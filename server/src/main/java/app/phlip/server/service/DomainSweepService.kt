package app.phlip.server

import org.json.JSONObject

/**
 * Host-side retention / purge sweeps: type snapshots on ended events,
 * ended-event wipe, chat retention, and single-event purge.
 *
 * Triggered from the presence/HTTP prune tick and from
 * [ServerSettingsService] when purge/retention flags turn on.
 */
internal class DomainSweepService(
    private val stateProvider: () -> AppState,
    private val operations: Operations,
) {
    internal data class Operations(
        val save: () -> Unit,
        val broadcast: (JSONObject) -> Unit,
        val broadcastToChannel: (Channel, JSONObject) -> Unit,
        val pushSyncToAll: () -> Unit,
        val eventHasEnded: (Event, Long) -> Boolean,
        val typeColorResolved: (EventType) -> String?,
        val clampChatRetentionDays: (Int) -> Int,
    )

    private val state get() = stateProvider()

    /**
     * Copy an ended event's type name + colour onto the event once (§5). After a
     * type is later renamed or deleted, history keeps what it said at the time.
     * Only touches events that carry a resolvable [Event.typeId] and haven't been
     * snapshotted yet; runs on the sweep tick before any purge.
     */
    fun sweepTypeSnapshots() {
        if (state.eventTypes.isEmpty()) return
        val now = System.currentTimeMillis()
        var changed = false
        for (ev in state.events) {
            if (ev.typeNameSnap != null) continue
            if (!operations.eventHasEnded(ev, now)) continue
            val type = ev.typeId?.let { id -> state.eventTypes.find { it.id == id } } ?: continue
            ev.typeNameSnap = type.name
            ev.typeColorSnap = operations.typeColorResolved(type)
            changed = true
        }
        if (changed) operations.save()
    }

    /**
     * Wipe an event (+ chain follow-ons) and related host data:
     * notifications, mirrored chat notes, reports. Channels/users stay.
     * Returns purged event ids.
     */
    fun purgeEventFromHost(
        eventId: String,
        broadcast: Boolean,
        persist: Boolean = true,
    ): List<String> {
        val ev = state.events.find { it.id == eventId } ?: return emptyList()
        val ch = state.channels.find { it.id == ev.channelId }
        val chainIds = state.events.filter { it.chainOf == ev.id }.map { it.id }
        val allIds = (listOf(ev.id) + chainIds).distinct()

        state.events.removeAll { it.id in allIds }

        for ((_, list) in state.notifications) {
            list.removeAll { n -> n.eventId != null && n.eventId in allIds }
        }
        for ((_, list) in state.messages) {
            list.removeAll { msg -> msg.eventId != null && msg.eventId in allIds }
        }
        state.reports.removeAll { rep ->
            rep.targetType == "event" && rep.targetId in allIds
        }

        if (persist) operations.save()
        if (broadcast && ch != null) {
            for (id in allIds) {
                operations.broadcastToChannel(ch, JSONObject().put("type", "eventDeleted").put("eventId", id))
            }
        }
        // § pinned location channels — viewers who could only see this booking
        // via its stub need a full resync to drop it.
        if (broadcast && ev.locationLabelId != null) operations.pushSyncToAll()
        android.util.Log.i("AshPurge", "purged events ${allIds.joinToString(",")}")
        return allIds
    }

    /**
     * When [AppState.purgeEndedEvents] is on, drop finished plans from the host
     * so a compromised device only holds currently active events.
     */
    fun sweepEndedEventPurge() {
        if (!state.purgeEndedEvents) return
        val now = System.currentTimeMillis()
        val doomed = state.events.filter { it.chainOf == null && operations.eventHasEnded(it, now) }
        if (doomed.isEmpty()) return
        var any = false
        for (ev in doomed.toList()) {
            if (state.events.none { it.id == ev.id }) continue
            purgeEventFromHost(ev.id, broadcast = true, persist = false)
            any = true
        }
        if (any) operations.save()
    }

    /**
     * Drop chat older than [AppState.chatRetentionDays]. Broadcasts `chatPurged`
     * so clients trim without a full sync. `0` retention = no-op (keep forever).
     */
    fun sweepChatRetention() {
        val days = operations.clampChatRetentionDays(state.chatRetentionDays)
        if (days <= 0) return
        val cutoff = System.currentTimeMillis() - days * 24L * 60 * 60 * 1000
        val removedIds = mutableSetOf<String>()
        var changed = false
        for ((chId, list) in state.messages.toList()) {
            val before = list.size
            list.removeAll { msg ->
                if (msg.ts < cutoff) {
                    removedIds.add(msg.id)
                    true
                } else false
            }
            if (list.size != before) changed = true
            if (list.isEmpty()) state.messages.remove(chId)
        }
        if (removedIds.isNotEmpty()) {
            for ((_, nlist) in state.notifications) {
                nlist.removeAll { n -> n.messageId != null && n.messageId in removedIds }
            }
            state.reports.removeAll {
                it.targetType == "message" && it.targetId in removedIds
            }
            changed = true
        }
        if (!changed) return
        operations.save()
        operations.broadcast(JSONObject().put("type", "chatPurged").put("beforeTs", cutoff))
        android.util.Log.i("AshPurge", "chat retention ${days}d — dropped ${removedIds.size} messages before $cutoff")
    }
}
