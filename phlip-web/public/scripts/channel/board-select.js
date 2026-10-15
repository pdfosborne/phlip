/* board-select.js — select-first message actions for the board All chat.
 *
 * Long-press a message to select it (WhatsApp model): the header becomes a
 * contextual bar, a reaction strip pops above the message, and an action block
 * replaces the composer. Tapping other messages adds / removes them. With
 * untagged messages the block's main action is "New event" (a live preview from
 * the selected messages) with "Add to event" below; with messages already in an
 * event it offers "Move to…" and "Remove from event".
 *
 * Replaces the old act-then-select flows on board home (rail add dots,
 * Organise conversation / chain pick, chat move select).
 *
 * Globals in:  S, activeConn, boardActiveMessages, boardMessageEventId,
 *   boardFindEvent, boardEventTitle, boardEventCompleted,
 *   boardAddEventChoices, boardParseMessagesPlan, boardFromChatDateLabel,
 *   boardMessagePlain, boardMessageSnapshot, boardRememberPriors,
 *   boardWriteMessageScope, boardRestoreSnapshot, boardLatestEventConversation,
 *   boardFreshConversationId, boardScrollAnchor, boardRestoreScrollAnchor,
 *   boardRevealFromChat, chatMoveRelatedIds, setChatReplyTarget,
 *   sendChatReaction, openChatMessageOptions, CHAT_REACT_EMOJIS, renderView, ic, esc
 * Globals out: boardSelectBegin, boardSelectToggle, boardSelectClear,
 *   boardSelectActive, boardSelectHandleClick, boardSelectSync,
 *   boardSelectSummary, boardSelectPreview, boardSelectEventChoices,
 *   boardClassifyChatSwipe, chatSwipeOwnsStart, NAV_EDGE_PX,
 *   boardWriteMessagesToEvent, boardSelectSnackbar, boardSwipeTag
 * Load after:  board-home.js
 * Load before: shell/*, wireboot.js
 */

const BOARD_SELECT_MAX = 40;
/** Swipes that start this close to the left edge always open the nav drawer. */
const NAV_EDGE_PX = 24;

/** Classify a horizontal swipe on a chat message.
 *  Right-to-left: reply (in the message's event when it has one).
 *  Left-to-right on an untagged message, away from the edge: tag it.
 *  Anything else left-to-right belongs to the nav drawer. */
function boardClassifyChatSwipe({ startX = 0, dx = 0, dy = 0, tagged = false, boardHome = true, edgePx = NAV_EDGE_PX } = {}) {
  if (Math.abs(dx) <= 12 || Math.abs(dx) <= Math.abs(dy) * 1.2) return null;
  if (dx < 0) return "reply";
  if (!boardHome || tagged || startX <= edgePx) return "nav";
  return "tag";
}

/** True when a pointerdown starts a gesture the chat should own (so the nav
 *  sheet swipe stands aside): an untagged board message away from the edge. */
function chatSwipeOwnsStart(e) {
  if (typeof S === "undefined" || !S.boardChatHome || S.boardSelect || S.boardFromChat) return false;
  if (typeof boardOnEventPage === "function" && boardOnEventPage()) return false;
  if ((e?.clientX || 0) <= NAV_EDGE_PX) return false;
  const msg = e?.target?.closest?.("#chat-scroll .msg[data-msg-id][data-real-chat=\"1\"]");
  if (!msg || msg.classList.contains("has-event")) return false;
  if (typeof canMutateContent === "function" && !canMutateContent()) return false;
  return !(typeof boardArchiveOn === "function" && boardArchiveOn());
}

function boardSelectActive() {
  return !!(typeof S !== "undefined" && S.boardSelect && (S.boardSelect.ids || []).length);
}

function boardSelectChannel() {
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const id = typeof S !== "undefined" ? S.activeView?.id : "";
  return { conn, ch: (conn?.channels || []).find((c) => c.id === id) || (id ? { id } : null) };
}

function boardSelectMessages() {
  const ids = new Set((typeof S !== "undefined" && S.boardSelect?.ids) || []);
  const list = typeof boardActiveMessages === "function" ? boardActiveMessages() : [];
  return list
    .filter((m) => m && ids.has(m.id) && !m.activity && !m._eventLinkMarker)
    .sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
}

