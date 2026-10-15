package app.phlip.server

import com.google.gson.Gson
import org.json.JSONArray
import org.json.JSONObject

/** Member and guest abuse-report handling with moderator-only delivery. */
internal class ModerationService(
    private val stateProvider: () -> AppState,
    private val gson: Gson,
    private val authorization: ServerAuthorization,
    private val idGenerator: () -> String,
    private val operations: Operations,
) {
    internal data class Operations(
        val save: () -> Unit,
        val sendToUser: (User, JSONObject) -> Unit,
        val broadcastToModerators: (JSONObject) -> Unit,
    )

    private val state: AppState get() = stateProvider()
    private val reportTargetTypes = setOf("message", "event", "user", "broadcast")
    private val reportReasons = setOf(
        "spam", "harassment", "hate", "sexual", "csam", "violence", "illegal", "other",
    )

    fun dispatch(user: User, message: JSONObject): Boolean {
        when (message.optString("type")) {
            "report" -> cmdReport(user, message)
            "setBlock" -> cmdSetBlock(user, message)
            "resolveReport" -> cmdResolveReport(user, message)
            else -> return false
        }
        return true
    }

    private fun cmdReport(user: User, message: JSONObject) {
        // Every authenticated member — including viewers — may report.
        val report = buildReport(
            rawType = message.optString("targetType"),
            targetId = message.optString("targetId"),
            channelId = message.optString("channelId").ifEmpty { null },
            rawReason = message.optString("reason"),
            rawNote = message.optString("note"),
            reporterId = user.id,
            reporterName = user.name,
            isGuest = false,
        ) ?: return
        val duplicate = state.reports.any {
            it.status == "open" && it.reporterId == user.id &&
                it.targetType == report.targetType && it.targetId == report.targetId
        }
        if (!duplicate) {
            if (state.reports.count { it.status == "open" && it.reporterId == user.id } >=
                MAX_OPEN_REPORTS_PER_REPORTER
            ) {
                operations.sendToUser(user, JSONObject().put("type", "reportAck").put("id", report.id))
                return
            }
            addReport(report)
        }
        operations.sendToUser(user, JSONObject().put("type", "reportAck").put("id", report.id))
    }

    private fun cmdSetBlock(user: User, message: JSONObject) {
        val targetId = message.optString("userId").ifEmpty { return }
        if (targetId == user.id) return
        val blocked = message.optBoolean("blocked", true)
        val list = user.blockedUserIds ?: mutableListOf<String>().also { user.blockedUserIds = it }
        val changed = if (blocked) {
            (targetId !in list).also { if (it) list.add(targetId) }
        } else {
            list.remove(targetId)
        }
        if (changed) {
            operations.save()
            operations.sendToUser(
                user,
                JSONObject().put("type", "blockUpdated")
                    .put("blocked", JSONArray(gson.toJson(user.blockedUserIds ?: emptyList<String>()))),
            )
        }
    }

    private fun cmdResolveReport(user: User, message: JSONObject) {
        if (!authorization.canModerateEvents(user)) return
        val id = message.optString("id").ifEmpty { return }
        val action = message.optString("action")
            .takeIf { it in setOf("resolved", "dismissed", "open") } ?: return
        val report = state.reports.find { it.id == id } ?: return
        report.status = action
        report.handledBy = user.id
        report.handledByName = user.name
        report.handledAt = System.currentTimeMillis()
        operations.save()
        operations.broadcastToModerators(
            JSONObject().put("type", "reportUpdated").put("report", JSONObject(gson.toJson(report))),
        )
    }

    fun buildReport(
        rawType: String,
        targetId: String,
        channelId: String?,
        rawReason: String,
        rawNote: String,
        reporterId: String,
        reporterName: String,
        isGuest: Boolean,
    ): Report? {
        val type = rawType.trim().lowercase().takeIf { it in reportTargetTypes } ?: return null
        val id = targetId.trim().take(200).ifEmpty { return null }
        if (!reportTargetExists(type, id)) return null
        val reason = rawReason.trim().lowercase().takeIf { it in reportReasons } ?: "other"
        val note = rawNote.trim().take(MAX_REPORT_NOTE).ifEmpty { null }
        val channel = channelId?.trim()?.take(64)?.takeIf { it.isNotEmpty() }
            ?.takeIf { candidate -> state.channels.any { it.id == candidate } }
        return Report(
            id = idGenerator(),
            targetType = type,
            targetId = id,
            channelId = channel,
            reason = reason,
            note = note,
            reporterId = reporterId,
            reporterName = reporterName,
            isGuest = isGuest,
            createdAt = System.currentTimeMillis(),
        )
    }

    fun addReport(report: Report) {
        state.reports.add(report)
        if (state.reports.size > MAX_REPORTS) state.reports.removeAt(0)
        operations.save()
        operations.broadcastToModerators(
            JSONObject().put("type", "reportAdded").put("report", JSONObject(gson.toJson(report))),
        )
    }

    fun reportsPayload(): JSONArray =
        JSONArray(gson.toJson(state.reports.takeLast(200).reversed()))

    private fun reportTargetExists(type: String, id: String): Boolean = when (type) {
        "event" -> state.events.any { it.id == id }
        "user" -> state.users.values.any { it.id == id }
        "message" -> state.messages.values.any { messages -> messages.any { it.id == id } }
        else -> false
    }
}
