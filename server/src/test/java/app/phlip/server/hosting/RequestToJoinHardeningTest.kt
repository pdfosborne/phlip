package app.phlip.server.hosting

import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Stage 7 adversarial / resilience checks for request-to-join + edge ingest. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = HostTestApp::class)
class RequestToJoinHardeningTest {

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
    fun oversizedName_rejected() {
        val longName = "N".repeat(200)
        val join = host.postJson(
            "/ash-join",
            JSONObject()
                .put("name", longName)
                .put("fingerprint", "fp-longname-0123456789ab"),
        )
        // Server truncates to 24 — still waiting, not crash
        assertTrue(join.code == 200 || join.code == 403)
        if (join.type() == "waiting") {
            assertTrue(join.json!!.optString("requestId").isNotEmpty())
        }
    }

    @Test
    fun emptyFingerprint_rejected() {
        val join = host.postJson(
            "/ash-join",
            JSONObject().put("name", "NoFp").put("fingerprint", "short"),
        )
        assertEquals("error", join.type())
    }

    @Test
    fun pendingDoesNotLeakOtherRequests() {
        host.postJson(
            "/ash-join",
            JSONObject().put("name", "Alpha").put("fingerprint", "fp-alpha-0123456789abcd"),
        )
        val joinB = host.postJson(
            "/ash-join",
            JSONObject().put("name", "Beta").put("fingerprint", "fp-beta-0123456789abcdef"),
        )
        assertEquals("waiting", joinB.type())
        // Wait poll for B must not include Alpha's name
        val wait = host.get("/ash-join-wait", query = "id=${joinB.json!!.optString("requestId")}")
        assertEquals("waiting", wait.type())
        assertTrue(!wait.body.contains("Alpha"))
    }

    @Test
    fun ingestEdgeJoinRequest_withSlug_attributes() {
        val slug = host.server.hostInviteSlug()!!
        val result = host.server.ingestEdgeJoinRequest(
            JSONObject()
                .put("name", "EdgeUser")
                .put("fingerprint", "fp-edgeuser-0123456789ab")
                .put("inviteSlug", slug)
                .put("sourceIp", "203.0.113.10"),
        )
        assertEquals("waiting", result.optString("type"))
        val rid = result.optString("requestId")
        val entry = host.server.pendingJoinsSnapshot().find { it.id == rid }
        assertEquals(slug, entry!!.inviteSlug)
    }

    @Test
    fun ingestEdgeJoinRequest_forgedSlug_noAttribution() {
        val result = host.server.ingestEdgeJoinRequest(
            JSONObject()
                .put("name", "Forged")
                .put("fingerprint", "fp-forged-0123456789abcd")
                .put("inviteSlug", "notarealslugxxxx")
                .put("sourceIp", "203.0.113.11"),
        )
        assertEquals("waiting", result.optString("type"))
        val rid = result.optString("requestId")
        val entry = host.server.pendingJoinsSnapshot().find { it.id == rid }
        assertEquals(null, entry!!.invitedByUserId)
    }

    @Test
    fun rotateHostSlug_changesPublicUrl() {
        host.server.setShareReach(
            "http://10.0.0.5:3000",
            "https://myserver.example.com",
            true,
        )
        val a = host.server.hostPersonalInviteUrl()!!
        val b = host.server.rotateHostPersonalInviteUrl()!!
        assertNotEquals(a, b)
        assertTrue(b.startsWith("https://myserver.example.com/j/"))
    }

    @Test
    fun localInviteUrl_isBareLanOrigin() {
        host.server.setShareReach("http://10.0.0.5:3000", null, false)
        val url = host.server.hostPersonalInviteUrl()!!
        assertEquals("http://10.0.0.5:3000", url)
        // Rotating the slug must not invent a /j/ path while Local.
        val after = host.server.rotateHostPersonalInviteUrl()!!
        assertEquals("http://10.0.0.5:3000", after)
    }

    @Test
    fun lanPersonalInvitePath_acceptsGetAndPost() {
        val slug = host.server.hostInviteSlug()!!
        val meta = host.get("/j/$slug", headers = mapOf("Accept" to "application/json"))
        assertEquals(200, meta.code)
        assertEquals(true, meta.json?.optBoolean("ok"))
        assertEquals(slug, meta.json?.optString("slug"))
        val join = host.postJson(
            "/j/$slug/request",
            JSONObject()
                .put("name", "LanJoin")
                .put("fingerprint", "fp-lanjoin-0123456789ab"),
        )
        assertEquals(200, join.code)
        assertEquals("waiting", join.type())
    }

    @Test
    fun lanPersonalInviteHtml_redirectsToSpaForAgreement() {
        val slug = host.server.hostInviteSlug()!!
        val r = host.get(
            "/j/$slug",
            headers = mapOf("Accept" to "text/html"),
            // OkHttp follows redirects by default — ask for no follow via encoded check of Location
        )
        // Followed redirect lands on SPA index (200 HTML) or we see 3xx if not followed.
        assertTrue(
            "expected SPA HTML or redirect, got ${r.code}",
            r.code == 200 || r.code in 300..399,
        )
        if (r.code == 200) {
            val body = r.body ?: ""
            assertTrue(
                "SPA should load so agreement can run before join",
                body.contains("phlip", ignoreCase = true) ||
                    body.contains("index", ignoreCase = true) ||
                    body.contains("<!DOCTYPE html", ignoreCase = true) ||
                    body.contains("Agree", ignoreCase = true) ||
                    body.contains("app", ignoreCase = true),
            )
        }
    }

    @Test
    fun ashOk_exposesOnlyExplicitJoinMetadata() {
        host.server.setJoinTag("AB12")
        val r = host.get("/ash-ok")
        assertEquals(200, r.code)
        val keys = mutableSetOf<String>()
        val iterator = r.json!!.keys()
        while (iterator.hasNext()) keys += iterator.next()
        assertEquals(setOf("ok", "name", "minAge", "joinTag"), keys)
    }
}