function boardSelectBegin(messageId, opts = {}) {
  if (typeof S === "undefined" || !S.boardChatHome || !messageId) return false;
  // The event page keeps its original long-press sheet.
  if (typeof boardOnEventPage === "function" && boardOnEventPage()) return false;
  if (typeof boardArchiveOn === "function" && boardArchiveOn()) return false;
  if (typeof canMutateContent === "function" && !canMutateContent()) return false;
  if (boardSelectActive()) {
    // Android fires both our long-press timer and a native contextmenu for one
    // press; the second must not toggle the message straight back off.
    const sel = S.boardSelect;
    if (messageId === sel.anchorId && performance.now() - (sel.began || 0) < 900) return true;
    boardSelectToggle(messageId);
    return true;
  }
  if (S.boardFromChat) {
    // Leaving an open event draft: repaint so its dimming and bar go away.
    const anchor = typeof boardScrollAnchor === "function" ? boardScrollAnchor() : null;
    S.boardFromChat = null;
    if (typeof renderView === "function") renderView(true);
    if (typeof boardRestoreScrollAnchor === "function") boardRestoreScrollAnchor(anchor);
  }
  if (typeof boardDestinationState !== "undefined" && boardDestinationState.picker && typeof boardDestinationDismiss === "function") {
    boardDestinationDismiss(false);
  }
  try { document.activeElement?.blur?.(); } catch {}
  // A long press can leave a native text selection behind; drop it.
  const clearText = () => { try { window.getSelection()?.removeAllRanges(); } catch {} };
  clearText();
  if (typeof setTimeout === "function") setTimeout(clearText, 60);
  if (typeof boardEventNavClose === "function") boardEventNavClose();
  S.boardSelect = {
    ids: [messageId],
    anchorId: messageId,
    // Tag state (left-to-right swipe): pick messages and drag them onto an
    // event; no reactions.
    tagging: !!opts.tagging,
    reacts: !opts.tagging,
    addOpen: false,
    query: "",
    began: performance.now(),
  };
  boardSelectSync();
  return true;
}

/** The event in focus in All chat (after a jump, a tag or a #label), if any. */
function boardSelectFocusEvent() {
  const id = typeof S !== "undefined" ? S.boardEventStep?.eventId : "";
  if (!id) return null;
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const ev = boardFindEvent(id, null, conn);
  return ev && !ev._missing && !boardEventCompleted(ev) ? ev : null;
}

/** Left-to-right swipe on a message. With an event in focus it goes straight
 *  into that event (Undo offered); otherwise it starts the tag state, where
 *  more messages can be picked and dragged onto an event. */
function boardSwipeTag(messageId) {
  if (typeof S === "undefined" || !messageId) return;
  const focus = boardSelectFocusEvent();
  if (focus) {
    const msg = (typeof boardActiveMessages === "function" ? boardActiveMessages() : []).find((m) => m && m.id === messageId);
    if (!msg || boardMessageEventId(msg) === focus.id) return;
    const moved = !!boardMessageEventId(msg);
    const anchor = typeof boardScrollAnchor === "function" ? boardScrollAnchor() : null;
    const done = boardWriteMessagesToEvent([msg], focus.id);
    if (typeof renderView === "function") renderView(true);
    if (typeof boardRestoreScrollAnchor === "function") boardRestoreScrollAnchor(anchor);
    if (done) boardSelectSnackbar(`${moved ? "Moved to" : "Added to"} ${boardEventTitle(focus)}`, done.channelId, done.snapshot);
    return;
  }
  boardSelectBegin(messageId, { tagging: true });
}

function boardSelectToggle(messageId) {
  const sel = typeof S !== "undefined" ? S.boardSelect : null;
  if (!sel || !messageId) return;
  const ids = sel.ids || [];
  if (ids.includes(messageId)) {
    sel.ids = ids.filter((id) => id !== messageId);
    if (sel.anchorId === messageId) sel.anchorId = sel.ids[sel.ids.length - 1] || "";
  } else if (ids.length < BOARD_SELECT_MAX) {
    sel.ids = ids.concat(messageId);
  }
  sel.reacts = false;
  if (!sel.ids.length) {
    boardSelectClear();
    return;
  }
  boardSelectSync();
}

function boardSelectClear() {
  if (typeof S === "undefined" || !S.boardSelect) return;
  S.boardSelect = null;
  boardSelectSync();
}

/** { ids, untagged, eventIds:Set, kind: "new" | "in" | "mixed", eventId } */
function boardSelectSummary() {
  const messages = boardSelectMessages();
  const eventIds = new Set();
  let untagged = 0;
  for (const m of messages) {
    const id = boardMessageEventId(m);
    if (id) eventIds.add(id);
    else untagged += 1;
  }
  let kind = "mixed";
  if (!eventIds.size) kind = "new";
  else if (!untagged && eventIds.size === 1) kind = "in";
  return {
    ids: messages.map((m) => m.id),
    messages,
    untagged,
    eventIds,
    kind,
    eventId: eventIds.size === 1 ? [...eventIds][0] : "",
  };
}

