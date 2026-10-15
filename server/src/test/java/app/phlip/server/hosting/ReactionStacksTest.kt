package app.phlip.server.hosting

import android.app.Application
import app.phlip.server.AppState
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

/** Multi-reaction stacks + shared drawn reaction cards. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class ReactionStacksTest {

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
            title = "e2e:reacts",
            whenMs = System.currentTimeMillis() + 86_400_000L,
        )
    }

    @After
    fun tearDown() {
        host.stop()
    }

    @Test
    fun catalogIncludesReactionRpcs() {
        assertTrue(HostCommandCatalog.MEMBER_RPC.contains("react"))
        assertTrue(HostCommandCatalog.MEMBER_RPC.contains("deleteReactionCard"))
    }

    @Test
    fun appendStacksMultipleReactions() {
        host.rpc(
            alice.token,
            "react",
            JSONObject().put("eventId", eventId).put("emoji", "❤️").put("append", true)
                .put("clientActionId", "a1"),
        )
        host.rpc(
            alice.token,
            "react",
            JSONObject().put("eventId", eventId).put("emoji", "🔥").put("append", true)
                .put("clientActionId", "a2"),
        )
        Thread.sleep(60)
        val stacks = eventStacks()
        val mine = stacks[alice.userId]!!
        assertEquals(listOf("❤️", "🔥"), mine)
    }

    @Test
    fun appendIsIdempotentOnClientActionId() {
        val payload = JSONObject().put("eventId", eventId).put("emoji", "👍").put("append", true)
            .put("clientActionId", "dup-1")
        host.rpc(alice.token, "react", payload)
        host.rpc(alice.token, "react", payload)
        Thread.sleep(60)
        assertEquals(1, eventStacks()[alice.userId]!!.size)
    }

    @Test
    fun removeAllClearsOwnStackOnly() {
        host.rpc(
            alice.token,
            "react",
            JSONObject().put("eventId", eventId).put("emoji", "❤️").put("append", true),
        )
        host.rpc(
            bob.token,
            "react",
            JSONObject().put("eventId", eventId).put("emoji", "😂").put("append", true),
        )
        Thread.sleep(40)
        host.rpc(alice.token, "react", JSONObject().put("eventId", eventId).put("removeAll", true))
        Thread.sleep(40)
        val stacks = eventStacks()
        assertFalse(stacks.containsKey(alice.userId))
        assertEquals(listOf("😂"), stacks[bob.userId])
    }

    @Test
    fun drawnReactionJoinsSharedCatalog() {
        val drawn = "d:" + "A".repeat(40)
        host.rpc(
            alice.token,
            "react",
            JSONObject().put("eventId", eventId).put("emoji", drawn).put("append", true),
        )
        Thread.sleep(80)
        val cards = serverState().reactionCards ?: emptyList()
        assertTrue(cards.any { it.card == drawn })
        val entry = cards.first { it.card == drawn }
        assertEquals(alice.userId, entry.createdBy)
    }

    @Test
    fun adminDeleteReactionCardPurgesEverywhere() {
        val drawn = "d:" + "B".repeat(40)
        host.rpc(
            alice.token,
            "react",
            JSONObject().put("eventId", eventId).put("emoji", drawn).put("append", true),
        )
        Thread.sleep(60)
        assertTrue((serverState().reactionCards ?: emptyList()).any { it.card == drawn })

        host.rpc(host.hostToken, "deleteReactionCard", JSONObject().put("card", drawn))
        Thread.sleep(80)
        assertFalse((serverState().reactionCards ?: emptyList()).any { it.card == drawn })
        val stacks = eventStacks()
        for (list in stacks.values) {
            assertFalse(list.contains(drawn))
        }
    }

    private fun serverState(): AppState = host.server.testStateForFixture()

    private fun eventStacks(): Map<String, List<String>> {
        val ev = serverState().events.find { it.id == eventId }
        assertNotNull(ev)
        return ev!!.reactionStacks?.mapValues { it.value.toList() } ?: emptyMap()
    }
}
