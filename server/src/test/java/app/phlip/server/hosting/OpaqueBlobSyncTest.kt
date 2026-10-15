package app.phlip.server.hosting

import android.app.Application
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.security.SecureRandom
import java.util.Base64

/**
 * T1.5 — server relays content as opaque capped strings: random bytes must
 * round-trip create / update / note / message / share enc / pitch labels
 * without format or prefix checks.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class OpaqueBlobSyncTest {

    private lateinit var host: TestHost
    private lateinit var alice: TestHost.MemberSession
    private lateinit var channelId: String
    private val rng = SecureRandom()

    @Before
    fun setUp() {
        host = TestHost.start()
        alice = host.approveMember("Alice")
        channelId = host.createEventChannel(
            "Plans",
            listOf(host.hostUserId(), alice.userId),
        )
    }

    @After
    fun tearDown() {
        host.stop()
    }

    @Test
    fun randomContentBlobs_roundTripWithoutServerInterpretation() {
        val title = randomBlob()
        val where = randomBlob()
        val details = randomBlob()
        val sticker = randomBlob()
        val subtitle = randomBlob()
        val whenMs = System.currentTimeMillis() + 86_400_000L

        val before = host.eventIds()
        host.rpc(
            alice.token,
            "createEvent",
            JSONObject()
                .put("channelId", channelId)
                .put("title", title)
                .put("when", whenMs)
                .put("where", where)
                .put("details", details)
                .put("sticker", sticker)
                .put("subtitle", subtitle),
        )
        Thread.sleep(40)
        val eventId = (host.eventIds() - before).firstOrNull()
        assertNotNull("createEvent should accept random title/where/details", eventId)

        val created = host.findEvent(eventId!!)!!
        assertEquals(title, created.optString("title"))
        assertEquals(where, created.optString("where"))
        assertEquals(details, created.optString("details"))
        assertEquals(sticker, created.optString("sticker"))
        assertEquals(subtitle, created.optString("subtitle"))
        assertEquals(whenMs, created.optLong("when"))

        val where2 = randomBlob()
        host.rpc(
            alice.token,
            "setEventWhere",
            JSONObject().put("eventId", eventId).put("where", where2),
        )
        Thread.sleep(40)
        assertEquals(where2, host.findEvent(eventId)!!.optString("where"))

        val subtitle2 = randomBlob()
        host.rpc(
            alice.token,
            "setEventSubtitle",
            JSONObject().put("eventId", eventId).put("subtitle", subtitle2),
        )
        Thread.sleep(40)
        assertEquals(subtitle2, host.findEvent(eventId)!!.optString("subtitle"))

        val noteBlob = randomBlob()
        host.rpc(
            alice.token,
            "eventNote",
            JSONObject()
                .put("eventId", eventId)
                .put("text", noteBlob)
                .put("noteId", "opaque-note-1"),
        )
        Thread.sleep(40)
        val notes = host.findEvent(eventId)!!.optJSONArray("notes")
        assertNotNull(notes)
        assertTrue(notes!!.length() >= 1)
        var found = false
        for (i in 0 until notes.length()) {
            val n = notes.getJSONObject(i)
            if (n.optString("id") == "opaque-note-1") {
                assertEquals(noteBlob, n.optString("text"))
                found = true
            }
        }
        assertTrue("note text must round-trip as opaque bytes", found)

        // Persist path: reload from data file must keep blobs intact.
        val persisted = host.findEvent(eventId)!!
        assertEquals(title, persisted.optString("title"))
        assertEquals(where2, persisted.optString("where"))
        assertEquals(details, persisted.optString("details"))
    }

    @Test
    fun randomMessageText_roundTripWithoutServerInterpretation() {
        val text = randomBlob()
        val before = host.messageCount(channelId)
        host.rpc(
            alice.token,
            "sendMessage",
            JSONObject().put("channelId", channelId).put("text", text),
        )
        Thread.sleep(40)
        assertEquals("sendMessage should accept random text blob", before + 1, host.messageCount(channelId))

        val msgs = JSONObject(host.dataFile.readText())
            .optJSONObject("messages")
            ?.optJSONArray(channelId)
        assertNotNull(msgs)
        var found = false
        for (i in 0 until msgs!!.length()) {
            if (msgs.getJSONObject(i).optString("text") == text) {
                found = true
                break
            }
        }
        assertTrue("message text must round-trip as opaque bytes", found)
    }

    @Test
    fun randomEventFields_roundTripWithoutPrefixCheck() {
        val whenMs = System.currentTimeMillis() + 86_400_000L
        val title = randomBlob()
        val where = randomBlob()
        val before = host.eventIds()
        host.rpc(
            alice.token,
            "createEvent",
            JSONObject()
                .put("channelId", channelId)
                .put("title", title)
                .put("when", whenMs)
                .put("where", where)
                .put("details", randomBlob()),
        )
        Thread.sleep(40)
        val eventId = (host.eventIds() - before).firstOrNull()
        assertNotNull(eventId)
        val stored = host.findEvent(eventId!!)
        assertNotNull(stored)
        assertEquals(title, stored!!.optString("title"))
        assertEquals(where, stored.optString("where"))
        assertTrue("event fields must not require an e2e: prefix", !title.startsWith("e2e:"))
    }

    private fun randomBlob(): String {
        val bytes = ByteArray(48)
        rng.nextBytes(bytes)
        // Not an e2e: prefix — proves the server does not require one.
        return "blob:" + Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }
}
