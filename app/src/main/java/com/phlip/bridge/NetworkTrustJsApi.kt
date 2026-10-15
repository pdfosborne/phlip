package com.phlip.bridge

import app.phlip.server.local.ApprovedNetworks
import com.phlip.MainActivity
import com.phlip.SettingsActivity
import org.json.JSONObject

/**
 * Network-trust and share-base calls behind AshNative: which LAN bases may be
 * minted, the client's current Wi‑Fi trust, and host/client approvals.
 */
class NetworkTrustJsApi(
    private val main: MainActivity,
) {
    /**
     * Freshest reachable base for a hosted server's share links:
     * Public mode → HTTPS tunnel URL; Local mode → LAN http://ip:port.
     * [connId] is the client's "srv-local-<rawId>".
     */
    fun shareBaseForServer(connId: String): String {
        val svc = main.hostService ?: return ""
        if (!svc.isRunning()) return ""
        val raw = connId.removePrefix("srv-local-")
        val st = svc.serverStatuses().firstOrNull { it.id == raw } ?: return ""
        if (st.isPublic) {
            st.publicUrl?.takeIf { it.isNotBlank() }?.let { return it }
            st.namedHostname.trim().takeIf { it.isNotEmpty() }?.let { return "https://$it" }
            return ""
        }
        if (!svc.isLanBroadcastAllowed()) return ""
        return st.lanUrls.firstOrNull().orEmpty()
    }

    /** Whether LAN `#lan=` / plaintext Local share bases may be minted (Trusted only). */
    fun lanBroadcastAllowed(): Boolean =
        main.hostService?.isLanBroadcastAllowed() == true

    /** Current Wi‑Fi trust for dual-path client transport (trusted / once / unknown / cellular). */
    fun getNetworkTrust(): String = main.clientTrustLabel()

    /** Record this Wi‑Fi as approved-once after a successful LAN join. */
    fun approveNetworkOnce(): String {
        val fp = main.clientNetworks.currentFingerprint(main) ?: return JSONObject().put("ok", false).toString()
        main.clientNetworks.approve(fp, ApprovedNetworks.Trust.ONCE)
        main.pushClientNetworkTrust()
        return JSONObject().put("ok", true).toString()
    }

    fun approveHostNetwork(trust: String): String {
        val t = when (trust.trim().lowercase()) {
            "trusted", "always", "always_trust", "always-trust" ->
                ApprovedNetworks.Trust.TRUSTED
            else -> ApprovedNetworks.Trust.ONCE
        }
        main.runOnUiThread {
            main.hostService?.approvePendingNetwork(t)
            main.pushHostStatusToWebView()
            main.bridgeHostingIfRunning()
        }
        return JSONObject().put("ok", true).toString()
    }

    fun openApprovedNetworks(): String {
        main.runOnUiThread {
            main.openSettingsScreen(SettingsActivity.SCREEN_HOST_NETWORKS)
        }
        return JSONObject().put("ok", true).toString()
    }

    /**
     * This device's first non-loopback IPv4 (e.g. 192.168.1.5), or "" if it isn't on
     * a network. Lets the client build a LAN share base from the port it's already
     * bridged to, independent of hosting-status plumbing.
     */
    fun lanIp(): String = try {
        java.net.NetworkInterface.getNetworkInterfaces().toList()
            .flatMap { it.inetAddresses.toList() }
            .firstOrNull { !it.isLoopbackAddress && it is java.net.Inet4Address }
            ?.hostAddress?.substringBefore('%').orEmpty()
    } catch (_: Exception) { "" }
}
