package app.phlip.server

import fi.iki.elonen.NanoHTTPD
import org.json.JSONArray
import org.json.JSONObject

/**
 * Member HTTP RPC (`/ash-rpc`) — same authed commands as WebSocket.
 * Wired behind [HttpGateway]; [DrServer] stays the NanoWSD façade.
 */
internal class HttpRpcHandler(
    private val transport: Transport,
    private val operations: Operations,
) {
    internal data class Transport(
        val jsonResponse: (NanoHTTPD.Response.Status, JSONObject) -> NanoHTTPD.Response,
        val rejectIfBodyTooLarge: (NanoHTTPD.IHTTPSession) -> NanoHTTPD.Response?,
        val readJsonBody: (NanoHTTPD.IHTTPSession) -> JSONObject?,
        val requestToken: (NanoHTTPD.IHTTPSession) -> String,
    )

    internal data class Operations(
        val pruneHttpClients: () -> Unit,
        val isMemberToken: (String) -> Boolean,
        val userForToken: (String) -> User?,
        val releaseHttpSession: (String) -> Unit,
        val touchHttpClient: (String) -> HttpClient,
        val touchHttpClientWithoutInitialSync: (String) -> HttpClient,
        val handleAuthedMessage: (User, JSONObject) -> Boolean,
        /** Drain pending HTTP messages; [max] should be high enough that
         *  command acks are not truncated behind a backlog (poll stays at 50). */
        val drainHttp: (HttpClient, Int) -> JSONArray,
    )

    /** POST {token, type, ...} — same authed commands as WebSocket. */
    fun handle(session: NanoHTTPD.IHTTPSession): NanoHTTPD.Response {
        if (session.method != NanoHTTPD.Method.POST) {
            return transport.jsonResponse(
                NanoHTTPD.Response.Status.METHOD_NOT_ALLOWED,
                JSONObject().put("type", "error").put("error", "POST required"),
            )
        }
        transport.rejectIfBodyTooLarge(session)?.let { return it }
        operations.pruneHttpClients()
        val body = transport.readJsonBody(session)
            ?: return transport.jsonResponse(
                NanoHTTPD.Response.Status.BAD_REQUEST,
                JSONObject().put("type", "error")
                    .put("error", "Couldn't read the request body. Try again."),
            )
        val token = body.optString("token").ifEmpty { transport.requestToken(session) }
        if (token.isEmpty() || !operations.isMemberToken(token)) {
            operations.releaseHttpSession(token)
            return transport.jsonResponse(
                NanoHTTPD.Response.Status.FORBIDDEN,
                JSONObject().put("type", "kicked").put("error", "Removed from this server"),
            )
        }
        val user = operations.userForToken(token)
            ?: return transport.jsonResponse(
                NanoHTTPD.Response.Status.FORBIDDEN,
                JSONObject().put("type", "kicked").put("error", "Removed from this server"),
            )
        val type = body.optString("type")
        // A v1 request is itself the initial state transfer, so do not queue a
        // legacy full snapshot ahead of it when this creates the HTTP session.
        val client = if (type == "syncRequest" && body.optInt("protocol") == 1) {
            operations.touchHttpClientWithoutInitialSync(token)
        } else {
            operations.touchHttpClient(token)
        }
        if (type == "ping") {
            return transport.jsonResponse(
                NanoHTTPD.Response.Status.OK,
                JSONObject().put("type", "pong").put("messages", JSONArray()),
            )
        }
        if (type == "join" || type.isEmpty()) {
            return transport.jsonResponse(
                NanoHTTPD.Response.Status.BAD_REQUEST,
                JSONObject().put("type", "error").put("error", "Use /ash-join for joining."),
            )
        }
        val m = JSONObject(body.toString())
        m.remove("token")
        m.remove("pass")
        if (!operations.handleAuthedMessage(user, m)) {
            val err = when (type) {
                "blockEvent" -> "Could not block this event"
                "approveEvent" -> "Could not approve this event"
                else -> "Command rejected"
            }
            return transport.jsonResponse(
                NanoHTTPD.Response.Status.OK,
                JSONObject().put("type", "error").put("error", err),
            )
        }
        // Poll batches at 50; RPC must return the command's own ack even when
        // demo/sync traffic already filled the queue.
        val messages = operations.drainHttp(client, 500)
        return transport.jsonResponse(
            NanoHTTPD.Response.Status.OK,
            JSONObject().put("type", "ok").put("messages", messages),
        )
    }
}
