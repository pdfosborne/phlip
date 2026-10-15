package app.phlip.server

import com.google.gson.JsonArray
import com.google.gson.JsonDeserializationContext
import com.google.gson.JsonDeserializer
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonSerializationContext
import com.google.gson.JsonSerializer
import java.lang.reflect.Type

// An event category ("Sport", "Food", …): groups event-type cards in the
// creation flow and colors/glyphs their ticket cards (accent hex, matched
// client-side against a curated palette for the paired tint wash — see
// CATEGORY_PALETTE in app.js). Names/icons/color are plaintext (same exposure
// as channel names' enabledCardIds). Server-level so every member sees the
// same set; defaults seeded per server.
data class Category(val id: String, var name: String, var icon: String = "custom", var color: String = "#6b675e")

/**
 * A first-class event type — the template a member picks before an event exists,
 * and the thing a card renders from (§5 of the admin/roles spec). Server-level
 * and plaintext (same exposure as [Category]) so the whole group shares one
 * vocabulary; an event points back with [Event.typeId].
 *
 * [color] is legacy and ignored (006) — tint comes from [categoryId]'s category.
 * [defaultDuration] null → 1h. [allowedLocations] null → every curated place.
 * [whoCanCreate] null / "inherit" → server default; "moderator" → moderators+ only.
 * [freeform] marks the permissive "Something else" escape-hatch type.
 * [capacity]/[signup] are reserved for the deferred RSVP pass — stored, not yet enforced.
 */
data class EventType(
    val id: String,
    var name: String,
    var icon: String = "custom",
    var color: String? = null,
    var categoryId: String? = null,
    var defaultDuration: String? = null,
    var allowedLocations: MutableList<String>? = null,
    var whoCanCreate: String? = null,
    var freeform: Boolean = false,
    var order: Int = 0,
    // Reserved (deferred RSVP pass): "unlimited" | "<n>" | "<min>-<max>".
    var capacity: String? = null,
    // Reserved (deferred RSVP pass): "yesno" | "capped" | "none".
    var signup: String? = null,
)

/** Stable slug id for a seeded/created type label (e.g. "Film night" → "film_night"). */
fun eventTypeSlug(label: String): String =
    label.trim().lowercase()
        .replace(Regex("[^a-z0-9]+"), "_")
        .trim('_')
        .take(40)
        .ifEmpty { "type" }

/**
 * Built-in event-type pack, mirroring the client's `EVENT_CARDS` (hand.js) so a
 * server seeds the same starter vocabulary every client already knows. Colour is
 * left null (inherits the category); the host can override per type afterwards.
 * The order here drives [EventType.order]. Kept in sync with hand.js.
 */
fun defaultEventTypes(): MutableList<EventType> = eventTypesForPreset(PRESET_FRIEND)

/** §6 setup presets — ids persisted on [AppState.setupPreset]. */
const val PRESET_FRIEND = "friend"
const val PRESET_CIRCLES = "circles"
const val PRESET_CLUB = "club"
/** One shared board for a household; pairs with [AppState.allowPinnedPeople]. */
const val PRESET_FAMILY = "family"
/** The host posts classes/events; members RSVP. For shops, studios, small venues. */
const val PRESET_BUSINESS = "business"
/** Neutral baseline — same permission ceiling as a typical open server, no themed pack. */
const val PRESET_SCRATCH = "scratch"
private val SETUP_PRESETS =
    setOf(PRESET_FRIEND, PRESET_CIRCLES, PRESET_CLUB, PRESET_FAMILY, PRESET_BUSINESS, PRESET_SCRATCH)

fun normalizeSetupPreset(raw: String?): String {
    val v = (raw ?: "").trim().lowercase()
    return if (v in SETUP_PRESETS) v else PRESET_FRIEND
}

/** Court/pitch sports a club can book several numbered venues for at once. */
private val COURT_SPORTS = setOf("tennis", "badminton", "squash", "basketball", "volleyball", "netball")
private val PITCH_SPORTS = setOf("football", "soccer", "hockey", "rugby", "cricket", "lacrosse")

/**
 * Whether a club's activity plays on several bookable venues at once (courts/pitches).
 * These get a numbered-venue pack and [AppState.allowMultiLocations] on by default —
 * an unrecognised or blank activity (a society, network, or community group) does not,
 * since most such groups meet in one place at a time.
 */
