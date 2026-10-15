package app.phlip.server

/**
 * Repairs persisted state loaded from older server schemas.
 *
 * Migration order is significant: later migrations rely on collections and
 * channels repaired by earlier steps. Random identifiers remain owned by
 * [DrServer] and are injected here.
 */
internal class ServerStateMigrations(
    private val idGenerator: () -> String,
) {
    /**
     * Apply all persisted-state repairs in the same order as the legacy load path.
     * [ensureSaltBlindKey] keeps cryptographic key generation in [DrServer] while
     * allowing this component to preserve its exact position in the sequence.
     */
    @Suppress("SENSELESS_COMPARISON")
    fun migrate(state: AppState, ensureSaltBlindKey: () -> Boolean): Boolean {
        if (state.notifications == null) state.notifications = mutableMapOf()
        if (state.channels == null) state.channels = mutableListOf()
        @Suppress("SENSELESS_COMPARISON")
        if (state.boards == null) state.boards = mutableListOf()
        if (state.events == null) state.events = mutableListOf()
        if (state.groupInvites == null) state.groupInvites = mutableListOf()
        if (state.serverActivity == null) state.serverActivity = mutableListOf()
        @Suppress("SENSELESS_COMPARISON")
        if (state.availabilities == null) state.availabilities = mutableListOf()
        @Suppress("SENSELESS_COMPARISON")
        if (state.timeBlocks == null) state.timeBlocks = mutableListOf()
        if (state.reports == null) state.reports = mutableListOf()
        if (state.categories == null || state.categories.isEmpty()) state.categories = defaultCategories()
        if (state.cardCats == null || state.cardCats.isEmpty()) state.cardCats = defaultCardCats()
        if (state.cardDurations == null) state.cardDurations = mutableMapOf()
        if (state.removedCards == null) state.removedCards = mutableListOf()
        if (state.locations == null || state.locations.isEmpty()) state.locations = defaultLocations()
        if (state.eventTypes == null) state.eventTypes = mutableListOf()
        if (state.reactionCards == null) state.reactionCards = mutableListOf()
        if (state.customRoles == null) state.customRoles = mutableListOf()

        var changed = ensureSaltBlindKey()
        if (state.minAge < 18 || state.minAge > 99) {
            state.minAge = clampMinAge(state.minAge)
            changed = true
        }
        changed = flattenLegacyGroups(state) || changed
        changed = ensureEventChannel(state) || changed
        changed = ensureWelcomeChannel(state) || changed
        changed = migrateMemberRoles(state) || changed
        changed = migrateServerEventRolePerms(state) || changed
        changed = migrateEventChannelRolePerms(state) || changed
        changed = migrateEventTypes(state) || changed
        changed = dropFreeformEventTypes(state) || changed
        changed = migrateReactionStacks(state) || changed
        changed = migrateLiveProfilePhotos(state) || changed
        changed = ensureBoards(state, idGenerator) || changed
        changed = migrateBoardShownKind(state) || changed
        changed = migrateBoardHiddenKinds(state) || changed
        changed = orderChannelsToBoards(state) || changed
        return changed
    }

    /** Seed [AppState.liveProfilePhotos] from legacy [AppState.allowProfilePics]. */
    private fun migrateLiveProfilePhotos(state: AppState): Boolean {
        val raw = state.liveProfilePhotos?.trim()?.lowercase().orEmpty()
        if (raw in LIVE_PROFILE_PHOTOS_MODES) {
            val wantAllow = raw != LIVE_PROFILE_PHOTOS_OFF
            if (state.allowProfilePics != wantAllow) {
                state.allowProfilePics = wantAllow
                return true
            }
            return false
        }
        // Missing/invalid string — map boolean (historical default was on → online).
        state.applyLiveProfilePhotos(
            if (state.allowProfilePics) LIVE_PROFILE_PHOTOS_ONLINE else LIVE_PROFILE_PHOTOS_OFF,
        )
        return true
    }

    @Suppress("SENSELESS_COMPARISON")
    private fun migrateBoardShownKind(state: AppState): Boolean {
        var changed = false
        for (board in state.boards) {
            val next = normalizeBoardShownKind(board.shownKind)
            if (board.shownKind != next) {
                board.shownKind = next
                changed = true
            }
        }
        return changed
    }

    @Suppress("SENSELESS_COMPARISON")
    private fun migrateBoardHiddenKinds(state: AppState): Boolean {
        var changed = false
        for (board in state.boards) {
            val raw = board.hiddenKinds
            val next = normalizeBoardHiddenKinds(raw)
            if (raw == null || raw != next) {
                applyBoardHiddenKinds(board, next)
                changed = true
            } else {
                val shown = firstVisibleBoardKind(board)
                if (board.shownKind != shown) {
                    board.shownKind = shown
                    changed = true
                }
            }
        }
        return changed
    }

    /**
     * Expand legacy per-user `emoji|count` maps into ordered [Event.reactionStacks]
     * lists, and keep [Event.reactions] as a compact summary for older clients.
     */
    @Suppress("SENSELESS_COMPARISON")
    private fun migrateReactionStacks(state: AppState): Boolean {
        var changed = false
        for (ev in state.events) {
            val stacks = ev.reactionStacks ?: mutableMapOf<String, MutableList<String>>().also {
                ev.reactionStacks = it
                changed = true
            }
            val legacy = ev.reactions
            if (legacy != null && stacks.isEmpty() && legacy.isNotEmpty()) {
                for ((uid, raw) in legacy) {
                    val parts = raw.split("|")
                    val emoji = parts.firstOrNull()?.trim().orEmpty()
                    if (emoji.isEmpty()) continue
                    val count = parts.getOrNull(1)?.toIntOrNull()?.coerceIn(1, MAX_REACTIONS_PER_USER) ?: 1
                    stacks[uid] = MutableList(count) { emoji }
                }
                changed = true
            }
            // Sync legacy summary from stacks when stacks have entries.
            if (stacks.isNotEmpty()) {
                val summary = mutableMapOf<String, String>()
                for ((uid, list) in stacks) {
                    if (list.isEmpty()) continue
                    val last = list.last()
                    summary[uid] = if (list.size > 1) "$last|${list.size.coerceAtMost(99)}" else last
                }
                if (ev.reactions != summary) {
                    ev.reactions = summary.takeIf { it.isNotEmpty() }
                    changed = true
                }
                // Drop empty user lists.
                val emptyKeys = stacks.filterValues { it.isEmpty() }.keys.toList()
                if (emptyKeys.isNotEmpty()) {
                    emptyKeys.forEach { stacks.remove(it) }
                    changed = true
                }
                if (stacks.isEmpty()) {
                    ev.reactionStacks = null
                    changed = true
                }
            }
        }
        // Deduplicate / cap reaction card library.
        val cards = state.reactionCards
        if (cards != null) {
            val seen = linkedMapOf<String, ReactionCardEntry>()
            var dirty = false
            for (raw in cards.toList()) {
                val clamped = clampReaction(raw.card)
                if (clamped == null || !clamped.startsWith("d:")) {
                    dirty = true
                    continue
                }
                val existing = seen[clamped]
                if (existing == null) {
                    if (raw.card != clamped) dirty = true
                    seen[clamped] = ReactionCardEntry(
                        card = clamped,
                        createdBy = raw.createdBy,
                        createdByName = raw.createdByName,
                    )
                } else {
                    dirty = true
                    // Prefer the entry that already has an author.
                    if (existing.createdBy.isNullOrBlank() && !raw.createdBy.isNullOrBlank()) {
                        existing.createdBy = raw.createdBy
                        existing.createdByName = raw.createdByName
                    }
                }
            }
            val next = seen.values.take(MAX_REACTION_CARDS).toMutableList()
            if (dirty || next != cards) {
                state.reactionCards = next
                changed = true
            }
        }
        return changed
    }

    /** Soft-rename legacy open lobby chat; ensure at least one chat channel exists. */
    private fun ensureWelcomeChannel(state: AppState): Boolean {
        var changed = false
        val general = state.channels.find {
            it.kind != "event" && it.name.equals("general", ignoreCase = true)
        }
        if (general != null) {
            general.name = "Welcome"
            changed = true
        }
        if (state.channels.none { it.kind != "event" }) {
            state.channels.add(0, Channel(idGenerator(), "Welcome", kind = "chat"))
            changed = true
        }
        return changed
    }

    /** Hoist pre-flattening group contents onto the top-level state lists. */
    private fun flattenLegacyGroups(state: AppState): Boolean {
        val legacy = state.groups ?: return false
        for (group in legacy) {
            state.channels.addAll(group.channels)
            state.events.addAll(group.events)
        }
        state.groups = null
        return true
    }

    /** Ensure the implicit legacy event board has a concrete channel. */
    private fun ensureEventChannel(state: AppState): Boolean {
        var changed = false
        for (channel in state.channels) {
            @Suppress("SENSELESS_COMPARISON")
            if (channel.kind == null) { channel.kind = "chat"; changed = true }
        }
        var eventChannel = state.channels.find { it.kind == "event" }
        if (eventChannel == null) {
            eventChannel = Channel(
                idGenerator(), "Events", kind = "event",
                rolePerms = defaultEventChannelViewPerms(),
            )
            state.channels.add(eventChannel)
            changed = true
        }
        for (event in state.events) {
            @Suppress("SENSELESS_COMPARISON")
            if (event.channelId == null || event.channelId.isEmpty()) {
                event.channelId = eventChannel.id
                changed = true
            }
        }
        return changed
    }

    private fun migrateMemberRoles(state: AppState): Boolean {
        var changed = false
        for (user in state.users.values) {
            if (user.isHost) {
                if (user.role != ROLE_HOST) { user.role = ROLE_HOST; changed = true }
            } else if (user.role.isNullOrBlank()) {
                user.role = ROLE_USER
                changed = true
            }
            // Drop any previously stored client IPs — not used for auth, privacy.
            if (!user.lastIp.isNullOrEmpty()) {
                user.lastIp = ""
                changed = true
            }
        }
        return changed
    }

    /**
     * Seed [AppState.eventRolePerms] once from defaults + any legacy channel matrices,
     * then strip each event channel's [Channel.rolePerms] down to view-only visibility.
     */
    private fun migrateServerEventRolePerms(state: AppState): Boolean {
        var changed = false
        val createLevel = run {
            val value = state.createEvents?.trim()?.lowercase().orEmpty()
            when {
                value == "user" || value == "member" -> PERM_EVERYONE
                value in MEMBER_PERMS -> value
                else -> if (state.allowUserCreateEvents) PERM_EVERYONE else PERM_MODERATOR
            }
        }
        if (state.eventRolePerms.isNullOrEmpty()) {
            val seeded = defaultEventChannelRolePerms(createLevel)
            for (ch in state.channels) {
                if (ch.kind != "event") continue
                val map = ch.rolePerms ?: continue
                for ((key, flags) in map) {
                    if (key in CHANNEL_MATRIX_FIXED_KEYS) {
                        // Prefer first channel's action flags for fixed rows when richer than defaults.
                        val cur = seeded[key] ?: emptyRolePermFlags()
                        if (!cur.create && flags.create) seeded[key] = flags.copyFlags()
                        continue
                    }
                    if (key !in seeded) seeded[key] = flags.copyFlags()
                }
            }
            for (role in state.customRoles ?: emptyList()) {
                if (role.baseRole.isNullOrBlank()) {
                    role.baseRole = ROLE_USER
                    changed = true
                }
                if (role.id !in seeded) {
                    val base = normalizeCustomRoleBase(role.baseRole)
                    seeded[role.id] = (seeded[base] ?: emptyRolePermFlags()).copyFlags()
                }
            }
            state.eventRolePerms = seeded
            changed = true
        } else {
            val map = state.eventRolePerms!!
            for (key in CHANNEL_MATRIX_FIXED_KEYS) {
                if (key !in map) {
                    map[key] = emptyRolePermFlags()
                    changed = true
                }
            }
            for (role in state.customRoles ?: emptyList()) {
                if (role.baseRole.isNullOrBlank()) {
                    role.baseRole = ROLE_USER
                    changed = true
                }
                if (role.id !in map) {
                    val base = normalizeCustomRoleBase(role.baseRole)
                    map[role.id] = (map[base] ?: emptyRolePermFlags()).copyFlags()
                    changed = true
                }
            }
        }
        return changed
    }

    /**
     * Ensure channels have a view-only [Channel.rolePerms] visibility map.
     * Event channels always; chat channels seeded from legacy minRole when missing.
     * Strips action flags left over from the old per-channel matrix model.
     */
    private fun migrateEventChannelRolePerms(state: AppState): Boolean {
        var changed = false
        val createLevel = run {
            val value = state.createEvents?.trim()?.lowercase().orEmpty()
            when {
                value == "user" || value == "member" -> PERM_EVERYONE
                value in MEMBER_PERMS -> value
                else -> if (state.allowUserCreateEvents) PERM_EVERYONE else PERM_MODERATOR
            }
        }
        val server = state.eventRolePerms ?: defaultEventChannelRolePerms(createLevel)
        for (channel in state.channels) {
            if (channel.kind != "event" && channel.kind != "chat" && channel.kind != "task") continue
            if (channel.rolePerms != null && channel.rolePerms!!.isNotEmpty()) {
                val map = channel.rolePerms!!
                var touched = false
                for (key in CHANNEL_MATRIX_FIXED_KEYS) {
                    if (key !in map) {
                        map[key] = RolePermFlags(view = server[key]?.view == true)
                        touched = true
                    }
                }
                // Strip action flags — channel map is visibility only.
                for ((key, flags) in map.toList()) {
                    if (flags.rsvp || flags.create || flags.react || flags.edit || flags.stickers
                        || flags.repeats || flags.chains || flags.requireApproval || flags.canApprove
                    ) {
                        map[key] = RolePermFlags(view = flags.view)
                        touched = true
                    }
                }
                if (touched) changed = true
                // Matrix owns visibility — drop legacy chat floor once seeded.
                if ((channel.kind == "chat" || channel.kind == "task") && channel.minRole != null) {
                    channel.minRole = null
                    changed = true
                }
                continue
            }
            if (channel.kind == "chat" || channel.kind == "task") {
                // Preserve existing minRole floor as view flags.
                channel.rolePerms = viewOnlyRolePerms(
                    seedEventChannelRolePerms(channel.minRole, createLevel)
                )
                channel.minRole = null
            } else {
                channel.rolePerms = viewOnlyRolePerms(server)
            }
            changed = true
        }
        return changed
    }

    /** Pick an id not already used by a type in [existing]. */
    fun uniqueTypeId(base: String, existing: List<EventType>): String {
        val used = existing.map { it.id }.toHashSet()
        if (base !in used) return base
        var index = 2
        while ("${base}_$index" in used) index++
        return "${base}_$index"
    }

    /** Seed first-class event types from built-ins and legacy per-label maps. */
    private fun migrateEventTypes(state: AppState): Boolean {
        if (state.eventTypes.isNotEmpty()) return false
        val seeded = defaultEventTypes()
        val removed = state.removedCards.map { it.trim().lowercase() }.toSet()
        seeded.removeAll { !it.freeform && it.name.lowercase() in removed }
        val validCats = state.categories.map { it.id }.toSet()
        for ((rawLabel, catId) in state.cardCats) {
            val label = rawLabel.trim()
            if (label.isEmpty() || label.lowercase() in removed) continue
            val existing = seeded.find { it.name.equals(label, ignoreCase = true) }
            if (existing != null) {
                if (catId in validCats) existing.categoryId = catId
            } else {
                seeded.add(EventType(
                    id = uniqueTypeId(eventTypeSlug(label), seeded),
                    name = label,
                    categoryId = catId.takeIf { it in validCats },
                    order = seeded.size,
                ))
            }
        }
        for ((rawLabel, duration) in state.cardDurations) {
            val type = seeded.find { it.name.equals(rawLabel.trim(), ignoreCase = true) } ?: continue
            val code = duration.trim()
            if (code in EVENT_DURATION_CODES) type.defaultDuration = code
        }
        seeded.forEachIndexed { index, type -> type.order = index }
        state.eventTypes = seeded
        return true
    }

    /** Drop the obsolete freeform event type and restore contiguous ordering. */
    private fun dropFreeformEventTypes(state: AppState): Boolean {
        val before = state.eventTypes.size
        state.eventTypes.removeAll { it.freeform }
        if (state.eventTypes.size == before) return false
        state.eventTypes.forEachIndexed { index, type -> type.order = index }
        return true
    }
}
