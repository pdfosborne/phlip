package com.phlip.join

import android.app.Activity
import android.webkit.WebView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import app.phlip.server.HostService
import app.phlip.server.PendingInfo
import app.phlip.server.ServerRegistry
import com.phlip.PendingJoinMessages
import org.json.JSONArray
import org.json.JSONObject

/** In-app Approve/Deny dialogs + push of the live pending-join queue to the WebView. */
class PendingJoinDialogHost(
    private val activity: Activity,
    private val hostService: () -> HostService?,
    private val webView: () -> WebView?,
    private val webPageReady: () -> Boolean,
    private val postCoalescedWebUpdate: (key: String, js: String) -> Unit,
) {
    private val shownJoinDialogs = HashSet<String>()
    private var joinDialog: AlertDialog? = null
    private var joinDialogKey: String? = null

    /** In-app Approve/Deny dialog when someone is waiting (stays until you choose).
     *  Auto-dismisses if an admin already approved/denied the same request. */
    fun showPendingJoinDialogs() {
        val svc = hostService() ?: return
        if (!svc.isRunning() || activity.isFinishing) return
        val pending = svc.serverStatuses().flatMap { s -> s.pending.map { s to it } }
        val pendingKeys = pending.map { (s, p) -> "${s.id}:${p.id}" }.toSet()

        val open = joinDialog
        val openKey = joinDialogKey
        if (open?.isShowing == true && openKey != null) {
            if (openKey in pendingKeys) return
            // Cleared elsewhere (e.g. admin Approve in People).
            open.dismiss()
            joinDialog = null
            joinDialogKey = null
            shownJoinDialogs.remove(openKey)
        } else if (open?.isShowing == true) {
            return
        }

        val next = pending.firstOrNull { (s, p) -> "${s.id}:${p.id}" !in shownJoinDialogs } ?: return
        val (server, p) = next
        val key = "${server.id}:${p.id}"
        shownJoinDialogs.add(key)
        joinDialogKey = key
        val wv = webView()
        joinDialog = AlertDialog.Builder(activity)
            .setTitle("Someone wants to join")
            .setMessage(pendingJoinMessage(server.name, p))
            .setPositiveButton("Approve") { _, _ ->
                val ok = svc.approve(server.id, p.id)
                joinDialog = null
                joinDialogKey = null
                shownJoinDialogs.remove(key)
                Toast.makeText(
                    activity,
                    if (ok) "Approved — they can finish joining now"
                    else "That join request expired — ask them to try again",
                    Toast.LENGTH_SHORT,
                ).show()
                // Native Approve bypasses the WebView socket — sync People pending from HostService.
                if (ok) pushPendingJoinQueueToWebView()
                wv?.post { showPendingJoinDialogs() }
            }
            .setNegativeButton("Deny") { _, _ ->
                svc.deny(server.id, p.id)
                joinDialog = null
                joinDialogKey = null
                shownJoinDialogs.remove(key)
                pushPendingJoinQueueToWebView()
                wv?.post { showPendingJoinDialogs() }
            }
            .setCancelable(false)
            .show()
    }

    /**
     * Native Approve/Deny (popup / Settings) bypasses the WebView socket, so People
     * can keep a stale "Waiting to join" row. Push the live queue from HostService.
     */
    fun pushPendingJoinQueueToWebView() {
        if (webView() == null || !webPageReady()) return
        val svc = hostService() ?: return
        val arr = JSONArray()
        val statuses = if (svc.isRunning()) svc.serverStatuses() else emptyList()
        for (st in statuses) {
            val pending = JSONArray()
            for (p in st.pending) {
                pending.put(
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
            arr.put(
                JSONObject()
                    .put("id", ServerRegistry.bridgeId(st.id))
                    .put("pending", pending),
            )
        }
        val js = "window.ashSyncPending && window.ashSyncPending($arr)"
        postCoalescedWebUpdate("pending-joins", js)
    }

    private fun pendingJoinMessage(serverName: String, p: PendingInfo): String =
        PendingJoinMessages.format(serverName, p.name, p.invitedByName)
}
