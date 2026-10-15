package app.phlip.server.hosting

import android.app.Application
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class EventCardStyleSyncTest {
    private lateinit var host: TestHost
    private lateinit var member: TestHost.MemberSession
    private lateinit var channelId: String
    private lateinit var typeId: String

    @Before
    fun setUp() {
        host = TestHost.start()
        member = host.approveMember("Member")
        channelId = host.createEventChannel("Styled", listOf(host.hostUserId(), member.userId))
        typeId = host.server.testStateForFixture().eventTypes.first().id
    }

    @After
    fun tearDown() = host.stop()

    private fun style(id: String, imageBg: String) = JSONObject()
        .put("id", id)
        .put("name", "Style $id")
        .put("colors", JSONObject()
            .put("imageBg", imageBg).put("imageFg", "#111827")
            .put("badgeBg", "#FFFFFF").put("badgeText", "#111827")
            .put("subtitleBg", "#F3F8FC").put("subtitleText", "#285B80")
            .put("infoBg", "#FFFFFF").put("detailText", "#4B5563")
            .put("border", "#E5E7EB"))
        .put("fonts", JSONObject()
            .put("titleFont", "inter").put("badgeFont", "inter").put("detailsFont", "inter"))
        .put("options", JSONObject().put("subtitleBorder", true))

    private fun create(token: String, id: String) {
        host.rpc(token, "createEvent", JSONObject()
            .put("id", id).put("channelId", channelId)
            .put("title", "cipher:title").put("where", "")
            .put("typeId", typeId)
            .put("when", 1_900_000_000_000L))
    }

    @Test
    fun creatorDefaultIsSnapshottedAndOnlyCreatorCanOverride() {
        val first = "style-event-first"
        create(host.hostToken, first)
        assertEquals("simple", host.server.testStateForFixture().events.first { it.id == first }.eventCardStyle?.id)

        host.rpc(host.hostToken, "setUserEventCardStyle",
            JSONObject().put("eventCardStyle", style("custom:blue", "#123456")))
        val second = "style-event-second"
        create(host.hostToken, second)
        val state = host.server.testStateForFixture()
        assertEquals("simple", state.events.first { it.id == first }.eventCardStyle?.id)
        assertEquals("custom:blue", state.events.first { it.id == second }.eventCardStyle?.id)

        host.rpc(member.token, "setEventCardStyle", JSONObject()
            .put("eventId", second).put("eventCardStyle", style("custom:denied", "#654321")))
        assertEquals("custom:blue", state.events.first { it.id == second }.eventCardStyle?.id)

        host.rpc(host.hostToken, "setEventCardStyle", JSONObject()
            .put("eventId", second).put("eventCardStyle", style("custom:one-off", "#ABCDEF")))
        assertEquals("custom:one-off", state.events.first { it.id == second }.eventCardStyle?.id)
    }

    @Test
    fun malformedStyleIsRejected() {
        host.rpc(host.hostToken, "setUserEventCardStyle", JSONObject()
            .put("eventCardStyle", style("bad style", "red")))
        assertNull(host.server.testStateForFixture().users.values.first { it.id == host.hostUserId() }.eventCardStyle)
    }

}
