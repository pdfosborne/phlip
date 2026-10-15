package app.phlip.server.local

import android.content.Context
import android.os.Handler
import android.os.Looper
import app.phlip.server.DrServer
import app.phlip.server.HostedServer
import app.phlip.server.ServerRegistry

/**
 * Local hosting façade: network gate, NSD advertise, share-reach, pause/resume.
 * Composes [NetworkGateController], [NsdAdvertiser], [ShareReachPublisher],
 * and [LanListenController].
 */
class LocalHostingCoordinator(
    context: Context,
    approvedNetworks: ApprovedNetworks,
    private val registry: ServerRegistry,
    private val servers: MutableMap<String, DrServer>,
    private val mainHandler: Handler = Handler(Looper.getMainLooper()),
    private val onStateChanged: () -> Unit = {},
    private val onServerActivity: () -> Unit = {},
    publicUrlProvider: (String) -> String? = { null },
) {
    enum class NetworkGate { SERVING, SUSPENDED }

    @Volatile private var started = false
    @Volatile var holdingDirectHotspot = false
        private set

    /** Soft-AP LAN URL for a Direct-locked server (set by HostService after hotspot exists). */
    @Volatile var directLanUrlProvider: (String) -> String? = { null }

    // Wired in init; lateinit so share/NSD lambdas can close over [gate] before assignment.
    private lateinit var shareReach: ShareReachPublisher
    private lateinit var nsd: NsdAdvertiser
    private lateinit var lanListen: LanListenController
    private lateinit var gate: NetworkGateController

    init {
        shareReach = ShareReachPublisher(
            registry = registry,
            servers = servers,
            isLanBroadcastAllowed = { gate.isLanBroadcastAllowed() },
            publicUrlProvider = publicUrlProvider,
            directLanUrlProvider = { directLanUrlProvider },
        )
        nsd = NsdAdvertiser(
            context = context,
            registry = registry,
            servers = servers,
            mainHandler = mainHandler,
            isStarted = { started },
            isNsdAllowed = { gate.isNsdAllowed() },
            isLanBusy = { servers.values.any { it.connectedClientCount() > 0 } },
        )
        lanListen = LanListenController(
            registry = registry,
            servers = servers,
            unadvertise = { id -> nsd.unadvertise(id) },
            advertise = { hs -> nsd.advertise(hs) },
            syncShareReach = { id -> shareReach.syncShareReach(id) },
            syncAllShareReach = { shareReach.syncAllShareReach() },
            nsdListenerIds = { nsd.listenerIds() },
        )
        gate = NetworkGateController(
            context = context,
            approvedNetworks = approvedNetworks,
            registry = registry,
            servers = servers,
            mainHandler = mainHandler,
            operations = NetworkGateController.Operations(
                isStarted = { started },
                pauseLanListening = { lanListen.pauseLanListening() },
                resumeLanListening = { lanListen.resumeLanListening() },
                syncShareReach = { id -> shareReach.syncShareReach(id) },
                advertise = { hs -> nsd.advertise(hs) },
                onStateChanged = onStateChanged,
                onServerActivity = onServerActivity,
                isDirectHotspotActive = { holdingDirectHotspot },
            ),
        )
    }

    fun start() {
        if (started) return
        started = true
        nsd.resetPaused()
        gate.resetState()
        gate.registerNetworkCallback()
        gate.applyNetworkGate(initial = true)
        nsd.refreshNsdIdleTimer()
    }

    fun stop() {
        nsd.clearIdleTimer()
        gate.clearDebounce()
        nsd.resetPaused()
        gate.unregisterNetworkCallback()
        nsd.unadvertiseAll()
        started = false
        gate.resetState()
    }

    fun isNetworkSuspended(): Boolean = gate.isNetworkSuspended()
    fun hasPendingNetwork(): Boolean = gate.hasPendingNetwork()
    fun isLanBroadcastAllowed(): Boolean = gate.isLanBroadcastAllowed()
    fun isNsdAllowed(): Boolean = gate.isNsdAllowed()
    fun isServing(): Boolean = gate.isServing()
    fun currentTrust(): ApprovedNetworks.Trust? = gate.currentTrust
    fun isCellularExempt(): Boolean = gate.cellularExempt
    fun networkGateLabel(): String = gate.networkGateLabel()
    fun pendingNetworkLabel(): String = gate.pendingNetworkLabel()

    fun refreshNetworkGate() {
        if (!started) return
        mainHandler.post { gate.applyNetworkGate(initial = true) }
    }

    /**
     * LocalOnlyHotspot often does not flip WifiManager.isWifiApEnabled, so the
     * normal gate evaluation stays suspended. Force LAN listen while a direct
     * session is live so nearby joiners can reach DrServer.
     *
     * Direct mode stays preferred over any host STA Wi‑Fi approval until End.
     */
    fun enterDirectHotspotServing() {
        if (!started) return
        holdingDirectHotspot = true
        val apply = {
            gate.preferDirectServing()
            // enterServing can no-op if already SERVING; LocalOnlyHotspot still
            // needs the listener open even when isWifiApEnabled stays false.
            lanListen.resumeLanListening()
        }
        if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) {
            apply()
            return
        }
        val latch = java.util.concurrent.CountDownLatch(1)
        mainHandler.post {
            try {
                apply()
            } finally {
                latch.countDown()
            }
        }
        try {
            latch.await(3, java.util.concurrent.TimeUnit.SECONDS)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        }
    }

    fun leaveDirectHotspotServing() {
        holdingDirectHotspot = false
        refreshNetworkGate()
    }

    fun approvePendingNetwork(trust: ApprovedNetworks.Trust) =
        gate.approvePendingNetwork(trust)

    fun declinePendingNetwork() = gate.declinePendingNetwork()

    fun syncShareReach(id: String) = shareReach.syncShareReach(id)
    fun syncAllShareReach() = shareReach.syncAllShareReach()

    fun advertise(hs: HostedServer) = nsd.advertise(hs)
    fun unadvertise(id: String) = nsd.unadvertise(id)
    fun ensureLanDiscovery() = nsd.ensureLanDiscovery()

    fun pauseLanListening() = lanListen.pauseLanListening()
    fun resumeLanListening() = lanListen.resumeLanListening()
}
