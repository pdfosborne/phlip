/* board-home.js — All chat wiring: chat memory and scroll anchor, the
 * filtered-event header, boardWireComposer (runs after every render), and
 * clicks in the chat stream (boardHandleStreamClick).
 *
 * The rest of All chat lives in: board-model.js (events and messages),
 * board-card.js (event card), board-feed.js (rows), board-continue.js
 * (continue / reply / tags), board-composer.js (message box),
 * board-from-chat.js (event draft from chat), board-select.js (selection),
 * board-event-nav.js (event bar, list, stepper), board-destination.js (# tag).
 *
 * Globals in:  shared board/chat state (S, Nav, activeConn), the files above
 * Globals out: boardWireComposer, boardHandleStreamClick, boardReturnToChat,
 *              boardSyncEventHead, boardOnEventPage, boardSaveChatMemory
 * Load after:  board-from-chat.js
 * Load before: board-select.js
 *
 * Must not: ES modules, bundlers, unrelated feature work
 */

function boardChatMemory() {
  if (typeof S === "undefined") {
    return { eventId: null, draft: "", scroll: 0, continuing: null, anchor: null, separate: false, saved: false };
  }
  if (!S.boardChatMemory) {
    S.boardChatMemory = { eventId: null, draft: "", scroll: 0, continuing: null, anchor: null, separate: false, saved: false };
  }
  if (S.boardChatMemory.anchor === undefined) S.boardChatMemory.anchor = null;
  if (S.boardChatMemory.separate === undefined) S.boardChatMemory.separate = false;
  return S.boardChatMemory;
}

/** Where the reader is: the first visible message and its offset, or "at the
 *  end". Survives re-renders that change content height, unlike scrollTop. */
function boardScrollAnchor() {
  const scroll = document.querySelector("#chat-scroll");
  if (!scroll) return null;
  const atEnd = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 48;
  const top = scroll.getBoundingClientRect().top;
  for (const el of scroll.querySelectorAll(".msg[data-msg-id]")) {
    const r = el.getBoundingClientRect();
    if (r.height && r.bottom > top + 1) return { msgId: el.dataset.msgId || "", offset: r.top - top, atEnd };
  }
  return { msgId: "", offset: 0, atEnd: true };
}

/** Restore boardScrollAnchor(). No anchor, "at end", or a message that is no
 *  longer rendered all land on the latest message, never the top. */
