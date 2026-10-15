package app.phlip.server

import org.json.JSONArray
import org.json.JSONObject

/**
 * Chat message content type.
 *
 * **Store:** [AppState.messages] keyed by channelId (`ChatMessage` list, cap 500).
 * Text is opaque ciphertext ([opaqueCiphertext]); server never assumes plaintext.
 * Side effects: tagged events append [Event.notes] (cap 50); @mentions append
 * [AppState.notifications]. Linked event→chat may mirror a second [ChatMessage].
 *
 * **User → host:** RPC `sendMessage`, `tagMessageEvents`, `deleteMessage`,
 * `reactMessage` (WS frame or `POST /ash-rpc`).
 *
 * **Host → users:** channel fanout `message` / `messageUpdated` / `messageDeleted`
 * / `eventNoteAdded`; mentions via [CollaborationCommandService.Operations.pushNotification].
 */
internal class ChatMessageHandler(
    private val s: CollaborationCommandSupport,
) {
    companion object {
        val CHAT_REACT_EMOJIS: Set<String> = setOf("❤️", "🔥", "😂", "👍", "🎉", "👀")
    }

    private fun conversationIdOf(m: JSONObject): String? =
        m.optString("conversationId").trim().takeIf { id ->
            id.length in 8..96 && id.all { ch -> ch.isLetterOrDigit() || ch == '-' || ch == '_' }
        }

    fun cmdSendMessage(user: User, m: JSONObject) {
        val requestedId = m.optString("id").trim().takeIf {
            it.length in 8..96 && it.all { ch -> ch.isLetterOrDigit() || ch == '-' || ch == '_' }
        }
        fun reject(reason: String) {
            requestedId?.let { s.operations.sendToUser(user, JSONObject().put("type", "messageAck")
                .put("id", it).put("accepted", false).put("error", reason)) }
        }
        if (!s.authorization.canMutateContent(user)) { reject("Not allowed"); return }
        val text = opaqueCiphertext(m.optString("text"))
        val channelId = m.optString("channelId")
        val channel = s.state.channels.find { it.id == channelId }
        if (text.isEmpty() || channel == null || !s.authorization.channelVisible(channel, user)) {
            reject("Message rejected"); return
        }
        if (requestedId != null) {
            val existing = s.state.messages[channelId]?.find { it.id == requestedId && it.userId == user.id }
            if (existing != null) {
                s.operations.sendToUser(user, JSONObject().put("type", "messageAck")
                    .put("id", requestedId).put("accepted", true))
                return
            }
        }
        val taggedIds = LinkedHashSet<String>()
        m.optJSONArray("mentionedEventIds")?.let { arr ->
            for (i in 0 until arr.length()) {
                val id = arr.optString(i).trim()
                if (id.isNotEmpty()) taggedIds.add(id)
            }
        }
        m.optString("eventId").trim().takeIf { it.isNotEmpty() }?.let { taggedIds.add(it) }
        val visibleTagged = taggedIds.mapNotNull { tid ->
            val ev = s.state.events.find { it.id == tid } ?: return@mapNotNull null
            val home = s.state.channels.find { it.id == ev.channelId } ?: return@mapNotNull null
            if (!eventTagAllowed(channel, home, user)) return@mapNotNull null
            ev
        }
        val primary = visibleTagged.firstOrNull()
        val mentioned = s.jsonStringList(m.optJSONArray("mentionedUserIds"))
            ?.filter { uid ->
                uid != user.id && s.state.users.values.any { u ->
                    u.id == uid && s.authorization.channelVisible(channel, u)
                }
            }
            ?.distinct()?.takeIf { it.isNotEmpty() }
        val eventIdList = visibleTagged.map { it.id }.toMutableList().takeIf { it.isNotEmpty() }
        val destList = s.state.messages[channelId]
        val replyToId = m.optString("replyToId").trim().takeIf { it.isNotEmpty() }?.takeIf { id ->
            destList?.any { it.id == id } == true
        }
        val msg = ChatMessage(
            requestedId ?: s.idGenerator(), channelId, user.id, user.name, text, System.currentTimeMillis(),
            primary?.id, primary?.title, mentioned?.toMutableList(), eventIdList,
            replyToId = replyToId,
            conversationId = conversationIdOf(m),
        )
        val list = s.state.messages.getOrPut(channelId) { mutableListOf() }
        list.add(msg)
        if (list.size > 500) list.removeAt(0)
        var mirroredNote: EventNote? = null
        var taggedEventChannel: Channel? = null
        if (primary != null) {
            taggedEventChannel = s.state.channels.find { it.id == primary.channelId }
            val notes = primary.notes ?: mutableListOf<EventNote>().also { primary.notes = it }
            mirroredNote = EventNote(user.id, user.name, text, msg.ts, id = s.idGenerator())
            notes.add(mirroredNote)
            if (notes.size > 50) notes.removeAt(0)
        }
        s.operations.save()
        s.operations.broadcastToChannel(channel, JSONObject().put("type", "message").put("message", JSONObject(s.gson.toJson(msg))))
        requestedId?.let { s.operations.sendToUser(user, JSONObject().put("type", "messageAck")
            .put("id", it).put("accepted", true)) }
        if (channel.kind == "event") {
            val linkedChat = channel.linkedChatChannelId?.let { id ->
                s.state.channels.find { it.id == id && it.kind == "chat" }
            }
            if (linkedChat != null && s.authorization.channelVisible(linkedChat, user)) {
                val mirrorReply = msg.replyToId?.takeIf { id ->
                    s.state.messages[linkedChat.id]?.any { it.id == id } == true
                }
                val mirror = msg.copy(
                    id = s.idGenerator(),
                    channelId = linkedChat.id,
                    mentionedEventIds = msg.mentionedEventIds?.toMutableList(),
                    mentionedUserIds = msg.mentionedUserIds?.toMutableList(),
                    replyToId = mirrorReply,
                    reactions = null,
                )
                val mirrorList = s.state.messages.getOrPut(linkedChat.id) { mutableListOf() }
                mirrorList.add(mirror)
                if (mirrorList.size > 500) mirrorList.removeAt(0)
                s.operations.save()
                s.operations.broadcastToChannel(linkedChat, JSONObject().put("type", "message")
                    .put("message", JSONObject(s.gson.toJson(mirror))))
            }
        }
        if (primary != null && taggedEventChannel != null && mirroredNote != null) {
            s.operations.broadcastToChannel(taggedEventChannel, JSONObject().put("type", "eventNoteAdded")
                .put("eventId", primary.id)
                .put("note", JSONObject(s.gson.toJson(mirroredNote))))
        }
        mentioned?.forEach { uid ->
            s.operations.pushNotification(Notification(s.idGenerator(), uid, "mentioned",
                channelId = channelId, messageId = msg.id,
                fromUserId = user.id, fromUserName = user.name, ts = msg.ts))
        }
    }

    /** Host-authored join log in the welcome chat. Not encrypted; never from client sendMessage. */
    fun postMemberJoined(user: User) {
        val channel = s.state.channels.find { it.kind == "chat" && it.welcomeChannel } ?: return
        val msg = ChatMessage(
            id = s.idGenerator(),
            channelId = channel.id,
            userId = user.id,
            name = user.name,
            text = "",
            ts = System.currentTimeMillis(),
            activity = "memberJoined",
        )
        val list = s.state.messages.getOrPut(channel.id) { mutableListOf() }
        list.add(msg)
        if (list.size > 500) list.removeAt(0)
        s.operations.save()
        s.operations.broadcastToChannel(
            channel,
            JSONObject().put("type", "message").put("message", JSONObject(s.gson.toJson(msg))),
        )
    }

    fun cmdTagMessageEvents(user: User, m: JSONObject) {
        if (!s.authorization.canMutateContent(user)) return
        val messageId = m.optString("messageId").ifEmpty { return }
        val channelId = m.optString("channelId").ifEmpty { return }
        val channel = s.state.channels.find { it.id == channelId } ?: return
        if (!s.authorization.channelVisible(channel, user)) return
        val list = s.state.messages[channelId] ?: return
        val idx = list.indexOfFirst { it.id == messageId }
        if (idx < 0) return
        val old = list[idx]
        val clear = m.optBoolean("clear", false)
        val nextIds = LinkedHashSet<String>()
        if (!clear) {
            m.optJSONArray("mentionedEventIds")?.let { arr ->
                for (i in 0 until arr.length()) {
                    val id = arr.optString(i).trim()
                    if (id.isNotEmpty()) nextIds.add(id)
                }
            }
            m.optString("eventId").trim().takeIf { it.isNotEmpty() }?.let { nextIds.add(it) }
        }
        val visible = nextIds.mapNotNull { tid ->
            val ev = s.state.events.find { it.id == tid } ?: return@mapNotNull null
            val home = s.state.channels.find { it.id == ev.channelId } ?: return@mapNotNull null
            if (!eventTagAllowed(channel, home, user)) return@mapNotNull null
            ev
        }
        val primary = visible.firstOrNull()
        val updated = old.copy(
            eventId = primary?.id,
            eventTitle = primary?.title,
            mentionedEventIds = visible.map { it.id }.toMutableList().takeIf { it.isNotEmpty() },
            linkedByUserId = if (visible.isNotEmpty()) user.id else null,
            linkedByUserName = if (visible.isNotEmpty()) user.name else null,
            conversationId = conversationIdOf(m) ?: old.conversationId,
        )
        list[idx] = updated
        s.operations.save()
        s.operations.broadcastToChannel(channel, JSONObject().put("type", "messageUpdated")
            .put("message", JSONObject(s.gson.toJson(updated))))
    }

    /**
     * Edit your own message's text (ciphertext only — the server never sees
     * plaintext). A tagged message's chat note on its event follows. Fans out
     * as messageUpdated with the whole message.
     */
    fun cmdEditMessage(user: User, m: JSONObject) {
        if (!s.authorization.canMutateContent(user)) return
        val channelId = m.optString("channelId").ifEmpty { return }
        val messageId = m.optString("messageId").ifEmpty { return }
        val text = opaqueCiphertext(m.optString("text"))
        if (text.isEmpty()) return
        val channel = s.state.channels.find { it.id == channelId } ?: return
        if (!s.authorization.channelVisible(channel, user)) return
        val list = s.state.messages[channelId] ?: return
        val idx = list.indexOfFirst { it.id == messageId }
        if (idx < 0) return
        val old = list[idx]
        if (old.userId != user.id || old.activity != null) return
        val updated = old.copy(text = text, editedAt = System.currentTimeMillis())
        list[idx] = updated
        old.eventId?.let { eid ->
            val notes = s.state.events.find { it.id == eid }?.notes
            if (notes != null) {
                val ni = notes.indexOfFirst { it.activity == null && it.userId == old.userId && it.ts == old.ts }
                if (ni >= 0) notes[ni] = notes[ni].copy(text = text)
            }
        }
        s.operations.save()
        s.operations.broadcastToChannel(channel, JSONObject().put("type", "messageUpdated")
            .put("message", JSONObject(s.gson.toJson(updated))))
    }

    fun cmdDeleteMessage(user: User, m: JSONObject) {
        val messageId = m.optString("messageId").ifEmpty { return }
        val channelIdHint = m.optString("channelId").ifEmpty { null }
        var foundChannel: Channel? = null
        var foundMsg: ChatMessage? = null
        val search = if (channelIdHint != null) {
            listOfNotNull(s.state.channels.find { it.id == channelIdHint })
        } else s.state.channels
        for (ch in search) {
            val list = s.state.messages[ch.id] ?: continue
            val hit = list.find { it.id == messageId } ?: continue
            foundMsg = hit
            foundChannel = ch
            break
        }
        val channel = foundChannel ?: return
        val msg = foundMsg ?: return
        if (!s.authorization.channelVisible(channel, user)) return
        if (msg.userId != user.id && !s.authorization.canModerateEvents(user)) return
        s.state.messages[channel.id]?.removeAll { it.id == messageId }
        if (s.state.messages[channel.id].isNullOrEmpty()) s.state.messages.remove(channel.id)
        for ((uid, list) in s.state.notifications.toList()) {
            list.removeAll { it.messageId == messageId }
            if (list.isEmpty()) s.state.notifications.remove(uid)
        }
        if (msg.eventId != null) {
            s.operations.removeEventChatNote(msg.eventId, null, msg.userId, msg.ts, user, true, false)
        }
        s.operations.save()
        s.operations.broadcastToChannel(channel, JSONObject()
            .put("type", "messageDeleted")
            .put("channelId", channel.id)
            .put("messageId", messageId))
    }

    fun cmdReactMessage(user: User, m: JSONObject) {
        if (!s.authorization.canMutateContent(user)) return
        val channelId = m.optString("channelId").ifEmpty { return }
        val messageId = m.optString("messageId").ifEmpty { return }
        val raw = m.optString("emoji").trim()
        val drawn = raw.startsWith("d:")
        val emoji = if (drawn) {
            if (!s.authorization.canUserDraw()) {
                s.operations.sendToUser(user, JSONObject().put("type", "error")
                    .put("error", "Drawing is turned off on this server."))
                return
            }
            clampReaction(raw) ?: return
        } else {
            if (raw !in CHAT_REACT_EMOJIS) return
            raw
        }
        val channel = s.state.channels.find { it.id == channelId } ?: return
        if (!s.authorization.channelVisible(channel, user)) return
        val list = s.state.messages[channelId] ?: return
        val idx = list.indexOfFirst { it.id == messageId }
        if (idx < 0) return
        val old = list[idx]
        if (!old.activity.isNullOrEmpty()) return
        val map = (old.reactions ?: mutableMapOf()).toMutableMap()
        if (map[user.id] == emoji) map.remove(user.id)
        else map[user.id] = emoji
        val updated = old.copy(reactions = map.takeIf { it.isNotEmpty() })
        list[idx] = updated
        val catalogChanged = map[user.id] == emoji && upsertDrawnCard(s.state, user, emoji)
        s.operations.save()
        val payload = JSONObject(s.gson.toJson(updated))
        if (updated.reactions == null) payload.put("reactions", JSONObject())
        val fanout = JSONObject().put("type", "messageUpdated").put("message", payload)
        if (catalogChanged) {
            fanout.put(
                "reactionCards",
                JSONArray(s.gson.toJson(s.state.reactionCards ?: emptyList<ReactionCardEntry>())),
            )
        }
        s.operations.broadcastToChannel(channel, fanout)
    }

    /** Chat may only tag events from linked agendas; event boards only tag their own. */
    private fun eventTagAllowed(dest: Channel, eventHome: Channel, user: User): Boolean {
        if (!s.authorization.channelVisible(eventHome, user)) return false
        return when (dest.kind) {
            "chat" -> eventHome.kind == "event" && eventHome.linkedChatChannelId == dest.id
            "event" -> eventHome.id == dest.id
            else -> false
        }
    }
}
