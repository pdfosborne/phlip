package app.phlip.server

import com.google.gson.Gson
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Membership, identity, admission-domain, and group-invite commands. */
internal class MembershipService(
    private val stateProvider: () -> AppState,
    private val gson: Gson,
    private val authorization: ServerAuthorization,
    private val idGenerator: () -> String,
    private val memberTokenGenerator: () -> String,
    private val groupInviteCodeGenerator: () -> String,
    private val personalInviteSlugGenerator: () -> String,
    private val random: SecureRandom,
    private val serverPassphrase: () -> String,
    private val defaultRoleForNewMembers: () -> String,
    private val livePics: MutableMap<String, String>,
    private val operations: Operations,
) {
    internal data class Operations(
        val save: () -> Unit,
        val sendToUser: (User, JSONObject) -> Unit,
        val sendToToken: (String, JSONObject) -> Unit,
        val broadcast: (JSONObject) -> Unit,
        val presence: () -> Unit,
        val broadcastMembers: () -> Unit,
        val pushSyncToAll: () -> Unit,
        val purgeMemberContent: (String) -> Unit,
        val disconnectUser: (String, String) -> Unit,
        val approveJoin: (String) -> Boolean,
        val denyJoin: (String) -> Unit,
        val snapshot: (User) -> JSONObject,
        val releaseHttpSession: (String) -> Unit,
        val edgeMemberSession: (String, String, String?) -> Unit,
        val onPersonalInvitesChanged: () -> Unit = {},
        /** Current share bases for building origin-rooted personal invite URLs. */
        val shareLanUrl: () -> String = { "" },
        val sharePublicUrl: () -> String = { "" },
        val hostIsPublic: () -> Boolean = { false },
        val postMemberJoined: (User) -> Unit = {},
    )

    private val state: AppState get() = stateProvider()

    fun dispatch(user: User, message: JSONObject): Boolean {
        when (message.optString("type")) {
            "setPassword" -> cmdSetPassword(user, message)
            "setDisplayName" -> cmdSetDisplayName(user, message)
            "setMemberDisplayName" -> cmdSetMemberDisplayName(user, message)
            "setMemberRole" -> cmdSetMemberRole(user, message)
            "setMemberRoleTags" -> cmdSetMemberRoleTags(user, message)
            "createCustomRole" -> cmdCreateCustomRole(user, message)
            "updateCustomRole" -> cmdUpdateCustomRole(user, message)
            "deleteCustomRole" -> cmdDeleteCustomRole(user, message)
            "updateEventRolePerms" -> cmdUpdateEventRolePerms(user, message)
            "approveJoin" -> cmdApproveJoin(user, message)
            "denyJoin" -> cmdDenyJoin(user, message)
            "leaveServer" -> cmdLeaveServer(user, message)
            "removeMember" -> cmdRemoveMember(user, message)
            "createInvite" -> cmdCreateInvite(user, message)
            "revokeInvite" -> cmdRevokeInvite(user, message)
            "redeemInvite" -> cmdRedeemInvite(user, message)
            "getInviteLink" -> cmdGetInviteLink(user, message)
            "rotateInviteLink" -> cmdRotateInviteLink(user, message)
            else -> return false
        }
        return true
    }

    private fun cmdSetPassword(user: User, message: JSONObject) {
        val salt = message.optString("pwdSalt").trim()
        val verifier = message.optString("authVerifier").trim()
        val wrapped = message.optString("wrappedGroupKey").trim()
        val fingerprint = message.optString("fingerprint").trim().lowercase()
        if (user.isHost || salt.isEmpty() || verifier.isEmpty() || !wrapped.startsWith("e2e:")) return
        if (!user.authVerifier.isNullOrEmpty()) return
        user.pwdSalt = salt.take(128)
        user.authVerifier = verifier.take(128)
        user.wrappedGroupKey = wrapped.take(MAX_CIPHERTEXT)
        if (fingerprint.length >= 16) rememberFingerprint(user, fingerprint)
        applyIdentityFields(user, message.optString("identityId"), message.optString("identityPub"))
        operations.save()
        operations.sendToUser(user, JSONObject().put("type", "passwordSet").put("ok", true))
    }

    private fun cmdSetDisplayName(user: User, message: JSONObject) {
        val name = message.optString("name").trim().take(24)
        if (name.isEmpty()) {
            operations.sendToUser(
                user,
                JSONObject().put("type", "error")
                    .put("error", "Pick a name so friends know who you are.").put("code", "nameEmpty"),
            )
            return
        }
        if (state.users.values.any { it.id != user.id && it.name.equals(name, ignoreCase = true) }) {
            operations.sendToUser(
                user,
                JSONObject().put("type", "error")
                    .put("error", "Someone here already uses that name. Try another.")
                    .put("code", "nameTaken").put("takenName", name),
            )
            return
        }
        if (user.name == name && !user.nameHostSet) {
            operations.sendToUser(
                user,
                JSONObject().put("type", "displayNameSet").put("name", user.name)
                    .put("nameHostSet", false).put("ok", true),
            )
            return
        }
        val from = user.name
        val wasHostSet = user.nameHostSet
        user.name = name
        user.nameSelf = name
        user.nameHostSet = false
        appendNameChangeActivity(user, user, from, name, hostSet = false)
        operations.save()
        operations.sendToUser(
            user,
            JSONObject().put("type", "displayNameSet").put("name", name)
                .put("nameHostSet", false).put("nameSelf", name)
                .put("clearedHostSet", wasHostSet).put("ok", true),
        )
        operations.presence()
        broadcastServerActivity()
    }

    private fun cmdSetMemberDisplayName(actor: User, message: JSONObject) {
        if (!authorization.canManageServer(actor)) {
            operations.sendToUser(
                actor,
                JSONObject().put("type", "error")
                    .put("error", "Only the host or an admin can set member names.").put("code", "forbidden"),
            )
            return
        }
        val targetId = message.optString("userId").trim()
        val name = message.optString("name").trim().take(24)
        if (targetId.isEmpty() || name.isEmpty()) {
            operations.sendToUser(
                actor,
                JSONObject().put("type", "error").put("error", "Pick a member and a name.")
                    .put("code", "nameEmpty"),
            )
            return
        }
        val target = state.users.values.find { it.id == targetId }
        if (target == null) {
            operations.sendToUser(
                actor,
                JSONObject().put("type", "error").put("error", "That member isn't here.")
                    .put("code", "notFound"),
            )
            return
        }
        if (target.id == actor.id) {
            cmdSetDisplayName(actor, JSONObject().put("name", name))
            return
        }
        if (!authorization.canManageMember(actor, target)) {
            operations.sendToUser(
                actor,
                JSONObject().put("type", "error").put("error", "You can't rename that member.")
                    .put("code", "forbidden"),
            )
            return
        }
        if (state.users.values.any { it.id != target.id && it.name.equals(name, ignoreCase = true) }) {
            operations.sendToUser(
                actor,
                JSONObject().put("type", "error")
                    .put("error", "Someone here already uses that name. Try another.")
                    .put("code", "nameTaken").put("takenName", name),
            )
            return
        }
        if (target.name == name && target.nameHostSet) {
            operations.sendToUser(
                actor,
                JSONObject().put("type", "memberDisplayNameSet").put("userId", target.id)
                    .put("name", name).put("nameHostSet", true).put("ok", true),
            )
            return
        }
        val from = target.name
        if (target.nameSelf.isNullOrBlank()) target.nameSelf = target.name
        target.name = name
        target.nameHostSet = true
        appendNameChangeActivity(actor, target, from, name, hostSet = true)
        operations.save()
        operations.sendToUser(
            actor,
            JSONObject().put("type", "memberDisplayNameSet").put("userId", target.id)
                .put("name", name).put("nameHostSet", true).put("ok", true),
        )
        operations.sendToUser(
            target,
            JSONObject().put("type", "displayNameSet").put("name", name)
                .put("nameHostSet", true).put("nameSelf", target.nameSelf ?: JSONObject.NULL)
                .put("hostSetBy", actor.name).put("ok", true),
        )
        operations.presence()
        broadcastServerActivity()
    }

    private fun cmdSetMemberRole(actor: User, message: JSONObject) {
        if (!authorization.canManageServer(actor)) return
        val targetId = message.optString("userId").ifEmpty { return }
        val role = message.optString("role").trim().lowercase()
        if (role !in ASSIGNABLE_ROLES) return
        val entry = state.users.entries.find { it.value.id == targetId } ?: return
        val target = entry.value
        if (!authorization.canManageMember(actor, target)) return
        if ((role == ROLE_ADMIN || effectiveRole(target) == ROLE_ADMIN) && effectiveRole(actor) != ROLE_HOST) return
        val wasManager = authorization.canManageServer(target)
        target.role = role
        target.isHost = false
        operations.save()
        operations.broadcastMembers()
        operations.sendToToken(entry.key, operations.snapshot(target).put("type", "sync"))
        // § pinned people — role changes alter channelVisible for pinnees; rebuild stubs.
        if (state.channels.any { it.pinnedUserId != null }) operations.pushSyncToAll()
        if (!wasManager && authorization.canManageServer(target)) {
            operations.sendToToken(
                entry.key,
                JSONObject().put("type", "invite").put("code", state.inviteCode)
                    .put("expiry", state.inviteExpiry),
            )
        }
    }

    private fun cmdSetMemberRoleTags(actor: User, message: JSONObject) {
        val targetId = message.optString("userId").ifEmpty { return }
        val entry = state.users.entries.find { it.value.id == targetId } ?: return
        val target = entry.value
        if (!authorization.canAssignMemberRoleTags(actor, target)) return
        val known = (state.customRoles ?: emptyList()).map { it.id }.toHashSet()
        val tags = jsonStringList(message.optJSONArray("roleTagIds"))
            ?.map { it.trim().take(40) }
            ?.filter { it in known }
            ?.distinct()
            ?.take(32)
            ?.toMutableList()
        target.roleTagIds = tags?.takeIf { it.isNotEmpty() }
        operations.save()
        operations.broadcastMembers()
        operations.sendToToken(entry.key, operations.snapshot(target).put("type", "sync"))
        operations.pushSyncToAll()
    }

    private fun ensureCustomRoles(): MutableList<CustomRole> =
        state.customRoles ?: mutableListOf<CustomRole>().also { state.customRoles = it }

    private fun cmdCreateCustomRole(actor: User, message: JSONObject) {
        if (!authorization.canManageServer(actor)) return
        val roles = ensureCustomRoles()
        if (roles.size >= 40) return
        val name = message.optString("name").trim().take(32).ifEmpty { return }
        if (roles.any { it.name.equals(name, ignoreCase = true) }) return
        val color = message.optString("color").trim().take(16)
            .takeIf { it.matches(Regex("^#[0-9a-fA-F]{6}$")) }
        val copyRoleId = message.optString("copyRoleId").trim()
        val presetRaw = message.optString("preset").ifBlank { message.optString("baseRole") }
        val baseRole = when {
            copyRoleId.isNotEmpty() -> ROLE_USER
            else -> normalizeCustomRoleBase(presetRaw)
        }
        val id = idGenerator()
        roles.add(CustomRole(id, name, color, roles.size, if (baseRole == "none") ROLE_USER else baseRole))
        val matrix = authorization.ensureEventRolePerms()
        val fromPayload = message.optJSONObject("rolePerms")
        val seeded = when {
            fromPayload != null -> parseRolePermsMap(JSONObject().put("_", fromPayload))?.get("_")
            copyRoleId.isNotEmpty() -> matrix[copyRoleId]?.copyFlags()
            baseRole == "none" -> emptyRolePermFlags()
            else -> (matrix[baseRole] ?: emptyRolePermFlags()).copyFlags()
        } ?: emptyRolePermFlags()
        matrix[id] = normalizeRolePermFlags(seeded)
        val visView = matrix[id]?.view == true
        for (ch in state.channels) {
            if (ch.kind != "event") continue
            val vis = ch.rolePerms ?: continue
            if (id !in vis) vis[id] = RolePermFlags(view = visView)
        }
        for (board in state.boards) {
            val vis = board.rolePerms ?: continue
            if (id !in vis) vis[id] = RolePermFlags(view = visView)
        }
        val assign = message.optJSONArray("assignUserIds")
        if (assign != null) {
            for (i in 0 until assign.length()) {
                val uid = assign.optString(i).trim()
                if (uid.isEmpty()) continue
                val target = state.users[uid] ?: continue
                if (target.isHost) continue
                val tags = (target.roleTagIds ?: mutableListOf()).toMutableList()
                if (id !in tags) tags.add(id)
                target.roleTagIds = tags.take(32).toMutableList()
            }
        }
        operations.save()
        operations.broadcastMembers()
        operations.pushSyncToAll()
    }

    private fun cmdUpdateCustomRole(actor: User, message: JSONObject) {
        if (!authorization.canManageServer(actor)) return
        val id = message.optString("roleId").ifEmpty { return }
        val role = ensureCustomRoles().find { it.id == id } ?: return
        if (message.has("name")) {
            val name = message.optString("name").trim().take(32).ifEmpty { return }
            if (ensureCustomRoles().any { it.id != id && it.name.equals(name, ignoreCase = true) }) return
            role.name = name
        }
        if (message.has("color")) {
            val color = message.optString("color").trim().take(16)
            role.color = color.takeIf { it.matches(Regex("^#[0-9a-fA-F]{6}$")) }
        }
        operations.save()
        operations.pushSyncToAll()
    }

    private fun cmdDeleteCustomRole(actor: User, message: JSONObject) {
        if (!authorization.canManageServer(actor)) return
        val id = message.optString("roleId").ifEmpty { return }
        val roles = ensureCustomRoles()
        if (!roles.removeAll { it.id == id }) return
        for (user in state.users.values) {
            user.roleTagIds?.removeAll { it == id }
            if (user.roleTagIds.isNullOrEmpty()) user.roleTagIds = null
        }
        for (ch in state.channels) {
            ch.rolePerms?.remove(id)
        }
        for (board in state.boards) {
            board.rolePerms?.remove(id)
        }
        state.eventRolePerms?.remove(id)
        roles.forEachIndexed { index, r -> r.sortOrder = index }
        operations.save()
        operations.broadcastMembers()
        operations.pushSyncToAll()
    }

    private fun cmdUpdateEventRolePerms(actor: User, message: JSONObject) {
        if (!authorization.canManageServer(actor)) {
            operations.sendToUser(
                actor,
                JSONObject().put("type", "error").put("error", "Only admins can edit role permissions.")
                    .put("code", "forbidden"),
            )
            return
        }
        val parsed = parseRolePermsMap(message.optJSONObject("rolePerms")) ?: return
        val known = (state.customRoles ?: emptyList()).map { it.id }.toHashSet()
        val cleaned = linkedMapOf<String, RolePermFlags>()
        for ((key, flags) in parsed) {
            if (key in CHANNEL_MATRIX_FIXED_KEYS || key in known) {
                cleaned[key] = normalizeRolePermFlags(flags.copyFlags())
            }
        }
        for (fixed in CHANNEL_MATRIX_FIXED_KEYS) {
            if (fixed !in cleaned) cleaned[fixed] = emptyRolePermFlags()
        }
        for (role in state.customRoles ?: emptyList()) {
            if (role.id !in cleaned) {
                val base = normalizeCustomRoleBase(role.baseRole)
                cleaned[role.id] = (cleaned[base] ?: emptyRolePermFlags()).copyFlags()
            }
        }
        state.eventRolePerms = cleaned
        operations.save()
        operations.broadcast(
            JSONObject()
                .put("type", "eventRolePerms")
                .put("eventRolePerms", JSONObject(gson.toJson(cleaned))),
        )
        operations.pushSyncToAll()
    }

    private fun cmdApproveJoin(actor: User, message: JSONObject) {
        if (!authorization.canManageServer(actor)) return
        val requestId = message.optString("requestId").ifEmpty { return }
        if (!operations.approveJoin(requestId)) {
            operations.sendToUser(
                actor,
                JSONObject().put("type", "error")
                    .put("error", "That join request expired — ask them to try again"),
            )
        }
    }

    private fun cmdDenyJoin(actor: User, message: JSONObject) {
        if (!authorization.canManageServer(actor)) return
        val requestId = message.optString("requestId").ifEmpty { return }
        operations.denyJoin(requestId)
    }

    private fun cmdLeaveServer(user: User, message: JSONObject) {
        if (user.isHost || effectiveRole(user) == ROLE_HOST) {
            operations.sendToUser(
                user,
                JSONObject().put("type", "error")
                    .put("error", "You’re the host — stop hosting on the phone instead of leaving."),
            )
            return
        }
        val entry = state.users.entries.find { it.value.id == user.id } ?: return
        val deleteData = if (message.has("deleteData")) message.optBoolean("deleteData", true) else true
        if (deleteData) operations.purgeMemberContent(user.id)
        state.users.remove(entry.key)
        state.notifications.remove(user.id)
        for (channel in state.channels) channel.allowedUserIds?.removeAll { it == user.id }
        livePics.remove(user.id)
        operations.save()
        operations.disconnectUser(entry.key, "Left this server")
        if (deleteData) operations.pushSyncToAll()
        operations.broadcastMembers()
        operations.broadcast(
            JSONObject().put("type", "memberRemoved").put("userId", user.id).put("purged", deleteData),
        )
    }

    private fun cmdRemoveMember(actor: User, message: JSONObject) {
        if (!authorization.canManageServer(actor)) return
        val targetId = message.optString("userId").ifEmpty { return }
        if (targetId == actor.id) return
        val entry = state.users.entries.find { it.value.id == targetId } ?: return
        if (!authorization.canManageMember(actor, entry.value)) return
        operations.purgeMemberContent(targetId)
        state.users.remove(entry.key)
        state.notifications.remove(targetId)
        for (channel in state.channels) channel.allowedUserIds?.removeAll { it == targetId }
        livePics.remove(targetId)
        operations.save()
        operations.disconnectUser(entry.key, "Removed from this server")
        operations.pushSyncToAll()
        operations.broadcastMembers()
        operations.broadcast(
            JSONObject().put("type", "memberRemoved").put("userId", targetId).put("purged", true),
        )
    }

    private fun cmdCreateInvite(user: User, message: JSONObject) {
        if (!authorization.canInviteToGroup(user)) {
            operations.sendToUser(
                user,
                JSONObject().put("type", "error")
                    .put("error", "You don't have permission to invite people into groups."),
            )
            return
        }
        pruneGroupInvites()
        if (state.groupInvites.count { groupInviteUsable(it) } >= MAX_GROUP_INVITES) {
            operations.sendToUser(
                user,
                JSONObject().put("type", "error")
                    .put("error", "Too many active invites — revoke some first."),
            )
            return
        }
        val requested = jsonStringList(message.optJSONArray("channelIds")) ?: mutableListOf()
        val channelIds = mutableListOf<String>()
        for (channelId in requested.distinct()) {
            val channel = state.channels.find { it.id == channelId } ?: continue
            if (channel.allowedUserIds == null) continue
            if (!authorization.channelVisible(channel, user) && !authorization.canManageServer(user)) continue
            channelIds.add(channel.id)
        }
        val ttlMs = message.optLong("ttlMs", GROUP_INVITE_TTL_MS)
            .coerceIn(60_000L, GROUP_INVITE_TTL_MS * 7)
        val maxUses = message.optInt("maxUses", 1).coerceIn(1, 20)
        val now = System.currentTimeMillis()
        val invite = GroupInvite(
            id = idGenerator(),
            code = groupInviteCodeGenerator(),
            createdBy = user.id,
            createdByName = user.name,
            createdAt = now,
            expiresAt = now + ttlMs,
            maxUses = maxUses,
            channelIds = channelIds,
        )
        state.groupInvites.add(invite)
        operations.save()
        broadcastGroupInvites()
        operations.sendToUser(
            user,
            groupInviteJson(invite, includeCode = true).put("type", "groupInviteCreated")
                .put("autoInclude", autoIncludeChannelsPayload()),
        )
    }

    private fun cmdRevokeInvite(user: User, message: JSONObject) {
        if (!authorization.canInviteToGroup(user)) return
        val id = message.optString("inviteId").trim().ifEmpty { return }
        val invite = state.groupInvites.find { it.id == id } ?: return
        if (invite.createdBy != user.id && !authorization.canManageServer(user)) return
        if (invite.revoked) return
        invite.revoked = true
        operations.save()
        broadcastGroupInvites()
        operations.sendToUser(user, JSONObject().put("type", "groupInviteRevoked").put("inviteId", id))
    }

    private fun cmdRedeemInvite(user: User, message: JSONObject) {
        if (user.isHost) return
        val code = message.optString("code").ifEmpty { message.optString("invite") }
        val invite = findUsableGroupInvite(code)
        if (invite == null) {
            operations.sendToUser(
                user,
                JSONObject().put("type", "error")
                    .put("error", "That invite is invalid, used up, or expired."),
            )
            return
        }
        applyInviteChannels(user, invite.channelIds)
        consumeGroupInvite(invite)
        operations.save()
        broadcastGroupInvites()
        operations.sendToUser(user, operations.snapshot(user).put("type", "sync").put("inviteRedeemed", true))
    }

    private fun cmdGetInviteLink(user: User, message: JSONObject) {
        val target = resolveInviteLinkTarget(user, message) ?: return
        val before = target.inviteSlug
        ensureInviteSlug(target)
        operations.save()
        if (before.isNullOrBlank()) notifyPersonalInvitesChanged()
        operations.sendToUser(user, inviteLinkPayload(target))
    }

    private fun cmdRotateInviteLink(user: User, message: JSONObject) {
        val target = resolveInviteLinkTarget(user, message) ?: return
        if (target.id != user.id && !authorization.canManageServer(user)) {
            operations.sendToUser(
                user,
                JSONObject().put("type", "error").put("error", "Only the host can rotate someone else's invite link."),
            )
            return
        }
        rotateInviteSlug(target)
        operations.save()
        notifyPersonalInvitesChanged()
        operations.sendToUser(user, inviteLinkPayload(target).put("rotated", true))
    }

    /** Resolve whose link to fetch: self by default, or a managed member via userId. */
    private fun resolveInviteLinkTarget(actor: User, message: JSONObject): User? {
        val targetId = message.optString("userId").trim()
        if (targetId.isEmpty() || targetId == actor.id) return actor
        if (!authorization.canManageServer(actor)) {
            operations.sendToUser(
                actor,
                JSONObject().put("type", "error").put("error", "Only the host can view another member's invite link."),
            )
            return null
        }
        val target = state.users.values.find { it.id == targetId }
        if (target == null) {
            operations.sendToUser(
                actor,
                JSONObject().put("type", "error").put("error", "Member not found."),
            )
            return null
        }
        return target
    }

    fun inviteLinkPayload(user: User): JSONObject {
        val slug = ensureInviteSlug(user)
        val url = personalInviteUrlFor(
            slug,
            operations.sharePublicUrl(),
            operations.shareLanUrl(),
            operations.hostIsPublic(),
        )
        return JSONObject()
            .put("type", "inviteLink")
            .put("slug", slug)
            .put("url", url)
            .put("userId", user.id)
            .put("createdAt", user.inviteSlugCreatedAt ?: 0L)
    }

    fun normalizePersonalInviteSlug(raw: String): String =
        raw.trim().lowercase().replace(Regex("[^a-z0-9]"), "").take(PERSONAL_INVITE_SLUG_LEN + 4)

    fun findUserByInviteSlug(raw: String): User? {
        val slug = normalizePersonalInviteSlug(raw)
        if (slug.length < 8) return null
        return state.users.values.find {
            (it.inviteSlug ?: "").equals(slug, ignoreCase = true)
        }
    }

    /** Mint a slug if missing; returns the current slug. */
    fun ensureInviteSlug(user: User): String {
        val existing = user.inviteSlug?.takeIf { it.isNotBlank() }
        if (existing != null) return existing
        val slug = rotateInviteSlug(user)
        notifyPersonalInvitesChanged()
        return slug
    }

    fun rotateInviteSlug(user: User): String {
        var slug: String
        do {
            slug = personalInviteSlugGenerator().lowercase()
        } while (state.users.values.any {
            it.id != user.id && (it.inviteSlug ?: "").equals(slug, ignoreCase = true)
        })
        user.inviteSlug = slug
        user.inviteSlugCreatedAt = System.currentTimeMillis()
        return slug
    }

    /** Mint personal invite slugs for every member missing one (migration). */
    fun ensureAllInviteSlugs(): Boolean {
        var changed = false
        for (user in state.users.values) {
            if (user.inviteSlug.isNullOrBlank()) {
                rotateInviteSlug(user)
                changed = true
            }
        }
        if (changed) notifyPersonalInvitesChanged()
        return changed
    }

    fun activeInviteSlugs(): List<String> {
        ensureAllInviteSlugs()
        return state.users.values.mapNotNull { it.inviteSlug?.takeIf { s -> s.isNotBlank() } }
            .map { normalizePersonalInviteSlug(it) }
            .filter { it.length >= 8 }
            .distinct()
    }

    private fun notifyPersonalInvitesChanged() {
        try {
            operations.onPersonalInvitesChanged()
        } catch (_: Exception) {
        }
    }

    fun normalizeInviteInput(raw: String): String {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return ""
        val beforeAt = if (trimmed.contains("@")) trimmed.substringBefore("@") else trimmed
        val core = if (beforeAt.contains("-")) {
            val last = beforeAt.substringAfterLast("-").replace("-", "")
            if (last.length == INVITE_CODE_LEN) last else beforeAt.replace("-", "")
        } else {
            beforeAt
        }
        return core.uppercase().replace(Regex("[^A-Z0-9]"), "")
    }

    fun inviteCodeValid(raw: String): Boolean {
        val code = normalizeInviteInput(raw)
        return code.isNotEmpty() && code == state.inviteCode &&
            System.currentTimeMillis() <= state.inviteExpiry
    }

    fun groupInviteUsable(invite: GroupInvite): Boolean =
        !invite.revoked && invite.uses < invite.maxUses && System.currentTimeMillis() <= invite.expiresAt

    fun findUsableGroupInvite(raw: String): GroupInvite? {
        val code = normalizeInviteInput(raw)
        if (code.length < GROUP_INVITE_CODE_LEN) return null
        val invite = state.groupInvites.find { it.code.equals(code, ignoreCase = true) } ?: return null
        return invite.takeIf(::groupInviteUsable)
    }

    fun consumeGroupInvite(invite: GroupInvite) {
        invite.uses = (invite.uses + 1).coerceAtMost(invite.maxUses + 10)
    }

    fun refundGroupInvite(inviteId: String) {
        val invite = state.groupInvites.find { it.id == inviteId } ?: return
        if (invite.uses > 0) invite.uses -= 1
        operations.save()
        broadcastGroupInvites()
    }

    fun applyInviteChannels(user: User, channelIds: List<String>): Boolean {
        var changed = false
        for (channelId in channelIds) {
            val channel = state.channels.find { it.id == channelId } ?: continue
            val allowed = channel.allowedUserIds ?: continue
            if (user.id in allowed) continue
            allowed.add(user.id)
            changed = true
        }
        return changed
    }

    fun rememberFingerprint(user: User, fingerprint: String) {
        if (fingerprint.length < 16) return
        val list = user.trustedFpHashes ?: mutableListOf<String>().also { user.trustedFpHashes = it }
        if (list.none { it.equals(fingerprint, ignoreCase = true) }) {
            list.add(fingerprint.lowercase())
            while (list.size > 8) list.removeAt(0)
        }
    }

    fun applyIdentityFields(user: User, identityId: String, identityPub: String) {
        val id = identityId.trim().lowercase().take(32)
        if (id.length >= 8 && user.identityId.isNullOrBlank()) user.identityId = id
        val publicKey = identityPub.trim().take(512)
        if (publicKey.isNotEmpty() && user.identityPub.isNullOrBlank()) user.identityPub = publicKey
    }

    fun issueWelcome(
        name: String,
        setupNonce: String? = null,
        fingerprint: String? = null,
        inviteChannelIds: List<String> = emptyList(),
        consumeInvite: GroupInvite? = null,
        identityId: String = "",
        identityPub: String = "",
    ): JSONObject {
        val identityKey = identityId.trim().lowercase().take(32)
        val existing = when {
            identityKey.length >= 8 -> state.users.entries.find {
                !it.value.isHost && (it.value.identityId ?: "").equals(identityKey, ignoreCase = true)
            } ?: state.users.entries.find {
                it.value.name.equals(name, ignoreCase = true) && !it.value.isHost
            }
            else -> state.users.entries.find {
                it.value.name.equals(name, ignoreCase = true) && !it.value.isHost
            }
        }
        val token: String
        val user: User
        val isNew: Boolean
        if (existing != null) {
            operations.releaseHttpSession(existing.key)
            token = existing.key
            user = existing.value
            isNew = false
        } else {
            token = memberTokenGenerator()
            user = User(
                idGenerator(), name, System.currentTimeMillis(), false,
                role = defaultRoleForNewMembers(),
            )
            ensureInviteSlug(user)
            state.users[token] = user
            autoIncludeNewMember(user)
            isNew = true
        }
        if (!fingerprint.isNullOrBlank()) rememberFingerprint(user, fingerprint)
        applyIdentityFields(user, identityId, identityPub)
        applyInviteChannels(user, inviteChannelIds)
        if (consumeInvite != null && groupInviteUsable(consumeInvite)) consumeGroupInvite(consumeInvite)
        if (isNew) operations.postMemberJoined(user)
        operations.save()
        if (isNew || inviteChannelIds.isNotEmpty()) broadcastGroupInvites()
        val welcome = operations.snapshot(user).put("token", token)
        val needsPassword = user.authVerifier.isNullOrEmpty()
        welcome.put("needsPassword", needsPassword)
        val passphrase = serverPassphrase()
        if (needsPassword && !setupNonce.isNullOrEmpty() && passphrase.isNotEmpty()) {
            welcome.put("setupNonce", setupNonce)
            welcome.put("groupKeyOnce", encryptGroupKeyOnce(passphrase, setupNonce, name))
        }
        if (!user.wrappedGroupKey.isNullOrEmpty()) welcome.put("wrappedGroupKey", user.wrappedGroupKey)
        try {
            operations.edgeMemberSession(token, user.id, null)
        } catch (_: Exception) {}
        return welcome
    }

    fun ensureHostOnPrivateChannels(host: User) {
        var changed = false
        for (channel in state.channels) {
            val allowed = channel.allowedUserIds ?: continue
            if (host.id in allowed) continue
            allowed.add(host.id)
            changed = true
        }
        if (changed) operations.save()
    }

    fun autoIncludeNewMember(user: User) {
        var changed = false
        for (channel in state.channels) {
            if (!channel.autoIncludeNewMembers) continue
            val allowed = channel.allowedUserIds ?: continue
            if (user.id in allowed) continue
            allowed.add(user.id)
            changed = true
        }
        if (changed) operations.save()
    }

    fun autoIncludeChannelsPayload(): JSONArray {
        val result = JSONArray()
        for (channel in state.channels) {
            if (!channel.autoIncludeNewMembers || channel.allowedUserIds == null) continue
            result.put(JSONObject().put("id", channel.id).put("name", channel.name).put("kind", channel.kind))
        }
        return result
    }

    fun groupInvitesPayload(user: User): JSONArray {
        pruneGroupInvites()
        val result = JSONArray()
        val manage = authorization.canManageServer(user)
        for (invite in state.groupInvites) {
            if (!manage && invite.createdBy != user.id) continue
            if (!groupInviteUsable(invite) && invite.revoked) continue
            if (!groupInviteUsable(invite) && System.currentTimeMillis() > invite.expiresAt + 86_400_000L) continue
            result.put(groupInviteJson(invite))
        }
        return result
    }

    fun serverActivityPayload(): JSONArray =
        JSONArray(gson.toJson(state.serverActivity ?: emptyList<ServerActivityEntry>()))

    private fun appendNameChangeActivity(
        actor: User,
        target: User,
        from: String,
        to: String,
        hostSet: Boolean,
    ) {
        if (from == to && !hostSet) return
        @Suppress("SENSELESS_COMPARISON")
        if (state.serverActivity == null) state.serverActivity = mutableListOf()
        state.serverActivity.add(
            ServerActivityEntry(
                id = idGenerator(),
                kind = "nameChange",
                at = System.currentTimeMillis(),
                actorId = actor.id,
                actorName = actor.name,
                targetId = target.id,
                targetName = to,
                from = from,
                to = to,
                hostSet = hostSet,
            ),
        )
        while (state.serverActivity.size > MAX_SERVER_ACTIVITY) state.serverActivity.removeAt(0)
    }

    private fun broadcastServerActivity() {
        operations.broadcast(
            JSONObject().put("type", "serverActivityUpdated")
                .put("serverActivity", serverActivityPayload()),
        )
    }

    private fun pruneGroupInvites() {
        val now = System.currentTimeMillis()
        val keep = state.groupInvites.filter {
            !(it.revoked && now - it.expiresAt > 7L * 24 * 60 * 60 * 1000) &&
                !(it.uses >= it.maxUses && now - it.expiresAt > 7L * 24 * 60 * 60 * 1000) &&
                !(now - it.expiresAt > 30L * 24 * 60 * 60 * 1000)
        }
        if (keep.size != state.groupInvites.size) state.groupInvites = keep.toMutableList()
    }

    private fun groupInviteJson(invite: GroupInvite, includeCode: Boolean = false): JSONObject {
        val result = JSONObject()
            .put("id", invite.id).put("createdBy", invite.createdBy)
            .put("createdByName", invite.createdByName).put("createdAt", invite.createdAt)
            .put("expiresAt", invite.expiresAt).put("maxUses", invite.maxUses)
            .put("uses", invite.uses).put("revoked", invite.revoked)
            .put("channelIds", JSONArray(invite.channelIds)).put("active", groupInviteUsable(invite))
        if (includeCode) result.put("code", invite.code)
        return result
    }

    private fun broadcastGroupInvites() {
        for ((token, user) in state.users) {
            if (!authorization.canInviteToGroup(user)) continue
            operations.sendToToken(
                token,
                JSONObject().put("type", "groupInvites").put("invites", groupInvitesPayload(user))
                    .put("autoInclude", autoIncludeChannelsPayload()),
            )
        }
    }

    internal fun encryptGroupKeyOnce(plain: String, setupNonce: String, name: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest("$setupNonce:${name.lowercase()}".toByteArray(Charsets.UTF_8))
        val key = SecretKeySpec(digest, "AES")
        val iv = ByteArray(12).also { random.nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, iv))
        val encrypted = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        val output = ByteArray(iv.size + encrypted.size)
        System.arraycopy(iv, 0, output, 0, iv.size)
        System.arraycopy(encrypted, 0, output, iv.size, encrypted.size)
        return "e2eonce:" + Base64.getEncoder().encodeToString(output)
    }

    private fun jsonStringList(arr: JSONArray?): MutableList<String>? {
        if (arr == null) return null
        val out = ArrayList<String>(arr.length())
        for (i in 0 until arr.length()) {
            val value = arr.opt(i) ?: continue
            when (value) {
                is String -> out.add(value)
                is Number, is Boolean -> out.add(value.toString())
                else -> continue
            }
        }
        return out
    }
}