function boardRestoreScrollAnchor(anchor) {
  const scroll = document.querySelector("#chat-scroll");
  if (!scroll) return;
  const toEnd = () => { scroll.scrollTop = scroll.scrollHeight; };
  if (!anchor || anchor.atEnd || !anchor.msgId) { toEnd(); return; }
  const sel = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(anchor.msgId) : String(anchor.msgId).replace(/"/g, "");
  const el = scroll.querySelector(`.msg[data-msg-id="${sel}"]`);
  if (!el) { toEnd(); return; }
  scroll.scrollTop += (el.getBoundingClientRect().top - scroll.getBoundingClientRect().top) - (anchor.offset || 0);
}

function boardSaveChatMemory() {
  const mem = boardChatMemory();
  const input = document.querySelector("#composer-input");
  mem.eventId = (typeof S !== "undefined" && S.chatFilterEventId) || null;
  mem.draft = input ? input.value : (mem.draft || "");
  if (input) { mem.selectionStart = input.selectionStart; mem.selectionEnd = input.selectionEnd; }
  mem.scroll = document.querySelector("#chat-scroll")?.scrollTop || 0;
  mem.scrollAnchor = boardScrollAnchor();
  mem.continuing = (typeof S !== "undefined" && S.boardContinuing) || null;
  mem.anchor = (typeof S !== "undefined" && S.boardContinueAnchor) || null;
  mem.separate = !!(typeof S !== "undefined" && S.boardContinueSeparate);
  const undo = typeof S !== "undefined" ? S.boardSeparateUndo : null;
  mem.undoContinuing = undo?.continuing || null;
  mem.undoAnchor = undo?.anchor || null;
  mem.saved = true;
  return mem;
}

function boardApplyComposerMemory(focus) {
  const mem = boardChatMemory();
  const input = document.querySelector("#composer-input");
  if (input && mem.draft && input.value !== mem.draft) input.value = mem.draft;
  if (input && mem.selectionStart != null) input.setSelectionRange(Math.min(mem.selectionStart, input.value.length), Math.min(mem.selectionEnd ?? mem.selectionStart, input.value.length));
  if (focus && input) {
    try { input.focus({ preventScroll: true }); } catch { try { input.focus(); } catch {} }
  }
  if (typeof boardSyncIme === "function") boardSyncIme();
}

function boardReturnToChat() {
  const mem = { ...boardChatMemory() };
  const liveAnchor = boardScrollAnchor();
  if (typeof S !== "undefined") {
    S.boardChatHome = true;
    S.boardPeoplePage = false;
    S.boardPeopleAccess = false;
    S.boardConnect = null;
    S.boardDisconnectPreview = null;
    S.boardContinuing = mem.continuing || null;
    S.boardContinueAnchor = mem.anchor || null;
    S.boardContinueSeparate = !!mem.separate;
    S.boardSeparateUndo = mem.undoContinuing || mem.undoAnchor
      ? { continuing: mem.undoContinuing || null, anchor: mem.undoAnchor || null }
      : null;
    S.boardComposerOpen = true;
  }
  if (typeof S !== "undefined" && mem.eventId && !S.boardContinueSeparate && !S.boardContinuing && !S.replyToMessage) {
    boardPinContinueTarget();
  }
  if (typeof S !== "undefined" && !mem.eventId && !S.replyToMessage) {
    S.boardContinuing = null;
    S.boardContinueAnchor = null;
    S.boardContinueSeparate = false;
  }
  if (typeof conversationsLandOnGeneralChat === "function") {
    conversationsLandOnGeneralChat({ eventId: mem.eventId || undefined });
  }
  Object.assign(boardChatMemory(), mem);
  boardApplyComposerMemory(false);
  document.querySelector("#composer-input")?.dispatchEvent(new Event("input", { bubbles: true }));
  boardRestoreScrollAnchor(mem.saved ? mem.scrollAnchor : liveAnchor);
  if (typeof syncBoardNavRow === "function") syncBoardNavRow();
}

function boardWireIme() {
  if (boardWireIme.done) return;
  boardWireIme.done = true;
  const place = () => boardSyncKeyboard();
  window.visualViewport?.addEventListener("resize", place);
  window.addEventListener("resize", place);
  window.addEventListener("ash-ime-inset", place);
  document.addEventListener("pointerdown", (e) => {
    if (typeof S === "undefined" || !S.boardChatHome) return;
    const tab = e.target && e.target.closest && e.target.closest("[data-board-tab]");
    const input = document.querySelector("#composer-input");
    boardComposerFocusWanted.want = !!(tab && input && document.activeElement === input);
  }, true);
  document.addEventListener("click", (e) => {
    if (!document.querySelector("#chat-scroll .board-rsvp-menu")) return;
    if (e.target.closest?.(".board-rsvp")) return;
    boardCloseRsvpMenu();
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !document.querySelector("#chat-scroll .board-rsvp-menu")) return;
    boardCloseRsvpMenu();
  });
  document.addEventListener("click", (e) => {
    const chip = e.target.closest?.("[data-board-archive-event]");
    if (!chip) return;
    e.preventDefault();
    boardSelectArchiveEvent(chip.dataset.boardArchiveEvent || "");
  });
}

