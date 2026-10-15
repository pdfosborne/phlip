package app.phlip.server

internal fun copyAllowList(src: MutableList<String>?): MutableList<String>? =
    src?.toMutableList()

internal fun copyViewPerms(src: MutableMap<String, RolePermFlags>?): MutableMap<String, RolePermFlags>? {
    if (src.isNullOrEmpty()) return null
    return viewOnlyRolePerms(src)
}

internal fun isPinnedChannel(ch: Channel): Boolean =
    ch.pinnedLocationLabel != null || ch.pinnedUserId != null

internal fun isWelcomeLobby(ch: Channel): Boolean =
    ch.kind == "chat" && ch.boardId == null && (ch.welcomeChannel || ch.name.equals("Welcome", ignoreCase = true))

internal fun boardChildren(state: AppState, boardId: String): List<Channel> =
    state.channels.filter { it.boardId == boardId }

internal fun eventChannelForBoard(state: AppState, boardId: String): Channel? =
    state.channels.find { it.boardId == boardId && it.kind == "event" && !isPinnedChannel(it) }

internal fun chatChannelForBoard(state: AppState, boardId: String): Channel? =
    state.channels.find { it.boardId == boardId && it.kind == "chat" && !isWelcomeLobby(it) }

internal val BOARD_CHILD_KINDS = listOf("event", "chat")

internal fun normalizeBoardShownKind(raw: String?): String {
    val kind = raw?.trim()?.lowercase().orEmpty()
    return if (kind == "chat") kind else "event"
}

internal fun normalizeBoardKind(raw: String?): String? {
    val kind = raw?.trim()?.lowercase().orEmpty()
    return if (kind in BOARD_CHILD_KINDS) kind else null
}

internal fun normalizeBoardHiddenKinds(raw: List<String>?): MutableList<String> {
    val hidden = mutableListOf<String>()
    if (raw != null) {
        for (item in raw) {
            val kind = normalizeBoardKind(item) ?: continue
            if (kind !in hidden) hidden.add(kind)
        }
    }
    if (hidden.size >= BOARD_CHILD_KINDS.size) hidden.remove("event")
    return hidden
}

internal fun boardHiddenKinds(board: Board): List<String> =
    normalizeBoardHiddenKinds(board.hiddenKinds)

internal fun firstVisibleBoardKind(board: Board): String {
    val hidden = boardHiddenKinds(board).toHashSet()
    val preferred = normalizeBoardShownKind(board.shownKind)
    if (preferred !in hidden) return preferred
    return BOARD_CHILD_KINDS.first { it !in hidden }
}

internal fun applyBoardHiddenKinds(board: Board, raw: List<String>?) {
    board.hiddenKinds = normalizeBoardHiddenKinds(raw)
    board.shownKind = firstVisibleBoardKind(board)
}

internal fun applyBoardVisibility(state: AppState, board: Board) {
    val event = eventChannelForBoard(state, board.id)
    val chat = chatChannelForBoard(state, board.id)
    val allow = copyAllowList(board.allowedUserIds)
    val perms = copyViewPerms(board.rolePerms) ?: defaultEventChannelViewPerms()
    board.rolePerms = copyViewPerms(perms)
    board.autoIncludeNewMembers = allow != null && board.autoIncludeNewMembers
    val auto = board.autoIncludeNewMembers
    for (ch in listOfNotNull(event, chat)) {
        ch.name = board.name
        ch.allowedUserIds = copyAllowList(allow)
        ch.autoIncludeNewMembers = auto
        ch.rolePerms = copyViewPerms(perms)
        ch.minRole = null
        ch.boardId = board.id
    }
    if (event != null && chat != null) {
        event.linkedChatChannelId = chat.id
    }
}

internal fun newBoardChild(
    id: String,
    board: Board,
    kind: String,
    linkedChatId: String? = null,
): Channel = Channel(
    id = id,
    name = board.name,
    kind = kind,
    allowedUserIds = copyAllowList(board.allowedUserIds),
    linkedChatChannelId = if (kind == "event") linkedChatId else null,
    autoIncludeNewMembers = board.autoIncludeNewMembers && board.allowedUserIds != null,
    rolePerms = copyViewPerms(board.rolePerms) ?: defaultEventChannelViewPerms(),
    boardId = board.id,
)

/**
 * Pair existing event/chat channels into boards. Idempotent.
 * Welcome, pinned location/people channels stay [Channel.boardId] null.
 */
