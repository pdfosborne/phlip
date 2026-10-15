package app.phlip.server

import org.json.JSONArray
import org.json.JSONObject

/** Event field edits, category card map, and notification read marks. */
internal class EventFieldsHandler(
    private val s: EventCommandSupport,
) {
    fun cmdSetEventWhere(user: User, m: JSONObject) {
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return
        if (!s.authorization.canEditEvent(user, ev)) return
        val old = ev.where
        ev.where = opaqueCiphertext(m.optString("where"))
        if (ev.where.isEmpty()) {
            ev.locationLabelId = null
        } else if (m.has("locationLabelId")) {
            ev.locationLabelId = sanitizeLocationLabelId(m.optString("locationLabelId"), s.state.locations)
        }
        s.operations.save()
        s.operations.broadcastToChannel(ch, JSONObject().put("type", "eventWhereUpdated")
            .put("eventId", ev.id).put("where", ev.where)
            .put("locationLabelId", ev.locationLabelId ?: JSONObject.NULL))
        if (old != ev.where) s.appendEventActivity(ch, ev, EventNote(
            user.id, user.name, "", System.currentTimeMillis(), activity = "where"))
        s.syncPinnedViewersIfNeeded(ev)
    }

    fun cmdSetEventDetails(user: User, m: JSONObject) {
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return
        if (!s.authorization.canEditEvent(user, ev)) return
        val old = ev.details
        ev.details = opaqueCiphertext(m.optString("details"))
        s.operations.save()
        s.operations.broadcastToChannel(ch, JSONObject().put("type", "eventDetailsUpdated")
            .put("eventId", ev.id).put("details", ev.details))
        if (old != ev.details) s.appendEventActivity(ch, ev, EventNote(
            user.id, user.name, "", System.currentTimeMillis(), activity = "details"))
    }


    fun cmdSetEventSticker(user: User, m: JSONObject) {
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return
        val canSticker = s.authorization.canChannel(user, ch, PERM_FLAG_STICKERS) ||
            s.authorization.canEditEvent(user, ev)
        if (!canSticker) return
        val old = ev.sticker ?: ""
        ev.sticker = opaqueCiphertext(m.optString("sticker")).ifEmpty { null }
        if (ev.sticker != null) {
            ev.stickerBy = user.id
            ev.stickerByName = user.name
        } else {
            ev.stickerBy = null
            ev.stickerByName = null
        }
        s.operations.save()
        s.operations.broadcastToChannel(ch, JSONObject().put("type", "eventStickerUpdated")
            .put("eventId", ev.id).put("sticker", ev.sticker ?: "")
            .put("stickerBy", ev.stickerBy ?: JSONObject.NULL)
            .put("stickerByName", ev.stickerByName ?: JSONObject.NULL))
        if (old != (ev.sticker ?: "")) s.appendEventActivity(ch, ev, EventNote(
            user.id, user.name, "", System.currentTimeMillis(), activity = "sticker"))
    }

    fun cmdSetEventSubtitle(user: User, m: JSONObject) {
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return
        if (!s.authorization.canEditEvent(user, ev)) return
        val old = ev.subtitle ?: ""
        ev.subtitle = opaqueCiphertext(m.optString("subtitle")).ifEmpty { null }
        s.operations.save()
        s.operations.broadcastToChannel(ch, JSONObject().put("type", "eventSubtitleUpdated")
            .put("eventId", ev.id).put("subtitle", ev.subtitle ?: ""))
        if (old != (ev.subtitle ?: "")) s.appendEventActivity(ch, ev, EventNote(
            user.id, user.name, "", System.currentTimeMillis(), activity = "subtitle"))
    }

    fun cmdSetEventDuration(user: User, m: JSONObject) {
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return
        if (!s.authorization.canEditEvent(user, ev)) return
        val old = ev.duration
        ev.duration = m.optString("duration").trim().take(16).takeIf { it in EVENT_DURATION_CODES }
        s.operations.save()
        s.operations.broadcastToChannel(ch, JSONObject().put("type", "eventDurationUpdated")
            .put("eventId", ev.id).put("duration", ev.duration ?: JSONObject.NULL))
        if (old != ev.duration) s.appendEventActivity(ch, ev, EventNote(
            user.id, user.name, "", System.currentTimeMillis(), activity = "duration",
            oldValue = old, newValue = ev.duration))
        s.syncPinnedViewersIfNeeded(ev)
        s.operations.clearOverlappingAvailabilities(ev)
    }

    fun cmdSetEventIcon(user: User, m: JSONObject) {
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return
        if (!s.authorization.channelVisible(ch, user) || !s.authorization.canEditEvent(user, ev)) return
        val old = ev.icon ?: ""
        var next = clampIcon(m.optString("icon"))
        if (next?.startsWith("d:") == true && !s.authorization.canUserDraw()) {
            s.operations.sendToUser(user, JSONObject().put("type", "error")
                .put("error", "Drawing is turned off on this server."))
            return
        }
        ev.icon = next
        val catalogChanged = upsertDrawnCard(s.state, user, ev.icon)
        s.operations.save()
        val payload = JSONObject().put("type", "eventIconUpdated")
            .put("eventId", ev.id).put("icon", ev.icon ?: "")
        if (catalogChanged) {
            payload.put(
                "reactionCards",
                JSONArray(s.gson.toJson(s.state.reactionCards ?: emptyList<ReactionCardEntry>())),
            )
        }
        s.operations.broadcastToChannel(ch, payload)
        if (old != (ev.icon ?: "")) s.appendEventActivity(ch, ev, EventNote(
            user.id, user.name, "", System.currentTimeMillis(), activity = "icon",
            oldValue = old.ifEmpty { null }, newValue = ev.icon))
    }

    /**
     * Change type: retitle (opaque) + stamp typeId/icon/cat. Subtitle is left alone
     * so the client can show `NewType: ExistingSubtitle`.
     * [Event.title] is a val — replace the row via [Event.copy] (same as seal).
     */
    fun cmdSetEventType(user: User, m: JSONObject) {
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return
        if (!s.authorization.channelVisible(ch, user) || !s.authorization.canEditEvent(user, ev)) return
        val title = opaqueCiphertext(m.optString("title")).ifEmpty { return }
        val typeId = m.optString("typeId").trim().take(40).ifEmpty { null }
        val type = typeId?.let { id -> s.state.eventTypes.find { it.id == id } }
        if (typeId != null && type == null) return
        if (type != null && !s.authorization.canCreateType(user, type)) return
        val cat = (type?.categoryId ?: m.optString("cat").trim().take(24))
            .takeIf { !it.isNullOrEmpty() && s.state.categories.any { c -> c.id == it } }
        val idx = s.state.events.indexOf(ev)
        if (idx < 0) return
        val oldTitle = ev.title
        val nextCat = when {
            cat != null -> cat
            m.has("cat") && m.optString("cat").isBlank() -> null
            else -> ev.cat
        }
        var nextIcon = clampIcon(m.optString("icon"))
        if (nextIcon?.startsWith("d:") == true && !s.authorization.canUserDraw()) {
            s.operations.sendToUser(user, JSONObject().put("type", "error")
                .put("error", "Drawing is turned off on this server."))
            return
        }
        val updated = ev.copy(
            title = title,
            shortName = if (m.has("shortName")) opaqueCiphertext(m.optString("shortName")).ifEmpty { null } else ev.shortName,
            typeId = type?.id,
            icon = nextIcon,
            cat = nextCat,
        )
        s.state.events[idx] = updated
        val catalogChanged = upsertDrawnCard(s.state, user, updated.icon)
        s.operations.save()
        val payload = JSONObject().put("type", "eventTypeUpdated")
            .put("eventId", updated.id)
            .put("title", updated.title)
            .put("shortName", updated.shortName ?: "")
            .put("typeId", updated.typeId ?: JSONObject.NULL)
            .put("icon", updated.icon ?: "")
            .put("cat", updated.cat ?: JSONObject.NULL)
        if (catalogChanged) {
            payload.put(
                "reactionCards",
                JSONArray(s.gson.toJson(s.state.reactionCards ?: emptyList<ReactionCardEntry>())),
            )
        }
        s.operations.broadcastToChannel(ch, payload)
        if (oldTitle != updated.title) s.appendEventActivity(ch, updated, EventNote(
            user.id, user.name, "", System.currentTimeMillis(), activity = "type"))
    }

    fun cmdSetEventCategory(user: User, m: JSONObject) {
        if (!s.authorization.canManageServer(user)) return
        val label = m.optString("label").trim().take(40).ifEmpty { return }
        val categoryId = m.optString("categoryId").trim().take(24).ifEmpty { return }
        if (categoryId !in s.state.categories.map { it.id }.toSet()) return
        s.state.cardCats[label] = categoryId
        s.operations.save()
        s.operations.pushSyncToAll()
    }

    fun cmdSetEventCardStyle(user: User, m: JSONObject) {
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return
        if (ev.createdBy != user.id) return
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return
        if (!s.authorization.channelVisible(ch, user)) return
        val style = eventCardStyleFromJson(m.optJSONObject("eventCardStyle")) ?: return
        if (ev.eventCardStyle == style) return
        ev.eventCardStyle = style
        s.operations.save()
        s.operations.broadcastToChannel(ch, JSONObject()
            .put("type", "eventCardStyleUpdated")
            .put("eventId", ev.id)
            .put("eventCardStyle", JSONObject(s.gson.toJson(style))))
    }

    fun cmdMarkNotificationsRead(user: User, m: JSONObject) {
        val ids = s.jsonStringList(m.optJSONArray("ids"))?.toSet()
        val list = s.state.notifications[user.id] ?: return
        var changed = false
        for (n in list) if ((ids == null || n.id in ids) && !n.read) {
            n.read = true
            changed = true
        }
        if (changed) s.operations.save()
    }
}
