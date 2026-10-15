package app.phlip.server.hosting

import android.app.Application
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Static assets and paths — ASSET from hosting-security-tests.md. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class AssetsTest {

    private lateinit var host: TestHost

    @Before
    fun setUp() {
        host = TestHost.start()
    }

    @After
    fun tearDown() {
        host.stop()
    }

    /** A-01 — Path traversal variants all reject. */
    @Test
    fun A01_pathTraversalRejected() {
        // Prefer encoded forms OkHttp will not resolve client-side into a safe path.
        val probes = listOf(
            "/%2e%2e/AndroidManifest.xml",
            "/%2e%2e%2fAndroidManifest.xml",
            "/%2e%2e%5cAndroidManifest.xml",
            "/....//....//etc/passwd.html",
            "/%252e%252e/index.html",
            "/not-a-real-asset.apk",
        )
        for (p in probes) {
            val r = host.getEncoded(p)
            assertTrue("$p should be rejected, got ${r.code} body=${r.body.take(80)}", r.code == 404 || r.code >= 400)
        }
    }

    /** A-02 — Absolute path request rejected. */
    @Test
    fun A02_absolutePathRejected() {
        val r = host.get("/C:/Windows/win.ini")
        assertTrue(r.code == 404 || r.code >= 400)
    }

    /** A-03 — Null byte in path rejected. */
    @Test
    fun A03_nullByteRejected() {
        // OkHttp may refuse null bytes in URL; try encoded form.
        val r = host.get("/index.html%00.js")
        assertTrue(r.code == 404 || r.code >= 400)
    }

    /** A-04 — Non-allowlisted extension / APK-ish asset rejected. */
    @Test
    fun A04_nonAllowlistedAssetRejected() {
        for (p in listOf("/secret.json", "/data.bin", "/app.apk", "/AndroidManifest.xml")) {
            val r = host.get(p)
            assertTrue("$p → ${r.code}", r.code == 404 || r.code >= 400)
        }
    }

    /** A-05 — MIME allowlist; never text/html for non-HTML. */
    @Test
    fun A05_mimeAllowlist() {
        val html = host.get("/index.html")
        assertEquals(200, html.code)
        assertTrue(html.header("Content-Type")!!.contains("text/html"))

        val js = host.get("/helpers.js")
        if (js.code == 200) {
            val ct = js.header("Content-Type")!!.lowercase()
            assertTrue(ct.contains("javascript") || ct.contains("ecmascript"))
            assertFalse(ct.contains("text/html"))
        }

        val css = host.get("/style.css")
        if (css.code == 200) {
            assertTrue(css.header("Content-Type")!!.contains("text/css"))
            assertFalse(css.header("Content-Type")!!.contains("text/html"))
        }

        // style.css is now an @import manifest; component modules live under styles/.
        val nestedCss = host.get("/styles/00-foundation.css")
        if (nestedCss.code == 200) {
            assertTrue(nestedCss.header("Content-Type")!!.contains("text/css"))
            assertFalse(nestedCss.header("Content-Type")!!.contains("text/html"))
        }
    }

    /** A-06 — X-Content-Type-Options: nosniff on asset responses. */
    @Test
    fun A06_nosniffOnAssets() {
        val r = host.get("/index.html")
        assertEquals("nosniff", r.header("X-Content-Type-Options"))
    }

    /** A-07 — noindex present (meta on HTML). */
    @Test
    fun A07_noindexOnHtml() {
        val r = host.get("/index.html")
        assertTrue(r.body.contains("noindex", ignoreCase = true))
    }

    /** A-08 — Long path / query rejected cleanly. */
    @Test
    fun A08_longPathAndQuery() {
        val longName = "a".repeat(8_000) + ".html"
        val r = host.get("/$longName")
        assertTrue(r.code == 404 || r.code >= 400)
        assertFalse(r.body.contains("at com.phlip"))

        val q = host.get("/index.html", query = "q=" + "x".repeat(8_000))
        // Query alone shouldn't explode the server.
        assertNotNull(q)
        assertTrue(q.code in 200..599)
    }
}
