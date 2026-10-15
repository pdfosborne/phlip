package app.phlip.server.local

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.wifi.WifiInfo
import android.net.wifi.WifiManager
import android.os.Build
import java.net.NetworkInterface
import java.security.MessageDigest

/**
 * LAN fingerprint material for [ApprovedNetworks]: gateway/DNS/domain/subnet/
 * transport hashes — never raw persisted values.
 *
 * Human-readable [ApprovedNetworks.Fingerprint.label] (SSID / Ethernet) is
 * separate from the hash and is safe to show in Settings.
 */
internal object NetworkFingerprint {
    const val HOTSPOT_FALLBACK_FP = "hotspot-local"

    data class LanSnapshot(
        val fingerprint: ApprovedNetworks.Fingerprint?,
        val cellularOnly: Boolean,
    )

    fun lanNetworkSnapshot(ctx: Context): LanSnapshot? {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return null
        val wifiOrEth = findLanNetwork(cm)
        if (wifiOrEth != null) {
            val caps = cm.getNetworkCapabilities(wifiOrEth)
            val lp = cm.getLinkProperties(wifiOrEth)
            val transport = when {
                caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true -> "WIFI"
                caps?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true -> "ETHERNET"
                else -> "LAN"
            }
            val label = when (transport) {
                "WIFI" -> currentWifiSsid(ctx, caps)
                "ETHERNET" -> "Ethernet"
                else -> null
            }
            val fp = fingerprintFrom(lp, transport, label = label)
                ?: return LanSnapshot(null, false)
            return LanSnapshot(fp, cellularOnly = false)
        }
        val active = cm.activeNetwork
        val caps = active?.let { cm.getNetworkCapabilities(it) }
        val cellular = caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true
        if (cellular && caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) != true &&
            caps?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) != true
        ) {
            return LanSnapshot(null, cellularOnly = true)
        }
        return LanSnapshot(null, cellularOnly = false)
    }

    /** Prefer Wi‑Fi / Ethernet under the VPN, not the VPN's LinkProperties. */
    fun findLanNetwork(cm: ConnectivityManager): Network? {
        val networks = cm.allNetworks
        var wifi: Network? = null
        var eth: Network? = null
        for (n in networks) {
            val caps = cm.getNetworkCapabilities(n) ?: continue
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue
            val lp = cm.getLinkProperties(n)
            val hasV4 = lp?.linkAddresses.orEmpty().any { la ->
                val addr = la.address
                addr is java.net.Inet4Address && !addr.isLoopbackAddress
            }
            if (!hasV4) continue
            when {
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> wifi = n
                caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> eth = n
            }
        }
        return wifi ?: eth
    }

    fun fingerprintFrom(
        lp: LinkProperties?,
        transport: String,
        label: String? = null,
    ): ApprovedNetworks.Fingerprint? {
        if (lp == null) return null
        val gateways = lp.routes
            .mapNotNull { route ->
                val gw = route.gateway ?: return@mapNotNull null
                if (gw.isAnyLocalAddress) return@mapNotNull null
                gw.hostAddress?.substringBefore('%')
            }
            .filter { it.isNotEmpty() }
            .sorted()
            .distinct()
        val dns = lp.dnsServers
            .mapNotNull { it.hostAddress?.substringBefore('%') }
            .filter { it.isNotEmpty() }
            .sorted()
            .distinct()
        val domains = listOfNotNull(
            lp.domains?.trim()?.takeIf { it.isNotEmpty() }?.lowercase(),
        )
        val prefixes = lp.linkAddresses.mapNotNull { la ->
            val host = la.address?.hostAddress?.substringBefore('%') ?: return@mapNotNull null
            if (la.address.isLoopbackAddress) return@mapNotNull null
            "$host/${la.prefixLength}"
        }.sorted()
        if (gateways.isEmpty() && dns.isEmpty() && prefixes.isEmpty()) return null
        val material = buildString {
            append("v1|")
            append(transport)
            append("|gw=")
            append(gateways.joinToString(","))
            append("|dns=")
            append(dns.joinToString(","))
            append("|dom=")
            append(domains.joinToString(","))
            append("|pfx=")
            append(prefixes.joinToString(","))
        }
        return ApprovedNetworks.Fingerprint(
            hash = sha256Hex(material),
            transport = transport,
            label = label?.trim()?.takeIf { it.isNotEmpty() },
        )
    }

    /**
     * Current Wi‑Fi SSID for display. Android treats SSID as location-sensitive:
     * ACCESS_FINE_LOCATION is required (and system Location usually must be on).
     * NEARBY_WIFI_DEVICES with `neverForLocation` alone is not enough — the OS
     * returns `<unknown ssid>`. Returns null when the name is withheld.
     */
    fun currentWifiSsid(ctx: Context, caps: NetworkCapabilities? = null): String? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val fromCaps = (caps?.transportInfo as? WifiInfo)?.let { sanitizeSsid(it.ssid) }
            if (fromCaps != null) return fromCaps
            // Caps may omit transportInfo on some OEMs — resolve active Wi‑Fi network.
            val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            val lan = cm?.let { findLanNetwork(it) }
            val lanCaps = lan?.let { cm.getNetworkCapabilities(it) }
            val fromLan = (lanCaps?.transportInfo as? WifiInfo)?.let { sanitizeSsid(it.ssid) }
            if (fromLan != null) return fromLan
        }
        @Suppress("DEPRECATION")
        val wm = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            ?: return null
        @Suppress("DEPRECATION")
        return sanitizeSsid(wm.connectionInfo?.ssid)
    }

    private fun sanitizeSsid(raw: String?): String? {
        val s = raw?.trim()?.trim('"').orEmpty()
        if (s.isEmpty()) return null
        if (s.equals("<unknown ssid>", ignoreCase = true)) return null
        if (s.equals("0x", ignoreCase = true)) return null
        return s
    }

    fun sha256Hex(s: String): String {
        val dig = MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8))
        return dig.joinToString("") { "%02x".format(it) }
    }

    /** Soft-AP / hotspot — phone is the access point (tether or LocalOnlyHotspot). */
    @Suppress("DEPRECATION")
    fun isHotspotActive(ctx: Context): Boolean {
        val wm = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        if (wm != null) {
            try {
                val m = wm.javaClass.getDeclaredMethod("isWifiApEnabled")
                m.isAccessible = true
                if (m.invoke(wm) as? Boolean == true) return true
            } catch (_: Throwable) {
            }
        }
        // LocalOnlyHotspot often leaves isWifiApEnabled=false — detect soft-AP ifaces.
        return hasSoftApInterface()
    }

    private fun hasSoftApInterface(): Boolean {
        return try {
            NetworkInterface.getNetworkInterfaces()?.toList().orEmpty().any { ni ->
                if (!ni.isUp) return@any false
                val name = ni.name.lowercase()
                val softName = name.startsWith("ap") || name.startsWith("softap") ||
                    name.startsWith("swlan") || name == "wlan1"
                if (!softName) return@any false
                ni.inetAddresses.toList().any { addr ->
                    addr is java.net.Inet4Address && !addr.isLoopbackAddress &&
                        (addr.hostAddress == "192.168.43.1" ||
                            addr.hostAddress?.endsWith(".1") == true)
                }
            }
        } catch (_: Throwable) {
            false
        }
    }

    fun hotspotFallbackFingerprint(): ApprovedNetworks.Fingerprint =
        ApprovedNetworks.Fingerprint(
            hash = HOTSPOT_FALLBACK_FP,
            transport = "HOTSPOT",
            label = "Hotspot",
        )
}
