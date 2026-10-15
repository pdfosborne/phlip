package app.phlip.server

import fi.iki.elonen.NanoHTTPD
import org.json.JSONObject

/**
 * Request-focused HTTP gateway for DrServer.
 *
 * DrServer remains the NanoWSD facade; this gateway isolates endpoint routing
 * and keeps path handling explicit for behavioral parity tests.
 */
internal class HttpGateway(
    private val transport: Transport,
) {
    data class Transport(
        val isWebsocketRequested: (NanoHTTPD.IHTTPSession) -> Boolean,
        val serveWebsocket: (NanoHTTPD.IHTTPSession) -> NanoHTTPD.Response,
        val rejectIfEdgeGateFails: (NanoHTTPD.IHTTPSession) -> NanoHTTPD.Response?,
        val jsonResponse: (NanoHTTPD.Response.Status, JSONObject) -> NanoHTTPD.Response,
        val publicJoinMeta: (NanoHTTPD.IHTTPSession) -> JSONObject,
        val handleHttpJoin: (NanoHTTPD.IHTTPSession) -> NanoHTTPD.Response,
        val handleHttpLogin: (NanoHTTPD.IHTTPSession) -> NanoHTTPD.Response,
        val handleHttpJoinWait: (NanoHTTPD.IHTTPSession) -> NanoHTTPD.Response,
        val handleAuthSalt: (NanoHTTPD.IHTTPSession) -> NanoHTTPD.Response,
        val handleHttpPoll: (NanoHTTPD.IHTTPSession) -> NanoHTTPD.Response,
        val handleHttpLeave: (NanoHTTPD.IHTTPSession) -> NanoHTTPD.Response,
        val handleHttpRpc: (NanoHTTPD.IHTTPSession) -> NanoHTTPD.Response,
        val handleShare: (String, NanoHTTPD.IHTTPSession) -> NanoHTTPD.Response?,
        val handlePersonalInvite: (NanoHTTPD.IHTTPSession, String) -> NanoHTTPD.Response?,
        val serveCachedCard: (String) -> NanoHTTPD.Response,
        val rejectIfBodyTooLarge: (NanoHTTPD.IHTTPSession) -> NanoHTTPD.Response?,
        val servePublicAsset: (NanoHTTPD.IHTTPSession, String) -> NanoHTTPD.Response,
    )

    fun serve(session: NanoHTTPD.IHTTPSession): NanoHTTPD.Response {
        if (transport.isWebsocketRequested(session)) return transport.serveWebsocket(session)
        val path = session.uri.split("?")[0]

        fun cors(r: NanoHTTPD.Response): NanoHTTPD.Response = HttpResponsePolicy.cors(r)

        if (session.method == NanoHTTPD.Method.OPTIONS) {
            return cors(
                NanoHTTPD.newFixedLengthResponse(
                    NanoHTTPD.Response.Status.OK,
                    NanoHTTPD.MIME_PLAINTEXT,
                    "",
                ),
            )
        }

        transport.rejectIfEdgeGateFails(session)?.let { return cors(it) }

        if (path == "/ash-ok" || path == "/ash-ok/") {
            return cors(transport.jsonResponse(NanoHTTPD.Response.Status.OK, transport.publicJoinMeta(session)))
        }
        if (path == "/ash-join" || path == "/ash-join/") return cors(transport.handleHttpJoin(session))
        if (path == "/ash-login" || path == "/ash-login/") return cors(transport.handleHttpLogin(session))
        if (path == "/ash-join-wait" || path == "/ash-join-wait/") return cors(transport.handleHttpJoinWait(session))
        if (path == "/ash-auth-salt" || path == "/ash-auth-salt/") return cors(transport.handleAuthSalt(session))
        if (path == "/ash-poll" || path == "/ash-poll/") return cors(transport.handleHttpPoll(session))
        if (path == "/ash-leave" || path == "/ash-leave/") return cors(transport.handleHttpLeave(session))
        if (path == "/ash-rpc" || path == "/ash-rpc/") return cors(transport.handleHttpRpc(session))

        transport.handleShare(path, session)?.let { return cors(it) }

        transport.handlePersonalInvite(session, path)?.let { return cors(it) }

        if (path.startsWith("/card/")) {
            return transport.serveCachedCard(path.removePrefix("/card/").trim('/'))
        }

        return transport.servePublicAsset(session, path)
    }
}