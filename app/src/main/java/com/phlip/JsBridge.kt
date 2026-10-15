package com.phlip

import android.content.Context
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.webkit.JavascriptInterface
import org.json.JSONObject
import com.phlip.backup.PersonalBackupBridge
import com.phlip.backup.ServerBackupBridge
import com.phlip.bridge.CalendarJsApi
import com.phlip.bridge.DeviceSecretStore
import com.phlip.bridge.HostingJsApi
import com.phlip.bridge.NetworkTrustJsApi
import com.phlip.bridge.TimePickerJsApi
import com.phlip.hotspot.HotspotHostSession
import com.phlip.media.ShareCardStore

/**
 * window.AshNative — the JS bridge surface. This class stays a thin facade: every
 * method here is the `@JavascriptInterface` contract the web client calls, and the
 * work lives in the helpers below (long work off the JS thread).
 */
class JsBridge(
    private val main: MainActivity,
) {
    private val shareCards = ShareCardStore(main, main.clientIo)
    private val personalBackup = PersonalBackupBridge(main)
    private val serverBackup = ServerBackupBridge(main)
    private val networkTrust = NetworkTrustJsApi(main)
    private val hosting = HostingJsApi(main)
    private val hotspotHost = HotspotHostSession(main)
    private val secrets = DeviceSecretStore(main)
    private val calendar = CalendarJsApi(main)
    private val timePicker = TimePickerJsApi(main)

    @JavascriptInterface
    fun hideKeyboard() {
        main.runOnUiThread {
            val imm = main.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
            val token = main.webView.windowToken
            if (token != null) imm?.hideSoftInputFromWindow(token, 0)
            main.webView.clearFocus()
            main.currentFocus?.clearFocus()
        }
    }

    /** Overlay the IME instead of shrinking the WebView (timeline expanded sheet). */
    @JavascriptInterface
    fun setKeyboardOverlay(overlay: Boolean) {
        main.runOnUiThread {
            val mode = if (overlay) {
                WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING
            } else {
                WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
            }
            main.window.setSoftInputMode(mode)
        }
    }

    @JavascriptInterface
    fun imeInsetPx(): Int = main.liveImeInsetPx()

    @JavascriptInterface
    fun startDiscovery() { main.runOnUiThread { main.startDiscovery() } }
    @JavascriptInterface
    fun stopDiscovery() { main.runOnUiThread { main.stopDiscovery() } }

    /** NSD resolve for joined-member LAN refresh (trusted Wi‑Fi). Returns JSON { ok, url, shareLan, sid }. */
    @JavascriptInterface
    fun resolveJoinTag(joinTag: String, timeoutMs: Int): String =
        main.resolveJoinTagBlocking(joinTag, timeoutMs)

    @JavascriptInterface
    fun startMemberDiscovery() { main.runOnUiThread { main.startMemberDiscovery() } }

    @JavascriptInterface
    fun stopMemberDiscovery() { main.runOnUiThread { main.stopMemberDiscovery() } }

    // ── share cards / clipboard (com.phlip.media) ──

    @JavascriptInterface
    fun shareImage(base64Png: String, caption: String) = shareCards.shareImage(base64Png, caption)

    @JavascriptInterface
    fun saveImage(base64Png: String) = shareCards.saveImage(base64Png)

    @JavascriptInterface
    fun cacheEventCard(eventId: String, base64Png: String) = shareCards.cacheEventCard(eventId, base64Png)

    @JavascriptInterface
    fun shareText(text: String) = shareCards.shareText(text)

    @JavascriptInterface
    fun openCalendarIcs(ics: String, filename: String) = shareCards.openCalendarIcs(ics, filename)

    @JavascriptInterface
    fun readClipboardText(): String = shareCards.readClipboardText()

    /**
     * Follow a map short link (maps.app.goo.gl and the like) to its destination.
     * Returns JSON `{url, name}` or "" when the address is not a map link.
     * The WebView cannot expand these itself (CORS). Only https map hosts are followed.
     */
    @JavascriptInterface
    fun expandMapLink(raw: String): String = expandMapLinkBlocking(raw)

    // ── network trust / share bases (com.phlip.bridge) ──

    @JavascriptInterface
    fun shareBaseForServer(connId: String): String = networkTrust.shareBaseForServer(connId)

    @JavascriptInterface
    fun lanBroadcastAllowed(): Boolean = networkTrust.lanBroadcastAllowed()

    @JavascriptInterface
    fun getNetworkTrust(): String = networkTrust.getNetworkTrust()

    @JavascriptInterface
    fun approveNetworkOnce(): String = networkTrust.approveNetworkOnce()

    @JavascriptInterface
    fun approveHostNetwork(trust: String): String = networkTrust.approveHostNetwork(trust)

    @JavascriptInterface
    fun openApprovedNetworks(): String = networkTrust.openApprovedNetworks()

    @JavascriptInterface
    fun lanIp(): String = networkTrust.lanIp()

    @JavascriptInterface
    fun pickImage() {
        main.runOnUiThread {
            try { main.pickImageLauncher.launch("image/*") } catch (_: Exception) { main.deliverPickedImage(null) }
        }
    }

    // ── backups (com.phlip.backup) ──

    /**
     * Tier 1 personal backup — write passphrase envelope via SAF CreateDocument.
     * Result: `window.__ashOnBackupExport(boolean)`.
     */
    @JavascriptInterface
    fun exportPersonalBackup(body: String, suggestedName: String) =
        personalBackup.exportPersonalBackup(body, suggestedName)

    /**
     * Tier 1 personal backup — pick a `.phlip` file via SAF.
     * Result: `window.__ashOnBackupImport(string|null)`.
     */
    @JavascriptInterface
    fun importPersonalBackup() = personalBackup.importPersonalBackup()

    /**
     * Host-only server backup export. Builds+seals on a background thread, then SAF.
     * Result: `window.__ashOnServerBackupExport(boolean)`.
     */
    @JavascriptInterface
    fun exportServerBackup(serverId: String, kind: String, passphrase: String, suggestedName: String) =
        serverBackup.exportServerBackup(serverId, kind, passphrase, suggestedName)

    @JavascriptInterface
    fun serverBackupSuggestedName(serverId: String, kind: String): String =
        serverBackup.serverBackupSuggestedName(serverId, kind)

    /** Pick a server `.phlip` file. Result: `window.__ashOnServerBackupPicked(boolean)`. */
    @JavascriptInterface
    fun importServerBackup() = serverBackup.importServerBackup()

    /**
     * Unlock the picked server backup. Returns JSON:
     * `{ok,kind,exportedAt,serverId,serverName,channelCount,eventTypeCount,memberCount,eventCount,error?}`.
     */
    @JavascriptInterface
    fun unlockServerBackup(passphrase: String): String = serverBackup.unlockServerBackup(passphrase)

    /**
     * Apply unlocked structure backup.
     * Empty [targetServerId] + [newServerName] → create new server.
     */
    @JavascriptInterface
    fun applyServerStructureBackup(
        targetServerId: String,
        newServerName: String,
        hostDisplayName: String,
    ): String = serverBackup.applyServerStructureBackup(targetServerId, newServerName, hostDisplayName)

    /** Same-ID full replace from unlocked payload. */
    @JavascriptInterface
    fun applyServerFullBackup(): String = serverBackup.applyServerFullBackup()

    // ── hosting (com.phlip.bridge) ──

    /** App settings formerly on the ⋮ overflow — now opened from the info panel. */
    @JavascriptInterface
    fun openAppSettings(screen: String) = hosting.openAppSettings(screen)

    /** Full Host settings snapshot for the right info panel. */
    @JavascriptInterface
    fun hostStatus(): String = hosting.hostStatus()

    /** Android can host on-device; iOS join-only returns false. */
    @JavascriptInterface
    fun hostingAvailable(): Boolean = true

    @JavascriptInterface
    fun startHosting(): String = hosting.startHosting()

    @JavascriptInterface
    fun stopHosting(): String = hosting.stopHosting()

    @JavascriptInterface
    fun createServer(name: String, preset: String, activityLabel: String, hostName: String): String =
        hosting.createServer(name, preset, activityLabel, hostName)

    @JavascriptInterface
    fun deleteHostedServer(serverId: String): String = hosting.deleteHostedServer(serverId)

    /**
     * Factory reset — wipe all hosted servers + host prefs / Cloudflare / identity.
     * Client clears WebView storage and reloads after this returns.
     */
    @JavascriptInterface
    fun factoryReset(): String = hosting.factoryReset()

    @JavascriptInterface
    fun setForceJoinCode(serverId: String, enabled: Boolean): String =
        hosting.setForceJoinCode(serverId, enabled)

    @JavascriptInterface
    fun triggerCodeRequest(serverId: String): String = hosting.triggerCodeRequest(serverId)

    @JavascriptInterface
    fun setPublicHosting(serverId: String, enabled: Boolean): String =
        hosting.setPublicHosting(serverId, enabled)

    /** Lock near-field to Local STA Wi‑Fi or Direct Soft-AP (mutually exclusive). */
    @JavascriptInterface
    fun setReachMode(serverId: String, mode: String): String = hosting.setReachMode(serverId, mode)

    @JavascriptInterface
    fun returnServerToDeviceOnly(serverId: String): String = hosting.returnServerToDeviceOnly(serverId)

    @JavascriptInterface
    fun regenerateInvite(serverId: String): String = hosting.regenerateInvite(serverId)

    @JavascriptInterface
    fun hostInviteLink(serverId: String): String = hosting.hostInviteLink(serverId)

    @JavascriptInterface
    fun rotateHostInviteLink(serverId: String): String = hosting.rotateHostInviteLink(serverId)

    @JavascriptInterface
    fun approveJoin(serverId: String, requestId: String): String = hosting.approveJoin(serverId, requestId)

    @JavascriptInterface
    fun denyJoin(serverId: String, requestId: String): String = hosting.denyJoin(serverId, requestId)

    @JavascriptInterface
    fun acceptHostRules(): String = hosting.acceptHostRules()

    @JavascriptInterface
    fun acceptAlphaAck(): String = hosting.acceptAlphaAck()

    @JavascriptInterface
    fun acceptLocalPrep(): String = hosting.acceptLocalPrep()

    @JavascriptInterface
    fun acceptDevicePrep(): String = hosting.acceptDevicePrep()

    @JavascriptInterface
    fun acceptPatchWarning(): String = hosting.acceptPatchWarning()

    @JavascriptInterface
    fun acceptOperatorAck(): String = hosting.acceptOperatorAck()

    @JavascriptInterface
    fun acceptDataAck(): String = hosting.acceptDataAck()

    @JavascriptInterface
    fun acceptPublicRiskAck(): String = hosting.acceptPublicRiskAck()

    @JavascriptInterface
    fun setSecurityRejectLog(enabled: Boolean): String = hosting.setSecurityRejectLog(enabled)

    /** Opens native Cloudflare domain / API setup (skips Host setup hub). */
    @JavascriptInterface
    fun openCloudflareSetup() = hosting.openCloudflareSetup()

    /** Opens the host-facing Cloudflare HSTS instructions directly. */
    @JavascriptInterface
    fun openCloudflareSecurityGuide() = hosting.openCloudflareSecurityGuide()

    /** Refresh remote version policy + optional Play flexible update prompt. */
    @JavascriptInterface
    fun checkHostUpdates(): String = hosting.checkHostUpdates()

    // ── Direct / hotspot (com.phlip.hotspot) ──

    /** Start a direct hotspot session for [serverId]. Host-side only. */
    @JavascriptInterface
    fun startHotspotSession(serverId: String): String = hotspotHost.startHotspotSession(serverId)

    /** End Direct (if live) and start again with a new Soft-AP name. */
    @JavascriptInterface
    fun rotateHotspotSession(serverId: String): String = hotspotHost.rotateHotspotSession(serverId)

    @JavascriptInterface
    fun endHotspotSession(): String = hotspotHost.endHotspotSession()

    @JavascriptInterface
    fun hotspotSessionStatus(): String = hotspotHost.hotspotSessionStatus()

    @JavascriptInterface
    fun openWifiSettings(): String = hotspotHost.openWifiSettings()

    @JavascriptInterface
    fun openLocationSettings(): String = hotspotHost.openLocationSettings()

    /** joinCode is kept for JS signature compat; rotating codes are no longer required. */
    @JavascriptInterface
    @Suppress("UNUSED_PARAMETER")
    fun watchHotspotJoin(ssid: String, joinUrl: String, joinCode: String, serverName: String): String =
        hotspotHost.watchHotspotJoin(ssid, joinUrl, serverName)

    @JavascriptInterface
    fun stopWatchHotspotJoin(): String = main.hotspotJoin.stopWatchHotspotJoin().toString()

    @JavascriptInterface
    fun reconnectToHotspot(ssid: String, password: String): String =
        main.hotspotJoin.reconnectToHotspot(ssid, password).toString()

    @JavascriptInterface
    fun leaveDirectSession(expectedSsid: String = ""): String =
        main.hotspotJoin.leaveDirectSession(expectedSsid.ifBlank { null }).toString()

    @JavascriptInterface
    fun hotspotJoinStatus(): String = main.hotspotJoin.hotspotJoinStatus().toString()

    /** Probe Soft-AP gateway for a joined server by joinTag after Direct Wi‑Fi change. */
    @JavascriptInterface
    fun rediscoverDirectServer(joinTag: String): String =
        main.hotspotJoin.rediscoverDirectServer(joinTag).toString()

    /** Light/dark from the web client — keeps the Android status + nav bars in sync. */
    @JavascriptInterface
    fun setUiTheme(theme: String) {
        val dark = theme.equals("dark", ignoreCase = true)
        main.runOnUiThread {
            main.getSharedPreferences(MainActivity.PREFS_UI, Context.MODE_PRIVATE)
                .edit()
                .putString(MainActivity.KEY_UI_THEME, if (dark) "dark" else "light")
                .apply()
            main.applySystemBarsForTheme(dark)
        }
    }

    // ── device secrets / calendar (com.phlip.bridge) ──

    /** 016 — seal small identity secrets (private key JWK) in Android Keystore. */
    @JavascriptInterface
    fun putDeviceSecret(alias: String, value: String): Boolean = secrets.putDeviceSecret(alias, value)

    @JavascriptInterface
    fun getDeviceSecret(alias: String): String = secrets.getDeviceSecret(alias)

    @JavascriptInterface
    fun removeDeviceSecret(alias: String): Boolean = secrets.removeDeviceSecret(alias)

    /** 022 / T4.3 — calendar read permission (device-calendar import). */
    @JavascriptInterface
    fun hasCalendarPermission(): Boolean = calendar.hasCalendarPermission()

    /**
     * Request READ_CALENDAR. Result delivered to `window.__ashOnCalendarPermission(boolean)`.
     * Must run on the UI thread for the system dialog.
     */
    @JavascriptInterface
    fun requestCalendarPermission() = calendar.requestCalendarPermission()

    @JavascriptInterface
    fun importDeviceCalendar(requestId: String) = calendar.importDeviceCalendar(requestId)

    @JavascriptInterface
    fun importDeviceCalendarFiltered(requestId: String, optionsJson: String) =
        calendar.importDeviceCalendarFiltered(requestId, optionsJson)

    @JavascriptInterface
    fun listDeviceCalendars(requestId: String) = calendar.listDeviceCalendars(requestId)

    /**
     * System time picker. Result: `window.__ashOnTimePicked(requestId, hour, minute)`
     * (hour/minute null on cancel).
     */
    @JavascriptInterface
    fun pickTime(hour: Int, minute: Int, requestId: String) =
        timePicker.pickTime(hour, minute, requestId)
}

