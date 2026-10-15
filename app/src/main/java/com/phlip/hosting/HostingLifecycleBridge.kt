package com.phlip.hosting

import android.content.Context
import app.phlip.server.HostService
import app.phlip.server.ServerRegistry
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Hands the page a live connection to hosting running on this same device, and
 *  cleans up host data files left behind after a registry wipe. */
class HostingLifecycleBridge(
    private val context: Context,
    private val hostService: () -> HostService?,
    private val isBound: () -> Boolean,
    private val postCoalescedWebUpdate: (key: String, js: String) -> Unit,
    private val pushPendingJoinQueueToWebView: () -> Unit,
) {

    /** Hand the page the full set of servers this device is hosting so each appears
     *  in the client rail; ones no longer hosted are dropped. Idempotent
     *  (window.ashSyncServers reconciles), so safe to call repeatedly as hosting
     *  starts/stops/servers are created while the activity is alive. */
    fun bridgeHostingIfRunning() {
        if (!isBound()) return
        val svc = hostService()
        val infos = if (svc != null && svc.isRunning()) svc.bridgeInfos() else emptyList()
        // Shareable bases (for /s/<id> share links) keyed by raw server id.
        val statuses = if (svc != null && svc.isRunning()) svc.serverStatuses() else emptyList()
        val arr = JSONArray()
        for (b in infos) {
            val st = statuses.firstOrNull { it.id == b.id }
            arr.put(JSONObject()
                .put("id", ServerRegistry.bridgeId(b.id))
                .put("url", "ws://127.0.0.1:${b.port}/ws")
                .put("name", b.name)
                .put("token", b.token)
                .put("pass", b.passphrase)
                // Where friends can actually reach this server, so the client can
                // build a self-contained share link off-device.
                .put("lanUrl", st?.lanUrls?.firstOrNull() ?: "")
                .put("publicUrl", st?.publicUrl ?: "")
                // Hosting mode for the rail Local/Public glyph (not only when tunnel URL is ready).
                .put("isPublic", st?.isPublic == true)
                .put("joinTag", st?.joinTag ?: "")
                .put("shareCode", st?.shareCode ?: "")
                .put("inviteCode", st?.inviteCode ?: "")
                .put("inviteExpiry", st?.inviteExpiry ?: 0L)
                .put("inviteSlug", st?.inviteSlug ?: "")
                .put("inviteUrl", st?.inviteUrl ?: "")
                .put("reachMode", st?.reachMode ?: "local")
                .put("hotspotActive", st?.hotspotActive == true)
                .put("hotspotSsid", st?.hotspotSsid ?: "")
                .put("hotspotLanUrl", st?.hotspotLanUrl ?: "")
                .put("hotspotRadioLive", st?.hotspotRadioLive != false)
                .put("hotspotRadioNote", st?.hotspotRadioNote ?: "")
                .put("pending", JSONArray().also { arrPend ->
                    for (p in st?.pending.orEmpty()) {
                        arrPend.put(
                            JSONObject()
                                .put("id", p.id)
                                .put("name", p.name)
                                .put("ts", p.ts)
                                .also { o ->
                                    p.invitedByName?.takeIf { it.isNotEmpty() }?.let { o.put("invitedByName", it) }
                                    p.invitedByUserId?.takeIf { it.isNotEmpty() }?.let { o.put("invitedByUserId", it) }
                                    p.inviteSlug?.takeIf { it.isNotEmpty() }?.let { o.put("inviteSlug", it) }
                                },
                        )
                    }
                }))
        }
        postCoalescedWebUpdate("hosted-servers", "window.ashSyncServers && window.ashSyncServers($arr)")
        pushPendingJoinQueueToWebView()
    }

    /** After registry wipe, remove any leftover host data files under filesDir. */
    fun sweepLeftoverHostDataFiles() {
        try {
            val dir = context.filesDir ?: return
            dir.listFiles()?.forEach { f ->
                val n = f.name
                if (n == "servers.json" || n == "data.json"
                    || (n.startsWith("data_") && n.endsWith(".json"))
                ) {
                    try {
                        f.delete()
                    } catch (_: Exception) {
                    }
                }
            }
            val cards = File(dir, "event-cards")
            if (cards.exists()) {
                try {
                    cards.deleteRecursively()
                } catch (_: Exception) {
                }
            }
        } catch (_: Exception) {
        }
    }
}
