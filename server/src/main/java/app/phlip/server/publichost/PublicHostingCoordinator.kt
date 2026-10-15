package app.phlip.server.publichost

import android.content.Context
import android.os.Handler
import app.phlip.server.DrServer
import app.phlip.server.HostedServer
import app.phlip.server.ServerRegistry
import app.phlip.server.publichost.cloudflare.CloudflarePrefs

/**
 * Public hosting façade: Cloudflare routes, shared tunnel, edge provision/sync.
 * Composes [PublicRouteManager], [SharedTunnelController], [EdgeProvisioner],
 * [EdgeSyncLoop] and [EdgeRelayDebouncer].
 */
class PublicHostingCoordinator(
    context: Context,
    private val registry: ServerRegistry,
    servers: MutableMap<String, DrServer>,
    mainHandler: Handler,
    private val cfPrefs: CloudflarePrefs,
    isHostingStarted: () -> Boolean,
    isLocalServing: () -> Boolean,
    onAdvertise: (HostedServer) -> Unit,
    onUnadvertise: (String) -> Unit,
    onStateChanged: () -> Unit = {},
    onServerActivity: () -> Unit = {},
    refreshEdgeGateOnServers: () -> Unit = {},
    readEdgeWorkerScript: () -> ByteArray,
) {
    private val state = PublicHostingState()

    private lateinit var routes: PublicRouteManager
    private lateinit var tunnel: SharedTunnelController
    private lateinit var sync: EdgeSyncLoop
    private lateinit var relay: EdgeRelayDebouncer
    private lateinit var provision: EdgeProvisioner

    init {
        sync = EdgeSyncLoop(
            registry = registry,
            servers = servers,
            mainHandler = mainHandler,
            cfPrefs = cfPrefs,
            isHostingStarted = isHostingStarted,
            namedHostnameFor = { hs -> routes.namedHostnameFor(hs) },
        )
        relay = EdgeRelayDebouncer(
            registry = registry,
            servers = servers,
            mainHandler = mainHandler,
            cfPrefs = cfPrefs,
            namedHostnameFor = { hs -> routes.namedHostnameFor(hs) },
        )
        tunnel = SharedTunnelController(
            context = context,
            registry = registry,
            servers = servers,
            cfPrefs = cfPrefs,
            state = state,
            namedHostnameFor = { hs -> routes.namedHostnameFor(hs) },
            onAdvertise = onAdvertise,
            onStateChanged = onStateChanged,
            onServerActivity = onServerActivity,
            startEdgePullLoop = { sync.startEdgePullLoop() },
            clearEdgePull = { sync.clear() },
        )
        routes = PublicRouteManager(
            context = context,
            registry = registry,
            servers = servers,
            mainHandler = mainHandler,
            cfPrefs = cfPrefs,
            state = state,
            isLocalServing = isLocalServing,
            onAdvertise = onAdvertise,
            onUnadvertise = onUnadvertise,
            onStateChanged = onStateChanged,
            onServerActivity = onServerActivity,
            refreshEdgeGateOnServers = refreshEdgeGateOnServers,
            readEdgeWorkerScript = readEdgeWorkerScript,
            ensureSharedTunnelRunning = { host -> tunnel.ensureSharedTunnelRunning(host) },
            stopCloudflarePublic = { tunnel.stopCloudflarePublic() },
            markAllPublicConnected = { tunnel.markAllPublicConnected() },
            startEdgePullLoop = { sync.startEdgePullLoop() },
            isHostingStarted = isHostingStarted,
        )
        provision = EdgeProvisioner(
            registry = registry,
            servers = servers,
            mainHandler = mainHandler,
            cfPrefs = cfPrefs,
            state = state,
            namedHostnameFor = { hs -> routes.namedHostnameFor(hs) },
            readEdgeWorkerScript = readEdgeWorkerScript,
            refreshEdgeGateOnServers = refreshEdgeGateOnServers,
            startEdgePullLoop = { sync.startEdgePullLoop() },
            syncWorkersPlanToEdge = { provision.syncWorkersPlanToEdge() },
            stopCloudflarePublic = { tunnel.stopCloudflarePublic() },
            ensureSharedTunnelRunning = { host -> tunnel.ensureSharedTunnelRunning(host) },
            onStateChanged = onStateChanged,
        )
        relay.startPeriodic()
    }

    fun cloudflarePrefs(): CloudflarePrefs = cfPrefs
    fun publicUrlFor(id: String): String? = state.publicUrls[id]
    fun publicErrorFor(id: String): String? = state.publicErrors[id]
    fun hasActiveProvider(): Boolean = tunnel.hasActiveProvider()

    fun stopAll() {
        relay.clear()
        sync.clear()
        tunnel.stopCloudflarePublic()
        state.publicUrls.clear()
        state.publicErrors.clear()
    }

    fun setPublic(id: String, public: Boolean): Boolean = routes.setPublic(id, public)
    fun removePublicSharing(id: String): Boolean = routes.setPublic(id, false, waitForRemoval = true)
    fun demoteAllPublic(reason: String? = null) = routes.demoteAllPublic(reason)
    fun restoreAllPublicRoutes(pubs: List<HostedServer>) = routes.restoreAllPublicRoutes(pubs)
    fun setPublicSubdomain(serverId: String, raw: String): String? = routes.setPublicSubdomain(serverId, raw)
    fun namedHostnameFor(hs: HostedServer): String = routes.namedHostnameFor(hs)
    fun onServerDeleted(hs: HostedServer?) = routes.onServerDeleted(hs)

    fun disconnectDomain(onDone: (String?) -> Unit) = routes.disconnectDomain(onDone)

    fun syncInviteToEdge(serverId: String, code: String, exp: Long) =
        sync.syncInviteToEdge(serverId, code, exp)

    fun syncPersonalInvitesToEdge(serverId: String) =
        sync.syncPersonalInvitesToEdge(serverId)

    fun syncMemberSessionBlocking(serverId: String, token: String, userId: String, oldToken: String?) =
        sync.syncMemberSessionBlocking(serverId, token, userId, oldToken)

    fun queueRelayPush(serverId: String, force: Boolean = false) =
        relay.queueRelayPush(serverId, force)

    fun setRelayCacheEnabled(enabled: Boolean) {
        cfPrefs.relayCacheEnabled = enabled
        if (enabled) {
            for (hs in registry.publicServers()) {
                relay.queueRelayPush(hs.id, force = true)
            }
            syncWorkersPlanToEdge()
        } else {
            relay.pushDisableAll()
            syncWorkersPlanToEdge()
        }
    }

    fun provisionOrRepairEdge(onDone: (String?) -> Unit) = provision.provisionOrRepairEdge(onDone)
    fun syncWorkersPlanToEdge() = provision.syncWorkersPlanToEdge()
    fun rotateTunnelToken(onDone: (String?) -> Unit) = provision.rotateTunnelToken(onDone)
}