/** The event a filtered or replying-into-event chat is showing, if any. */
function boardFocusEvent() {
  if (typeof S === "undefined" || !S.boardChatHome) return null;
  // The event page (Chat / Sign-ups / Details) has its own header.
  if (S.conversationsThread?.eventId) return null;
  const id = S.chatFilterEventId;
  if (!id) return null;
  const ev = boardFindEvent(id, null, typeof activeConn === "function" ? activeConn() : null);
  return ev && !ev._missing ? ev : null;
}

/** In an event's own chat the header becomes the event: back to All chat,
 *  title + when (opens the event), and RSVP. Replaces the pinned card row. */
function boardSyncEventHead() {
  const head = document.querySelector("header.main-head");
  if (!head) return;
  const ev = boardFocusEvent();
  const old = head.querySelector("#board-event-head");
  document.body.classList.toggle("board-event-focus", !!ev);
  if (!ev) { old?.remove(); return; }
  const title = boardEventTitle(ev);
  const when = typeof conversationWhenLabel === "function" ? conversationWhenLabel(ev) : "";
  const where = ev._where || "";
  const detail = [when || "Time to be decided", where].filter(Boolean).join(" · ");
  const mine = typeof timelineMyRsvp === "function" ? timelineMyRsvp(ev) : null;
  const back = typeof ic === "function" ? ic("chevron-left") : "‹";
  const html = `<div id="board-event-head" class="board-event-head is-rsvp-${typeof boardEventRsvpState === "function" ? boardEventRsvpState(ev) : "none"}" data-event="${esc(ev.id)}">
    <button type="button" class="board-event-head-back" data-event-head-back aria-label="Back to all chat">${back}</button>
    <button type="button" class="board-event-head-title" data-event-head-open aria-label="Open ${esc(title)}">
      <span class="board-event-head-name">${esc(title)}</span>
      <span class="board-event-head-when">${esc(detail)}</span>
    </button>
    ${boardEventRsvpControl(mine, ev)}
  </div>`;
  const key = `${ev.id}|${title}|${detail}|${mine || ""}`;
  if (old && old.dataset.key === key) return;
  old?.remove();
  head.insertAdjacentHTML("beforeend", html);
  const el = head.querySelector("#board-event-head");
  el.dataset.key = key;
  el.querySelector("[data-event-head-back]")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (typeof boardShowAllChat === "function") boardShowAllChat();
  });
  el.querySelector("[data-event-head-open]")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (typeof boardOpenEventPage === "function") boardOpenEventPage(ev.id);
  });
  el.querySelector("[data-board-rsvp-menu]")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof openEventRsvpMenu === "function") {
      openEventRsvpMenu(ev, e.currentTarget, () => { if (typeof renderView === "function") renderView(true); });
    }
  });
}

/** The event page (Chat / Sign-ups / Details tabs) keeps its original layout:
 *  none of the All chat feed styling applies there. */
function boardOnEventPage() {
  return !!(typeof S !== "undefined" && S.conversationsThread?.eventId);
}

