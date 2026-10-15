package app.phlip.server

import fi.iki.elonen.NanoWSD
import org.json.JSONObject

/**
 * Shared delivery fanout for websocket and HTTP long-poll members.
 *
 * Centralizing this keeps transport delivery behavior consistent while DrServer
 * remains the lifecycle facade.
 */
internal class DeliveryHub(
    private val wsBindings: Map<NanoWSD.WebSocket, String>,
    private val httpBindings: Map<String, HttpClient>,
    private val userByToken: (String) -> User?,
    private val enqueueHttp: (String, String) -> Unit,
) {
    fun sendToToken(token: String, msg: JSONObject) {
        val raw = msg.toString()
        for ((ws, sessionToken) in wsBindings) {
            if (sessionToken == token) {
                try { ws.send(raw) } catch (_: Exception) {}
            }
        }
        for ((sessionToken, _) in httpBindings) {
            if (sessionToken == token) enqueueHttp(token, raw)
        }
    }

    fun sendToUser(user: User, msg: JSONObject) {
        val raw = msg.toString()
        for ((ws, token) in wsBindings) {
            if (userByToken(token)?.id == user.id) {
                try { ws.send(raw) } catch (_: Exception) {}
            }
        }
        for ((token, _) in httpBindings) {
            if (userByToken(token)?.id == user.id) enqueueHttp(token, raw)
        }
    }

    fun broadcast(msg: JSONObject) {
        val raw = msg.toString()
        for ((ws, _) in wsBindings) {
            try { ws.send(raw) } catch (_: Exception) {}
        }
        for (token in httpBindings.keys) enqueueHttp(token, raw)
    }

    fun broadcastToAudience(audienceUserIds: Set<String>, msg: JSONObject) {
        val raw = msg.toString()
        for ((ws, token) in wsBindings) {
            val u = userByToken(token) ?: continue
            if (u.id in audienceUserIds) {
                try { ws.send(raw) } catch (_: Exception) {}
            }
        }
        for ((token, _) in httpBindings) {
            val u = userByToken(token) ?: continue
            if (u.id in audienceUserIds) enqueueHttp(token, raw)
        }
    }

    fun pushSyncToAll(snapshotFor: (User) -> JSONObject) {
        for ((ws, token) in wsBindings) {
            val u = userByToken(token) ?: continue
            try { ws.send(snapshotFor(u).put("type", "sync").toString()) } catch (_: Exception) {}
        }
        for ((token, _) in httpBindings) {
            val u = userByToken(token) ?: continue
            enqueueHttp(token, snapshotFor(u).put("type", "sync").toString())
        }
    }
}
