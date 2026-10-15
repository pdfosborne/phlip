/* board-feed.js — All chat rows (messages, #labels, chains), board navigation
 * and the archive rail.
 *
 * Globals in:  shared board/chat state (S, Nav, activeConn), board-model.js,
 *              board-card.js
 * Globals out: boardHomeRows, boardMessageHTML, boardChainRows, boardSelectTab,
 *              boardOpenEventPage, boardEventTagHTML, boardMessageWhenLabel
 * Load after:  board-card.js
 * Load before: board-pages.js
 *
 * Must not: ES modules, bundlers, unrelated feature work
 */

function boardOpenEventPage(eventId) {
  if (!eventId || typeof S === "undefined") return;
  const mem = typeof boardSaveChatMemory === "function" ? boardSaveChatMemory() : null;
  if (mem) {
    mem.continuing = null;
    mem.anchor = null;
    mem.separate = false;
  }
  S.boardContinuing = null;
  S.boardContinueAnchor = null;
  S.boardContinueSeparate = false;
  S.boardComposerOpen = false;
  if (typeof boardClearContinueScan === "function") boardClearContinueScan();
  S.boardConnect = null;
  S.boardDisconnectPreview = null;
  S.replyToMessage = null;
  S.autoTagEventId = null;
  S.memoryChatReadonly = false;
  S.conversationsThread = { eventId, tab: "chat" };
  S.chatFilterEventId = eventId;
  S.chatFilterUntagged = false;
  S.mentionedEventIds = [eventId];
  S.taggedEventId = eventId;
  if (typeof renderView === "function") renderView(false, { force: true });
}

function boardSelectTab(eventId, opts) {
  if (typeof S === "undefined") return;
  S.boardArchive = !!(opts && opts.archive) && !eventId;
  if (!opts || !opts.archive || eventId) S.boardArchiveEventId = null;
  const mem = boardSaveChatMemory();
  mem.continuing = null;
  mem.anchor = null;
  mem.separate = false;
  S.boardChatHome = true;
  S.boardContinuing = null;
  S.boardContinueAnchor = null;
  S.boardContinueSeparate = false;
  S.boardSeparateUndo = null;
  S.boardComposerOpen = true;
  S.boardComposeEventId = null;
  if (typeof boardClearContinueScan === "function") boardClearContinueScan();
  if (!opts?.preserveDraft) mem.draft = "";
  S.boardConnect = null;
  S.boardDisconnectPreview = null;
  S.replyToMessage = null;
  S.boardAddPick = null;
  S.conversationsThread = null;
  S.autoTagEventId = null;
  S.chatMoveSelect = null;
  if (!eventId) {
    S.chatFilterEventId = null;
    S.chatFilterUntagged = false;
    S.mentionedEventIds = [];
    S.taggedEventId = null;
  } else {
    S.chatFilterEventId = eventId;
    S.chatFilterUntagged = false;
    S.mentionedEventIds = [eventId];
    S.taggedEventId = eventId;
    const conn = typeof activeConn === "function" ? activeConn() : null;
    const chId = S.activeView?.id;
    try {
      if (typeof markEventChatFilterSeen === "function" && conn && chId) {
        markEventChatFilterSeen(conn, chId, eventId, boardActiveMessages());
      }
    } catch {}
    boardPinContinueTarget();
  }
  if (typeof renderView === "function") renderView(false, { force: true });
}

function boardSelectArchive() {
  if (boardArchiveOn()) return;
  boardSelectTab(null, { archive: true });
}

function boardPageKind() {
  if (typeof S !== "undefined" && S.boardPeoplePage) return "people";
  if (typeof conversationChatSurfaceOn === "function" && conversationChatSurfaceOn()) return "chat";
  const eventCh = typeof conversationActiveEventChannel === "function" ? conversationActiveEventChannel() : null;
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const view = typeof S !== "undefined" ? S.activeView : null;
  const taskCh = typeof conversationTaskChannel === "function" ? conversationTaskChannel(eventCh, conn) : null;
  if (taskCh && view?.kind === "channel" && view.id === taskCh.id) return "tasks";
  if (eventCh && typeof isBoardPollsView === "function" && isBoardPollsView(eventCh, conn)) return "polls";
  if (eventCh && typeof isBoardAgendaView === "function" && isBoardAgendaView(eventCh, conn)) return "timeline";
  return "";
}

function syncBoardNavRow() {
  // Header overlays follow the view: the event head and selection bar only
  // belong to the board chat.
  if (typeof boardSyncEventHead === "function") boardSyncEventHead();
  if (typeof S !== "undefined" && !S.boardChatHome && S.boardSelect && typeof boardSelectClear === "function") boardSelectClear();
  if (typeof boardEventNavSync === "function") boardEventNavSync();
  const row = document.getElementById("board-nav-row");
  const tabs = document.getElementById("board-event-tabs");
  const back = document.getElementById("board-back-chat");
  if (!row || !tabs) return;
  const eventCh = typeof conversationActiveEventChannel === "function" ? conversationActiveEventChannel() : null;
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const show = !!(typeof S !== "undefined" && S.boardChatHome && !S.conversationsThread?.eventId && eventCh
    && typeof boardUsesChatHome === "function" && boardUsesChatHome(eventCh, conn));
  row.hidden = !show;
  if (!show) {
    return;
  }
  if (back && !back.dataset.wired) {
    back.dataset.wired = "1";
    back.addEventListener("click", () => boardReturnToChat());
  }
  const page = boardPageKind();
  const chat = page === "chat";
  if (back) back.hidden = chat;
  tabs.hidden = !chat;
  if (!chat) {
    tabs.innerHTML = "";
    return;
  }
  const archiveOn = boardArchiveOn();
  tabs.removeAttribute("role");
  tabs.setAttribute("aria-label", "Chat navigation");
  tabs.innerHTML = archiveOn
    ? `<button type="button" class="board-all-chat" data-board-all-chat>← All chat</button>${boardArchiveAgeButtonHTML()}` : "";
  tabs.querySelector("[data-board-all-chat]")?.addEventListener("click", boardShowAllChat);
  tabs.querySelector("[data-board-archive-age]")?.addEventListener("click", (e) => {
    e.preventDefault();
    boardOpenArchiveAgeMenu(e.currentTarget);
  });
  row.hidden = !archiveOn;

}

