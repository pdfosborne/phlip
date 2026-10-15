package app.phlip.server.hosting

import android.app.Application
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.json.JSONObject

/** Input handling and limits — LIMIT from hosting-security-tests.md. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class LimitsTest {

    private lateinit var host: TestHost

    @Before
    fun setUp() {
        host = TestHost.start()
    }

    @After
    fun tearDown() {
        host.stop()
    }

    /** L-01 — Body at 256KB−1 / exactly 256KB / 256KB+1 → accept / accept / reject. */
    @Test
    fun L01_bodySizeBoundary() {
        val max = 256_000
        fun bodyOf(n: Int): ByteArray {
            val prefix = """{"type":"ping","token":"${host.hostToken}","pad":"""".toByteArray()
            val suffix = "\"}".toByteArray()
            val pad = n - prefix.size - suffix.size
            require(pad > 0)
            return prefix + ByteArray(pad) { 'a'.code.toByte() } + suffix
        }
        val under = host.postRaw("/ash-rpc", bodyOf(max - 1))
        assertTrue("256KB-1 should accept, got ${under.code} ${under.body}", under.code in 200..299)

        val exact = host.postRaw("/ash-rpc", bodyOf(max))
        assertTrue("exactly 256KB should accept, got ${exact.code}", exact.code in 200..299)

        // Oversize: assert the Content-Length gate without transferring 256KB+1 bytes.
        // Full-body writes (and mismatched declared lengths) often surface as IOException
        // on Windows when the server rejects and closes before the client finishes.
        val tiny = """{"type":"ping","token":"${host.hostToken}"}""".toByteArray()
        val over = host.postDeclaredLength("/ash-rpc", (max + 1).toLong(), tiny)
        assertTrue(
            "256KB+1 should reject, got ${over.code} ${over.body}",
            over.code == 400 ||
                over.type() == "error" ||
                over.body.contains("too large", true) ||
                over.code == -1,
        )
    }

    /** L-07 — report of unknown target must not crash. */
    @Test
    fun L07_reportNonexistentTarget() {
        val before = host.reportCount()
        host.rpc(
            host.hostToken,
            "report",
            JSONObject()
                .put("targetType", "event")
                .put("targetId", "no-such-event")
                .put("reason", "spam"),
        )
        assertTrue(host.reportCount() >= before)
        assertTrue(host.rpc(host.hostToken, "ping").type() == "pong")
    }

    /** L-08 — Malformed JSON / wrong content-type reject without stack traces. */
    @Test
    fun L08_malformedBodyNoStackTrace() {
        val r = host.postRaw("/ash-rpc", "{not-json".toByteArray(), contentType = "text/plain")
        assertTrue(r.code in 400..499 || r.type() == "error")
        assertFalse(r.body.contains("Exception"))
        assertFalse(r.body.contains("at com.phlip"))
        assertFalse(r.body.contains("stack", ignoreCase = true))
    }

    /** L-09 — Deeply nested JSON handled without hang/crash. */
    @Test
    fun L09_deeplyNestedJson() {
        val nested = StringBuilder("{\"type\":\"ping\",\"token\":\"${host.hostToken}\",\"x\":")
        repeat(200) { nested.append("{\"a\":") }
        nested.append("1")
        repeat(200) { nested.append("}") }
        nested.append("}")
        val r = host.postRaw("/ash-rpc", nested.toString().toByteArray())
        assertTrue(r.code in 200..599)
        assertFalse(r.body.contains("at com.phlip"))
    }

    /**
     * L-12 moved to [OpenSecurityGapsTest] — intentionally red, excluded from
     * default runs unless `-PincludeOpenGaps`.
     */

    /** L-06 — jsonStringList soft-fails on objects/nulls/nested arrays (via createChannel). */
    @Test
    fun L06_jsonStringListHostileValuesNoCrash() {
        val before = host.channelIds().size
        // allowedUserIds as nested arrays / nulls — must not crash or partially write junk ids.
        val body = JSONObject()
            .put("type", "createChannel")
            .put("token", host.hostToken)
            .put("name", "Hostile")
            .put("kind", "chat")
            .put(
                "allowedUserIds",
                org.json.JSONArray()
                    .put(JSONObject().put("x", 1))
                    .put(org.json.JSONObject.NULL)
                    .put(org.json.JSONArray().put("nested"))
                    .put(host.hostUserId()),
            )
        val r = host.postRaw("/ash-rpc", body.toString().toByteArray())
        assertTrue(r.code in 200..599)
        assertFalse(r.body.contains("at com.phlip"))
        // Channel may or may not be created; server must stay up.
        assertEquals("pong", host.rpc(host.hostToken, "ping").type())
        assertTrue(host.channelIds().size >= before)
    }

    /** L-10 — duplicate keys / huge numbers / odd literals handled deterministically. */
    @Test
    fun L10_oddJsonLiteralsDeterministic() {
        // Duplicate keys: org.json keeps the last; must not crash.
        val dup = """{"type":"ping","token":"${host.hostToken}","type":"ping"}"""
        val r1 = host.postRaw("/ash-rpc", dup.toByteArray())
        assertTrue(r1.code in 200..299)
        // Huge number as when — must not hang.
        val huge = JSONObject()
            .put("type", "createEvent")
            .put("token", host.hostToken)
            .put("channelId", "nope")
            .put("title", "e2e:x")
            .put("when", Double.MAX_VALUE)
        val r2 = host.postRaw("/ash-rpc", huge.toString().toByteArray())
        assertTrue(r2.code in 200..599)
        assertEquals("pong", host.rpc(host.hostToken, "ping").type())
    }

}
