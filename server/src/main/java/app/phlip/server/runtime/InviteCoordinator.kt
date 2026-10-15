package app.phlip.server

import org.json.JSONObject

/**
 * Legacy rotating join-code invite (deprecated for admission).
 *
 * Request-to-join uses personal invite slugs (`User.inviteSlug`) + host Approve.
 * This coordinator remains for one-release backward compat (edge invite-hash,
 * Force join code APIs) but **auto-rotation is disabled** — codes no longer
 * cycle on a timer. Prefer [MembershipService] personal invite link RPCs.
 *
 * **Store:** [AppState.inviteCode], [AppState.inviteExpiry], [AppState.forceJoinCode],
 * [AppState.codeChallenge]; remint may rewrite [AppState.users] bearer keys.
 */
internal class InviteCoordinator(
    private val stateProvider: () -> AppState,
    private val sessionRegistry: ServerSessionRegistry,
    private val authorization: ServerAuthorization,
    private val operations: Operations,
) {
    internal data class Operations(
        val save: () -> Unit,
        val newInviteCode: () -> String,
        val newMemberToken: () -> String,
        val disconnectUser: (String, String) -> Unit,
        val broadcast: (JSONObject) -> Unit,
        val serverSettingsPayload: () -> JSONObject,
        val sendToUser: (User, JSONObject) -> Unit,
        val enqueueHttp: (String, String) -> Unit,
        val scheduleInviteRotation: (Long) -> Unit,
        val onInviteChanged: (String, Long) -> Unit,
    )

    private val state get() = stateProvider()
    private val clients get() = sessionRegistry.clients
    private val httpClients get() = sessionRegistry.httpClients

    fun regenerateInvite(ttlMs: Long = INVITE_TTL_MS): Pair<String, Long> {
        state.inviteCode = operations.newInviteCode()
        state.inviteExpiry = System.currentTimeMillis() + ttlMs
        operations.save()
        notifyInviteChanged()
        return Pair(state.inviteCode, state.inviteExpiry)
    }

    fun forceJoinCode(): Boolean = state.forceJoinCode

    /**
     * Host failsafe: when enabled, every member re-login needs the current join code.
     * Turning on issues a fresh code, clears device trust, and invalidates live
     * member sessions so app/browser clients must sign in again with that code.
     */
    fun setForceJoinCode(enabled: Boolean) {
        val turningOn = enabled && !state.forceJoinCode
        state.forceJoinCode = enabled
        if (turningOn) {
            regenerateInvite()
            for (u in state.users.values) {
                if (!u.isHost) u.trustedFpHashes?.clear()
            }
            val reason = "Host requires the current join code — sign in again with your name, password, and the new code."
            remintNonHostSessions(reason)
        }
        operations.save()
        operations.broadcast(
            JSONObject().put("type", "serverSettings").put("serverSettings", operations.serverSettingsPayload()),
        )
    }

    /**
     * One-shot failsafe: bump [AppState.codeChallenge] so every member must present
     * the **current** join code once on next sign-in. Does not leave Force join code on,
     * and does not rotate the invite (share the existing code).
     */
    fun triggerCodeRequest() {
        state.codeChallenge = (state.codeChallenge + 1).coerceAtLeast(1)
        for (u in state.users.values) {
            if (!u.isHost) u.trustedFpHashes?.clear()
        }
        val reason = "Host requested the join code once — sign in again with your name, password, and the current code."
        remintNonHostSessions(reason)
        operations.save()
        operations.broadcast(
            JSONObject().put("type", "serverSettings").put("serverSettings", operations.serverSettingsPayload()),
        )
    }

    fun cmdTriggerCodeRequest(user: User) {
        if (!authorization.canManageServer(user)) {
            operations.sendToUser(
                user,
                JSONObject().put("type", "error").put("error", "Only admins can trigger a code request.")
                    .put("code", "forbidden"),
            )
            return
        }
        // Ack before sessions are wiped so the acting admin (if non-host) may still hear it.
        operations.sendToUser(
            user,
            JSONObject().put("type", "codeRequestTriggered").put("codeChallenge", state.codeChallenge + 1),
        )
        triggerCodeRequest()
    }

    /** Current legacy invite code; mints once if empty (no timer auto-rotation). */
    fun currentInvite(): Pair<String, Long> {
        if (state.inviteCode.isEmpty()) {
            return regenerateInvite()
        }
        return Pair(state.inviteCode, state.inviteExpiry)
    }

    /** Push code to managers if still used; rotation timer is a no-op (request-to-join). */
    fun notifyInviteChanged() {
        val code = state.inviteCode
        val expiry = state.inviteExpiry
        broadcastInviteToManagers(code, expiry)
        // Auto-rotation disabled — personal invite slugs do not expire on a timer.
        operations.onInviteChanged(code, expiry)
    }

    fun broadcastInviteToManagers(code: String, expiry: Long) {
        val raw = JSONObject()
            .put("type", "invite")
            .put("code", code)
            .put("expiry", expiry)
            .toString()
        for ((ws, token) in clients) {
            val u = state.users[token] ?: continue
            if (!authorization.canManageServer(u)) continue
            try { ws.send(raw) } catch (_: Exception) {}
        }
        for ((token, _) in httpClients) {
            val u = state.users[token] ?: continue
            if (!authorization.canManageServer(u)) continue
            operations.enqueueHttp(token, raw)
        }
    }

    /** No-op: rotating codes are retired; personal invite slugs are stable until rotate. */
    fun scheduleInviteRotation(@Suppress("UNUSED_PARAMETER") expiry: Long = state.inviteExpiry) {
        // Intentionally empty.
    }

    private fun remintNonHostSessions(reason: String) {
        val remint = state.users.entries.filter { !it.value.isHost }.map { it.key to it.value }
        for ((oldTok, user) in remint) {
            operations.disconnectUser(oldTok, reason)
            state.users.remove(oldTok)
            val newTok = operations.newMemberToken()
            state.users[newTok] = user
        }
    }
}
