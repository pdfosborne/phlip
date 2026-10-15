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

/** Bare public root: returning-member authentication only, never request-to-join. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = HostTestApp::class)
class PublicLoginTest {

    private lateinit var host: TestHost

    @Before
    fun setUp() {
        host = TestHost.start()
    }

    @After
    fun tearDown() {
        host.stop()
    }

    private fun passwordMember(name: String, verifier: String): TestHost.MemberSession {
        val member = host.approveMember(name)
        host.rpc(
            member.token,
            "setPassword",
            JSONObject()
                .put("pwdSalt", "cHVibGljLWxvZ2luLXNhbHQ=")
                .put("authVerifier", verifier)
                .put("wrappedGroupKey", "e2e:public-login-wrapped-key")
                .put("fingerprint", TestHost.fp("$name-setup")),
        )
        return member
    }

    @Test
    fun knownMember_correctVerifier_getsWelcomeAndFreshToken() {
        val old = passwordMember("Alice", "verifier-alice-public-login")
        val login = host.postJson(
            "/ash-login",
            JSONObject()
                .put("name", "Alice")
                .put("authVerifier", "verifier-alice-public-login")
                .put("fingerprint", TestHost.fp("alice-return")),
        )

        assertEquals(200, login.code)
        assertEquals("welcome", login.type())
        assertTrue(login.json!!.optString("token").isNotEmpty())
        assertNotEquals(old.token, login.json!!.optString("token"))
    }

    @Test
    fun authSalt_returnsRealForMemberAndBlindForUnknown() {
        passwordMember("Alice", "verifier-alice-public-login")
        val known = host.get("/ash-auth-salt", query = "name=Alice")
        val unknown = host.get("/ash-auth-salt", query = "name=Unknown")

        assertEquals("authSalt", known.type())
        assertEquals("authSalt", unknown.type())
        assertEquals("cHVibGljLWxvZ2luLXNhbHQ=", known.json!!.optString("salt"))
        assertTrue(unknown.json!!.optString("salt").isNotEmpty())
        assertNotEquals(known.json!!.optString("salt"), unknown.json!!.optString("salt"))
    }

    @Test
    fun wrongAndUnknownCredentials_areIdenticalAndNeverPending() {
        passwordMember("Alice", "verifier-alice-public-login")
        val before = host.server.pendingJoinsSnapshot().size
        val wrong = host.postJson(
            "/ash-login",
            JSONObject()
                .put("name", "Alice")
                .put("authVerifier", "wrong-verifier")
                .put("fingerprint", TestHost.fp("alice-wrong")),
        )
        val unknown = host.postJson(
            "/ash-login",
            JSONObject()
                .put("name", "Unknown")
                .put("authVerifier", "blind-salt-derived-verifier")
                .put("fingerprint", TestHost.fp("unknown-login")),
        )

        assertEquals("error", wrong.type())
        assertEquals("error", unknown.type())
        assertEquals("Wrong name or password.", wrong.error())
        assertEquals(wrong.error(), unknown.error())
        assertEquals(before, host.server.pendingJoinsSnapshot().size)
    }

    @Test
    fun incompleteAccount_isRejectedAndNeverReminted() {
        host.approveMember("Incomplete")
        val before = host.server.pendingJoinsSnapshot().size
        val login = host.postJson(
            "/ash-login",
            JSONObject()
                .put("name", "Incomplete")
                .put("authVerifier", "any-verifier")
                .put("fingerprint", TestHost.fp("incomplete-login")),
        )

        assertEquals("error", login.type())
        assertEquals("Wrong name or password.", login.error())
        assertEquals(before, host.server.pendingJoinsSnapshot().size)
    }

    @Test
    fun validPersonalInvite_stillUsesJoinApprovalFlow() {
        val slug = host.server.hostInviteSlug()!!
        val join = host.postJson(
            "/ash-join",
            JSONObject()
                .put("name", "NewInviteMember")
                .put("fingerprint", TestHost.fp("new-invite-member"))
                .put("inviteSlug", slug),
        )

        assertEquals("waiting", join.type())
        assertTrue(join.json!!.optString("requestId").isNotEmpty())
    }

    @Test
    fun personalInvite_correctExistingCredentialsReturnWelcomeWithoutPending() {
        passwordMember("Alice", "verifier-alice-public-login")
        val before = host.server.pendingJoinsSnapshot().size
        val join = host.postJson(
            "/ash-join",
            JSONObject()
                .put("name", "Alice")
                .put("authVerifier", "verifier-alice-public-login")
                .put("fingerprint", TestHost.fp("alice-invite-return"))
                .put("inviteSlug", host.server.hostInviteSlug()),
        )

        assertEquals("welcome", join.type())
        assertTrue(join.json!!.optString("token").isNotEmpty())
        assertEquals(before, host.server.pendingJoinsSnapshot().size)
    }

    @Test
    fun personalInvite_wrongExistingCredentialsNeverEnqueueDuplicate() {
        passwordMember("Alice", "verifier-alice-public-login")
        val before = host.server.pendingJoinsSnapshot().size
        val join = host.postJson(
            "/ash-join",
            JSONObject()
                .put("name", "Alice")
                .put("authVerifier", "wrong-verifier")
                .put("fingerprint", TestHost.fp("alice-invite-wrong"))
                .put("inviteSlug", host.server.hostInviteSlug()),
        )

        assertEquals("error", join.type())
        assertEquals("Wrong name or password.", join.error())
        assertEquals(before, host.server.pendingJoinsSnapshot().size)
    }

    @Test
    fun personalInvite_remintsIncompleteAccountForPasswordSetup() {
        host.approveMember("Incomplete")
        val join = host.postJson(
            "/ash-join",
            JSONObject()
                .put("name", "Incomplete")
                .put("authVerifier", "blind-salt-derived-verifier")
                .put("fingerprint", TestHost.fp("incomplete-invite"))
                .put("inviteSlug", host.server.hostInviteSlug()),
        )

        assertEquals("welcome", join.type())
        assertTrue(join.json!!.optBoolean("needsPassword"))
        assertTrue(join.json!!.optString("setupNonce").isNotEmpty())
        assertTrue(join.json!!.optString("token").isNotEmpty())
    }
}
