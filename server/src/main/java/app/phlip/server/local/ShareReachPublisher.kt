package app.phlip.server.local

import app.phlip.server.DrServer
import app.phlip.server.HostedServer
import app.phlip.server.ServerRegistry
import java.net.NetworkInterface

/**
 * Publishes LAN / public share-reach bases into each [DrServer].
 *
 * Direct-only servers never get STA Wi‑Fi LAN bases — only Soft-AP URL when live.
 */
internal class ShareReachPublisher(
    private val registry: ServerRegistry,
    private val servers: MutableMap<String, DrServer>,
    private val isLanBroadcastAllowed: () -> Boolean,
    private val publicUrlProvider: (String) -> String?,
    private val directLanUrlProvider: () -> ((String) -> String?) = { { null } },
) {
    fun syncShareReach(id: String) {
        val hs = registry.get(id) ?: return
        val srv = servers[id] ?: return
        val lan = when {
            hs.isDeviceOnly() -> ""
            hs.isDirectReach() -> directLanUrlProvider().invoke(id)?.trim().orEmpty()
            isLanBroadcastAllowed() ->
                lanAddresses()
                    .firstOrNull { !isSoftApRange(it) }
                    ?.let { "http://$it:${hs.port}" }
                    .orEmpty()
                    .ifEmpty {
                        // Fallback if only Soft-AP ifaces exist while in Local mode.
                        lanAddresses().firstOrNull()?.let { "http://$it:${hs.port}" }.orEmpty()
                    }
            else -> ""
        }
        val pub = if (hs.isPublic) publicUrlProvider(id) else null
        srv.setShareReach(lan, pub, hs.isPublic, hs.reachMode)
    }

    fun syncAllShareReach() {
        for (id in servers.keys.toList()) syncShareReach(id)
    }

    fun lanAddresses(): List<String> =
        NetworkInterface.getNetworkInterfaces()?.toList()
            ?.flatMap { it.inetAddresses.toList() }
            ?.filter { !it.isLoopbackAddress && it is java.net.Inet4Address }
            ?.mapNotNull { it.hostAddress?.takeIf { a -> a.isNotEmpty() } }
            ?: emptyList()

    companion object {
        fun isSoftApRange(ip: String): Boolean =
            ip.startsWith("192.168.43.") ||
                ip.startsWith("192.168.49.") ||
                ip.startsWith("192.168.75.") ||
                ip.startsWith("192.168.137.")
    }
}
