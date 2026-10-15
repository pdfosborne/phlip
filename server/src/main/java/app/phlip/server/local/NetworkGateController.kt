package app.phlip.server.local

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Handler
import app.phlip.server.DrServer
import app.phlip.server.HostedServer
import app.phlip.server.SecurityRejectLog
import app.phlip.server.ServerRegistry

/**
 * Network gate (SERVING / SUSPENDED): evaluate approved networks, debounce
 * suspend, and drive pause/resume + advertise via [Operations].
 */
internal class NetworkGateController(
    private val context: Context,
    private val approvedNetworks: ApprovedNetworks,
    private val registry: ServerRegistry,
    private val servers: MutableMap<String, DrServer>,
    private val mainHandler: Handler,
    private val operations: Operations,
) {
    enum class NetworkGate { SERVING, SUSPENDED }

    internal data class Operations(
        val isStarted: () -> Boolean,
        val pauseLanListening: () -> Unit,
        val resumeLanListening: () -> Unit,
        val syncShareReach: (String) -> Unit,
        val advertise: (HostedServer) -> Unit,
        val onStateChanged: () -> Unit,
        val onServerActivity: () -> Unit,
        val isDirectHotspotActive: () -> Boolean = { false },
    )

    @Volatile var networkGate = NetworkGate.SUSPENDED
        private set
    @Volatile var cellularExempt = false
        private set
    @Volatile var currentTrust: ApprovedNetworks.Trust? = null
        private set
    @Volatile private var currentFpHash: String? = null
    @Volatile var pendingFp: ApprovedNetworks.Fingerprint? = null
        private set
    private var lastServingFpHash: String? = null
    private var lastServingAt = 0L
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private val debounceSuspendRunnable = Runnable { finalizeDebouncedSuspend() }
    private var debouncePendingFp: ApprovedNetworks.Fingerprint? = null

    private val connectivity: ConnectivityManager by lazy {
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    }

    fun resetState() {
        networkGate = NetworkGate.SUSPENDED
        cellularExempt = false
        currentTrust = null
        currentFpHash = null
        pendingFp = null
    }

    fun clearDebounce() {
        mainHandler.removeCallbacks(debounceSuspendRunnable)
        debouncePendingFp = null
    }

    fun isNetworkSuspended(): Boolean =
        operations.isStarted() && networkGate == NetworkGate.SUSPENDED

    fun isLanBroadcastAllowed(): Boolean =
        operations.isStarted() && networkGate == NetworkGate.SERVING && !cellularExempt &&
            currentTrust == ApprovedNetworks.Trust.TRUSTED

    fun isNsdAllowed(): Boolean =
        operations.isStarted() && networkGate == NetworkGate.SERVING && !cellularExempt &&
            (currentTrust == ApprovedNetworks.Trust.TRUSTED ||
                currentTrust == ApprovedNetworks.Trust.ONCE)

    fun isServing(): Boolean = operations.isStarted() && networkGate == NetworkGate.SERVING

    fun networkGateLabel(): String = when {
        !operations.isStarted() -> "off"
        operations.isDirectHotspotActive() && networkGate == NetworkGate.SERVING -> "direct"
        cellularExempt && networkGate == NetworkGate.SERVING -> "cellular"
        networkGate == NetworkGate.SUSPENDED -> "suspended"
        currentTrust == ApprovedNetworks.Trust.TRUSTED -> "trusted"
        currentTrust == ApprovedNetworks.Trust.ONCE -> "once"
        else -> "serving"
    }

    fun hasPendingNetwork(): Boolean =
        pendingFp != null && !operations.isDirectHotspotActive()

    fun pendingNetworkLabel(): String =
        if (operations.isDirectHotspotActive()) "" else pendingFp?.label.orEmpty()

    fun approvePendingNetwork(trust: ApprovedNetworks.Trust) {
        if (operations.isDirectHotspotActive()) return
        val pending = pendingFp ?: approvedNetworks.currentFingerprint(context) ?: return
        // Prefer a fresh snapshot so SSID is saved if Location was just granted.
        val fresh = approvedNetworks.currentFingerprint(context)
        val fp = if (fresh != null && fresh.hash == pending.hash) fresh else pending
        approvedNetworks.approve(fp, trust)
        cancelDebouncedSuspend()
        enterServing(fp, trust, cellular = false, reason = "approve-${trust.name.lowercase()}")
        SecurityRejectLog.record("host", "network", "approve", trust.name)
    }

    fun declinePendingNetwork() {
        SecurityRejectLog.record("host", "network", "decline", pendingFp?.hash?.take(12) ?: "")
        // Stay suspended; host must approve to serve.
    }

    fun registerNetworkCallback() {
        if (networkCallback != null) return
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = postGate()
            override fun onLost(network: Network) = postGate()
            override fun onLinkPropertiesChanged(network: Network, linkProperties: LinkProperties) = postGate()
            override fun onCapabilitiesChanged(network: Network, networkCapabilities: NetworkCapabilities) = postGate()
        }
        networkCallback = cb
        try {
            val req = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()
            connectivity.registerNetworkCallback(req, cb)
        } catch (t: Throwable) {
            android.util.Log.w("AshNetGate", "registerNetworkCallback failed", t)
            try {
                connectivity.registerDefaultNetworkCallback(cb)
            } catch (t2: Throwable) {
                android.util.Log.e("AshNetGate", "registerDefaultNetworkCallback failed", t2)
            }
        }
    }

    fun unregisterNetworkCallback() {
        val cb = networkCallback ?: return
        networkCallback = null
        try {
            connectivity.unregisterNetworkCallback(cb)
        } catch (_: Exception) {
        }
    }

    fun postGate() {
        mainHandler.post { if (operations.isStarted()) applyNetworkGate(initial = false) }
    }

    fun applyNetworkGate(initial: Boolean) {
        if (!operations.isStarted()) return
        if (operations.isDirectHotspotActive()) {
            preferDirectServing()
            return
        }
        val eval = approvedNetworks.evaluate(context)
        when (eval) {
            is ApprovedNetworks.Evaluation.CellularExempt -> {
                cancelDebouncedSuspend()
                leavePreviousOnceIfNeeded(null)
                enterServing(fp = null, trust = null, cellular = true, reason = "cellular")
            }
            is ApprovedNetworks.Evaluation.HotspotTrusted -> {
                cancelDebouncedSuspend()
                leavePreviousOnceIfNeeded(eval.fp.hash)
                approvedNetworks.approve(eval.fp, ApprovedNetworks.Trust.TRUSTED, label = "Hotspot")
                enterServing(eval.fp, ApprovedNetworks.Trust.TRUSTED, cellular = false, reason = "hotspot")
            }
            is ApprovedNetworks.Evaluation.Known -> {
                cancelDebouncedSuspend()
                leavePreviousOnceIfNeeded(eval.fp.hash)
                // Backfill / refresh human SSID when the OS can see it now.
                val ssid = eval.fp.label?.trim().orEmpty()
                if (ssid.isNotEmpty() && eval.record.label != ssid) {
                    approvedNetworks.approve(eval.fp, eval.record.trust, label = ssid)
                }
                enterServing(eval.fp, eval.record.trust, cellular = false, reason = "known")
            }
            is ApprovedNetworks.Evaluation.Unknown -> {
                leavePreviousOnceIfNeeded(eval.fp.hash)
                if (eval.fp.hash == lastServingFpHash &&
                    System.currentTimeMillis() - lastServingAt < NETWORK_DEBOUNCE_MS
                ) {
                    val stored = approvedNetworks.lookup(eval.fp.hash)
                    if (stored != null) {
                        enterServing(eval.fp, stored.trust, cellular = false, reason = "debounce")
                        return
                    }
                }
                if (networkGate == NetworkGate.SUSPENDED && pendingFp?.hash == eval.fp.hash) {
                    // Same network — still refresh label if SSID became readable.
                    if (eval.fp.label != pendingFp?.label) {
                        pendingFp = eval.fp
                        operations.onStateChanged()
                    }
                    return
                }
                if (initial) {
                    suspendForApproval(eval.fp, reason = "unknown")
                } else {
                    scheduleDebouncedSuspend(eval.fp)
                }
            }
            ApprovedNetworks.Evaluation.None -> {
                if (networkGate == NetworkGate.SERVING && !cellularExempt) {
                    scheduleDebouncedSuspend(pendingFp = null)
                } else {
                    clearPendingIfOffline()
                }
            }
        }
    }

    /** Keep LAN serving while Soft-AP radio is live — ignores host STA Wi‑Fi approval.
     *  Per-server Direct exclusivity is enforced in ShareReach/NSD (no STA publish for
     *  reachMode=direct); this only keeps the Soft-AP listener up host-wide. */
    fun preferDirectServing() {
        cancelDebouncedSuspend()
        pendingFp = null
        enterServing(
            fp = NetworkFingerprint.hotspotFallbackFingerprint(),
            trust = ApprovedNetworks.Trust.TRUSTED,
            cellular = false,
            reason = "local-only-hotspot",
            forceResumeLan = true,
        )
    }

    fun enterServing(
        fp: ApprovedNetworks.Fingerprint?,
        trust: ApprovedNetworks.Trust?,
        cellular: Boolean,
        reason: String,
        forceResumeLan: Boolean = false,
    ) {
        val wasSuspended = networkGate == NetworkGate.SUSPENDED
        val prevTrust = currentTrust
        val sameState = networkGate == NetworkGate.SERVING &&
            currentFpHash == fp?.hash &&
            currentTrust == trust &&
            cellularExempt == cellular
        if (sameState && !forceResumeLan) {
            lastServingAt = System.currentTimeMillis()
            if (fp != null) lastServingFpHash = fp.hash
            return
        }
        networkGate = NetworkGate.SERVING
        cellularExempt = cellular
        currentTrust = if (cellular) null else trust
        currentFpHash = fp?.hash
        pendingFp = null
        if (fp != null) {
            lastServingFpHash = fp.hash
            lastServingAt = System.currentTimeMillis()
            approvedNetworks.touch(fp.hash)
        }
        if (forceResumeLan || wasSuspended || servers.values.any { it.isListeningPaused() }) {
            operations.resumeLanListening()
            SecurityRejectLog.record("host", "network", "resume", reason)
        } else if (prevTrust != currentTrust) {
            for (id in servers.keys.toList()) {
                operations.syncShareReach(id)
                registry.get(id)?.let { operations.advertise(it) }
            }
        }
        operations.onStateChanged()
        operations.onServerActivity()
    }

    private fun clearPendingIfOffline() {
        if (pendingFp == null) return
        pendingFp = null
        operations.onStateChanged()
    }

    private fun suspendOffline() {
        cancelDebouncedSuspend()
        val wasServing = networkGate == NetworkGate.SERVING
        if (networkGate == NetworkGate.SUSPENDED && pendingFp == null && !wasServing) return
        networkGate = NetworkGate.SUSPENDED
        cellularExempt = false
        currentTrust = null
        currentFpHash = null
        pendingFp = null
        operations.pauseLanListening()
        if (wasServing) {
            SecurityRejectLog.record("host", "network", "suspend", "offline")
        }
        operations.onStateChanged()
        operations.onServerActivity()
    }

    fun suspendForApproval(fp: ApprovedNetworks.Fingerprint, reason: String) {
        if (operations.isDirectHotspotActive()) {
            preferDirectServing()
            return
        }
        leavePreviousOnceIfNeeded(fp.hash)
        val wasServing = networkGate == NetworkGate.SERVING
        networkGate = NetworkGate.SUSPENDED
        cellularExempt = false
        currentTrust = null
        currentFpHash = null
        pendingFp = fp
        operations.pauseLanListening()
        if (wasServing || reason == "unknown") {
            SecurityRejectLog.record("host", "network", "suspend", reason)
        }
        operations.onStateChanged()
        operations.onServerActivity()
    }

    private fun leavePreviousOnceIfNeeded(newFpHash: String?) {
        val prev = currentFpHash ?: return
        if (newFpHash != null && newFpHash == prev) return
        approvedNetworks.clearOnce(prev)
    }

    private fun scheduleDebouncedSuspend(pendingFp: ApprovedNetworks.Fingerprint?) {
        if (operations.isDirectHotspotActive()) return
        debouncePendingFp = pendingFp
        mainHandler.removeCallbacks(debounceSuspendRunnable)
        mainHandler.postDelayed(debounceSuspendRunnable, NETWORK_DEBOUNCE_MS)
    }

    private fun cancelDebouncedSuspend() {
        mainHandler.removeCallbacks(debounceSuspendRunnable)
        debouncePendingFp = null
    }

    private fun finalizeDebouncedSuspend() {
        if (!operations.isStarted()) return
        // Direct mode wins over any pending Local network suspend.
        if (operations.isDirectHotspotActive()) {
            preferDirectServing()
            debouncePendingFp = null
            return
        }
        val eval = approvedNetworks.evaluate(context)
        when (eval) {
            is ApprovedNetworks.Evaluation.Known,
            is ApprovedNetworks.Evaluation.HotspotTrusted,
            ApprovedNetworks.Evaluation.CellularExempt -> {
                applyNetworkGate(initial = false)
            }
            is ApprovedNetworks.Evaluation.Unknown -> {
                suspendForApproval(eval.fp, reason = "unknown")
            }
            ApprovedNetworks.Evaluation.None -> {
                val fp = debouncePendingFp
                if (fp != null) suspendForApproval(fp, reason = "lost")
                else suspendOffline()
            }
        }
        debouncePendingFp = null
    }

    companion object {
        private const val NETWORK_DEBOUNCE_MS = 10_000L
    }
}
