package app.phlip.server

import fi.iki.elonen.NanoHTTPD
import org.json.JSONArray
import org.json.JSONObject

/**
 * Member long-poll (`/ash-poll`). Session token is enough.
 * Wired behind [HttpGateway]; [DrServer] stays the NanoWSD façade.
 */
internal class HttpPollHandler(
    private val transport: Transport,
    private val operations: Operations,
) {
    internal data class Transport(
        val jsonResponse: (NanoHTTPD.Response.Status, JSONObject) -> NanoHTTPD.Response,
        val requestToken: (NanoHTTPD.IHTTPSession) -> String,
        val noteReject: (String, String, String) -> Unit,
    )

    internal data class Operations(
        val pruneHttpClients: () -> Unit,
        val isMemberToken: (String) -> Boolean,
        val releaseHttpSession: (String) -> Unit,
        val tryBeginPoll: () -> Boolean,
        val endPoll: () -> Unit,
        val touchHttpClient: (String) -> HttpClient,
        val drainHttp: (HttpClient) -> JSONArray,
    )

    /** GET ?token= (or X-Ash-Token) — long-poll up to ~25s. */
    fun handle(session: NanoHTTPD.IHTTPSession): NanoHTTPD.Response {
        operations.pruneHttpClients()
        val token = transport.requestToken(session)
        if (token.isEmpty() || !operations.isMemberToken(token)) {
            operations.releaseHttpSession(token)
            // Membership gone (removed / left) — client should drop this server.
            return transport.jsonResponse(
                NanoHTTPD.Response.Status.FORBIDDEN,
                JSONObject().put("type", "kicked").put("error", "Removed from this server"),
            )
        }
        if (!operations.tryBeginPoll()) {
            transport.noteReject("/ash-poll", "poll_cap", "concurrent long-polls")
            return transport.jsonResponse(
                NanoHTTPD.Response.Status.OK,
                JSONObject().put("type", "error").put("error", "Host is busy — try again in a moment."),
            )
        }
        try {
            val client = operations.touchHttpClient(token)
            val deadline = System.currentTimeMillis() + 25_000L
            var messages = operations.drainHttp(client)
            while (messages.length() == 0 && System.currentTimeMillis() < deadline) {
                // Do NOT refresh lastSeen here — a disconnected client would stay
                // "online" for the whole hold. lastSeen is set when the poll starts
                // (touchHttpClient) and again only when we actually deliver traffic.
                val waitMs = (deadline - System.currentTimeMillis()).coerceAtMost(5_000L).coerceAtLeast(50L)
                client.messages.awaitMessages(waitMs)
                messages = operations.drainHttp(client)
            }
            if (messages.length() > 0) client.lastSeen = System.currentTimeMillis()
            return transport.jsonResponse(
                NanoHTTPD.Response.Status.OK,
                JSONObject().put("type", "poll").put("messages", messages),
            )
        } finally {
            operations.endPoll()
        }
    }
}
