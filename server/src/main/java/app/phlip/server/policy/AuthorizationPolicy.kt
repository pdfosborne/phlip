package app.phlip.server

import org.json.JSONObject

internal const val ROLE_HOST = "host"
internal const val ROLE_ADMIN = "admin"
internal const val ROLE_MODERATOR = "moderator"
internal const val ROLE_USER = "user"
internal const val ROLE_VIEWER = "viewer"
internal val ASSIGNABLE_ROLES = setOf(ROLE_ADMIN, ROLE_MODERATOR, ROLE_USER, ROLE_VIEWER)

/** Fixed rows always present on an event-channel permission matrix. */
internal val CHANNEL_MATRIX_FIXED_KEYS = listOf(ROLE_MODERATOR, ROLE_USER, ROLE_VIEWER)

internal const val PERM_FLAG_VIEW = "view"
internal const val PERM_FLAG_RSVP = "rsvp"
internal const val PERM_FLAG_CREATE = "create"
internal const val PERM_FLAG_REACT = "react"
internal const val PERM_FLAG_EDIT = "edit"
internal const val PERM_FLAG_STICKERS = "stickers"
internal const val PERM_FLAG_REPEATS = "repeats"
internal const val PERM_FLAG_CHAINS = "chains"
internal const val PERM_FLAG_REQUIRE_APPROVAL = "requireApproval"
internal const val PERM_FLAG_CAN_APPROVE = "canApprove"
internal const val PERM_FLAG_CREATE_EVENT_TYPES = "createEventTypes"
internal const val PERM_FLAG_ADD_LOCATIONS = "addLocations"
internal val CHANNEL_PERM_FLAGS = setOf(
    PERM_FLAG_VIEW, PERM_FLAG_RSVP, PERM_FLAG_CREATE, PERM_FLAG_REACT,
    PERM_FLAG_EDIT, PERM_FLAG_STICKERS, PERM_FLAG_REPEATS, PERM_FLAG_CHAINS,
    PERM_FLAG_REQUIRE_APPROVAL, PERM_FLAG_CAN_APPROVE,
)
internal val CHANNEL_VIEW_FIXED_KEYS = listOf(ROLE_MODERATOR, ROLE_USER, ROLE_VIEWER)
internal val ROLE_CONFIG_PERM_FLAGS = listOf(
    PERM_FLAG_VIEW, PERM_FLAG_CREATE, PERM_FLAG_REQUIRE_APPROVAL,
    PERM_FLAG_CAN_APPROVE, PERM_FLAG_CREATE_EVENT_TYPES,
)

internal const val PERM_EVERYONE = "everyone"
internal const val PERM_MODERATOR = "moderator"
internal const val PERM_ADMIN = "admin"
internal val MEMBER_PERMS = setOf(PERM_EVERYONE, PERM_MODERATOR, PERM_ADMIN)

/** Empty flags (no access). */
internal fun emptyRolePermFlags(): RolePermFlags = RolePermFlags()

/** Moderator row: all flags on. Approval isn't required for a fully-trusted role. */
internal fun allRolePermFlags(): RolePermFlags = RolePermFlags(
    view = true, rsvp = true, create = true, react = true,
    edit = true, stickers = true, repeats = true, chains = true,
    requireApproval = false, canApprove = true,
    createEventTypes = true, addLocations = true,
)

/** Elevated Moderator actions — view is per-channel, not implied. */
internal fun moderatorActionFlags(): RolePermFlags = allRolePermFlags().copy(view = false)

/**
 * Missing [ROLE_MODERATOR] view defaults true so existing boards stay visible to mods,
 * unless the matrix is Admins-only (no member/viewer/custom view, or minRole admin).
 */
internal fun moderatorViewDefault(
    vis: Map<String, RolePermFlags>?,
    minRole: String? = null,
): Boolean {
    if (vis != null && vis.containsKey(ROLE_MODERATOR)) return vis[ROLE_MODERATOR]?.view == true
    val floor = normalizeChannelMinRole(minRole)
    if (floor == ROLE_ADMIN) return false
    if (vis.isNullOrEmpty()) return true
    if (vis[ROLE_USER]?.view == true || vis[ROLE_VIEWER]?.view == true) return true
    if (vis.any { (key, flags) ->
        key != ROLE_ADMIN && key !in CHANNEL_VIEW_FIXED_KEYS && flags.view
    }) return true
    if (floor == ROLE_MODERATOR) return true
    return false
}

