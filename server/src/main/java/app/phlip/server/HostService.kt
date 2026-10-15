package app.phlip.server

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Binder
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import app.phlip.core.assets.AssetManagerClientAssetSource
import app.phlip.core.assets.ClientAssetSource
import app.phlip.server.hosting.HostNotifications
import app.phlip.server.hosting.HostPowerLocks
import app.phlip.server.hosting.HostStatusPublisher
import app.phlip.server.hosting.ServerBackupService
import app.phlip.server.hosting.ServerInstanceManager
import app.phlip.server.hotspot.HotspotSessionCoordinator
import app.phlip.server.hotspot.HotspotSessionInfo
import app.phlip.server.hotspot.HotspotStartResult
import app.phlip.server.local.ApprovedNetworks
import app.phlip.server.local.LocalHostingCoordinator
import app.phlip.server.publichost.HostPublicGate
import app.phlip.server.publichost.PublicHostingCoordinator
import app.phlip.server.publichost.cloudflare.CloudflarePrefs
import java.util.concurrent.ConcurrentHashMap

/** Hosts zero or more independent servers on this device. "Hosting" is a single
 *  foreground service (started explicitly from Settings); under it each server in
 *  the [ServerRegistry] runs as its own [DrServer] on its own port + data file.
 *  Public hosting uses one Cloudflare Tunnel with per-server subdomain → port
 *  ingress — several servers may be Public at once.
 *
 *  LAN exposure is gated by [ApprovedNetworks]: unknown Wi‑Fi/Ethernet suspends
 *  listening until the host approves (once or always-trust). */
class HostService : Service() {

    private lateinit var registry: ServerRegistry
    private lateinit var approvedNetworks: ApprovedNetworks
    private lateinit var localHosting: LocalHostingCoordinator
    private lateinit var publicHosting: PublicHostingCoordinator
    private lateinit var instances: ServerInstanceManager
    private lateinit var statusPublisher: HostStatusPublisher
    private lateinit var powerLocks: HostPowerLocks
    private lateinit var notifications: HostNotifications
    private lateinit var hotspotSession: HotspotSessionCoordinator
    private lateinit var backups: ServerBackupService

    private val servers = ConcurrentHashMap<String, DrServer>()
    private val pendingByServer = ConcurrentHashMap<String, List<PendingInfo>>()
    private val mainHandler = Handler(Looper.getMainLooper())
    @Volatile private var started = false

    fun addStatusListener(listener: () -> Unit) = statusPublisher.addStatusListener(listener)
    fun removeStatusListener(listener: () -> Unit) = statusPublisher.removeStatusListener(listener)

    /** @deprecated Prefer [addStatusListener] — kept so older call sites compile during edit. */
    var onStatusChanged: (() -> Unit)?
        get() = statusPublisher.onStatusChanged
        set(v) {
            statusPublisher.onStatusChanged = v
        }

    fun cloudflarePrefs(): CloudflarePrefs = publicHosting.cloudflarePrefs()
    fun approvedNetworks(): ApprovedNetworks = approvedNetworks

    fun isNetworkSuspended(): Boolean = localHosting.isNetworkSuspended()
    fun hasPendingNetwork(): Boolean = localHosting.hasPendingNetwork()
    /** LAN Broadcast minting (plaintext guest pages) — Trusted networks only. */
    fun isLanBroadcastAllowed(): Boolean = localHosting.isLanBroadcastAllowed()
    /** Nearby discovery: Trusted *or* Approve-once (listening already exposes the port). */
    fun isNsdAllowed(): Boolean = localHosting.isNsdAllowed()
    fun networkGateLabel(): String = localHosting.networkGateLabel()
    fun pendingNetworkLabel(): String = localHosting.pendingNetworkLabel()

    /** Flat list of waiting join requests across all servers (for in-app popups). */
    fun pendingJoins(): List<Pair<String, PendingInfo>> = statusPublisher.pendingJoins()

    inner class LocalBinder : Binder() {
        val service get() = this@HostService
    }

    override fun onBind(intent: Intent): IBinder = LocalBinder()