function boardSelectPreview() {
  const sel = typeof S !== "undefined" ? S.boardSelect : null;
  if (!sel || typeof boardParseMessagesPlan !== "function") return null;
  return boardParseMessagesPlan(boardSelectMessages(), sel.anchorId);
}

/** Events to add to: same day as the preview first, then events visible in the
 *  chat right now, then upcoming by date. */
function boardSelectEventChoices(preview, excludeId) {
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const events = (typeof boardAddEventChoices === "function" ? boardAddEventChoices() : (conn?.events || []))
    .filter((ev) => ev && !ev._missing && !ev.chainOf && ev.id !== excludeId
      && !(typeof boardEventCompleted === "function" && boardEventCompleted(ev)));
  const day = preview?.day != null && typeof planDayStart === "function" ? planDayStart(preview.day) : null;
  const visible = new Set();
  const scroll = document.querySelector("#chat-scroll");
  if (scroll) {
    const box = scroll.getBoundingClientRect();
    scroll.querySelectorAll(".msg.has-event[data-event], .board-event-card[data-event]").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.bottom > box.top && r.top < box.bottom) visible.add(el.dataset.event);
    });
  }
  const rank = (ev) => {
    const sameDay = day != null && ev.when != null && typeof planDayStart === "function" && planDayStart(ev.when) === day;
    return sameDay ? 0 : (visible.has(ev.id) ? 1 : 2);
  };
  return events.slice().sort((a, b) => rank(a) - rank(b)
    || ((Number(a.when) || Infinity) - (Number(b.when) || Infinity))
    || boardEventTitle(a).localeCompare(boardEventTitle(b)));
}

function boardSelectRelatedIds() {
  const sel = typeof S !== "undefined" ? S.boardSelect : null;
  if (!sel?.anchorId || typeof chatMoveRelatedIds !== "function") return [];
  const list = typeof boardActiveMessages === "function" ? boardActiveMessages() : [];
  const have = new Set(sel.ids || []);
  return chatMoveRelatedIds(list, sel.anchorId).filter((id) => !have.has(id));
}

function boardSelectSnackbar(message, channelId, snapshot) {
  if (typeof AshFeedback !== "undefined" && typeof AshFeedback.snackbar === "function") {
    AshFeedback.snackbar({ message, action: "Undo", onUndo: () => boardRestoreSnapshot(channelId, snapshot) });
  } else if (typeof toast === "function") {
    toast(message);
  }
}

/** Write only the selected lines to an event (or detach them). */
function boardSelectWrite(eventId) {
  return boardWriteMessagesToEvent(boardSelectMessages(), eventId);
}

/** Write these messages (and only these) to an event, or detach them with no
 *  event. Returns what Undo needs. Used by selection and by drag and drop. */
function boardWriteMessagesToEvent(picked, eventId) {
  const { conn, ch } = boardSelectChannel();
  if (!conn || !ch) return null;
  const list = conn.messages?.[ch.id] || [];
  const messages = (picked || []).map((m) => list.find((x) => x.id === m.id) || m);
  if (!messages.length) return null;
  const snapshot = boardMessageSnapshot(list, messages);
  boardRememberPriors(ch.id, snapshot);
  const target = eventId
    ? (boardLatestEventConversation(list, eventId) || boardFreshConversationId())
    : boardFreshConversationId();
  for (const m of messages) boardWriteMessageScope(m, target, eventId || null, conn, ch.id);
  try { if (typeof cacheConn === "function") cacheConn(conn); } catch {}
  return { channelId: ch.id, snapshot, count: messages.length, conn };
}

function boardSelectAddTo(eventId) {
  if (!eventId) return;
  const summary = boardSelectSummary();
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const ev = boardFindEvent(eventId, null, conn);
  if (!ev || ev._missing) return;
  const moved = summary.messages.filter((m) => {
    const id = boardMessageEventId(m);
    return id && id !== eventId;
  }).length;
  const anchor = typeof boardScrollAnchor === "function" ? boardScrollAnchor() : null;
  const done = boardSelectWrite(eventId);
  S.boardSelect = null;
  if (typeof renderView === "function") renderView(true);
  if (typeof boardRestoreScrollAnchor === "function") boardRestoreScrollAnchor(anchor);
  boardSelectSync();
  if (done) {
    const n = done.count;
    const what = moved ? `Moved ${n === 1 ? "1 message" : `${n} messages`} to` : (n === 1 ? "Added to" : `Added ${n} messages to`);
    boardSelectSnackbar(`${what} ${boardEventTitle(ev)}`, done.channelId, done.snapshot);
  }
}

