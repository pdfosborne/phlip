package app.phlip.server.hosting

import android.app.Application
import app.phlip.server.HttpClient
import app.phlip.server.PresenceCoordinator
import app.phlip.server.ServerScheduler
import app.phlip.server.ServerSessionRegistry
import com.google.gson.Gson
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.CopyOnWriteArrayList

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class PresenceCoordinatorTest {

    private val gson = Gson()

    @Test
    fun onlineUserIdsDedupesHttpSessionsByUserId() {
        val registry = ServerSessionRegistry()
        registry.httpClients["t1"] = HttpClient()
        registry.httpClients["t1b"] = HttpClient()
        registry.httpClients["t2"] = HttpClient()
        val presence = coordinator(registry, CopyOnWriteArrayList()) { token ->
            when (token) {
                "t1", "t1b" -> "u1"
                "t2" -> "u2"
                else -> null
            }
        }
        val online = presence.onlineUserIds()
        // Tokens are de-duplicated; user ids follow token→user mapping (may repeat).
        assertEquals(3, online.size)
        assertEquals(2, online.toSet().size)
        assertTrue(online.contains("u1"))
        assertTrue(online.contains("u2"))
    }

    @Test
    fun activityCallbackInvokedOnFire() {
        val events = mutableListOf<String>()
        val presence = PresenceCoordinator(
            sessionRegistry = ServerSessionRegistry(),
            scheduler = idleScheduler(),
            gson = gson,
            userIdForToken = { "u" },
            membersPayload = { JSONArray() },
            broadcast = {},
            onActivityChanged = { events.add("activity") },
        )
        presence.fireActivityChanged()
        presence.fireActivityChanged()
        assertEquals(listOf("activity", "activity"), events)
    }

    @Test
    fun pruneLivePicsDropsOfflineUsers() {
        val registry = ServerSessionRegistry()
        registry.livePics["online"] = "pic1"
        registry.livePics["gone"] = "pic2"
        val presence = coordinator(registry, CopyOnWriteArrayList()) { null }
        presence.pruneLivePics(listOf("online"))
        assertTrue(registry.livePics.containsKey("online"))
        assertFalse(registry.livePics.containsKey("gone"))
    }

    @Test
    fun presenceBroadcastIncludesOnlineAndMembers() {
        val registry = ServerSessionRegistry()
        registry.httpClients["t1"] = HttpClient()
        val broadcasts = CopyOnWriteArrayList<JSONObject>()
        val presence = coordinator(registry, broadcasts) { "u1" }
        presence.presence()
        assertEquals(1, broadcasts.size)
        assertEquals("presence", broadcasts[0].optString("type"))
        assertEquals(1, broadcasts[0].optJSONArray("online")!!.length())
        assertEquals("u1", broadcasts[0].optJSONArray("online")!!.getString(0))
    }

    @Test
    fun broadcastLivePicPayload() {
        val broadcasts = CopyOnWriteArrayList<JSONObject>()
        val presence = coordinator(ServerSessionRegistry(), broadcasts) { null }
        presence.broadcastLivePic("u1", "data:image/jpeg;base64,xx")
        presence.broadcastLivePic("u1", null)
        assertEquals("livePic", broadcasts[0].optString("type"))
        assertEquals("u1", broadcasts[0].optString("userId"))
        assertEquals("data:image/jpeg;base64,xx", broadcasts[0].optString("livePic"))
        assertTrue(broadcasts[1].isNull("livePic"))
    }

    @Test
    fun broadcastMembersUsesMembersPayload() {
        val broadcasts = CopyOnWriteArrayList<JSONObject>()
        val presence = coordinator(ServerSessionRegistry(), broadcasts) { null }
        presence.broadcastMembers()
        assertEquals("members", broadcasts[0].optString("type"))
        assertEquals(1, broadcasts[0].optJSONArray("members")!!.length())
    }

    private fun coordinator(
        registry: ServerSessionRegistry,
        broadcasts: MutableList<JSONObject>,
        userIdForToken: (String) -> String?,
    ) = PresenceCoordinator(
        sessionRegistry = registry,
        scheduler = idleScheduler(),
        gson = gson,
        userIdForToken = userIdForToken,
        membersPayload = { JSONArray().put(JSONObject().put("id", "m")) },
        broadcast = { broadcasts.add(it) },
        onActivityChanged = {},
    )

    private fun idleScheduler() = ServerScheduler(
        port = 0,
        onPresenceTick = {},
        shouldUseIdlePresenceTick = { true },
        onInviteRotationTick = {},
        currentInviteExpiry = { System.currentTimeMillis() + 60_000 },
    )
}
