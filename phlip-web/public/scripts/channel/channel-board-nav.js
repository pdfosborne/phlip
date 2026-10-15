/* channel-board-nav.js — Board landing. All chat is the home; Timeline and Polls are secondary pages.
 *
 * Globals in:  shared board/chat state (S, Nav, activeConn)
 * Globals out: renderConversations, conversationsLandOnGeneralChat, openConversationsEvent, setBoardConversationsSurface, conversationsHandleBack, syncBoardHeadChrome
 * Load after:  channel-chat.js
 * Load before: channel-event-panel.js
 *
 * Must not: ES modules, bundlers, unrelated feature work
 */

function conversationActiveEventChannel() {
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const g = typeof group === "function" ? group() : null;
  const view = typeof S !== "undefined" ? S.activeView : null;
  if (!conn || !g || view?.kind !== "channel") return null;
  const ch = (g.channels || []).find(c => c.id === view.id);
  if (!ch) return null;
  if (ch.kind === "event" && typeof boardUsesChatHome === "function"
      && boardUsesChatHome(ch, conn)) {
    return ch;
  }
  if (ch.kind === "chat" && typeof eventChannelForBoard === "function") {
    const board = typeof boardForChannel === "function" ? boardForChannel(ch, conn) : null;
    const eventCh = board ? eventChannelForBoard(board, conn) : null;
    if (eventCh && typeof boardUsesChatHome === "function"
        && boardUsesChatHome(eventCh, conn)) {
      return eventCh;
    }
  }
  if (ch.kind === "task" && typeof eventChannelForBoard === "function") {
    const board = typeof boardForChannel === "function" ? boardForChannel(ch, conn) : null;
    const eventCh = board ? eventChannelForBoard(board, conn) : null;
    if (eventCh && typeof boardUsesChatHome === "function"
        && boardUsesChatHome(eventCh, conn)) {
      return eventCh;
    }
  }
  return null;
}

function conversationChatSurfaceOn() {
  const g = typeof group === "function" ? group() : null;
  const view = typeof S !== "undefined" ? S.activeView : null;
  if (!g || view?.kind !== "channel") return false;
  const ch = (g.channels || []).find(c => c.id === view.id);
  if (!ch || ch.kind !== "chat") return false;
  if (typeof isWelcomeLobby === "function" && isWelcomeLobby(ch)) return false;
  return !!conversationActiveEventChannel();
}

function conversationGeneralChannel(eventCh, conn = (typeof activeConn === "function" ? activeConn() : null)) {
  if (!eventCh || !conn || typeof chatChannelForBoard !== "function") return null;
  const board = typeof boardForChannel === "function" ? boardForChannel(eventCh, conn) : null;
  return board ? chatChannelForBoard(board, conn) : null;
}

function conversationBoardIsPersonalOnly(ch, conn) {
  if (!ch || !conn) return false;
  if (typeof PersonalSpace === "undefined" || !PersonalSpace.isPersonal(conn)) return false;
  if (typeof S !== "undefined" && S.activeProjection) return false;
  const board = typeof boardForChannel === "function" ? boardForChannel(ch, conn) : null;
  if (board && typeof PersonalSpace.isSourceBoard === "function" && PersonalSpace.isSourceBoard(board)) return false;
  return true;
}

function conversationBoardChatLabel() {
  return "All chat";
}

function conversationsStartCreate() {
  const ch = conversationActiveEventChannel();
  if (!ch) return;
  if (typeof S !== "undefined") S.activeEventChannelId = ch.id;
  if (typeof startFlatTypePick === "function") {
    startFlatTypePick({ createFromEvent: true, day: Date.now() });
  } else if (typeof openCreateDraft === "function") {
    openCreateDraft();
  }
}

