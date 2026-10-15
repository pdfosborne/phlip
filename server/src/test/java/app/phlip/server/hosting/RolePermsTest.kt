package app.phlip.server.hosting

import android.app.Application
import app.phlip.server.AppState
import app.phlip.server.CHANNEL_MATRIX_FIXED_KEYS
import app.phlip.server.Channel
import app.phlip.server.CustomRole
import app.phlip.server.Event
import app.phlip.server.MembershipService
import app.phlip.server.PERM_EVERYONE
import app.phlip.server.PERM_FLAG_CREATE
import app.phlip.server.PERM_FLAG_EDIT
import app.phlip.server.PERM_FLAG_RSVP
import app.phlip.server.PERM_FLAG_VIEW
import app.phlip.server.PERM_MODERATOR
import app.phlip.server.ROLE_ADMIN
import app.phlip.server.ROLE_HOST
import app.phlip.server.ROLE_MODERATOR
import app.phlip.server.ROLE_USER
import app.phlip.server.ROLE_VIEWER
import app.phlip.server.RolePermFlags
import app.phlip.server.ServerAuthorization
import app.phlip.server.ServerStateMigrations
import app.phlip.server.User
import app.phlip.server.defaultMemberRolePermFlags
import app.phlip.server.emptyRolePermFlags
import app.phlip.server.normalizeCustomRoleBase
import app.phlip.server.normalizeRolePermFlags
import app.phlip.server.seedEventChannelRolePerms
import app.phlip.server.viewOnlyRolePerms
import com.google.gson.Gson
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.security.SecureRandom

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class RolePermsTest {

    @Test
    fun seedFromMinRoleHidesViewersWhenFloorIsMember() {
        val map = seedEventChannelRolePerms("user", PERM_EVERYONE)
        assertFalse(map[ROLE_VIEWER]!!.view)
        assertTrue(map[ROLE_USER]!!.view)
        assertTrue(map[ROLE_USER]!!.create)
        assertFalse(map[ROLE_USER]!!.edit)
        assertTrue(map[ROLE_MODERATOR]!!.edit)
    }

    @Test
    fun seedModeratorCreateScopeLocksMemberCreate() {
        val map = seedEventChannelRolePerms(null, PERM_MODERATOR)
        assertTrue(map[ROLE_VIEWER]!!.view)
        assertFalse(map[ROLE_USER]!!.create)
        assertTrue(map[ROLE_MODERATOR]!!.create)
    }

    @Test
    fun migrationSeedsMissingEventMatrices() {
        val state = AppState().apply {
            createEvents = PERM_EVERYONE
            channels.add(Channel("e1", "Fixtures", kind = "event", minRole = "user"))
            channels.add(Channel("c1", "Welcome", kind = "chat", minRole = "user"))
            users["h"] = User("h", "Host", 1L, isHost = true, role = "host")
        }
        val migrations = ServerStateMigrations(idGenerator = { "id_${System.nanoTime()}" })
        assertTrue(migrations.migrate(state) { false })
        val event = state.channels.find { it.id == "e1" }!!
        assertTrue(event.rolePerms != null && event.rolePerms!!.isNotEmpty())
        for (key in CHANNEL_MATRIX_FIXED_KEYS) {
            assertTrue(key in event.rolePerms!!)
        }
        // Event minRole is not migrated into view flags — channels get view-only
        // copies of the server matrix (default floor includes viewer.view).
        assertTrue(event.rolePerms!![ROLE_VIEWER]!!.view)
        assertTrue(event.rolePerms!![ROLE_USER]!!.view)
        val chat = state.channels.find { it.id == "c1" }!!
        assertTrue(chat.rolePerms != null && chat.rolePerms!!.isNotEmpty())
        // Chat minRole "user" → viewers hidden, members visible.
        assertFalse(chat.rolePerms!![ROLE_VIEWER]!!.view)
        assertTrue(chat.rolePerms!![ROLE_USER]!!.view)
        assertTrue(chat.minRole == null)
    }

    @Test
    fun hostBypassesMatrixAndTagsUnion() {
        val state = AppState()
        val auth = ServerAuthorization { state }
        val host = User("h", "Host", 1L, isHost = true, role = "host")
        val member = User("m", "Mem", 1L, role = ROLE_USER, roleTagIds = mutableListOf("tag1"))
        val viewer = User("v", "View", 1L, role = ROLE_VIEWER)
        state.customRoles = mutableListOf(CustomRole("tag1", "Juniors"))
        val ch = Channel(
            "e1", "Fixtures", kind = "event",
            rolePerms = seedEventChannelRolePerms("user", PERM_EVERYONE).also {
                it["tag1"] = defaultMemberRolePermFlags(true)
            },
        )
        state.channels.add(ch)
        state.users["h"] = host
        state.users["m"] = member
        state.users["v"] = viewer

        assertTrue(auth.channelVisible(ch, host))
        assertTrue(auth.canChannel(host, ch, PERM_FLAG_EDIT))
        assertTrue(auth.canChannel(member, ch, PERM_FLAG_CREATE))
        assertFalse(auth.canChannel(member, ch, PERM_FLAG_EDIT))
        assertFalse(auth.canChannel(viewer, ch, PERM_FLAG_VIEW))

        // Tag alone grants access for a viewer with the juniors tag
        viewer.roleTagIds = mutableListOf("tag1")
        assertTrue(auth.canChannel(viewer, ch, PERM_FLAG_VIEW))
        assertTrue(auth.canChannel(viewer, ch, PERM_FLAG_RSVP))
    }

    @Test
    fun privateAllowListStillAndsWithViewDuringMigration() {
        val state = AppState()
        val auth = ServerAuthorization { state }
        val member = User("m", "Mem", 1L, role = ROLE_USER)
        val other = User("o", "Other", 1L, role = ROLE_USER)
        val ch = Channel(
            "e1", "Private", kind = "event",
            allowedUserIds = mutableListOf("m"),
            rolePerms = seedEventChannelRolePerms(null, PERM_EVERYONE),
        )
        state.channels.add(ch)
        assertTrue(auth.canChannel(member, ch, PERM_FLAG_VIEW))
        assertFalse(auth.canChannel(other, ch, PERM_FLAG_VIEW))
    }

    @Test
    fun chatRolePermsGateViewLikeEvents() {
        val state = AppState()
        val auth = ServerAuthorization { state }
        val member = User("m", "Mem", 1L, role = ROLE_USER)
        val viewer = User("v", "View", 1L, role = ROLE_VIEWER)
        val ch = Channel(
            "c1", "Committee", kind = "chat",
            rolePerms = viewOnlyRolePerms(seedEventChannelRolePerms("user", PERM_EVERYONE)),
        )
        state.channels.add(ch)
        assertTrue(auth.channelVisible(ch, member))
        assertFalse(auth.channelVisible(ch, viewer))
        assertTrue(auth.canChannel(member, ch, PERM_FLAG_VIEW))
        assertFalse(auth.canChannel(viewer, ch, PERM_FLAG_VIEW))
    }

    @Test
    fun staffCanAssignCustomRoleTagsToMembers() {
        val state = AppState()
        val auth = ServerAuthorization { state }
        val host = User("h", "Host", 1L, isHost = true, role = ROLE_HOST)
        val admin = User("a", "Admin", 1L, role = ROLE_ADMIN)
        val mod = User("mod", "Mod", 1L, role = ROLE_MODERATOR)
        val member = User("m", "Mem", 1L, role = ROLE_USER)
        val viewer = User("v", "View", 1L, role = ROLE_VIEWER)

        assertTrue(auth.canAssignMemberRoleTags(host, member))
        assertTrue(auth.canAssignMemberRoleTags(admin, member))
        assertTrue(auth.canAssignMemberRoleTags(admin, viewer))
        assertTrue(auth.canAssignMemberRoleTags(admin, mod))
        assertTrue(auth.canAssignMemberRoleTags(mod, member))
        assertTrue(auth.canAssignMemberRoleTags(mod, viewer))
        assertFalse(auth.canAssignMemberRoleTags(mod, admin))
        assertFalse(auth.canAssignMemberRoleTags(mod, host))
        assertFalse(auth.canAssignMemberRoleTags(member, viewer))
        assertFalse(auth.canManageMember(mod, member))
    }

    @Test
    fun customTagsOrWithBaseAndCannotDenyCreateOrGrantManage() {
        val state = AppState()
        val auth = ServerAuthorization { state }
        val member = User("m", "Mem", 1L, role = ROLE_USER, roleTagIds = mutableListOf("juniors", "coaches"))
        val ch = Channel(
            "e1", "Fixtures", kind = "event",
            rolePerms = viewOnlyRolePerms(seedEventChannelRolePerms(null, PERM_EVERYONE)),
        )
        state.channels.add(ch)
        state.customRoles = mutableListOf(CustomRole("juniors", "Juniors"), CustomRole("coaches", "Coaches"))
        state.eventRolePerms = linkedMapOf(
            ROLE_USER to defaultMemberRolePermFlags(true),
            ROLE_VIEWER to RolePermFlags(view = true),
            ROLE_MODERATOR to emptyRolePermFlags(),
            "juniors" to RolePermFlags(view = true, create = true, requireApproval = true),
            "coaches" to RolePermFlags(view = true, canApprove = true, createEventTypes = true),
        )

        assertTrue(auth.canChannel(member, ch, PERM_FLAG_CREATE))
        assertFalse(auth.roleRequiresApproval(member, ch))
        assertTrue(auth.canApproveEvents(member, ch))
        assertTrue(auth.canCreateEventTypes(member))
        assertFalse(auth.canManageServer(member))

        val viewer = User("v", "View", 1L, role = ROLE_VIEWER, roleTagIds = mutableListOf("juniors"))
        state.eventRolePerms!![ROLE_USER] = RolePermFlags(view = true, create = false)
        assertTrue(auth.canChannel(viewer, ch, PERM_FLAG_CREATE))
        assertTrue(auth.roleRequiresApproval(viewer, ch))
    }

    @Test
    fun createImpliesEditOwnAndStaffEditAny() {
        val state = AppState()
        val auth = ServerAuthorization { state }
        val host = User("h", "Host", 1L, isHost = true, role = ROLE_HOST)
        val admin = User("a", "Admin", 1L, role = ROLE_ADMIN)
        val member = User("m", "Mem", 1L, role = ROLE_USER)
        val ch = Channel(
            "e1", "Fixtures", kind = "event",
            rolePerms = viewOnlyRolePerms(seedEventChannelRolePerms(null, PERM_EVERYONE)),
        )
        state.channels.add(ch)
        state.eventRolePerms = linkedMapOf(
            ROLE_USER to defaultMemberRolePermFlags(true),
            ROLE_VIEWER to RolePermFlags(view = true),
            ROLE_MODERATOR to emptyRolePermFlags(),
        )
        val own = event("ev1", "m", "e1")
        val theirs = event("ev2", "o", "e1")

        assertTrue(auth.canEditEvent(member, own))
        assertFalse(auth.canEditEvent(member, theirs))
        assertTrue(auth.canEditEvent(host, theirs))
        assertTrue(auth.canEditEvent(admin, theirs))
        assertFalse(auth.canChannel(member, ch, PERM_FLAG_EDIT))
    }

    @Test
    fun moderatorActionsFollowViewNotSeeAll() {
        val state = AppState()
        val auth = ServerAuthorization { state }
        val host = User("h", "Host", 1L, isHost = true, role = ROLE_HOST)
        val admin = User("a", "Admin", 1L, role = ROLE_ADMIN)
        val mod = User("mod", "Mod", 1L, role = ROLE_MODERATOR)
        val member = User("m", "Mem", 1L, role = ROLE_USER)
        val open = Channel(
            "open", "Open", kind = "event",
            rolePerms = viewOnlyRolePerms(seedEventChannelRolePerms(null, PERM_EVERYONE)),
        )
        val hidden = Channel(
            "hid", "Staff", kind = "event",
            rolePerms = linkedMapOf(
                ROLE_MODERATOR to RolePermFlags(view = false),
                ROLE_USER to RolePermFlags(view = false),
                ROLE_VIEWER to RolePermFlags(view = false),
            ),
        )
        val privateCh = Channel(
            "priv", "Private", kind = "event",
            allowedUserIds = mutableListOf("m"),
            rolePerms = viewOnlyRolePerms(seedEventChannelRolePerms(null, PERM_EVERYONE)),
        )
        state.channels.addAll(listOf(open, hidden, privateCh))

        assertTrue(auth.channelVisible(open, mod))
        assertTrue(auth.canEditEvent(mod, event("e-open", "m", "open")))
        assertTrue(auth.canApproveEvents(mod, open))

        assertFalse(auth.channelVisible(hidden, mod))
        assertTrue(auth.channelVisible(hidden, host))
        assertTrue(auth.channelVisible(hidden, admin))
        assertFalse(auth.canEditEvent(mod, event("e-hid", "m", "hid")))
        assertFalse(auth.canApproveEvents(mod, hidden))

        assertFalse(auth.channelVisible(privateCh, mod))
        assertTrue(auth.channelVisible(privateCh, member))
        assertTrue(auth.channelVisible(privateCh, host))
    }

    @Test
    fun missingModeratorViewStaysOpenExceptAdminsOnly() {
        val state = AppState()
        val auth = ServerAuthorization { state }
        val mod = User("mod", "Mod", 1L, role = ROLE_MODERATOR)
        val open = Channel(
            "open", "Open", kind = "event",
            rolePerms = linkedMapOf(
                ROLE_USER to RolePermFlags(view = true),
                ROLE_VIEWER to RolePermFlags(view = true),
            ),
        )
        val admins = Channel(
            "adm", "Admins", kind = "event",
            minRole = ROLE_ADMIN,
            rolePerms = linkedMapOf(
                ROLE_USER to RolePermFlags(view = false),
                ROLE_VIEWER to RolePermFlags(view = false),
            ),
        )
        state.channels.addAll(listOf(open, admins))
        assertTrue(auth.channelVisible(open, mod))
        assertFalse(auth.channelVisible(admins, mod))
    }

    @Test
    fun oldFlagsNormalizeOnRead() {
        val flags = normalizeRolePermFlags(
            RolePermFlags(view = true, create = true, edit = true, react = false, rsvp = false),
        )
        assertTrue(flags.rsvp)
        assertTrue(flags.react)
        assertTrue(flags.stickers)
        assertTrue(flags.repeats)
        assertTrue(flags.chains)
        assertTrue(flags.addLocations)
        assertFalse(flags.edit)

        val state = AppState()
        val auth = ServerAuthorization { state }
        state.eventRolePerms = linkedMapOf(
            ROLE_USER to RolePermFlags(view = true, create = true, edit = true),
            ROLE_VIEWER to RolePermFlags(view = true),
            ROLE_MODERATOR to emptyRolePermFlags(),
        )
        val normalized = auth.ensureEventRolePerms()[ROLE_USER]!!
        assertFalse(normalized.edit)
        assertTrue(normalized.repeats)
    }

    @Test
    fun createRolePresetsAndDeleteKeepsBaseRole() {
        val state = AppState()
        val host = User("h", "Host", 1L, isHost = true, role = ROLE_HOST)
        val member = User("m", "Mem", 1L, role = ROLE_USER)
        state.users["h"] = host
        state.users["m"] = member
        state.eventRolePerms = linkedMapOf(
            ROLE_USER to defaultMemberRolePermFlags(true),
            ROLE_VIEWER to RolePermFlags(view = true),
            ROLE_MODERATOR to emptyRolePermFlags(),
        )
        val ids = sequenceIds("role")
        val svc = membershipFor(state, ids)

        assertEquals(ROLE_USER, normalizeCustomRoleBase("member"))
        assertEquals(ROLE_VIEWER, normalizeCustomRoleBase("viewer"))
        assertEquals("none", normalizeCustomRoleBase("none"))

        svc.dispatch(host, JSONObject().put("type", "createCustomRole").put("name", "None").put("preset", "none"))
        val none = state.customRoles!!.find { it.name == "None" }!!
        assertFalse(state.eventRolePerms!![none.id]!!.view)
        assertFalse(state.eventRolePerms!![none.id]!!.create)

        svc.dispatch(host, JSONObject().put("type", "createCustomRole").put("name", "Viewers").put("preset", "viewer"))
        val viewers = state.customRoles!!.find { it.name == "Viewers" }!!
        assertTrue(state.eventRolePerms!![viewers.id]!!.view)
        assertFalse(state.eventRolePerms!![viewers.id]!!.create)

        svc.dispatch(
            host,
            JSONObject().put("type", "createCustomRole").put("name", "Copy").put("copyRoleId", viewers.id),
        )
        val copy = state.customRoles!!.find { it.name == "Copy" }!!
        assertEquals(state.eventRolePerms!![viewers.id]!!.view, state.eventRolePerms!![copy.id]!!.view)
        assertEquals(state.eventRolePerms!![viewers.id]!!.create, state.eventRolePerms!![copy.id]!!.create)

        svc.dispatch(
            host,
            JSONObject()
                .put("type", "createCustomRole")
                .put("name", "Tagged")
                .put("preset", "member")
                .put("assignUserIds", JSONArray().put("m")),
        )
        val tagged = state.customRoles!!.find { it.name == "Tagged" }!!
        assertTrue(member.roleTagIds!!.contains(tagged.id))
        assertEquals(ROLE_USER, member.role)

        svc.dispatch(host, JSONObject().put("type", "deleteCustomRole").put("roleId", tagged.id))
        assertNull(state.customRoles!!.find { it.id == tagged.id })
        assertTrue(member.roleTagIds.isNullOrEmpty())
        assertEquals(ROLE_USER, member.role)
    }

    private fun sequenceIds(prefix: String): () -> String {
        var n = 0
        return { "$prefix${++n}" }
    }

    private fun event(id: String, createdBy: String, channelId: String) = Event(
        id = id,
        title = "Match",
        `when` = 1L,
        where = "",
        details = "",
        createdBy = createdBy,
        createdByName = createdBy,
        createdAt = 1L,
        channelId = channelId,
    )

    private fun membershipFor(state: AppState, idGenerator: () -> String): MembershipService {
        val auth = ServerAuthorization { state }
        return MembershipService(
            stateProvider = { state },
            gson = Gson(),
            authorization = auth,
            idGenerator = idGenerator,
            memberTokenGenerator = { "tok" },
            groupInviteCodeGenerator = { "inv" },
            personalInviteSlugGenerator = { "slugslug12" },
            random = SecureRandom(),
            serverPassphrase = { "pass" },
            defaultRoleForNewMembers = { ROLE_USER },
            livePics = mutableMapOf(),
            operations = MembershipService.Operations(
                save = {},
                sendToUser = { _, _ -> },
                sendToToken = { _, _ -> },
                broadcast = {},
                presence = {},
                broadcastMembers = {},
                pushSyncToAll = {},
                purgeMemberContent = {},
                disconnectUser = { _, _ -> },
                approveJoin = { false },
                denyJoin = {},
                snapshot = { JSONObject() },
                releaseHttpSession = {},
                edgeMemberSession = { _, _, _ -> },
            ),
        )
    }
}
