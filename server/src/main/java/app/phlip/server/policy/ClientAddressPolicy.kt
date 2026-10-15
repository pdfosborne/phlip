package app.phlip.server

import fi.iki.elonen.NanoHTTPD
import java.net.InetAddress
import java.security.MessageDigest

/**
 * Client address classification and Cloudflare-aware IP selection.
 *
 * Forwarding headers are trusted only when the TCP peer is loopback (tunnel → phone).
 */
internal object ClientAddressPolicy {

    /** True for loopback / RFC1918 / link-local / IPv6 ULA — used to loosen LAN rate limits. */
    fun isPrivateClientIp(ip: String): Boolean {
        return try {
            val raw = ip.removePrefix("[").removeSuffix("]").substringBefore('%')
            if (raw.isBlank() || raw == "?") return false
            val address = InetAddress.getByName(raw)
            val bytes = address.address
            val isIpv6UniqueLocal = bytes.size == 16 && (bytes[0].toInt() and 0xfe) == 0xfc
            address.isLoopbackAddress || address.isSiteLocalAddress ||
                address.isLinkLocalAddress || isIpv6UniqueLocal
        } catch (_: Exception) {
            false
        }
    }

    fun clientIp(session: NanoHTTPD.IHTTPSession): String =
        clientIp(session.remoteIpAddress, session.headers ?: emptyMap())

    fun clientIp(remoteIp: String?, headers: Map<String, String>): String {
        fun hdr(name: String): String? =
            headers.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value?.trim()
                ?.takeIf { it.isNotEmpty() }
        val remote = remoteIp?.takeIf { it.isNotBlank() } ?: "?"
        // Only trust CF / XFF when the TCP peer is loopback (tunnel → phone).
        val fromLocalProxy = try {
            val raw = remote.removePrefix("[").removeSuffix("]").substringBefore('%')
            InetAddress.getByName(raw).isLoopbackAddress
        } catch (_: Exception) {
            false
        }
        if (fromLocalProxy) {
            hdr("cf-connecting-ip")?.let { return it.split(',').first().trim() }
            hdr("x-forwarded-for")?.let { return it.split(',').first().trim() }
        }
        return remote
    }

    /** True only for a direct private-network request, never Cloudflare or port-forwarded WAN. */
    fun isDirectLanRequest(session: NanoHTTPD.IHTTPSession): Boolean =
        isDirectLanRequest(session.remoteIpAddress, session.headers ?: emptyMap())

    fun isDirectLanRequest(remoteIp: String?, headers: Map<String, String>): Boolean {
        fun has(name: String) = headers.keys.any { it.equals(name, ignoreCase = true) }
        if (has("cf-connecting-ip") || has("cf-ray")) return false
        return try {
            val raw = remoteIp.orEmpty()
                .removePrefix("[").removeSuffix("]")
                .substringBefore('%')
            val address = InetAddress.getByName(raw)
            val bytes = address.address
            val isIpv6UniqueLocal = bytes.size == 16 && (bytes[0].toInt() and 0xfe) == 0xfc
            address.isLoopbackAddress || address.isSiteLocalAddress ||
                address.isLinkLocalAddress || isIpv6UniqueLocal
        } catch (_: Exception) {
            false
        }
    }

    /** Timing-safe UTF-8 equality (length-padded so [MessageDigest.isEqual] does not short-circuit on size). */
    fun passwordsEqual(a: String, b: String): Boolean {
        val aa = a.toByteArray(Charsets.UTF_8)
        val bb = b.toByteArray(Charsets.UTF_8)
        val n = maxOf(aa.size, bb.size, 1)
        val pa = ByteArray(n)
        val pb = ByteArray(n)
        System.arraycopy(aa, 0, pa, 0, aa.size)
        System.arraycopy(bb, 0, pb, 0, bb.size)
        return aa.size == bb.size && MessageDigest.isEqual(pa, pb)
    }
}
