package app.phlip.server

import com.google.gson.Gson
import org.json.JSONArray
import org.json.JSONObject

/**
 * Setup-guide presets: permission floors, type/location packs, and channel seeds.
 */
internal class SetupPresetService(
    private val stateProvider: () -> AppState,
    private val gson: Gson,
    private val authorization: ServerAuthorization,
    private val operations: Operations,
) {
    internal data class Operations(
        val save: () -> Unit,
        val genId: () -> String,
        val broadcast: (JSONObject) -> Unit,
        val pushSyncToAll: () -> Unit,
        val purgeEventFromHost: (String, Boolean, Boolean) -> List<String>,
        val serverSettingsPayload: () -> JSONObject,
        val defaultRoleForNewMembers: () -> String,
        val effectiveCreateEvents: () -> String,
        val sendToUser: (User, JSONObject) -> Unit,
        val canManageServer: (User) -> Boolean,
    )

    private val state get() = stateProvider()

    fun applySetupPreset(
        presetRaw: String,
        activityRaw: String? = null,
        replaceTypes: Boolean = true,
        replaceLocations: Boolean = true,
    ): JSONObject {
        val preset = normalizeSetupPreset(presetRaw)
        val activity = activityRaw?.trim()?.take(40)?.ifEmpty { null }
        val before = presetSummary()
        state.setupPreset = preset
        state.setupActivity = if (preset == PRESET_CLUB || preset == PRESET_BUSINESS) activity else null

        when (preset) {
            PRESET_CLUB -> {
                state.defaultRole = ROLE_VIEWER
                state.allowUserCreateEvents = false
                state.createEvents = PERM_MODERATOR
                state.createEventTypes = PERM_MODERATOR
                state.addLocations = PERM_ADMIN
                state.inviteToGroup = PERM_ADMIN
                state.allowFreeform = false
                state.offerAutoInclude = true
                // Courts/pitches (e.g. tennis) get multi-location on; a community
                // group with no fixed venue leaves it off.
                state.allowMultiLocations = clubHasMultiLocationVenues(activity)
            }
            PRESET_CIRCLES -> {
                state.defaultRole = ROLE_USER
                state.allowUserCreateEvents = true
                state.createEvents = PERM_EVERYONE
                state.createEventTypes = PERM_MODERATOR
                state.addLocations = PERM_MODERATOR
                state.inviteToGroup = PERM_ADMIN
                state.allowFreeform = true
                state.offerAutoInclude = false
            }
            PRESET_FAMILY -> {
                state.defaultRole = ROLE_USER
                state.allowUserCreateEvents = true
                state.createEvents = PERM_EVERYONE
                state.createEventTypes = PERM_EVERYONE
                state.addLocations = PERM_EVERYONE
                state.inviteToGroup = PERM_ADMIN
                state.allowFreeform = true
                state.offerAutoInclude = true
                // The headline feature: lets you add a board that follows one
                // person's plans, once there's more than one of you to follow.
                state.allowPinnedPeople = true
            }
            PRESET_BUSINESS -> {
                state.defaultRole = ROLE_VIEWER
                state.allowUserCreateEvents = false
                state.createEvents = PERM_ADMIN
                state.createEventTypes = PERM_ADMIN
                state.addLocations = PERM_ADMIN
                state.inviteToGroup = PERM_ADMIN
                state.allowFreeform = false
                state.offerAutoInclude = true
            }
            PRESET_SCRATCH -> {
                state.defaultRole = ROLE_USER
                state.allowUserCreateEvents = true
                state.createEvents = PERM_EVERYONE
                state.createEventTypes = PERM_MODERATOR
                state.addLocations = PERM_MODERATOR
                state.inviteToGroup = PERM_ADMIN
                state.allowFreeform = true
                state.offerAutoInclude = true
            }
            else -> {
                state.defaultRole = ROLE_USER
                state.allowUserCreateEvents = true
                state.createEvents = PERM_EVERYONE
                state.createEventTypes = PERM_EVERYONE
                state.addLocations = PERM_EVERYONE
                state.inviteToGroup = PERM_ADMIN
                state.allowFreeform = true
                state.offerAutoInclude = true
            }
        }

        seedPresetChannels(preset, activity)

        if (replaceTypes) {
            val usedIds = state.events.mapNotNull { it.typeId }.toSet()
            val keep = state.eventTypes.filter { it.id in usedIds }
            val pack = eventTypesForPreset(preset, activity)
            val keepIds = keep.map { it.id }.toSet()
            val merged = keep.toMutableList()
            for (t in pack) {
                if (t.id in keepIds) {
                    val i = merged.indexOfFirst { it.id == t.id }
                    if (i >= 0) {
                        merged[i] = t.copy()
                    }
                } else {
                    merged.add(t)
                }
            }
            merged.forEachIndexed { i, t -> t.order = i }
            state.eventTypes = merged
            state.cardCats = linkedMapOf<String, String>().also { m ->
                for (t in state.eventTypes) {
                    val cat = t.categoryId ?: continue
                    m[t.name] = cat
                }
            }.toMutableMap()
            state.cardDurations = linkedMapOf<String, String>().also { m ->
                for (t in state.eventTypes) {
                    val d = t.defaultDuration ?: continue
                    m[t.name] = d
                }
            }.toMutableMap()
        }

        if (replaceLocations && state.events.isEmpty()) {
            state.locations = locationsForPreset(preset, activity)
        } else if (replaceLocations) {
            val have = state.locations.map { it.label.lowercase() }.toHashSet()
            for (loc in locationsForPreset(preset, activity)) {
                if (loc.label.lowercase() !in have) {
                    state.locations.add(loc)
                    have.add(loc.label.lowercase())
                }
            }
        }

        operations.save()
        val after = presetSummary()
        val msg = JSONObject()
            .put("type", "setupPresetApplied")
            .put("preset", preset)
            .put("activity", activity ?: JSONObject.NULL)
            .put("before", before)
            .put("after", after)
            .put("serverSettings", operations.serverSettingsPayload())
            .put("eventTypes", JSONArray(gson.toJson(state.eventTypes)))
            .put("locations", JSONArray(gson.toJson(state.locations)))
        operations.broadcast(msg)
        operations.pushSyncToAll()
        return msg
    }

    fun softRenameBoard(from: String, to: String, inviteOnly: Boolean = false) {
        val board = state.boards.find { it.name.equals(from, ignoreCase = true) } ?: return
        if (state.boards.any { it.name.equals(to, ignoreCase = true) && it.id != board.id }) return
        board.name = to
        if (inviteOnly) {
            board.autoIncludeNewMembers = false
            if (board.allowedUserIds == null) board.allowedUserIds = mutableListOf()
        }
        applyBoardVisibility(state, board)
    }

    fun removeStockBoard(name: String) {
        val board = state.boards.find { it.name.equals(name, ignoreCase = true) } ?: return
        val childIds = boardChildren(state, board.id).map { it.id }
        state.boards.removeAll { it.id == board.id }
        for (id in childIds) {
            val idx = state.channels.indexOfFirst { it.id == id }
            if (idx < 0) continue
            val ch = state.channels.removeAt(idx)
            if (ch.kind == "event") {
                val evIds = state.events.filter { it.channelId == ch.id }.map { it.id }
                for (eid in evIds) {
                    if (state.events.any { it.id == eid }) {
                        operations.purgeEventFromHost(eid, false, false)
                    }
                }
            } else {
                state.messages.remove(ch.id)
            }
        }
    }

    fun removeStockChannel(name: String, kind: String) {
        val idx = state.channels.indexOfFirst {
            it.kind == kind && it.name.equals(name, ignoreCase = true)
        }
        if (idx < 0) return
        val ch = state.channels.removeAt(idx)
        if (ch.kind == "event") {
            val evIds = state.events.filter { it.channelId == ch.id }.map { it.id }
            for (id in evIds) {
                if (state.events.any { it.id == id }) {
                    operations.purgeEventFromHost(id, false, false)
                }
            }
        } else {
            state.messages.remove(ch.id)
            for (other in state.channels) if (other.linkedChatChannelId == ch.id) {
                other.linkedChatChannelId = null
                other.mirrorActivity = false
            }
        }
    }

    fun seedPresetChannels(preset: String, activity: String?) {
        val seeds = boardSeedsForPreset(preset, activity)
        val memberIds = state.users.values.map { it.id }
        val hostIds = state.users.values.filter { it.isHost }.map { it.id }
        val p = normalizeSetupPreset(preset)

        ensureWelcomeLobby(hostIds)

        val firstBoard = seeds.firstOrNull()
        if (p != PRESET_CLUB &&
            firstBoard != null && !firstBoard.name.equals("Events", ignoreCase = true)
        ) {
            if (state.boards.size == 1 &&
                state.boards[0].name.equals("Events", ignoreCase = true) &&
                state.boards.none { it.name.equals(firstBoard.name, ignoreCase = true) }
            ) {
                state.boards[0].name = firstBoard.name
                applyBoardVisibility(state, state.boards[0])
            }
        }
        when (p) {
            PRESET_FRIEND -> softRenameBoard("Weekends", "London based", inviteOnly = true)
            PRESET_CLUB -> {
                softRenameBoard("Events", "Open-invite")
                softRenameBoard("Juniors", "Open-invite")
                softRenameBoard("Weekends", "Socials", inviteOnly = true)
                softRenameBoard("Committee plans", "Socials", inviteOnly = true)
                removeStockBoard("The crew")
                removeStockChannel("The crew", "chat")
            }
            PRESET_CIRCLES -> {
                softRenameBoard("Work plans", "Work")
                softRenameBoard("Home plans", "Home")
                softRenameBoard("Friends plans", "Friends")
            }
        }

        for (seed in seeds) {
            val vis = viewOnlyRolePerms(
                seedEventChannelRolePerms(
                    normalizeChannelMinRole(seed.minRole),
                    authorization.effectiveCreateEvents(),
                )
            ).also { visMap ->
                val floor = normalizeChannelMinRole(seed.minRole)
                if (floor != null) {
                    for (key in CHANNEL_MATRIX_FIXED_KEYS) {
                        val row = visMap[key] ?: emptyRolePermFlags()
                        row.view = roleRank(key) >= roleRank(floor)
                        visMap[key] = row
                    }
                }
            }
            val allow = if (seed.open) null else {
                (if (seed.autoInclude) memberIds else hostIds).toMutableList()
            }
            var board = state.boards.find { it.name.equals(seed.name, ignoreCase = true) }
            if (board == null) {
                board = Board(
                    id = operations.genId(),
                    name = seed.name,
                    allowedUserIds = allow,
                    autoIncludeNewMembers = !seed.open && seed.autoInclude,
                    rolePerms = vis,
                )
                state.boards.add(board)
                val chat = newBoardChild(operations.genId(), board, "chat")
                val event = newBoardChild(operations.genId(), board, "event", linkedChatId = chat.id)
                state.channels.add(event)
                state.channels.add(chat)
            } else {
                board.allowedUserIds = allow
                board.autoIncludeNewMembers = !seed.open && seed.autoInclude
                board.rolePerms = vis
            }
            applyBoardVisibility(state, board)
        }
        ensureBoards(state, operations.genId)
        orderChannelsToBoards(state)

        // One concrete example of "follow a place" for clubs with numbered
        // venues — the host can add more, or remove it, once they see the pattern.
        if (p == PRESET_CLUB) {
            clubPrimaryVenueLabel(activity)?.let { ensurePinnedLocationChannel(it) }
        }
    }

    private fun ensurePinnedLocationChannel(label: String) {
        if (state.channels.any { it.pinnedLocationLabel == label }) return
        if (state.locations.none { it.label == label }) return
        state.channels.add(
            Channel(
                id = operations.genId(),
                name = label,
                kind = "event",
                pinnedLocationLabel = label,
                enabledLocations = mutableListOf(label),
                autoIncludeNewMembers = false,
                allowAvailability = false,
                rolePerms = viewOnlyRolePerms(authorization.ensureEventRolePerms()),
            )
        )
    }

    private fun ensureWelcomeLobby(hostIds: List<String>) {
        var welcome = state.channels.find { isWelcomeLobby(it) }
        if (welcome == null) {
            welcome = Channel(
                id = operations.genId(),
                name = "Welcome",
                kind = "chat",
                allowedUserIds = null,
                autoIncludeNewMembers = false,
                rolePerms = viewOnlyRolePerms(authorization.ensureEventRolePerms()),
                welcomeChannel = true,
            )
            state.channels.add(0, welcome)
        } else {
            welcome.name = "Welcome"
            welcome.welcomeChannel = true
            welcome.boardId = null
            welcome.allowedUserIds = null
            welcome.autoIncludeNewMembers = false
        }
        for (other in state.channels) {
            if (other !== welcome && other.kind == "chat") other.welcomeChannel = false
        }
    }

    fun presetSummary(): JSONObject =
        JSONObject()
            .put("preset", state.setupPreset ?: "")
            .put("defaultRole", operations.defaultRoleForNewMembers())
            .put("allowUserCreateEvents", operations.effectiveCreateEvents() == PERM_EVERYONE)
            .put("createEvents", operations.effectiveCreateEvents())
            .put("createEventTypes", normalizeMemberPerm(state.createEventTypes, PERM_MODERATOR))
            .put("addLocations", normalizeMemberPerm(state.addLocations, PERM_MODERATOR))
            .put("inviteToGroup", PERM_ADMIN)
            .put("allowFreeform", state.allowFreeform != false)
            .put("offerAutoInclude", state.offerAutoInclude != false)
            .put("autoIncludeEvents", state.channels.any { it.kind == "event" && it.autoIncludeNewMembers })
            .put("types", JSONArray().also { arr -> for (t in state.eventTypes) arr.put(t.name) })
            .put("chats", JSONArray().also { arr ->
                for (c in state.channels) if (c.kind != "event") arr.put(c.name)
            })
            .put("eventBoards", JSONArray().also { arr ->
                for (c in state.channels) if (c.kind == "event") arr.put(c.name)
            })
            .put("boards", JSONArray().also { arr ->
                for (b in state.boards) arr.put(b.name)
            })

    fun cmdApplySetupPreset(user: User, m: JSONObject) {
        if (!operations.canManageServer(user)) {
            operations.sendToUser(user, JSONObject().put("type", "error")
                .put("error", "Only admins can run the Setup guide."))
            return
        }
        val raw = m.optString("preset").trim().lowercase()
        if (normalizeSetupPreset(raw) != raw) {
            operations.sendToUser(user, JSONObject().put("type", "error").put("error", "Unknown setup preset."))
            return
        }
        val activity = m.optString("activity").takeIf { it.isNotBlank() }
        val replaceTypes = m.optBoolean("replaceTypes", true)
        val replaceLocations = m.optBoolean("replaceLocations", true)
        applySetupPreset(raw, activity, replaceTypes, replaceLocations)
    }
}
