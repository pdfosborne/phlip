package com.phlip.hotspot

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.Uri
import android.net.wifi.WifiManager
import android.net.wifi.WifiNetworkSpecifier
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.app.NotificationCompat
import com.phlip.MainActivity
import org.json.JSONObject

/**
 * Joiner-side direct hotspot: SSID watch after manual Settings join,
 * in-app reconnect for saved networks, and process network binding.
 */
class HotspotJoinCoordinator(
    private val activity: MainActivity,
) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val connectivity =
        activity.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val wifiManager =
        activity.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager

    private var watchSsid: String? = null
    private var watchJoinUrl: String? = null
    private var watchInviteSlug: String? = null
    private var watchServerName: String? = null
    private var watchCallback: ConnectivityManager.NetworkCallback? = null

    private var reconnectCallback: ConnectivityManager.NetworkCallback? = null
    private var boundNetwork: Network? = null

    @Volatile private var reconnectSsid: String? = null
    @Volatile private var boundForDiscovery = false

    fun openWifiSettings() {
        // Prefer the quick Wi‑Fi panel (Android 10+) — same UX as Change Wi‑Fi network.
        openWifiPanelOrSettings()
    }

    fun watchHotspotJoin(
        ssid: String,
        joinUrl: String?,
        inviteSlug: String?,
        serverName: String?,
    ): JSONObject {
        val trimmed = ssid.trim()
        if (trimmed.isEmpty()) {
            return JSONObject().put("ok", false).put("error", "Missing network name")
        }
        stopWatchHotspotJoin()
        watchSsid = trimmed
        watchJoinUrl = joinUrl?.trim()?.takeIf { it.isNotEmpty() }
        watchInviteSlug = inviteSlug?.trim()?.takeIf { it.isNotEmpty() }
        watchServerName = serverName?.trim()?.takeIf { it.isNotEmpty() }

        if (currentWifiSsid()?.equals(trimmed, ignoreCase = true) == true) {
            deliverJoinReady(foreground = activity.hasWindowFocus())
            return JSONObject().put("ok", true).put("alreadyConnected", true)
        }

        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                mainHandler.post { checkWatchMatch(foreground = activity.hasWindowFocus()) }
            }

            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                    mainHandler.post { checkWatchMatch(foreground = activity.hasWindowFocus()) }
                }
            }
        }
        watchCallback = cb
        try {
            connectivity.registerDefaultNetworkCallback(cb)
        } catch (_: Exception) {
            watchCallback = null
            watchSsid = null
            return JSONObject().put("ok", false).put("error", "Could not watch network changes")
        }
        return JSONObject().put("ok", true).put("alreadyConnected", false)
    }

    fun stopWatchHotspotJoin(): JSONObject {
        watchCallback?.let {
            try { connectivity.unregisterNetworkCallback(it) } catch (_: Exception) {}
        }
        watchCallback = null
        watchSsid = null
        watchJoinUrl = null
        watchInviteSlug = null
        watchServerName = null
        return JSONObject().put("ok", true)
    }

    fun reconnectToHotspot(ssid: String, password: String): JSONObject {
        val trimmedSsid = ssid.trim()
        if (trimmedSsid.isEmpty() || password.isEmpty()) {
            return JSONObject().put("ok", false).put("error", "Missing Wi-Fi credentials")
        }
        // Already on the host Soft-AP — bind Phlip traffic to it (no system dialog).
        if (isOnSsid(trimmedSsid) ||
            (currentWifiSsid() == null && localOnlyWifiNetwork() != null && looksLikeDirectSsid(trimmedSsid))
        ) {
            clearHotspotBinding(disconnectWifi = false)
            val wifi = localOnlyWifiNetwork()
            if (wifi != null) bindNetwork(wifi)
            reconnectSsid = trimmedSsid
            return JSONObject().put("ok", true).put("ssid", trimmedSsid).put("alreadyConnected", true)
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            openWifiSettings()
            return JSONObject()
                .put("ok", false)
                .put("error", "Open Wi‑Fi settings and join $trimmedSsid")
                .put("openedWifiSettings", true)
        }
        // Do not block the WebView bridge thread — Android shows a connect sheet.
        clearHotspotBinding(disconnectWifi = false)
        mainHandler.post {
            try {
                val specifier = WifiNetworkSpecifier.Builder()
                    .setSsid(trimmedSsid)
                    .setWpa2Passphrase(password)
                    .build()
                val request = NetworkRequest.Builder()
                    .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                    .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .setNetworkSpecifier(specifier)
                    .build()
                val cb = object : ConnectivityManager.NetworkCallback() {
                    override fun onAvailable(network: Network) {
                        mainHandler.post {
                            bindNetwork(network)
                            reconnectSsid = trimmedSsid
                            reconnectCallback = this
                            activity.pushHotspotReconnectResult(
                                JSONObject()
                                    .put("ok", true)
                                    .put("ssid", trimmedSsid),
                            )
                        }
                    }

                    override fun onUnavailable() {
                        mainHandler.post {
                            if (reconnectCallback === this) reconnectCallback = null
                            // Specifier sheet dismissed / failed — fall back to Settings.
                            openWifiSettings()
                            activity.pushHotspotReconnectResult(
                                JSONObject()
                                    .put("ok", false)
                                    .put("error", "Couldn’t auto-connect — join $trimmedSsid in Wi‑Fi settings")
                                    .put("openedWifiSettings", true)
                                    .put("ssid", trimmedSsid),
                            )
                        }
                    }

                    override fun onLost(network: Network) {
                        mainHandler.post {
                            if (boundNetwork == network) {
                                boundNetwork = null
                                reconnectSsid = null
                                reconnectCallback = null
                                bindNetwork(null)
                            }
                        }
                    }
                }
                reconnectCallback = cb
                connectivity.requestNetwork(request, cb)
            } catch (t: Throwable) {
                openWifiSettings()
                activity.pushHotspotReconnectResult(
                    JSONObject()
                        .put("ok", false)
                        .put("error", t.message?.take(120) ?: "Connect failed")
                        .put("openedWifiSettings", true)
                        .put("ssid", trimmedSsid),
                )
            }
        }
        return JSONObject()
            .put("ok", true)
            .put("pending", true)
            .put("ssid", trimmedSsid)
    }

    fun leaveDirectSession(expectedSsid: String? = null): JSONObject {
        val want = expectedSsid?.trim()?.takeIf { it.isNotEmpty() } ?: reconnectSsid
        val before = currentWifiSsid()
        clearHotspotBinding(disconnectWifi = true, targetSsid = want)
        // Prefer any internet-capable network so Phlip isn't stuck on Soft-AP routing.
        preferInternetNetwork()
        val after = currentWifiSsid()
        val stillOnDirect = when {
            after != null && want != null && after.equals(want, ignoreCase = true) -> true
            after != null && looksLikeDirectSsid(after) -> true
            // SSID hidden but Soft-AP iface still present
            after == null && localOnlyWifiNetwork() != null &&
                (want != null || before == null || looksLikeDirectSsid(before ?: "")) -> true
            else -> false
        }
        // Apps can't reliably forget a manually joined LocalOnlyHotspot — open Wi‑Fi UI.
        if (stillOnDirect) {
            openWifiPanelOrSettings()
            return JSONObject()
                .put("ok", true)
                .put("openedWifiSettings", true)
                .put("stillOnHost", true)
                .put("ssid", after ?: want ?: JSONObject.NULL)
        }
        return JSONObject()
            .put("ok", true)
            .put("openedWifiSettings", false)
            .put("stillOnHost", false)
            .put("ssid", after ?: JSONObject.NULL)
    }

    /** Drop process bind / specifier request. Optionally disconnect Wi‑Fi to return to normal networks. */
    private fun clearHotspotBinding(disconnectWifi: Boolean, targetSsid: String? = null) {
        val ssidToDrop = targetSsid ?: reconnectSsid
        reconnectCallback?.let {
            try { connectivity.unregisterNetworkCallback(it) } catch (_: Exception) {}
        }
        reconnectCallback = null
        reconnectSsid = null
        boundForDiscovery = false
        bindNetwork(null)
        if (!disconnectWifi) return
        val current = currentWifiSsid()
        val shouldDisconnect = when {
            current == null -> true // hidden SSID — still try (best-effort)
            ssidToDrop != null && current.equals(ssidToDrop, ignoreCase = true) -> true
            looksLikeDirectSsid(current) -> true
            else -> ssidToDrop != null
        }
        if (shouldDisconnect) {
            try {
                @Suppress("DEPRECATION")
                wifiManager.disconnect()
            } catch (_: Exception) {
            }
        }
    }

    private fun preferInternetNetwork() {
        try {
            val request = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()
            connectivity.requestNetwork(
                request,
                object : ConnectivityManager.NetworkCallback() {
                    override fun onAvailable(network: Network) {
                        mainHandler.post {
                            try {
                                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                                    connectivity.bindProcessToNetwork(network)
                                }
                            } catch (_: Exception) {
                            }
                            try { connectivity.unregisterNetworkCallback(this) } catch (_: Exception) {}
                            // Don't keep process permanently bound — clear so default routing returns.
                            mainHandler.postDelayed({
                                try {
                                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                                        connectivity.bindProcessToNetwork(null)
                                    }
                                } catch (_: Exception) {
                                }
                            }, 1500L)
                        }
                    }

                    override fun onUnavailable() {
                        try { connectivity.unregisterNetworkCallback(this) } catch (_: Exception) {}
                    }
                },
            )
        } catch (_: Exception) {
        }
    }

    private fun openWifiPanelOrSettings() {
        mainHandler.post {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    activity.startActivity(
                        Intent(Settings.Panel.ACTION_WIFI).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    )
                    return@post
                }
            } catch (_: Exception) {
            }
            openWifiSettings()
        }
    }

    fun hotspotJoinStatus(): JSONObject {
        val ssid = currentWifiSsid()
        val watching = watchSsid
        val bound = boundNetwork != null
        val onReconnect = reconnectSsid != null &&
            (ssid?.equals(reconnectSsid, ignoreCase = true) == true)
        // Soft-AP only: Wi‑Fi without INTERNET. Never treat unknown SSID on any
        // Wi‑Fi as Direct — that bricked clients on normal home networks.
        val softAp = softApOnlyNetwork() != null
        val onDirectIface = softAp && ssid != null && looksLikeDirectSsid(ssid)
        return JSONObject()
            .put("watching", watching != null)
            .put("watchSsid", watching ?: JSONObject.NULL)
            .put("connectedSsid", ssid ?: JSONObject.NULL)
            .put("bound", bound)
            .put("reconnectSsid", reconnectSsid ?: JSONObject.NULL)
            .put("onWatchNetwork", watching != null && ssid?.equals(watching, ignoreCase = true) == true)
            .put(
                "onHostHotspot",
                onReconnect ||
                    onDirectIface ||
                    (ssid != null && looksLikeDirectSsid(ssid)),
            )
    }

    private fun looksLikeDirectSsid(ssid: String): Boolean {
        val s = ssid.trim()
        return s.startsWith("phlip-", ignoreCase = true) ||
            s.startsWith("AndroidShare_", ignoreCase = true) ||
            s.startsWith("AndroidAP", ignoreCase = true) ||
            s.startsWith("DIRECT-", ignoreCase = true)
    }

    fun isOnSsid(ssid: String): Boolean =
        currentWifiSsid()?.equals(ssid.trim(), ignoreCase = true) == true

    /**
     * LocalOnlyHotspot often has no mDNS and Android keeps using cellular.
     * Bind to the no-internet Wi‑Fi and probe `/ash-ok` on the AP gateway so
     * "Nearby servers" can list the host the same way NSD would on a LAN.
     */
    fun probeNearbyOnDirectWifi(): List<JSONObject> {
        try {
            var last = emptyList<JSONObject>()
            for (attempt in 0 until 3) {
                last = probeNearbyOnce()
                if (last.isNotEmpty()) return last
                if (attempt < 2) {
                    try {
                        Thread.sleep(500L)
                    } catch (_: InterruptedException) {
                        Thread.currentThread().interrupt()
                        return last
                    }
                }
            }
            android.util.Log.w("AshHotspotJoin", "direct-wifi probe found nothing after retries")
            return last
        } finally {
            if (reconnectSsid == null) {
                try { unbindDiscoveryNetwork() } catch (_: Exception) {}
            }
        }
    }

    /**
     * After joining (or already on) a Direct Soft-AP, find the host by [joinTag]
     * via `/ash-ok` on Soft-AP gateways — used for Rejoin when SSID/IP changed.
     */
    fun rediscoverDirectServer(joinTag: String): JSONObject {
        val want = joinTag.trim()
        if (want.isEmpty()) {
            return JSONObject().put("ok", false).put("error", "Missing server id")
        }
        return try {
            var last = emptyList<JSONObject>()
            for (attempt in 0 until 2) {
                last = probeNearbyOnce(quick = true)
                val match = last.firstOrNull { it.optString("sid").trim() == want }
                if (match != null) {
                    return JSONObject()
                        .put("ok", true)
                        .put("sid", match.optString("sid"))
                        .put("name", match.optString("name"))
                        .put("url", match.optString("url"))
                        .put("shareLan", match.optString("shareLan"))
                        .put("ssid", currentWifiSsid().orEmpty())
                }
                if (attempt < 1) {
                    try {
                        Thread.sleep(300L)
                    } catch (_: InterruptedException) {
                        Thread.currentThread().interrupt()
                        break
                    }
                }
            }
            JSONObject()
                .put("ok", false)
                .put("error", "Host not found on this Wi‑Fi yet")
                .put("ssid", currentWifiSsid().orEmpty())
        } finally {
            // Never leave the process bound after a probe — that freezes networking.
            if (reconnectSsid == null) {
                try { unbindDiscoveryNetwork() } catch (_: Exception) {}
            }
        }
    }

    private fun probeNearbyOnce(quick: Boolean = false): List<JSONObject> {
        val wifi = softApOnlyNetwork() ?: localOnlyWifiNetwork()
        if (wifi != null) {
            bindNetwork(wifi)
            boundForDiscovery = true
        }
        val hosts = linkedSetOf<String>()
        hosts.addAll(wifiGatewayIps(wifi))
        hosts.add("192.168.43.1")
        hosts.add("192.168.49.1")
        if (!quick) {
            hosts.add("192.168.43.240")
            hosts.add("192.168.137.1")
        }
        android.util.Log.i(
            "AshHotspotJoin",
            "probing hosts=${hosts.joinToString()} bound=${wifi != null} quick=$quick",
        )
        val found = ArrayList<JSONObject>()
        fun consider(host: String, port: Int): Boolean {
            val meta = fetchAshOk(host, port) ?: return false
            val name = meta.optString("name").ifBlank { "Nearby server" }
            val sid = meta.optString("joinTag")
            val code = meta.optString("code")
            found.add(
                JSONObject()
                    .put("id", "hotspot-$host-$port")
                    .put("sid", sid)
                    .put("name", name)
                    .put("url", "ws://$host:$port/ws")
                    .put("shareLan", "http://$host:$port")
                    .put("code", code)
                    .put("pass", ""),
            )
            return true
        }
        val ports = if (quick) 3000..3002 else 3000..3008
        for (host in hosts) {
            if (consider(host, 3000)) return found
        }
        for (host in hosts) {
            for (port in ports) {
                if (port == 3000) continue
                if (consider(host, port)) return found
            }
        }
        return found
    }

    fun unbindDiscoveryNetwork() {
        if (!boundForDiscovery) return
        if (reconnectSsid != null) return
        boundForDiscovery = false
        bindNetwork(null)
    }

    /** Wi‑Fi Soft-AP / LocalOnlyHotspot — no INTERNET capability. */
    private fun softApOnlyNetwork(): Network? {
        return try {
            connectivity.allNetworks.firstOrNull { n ->
                val caps = connectivity.getNetworkCapabilities(n) ?: return@firstOrNull false
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) &&
                    !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun localOnlyWifiNetwork(): Network? {
        return try {
            softApOnlyNetwork()
                ?: connectivity.allNetworks.firstOrNull { n ->
                    val caps = connectivity.getNetworkCapabilities(n) ?: return@firstOrNull false
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                }
        } catch (_: Exception) {
            null
        }
    }

    @Suppress("DEPRECATION")
    private fun dhcpGatewayIp(): String? {
        return try {
            val gw = wifiManager.dhcpInfo?.gateway ?: return null
            if (gw == 0) return null
            String.format(
                java.util.Locale.US,
                "%d.%d.%d.%d",
                gw and 0xff,
                gw shr 8 and 0xff,
                gw shr 16 and 0xff,
                gw shr 24 and 0xff,
            )
        } catch (_: Exception) {
            null
        }
    }

    private fun wifiGatewayIps(network: Network?): List<String> {
        val out = linkedSetOf<String>()
        dhcpGatewayIp()?.let { ip ->
            out.add(ip)
            val prefix = ip.substringBeforeLast(".", missingDelimiterValue = "")
            if (prefix.isNotEmpty()) {
                out.add("$prefix.1")
                out.add("$prefix.240")
            }
        }
        if (network == null) return out.toList()
        try {
            val lp = connectivity.getLinkProperties(network) ?: return out.toList()
            for (route in lp.routes) {
                val gw = route.gateway ?: continue
                if (gw.isAnyLocalAddress) continue
                val ip = gw.hostAddress?.substringBefore('%') ?: continue
                if (ip.contains(':')) continue
                out.add(ip)
                val prefix = ip.substringBeforeLast(".", missingDelimiterValue = "")
                if (prefix.isNotEmpty()) {
                    out.add("$prefix.1")
                    out.add("$prefix.240")
                }
            }
            for (la in lp.linkAddresses) {
                val addr = la.address
                if (addr !is java.net.Inet4Address || addr.isLoopbackAddress) continue
                val ip = addr.hostAddress ?: continue
                val prefix = ip.substringBeforeLast(".", missingDelimiterValue = "")
                if (prefix.isNotEmpty()) {
                    out.add("$prefix.1")
                    out.add("$prefix.240")
                }
            }
        } catch (_: Exception) {
        }
        return out.toList()
    }

    private fun fetchAshOk(host: String, port: Int): JSONObject? {
        return try {
            val url = java.net.URL("http://$host:$port/ash-ok")
            val conn = (boundNetwork?.openConnection(url) ?: url.openConnection()) as java.net.HttpURLConnection
            conn.connectTimeout = 250
            conn.readTimeout = 250
            conn.requestMethod = "GET"
            conn.instanceFollowRedirects = false
            conn.useCaches = false
            try {
                if (conn.responseCode != 200) return null
                val body = conn.inputStream.bufferedReader().use { it.readText() }
                val json = JSONObject(body)
                if (json.optBoolean("ok")) json else null
            } finally {
                conn.disconnect()
            }
        } catch (t: Exception) {
            android.util.Log.d("AshHotspotJoin", "probe $host:$port failed: ${t.message}")
            null
        }
    }

    private fun checkWatchMatch(foreground: Boolean) {
        val expected = watchSsid ?: return
        if (!currentWifiSsid().equals(expected, ignoreCase = true)) return
        deliverJoinReady(foreground)
        stopWatchHotspotJoin()
    }

    private fun deliverJoinReady(foreground: Boolean) {
        val payload = JSONObject()
            .put("ssid", watchSsid ?: "")
            .put("joinUrl", watchJoinUrl ?: "")
            .put("inviteSlug", watchInviteSlug ?: "")
            .put("serverName", watchServerName ?: "")
        if (foreground) {
            activity.pushHotspotJoinReady(payload)
        } else {
            showJoinReadyNotification(payload)
            activity.pushHotspotJoinReady(payload)
        }
    }

    private fun showJoinReadyNotification(payload: JSONObject) {
        val ctx = activity.applicationContext
        val channelId = "phlip_hotspot_join"
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(channelId, "Direct session join", NotificationManager.IMPORTANCE_HIGH)
                .apply { description = "Prompt when you connect to a host's direct Wi-Fi" },
        )
        val name = payload.optString("serverName").ifEmpty { "host" }
        val joinUrl = payload.optString("joinUrl")
        val inviteSlug = payload.optString("inviteSlug")
        val deepLink = when {
            joinUrl.isNotEmpty() && inviteSlug.isNotEmpty() ->
                "phlip://join?url=${Uri.encode(joinUrl)}&slug=${Uri.encode(inviteSlug)}"
            inviteSlug.isNotEmpty() ->
                "phlip://join?slug=${Uri.encode(inviteSlug)}"
            joinUrl.isNotEmpty() -> "phlip://join?url=${Uri.encode(joinUrl)}"
            else -> "phlip://join"
        }
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(deepLink)).apply {
            setClass(ctx, MainActivity::class.java)
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pi = PendingIntent.getActivity(ctx, 42, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notif = NotificationCompat.Builder(ctx, channelId)
            .setSmallIcon(ctx.applicationInfo.icon)
            .setContentTitle("On $name's network")
            .setContentText("Tap to join the server")
            .setContentIntent(pi)
            .setAutoCancel(true)
            .build()
        nm.notify(JOIN_READY_NOTIF_ID, notif)
    }

    private fun bindNetwork(network: Network?) {
        boundNetwork = network
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                connectivity.bindProcessToNetwork(network)
            } else {
                @Suppress("DEPRECATION")
                ConnectivityManager.setProcessDefaultNetwork(network)
            }
        } catch (_: Exception) {
        }
    }

    @Suppress("DEPRECATION")
    private fun currentWifiSsid(): String? {
        return try {
            val info = wifiManager.connectionInfo ?: return null
            val raw = info.ssid?.trim()?.trim('"').orEmpty()
            when {
                raw.isEmpty() -> null
                raw.equals("<unknown ssid>", ignoreCase = true) -> null
                else -> raw
            }
        } catch (_: Exception) {
            null
        }
    }

    companion object {
        private const val JOIN_READY_NOTIF_ID = 8801
    }
}
