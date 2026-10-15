package app.phlip.server.publichost

import android.os.Handler
import app.phlip.server.DrServer
import app.phlip.server.HostedServer
import app.phlip.server.ServerRegistry
import app.phlip.server.publichost.cloudflare.CloudflareApi
import app.phlip.server.publichost.cloudflare.CloudflarePrefs
import app.phlip.server.publichost.cloudflare.EdgeHostClient

/** Edge Worker provision/repair, tunnel token rotate, workers-plan sync. */
internal class EdgeProvisioner(
    private val registry: ServerRegistry,
    private val servers: MutableMap<String, DrServer>,
    private val mainHandler: Handler,
    private val cfPrefs: CloudflarePrefs,
    private val state: PublicHostingState,
    private val namedHostnameFor: (HostedServer) -> String,
    private val readEdgeWorkerScript: () -> ByteArray,
    private val refreshEdgeGateOnServers: () -> Unit,
    private val startEdgePullLoop: () -> Unit,
    private val syncWorkersPlanToEdge: () -> Unit,
    private val stopCloudflarePublic: () -> Unit,
    private val ensureSharedTunnelRunning: (String) -> Unit,
    private val onStateChanged: () -> Unit,
) {
    fun provisionOrRepairEdge(onDone: (String?) -> Unit) {
        if (!cfPrefs.hasNamedTunnel()) {
            onDone("Set up Cloudflare first.")
            return
        }
        if (cfPrefs.apiToken.isBlank()) {
            onDone("Paste a Cloudflare API token with Workers + KV permissions.")
            return
        }
        Thread({
            try {
                val pubs = registry.publicServers()
                if (pubs.isEmpty()) {
                    CloudflareApi.provisionEdge(
                        cfPrefs.apiToken,
                        cfPrefs,
                        readEdgeWorkerScript(),
                        "http://127.0.0.1:1",
                        emptyList(),
                    )
                    mainHandler.post {
                        cfPrefs.edgeEnforce = false
                        refreshEdgeGateOnServers()
                        onDone(null)
                    }
                    return@Thread
                }
                val hosts = pubs.map { namedHostnameFor(it) }.filter { it.isNotEmpty() }
                val first = pubs.first()
                CloudflareApi.provisionEdge(
                    cfPrefs.apiToken,
                    cfPrefs,
                    readEdgeWorkerScript(),
                    "http://127.0.0.1:${first.port}",
                    hosts,
                )
                for (hs in pubs) {
                    val host = namedHostnameFor(hs)
                    if (host.isEmpty()) continue
                    val local = "http://127.0.0.1:${hs.port}"
                    val originHost = CloudflareApi.ensureOriginHostname(
                        cfPrefs.apiToken,
                        cfPrefs,
                        host,
                        local,
                    )
                    EdgeHostClient.syncOrigin(cfPrefs, host, "https://$originHost")
                    CloudflareApi.ensureWorkerRoute(cfPrefs.apiToken, cfPrefs.zoneId, host)
                    val srv = servers[hs.id]
                    srv?.let {
                        val slugs = it.activeInviteSlugs()
                        EdgeHostClient.syncPersonalInvites(cfPrefs, host, slugs, it.hostDisplayNameForEdge())
                    }
                    EdgeHostClient.syncWorkersPlan(cfPrefs, host)
                }
                mainHandler.post {
                    cfPrefs.edgeEnforce = true
                    refreshEdgeGateOnServers()
                    startEdgePullLoop()
                    syncWorkersPlanToEdge()
                    onDone(null)
                }
            } catch (t: Throwable) {
                android.util.Log.e("AshCloudflare", "edge repair failed", t)
                mainHandler.post {
                    onDone(CloudflareApi.describeFailure(t))
                }
            }
        }, "ash-edge-provision").apply { isDaemon = true }.start()
    }

    fun syncWorkersPlanToEdge() {
        if (!cfPrefs.edgeProvisioned) return
        Thread({
            for (hs in registry.publicServers()) {
                val host = namedHostnameFor(hs)
                if (host.isEmpty()) continue
                try {
                    val r = EdgeHostClient.syncWorkersPlan(cfPrefs, host)
                    val kv = r.body?.optJSONObject("kv")
                    if (kv != null) servers[hs.id]?.applyEdgeKvStats(kv)
                } catch (t: Throwable) {
                    android.util.Log.w("AshEdge", "workers plan sync failed", t)
                }
            }
        }, "ash-edge-plan").apply { isDaemon = true }.start()
    }

    fun rotateTunnelToken(onDone: (String?) -> Unit) {
        if (!cfPrefs.hasNamedTunnel()) {
            onDone("Set up Cloudflare first.")
            return
        }
        if (cfPrefs.apiToken.isBlank()) {
            onDone("Paste a Cloudflare API token (Edit domain) before rotating.")
            return
        }
        Thread({
            try {
                val routes = registry.publicServers().mapNotNull { hs ->
                    val host = namedHostnameFor(hs)
                    if (host.isEmpty()) null else host to "http://127.0.0.1:${hs.port}"
                }
                CloudflareApi.rotateNamedTunnel(cfPrefs.apiToken, cfPrefs, routes)
                if (cfPrefs.edgeProvisioned) {
                    try {
                        val hosts = routes.map { it.first }
                        val local = routes.firstOrNull()?.second ?: "http://127.0.0.1:1"
                        CloudflareApi.provisionEdge(cfPrefs.apiToken, cfPrefs, readEdgeWorkerScript(), local, hosts)
                        for ((host, localHttp) in routes) {
                            val originHost = CloudflareApi.ensureOriginHostname(
                                cfPrefs.apiToken,
                                cfPrefs,
                                host,
                                localHttp,
                            )
                            EdgeHostClient.syncOrigin(cfPrefs, host, "https://$originHost")
                            CloudflareApi.ensureWorkerRoute(cfPrefs.apiToken, cfPrefs.zoneId, host)
                        }
                    } catch (t: Throwable) {
                        android.util.Log.e("AshCloudflare", "edge repair after rotate failed", t)
                    }
                }
                mainHandler.post {
                    try {
                        val needTunnel = registry.publicServers().isNotEmpty()
                        stopCloudflarePublic()
                        if (needTunnel) {
                            ensureSharedTunnelRunning(
                                registry.publicServers().firstOrNull()?.let { namedHostnameFor(it) }.orEmpty(),
                            )
                            for (hs in registry.publicServers()) {
                                val host = namedHostnameFor(hs)
                                if (host.isNotEmpty()) state.publicUrls[hs.id] = "https://$host"
                                servers[hs.id]?.let {
                                    EdgeHostClient.syncPersonalInvites(
                                        cfPrefs,
                                        host,
                                        it.activeInviteSlugs(),
                                        it.hostDisplayNameForEdge(),
                                    )
                                }
                            }
                            if (cfPrefs.edgeProvisioned) {
                                cfPrefs.edgeEnforce = true
                                refreshEdgeGateOnServers()
                                startEdgePullLoop()
                            }
                        }
                        onStateChanged()
                        onDone(null)
                    } catch (t: Throwable) {
                        android.util.Log.e("AshCloudflare", "tunnel restart after rotate failed", t)
                        onDone(CloudflareApi.describeFailure(t))
                    }
                }
            } catch (t: Throwable) {
                android.util.Log.e("AshCloudflare", "rotate tunnel failed", t)
                mainHandler.post {
                    onDone(CloudflareApi.describeFailure(t))
                }
            }
        }, "ash-cf-rotate").apply { isDaemon = true }.start()
    }
}
