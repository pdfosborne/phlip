/* board-continue.js — continuing a conversation or event from All chat: reply targets, event targets for the # picker, outgoing tags, and the per-board link and chain memory.
 *
 * Globals in:  shared board/chat state (S, Nav, activeConn), board-model.js
 * Globals out: boardBeginContinue, boardOwnEvents, boardCancelReply, boardContinueEventTargets, boardApplyTag, boardKeepChains, boardExtendTarget
 * Load after:  board-pages.js
 * Load before: board-composer.js
 *
 * Must not: ES modules, bundlers, unrelated feature work
 */

function boardReleaseContinuationAfterSend() {
  if (typeof S === "undefined" || !S.boardChatHome) return;
  if (S.boardArchive) S.boardArchive = false;
  S.boardComposeEventId = null;
  S.boardComposerOpen = true;
  S.boardSuppressComposerLock = true;
  if (S.chatFilterEventId && S.boardContinueSeparate && S.boardOutgoingConversationId) {
    S.boardContinuing = S.boardOutgoingConversationId;
    S.boardContinueAnchor = null;
    S.boardContinueSeparate = false;
  }
  if (!S.chatFilterEventId) {
    S.boardContinuing = null;
    S.boardContinueAnchor = null;
    S.boardContinueSeparate = false;
  }
  S.boardOutgoingConversationId = null;
  if (typeof boardClearContinueScan === "function") boardClearContinueScan();
  const mem = boardChatMemory();
  mem.draft = "";
  mem.continuing = S.chatFilterEventId ? (S.boardContinuing || null) : null;
  mem.anchor = S.chatFilterEventId ? (S.boardContinueAnchor || null) : null;
  mem.separate = false;
  mem.saved = true;
}

function boardContinuationEvent() {
  if (typeof S === "undefined" || !S.boardChatHome || !S.boardContinuing || S.boardContinueSeparate || S.boardConnect) return null;
  const list = boardActiveMessages();
  const id = boardConversationEventId(list, S.boardContinuing);
  if (!id) return null;
  return boardFindEvent(id, null, typeof activeConn === "function" ? activeConn() : null);
}

function boardContinuationExcerpt() {
  const list = boardActiveMessages();
  const id = typeof S !== "undefined" ? S.boardContinueAnchor : "";
  const message = (list || []).find((item) => item.id === id);
  const raw = typeof chatMessagePlaintext === "function"
    ? chatMessagePlaintext(message)
    : (message?._text || message?.text || "");
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > 40 ? `${text.slice(0, 40).trim()}…` : text;
}

function boardContinuationHTML() {
  if (boardExtendTarget() || boardFilterCompose()) return "";
  if (typeof S === "undefined" || !S.boardChatHome || !S.boardContinuing || S.boardContinueSeparate || S.boardConnect || S.replyToMessage) return "";
  const ev = boardContinuationEvent();
  const title = ev ? boardEventTitle(ev) : "";
  const excerpt = boardContinuationExcerpt();
  const quote = excerpt ? `<span class="board-continuing-excerpt">${esc(excerpt)}</span>` : "";
  const event = title ? `<span class="board-continuing-event">${esc(title)}</span>` : "";
  return `<div class="board-continuing" role="status">
    <p class="board-continuing-line">${quote}${event}</p>
    <button type="button" id="board-stop-continuing" aria-label="Cancel continuing">×</button>
  </div>`;
}

function boardLatestEventConversation(list, eventId) {
  if (!eventId) return null;
  for (let i = (list || []).length - 1; i >= 0; i--) {
    const m = list[i];
    if (!m || m.activity || m._eventLinkMarker) continue;
    if (boardMessageEventId(m) !== eventId) continue;
    return boardMessageConversationId(m, list);
  }
  return null;
}

function boardLastExtendMessage(list, filterId, conn) {
  const events = conn?.events;
  for (let i = (list || []).length - 1; i >= 0; i--) {
    const m = list[i];
    if (!m || m.activity || m._eventLinkMarker) continue;
    if (filterId) {
      if (boardMessageEventId(m) !== filterId) continue;
    } else if (boardMessageIsFolded(m, events, conn)) continue;
    return m;
  }
  return null;
}

function boardPinContinueTarget() {
  if (typeof S === "undefined" || !S.boardChatHome) return;
  if (S.boardContinueSeparate || S.boardContinuing || S.replyToMessage) return;
  const list = boardActiveMessages();
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const last = boardLastExtendMessage(list, S.chatFilterEventId || "", conn);
  if (!last) return;
  const cid = boardMessageConversationId(last, list);
  if (!cid) return;
  S.boardContinuing = cid;
  S.boardContinueAnchor = last.id;
  const mem = boardChatMemory();
  mem.continuing = cid;
  mem.anchor = last.id;
  mem.separate = false;
  mem.saved = true;
}

