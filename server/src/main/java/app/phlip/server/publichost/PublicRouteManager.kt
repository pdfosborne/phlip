package app.phlip.server.publichost

import android.content.Context
import android.os.Handler
import app.phlip.core.tunnel.PublicAccessState
import app.phlip.server.DrServer
import app.phlip.server.publichost.HostPublicGate
import app.phlip.server.HostedServer
import app.phlip.server.ServerRegistry
import app.phlip.server.publichost.cloudflare.CloudflareApi
import app.phlip.server.publichost.cloudflare.CloudflarePrefs
import app.phlip.server.publichost.cloudflare.EdgeHostClient

/** Public flag, DNS/ingress routes, subdomain, URL/error maps. */
internal class PublicRouteManager(
    private val context: Context,
    private val registry: ServerRegistry,
    private val servers: MutableMap<String, DrServer>,
    private val mainHandler: Handler,
    private val cfPrefs: CloudflarePrefs,
    private val state: PublicHostingState,
    private val isLocalServing: () -> Boolean,
    private val onAdvertise: (HostedServer) -> Unit,
    private val onUnadvertise: (String) -> Unit,
    private val onStateChanged: () -> Unit,
    private val onServerActivity: () -> Unit,
    private val refreshEdgeGateOnServers: () -> Unit,
    private val readEdgeWorkerScript: () -> ByteArray,
    private val ensureSharedTunnelRunning: (String) -> Unit,
    private val stopCloudflarePublic: () -> Unit,
    private val markAllPublicConnected: () -> Unit,
    private val startEdgePullLoop: () -> Unit,
    private val isHostingStarted: () -> Boolean,
) {
    fun namedHostnameFor(hs: HostedServer): String =
        if (cfPrefs.hasNamedTunnel()) cfPrefs.hostnameFor(hs.name, hs.joinTag, hs.publicSubdomain)
        else ""

    fun setPublic(id: String, public: Boolean, waitForRemoval: Boolean = false): Boolean {
        val current = registry.get(id) ?: return false
        if (!public && waitForRemoval && current.isPublic) {
            try {
                if (cfPrefs.apiToken.isBlank() || cfPrefs.accountId.isBlank() || cfPrefs.zoneId.isBlank() || cfPrefs.tunnelId.isBlank()) {
                    error("Remove the manually configured Internet route before returning to device only")
                }
                removeNamedPublicRoute(namedHostnameFor(current))
            } catch (t: Throwable) {
                state.publicErrors[id] = "Could not remove Internet sharing: ${CloudflareApi.describeFailure(t)}"
                onStateChanged()
                return false
            }
        }
        if (public) {
            if (!isLocalServing()) {
                state.publicErrors[id] = "Approve this network before going Public."
                onStateChanged()
                return false
            }
            val block = HostPublicGate.blockReason(context, cfPrefs)
            if (block != null) {
                state.publicErrors[id] = block
                onStateChanged()
                return false
            }
        }
        registry.setPublic(id, public)
        if (public) {
            onUnadvertise(id)
            registry.get(id)?.let { startCloudflarePublic(it) }
        } else {
            state.publicErrors.remove(id)
            registry.get(id)?.let { stopCloudflarePublicFor(it, removeRoute = !waitForRemoval) }
            registry.get(id)?.let { if (servers.containsKey(it.id)) onAdvertise(it) }
        }
        onServerActivity()
        onStateChanged()
        return true
    }

    fun demoteAllPublic(reason: String? = null) {
        val pubs = registry.publicServers().map { it.id }
        if (pubs.isEmpty()) return
        for (id in pubs) {
            if (reason != null) state.publicErrors[id] = reason
            setPublic(id, false)
        }
    }

    fun restoreAllPublicRoutes(pubs: List<HostedServer>) {
        Thread({
            for (hs in pubs) {
                if (!isHostingStarted()) return@Thread
                try {
                    val hostname = namedHostnameFor(hs)
                    ensureNamedPublicRoute(hs, hostname, "http://127.0.0.1:${hs.port}")
                } catch (t: Throwable) {
                    android.util.Log.e("AshCloudflare", "restore route failed for ${hs.id}", t)
                    state.publicErrors[hs.id] = CloudflareApi.describeFailure(t)
                }
            }
            mainHandler.post {
                if (!isHostingStarted()) return@post
                val still = registry.publicServers()
                if (still.isEmpty()) {
                    onStateChanged()
                    return@post
                }
                ensureSharedTunnelRunning(namedHostnameFor(still.first()))
                onStateChanged()
            }
        }, "ash-cf-restore").apply { isDaemon = true }.start()
    }

    fun setPublicSubdomain(serverId: String, raw: String): String? {
        if (!cfPrefs.hasNamedTunnel()) return "Set up a Cloudflare domain and API token first."
        val hs = registry.get(serverId) ?: return "Server not found."
        val trimmed = raw.trim()
        val nextCustom = if (trimmed.isEmpty()) {
            ""
        } else {
            val label = CloudflarePrefs.normalizeSubdomainInput(trimmed)
            if (label.isEmpty()) {
                return "Use letters, numbers, and hyphens only (e.g. home or family-chat)."
            }
            val derived = CloudflarePrefs.subdomainLabel(hs.name, hs.joinTag)
            if (label == derived) "" else label
        }
        val nextHost = cfPrefs.hostnameFor(hs.name, hs.joinTag, nextCustom)
        val nextLabel = nextHost.substringBefore('.', missingDelimiterValue = nextHost)
        for (other in registry.all()) {
            if (other.id == serverId) continue
            val otherHost = namedHostnameFor(other)
            val otherLabel = otherHost.substringBefore('.', missingDelimiterValue = otherHost)
            if (otherLabel.equals(nextLabel, ignoreCase = true)) {
                return "“$nextLabel” is already used by “${other.name}”."
            }
        }
        val oldHost = namedHostnameFor(hs)
        if (hs.publicSubdomain == nextCustom && oldHost.equals(nextHost, ignoreCase = true)) {
            return null
        }
        hs.publicSubdomain = nextCustom
        registry.save()
        if (hs.isPublic) {
            state.publicUrls.remove(hs.id)
            state.publicErrors.remove(hs.id)
            Thread({
                try {
                    val localHttp = "http://127.0.0.1:${hs.port}"
                    ensureNamedPublicRoute(hs, nextHost, localHttp)
                    if (oldHost.isNotBlank() && !oldHost.equals(nextHost, ignoreCase = true)) {
                        removeNamedPublicRoute(oldHost)
                    }
                    if (registry.get(hs.id)?.isPublic != true) return@Thread
                    mainHandler.post {
                        if (registry.get(hs.id)?.isPublic == true) {
                            ensureSharedTunnelRunning(nextHost)
                            if (state.publicProvider?.status()?.state == PublicAccessState.CONNECTED) {
                                state.publicUrls[hs.id] = "https://$nextHost"
                                state.publicErrors.remove(hs.id)
                            }
                            onStateChanged()
                        } else {
                            onStateChanged()
                        }
                    }
                } catch (t: Throwable) {
                    android.util.Log.e("AshCloudflare", "subdomain rename failed", t)
                    state.publicErrors[hs.id] = CloudflareApi.describeFailure(t)
                    onStateChanged()
                }
            }, "ash-cf-rename").apply { isDaemon = true }.start()
            onStateChanged()
        } else {
            onStateChanged()
        }
        return null
    }

    fun onServerDeleted(hs: HostedServer?) {
        if (hs == null) return
        val hostname = namedHostnameFor(hs)
        state.publicUrls.remove(hs.id)
        state.publicErrors.remove(hs.id)
        // Always try CF teardown when we still have credentials — even if Public was
        // already demoted (prior async remove may have raced with clearSecrets).
        if (hostname.isNotEmpty() &&
            cfPrefs.apiToken.isNotBlank() &&
            cfPrefs.accountId.isNotBlank() &&
            cfPrefs.zoneId.isNotBlank() &&
            cfPrefs.tunnelId.isNotBlank()
        ) {
            Thread({ removeNamedPublicRoute(hostname) }, "ash-cf-rm").apply { isDaemon = true }.start()
        }
        if (registry.publicServers().isEmpty()) stopCloudflarePublic()
        else markAllPublicConnected()
        onServerActivity()
    }

    private fun startCloudflarePublic(hs: HostedServer) {
        state.publicErrors.remove(hs.id)
        state.publicUrls.remove(hs.id)
        onServerActivity()
        if (!cfPrefs.hasNamedTunnel()) {
            state.publicErrors[hs.id] = "Set up a Cloudflare domain and API token before going Public."
            registry.setPublic(hs.id, false)
            if (servers.containsKey(hs.id)) onAdvertise(hs)
            onStateChanged()
            return
        }
        val localAddr = "127.0.0.1:${hs.port}"
        val hostname = namedHostnameFor(hs)
        Thread({
            try {
                ensureNamedPublicRoute(hs, hostname, "http://$localAddr")
                if (registry.get(hs.id)?.isPublic != true) return@Thread
                mainHandler.post {
                    if (registry.get(hs.id)?.isPublic != true) return@post
                    ensureSharedTunnelRunning(hostname)
                    if (state.publicProvider?.status()?.state == PublicAccessState.CONNECTED) {
                        state.publicUrls[hs.id] = "https://$hostname"
                        state.publicErrors.remove(hs.id)
                        onStateChanged()
                        onServerActivity()
                    }
                }
            } catch (t: Throwable) {
                android.util.Log.e("AshCloudflare", "named route failed", t)
                state.publicErrors[hs.id] = CloudflareApi.describeFailure(t)
                state.publicUrls.remove(hs.id)
                onStateChanged()
            }
        }, "ash-cf-pub-${hs.id}").apply { isDaemon = true }.start()
    }

    private fun stopCloudflarePublicFor(hs: HostedServer, removeRoute: Boolean = true) {
        val hostname = namedHostnameFor(hs)
        state.publicUrls.remove(hs.id)
        if (removeRoute && hostname.isNotEmpty()) {
            Thread({
                try {
                    removeNamedPublicRoute(hostname)
                } catch (t: Throwable) {
                    android.util.Log.e("AshCloudflare", "remove route failed", t)
                }
            }, "ash-cf-rm-${hs.id}").apply { isDaemon = true }.start()
        }
        if (registry.publicServers().isEmpty()) {
            stopCloudflarePublic()
        }
        onServerActivity()
    }

    fun ensureNamedPublicRoute(hs: HostedServer, hostname: String, localHttpUrl: String) {
        val api = cfPrefs.apiToken
        if (api.isBlank() || cfPrefs.accountId.isBlank() || cfPrefs.zoneId.isBlank() || cfPrefs.tunnelId.isBlank()) {
            android.util.Log.i("AshCloudflare", "Skipping API route publish (manual token mode)")
            return
        }
        CloudflareApi.publishHostname(
            apiToken = api,
            accountId = cfPrefs.accountId,
            zoneId = cfPrefs.zoneId,
            tunnelId = cfPrefs.tunnelId,
            hostname = hostname,
            localHttpUrl = localHttpUrl,
        )
        try {
            val originHost = CloudflareApi.ensureOriginHostname(api, cfPrefs, hostname, localHttpUrl)
            val originUrl = "https://$originHost"
            val hosts = registry.publicServers().map { namedHostnameFor(it) }.filter { it.isNotEmpty() }
                .ifEmpty { listOf(hostname) }
            if (!cfPrefs.edgeProvisioned) {
                CloudflareApi.provisionEdge(api, cfPrefs, readEdgeWorkerScript(), localHttpUrl, hosts)
            } else {
                try {
                    CloudflareApi.provisionEdge(api, cfPrefs, readEdgeWorkerScript(), localHttpUrl, hosts)
                } catch (t: Throwable) {
                    android.util.Log.w("AshCloudflare", "Worker refresh failed; keeping existing edge", t)
                    CloudflareApi.ensureWorkerRoute(api, cfPrefs.zoneId, hostname)
                }
            }
            EdgeHostClient.syncOrigin(cfPrefs, hostname, originUrl)
            cfPrefs.edgeEnforce = true
            refreshEdgeGateOnServers()
            servers[hs.id]?.let { srv ->
                EdgeHostClient.syncPersonalInvites(
                    cfPrefs,
                    hostname,
                    srv.activeInviteSlugs(),
                    srv.hostDisplayNameForEdge(),
                )
            }
            startEdgePullLoop()
            android.util.Log.i("AshCloudflare", "Published $hostname → $localHttpUrl (origin $originHost, edge on)")
        } catch (t: Throwable) {
            android.util.Log.e("AshCloudflare", "Edge provision skipped for $hostname", t)
            android.util.Log.i("AshCloudflare", "Published $hostname → $localHttpUrl (tunnel only)")
        }
    }

    fun removeNamedPublicRoute(hostname: String) {
        val api = cfPrefs.apiToken
        if (api.isBlank() || cfPrefs.accountId.isBlank() || cfPrefs.zoneId.isBlank() || cfPrefs.tunnelId.isBlank()) {
            return
        }
        CloudflareApi.purgePublicHostname(api, cfPrefs, hostname)
        android.util.Log.i("AshCloudflare", "Purged public hostname $hostname")
    }

    /**
     * Demote all Public servers and synchronously purge Cloudflare routes / edge KV
     * while the API token is still available. Caller clears secrets after [onDone].
     */
    fun disconnectDomain(onDone: (String?) -> Unit) {
        Thread({
            try {
                val pubs = registry.publicServers().toList()
                val hosts = pubs.map { namedHostnameFor(it) }.filter { it.isNotEmpty() }.distinct()
                for (hs in pubs) {
                    registry.setPublic(hs.id, false)
                    state.publicUrls.remove(hs.id)
                    state.publicErrors.remove(hs.id)
                    if (servers.containsKey(hs.id)) onAdvertise(hs)
                }
                for (host in hosts) {
                    try {
                        removeNamedPublicRoute(host)
                    } catch (t: Throwable) {
                        android.util.Log.e("AshCloudflare", "disconnect purge failed for $host", t)
                    }
                }
                stopCloudflarePublic()
                onServerActivity()
                mainHandler.post {
                    onStateChanged()
                    onDone(null)
                }
            } catch (t: Throwable) {
                android.util.Log.e("AshCloudflare", "disconnectDomain failed", t)
                mainHandler.post {
                    onDone(CloudflareApi.describeFailure(t))
                }
            }
        }, "ash-cf-disconnect").apply { isDaemon = true }.start()
    }
}