/* ── Archive age (set in the Archive view) ──────────────────────────────
   "Older than 2 weeks ⌄" says what Archive holds and changes it: 1 week,
   2 weeks, 1 month or Never (per board, on this device). */
function boardArchiveAgeLabel(days) {
  const hit = (typeof BOARD_ARCHIVE_CHOICES !== "undefined" ? BOARD_ARCHIVE_CHOICES : []).find(([n]) => n === days);
  return days ? `Older than ${hit ? hit[1] : `${days} days`}` : "Archiving off";
}

function boardArchiveAgeButtonHTML() {
  const days = typeof boardArchiveDays === "function" ? boardArchiveDays() : 14;
  const chev = typeof ic === "function" ? ic("chevron-down") : "";
  return `<button type="button" class="board-archive-age" data-board-archive-age aria-haspopup="menu" aria-expanded="false" aria-label="Chat moves here when ${esc(boardArchiveAgeLabel(days).toLowerCase())}, change">${esc(boardArchiveAgeLabel(days))}${chev}</button>`;
}

function boardCloseArchiveAgeMenu() {
  document.querySelectorAll(".board-archive-age-menu").forEach((el) => el.remove());
  document.querySelectorAll("[data-board-archive-age]").forEach((b) => b.setAttribute("aria-expanded", "false"));
}

function boardOpenArchiveAgeMenu(btn) {
  if (document.querySelector(".board-archive-age-menu")) { boardCloseArchiveAgeMenu(); return; }
  const days = typeof boardArchiveDays === "function" ? boardArchiveDays() : 14;
  const check = typeof ic === "function" ? ic("check") : "✓";
  const menu = document.createElement("div");
  menu.className = "board-archive-age-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `<p class="board-archive-age-kicker">Move chat here after</p>${(typeof BOARD_ARCHIVE_CHOICES !== "undefined" ? BOARD_ARCHIVE_CHOICES : []).map(([n, label]) =>
    `<button type="button" role="menuitemradio" aria-checked="${n === days ? "true" : "false"}" data-archive-days="${n}"><span>${esc(label)}</span>${n === days ? check : ""}</button>`).join("")}`;
  document.body.appendChild(menu);
  const r = btn.getBoundingClientRect();
  menu.style.top = `${Math.round(r.bottom + 4)}px`;
  menu.style.right = `${Math.round(Math.max(8, window.innerWidth - r.right))}px`;
  btn.setAttribute("aria-expanded", "true");
  menu.addEventListener("click", (e) => {
    const pick = e.target.closest?.("[data-archive-days]");
    if (!pick) return;
    e.preventDefault();
    boardCloseArchiveAgeMenu();
    if (typeof boardSetArchiveDays === "function") boardSetArchiveDays(Number(pick.dataset.archiveDays));
    if (typeof renderView === "function") renderView(true);
  });
  const away = (e) => {
    if (e.target.closest?.(".board-archive-age-menu, [data-board-archive-age]")) return;
    boardCloseArchiveAgeMenu();
    document.removeEventListener("pointerdown", away, true);
  };
  document.addEventListener("pointerdown", away, true);
}

/** Back to plain All chat: out of Archive (and its event filter) and off any
 *  message box tag. */
function boardShowAllChat() {
  boardCloseArchiveAgeMenu();
  if (typeof S !== "undefined") {
    S.boardArchive = false;
    S.boardArchiveEventId = null;
  }
  boardDestinationSet(null);
}

/** Chat to make an event from: any message in All chat (not activity). */
function boardHasChatMessages() {
  const list = typeof boardActiveMessages === "function" ? boardActiveMessages() : [];
  return (list || []).some((m) => m && !m.activity && !m._eventLinkMarker && !m._archiveCard);
}

/** "+" and "New event": events are made from chat, in quick create (empty,
 *  filled by tapping words, typing or picking). With no chat yet there's
 *  nothing to make one from, so the buttons are muted and say so. */
function boardOpenQuickCreate() {
  if (typeof boardWritableCreateChannel !== "function" || !boardWritableCreateChannel()) {
    try { toast("Couldn't save that event on this board"); } catch {}
    return;
  }
  if (!boardHasChatMessages()) {
    try { toast("Send a message first \u2014 events are made from chat"); } catch {}
    return;
  }
  if (typeof S === "undefined") return;
  if (typeof boardSelectActive === "function" && boardSelectActive() && typeof boardSelectClear === "function") boardSelectClear();
  S.boardFromChat = { selected: [], dropped: {}, conversationId: null, eventId: "" };
  if (typeof renderView === "function") renderView(true);
}

function boardOpenCreateEvent() {
  if (typeof featureParked === "function" && featureParked("manualCreate")) {
    boardOpenQuickCreate();
    return;
  }
  const eventCh = typeof boardWritableCreateChannel === "function"
    ? boardWritableCreateChannel()
    : null;
  if (!eventCh) {
    try { toast("Couldn't save that event on this board"); } catch {}
    return;
  }
  const conn = typeof activeConn === "function" ? activeConn() : null;
  if (typeof openCreateDraft === "function") {
    openCreateDraft({
      createFromEvent: true,
      day: Date.now(),
      createChannelId: eventCh.id,
      createConnId: conn?.id || null,
    });
  }
}

function boardComposeCreateHTML() {
  const ico = typeof ic === "function" ? ic("plus") : "+";
  // The message box's button only tags ("#", normal weight); creating an
  // event moved to "+" in the event bar. While tagging it turns into ✕.
  void ico;
  return `<button type="button" class="board-compose-add" id="board-compose-add" aria-label="Tag an event" aria-haspopup="listbox"><span class="board-compose-plus-icon board-compose-hash-glyph" aria-hidden="true">#</span><span class="board-compose-hash-icon" aria-hidden="true">${typeof ic === "function" ? ic("x") : "\u00d7"}</span></button>`;
}

