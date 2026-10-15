package app.phlip.server

import fi.iki.elonen.NanoWSD
import org.json.JSONObject
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** Minimal socket surface for join / approve / deny (implemented by [DrServer.DrWebSocket]). */
internal interface JoinWebSocket {
    var pendingId: String?
    fun isSocketOpen(): Boolean
    fun send(text: String)
    fun closeNormal(reason: String)
}

/**
 * Join / approval / auth-salt orchestration: pending queue, remint, name claim,
 * and welcome handoff via [MembershipService.issueWelcome].
 *
 * Request-to-join: brand-new names enqueue without a rotating code. Optional
 * [inviteSlug] is resolved server-side for tamper-evident attribution.
 */
internal class JoinOrchestrator(
    private val stateProvider: () -> AppState,
    private val sessionRegistry: ServerSessionRegistry,
    private val membershipService: MembershipService,
    private val rateLimits: RateLimitPolicy,
    private val rng: SecureRandom,
    private val operations: Operations,
) {
    internal data class Operations(
        val save: () -> Unit,
        val genId: () -> String,
        val newMemberToken: () -> String,
        val snapshot: (User) -> JSONObject,
        val reclaimMemberSession: (String) -> Unit,
        val releaseHttpSession: (String) -> Unit,
        val bindClient: (JoinWebSocket, String) -> Unit,
        val presence: () -> Unit,
        val notifyPending: () -> Unit,
        val onEdgeMemberSession: (token: String, userId: String, oldToken: String?) -> Unit,
        val connectedClientCount: () -> Int,
        val pruneStalePending: () -> Unit,
        val pruneReadyWelcome: () -> Unit,
    )

    private val state get() = stateProvider()
    private val clients get() = sessionRegistry.clients
    private val httpClients get() = sessionRegistry.httpClients
    private val pending get() = sessionRegistry.pending
    private val preApproved get() = sessionRegistry.preApproved
    private val readyWelcome get() = sessionRegistry.readyWelcome
    private val readyWelcomeAt get() = sessionRegistry.readyWelcomeAt
    private val deniedIds get() = sessionRegistry.deniedIds

    /**
     * Auth-salt body only (no NanoHTTPD). May return `type:error` for rate lockout
     * or empty name; callers map HTTP status from `type` / error text.
     */
    fun authSalt(
        name: String,
        inviteRaw: String,
        identityId: String,
        ip: String,
        lan: Boolean,
        inviteSlug: String = "",
    ): JSONObject {
        rateLimits.limitedError(ip, lan)?.let { return it }
        val cleanName = name.trim().take(24)
        if (cleanName.isEmpty()) {
            return JSONObject().put("type", "error").put("error", "Name required")
        }
        val inviteOk = membershipService.inviteCodeValid(inviteRaw) ||
            membershipService.findUsableGroupInvite(inviteRaw) != null ||
            membershipService.findUserByInviteSlug(inviteSlug) != null
        val idKey = identityId.trim().lowercase().take(32)
        val user = when {
            idKey.length >= 8 -> state.users.values.find {
                !it.isHost && (it.identityId ?: "").equals(idKey, ignoreCase = true)
            } ?: state.users.values.find { !it.isHost && it.name.equals(cleanName, ignoreCase = true) }
            else -> state.users.values.find { !it.isHost && it.name.equals(cleanName, ignoreCase = true) }
        }
        val memberSalt = user?.pwdSalt?.takeIf { it.isNotEmpty() }
        val passworded = memberSalt != null && !user?.authVerifier.isNullOrEmpty()
        // Returning members and anyone with a valid slug/group/legacy invite get real salt.
        // New requesters (no password yet) also get a stable blind salt so they can proceed.
        if (inviteOk || passworded || lan) {
            return JSONObject().put("type", "authSalt").put("salt", memberSalt ?: blindAuthSalt(cleanName))
        }
        if (!lan) rateLimits.bump(ip, lan = false)
        return JSONObject().put("type", "authSalt").put("salt", blindAuthSalt(cleanName))
    }

    /** Persist a random HMAC key used to synthesize fake auth salts. */
    fun ensureSaltBlindKey(): Boolean {
        @Suppress("SENSELESS_COMPARISON")
        if (state.saltBlindKey != null && state.saltBlindKey.isNotBlank()) return false
        val b = ByteArray(32).also { rng.nextBytes(it) }
        state.saltBlindKey = Base64.getEncoder().encodeToString(b)
        return true
    }

    /** 16-byte base64 salt that looks like a real `pwdSalt` but is not one. */
    fun blindAuthSalt(name: String): String {
        ensureSaltBlindKey()
        val keyBytes = try {
            Base64.getDecoder().decode(state.saltBlindKey)
        } catch (_: Exception) {
            ByteArray(32).also { rng.nextBytes(it) }.also {
                state.saltBlindKey = Base64.getEncoder().encodeToString(it)
            }
        }
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(keyBytes, "HmacSHA256"))
        val dig = mac.doFinal("ash-salt:${name.lowercase()}".toByteArray(Charsets.UTF_8))
        return Base64.getEncoder().encodeToString(dig.copyOf(16))
    }

    /**
     * Per-user login + request-to-join.
     * - Returning member with password: authVerifier required (no rotating code).
     * - Brand-new name → pending queue (optional personal [inviteSlug] for attribution).
     */
    fun processJoin(
        nameRaw: String,
        inviteRaw: String,
        fingerprint: String,
        authVerifier: String,
        ip: String,
        joinWs: JoinWebSocket?,
        identityId: String = "",
        identityPub: String = "",
        inviteSlug: String = "",
        signInOnly: Boolean = false,
    ): JSONObject {
        val lan = ClientAddressPolicy.isPrivateClientIp(ip)
        rateLimits.limitedError(ip, lan)?.let { return it }
        val name = nameRaw.trim().take(24)
        if (name.isEmpty()) {
            if (signInOnly) {
                rateLimits.bump(ip, lan)
                return JSONObject().put("type", "error").put("error", "Wrong name or password.")
            }
            return JSONObject().put("type", "error").put("error", "Pick a name so friends know who you are.")
        }
        val fp = fingerprint.trim().lowercase()
        if (fp.length < 16) {
            if (signInOnly) {
                rateLimits.bump(ip, lan)
                return JSONObject().put("type", "error").put("error", "Wrong name or password.")
            }
            return JSONObject().put("type", "error").put("error", "Couldn't verify this device. Update the app and try again.")
        }
        if (operations.connectedClientCount() >= MAX_CLIENTS) {
            return JSONObject().put("type", "error").put("error", "Host is at capacity.")
        }

        val idKey = identityId.trim().lowercase().take(32)
        val byIdentity = if (idKey.length >= 8) {
            state.users.entries.find {
                !it.value.isHost && (it.value.identityId ?: "").equals(idKey, ignoreCase = true)
            }
        } else null
        val byName = state.users.entries.find {
            !it.value.isHost && it.value.name.equals(name, ignoreCase = true)
        }
        val existing = byIdentity ?: byName
        val groupInv = membershipService.findUsableGroupInvite(inviteRaw)
        // Legacy rotating code still accepted for group-invite-style redemption paths,
        // but is no longer required for brand-new request-to-join.
        val legacyInviteOk = membershipService.inviteCodeValid(inviteRaw) || groupInv != null
        val referrer = membershipService.findUserByInviteSlug(inviteSlug)

        if (existing != null && !existing.value.authVerifier.isNullOrEmpty()) {
            val user = existing.value
            if (authVerifier.isEmpty() || !ClientAddressPolicy.passwordsEqual(authVerifier, user.authVerifier!!)) {
                rateLimits.bump(ip, lan)
                return JSONObject().put("type", "error").put("error", "Wrong name or password.")
            }
            // Returning members: password only — no rotating join-code re-check.
            rateLimits.clear(ip)
            operations.reclaimMemberSession(existing.key)
            membershipService.rememberFingerprint(user, fp)
            membershipService.applyIdentityFields(user, idKey, identityPub)
            user.lastCodeAck = state.codeChallenge
            if (groupInv != null) {
                membershipService.applyInviteChannels(user, groupInv.channelIds)
                membershipService.consumeGroupInvite(groupInv)
            }
            val oldTok = existing.key
            val token = remintMemberToken(existing.key, user)
            operations.save()
            try { operations.onEdgeMemberSession(token, user.id, oldTok) } catch (_: Exception) {}
            val welcome = operations.snapshot(user).put("token", token)
            if (!user.wrappedGroupKey.isNullOrEmpty()) {
                welcome.put("wrappedGroupKey", user.wrappedGroupKey)
            }
            if (groupInv != null) welcome.put("inviteRedeemed", true)
            if (joinWs != null) {
                operations.bindClient(joinWs, token)
                try { joinWs.send(welcome.toString()) } catch (_: Exception) {}
                operations.presence()
            }
            return welcome
        }

        // Bare public login is authentication-only: an unknown or incomplete
        // account must never fall through to remint/setup or the pending queue.
        if (signInOnly) {
            rateLimits.bump(ip, lan)
            return JSONObject().put("type", "error").put("error", "Wrong name or password.")
        }

        if (existing != null && existing.value.authVerifier.isNullOrEmpty()) {
            // Incomplete account: LAN always OK; public needs slug / legacy invite / group invite.
            if (!lan && referrer == null && !legacyInviteOk) {
                rateLimits.bump(ip, lan)
                return JSONObject().put("type", "error").put(
                    "error",
                    "This account isn't fully set up yet. Open a personal invite link from someone in the group, then try again.",
                )
            }
            rateLimits.clear(ip)
            operations.reclaimMemberSession(existing.key)
            membershipService.applyIdentityFields(existing.value, idKey, identityPub)
            val setupNonce = operations.genId()
            val welcome = membershipService.issueWelcome(
                name, setupNonce = setupNonce, fingerprint = fp,
                inviteChannelIds = groupInv?.channelIds?.toList() ?: emptyList(),
                consumeInvite = groupInv,
                identityId = idKey,
                identityPub = identityPub,
            )
            if (joinWs != null) {
                operations.bindClient(joinWs, welcome.optString("token"))
                try { joinWs.send(welcome.toString()) } catch (_: Exception) {}
                operations.presence()
            }
            return welcome
        }

        // Brand-new name: no rotating code required — enqueue for host approval.
        // Unknown/forged slug is ignored (open request) rather than forging attribution.
        if (!claimMemberName(name, ip)) {
            return JSONObject().put("type", "error")
                .put("error", "Someone here already uses that name. Try another.")
                .put("code", "nameTaken")
                .put("takenName", name)
        }

        rateLimits.clear(ip)
        val reservedChannels = mutableListOf<String>()
        var reservedInviteId: String? = null
        if (groupInv != null) {
            reservedChannels.addAll(groupInv.channelIds)
            reservedInviteId = groupInv.id
            membershipService.consumeGroupInvite(groupInv)
            operations.save()
        }
        val preAt = preApproved.remove(name.lowercase())
        if (preAt != null && System.currentTimeMillis() - preAt < 10 * 60_000L) {
            val setupNonce = operations.genId()
            val welcome = membershipService.issueWelcome(
                name, setupNonce = setupNonce, fingerprint = fp,
                inviteChannelIds = reservedChannels,
                identityId = idKey,
                identityPub = identityPub,
            )
            if (joinWs != null) {
                operations.bindClient(joinWs, welcome.optString("token"))
                try { joinWs.send(welcome.toString()) } catch (_: Exception) {}
                operations.presence()
            }
            return welcome
        }

        val nanoWs = joinWs as? NanoWSD.WebSocket
        val existingPending = pending.entries.find { it.value.name.equals(name, ignoreCase = true) }
        if (existingPending != null) {
            if (joinWs != null) {
                existingPending.value.ws = nanoWs
                joinWs.pendingId = existingPending.key
                try {
                    joinWs.send(
                        JSONObject().put("type", "waiting")
                            .put("requestId", existingPending.key)
                            .put("setupNonce", existingPending.value.setupNonce)
                            .toString(),
                    )
                } catch (_: Exception) {}
            }
            return JSONObject().put("type", "waiting").put("requestId", existingPending.key)
                .put("setupNonce", existingPending.value.setupNonce)
        }
        if (pending.size >= MAX_PENDING) {
            if (reservedInviteId != null) membershipService.refundGroupInvite(reservedInviteId)
            return JSONObject().put("type", "error").put("error", "Too many requests waiting — try again shortly.")
        }
        val rid = operations.genId()
        val setupNonce = operations.genId()
        pending[rid] = PendingEntry(
            nanoWs, name, System.currentTimeMillis(), setupNonce, fp,
            inviteId = reservedInviteId,
            inviteChannelIds = reservedChannels.toList(),
            identityId = idKey.takeIf { it.length >= 8 },
            identityPub = identityPub.trim().takeIf { it.isNotEmpty() }?.take(512),
            invitedByUserId = referrer?.id,
            invitedByName = referrer?.name,
            inviteSlug = referrer?.inviteSlug,
        )
        if (joinWs != null) joinWs.pendingId = rid
        operations.notifyPending()
        if (joinWs != null) {
            try {
                joinWs.send(
                    JSONObject().put("type", "waiting")
                        .put("requestId", rid)
                        .put("setupNonce", setupNonce)
                        .toString(),
                )
            } catch (_: Exception) {}
        }
        return JSONObject().put("type", "waiting").put("requestId", rid).put("setupNonce", setupNonce)
    }

    fun remintMemberToken(oldToken: String, user: User): String {
        val fresh = operations.newMemberToken()
        if (oldToken.isNotEmpty() && oldToken == fresh) return oldToken
        if (oldToken.isNotEmpty()) state.users.remove(oldToken)
        state.users[fresh] = user
        return fresh
    }

    @Suppress("UNUSED_PARAMETER")
    fun claimMemberName(name: String, ip: String): Boolean {
        val existing = state.users.entries.find { it.value.name.equals(name, ignoreCase = true) }
            ?: return true
        if (existing.value.isHost) return false
        if (clients.containsValue(existing.key)) return false
        val http = httpClients[existing.key]
        if (http != null) {
            val fresh = System.currentTimeMillis() - http.lastSeen < HTTP_PRESENCE_IDLE_MS
            if (!fresh) {
                operations.releaseHttpSession(existing.key)
                return true
            }
            return false
        }
        return true
    }

    fun approve(requestId: String): Boolean {
        operations.pruneStalePending()
        operations.pruneReadyWelcome()
        val p = pending.remove(requestId) ?: return false
        val welcome = membershipService.issueWelcome(
            p.name, setupNonce = p.setupNonce, fingerprint = p.fingerprint,
            inviteChannelIds = p.inviteChannelIds,
            identityId = p.identityId ?: "",
            identityPub = p.identityPub ?: "",
        )
        readyWelcome[requestId] = welcome
        readyWelcomeAt[requestId] = System.currentTimeMillis()
        preApproved[p.name.lowercase()] = System.currentTimeMillis()
        val ws = p.ws as? JoinWebSocket
        val wsLive = try { ws != null && ws.isSocketOpen() } catch (_: Exception) { false }
        if (wsLive && ws != null) {
            ws.pendingId = null
            operations.bindClient(ws, welcome.optString("token"))
            try {
                ws.send(welcome.toString())
            } catch (e: Exception) {
                android.util.Log.e("AshJoin", "approve welcome ws failed for ${p.name}", e)
            }
        } else {
            android.util.Log.i("AshJoin", "approve via HTTP queue: ${p.name} id=$requestId")
        }
        operations.notifyPending()
        operations.presence()
        return true
    }

    fun deny(requestId: String) {
        val p = pending.remove(requestId) ?: return
        preApproved.remove(p.name.lowercase())
        if (!p.inviteId.isNullOrEmpty()) membershipService.refundGroupInvite(p.inviteId!!)
        deniedIds[requestId] = System.currentTimeMillis()
        val ws = p.ws as? JoinWebSocket
        if (ws != null) {
            ws.pendingId = null
            try {
                ws.send(JSONObject().put("type", "denied").toString())
                ws.closeNormal("denied")
            } catch (_: Exception) {}
        }
        operations.notifyPending()
    }
}
