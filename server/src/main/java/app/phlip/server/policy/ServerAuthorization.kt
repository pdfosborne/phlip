package app.phlip.server

import java.util.LinkedHashSet

/** Stateful authorization facade that always evaluates against the current server state. */
internal class ServerAuthorization(
    private val stateProvider: () -> AppState,
) {
    private val state: AppState
        get() = stateProvider()

    internal fun canManageServer(user: User): Boolean {
        val role = effectiveRole(user)
        return role == ROLE_HOST || role == ROLE_ADMIN
    }

    internal fun canModerateEvents(user: User): Boolean {
        val role = effectiveRole(user)
        return role == ROLE_HOST || role == ROLE_ADMIN || role == ROLE_MODERATOR
    }

    /** Approval-role gate for pending events (§ approvals): host/admin, or moderator/approve flag on a visible channel. */
    internal fun canApproveEvents(user: User, channel: Channel): Boolean {
        if (canManageServer(user)) return true
        if (!channelVisible(channel, user)) return false
        if (effectiveRole(user) == ROLE_MODERATOR) return true
        return channel.kind == "event" && effectiveChannelFlags(user, channel).canApprove
    }

    /** § approvals — restriction cannot deny unrestricted create. */
    internal fun roleRequiresApproval(user: User, channel: Channel): Boolean {
        if (channel.kind != "event") return false
        if (canManageServer(user)) return false
        if (effectiveRole(user) == ROLE_MODERATOR) return false
        val flags = effectiveChannelFlags(user, channel)
        return flags.create && flags.requireApproval
    }

    internal fun canCreateEvents(user: User): Boolean =
        meetsMemberPerm(user, effectiveCreateEvents())

    /** Create-events scope; migrates legacy [AppState.allowUserCreateEvents]. */
    internal fun effectiveCreateEvents(): String {
        val value = state.createEvents?.trim()?.lowercase().orEmpty()
        if (value == "user" || value == "member") return PERM_EVERYONE
        if (value in MEMBER_PERMS) return value
        return if (state.allowUserCreateEvents) PERM_EVERYONE else PERM_MODERATOR
    }

    /** Does [user]'s role meet a member permission ceiling? Viewers never do. */
    internal fun meetsMemberPerm(user: User, level: String): Boolean {
        val role = effectiveRole(user)
        if (role == ROLE_VIEWER) return false
        return when (normalizeMemberPerm(level, PERM_ADMIN)) {
            PERM_EVERYONE -> role == ROLE_USER || canModerateEvents(user)
            PERM_MODERATOR -> canModerateEvents(user)
            else -> canManageServer(user)
        }
    }

    internal fun canCreateEventTypes(user: User): Boolean {
        if (canManageServer(user)) return true
        if (effectiveRole(user) == ROLE_MODERATOR) return true
        val perms = ensureEventRolePerms()
        val primary = if (effectiveRole(user) == ROLE_VIEWER) ROLE_VIEWER else ROLE_USER
        if (perms[primary]?.createEventTypes == true) return true
        for (tagId in user.roleTagIds ?: emptyList()) {
            if (perms[tagId]?.createEventTypes == true) return true
        }
        return meetsMemberPerm(user, normalizeMemberPerm(state.createEventTypes, PERM_MODERATOR))
    }

    internal fun canAddLocations(user: User): Boolean {
        if (canManageServer(user)) return true
        if (effectiveRole(user) == ROLE_MODERATOR) return true
        val perms = ensureEventRolePerms()
        val primary = if (effectiveRole(user) == ROLE_VIEWER) ROLE_VIEWER else ROLE_USER
        if (perms[primary]?.create == true || perms[primary]?.addLocations == true) return true
        for (tagId in user.roleTagIds ?: emptyList()) {
            if (perms[tagId]?.create == true || perms[tagId]?.addLocations == true) return true
        }
        return meetsMemberPerm(user, normalizeMemberPerm(state.addLocations, PERM_MODERATOR))
    }

    internal fun canInviteToGroup(user: User): Boolean = canManageServer(user)

    internal fun canUserDraw(): Boolean = state.allowUserDraw

    internal fun canCreateType(user: User, type: EventType): Boolean {
        if (type.whoCanCreate == ROLE_MODERATOR) return canModerateEvents(user)
        return true
    }

    internal fun canMutateContent(user: User): Boolean = effectiveRole(user) != ROLE_VIEWER

    /**
     * Union of matrix flags for [user] on an event channel.
     * Action flags come from server-wide [AppState.eventRolePerms]; view comes from
     * the channel's visibility map ([Channel.rolePerms]).
     * Host/admin bypass is handled by callers via [canManageServer] / [canChannel].
     */
    internal fun effectiveChannelFlags(user: User, channel: Channel): RolePermFlags {
        val serverPerms = ensureEventRolePerms()
        val primary = effectiveRole(user)
        val tags = user.roleTagIds ?: emptyList()
        if (primary == ROLE_HOST || primary == ROLE_ADMIN) {
            return allRolePermFlags()
        }

        var flags = emptyRolePermFlags()
        val createSources = mutableListOf<RolePermFlags>()
        if (primary == ROLE_MODERATOR) {
            flags = moderatorActionFlags()
            createSources.add(RolePermFlags(create = true, requireApproval = false))
        } else {
            val primaryKey = if (primary == ROLE_VIEWER) ROLE_VIEWER else ROLE_USER
            serverPerms[primaryKey]?.let {
                flags = flags.orWith(it)
                createSources.add(it)
            }
        }
        for (tagId in tags) {
            serverPerms[tagId]?.let {
                flags = flags.orWith(it)
                createSources.add(it)
            }
        }
        val creating = createSources.filter { it.create }
        flags.requireApproval = if (primary == ROLE_MODERATOR) false
        else if (creating.isNotEmpty()) creating.all { it.requireApproval }
        else false

        val vis = channelRolePerms(channel)
        val viewKey = if (primary == ROLE_MODERATOR) ROLE_MODERATOR
        else if (primary == ROLE_VIEWER) ROLE_VIEWER
        else ROLE_USER
        val canView = if (vis.isNullOrEmpty()) {
            if (primary == ROLE_MODERATOR) moderatorViewDefault(vis, channel.minRole)
            else flags.view || (
                meetsChannelMinRole(channel, user) &&
                    (channelAllowList(channel) == null || channelAllowList(channel)!!.contains(user.id))
                )
        } else {
            var seen = if (primary == ROLE_MODERATOR && !vis.containsKey(ROLE_MODERATOR)) {
                moderatorViewDefault(vis, channel.minRole)
            } else {
                vis[viewKey]?.view == true
            }
            for (tagId in tags) {
                if (vis[tagId]?.view == true) seen = true
            }
            seen
        }
        val visibilityBoard = channelBoard(channel)
        val manual = channelAllowList(channel)
        val autoInclude = visibilityBoard?.autoIncludeNewMembers ?: channel.autoIncludeNewMembers
        flags.view = if (manual != null && !autoInclude) manual.contains(user.id) else canView
        return flags
    }

    /** Ensure [AppState.eventRolePerms] exists with fixed rows; seed from defaults when missing. */
    internal fun ensureEventRolePerms(): MutableMap<String, RolePermFlags> {
        val existing = state.eventRolePerms
        if (!existing.isNullOrEmpty()) {
            for (key in CHANNEL_MATRIX_FIXED_KEYS) {
                if (key !in existing) existing[key] = emptyRolePermFlags()
            }
            val keys = existing.keys.toList()
            for (key in keys) {
                existing[key] = normalizeRolePermFlags(existing[key] ?: emptyRolePermFlags())
            }
            return existing
        }
        val seeded = defaultEventChannelRolePerms(effectiveCreateEvents())
        // Carry custom role rows from any existing channel matrices (legacy).
        for (ch in state.channels) {
            if (ch.kind != "event") continue
            val map = ch.rolePerms ?: continue
            for ((key, flags) in map) {
                if (key in CHANNEL_MATRIX_FIXED_KEYS) continue
                if (key !in seeded) seeded[key] = flags.copyFlags()
            }
        }
        for (role in state.customRoles ?: emptyList()) {
            if (role.id !in seeded) {
                val base = normalizeCustomRoleBase(role.baseRole)
                seeded[role.id] = (seeded[base] ?: emptyRolePermFlags()).copyFlags()
            }
        }
        state.eventRolePerms = seeded.mapValues { normalizeRolePermFlags(it.value.copyFlags()) }.toMutableMap()
        return state.eventRolePerms!!
    }

    /** Event/chat matrix flag (or host/admin bypass). Legacy chat without rolePerms uses minRole. */
    internal fun canChannel(user: User, channel: Channel, flag: String): Boolean {
        if (canManageServer(user)) return true
        val usesMatrix = channel.kind == "event" || !channelRolePerms(channel).isNullOrEmpty()
        if (!usesMatrix) {
            // Legacy chat: view = channelVisible; mutate-style flags = non-viewer + visible
            if (!channelVisible(channel, user)) return false
            return when (flag) {
                PERM_FLAG_VIEW -> true
                else -> canMutateContent(user)
            }
        }
        val flags = effectiveChannelFlags(user, channel)
        if (!flags.view) return false
        // Private allow-list still restricts view/actions
        val allowed = channelAllowList(channel)
        if (allowed != null && !allowed.contains(user.id)) return false
        if (flag == PERM_FLAG_VIEW) return true
        // Chat has no action columns — non-view flags mean "can post" for non-viewers.
        if (channel.kind != "event") return canMutateContent(user)
        return flags.flag(flag)
    }

    internal fun canCreateEventsInChannel(user: User, channel: Channel): Boolean {
        if (channel.kind != "event") return false
        if (!canChannel(user, channel, PERM_FLAG_CREATE)) return false
        return true
    }

    internal fun canEditEvent(user: User, event: Event): Boolean {
        val channel = state.channels.find { it.id == event.channelId } ?: return false
        if (!channelVisible(channel, user)) return false
        if (canManageServer(user)) return true
        if (effectiveRole(user) == ROLE_MODERATOR) return true
        if (channel.kind == "event") {
            if (event.createdBy == user.id && canChannel(user, channel, PERM_FLAG_CREATE)) return true
            return false
        }
        return canMutateContent(user) && event.createdBy == user.id
    }

    internal fun canManageMember(actor: User, target: User): Boolean {
        if (target.isHost || effectiveRole(target) == ROLE_HOST) return false
        val actorRole = effectiveRole(actor)
        if (actorRole == ROLE_HOST) return true
        if (actorRole == ROLE_ADMIN) {
            val targetRole = effectiveRole(target)
            return targetRole == ROLE_MODERATOR || targetRole == ROLE_USER || targetRole == ROLE_VIEWER
        }
        return false
    }

    /**
     * Custom role tags (not ladder roles). Host/admin match [canManageMember];
     * moderators may tag members and viewers only.
     */
    internal fun canAssignMemberRoleTags(actor: User, target: User): Boolean {
        if (canManageMember(actor, target)) return true
        if (target.isHost || effectiveRole(target) == ROLE_HOST) return false
        if (effectiveRole(actor) != ROLE_MODERATOR) return false
        val targetRole = effectiveRole(target)
        return targetRole == ROLE_USER || targetRole == ROLE_VIEWER
    }

    internal fun channelBoard(channel: Channel): Board? {
        val id = channel.boardId?.trim().orEmpty()
        if (id.isEmpty()) return null
        return state.boards.find { it.id == id }
    }

    internal fun channelRolePerms(channel: Channel): MutableMap<String, RolePermFlags>? =
        channelBoard(channel)?.rolePerms ?: channel.rolePerms

    internal fun channelAllowList(channel: Channel): MutableList<String>? =
        channelBoard(channel)?.allowedUserIds ?: channel.allowedUserIds

    /** Host/admin bypass; board-backed channels inherit the board's visibility. */
    internal fun boardVisible(board: Board, user: User): Boolean {
        if (canManageServer(user)) return true
        if (board.allowedUserIds != null && !board.autoIncludeNewMembers) {
            return board.allowedUserIds!!.contains(user.id)
        }
        val vis = board.rolePerms
        if (!vis.isNullOrEmpty()) {
            val primary = effectiveRole(user)
            val primaryKey = when (primary) {
                ROLE_MODERATOR -> ROLE_MODERATOR
                ROLE_VIEWER -> ROLE_VIEWER
                else -> ROLE_USER
            }
            var seen = if (primary == ROLE_MODERATOR && !vis.containsKey(ROLE_MODERATOR)) {
                moderatorViewDefault(vis, null)
            } else {
                vis[primaryKey]?.view == true
            }
            for (tagId in user.roleTagIds ?: emptyList()) {
                if (vis[tagId]?.view == true) seen = true
            }
            if (!seen) return false
        }
        val allowed = board.allowedUserIds
        return allowed == null || allowed.contains(user.id)
    }

    /** Host/admin bypass; channels with a role matrix use view flags; legacy chat uses minRole. */
    internal fun channelVisible(channel: Channel, user: User): Boolean {
        if (canManageServer(user)) return true
        val board = channelBoard(channel)
        if (board != null) return boardVisible(board, user)
        if (channel.allowedUserIds != null && !channel.autoIncludeNewMembers) {
            return channel.allowedUserIds!!.contains(user.id)
        }
        if (channel.kind == "event" || !channel.rolePerms.isNullOrEmpty()) {
            return canChannel(user, channel, PERM_FLAG_VIEW)
        }
        if (!meetsChannelMinRole(channel, user)) return false
        val allowed = channel.allowedUserIds
        return allowed == null || allowed.contains(user.id)
    }

    internal fun meetsChannelMinRole(channel: Channel, user: User): Boolean {
        val floor = normalizeChannelMinRole(channel.minRole) ?: ROLE_VIEWER
        return roleRank(effectiveRole(user)) >= roleRank(floor)
    }

    internal fun audienceFor(channel: Channel): Collection<User> =
        state.users.values.filter { channelVisible(channel, it) }
}
