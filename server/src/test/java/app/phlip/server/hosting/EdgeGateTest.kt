package app.phlip.server.hosting

import android.app.Application
import app.phlip.server.SecurityRejectLog
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/** Transport and edge gate — EDGE from hosting-security-tests.md. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class EdgeGateTest {

    private lateinit var host: TestHost
    private val secret = "edge-secret-for-tests-only"

    @Before
    fun setUp() {
        host = TestHost.start(
            TestHost.Seed(
                edgeSecret = secret,
                edgeEnforce = true,
                apexDomain = "phlip.example",
                rejectLog = true,
            ),
        )
        SecurityRejectLog.clear()
    }

    @After
    fun tearDown() {
        host.stop()
    }

    /** E-01 — CF-looking request without X-Phlip-Edge rejected + logged. */
    @Test
    fun E01_cloudflareWithoutEdgeHeaderRejected() {
        val r = host.get(
            "/ash-ok",
            headers = mapOf(
                "cf-ray" to "abc123",
                "cf-connecting-ip" to "1.2.3.4",
                "Host" to "join.phlip.example",
            ),
        )
        assertEquals(403, r.code)
        assertEquals("error", r.type())
        assertTrue(
            SecurityRejectLog.snapshot().any { it.reason == "edge_gate" },
        )
    }

    /** E-02 — correct header accepted. */
    @Test
    fun E02_correctEdgeHeaderAccepted() {
        val r = host.get(
            "/ash-ok",
            headers = mapOf(
                "cf-ray" to "abc123",
                "X-Phlip-Edge" to secret,
                "Host" to "join.phlip.example",
            ),
        )
        assertEquals(200, r.code)
        assertFalse(r.type() == "error")
    }

    /** E-03 — wrong header value rejected. */
    @Test
    fun E03_wrongEdgeHeaderRejected() {
        val r = host.get(
            "/ash-ok",
            headers = mapOf(
                "cf-ray" to "abc123",
                "X-Phlip-Edge" to "wrong-secret",
            ),
        )
        assertEquals(403, r.code)
    }

    /** E-04 — LAN / loopback without header accepted even when enforce is on. */
    @Test
    fun E04_lanWithoutHeaderAccepted() {
        val r = host.get("/ash-ok")
        assertEquals(200, r.code)
        assertFalse(
            "LAN origin must not set HSTS for plain-HTTP/local addresses",
            r.headers.keys.any { it.equals("strict-transport-security", ignoreCase = true) },
        )
    }

    /** E-05 — edgeEnforce off → no gating. */
    @Test
    fun E05_enforceOffNoGating() {
        host.setEdgeGate(enforce = false)
        val r = host.get(
            "/ash-ok",
            headers = mapOf("cf-ray" to "abc123"),
        )
        assertEquals(200, r.code)
    }

    /** E-06 — header comparison uses MessageDigest.isEqual (constant-time). */
    @Test
    fun E06_edgeCompareIsConstantTime() {
        val src = locateEdgeOriginPolicySource().readText()
        val fn = src.indexOf("fun rejectIfEdgeGateFails")
        require(fn >= 0)
        val block = src.substring(fn)
        assertTrue(
            "edge gate must use MessageDigest.isEqual",
            block.contains("MessageDigest.isEqual"),
        )
        assertFalse(
            "edge gate must not early-return on first unequal byte via ==",
            block.contains("got == edgeSecret") || block.contains("edgeSecret == got"),
        )
    }

    /** E-07 — edgeSecret never appears in responses or reject-log detail. */
    @Test
    fun E07_edgeSecretNeverLeaked() {
        val responses = listOf(
            host.get("/ash-ok"),
            host.get(
                "/ash-ok",
                headers = mapOf("cf-ray" to "x", "X-Phlip-Edge" to "bad"),
            ),
            host.get(
                "/ash-ok",
                headers = mapOf("cf-ray" to "x", "X-Phlip-Edge" to secret),
            ),
            host.get("/index.html"),
        )
        for (r in responses) {
            assertFalse("body leaked secret", r.body.contains(secret))
            for ((_, v) in r.headers) {
                assertFalse("header leaked secret", v.contains(secret))
            }
        }
        for (e in SecurityRejectLog.snapshot()) {
            assertFalse(e.detail.contains(secret))
            assertFalse(e.reason.contains(secret))
            assertFalse(e.path.contains(secret))
        }
    }

    /** E-08 — Client-supplied X-Phlip-Edge on LAN is ignored (LAN never gated). */
    @Test
    fun E08_lanIgnoresClientEdgeHeader() {
        val withBad = host.get("/ash-ok", headers = mapOf("X-Phlip-Edge" to "totally-wrong"))
        assertEquals(200, withBad.code)
        val withGood = host.get("/ash-ok", headers = mapOf("X-Phlip-Edge" to secret))
        assertEquals(200, withGood.code)
    }

    @Test
    fun E09_spaHtmlKeepsRestrictiveCsp() {
        val r = host.get("/index.html")
        assertEquals(200, r.code)
        val csp = r.headers.entries
            .firstOrNull { it.key.equals("content-security-policy", ignoreCase = true) }
            ?.value
            .orEmpty()
        assertTrue(csp.contains("script-src 'self'"))
        assertTrue(csp.contains("form-action 'self'"))
        assertTrue(csp.contains("object-src 'none'"))
        assertTrue(csp.contains("frame-ancestors 'none'"))
        assertFalse(csp.contains("unsafe-eval"))
    }

    private fun locateEdgeOriginPolicySource(): File {
        val candidates = listOf(
            File("src/main/java/app/phlip/server/publichost/EdgeOriginPolicy.kt"),
            File("../server/src/main/java/app/phlip/server/publichost/EdgeOriginPolicy.kt"),
        )
        return candidates.first { it.isFile }
    }
}
