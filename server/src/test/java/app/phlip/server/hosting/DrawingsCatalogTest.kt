package app.phlip.server.hosting

import android.app.Application
import org.json.JSONArray
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

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class DrawingsCatalogTest {

    private lateinit var host: TestHost
    private lateinit var alice: TestHost.MemberSession
    private lateinit var channelId: String

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
    fun drawnChatReaction_isAccepted_unknownEmoji_isRejected() {
        val messageId = "msgdraw01"
        host.rpc(
            alice.token,
            "sendMessage",
            JSONObject()
                .put("channelId", channelId)
                .put("id", messageId)
                .put("text", "hello"),
        )
        Thread.sleep(40)

        host.rpc(
            alice.token,
            "reactMessage",
            JSONObject()
                .put("channelId", channelId)
                .put("messageId", messageId)
                .put("emoji", "not-an-emoji"),
        )
        Thread.sleep(40)
        assertEquals("", messageReaction(channelId, messageId, alice.userId))

        val drawing = "d:testdrawchat"
        host.rpc(
            alice.token,
            "reactMessage",
            JSONObject()
                .put("channelId", channelId)
                .put("messageId", messageId)
                .put("emoji", drawing),
        )
        Thread.sleep(40)
        assertEquals(drawing, messageReaction(channelId, messageId, alice.userId))
        assertTrue("drawn chat reaction should land in the catalog", catalogHas(drawing))
    }

    @Test
    fun deleteReactionCard_clearsEventIconAndChatReaction() {
        val drawing = "d:testdrawicon"
        val before = host.eventIds()
        host.rpc(
            alice.token,
            "createEvent",
            JSONObject()
                .put("channelId", channelId)
                .put("title", "e2e:drawn")
                .put("when", System.currentTimeMillis() + 86_400_000L)
                .put("icon", drawing),
        )
        Thread.sleep(40)
        val eventId = (host.eventIds() - before).firstOrNull()
        assertNotNull(eventId)
        assertEquals(drawing, host.findEvent(eventId!!)!!.optString("icon"))
        assertTrue(catalogHas(drawing))

        val messageId = "msgdraw02"
        host.rpc(
            alice.token,
            "sendMessage",
            JSONObject()
                .put("channelId", channelId)
                .put("id", messageId)
                .put("text", "react me"),
        )
        Thread.sleep(40)
        host.rpc(
            alice.token,
            "reactMessage",
            JSONObject()
                .put("channelId", channelId)
                .put("messageId", messageId)
                .put("emoji", drawing),
        )
        Thread.sleep(40)
        assertEquals(drawing, messageReaction(channelId, messageId, alice.userId))

        host.rpc(
            host.hostToken,
            "deleteReactionCard",
            JSONObject().put("card", drawing),
        )
        Thread.sleep(40)
        assertFalse(catalogHas(drawing))
        assertEquals("", host.findEvent(eventId)!!.optString("icon"))
        assertEquals("", messageReaction(channelId, messageId, alice.userId))
    }

    private fun catalogHas(card: String): Boolean {
        val arr = JSONObject(host.dataFile.readText()).optJSONArray("reactionCards") ?: JSONArray()
        for (i in 0 until arr.length()) {
            val el = arr.opt(i)
            val value = when (el) {
                is JSONObject -> el.optString("card")
                else -> el?.toString().orEmpty()
            }
            if (value == card) return true
        }
        return false
    }

    private fun messageReaction(channelId: String, messageId: String, userId: String): String {
        val msgs = JSONObject(host.dataFile.readText())
            .optJSONObject("messages")
            ?.optJSONArray(channelId)
            ?: return ""
        for (i in 0 until msgs.length()) {
            val msg = msgs.optJSONObject(i) ?: continue
            if (msg.optString("id") != messageId) continue
            return msg.optJSONObject("reactions")?.optString(userId).orEmpty()
        }
        return ""
    }
}
