package app.phlip.server.hosting

import android.content.Context
import android.net.wifi.WifiManager
import android.os.PowerManager
import app.phlip.server.DrServer
import app.phlip.server.PendingInfo
import app.phlip.server.ServerRegistry
import app.phlip.server.publichost.PublicHostingCoordinator
import java.util.concurrent.ConcurrentHashMap

/** Wake lock + Wi-Fi lock policy for the host session. */
internal class HostPowerLocks(
    private val context: Context,
    private val registry: ServerRegistry,
    private val servers: ConcurrentHashMap<String, DrServer>,
    private val pendingByServer: ConcurrentHashMap<String, List<PendingInfo>>,
    private val publicHosting: PublicHostingCoordinator,
    private val isStarted: () -> Boolean,
) {
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var wifiHighPerf = false

    fun needsHighPerfWifi(): Boolean {
        if (registry.publicServers().isNotEmpty() || publicHosting.hasActiveProvider()) return true
        if (pendingByServer.values.any { it.isNotEmpty() }) return true
        for (srv in servers.values) {
            if (srv.connectedClientCount() > 0 || srv.hasShareActivity()) return true
        }
        return false
    }

    fun isLanBusy(): Boolean {
        if (pendingByServer.values.any { it.isNotEmpty() }) return true
        return servers.values.any { it.connectedClientCount() > 0 }
    }

    @Suppress("DEPRECATION")
    fun updatePowerLocks() {
        if (!isStarted()) return
        if (wakeLock == null) {
            val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "phlip:host").apply {
                setReferenceCounted(false)
                acquire()
            }
        }
        val wantHigh = needsHighPerfWifi()
        if (wifiLock != null && wifiHighPerf == wantHigh) return
        try {
            wifiLock?.release()
        } catch (_: Exception) {
        }
        wifiLock = null
        val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        val mode = if (wantHigh) WifiManager.WIFI_MODE_FULL_HIGH_PERF else WifiManager.WIFI_MODE_FULL
        wifiLock = wm.createWifiLock(mode, "phlip:host").apply {
            setReferenceCounted(false)
            acquire()
        }
        wifiHighPerf = wantHigh
    }

    fun releaseLocks() {
        try {
            wakeLock?.release()
        } catch (_: Exception) {
        }
        wakeLock = null
        try {
            wifiLock?.release()
        } catch (_: Exception) {
        }
        wifiLock = null
        wifiHighPerf = false
    }
}
