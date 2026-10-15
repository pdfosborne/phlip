package app.phlip.server

import com.google.gson.Gson
import fi.iki.elonen.NanoWSD
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/**
 * Notification persistence/delivery and moderator-only fanout.
 */
internal class ReportingCoordinator(
    private val stateProvider: () -> AppState,
    private val gson: Gson,
    private val clients: ConcurrentHashMap<NanoWSD.WebSocket, String>,
    private val httpClients: ConcurrentHashMap<String, HttpClient>,
    private val userByToken: (String) -> User?,
    private val canModerate: (User) -> Boolean,
    private val enqueueHttp: (String, String) -> Unit,
    private val save: () -> Unit,
) {
    private val state get() = stateProvider()

    /** Stores a notification and pushes it to the recipient's live sessions. */
    fun pushNotification(n: Notification) {
        val recipient = state.users.values.find { it.id == n.userId }
        if (recipient?.blockedUserIds?.contains(n.fromUserId) == true) return
        val list = state.notifications.getOrPut(n.userId) { mutableListOf() }
        list.add(n)
        if (list.size > 200) list.removeAt(0)
        save()
        val raw = JSONObject().put("type", "notification").put("notification", JSONObject(gson.toJson(n))).toString()
        for ((ws, token) in clients) {
            if (userByToken(token)?.id == n.userId) try { ws.send(raw) } catch (_: Exception) {}
        }
        for ((token, _) in httpClients) {
            if (userByToken(token)?.id == n.userId) enqueueHttp(token, raw)
        }
    }

    /** Deliver a message to every connected host/admin/moderator. */
    fun broadcastToModerators(msg: JSONObject) {
        val raw = msg.toString()
        for ((ws, token) in clients) {
            val user = userByToken(token) ?: continue
            if (canModerate(user)) try { ws.send(raw) } catch (_: Exception) {}
        }
        for ((token, _) in httpClients) {
            val user = userByToken(token) ?: continue
            if (canModerate(user)) enqueueHttp(token, raw)
        }
    }
}