(function wireBoardComposeCreate() {
  if (typeof document === "undefined") return;
  const bind = () => {
    if (document.body.dataset.boardComposeCreateWired) return;
    document.body.dataset.boardComposeCreateWired = "1";
    document.addEventListener("click", (e) => {
      const btn = e.target.closest?.("#board-compose-add");
      if (!btn || btn.id !== "board-compose-add" || btn.classList.contains("board-archive")) return;
      e.preventDefault();
      if (btn.classList.contains("is-hash")) boardDestinationDismiss(document.activeElement?.id === "composer-input");
      else if (typeof boardDestinationStartHash === "function") boardDestinationStartHash(document.querySelector("#composer-input"));
    });
    // Keep focus where it is so tapping "+" never raises the keyboard.
    document.addEventListener("pointerdown", (e) => {
      if (e.target.closest?.("#board-compose-add")) e.preventDefault();
    });
  };
  if (document.body) bind();
  else document.addEventListener("DOMContentLoaded", bind);
})();

function boardArchiveRailHTML() {
  const events = boardArchiveEvents();
  const current = boardArchiveFilterId();
  const chip = (id, name, date, on) => {
    const mark = id ? `<span class="board-event-dot" aria-hidden="true"></span>` : "";
    const when = date ? `<span class="board-archive-chip-date">${esc(date)}</span>` : "";
    return `<button type="button" class="board-archive-chip${on ? " is-on" : ""}" data-board-archive-event="${esc(id)}" aria-pressed="${on ? "true" : "false"}">${mark}<span class="board-archive-chip-copy"><span class="board-archive-chip-name">${esc(name)}</span>${when}</span></button>`;
  };
  const chips = [
    chip("", "All", "", !current),
    ...events.map((ev) => chip(ev.id, eventShortName(ev), boardEventTabDate(ev), ev.id === current)),
  ];
  return `<div class="board-archive-rail" role="toolbar" aria-label="Archived events">${chips.join("")}</div>`;
}

function boardSelectArchiveEvent(eventId) {
  if (!boardArchiveOn() || typeof S === "undefined") return;
  const current = S.boardArchiveEventId || "";
  S.boardArchiveEventId = eventId && eventId !== current ? eventId : null;
  S.boardAddPick = null;
  if (typeof renderView === "function") renderView(true);
}

/** Short date divider label: "Today", "Yesterday", "Sun 27 Sep" (year only
 *  when it isn't this year). fmtDay stays as-is for event dates. */