private const val MAP_LINK_UA =
    "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"

/** Expand one map URL. Blocking; called on the JavaBridge thread. */
private fun expandMapLinkBlocking(raw: String): String {
    val start = raw.trim()
    if (!start.startsWith("https://") || !mapHostAllowed(start, startOnly = true)) return ""
    return try {
        var current = start
        var hops = 0
        while (hops < 5) {
            val url = java.net.URL(current)
            val conn = (url.openConnection() as java.net.HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = 6_000
                readTimeout = 6_000
                setRequestProperty("User-Agent", MAP_LINK_UA)
                setRequestProperty("Accept", "text/html")
                setRequestProperty("Accept-Language", "en")
                requestMethod = "GET"
            }
            try {
                val code = conn.responseCode
                if (code in 300..399) {
                    val loc = conn.getHeaderField("Location") ?: break
                    val next = java.net.URL(url, loc).toString()
                    if (!next.startsWith("https://") || !mapHostAllowed(next, startOnly = false)) break
                    if (next.contains("/maps/place/") || next.contains("/maps/search/")) {
                        return JSONObject().put("url", next).put("name", "").toString()
                    }
                    current = next
                    hops++
                    continue
                }
                if (code !in 200..299) break
                val title = mapTitleFromHtml(conn.inputStream)
                val landed = conn.url?.toString()?.takeIf { it.startsWith("https://") } ?: current
                if (!mapHostAllowed(landed, startOnly = true)) break
                return JSONObject().put("url", landed).put("name", title).toString()
            } finally {
                conn.disconnect()
            }
        }
        if (mapHostAllowed(current, startOnly = true)) {
            JSONObject().put("url", current).put("name", "").toString()
        } else ""
    } catch (_: Exception) {
        ""
    }
}

