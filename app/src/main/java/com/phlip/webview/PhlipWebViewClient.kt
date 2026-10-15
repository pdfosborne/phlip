package com.phlip.webview

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import java.util.Locale

/** Asset-origin WebViewClient: intercept assets, open external URLs in the system handler. */
class PhlipWebViewClient(
    private val activity: Context,
    private val assetLoader: WebViewAssetLoader,
    private val assetDomain: String,
    private val callbacks: Callbacks,
) : WebViewClient() {

    interface Callbacks {
        fun onMainFrameFinished()
        fun onMainFrameError()
        fun progressViews(): Pair<View, View>? // progressStarting, splashLogo
    }

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
        assetLoader.shouldInterceptRequest(request.url)

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val uri = request.url ?: return true
        val host = uri.host?.lowercase(Locale.US).orEmpty()
        val scheme = uri.scheme?.lowercase(Locale.US).orEmpty()
        // Stay inside the bundled asset origin (and about:blank bootstraps).
        if (host == assetDomain) return false
        if (scheme == "about") return false
        // Anything else (http/https/intent/…) → system browser / handler.
        if (request.isForMainFrame) {
            try {
                activity.startActivity(Intent(Intent.ACTION_VIEW, uri))
            } catch (_: Exception) {
                // No handler — still consume so the WebView never loads remote HTML.
            }
        }
        return true
    }

    override fun onPageFinished(view: WebView, url: String) {
        callbacks.progressViews()?.let { (progress, splash) ->
            progress.visibility = View.GONE
            splash.visibility = View.GONE
        }
        callbacks.onMainFrameFinished()
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (request.isForMainFrame) {
            callbacks.onMainFrameError()
        }
    }
}