internal fun normalizeRolePermFlags(flags: RolePermFlags): RolePermFlags {
    val out = flags.copyFlags()
    if (out.view) {
        out.rsvp = true
        out.react = true
        out.stickers = true
    }
    if (out.create) {
        out.repeats = true
        out.chains = true
        out.addLocations = true
    }
    out.edit = false
    return out
}

/** Default member (user) row for a new event channel. */
internal fun defaultMemberRolePermFlags(canCreate: Boolean = true): RolePermFlags = RolePermFlags(
    view = true,
    rsvp = true,
    create = canCreate,
    react = true,
    edit = false,
    stickers = true,
    repeats = canCreate,
    chains = canCreate,
)

/** Viewer row: view only (when the floor allows viewers). */
internal fun viewerRolePermFlags(canView: Boolean): RolePermFlags =
    RolePermFlags(view = canView)

/**
 * Seed a full event-channel matrix from a legacy minRole floor and server create-events scope.
 * [createLevel] is everyone | moderator | admin.
 */
internal fun seedEventChannelRolePerms(
    minRole: String?,
    createLevel: String,
): MutableMap<String, RolePermFlags> {
    val floor = normalizeChannelMinRole(minRole) ?: ROLE_VIEWER
    fun canView(role: String): Boolean = roleRank(role) >= roleRank(floor)
    fun canCreate(role: String): Boolean {
        if (!canView(role)) return false
        return when (normalizeMemberPerm(createLevel, PERM_EVERYONE)) {
            PERM_EVERYONE -> role == ROLE_USER || role == ROLE_MODERATOR || role == ROLE_ADMIN || role == ROLE_HOST
            PERM_MODERATOR -> role == ROLE_MODERATOR || role == ROLE_ADMIN || role == ROLE_HOST
            else -> role == ROLE_ADMIN || role == ROLE_HOST
        }
    }
    val memberCreate = canCreate(ROLE_USER)
    val modCreate = canCreate(ROLE_MODERATOR)
    val map = linkedMapOf<String, RolePermFlags>()
    map[ROLE_VIEWER] = viewerRolePermFlags(canView(ROLE_VIEWER))
    map[ROLE_USER] = if (canView(ROLE_USER)) {
        defaultMemberRolePermFlags(memberCreate)
    } else {
        emptyRolePermFlags()
    }
    map[ROLE_MODERATOR] = if (canView(ROLE_MODERATOR)) {
        allRolePermFlags().also {
            if (!modCreate) {
                it.create = false
                it.repeats = false
                it.chains = false
            }
        }
    } else {
        emptyRolePermFlags()
    }
    return map
}

/** Default matrix for a brand-new open event channel (everyone sees; members act; mods edit). */
internal fun defaultEventChannelRolePerms(createLevel: String = PERM_EVERYONE): MutableMap<String, RolePermFlags> =
    seedEventChannelRolePerms(null, createLevel)

/** Keep only the view flag per role (channel visibility). */
internal fun viewOnlyRolePerms(full: Map<String, RolePermFlags>): MutableMap<String, RolePermFlags> {
    val out = linkedMapOf<String, RolePermFlags>()
    for ((key, flags) in full) {
        out[key] = RolePermFlags(view = flags.view)
    }
    for (fixed in CHANNEL_VIEW_FIXED_KEYS) {
        if (fixed !in out) {
            out[fixed] = RolePermFlags(view = fixed == ROLE_MODERATOR)
        }
    }
    return out
}

/** Default per-channel visibility: same view column as the default server matrix. */
internal fun defaultEventChannelViewPerms(createLevel: String = PERM_EVERYONE): MutableMap<String, RolePermFlags> =
    viewOnlyRolePerms(defaultEventChannelRolePerms(createLevel))

