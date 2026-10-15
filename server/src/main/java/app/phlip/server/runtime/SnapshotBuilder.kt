package app.phlip.server

import com.google.gson.Gson
import org.json.JSONArray
import org.json.JSONObject

/**
 * Per-member sync/welcome snapshot assembly (filtered channels, events).
 */
internal class SnapshotBuilder(
    private val stateProvider: () -> AppState,
    private val gson: Gson,
    private val authorization: ServerAuthorization,
    private val sessionRegistry: ServerSessionRegistry,
    private val membershipService: MembershipService,
    private val moderationService: ModerationService,
    private val operations: Operations,
) {
    internal data class Operations(
        val onlineUserIds: () -> List<String>,
        val pruneLivePics: (Collection<String>) -> Unit,
        val livePicFor: (String) -> String?,
        val save: () -> Unit,
        val currentInvite: () -> Pair<String, Long>,
        val shareLanUrl: () -> String,
        val sharePublicUrl: () -> String,
        val hostIsPublic: () -> Boolean,
        val hotspotSsid: () -> String = { "" },
        val hotspotPassword: () -> String = { "" },
        val reachMode: () -> String = { "local" },
        val registryJoinTag: () -> String,
        val serverSettingsPayload: () -> JSONObject,
    )

    private val state get() = stateProvider()
    private val pending get() = sessionRegistry.pending

    fun publicUser(
        u: User,
        onlineIds: Collection<String> = operations.onlineUserIds(),
        includeLivePic: Boolean = true,
    ): JSONObject {
        val o = JSONObject()
            .put("id", u.id)
            .put("name", u.name)
            .put("isHost", u.isHost)
            .put("role", effectiveRole(u))
            .put("nameHostSet", u.nameHostSet)
        if (u.isDemo) o.put("isDemo", true)
        val tags = u.roleTagIds
        if (!tags.isNullOrEmpty()) o.put("roleTagIds", JSONArray(tags))
        u.offlineAvatar?.takeIf { it.isNotEmpty() }?.let { raw ->
            try { o.put("offlineAvatar", JSONObject(raw)) } catch (_: Exception) {}
        }
        if (includeLivePic && onlineIds.contains(u.id)) {
            operations.livePicFor(u.id)?.takeIf { it.isNotEmpty() }?.let { o.put("livePic", it) }
        }
        val alwaysPhotos = state.effectiveLiveProfilePhotos() == LIVE_PROFILE_PHOTOS_ALWAYS
        if (alwaysPhotos) {
            // Always-viewable: include profilePic even with offlineAvatar so clients can prefer photo.
            u.profilePic?.takeIf { it.isNotEmpty() }?.let { o.put("profilePic", it) }
        } else if (!o.has("livePic") && !o.has("offlineAvatar")) {
            u.profilePic?.takeIf { it.isNotEmpty() }?.let { o.put("profilePic", it) }
        }
        u.eventCardStyle?.let { o.put("eventCardStyle", JSONObject(gson.toJson(it))) }
        u.identityId?.takeIf { it.isNotEmpty() }?.let { o.put("identityId", it) }
        u.identityPub?.takeIf { it.isNotEmpty() }?.let { o.put("identityPub", it) }
        return o
    }

    fun selfUser(u: User): JSONObject {
        val o = publicUser(u)
        if (u.nameHostSet) {
            u.nameSelf?.takeIf { it.isNotEmpty() }?.let { o.put("nameSelf", it) }
        }
        u.inviteSlug?.takeIf { it.isNotEmpty() }?.let { slug ->
            o.put("inviteSlug", slug)
            val url = personalInviteUrlFor(
                slug,
                operations.sharePublicUrl(),
                operations.shareLanUrl(),
                operations.hostIsPublic(),
            )
            if (url.isNotEmpty()) o.put("inviteUrl", url)
        }
        return o
    }

    fun membersPayload(includeLivePics: Boolean = true): JSONArray {
        val onlineIds = operations.onlineUserIds()
        operations.pruneLivePics(onlineIds)
        val arr = JSONArray()
        for (u in state.users.values) arr.put(publicUser(u, onlineIds, includeLivePics))
        return arr
    }

    /**
     * Occupancy contact fields for a limited stub. Channel id stays the pin
     * (so the client attaches the row to the aggregation view). Creator and
     * source board are plaintext so viewers can still see who to contact.
     */
    private fun occupancyLimitedStub(ev: Event, pinChannelId: String): JSONObject {
        val o = JSONObject()
            .put("id", ev.id)
            .put("channelId", pinChannelId)
            .put("when", ev.`when` ?: JSONObject.NULL)
            .put("duration", ev.duration ?: JSONObject.NULL)
            .put("limited", true)
        val creatorId = ev.createdBy.trim()
        if (creatorId.isNotEmpty()) o.put("createdBy", creatorId)
        val creatorName = state.users.values.find { it.id == creatorId }?.name?.trim().orEmpty()
            .ifEmpty { ev.createdByName.trim() }
        if (creatorName.isNotEmpty()) o.put("createdByName", creatorName)
        val home = state.channels.find { it.id == ev.channelId }
        val boardName = home?.boardId
            ?.let { bid -> state.boards.find { it.id == bid }?.name }
            ?.trim().orEmpty()
        val sourceName = boardName.ifEmpty { home?.name?.trim().orEmpty() }
        if (sourceName.isNotEmpty()) o.put("sourceChannelName", sourceName)
        return o
    }

    fun pinnedLocationEventStubs(
        visibleChannels: List<Channel>,
        visibleChannelIds: Set<String>,
    ): List<JSONObject> {
        val pinnedChannels = visibleChannels.filter { it.pinnedLocationLabel != null }
        if (pinnedChannels.isEmpty()) return emptyList()
        val out = mutableListOf<JSONObject>()
        for (pinned in pinnedChannels) {
            val label = pinned.pinnedLocationLabel ?: continue
            for (ev in state.events) {
                if (!locationLabelIdHasPlace(ev.locationLabelId, label)) continue
                if (ev.channelId in visibleChannelIds) continue
                if (ev.approvalStatus == "blocked") continue
                val goingCount = ev.rsvps.values.count { it == "going" }
                out.add(occupancyLimitedStub(ev, pinned.id)
                    .put("locationLabelId", label)
                    .put("rsvpCount", goingCount))
            }
        }
        return out
    }

    fun pinnedPeopleEventStubs(
        visibleChannels: List<Channel>,
        visibleChannelIds: Set<String>,
    ): List<JSONObject> {
        if (!state.allowPinnedPeople) return emptyList()
        val pinnedChannels = visibleChannels.filter { it.pinnedUserId != null }
        if (pinnedChannels.isEmpty()) return emptyList()
        val homeById = state.channels.associateBy { it.id }
        val out = mutableListOf<JSONObject>()
        for (pinned in pinnedChannels) {
            val pinneeId = pinned.pinnedUserId ?: continue
            val pinnee = state.users.values.find { it.id == pinneeId } ?: continue
            for (ev in state.events) {
                if (ev.channelId in visibleChannelIds) continue
                if (ev.approvalStatus == "blocked") continue
                val home = homeById[ev.channelId] ?: continue
                if (home.kind != "event") continue
                if (home.pinnedLocationLabel != null || home.pinnedUserId != null) continue
                if (!authorization.channelVisible(home, pinnee)) continue
                val goingCount = ev.rsvps.values.count { it == "going" }
                out.add(occupancyLimitedStub(ev, pinned.id)
                    .put("pinnedUserId", pinneeId)
                    .put("rsvpCount", goingCount))
            }
        }
        return out
    }

    fun snapshot(user: User): JSONObject {
        val onlineIds = operations.onlineUserIds()
        val pendingList = pending.entries.map { (rid, p) ->
            buildMap<String, Any?> {
                put("id", rid)
                put("name", p.name)
                put("ts", p.ts)
                p.invitedByUserId?.let { put("invitedByUserId", it) }
                p.invitedByName?.let { put("invitedByName", it) }
                p.inviteSlug?.let { put("inviteSlug", it) }
            }
        }
        val visibleChannels = state.channels.filter { authorization.channelVisible(it, user) }
        val visibleChannelIds = visibleChannels.map { it.id }.toSet()
        val visibleBoardIds = visibleChannels.mapNotNull { it.boardId }.toSet()
        val visibleBoards = state.boards.filter { board ->
            board.id in visibleBoardIds || authorization.boardVisible(board, user)
        }
        val visibleEvents = state.events.filter { it.channelId in visibleChannelIds }
        val pinnedEventStubs = pinnedLocationEventStubs(visibleChannels, visibleChannelIds)
        val pinnedPeopleStubs = pinnedPeopleEventStubs(visibleChannels, visibleChannelIds)
        val visibleMessages = state.messages.filterKeys { it in visibleChannelIds }
        return JSONObject()
            .put("type", "welcome")
            .put("user", selfUser(user))
            .put("hostName", state.hostName)
            .put("iconText", state.iconText)
            .put("serverPic", state.serverPic ?: JSONObject.NULL)
            .put("joinTag", operations.registryJoinTag().takeIf { it.isNotEmpty() } ?: JSONObject.NULL)
            .put("pwdSalt", user.pwdSalt ?: JSONObject.NULL)
            .put("e2eSalt", state.e2eSalt)
            .put("categories", JSONArray(gson.toJson(state.categories)))
            .put("cardCats", JSONObject(gson.toJson(state.cardCats)))
            .put("cardDurations", JSONObject(gson.toJson(state.cardDurations)))
            .put("removedCards", JSONArray(gson.toJson(state.removedCards)))
            .put("locations", JSONArray(gson.toJson(state.locations)))
            .put("eventTypes", JSONArray(gson.toJson(state.eventTypes)))
            .put("reactionCards", JSONArray(gson.toJson(state.reactionCards ?: emptyList<ReactionCardEntry>())))
            .put("customRoles", JSONArray(gson.toJson(state.customRoles ?: emptyList<CustomRole>())))
            .put("eventRolePerms", JSONObject(gson.toJson(authorization.ensureEventRolePerms())))
            .put("boards", JSONArray(gson.toJson(visibleBoards)))
            .put("channels", JSONArray(gson.toJson(visibleChannels)))
            .put("events", run {
                val arr = JSONArray(gson.toJson(visibleEvents))
                for (stub in pinnedEventStubs) arr.put(stub)
                for (stub in pinnedPeopleStubs) arr.put(stub)
                arr
            })
            .put("availabilities", JSONArray(gson.toJson(
                state.availabilities.filter { it.channelId in visibleChannelIds }
            )))
            .put("timeBlocks", JSONArray(gson.toJson(
                state.timeBlocks.filter { it.channelId in visibleChannelIds }
            )))
            .put("messages", JSONObject(gson.toJson(visibleMessages)))
            .put("members", membersPayload())
            .put("online", JSONArray(gson.toJson(onlineIds)))
            .put("pending", if (authorization.canManageServer(user)) JSONArray(gson.toJson(pendingList)) else JSONArray())
            .put("invite", if (authorization.canManageServer(user)) {
                val (code, exp) = operations.currentInvite()
                JSONObject().put("code", code).put("expiry", exp)
            } else JSONObject.NULL)
            .put("groupInvites", if (authorization.canInviteToGroup(user)) membershipService.groupInvitesPayload(user) else JSONArray())
            .put("autoIncludeChannels", if (authorization.canInviteToGroup(user)) membershipService.autoIncludeChannelsPayload() else JSONArray())
            .put("shareLan", run {
                val lan = operations.shareLanUrl()
                if (lan.isEmpty()) JSONObject.NULL else lan
            })
            .put("sharePublic", run {
                val pub = operations.sharePublicUrl()
                if (pub.isEmpty()) JSONObject.NULL else pub
            })
            .put("isPublic", operations.hostIsPublic())
            .put("reachMode", operations.reachMode())
            .put("hotspotActive", operations.hotspotSsid().isNotEmpty())
            .put("hotspotSsid", run {
                val s = operations.hotspotSsid()
                if (s.isEmpty()) JSONObject.NULL else s
            })
            .put("hotspotPassword", run {
                val p = operations.hotspotPassword()
                if (p.isEmpty()) JSONObject.NULL else p
            })
            .put("serverSettings", operations.serverSettingsPayload())
            .put("notifications", JSONArray(gson.toJson(state.notifications[user.id] ?: emptyList<Notification>())))
            .put("reports", if (authorization.canModerateEvents(user)) moderationService.reportsPayload() else JSONArray())
            .put("blocked", JSONArray(gson.toJson(user.blockedUserIds ?: emptyList<String>())))
            .put("serverActivity", membershipService.serverActivityPayload())
    }

    /**
     * Welcome-shaped relay blob for Worker KV: open (non-allow-listed) channels
     * only, no tokens / invite codes / pending / per-user secrets.
     */
    fun relaySnapshot(): JSONObject {
        val onlineIds = operations.onlineUserIds()
        val openChannels = state.channels.filter { channel ->
            channel.allowedUserIds == null
        }
        val openIds = openChannels.map { it.id }.toSet()
        val openBoardIds = openChannels.mapNotNull { it.boardId }.toSet()
        val openBoards = state.boards.filter { it.id in openBoardIds && it.allowedUserIds == null }
        val visibleEvents = state.events.filter { it.channelId in openIds }
        val pinnedEventStubs = pinnedLocationEventStubs(openChannels, openIds)
        val pinnedPeopleStubs = pinnedPeopleEventStubs(openChannels, openIds)
        val visibleMessages = state.messages.filterKeys { it in openIds }
        val stubUser = JSONObject()
            .put("id", "")
            .put("name", "")
            .put("isHost", false)
            .put("role", "user")
        return JSONObject()
            .put("type", "welcome")
            .put("relay", true)
            .put("user", stubUser)
            .put("hostName", state.hostName)
            .put("iconText", state.iconText)
            .put("serverPic", state.serverPic ?: JSONObject.NULL)
            .put("joinTag", operations.registryJoinTag().takeIf { it.isNotEmpty() } ?: JSONObject.NULL)
            .put("e2eSalt", state.e2eSalt)
            .put("categories", JSONArray(gson.toJson(state.categories)))
            .put("cardCats", JSONObject(gson.toJson(state.cardCats)))
            .put("cardDurations", JSONObject(gson.toJson(state.cardDurations)))
            .put("removedCards", JSONArray(gson.toJson(state.removedCards)))
            .put("locations", JSONArray(gson.toJson(state.locations)))
            .put("eventTypes", JSONArray(gson.toJson(state.eventTypes)))
            .put("reactionCards", JSONArray(gson.toJson(state.reactionCards ?: emptyList<ReactionCardEntry>())))
            .put("customRoles", JSONArray(gson.toJson(state.customRoles ?: emptyList<CustomRole>())))
            .put("eventRolePerms", JSONObject(gson.toJson(authorization.ensureEventRolePerms())))
            .put("boards", JSONArray(gson.toJson(openBoards)))
            .put("channels", JSONArray(gson.toJson(openChannels)))
            .put("events", run {
                val arr = JSONArray(gson.toJson(visibleEvents))
                for (stub in pinnedEventStubs) arr.put(stub)
                for (stub in pinnedPeopleStubs) arr.put(stub)
                arr
            })
            .put("availabilities", JSONArray(gson.toJson(
                state.availabilities.filter { it.channelId in openIds }
            )))
            .put("timeBlocks", JSONArray(gson.toJson(
                state.timeBlocks.filter { it.channelId in openIds }
            )))
            .put("messages", JSONObject(gson.toJson(visibleMessages)))
            .put("members", membersPayload(includeLivePics = false))
            .put("online", JSONArray(gson.toJson(onlineIds)))
            .put("pending", JSONArray())
            .put("invite", JSONObject.NULL)
            .put("groupInvites", JSONArray())
            .put("autoIncludeChannels", JSONArray())
            .put("shareLan", JSONObject.NULL)
            .put("sharePublic", run {
                val pub = operations.sharePublicUrl()
                if (pub.isEmpty()) JSONObject.NULL else pub
            })
            .put("isPublic", operations.hostIsPublic())
            .put("reachMode", operations.reachMode())
            .put("hotspotActive", false)
            .put("hotspotSsid", JSONObject.NULL)
            .put("hotspotPassword", JSONObject.NULL)
            .put("serverSettings", operations.serverSettingsPayload())
            .put("notifications", JSONArray())
            .put("reports", JSONArray())
            .put("blocked", JSONArray())
            .put("serverActivity", JSONArray())
    }
}