function boardSelectRemoveFromEvent() {
  const summary = boardSelectSummary();
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const ev = summary.eventId ? boardFindEvent(summary.eventId, null, conn) : null;
  const anchor = typeof boardScrollAnchor === "function" ? boardScrollAnchor() : null;
  const done = boardSelectWrite(null);
  S.boardSelect = null;
  if (typeof renderView === "function") renderView(true);
  if (typeof boardRestoreScrollAnchor === "function") boardRestoreScrollAnchor(anchor);
  boardSelectSync();
  if (done) boardSelectSnackbar(`Removed from ${ev ? boardEventTitle(ev) : "the event"}`, done.channelId, done.snapshot);
}

function boardSelectNewEvent() {
  const sel = typeof S !== "undefined" ? S.boardSelect : null;
  if (!sel) return;
  const ids = boardSelectMessages().map((m) => m.id);
  if (!ids.length) return;
  const anchor = typeof boardScrollAnchor === "function" ? boardScrollAnchor() : null;
  S.boardSelect = null;
  S.boardFromChat = {
    selected: ids,
    dropped: {},
    conversationId: typeof boardFreshConversationId === "function" ? boardFreshConversationId() : "",
    eventId: "",
    primaryId: sel.anchorId || ids[0],
  };
  boardSelectSync();
  if (typeof renderView === "function") renderView(true);
  if (typeof boardRestoreScrollAnchor === "function") boardRestoreScrollAnchor(anchor);
  if (typeof boardRevealFromChat === "function") boardRevealFromChat();
}

async function boardSelectCopy() {
  const text = boardSelectMessages()
    .map((m) => (typeof chatMessagePlaintext === "function" ? chatMessagePlaintext(m) : boardMessagePlain(m)))
    .filter(Boolean)
    .join("\n");
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    if (typeof toast === "function") toast("Copied");
  } catch {
    if (typeof toast === "function") toast("Couldn't copy");
  }
  boardSelectClear();
}

function boardSelectReply() {
  const [m] = boardSelectMessages();
  const { ch } = boardSelectChannel();
  if (!m || !ch) return;
  boardSelectClear();
  if (typeof setChatReplyTarget === "function") setChatReplyTarget(ch, m);
  const input = document.querySelector("#composer-input");
  try { input?.focus(); } catch {}
}

/** Edit: your own single message, in a text box (the server stores it
 *  encrypted, as when sending; it's marked "edited"). */
function boardSelectCanEdit(msgs, conn) {
  const meId = conn?.me?.id || (typeof S !== "undefined" ? S.me?.id : "");
  const [m] = msgs;
  return msgs.length === 1 && !!m && m.userId === meId && !m.taskId && !m.activity
    && typeof m._text === "string" && !!m._text.trim();
}

/** Delete: every picked message must be one you can delete. */
function boardSelectCanDelete(msgs, conn) {
  return msgs.length > 0 && typeof canDeleteChatMessage === "function"
    && msgs.every((m) => canDeleteChatMessage(m, conn));
}

async function boardSelectEdit() {
  const msgs = boardSelectMessages();
  const { ch, conn } = boardSelectChannel();
  if (!ch || !boardSelectCanEdit(msgs, conn)) return;
  const m = msgs[0];
  boardSelectClear();
  if (typeof ashPrompt !== "function") return;
  const next = await ashPrompt("Edit message", { value: m._text, ok: "Save", maxlength: 2000 });
  if (next == null || next === m._text.trim()) return;
  const text = typeof encrypt === "function" ? await encrypt(next, conn?.key) : next;
  if (typeof send === "function") send({ type: "editMessage", channelId: ch.id, messageId: m.id, text }, conn?.id);
  m.text = text;
  m._text = next;
  m.editedAt = Date.now();
  if (typeof renderView === "function") renderView(true);
}

function boardSelectDelete() {
  const msgs = boardSelectMessages();
  const { ch, conn } = boardSelectChannel();
  if (!ch || !boardSelectCanDelete(msgs, conn)) return;
  boardSelectClear();
  const snaps = msgs.map((m) => (typeof hideLocalChatMessage === "function" ? hideLocalChatMessage(conn, ch.id, m.id) : null)).filter(Boolean);
  const refresh = () => { if (typeof renderView === "function") renderView(true); };
  const commit = () => msgs.forEach((m) => send({ type: "deleteMessage", channelId: ch.id, messageId: m.id }, conn?.id));
  refresh();
  const fb = typeof AshFeedback !== "undefined" ? AshFeedback : null;
  if (!snaps.length || !fb || typeof fb.snackbar !== "function") { commit(); return; }
  fb.snackbar({
    message: msgs.length === 1 ? "Message deleted" : `${msgs.length} messages deleted`,
    action: "Undo",
    onUndo() {
      snaps.slice().reverse().forEach((snap) => { if (typeof restoreLocalChatMessage === "function") restoreLocalChatMessage(snap); });
      refresh();
    },
    onCommit: commit,
  });
}

