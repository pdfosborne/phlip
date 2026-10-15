package app.phlip.server

import fi.iki.elonen.NanoHTTPD
import org.json.JSONObject

/**
 * Explicit member leave (`/ash-leave`) — mark offline immediately.
 * Wired behind [HttpGateway]; [DrServer] stays the NanoWSD façade.
 */
internal class HttpLeaveHandler(
    private val transport: Transport,
    private val operations: Operations,
) {
    internal data class Transport(
        val jsonResponse: (NanoHTTPD.Response.Status, JSONObject) -> NanoHTTPD.Response,
        val requestToken: (NanoHTTPD.IHTTPSession) -> String,
        val readJsonBody: (NanoHTTPD.IHTTPSession) -> JSONObject?,
    )

    internal data class Operations(
        val releaseHttpSession: (String) -> Unit,
    )

    fun handle(session: NanoHTTPD.IHTTPSession): NanoHTTPD.Response {
        var token = transport.requestToken(session)
        if (token.isEmpty() && session.method == NanoHTTPD.Method.POST) {
            val body = transport.readJsonBody(session)
            token = body?.optString("token")?.trim().orEmpty()
        }
        operations.releaseHttpSession(token)
        return transport.jsonResponse(
            NanoHTTPD.Response.Status.OK,
            JSONObject().put("type", "ok"),
        )
    }
}