function conversationsLandOnGeneralChat({ eventId } = {}) {
  if (S._boardOpening) return;
  S._boardOpening = true;
  try {
  const eventCh = conversationActiveEventChannel();
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const chat = conversationGeneralChannel(eventCh, conn);
  if (!eventCh || !conn || !chat) return;
  if (typeof closeTimelineSheet === "function") {
    try { closeTimelineSheet(); } catch {}
  }
  S.conversationsReturn = {
    connId: conn.id,
    eventChannelId: eventCh.id,
    surface: typeof boardSurfaceFor === "function" ? boardSurfaceFor(eventCh.id) : "conversations",
    focusEventId: eventId || null,
    projection: S.activeProjection
      ? {
        sourceConnId: S.activeProjection.sourceConnId,
        sourceBoardId: S.activeProjection.sourceBoardId,
        sourceChannelId: eventCh.id,
      }
      : null,
  };
  S.boardChatHome = true;
  S.memoryChatReadonly = false;
  S.autoTagEventId = null;
  S.conversationsThread = null;
  if (eventId) {
    S.chatFilterEventId = eventId;
    S.chatFilterUntagged = false;
    S.mentionedEventIds = [eventId];
    S.taggedEventId = eventId;
    S.chatMoveSelect = null;
  } else {
    S.chatFilterEventId = null;
    S.chatFilterUntagged = false;
    S.mentionedEventIds = [];
    S.taggedEventId = null;
  }
  if (typeof markChannelRead === "function") markChannelRead(conn, chat.id);
  if (S.activeProjection && typeof Nav?.openProjectedChannel === "function") {
    Nav.openProjectedChannel({
      sourceConnId: S.activeProjection.sourceConnId,
      sourceBoardId: S.activeProjection.sourceBoardId,
      sourceChannelId: chat.id,
    });
  } else if (typeof Nav?.openChannel === "function") {
    Nav.openChannel(chat.id);
  }
  if (typeof renderSidebar === "function") renderSidebar();
  if (typeof renderNavIcon === "function") renderNavIcon();
  if (typeof renderView === "function") renderView(false, { force: true });
  } finally {
    S._boardOpening = false;
  }
}

function openConversationsEvent(eventId) {
  if (!eventId) return;
  if (typeof S !== "undefined") S.conversationLastOpenedId = eventId;
  conversationsLandOnGeneralChat({ eventId });
}

function setBoardConversationsSurface(mode) {
  if (typeof S !== "undefined") {
    S.boardPeoplePage = false;
    S.boardPeopleAccess = false;
  }
  const ch = conversationActiveEventChannel();
  if (!ch || typeof setBoardSurface !== "function") return;
  const surface = mode === "agenda" ? "agenda" : mode === "polls" ? "polls" : "conversations";
  if (surface === "conversations" && typeof boardReturnToChat === "function") {
    boardReturnToChat();
    return;
  }
  if (surface !== "conversations" && typeof conversationChatSurfaceOn === "function"
      && conversationChatSurfaceOn() && typeof boardSaveChatMemory === "function") {
    boardSaveChatMemory();
  }
  if (surface !== "polls" && window.PollsUI) window.PollsUI.openId = null;
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const taskCh = conversationTaskChannel(ch, conn);
  const view = typeof S !== "undefined" ? S.activeView : null;
  const onTasks = !!(taskCh && view?.kind === "channel" && view.id === taskCh.id);
  if (onTasks) {
    const ret = (typeof S !== "undefined" && S.conversationsReturn) || {};
    conversationsRestoreBoard({
      ...ret,
      connId: ret.connId || conn?.id,
      eventChannelId: ret.eventChannelId || ch.id,
      surface,
    }, ch);
    return;
  }
  const already = !!(view?.kind === "channel" && view.id === ch.id);
  const current = typeof boardSurfaceFor === "function" ? boardSurfaceFor(ch.id) : "conversations";
  if (already && current === surface) {
    if (surface === "polls" && window.PollsUI?.openId) {
      window.PollsUI.openId = null;
      if (typeof renderView === "function") renderView(false, { force: true });
      return;
    }
    if (surface === "conversations" && typeof closeTimelineSheet === "function") {
      try { closeTimelineSheet(); } catch {}
    }
    syncBoardHeadChrome();
    return;
  }
  setBoardSurface(ch.id, surface);
  if (surface === "conversations" && typeof closeTimelineSheet === "function") {
    try { closeTimelineSheet(); } catch {}
  }
  if (!already) {
    if (typeof S !== "undefined") {
      S.conversationsThread = null;
      if (S.conversationsReturn?.eventChannelId === ch.id) S.conversationsReturn = null;
    }
    if (typeof Nav?.openChannel === "function") Nav.openChannel(ch.id);
  }
  if (typeof renderView === "function") renderView(false, { force: true });
  if (typeof renderNavIcon === "function") renderNavIcon();
}