/** Draw: a drawn reaction on the one picked message. */
function boardSelectDraw() {
  const [m] = boardSelectMessages();
  const { ch, conn } = boardSelectChannel();
  if (!m || !ch || typeof openChatDrawnReaction !== "function") return;
  const meId = conn?.me?.id || "";
  const mine = (m.reactions || {})[meId] || null;
  boardSelectClear();
  openChatDrawnReaction({ ch, messageId: m.id, conn, myEmoji: mine, drawnOn: !!(mine && typeof isDrawnIcon === "function" && isDrawnIcon(mine)) });
}

function boardSelectReact(emoji) {
  const [m] = boardSelectMessages();
  const { ch, conn } = boardSelectChannel();
  if (!m || !ch || !emoji) return;
  if (typeof sendChatReaction === "function") sendChatReaction(ch.id, m.id, emoji, conn?.id);
  boardSelectClear();
}

/* ── Rendering ─────────────────────────────────────────────────────────── */

function boardSelectIcon(name) {
  return typeof ic === "function" ? ic(name) : "";
}

/** The top bar: ✕ · count · Reply · Copy · Edit (your own one message) ·
 *  Delete (messages you can delete). No ⋮ sheet. */
function boardSelectBarHTML(count) {
  const one = count === 1;
  const msgs = boardSelectMessages();
  const { conn } = boardSelectChannel();
  const canEdit = boardSelectCanEdit(msgs, conn);
  const canDelete = boardSelectCanDelete(msgs, conn);
  return `<div id="board-select-bar" class="board-select-bar" role="toolbar" aria-label="${count} selected">
    <button type="button" data-select-close aria-label="Clear selection">${boardSelectIcon("x")}</button>
    <span class="board-select-count" aria-live="polite">${count} selected</span>
    ${one ? `<button type="button" data-select-reply aria-label="Reply">${boardSelectIcon("reply")}</button>` : ""}
    <button type="button" data-select-copy aria-label="Copy">${boardSelectIcon("copy")}</button>
    ${canEdit ? `<button type="button" data-select-edit aria-label="Edit message">${boardSelectIcon("pencil")}</button>` : ""}
    ${canDelete ? `<button type="button" data-select-delete aria-label="${one ? "Delete message" : "Delete messages"}">${boardSelectIcon("trash")}</button>` : ""}
  </div>`;
}

function boardSelectEventRowHTML(ev, attr) {
  const when = typeof conversationWhenLabel === "function" ? conversationWhenLabel(ev) : "";
  return `<button type="button" class="board-select-event" ${attr}="${esc(ev.id)}">
    <span class="board-select-event-title">${esc(boardEventTitle(ev))}</span>
    <span class="board-select-event-when">${esc(when)}</span>
  </button>`;
}

function boardSelectListHTML(summary, preview, verb) {
  const sel = S.boardSelect;
  const exclude = summary.kind === "in" ? summary.eventId : "";
  let events = boardSelectEventChoices(preview, exclude);
  const q = String(sel.query || "").trim().toLocaleLowerCase();
  if (q) events = events.filter((ev) => boardEventTitle(ev).toLocaleLowerCase().includes(q));
  const search = boardSelectEventChoices(preview, exclude).length > 6
    ? `<input type="search" class="board-select-search" data-select-search placeholder="Search events" value="${esc(sel.query || "")}" aria-label="Search events">`
    : "";
  const rows = events.length
    ? events.map((ev) => boardSelectEventRowHTML(ev, "data-select-add")).join("")
    : `<p class="board-select-empty">${q ? "No matching events" : "No upcoming events"}</p>`;
  return `<div class="board-select-list-head">
      <button type="button" data-select-add-close aria-label="Back">${boardSelectIcon("arrow-left")}</button>
      <span>${esc(verb)}</span>
    </div>
    ${search}
    <div class="board-select-list" role="list">${rows}</div>`;
}

