package com.phlip.join

import android.webkit.WebView
import org.json.JSONObject

/** Delivers pending join/pass payloads once the WebView page is ready. */
class PendingPrefillDelivery(
    private val capture: JoinIntentCapture,
    private val isPageReady: () -> Boolean,
    private val webView: () -> WebView?,
) {
    var deliveryInFlight = false

    fun deliverAll() {
        deliverPendingEventPass()
        val slug = capture.pendingInviteSlug
        val text = capture.pendingJoinPrefill
        if (slug == null && text == null) return
        val wv = webView() ?: return
        if (!isPageReady() || deliveryInFlight) return
        val prefill = capture.combinePrefill() ?: return
        deliveryInFlight = true
        wv.post {
            val quoted = JSONObject.quote(prefill)
            wv.evaluateJavascript(
                "(function(){try{if(typeof window.ashJoinFromUrl!=='function')return false;" +
                    "window.ashJoinFromUrl($quoted);return true;}catch(e){return false;}})()",
            ) { accepted ->
                deliveryInFlight = false
                if (accepted == "true") {
                    if (capture.pendingInviteSlug == slug) capture.pendingInviteSlug = null
                    if (capture.pendingJoinPrefill == text) capture.pendingJoinPrefill = null
                    deliverAll()
                } else {
                    // The page may have finished before its deferred scripts. Keep
                    // the atomic prefill and retry once the callback is installed.
                    wv.postDelayed({ deliverAll() }, 150L)
                }
            }
        }
    }

    private fun deliverPendingEventPass() {
        val text = capture.pendingEventPass ?: return
        val wv = webView() ?: return
        if (!isPageReady()) return
        capture.pendingEventPass = null
        val quoted = JSONObject.quote(text)
        wv.post {
            wv.evaluateJavascript(
                "window.ashReceiveEventPass && window.ashReceiveEventPass($quoted)",
                null,
            )
        }
    }

    fun resetFlight() {
        deliveryInFlight = false
    }
}