function boardWireComposer(view) {
  if (view) boardDestinationWire(view);
  if (!view) return;
  view.querySelector("#chat-scroll")?.classList.toggle("is-board-feed", typeof S !== "undefined" && !!S.boardChatHome && !boardOnEventPage());
  boardSyncEventHead();
  if (boardOnEventPage() && typeof boardSelectClear === "function") boardSelectClear();
  if (typeof S !== "undefined" && S.boardChatHome && !boardOnEventPage()) {
    boardWireJumpLatest(view);
    if (typeof boardSelectSync === "function") boardSelectSync();
  }
  // Event bar + stepper (board-event-nav.js): removes itself outside All chat.
  if (typeof boardEventNavSync === "function") {
    boardEventNavSync(view);
    clearTimeout(boardWireComposer.seenTimer);
    boardWireComposer.seenTimer = setTimeout(() => {
      if (typeof boardEventNavMarkSeen === "function") boardEventNavMarkSeen();
    }, 500);
  }
  boardWireIme();
  const input = view.querySelector("#composer-input");
  if (input && !input._boardPinWired) {
    input._boardPinWired = true;
    input.addEventListener("keydown", (e) => boardComposerEnterSend(input, e));
    input.addEventListener("beforeinput", (e) => boardComposerEnterSend(input, e));
    input.addEventListener("input", () => {
      if (typeof S === "undefined" || !S.boardChatHome) return;
      boardFitComposerField(view);
      boardSyncClose(view);
      boardSyncConnector(view);
    });
    input.addEventListener("blur", () => boardMarkContinueFocus(false));
  }
  input?.addEventListener("focus", () => {
    boardSyncIme();
    if (typeof S !== "undefined" && S.boardSuppressComposerLock) S.boardSuppressComposerLock = false;
    boardMarkContinueFocus(true);
  });
  if (input && document.activeElement === input) boardMarkContinueFocus(true);
  boardWireFromChatBar(view);
  view.querySelector("[data-board-show-hidden]")?.addEventListener("click", () => {
    if (typeof renderView === "function") renderView(true);
  });
  boardCloseRsvpMenu();
  boardSyncClose(view);
  boardSyncIme();
  boardDockInlineComposer(view);
  boardFitComposerField(view);
  boardWireFieldActions(view);
  boardFloatComposer(view);
  boardSyncConnector(view);
  boardWirePullBreak(view);
}

function boardFocusHiddenIds() {
  return new Set();
}

function boardHiddenNoteHTML() {
  if (typeof S === "undefined" || !S.boardChatHome) return "";
  const list = boardActiveMessages();
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const n = boardFocusHiddenIds(list, S.chatFilterEventId || "", conn).size;
  if (!n) return "";
  const label = n === 1 ? "1 other message hidden" : `${n} other messages hidden`;
  return `<button type="button" class="board-hidden-note" data-board-show-hidden>${label}</button>`;
}

function boardFlashRun(el) {
  if (!el) return;
  el.classList.add("is-arrive");
  clearTimeout(el._boardArrive);
  el._boardArrive = setTimeout(() => el.classList.remove("is-arrive"), 1200);
}

async function boardShareEventIntoAllChat(conn, ev) {
  if (!conn || !ev?.id || ev.chainOf) return;
  if (ev.createdBy && conn.me?.id && ev.createdBy !== conn.me.id) return;
  if (typeof S !== "undefined" && S.createDraftFromChat) return;
  if (typeof send !== "function") return;
  if (typeof S !== "undefined") {
    if (!S.boardSeededEvents) S.boardSeededEvents = Object.create(null);
    if (S.boardSeededEvents[ev.id]) return;
  }
  const eventCh = (conn.channels || []).find((c) => c.id === ev.channelId && c.kind === "event");
  if (!eventCh) return;
  if (typeof boardUsesChatHome === "function" && !boardUsesChatHome(eventCh, conn)) return;
  const chatCh = typeof conversationGeneralChannel === "function"
    ? conversationGeneralChannel(eventCh, conn)
    : null;
  if (!chatCh?.id) return;
  const list = conn.messages?.[chatCh.id] || [];
  const already = list.some((m) => {
    if (!m || m.activity || m._eventLinkMarker) return false;
    if (typeof boardMessageEventId === "function" && boardMessageEventId(m) === ev.id) return true;
    return m.eventId === ev.id;
  });
  if (already) return;
  if (typeof S !== "undefined") S.boardSeededEvents[ev.id] = 1;
  const title = (typeof boardEventTitle === "function" ? boardEventTitle(ev) : "")
    || ev._title || ev.title || "Event";
  let text = String(title || "Event").trim() || "Event";
  if (conn.key && typeof encrypt === "function") {
    try { text = await encrypt(text, conn.key); } catch { /* keep plaintext */ }
  }
  const conversationId = typeof boardFreshConversationId === "function"
    ? boardFreshConversationId()
    : ("c" + Date.now().toString(36));
  send({
    type: "sendMessage",
    channelId: chatCh.id,
    text,
    eventId: ev.id,
    mentionedEventIds: [ev.id],
    conversationId,
  }, conn.id);
}

