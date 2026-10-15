package app.phlip.server

import org.json.JSONObject

/**
 * Catalog vocabulary content type (categories, event types, locations, card maps).
 *
 * **Store:** [AppState.categories], [AppState.cardCats], [AppState.cardDurations],
 * [AppState.removedCards], [AppState.eventTypes], [AppState.locations],
 * [AppState.allowFreeform]. Plaintext shared vocabulary for all members;
 * `updateEventTypes` may reassign [Event.typeId] when labels change.
 *
 * **User → host:** RPC `updateCategories`, `updateEventTypes`, `addEventType`,
 * `updateLocations`, `addLocation` (managers or capability-gated add-*).
 *
 * **Host → users:** [CollaborationCommandService.Operations.pushSyncToAll]
 * (filtered `sync` includes catalog fields).
 */
internal class CatalogHandler(
    private val s: CollaborationCommandSupport,
) {
    fun cmdUpdateCategories(user: User, m: JSONObject) {
        if (!s.authorization.canManageServer(user)) return
        val arr = m.optJSONArray("categories") ?: return
        if (arr.length() == 0 || arr.length() > MAX_CATEGORIES) return
        val hexPattern = Regex("^#[0-9a-fA-F]{6}$")
        val fresh = mutableListOf<Category>()
        for (i in 0 until arr.length()) {
            val c = arr.optJSONObject(i) ?: return
            val name = c.optString("name").trim().take(24).ifEmpty { return }
            val icon = clampIcon(c.optString("icon")) ?: "custom"
            val id = c.optString("id").trim().take(24).ifEmpty { s.idGenerator() }
            val color = c.optString("color").trim().takeIf { hexPattern.matches(it) } ?: "#6b675e"
            if (fresh.any { it.id == id }) return
            fresh.add(Category(id, name, icon, color))
        }
        s.state.categories = fresh
        val catsMap = m.optJSONObject("cardCats")
        if (catsMap != null) {
            val valid = fresh.map { it.id }.toSet()
            val fallback = fresh.find { it.id == "other" }?.id ?: fresh.first().id
            val next = mutableMapOf<String, String>()
            val keys = catsMap.keys()
            while (keys.hasNext()) {
                val label = keys.next().trim().take(40)
                if (label.isEmpty()) continue
                val catId = catsMap.optString(label).trim().take(24)
                next[label] = if (catId in valid) catId else fallback
            }
            s.state.cardCats = next
        } else {
            val valid = fresh.map { it.id }.toSet()
            val fallback = fresh.find { it.id == "other" }?.id ?: fresh.first().id
            s.state.cardCats = s.state.cardCats.mapValues { (_, v) -> if (v in valid) v else fallback }.toMutableMap()
        }
        if (m.has("removedCards")) {
            val removed = s.jsonStringList(m.optJSONArray("removedCards")) ?: mutableListOf()
            s.state.removedCards = removed.map { it.trim().take(40) }.filter { it.isNotEmpty() }
                .distinct().take(200).toMutableList()
            for (label in s.state.removedCards) {
                s.state.cardCats.remove(label)
                s.state.cardDurations.remove(label)
            }
        }
        m.optJSONObject("cardDurations")?.let { durations ->
            val next = mutableMapOf<String, String>()
            val keys = durations.keys()
            while (keys.hasNext()) {
                val label = keys.next().trim().take(40)
                if (label.isEmpty()) continue
                val code = durations.optString(label).trim().take(16)
                if (code in EVENT_DURATION_CODES) next[label] = code
            }
            s.state.cardDurations = next
        }
        s.operations.save()
        s.operations.pushSyncToAll()
    }

    fun cmdUpdateEventTypes(user: User, m: JSONObject) {
        if (!s.authorization.canManageServer(user)) return
        val arr = m.optJSONArray("eventTypes") ?: return
        if (arr.length() == 0 || arr.length() > MAX_EVENT_TYPES) return
        val validCats = s.state.categories.map { it.id }.toSet()
        val validLocs = s.state.locations.map { it.label.lowercase() }.toSet()
        val fresh = mutableListOf<EventType>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: return
            val name = o.optString("name").trim().take(40).ifEmpty { return }
            val id = o.optString("id").trim().take(40).ifEmpty { eventTypeSlug(name) }
                .let { s.uniqueTypeId(it, fresh) }
            val icon = clampIcon(o.optString("icon")) ?: "custom"
            val categoryId = o.optString("categoryId").trim().takeIf { it in validCats }
            val defaultDuration = o.optString("defaultDuration").trim().takeIf { it in EVENT_DURATION_CODES }
            val allowedLocations = o.optJSONArray("allowedLocations")?.let { locationArray ->
                val out = mutableListOf<String>()
                val seen = mutableSetOf<String>()
                for (j in 0 until locationArray.length()) {
                    val loc = locationArray.optString(j).trim().take(60)
                    val key = loc.lowercase()
                    if (loc.isNotEmpty() && key in validLocs && key !in seen) { seen.add(key); out.add(loc) }
                }
                out
            }
            val whoCanCreate = o.optString("whoCanCreate").trim().lowercase().takeIf { it == ROLE_MODERATOR }
            fresh.add(EventType(
                id = id, name = name, icon = icon, color = null, categoryId = categoryId,
                defaultDuration = defaultDuration, allowedLocations = allowedLocations,
                whoCanCreate = whoCanCreate, freeform = false,
                order = i, capacity = o.optString("capacity").trim().take(24).ifEmpty { null },
                signup = o.optString("signup").trim().take(24).ifEmpty { null },
            ))
        }
        val freshIds = fresh.map { it.id }.toHashSet()
        m.optJSONObject("reassign")?.let { reassign ->
            val keys = reassign.keys()
            while (keys.hasNext()) {
                val oldId = keys.next()
                val newId = reassign.optString(oldId).trim()
                if (newId.isEmpty() || newId !in freshIds) continue
                for (event in s.state.events) if (event.typeId == oldId) event.typeId = newId
            }
        }
        s.state.eventTypes = fresh
        if (m.has("allowFreeform")) s.state.allowFreeform = m.optBoolean("allowFreeform", true)
        s.operations.save()
        s.operations.pushSyncToAll()
    }

    fun cmdUpdateLocations(user: User, m: JSONObject) {
        if (!s.authorization.canManageServer(user)) return
        val arr = m.optJSONArray("locations") ?: return
        if (arr.length() > MAX_LOCATIONS) return
        val fresh = mutableListOf<PlaceEntry>()
        val seen = mutableSetOf<String>()
        for (i in 0 until arr.length()) {
            val element = arr.opt(i)
            val place = when (element) {
                is JSONObject -> {
                    val label = element.optString("label").trim().take(60)
                    if (label.isEmpty()) null else PlaceEntry(label, element.optString("categoryId").trim()
                        .ifEmpty { inferLocationCategoryId(label) }.take(40))
                }
                else -> {
                    val label = arr.optString(i).trim().take(60)
                    if (label.isEmpty()) null else placeEntry(label)
                }
            } ?: continue
            val key = place.label.lowercase()
            if (key in seen) continue
            seen.add(key)
            fresh.add(place)
        }
        s.state.locations = fresh
        s.operations.save()
        s.operations.pushSyncToAll()
    }

    fun cmdAddLocation(user: User, m: JSONObject) {
        if (!s.authorization.canAddLocations(user)) return
        val label = m.optString("location").trim().take(60).ifEmpty { return }
        val categoryId = m.optString("categoryId").trim().ifEmpty { inferLocationCategoryId(label) }.take(40)
        if (s.state.locations.any { it.label.equals(label, ignoreCase = true) }) return
        if (s.state.locations.size >= MAX_LOCATIONS) return
        s.state.locations.add(PlaceEntry(label, categoryId))
        s.operations.save()
        s.operations.pushSyncToAll()
    }

    fun cmdAddEventType(user: User, m: JSONObject) {
        if (!s.authorization.canCreateEventTypes(user)) return
        if (s.state.eventTypes.size >= MAX_EVENT_TYPES) return
        val validCats = s.state.categories.map { it.id }.toSet()
        val validLocs = s.state.locations.map { it.label.lowercase() }.toSet()
        val name = m.optString("name").trim().take(40).ifEmpty { return }
        if (s.state.eventTypes.any { it.name.equals(name, ignoreCase = true) }) return
        val id = s.uniqueTypeId(eventTypeSlug(name), s.state.eventTypes)
        var icon = clampIcon(m.optString("icon")) ?: "custom"
        if (icon.startsWith("d:") && !s.authorization.canUserDraw()) icon = "custom"
        val allowedLocations = m.optJSONArray("allowedLocations")?.let { locationArray ->
            val out = mutableListOf<String>()
            val seen = mutableSetOf<String>()
            for (j in 0 until locationArray.length()) {
                val loc = locationArray.optString(j).trim().take(60)
                val key = loc.lowercase()
                if (loc.isNotEmpty() && key in validLocs && key !in seen) { seen.add(key); out.add(loc) }
            }
            out
        }
        s.state.eventTypes.add(EventType(
            id = id, name = name, icon = icon, color = null,
            categoryId = m.optString("categoryId").trim().takeIf { it in validCats },
            defaultDuration = m.optString("defaultDuration").trim().takeIf { it in EVENT_DURATION_CODES },
            allowedLocations = allowedLocations,
            whoCanCreate = m.optString("whoCanCreate").trim().lowercase().takeIf { it == ROLE_MODERATOR },
            freeform = false, order = s.state.eventTypes.size,
        ))
        upsertDrawnCard(s.state, user, icon)
        s.operations.save()
        s.operations.pushSyncToAll()
    }

    /** Admin: remove a drawing from the shared library and every event, type, routine, and chat. */
    fun cmdDeleteReactionCard(user: User, m: JSONObject) {
        if (!s.authorization.canManageServer(user)) return
        val card = clampReaction(m.optString("card").ifEmpty { m.optString("emoji") }) ?: return
        if (!stripDrawnCard(s.state, card)) return
        s.operations.save()
        s.operations.pushSyncToAll()
    }
}