fun clubHasMultiLocationVenues(activity: String?): Boolean {
    val act = (activity ?: "").trim().lowercase()
    if (act.isEmpty()) return false
    return COURT_SPORTS.any { act.contains(it) } || PITCH_SPORTS.any { act.contains(it) }
}

/** First bookable venue label for a multi-location club — seeds one pinned-location
 *  board so members can see the pattern. Null for non-venue (community) clubs. */
fun clubPrimaryVenueLabel(activity: String?): String? {
    if (!clubHasMultiLocationVenues(activity)) return null
    val act = (activity ?: "").trim().lowercase()
    return if (PITCH_SPORTS.any { act.contains(it) }) "Pitch 1" else "Court 1"
}

/** Starter type packs for each §6 preset. */
fun eventTypesForPreset(preset: String, activity: String? = null): MutableList<EventType> {
    val p = normalizeSetupPreset(preset)
    val pack: List<Triple<String, String, String>> = when (p) {
        PRESET_CLUB -> {
            val act = (activity ?: "").trim().lowercase()
            when {
                clubHasMultiLocationVenues(activity) && PITCH_SPORTS.any { act.contains(it) } -> listOf(
                    Triple("Training", "sport", "sport"),
                    Triple("Match", "sport", "sport"),
                    Triple("Practice", "sport", "sport"),
                    Triple("Social", "party", "social"),
                )
                clubHasMultiLocationVenues(activity) -> listOf(
                    Triple("Coaching", "sport", "sport"),
                    Triple("Match", "sport", "sport"),
                    Triple("Practice", "sport", "sport"),
                    Triple("Social", "party", "social"),
                )
                else -> listOf(
                    // No fixed venue — a society, network or community group.
                    Triple("Meetup", "party", "social"),
                    Triple("Class", "custom", "other"),
                    Triple("Coffee morning", "dinner", "food"),
                    Triple("Talk", "film", "entertainment"),
                )
            }
        }
        PRESET_CIRCLES -> listOf(
            Triple("Meetup", "party", "social"),
            Triple("Dinner", "dinner", "food"),
            Triple("Trip", "hike", "social"),
        )
        PRESET_FAMILY -> listOf(
            // Small and mixed on purpose — one shared board covers all of it.
            Triple("Meal", "dinner", "food"),
            Triple("Outing", "hike", "social"),
            Triple("Chore", "custom", "other"),
        )
        PRESET_BUSINESS -> {
            val act = (activity ?: "").trim().lowercase()
            when {
                act.contains("pottery") || act.contains("craft") || act.contains("art") || act.contains("studio") -> listOf(
                    Triple("Class", "custom", "other"),
                    Triple("Open studio", "custom", "other"),
                )
                act.contains("book") || act.contains("read") || act.contains("poetry") || act.contains("writing") -> listOf(
                    Triple("Book club", "film", "entertainment"),
                    Triple("Poetry night", "film", "entertainment"),
                )
                else -> listOf(
                    Triple("Class", "custom", "other"),
                    Triple("Event", "party", "social"),
                )
            }
        }
        PRESET_SCRATCH -> listOf(
            // Broad starter vocabulary — organiser trims later.
            Triple("Dinner", "dinner", "food"),
            Triple("Drinks", "drinks", "social"),
            Triple("Film night", "film", "entertainment"),
            Triple("Games", "games", "entertainment"),
            Triple("Party", "party", "social"),
            Triple("Sport", "sport", "sport"),
        )
        else -> listOf(
            Triple("Dinner", "dinner", "food"),
            Triple("Drinks", "drinks", "social"),
            Triple("Film night", "film", "entertainment"),
            Triple("Games", "games", "entertainment"),
            Triple("Trip", "hike", "social"),
            Triple("Birthday", "party", "social"),
        )
    }
    val who = when (p) {
        PRESET_CLUB -> "moderator"
        PRESET_BUSINESS -> "admin"
        else -> null
    }
    return pack.mapIndexed { i, (label, icon, cat) ->
        EventType(
            id = eventTypeSlug(label),
            name = label,
            icon = icon,
            categoryId = cat,
            order = i,
            whoCanCreate = who,
        )
    }.toMutableList()
}

