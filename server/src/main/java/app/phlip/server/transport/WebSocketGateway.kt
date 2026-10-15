package app.phlip.server

import fi.iki.elonen.NanoWSD
import org.json.JSONObject

/**
 * Request-focused websocket frame gateway.
 *
 * DrServer still owns lifecycle and keeps NanoWSD subclassing; this component
 * centralizes frame parsing/dispatch and close/exception teardown behavior.
 */
internal class WebSocketGateway(
    private val transport: Transport,
) {
    data class Transport(
        val resolveToken: (NanoWSD.WebSocket) -> String?,
        val resolveUser: (String) -> User?,
        val sendRaw: (NanoWSD.WebSocket, String) -> Unit,
        val handleJoin: (NanoWSD.WebSocket, String, JSONObject) -> Unit,
        val handleAuthed: (User, JSONObject) -> Boolean,
        val onDisconnect: (NanoWSD.WebSocket) -> Unit,
    )

    fun onMessage(ws: NanoWSD.WebSocket, ip: String, payload: String) {
        val m = try { JSONObject(payload) } catch (_: Exception) { return }
        val token = transport.resolveToken(ws)
        val user = token?.let { transport.resolveUser(it) }

        when (m.optString("type")) {
            "ping" -> {
                try {
                    transport.sendRaw(ws, JSONObject().put("type", "pong").toString())
                } catch (_: Exception) {}
            }

            "join" -> transport.handleJoin(ws, ip, m)

            else -> {
                if (user != null) {
                    val ok = transport.handleAuthed(user, m)
                    if (!ok) {
                        val err = when (m.optString("type")) {
                            "blockEvent" -> "Could not block this event"
                            "approveEvent" -> "Could not approve this event"
                            else -> "Command rejected"
                        }
                        try {
                            transport.sendRaw(ws, JSONObject().put("type", "error").put("error", err).toString())
                        } catch (_: Exception) {}
                    }
                }
            }
        }
    }

    fun onCloseOrException(ws: NanoWSD.WebSocket) {
        transport.onDisconnect(ws)
    }
}
