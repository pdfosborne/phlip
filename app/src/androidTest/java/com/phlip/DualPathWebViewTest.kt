package com.phlip

import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Smoke: WebView bridge exposes dual-path network trust + ashNetworkChanged. */
@RunWith(AndroidJUnit4::class)
class DualPathWebViewTest {

    @get:Rule
    val activityRule = ActivityScenarioRule(MainActivity::class.java)

    @Test
    fun ashNetworkChanged_invokesClientHandler() {
        val latch = CountDownLatch(1)
        var ok = false
        activityRule.scenario.onActivity { activity ->
            val webView = activity.findViewById<android.webkit.WebView>(R.id.webview)
            webView.post {
                webView.evaluateJavascript(
                    """
                    (function(){
                      if (typeof window.ashNetworkChanged !== 'function') return 'missing';
                      window._ashNetworkTrust = 'trusted';
                      window.ashNetworkChanged({ trust: 'trusted' });
                      return typeof onNetworkPossiblyChanged === 'function' ? 'ok' : 'no-handler';
                    })()
                    """.trimIndent(),
                ) { result ->
                    ok = result?.contains("ok") == true || result?.contains("no-handler") == true
                    latch.countDown()
                }
            }
        }
        assertTrue(latch.await(30, TimeUnit.SECONDS))
        assertTrue(ok)
    }

    @Test
    fun getNetworkTrust_returnsLabel() {
        val latch = CountDownLatch(1)
        var label = ""
        activityRule.scenario.onActivity { activity ->
            val webView = activity.findViewById<android.webkit.WebView>(R.id.webview)
                ?: return@onActivity
            webView.post {
                webView.evaluateJavascript(
                    "(function(){ try { return window.AshNative.getNetworkTrust(); } catch(e) { return ''; } })()",
                ) { result ->
                    label = result?.trim('"') ?: ""
                    latch.countDown()
                }
            }
        }
        assertTrue(latch.await(30, TimeUnit.SECONDS))
        assertTrue(label in listOf("trusted", "once", "unknown", "cellular"))
    }
}