/** Parse a rolePerms object from a client command payload. */
internal fun parseRolePermsMap(raw: JSONObject?): MutableMap<String, RolePermFlags>? {
    if (raw == null) return null
    val out = linkedMapOf<String, RolePermFlags>()
    val keys = raw.keys()
    while (keys.hasNext()) {
        val key = keys.next().trim()
        if (key.isEmpty() || key.length > 40) continue
        val row = raw.optJSONObject(key) ?: continue
        out[key] = normalizeRolePermFlags(
            RolePermFlags(
                view = row.optBoolean("view", false),
                rsvp = row.optBoolean("rsvp", false),
                create = row.optBoolean("create", false),
                react = row.optBoolean("react", false),
                edit = row.optBoolean("edit", false),
                stickers = row.optBoolean("stickers", false),
                repeats = row.optBoolean("repeats", false),
                chains = row.optBoolean("chains", false),
                requireApproval = row.optBoolean("requireApproval", false),
                canApprove = row.optBoolean("canApprove", false),
                createEventTypes = row.optBoolean("createEventTypes", false),
                addLocations = row.optBoolean("addLocations", false),
            ),
        )
    }
    if (out.isEmpty()) return null
    for (fixed in CHANNEL_MATRIX_FIXED_KEYS) {
        if (fixed !in out) out[fixed] = emptyRolePermFlags()
    }
    return out
}

/** Parse channel visibility: accept full matrix payloads but persist view-only. */
internal fun parseViewOnlyRolePermsMap(raw: JSONObject?): MutableMap<String, RolePermFlags>? {
    val parsed = parseRolePermsMap(raw) ?: return null
    return viewOnlyRolePerms(parsed)
}

/** Normalize custom-role seed: member, viewer, or none. */
internal fun normalizeCustomRoleBase(raw: String?): String {
    val v = raw?.trim()?.lowercase().orEmpty()
    return when (v) {
        ROLE_VIEWER -> ROLE_VIEWER
        "none" -> "none"
        else -> ROLE_USER
    }
}

internal fun effectiveRole(user: User): String {
    if (user.isHost) return ROLE_HOST
    return when (val role = user.role?.trim()?.lowercase().orEmpty()) {
        ROLE_HOST, ROLE_ADMIN, ROLE_MODERATOR, ROLE_USER, ROLE_VIEWER -> role
        else -> ROLE_USER
    }
}

internal fun roleRank(role: String): Int = when (role) {
    ROLE_VIEWER -> 0
    ROLE_USER -> 1
    ROLE_MODERATOR -> 2
    ROLE_ADMIN -> 3
    ROLE_HOST -> 4
    else -> 1
}

internal fun normalizeMemberPerm(raw: String?, default: String): String {
    val value = raw?.trim()?.lowercase().orEmpty()
    if (value == "user" || value == "member") return PERM_EVERYONE
    return if (value in MEMBER_PERMS) value else default
}

internal fun clampMinAge(raw: Int): Int = raw.coerceIn(18, 99)

/** Camera profile photos: none / online-only RAM relay / host-persisted. */
internal const val LIVE_PROFILE_PHOTOS_OFF = "off"
internal const val LIVE_PROFILE_PHOTOS_ONLINE = "online"
internal const val LIVE_PROFILE_PHOTOS_ALWAYS = "always"
internal val LIVE_PROFILE_PHOTOS_MODES = setOf(
    LIVE_PROFILE_PHOTOS_OFF,
    LIVE_PROFILE_PHOTOS_ONLINE,
    LIVE_PROFILE_PHOTOS_ALWAYS,
)

/**
 * Normalize live-photo mode. Valid strings win; otherwise map legacy
 * [allowProfilePicsLegacy] (true/missing → online, false → off).
 */
internal fun normalizeLiveProfilePhotos(
    raw: String?,
    allowProfilePicsLegacy: Boolean? = null,
): String {
    val value = raw?.trim()?.lowercase().orEmpty()
    if (value in LIVE_PROFILE_PHOTOS_MODES) return value
    return if (allowProfilePicsLegacy == false) LIVE_PROFILE_PHOTOS_OFF else LIVE_PROFILE_PHOTOS_ONLINE
}

internal fun AppState.effectiveLiveProfilePhotos(): String =
    normalizeLiveProfilePhotos(liveProfilePhotos, allowProfilePics)

/** Set mode and keep legacy [AppState.allowProfilePics] in sync. */
internal fun AppState.applyLiveProfilePhotos(mode: String) {
    val normalized = normalizeLiveProfilePhotos(mode, null)
    liveProfilePhotos = normalized
    allowProfilePics = normalized != LIVE_PROFILE_PHOTOS_OFF
}
