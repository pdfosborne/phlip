package app.phlip.server

import com.google.gson.Gson
import fi.iki.elonen.NanoWSD
import org.json.JSONArray
import org.json.JSONObject

/**
 * WebSocket bind bookkeeping, online roster, live-pic prune/broadcast, and
 * presence ticker adjustment.
 */
internal class PresenceCoordinator(
    private val sessionRegistry: ServerSessionRegistry,
    private val scheduler: ServerScheduler,
    private val gson: Gson,
    private val userIdForToken: (String) -> String?,
    private val membersPayload: (includeLivePics: Boolean) -> JSONArray,
    private val broadcast: (JSONObject) -> Unit,
    private val onActivityChanged: () -> Unit,
) {
    private val clients get() = sessionRegistry.clients
    private val httpClients get() = sessionRegistry.httpClients
    private val livePics get() = sessionRegistry.livePics

    fun fireActivityChanged() {
        try {
            onActivityChanged()
        } catch (t: Throwable) {
            android.util.Log.w("AshPresence", "onActivityChanged failed", t)
        }
    }

    fun bindClient(ws: NanoWSD.WebSocket, token: String) {
        clients[ws] = token
        fireActivityChanged()
    }

    fun unbindClient(ws: NanoWSD.WebSocket) {
        if (clients.remove(ws) != null) fireActivityChanged()
    }

    fun startPresenceTicker() {
        scheduler.startPresenceTicker()
    }

    /** 8s while HTTP/share sessions exist; 60s when idle. */
    fun adjustPresenceTicker() {
        scheduler.adjustPresenceTicker()
    }

    fun onlineUserIds(): List<String> {
        val tokens = LinkedHashSet<String>()
        tokens.addAll(clients.values)
        tokens.addAll(httpClients.keys)
        return tokens.mapNotNull { userIdForToken(it) }
    }

    fun pruneLivePics(onlineIds: Collection<String>) {
        val online = onlineIds.toHashSet()
        for (uid in livePics.keys.toList()) {
            if (uid !in online) livePics.remove(uid)
        }
    }

    fun presence() {
        val onlineIds = onlineUserIds()
        pruneLivePics(onlineIds)
        broadcast(
            JSONObject()
                .put("type", "presence")
                .put("online", JSONArray(gson.toJson(onlineIds)))
                .put("members", membersPayload(false)),
        )
    }

    /** One member's session photo (or clear) — not a full roster re-send. */
    fun broadcastLivePic(userId: String, pic: String?) {
        val msg = JSONObject()
            .put("type", "livePic")
            .put("userId", userId)
        if (pic.isNullOrEmpty()) msg.put("livePic", JSONObject.NULL)
        else msg.put("livePic", pic)
        broadcast(msg)
    }

    fun broadcastMembers() {
        broadcast(JSONObject().put("type", "members").put("members", membersPayload(false)))
    }
}
