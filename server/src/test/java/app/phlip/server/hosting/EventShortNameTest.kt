package app.phlip.server.hosting

import android.app.Application
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class EventShortNameTest {
    @Test fun shortNamePersistsSyncsAndClearsWithoutChangingTitle() {
        val host = TestHost.start()
        try {
            val member = host.approveMember("Reader")
            val channel = host.createEventChannel("Plans", listOf(host.hostUserId(), member.userId))
            val id = "short-name-event"
            host.rpc(host.hostToken, "createEvent", JSONObject()
                .put("id", id).put("channelId", channel).put("title", "cipher:full-title")
                .put("shortName", "cipher:short-name").put("when", 1_900_000_000_000L))
            assertEquals("cipher:short-name", host.findEvent(id)?.optString("shortName"))
            host.rpc(host.hostToken, "setEventType", JSONObject()
                .put("eventId", id).put("title", "cipher:renamed-title"))
            assertEquals("cipher:short-name", host.findEvent(id)?.optString("shortName"))
            host.rpc(host.hostToken, "setEventType", JSONObject()
                .put("eventId", id).put("title", "cipher:renamed-title").put("shortName", "cipher:new-short"))
            assertEquals("cipher:new-short", host.findEvent(id)?.optString("shortName"))
            assertTrue(host.poll(member.token).body.contains("cipher:new-short"))
            host.rpc(host.hostToken, "setEventType", JSONObject()
                .put("eventId", id).put("title", "cipher:renamed-title").put("shortName", ""))
            assertNull(host.server.testStateForFixture().events.first { it.id == id }.shortName)
            assertEquals("cipher:renamed-title", host.findEvent(id)?.optString("title"))
        } finally { host.stop() }
    }
}
