package com.phlip.webview

import android.webkit.WebView

/**
 * Status/discovery updates are latest-value wins. Promise callbacks and picker/
 * backup replies intentionally do not use this path, so their ordering remains
 * exact. Draining one update per UI-loop turn prevents a host-status burst from
 * monopolising WebView's JavaScript queue.
 */
class WebViewUpdateCoalescer(
    private val isAlive: () -> Boolean,
    private val webView: () -> WebView?,
) {
    private val lock = Any()
    private val pending = mutableMapOf<String, String>()
    private var drainScheduled = false

    fun post(key: String, javascript: String) {
        val wv = webView() ?: return
        if (!isAlive()) return
        synchronized(lock) {
            pending[key] = javascript
            if (drainScheduled) return
            drainScheduled = true
        }
        wv.post { drain() }
    }

    fun clear() {
        synchronized(lock) {
            pending.clear()
            drainScheduled = false
        }
    }

    private fun drain() {
        if (!isAlive()) {
            clear()
            return
        }
        val wv = webView() ?: run {
            clear()
            return
        }
        val javascript = synchronized(lock) {
            val entry = pending.entries.firstOrNull()
            if (entry == null) {
                drainScheduled = false
                null
            } else {
                pending.remove(entry.key)
                entry.value
            }
        } ?: return
        try {
            wv.evaluateJavascript(javascript, null)
        } catch (_: Exception) {
        }
        synchronized(lock) {
            if (pending.isEmpty()) {
                drainScheduled = false
            } else {
                wv.post { drain() }
            }
        }
    }
}
