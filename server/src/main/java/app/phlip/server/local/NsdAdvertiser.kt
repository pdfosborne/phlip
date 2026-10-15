package app.phlip.server.local

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import app.phlip.server.DrServer
import app.phlip.server.HostService
import app.phlip.server.HostedServer
import app.phlip.server.ServerRegistry
import java.util.concurrent.ConcurrentHashMap

/**
 * NSD/DNS-SD advertise for non-public local servers, including idle pause.
 */
internal class NsdAdvertiser(
    context: Context,
    private val registry: ServerRegistry,
    private val servers: MutableMap<String, DrServer>,
    private val mainHandler: Handler,
    private val isStarted: () -> Boolean,
    private val isNsdAllowed: () -> Boolean,
    private val isLanBusy: () -> Boolean,
) {
    private val nsdManager: NsdManager by lazy {
        context.getSystemService(Context.NSD_SERVICE) as NsdManager
    }
    private val nsdListeners = ConcurrentHashMap<String, NsdManager.RegistrationListener>()
    @Volatile var nsdPaused = false
        private set

    private val nsdIdleRunnable = Runnable { pauseNsdIfStillIdle() }

    fun clearIdleTimer() {
        mainHandler.removeCallbacks(nsdIdleRunnable)
    }

    fun resetPaused() {
        nsdPaused = false
    }

    fun advertise(hs: HostedServer) {
        android.util.Log.d("AshNsd", "advertise() called for ${hs.id}")
        unadvertise(hs.id)
        if (hs.isDeviceOnly()) {
            android.util.Log.d("AshNsd", "skip advertise — On this device (${hs.id})")
            return
        }
        if (hs.isPublic) {
            android.util.Log.d("AshNsd", "skip advertise — Public (${hs.id})")
            return
        }
        if (hs.isDirectReach()) {
            android.util.Log.d("AshNsd", "skip advertise — Direct-only (${hs.id})")
            return
        }
        if (!isNsdAllowed()) {
            android.util.Log.d("AshNsd", "skip advertise — network gate (not serving / cellular)")
            return
        }
        val srv = servers[hs.id] ?: run {
            android.util.Log.d("AshNsd", "no server instance, aborting")
            return
        }
        val info = NsdServiceInfo().apply {
            serviceName = "Phlip-${hs.id}"
            serviceType = HostService.NSD_SERVICE_TYPE
            port = hs.port
            setAttribute("id", hs.id)
            setAttribute("sid", hs.joinTag)
            setAttribute("name", hs.name.take(63))
            // Rotating join codes retired — advertise joinTag (+ optional host invite slug).
            val slug = srv.hostInviteSlug()?.take(63).orEmpty()
            if (slug.isNotEmpty()) setAttribute("slug", slug)
        }
        val listener = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(si: NsdServiceInfo) {
                android.util.Log.d("AshNsd", "registered ${si.serviceName}")
            }

            override fun onRegistrationFailed(si: NsdServiceInfo, errorCode: Int) {
                android.util.Log.d("AshNsd", "register FAILED $errorCode")
                nsdListeners.remove(hs.id)
            }

            override fun onServiceUnregistered(si: NsdServiceInfo) {}
            override fun onUnregistrationFailed(si: NsdServiceInfo, errorCode: Int) {}
        }
        try {
            nsdManager.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener)
            nsdListeners[hs.id] = listener
            nsdPaused = false
            android.util.Log.d("AshNsd", "registerService() call returned (async result pending)")
        } catch (e: Exception) {
            android.util.Log.d("AshNsd", "registerService() threw: $e")
        }
    }

    fun unadvertise(id: String) {
        nsdListeners.remove(id)?.let {
            try { nsdManager.unregisterService(it) } catch (_: Exception) {}
        }
    }

    fun unadvertiseAll() {
        for (id in nsdListeners.keys.toList()) unadvertise(id)
    }

    fun ensureLanDiscovery() {
        if (!isStarted() || !isNsdAllowed()) return
        mainHandler.post {
            if (!isStarted() || !isNsdAllowed()) return@post
            if (nsdPaused || nsdListeners.isEmpty()) {
                nsdPaused = false
                mainHandler.removeCallbacks(nsdIdleRunnable)
                for (hs in registry.all()) {
                    if (servers.containsKey(hs.id)) advertise(hs)
                }
            }
            refreshNsdIdleTimer()
        }
    }

    fun refreshNsdIdleTimer() {
        mainHandler.removeCallbacks(nsdIdleRunnable)
        if (!isStarted()) return
        if (isLanBusy()) {
            if (nsdPaused) {
                nsdPaused = false
                for (hs in registry.all()) {
                    if (servers.containsKey(hs.id)) advertise(hs)
                }
            }
        } else if (!nsdPaused) {
            mainHandler.postDelayed(nsdIdleRunnable, NSD_IDLE_MS)
        }
    }

    private fun pauseNsdIfStillIdle() {
        if (!isStarted() || isLanBusy()) return
        nsdPaused = true
        unadvertiseAll()
        android.util.Log.d("AshNsd", "paused advertise after idle")
    }

    fun listenerIds(): Collection<String> = nsdListeners.keys

    companion object {
        private const val NSD_IDLE_MS = 10 * 60 * 1000L
    }
}