function boardSelectBlockHTML() {
  const sel = S.boardSelect;
  const summary = boardSelectSummary();
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const preview = summary.kind === "in" ? null : boardSelectPreview();
  const related = summary.kind === "in" ? [] : boardSelectRelatedIds();
  const relatedChip = related.length
    ? `<button type="button" class="board-select-related" data-select-related>${boardSelectIcon("sparkles")}<span>Select related (+${related.length})</span></button>`
    : "";
  if (sel.tagging && !sel.addOpen) return boardSelectTagBlockHTML(summary);
  if (sel.addOpen) {
    const verb = summary.kind === "new" ? "Add to event" : "Move to";
    return `<div class="board-select-block is-list">${boardSelectListHTML(summary, preview, verb)}</div>`;
  }
  if (summary.kind === "in") {
    const ev = boardFindEvent(summary.eventId, null, conn);
    return `<div class="board-select-block">
      <p class="board-select-in">In ${esc(ev ? boardEventTitle(ev) : "an event")}</p>
      <button type="button" class="board-select-secondary" data-select-add-open>${boardSelectIcon("arrow-right-left")}<span>Move to…</span></button>
      <button type="button" class="board-select-secondary is-danger" data-select-remove>${boardSelectIcon("split")}<span>Remove from event</span></button>
    </div>`;
  }
  // Only a message with a plan in it (a date, time or place) names the event;
  // otherwise "Anyone seen my keys" would be offered as an event name.
  const hasPlan = !!(preview && (preview.day != null || preview.timeText || preview.where));
  const title = hasPlan && preview.title && preview.title !== "Plan" ? preview.title : "New event";
  const facts = [];
  if (preview?.day != null) facts.push(`${boardSelectIcon("calendar")}<span>${esc(boardFromChatDateLabel(preview.day))}</span>`);
  if (preview?.timeText) facts.push(`${boardSelectIcon("clock")}<span>${esc(preview.timeText)}</span>`);
  if (preview?.where) facts.push(`${boardSelectIcon("map-pin")}<span>${esc(preview.where)}</span>`);
  const moves = summary.kind === "mixed"
    ? (() => {
      const n = summary.messages.length - summary.untagged;
      const evs = [...summary.eventIds].map((id) => boardFindEvent(id, null, conn)).filter(Boolean);
      const from = evs.length === 1 ? boardEventTitle(evs[0]) : `${evs.length} events`;
      return `<p class="board-select-note">Moves ${n} from ${esc(from)}</p>`;
    })()
    : "";
  const label = `New event: ${title}${preview?.day != null ? `, ${boardFromChatDateLabel(preview.day)}` : ""}${preview?.timeText ? `, ${preview.timeText}` : ""}`;
  // In an event's focus (jump, tag or #label) the likely intent is "this
  // belongs here", so lead with adding to it. Otherwise no quick "Add to".
  const focus = boardSelectFocusEvent();
  const near = focus && summary.kind !== "in" ? focus : null;
  if (near) {
    const short = typeof boardEventShortLabel === "function" ? boardEventShortLabel(near) : boardEventTitle(near);
    const when = typeof conversationWhenLabel === "function" ? conversationWhenLabel(near) : "";
    return `<div class="board-select-block">
    ${relatedChip}
    <button type="button" class="board-select-new is-suggest" data-select-add="${esc(near.id)}" aria-label="Add to ${esc(boardEventTitle(near))}">
      <span class="board-select-new-kicker">${boardSelectIcon("folder-plus")}Add to</span>
      <span class="board-select-new-title">#${esc(short)}</span>
      ${when ? `<span class="board-select-new-facts">${esc(when)}</span>` : ""}
    </button>
    <button type="button" class="board-select-secondary" data-select-new aria-label="${esc(label)}">${boardSelectIcon("plus")}<span>New event</span></button>
    <button type="button" class="board-select-secondary" data-select-add-open>${boardSelectIcon("calendar")}<span>Another event…</span>${boardSelectIcon("chevron-up")}</button>
  </div>`;
  }
  return `<div class="board-select-block">
    ${relatedChip}
    <button type="button" class="board-select-new" data-select-new aria-label="${esc(label)}">
      ${hasPlan ? `<span class="board-select-new-kicker">${boardSelectIcon("plus")}New event</span>` : ""}
      <span class="board-select-new-title">${hasPlan ? "" : boardSelectIcon("plus")}${esc(title)}</span>
      ${facts.length ? `<span class="board-select-new-facts">${facts.map((f) => `<span>${f}</span>`).join("")}</span>` : `<span class="board-select-new-facts is-empty">Add a date</span>`}
    </button>
    ${moves}
    <button type="button" class="board-select-secondary" data-select-add-open>${boardSelectIcon("folder-plus")}<span>Add to event</span>${boardSelectIcon("chevron-up")}</button>
  </div>`;
}

