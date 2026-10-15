package app.phlip.server.publichost

import android.os.Handler
import app.phlip.server.DrServer
import app.phlip.server.HostedServer
import app.phlip.server.ServerRegistry
import app.phlip.server.publichost.cloudflare.CloudflarePrefs
import app.phlip.server.publichost.cloudflare.EdgeHostClient
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Invite / member-session push and edge inbox pull loop. */
internal class EdgeSyncLoop(
    private val registry: ServerRegistry,
    private val servers: MutableMap<String, DrServer>,
    private val mainHandler: Handler,
    private val cfPrefs: CloudflarePrefs,
    private val isHostingStarted: () -> Boolean,
    private val namedHostnameFor: (HostedServer) -> String,
) {
    private val edgePullSince = ConcurrentHashMap<String, Long>()
    private val lastSlugSyncSig = ConcurrentHashMap<String, String>()
    private var edgePullTick: Runnable? = null

    fun clear() {
        edgePullTick?.let { mainHandler.removeCallbacks(it) }
        edgePullTick = null
        edgePullSince.clear()
        lastSlugSyncSig.clear()
    }

    /**
     * Personal-invite slug sync (and plan). Rotating join-code hashes are no longer published.
     */
    fun syncInviteToEdge(serverId: String, code: String, exp: Long) {
        val hs = registry.get(serverId) ?: return
        if (!hs.isPublic || !cfPrefs.edgeProvisioned) return
        val host = namedHostnameFor(hs)
        if (host.isEmpty()) return
        Thread({
            try {
                syncPersonalInvitesBlocking(hs.id, host, force = true)
                EdgeHostClient.syncWorkersPlan(cfPrefs, host)
            } catch (t: Throwable) {
                android.util.Log.w("AshEdge", "invite sync failed", t)
            }
        }, "ash-edge-invite").apply { isDaemon = true }.start()
    }

    /** Publish all member personal invite slugs to the Worker allowlist. */
    fun syncPersonalInvitesToEdge(serverId: String) {
        val hs = registry.get(serverId) ?: return
        if (!hs.isPublic || !cfPrefs.edgeProvisioned) return
        val host = namedHostnameFor(hs)
        if (host.isEmpty()) return
        Thread({
            try {
                syncPersonalInvitesBlocking(serverId, host, force = true)
            } catch (t: Throwable) {
                android.util.Log.w("AshEdge", "personal invite sync failed", t)
            }
        }, "ash-edge-slugs").apply { isDaemon = true }.start()
    }

    private fun syncPersonalInvitesBlocking(serverId: String, host: String, force: Boolean = false) {
        val srv = servers[serverId] ?: return
        val slugs = srv.activeInviteSlugs()
        val display = srv.hostDisplayNameForEdge()
        val sig = "$display|${slugs.sorted().joinToString(",")}"
        if (!force && lastSlugSyncSig[serverId] == sig) return
        if (EdgeHostClient.syncPersonalInvites(cfPrefs, host, slugs, display)) {
            lastSlugSyncSig[serverId] = sig
        }
    }

    fun syncMemberSessionBlocking(serverId: String, token: String, userId: String, oldToken: String?) {
        val hs = registry.get(serverId) ?: return
        val done = CountDownLatch(1)
        Thread({
            try {
                val host = namedHostnameFor(hs)
                if (host.isNotEmpty() && cfPrefs.edgeProvisioned) {
                    val ok = EdgeHostClient.syncMemberSession(cfPrefs, host, token, userId, oldToken)
                    if (!ok) {
                        android.util.Log.w("AshEdge", "member session sync returned false for $host")
                    }
                }
            } catch (t: Throwable) {
                android.util.Log.w("AshEdge", "member session sync failed", t)
            } finally {
                done.countDown()
            }
        }, "ash-edge-member").apply { isDaemon = true }.start()
        try {
            if (!done.await(20, TimeUnit.SECONDS)) {
                android.util.Log.w("AshEdge", "member session sync timed out")
            }
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        }
    }

    fun startEdgePullLoop() {
        edgePullTick?.let { mainHandler.removeCallbacks(it) }
        val tick = object : Runnable {
            override fun run() {
                if (!isHostingStarted() || !cfPrefs.edgeProvisioned) return
                Thread({ pullEdgeInboxes() }, "ash-edge-pull").apply { isDaemon = true }.start()
                mainHandler.postDelayed(this, 8_000L)
            }
        }
        edgePullTick = tick
        mainHandler.postDelayed(tick, 4_000L)
    }

    private fun pullEdgeInboxes() {
        for (hs in registry.publicServers()) {
            val host = namedHostnameFor(hs)
            if (host.isEmpty()) continue
            val srv = servers[hs.id] ?: continue
            try {
                syncPersonalInvitesBlocking(hs.id, host, force = false)
            } catch (_: Exception) {
            }
            pullQueuedJoinRequests(hs.id, host, srv)
            val since = edgePullSince[hs.id] ?: 0L
            val result = try {
                EdgeHostClient.pullInbox(cfPrefs, host, since)
            } catch (_: Exception) {
                continue
            }
            if (!result.ok) continue
            val root = result.body ?: continue
            root.optJSONObject("kv")?.let { srv.applyEdgeKvStats(it) }
        }
    }

    private fun pullQueuedJoinRequests(serverId: String, host: String, srv: DrServer) {
        val result = try {
            EdgeHostClient.pullJoinRequests(cfPrefs, host)
        } catch (_: Exception) {
            return
        }
        if (!result.ok) return
        val root = result.body ?: return
        val requests = root.optJSONArray("requests") ?: return
        for (i in 0 until requests.length()) {
            val req = requests.optJSONObject(i) ?: continue
            try {
                srv.ingestEdgeJoinRequest(req)
            } catch (t: Throwable) {
                android.util.Log.w("AshEdge", "ingest join request failed", t)
            }
        }
    }
}
