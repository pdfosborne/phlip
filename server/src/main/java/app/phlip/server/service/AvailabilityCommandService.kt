package app.phlip.server

import com.google.gson.Gson
import org.json.JSONObject

/** § I'm available — create / update / delete / signal free-time marks. */
internal class AvailabilityCommandService(
    private val stateProvider: () -> AppState,
    private val gson: Gson,
    private val authorization: ServerAuthorization,
    private val idGenerator: () -> String,
    private val operations: Operations,
) {
    internal data class Operations(
        val save: () -> Unit,
        val broadcastToChannel: (Channel, JSONObject) -> Unit,
    )

    private val state: AppState get() = stateProvider()

    fun dispatch(user: User, message: JSONObject): Boolean {
        when (message.optString("type")) {
            "createAvailability" -> cmdCreate(user, message)
            "updateAvailability" -> cmdUpdate(user, message)
            "deleteAvailability" -> cmdDelete(user, message)
            "signalAvailability" -> cmdSignal(user, message)
            else -> return false
        }
        return true
    }

    /**
     * Drop any availability in [event]'s channel whose window overlaps the event.
     * Call after create / time / duration changes on normal events.
     */
    fun clearOverlappingForEvent(event: Event) {
        val start = event.`when` ?: return
        val dur = durationCodeMs(event.duration)
        if (dur <= 0L) return
        val channelId = event.channelId
        val doomed = state.availabilities.filter {
            it.channelId == channelId && intervalsOverlap(it.`when`, it.duration, start, dur)
        }
        if (doomed.isEmpty()) return
        val ch = state.channels.find { it.id == channelId }
        for (a in doomed) {
            state.availabilities.removeAll { it.id == a.id }
            if (ch != null) {
                operations.broadcastToChannel(ch, JSONObject()
                    .put("type", "availabilityDeleted")
                    .put("availabilityId", a.id)
                    .put("channelId", channelId))
            }
        }
        operations.save()
    }

    private fun cmdCreate(user: User, m: JSONObject) {
        val ch = state.channels.find { it.id == m.optString("channelId") } ?: return
        if (ch.kind != "event" || !ch.allowAvailability) return
        if (ch.pinnedLocationLabel != null || ch.pinnedUserId != null) return
        if (!authorization.channelVisible(ch, user)) return
        val whenMs = m.optLong("when", 0L)
        val duration = m.optLong("duration", 0L)
        if (whenMs <= 0L || duration <= 0L) return
        // Cap window at 24h.
        val dur = duration.coerceAtMost(24L * 60L * 60L * 1000L)
        val id = m.optString("id").trim().take(24).ifEmpty { idGenerator() }
        if (state.availabilities.any { it.id == id }) return
        val avail = Availability(
            id = id,
            channelId = ch.id,
            userId = user.id,
            userName = user.name,
            `when` = whenMs,
            duration = dur,
            where = opaqueCiphertext(m.optString("where")),
            details = opaqueCiphertext(m.optString("details")),
            signals = mutableListOf(),
            createdAt = System.currentTimeMillis(),
        )
        // Don't create if an existing event already fills this window.
        if (channelEventOverlaps(ch.id, whenMs, dur)) return
        state.availabilities.add(avail)
        operations.save()
        operations.broadcastToChannel(ch, JSONObject()
            .put("type", "availabilityCreated")
            .put("availability", JSONObject(gson.toJson(avail))))
    }

    private fun cmdUpdate(user: User, m: JSONObject) {
        val avail = state.availabilities.find { it.id == m.optString("availabilityId") } ?: return
        val ch = state.channels.find { it.id == avail.channelId } ?: return
        if (!authorization.channelVisible(ch, user)) return
        val isOwner = avail.userId == user.id
        if (!isOwner && !authorization.canModerateEvents(user)) return
        if (m.has("when")) {
            val whenMs = m.optLong("when", 0L)
            if (whenMs <= 0L) return
            avail.`when` = whenMs
        }
        if (m.has("duration")) {
            val duration = m.optLong("duration", 0L)
            if (duration <= 0L) return
            avail.duration = duration.coerceAtMost(24L * 60L * 60L * 1000L)
        }
        if (m.has("where")) avail.where = opaqueCiphertext(m.optString("where"))
        if (m.has("details")) avail.details = opaqueCiphertext(m.optString("details"))
        // Drop if the new window now overlaps an event.
        if (channelEventOverlaps(ch.id, avail.`when`, avail.duration)) {
            state.availabilities.removeAll { it.id == avail.id }
            operations.save()
            operations.broadcastToChannel(ch, JSONObject()
                .put("type", "availabilityDeleted")
                .put("availabilityId", avail.id)
                .put("channelId", ch.id))
            return
        }
        // Clamp signals whose startWhen fell outside the new window.
        avail.signals.removeAll { s ->
            val sw = s.startWhen ?: return@removeAll false
            sw < avail.`when` || sw >= avail.`when` + avail.duration
        }
        operations.save()
        operations.broadcastToChannel(ch, JSONObject()
            .put("type", "availabilityUpdated")
            .put("availability", JSONObject(gson.toJson(avail))))
    }

    private fun cmdDelete(user: User, m: JSONObject) {
        val avail = state.availabilities.find { it.id == m.optString("availabilityId") } ?: return
        val ch = state.channels.find { it.id == avail.channelId } ?: return
        if (!authorization.channelVisible(ch, user)) return
        val isOwner = avail.userId == user.id
        if (!isOwner && !authorization.canModerateEvents(user)) return
        state.availabilities.removeAll { it.id == avail.id }
        operations.save()
        operations.broadcastToChannel(ch, JSONObject()
            .put("type", "availabilityDeleted")
            .put("availabilityId", avail.id)
            .put("channelId", ch.id))
    }

    private fun cmdSignal(user: User, m: JSONObject) {
        val avail = state.availabilities.find { it.id == m.optString("availabilityId") } ?: return
        val ch = state.channels.find { it.id == avail.channelId } ?: return
        if (!ch.allowAvailability) return
        if (!authorization.channelVisible(ch, user)) return
        // Owner doesn't need to signal their own mark.
        if (avail.userId == user.id) return
        val remove = m.optBoolean("remove", false)
        if (remove) {
            avail.signals.removeAll { it.userId == user.id }
        } else {
            var startWhen: Long? = null
            if (m.has("startWhen") && !m.isNull("startWhen")) {
                val sw = m.optLong("startWhen", 0L)
                if (sw > 0L) {
                    if (sw < avail.`when` || sw >= avail.`when` + avail.duration) return
                    startWhen = sw
                }
            }
            avail.signals.removeAll { it.userId == user.id }
            avail.signals.add(AvailabilitySignal(
                userId = user.id,
                name = user.name,
                startWhen = startWhen,
                ts = System.currentTimeMillis(),
            ))
        }
        operations.save()
        operations.broadcastToChannel(ch, JSONObject()
            .put("type", "availabilitySignal")
            .put("availabilityId", avail.id)
            .put("channelId", ch.id)
            .put("signals", org.json.JSONArray(gson.toJson(avail.signals))))
    }

    private fun channelEventOverlaps(channelId: String, start: Long, dur: Long): Boolean {
        for (ev in state.events) {
            if (ev.channelId != channelId) continue
            if (ev.approvalStatus == "blocked") continue
            val evStart = ev.`when` ?: continue
            val evDur = durationCodeMs(ev.duration)
            if (intervalsOverlap(start, dur, evStart, evDur)) return true
        }
        return false
    }

    companion object {
        fun intervalsOverlap(aStart: Long, aDur: Long, bStart: Long, bDur: Long): Boolean {
            if (aDur <= 0L || bDur <= 0L) return false
            val aEnd = aStart + aDur
            val bEnd = bStart + bDur
            return aStart < bEnd && bStart < aEnd
        }

        fun durationCodeMs(code: String?): Long = when (code) {
            "5m" -> 5L * 60_000
            "10m" -> 10L * 60_000
            "15m" -> 15L * 60_000
            "30m" -> 30L * 60_000
            "45m" -> 45L * 60_000
            "2h" -> 2L * 3_600_000
            "3h" -> 3L * 3_600_000
            "4h" -> 4L * 3_600_000
            "morning", "afternoon", "evening" -> 3L * 3_600_000
            "day" -> 12L * 3_600_000
            else -> 3_600_000L // "1h" / null
        }
    }
}
