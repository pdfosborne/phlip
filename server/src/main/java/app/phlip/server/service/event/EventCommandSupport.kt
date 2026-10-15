package app.phlip.server

import com.google.gson.Gson
import org.json.JSONArray
import org.json.JSONObject

/** Shared state, operations, and cross-family helpers for event command handlers. */
internal class EventCommandSupport(
    private val stateProvider: () -> AppState,
    val gson: Gson,
    val authorization: ServerAuthorization,
    val idGenerator: () -> String,
    val operations: EventCommandService.Operations,
) {
    val state: AppState get() = stateProvider()

    fun syncPinnedViewersIfNeeded(event: Event) {
        if (event.locationLabelId != null
            || state.channels.any { it.pinnedUserId != null }) {
            operations.pushSyncToAll()
        }
    }

    fun notifyApprovers(channel: Channel, event: Event, requester: User) {
        for (candidate in state.users.values) {
            if (candidate.id == requester.id) continue
            if (!authorization.canApproveEvents(candidate, channel)) continue
            if (!authorization.channelVisible(channel, candidate)) continue
            operations.pushNotification(Notification(idGenerator(), candidate.id, "eventPendingApproval",
                eventId = event.id, fromUserId = requester.id, fromUserName = requester.name,
                ts = System.currentTimeMillis()))
        }
    }

    fun blockPendingEvent(
        channel: Channel,
        event: Event,
        note: String?,
        altSuggestion: String?,
        approver: User?,
    ) {
        event.approvalStatus = "blocked"
        event.approvalNote = note
        event.approvalAltSuggestion = altSuggestion
        operations.save()
        operations.broadcastToChannel(channel, JSONObject().put("type", "eventApprovalUpdated")
            .put("eventId", event.id).put("approvalStatus", "blocked")
            .put("approvalNote", note ?: JSONObject.NULL)
            .put("approvalAltSuggestion", altSuggestion ?: JSONObject.NULL))
        operations.pushSyncToAll()
        if (event.createdBy != approver?.id) {
            operations.pushNotification(Notification(idGenerator(), event.createdBy, "eventBlocked",
                eventId = event.id, fromUserId = approver?.id ?: "system",
                fromUserName = approver?.name ?: "System", ts = System.currentTimeMillis(),
                approvalNote = note, approvalAltSuggestion = altSuggestion))
        }
    }

    fun autoResolveOverlaps(channel: Channel, approved: Event, approver: User) {
        val approvedWhen = approved.`when` ?: return
        val approvedEnd = approvedWhen + durationCodeMs(approved.duration)
        val candidates = state.events.filter {
            it.id != approved.id && it.approvalStatus == "pending" &&
                (if (approved.locationLabelId != null)
                    locationLabelIdsOverlap(it.locationLabelId, approved.locationLabelId)
                else it.channelId == channel.id)
        }
        for (candidate in candidates) {
            val cWhen = candidate.`when` ?: continue
            val cEnd = cWhen + durationCodeMs(candidate.duration)
            if (cWhen < approvedEnd && approvedWhen < cEnd) {
                val candidateCh = state.channels.find { it.id == candidate.channelId } ?: continue
                blockPendingEvent(candidateCh, candidate,
                    "Auto-declined: conflicts with an approved booking.", null, approver)
            }
        }
    }

    fun durationCodeMs(code: String?): Long = when (code) {
        "5m" -> 5 * 60_000L
        "10m" -> 10 * 60_000L
        "15m" -> 15 * 60_000L
        "30m" -> 30 * 60_000L
        "45m" -> 45 * 60_000L
        "2h" -> 2 * 3_600_000L
        "3h" -> 3 * 3_600_000L
        "4h" -> 4 * 3_600_000L
        "morning", "afternoon", "evening" -> 4 * 3_600_000L
        "day" -> 12 * 3_600_000L
        else -> 3_600_000L
    }

    fun flagChainDependencyWarns(ch: Channel, primary: Event) {
        val parentWhen = primary.`when` ?: return
        var any = false
        for (child in state.events) {
            if (child.chainOf != primary.id || (child.chainStatus ?: "proposal") != "linked") continue
            child.chainDepWarnWhen = parentWhen
            broadcastChainUpdated(ch, child)
            any = true
        }
        if (any) operations.save()
    }

    fun broadcastChainUpdated(ch: Channel, ev: Event) {
        operations.broadcastToChannel(ch, JSONObject().put("type", "eventChainUpdated")
            .put("eventId", ev.id).put("chainOf", ev.chainOf ?: JSONObject.NULL)
            .put("chainMode", ev.chainMode ?: JSONObject.NULL)
            .put("chainStatus", ev.chainStatus ?: JSONObject.NULL)
            .put("chainDepWarnWhen", ev.chainDepWarnWhen ?: JSONObject.NULL))
    }

    fun clearOtherPins(ch: Channel, ev: Event, keepId: String?) {
        val list = ev.notes ?: return
        for (i in list.indices) {
            val n = list[i]
            if (n.activity != null || n.noteKind == "personal") continue
            val isPin = n.pinned || n.noteKind == "shared"
            if (!isPin) continue
            if (keepId != null && n.id != null && n.id == keepId) continue
            val demoted = EventNote(
                n.userId, n.name, n.text, n.ts, n.mentionedUserIds,
                n.linkedEventId, n.linkedEventTitle, n.activity, n.status, n.targetUserId,
                n.targetName, n.oldWhen, n.newWhen, n.oldWhenPrecision, n.newWhenPrecision,
                n.oldWhenPeriod, n.newWhenPeriod, n.oldValue, n.newValue, n.id,
                noteKind = null, pinned = false,
            )
            list[i] = demoted
            operations.broadcastToChannel(ch, JSONObject().put("type", "eventNoteUpdated")
                .put("eventId", ev.id).put("note", JSONObject(gson.toJson(demoted))))
        }
    }

    fun appendEventActivity(channel: Channel, event: Event, note: EventNote) {
        val list = event.notes ?: mutableListOf<EventNote>().also { event.notes = it }
        list.add(note)
        if (list.size > 50) list.removeAt(0)
        operations.broadcastToChannel(channel, JSONObject().put("type", "eventNoteAdded")
            .put("eventId", event.id).put("note", JSONObject(gson.toJson(note))))
    }

    fun removeEventChatNote(
        eventId: String,
        noteId: String?,
        noteUserId: String?,
        noteTs: Long?,
        actor: User,
        broadcast: Boolean,
        saveAfter: Boolean,
    ): Boolean {
        val ev = state.events.find { it.id == eventId } ?: return false
        val ch = state.channels.find { it.id == ev.channelId } ?: return false
        if (!authorization.channelVisible(ch, actor)) return false
        val list = ev.notes ?: return false
        val note = when {
            !noteId.isNullOrEmpty() -> list.find { it.id == noteId && it.activity == null }
            noteTs != null && !noteUserId.isNullOrEmpty() -> list.find {
                it.activity == null && it.userId == noteUserId && it.ts == noteTs
            }
            else -> null
        } ?: return false
        if (note.userId != actor.id && !authorization.canModerateEvents(actor)) return false
        val removedId = note.id
        val removedUserId = note.userId
        val removedTs = note.ts
        list.remove(note)
        if (list.isEmpty()) ev.notes = null
        note.linkedEventId?.let { linkedId ->
            val linked = state.events.find { it.id == linkedId }
            val otherList = linked?.notes
            if (linked != null && otherList != null) {
                val backId = removedId?.let { "$it-b" }
                val removedBack = otherList.filter { bn ->
                    bn.activity == null && bn.userId == removedUserId && bn.ts == removedTs &&
                        bn.linkedEventId == ev.id && (backId == null || bn.id == null || bn.id == backId)
                }
                otherList.removeAll(removedBack.toSet())
                if (otherList.isEmpty()) linked.notes = null
                if (broadcast) {
                    val otherCh = state.channels.find { it.id == linked.channelId }
                    for (bn in removedBack) {
                        val payload = JSONObject().put("type", "eventNoteDeleted")
                            .put("eventId", linked.id).put("noteTs", bn.ts).put("noteUserId", bn.userId)
                        if (!bn.id.isNullOrEmpty()) payload.put("noteId", bn.id)
                        if (otherCh != null) operations.broadcastToChannel(otherCh, payload)
                    }
                }
            }
        }
        val linkedChat = ch.linkedChatChannelId?.let { id ->
            state.channels.find { it.id == id && it.kind == "chat" }
        }
        if (linkedChat != null) {
            val messages = state.messages[linkedChat.id]
            if (messages != null) {
                val mirrored = messages.filter {
                    it.eventId == ev.id && it.userId == removedUserId && it.ts == removedTs
                }
                for (msg in mirrored) {
                    messages.remove(msg)
                    for ((_, notifications) in state.notifications.toList()) {
                        notifications.removeAll { it.messageId == msg.id }
                    }
                    if (broadcast) operations.broadcastToChannel(linkedChat, JSONObject()
                        .put("type", "messageDeleted").put("channelId", linkedChat.id)
                        .put("messageId", msg.id))
                }
                if (messages.isEmpty()) state.messages.remove(linkedChat.id)
            }
        }
        if (broadcast) {
            val payload = JSONObject().put("type", "eventNoteDeleted").put("eventId", ev.id)
                .put("noteTs", removedTs).put("noteUserId", removedUserId)
            if (!removedId.isNullOrEmpty()) payload.put("noteId", removedId)
            operations.broadcastToChannel(ch, payload)
        }
        if (saveAfter) operations.save()
        return true
    }

    fun jsonStringList(array: JSONArray?): MutableList<String>? {
        if (array == null) return null
        val out = ArrayList<String>(array.length())
        for (i in 0 until array.length()) {
            when (val value = array.opt(i) ?: continue) {
                is String -> out.add(value)
                is Number, is Boolean -> out.add(value.toString())
            }
        }
        return out
    }
}
