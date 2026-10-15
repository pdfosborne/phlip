package app.phlip.server.hosting

import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Stage 1 request-to-join: no rotating code, personal slug attribution. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = HostTestApp::class)
class RequestToJoinTest {

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
    fun newName_withoutInviteCode_entersWaiting() {
        val join = host.postJson(
            "/ash-join",
            JSONObject()
                .put("name", "Jordan")
                .put("fingerprint", "fp-jordan-0123456789abcdef"),
        )
        assertEquals(200, join.code)
        assertEquals("waiting", join.type())
        assertTrue(join.json!!.optString("requestId").isNotEmpty())
    }

    @Test
    fun personalSlug_attributesPendingRequest() {
        val slug = host.server.hostInviteSlug()
        assertNotNull(slug)
        assertTrue(slug!!.length >= 8)

        val join = host.postJson(
            "/ash-join",
            JSONObject()
                .put("name", "Sam")
                .put("fingerprint", "fp-sam-0123456789abcdefxx")
                .put("inviteSlug", slug),
        )
        assertEquals("waiting", join.type())
        val requestId = join.json!!.optString("requestId")

        val entry = host.server.pendingJoinsSnapshot().find { it.id == requestId }
        assertNotNull(entry)
        assertEquals(slug, entry!!.inviteSlug)
        assertNotNull(entry.invitedByUserId)
        assertFalse(entry.invitedByName.isNullOrBlank())
    }

    @Test
    fun forgedSlug_doesNotAttribute_stillAllowsRequest() {
        val join = host.postJson(
            "/ash-join",
            JSONObject()
                .put("name", "Pat")
                .put("fingerprint", "fp-pat-0123456789abcdefxx")
                .put("inviteSlug", "zzzzzzzzzzzzzzzz"),
        )
        assertEquals("waiting", join.type())
        val requestId = join.json!!.optString("requestId")
        val entry = host.server.pendingJoinsSnapshot().find { it.id == requestId }
        assertNotNull(entry)
        assertNull(entry!!.invitedByUserId)
        assertNull(entry.inviteSlug)
    }

    @Test
    fun rotateInviteLink_invalidatesOldSlug() {
        host.server.setShareReach(
            "http://192.168.1.20:3000",
            "https://myserver.example.com",
            true,
        )
        val oldSlug = host.server.hostInviteSlug()
        assertNotNull(oldSlug)
        val newUrl = host.server.rotateHostPersonalInviteUrl()
        assertNotNull(newUrl)
        val newSlug = host.server.hostInviteSlug()
        assertNotNull(newSlug)
        assertNotEquals(oldSlug, newSlug)
        assertTrue(newUrl!!.endsWith("/j/$newSlug"))
        assertTrue(newUrl.startsWith("https://myserver.example.com/j/"))

        val joinOld = host.postJson(
            "/ash-join",
            JSONObject()
                .put("name", "OldSlugUser")
                .put("fingerprint", "fp-oldslug-0123456789ab")
                .put("inviteSlug", oldSlug),
        )
        assertEquals("waiting", joinOld.type())
        val oldEntry = host.server.pendingJoinsSnapshot()
            .find { it.id == joinOld.json!!.optString("requestId") }
        assertNull(oldEntry!!.invitedByUserId)

        val joinNew = host.postJson(
            "/ash-join",
            JSONObject()
                .put("name", "NewSlugUser")
                .put("fingerprint", "fp-newslug-0123456789ab")
                .put("inviteSlug", newSlug),
        )
        assertEquals("waiting", joinNew.type())
        val newEntry = host.server.pendingJoinsSnapshot()
            .find { it.id == joinNew.json!!.optString("requestId") }
        assertEquals(newSlug, newEntry!!.inviteSlug)
    }

    @Test
    fun approveMember_withoutCode_works() {
        val session = host.approveMember("Riley")
        assertTrue(session.token.isNotEmpty())
        assertTrue(session.userId.isNotEmpty())
    }

    @Test
    fun memberGetsPersonalInviteSlug() {
        val session = host.approveMember("Casey")
        // After approve, slug is minted in issueWelcome; confirm via host RPC path on member token
        // by reading welcome-stored user through a trivial poll + getInviteLink is optional —
        // approveMember welcome JSON includes user.inviteSlug when minted.
        val join = host.postJson(
            "/ash-join",
            JSONObject()
                .put("name", "Casey2")
                .put("fingerprint", "fp-casey2-0123456789abcd"),
        )
        assertEquals("waiting", join.type())
        val requestId = join.json!!.optString("requestId")
        host.rpc(host.hostToken, "approveJoin", JSONObject().put("requestId", requestId))
        var welcome: JSONObject? = null
        repeat(40) {
            val w = host.get("/ash-join-wait", query = "id=$requestId")
            if (w.json?.has("token") == true) {
                welcome = w.json
                return@repeat
            }
            Thread.sleep(50)
        }
        assertNotNull(welcome)
        val user = welcome!!.optJSONObject("user")
        assertNotNull(user)
        assertTrue(user!!.optString("inviteSlug").length >= 8)
        host.server.setShareReach("http://192.168.1.10:3000", null, false)
        val welcome2 = host.server.hostPersonalInviteUrl()
        assertNotNull(welcome2)
        assertEquals("http://192.168.1.10:3000", welcome2)
        host.server.setShareReach(
            "http://192.168.1.10:3000",
            "https://myserver.example.com",
            true,
        )
        val pubInvite = host.server.hostPersonalInviteUrl()
        assertNotNull(pubInvite)
        assertTrue(pubInvite!!.startsWith("https://myserver.example.com/j/"))
        assertTrue(session.token.isNotEmpty())
    }
}