function boardOnEventCreated(conn, ev) {
  if (!ev?.id) return;
  if (ev.createdBy && conn?.me?.id && ev.createdBy !== conn.me.id) return;
  const pending = typeof S !== "undefined" ? S.boardPendingAttach : null;
  if (pending && pending.connId === conn?.id) {
    S.boardPendingAttach = null;
    boardAttachConversation(pending.channelId, pending.conversationId, ev.id);
    return;
  }
  void boardShareEventIntoAllChat(conn, ev);
}

function boardHandleStreamClick(e) {
  if (typeof boardSelectHandleClick === "function" && boardSelectHandleClick(e)) return true;
  // Web links (in a message, or an event's place) open in the browser or the
  // Maps app; nothing else on the row reacts to the tap.
  const link = e.target.closest?.("a[data-msg-link], a[data-board-place-link]");
  if (link && link.closest("#chat-scroll, #view")) return true;
  // An event icon in All chat: carry on in that event (tags the message box
  // and shows its stepper; the keyboard waits for a tap on the box).
  const lead = e.target.closest?.("[data-board-lead], [data-board-lead-event]");
  if (lead && lead.closest("#chat-scroll")) {
    e.preventDefault();
    // The icon of the event already in focus: tap again to leave it.
    const leadEvent = lead.dataset.boardLeadEvent || lead.closest("[data-event]")?.dataset.event || "";
    if (leadEvent && typeof S !== "undefined" && S.boardEventStep?.eventId === leadEvent && typeof boardEventFocusExit === "function") {
      boardEventFocusExit();
    } else if (lead.dataset.boardLead) {
      if (typeof boardBeginContinue === "function") boardBeginContinue(lead.dataset.boardLead);
    } else if (typeof boardDestinationSet === "function") {
      // An event card: carry on in the event's latest conversation, if any.
      const eventId = lead.dataset.boardLeadEvent;
      const conn = typeof activeConn === "function" ? activeConn() : null;
      const ev = boardFindEvent(eventId, null, conn);
      if (ev && !ev._missing && !boardEventCompleted(ev)) {
        const list = boardActiveMessages();
        boardDestinationSet({ eventId, conversationId: boardLatestEventConversation(list, eventId) || null, label: boardEventTitle(ev) });
      }
    }
    return true;
  }
  const older = e.target.closest?.("[data-board-open-archive]");
  if (older && older.closest("#chat-scroll")) {
    e.preventDefault();
    if (typeof boardOpenPage === "function") boardOpenPage("archive");
    return true;
  }
  // A message's #label opens its event (the icon is how you focus on it).
  const tag = e.target.closest?.("[data-event-tag]");
  if (tag && tag.closest("#chat-scroll")) {
    e.preventDefault();
    if (typeof boardOpenEventPage === "function") boardOpenEventPage(tag.dataset.eventTag);
    return true;
  }
  if (typeof S !== "undefined" && !S.boardFromChat) {
    const mark = e.target.closest?.(".msg-plan-hit.is-mark");
    const marked = mark?.closest?.(".msg[data-msg-id]");
    if (mark && marked && marked.closest("#chat-scroll")) {
      e.preventDefault();
      const id = marked.dataset.msgId || "";
      if (id) {
        const chain = boardFromChatChain(id);
        const list = typeof boardActiveMessages === "function" ? boardActiveMessages() : [];
        const source = list.find((m) => m && m.id === id);
        const eventId = boardMessageEventId(source);
        const conn = typeof activeConn === "function" ? activeConn() : null;
        const ev = eventId ? boardFindEvent(eventId, null, conn) : null;
        const updating = !!(ev && (typeof canEditEvent !== "function" || canEditEvent(ev)));
        const kept = boardScrollAnchor();
        S.boardFromChat = {
          selected: updating ? [id] : chain.ids,
          dropped: {},
          conversationId: chain.conversationId,
          eventId: updating ? eventId : "",
        };
        if (typeof renderView === "function") renderView(true);
        boardRestoreScrollAnchor(kept);
        boardRevealFromChat();
      }
      return true;
    }
  }
  if (typeof S !== "undefined" && S.boardFromChat) {
    const msg = e.target.closest?.("#chat-scroll .msg[data-msg-id]");
    if (msg && !e.target.closest("button, a, input, textarea")) {
      e.preventDefault();
      if (S.boardFromChat.correcting) {
        boardCorrectFromChatTap(msg, e.target);
        return true;
      }
      if (msg.dataset.fromChat === "1") {
        const id = msg.dataset.msgId || "";
        const selected = S.boardFromChat.selected || [];
        S.boardFromChat.selected = selected.includes(id)
          ? selected.filter((item) => item !== id)
          : selected.concat(id);
        boardSyncFromChat();
      }
      return true;
    }
  }
  const collapse = e.target.closest("[data-board-collapse]");
  if (collapse) {
    e.preventDefault();
    const eventId = collapse.dataset.boardCollapse || "";
    if (eventId) {
      boardSetEventOverride(eventId, true);
      if (typeof renderView === "function") renderView(true);
    }
    return true;
  }
  const rsvpMenu = e.target.closest(".board-event-card [data-board-rsvp-menu]");
  if (rsvpMenu) {
    e.preventDefault();
    if (rsvpMenu.getAttribute("aria-expanded") === "true") {
      boardCloseRsvpMenu();
      if (typeof timelineCloseQuickMenu === "function") timelineCloseQuickMenu();
    } else boardOpenRsvpMenu(rsvpMenu);
    return true;
  }
  const openPage = e.target.closest("[data-board-event-page]");
  // The whole event box opens the event, except its RSVP and "Show chat".
  if (openPage && !e.target.closest(".board-rsvp, [data-board-show], [data-board-rsvp-menu]")) {
    e.preventDefault();
    boardOpenEventPage(openPage.dataset.boardEventPage);
    return true;
  }
  const show = e.target.closest("[data-board-show]");
  if (show) {
    e.preventDefault();
    boardSetEventOverride(show.dataset.boardShow, false);
    if (typeof renderView === "function") renderView(true);
    return true;
  }
  const gap = e.target.closest("[data-board-gap]");
  if (gap) {
    e.preventDefault();
    if (!S.boardExpandedGaps) S.boardExpandedGaps = {};
    const key = gap.dataset.boardGap;
    S.boardExpandedGaps[key] = !S.boardExpandedGaps[key];
    if (typeof renderView === "function") renderView(true);
    return true;
  }
  const eventTasks = e.target.closest("[data-board-event-tasks]");
  if (eventTasks) {
    e.preventDefault();
    if (!S.boardExpandedEventTasks) S.boardExpandedEventTasks = {};
    const key = eventTasks.dataset.boardEventTasks;
    S.boardExpandedEventTasks[key] = !S.boardExpandedEventTasks[key];
    if (typeof renderView === "function") renderView(true);
    return true;
  }
  const eventTaskComplete = e.target.closest(".board-event-task-complete");
  if (eventTaskComplete) {
    e.preventDefault();
    const row = eventTaskComplete.closest(".board-event-task-row");
    const taskId = row?.dataset.taskId || "";
    const conn = typeof activeConn === "function" ? activeConn() : null;
    const task = (conn?.tasks || []).find((item) => item.id === taskId);
    if (task && typeof TaskChannelUI?.setCompletedFromChat === "function") {
      TaskChannelUI.setCompletedFromChat(conn, task, true);
    }
    return true;
  }
  return false;
}
