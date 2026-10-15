package app.phlip.server

import fi.iki.elonen.NanoHTTPD
import org.json.JSONObject
import java.util.UUID

/**
 * LAN/Direct browser surface for personal invites: `GET|POST /j/<slug>`.
 * Public tunnel traffic uses the edge Worker on the server's own hostname instead.
 */
internal class PersonalInviteHttpHandler(
    private val transport: Transport,
    private val operations: Operations,
) {
    internal data class Transport(
        val jsonResponse: (NanoHTTPD.Response.Status, JSONObject) -> NanoHTTPD.Response,
        val rejectIfBodyTooLarge: (NanoHTTPD.IHTTPSession) -> NanoHTTPD.Response?,
        val readJsonBody: (NanoHTTPD.IHTTPSession) -> JSONObject?,
        val clientIp: (NanoHTTPD.IHTTPSession) -> String,
        val htmlResponse: (NanoHTTPD.Response.Status, String) -> NanoHTTPD.Response,
        val redirectResponse: (String) -> NanoHTTPD.Response,
    )

    internal data class Operations(
        val hostDisplayName: () -> String,
        val findUserByInviteSlug: (String) -> User?,
        val processJoin: (
            nameRaw: String,
            inviteRaw: String,
            fingerprint: String,
            authVerifier: String,
            ip: String,
            identityId: String,
            identityPub: String,
            inviteSlug: String,
        ) -> JSONObject,
    )

    /** Match `/j/<slug>` or `/j/<slug>/request`. */
    fun parsePath(path: String): Pair<String, Boolean>? {
        val p = path.trimEnd('/')
        if (!p.startsWith("/j/")) return null
        val rest = p.removePrefix("/j/").trim('/')
        if (rest.isEmpty()) return null
        val request = rest.endsWith("/request")
        val slugPart = if (request) rest.removeSuffix("/request").trim('/') else rest
        val slug = slugPart.lowercase().replace(Regex("[^a-z0-9]"), "")
        if (slug.length < 8) return null
        return slug to request
    }

    fun handle(session: NanoHTTPD.IHTTPSession, path: String): NanoHTTPD.Response? {
        val parsed = parsePath(path) ?: return null
        val (slug, isRequestPath) = parsed
        // Browser HTML GET: never show a bare name form — SPA agreement first.
        if (session.method == NanoHTTPD.Method.GET && !isRequestPath && wantsHtml(session)) {
            return transport.redirectResponse("/?slug=${slug}")
        }
        // Browser form POST (not JSON API): send into SPA instead of joining without agree.
        val ctEarly = (session.headers["content-type"] ?: "").lowercase()
        if (session.method == NanoHTTPD.Method.POST &&
            !ctEarly.contains("application/json") &&
            wantsHtml(session)
        ) {
            return transport.redirectResponse("/?slug=${slug}")
        }
        val inviter = operations.findUserByInviteSlug(slug)
        if (inviter == null) {
            return transport.jsonResponse(
                NanoHTTPD.Response.Status.NOT_FOUND,
                JSONObject()
                    .put("ok", false)
                    .put("slug", slug)
                    .put("error", "That invite link isn't recognised."),
            )
        }
        if (session.method == NanoHTTPD.Method.GET && !isRequestPath) {
            return transport.jsonResponse(
                NanoHTTPD.Response.Status.OK,
                JSONObject()
                    .put("ok", true)
                    .put("slug", slug)
                    .put("hostDisplayName", operations.hostDisplayName())
                    .put("invitedByName", inviter.name)
                    .put("tunnelUp", false)
                    .put("local", true),
            )
        }
        if (session.method == NanoHTTPD.Method.POST && (isRequestPath || path.trimEnd('/') == "/j/$slug")) {
            return handleRequest(session, slug)
        }
        return transport.jsonResponse(
            NanoHTTPD.Response.Status.METHOD_NOT_ALLOWED,
            JSONObject().put("type", "error").put("error", "Use GET or POST."),
        )
    }

    private fun handleRequest(session: NanoHTTPD.IHTTPSession, slug: String): NanoHTTPD.Response {
        transport.rejectIfBodyTooLarge(session)?.let { return it }
        var name = ""
        var fingerprint = ""
        val ct = (session.headers["content-type"] ?: "").lowercase()
        if (ct.contains("application/json")) {
            val body = transport.readJsonBody(session) ?: JSONObject()
            name = body.optString("name").trim()
            fingerprint = body.optString("fingerprint").trim().lowercase()
        } else {
            try {
                val files = HashMap<String, String>()
                session.parseBody(files)
            } catch (_: Exception) {
            }
            name = (session.parms["name"] ?: "").trim()
            fingerprint = (session.parms["fingerprint"] ?: "").trim().lowercase()
        }
        name = name.take(24)
        if (name.isEmpty()) {
            return transport.jsonResponse(
                NanoHTTPD.Response.Status.BAD_REQUEST,
                JSONObject().put("type", "error").put("error", "Pick a name so friends know who you are."),
            )
        }
        if (fingerprint.length < 16) {
            fingerprint = "lan" + UUID.randomUUID().toString().replace("-", "").take(24)
        }
        val ip = transport.clientIp(session)
        val result = operations.processJoin(
            name,
            "",
            fingerprint,
            "",
            ip,
            "",
            "",
            slug,
        )
        val type = result.optString("type")
        val status = when (type) {
            "error" -> NanoHTTPD.Response.Status.FORBIDDEN
            else -> NanoHTTPD.Response.Status.OK
        }
        return transport.jsonResponse(status, result)
    }

    private fun wantsHtml(session: NanoHTTPD.IHTTPSession): Boolean {
        val accept = (session.headers["accept"] ?: "").lowercase()
        if (accept.contains("application/json")) return false
        return accept.contains("text/html") || accept.contains("*/*") || accept.isEmpty()
    }
}