function boardExtendTarget() {
  if (typeof S === "undefined" || !S.boardChatHome || !S.boardComposerOpen) return null;
  if (S.boardContinueSeparate || S.boardConnect || !S.boardContinuing) return null;
  const list = boardActiveMessages();
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const filterId = S.chatFilterEventId || "";
  const members = boardConversationMessages(list, S.boardContinuing).filter((m) => {
    if (!m || m.activity || m._eventLinkMarker) return false;
    if (filterId && boardMessageEventId(m) !== filterId) return false;
    if (!filterId && boardMessageIsFolded(m, conn?.events, conn)) return false;
    return true;
  });
  const message = members[members.length - 1] || null;
  const conversationId = S.boardContinuing;
  if (!message || !conversationId) return null;
  const eventId = boardConversationEventId(list, conversationId);
  const found = eventId ? boardFindEvent(eventId, null, conn) : null;
  const hidden = boardFocusHiddenIds(list, filterId, conn);
  let laterVisible = false;
  let passed = false;
  for (const m of list) {
    if (!m || m.activity || m._eventLinkMarker) continue;
    if (filterId) {
      if (boardMessageEventId(m) !== filterId) continue;
    } else if (boardMessageIsFolded(m, conn?.events, conn)) continue;
    if (m.id === message.id) {
      passed = true;
      continue;
    }
    if (passed && !hidden.has(m.id)) {
      laterVisible = true;
      break;
    }
  }
  return {
    messageId: message.id,
    conversationId,
    eventId: eventId || null,
    event: found && !found._missing ? found : null,
    reachesField: passed && !laterVisible,
  };
}

function boardFilterCompose() {
  return typeof S !== "undefined" && !!S.boardChatHome && !!S.chatFilterEventId
    && !S.boardContinueSeparate && !S.replyToMessage && !S.boardFromChat;
}

function boardLatestStartMessage() {
  if (typeof S === "undefined" || !S.boardChatHome || S.chatFilterEventId) return null;
  const list = typeof boardActiveMessages === "function" ? boardActiveMessages() : [];
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const events = conn?.events;
  for (let i = (list || []).length - 1; i >= 0; i--) {
    const message = list[i];
    if (!message || message.activity || message._eventLinkMarker) continue;
    if (boardMessageIsFolded(message, events, conn)) continue;
    if (boardMessageChainSize(list, message) < 2) continue;
    return message;
  }
  return null;
}

function boardStartRowVisible() {
  if (typeof S === "undefined" || !S.boardChatHome) return false;
  if (S.chatFilterEventId || S.boardComposerOpen || S.boardFromChat || S.boardContinueSeparate || S.replyToMessage || S.boardConnect) return false;
  return true;
}

function boardStartOwnsRun(conversationId, replyTo) {
  if (!replyTo || !conversationId || !boardStartRowVisible()) return false;
  const last = boardLatestStartMessage();
  if (!last) return false;
  const list = typeof boardActiveMessages === "function" ? boardActiveMessages() : [];
  return boardMessageConversationId(last, list) === conversationId;
}

function boardEnsureOpenComposer() {
  if (typeof S === "undefined" || !S.boardChatHome || S.boardConnect || S.boardFromChat) return;
  S.boardComposerOpen = true;
  if (S.chatFilterEventId) {
    S.boardContinueSeparate = false;
    S.boardComposeEventId = null;
    if (!S.boardContinuing && !S.replyToMessage) boardPinContinueTarget();
    return;
  }
  if (S.replyToMessage) return;
  S.boardContinuing = null;
  S.boardContinueAnchor = null;
  S.boardContinueSeparate = false;
  S.boardComposeEventId = null;
  const mem = boardChatMemory();
  mem.continuing = null;
  mem.anchor = null;
  mem.separate = false;
}

function boardContinueWhenDetail(ev) {
  const date = boardEventTabDate(ev);
  const time = typeof timelineTimeLabel === "function" ? timelineTimeLabel(ev, false) : "";
  return [date, time].filter(Boolean).join(" · ");
}

/** Live events this board's chat can attach messages to. */
/** This board's own events: the same list as the top bar's dropdown.
 *  Null outside a board, where the older chat-link lookup still applies.
 *  (A chat can also have other boards' event channels importing into it, and
 *  its messages can mention their events; neither belongs in tagging.) */
function boardOwnEvents() {
  if (typeof boardEventNavEvents !== "function") return null;
  if (typeof conversationActiveEventChannel === "function" && !conversationActiveEventChannel()) return null;
  return boardEventNavEvents();
}

function boardAddEventChoices() {
  const own = boardOwnEvents();
  if (own) return own;
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const events = typeof channelEventsForPanelChat === "function" && typeof S !== "undefined" && S.activeView?.id
    ? channelEventsForPanelChat({ id: S.activeView.id, kind: "chat" })
    : (conn?.events || []);
  return boardLiveEvents(events);
}