function conversationTaskChannel(eventCh, conn) {
  const boardCh = eventCh || conversationActiveEventChannel();
  const owner = conn || (typeof activeConn === "function" ? activeConn() : null);
  if (!boardCh || !owner || typeof taskChannelForBoard !== "function") return null;
  const board = typeof boardForChannel === "function" ? boardForChannel(boardCh, owner) : null;
  if (!board) return null;
  return taskChannelForBoard(board, owner);
}

function conversationsOpenNestedChannel(ch, eventCh, conn) {
  if (!ch || !eventCh || !conn) return;
  if (typeof S !== "undefined") {
    S.conversationsReturn = {
      connId: conn.id,
      eventChannelId: eventCh.id,
      projection: S.activeProjection
        ? {
          sourceConnId: S.activeProjection.sourceConnId,
          sourceBoardId: S.activeProjection.sourceBoardId,
          sourceChannelId: eventCh.id,
        }
        : null,
      surface: typeof boardSurfaceFor === "function" ? boardSurfaceFor(eventCh.id) : "conversations",
    };
  }
  if (typeof closeTimelineSheet === "function") {
    try { closeTimelineSheet(); } catch {}
  }
  if (typeof S !== "undefined" && S.activeProjection && typeof Nav?.openProjectedChannel === "function") {
    Nav.openProjectedChannel({
      sourceConnId: S.activeProjection.sourceConnId,
      sourceBoardId: S.activeProjection.sourceBoardId,
      sourceChannelId: ch.id,
    });
  } else if (typeof Nav?.openChannel === "function") {
    Nav.openChannel(ch.id);
  }
  if (typeof renderSidebar === "function") renderSidebar();
  if (typeof renderNavIcon === "function") renderNavIcon();
  if (typeof renderView === "function") renderView(false, { force: true });
}

function conversationsRestoreBoard(ret, eventCh) {
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const targetId = ret?.eventChannelId || eventCh?.id;
  if (!conn || !targetId) return false;
  if (typeof S !== "undefined") S.conversationsReturn = null;
  const surface = ret?.surface === "agenda" ? "agenda" : ret?.surface === "polls" ? "polls" : "conversations";
  if (typeof setBoardSurface === "function") setBoardSurface(targetId, surface);
  if (ret?.projection && typeof Nav?.openProjectedChannel === "function") {
    Nav.openProjectedChannel({
      sourceConnId: ret.projection.sourceConnId,
      sourceBoardId: ret.projection.sourceBoardId,
      sourceChannelId: targetId,
    });
  } else if (typeof Nav?.openChannel === "function") {
    Nav.openChannel(targetId);
  }
  if (typeof S !== "undefined") S.activeEventChannelId = targetId;
  if (typeof renderSidebar === "function") renderSidebar();
  if (typeof renderNavIcon === "function") renderNavIcon();
  if (typeof renderView === "function") renderView(false, { force: true });
  return true;
}

function syncBoardHeadChrome() {
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const eventCh = typeof conversationActiveEventChannel === "function"
    ? conversationActiveEventChannel()
    : null;
  const show = !!(eventCh && typeof boardUsesChatHome === "function"
    && boardUsesChatHome(eventCh, conn));
  document.body.classList.toggle("float-board", !!show);
  if (show && typeof syncChannelInfoBtn === "function") syncChannelInfoBtn();
  if (typeof syncBoardNavRow === "function") syncBoardNavRow();
  if (!show) {
    syncBoardTitleTrigger(false);
    return;
  }

  syncBoardTitleTrigger(true);
  syncFloatBoardHeader(eventCh, conn);
  if (boardOptionsIsOpen()) paintBoardOptions();
}

