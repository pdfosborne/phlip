package app.phlip.server.hosting

import android.app.Application
import app.phlip.server.AppState
import app.phlip.server.DrServer
import app.phlip.server.HostCommandCatalog
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** 021 — chain mode, promote, one-hop dependency warn. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class EventChainsTest {

    private lateinit var host: TestHost
    private lateinit var alice: TestHost.MemberSession
    private lateinit var bob: TestHost.MemberSession
    private lateinit var channelId: String
    private lateinit var primaryId: String
    private var primaryWhen: Long = 0L

    @Before
    fun setUp() {
        host = TestHost.start()
        alice = host.approveMember("Alice")
        bob = host.approveMember("Bob")
        channelId = host.createEventChannel("Plans", listOf(host.hostUserId(), alice.userId, bob.userId))
        primaryWhen = System.currentTimeMillis() + 3 * 86_400_000L
        primaryId = host.createEvent(alice.token, channelId, title = "e2e:party", whenMs = primaryWhen)
    }

    @After
    fun tearDown() {
        host.stop()
    }

    @Test
    fun catalogIncludesChainRpcs() {
        assertTrue(HostCommandCatalog.MEMBER_RPC.contains("setChainMode"))
        assertTrue(HostCommandCatalog.MEMBER_RPC.contains("promoteChainEvent"))
        assertTrue(HostCommandCatalog.MEMBER_RPC.contains("clearChainDepWarn"))
    }

    @Test
    fun createFollowOn_isProposal() {
        val childId = createChain("e2e:drinks")
        Thread.sleep(40)
        val child = findEvent(childId)!!
        assertEquals(primaryId, child.chainOf)
        assertEquals("proposal", child.chainStatus)
    }

    @Test
    fun setChainMode_andPromote_choiceDropsLosers() {
        val a = createChain("e2e:dinner")
        val b = createChain("e2e:film")
        Thread.sleep(40)
        host.rpc(alice.token, "setChainMode", JSONObject().put("eventId", primaryId).put("mode", "choice"))
        Thread.sleep(40)
        assertEquals("choice", findEvent(primaryId)!!.chainMode)

        host.rpc(alice.token, "promoteChainEvent", JSONObject().put("eventId", a))
        Thread.sleep(40)
        assertEquals("linked", findEvent(a)!!.chainStatus)
        assertNull(findEvent(b))
    }

    @Test
    fun parentTimeMove_warnsLinkedChild() {
        val childId = createChain("e2e:dinner")
        Thread.sleep(40)
        host.rpc(alice.token, "promoteChainEvent", JSONObject().put("eventId", childId))
        Thread.sleep(40)
        val newWhen = primaryWhen + 86_400_000L
        host.rpc(
            alice.token,
            "setEventTimePrecision",
            JSONObject().put("eventId", primaryId).put("when", newWhen),
        )
        Thread.sleep(40)
        val child = findEvent(childId)!!
        assertEquals(newWhen, child.chainDepWarnWhen)

        host.rpc(alice.token, "clearChainDepWarn", JSONObject().put("eventId", childId))
        Thread.sleep(40)
        assertNull(findEvent(childId)!!.chainDepWarnWhen)
    }

    private fun createChain(title: String): String {
        val before = serverState().events.map { it.id }.toSet()
        host.rpc(
            alice.token,
            "createEvent",
            JSONObject()
                .put("channelId", channelId)
                .put("title", title)
                .put("when", primaryWhen + 3_600_000L)
                .put("where", "")
                .put("details", "")
                .put("chainOf", primaryId)
                .put("whenPrecision", "unconfirmed"),
        )
        Thread.sleep(40)
        return (serverState().events.map { it.id }.toSet() - before).firstOrNull()
            ?: error("createChain failed")
    }

    private fun serverState(): AppState {
        return host.server.testStateForFixture()
    }

    private fun findEvent(id: String) = serverState().events.find { it.id == id }
}
