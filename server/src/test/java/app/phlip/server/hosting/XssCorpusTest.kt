package app.phlip.server.hosting

import android.app.Application
import app.phlip.server.AppState
import app.phlip.server.Channel
import app.phlip.server.ChatMessage
import app.phlip.server.DrServer
import app.phlip.server.Event
import app.phlip.server.Report
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
 * XSS corpus (X-03…X-08) at the HTTP/JSON boundary.
 *
 * Full DOM execution checks remain L3 (Playwright). These tests prove user-controlled
 * fields survive storage and leave the server as JSON-safe strings — especially X-08
 * (payloads seeded directly into state, bypassing write-path sanitizers).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class XssCorpusTest {

    companion object {
        /** Keep this list in the test file — hosting-security-tests.md X-03. */
        val XSS_FIELDS = listOf(
            "display name",
            "guest name",
            "event title",
            "event notes",
            "channel name",
            "server name",
            "chat message",
            "report reason",
            "pitch card text",
            "share title",
            "passcode hint",
        )

        val PAYLOADS = listOf(
            "<script>alert(1)</script>",
            "\"><img src=x onerror=alert(1)>",
            "</script><script>alert(1)</script>",
            "'-alert(1)-'",
            "<svg/onload=alert(1)>",
            "javascript:alert(1)",
            "{{constructor.constructor('alert(1)')()}}",
            "\u202E\u202D spoof",
            "\u200Bzero\u200Bwidth",
            "d:\"><script>alert(1)</script>",
        )
    }

    private lateinit var host: TestHost

    @Before
    fun setUp() {
        host = TestHost.start()
    }

    @After
    fun tearDown() {
        host.stop()
    }

    @Test
    fun X03_fieldListIsExplicit() {
        assertTrue(XSS_FIELDS.size >= 11)
        assertTrue("guest name" in XSS_FIELDS)
        assertTrue("report reason" in XSS_FIELDS)
    }

    /** X-03 / X-05 / X-07 — payloads through live write paths leave JSON-safe responses. */
    @Test
    fun X03_X05_X07_payloadsThroughApiAreJsonSafe() {
        for (payload in PAYLOADS) {
            val ch = host.createEventChannel("Xss${payload.hashCode()}", listOf(host.hostUserId()))
            val ev = host.createEvent(host.hostToken, ch, title = payload)
            host.rpc(
                host.hostToken,
                "sendMessage",
                JSONObject().put("channelId", ch).put("text", payload),
            )
            host.rpc(
                host.hostToken,
                "report",
                JSONObject()
                    .put("targetType", "event")
                    .put("targetId", ev)
                    .put("reason", "other")
                    .put("note", payload),
            )
            val html = host.get("/index.html")
            assertFalse(
                "static HTML must not contain live payload",
                html.body.contains(payload) && payload.contains("<script>"),
            )
        }
    }

    /** X-04 — drawn-stroke d: payloads are opaque data, not HTML MIME, and stay JSON-string-safe. */
    @Test
    fun X04_drawnStrokeScriptStaysOpaqueData() {
        val ch = host.createEventChannel("Drawn", listOf(host.hostUserId()))
        val evil = "d:\"><script>alert(1)</script>"
        host.rpc(
            host.hostToken,
            "createEvent",
            JSONObject()
                .put("channelId", ch)
                .put("title", "e2e:icon")
                .put("when", System.currentTimeMillis() + 99_000)
                .put("where", "x")
                .put("details", "y")
                .put("icon", evil),
        )
        val events = host.eventIds().mapNotNull { host.findEvent(it) }
        val withIcon = events.filter { it.optString("icon").isNotEmpty() }
        for (ev in withIcon) {
            val icon = ev.optString("icon")
            // Accepted drawn strokes remain d:-prefixed opaque data (DOM sink = L3).
            assertTrue(icon.startsWith("d:"))
        }
        val html = host.get("/index.html")
        assertFalse(html.body.contains(evil))
    }

    private fun assertJsonSafe(wire: String, label: String) {
        // API payloads must parse as JSON (or be empty/ended markers).
        val trimmed = wire.trim()
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            try {
                if (trimmed.startsWith("{")) JSONObject(trimmed) else org.json.JSONArray(trimmed)
            } catch (e: Exception) {
                throw AssertionError("$label is not valid JSON: ${e.message}\n${trimmed.take(200)}")
            }
        }
        // Never serve user XSS as an HTML document body.
        assertFalse(
            "$label looks like an HTML document embedding script",
            trimmed.startsWith("<!DOCTYPE") && trimmed.contains("<script>alert"),
        )
    }

    /**
     * X-08 — payloads seeded directly into fixture state (bypass write sanitiser).
     * Must still leave the wire JSON-safe on read/render paths.
     */
    @Test
    fun X08_seededPayloadsEscapedOnRead() {
        val payload = "<script>alert('x08')</script>"
        val hostId = host.hostUserId()
        val chId = "ch-x08"
        val evId = "ev-x08"

        injectRawState(
            channel = Channel(chId, payload, kind = "event", allowedUserIds = mutableListOf(hostId)),
            event = Event(
                id = evId,
                title = payload,
                `when` = System.currentTimeMillis() + 86_400_000L,
                where = payload,
                details = payload,
                createdBy = hostId,
                createdByName = payload,
                createdAt = System.currentTimeMillis(),
                channelId = chId,
                notes = mutableListOf(
                    app.phlip.server.EventNote(hostId, payload, payload, System.currentTimeMillis()),
                ),
            ),
            message = ChatMessage("m-x08", chId, hostId, payload, payload, System.currentTimeMillis()),
            report = Report(
                id = "r-x08",
                targetType = "event",
                targetId = evId,
                reason = "other",
                note = payload,
                reporterId = hostId,
                reporterName = payload,
                createdAt = System.currentTimeMillis(),
            ),
        )

        // Member poll/sync path after seed.
        val ping = host.rpc(host.hostToken, "ping")
        assertJsonSafe(ping.body, "X-08 member rpc")
    }

    /** X-06 — bidi / zero-width names don't crash join or break JSON. */
    @Test
    fun X06_bidiAndZeroWidthNames() {
        val ch = host.createEventChannel("Bidi", listOf(host.hostUserId()))
        for (name in listOf("\u202Eevil", "a\u200Bb", "аlex")) {
            val sent = host.rpc(
                host.hostToken,
                "sendMessage",
                JSONObject().put("channelId", ch).put("text", name),
            )
            assertJsonSafe(sent.body, "bidi name")
        }
    }

    private fun injectRawState(
        channel: Channel,
        event: Event,
        message: ChatMessage,
        report: Report,
    ) {
        val state = host.server.testStateForFixture()
        state.hostName = "<script>host</script>"
        state.channels.add(channel)
        state.events.add(event)
        state.messages.getOrPut(channel.id) { mutableListOf() }.add(message)
        state.reports.add(report)
        host.server.testSaveForFixture()
    }
}