function boardSelectReactsHTML() {
  const emojis = typeof CHAT_REACT_EMOJIS !== "undefined" ? CHAT_REACT_EMOJIS : ["👍", "❤️", "😂"];
  const draw = typeof canUserDraw !== "function" || canUserDraw()
    ? `<button type="button" class="board-select-draw" data-select-draw aria-label="Draw a reaction">${boardSelectIcon("brush")}</button>`
    : "";
  return `<div id="board-select-reacts" class="board-select-reacts" role="toolbar" aria-label="Quick reactions">${emojis.map((em) =>
    `<button type="button" data-select-react="${esc(em)}" aria-label="${esc(em)}">${esc(em)}</button>`).join("")}${draw}</div>`;
}

/** Keeps the reaction strip just above the selected message (below it near
 *  the top), between the header and the action block, and follows scrolling;
 *  hidden while the message is out of view. */
function boardSelectPlaceReacts(view) {
  const strip = view?.querySelector("#board-select-reacts");
  const sel = typeof S !== "undefined" ? S.boardSelect : null;
  if (!strip || !sel) return;
  const css = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(sel.anchorId) : sel.anchorId;
  const anchorEl = document.querySelector(`#chat-scroll .msg[data-msg-id="${css}"]`);
  const scroll = document.querySelector("#chat-scroll");
  if (!anchorEl || !scroll) { strip.hidden = true; return; }
  const viewBox = view.getBoundingClientRect();
  const scrollBox = scroll.getBoundingClientRect();
  const msgBox = anchorEl.getBoundingClientRect();
  const h = strip.offsetHeight || 44;
  const visible = msgBox.bottom > scrollBox.top + 8 && msgBox.top < scrollBox.bottom - 8;
  strip.hidden = !visible;
  if (!visible) return;
  // Above the message, so the messages below stay free to tap into the
  // selection (and to drag); below it only when there's no room above.
  let top = msgBox.top - viewBox.top - h - 6;
  if (top < scrollBox.top - viewBox.top + 4) top = msgBox.bottom - viewBox.top + 6;
  top = Math.min(top, scrollBox.bottom - viewBox.top - h - 4);
  strip.style.top = Math.round(top) + "px";
}

/** Tag state: what's picked can be dragged onto any event in the chat, or
 *  sent to one from the list. */
function boardSelectTagBlockHTML(summary) {
  const n = summary.messages.length;
  return `<div class="board-select-block is-tagging">
    <div class="board-select-tag-head">
      <p class="board-select-tag-hint">${boardSelectIcon("move")}<span>Drag ${n === 1 ? "it" : `these ${n}`} onto an event, or tap more</span></p>
      <button type="button" class="board-select-cancel" data-select-close>Cancel</button>
    </div>
    <button type="button" class="board-select-secondary" data-select-add-open>${boardSelectIcon("calendar")}<span>Choose event…</span>${boardSelectIcon("chevron-up")}</button>
    <button type="button" class="board-select-secondary" data-select-new>${boardSelectIcon("plus")}<span>New event</span></button>
  </div>`;
}

/** Apply selection state to whatever is currently rendered. Safe to call after
 *  any renderView. */
function boardSelectSync() {
  if (typeof document === "undefined") return;
  const view = document.getElementById("view");
  const on = boardSelectActive() && typeof S !== "undefined" && !!S.boardChatHome;
  document.body?.classList.toggle("board-selecting", on);
  if (!on) {
    document.body?.classList.toggle("board-tagging", false);
    if (typeof boardDropZonesPaint === "function") boardDropZonesPaint();
  }
  const ids = new Set(on ? S.boardSelect.ids : []);
  document.querySelectorAll("#chat-scroll .msg[data-msg-id]").forEach((el) => {
    const picked = ids.has(el.dataset.msgId || "");
    el.classList.toggle("is-selected", picked);
    if (on) el.setAttribute("aria-selected", picked ? "true" : "false");
    else el.removeAttribute("aria-selected");
  });
  const head = document.querySelector("header.main-head");
  head?.querySelector("#board-select-bar")?.remove();
  view?.querySelector("#board-select-reacts")?.remove();
  const composer = view?.querySelector(":scope > .composer.is-board");
  composer?.querySelector(".board-select-block")?.remove();
  if (!on || !view) return;
  const count = S.boardSelect.ids.length;
  if (head) head.insertAdjacentHTML("beforeend", boardSelectBarHTML(count));
  if (composer) {
    composer.insertAdjacentHTML("afterbegin", boardSelectBlockHTML());
    const search = composer.querySelector("[data-select-search]");
    if (search && S.boardSelect.focusSearch) {
      S.boardSelect.focusSearch = false;
      search.focus();
      const end = search.value.length;
      try { search.setSelectionRange(end, end); } catch {}
    }
  }
  document.body.classList.toggle("board-tagging", !!S.boardSelect.tagging);
  if (typeof boardFloatComposer === "function") boardFloatComposer(view);
  if (typeof boardDropZonesPaint === "function") requestAnimationFrame(boardDropZonesPaint);
  // Place the strip after the action block has resized the chat, and keep it
  // with its message while the chat scrolls.
  if (S.boardSelect.reacts && count === 1) {
    view.insertAdjacentHTML("beforeend", boardSelectReactsHTML());
    boardSelectPlaceReacts(view);
    requestAnimationFrame(() => boardSelectPlaceReacts(view));
    const scroll = document.querySelector("#chat-scroll");
    if (scroll && !scroll._selectReactsWired) {
      scroll._selectReactsWired = true;
      scroll.addEventListener("scroll", () => boardSelectPlaceReacts(document.getElementById("view")), { passive: true });
    }
  }
}

