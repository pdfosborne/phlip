package app.phlip.server

import org.json.JSONObject

/** Event reactions and note/pin/publish/delete commands. */
internal class EventNotesHandler(
    private val s: EventCommandSupport,
) {
    fun cmdReact(user: User, m: JSONObject) {
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return
        if (!s.authorization.canChannel(user, ch, PERM_FLAG_REACT)) return
        val stacks = ev.reactionStacks
            ?: mutableMapOf<String, MutableList<String>>().also { ev.reactionStacks = it }
        scrubMangledStacks(stacks)

        val clearEmoji = m.optString("clearEmoji").takeIf { it.isNotEmpty() }?.let { clampReaction(it) }
        if (clearEmoji != null) {
            if (!s.authorization.canModerateEvents(user)) return
            if (!clearEmoji.startsWith("d:") && clearEmoji.all { it == '\uFFFD' }) return
            var removed = false
            for ((uid, list) in stacks.toList()) {
                val before = list.size
                list.removeAll { it == clearEmoji }
                if (list.size != before) removed = true
                if (list.isEmpty()) stacks.remove(uid)
            }
            if (!removed) return
            syncLegacyReactions(ev, stacks)
            s.operations.save()
            broadcastReactions(ch, ev, stacks)
            return
        }

        if (m.optBoolean("removeAll", false)) {
            val targetId = m.optString("userId").ifEmpty { user.id }
            if (targetId != user.id && !s.authorization.canModerateEvents(user)) return
            if (!stacks.containsKey(targetId)) return
            stacks.remove(targetId)
            syncLegacyReactions(ev, stacks)
            s.operations.save()
            broadcastReactions(ch, ev, stacks)
            return
        }

        if (m.optBoolean("remove", false)) {
            val targetId = m.optString("userId").ifEmpty { user.id }
            if (targetId != user.id && !s.authorization.canModerateEvents(user)) return
            if (!stacks.containsKey(targetId)) return
            stacks.remove(targetId)
            syncLegacyReactions(ev, stacks)
            s.operations.save()
            broadcastReactions(ch, ev, stacks)
            return
        }

        val emoji = clampReaction(m.optString("emoji")) ?: return
        if (!emoji.startsWith("d:") && emoji.all { it == '\uFFFD' }) return
        if (emoji.startsWith("d:") && !s.authorization.canUserDraw()) {
            s.operations.sendToUser(user, JSONObject().put("type", "error")
                .put("error", "Drawing is turned off on this server."))
            return
        }

        val list = stacks.getOrPut(user.id) { mutableListOf() }
        val append = m.optBoolean("append", false) || m.optBoolean("add", false)
        val clientActionId = m.optString("clientActionId").trim().take(40).ifEmpty { null }

        if (clientActionId != null) {
            val applied = ev.reactionActionIds ?: mutableListOf<String>().also { ev.reactionActionIds = it }
            if (applied.contains(clientActionId)) {
                syncLegacyReactions(ev, stacks)
                broadcastReactions(ch, ev, stacks)
                return
            }
        }

        if (append) {
            if (list.size >= MAX_REACTIONS_PER_USER) {
                s.operations.sendToUser(user, JSONObject().put("type", "error")
                    .put("error", "That’s enough reactions on this event."))
                return
            }
            list.add(emoji)
            if (clientActionId != null) {
                val applied = ev.reactionActionIds ?: mutableListOf<String>().also { ev.reactionActionIds = it }
                applied.add(clientActionId)
                while (applied.size > 64) applied.removeAt(0)
            }
            val catalogChanged = upsertDrawnCard(s.state, user, emoji)
            syncLegacyReactions(ev, stacks)
            s.operations.save()
            broadcastReactions(ch, ev, stacks, catalogChanged)
            return
        }

        // Legacy: count set → replace stack with N copies; no count → toggle.
        val count = if (m.has("count")) m.optInt("count").coerceIn(1, MAX_REACTIONS_PER_USER) else null
        if (count == null) {
            if (list.size == 1 && list.first() == emoji) stacks.remove(user.id)
            else stacks[user.id] = mutableListOf(emoji)
        } else {
            stacks[user.id] = MutableList(count) { emoji }
        }
        val catalogChanged = upsertDrawnCard(s.state, user, emoji)
        syncLegacyReactions(ev, stacks)
        s.operations.save()
        broadcastReactions(ch, ev, stacks, catalogChanged)
    }

    private fun scrubMangledStacks(stacks: MutableMap<String, MutableList<String>>) {
        for ((uid, list) in stacks.toList()) {
            list.removeAll { em -> em.isNotEmpty() && !em.startsWith("d:") && em.all { it == '\uFFFD' } }
            if (list.isEmpty()) stacks.remove(uid)
        }
    }

    private fun syncLegacyReactions(ev: Event, stacks: MutableMap<String, MutableList<String>>) {
        if (stacks.isEmpty()) {
            ev.reactions = null
            ev.reactionStacks = null
            return
        }
        val summary = mutableMapOf<String, String>()
        for ((uid, list) in stacks) {
            if (list.isEmpty()) continue
            val last = list.last()
            summary[uid] = if (list.size > 1) "$last|${list.size.coerceAtMost(99)}" else last
        }
        ev.reactions = summary.takeIf { it.isNotEmpty() }
        stacks.entries.removeAll { it.value.isEmpty() }
        if (stacks.isEmpty()) ev.reactionStacks = null
    }

    fun broadcastReactions(
        ch: Channel,
        ev: Event,
        stacks: MutableMap<String, MutableList<String>>,
        catalogChanged: Boolean = false,
    ) {
        val payload = JSONObject().put("type", "reactionUpdated")
            .put("eventId", ev.id)
            .put("reactions", JSONObject(s.gson.toJson(ev.reactions ?: emptyMap<String, String>())))
            .put("reactionStacks", JSONObject(s.gson.toJson(stacks)))
        if (catalogChanged) {
            payload.put(
                "reactionCards",
                org.json.JSONArray(s.gson.toJson(s.state.reactionCards ?: emptyList<ReactionCardEntry>())),
            )
        }
        s.operations.broadcastToChannel(ch, payload)
    }

    fun cmdEventNote(user: User, m: JSONObject) {
        if (!s.authorization.canMutateContent(user)) return
        val text = opaqueCiphertext(m.optString("text")).ifEmpty { return }
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return
        if (!s.authorization.channelVisible(ch, user)) return
        val mentioned = s.jsonStringList(m.optJSONArray("mentionedUserIds"))
            ?.filter { it != user.id && s.state.users.values.any { u -> u.id == it } }
            ?.distinct()?.takeIf { it.isNotEmpty() }
        var linkedEv: Event? = null
        val linkedId = m.optString("linkedEventId").ifEmpty { null }
        if (linkedId != null && linkedId != ev.id) {
            val other = s.state.events.find { it.id == linkedId }
            val otherCh = other?.let { e -> s.state.channels.find { it.id == e.channelId } }
            if (other != null && otherCh != null && s.authorization.channelVisible(otherCh, user)) linkedEv = other
        }
        val list = ev.notes ?: mutableListOf<EventNote>().also { ev.notes = it }
        val noteId = m.optString("noteId").trim().take(24).ifEmpty { null }
        if (noteId != null) {
            val existing = list.find { it.id == noteId }
            if (existing != null) {
                s.operations.broadcastToChannel(ch, JSONObject().put("type", "eventNoteAdded")
                    .put("eventId", ev.id).put("note", JSONObject(s.gson.toJson(existing))))
                return
            }
        }
        val resolvedNoteId = noteId ?: s.idGenerator()
        val noteKind = when (val raw = m.optString("noteKind").trim().lowercase()) {
            "shared", "personal" -> raw
            else -> null
        }
        val pinned = m.optBoolean("pinned", noteKind == "shared")
        val note = EventNote(user.id, user.name, text, System.currentTimeMillis(),
            mentioned?.toMutableList(), linkedEv?.id, linkedEv?.title, id = resolvedNoteId,
            noteKind = noteKind, pinned = pinned && noteKind != "personal")
        if (note.pinned) s.clearOtherPins(ch, ev, resolvedNoteId)
        list.add(note)
        if (list.size > 50) list.removeAt(0)
        var backNote: EventNote? = null
        if (linkedEv != null && noteKind != "personal") {
            val otherList = linkedEv.notes ?: mutableListOf<EventNote>().also { linkedEv.notes = it }
            backNote = EventNote(user.id, user.name, text, note.ts, null, ev.id, ev.title,
                id = "$resolvedNoteId-b")
            otherList.add(backNote)
            if (otherList.size > 50) otherList.removeAt(0)
        }
        val linkedChat = if (noteKind == "personal") null else ch.linkedChatChannelId?.let { id ->
            s.state.channels.find { it.id == id && it.kind == "chat" }
        }
        val mirrored = linkedChat?.let {
            ChatMessage(s.idGenerator(), it.id, user.id, user.name, text, note.ts, ev.id, ev.title,
                mentioned?.toMutableList()).also { msg ->
                val messages = s.state.messages.getOrPut(it.id) { mutableListOf() }
                messages.add(msg)
                if (messages.size > 500) messages.removeAt(0)
            }
        }
        s.operations.save()
        s.operations.broadcastToChannel(ch, JSONObject().put("type", "eventNoteAdded")
            .put("eventId", ev.id).put("note", JSONObject(s.gson.toJson(note))))
        if (linkedEv != null && backNote != null) {
            val otherCh = s.state.channels.find { it.id == linkedEv.channelId }!!
            s.operations.broadcastToChannel(otherCh, JSONObject().put("type", "eventNoteAdded")
                .put("eventId", linkedEv.id).put("note", JSONObject(s.gson.toJson(backNote))))
        }
        if (linkedChat != null && mirrored != null) {
            s.operations.broadcastToChannel(linkedChat, JSONObject().put("type", "message")
                .put("message", JSONObject(s.gson.toJson(mirrored))))
        }
        if (noteKind != "personal") mentioned?.forEach { uid ->
            s.operations.pushNotification(Notification(s.idGenerator(), uid, "mentioned", eventId = ev.id,
                fromUserId = user.id, fromUserName = user.name, ts = note.ts))
        }
    }

    fun cmdPinEventNote(user: User, m: JSONObject) {
        if (!s.authorization.canMutateContent(user)) return
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return
        if (!s.authorization.channelVisible(ch, user)) return
        val list = ev.notes ?: return
        val noteId = m.optString("noteId").trim().take(48).ifEmpty { null }
        val noteTs = m.optLong("noteTs", 0L).takeIf { it > 0L }
        val noteUserId = m.optString("noteUserId").ifEmpty { null }
        val idx = list.indexOfFirst { n ->
            if (n.activity != null || n.noteKind == "personal") false
            else if (noteId != null && n.id != null) n.id == noteId
            else noteUserId != null && noteTs != null && n.userId == noteUserId && n.ts == noteTs
        }
        if (idx < 0) return
        val old = list[idx]
        val pinned = EventNote(old.userId, old.name, old.text, old.ts, old.mentionedUserIds,
            old.linkedEventId, old.linkedEventTitle, old.activity, old.status, old.targetUserId,
            old.targetName, old.oldWhen, old.newWhen, old.oldWhenPrecision, old.newWhenPrecision,
            old.oldWhenPeriod, old.newWhenPeriod, old.oldValue, old.newValue, old.id,
            noteKind = "shared", pinned = true)
        s.clearOtherPins(ch, ev, old.id)
        list[idx] = pinned
        s.operations.save()
        s.operations.broadcastToChannel(ch, JSONObject().put("type", "eventNoteUpdated")
            .put("eventId", ev.id).put("note", JSONObject(s.gson.toJson(pinned))))
    }

    fun cmdPublishPersonalNote(user: User, m: JSONObject) {
        if (!s.authorization.canMutateContent(user)) return
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return
        if (!s.authorization.channelVisible(ch, user)) return
        val list = ev.notes ?: return
        val noteId = m.optString("noteId").trim().take(48).ifEmpty { return }
        val text = opaqueCiphertext(m.optString("text")).ifEmpty { return }
        val idx = list.indexOfFirst { it.id == noteId && it.noteKind == "personal" && it.userId == user.id }
        if (idx < 0) return
        val old = list[idx]
        val shared = EventNote(old.userId, old.name, text, old.ts, null, null, null,
            id = old.id, noteKind = "shared", pinned = true)
        s.clearOtherPins(ch, ev, old.id)
        list[idx] = shared
        s.operations.save()
        s.operations.broadcastToChannel(ch, JSONObject().put("type", "eventNoteUpdated")
            .put("eventId", ev.id).put("note", JSONObject(s.gson.toJson(shared))))
    }

    fun cmdDeleteEventNote(user: User, m: JSONObject) {
        s.removeEventChatNote(
            eventId = m.optString("eventId").ifEmpty { return },
            noteId = m.optString("noteId").trim().take(48).ifEmpty { null },
            noteUserId = m.optString("noteUserId").ifEmpty { null },
            noteTs = m.optLong("noteTs", 0L).takeIf { it > 0L },
            actor = user, broadcast = true, saveAfter = true,
        )
    }
}