private fun mapHostAllowed(raw: String, startOnly: Boolean): Boolean {
    val url = try { java.net.URL(raw) } catch (_: Exception) { return false }
    val host = url.host.lowercase().removePrefix("www.")
    val path = url.path.lowercase()
    if (host == "maps.app.goo.gl") return true
    if (host == "goo.gl") return path.startsWith("/maps")
    if (host == "maps.apple.com" || host == "osm.org") return true
    if (host == "openstreetmap.org" || host.endsWith(".openstreetmap.org")) return true
    if (host == "maps.google.com" || host.startsWith("maps.google.")) return true
    val google = host == "google.com" || host.endsWith(".google.com") || host.contains(".google.")
    if (!google) return false
    if (!startOnly) return true
    return path.contains("/maps")
}

private fun mapTitleFromHtml(stream: java.io.InputStream): String {
    val text = stream.bufferedReader().use { reader ->
        val buf = CharArray(64_000)
        val n = reader.read(buf)
        if (n <= 0) "" else String(buf, 0, n)
    }
    val og = Regex("""property=["']og:title["'][^>]*content=["']([^"']+)["']""", RegexOption.IGNORE_CASE)
        .find(text)?.groupValues?.getOrNull(1)
        ?: Regex("""content=["']([^"']+)["'][^>]*property=["']og:title["']""", RegexOption.IGNORE_CASE)
            .find(text)?.groupValues?.getOrNull(1)
    val raw = og ?: Regex("""<title>([^<]{1,180})</title>""", RegexOption.IGNORE_CASE)
        .find(text)?.groupValues?.getOrNull(1)
    return cleanMapPageTitle(raw.orEmpty())
}

private fun cleanMapPageTitle(raw: String): String {
    var s = raw
        .replace("&amp;", "&")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&quot;", "\"")
        .replace("\n", " ")
        .replace(Regex("\\s+"), " ")
        .trim()
    s = s.replace(Regex("""\s*[|·–—-]\s*Google Maps.*$""", RegexOption.IGNORE_CASE), "").trim()
    if (s.isEmpty() || s.equals("Google Maps", ignoreCase = true)) return ""
    if (s.length > 80) {
        val head = s.substringBefore(",").trim()
        if (head.length in 2..80 && !head.equals("Google Maps", ignoreCase = true)) return head
        return ""
    }
    return s
}