function conversationsHandleBack() {
  if (typeof S !== "undefined" && S.boardChatHome
      && typeof conversationChatSurfaceOn === "function" && conversationChatSurfaceOn()) {
    if (S.chatFilterEventId && typeof boardSelectTab === "function") {
      if (S.conversationsThread?.eventId && typeof boardReturnToChat === "function") boardReturnToChat();
      else if (typeof boardShowAllChat === "function") boardShowAllChat();
      else boardSelectTab(null);
      return true;
    }
    return false;
  }
  if (typeof S !== "undefined" && S.boardChatHome
      && typeof boardPageKind === "function" && boardPageKind() && boardPageKind() !== "chat") {
    return false;
  }
  if (boardOptionsIsOpen()) {
    closeBoardOptions({ restoreFocus: true });
    return true;
  }
  if (conversationFeedPickerIsOpen()) {
    closeConversationFeedPicker();
    return true;
  }
  if (typeof pollsHandleBack === "function" && pollsHandleBack()) return true;
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const g = typeof group === "function" ? group() : null;
  const view = typeof S !== "undefined" ? S.activeView : null;
  const ch = view?.kind === "channel"
    ? (g?.channels || []).find(c => c.id === view.id)
    : null;
  const ret = typeof S !== "undefined" ? S.conversationsReturn : null;
  if (ret && ch && conn && ret.connId === conn.id) {
    const eventCh = (g?.channels || []).find(c => c.id === ret.eventChannelId)
      || (conn.channels || []).find(c => c.id === ret.eventChannelId);
    const general = conversationGeneralChannel(eventCh, conn);
    const taskCh = conversationTaskChannel(eventCh, conn);
    if ((general && ch.id === general.id) || (taskCh && ch.id === taskCh.id)) {
      if (taskCh && ch.id === taskCh.id) {
        return conversationsRestoreBoard(ret, eventCh);
      }
      const backSurface = ret.surface === "agenda" || ret.surface === "polls" ? ret.surface : "conversations";
      const focusEventId = ret.focusEventId || null;
      S.conversationsReturn = null;
      S.conversationsThread = null;
      if (typeof clearChatStreamFilters === "function") clearChatStreamFilters();
      else {
        S.chatFilterEventId = null;
        S.chatFilterUntagged = false;
        S.memoryChatReadonly = false;
      }
      S.mentionedEventIds = [];
      S.taggedEventId = null;
      S.autoTagEventId = null;
      S.chatMoveSelect = null;
      if (typeof setBoardSurface === "function") setBoardSurface(ret.eventChannelId, backSurface);
      if (ret.projection && typeof Nav?.openProjectedChannel === "function") {
        Nav.openProjectedChannel({
          sourceConnId: ret.projection.sourceConnId,
          sourceBoardId: ret.projection.sourceBoardId,
          sourceChannelId: ret.eventChannelId,
        });
      } else if (typeof Nav?.openChannel === "function") {
        Nav.openChannel(ret.eventChannelId);
      }
      S.activeEventChannelId = ret.eventChannelId;
      if (typeof renderSidebar === "function") renderSidebar();
      if (typeof renderNavIcon === "function") renderNavIcon();
      if (typeof renderView === "function") renderView(false, { force: true });
      if (backSurface === "agenda" && focusEventId && typeof timelineFocusAgendaEvent === "function") {
        requestAnimationFrame(function () { timelineFocusAgendaEvent(focusEventId); });
      }
      return true;
    }
  }
  if (ch && typeof isBoardPollsView === "function" && isBoardPollsView(ch, conn)) {
    if (typeof setBoardSurface === "function") setBoardSurface(ch.id, "conversations");
    if (typeof renderView === "function") renderView(false, { force: true });
    return true;
  }
  if (ch && typeof isBoardAgendaView === "function" && isBoardAgendaView(ch, conn)) {
    if (typeof setBoardSurface === "function") setBoardSurface(ch.id, "conversations");
    if (typeof closeTimelineSheet === "function") {
      try { closeTimelineSheet(); } catch {}
    }
    if (typeof renderView === "function") renderView(false, { force: true });
    return true;
  }
  return false;
}

function renderConversations(view, ch) {
  const conn = typeof activeConn === "function" ? activeConn() : null;
  if (!view || !ch || !conn) return;
  const chat = typeof conversationGeneralChannel === "function"
    ? conversationGeneralChannel(ch, conn) : null;
  if (!S._boardOpening && chat) {
    S.boardChatHome = true;
    conversationsLandOnGeneralChat();
    return;
  }
  view.style.cssText = "display:flex;flex-direction:column;flex:1;min-height:0";
  view.classList.add("conversations-view-mode");
  view.classList.remove("timeline-view-mode", "tl-layout-list", "tl-layout-cards");
  document.body.classList.remove("timeline-view-active");
  view.innerHTML = `<div class="conv-scroll"><p class="empty-note">This board has no chat yet.</p></div>`;
}

(function wireBoardCreate() {
  if (!document.body.dataset.boardCreateWired) {
    document.body.dataset.boardCreateWired = "1";
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-board-create]");
      if (!btn) return;
      e.preventDefault();
      const fab = document.getElementById("tl-create-fab");
      if (fab && document.querySelector(".timeline-view-mode")) {
        fab.click();
        return;
      }
      conversationsStartCreate();
    });
  }
})();
