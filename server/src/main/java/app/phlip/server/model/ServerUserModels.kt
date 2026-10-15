package app.phlip.server

/** Persisted member record. Keep field names/defaults stable for Gson compatibility. */
data class User(
    val id: String,
    var name: String,
    val joinedAt: Long,
    var isHost: Boolean = false,
    var lastIp: String? = "",
    var pwdSalt: String? = null,
    var authVerifier: String? = null,
    var wrappedGroupKey: String? = null,
    var trustedFpHashes: MutableList<String>? = null,
    /** Last [AppState.codeChallenge] this member satisfied with a join-code login. */
    var lastCodeAck: Int = 0,
    var role: String? = null,
    /** Custom role tag ids (subgroup labels); orthogonal to [role]. */
    var roleTagIds: MutableList<String>? = null,
    var profilePic: String? = null,
    var offlineAvatar: String? = null,
    /** This member's default preset for newly created event cards. */
    var eventCardStyle: EventCardStyle? = null,
    var blockedUserIds: MutableList<String>? = null,
    var identityId: String? = null,
    var identityPub: String? = null,
    var nameHostSet: Boolean = false,
    var nameSelf: String? = null,
    /** True for host/admin-minted synthetic members (see DemoUserService). Never set by clients. */
    var isDemo: Boolean = false,
    /**
     * Personal invite slug for `https://phlipapp.com/j/<slug>`.
     * Unguessable; rotating invalidates old links. Null until minted.
     */
    var inviteSlug: String? = null,
    /** Epoch ms when [inviteSlug] was last minted or rotated. */
    var inviteSlugCreatedAt: Long? = null,
)

/** Server-defined subgroup tag (not part of the host/admin/mod ladder). */
data class CustomRole(
    val id: String,
    var name: String,
    var color: String? = null,
    var sortOrder: Int = 0,
    /**
     * Permission template this tag was created from: [ROLE_USER] (member) or
     * [ROLE_VIEWER]. Used when seeding [AppState.eventRolePerms] for the new id.
     */
    var baseRole: String? = ROLE_USER,
)

/**
 * Per-role flags on a channel visibility map or the server action matrix.
 * Keys on [Channel.rolePerms] are
 * moderator | user | viewer | customRoleId.
 */
data class RolePermFlags(
    var view: Boolean = false,
    var rsvp: Boolean = false,
    var create: Boolean = false,
    var react: Boolean = false,
    var edit: Boolean = false,
    var stickers: Boolean = false,
    var repeats: Boolean = false,
    var chains: Boolean = false,
    /** § approvals — events created by this role start pending unless the creator can also approve. */
    var requireApproval: Boolean = false,
    /** § approvals — this role may approve/block pending events (in addition to moderator+). */
    var canApprove: Boolean = false,
    var createEventTypes: Boolean = false,
    var addLocations: Boolean = false,
) {
    fun copyFlags(): RolePermFlags = copy()

    fun orWith(other: RolePermFlags): RolePermFlags = RolePermFlags(
        view = view || other.view,
        rsvp = rsvp || other.rsvp,
        create = create || other.create,
        react = react || other.react,
        edit = edit || other.edit,
        stickers = stickers || other.stickers,
        repeats = repeats || other.repeats,
        chains = chains || other.chains,
        requireApproval = requireApproval || other.requireApproval,
        canApprove = canApprove || other.canApprove,
        createEventTypes = createEventTypes || other.createEventTypes,
        addLocations = addLocations || other.addLocations,
    )

    fun flag(name: String): Boolean = when (name) {
        "view" -> view
        "rsvp" -> rsvp
        "create" -> create
        "react" -> react
        "edit" -> edit
        "stickers" -> stickers
        "repeats" -> repeats
        "chains" -> chains
        "requireApproval" -> requireApproval
        "canApprove" -> canApprove
        "createEventTypes" -> createEventTypes
        "addLocations" -> addLocations
        else -> false
    }
}

