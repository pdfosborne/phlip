package com.phlip.hotspot

import android.os.Build
import app.phlip.server.hotspot.HotspotStartResult
import com.phlip.MainActivity
import org.json.JSONObject

/**
 * Host-side Direct (Soft-AP) session control behind the AshNative hotspot calls,
 * plus the permission-gated joiner watch. Runs off the UI thread — LocalOnlyHotspot
 * callbacks need the main looper free.
 */
class HotspotHostSession(
    private val main: MainActivity,
) {
    /** Start a direct hotspot session for [serverId]. Reuses the saved Soft-AP name across End → Start. */
    fun startHotspotSession(serverId: String): String =
        start(serverId.trim(), rotateNetwork = false)

    /** End Direct (if live) and start again with a new Soft-AP name. */
    fun rotateHotspotSession(serverId: String): String =
        start(serverId.trim(), rotateNetwork = true)

    private fun start(serverId: String, rotateNetwork: Boolean): String {
        if (!main.hasHotspotWifiPermission()) {
            main.ensureHotspotLocationPermission { }
            return JSONObject().put("ok", false).put("error", "Wi-Fi permission required — try again")
                .toString()
        }
        // Pre-Tiramisu LocalOnlyHotspot fails with "location mode not enabled" if Location is off.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU && !main.isSystemLocationEnabled()) {
            main.openSystemLocationSettings()
            return JSONObject()
                .put("ok", false)
                .put("error", "Turn on Location in Settings, then try Start direct session again")
                .put("needsLocation", true)
                .toString()
        }
        val result = JSONObject().put("ok", false).put("error", "Start hosting first")
        try {
            val svc = main.hostService
            if (svc == null || !svc.isRunning()) {
                return result.toString()
            }
            val out = if (rotateNetwork) {
                svc.rotateDirectSession(serverId)
            } else {
                svc.startDirectSession(serverId, rotateNetwork = false)
            }
            when (out) {
                is HotspotStartResult.Started -> {
                    val info = out.info
                    val systemSsid = info.ssid.startsWith("AndroidShare_", ignoreCase = true)
                    result.put("ok", true)
                        .put("serverId", info.serverId)
                        .put("ssid", info.ssid)
                        .put("password", info.password)
                        .put("qrUri", info.qrUri)
                        .put("gatewayIp", info.gatewayIp)
                        .put("lanUrl", info.lanUrl)
                        .put("joinCode", info.joinCode)
                        .put("systemSsid", systemSsid)
                        .remove("error")
                    if (systemSsid) {
                        android.util.Log.w("AshMain", "Direct Soft-AP used system name ${info.ssid}")
                    }
                    main.runOnUiThread {
                        main.pushHostStatusToWebView()
                        main.pushHotspotSessionToWebView()
                        main.bridgeHostingIfRunning()
                    }
                }
                is HotspotStartResult.Failed -> {
                    val err = out.error
                    val needsLoc = err.contains("location", ignoreCase = true)
                    result.put("ok", false).put("error",
                        if (needsLoc) {
                            "Turn on Location in Settings, then try Start direct session again"
                        } else err
                    )
                    if (needsLoc) {
                        result.put("needsLocation", true)
                        main.openSystemLocationSettings()
                    }
                }
            }
        } catch (t: Throwable) {
            val msg = t.message?.take(120) ?: "Could not start session"
            val needsLoc = msg.contains("location", ignoreCase = true)
            result.put("ok", false).put("error",
                if (needsLoc) {
                    "Turn on Location in Settings, then try Start direct session again"
                } else msg
            )
            if (needsLoc) {
                result.put("needsLocation", true)
                main.openSystemLocationSettings()
            }
        }
        return result.toString()
    }

    fun endHotspotSession(): String {
        // Close reservation off the UI thread so close() can finish before the next start.
        try {
            main.hostService?.endDirectSession()
        } catch (_: Throwable) {
        }
        main.runOnUiThread {
            main.pushHostStatusToWebView()
            main.pushHotspotSessionToWebView()
            main.bridgeHostingIfRunning()
        }
        return JSONObject().put("ok", true).toString()
    }

    fun hotspotSessionStatus(): String {
        val svc = main.hostService
        val info = if (svc != null && svc.isRunning()) svc.hotspotSessionInfo() else null
        return if (info == null) {
            JSONObject().put("active", false).toString()
        } else {
            JSONObject()
                .put("active", true)
                .put("serverId", info.serverId)
                .put("serverName", info.serverName)
                .put("ssid", info.ssid)
                .put("password", info.password)
                .put("qrUri", info.qrUri)
                .put("gatewayIp", info.gatewayIp)
                .put("lanUrl", info.lanUrl)
                .put("joinCode", info.joinCode)
                .put("startedAt", info.startedAt)
                .toString()
        }
    }

    fun openWifiSettings(): String {
        main.hotspotJoin.openWifiSettings()
        return JSONObject().put("ok", true).toString()
    }

    fun openLocationSettings(): String {
        main.openSystemLocationSettings()
        return JSONObject().put("ok", true).toString()
    }

    /** Joiner side: watch for the Soft-AP SSID once Wi‑Fi permission is in place. */
    fun watchHotspotJoin(ssid: String, joinUrl: String, serverName: String): String {
        if (!main.hasHotspotWifiPermission()) {
            main.ensureHotspotLocationPermission { }
            return JSONObject().put("ok", false).put("error", "Wi-Fi permission required — try again")
                .toString()
        }
        return main.hotspotJoin.watchHotspotJoin(
            ssid = ssid,
            joinUrl = joinUrl,
            inviteSlug = null,
            serverName = serverName,
        ).toString()
    }
}
