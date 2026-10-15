package app.phlip.server.hosting

import android.app.Application
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

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class WelcomeChannelTest {

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
    fun turningOnWelcomeClearsThePreviousChat() {
        val a = host.createChatChannel("Lobby A", allowedUserIds = null)
        val b = host.createChatChannel("Lobby B", allowedUserIds = null)
        host.rpc(
            host.hostToken,
            "updateChannel",
            JSONObject().put("channelId", a).put("name", "Lobby A").put("welcomeChannel", true),
        )
        assertTrue(findChannel(a)!!.optBoolean("welcomeChannel"))
        host.rpc(
            host.hostToken,
            "updateChannel",
            JSONObject().put("channelId", b).put("name", "Lobby B").put("welcomeChannel", true),
        )
        assertFalse(findChannel(a)!!.optBoolean("welcomeChannel"))
        assertTrue(findChannel(b)!!.optBoolean("welcomeChannel"))
    }

    @Test
    fun newMemberPostsJoinLogReturningDoesNot() {
        val chat = host.createChatChannel("Welcome", allowedUserIds = null)
        host.rpc(
            host.hostToken,
            "updateChannel",
            JSONObject().put("channelId", chat).put("name", "Welcome").put("welcomeChannel", true),
        )
        assertEquals(0, host.messageCount(chat))
        val alice = host.approveMember("Alice")
        assertEquals(1, host.messageCount(chat))
        val msg = lastMessage(chat)!!
        assertEquals("memberJoined", msg.optString("activity"))
        assertEquals(alice.userId, msg.optString("userId"))
        assertEquals("Alice", msg.optString("name"))

        host.postJson(
            "/ash-join",
            JSONObject()
                .put("name", "Alice")
                .put("fingerprint", TestHost.fp("alice-return")),
        )
        assertEquals(1, host.messageCount(chat))
    }

    @Test
    fun noWelcomeChannelMeansNoJoinPost() {
        val chat = host.createChatChannel("Quiet", allowedUserIds = null)
        host.approveMember("Bob")
        assertEquals(0, host.messageCount(chat))
    }

    private fun findChannel(id: String): JSONObject? {
        val arr = JSONObject(host.dataFile.readText()).optJSONArray("channels") ?: return null
        for (i in 0 until arr.length()) {
            val ch = arr.getJSONObject(i)
            if (ch.optString("id") == id) return ch
        }
        return null
    }

    private fun lastMessage(channelId: String): JSONObject? {
        val msgs = JSONObject(host.dataFile.readText()).optJSONObject("messages") ?: return null
        val arr = msgs.optJSONArray(channelId) ?: return null
        if (arr.length() == 0) return null
        return arr.getJSONObject(arr.length() - 1)
    }
}
