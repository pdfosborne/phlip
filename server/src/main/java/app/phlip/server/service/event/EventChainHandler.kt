package app.phlip.server

import org.json.JSONObject

/** Event chain mode, promote, and dependency-warn commands. */
internal class EventChainHandler(
    private val s: EventCommandSupport,
) {
    fun cmdSetChainMode(user: User, m: JSONObject) {
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return
        if (ev.chainOf != null) return
        if (!s.authorization.canChannel(user, ch, PERM_FLAG_CHAINS) &&
            !s.authorization.canEditEvent(user, ev)
        ) return
        val mode = m.optString("mode").trim().lowercase()
            .takeIf { it in setOf("sequence", "choice") } ?: return
        ev.chainMode = mode
        s.operations.save()
        s.broadcastChainUpdated(ch, ev)
    }

    fun cmdPromoteChainEvent(user: User, m: JSONObject) {
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return
        if (ev.chainOf.isNullOrEmpty()) return
        if (!s.authorization.canChannel(user, ch, PERM_FLAG_CHAINS) &&
            !s.authorization.canEditEvent(user, ev)
        ) return
        ev.chainStatus = "linked"
        ev.chainDepWarnWhen = null
        val primary = s.state.events.find { it.id == ev.chainOf }
        if (primary?.chainMode == "choice") {
            val loserIds = s.state.events.filter {
                it.chainOf == ev.chainOf && it.id != ev.id && (it.chainStatus ?: "proposal") == "proposal"
            }.map { it.id }
            for (id in loserIds) {
                s.state.events.removeAll { it.id == id }
                s.operations.broadcastToChannel(ch, JSONObject().put("type", "eventDeleted").put("eventId", id))
            }
        }
        s.operations.save()
        s.broadcastChainUpdated(ch, ev)
    }

    fun cmdClearChainDepWarn(user: User, m: JSONObject) {
        val ev = s.state.events.find { it.id == m.optString("eventId") } ?: return
        val ch = s.state.channels.find { it.id == ev.channelId } ?: return
        if (ev.chainDepWarnWhen == null) return
        if (!s.authorization.canChannel(user, ch, PERM_FLAG_CHAINS) &&
            !s.authorization.canEditEvent(user, ev)
        ) return
        ev.chainDepWarnWhen = null
        s.operations.save()
        s.broadcastChainUpdated(ch, ev)
    }
}