function fmtDayRule(ts) {
  const d = new Date(Number(ts) || 0);
  const start = (x) => { const c = new Date(x); c.setHours(0, 0, 0, 0); return c.getTime(); };
  const diff = Math.round((start(Date.now()) - start(d)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  const opts = { weekday: "short", day: "numeric", month: "short" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("en-GB", opts).replace(",", "").replace("Sept", "Sep");
}

/** Message time in All chat. There are no day dividers there (they split
 *  conversations and floated over blocks), so older messages carry their day:
 *  "4:12pm", "Yesterday 4:12pm", "Sun 4:12pm" (this week), "27 Sep 4:12pm",
 *  "27 Sep 2025" (another year). */
function boardMessageWhenLabel(ts) {
  const t = Number(ts) || 0;
  const time = typeof fmtTime === "function" ? fmtTime(t) : "";
  if (!t) return time;
  const d = new Date(t);
  const start = (x) => { const c = new Date(x); c.setHours(0, 0, 0, 0); return c.getTime(); };
  const diff = Math.round((start(Date.now()) - start(d)) / 86400000);
  if (diff <= 0) return time;
  if (diff === 1) return `Yesterday ${time}`;
  if (diff < 7) return `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
  const dm = `${d.getDate()} ${d.toLocaleDateString("en-GB", { month: "short" }).replace("Sept", "Sep")}`;
  if (d.getFullYear() !== new Date().getFullYear()) return `${dm} ${d.getFullYear()}`;
  return `${dm} ${time}`;
}

/** Day dividers stay on the event page (its original layout) only. */
function boardShowsDayRules() {
  return typeof S !== "undefined" && !!S.conversationsThread?.eventId;
}

function boardSameDay(a, b) {
  return new Date(Number(a?.ts) || 0).toDateString() === new Date(Number(b?.ts) || 0).toDateString();
}

/** The event label on a message's name line: plain "#Event name" text, the
 *  same # as tagging in the message box. Every event message carries one, so
 *  a message without one is general chat. No colour: periwinkle marks the
 *  event in focus only. Tapping it brings that event into focus where you are
 *  (board-event-nav.js). */
function boardEventTagHTML(ev) {
  if (!ev || ev._missing) return "";
  const title = boardEventTitle(ev);
  const st = boardEventRsvpState(ev);
  return `<button type="button" class="msg-event-tag is-${st}" data-event-tag="${esc(ev.id)}" aria-label="${esc(title)}: open event"><span class="msg-event-tag-hash" aria-hidden="true">#</span><span class="msg-event-tag-name">${esc(boardEventShortLabel(ev))}</span></button>`;
}

/** A message with nothing to show (no text at all) is skipped rather than
 *  drawn as "…"; one whose text hasn't decrypted is retried once. Each skip
 *  is logged (ids and field names only) so the cause shows in the phone log. */
const boardTextlessLogged = new Set();
function boardMessageUnreadable(m, conn) {
  if (!m || m.activity || m.taskId || m._text !== undefined) return false;
  const wire = m.text;
  if (wire == null || wire === "") {
    if (m.id && !boardTextlessLogged.has(m.id)) {
      boardTextlessLogged.add(m.id);
      try { console.warn("[phlip-textless]", JSON.stringify({ id: m.id, channelId: m.channelId, keys: Object.keys(m).filter((k) => !/^_?text$/.test(k)), eventId: m.eventId || null })); } catch {}
    }
    return true;
  }
  if (!m._decRetry && typeof decMsg === "function") {
    m._decRetry = 1;
    decMsg(m, conn?.key).then(() => { if (typeof renderView === "function") renderView(true); }).catch(() => {});
  }
  return false;
}

function boardMessageHTML(m, { conn, list, event, showLabel, lighter, linked, grouped } = {}) {
  if (boardMessageUnreadable(m, conn)) return "";
  const who = m.name || m.userId || "?";
  const meId = conn?.me?.id || "";
  const title = event ? boardEventTitle(event) : "";
  const label = "";
  const phrase = title ? `tagged ${title}` : (linked ? "in a linked conversation" : "");
  const sr = phrase ? `<span class="conv-sr-only">${esc(phrase)}</span>` : "";
  const picking = typeof S !== "undefined" && !!S.boardFromChat;
  // The draft can use the selected messages, their conversation and nearby
  // untagged messages; everything else is dimmed.
  const candidates = picking && typeof boardFromChatCandidates === "function" ? boardFromChatCandidates() : null;
  const picked = !!(picking && m.id && (S.boardFromChat.selected || []).includes(m.id));
  const addable = !!(candidates && m.id && candidates.has(m.id));
  const locked = !!(picking && m.id && !addable);
  const bodyHTML = boardFromChatBodyHTML(m);
  const quote = typeof chatReplyQuoteHTML === "function" ? chatReplyQuoteHTML(m, list) : "";
  const reactions = typeof chatReactionChipsHTML === "function"
    ? chatReactionChipsHTML(m, { mine: meId, interactive: typeof canMutateContent !== "function" || canMutateContent() })
    : "";
  const canDelete = m.userId === meId;
  const replying = typeof S !== "undefined" && S.boardComposerOpen && S.replyToMessage && S.replyToMessage.id === m.id;
  // has-event / data-event mark a message's event for swipes and the "Add to"
  // list (events in view). Not set in an event's own view, where all are one.
  const inEventView = typeof S !== "undefined" && !!S.chatFilterEventId;
  const tagEvent = !inEventView && event && !event._missing ? event : null;
  const tagAttr = tagEvent ? ` data-event="${esc(tagEvent.id)}"` : "";
  // All chat leads with the event: an event message's left column is the
  // event's icon (tap: message this event — tags the message box, no keyboard)
  // and the sender's face moves to a small chip on the name line. General
  // chat keeps the face. The event page keeps faces throughout.
  const feedLead = !boardShowsDayRules();
  const face = `${typeof avatarFaceHtml === "function" ? avatarFaceHtml(m.userId, who) : ""}`;
  const faceStyle = typeof avatarStyle === "function" ? avatarStyle(m.userId) : "";
  // Icon > date > time: a shared icon adds the date under it, a shared day the time.
  const leadExtras = feedLead && tagEvent && !grouped && typeof boardLeadExtras === "function" ? boardLeadExtras(tagEvent) : [];
  const lead = feedLead && tagEvent
    ? `<button type="button" class="msg-ev-lead${grouped ? " spacer" : ""}${leadExtras.length ? ` has-sub has-sub-${leadExtras.length}` : ""}" data-board-lead="${esc(m.id || "")}" aria-label="Message in ${esc([boardEventTitle(tagEvent), ...leadExtras].join(", "))}">${boardEventLeadInnerHTML(tagEvent, leadExtras)}</button>`
    : `<div class="avatar${grouped ? " spacer" : ""}" style="${faceStyle}">${face}</div>`;
  const whoFace = feedLead && tagEvent ? `<span class="avatar msg-who-face" style="${faceStyle}" aria-hidden="true">${face}</span>` : "";
  return `<div class="msg${grouped ? "" : " head-gap"}${tagEvent ? " has-event" : ""}${leadExtras.length ? ` lead-sub-${leadExtras.length}` : ""}${lighter ? " is-surrounding" : ""}${replying ? " is-continuing" : ""}${picked ? " is-from-chat" : ""}${locked ? " is-from-chat-locked" : ""}" data-chat-key="message:${esc(m.id || "")}" data-msg-id="${esc(m.id || "")}" data-from-chat="${addable ? "1" : "0"}" data-real-chat="1" data-can-delete="${canDelete ? "1" : "0"}" data-can-report="0"${tagAttr}>
    ${lead}
    <div class="msg-main">
      ${grouped ? "" : `<div class="msg-meta">${whoFace}<span class="who"${typeof roleNameStyle === "function" && roleNameStyle(m.userId) ? ` style="${roleNameStyle(m.userId)}"` : ""}>${esc(who)}</span>${m.editedAt ? `<span class="msg-edited">edited</span>` : ""}<span class="when">${boardShowsDayRules() ? (typeof fmtTime === "function" ? fmtTime(m.ts) : "") : boardMessageWhenLabel(m.ts)}</span>${sr}${label}${tagEvent && !boardShowsDayRules() ? boardEventTagHTML(tagEvent) : ""}</div>`}
      ${quote}
      <div class="msg-body-row">
        ${m.taskId && typeof chatTaskCardHTML === "function"
          ? chatTaskCardHTML(m, conn)
          : `<div class="msg-body">${bodyHTML}</div>`}
      </div>
      ${reactions}
    </div>
  </div>`;
}

function boardMessageIsFolded(m, allEvents, conn) {
  if (!m || m.activity || m._eventLinkMarker) return false;
  const tag = boardMessageEventId(m);
  const ev = tag ? boardFindEvent(tag, allEvents, conn) : null;
  return !!(ev && boardEventIsHidden(ev) && !boardMentionsMe(m, conn));
}

function boardShownConversationAnchors(list, include) {
  const lastAnchor = new Map();
  const seen = new Set();
  const prevAnchor = new Map();
  for (const m of list || []) {
    if (!include(m)) continue;
    const cid = boardMessageConversationId(m, list);
    if (cid) lastAnchor.set(cid, m.id);
  }
  return {
    take(id, anchor) {
      const latest = !!id && lastAnchor.get(id) === anchor;
      const resumed = !!id && seen.has(id);
      const earlier = resumed ? (prevAnchor.get(id) || null) : null;
      if (id) {
        seen.add(id);
        if (anchor) prevAnchor.set(id, anchor);
      }
      return { latest, resumed, earlier };
    },
  };
}

function boardRailEdges(conversationId, anchorId) {
  const empty = { earlierId: "", laterId: "" };
  if (!conversationId || !anchorId || typeof boardActiveMessages !== "function") return empty;
  const list = boardActiveMessages().slice().sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const events = conn?.events;
  const feed = [];
  for (const m of list) {
    if (!m || m.activity || m._eventLinkMarker) continue;
    if (typeof boardMessageIsFolded === "function" && boardMessageIsFolded(m, events, conn)) continue;
    feed.push({ id: m.id, cid: boardMessageConversationId(m, list) });
  }
  const idx = feed.findIndex((m) => m.id === anchorId);
  if (idx < 0) return empty;
  let start = idx;
  while (start > 0 && feed[start - 1].cid === conversationId) start -= 1;
  let earlier = -1;
  for (let i = start - 1; i >= 0; i--) {
    if (feed[i].cid === conversationId) { earlier = i; break; }
  }
  let later = -1;
  for (let i = idx + 1; i < feed.length; i++) {
    if (feed[i].cid === conversationId) { later = i; break; }
  }
  return {
    earlierId: earlier >= 0 && earlier !== start - 1 ? feed[earlier].id : "",
    laterId: later >= 0 && later !== idx + 1 ? feed[later].id : "",
  };
}

function boardRunSection({ id, anchor, event, html, count, resumed, fromCard, holdsReply, latest }) {
  const selected = !!(typeof S !== "undefined" && S.boardConnect?.mode === "add" && S.boardConnect.chainId && id === S.boardConnect.chainId);
  const preview = typeof S !== "undefined" && S.boardDisconnectPreview === id;
  const chain = !!(typeof S !== "undefined" && !S.boardContinueSeparate && S.boardContinuing === id);
  const tagged = !!(event && !event._missing);
  const inChain = count > 1 || !!resumed || !!fromCard;
  const dotOnly = !inChain;
  const extend = boardExtendTarget();
  const replyJoin = !!(holdsReply && typeof S !== "undefined" && S.replyToMessage && S.boardContinuing === id);
  const intoField = !!(extend && anchor && (S.replyToMessage ? replyJoin : extend.messageId === anchor));
  const edges = dotOnly ? { earlierId: "", laterId: "" } : boardRailEdges(id, anchor);
  const earlierId = edges.earlierId;
  const laterId = edges.laterId;
  const replyTo = tagged && latest && !laterId ? anchor : "";
  const startHere = boardStartOwnsRun(id, replyTo);
  const showEarlier = !!(earlierId);
  const eventAttr = event?.id ? ` data-event="${esc(event.id)}"` : "";
  const reach = intoField && extend.reachesField ? " is-reach" : "";
  // Event membership is shown as a #label on each message's name line (boardEventTagHTML).
  return `<section class="board-msg-run${tagged ? " is-event" : ""}${intoField ? " is-field" : ""}${reach}${replyTo ? " is-latest" : ""}${startHere ? " is-start" : ""}${showEarlier ? " is-resumed" : ""}${fromCard ? " is-from-card" : ""}${chain && tagged ? " is-chain" : ""}${selected ? " is-chain-target" : ""}${preview ? " is-disconnect" : ""}" data-conversation="${esc(id || "")}" data-run-anchor="${esc(anchor || "")}"${eventAttr}>${html}</section>`;
}

function boardHomeRows({ messages, allEvents, conn, ch, filterEv }) {
  const list = (messages || []).slice().sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
  boardKeepChains(list);
  if (filterEv) return boardEventRows(list, filterEv, allEvents, conn);
  return boardGeneralRows(list, allEvents, conn, ch);
}

/** Events that belong on this board: its event channel, including linked feeds. */
function boardEventsOnThisBoard(fallback, conn, ch) {
  let channel = ch || null;
  if (!channel && conn && typeof S !== "undefined") {
    const id = S.activeView?.id;
    channel = id ? (conn.channels || []).find((c) => c.id === id) : null;
  }
  if (channel?.kind === "chat" && channel.boardId && typeof eventChannelForBoard === "function") {
    const eventCh = eventChannelForBoard(channel.boardId, conn);
    if (eventCh && typeof channelEventsForPanelChat === "function") {
      const scoped = channelEventsForPanelChat(eventCh);
      if (Array.isArray(scoped)) return scoped;
    }
  }
  return fallback || [];
}

function boardUntaggedRelevantToEvent(message, event) {
  const created = Number(event?.createdAt);
  const sent = Number(message?.ts);
  return Number.isFinite(created) && created > 0 && Number.isFinite(sent) && sent >= created;
}

function boardGeneralRows(list, allEvents, conn, ch) {
  allEvents = boardEventsOnThisBoard(allEvents, conn, ch);
  const rows = [];
  const seenCard = new Set();
  const hidden = boardFocusHiddenIds(list, "", conn);
  const archive = boardArchiveOn();
  const flags = boardShownConversationAnchors(list, (m) => !boardMessageIsFolded(m, allEvents, conn) && !m?.activity && !m?._eventLinkMarker);
  let lastDay = "";
  let runId = null;
  let run = [];
  let runEvent = null;
  let cardAhead = false;
  // The event card just pushed, as a message from its creator: the creator's
  // own first message right after it stacks under the same header.
  let cardPrev = null;
  const stacksUnderCard = (m) => !!(cardPrev && rows.length === cardPrev.row
    && m && m.userId && m.userId === cardPrev.userId
    && boardMessageEventId(m) === cardPrev.eventId
    && Math.abs((Number(m.ts) || 0) - cardPrev.ts) < 5 * 60e3
    && new Date(Number(m.ts) || 0).toDateString() === new Date(cardPrev.ts).toDateString());
  const flush = () => {
    if (!run.length) return;
    const anchor = run[run.length - 1].id;
    const bits = flags.take(runId, anchor);
    const html = run.map((m, i) => {
      // Each line carries its own event: a same-sender stack can mix events.
      const own = boardAttachedEvent(boardMessageEventId(m), allEvents, conn);
      const ev = own && !own._missing ? own : null;
      return boardMessageHTML(m, {
        conn,
        list,
        event: ev,
        showLabel: i === 0 && !!ev && !bits.latest,
        lighter: false,
        linked: run.length > 1,
        // A stacked line has no header, so it must share the day shown above it.
        grouped: i > 0
          ? (typeof chatMessagesGroupTogether === "function" && chatMessagesGroupTogether(run[i - 1], m) && boardSameDay(run[i - 1], m))
          : stacksUnderCard(m),
      });
    }).join("");
    rows.push(boardRunSection({
      id: runId,
      anchor,
      event: runEvent,
      html,
      count: run.length,
      fromCard: cardAhead,
      holdsReply: run.some((item) => item && typeof S !== "undefined" && S.replyToMessage && item.id === S.replyToMessage.id),
      ...bits,
    }));
    run = [];
    runId = null;
    runEvent = null;
    cardAhead = false;
    cardPrev = null;
  };
  let feed = list;
  if (archive) {
    const tagged = new Set();
    for (const m of list) {
      if (!m || boardFeedDropsMessage(m, list, allEvents, conn)) continue;
      const tag = boardMessageEventId(m) || m.eventId;
      if (tag) tagged.add(tag);
    }
    const filterId = boardArchiveFilterId();
    const cutoff = boardArchiveCutoff();
    const extras = boardCompletedEvents(allEvents)
      .filter((ev) => !tagged.has(ev.id) && (!filterId || ev.id === filterId) && (Number(ev.when) || 0) < cutoff)
      .map((ev) => ({
        id: `archive-card-${ev.id}`,
        ts: Number(ev.when) || 0,
        activity: true,
        eventId: ev.id,
        _archiveCard: true,
      }));
    if (extras.length) {
      feed = list.concat(extras).sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
    }
  } else {
    // Every live event on the board gets a card, even before anyone replies.
    const tagged = new Set();
    for (const m of list) {
      if (!m) continue;
      const tag = boardMessageEventId(m) || m.eventId;
      if (tag) tagged.add(tag);
    }
    const live = typeof boardLiveEvents === "function" ? boardLiveEvents(allEvents) : (allEvents || []);
    const undated = (allEvents || []).filter((ev) => ev && !ev.chainOf && !(Number(ev.when) > 0)
      && (typeof boardEventCompleted !== "function" || !boardEventCompleted(ev)));
    const extras = live.concat(undated)
      .filter((ev) => ev && ev.id && !tagged.has(ev.id))
      .map((ev) => ({
        id: "ev-card-" + ev.id,
        ts: Number(ev.createdAt) || Number(ev.when) || 0,
        activity: true,
        eventId: ev.id,
      }));
    if (extras.length) {
      feed = list.concat(extras).sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
    }
  }
  // The events in view, for the lead tiles' icon > date > time fallback.
  if (typeof boardSetLeadPeers === "function") {
    const peerIds = new Set();
    for (const m of feed) {
      if (!m || boardFeedDropsMessage(m, list, allEvents, conn)) continue;
      if (!archive && hidden.has(m.id)) continue;
      const id = boardMessageEventId(m) || (m.activity ? m.eventId : "");
      if (id) peerIds.add(id);
    }
    boardSetLeadPeers([...peerIds].map((id) => boardFindEvent(id, allEvents, conn)).filter((ev) => ev && !ev._missing && !ev.chainOf));
  }
  for (const m of feed) {
    if (!m || boardFeedDropsMessage(m, list, allEvents, conn)) continue;
    if (!archive && hidden.has(m.id)) continue;
    if (m.activity || m._eventLinkMarker) {
      const id = m.eventId || boardMessageEventId(m);
      const ev = boardFindEvent(id, allEvents, conn);
      if (ev && !seenCard.has(ev.id)) {
        flush();
        rows.push(boardEventCardHTML(ev, { ts: m.ts }));
        seenCard.add(ev.id);
        cardPrev = { userId: ev.createdBy || "", ts: Number(m.ts) || 0, eventId: ev.id, row: rows.length };
      }
      continue;
    }
    const day = new Date(m.ts || 0).toDateString();
    const tag = boardMessageEventId(m);
    const ev = boardAttachedEvent(tag, allEvents, conn);
    if (!archive && ev && !ev._missing && boardEventIsHidden(ev) && !boardMentionsMe(m, conn)) {
      flush();
      if (!seenCard.has(ev.id)) {
        rows.push(boardEventCardHTML(ev, { ts: m.ts }));
        seenCard.add(ev.id);
      }
      lastDay = day;
      continue;
    }
    if (!archive && ev && !ev._missing && boardEventIsHidden(ev) && boardMentionsMe(m, conn)) {
      flush();
      const cid = boardMessageConversationId(m, list);
      const bits = flags.take(cid, m.id);
      rows.push(boardRunSection({
        id: cid,
        anchor: m.id,
        event: ev,
        html: boardMessageHTML(m, { conn, list, event: ev, showLabel: !bits.latest, lighter: false, linked: !!bits.resumed }),
        count: 1,
        holdsReply: !!(typeof S !== "undefined" && S.replyToMessage && m.id === S.replyToMessage.id),
        ...bits,
      }));
      lastDay = day;
      continue;
    }
    if (day !== lastDay && boardShowsDayRules()) {
      flush();
      rows.push(`<div class="day-rule">${typeof S !== "undefined" && S.conversationsThread?.eventId && typeof fmtDay === "function" ? fmtDay(m.ts) : fmtDayRule(m.ts)}</div>`);
      lastDay = day;
    }
    const cid = boardMessageConversationId(m, list);
    let stackOn = !!(run.length
      && typeof chatMessagesGroupTogether === "function"
      && chatMessagesGroupTogether(run[run.length - 1], m));
    // A run never mixes events: each run becomes one conversation block.
    const evKey = ev && !ev._missing ? ev.id : "";
    const runKey = runEvent && !runEvent._missing ? runEvent.id : "";
    if (run.length && evKey !== runKey) {
      flush();
      stackOn = false;
    }
    if (cid !== runId && !stackOn) flush();
    if (!run.length && ev && !ev._missing && !seenCard.has(ev.id)) {
      rows.push(boardEventCardHTML(ev, { ts: m.ts }));
      seenCard.add(ev.id);
      cardAhead = true;
      const created = Number(ev.createdAt) || 0;
      cardPrev = { userId: ev.createdBy || "", ts: created && created <= (Number(m.ts) || 0) ? created : (Number(m.ts) || 0), eventId: ev.id, row: rows.length };
    }
    run.push(m);
    if (!stackOn) {
      runId = cid;
      runEvent = ev;
    }
  }
  flush();
  if (archive && !rows.length) rows.push(`<p class="empty-note">${boardArchiveDays() ? "Nothing in the archive yet." : "Archiving is off for this board (board menu)."}</p>`);
  // Older chat has moved: say where, once, at the top.
  if (!archive && list.some((m) => m && !m.activity && boardMessageArchived(m, list, allEvents, conn))) {
    rows.unshift(`<p class="board-archive-note"><button type="button" data-board-open-archive>${typeof ic === "function" ? ic("archive") : ""}<span>Older chat is in Archive</span></button></p>`);
  }
  // Messages stand on their own (Oct 2026, evening): no conversation blocks;
  // each event message carries its event as a #label on its name line.
  return archive ? rows : boardChainRows(rows);
}

/** Consecutive messages about the same event (any senders, an event card and
 *  its replies included) form a chain: the first leads with the event's icon
 *  and #label, the rest hang off it as a tree — a rail down the left column
 *  with a curved branch into each later speaker's face (their icons hidden). Anything in between —
 *  general chat, another event, a date — ends the chain, so the rail never
 *  bridges a gap. Applied to the row HTML at render time (never to the DOM),
 *  so reconcileChatRows sees the final markup. */
function boardChainRows(rows) {
  const units = [];
  // The message element only — not msg-main / msg-meta / msg-body inside it.
  const msgRe = /<div class="msg(?=[ "])([^"]*)"([^>]*)>/g;
  rows.forEach((html, ri) => {
    if (typeof html !== "string") return;
    const isCard = /^\s*<section class="board-event-card is-message/.test(html);
    if (/^\s*<section class="board-msg-run/.test(html) || isCard) {
      let m;
      msgRe.lastIndex = 0;
      while ((m = msgRe.exec(html))) {
        const ev = /data-event="([^"]*)"/.exec(m[2]);
        const id = /data-msg-id="([^"]*)"/.exec(m[2]);
        units.push({
          ri, at: m.index, end: m.index + m[0].length, ev: ev ? ev[1] : "",
          id: id ? id[1] : "", card: isCard, grouped: !/\bhead-gap\b/.test(m[1]),
        });
      }
    } else {
      units.push({ ri, at: -1, ev: "" });
    }
  });
  const edits = new Map();   // row index → [{ at, text }]
  const edit = (u, at, text) => {
    if (u.at < 0) return;
    if (!edits.has(u.ri)) edits.set(u.ri, []);
    edits.get(u.ri).push({ at, text });
  };
  const cls = new Map();
  const addCls = (u, c) => { const k = `${u.ri}:${u.at}`; cls.set(k, { u, list: (cls.get(k)?.list || []).concat(c) }); };
  // Each chain reads as a tree: the rail runs from the head's icon down to
  // the last speaker, and every later speaker (a header line) branches off it
  // with a curve into their face — the last curve ends the rail. A speaker's
  // stacked lines after the last branch hang off it without rail.
  for (let i = 0; i < units.length;) {
    const u = units[i];
    let j = i + 1;
    while (u.ev && j < units.length && units[j].ev === u.ev) j++;
    if (!u.ev || j - i < 2) { i = j; continue; }
    const chain = units.slice(i, j);
    let last = 0;   // the last header line (a branch) after the head
    chain.forEach((c, k) => { if (k > 0 && !c.grouped) last = k; });
    chain.forEach((c, k) => {
      const list = [];
      if (k > 0) list.push("chain-prev");
      if (k < last) list.push("chain-next");
      if (k > 0 && k === last) list.push("chain-end");
      if (chain[k + 1] && chain[k + 1].grouped) list.push("chain-to-stack");
      if (list.length) addCls(c, list);
    });
    i = j;
  }
  cls.forEach(({ u, list }) => edit(u, u.at + '<div class="msg'.length, " " + list.join(" ")));
  if (!edits.size) return rows;
  const out = rows.slice();
  edits.forEach((list, ri) => {
    let html = out[ri];
    list.sort((x, y) => y.at - x.at).forEach(({ at, text }) => { html = html.slice(0, at) + text + html.slice(at); });
    out[ri] = html;
  });
  return out;
}