fun locationsForPreset(preset: String, activity: String? = null): MutableList<PlaceEntry> {
    return when (normalizeSetupPreset(preset)) {
        PRESET_CLUB -> {
            val act = (activity ?: "").trim().lowercase()
            when {
                PITCH_SPORTS.any { act.contains(it) } -> mutableListOf(
                    placeEntry("Club", "work"),
                    placeEntry("Pitch 1", "leisure"),
                    placeEntry("Pitch 2", "leisure"),
                )
                clubHasMultiLocationVenues(activity) -> mutableListOf(
                    placeEntry("Club", "work"),
                    placeEntry("Court 1", "leisure"),
                    placeEntry("Court 2", "leisure"),
                    placeEntry("Court 3", "leisure"),
                )
                else -> mutableListOf(
                    // No fixed venue — organiser adds their usual haunts.
                    placeEntry("Venue", "other"),
                    placeEntry("Hall", "work"),
                )
            }
        }
        PRESET_CIRCLES -> mutableListOf(
            placeEntry("Home"),
            placeEntry("Town"),
            placeEntry("Cafe", "food"),
            placeEntry("Work"),
        )
        PRESET_FAMILY -> mutableListOf(
            placeEntry("Home"),
            placeEntry("Park", "leisure"),
        )
        PRESET_BUSINESS -> mutableListOf(
            placeEntry((activity ?: "").trim().take(40).ifEmpty { "Venue" }, "work"),
        )
        else -> defaultLocations()
    }
}

/**
 * Example boards each preset seeds (plus a standalone Welcome chat).
 */
data class BoardSeed(
    val name: String,
    val open: Boolean = false,
    val autoInclude: Boolean = false,
    /** null = everyone (viewers included); "user" | "moderator" | "admin" */
    val minRole: String? = null,
)

/** null = no role floor (viewers included). Stored values: user | moderator | admin. */
fun normalizeChannelMinRole(raw: String?): String? {
    val v = raw?.trim()?.lowercase().orEmpty()
    return when (v) {
        "", "viewer", "everyone" -> null
        "user", "member" -> "user"
        "moderator", "mod" -> "moderator"
        "admin" -> "admin"
        else -> null
    }
}

fun boardSeedsForPreset(preset: String, activity: String? = null): List<BoardSeed> {
    return when (normalizeSetupPreset(preset)) {
        PRESET_CLUB -> listOf(
            BoardSeed("Members", open = true, minRole = "user"),
            BoardSeed("Committee", open = true, minRole = "moderator"),
            BoardSeed("Admin", open = true, minRole = "admin"),
            BoardSeed("Fixtures", open = true, minRole = "user"),
            BoardSeed("Open-invite", open = true),
            BoardSeed("Socials", autoInclude = false),
        )
        PRESET_CIRCLES -> listOf(
            BoardSeed("Work", autoInclude = false),
            BoardSeed("Home", autoInclude = false),
            BoardSeed("Friends", autoInclude = false),
        )
        // One shared board on purpose — pairs with allowPinnedPeople for a
        // member's own follow-along board, once there's more than one of you.
        PRESET_FAMILY -> listOf(
            BoardSeed("Family", open = true),
        )
        // The host runs the calendar; members see and RSVP. A class/session
        // split covers most small venues without over-fitting one trade.
        PRESET_BUSINESS -> listOf(
            BoardSeed("Classes", open = true),
            BoardSeed("Open sessions", open = true),
        )
        PRESET_SCRATCH -> listOf(
            BoardSeed("Group", autoInclude = false),
            BoardSeed("Direct", autoInclude = false),
            BoardSeed("Events", autoInclude = false),
            BoardSeed("Section", autoInclude = false),
            BoardSeed("Private plans", autoInclude = false),
        )
        else -> listOf( // friend
            BoardSeed("The crew", open = true, minRole = "user"),
            BoardSeed("Events", autoInclude = true),
            BoardSeed("London based", autoInclude = false),
            BoardSeed("Uni mates", autoInclude = false),
            BoardSeed("Home mates", autoInclude = false),
        )
    }
}

fun defaultCategories(): MutableList<Category> = mutableListOf(
    Category("entertainment", "Entertainment", "film", "#6b63e0"),
    Category("food", "Food", "dinner", "#4f9e6a"),
    Category("social", "Social", "party", "#c2569e"),
    Category("sport", "Sport", "sport", "#d9534f"),
    Category("other", "Other", "custom", "#6b675e"),
)

/** Places offered when planning — host can edit; seeded on new / empty servers. */
data class PlaceEntry(
    var label: String = "",
    var categoryId: String = "other",
    /** Shared Google Maps / Apple Maps / OSM link. Empty when nobody has attached one. */
    var mapUrl: String? = null,
)

