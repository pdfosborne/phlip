package app.phlip.server

import android.app.Application
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class SyncSliceBuilderTest {
    private val builder = SyncSliceBuilder()
    private val user = User(id = "u1", name = "Alice", joinedAt = 1L)

    @Test
    fun canonicalHashIgnoresObjectKeyOrder() {
        val a = JSONObject().put("b", 2).put("a", JSONObject().put("y", 2).put("x", 1))
        val b = JSONObject().put("a", JSONObject().put("x", 1).put("y", 2)).put("b", 2)
        assertEquals(builder.hash(a), builder.hash(b))
    }

    @Test
    fun unchangedManifestReturnsNoBodies() {
        val first = builder.response(snapshot(), user, request())
        val second = builder.response(snapshot(), user, request(first.getJSONObject("manifest")))
        assertEquals(0, second.getJSONArray("changed").length())
        assertEquals(first.getString("baseRevision"), second.getString("baseRevision"))
    }

    @Test
    fun changedChannelDoesNotReturnUnrelatedChannel() {
        val first = builder.response(snapshot(), user, request())
        val nextSnapshot = snapshot()
        nextSnapshot.getJSONArray("events").getJSONObject(0).put("duration", "2h")
        val second = builder.response(nextSnapshot, user, request(first.getJSONObject("manifest")))
        val changed = second.getJSONArray("changed")
        assertEquals(1, changed.length())
        assertEquals("channel:c1", changed.getJSONObject(0).getString("key"))
    }

    @Test
    fun eventsAreScopedToTheirVisibleChannelSlice() {
        val response = builder.response(snapshot(), user, request())
        val changed = response.getJSONArray("changed")
        val c1 = (0 until changed.length()).map { changed.getJSONObject(it) }
            .first { it.getString("key") == "channel:c1" }
            .getJSONObject("data")
        assertEquals(1, c1.getJSONArray("events").length())
        assertEquals("e1", c1.getJSONArray("events").getJSONObject(0).getString("id"))
        val c2 = (0 until changed.length()).map { changed.getJSONObject(it) }
            .first { it.getString("key") == "channel:c2" }
            .getJSONObject("data")
        assertEquals(0, c2.getJSONArray("events").length())
    }

    @Test
    fun missingChannelIsReturnedAsRemoval() {
        val first = builder.response(snapshot(), user, request())
        val next = snapshot()
        next.put("channels", JSONArray().put(next.getJSONArray("channels").getJSONObject(0)))
        next.put("events", JSONArray().put(next.getJSONArray("events").getJSONObject(0)))
        next.put("messages", JSONObject().put("c1", next.getJSONObject("messages").getJSONArray("c1")))
        val response = builder.response(next, user, request(first.getJSONObject("manifest")))
        val removed = response.getJSONArray("removed")
        assertTrue((0 until removed.length()).any { removed.getString(it) == "channel:c2" })
    }

    @Test
    fun principalMismatchForcesFullSliceSet() {
        val first = builder.response(snapshot(), user, request())
        val request = request(first.getJSONObject("manifest")).put("principalId", "someone-else")
        val response = builder.response(snapshot(), user, request)
        assertEquals(3, response.getJSONArray("changed").length())
        assertFalse(response.getJSONObject("manifest").has("channel:not-visible"))
    }

    @Test
    fun newestMessagesAreBoundedAndOlderPagesRemainAvailable() {
        val snap = snapshot()
        val messages = JSONArray()
        repeat(150) { i -> messages.put(JSONObject().put("id", "m%03d".format(i)).put("channelId", "c1").put("ts", i + 1)) }
        snap.getJSONObject("messages").put("c1", messages)
        val response = builder.response(snap, user, request())
        val changed = response.getJSONArray("changed")
        val channel = (0 until changed.length()).map { changed.getJSONObject(it) }
            .first { it.getString("key") == "channel:c1" }.getJSONObject("data")
        assertEquals(100, channel.getJSONArray("messages").length())
        assertTrue(channel.getBoolean("hasOlderMessages"))

        val page = builder.messagePage(snap, "c1", 51, "m050")
        assertEquals(50, page.getJSONArray("items").length())
        assertFalse(page.getBoolean("hasMore"))
    }

    private fun request(manifest: JSONObject? = null) = JSONObject()
        .put("protocol", 1)
        .put("principalId", user.id)
        .put("manifest", manifest ?: JSONObject())

    private fun snapshot(): JSONObject = JSONObject()
        .put("type", "welcome")
        .put("user", JSONObject().put("id", user.id).put("name", user.name))
        .put("hostName", "Host")
        .put("online", JSONArray().put(user.id))
        .put("channels", JSONArray()
            .put(JSONObject().put("id", "c1").put("kind", "event").put("name", "Plans"))
            .put(JSONObject().put("id", "c2").put("kind", "chat").put("name", "Chat")))
        .put("events", JSONArray().put(JSONObject().put("id", "e1").put("channelId", "c1").put("duration", "1h")))
        .put("availabilities", JSONArray())
        .put("timeBlocks", JSONArray())
        .put("messages", JSONObject()
            .put("c1", JSONArray().put(JSONObject().put("id", "m1").put("channelId", "c1").put("ts", 1)))
            .put("c2", JSONArray()))
}