    private fun clientAssetSource(): ClientAssetSource =
        ClientAssetsHolder.get() ?: AssetManagerClientAssetSource(assets)

    override fun onCreate() {
        super.onCreate()
        instance = this
        registry = ServerRegistry(this)
        approvedNetworks = ApprovedNetworks(this)
        publicHosting = PublicHostingCoordinator(
            context = this,
            registry = registry,
            servers = servers,
            mainHandler = mainHandler,
            cfPrefs = CloudflarePrefs(this),
            isHostingStarted = { started },
            isLocalServing = { localHosting.isServing() },
            onAdvertise = { hs -> localHosting.advertise(hs) },
            onUnadvertise = { id -> localHosting.unadvertise(id) },
            onStateChanged = { publishStatus() },
            onServerActivity = { onServerActivity() },
            refreshEdgeGateOnServers = { refreshEdgeGateOnServers() },
            readEdgeWorkerScript = { assets.open("edge/phlip-edge-worker.js").use { it.readBytes() } },
        )
        localHosting = LocalHostingCoordinator(
            context = this,
            approvedNetworks = approvedNetworks,
            registry = registry,
            servers = servers,
            mainHandler = mainHandler,
            onStateChanged = { publishStatus() },
            onServerActivity = { onServerActivity() },
            publicUrlProvider = { id -> publicHosting.publicUrlFor(id) },
        )
        notifications = HostNotifications(
            context = this,
            registry = registry,
            pendingByServer = pendingByServer,
            localHosting = localHosting,
            isLiveBusy = { isLiveBusy() },
            serverCount = { servers.size },
        )
        powerLocks = HostPowerLocks(
            context = this,
            registry = registry,
            servers = servers,
            pendingByServer = pendingByServer,
            publicHosting = publicHosting,
            isStarted = { started },
        )
        hotspotSession = HotspotSessionCoordinator(
            context = this,
            registry = registry,
            mainHandler = mainHandler,
            onStateChanged = {
                val info = hotspotSession.sessionInfo()
                if (info != null) {
                    servers[info.serverId]?.setHotspotCreds(info.ssid, info.password)
                    if (info.radioLive) {
                        localHosting.enterDirectHotspotServing()
                    }
                }
                localHosting.syncAllShareReach()
                publishStatus()
            },
            inviteCodeProvider = { id ->
                servers[id]?.currentInvite()?.first?.trim().orEmpty()
            },
        )
        localHosting.directLanUrlProvider = { id ->
            hotspotSession.sessionForServer(id)?.lanUrl?.takeIf { it.isNotBlank() }
        }
        statusPublisher = HostStatusPublisher(
            registry = registry,
            servers = servers,
            pendingByServer = pendingByServer,
            localHosting = localHosting,
            publicHosting = publicHosting,
            hotspotSession = hotspotSession,
            isLanBroadcastAllowed = { isLanBroadcastAllowed() },
            namedHostnameFor = { hs -> namedHostnameFor(hs) },
            syncAllShareReach = { localHosting.syncAllShareReach() },
            notifyForeground = { notifications.notifyStatus() },
        )
        instances = ServerInstanceManager(
            context = this,
            registry = registry,
            servers = servers,
            pendingByServer = pendingByServer,
            mainHandler = mainHandler,
            localHosting = localHosting,
            publicHosting = publicHosting,
            clientAssetSource = { clientAssetSource() },
            isStarted = { started },
            publishStatus = { publishStatus() },
            onServerActivity = { onServerActivity() },
            applyEdgeGate = { srv -> applyEdgeGate(srv) },
        )
        backups = ServerBackupService(
            context = this,
            registry = registry,
            liveServers = servers,
            startInstance = { hs -> instances.startInstance(hs) },
            stopInstance = { id -> instances.stopInstance(id) },
            publishStatus = { publishStatus() },
            mintHostUser = { id, hostName -> servers[id]?.mintHostUser(hostName) },
        )
        notifications.createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_APPROVE_ONCE -> {
                if (!started) startHosting()
                approvePendingNetwork(ApprovedNetworks.Trust.ONCE)
                return START_STICKY
            }
            ACTION_ALWAYS_TRUST -> {
                if (!started) startHosting()
                approvePendingNetwork(ApprovedNetworks.Trust.TRUSTED)
                return START_STICKY
            }
            ACTION_DECLINE_NETWORK -> {
                if (started) declinePendingNetwork()
                return START_STICKY
            }
        }
        if (!started) startHosting()
        return START_STICKY
    }

    private fun startHosting() {
        started = true
        HostPublicGate.setHostingDesired(this, true)
        SecurityRejectLog.refreshEnabled(this)
        localHosting.start()
        for (hs in registry.all()) instances.startInstance(hs)
        powerLocks.updatePowerLocks()
        startForeground(notifications.notifId, notifications.buildNotification())
        val pubs = registry.publicServers()
        if (pubs.isNotEmpty() && localHosting.isServing()) {
            mainHandler.postDelayed({
                if (!started || !localHosting.isServing()) return@postDelayed
                if (!publicHosting.cloudflarePrefs().hasNamedTunnel()) {
                    for (pub in pubs) {
                        registry.setPublic(pub.id, false)
                        if (servers.containsKey(pub.id)) localHosting.advertise(pub)
                    }
                    publishStatus()
                    return@postDelayed
                }
                publicHosting.restoreAllPublicRoutes(pubs)
            }, 800)
        }
        publishStatus()
    }

    fun stopHosting() {
        hotspotSession.stop()
        localHosting.stop()
        notifications.clearNetworkSuspendNotification()
        publicHosting.stopAll()
        for (id in servers.keys.toList()) localHosting.unadvertise(id)
        for (s in servers.values) {
            s.closeAllClients()
            s.stop()
        }
        servers.clear()
        pendingByServer.clear()
        started = false
        HostPublicGate.setHostingDesired(this, false)
        powerLocks.releaseLocks()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun applyEdgeGate(srv: DrServer) {
        val cfPrefs = publicHosting.cloudflarePrefs()
        srv.setEdgeGate(cfPrefs.edgeSecret, cfPrefs.edgeEnforce, cfPrefs.domain)
    }

    fun refreshEdgeGateOnServers() {
        for (srv in servers.values) applyEdgeGate(srv)
    }

    fun ensureLanDiscovery() = localHosting.ensureLanDiscovery()

    fun createServer(
        name: String,
        hostName: String,
        public: Boolean,
        preset: String = PRESET_FRIEND,
        activity: String? = null,
    ): HostedServer? {
        if (!started) return null
        val hostPrefs = getSharedPreferences(HostPublicGate.PREFS_NAME, Context.MODE_PRIVATE)
        if (!hostPrefs.getBoolean(HostPublicGate.KEY_ALPHA_ACK, false)) return null
        val hs = registry.add(name, newGroupSecret(), reachMode = ServerRegistry.REACH_DEVICE)
        instances.startInstance(hs, initialPreset = preset, initialActivity = activity)
        servers[hs.id]?.mintHostUser(hostName)
        servers[hs.id]?.applySetupPreset(preset, activity, replaceTypes = true, replaceLocations = true)
        if (public) setPublic(hs.id, true)
        publishStatus()
        return hs
    }

    private fun newGroupSecret(): String {
        val b = ByteArray(24)
        java.security.SecureRandom().nextBytes(b)
        return android.util.Base64.encodeToString(b, android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP)
    }

    fun deleteServer(id: String) {
        val hs = registry.get(id)
        instances.stopInstance(id)
        registry.remove(id)
        publicHosting.onServerDeleted(hs)
        publishStatus()
    }

    fun wipeAllHostedData() {
        for (id in registry.all().map { it.id }) {
            try {
                deleteServer(id)
            } catch (t: Throwable) {
                android.util.Log.w("AshHost", "wipe deleteServer failed for $id", t)
            }
        }
        try {
            stopHosting()
        } catch (t: Throwable) {
            android.util.Log.w("AshHost", "wipe stopHosting failed", t)
            HostPublicGate.setHostingDesired(this, false)
        }
    }

    fun setPublic(id: String, public: Boolean): Boolean = publicHosting.setPublic(id, public)
    fun demoteAllPublic(reason: String? = null) = publicHosting.demoteAllPublic(reason)
    fun provisionOrRepairEdge(onDone: (String?) -> Unit) = publicHosting.provisionOrRepairEdge(onDone)
    fun syncWorkersPlanToEdge() = publicHosting.syncWorkersPlanToEdge()

    fun setRelayCacheEnabled(enabled: Boolean) = publicHosting.setRelayCacheEnabled(enabled)

    fun pushRelayCacheNow() {
        for (hs in registry.publicServers()) {
            publicHosting.queueRelayPush(hs.id, force = true)
        }
    }

    fun approve(serverId: String, requestId: String): Boolean =
        servers[serverId]?.approve(requestId) ?: false

    fun deny(serverId: String, requestId: String) {
        servers[serverId]?.deny(requestId)
    }

    fun regenerateInvite(serverId: String) {
        servers[serverId]?.regenerateInvite()
        registry.get(serverId)?.let { localHosting.advertise(it) }
        publishStatus()
    }

    /** Host's personal invite URL (`https://phlipapp.com/j/<slug>`), minting if needed. */
    fun hostInviteLink(serverId: String): String? =
        servers[serverId]?.hostPersonalInviteUrl()

    /** Rotate the host's personal invite link; re-advertise so NSD picks up the new slug. */
    fun rotateHostInviteLink(serverId: String): String? {
        val url = servers[serverId]?.rotateHostPersonalInviteUrl() ?: return null
        registry.get(serverId)?.let { localHosting.advertise(it) }
        publishStatus()
        return url
    }

    fun setForceJoinCode(serverId: String, enabled: Boolean) {
        servers[serverId]?.setForceJoinCode(enabled)
        if (enabled) registry.get(serverId)?.let { localHosting.advertise(it) }
        publishStatus()
    }

    fun triggerCodeRequest(serverId: String) {
        servers[serverId]?.triggerCodeRequest()
        publishStatus()
    }

    fun rotateTunnelToken(onDone: (String?) -> Unit) = publicHosting.rotateTunnelToken(onDone)
    fun disconnectCloudflareDomain(onDone: (String?) -> Unit) =
        publicHosting.disconnectDomain(onDone)
    fun setPublicSubdomain(serverId: String, raw: String): String? =
        publicHosting.setPublicSubdomain(serverId, raw)

    fun namedHostnameFor(hs: HostedServer): String = publicHosting.namedHostnameFor(hs)

    fun serverIcon(serverId: String): String = servers[serverId]?.iconText() ?: ""
    fun setServerIcon(serverId: String, text: String) {
        servers[serverId]?.setIconText(text)
        publishStatus()
    }

    /** Seal a structure or full server backup (UTF-8 `.phlip` envelope bytes). */
    fun exportServerBackup(serverId: String, kind: String, passphrase: String): Result<ByteArray> {
        if (!::backups.isInitialized) {
            return Result.failure(IllegalStateException("Host not ready"))
        }
        return backups.exportSealed(serverId, kind, passphrase)
    }

    fun serverBackupSuggestedName(serverId: String, kind: String): String {
        val name = registry.get(serverId)?.name ?: "server"
        return if (::backups.isInitialized) backups.suggestedName(kind, name)
        else "phlip-server-backup.phlip"
    }

    fun unlockServerBackup(passphrase: String, envelopeBytes: ByteArray): Result<ServerBackupService.Preview> {
        if (!::backups.isInitialized) {
            return Result.failure(IllegalStateException("Host not ready"))
        }
        return backups.unlockPreview(passphrase, envelopeBytes)
    }

    fun applyServerStructureBackup(
        payloadJson: String,
        targetServerId: String?,
        newServerName: String?,
        hostDisplayName: String,
    ): Result<String> {
        if (!::backups.isInitialized) {
            return Result.failure(IllegalStateException("Host not ready"))
        }
        if (!started) return Result.failure(IllegalStateException("Start hosting first"))
        return backups.applyStructure(payloadJson, targetServerId, newServerName, hostDisplayName)
    }

    fun applyServerFullBackup(payloadJson: String): Result<String> {
        if (!::backups.isInitialized) {
            return Result.failure(IllegalStateException("Host not ready"))
        }
        if (!started) return Result.failure(IllegalStateException("Start hosting first"))
        return backups.applyFull(payloadJson)
    }

    fun isRunning() = started

    fun approvePendingNetwork(trust: ApprovedNetworks.Trust) {
        localHosting.approvePendingNetwork(trust)
    }

    fun refreshNetworkGate() = localHosting.refreshNetworkGate()

    /**
     * Switch near-field reach for one server. Device, Direct and Local are exclusive;
     * Public hosting stays independent.
     *
     * Leaving On this device needs host rules and Local safety. A bind-address
     * change (device ↔ not device) restarts the instance.
     *
     * @return null on success, otherwise an error message.
     */
    fun setReachMode(serverId: String, mode: String): String? {
        if (!started) return "Hosting is off"
        val hs = registry.get(serverId) ?: return "Server not found"
        val next = ServerRegistry.normalizeReachMode(mode)
        val prev = hs.reachMode
        if (prev == next) return null
        val leavingDevice = hs.isDeviceOnly() && next != ServerRegistry.REACH_DEVICE
        if (leavingDevice && !HostPublicGate.canShareNearby(this)) {
            if (!HostPublicGate.hostRulesAccepted(this)) {
                return "Accept the server rules first"
            }
            if (!HostPublicGate.localPrepAccepted(this)) {
                return "Read safer hosting for Local first"
            }
        }
        if (prev == ServerRegistry.REACH_DIRECT && next != ServerRegistry.REACH_DIRECT) {
            val session = hotspotSession.sessionForServer(serverId)
            if (session != null) {
                hotspotSession.endSession()
                servers[serverId]?.setHotspotCreds("", "")
                localHosting.leaveDirectHotspotServing()
            }
        }
        val bindChanges = hs.isDeviceOnly() != (next == ServerRegistry.REACH_DEVICE)
        registry.setReachMode(serverId, next)
        if (bindChanges) {
            instances.stopInstance(serverId)
            registry.get(serverId)?.let { instances.startInstance(it) }
        } else {
            localHosting.unadvertise(serverId)
            if (next == ServerRegistry.REACH_LOCAL) {
                registry.get(serverId)?.let { localHosting.advertise(it) }
            }
            localHosting.syncShareReach(serverId)
        }
        publishStatus()
        return null
    }

    fun returnServerToDeviceOnly(serverId: String): String? {
        if (!started) return "Hosting is off"
        val hs = registry.get(serverId) ?: return "Server not found"
        if (hs.isPublic && !publicHosting.removePublicSharing(serverId)) {
            return publicHosting.publicErrorFor(serverId) ?: "Could not turn off Internet sharing"
        }
        return setReachMode(serverId, ServerRegistry.REACH_DEVICE)
    }

    fun startDirectSession(serverId: String, rotateNetwork: Boolean = false): HotspotStartResult {
        if (!started) return HotspotStartResult.Failed("Start hosting first")
        val hs = registry.get(serverId) ?: return HotspotStartResult.Failed("Server not found")
        val currentSession = hotspotSession.sessionInfo()
        if (currentSession != null && currentSession.serverId != serverId) {
            return HotspotStartResult.Failed("Another server is using this phone’s hotspot. End that session before starting this one.")
        }
        // Start Direct implies lock — exclusive of Local STA for this server.
        if (!hs.isDirectReach()) {
            val error = setReachMode(serverId, ServerRegistry.REACH_DIRECT)
            if (error != null) return HotspotStartResult.Failed(error)
        }
        val result = hotspotSession.startSession(serverId, hs.port, rotateNetwork = rotateNetwork)
        if (result is HotspotStartResult.Started) {
            // LocalOnlyHotspot does not always set isWifiApEnabled — force LAN listen.
            localHosting.enterDirectHotspotServing()
            localHosting.ensureLanDiscovery()
            servers[serverId]?.setHotspotCreds(result.info.ssid, result.info.password)
            localHosting.syncShareReach(serverId)
            publishStatus()
        } else {
            // Still Direct-locked even if Soft-AP failed to start.
            localHosting.syncShareReach(serverId)
            publishStatus()
        }
        return result
    }

    /** End live session (if any), mint a new Soft-AP name, and start again for [serverId]. */
    fun rotateDirectSession(serverId: String): HotspotStartResult {
        if (!started) return HotspotStartResult.Failed("Start hosting first")
        if (hotspotSession.sessionInfo() != null) {
            endDirectSession()
        }
        return startDirectSession(serverId, rotateNetwork = true)
    }

    fun endDirectSession(): Boolean {
        val info = hotspotSession.sessionInfo()
        val ended = hotspotSession.endSession()
        info?.serverId?.let { sid ->
            servers[sid]?.setHotspotCreds("", "")
            // Keep reachMode=direct — Soft-AP pause does not fall back to Local.
            localHosting.syncShareReach(sid)
        }
        localHosting.leaveDirectHotspotServing()
        publishStatus()
        return ended
    }

    fun hotspotSessionInfo(): HotspotSessionInfo? = hotspotSession.sessionInfo()

    fun hotspotSessionFor(serverId: String): HotspotSessionInfo? =
        hotspotSession.sessionForServer(serverId)

    fun declinePendingNetwork() {
        localHosting.declinePendingNetwork()
        notifications.showNetworkSuspendNotification()
        publishStatus()
    }

    data class ServerStatus(
        val id: String,
        val name: String,
        val port: Int,
        val lanUrls: List<String>,
        val inviteCode: String,
        val inviteExpiry: Long,
        val joinTag: String,
        val shareCode: String,
        /** Personal invite slug for `https://phlipapp.com/j/<slug>`. */
        val inviteSlug: String = "",
        val inviteUrl: String = "",
        val isPublic: Boolean,
        val publicUrl: String?,
        val publicNetworkCode: String,
        val error: String?,
        val passphrase: String,
        val pending: List<PendingInfo>,
        val forceJoinCode: Boolean,
        val publicSubdomain: String,
        val namedHostname: String,
        /** `local` | `direct` — near-field path; exclusive of the other. */
        val reachMode: String = ServerRegistry.REACH_LOCAL,
        val hotspotActive: Boolean = false,
        val hotspotSsid: String = "",
        val hotspotPassword: String = "",
        val hotspotQrUri: String = "",
        val hotspotLanUrl: String = "",
        val hotspotRadioLive: Boolean = true,
        val hotspotRadioNote: String = "",
        val listening: Boolean = false,
    )

    fun serverStatuses(): List<ServerStatus> = statusPublisher.serverStatuses()

    data class BridgeInfo(
        val id: String,
        val port: Int,
        val name: String,
        val token: String,
        val passphrase: String,
    )

    fun bridgeInfos(): List<BridgeInfo> = statusPublisher.bridgeInfos()

    private fun onServerActivity() {
        mainHandler.post {
            if (!started) return@post
            powerLocks.updatePowerLocks()
        }
    }

    fun isLiveBusy(): Boolean = servers.values.any { it.hasLiveEventOrBroadcast() }

    private fun publishStatus() = statusPublisher.publishStatus()

    override fun onDestroy() {
        super.onDestroy()
        hotspotSession.stop()
        localHosting.stop()
        publicHosting.stopAll()
        notifications.clearNetworkSuspendNotification()
        if (instance === this) instance = null
        for (s in servers.values) s.stop()
        powerLocks.releaseLocks()
    }

    companion object {
        /** Shared with MainActivity's discovery browsing — must match exactly. */
        const val NSD_SERVICE_TYPE = "_ash._tcp."
        const val ACTION_APPROVE_ONCE = "app.phlip.server.action.APPROVE_NETWORK_ONCE"
        const val ACTION_ALWAYS_TRUST = "app.phlip.server.action.ALWAYS_TRUST_NETWORK"
        const val ACTION_DECLINE_NETWORK = "app.phlip.server.action.DECLINE_NETWORK"
        @Volatile var instance: HostService? = null
            private set
    }
}
