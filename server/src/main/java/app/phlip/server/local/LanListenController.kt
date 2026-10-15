package app.phlip.server.local

import app.phlip.server.DrServer
import app.phlip.server.HostedServer
import app.phlip.server.ServerRegistry

/**
 * Pause / resume [DrServer] listeners and re-publish NSD + share-reach.
 */
internal class LanListenController(
    private val registry: ServerRegistry,
    private val servers: MutableMap<String, DrServer>,
    private val unadvertise: (String) -> Unit,
    private val advertise: (HostedServer) -> Unit,
    private val syncShareReach: (String) -> Unit,
    private val syncAllShareReach: () -> Unit,
    private val nsdListenerIds: () -> Collection<String>,
) {
    fun pauseLanListening() {
        for (id in nsdListenerIds().toList()) unadvertise(id)
        for ((id, srv) in servers) {
            if (registry.get(id)?.isDeviceOnly() == true) continue
            try {
                srv.pauseListening()
            } catch (t: Throwable) {
                android.util.Log.w("AshNetGate", "pauseListening failed", t)
            }
        }
        syncAllShareReach()
    }

    fun resumeLanListening() {
        for ((id, srv) in servers) {
            if (registry.get(id)?.isDeviceOnly() == true) continue
            try {
                srv.resumeListening()
            } catch (t: Throwable) {
                android.util.Log.w("AshNetGate", "resumeListening failed", t)
            }
            syncShareReach(id)
            registry.get(id)?.let { advertise(it) }
        }
    }
}