function boardEventRows(list, filterEv, allEvents, conn) {
  // In the filtered All chat the event sits in the header (boardSyncEventHead).
  // The event page keeps its original pinned card row.
  const onEventPage = typeof S !== "undefined" && !!S.conversationsThread?.eventId;
  const rows = onEventPage ? [boardEventCardHTML(filterEv, { compact: true })] : [];
  let cardAhead = !boardEventIsHidden(filterEv);
  const matches = [];
  list.forEach((m, i) => {
    if (!m || m.activity || m._eventLinkMarker) return;
    if (boardMessageEventId(m) === filterEv.id) matches.push({ m, i });
  });
  if (!matches.length) {
    rows.push(`<p class="empty-note">No messages about ${esc(boardEventTitle(filterEv))} yet.</p>`);
    return rows;
  }
  if (!S.boardExpandedGaps) S.boardExpandedGaps = {};
  const hidden = boardFocusHiddenIds(list, filterEv.id, conn);
  const matchIds = new Set(matches.map((row) => row.m.id));
  const flags = boardShownConversationAnchors(list, (m) => m && matchIds.has(m.id));
  let prev = null;
  let run = [];
  let runId = null;
  const flush = () => {
    if (!run.length) return;
    const anchor = run[run.length - 1].id;
    const bits = flags.take(runId, anchor);
    const html = run.map((m, i) => boardMessageHTML(m, {
      conn,
      list,
      event: filterEv,
      showLabel: i === 0 && !bits.latest,
      lighter: false,
      linked: run.length > 1,
      grouped: i > 0 && typeof chatMessagesGroupTogether === "function" && chatMessagesGroupTogether(run[i - 1], m),
    })).join("");
    rows.push(boardRunSection({
      id: runId,
      anchor,
      event: filterEv,
      html,
      count: run.length,
      fromCard: cardAhead,
      holdsReply: run.some((item) => item && typeof S !== "undefined" && S.replyToMessage && item.id === S.replyToMessage.id),
      ...bits,
    }));
    run = [];
    runId = null;
    cardAhead = false;
  };
  for (const { m, i } of matches) {
    if (hidden.has(m.id)) continue;
    if (prev != null) {
      const gap = [];
      for (let k = prev + 1; k < i; k++) {
        const x = list[k];
        if (!x || x.activity || x._eventLinkMarker) continue;
        if (!boardMessageEventId(x) && boardUntaggedRelevantToEvent(x, filterEv)) gap.push(x);
      }
      if (gap.length) {
        flush();
        const key = `${filterEv.id}:${list[prev].id}:${m.id}`;
        const open = !!S.boardExpandedGaps[key];
        rows.push(`<button type="button" class="board-context-toggle" data-board-gap="${esc(key)}" aria-expanded="${open ? "true" : "false"}">${open ? "Hide" : "Show"} surrounding chat · ${gap.length} ${gap.length === 1 ? "message" : "messages"}</button>`);
        if (open) {
          rows.push(`<div class="board-surrounding"><p class="board-context-caption">Untagged in All chat · not attached to ${esc(boardEventTitle(filterEv))}</p>${gap.map((x, gi) => boardMessageHTML(x, {
            conn,
            list,
            event: null,
            showLabel: false,
            lighter: true,
            linked: false,
            grouped: gi > 0 && typeof chatMessagesGroupTogether === "function" && chatMessagesGroupTogether(gap[gi - 1], x),
          })).join("")}</div>`);
        }
      }
    }
    const cid = boardMessageConversationId(m, list);
    const stackOn = !!(run.length
      && typeof chatMessagesGroupTogether === "function"
      && chatMessagesGroupTogether(run[run.length - 1], m));
    if (runId && cid !== runId && !stackOn) flush();
    run.push(m);
    if (!stackOn) runId = cid;
    prev = i;
  }
  flush();
  return rows;
}