data class ServerActivityEntry(
    val id: String,
    val kind: String,
    val at: Long,
    val actorId: String,
    val actorName: String,
    val targetId: String,
    val targetName: String,
    val from: String,
    val to: String,
    val hostSet: Boolean = false,
)

data class Channel(
    val id: String,
    var name: String,
    var kind: String = "chat",
    var allowedUserIds: MutableList<String>? = null,
    var enabledCardIds: MutableList<String>? = null,
    var linkedChatChannelId: String? = null,
    var enabledCategoryIds: MutableList<String>? = null,
    var enabledLocations: MutableList<String>? = null,
    var mirrorActivity: Boolean = false,
    var autoIncludeNewMembers: Boolean = false,
    var minRole: String? = null,
    /**
     * Channel **visibility** map (view flags only) for event and chat boards.
     * Action permissions live on [AppState.eventRolePerms].
     * Keys: admin | moderator | user | viewer | customRoleId.
     * Null only on pre-migration channels (seeded on load).
     */
    var rolePerms: MutableMap<String, RolePermFlags>? = null,
    /** Legacy per-channel approval override, superseded by the per-role "Require approval" /
     *  "Approve" [RolePermFlags] matrix columns. No longer written; kept for old saved state. */
    var eventsRequireApproval: Boolean = false,
    /** Legacy approver-role list, superseded by [RolePermFlags.canApprove]. No longer written. */
    var approvalRoleIds: MutableList<String>? = null,
    /**
     * § pinned location channels. When set, this channel is a read-only
     * aggregation view of every event booking that place (across all event
     * channels) — not an independent event store. Events can't be created
     * directly here; see [Event.locationLabelId].
     */
    var pinnedLocationLabel: String? = null,
    /**
     * § pinned people channels. When set, this channel is a read-only
     * aggregation of every event whose home channel that member can see.
     * Mutually exclusive with [pinnedLocationLabel]. Events can't be created
     * directly here; viewers without home-channel access get limited stubs.
     */
    var pinnedUserId: String? = null,
    /**
     * § I'm available — when on, members may post lightweight availability marks
     * (not full events) on this event channel. Default off; managers toggle in
     * channel settings. Ignored on chat / pinned aggregation boards.
     */
    var allowAvailability: Boolean = false,
    /** Optional sidebar icon (lucide name, short glyph, or drawn `d:` payload). */
    var icon: String? = null,
    /**
     * Hosted chat only — when true, a join log line is posted here after a new
     * member is approved. At most one chat; default off.
     */
    var welcomeChannel: Boolean = false,
    /**
     * Parent board id. Null for Welcome lobby chat, pinned aggregations, and
     * any channel that is not part of a board.
     */
    var boardId: String? = null,
)

/**
 * Sidebar board: exactly one event, chat, and task channel with shared visibility.
 * Child channel names stay in sync with [name].
 */
data class Board(
    val id: String,
    var name: String,
    var icon: String? = null,
    /** Which child the board opens to: event, chat, or task. */
    var shownKind: String = "event",
    /** Child kinds hidden from the sidebar. Channels stay on the board. */
    var hiddenKinds: MutableList<String> = mutableListOf(),
    var allowedUserIds: MutableList<String>? = null,
    var autoIncludeNewMembers: Boolean = false,
    var rolePerms: MutableMap<String, RolePermFlags>? = null,
)

data class EventNote(
    val userId: String,
    val name: String,
    val text: String,
    val ts: Long,
    val mentionedUserIds: MutableList<String>? = null,
    val linkedEventId: String? = null,
    val linkedEventTitle: String? = null,
    val activity: String? = null,
    val status: String? = null,
    val targetUserId: String? = null,
    val targetName: String? = null,
    val oldWhen: Long? = null,
    val newWhen: Long? = null,
    val oldWhenPrecision: String? = null,
    val newWhenPrecision: String? = null,
    val oldWhenPeriod: String? = null,
    val newWhenPeriod: String? = null,
    val oldValue: String? = null,
    val newValue: String? = null,
    val id: String? = null,
    val noteKind: String? = null,
    val pinned: Boolean = false,
)
