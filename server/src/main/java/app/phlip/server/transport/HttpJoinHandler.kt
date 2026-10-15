package app.phlip.server

import fi.iki.elonen.NanoHTTPD
import org.json.JSONObject

/**
 * Member join HTTP surface: auth-salt, join POST, and join-wait poll.
 * Wired behind [HttpGateway]; [DrServer] stays the NanoWSD façade.
 */
internal class HttpJoinHandler(
    private val transport: Transport,
    private val operations: Operations,
) {
    internal data class Transport(
        val jsonResponse: (NanoHTTPD.Response.Status, JSONObject) -> NanoHTTPD.Response,
        val rejectIfBodyTooLarge: (NanoHTTPD.IHTTPSession) -> NanoHTTPD.Response?,
        val readJsonBody: (NanoHTTPD.IHTTPSession) -> JSONObject?,
        val clientIp: (NanoHTTPD.IHTTPSession) -> String,
        val isPrivateClientIp: (String) -> Boolean,
        val isDirectLanRequest: (NanoHTTPD.IHTTPSession) -> Boolean,
    )

    internal data class Operations(
        val authSalt: (
            name: String,
            inviteRaw: String,
            identityId: String,
            ip: String,
            lan: Boolean,
            inviteSlug: String,
        ) -> JSONObject,
        val processJoin: (
            nameRaw: String,
            inviteRaw: String,
            fingerprint: String,
            authVerifier: String,
            ip: String,
            identityId: String,
            identityPub: String,
            inviteSlug: String,
            signInOnly: Boolean,
        ) -> JSONObject,
        val pruneReadyWelcome: () -> Unit,
        val readyWelcome: (String) -> JSONObject?,
        val isDenied: (String) -> Boolean,
        val isPending: (String) -> Boolean,
    )

    /**
     * GET ?name=&invite=&inviteSlug= → always `{type:authSalt,salt}` (never "unknown").
     * Real member salt when a personal slug / group invite / legacy code is valid, OR when
     * this name already has a password. Otherwise a deterministic fake salt.
     */
    fun handleAuthSalt(session: NanoHTTPD.IHTTPSession): NanoHTTPD.Response {
        val ip = transport.clientIp(session)
        val lan = transport.isPrivateClientIp(ip) || transport.isDirectLanRequest(session)
        val body = operations.authSalt(
            session.parms["name"] ?: "",
            session.parms["invite"] ?: "",
            session.parms["identityId"] ?: "",
            ip,
            lan,
            session.parms["inviteSlug"] ?: "",
        )
        val status = when (body.optString("type")) {
            "error" -> when {
                body.optString("error") == "Name required" -> NanoHTTPD.Response.Status.BAD_REQUEST
                else -> NanoHTTPD.Response.Status.FORBIDDEN
            }
            else -> NanoHTTPD.Response.Status.OK
        }
        return transport.jsonResponse(status, body)
    }

    /** POST credentials → waiting | welcome | error; login mode can never enqueue. */
    fun handleJoin(
        session: NanoHTTPD.IHTTPSession,
        signInOnly: Boolean = false,
    ): NanoHTTPD.Response {
        if (session.method != NanoHTTPD.Method.POST) {
            return transport.jsonResponse(
                NanoHTTPD.Response.Status.METHOD_NOT_ALLOWED,
                JSONObject().put("type", "error").put("error", "POST required"),
            )
        }
        transport.rejectIfBodyTooLarge(session)?.let { return it }
        val body = transport.readJsonBody(session)
            ?: return transport.jsonResponse(
                NanoHTTPD.Response.Status.BAD_REQUEST,
                JSONObject().put("type", "error")
                    .put("error", "Couldn't read the join request. Try again, or ask the host to toggle Public off/on."),
            )
        val ip = transport.clientIp(session)
        val result = operations.processJoin(
            body.optString("name"),
            body.optString("invite"),
            body.optString("fingerprint"),
            body.optString("authVerifier"),
            ip,
            body.optString("identityId"),
            body.optString("identityPub"),
            body.optString("inviteSlug").ifEmpty { body.optString("slug") },
            signInOnly,
        )
        val type = result.optString("type")
        val status = when (type) {
            "error" -> when {
                result.optString("error").contains("capacity", true) -> NanoHTTPD.Response.Status.SERVICE_UNAVAILABLE
                result.optString("error").contains("already uses", true) -> NanoHTTPD.Response.Status.CONFLICT
                result.optString("error").contains("Too many", true) -> NanoHTTPD.Response.Status.FORBIDDEN
                else -> NanoHTTPD.Response.Status.FORBIDDEN
            }
            else -> NanoHTTPD.Response.Status.OK
        }
        return transport.jsonResponse(status, result)
    }

    /** GET ?id=requestId → waiting | welcome | denied | error */
    fun handleJoinWait(session: NanoHTTPD.IHTTPSession): NanoHTTPD.Response {
        operations.pruneReadyWelcome()
        val id = session.parms["id"]?.trim().orEmpty()
        if (id.isEmpty()) {
            return transport.jsonResponse(
                NanoHTTPD.Response.Status.BAD_REQUEST,
                JSONObject().put("type", "error").put("error", "Missing id"),
            )
        }
        operations.readyWelcome(id)?.let { welcome ->
            return transport.jsonResponse(NanoHTTPD.Response.Status.OK, welcome)
        }
        if (operations.isDenied(id)) {
            return transport.jsonResponse(
                NanoHTTPD.Response.Status.OK,
                JSONObject().put("type", "denied"),
            )
        }
        if (operations.isPending(id)) {
            return transport.jsonResponse(
                NanoHTTPD.Response.Status.OK,
                JSONObject().put("type", "waiting").put("requestId", id),
            )
        }
        return transport.jsonResponse(
            NanoHTTPD.Response.Status.NOT_FOUND,
            JSONObject().put("type", "error").put("error", "That join request expired. Try joining again."),
        )
    }
}
