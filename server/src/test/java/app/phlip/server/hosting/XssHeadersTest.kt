package app.phlip.server.hosting

import android.app.Application
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * XSS / CSP headers that are cheap to assert in L2 (X-01).
 * Full DOM XSS corpus (X-02..X-08) needs L3 Playwright — see ClientLayerStubsTest.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class XssHeadersTest {

    private lateinit var host: TestHost

    @Before
    fun setUp() {
        host = TestHost.start()
    }

    @After
    fun tearDown() {
        host.stop()
    }

    /** X-01 — CSP on every HTML response: script-src 'self', no unsafe-inline/eval. */
    @Test
    fun X01_cspOnHtml() {
        val r = host.get("/index.html")
        assertTrue(r.code == 200)
        val csp = r.header("Content-Security-Policy")
        assertTrue("missing CSP", !csp.isNullOrBlank())
        assertTrue(csp!!.contains("script-src 'self'"))
        assertFalse("script-src must not allow unsafe-inline", Regex("script-src[^;]*unsafe-inline").containsMatchIn(csp))
        assertFalse(csp.contains("unsafe-eval"))
    }

    /** Referrer-Policy set so fragments/paths do not leak (also K-03). */
    @Test
    fun X01_referrerPolicyNoReferrer() {
        val r = host.get("/index.html")
        assertTrue(r.header("Referrer-Policy")!!.contains("no-referrer"))
    }

    /** Markup in a chat message stays inside JSON, not an HTML document. */
    @Test
    fun X05_messageMarkupStoredAsText() {
        val ch = host.createChatChannel("Xss", listOf(host.hostUserId()))
        val evil = "<script>alert(1)</script>"
        val sent = host.rpc(
            host.hostToken,
            "sendMessage",
            JSONObject().put("channelId", ch).put("text", evil),
        )
        assertFalse(sent.body.trim().startsWith("<!DOCTYPE"))
        val stored = host.dataFile.readText()
        assertTrue(stored.contains(evil) || stored.contains("\\u003c"))
    }
}
