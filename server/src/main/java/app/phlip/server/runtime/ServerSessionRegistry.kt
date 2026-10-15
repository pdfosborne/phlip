package app.phlip.server

import fi.iki.elonen.NanoWSD
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/** Public clients use HTTP long-poll (Cloudflare WSS is unreliable). */
internal data class HttpClient(
    val messages: PollMessageQueue = PollMessageQueue(),
    @Volatile var lastSeen: Long = System.currentTimeMillis(),
)

/** A pending member join retained while its socket is temporarily disconnected. */
internal data class PendingEntry(
    @Volatile var ws: NanoWSD.WebSocket?,
    val name: String,
    val ts: Long,
    /** One-time nonce so Approve can wrap the group secret for password setup. */
    val setupNonce: String,
    /** Device fingerprint from the join request — remembered on Approve. */
    val fingerprint: String = "",
    /** Group-invite id that admitted this pending joiner (use already reserved). */
    val inviteId: String? = null,
    /** Channel edges to open on Approve (copied at reserve time). */
    val inviteChannelIds: List<String> = emptyList(),
    /** 016 — opaque identity (optional until client upgrades). */
    val identityId: String? = null,
    val identityPub: String? = null,
    /** Server-resolved personal-invite attribution (never trust client "via" claims). */
    val invitedByUserId: String? = null,
    val invitedByName: String? = null,
    val inviteSlug: String? = null,
)

/** Owns all in-memory connection and session state for one [DrServer]. */
internal class ServerSessionRegistry {
    /** Authenticated websocket → member token. */
    val clients = ConcurrentHashMap<NanoWSD.WebSocket, String>()

    /** Member token → HTTP long-poll session. */
    val httpClients = ConcurrentHashMap<String, HttpClient>()

    /** Session-only camera photos keyed by user id; never persisted. */
    val livePics = ConcurrentHashMap<String, String>()

    /** Request id → pending join. */
    val pending = ConcurrentHashMap<String, PendingEntry>()

    /** Lowercase member name → approval time for reconnecting joiners. */
    val preApproved = ConcurrentHashMap<String, Long>()

    /** Request id → welcome payload retained for retrying HTTP polls. */
    val readyWelcome = ConcurrentHashMap<String, JSONObject>()
    val readyWelcomeAt = ConcurrentHashMap<String, Long>()

    /** Request id → denial time. */
    val deniedIds = ConcurrentHashMap<String, Long>()

    /** Client IP → failed-attempt count and lock expiry. */
    val rateMap = ConcurrentHashMap<String, Pair<Int, Long>>()

    /** Share guest token → RPC window start and request count. */
    /** In-flight member and share long-poll holds. */
    val activePolls = AtomicInteger(0)

    fun touchHttpClient(token: String): Pair<HttpClient, Boolean> {
        var created = false
        val client = httpClients.computeIfAbsent(token) {
            created = true
            HttpClient()
        }
        client.lastSeen = System.currentTimeMillis()
        return Pair(client, created)
    }

    fun releaseHttpSession(token: String): Boolean {
        if (token.isEmpty()) return false
        return httpClients.remove(token) != null
    }

    fun pruneHttpClients(cutoffMs: Long): Boolean {
        var removed = false
        for ((token, c) in httpClients.entries.toList()) {
            if (c.lastSeen < cutoffMs) {
                httpClients.remove(token, c)
                removed = true
            }
        }
        return removed
    }
}
