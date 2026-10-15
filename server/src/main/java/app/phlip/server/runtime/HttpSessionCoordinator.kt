package app.phlip.server

import org.json.JSONArray

/**
 * HTTP long-poll session lifecycle: touch/release/queue, idle prune, and
 * pending/welcome TTL cleanup. Domain sweeps stay with [DrServer].
 */
internal class HttpSessionCoordinator(
    private val sessionRegistry: ServerSessionRegistry,
    private val onHttpSessionOpened: (token: String) -> Unit,
    private val onHttpSessionsChanged: () -> Unit,
    private val closeWebSocketsForToken: (token: String) -> Unit,
) {
    private val httpClients get() = sessionRegistry.httpClients
    private val pending get() = sessionRegistry.pending
    private val readyWelcome get() = sessionRegistry.readyWelcome
    private val readyWelcomeAt get() = sessionRegistry.readyWelcomeAt
    private val deniedIds get() = sessionRegistry.deniedIds

    fun touchHttpClient(token: String, enqueueInitialSync: Boolean = true): HttpClient {
        val (client, created) = sessionRegistry.touchHttpClient(token)
        if (created) {
            if (enqueueInitialSync) onHttpSessionOpened(token)
            onHttpSessionsChanged()
        }
        return client
    }

    fun releaseHttpSession(token: String) {
        if (sessionRegistry.releaseHttpSession(token)) {
            onHttpSessionsChanged()
        }
    }

    /** Drop any live HTTP poll / WebSocket holding this member token. */
    fun reclaimMemberSession(token: String) {
        if (token.isEmpty()) return
        releaseHttpSession(token)
        closeWebSocketsForToken(token)
    }

    fun enqueueHttp(token: String, raw: String) {
        val client = httpClients[token] ?: return
        client.messages.enqueue(raw)
    }

    fun drainHttp(client: HttpClient, max: Int = 50): JSONArray = client.messages.drain(max)

    /** Remove idle HTTP sessions. Returns true when any were dropped. */
    fun pruneIdleHttpClients(nowMs: Long = System.currentTimeMillis()): Boolean {
        val cutoff = nowMs - HTTP_PRESENCE_IDLE_MS
        val removed = sessionRegistry.pruneHttpClients(cutoff)
        if (removed) onHttpSessionsChanged()
        return removed
    }

    /** Drop join requests older than 10 minutes with no live socket. */
    fun pruneStalePending(nowMs: Long = System.currentTimeMillis()) {
        val cutoff = nowMs - 10 * 60_000L
        val stale = pending.entries.filter { it.value.ws == null && it.value.ts < cutoff }.map { it.key }
        for (key in stale) pending.remove(key)
    }

    /** Drop approved-welcome / denied markers older than 10 minutes. */
    fun pruneReadyWelcome(nowMs: Long = System.currentTimeMillis()) {
        val cutoff = nowMs - 10 * 60_000L
        for ((id, at) in readyWelcomeAt) {
            if (at < cutoff) {
                readyWelcome.remove(id)
                readyWelcomeAt.remove(id)
            }
        }
        for ((id, at) in deniedIds) {
            if (at < cutoff) deniedIds.remove(id)
        }
    }
}