function boardContinueEventTargets() {
  const list = boardContinuationMessages();
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const own = boardOwnEvents();
  const ownIds = own ? new Set(own.map((ev) => ev.id)) : null;
  const seen = new Set();
  const targets = [];
  for (let i = (list || []).length - 1; i >= 0; i--) {
    const message = list[i];
    if (!message || message.activity || message._eventLinkMarker) continue;
    if (typeof boardMessageIsFolded === "function" && boardMessageIsFolded(message, conn?.events, conn)) continue;
    const conversationId = boardMessageConversationId(message, list);
    const eventId = boardConversationEventId(list, conversationId) || boardMessageEventId(message);
    if (!eventId || seen.has(eventId) || (ownIds && !ownIds.has(eventId))) continue;
    const ev = typeof boardFindEvent === "function" ? boardFindEvent(eventId, null, conn) : null;
    if (!ev || ev._missing || boardEventCompleted(ev)) continue;
    seen.add(eventId);
    targets.push({ eventId, conversationId, event: ev });
  }
  for (const ev of boardAddEventChoices()) {
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    targets.push({ eventId: ev.id, conversationId: null, event: ev });
  }
  return targets;
}

function boardOutgoingTag() { return boardDestinationRoute(); }

function boardApplyTag(channelId, messageId, eventId, conversationId, conn) {
  if (typeof send !== "function") return;
  const owner = conn || (typeof activeConn === "function" ? activeConn() : null);
  send({
    type: "tagMessageEvents",
    channelId,
    messageId,
    mentionedEventIds: eventId ? [eventId] : [],
    eventId: eventId || null,
    clear: !eventId,
    conversationId: conversationId || null,
  }, owner?.id);
}

const BOARD_LINK_KEY = "phlip-board-link-v1";

const BOARD_CHAIN_KEY = "phlip-board-chain-v1";

function boardLinkMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(BOARD_LINK_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function boardLinkBucket(channelId) {
  const all = boardLinkMap();
  const key = String(channelId || "");
  if (!all[key]) all[key] = {};
  return { all, key, bucket: all[key] };
}

function boardSaveLinkMap(all) {
  try { localStorage.setItem(BOARD_LINK_KEY, JSON.stringify(all)); } catch {}
}

function boardChainMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(BOARD_CHAIN_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function boardChainBucket(channelId) {
  const all = boardChainMap();
  const key = String(channelId || "");
  if (!all[key] || typeof all[key] !== "object") all[key] = {};
  return { all, key, bucket: all[key] };
}

function boardRememberChain(channelId, messageId, conversationId) {
  if (!channelId || !messageId || !conversationId) return;
  const state = boardChainBucket(channelId);
  if (state.bucket[messageId] === conversationId) return;
  state.bucket[messageId] = conversationId;
  try { localStorage.setItem(BOARD_CHAIN_KEY, JSON.stringify(state.all)); } catch {}
}

function boardKeepChains(list) {
  const channelId = typeof S !== "undefined" ? (S.activeView?.id || "") : "";
  if (!channelId) return;
  const saved = boardChainBucket(channelId).bucket;
  for (const m of list || []) {
    if (!m?.id || m.activity || m._eventLinkMarker) continue;
    if (!m.conversationId && saved[m.id]) {
      m.conversationId = saved[m.id];
      if (!boardMessageEventId(m)) boardApplyTag(channelId, m.id, null, m.conversationId);
    }
    if (m.conversationId) boardRememberChain(channelId, m.id, m.conversationId);
  }
}

function boardRememberPriors(channelId, snapshot) {
  const state = boardLinkBucket(channelId);
  for (const row of snapshot) {
    if (!row?.id || state.bucket[row.id]) continue;
    state.bucket[row.id] = {
      conversationId: row.conversationId || null,
      eventId: row.eventId || null,
    };
  }
  boardSaveLinkMap(state.all);
}

function boardMessageSnapshot(list, messages) {
  return (messages || []).filter((m) => m && m.id).map((m) => ({
    id: m.id,
    conversationId: m.conversationId || boardMessageConversationId(m, list),
    eventId: boardMessageEventId(m) || null,
    replyToId: m.replyToId || null,
  }));
}

function boardWriteMessageScope(m, conversationId, eventId, conn, channelId) {
  m.conversationId = conversationId;
  boardRememberChain(channelId, m.id, conversationId);
  if (eventId) {
    m.mentionedEventIds = [eventId];
    m.eventId = eventId;
  } else {
    m.mentionedEventIds = null;
    m.eventId = null;
  }
  boardApplyTag(channelId, m.id, eventId, conversationId, conn);
}

function boardRestoreSnapshot(channelId, snapshot) {
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const list = conn?.messages?.[channelId] || [];
  const state = boardLinkBucket(channelId);
  for (const row of snapshot || []) {
    const m = list.find((x) => x.id === row.id);
    if (!m) continue;
    m.replyToId = row.replyToId || null;
    boardWriteMessageScope(m, row.conversationId, row.eventId, conn, channelId);
    delete state.bucket[row.id];
  }
  boardSaveLinkMap(state.all);
  try { if (typeof cacheConn === "function") cacheConn(conn); } catch {}
  if (typeof renderView === "function") renderView(true);
}

function boardNotifyConnected(eventId) {
  const ev = boardFindEvent(eventId, null, typeof activeConn === "function" ? activeConn() : null);
  const title = ev ? boardEventTitle(ev) : "this event";
  if (typeof AshFeedback !== "undefined" && typeof AshFeedback.toast === "function") {
    AshFeedback.toast(`Conversation connected to ${title}`);
  }
}

function boardAttachConversation(channelId, conversationId, eventId) {
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const list = conn?.messages?.[channelId] || [];
  const members = boardConversationMessages(list, conversationId);
  const had = boardConversationEventId(list, conversationId);
  const snapshot = boardMessageSnapshot(list, members);
  if (eventId && !had) boardRememberPriors(channelId, snapshot);
  for (const m of members) boardWriteMessageScope(m, conversationId, eventId, conn, channelId);
  try { if (typeof cacheConn === "function") cacheConn(conn); } catch {}
  if (typeof renderView === "function") renderView(true);
  if (eventId && !had) boardNotifyConnected(eventId);
}

function boardFreshConversationId() {
  return typeof genLocalId === "function" ? genLocalId() : ("c" + Date.now().toString(36));
}

function boardMessageChainSize(list, message) {
  if (!message) return 0;
  const cid = boardMessageConversationId(message, list);
  return boardConversationMessages(list, cid).length;
}

function boardCancelReply() {
  if (typeof S === "undefined" || !S.boardChatHome || !S.replyToMessage) return;
  const live = document.querySelector("#composer-input");
  const draft = live ? (live.value || "") : "";
  const anchor = boardScrollAnchor();
  S.replyToMessage = null;
  const mem = boardChatMemory();
  mem.draft = draft;
  mem.continuing = S.boardContinuing || null;
  mem.anchor = S.boardContinueAnchor || null;
  mem.separate = false;
  mem.saved = true;
  if (typeof renderView === "function") renderView(true);
  boardApplyComposerMemory(false);
  boardRestoreScrollAnchor(anchor);
  boardFocusComposerInput();
  boardSyncConnector(document.getElementById("view"));
}

function boardBeginContinue(messageId, opts) {
  if (S.boardChatHome && !S.conversationsThread?.eventId) { boardDestinationContinue(messageId, opts); return; }
  const list = boardContinuationMessages();
  const m = list.find((x) => x.id === messageId);
  if (!m) return;
  const eventId = boardConversationEventId(list, boardMessageConversationId(m, list)) || boardMessageEventId(m);
  if (eventId && S.boardChatHome && !(opts && opts.keepReply)) {
    const ev = boardFindEvent(eventId, null, typeof activeConn === "function" ? activeConn() : null);
    if (!ev || ev._missing || boardEventCompleted(ev) || boardArchiveOn()) return;
    boardSaveChatMemory();
    S.replyToMessage = null;
    S.boardContinuing = null;
    S.boardContinueSeparate = false;
    S.boardContinueAnchor = null;
    S.boardSendContinue = true;
    if (typeof renderView === "function") renderView(true);
    boardApplyComposerMemory(false);
    boardFocusComposerInput();
    return;
  }
  if (typeof S !== "undefined") {
  }
  const keepReply = !!(opts && opts.keepReply);
  const reply = keepReply ? S.replyToMessage : null;
  const live = document.querySelector("#composer-input");
  const draft = live ? (live.value || "") : "";
  const cid = boardMessageConversationId(m, list);
  if (S.chatFilterEventId && boardMessageEventId(m) && boardMessageEventId(m) !== S.chatFilterEventId) {
    boardSelectTab(null);
  }
  S.replyToMessage = reply;
  S.boardConnect = null;
  S.boardContinueSeparate = false;
  S.boardComposerOpen = true;
  S.boardContinuing = cid;
  S.boardContinueAnchor = m.id;
  S.boardComposeEventId = null;
  S.boardSeparateUndo = null;
  const mem = boardChatMemory();
  mem.draft = draft;
  mem.continuing = cid;
  mem.anchor = m.id;
  mem.separate = false;
  mem.undoContinuing = null;
  mem.undoAnchor = null;
  mem.saved = true;
  if (typeof renderView === "function") renderView(true);
  boardApplyComposerMemory(false);
  boardScanToContinued(m.id, true);
  boardFocusComposerInput();
  boardExpandComposer();
}
