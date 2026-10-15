package app.phlip.server.publichost

import android.os.Handler
import app.phlip.server.DrServer
import app.phlip.server.HostedServer
import app.phlip.server.ServerRegistry
import app.phlip.server.publichost.cloudflare.CloudflarePrefs
import app.phlip.server.publichost.cloudflare.EdgeHostClient
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Debounced push of encrypted welcome snapshots to Worker KV (`/edge/host/relay`).
 * ~55s debounce; skips when relay is off, edge missing, or KV meter limited.
 */
internal class EdgeRelayDebouncer(
    private val registry: ServerRegistry,
    private val servers: MutableMap<String, DrServer>,
    private val mainHandler: Handler,
    private val cfPrefs: CloudflarePrefs,
    private val namedHostnameFor: (HostedServer) -> String,
) {
    private val pending = ConcurrentHashMap<String, Runnable>()
    private val lastPushAt = ConcurrentHashMap<String, Long>()
    private val lastFp = ConcurrentHashMap<String, String>()
    private val kvLimitedLogged = AtomicBoolean(false)
    private var periodicTick: Runnable? = null

    fun clear() {
        for (run in pending.values.toList()) mainHandler.removeCallbacks(run)
        pending.clear()
        lastPushAt.clear()
        lastFp.clear()
        periodicTick?.let { mainHandler.removeCallbacks(it) }
        periodicTick = null
    }

    fun startPeriodic() {
        periodicTick?.let { mainHandler.removeCallbacks(it) }
        val tick = object : Runnable {
            override fun run() {
                if (!cfPrefs.relayCacheEnabled || !cfPrefs.edgeProvisioned) {
                    mainHandler.postDelayed(this, 60_000L)
                    return
                }
                for (hs in registry.publicServers()) {
                    queueRelayPush(hs.id, force = false)
                }
                mainHandler.postDelayed(this, 60_000L)
            }
        }
        periodicTick = tick
        mainHandler.postDelayed(tick, 45_000L)
    }

    fun queueRelayPush(serverId: String, force: Boolean = false) {
        if (!cfPrefs.relayCacheEnabled || !cfPrefs.edgeProvisioned) return
        val hs = registry.get(serverId) ?: return
        if (!hs.isPublic) return
        pending.remove(serverId)?.let { mainHandler.removeCallbacks(it) }
        val run = Runnable {
            pending.remove(serverId)
            Thread({
                try {
                    pushNow(serverId, force)
                } catch (t: Throwable) {
                    android.util.Log.w("AshEdge", "relay push failed", t)
                }
            }, "ash-edge-relay").apply { isDaemon = true }.start()
        }
        pending[serverId] = run
        val last = lastPushAt[serverId] ?: 0L
        val wait = if (force) 0L else (55_000L - (System.currentTimeMillis() - last)).coerceAtLeast(0L)
        if (wait == 0L) {
            lastPushAt[serverId] = System.currentTimeMillis()
            mainHandler.post(run)
        } else {
            mainHandler.postDelayed(run, wait)
        }
    }

    fun pushDisableAll() {
        Thread({
            try {
                for (hs in registry.publicServers()) {
                    val host = namedHostnameFor(hs)
                    if (host.isEmpty()) continue
                    EdgeHostClient.pushRelaySnapshot(
                        prefs = cfPrefs,
                        publicHostname = host,
                        seq = cfPrefs.relaySeqFor(host),
                        sealed = null,
                        enabled = false,
                    )
                }
            } catch (t: Throwable) {
                android.util.Log.w("AshEdge", "relay disable failed", t)
            }
        }, "ash-edge-relay-off").apply { isDaemon = true }.start()
    }

    private fun pushNow(serverId: String, force: Boolean) {
        if (!cfPrefs.relayCacheEnabled || !cfPrefs.edgeProvisioned) return
        val hs = registry.get(serverId) ?: return
        if (!hs.isPublic) return
        val host = namedHostnameFor(hs)
        if (host.isEmpty()) return
        val srv = servers[serverId] ?: return
        val sealed = srv.sealedRelaySnapshot() ?: return
        if (!force && lastFp[serverId] == sealed) return
        lastPushAt[serverId] = System.currentTimeMillis()
        val seq = cfPrefs.bumpRelaySeq(host)
        var result = EdgeHostClient.pushRelaySnapshot(cfPrefs, host, seq, sealed, enabled = true)
        if (!result.ok) {
            try {
                Thread.sleep(700)
            } catch (_: InterruptedException) {
            }
            result = EdgeHostClient.pushRelaySnapshot(cfPrefs, host, seq, sealed, enabled = true)
        }
        if (result.ok) {
            lastFp[serverId] = sealed
            result.body?.optJSONObject("kv")?.let { srv.applyEdgeKvStats(it) }
            kvLimitedLogged.set(false)
        } else {
            val err = result.errorMessage
            if (result.httpCode == 503 || err.contains("KV write limit", ignoreCase = true)) {
                if (kvLimitedLogged.compareAndSet(false, true)) {
                    android.util.Log.w("AshEdge", "relay push skipped — KV limited: $err")
                }
            } else {
                android.util.Log.w("AshEdge", "relay push failed for $host: $err")
            }
        }
    }
}