/** Chat taps while selecting only toggle selection. Returns true if handled. */
if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("pointerdown", () => { boardSelectHandleClick.lastDown = performance.now(); }, true);
}

function boardSelectHandleClick(e) {
  if (!boardSelectActive()) return false;
  e.preventDefault();
  e.stopPropagation();
  const msg = e.target.closest?.("#chat-scroll .msg[data-msg-id]");
  if (!msg || msg.dataset.realChat !== "1") return true;
  const id = msg.dataset.msgId || "";
  const sel = S.boardSelect;
  // The click that ends the long-press (or swipe) that began the selection
  // must not toggle anything: the action block may have moved the chat, so it
  // can land on another line.
  if ((boardSelectHandleClick.lastDown || 0) < (sel.began || 0)) return true;
  boardSelectToggle(id);
  return true;
}

(function wireBoardSelect() {
  if (typeof document === "undefined") return;
  const bind = () => {
    if (document.body.dataset.boardSelectWired) return;
    document.body.dataset.boardSelectWired = "1";
    document.addEventListener("click", (e) => {
      if (!boardSelectActive()) return;
      const t = e.target;
      const hit = (sel) => t.closest?.(sel);
      let btn;
      if ((btn = hit("[data-select-close]"))) { e.preventDefault(); boardSelectClear(); return; }
      if ((btn = hit("[data-select-copy]"))) { e.preventDefault(); void boardSelectCopy(); return; }
      if ((btn = hit("[data-select-reply]"))) { e.preventDefault(); boardSelectReply(); return; }
      if ((btn = hit("[data-select-edit]"))) { e.preventDefault(); void boardSelectEdit(); return; }
      if ((btn = hit("[data-select-delete]"))) { e.preventDefault(); boardSelectDelete(); return; }
      if ((btn = hit("[data-select-draw]"))) { e.preventDefault(); boardSelectDraw(); return; }
      if ((btn = hit("[data-select-react]"))) { e.preventDefault(); boardSelectReact(btn.dataset.selectReact); return; }
      if ((btn = hit("[data-select-new]"))) { e.preventDefault(); boardSelectNewEvent(); return; }
      if ((btn = hit("[data-select-add-open]"))) {
        e.preventDefault();
        S.boardSelect.addOpen = true;
        S.boardSelect.reacts = false;
        boardSelectSync();
        return;
      }
      if ((btn = hit("[data-select-add-close]"))) {
        e.preventDefault();
        S.boardSelect.addOpen = false;
        S.boardSelect.query = "";
        boardSelectSync();
        return;
      }
      if ((btn = hit("[data-select-add]"))) { e.preventDefault(); boardSelectAddTo(btn.dataset.selectAdd); return; }
      if ((btn = hit("[data-select-remove]"))) { e.preventDefault(); boardSelectRemoveFromEvent(); return; }
      if ((btn = hit("[data-select-related]"))) {
        e.preventDefault();
        const more = boardSelectRelatedIds();
        S.boardSelect.ids = S.boardSelect.ids.concat(more).slice(0, BOARD_SELECT_MAX);
        S.boardSelect.reacts = false;
        boardSelectSync();
      }
    }, true);
    document.addEventListener("input", (e) => {
      const search = e.target.closest?.("[data-select-search]");
      if (!search || !boardSelectActive()) return;
      S.boardSelect.query = search.value;
      S.boardSelect.focusSearch = true;
      boardSelectSync();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && boardSelectActive()) {
        e.preventDefault();
        boardSelectClear();
      }
    });
  };
  if (document.body) bind();
  else document.addEventListener("DOMContentLoaded", bind);
})();
