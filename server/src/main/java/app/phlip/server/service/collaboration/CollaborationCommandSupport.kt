package app.phlip.server

import com.google.gson.Gson
import org.json.JSONArray

/**
 * Shared state, operations, and helpers for collaboration content-type handlers.
 *
 * Persistence: almost all fields live in sealed host `AppState` (`data_*.json` via
 * [CollaborationCommandService.Operations.save]). Session live pics are RAM-only
 * ([livePics]) and are never written to disk.
 *
 * Transport: handlers mutate state then call [operations] for fanout — typically
 * [CollaborationCommandService.Operations.broadcastToChannel],
 * [CollaborationCommandService.Operations.pushSyncToAll],
 * [CollaborationCommandService.Operations.broadcast],
 * [CollaborationCommandService.Operations.broadcastLivePic], or
 * [CollaborationCommandService.Operations.presence]. Ingress is member RPC
 * (`type` string) over WebSocket or `POST /ash-rpc`.
 */
internal class CollaborationCommandSupport(
    private val stateProvider: () -> AppState,
    val gson: Gson,
    val livePics: MutableMap<String, String>,
    val authorization: ServerAuthorization,
    val idGenerator: () -> String,
    val uniqueTypeId: (String, List<EventType>) -> String,
    val operations: CollaborationCommandService.Operations,
) {
    val state: AppState get() = stateProvider()

    fun jsonStringList(array: JSONArray?): MutableList<String>? {
        if (array == null) return null
        val out = ArrayList<String>(array.length())
        for (i in 0 until array.length()) {
            val value = array.opt(i) ?: continue
            when (value) {
                is String -> out.add(value)
                is Number, is Boolean -> out.add(value.toString())
                else -> continue
            }
        }
        return out
    }
}
