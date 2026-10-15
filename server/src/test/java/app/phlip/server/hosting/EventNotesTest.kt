package app.phlip.server.hosting

import android.app.Application
import app.phlip.server.AppState
import app.phlip.server.DrServer
import app.phlip.server.HostCommandCatalog
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** 018 — shared pin + personal sealed notes. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class EventNotesTest {

    private lateinit var host: TestHost
    private lateinit var alice: TestHost.MemberSession
    private lateinit var bob: TestHost.MemberSession
    private lateinit var channelId: String
    private lateinit var eventId: String

    @Before
    fun setUp() {
        host = TestHost.start()
        alice = host.approveMember("Alice")
        bob = host.approveMember("Bob")
        channelId = host.createEventChannel("Plans", listOf(host.hostUserId(), alice.userId, bob.userId))
        eventId = host.createEvent(
            alice.token,
            channelId,
            title = "e2e:notes",
            whenMs = System.currentTimeMillis() + 86_400_000L,
        )
    }

    @After
    fun tearDown() {
        host.stop()
    }

    @Test
    fun catalogIncludesNoteRpcs() {
        assertTrue(HostCommandCatalog.MEMBER_RPC.contains("eventNote"))
        assertTrue(HostCommandCatalog.MEMBER_RPC.contains("pinEventNote"))
        assertTrue(HostCommandCatalog.MEMBER_RPC.contains("publishPersonalNote"))
        assertTrue(HostCommandCatalog.MEMBER_RPC.contains("setEventDetails"))
        assertTrue(HostCommandCatalog.MEMBER_RPC.contains("setEventSubtitle"))
        assertTrue(HostCommandCatalog.MEMBER_RPC.contains("setEventType"))
    }

    @Test
    fun chatNote_thenPin_becomesShared() {
        host.rpc(
            bob.token,
            "eventNote",
            JSONObject()
                .put("eventId", eventId)
                .put("text", "e2e:park early")
                .put("noteId", "note-park-1"),
        )
        Thread.sleep(40)
        val chat = findNote("note-park-1")!!
        assertFalse(chat.pinned)
        assertTrue(chat.noteKind.isNullOrEmpty())

        host.rpc(
            alice.token,
            "pinEventNote",
            JSONObject().put("eventId", eventId).put("noteId", "note-park-1"),
        )
        Thread.sleep(40)
        val pinned = findNote("note-park-1")!!
        assertTrue(pinned.pinned)
        assertEquals("shared", pinned.noteKind)
    }

    @Test
    fun pinReplacesPreviousPin() {
        host.rpc(
            bob.token,
            "eventNote",
            JSONObject()
                .put("eventId", eventId)
                .put("text", "e2e:first")
                .put("noteId", "note-a"),
        )
        host.rpc(
            bob.token,
            "eventNote",
            JSONObject()
                .put("eventId", eventId)
                .put("text", "e2e:second")
                .put("noteId", "note-b"),
        )
        Thread.sleep(40)
        host.rpc(
            alice.token,
            "pinEventNote",
            JSONObject().put("eventId", eventId).put("noteId", "note-a"),
        )
        Thread.sleep(40)
        assertTrue(findNote("note-a")!!.pinned)
        assertEquals("shared", findNote("note-a")!!.noteKind)

        host.rpc(
            alice.token,
            "pinEventNote",
            JSONObject().put("eventId", eventId).put("noteId", "note-b"),
        )
        Thread.sleep(40)
        val a = findNote("note-a")!!
        val b = findNote("note-b")!!
        assertFalse(a.pinned)
        assertTrue(a.noteKind.isNullOrEmpty())
        assertTrue(b.pinned)
        assertEquals("shared", b.noteKind)
    }

    @Test
    fun setEventDetails_updatesAndBroadcasts() {
        host.rpc(
            alice.token,
            "setEventDetails",
            JSONObject()
                .put("eventId", eventId)
                .put("details", "e2e:bring-snacks"),
        )
        Thread.sleep(40)
        val ev = serverState().events.find { it.id == eventId }!!
        assertEquals("e2e:bring-snacks", ev.details)
        assertTrue(ev.notes?.any { it.activity == "details" } == true)
    }

    @Test
    fun personalNote_thenPublish() {
        host.rpc(
            alice.token,
            "eventNote",
            JSONObject()
                .put("eventId", eventId)
                .put("text", "self:opaque-blob")
                .put("noteId", "note-priv-1")
                .put("noteKind", "personal"),
        )
        Thread.sleep(40)
        val personal = findNote("note-priv-1")!!
        assertEquals("personal", personal.noteKind)
        assertFalse(personal.pinned)

        host.rpc(
            alice.token,
            "publishPersonalNote",
            JSONObject()
                .put("eventId", eventId)
                .put("noteId", "note-priv-1")
                .put("text", "e2e:now-shared"),
        )
        Thread.sleep(40)
        val shared = findNote("note-priv-1")!!
        assertEquals("shared", shared.noteKind)
        assertTrue(shared.pinned)
        assertEquals("e2e:now-shared", shared.text)
    }

    private fun serverState(): AppState {
        return host.server.testStateForFixture()
    }

    private fun findNote(id: String) =
        serverState().events.find { it.id == eventId }?.notes?.find { it.id == id }
}