internal fun ensureBoards(state: AppState, idGenerator: () -> String): Boolean {
    @Suppress("SENSELESS_COMPARISON")
    if (state.boards == null) state.boards = mutableListOf()
    var changed = false

    fun makeBoardFrom(ch: Channel): Board {
        val board = Board(
            id = idGenerator(),
            name = ch.name.trim().take(32).ifEmpty { "Board" },
            icon = ch.icon,
            shownKind = normalizeBoardShownKind(ch.kind),
            allowedUserIds = copyAllowList(ch.allowedUserIds),
            autoIncludeNewMembers = ch.autoIncludeNewMembers && ch.allowedUserIds != null,
            rolePerms = copyViewPerms(ch.rolePerms) ?: defaultEventChannelViewPerms(),
        )
        state.boards.add(board)
        return board
    }

    // Repair boards that already exist.
    for (board in state.boards.toList()) {
        var events = state.channels.filter {
            it.boardId == board.id && it.kind == "event" && !isPinnedChannel(it)
        }
        var chats = state.channels.filter {
            it.boardId == board.id && it.kind == "chat" && !isWelcomeLobby(it)
        }
        for (extra in events.drop(1)) {
            extra.boardId = null
            changed = true
        }
        for (extra in chats.drop(1)) {
            extra.boardId = null
            changed = true
        }
        events = events.take(1)
        chats = chats.take(1)
        if (events.isEmpty()) {
            val ev = newBoardChild(idGenerator(), board, "event")
            state.channels.add(ev)
            events = listOf(ev)
            changed = true
        }
        if (chats.isEmpty()) {
            val chat = newBoardChild(idGenerator(), board, "chat")
            state.channels.add(chat)
            chats = listOf(chat)
            changed = true
        }
        val ev = events.first()
        val chat = chats.first()
        if (ev.linkedChatChannelId != chat.id) {
            ev.linkedChatChannelId = chat.id
            changed = true
        }
        if (ev.name != board.name || chat.name != board.name) {
            ev.name = board.name
            chat.name = board.name
            changed = true
        }
        applyBoardVisibility(state, board)
    }

    val boardedIds = state.boards.map { it.id }.toHashSet()

    // Pair via existing linkedChatChannelId (skip Welcome as the chat target).
    for (ev in state.channels.toList()) {
        if (ev.kind != "event" || ev.boardId != null || isPinnedChannel(ev)) continue
        val chatId = ev.linkedChatChannelId ?: continue
        val chat = state.channels.find {
            it.id == chatId && it.kind == "chat" && it.boardId == null && !isWelcomeLobby(it)
        } ?: continue
        val board = makeBoardFrom(ev)
        boardedIds.add(board.id)
        ev.boardId = board.id
        chat.boardId = board.id
        applyBoardVisibility(state, board)
        changed = true
    }

    // Unpaired event channels get a chat sibling.
    for (ev in state.channels.toList()) {
        if (ev.kind != "event" || ev.boardId != null || isPinnedChannel(ev)) continue
        val board = makeBoardFrom(ev)
        ev.boardId = board.id
        val chat = newBoardChild(idGenerator(), board, "chat")
        state.channels.add(chat)
        applyBoardVisibility(state, board)
        changed = true
    }

    // Unpaired chats (not Welcome) get an event sibling.
    for (chat in state.channels.toList()) {
        if (chat.kind != "chat" || chat.boardId != null || isWelcomeLobby(chat)) continue
        val board = makeBoardFrom(chat)
        chat.boardId = board.id
        val ev = newBoardChild(idGenerator(), board, "event", linkedChatId = chat.id)
        state.channels.add(ev)
        applyBoardVisibility(state, board)
        changed = true
    }

    // Drop boards that no longer have children.
    val liveIds = state.channels.mapNotNull { it.boardId }.toHashSet()
    val before = state.boards.size
    state.boards.removeAll { it.id !in liveIds }
    if (state.boards.size != before) changed = true

    return changed
}

/** Keep channel list order: Welcome, then each board's event+chat, then pinned, then leftovers. */
internal fun orderChannelsToBoards(state: AppState): Boolean {
    val original = state.channels.map { it.id }
    val welcome = state.channels.filter { isWelcomeLobby(it) }
    val pinned = state.channels.filter { isPinnedChannel(it) }
    val used = HashSet<String>()
    welcome.forEach { used.add(it.id) }
    pinned.forEach { used.add(it.id) }
    val boarded = mutableListOf<Channel>()
    for (board in state.boards) {
        val ev = eventChannelForBoard(state, board.id)
        val chat = chatChannelForBoard(state, board.id)
        if (ev != null && used.add(ev.id)) boarded.add(ev)
        if (chat != null && used.add(chat.id)) boarded.add(chat)
    }
    val rest = state.channels.filter { it.id !in used }
    val next = (welcome + boarded + pinned + rest).distinctBy { it.id }
    if (next.map { it.id } == original) return false
    state.channels.clear()
    state.channels.addAll(next)
    return true
}