/** Keep http(s) and geo map links; drop anything else. */
fun sanitizePlaceMapUrl(raw: String?): String? {
    val text = raw?.trim().orEmpty()
    if (text.isEmpty() || text.length > 500) return null
    val lower = text.lowercase()
    if (lower.startsWith("geo:") || lower.startsWith("https://") || lower.startsWith("http://")) return text
    return null
}

fun inferLocationCategoryId(label: String): String {
    val key = label.trim().lowercase()
    return when (key) {
        "home", "friend's place" -> "home"
        "town", "city centre" -> "out"
        "pub", "coffee shop", "restaurant", "cafe" -> "food"
        "park", "cinema", "gym" -> "leisure"
        "work", "club", "main hall", "studio" -> "work"
        else -> when {
            key.startsWith("court") || key.startsWith("pitch") -> "leisure"
            else -> "other"
        }
    }
}

fun placeEntry(label: String, categoryId: String? = null): PlaceEntry =
    PlaceEntry(label, categoryId ?: inferLocationCategoryId(label))

/** Gson: accept legacy string[] and object[] for [AppState.locations]. */
class PlaceEntryListAdapter : JsonDeserializer<MutableList<PlaceEntry>>, JsonSerializer<MutableList<PlaceEntry>> {
    override fun deserialize(
        json: JsonElement,
        typeOfT: Type,
        context: JsonDeserializationContext,
    ): MutableList<PlaceEntry> {
        if (!json.isJsonArray) return defaultLocations()
        val out = mutableListOf<PlaceEntry>()
        val seen = mutableSetOf<String>()
        for (el in json.asJsonArray) {
            val place = when {
                el.isJsonPrimitive && el.asJsonPrimitive.isString -> {
                    val label = el.asString.trim()
                    if (label.isEmpty()) null else placeEntry(label)
                }
                el.isJsonObject -> {
                    val o = el.asJsonObject
                    val label = o.get("label")?.asString?.trim().orEmpty()
                    if (label.isEmpty()) null
                    else {
                        val cat = o.get("categoryId")?.takeIf { it.isJsonPrimitive }?.asString?.trim().orEmpty()
                            .ifEmpty { inferLocationCategoryId(label) }
                        val mapRaw = o.get("mapUrl")?.takeIf { it.isJsonPrimitive }?.asString
                        PlaceEntry(label, cat, sanitizePlaceMapUrl(mapRaw))
                    }
                }
                else -> null
            }
            if (place == null) continue
            val key = place.label.lowercase()
            if (key in seen) continue
            seen.add(key)
            out.add(place)
        }
        return if (out.isEmpty()) defaultLocations() else out
    }

    override fun serialize(
        src: MutableList<PlaceEntry>?,
        typeOfSrc: Type,
        context: JsonSerializationContext,
    ): JsonElement {
        val arr = JsonArray()
        for (p in src.orEmpty()) {
            val o = JsonObject()
            o.addProperty("label", p.label)
            o.addProperty("categoryId", p.categoryId)
            sanitizePlaceMapUrl(p.mapUrl)?.let { o.addProperty("mapUrl", it) }
            arr.add(o)
        }
        return arr
    }
}

fun defaultLocations(): MutableList<PlaceEntry> = mutableListOf(
    placeEntry("Home"),
    placeEntry("Town"),
    placeEntry("City Centre"),
    placeEntry("Pub"),
    placeEntry("Coffee Shop"),
    placeEntry("Restaurant"),
    placeEntry("Park"),
    placeEntry("Cinema"),
    placeEntry("Gym"),
    placeEntry("Work"),
    placeEntry("Friend's place"),
)

/**
 * One drawn reaction in the server-wide library (`d:` stroke payload) plus who
 * first drew it. Legacy data may be a bare string — see [ReactionCardListAdapter].
 */
data class ReactionCardEntry(
    var card: String = "",
    var createdBy: String? = null,
    var createdByName: String? = null,
)

