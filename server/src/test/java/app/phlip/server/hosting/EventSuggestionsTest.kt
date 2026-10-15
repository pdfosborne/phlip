package app.phlip.server.hosting

import android.app.Application
import app.phlip.server.AppState
import app.phlip.server.DrServer
import app.phlip.server.HostCommandCatalog
import org.json.JSONObject
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

/** 001/010 Slice 1 — stacked alternative times. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class EventSuggestionsTest {

    private lateinit var host: TestHost
    private lateinit var alice: TestHost.MemberSession
    private lateinit var bob: TestHost.MemberSession
    private lateinit var channelId: String
    private lateinit var eventId: String
    private var originalWhen: Long = 0L

    @Before
    fun setUp() {
        host = TestHost.start()
        alice = host.approveMember("Alice")
        bob = host.approveMember("Bob")
        channelId = host.createEventChannel("Plans", listOf(host.hostUserId(), alice.userId, bob.userId))
        originalWhen = System.currentTimeMillis() + 3 * 86_400_000L
        eventId = host.createEvent(alice.token, channelId, title = "e2e:dinner", whenMs = originalWhen)
    }

    @After
    fun tearDown() {
        host.stop()
    }

    @Test
    fun catalogIncludesSuggestionRpcs() {
        assertTrue(HostCommandCatalog.MEMBER_RPC.contains("suggestEventWhen"))
        assertTrue(HostCommandCatalog.MEMBER_RPC.contains("supportEventSuggestion"))
        assertTrue(HostCommandCatalog.MEMBER_RPC.contains("promoteEventSuggestion"))
        assertTrue(HostCommandCatalog.MEMBER_RPC.contains("lockEventSuggestions"))
    }

    @Test
    fun memberSuggest_andCreatorSeed_mergeSameWhen() {
        val alt = originalWhen + 86_400_000L
        host.rpc(
            bob.token,
            "suggestEventWhen",
            JSONObject().put("eventId", eventId).put("when", alt),
        )
        Thread.sleep(40)
        assertEquals(1, suggestionCount())

        // Creator seeds the same instant — merges support, no second row.
        host.rpc(
            alice.token,
            "suggestEventWhen",
            JSONObject().put("eventId", eventId).put("when", alt),
        )
        Thread.sleep(40)
        assertEquals(1, suggestionCount())
        val sug = firstSuggestion()!!
        assertTrue(sug.supporterIds.contains(bob.userId))
        assertTrue(sug.supporterIds.contains(alice.userId))
    }

    @Test
    fun support_addsSupporter() {
        val alt = originalWhen + 2 * 86_400_000L
        host.rpc(alice.token, "suggestEventWhen", JSONObject().put("eventId", eventId).put("when", alt))
        Thread.sleep(40)
        val id = firstSuggestion()!!.id
        host.rpc(bob.token, "supportEventSuggestion", JSONObject().put("eventId", eventId).put("suggestionId", id))
        Thread.sleep(40)
        assertTrue(firstSuggestion()!!.supporterIds.contains(bob.userId))
    }

    @Test
    fun support_voteNo_mutualExclusion_andClear() {
        val alt = originalWhen + 2 * 86_400_000L
        host.rpc(alice.token, "suggestEventWhen", JSONObject().put("eventId", eventId).put("when", alt))
        Thread.sleep(40)
        val id = firstSuggestion()!!.id

        host.rpc(
            bob.token,
            "supportEventSuggestion",
            JSONObject().put("eventId", eventId).put("suggestionId", id).put("vote", "no"),
        )
        Thread.sleep(40)
        var sug = firstSuggestion()!!
        assertTrue(sug.declinerIds.contains(bob.userId))
        assertFalse(sug.supporterIds.contains(bob.userId))

        host.rpc(
            bob.token,
            "supportEventSuggestion",
            JSONObject().put("eventId", eventId).put("suggestionId", id).put("vote", "yes"),
        )
        Thread.sleep(40)
        sug = firstSuggestion()!!
        assertTrue(sug.supporterIds.contains(bob.userId))
        assertFalse(sug.declinerIds.contains(bob.userId))

        // Same vote again clears.
        host.rpc(
            bob.token,
            "supportEventSuggestion",
            JSONObject().put("eventId", eventId).put("suggestionId", id).put("vote", "yes"),
        )
        Thread.sleep(40)
        sug = firstSuggestion()!!
        assertFalse(sug.supporterIds.contains(bob.userId))
        assertFalse(sug.declinerIds.contains(bob.userId))
    }

    @Test
    fun suggestMerge_removesFromDecliners() {
        val alt = originalWhen + 86_400_000L
        host.rpc(alice.token, "suggestEventWhen", JSONObject().put("eventId", eventId).put("when", alt))
        Thread.sleep(40)
        val id = firstSuggestion()!!.id
        host.rpc(
            bob.token,
            "supportEventSuggestion",
            JSONObject().put("eventId", eventId).put("suggestionId", id).put("vote", "no"),
        )
        Thread.sleep(40)
        assertTrue(firstSuggestion()!!.declinerIds.contains(bob.userId))

        // Bob suggests the same when → auto-yes, leave decliners.
        host.rpc(bob.token, "suggestEventWhen", JSONObject().put("eventId", eventId).put("when", alt))
        Thread.sleep(40)
        val sug = firstSuggestion()!!
        assertTrue(sug.supporterIds.contains(bob.userId))
        assertFalse(sug.declinerIds.contains(bob.userId))
    }

    @Test
    fun promote_swapsWhen_andDemotesPrior() {
        val alt = originalWhen + 86_400_000L
        host.rpc(bob.token, "suggestEventWhen", JSONObject().put("eventId", eventId).put("when", alt))
        Thread.sleep(40)
        val sugId = firstSuggestion()!!.id
        host.rpc(
            alice.token,
            "promoteEventSuggestion",
            JSONObject().put("eventId", eventId).put("suggestionId", sugId),
        )
        Thread.sleep(40)
        val ev = findEvent()!!
        assertEquals(alt, ev.`when`)
        // Prior date demoted into the stack.
        assertTrue((ev.suggestions?.size ?: 0) >= 1)
        assertTrue(ev.suggestions!!.any { it.`when` == originalWhen })
        assertFalse(ev.suggestions!!.any { it.id == sugId })
    }

    @Test
    fun lock_clearsStack_keepsWhen() {
        val alt = originalWhen + 86_400_000L
        host.rpc(bob.token, "suggestEventWhen", JSONObject().put("eventId", eventId).put("when", alt))
        Thread.sleep(40)
        assertEquals(1, suggestionCount())
        host.rpc(alice.token, "lockEventSuggestions", JSONObject().put("eventId", eventId))
        Thread.sleep(40)
        val ev = findEvent()!!
        assertEquals(originalWhen, ev.`when`)
        assertTrue(ev.suggestions.isNullOrEmpty())
    }

    @Test
    fun lock_nonEditor_ignored() {
        val alt = originalWhen + 86_400_000L
        host.rpc(bob.token, "suggestEventWhen", JSONObject().put("eventId", eventId).put("when", alt))
        Thread.sleep(40)
        host.rpc(bob.token, "lockEventSuggestions", JSONObject().put("eventId", eventId))
        Thread.sleep(40)
        assertEquals(1, suggestionCount())
        assertEquals(originalWhen, findEvent()!!.`when`)
    }

    private fun serverState(): AppState {
        return host.server.testStateForFixture()
    }

    private fun findEvent() = serverState().events.find { it.id == eventId }

    private fun suggestionCount() = findEvent()?.suggestions?.size ?: 0

    private fun firstSuggestion() = findEvent()?.suggestions?.firstOrNull()
}
