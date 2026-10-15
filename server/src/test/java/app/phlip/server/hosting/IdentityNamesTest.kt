package app.phlip.server.hosting

import android.app.Application
import app.phlip.server.AppState
import app.phlip.server.DrServer
import app.phlip.server.HostCommandCatalog
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

/** 016 Slice 1 — identity-keyed login + mutable display names. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class IdentityNamesTest {

    private lateinit var host: TestHost
    private lateinit var alice: TestHost.MemberSession
    private lateinit var bob: TestHost.MemberSession

    @Before
    fun setUp() {
        host = TestHost.start()
        alice = host.approveMember("Alice")
        bob = host.approveMember("Bob")
    }

    @After
    fun tearDown() {
        host.stop()
    }

    @Test
    fun catalogIncludesSetDisplayName() {
        assertTrue(HostCommandCatalog.MEMBER_RPC.contains("setDisplayName"))
        assertTrue(HostCommandCatalog.MEMBER_RPC.contains("setMemberDisplayName"))
    }

    @Test
    fun setDisplayName_rejectsCollision() {
        val clash = host.rpc(alice.token, "setDisplayName", JSONObject().put("name", "Bob"))
        // Error is delivered on the member session (poll / enqueue), not necessarily the RPC HTTP body.
        // Assert state unchanged.
        assertEquals("Alice", memberName(alice.userId))
        // Same name is fine (no-op / ack).
        host.rpc(alice.token, "setDisplayName", JSONObject().put("name", "Alice"))
        assertEquals("Alice", memberName(alice.userId))
        // Unique rename.
        host.rpc(alice.token, "setDisplayName", JSONObject().put("name", "Alice M"))
        // Drain enqueue so save/presence settle.
        Thread.sleep(50)
        assertEquals("Alice M", memberName(alice.userId))
        assertNotEquals("Bob", memberName(alice.userId))
        // Silence unused warning if RPC returns empty.
        assertTrue(clash.code == 200 || clash.code == 0 || clash.code > 0)
    }

    @Test
    fun hostOverride_setsFlagAndActivity() {
        host.rpc(
            host.hostToken,
            "setMemberDisplayName",
            JSONObject().put("userId", alice.userId).put("name", "Alice Marchant"),
        )
        Thread.sleep(50)
        val u = member(alice.userId)
        assertEquals("Alice Marchant", u.name)
        assertTrue(u.nameHostSet)
        assertEquals("Alice", u.nameSelf)
        val activity = serverState().serverActivity
        assertTrue(activity.isNotEmpty())
        val last = activity.last()
        assertEquals("nameChange", last.kind)
        assertTrue(last.hostSet)
        assertEquals("Alice", last.from)
        assertEquals("Alice Marchant", last.to)
        assertEquals(alice.userId, last.targetId)
    }

    @Test
    fun hostOverride_rejectsCollision() {
        host.rpc(
            host.hostToken,
            "setMemberDisplayName",
            JSONObject().put("userId", alice.userId).put("name", "Bob"),
        )
        Thread.sleep(50)
        assertEquals("Alice", memberName(alice.userId))
        assertTrue(!member(alice.userId).nameHostSet)
    }

    @Test
    fun selfRename_clearsHostOverride() {
        host.rpc(
            host.hostToken,
            "setMemberDisplayName",
            JSONObject().put("userId", alice.userId).put("name", "Alice HostSet"),
        )
        Thread.sleep(50)
        assertTrue(member(alice.userId).nameHostSet)
        host.rpc(alice.token, "setDisplayName", JSONObject().put("name", "Alice Self"))
        Thread.sleep(50)
        val u = member(alice.userId)
        assertEquals("Alice Self", u.name)
        assertTrue(!u.nameHostSet)
        assertEquals("Alice Self", u.nameSelf)
    }

    @Test
    fun returningJoin_matchesIdentityIdAfterRename() {
        val identityId = "a1b2c3d4e5f60718"
        val identityPub = "dGVzdFB1YktleQ=="
        val verifier = "test-auth-verifier-016"
        seedMemberAuth(alice.token, identityId, identityPub, verifier)

        host.rpc(alice.token, "setDisplayName", JSONObject().put("name", "Alice M"))
        Thread.sleep(50)
        assertEquals("Alice M", memberName(alice.userId))

        val (invite, _) = host.server.currentInvite()
        // Typed name is the old one — identityId + password still admits.
        val join = host.postJson(
            "/ash-join",
            JSONObject()
                .put("name", "Alice")
                .put("invite", invite)
                .put("fingerprint", "fp-alice-return-0123456789ab")
                .put("authVerifier", verifier)
                .put("identityId", identityId)
                .put("identityPub", identityPub),
        )
        assertEquals("welcome", join.type())
        val user = join.json!!.optJSONObject("user")
        assertEquals(alice.userId, user?.optString("id"))
        assertEquals("Alice M", user?.optString("name"))
        assertEquals(identityId, user?.optString("identityId"))
    }

    @Test
    fun membersRoster_includesIdentityPub() {
        val identityId = "b2c3d4e5f607189a"
        val identityPub = "dGVzdFB1YktleUZvclNlYWw="
        seedMemberAuth(alice.token, identityId, identityPub, "dmVyaWZpZXI=")
        val arr = host.server.testMembersPayloadForFixture(false)
        var found = false
        for (i in 0 until arr.length()) {
            val m = arr.getJSONObject(i)
            if (m.optString("id") == alice.userId) {
                assertEquals(identityId, m.optString("identityId"))
                assertEquals(identityPub, m.optString("identityPub"))
                found = true
            }
        }
        assertTrue("alice should appear in members with identityPub", found)
    }

    private fun memberName(userId: String): String {
        return member(userId).name
    }

    private fun member(userId: String): app.phlip.server.User {
        val state = serverState()
        return state.users.values.first { it.id == userId }
    }

    private fun seedMemberAuth(
        token: String,
        identityId: String,
        identityPub: String,
        verifier: String,
    ) {
        val state = serverState()
        val user = state.users[token] ?: error("no user for token")
        user.pwdSalt = "dGVzdHNhbHQxNjAxNjAxNg=="
        user.authVerifier = verifier
        user.wrappedGroupKey = "e2e:test-wrapped-group-key"
        user.identityId = identityId
        user.identityPub = identityPub
        invokeSave()
    }

    private fun serverState(): AppState {
        return host.server.testStateForFixture()
    }

    private fun invokeSave() {
        host.server.testSaveForFixture()
    }
}
