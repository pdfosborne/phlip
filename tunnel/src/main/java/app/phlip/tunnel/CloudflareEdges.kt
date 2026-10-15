package app.phlip.tunnel

import android.util.Log
import java.net.Inet4Address
import java.net.InetAddress

/**
 * Resolve Cloudflare Tunnel edge addresses (`host:7844`) using Android DNS
 * so the bundled cloudflared binary does not rely on Go DNS on-device.
 */
object CloudflareEdges {

    fun resolve(limit: Int = 8): List<String> {
        val out = LinkedHashSet<String>()
        for (host in EDGE_HOSTS) {
            try {
                for (addr in InetAddress.getAllByName(host)) {
                    if (addr is Inet4Address) {
                        val ip = addr.hostAddress ?: continue
                        out.add("$ip:$EDGE_PORT")
                        if (out.size >= limit) return out.toList()
                    }
                }
            } catch (t: Throwable) {
                Log.w(TAG, "edge resolve failed for $host", t)
            }
        }
        if (out.isEmpty()) {
            for (ip in FALLBACK_EDGE_IPS) {
                out.add("$ip:$EDGE_PORT")
                if (out.size >= limit) break
            }
        }
        return out.toList()
    }

    private const val TAG = "AshCfEdges"
    private const val EDGE_PORT = 7844
    private val EDGE_HOSTS = listOf(
        "region1.v2.argotunnel.com",
        "region2.v2.argotunnel.com",
    )
    private val FALLBACK_EDGE_IPS = listOf(
        "198.41.192.7",
        "198.41.192.27",
        "198.41.192.47",
        "198.41.192.67",
        "198.41.200.13",
        "198.41.200.33",
    )
}
