package app.phlip.server

import org.json.JSONArray
import org.json.JSONObject

/**
 * Channel (chat board / event board) content type.
 *
 * **Store:** [AppState.channels]. Event channels may cascade-delete events
 * and availabilities via
 * [CollaborationCommandService.Operations.purgeEventFromHost]. Chat channels
 * drop [AppState.messages] for that id and clear linked-chat pointers on event
 * channels. Pinned location/people channels are aggregation views (fields on
 * [Channel]), not separate stores.
 *
 * **User → host:** RPC `createChannel`, `updateChannel`, `reorderChannels`,
 * `deleteChannel`, `deleteChannelsBulk`, `deleteEventsBulk`.
 *
 * **Host → users:** [CollaborationCommandService.Operations.pushSyncToAll]
 * (filtered `sync` snapshot); bulk event delete also broadcasts `eventsDeleted`
 * on the channel.
 */
internal class ChannelHandler(
    private val s: CollaborationCommandSupport,
) {
    fun cmdCreateChannel(user: User, m: JSONObject) {
        if (!s.authorization.canManageServer(user)) return
        if (s.state.channels.size >= MAX_CHANNELS) return
        val kind = if (m.optString("kind") == "event") "event" else "chat"
        val rawName = m.optString("name").trim().take(32).ifEmpty { return }
        val name = if (kind == "chat") rawName.replace(Regex("\\s+"), " ").trim() else rawName
        val pinnedLocationLabel = if (kind == "event") {
            m.optString("pinnedLocationLabel").trim().ifEmpty { null }
                ?.takeIf { label -> s.state.locations.any { it.label == label } }
        } else null
        val rawPinnedUserId = if (kind == "event" && pinnedLocationLabel == null) {
            m.optString("pinnedUserId").trim().ifEmpty { null }
        } else null
        if (rawPinnedUserId != null) {
            if (!s.state.allowPinnedPeople) return
            if (s.state.users.values.none { it.id == rawPinnedUserId }) return
            if (s.state.channels.any { it.kind == "event" && it.pinnedUserId == rawPinnedUserId }) return
        }
        val pinnedUserId = rawPinnedUserId
        val welcomeChannel = kind == "chat" && m.optBoolean("welcomeChannel", false)
        val isPinned = pinnedLocationLabel != null || pinnedUserId != null
        val boardIdRaw = m.optString("boardId").trim().ifEmpty { null }
        val board = boardIdRaw?.let { id -> s.state.boards.find { it.id == id } }
        if (!isPinned && !welcomeChannel) {
            if (board == null) return
            val exists = s.state.channels.any {
                it.boardId == board.id && it.kind == kind && !isPinnedChannel(it) && !isWelcomeLobby(it)
            }
            if (exists) return
        } else if (board != null) {
            return
        }
        var allowed = s.jsonStringList(m.optJSONArray("allowedUserIds"))
        var autoInclude = allowed != null && m.optBoolean("autoIncludeNewMembers", false)
        var rolePerms = when {
            m.has("rolePerms") -> parseViewOnlyRolePermsMap(m.optJSONObject("rolePerms"))
                ?: if (kind == "event") {
                    viewOnlyRolePerms(s.authorization.ensureEventRolePerms())
                } else {
                    viewOnlyRolePerms(
                        seedEventChannelRolePerms(
                            normalizeChannelMinRole(m.optString("minRole")),
                            s.authorization.effectiveCreateEvents(),
                        )
                    )
                }
            kind == "event" -> viewOnlyRolePerms(s.authorization.ensureEventRolePerms())
            else -> viewOnlyRolePerms(
                seedEventChannelRolePerms(
                    normalizeChannelMinRole(m.optString("minRole")),
                    s.authorization.effectiveCreateEvents(),
                )
            )
        }
        if (board != null) {
            allowed = copyAllowList(board.allowedUserIds)
            autoInclude = board.autoIncludeNewMembers && allowed != null
            rolePerms = copyViewPerms(board.rolePerms) ?: rolePerms
        } else if (kind == "event" && !isPinned) {
            if (!m.has("allowedUserIds")) allowed = null
            else if (allowed != null && user.id !in allowed) allowed.add(0, user.id)
        } else if (!m.has("allowedUserIds")) {
            allowed = mutableListOf(user.id)
        } else if (allowed != null && user.id !in allowed) {
            allowed.add(0, user.id)
        }
        val cards = if (kind == "event") s.jsonStringList(m.optJSONArray("enabledCardIds")) else null
        val cats = if (kind == "event") s.jsonStringList(m.optJSONArray("enabledCategoryIds")) else null
        val locs = if (pinnedLocationLabel != null) mutableListOf(pinnedLocationLabel)
            else if (kind == "event") s.jsonStringList(m.optJSONArray("enabledLocations")) else null
        val linkedChat = if (kind == "event" && board != null) {
            chatChannelForBoard(s.state, board.id)?.id
        } else if (kind == "event") {
            m.optString("linkedChatChannelId").ifEmpty { null }
                ?.takeIf { id -> s.state.channels.any { it.id == id && it.kind == "chat" } }
        } else null
        val mirrorActivity = kind == "event" && linkedChat != null && m.optBoolean("mirrorActivity", false)
        val minRole = null
        val allowAvailability = kind == "event"
            && pinnedLocationLabel == null
            && pinnedUserId == null
            && m.optBoolean("allowAvailability", false)
        val icon = if (m.has("icon")) clampIcon(m.optString("icon")) else null
        if (welcomeChannel) clearOtherWelcomeChannels()
        val chName = board?.name ?: name
        s.state.channels.add(Channel(
            s.idGenerator(), chName, kind, allowed, cards, linkedChat, cats, locs, mirrorActivity,
            autoIncludeNewMembers = autoInclude,
            minRole = minRole,
            rolePerms = rolePerms,
            pinnedLocationLabel = pinnedLocationLabel,
            pinnedUserId = pinnedUserId,
            allowAvailability = allowAvailability,
            icon = icon,
            welcomeChannel = welcomeChannel,
            boardId = board?.id,
        ))
        if (board != null) applyBoardVisibility(s.state, board)
        s.operations.save()
        s.operations.pushSyncToAll()
    }

    fun cmdUpdateChannel(user: User, m: JSONObject) {
        val ch = s.state.channels.find { it.id == m.optString("channelId") } ?: return
        if (!s.authorization.canManageServer(user)) {
            if (!s.authorization.canInviteToGroup(user) || !m.has("allowedUserIds")) return
            val otherKeys = m.keys().asSequence().filter {
                it != "type" && it != "channelId" && it != "allowedUserIds"
            }.toList()
            if (otherKeys.isNotEmpty()) return
            val next = s.jsonStringList(m.optJSONArray("allowedUserIds")) ?: return
            val prev = ch.allowedUserIds ?: return
            if (!next.containsAll(prev)) return
            if (!s.authorization.channelVisible(ch, user)) return
            ch.allowedUserIds = next
            val board = s.state.boards.find { it.id == ch.boardId }
            if (board != null) {
                board.allowedUserIds = copyAllowList(next)
                applyBoardVisibility(s.state, board)
            }
            s.operations.save()
            s.operations.pushSyncToAll()
            return
        }
        m.optString("name").trim().take(32).ifEmpty { null }?.let {
            val next = if (ch.kind == "chat") it.replace(Regex("\\s+"), " ").trim() else it
            val board = s.state.boards.find { b -> b.id == ch.boardId }
            if (board != null) {
                board.name = next
                applyBoardVisibility(s.state, board)
            } else {
                ch.name = next
            }
        }
        val board = s.state.boards.find { b -> b.id == ch.boardId }
        if (board != null && (m.has("allowedUserIds") || m.has("autoIncludeNewMembers") || m.has("rolePerms"))) {
            if (m.has("allowedUserIds")) board.allowedUserIds = s.jsonStringList(m.optJSONArray("allowedUserIds"))
            if (m.has("autoIncludeNewMembers")) {
                board.autoIncludeNewMembers = board.allowedUserIds != null && m.optBoolean("autoIncludeNewMembers", false)
            } else if (board.allowedUserIds == null) board.autoIncludeNewMembers = false
            if (m.has("rolePerms")) {
                val parsed = parseViewOnlyRolePermsMap(m.optJSONObject("rolePerms"))
                if (parsed != null) {
                    val known = (s.state.customRoles ?: emptyList()).map { it.id }.toHashSet()
                    val cleaned = linkedMapOf<String, RolePermFlags>()
                    for ((key, flags) in parsed) {
                        if (key in CHANNEL_MATRIX_FIXED_KEYS || key == ROLE_ADMIN || key in known) {
                            cleaned[key] = RolePermFlags(view = flags.view)
                        }
                    }
                    for (fixed in CHANNEL_MATRIX_FIXED_KEYS) {
                        if (fixed !in cleaned) cleaned[fixed] = emptyRolePermFlags()
                    }
                    board.rolePerms = cleaned
                }
            }
            applyBoardVisibility(s.state, board)
        } else {
            if (m.has("allowedUserIds")) ch.allowedUserIds = s.jsonStringList(m.optJSONArray("allowedUserIds"))
            if (m.has("autoIncludeNewMembers")) {
                ch.autoIncludeNewMembers = ch.allowedUserIds != null && m.optBoolean("autoIncludeNewMembers", false)
            } else if (ch.allowedUserIds == null) ch.autoIncludeNewMembers = false
            if (ch.kind == "chat" && m.has("minRole") && !m.has("rolePerms")) {
                ch.minRole = normalizeChannelMinRole(m.optString("minRole"))
            }
            if (m.has("rolePerms") && (ch.kind == "event" || ch.kind == "chat")) {
                val parsed = parseViewOnlyRolePermsMap(m.optJSONObject("rolePerms"))
                if (parsed != null) {
                    val known = (s.state.customRoles ?: emptyList()).map { it.id }.toHashSet()
                    val cleaned = linkedMapOf<String, RolePermFlags>()
                    for ((key, flags) in parsed) {
                        if (key in CHANNEL_MATRIX_FIXED_KEYS || key == ROLE_ADMIN || key in known) {
                            cleaned[key] = RolePermFlags(view = flags.view)
                        }
                    }
                    for (fixed in CHANNEL_MATRIX_FIXED_KEYS) {
                        if (fixed !in cleaned) cleaned[fixed] = emptyRolePermFlags()
                    }
                    ch.rolePerms = cleaned
                    if (ch.kind == "chat") ch.minRole = null
                }
            }
        }
        if (ch.kind == "event" && m.has("enabledCardIds")) ch.enabledCardIds = s.jsonStringList(m.optJSONArray("enabledCardIds"))
        if (ch.kind == "event" && m.has("enabledCategoryIds")) ch.enabledCategoryIds = s.jsonStringList(m.optJSONArray("enabledCategoryIds"))
        // Pinned channels keep their single-location lock forever (it defines the aggregation query).
        if (ch.kind == "event" && m.has("enabledLocations") && ch.pinnedLocationLabel == null) {
            ch.enabledLocations = s.jsonStringList(m.optJSONArray("enabledLocations"))
        }
        if (ch.kind == "event" && m.has("linkedChatChannelId")) {
            val sibling = ch.boardId?.let { chatChannelForBoard(s.state, it)?.id }
            ch.linkedChatChannelId = sibling
                ?: m.optString("linkedChatChannelId").ifEmpty { null }
                    ?.takeIf { id -> s.state.channels.any { it.id == id && it.kind == "chat" } }
        }
        if (ch.kind == "event" && m.has("mirrorActivity")) {
            ch.mirrorActivity = ch.linkedChatChannelId != null && m.optBoolean("mirrorActivity", false)
        } else if (ch.kind == "event" && ch.linkedChatChannelId == null) ch.mirrorActivity = false
        if (ch.kind == "event" && m.has("allowAvailability")) {
            ch.allowAvailability = ch.pinnedLocationLabel == null
                && ch.pinnedUserId == null
                && m.optBoolean("allowAvailability", false)
        }
        if (m.has("icon")) {
            val raw = m.optString("icon")
            ch.icon = if (raw.isBlank()) null else clampIcon(raw)
        }
        if (ch.kind == "chat" && m.has("welcomeChannel")) {
            val on = m.optBoolean("welcomeChannel", false)
            if (on) clearOtherWelcomeChannels(except = ch)
            ch.welcomeChannel = on
        } else if (ch.kind != "chat") {
            ch.welcomeChannel = false
        }
        s.operations.save()
        s.operations.pushSyncToAll()
    }

    private fun clearOtherWelcomeChannels(except: Channel? = null) {
        for (other in s.state.channels) {
            if (other === except) continue
            if (other.kind == "chat" && other.welcomeChannel) other.welcomeChannel = false
        }
    }

    fun cmdReorderChannels(user: User, m: JSONObject) {
        if (!s.authorization.canManageServer(user)) return
        val ids = s.jsonStringList(m.optJSONArray("channelIds")) ?: return
        if (!applyListOrderByIds(s.state.channels, ids) { it.id }) return
        s.operations.save()
        s.operations.pushSyncToAll()
    }

    fun cmdDeleteChannel(user: User, m: JSONObject) {
        if (!s.authorization.canManageServer(user)) return
        val id = m.optString("channelId").trim()
        val ch = s.state.channels.find { it.id == id } ?: return
        if (!ch.boardId.isNullOrBlank()) return
        if (!purgeChannelById(id)) return
        s.operations.save()
        s.operations.pushSyncToAll()
    }

    fun cmdDeleteChannelsBulk(user: User, m: JSONObject) {
        if (!s.authorization.canManageServer(user)) return
        val ids = s.jsonStringList(m.optJSONArray("channelIds"))?.distinct().orEmpty()
        if (ids.isEmpty()) return
        var any = false
        for (id in ids) {
            val ch = s.state.channels.find { it.id == id } ?: continue
            if (!ch.boardId.isNullOrBlank()) continue
            if (purgeChannelById(id)) any = true
        }
        if (!any) return
        s.operations.save()
        s.operations.pushSyncToAll()
    }

    fun cmdDeleteEventsBulk(user: User, m: JSONObject) {
        if (!s.authorization.canModerateEvents(user)) return
        val channel = s.state.channels.find { it.id == m.optString("channelId") } ?: return
        if (!s.authorization.channelVisible(channel, user)) return
        val ids = s.jsonStringList(m.optJSONArray("eventIds"))?.toSet() ?: return
        if (ids.isEmpty()) return
        val toRemove = s.state.events.filter { it.id in ids && it.channelId == channel.id }
        if (toRemove.isEmpty()) return
        val purged = mutableListOf<String>()
        for (event in toRemove.toList()) {
            if (s.state.events.any { it.id == event.id }) {
                purged.addAll(s.operations.purgeEventFromHost(event.id, false, false))
            }
        }
        if (purged.isEmpty()) return
        s.operations.save()
        s.operations.broadcastToChannel(channel, JSONObject().put("type", "eventsDeleted")
            .put("channelId", channel.id)
            .put("eventIds", JSONArray(purged.distinct())))
    }

    fun cmdCreateBoard(user: User, m: JSONObject) {
        if (!s.authorization.canManageServer(user)) return
        if (s.state.boards.size >= MAX_BOARDS) return
        if (s.state.channels.size + 2 > MAX_CHANNELS) return
        val name = m.optString("name").trim().take(32).ifEmpty { return }
        var allowed = if (m.has("allowedUserIds") && m.isNull("allowedUserIds")) {
            null
        } else {
            s.jsonStringList(m.optJSONArray("allowedUserIds"))
        }
        if (!m.has("allowedUserIds")) allowed = mutableListOf(user.id)
        else if (allowed != null && user.id !in allowed) allowed.add(0, user.id)
        val autoInclude = allowed != null && m.optBoolean("autoIncludeNewMembers", false)
        val rolePerms = parseViewOnlyRolePermsMap(m.optJSONObject("rolePerms"))
            ?: viewOnlyRolePerms(s.authorization.ensureEventRolePerms())
        val icon = if (m.has("icon")) clampIcon(m.optString("icon")) else null
        val board = Board(
            id = s.idGenerator(),
            name = name,
            icon = icon,
            shownKind = normalizeBoardShownKind(m.optString("shownKind")),
            allowedUserIds = allowed,
            autoIncludeNewMembers = autoInclude,
            rolePerms = rolePerms,
        )
        s.state.boards.add(board)
        val chat = newBoardChild(s.idGenerator(), board, "chat")
        val event = newBoardChild(s.idGenerator(), board, "event", linkedChatId = chat.id)
        event.allowAvailability = m.optBoolean("allowAvailability", false)
        event.mirrorActivity = m.optBoolean("mirrorActivity", false)
        s.state.channels.add(event)
        s.state.channels.add(chat)
        applyBoardVisibility(s.state, board)
        orderChannelsToBoards(s.state)
        s.operations.save()
        s.operations.pushSyncToAll()
    }

    fun cmdUpdateBoard(user: User, m: JSONObject) {
        if (!s.authorization.canManageServer(user)) {
            if (!s.authorization.canInviteToGroup(user) || !m.has("allowedUserIds")) return
            val otherKeys = m.keys().asSequence().filter {
                it != "type" && it != "boardId" && it != "allowedUserIds"
            }.toList()
            if (otherKeys.isNotEmpty()) return
            val board = s.state.boards.find { it.id == m.optString("boardId") } ?: return
            val next = s.jsonStringList(m.optJSONArray("allowedUserIds")) ?: return
            val prev = board.allowedUserIds ?: return
            if (!next.containsAll(prev)) return
            val event = eventChannelForBoard(s.state, board.id) ?: return
            if (!s.authorization.channelVisible(event, user)) return
            board.allowedUserIds = next
            applyBoardVisibility(s.state, board)
            s.operations.save()
            s.operations.pushSyncToAll()
            return
        }
        val board = s.state.boards.find { it.id == m.optString("boardId") } ?: return
        m.optString("name").trim().take(32).ifEmpty { null }?.let { board.name = it }
        if (m.has("icon")) {
            val raw = m.optString("icon")
            board.icon = if (raw.isBlank()) null else clampIcon(raw)
        }
        if (m.has("hiddenKinds")) {
            applyBoardHiddenKinds(board, s.jsonStringList(m.optJSONArray("hiddenKinds")))
        }
        if (m.has("shownKind")) {
            val next = normalizeBoardShownKind(m.optString("shownKind"))
            board.shownKind = if (next in boardHiddenKinds(board)) firstVisibleBoardKind(board) else next
        }
        if (m.has("allowedUserIds")) {
            board.allowedUserIds = if (m.isNull("allowedUserIds")) null
            else s.jsonStringList(m.optJSONArray("allowedUserIds"))
        }
        if (m.has("autoIncludeNewMembers")) {
            board.autoIncludeNewMembers = board.allowedUserIds != null && m.optBoolean("autoIncludeNewMembers", false)
        } else if (board.allowedUserIds == null) {
            board.autoIncludeNewMembers = false
        }
        if (m.has("rolePerms")) {
            val parsed = parseViewOnlyRolePermsMap(m.optJSONObject("rolePerms"))
            if (parsed != null) {
                val known = (s.state.customRoles ?: emptyList()).map { it.id }.toHashSet()
                val cleaned = linkedMapOf<String, RolePermFlags>()
                for ((key, flags) in parsed) {
                    if (key in CHANNEL_MATRIX_FIXED_KEYS || key == ROLE_ADMIN || key in known) {
                        cleaned[key] = RolePermFlags(view = flags.view)
                    }
                }
                for (fixed in CHANNEL_MATRIX_FIXED_KEYS) {
                    if (fixed !in cleaned) cleaned[fixed] = emptyRolePermFlags()
                }
                board.rolePerms = cleaned
            }
        }
        applyBoardVisibility(s.state, board)
        if (m.has("mirrorActivity") || m.has("allowAvailability")) {
            val event = eventChannelForBoard(s.state, board.id)
            if (event != null) {
                if (m.has("mirrorActivity")) {
                    event.mirrorActivity = event.linkedChatChannelId != null && m.optBoolean("mirrorActivity", false)
                }
                if (m.has("allowAvailability")) {
                    event.allowAvailability = m.optBoolean("allowAvailability", false)
                }
            }
        }
        s.operations.save()
        s.operations.pushSyncToAll()
    }

    fun cmdDeleteBoard(user: User, m: JSONObject) {
        if (!s.authorization.canManageServer(user)) return
        val id = m.optString("boardId").trim()
        if (id.isEmpty()) return
        val idx = s.state.boards.indexOfFirst { it.id == id }
        if (idx < 0) return
        val childIds = boardChildren(s.state, id).map { it.id }
        s.state.boards.removeAt(idx)
        for (cid in childIds) purgeChannelById(cid)
        s.operations.save()
        s.operations.pushSyncToAll()
    }

    fun cmdReorderBoards(user: User, m: JSONObject) {
        if (!s.authorization.canManageServer(user)) return
        val ids = s.jsonStringList(m.optJSONArray("boardIds")) ?: return
        if (!applyListOrderByIds(s.state.boards, ids) { it.id }) {
            // Still rewrite channel order if boards didn't move? no-op
        }
        orderChannelsToBoards(s.state)
        s.operations.save()
        s.operations.pushSyncToAll()
    }

    /** Remove one channel and its server-side content. */
    fun purgeChannelById(channelId: String): Boolean {
        val idx = s.state.channels.indexOfFirst { it.id == channelId }
        if (idx < 0) return false
        val channel = s.state.channels.removeAt(idx)
        if (channel.kind == "event") {
            val eventIds = s.state.events.filter { it.channelId == channel.id }.map { it.id }
            for (id in eventIds) {
                if (s.state.events.any { it.id == id }) s.operations.purgeEventFromHost(id, false, false)
            }
            s.state.availabilities.removeAll { it.channelId == channel.id }
            s.state.timeBlocks.removeAll { it.channelId == channel.id }
        } else {
            s.state.messages.remove(channel.id)
            for (other in s.state.channels) if (other.linkedChatChannelId == channel.id) {
                other.linkedChatChannelId = null
                other.mirrorActivity = false
            }
        }
        return true
    }
}
