package app.phlip.server.hosting

import android.app.Application
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

/** Demo users: host/admin-only synthetic members that RSVP and chat like real ones. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class DemoUsersTest {

    private lateinit var host: TestHost
    private lateinit var alice: TestHost.MemberSession

    @Before
    fun setUp() {
        host = TestHost.start()
        alice = host.approveMember("Alice")
    }

    @After
    fun tearDown() {
        host.stop()
    }

    @Test
    fun catalogIncludesDemoUserRpcs() {
        assertTrue(HostCommandCatalog.MEMBER_RPC.contains("createDemoUsers"))
        assertTrue(HostCommandCatalog.MEMBER_RPC.contains("removeDemoUsers"))
        // Never guest-reachable.
        assertTrue(HostCommandCatalog.GUEST_FORBIDDEN.contains("createDemoUsers"))
        assertTrue(HostCommandCatalog.GUEST_FORBIDDEN.contains("removeDemoUsers"))
    }

    @Test
    fun nonAdminCannotCreateOrRemoveDemoUsers() {
        host.rpc(alice.token, "createDemoUsers", JSONObject().put("count", 5))
        Thread.sleep(30)
        assertEquals(0, demoUsers().size)

        // Seed one via the host, then confirm a non-admin can't purge it.
        host.rpc(host.hostToken, "createDemoUsers", JSONObject().put("count", 1))
        Thread.sleep(30)
        assertEquals(1, demoUsers().size)
        host.rpc(alice.token, "removeDemoUsers", JSONObject())
        Thread.sleep(30)
        assertEquals(1, demoUsers().size)
    }

    @Test
    fun hostCreatesDemoUsersWithRequestedRoleAndUniqueNames() {
        host.rpc(host.hostToken, "createDemoUsers", JSONObject().put("count", 6).put("role", "moderator"))
        Thread.sleep(30)
        val demos = demoUsers()
        assertEquals(6, demos.size)
        for (u in demos) assertEquals("moderator", u.optString("role"))
        val names = demos.map { it.optString("name") }
        assertEquals("demo names must be unique", names.size, names.toSet().size)
    }

    @Test
    fun createDemoUsersCapsAtOneHundredTotal() {
        // Requested count is clamped to 100 per call; a server-wide cap of 100 remains.
        host.rpc(host.hostToken, "createDemoUsers", JSONObject().put("count", 150))
        Thread.sleep(200)
        assertEquals(100, demoUsers().size)

        val res = host.rpc(host.hostToken, "createDemoUsers", JSONObject().put("count", 5))
        Thread.sleep(30)
        assertEquals(100, demoUsers().size)
        assertNotNull("expected an error ack in messages: ${res.body}", firstMessage(res, "error"))
    }

    @Test
    fun demoUsersReactToExistingEventsWithRsvpAndChatAfterDelay() {
        val channelId = createOpenEventChannel("Plans")
        val eventId = host.createEvent(alice.token, channelId, title = "e2e:dinner")

        // Fire scheduled reactions almost immediately instead of waiting up to 5 minutes.
        host.server.testSetDemoDelayOverrideMsForFixture(20L)
        host.rpc(host.hostToken, "createDemoUsers", JSONObject().put("count", 12))
        Thread.sleep(400)

        val ev = host.findEvent(eventId)!!
        val demoIds = demoUsers().map { it.optString("id") }.toSet()
        val rsvps = ev.optJSONObject("rsvps") ?: JSONObject()
        val respondedDemoIds = rsvps.keys().asSequence().filter { it in demoIds }.toSet()
        // ~75% response rate across 12 users — astronomically unlikely all skip.
        assertTrue("expected at least one demo RSVP, got rsvps=$rsvps", respondedDemoIds.isNotEmpty())
        for (status in respondedDemoIds.map { rsvps.optString(it) }) {
            assertTrue(status in listOf("going", "maybe", "out"))
        }

        val messagesInChannel = host.run {
            val o = org.json.JSONObject(dataFile.readText())
            o.optJSONObject("messages")?.optJSONArray(channelId) ?: org.json.JSONArray()
        }
        var sawDemoChat = false
        for (i in 0 until messagesInChannel.length()) {
            val msg = messagesInChannel.getJSONObject(i)
            if (msg.optString("userId") in demoIds) sawDemoChat = true
        }
        assertTrue("expected at least one demo chat message", sawDemoChat)
    }

    @Test
    fun demoUsersReactToNewlyCreatedEvents() {
        val channelId = createOpenEventChannel("Plans")

        host.server.testSetDemoDelayOverrideMsForFixture(20L)
        host.rpc(host.hostToken, "createDemoUsers", JSONObject().put("count", 10))
        Thread.sleep(50)
        assertEquals(10, demoUsers().size)

        val eventId = host.createEvent(alice.token, channelId, title = "e2e:new-event")
        Thread.sleep(400)

        val ev = host.findEvent(eventId)!!
        val demoIds = demoUsers().map { it.optString("id") }.toSet()
        val rsvps = ev.optJSONObject("rsvps") ?: JSONObject()
        val respondedDemoIds = rsvps.keys().asSequence().filter { it in demoIds }.toSet()
        assertTrue("expected at least one demo RSVP on a new event", respondedDemoIds.isNotEmpty())
    }

    @Test
    fun removeDemoUsersPurgesRsvpsAndChat() {
        val channelId = createOpenEventChannel("Plans")
        val eventId = host.createEvent(alice.token, channelId, title = "e2e:dinner")

        host.server.testSetDemoDelayOverrideMsForFixture(20L)
        host.rpc(host.hostToken, "createDemoUsers", JSONObject().put("count", 12))
        Thread.sleep(400)
        val demoIds = demoUsers().map { it.optString("id") }.toSet()
        assertTrue(host.findEvent(eventId)!!.optJSONObject("rsvps")!!.keys().asSequence().any { it in demoIds })

        val res = host.rpc(host.hostToken, "removeDemoUsers", JSONObject())
        Thread.sleep(50)
        val removedMsg = firstMessage(res, "demoUsersRemoved")
        assertNotNull("expected demoUsersRemoved ack in messages: ${res.body}", removedMsg)
        assertEquals(12, removedMsg!!.optInt("count"))

        assertEquals(0, demoUsers().size)
        val evAfter = host.findEvent(eventId)!!
        val rsvpsAfter = evAfter.optJSONObject("rsvps") ?: JSONObject()
        assertFalse(rsvpsAfter.keys().asSequence().any { it in demoIds })

        val messagesInChannel = host.run {
            val o = org.json.JSONObject(dataFile.readText())
            o.optJSONObject("messages")?.optJSONArray(channelId) ?: org.json.JSONArray()
        }
        for (i in 0 until messagesInChannel.length()) {
            assertFalse(messagesInChannel.getJSONObject(i).optString("userId") in demoIds)
        }
    }

    @Test
    fun removeDemoUsersWithNoneIsANoOp() {
        val res = host.rpc(host.hostToken, "removeDemoUsers", JSONObject())
        val msg = firstMessage(res, "demoUsersRemoved")
        assertNotNull("expected demoUsersRemoved ack in messages: ${res.body}", msg)
        assertEquals(0, msg!!.optInt("count"))
    }

    /**
     * An event channel with no explicit allow-list, so visibility/RSVP come from the
     * default role permission matrix — required for freshly-minted demo users (role
     * "user") to be eligible, since they're never added to a private allow-list.
     */
    private fun createOpenEventChannel(name: String): String {
        val before = host.channelIds()
        host.rpc(
            host.hostToken,
            "createBoard",
            JSONObject().put("name", name).put("allowedUserIds", JSONObject.NULL),
        )
        val state = JSONObject(host.dataFile.readText())
        val channels = state.getJSONArray("channels")
        return (0 until channels.length()).map { channels.getJSONObject(it) }
            .firstOrNull { it.optString("id") in (host.channelIds() - before) && it.optString("kind") == "event" }
            ?.getString("id")
            ?: error("createBoard did not add an event channel")
    }

    /** RPC command acks arrive inside the `messages` array of the immediate /ash-rpc response. */
    private fun firstMessage(res: TestHost.HttpResult, type: String): JSONObject? {
        val arr = res.json?.optJSONArray("messages") ?: return null
        for (i in 0 until arr.length()) {
            val m = arr.optJSONObject(i) ?: continue
            if (m.optString("type") == type) return m
        }
        return null
    }

    private fun demoUsers(): List<JSONObject> {
        val o = JSONObject(host.dataFile.readText())
        val users = o.optJSONObject("users") ?: return emptyList()
        val out = mutableListOf<JSONObject>()
        val keys = users.keys()
        while (keys.hasNext()) {
            val u = users.optJSONObject(keys.next()) ?: continue
            if (u.optBoolean("isDemo")) out.add(u)
        }
        return out
    }
}