/** Gson: accept legacy string[] and object[] for [AppState.reactionCards]. */
class ReactionCardListAdapter :
    JsonDeserializer<MutableList<ReactionCardEntry>>,
    JsonSerializer<MutableList<ReactionCardEntry>> {
    override fun deserialize(
        json: JsonElement,
        typeOfT: Type,
        context: JsonDeserializationContext,
    ): MutableList<ReactionCardEntry> {
        if (!json.isJsonArray) return mutableListOf()
        val out = mutableListOf<ReactionCardEntry>()
        val seen = mutableSetOf<String>()
        for (el in json.asJsonArray) {
            val entry = when {
                el.isJsonPrimitive && el.asJsonPrimitive.isString -> {
                    val card = el.asString.trim()
                    if (card.isEmpty()) null else ReactionCardEntry(card = card)
                }
                el.isJsonObject -> {
                    val o = el.asJsonObject
                    val card = (o.get("card")?.asString ?: o.get("emoji")?.asString ?: o.get("id")?.asString)
                        ?.trim().orEmpty()
                    if (card.isEmpty()) null
                    else ReactionCardEntry(
                        card = card,
                        createdBy = o.get("createdBy")?.asString?.trim()?.ifEmpty { null },
                        createdByName = o.get("createdByName")?.asString?.trim()?.ifEmpty { null },
                    )
                }
                else -> null
            } ?: continue
            if (!seen.add(entry.card)) continue
            out.add(entry)
        }
        return out
    }

    override fun serialize(
        src: MutableList<ReactionCardEntry>?,
        typeOfSrc: Type,
        context: JsonSerializationContext,
    ): JsonElement {
        val arr = JsonArray()
        for (e in src.orEmpty()) {
            val card = e.card.trim()
            if (card.isEmpty()) continue
            val o = JsonObject()
            o.addProperty("card", card)
            e.createdBy?.takeIf { it.isNotBlank() }?.let { o.addProperty("createdBy", it) }
            e.createdByName?.takeIf { it.isNotBlank() }?.let { o.addProperty("createdByName", it) }
            arr.add(o)
        }
        return arr
    }
}

/** Add a drawn `d:` payload to the shared catalog if missing. Returns true when added. */
internal fun upsertDrawnCard(state: AppState, user: User, payload: String?): Boolean {
    val card = clampReaction(payload) ?: return false
    if (!card.startsWith("d:")) return false
    val cards = state.reactionCards
        ?: mutableListOf<ReactionCardEntry>().also { state.reactionCards = it }
    if (cards.any { it.card == card }) return false
    cards.add(
        ReactionCardEntry(
            card = card,
            createdBy = user.id,
            createdByName = user.name.trim().ifEmpty { null },
        ),
    )
    while (cards.size > MAX_REACTION_CARDS) cards.removeAt(0)
    return true
}

/**
 * Remove a drawing from the catalog and every place it is used
 * (event icons, leftover event reaction stacks, types, chat).
 * Returns true when anything changed.
 */
internal fun stripDrawnCard(state: AppState, raw: String?): Boolean {
    val card = clampReaction(raw) ?: return false
    if (!card.startsWith("d:")) return false
    var changed = false
    val cards = state.reactionCards
    if (cards != null && cards.removeAll { it.card == card }) changed = true
    for (ev in state.events) {
        if (ev.icon == card) {
            ev.icon = null
            changed = true
        }
        val stacks = ev.reactionStacks ?: continue
        var stackChanged = false
        for ((uid, list) in stacks.toList()) {
            val before = list.size
            list.removeAll { it == card }
            if (list.size != before) stackChanged = true
            if (list.isEmpty()) stacks.remove(uid)
        }
        if (!stackChanged) continue
        changed = true
        if (stacks.isEmpty()) {
            ev.reactionStacks = null
            ev.reactions = null
        } else {
            val summary = mutableMapOf<String, String>()
            for ((uid, list) in stacks) {
                if (list.isEmpty()) continue
                val last = list.last()
                summary[uid] = if (list.size > 1) "$last|${list.size.coerceAtMost(99)}" else last
            }
            ev.reactions = summary.takeIf { it.isNotEmpty() }
        }
    }
    for (type in state.eventTypes) {
        if (type.icon == card) {
            type.icon = "custom"
            changed = true
        }
    }
    for (list in state.messages.values) {
        for (i in list.indices) {
            val msg = list[i]
            val map = msg.reactions ?: continue
            if (map.values.none { it == card }) continue
            val next = map.filterValues { it != card }.toMutableMap()
            list[i] = msg.copy(reactions = next.takeIf { it.isNotEmpty() })
            changed = true
        }
    }
    return changed
}

fun defaultCardCats(): MutableMap<String, String> = mutableMapOf(
    "Film night" to "entertainment",
    "Games" to "entertainment",
    "Dinner" to "food",
    "Coffee" to "food",
    "Lunch" to "food",
    "Brunch" to "food",
    "Pizza" to "food",
    "Drinks" to "social",
    "Hike" to "social",
    "Party" to "social",
    "Sport" to "sport",
)
