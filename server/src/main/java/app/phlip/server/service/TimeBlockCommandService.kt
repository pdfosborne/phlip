package app.phlip.server

import com.google.gson.Gson
import org.json.JSONObject

/** Time blocks — create / update / delete whole-day and timed spans. */
internal class TimeBlockCommandService(
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
            "createTimeBlock" -> cmdCreate(user, message)
            "updateTimeBlock" -> cmdUpdate(user, message)
            "deleteTimeBlock" -> cmdDelete(user, message)
            "signupTimeBlock" -> cmdSignup(user, message)
            else -> return false
        }
        return true
    }

    private fun cmdCreate(user: User, m: JSONObject) {
        val ch = state.channels.find { it.id == m.optString("channelId") } ?: return
        if (!channelAllowsTimeBlocks(ch)) return
        if (!authorization.channelVisible(ch, user)) return
        if (!authorization.canCreateEventsInChannel(user, ch)) return
        val title = opaqueCiphertext(m.optString("title")).ifEmpty { return }
        val startDay = normalizeDay(m.optLong("startDay", 0L)) ?: return
        var endDay = normalizeDay(m.optLong("endDay", startDay)) ?: startDay
        if (endDay < startDay) endDay = startDay
        if (endDay - startDay > MAX_SPAN_MS) return
        val startPeriod = normalizePeriod(m.optString("startPeriod"))
        val endPeriod = if (endDay == startDay) null else normalizePeriod(m.optString("endPeriod"))
        val startMinutes = resolveMinutes(m, "startMinutes", startPeriod, start = true)
        val endMinutes = resolveMinutes(m, "endMinutes", endPeriod ?: startPeriod, start = false)
        if (endDay == startDay && endMinutes <= startMinutes) return
        val id = m.optString("id").trim().take(24).ifEmpty { idGenerator() }
        if (state.timeBlocks.any { it.id == id }) return
        val block = TimeBlock(
            id = id,
            channelId = ch.id,
            createdBy = user.id,
            createdByName = user.name,
            title = title,
            where = opaqueCiphertext(m.optString("where")),
            details = opaqueCiphertext(m.optString("details")),
            startDay = startDay,
            endDay = endDay,
            startPeriod = startPeriod,
            endPeriod = endPeriod,
            startMinutes = startMinutes,
            endMinutes = endMinutes,
            signups = mutableListOf(
                TimeBlockSignup(
                    userId = user.id,
                    name = user.name,
                    ts = System.currentTimeMillis(),
                ),
            ),
            createdAt = System.currentTimeMillis(),
        )
        state.timeBlocks.add(block)
        operations.save()
        operations.broadcastToChannel(ch, JSONObject()
            .put("type", "timeBlockCreated")
            .put("timeBlock", JSONObject(gson.toJson(block))))
    }

    private fun cmdUpdate(user: User, m: JSONObject) {
        val block = state.timeBlocks.find { it.id == m.optString("timeBlockId") } ?: return
        val ch = state.channels.find { it.id == block.channelId } ?: return
        if (!authorization.channelVisible(ch, user)) return
        val isOwner = block.createdBy == user.id
        if (!isOwner && !authorization.canModerateEvents(user)) return
        if (m.has("title")) {
            val title = opaqueCiphertext(m.optString("title")).ifEmpty { return }
            block.title = title
        }
        if (m.has("where")) block.where = opaqueCiphertext(m.optString("where"))
        if (m.has("details")) block.details = opaqueCiphertext(m.optString("details"))
        val rangeTouched = m.has("startDay") || m.has("endDay")
            || m.has("startPeriod") || m.has("endPeriod")
            || m.has("startMinutes") || m.has("endMinutes")
        if (rangeTouched) {
            val startDay = normalizeDay(
                if (m.has("startDay")) m.optLong("startDay", 0L) else block.startDay
            ) ?: return
            var endDay = normalizeDay(
                if (m.has("endDay")) m.optLong("endDay", startDay) else block.endDay
            ) ?: startDay
            if (endDay < startDay) endDay = startDay
            if (endDay - startDay > MAX_SPAN_MS) return
            val startMins = if (m.has("startMinutes")) {
                normalizeMinutes(m.optInt("startMinutes", 0))
            } else {
                block.startMinutes ?: minutesFromPeriod(block.startPeriod, start = true)
            }
            val endMins = if (m.has("endMinutes")) {
                normalizeMinutes(m.optInt("endMinutes", ALL_DAY_END))
            } else {
                block.endMinutes ?: minutesFromPeriod(
                    if (endDay == startDay) {
                        if (m.has("startPeriod")) normalizePeriod(m.optString("startPeriod"))
                        else block.startPeriod
                    } else {
                        if (m.has("endPeriod")) normalizePeriod(m.optString("endPeriod"))
                        else block.endPeriod
                    },
                    start = false,
                )
            }
            if (endDay == startDay && endMins <= startMins) return
            block.startDay = startDay
            block.endDay = endDay
            block.startPeriod = if (m.has("startPeriod")) {
                normalizePeriod(m.optString("startPeriod"))
            } else {
                block.startPeriod
            }
            block.endPeriod = if (endDay == startDay) {
                null
            } else if (m.has("endPeriod")) {
                normalizePeriod(m.optString("endPeriod"))
            } else {
                block.endPeriod
            }
            block.startMinutes = startMins
            block.endMinutes = endMins
        }
        operations.save()
        operations.broadcastToChannel(ch, JSONObject()
            .put("type", "timeBlockUpdated")
            .put("timeBlock", JSONObject(gson.toJson(block))))
    }

    private fun cmdDelete(user: User, m: JSONObject) {
        val block = state.timeBlocks.find { it.id == m.optString("timeBlockId") } ?: return
        val ch = state.channels.find { it.id == block.channelId } ?: return
        if (!authorization.channelVisible(ch, user)) return
        val isOwner = block.createdBy == user.id
        if (!isOwner && !authorization.canModerateEvents(user)) return
        state.timeBlocks.removeAll { it.id == block.id }
        operations.save()
        operations.broadcastToChannel(ch, JSONObject()
            .put("type", "timeBlockDeleted")
            .put("timeBlockId", block.id)
            .put("channelId", ch.id))
    }

    private fun cmdSignup(user: User, m: JSONObject) {
        val block = state.timeBlocks.find { it.id == m.optString("timeBlockId") } ?: return
        val ch = state.channels.find { it.id == block.channelId } ?: return
        if (!authorization.channelVisible(ch, user)) return
        val list = block.signups ?: mutableListOf<TimeBlockSignup>().also { block.signups = it }
        val remove = m.optBoolean("remove", false)
        if (remove) {
            list.removeAll { it.userId == user.id }
        } else {
            list.removeAll { it.userId == user.id }
            list.add(
                TimeBlockSignup(
                    userId = user.id,
                    name = user.name,
                    ts = System.currentTimeMillis(),
                ),
            )
        }
        operations.save()
        operations.broadcastToChannel(ch, JSONObject()
            .put("type", "timeBlockSignup")
            .put("timeBlockId", block.id)
            .put("channelId", ch.id)
            .put("signups", org.json.JSONArray(gson.toJson(list))))
    }

    companion object {
        private const val MAX_SPAN_MS = 366L * 24L * 60L * 60L * 1000L
        private const val ALL_DAY_END = 23 * 60 + 59
        private val PERIODS = setOf("morning", "afternoon", "evening")

        fun channelAllowsTimeBlocks(ch: Channel): Boolean {
            if (ch.kind != "event") return false
            if (ch.pinnedLocationLabel != null || ch.pinnedUserId != null) return false
            return true
        }

        fun normalizePeriod(raw: String?): String? {
            val v = raw?.trim()?.lowercase().orEmpty()
            if (v.isEmpty() || v == "null" || v == "day" || v == "whole") return null
            return if (v in PERIODS) v else null
        }

        fun normalizeMinutes(raw: Int): Int = raw.coerceIn(0, ALL_DAY_END)

        fun minutesFromPeriod(period: String?, start: Boolean): Int {
            return when (normalizePeriod(period)) {
                "morning" -> if (start) 8 * 60 else 12 * 60
                "afternoon" -> if (start) 12 * 60 else 17 * 60
                "evening" -> if (start) 18 * 60 else 23 * 60
                else -> if (start) 0 else ALL_DAY_END
            }
        }

        fun resolveMinutes(m: JSONObject, key: String, period: String?, start: Boolean): Int {
            if (m.has(key) && !m.isNull(key)) {
                return normalizeMinutes(m.optInt(key, if (start) 0 else ALL_DAY_END))
            }
            return minutesFromPeriod(period, start)
        }

        /** Accept a dayStart-ish ms; snap to local midnight of that instant. */
        fun normalizeDay(raw: Long): Long? {
            if (raw <= 0L) return null
            val cal = java.util.Calendar.getInstance()
            cal.timeInMillis = raw
            cal.set(java.util.Calendar.HOUR_OF_DAY, 0)
            cal.set(java.util.Calendar.MINUTE, 0)
            cal.set(java.util.Calendar.SECOND, 0)
            cal.set(java.util.Calendar.MILLISECOND, 0)
            return cal.timeInMillis
        }
    }
}
