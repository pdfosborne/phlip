package app.phlip.server.hosting

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

/** Dual-path join: joinTag on /ash-ok and path-independent member tokens. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = HostTestApp::class)
class DualPathJoinTest {

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
    fun ashOk_includesJoinTagWhenSet() {
        host.server.setJoinTag("AB12")
        val r = host.get("/ash-ok")
        assertEquals(200, r.code)
        assertEquals("AB12", r.json?.optString("joinTag"))
        assertTrue(r.json?.optBoolean("ok") == true)
    }

    @Test
    fun memberTokenAuthenticatesAfterLanJoin() {
        host.server.setJoinTag("ZX99")
        host.server.setShareReach("http://192.168.1.10:3000", "https://join.example.test", true)
        val session = host.approveMember("Alex")
        val poll = host.poll(session.token)
        assertEquals(200, poll.code)
        val ping = host.rpc(session.token, "ping")
        assertEquals(200, ping.code)
    }

    @Test
    fun welcome_includesShareLanSharePublicForMember() {
        host.server.setJoinTag("QR01")
        host.server.setShareReach("http://192.168.1.20:8080", "https://club.example.test", true)
        val (invite, _) = host.server.currentInvite()
        val join = host.postJson(
            "/ash-join",
            org.json.JSONObject()
                .put("name", "Blake")
                .put("invite", invite)
                .put("fingerprint", "fp-blake-welcome"),
        )
        assertEquals("waiting", join.type())
        val requestId = join.json!!.optString("requestId")
        val approve = host.rpc(host.hostToken, "approveJoin", org.json.JSONObject().put("requestId", requestId))
        assertEquals(200, approve.code)
        var welcome: org.json.JSONObject? = null
        for (i in 0 until 40) {
            val w = host.get("/ash-join-wait", query = "id=$requestId")
            if (w.json?.has("token") == true) {
                welcome = w.json
                break
            }
            Thread.sleep(50)
        }
        val w = welcome ?: error("no welcome payload")
        assertEquals("QR01", w.optString("joinTag"))
        assertEquals("http://192.168.1.20:8080", w.optString("shareLan"))
        assertEquals("https://club.example.test", w.optString("sharePublic"))
        assertTrue(w.optBoolean("isPublic"))
    }

    @Test
    fun memberTokenWorksOnEdgeSimulatedPath() {
        val edgeHost = TestHost.start(
            TestHost.Seed(
                edgeSecret = "dual-path-edge-secret",
                edgeEnforce = true,
                apexDomain = "join.example.test",
            ),
        )
        try {
            edgeHost.server.setJoinTag("ED01")
            val session = edgeHost.approveMember("Casey")
            val lanPoll = edgeHost.poll(session.token)
            assertEquals(200, lanPoll.code)

            val edgeHeaders = mapOf(
                "cf-ray" to "test-ray-dual",
                "cf-connecting-ip" to "203.0.113.10",
                "Host" to "join.example.test",
                "X-Phlip-Edge" to "dual-path-edge-secret",
            )
            val edgePoll = edgeHost.get("/ash-poll", headers = edgeHeaders + mapOf("X-Ash-Token" to session.token))
            assertEquals(200, edgePoll.code)
            val edgePing = edgeHost.postJson(
                "/ash-rpc",
                JSONObject().put("type", "ping").put("token", session.token),
                headers = edgeHeaders,
                tokenHeader = session.token,
            )
            assertEquals(200, edgePing.code)
        } finally {
            edgeHost.stop()
        }
    }

    @Test
    fun unauthenticatedLanJoinRejected() {
        val fakeTok = "no-bearer-dual-path-test-token-000011112222"
        val poll = host.poll(fakeTok)
        assertTrue(
            poll.type() == "kicked" || poll.code == 403 || poll.type() == "error",
        )
        val rpc = host.rpc(fakeTok, "ping")
        assertTrue(rpc.type() == "kicked" || rpc.code == 403 || rpc.type() == "error")
        val joinWait = host.get("/ash-join-wait", query = "id=fake-request-id")
        assertTrue(joinWait.code == 403 || joinWait.type() == "error" || joinWait.body.isEmpty())
    }
}
