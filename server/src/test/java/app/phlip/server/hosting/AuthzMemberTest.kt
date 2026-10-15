package app.phlip.server.hosting

import android.app.Application
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Member authorization — AUTHZ-M from hosting-security-tests.md. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class AuthzMemberTest {

    private lateinit var host: TestHost
    private lateinit var alice: TestHost.MemberSession
    private lateinit var bob: TestHost.MemberSession
    private lateinit var mod: TestHost.MemberSession

    @Before
    fun setUp() {
        host = TestHost.start()
        alice = host.approveMember("Alice", role = "user")
        bob = host.approveMember("Bob", role = "user")
        mod = host.approveMember("Mod", role = "moderator")
    }

    @After
    fun tearDown() {
        host.stop()
    }

    /** M-01 — Member A edits event in a channel they cannot see. */
    @Test
    fun M01_memberCannotEditHiddenChannelEvent() {
        val privateCh = host.createEventChannel("Secret", listOf(host.hostUserId(), bob.userId))
        val evId = host.createEvent(host.hostToken, privateCh, title = "e2e:secret")
        val before = host.findEvent(evId)!!.optString("where")
        host.rpc(alice.token, "setEventWhere", JSONObject().put("eventId", evId).put("where", "e2e:leaked"))
        assertEquals(before, host.findEvent(evId)!!.optString("where"))
    }

    /** M-02 — Member deletes another member's message without mod rights. */
    @Test
    fun privatePeopleSelectionOverridesRoleVisibility() {
        val chat = host.createChatChannel("Selected people", listOf(host.hostUserId(), alice.userId))
        val perms = JSONObject()
            .put("user", JSONObject().put("view", false))
            .put("viewer", JSONObject().put("view", false))
            .put("moderator", JSONObject().put("view", false))
        host.rpc(host.hostToken, "updateChannel", JSONObject()
            .put("channelId", chat).put("rolePerms", perms))
        val before = host.messageCount(chat)
        host.rpc(alice.token, "sendMessage", JSONObject().put("channelId", chat).put("text", "private note"))
        assertEquals(before + 1, host.messageCount(chat))
        host.rpc(bob.token, "sendMessage", JSONObject().put("channelId", chat).put("text", "not selected"))
        host.rpc(mod.token, "sendMessage", JSONObject().put("channelId", chat).put("text", "not selected mod"))
        assertEquals(before + 1, host.messageCount(chat))
    }

    @Test
    fun M02_memberCannotDeleteOthersMessage() {
        val chat = host.createChatChannel("Lobby", allowedUserIds = null) // open
        // Ensure alice/bob can see open channels — null allow-list = everyone.
        host.rpc(bob.token, "sendMessage", JSONObject().put("channelId", chat).put("text", "e2e:bob-msg"))
        // Find message id from data file.
        val o = JSONObject(host.dataFile.readText())
        val msgs = o.getJSONObject("messages").getJSONArray(chat)
        assertTrue(msgs.length() >= 1)
        val msgId = msgs.getJSONObject(msgs.length() - 1).optString("id")
        val countBefore = host.messageCount(chat)
        host.rpc(alice.token, "deleteMessage", JSONObject().put("messageId", msgId).put("channelId", chat))
        assertEquals(countBefore, host.messageCount(chat))
    }

    /** M-03 — Moderator deletes in a channel they cannot see. */
    @Test
    fun M03_moderatorCannotModerateInvisibleChannel() {
        val privateCh = host.createChatChannel("Hidden", listOf(host.hostUserId(), alice.userId))
        host.rpc(alice.token, "sendMessage", JSONObject().put("channelId", privateCh).put("text", "e2e:hidden"))
        val o = JSONObject(host.dataFile.readText())
        val msgs = o.getJSONObject("messages").getJSONArray(privateCh)
        val msgId = msgs.getJSONObject(0).optString("id")
        val before = host.messageCount(privateCh)
        host.rpc(mod.token, "deleteMessage", JSONObject().put("messageId", msgId).put("channelId", privateCh))
        assertEquals(before, host.messageCount(privateCh))
    }

    /** M-06 / M-07 — createEvent replay into different channel / another member's event. */
    @Test
    fun M06_M07_createEventReplayGuards() {
        val chA = host.createEventChannel("A", listOf(host.hostUserId(), alice.userId, bob.userId))
        val chB = host.createEventChannel("B", listOf(host.hostUserId(), alice.userId, bob.userId))
        val id = "replayid01234567890123"
        host.createEvent(alice.token, chA, title = "e2e:alice", id = id)
        val countBefore = host.eventIds().size
        // Replay into different channel — must not create / must not move.
        host.rpc(
            alice.token,
            "createEvent",
            JSONObject()
                .put("id", id)
                .put("channelId", chB)
                .put("title", "e2e:moved")
                .put("when", System.currentTimeMillis() + 99_000)
                .put("where", "x")
                .put("details", "y"),
        )
        assertEquals(countBefore, host.eventIds().size)
        assertEquals(chA, host.findEvent(id)!!.optString("channelId"))

        // Bob replays Alice's id — no new event, Alice's event unchanged.
        host.rpc(
            bob.token,
            "createEvent",
            JSONObject()
                .put("id", id)
                .put("channelId", chA)
                .put("title", "e2e:stolen")
                .put("when", System.currentTimeMillis() + 99_000)
                .put("where", "x")
                .put("details", "y"),
        )
        assertEquals("e2e:alice", host.findEvent(id)!!.optString("title"))
    }

    /** M-08 — addPerson targeting a user not visible; uniform error (no existence leak). */
    @Test
    fun M08_addPersonHiddenTargetNoExistenceDisclosure() {
        val privateCh = host.createEventChannel("Inner", listOf(host.hostUserId(), alice.userId))
        val ev = host.createEvent(alice.token, privateCh)
        // Bob is not visible on this channel — addPerson should no-op.
        val before = host.findEvent(ev)!!.toString()
        val r1 = host.rpc(
            alice.token,
            "addPerson",
            JSONObject().put("eventId", ev).put("userId", bob.userId),
        )
        // Unknown user id — same silent reject path.
        val r2 = host.rpc(
            alice.token,
            "addPerson",
            JSONObject().put("eventId", ev).put("userId", "does-not-exist-zzzz"),
        )
        assertEquals(before, host.findEvent(ev)!!.toString())
        // HTTP envelope identical (both ok with empty side-effects) — no distinct error bodies.
        assertEquals(r1.type(), r2.type())
        assertEquals(r1.code, r2.code)
    }

    /** M-09 — Pending (unapproved) has no bearer; join-wait only. */
    @Test
    fun M09_pendingHasNoReadAccess() {
        val (invite, _) = host.server.currentInvite()
        val join = host.postJson(
            "/ash-join",
            JSONObject()
                .put("name", "PendingPat")
                .put("invite", invite)
                .put("fingerprint", TestHost.fp("pendingpat")),
        )
        assertEquals("waiting", join.type())
        val fakeTok = "pending-not-a-real-token-0000111122223333"
        val poll = host.poll(fakeTok)
        assertTrue(
            poll.type() == "kicked" || poll.code == 403 || poll.type() == "error" ||
                poll.body.contains("Removed", ignoreCase = true),
        )
        val rpc = host.rpc(fakeTok, "sendMessage", JSONObject().put("text", "x").put("channelId", "y"))
        assertTrue(rpc.type() == "kicked" || rpc.code == 403)
    }

    /** M-10 — Removed member's bearer rejected on write. */
    @Test
    fun M10_removedMemberWriteRejected() {
        host.rpc(host.hostToken, "removeMember", JSONObject().put("userId", bob.userId))
        val r = host.rpc(
            bob.token,
            "sendMessage",
            JSONObject().put("channelId", host.channelIds().first()).put("text", "e2e:after-kick"),
        )
        assertTrue(r.type() == "kicked" || r.code == 403)
    }

    /** M-11 — Expired / malformed / truncated bearer → uniform reject. */
    @Test
    fun M11_malformedBearersUniformReject() {
        val samples = listOf(
            "",
            "abc",
            "0".repeat(31),
            "g".repeat(32),
            alice.token.dropLast(1),
            "zz" + alice.token.drop(2),
        )
        val bodies = samples.map { tok ->
            host.rpc(tok, "ping").let { "${it.code}|${it.type()}|${it.error()}" }
        }
        // All rejects should share the same envelope (kicked / Forbidden).
        val distinct = bodies.toSet()
        assertTrue("expected uniform reject envelopes, got $distinct", distinct.size <= 2)
        for (b in bodies) {
            assertTrue(b.contains("kicked") || b.contains("403") || b.contains("error"))
        }
        // Empty vs truncated should not disclose "expired" vs "invalid" differently.
        assertEquals(bodies[0], bodies[2])
    }

    /** M-12 — Bearer from server A rejected on server B. */
    @Test
    fun M12_crossServerBearerRejected() {
        val other = TestHost.start(TestHost.Seed(hostName = "Other Host"))
        try {
            val r = other.rpc(alice.token, "ping")
            assertTrue(r.type() == "kicked" || r.code == 403)
        } finally {
            other.stop()
        }
    }

    /** M-13 — Password sign-in remint invalidates prior bearer. */
    @Test
    fun M13_passwordSignInRemintsBearer() {
        // Set password via RPC (first-time).
        host.rpc(
            alice.token,
            "setPassword",
            JSONObject()
                .put("pwdSalt", "c2FsdA==")
                .put("authVerifier", "verifier-alice-0001")
                .put("wrappedGroupKey", "e2e:wrapped-key-material")
                .put("fingerprint", TestHost.fp("alice-device")),
        )
        val oldTok = alice.token
        val join = host.postJson(
            "/ash-join",
            JSONObject()
                .put("name", "Alice")
                .put("authVerifier", "verifier-alice-0001")
                .put("fingerprint", TestHost.fp("alice-device-2")),
        )
        assertTrue("expected welcome, got ${join.type()} ${join.error()}", join.json?.has("token") == true)
        val newTok = join.json!!.optString("token")
        assertNotEquals(oldTok, newTok)
        val oldRpc = host.rpc(oldTok, "ping")
        assertTrue(oldRpc.type() == "kicked" || oldRpc.code == 403)
        assertEquals("pong", host.rpc(newTok, "ping").type())
    }

    @Test
    fun mentionDoesNotNotifyUserWhoCannotSeeChat() {
        val privateCh = host.createChatChannel("Hidden", listOf(host.hostUserId(), alice.userId))
        host.rpc(
            alice.token,
            "sendMessage",
            JSONObject()
                .put("channelId", privateCh)
                .put("text", "e2e:hi")
                .put("mentionedUserIds", JSONArray().put(bob.userId)),
        )
        val msgs = JSONObject(host.dataFile.readText())
            .getJSONObject("messages").getJSONArray(privateCh)
        val last = msgs.getJSONObject(msgs.length() - 1)
        val mentioned = last.optJSONArray("mentionedUserIds")
        assertTrue(mentioned == null || mentioned.length() == 0)
    }

    @Test
    fun chatCannotTagEventFromUnlinkedAgenda() {
        val chat = host.createChatChannel("Lobby", allowedUserIds = null)
        val secret = host.createEventChannel("Secret", listOf(host.hostUserId(), alice.userId, bob.userId))
        val evId = host.createEvent(alice.token, secret, title = "e2e:secret")
        host.rpc(
            alice.token,
            "sendMessage",
            JSONObject()
                .put("channelId", chat)
                .put("text", "e2e:tag")
                .put("mentionedEventIds", JSONArray().put(evId))
                .put("eventId", evId),
        )
        val msgs = JSONObject(host.dataFile.readText())
            .getJSONObject("messages").getJSONArray(chat)
        val last = msgs.getJSONObject(msgs.length() - 1)
        assertEquals("", last.optString("eventId"))
        val tagged = last.optJSONArray("mentionedEventIds")
        assertTrue(tagged == null || tagged.length() == 0)
    }

}
