/* board-model.js — board events and messages: lookup, hidden state, lists, titles, icons and RSVP state.
 *
 * Pure helpers shared by the feed, the event card, the event bar and the
 * composer. No rendering beyond small icon snippets.
 *
 * Globals in:  shared board/chat state (S, Nav, activeConn)
 * Globals out: boardFindEvent, boardEventTitle, boardEventRsvpState, boardEventShortLabel, boardActiveMessages, boardLiveEvents, boardEventIsHidden,
 *   boardSetLeadPeers, boardLeadExtras, boardEventLeadInnerHTML
 * Load after:  channel-event-panel.js
 * Load before: board-card.js
 *
 * Must not: ES modules, bundlers, unrelated feature work
 */

const BOARD_HIDE_KEY = "phlip-board-hide-v1";

function boardHideMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(BOARD_HIDE_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function boardHideBucket() {
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const eventCh = typeof conversationActiveEventChannel === "function" ? conversationActiveEventChannel() : null;
  const key = `${conn?.id || ""}:${eventCh?.id || ""}`;
  const all = boardHideMap();
  if (!all[key]) all[key] = { hideDeclined: true, overrides: {} };
  if (all[key].hideDeclined == null) all[key].hideDeclined = true;
  if (!all[key].overrides) all[key].overrides = {};
  return { key, all, bucket: all[key] };
}

function boardSaveHide(state) {
  try { localStorage.setItem(BOARD_HIDE_KEY, JSON.stringify(state.all)); } catch {}
}

function boardHideDeclined() {
  return !!boardHideBucket().bucket.hideDeclined;
}

function boardSetHideDeclined(on) {
  const state = boardHideBucket();
  state.bucket.hideDeclined = !!on;
  boardSaveHide(state);
}

/* ── Archive by age ─────────────────────────────────────────────────────
   Messages older than the board's archive age (default 2 weeks; set in the
   board menu) move to Archive — unless their event is still to come, so a
   plan's chat stays with it. "Never" keeps everything in All chat. */
const BOARD_ARCHIVE_CHOICES = [[7, "1 week"], [14, "2 weeks"], [30, "1 month"], [0, "Never"]];
const BOARD_ARCHIVE_DEFAULT_DAYS = 14;

function boardArchiveDays() {
  const memo = boardArchiveDays.memo;
  const now = Date.now();
  if (memo && now - memo.at < 1000) return memo.days;
  const d = boardHideBucket().bucket.archiveDays;
  const days = BOARD_ARCHIVE_CHOICES.some(([n]) => n === d) ? d : BOARD_ARCHIVE_DEFAULT_DAYS;
  boardArchiveDays.memo = { at: now, days };
  return days;
}

function boardSetArchiveDays(days) {
  const state = boardHideBucket();
  state.bucket.archiveDays = BOARD_ARCHIVE_CHOICES.some(([n]) => n === days) ? days : BOARD_ARCHIVE_DEFAULT_DAYS;
  boardSaveHide(state);
  boardArchiveDays.memo = null;
}

/** Messages sent before this moment are archived (0: never). */
function boardArchiveCutoff() {
  const days = boardArchiveDays();
  return days ? Date.now() - days * 86400e3 : 0;
}

/** The event a message belongs to (its tag, else its conversation's). */
function boardMessageOwnEvent(m, list, allEvents, conn) {
  const tag = boardMessageEventId(m) || m?.eventId || "";
  let ev = tag ? boardAttachedEvent(tag, allEvents, conn) : null;
  if ((!ev || ev._missing) && list) {
    const cid = boardMessageConversationId(m, list);
    const eventId = cid ? boardConversationEventId(list, cid) : "";
    if (eventId) ev = boardAttachedEvent(eventId, allEvents, conn);
  }
  return ev && !ev._missing ? ev : null;
}

function boardMessageArchived(m, list, allEvents, conn) {
  const cutoff = boardArchiveCutoff();
  if (!cutoff || !m || (Number(m.ts) || 0) >= cutoff) return false;
  const ev = boardMessageOwnEvent(m, list, allEvents, conn);
  return !(ev && !boardEventCompleted(ev));
}

function boardEventOverride(eventId) {
  const id = String(eventId || "");
  if (!id) return null;
  const value = boardHideBucket().bucket.overrides[id];
  return value === true || value === false ? value : null;
}

function boardSetEventOverride(eventId, hidden) {
  const state = boardHideBucket();
  const id = String(eventId || "");
  if (!id) return;
  if (hidden == null) delete state.bucket.overrides[id];
  else state.bucket.overrides[id] = !!hidden;
  boardSaveHide(state);
}

function boardEventIsHidden(ev) {
  if (!ev) return false;
  const override = boardEventOverride(ev.id);
  if (override != null) return override;
  if (!boardHideDeclined()) return false;
  const rsvp = typeof timelineMyRsvp === "function" ? timelineMyRsvp(ev) : null;
  return rsvp === "out";
}

function boardFindEvent(id, events, conn) {
  if (typeof findEventById === "function") return findEventById(id, events, conn);
  if (!id) return null;
  return (events || []).find((e) => e.id === id)
    || (conn?.events || []).find((e) => e.id === id)
    || null;
}

function boardAttachedEvent(id, events, conn) {
  if (!id) return null;
  return boardFindEvent(id, events, conn) || { id, _missing: true };
}

/** The event's type icon (party, dinner…), or "" for the generic pin. */
function boardEventIconName(ev) {
  if (!ev || ev._missing || typeof eventIcon !== "function") return "";
  const name = String(eventIcon(ev) || "");
  return name && name !== "pin" && name !== "custom" ? name : "";
}

function boardEventIconHTML(ev, cls) {
  const name = boardEventIconName(ev);
  const svg = name && typeof ic === "function" ? ic(name) : "";
  // ic() falls back to the plain name for unknown icons; show nothing then.
  return /<svg/.test(svg) ? `<span class="${cls}" aria-hidden="true">${svg}</span>` : "";
}

/* ── Lead tile fallback: icon > date > time ──────────────────────────────
   The events shown in the feed right now (set per render by
   boardGeneralRows). When two of them share an icon, the tile grows to add
   the date under it; when they also share the day, the time as well. */
let boardLeadPeers = null;

function boardSetLeadPeers(events) {
  boardLeadPeers = Array.isArray(events) ? events : null;
}

function boardLeadDayKey(ev) {
  const when = Number(ev?.when) || 0;
  return when > 0 ? new Date(when).toDateString() : "";
}

function boardLeadDateLabel(ev) {
  const when = Number(ev?.when) || 0;
  if (!(when > 0)) return "No date";
  return new Date(when).toLocaleDateString("en-GB", { day: "numeric", month: "short" }).replace("Sept", "Sep");
}

function boardLeadTimeLabel(ev) {
  if (!(Number(ev?.when) > 0)) return "";
  if (typeof timelineTimeLabel === "function") return String(timelineTimeLabel(ev, false) || "");
  return new Date(Number(ev.when)).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" });
}

/** The extra lines under an event's lead icon: [] when its icon is unique
 *  among the events in view, [date] when shared, [date, time] when the day is
 *  shared too. */
function boardLeadExtras(ev) {
  if (!ev || ev._missing || !boardLeadPeers) return [];
  const icon = boardEventIconName(ev);
  const day = boardLeadDayKey(ev);
  let iconClash = false;
  let dayClash = false;
  for (const other of boardLeadPeers) {
    if (!other || other.id === ev.id || boardEventIconName(other) !== icon) continue;
    iconClash = true;
    if (boardLeadDayKey(other) === day) dayClash = true;
  }
  if (!iconClash) return [];
  const date = boardLeadDateLabel(ev);
  const time = dayClash ? boardLeadTimeLabel(ev) : "";
  return time ? [date, time] : [date];
}

/** The lead tile's inside: the icon (calendar when generic) and any extras. */
function boardEventLeadInnerHTML(ev, extras) {
  const icon = boardEventIconHTML(ev, "msg-ev-lead-ico")
    || `<span class="msg-ev-lead-ico" aria-hidden="true">${typeof ic === "function" ? ic("calendar") : ""}</span>`;
  const lines = (extras || []).map((t) => `<span class="msg-ev-lead-sub">${esc(t)}</span>`).join("");
  return icon + lines;
}

/** The event's icon with a small RSVP badge on its corner, for compact event
 *  rows (the # picker): an empty ring = still to answer, ✓ = going, ✕ = can't go,
 *  nothing when there's nothing to answer. */
function boardEventIconWithStateHTML(ev, cls) {
  const icon = boardEventIconHTML(ev, cls)
    || `<span class="${cls}" aria-hidden="true">${typeof ic === "function" ? ic("calendar") : ""}</span>`;
  const st = boardEventRsvpState(ev);
  const mark = st === "going" ? (typeof ic === "function" ? ic("check") : "\u2713")
    : st === "out" ? (typeof ic === "function" ? ic("x") : "\u00d7")
      : "";
  const badge = st === "none" ? "" : `<span class="board-rsvp-badge is-${st}" aria-hidden="true">${mark}</span>`;
  return `<span class="board-event-icon-mark">${icon}${badge}</span>`;
}

function boardEventTitle(ev) {
  if (!ev) return "Event";
  if (typeof eventDisplayTitle === "function") return eventDisplayTitle(ev) || "Event";
  return ev._title || ev.title || "Event";
}

function boardMessageEventId(m) {
  if (!m || typeof messageMentionedEventIds !== "function") return m?.eventId || null;
  return messageMentionedEventIds(m)[0] || null;
}

function boardMessageConversationId(m, messages) {
  if (!m) return null;
  if (m.conversationId) return m.conversationId;
  if (m.replyToId) {
    const parent = (messages || []).find((x) => x.id === m.replyToId);
    if (parent && parent !== m) return boardMessageConversationId(parent, messages);
  }
  const tag = boardMessageEventId(m);
  if (tag) return "event-" + tag;
  return m.id ? "conversation-" + m.id : null;
}

function boardConversationMessages(messages, id) {
  if (!id) return [];
  return (messages || []).filter((m) => m && !m.activity && !m._eventLinkMarker
    && boardMessageConversationId(m, messages) === id);
}

function boardConversationEventId(messages, id) {
  const hit = boardConversationMessages(messages, id).find((m) => boardMessageEventId(m));
  return hit ? boardMessageEventId(hit) : (String(id || "").startsWith("event-") ? String(id).slice(6) : null);
}

function boardMentionsMe(m, conn) {
  const me = conn?.me?.id;
  if (me && Array.isArray(m?.mentionedUserIds) && m.mentionedUserIds.includes(me)) return true;
  const name = conn?.me?.name;
  const text = String(m?._text || "");
  if (name && text.includes("@" + name)) return true;
  return false;
}

function boardUpcomingEvents(events) {
  const start = typeof conversationDayStart === "function"
    ? conversationDayStart(Date.now())
    : new Date().setHours(0, 0, 0, 0);
  return (events || []).filter((ev) => {
    if (!ev || ev.chainOf) return false;
    if (typeof isMainViewEvent === "function" && !isMainViewEvent(ev)) return false;
    const when = Number(ev.when) || 0;
    return when >= start;
  }).sort((a, b) => {
    const aw = Number(a.when) || 0;
    const bw = Number(b.when) || 0;
    if (aw !== bw) return aw - bw;
    return boardEventTitle(a).localeCompare(boardEventTitle(b));
  });
}

function boardArchiveOn() {
  return typeof S !== "undefined" && !!S.boardArchive && !S.chatFilterEventId;
}

function boardPanelEvents(conn) {
  const id = typeof S !== "undefined" ? S.activeView?.id : "";
  let ch = id && conn ? (conn.channels || []).find((c) => c.id === id) : null;
  if (ch?.kind === "chat" && ch.boardId && typeof eventChannelForBoard === "function") {
    ch = eventChannelForBoard(ch.boardId, conn) || ch;
  }
  if (typeof channelEventsForPanelChat === "function") return channelEventsForPanelChat(ch || null);
  return conn?.events || [];
}

/** Past events whose day is older than the archive age (the Archive rail). */
function boardArchiveEvents() {
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const cutoff = boardArchiveCutoff();
  return cutoff ? boardCompletedEvents(boardPanelEvents(conn)).filter((ev) => (Number(ev.when) || 0) < cutoff) : [];
}

function boardArchiveFilterId() {
  if (!boardArchiveOn() || typeof S === "undefined") return "";
  const id = S.boardArchiveEventId || "";
  if (!id) return "";
  return boardArchiveEvents().some((ev) => ev.id === id) ? id : "";
}

function boardEventEndMs(ev) {
  const when = Number(ev?.when) || 0;
  if (!when) return 0;
  const dur = typeof eventDurationMsClient === "function"
    ? eventDurationMsClient(ev.duration)
    : 3600000;
  return when + (Number(dur) || 3600000);
}

function boardEventCompleted(ev) {
  if (!ev || ev.chainOf || ev._missing) return false;
  const when = Number(ev.when) || 0;
  if (!when) return false;
  if (typeof isEventPastDay === "function" && isEventPastDay(ev)) return true;
  return Date.now() >= boardEventEndMs(ev);
}

function boardLiveEvents(events) {
  return boardUpcomingEvents(events).filter((ev) => !boardEventCompleted(ev));
}

function boardCompletedEvents(events) {
  return (events || []).filter((ev) => ev && !ev.chainOf && boardEventCompleted(ev))
    .sort((a, b) => (Number(a.when) || 0) - (Number(b.when) || 0));
}

function boardFeedDropsMessage(m, list, allEvents, conn) {
  if (!m) return true;
  const archive = boardArchiveOn();
  const filter = archive ? boardArchiveFilterId() : "";
  if (m._archiveCard) {
    if (!archive) return true;
    return !!(filter && m.eventId !== filter);
  }
  const done = boardMessageArchived(m, list, allEvents, conn);
  if (!archive) return done;
  if (!done) return true;
  if (!filter) return false;
  const tag = boardMessageEventId(m) || m.eventId || "";
  const cid = tag ? "" : boardMessageConversationId(m, list);
  const id = tag || (cid ? boardConversationEventId(list, cid) : "");
  return id !== filter;
}

function boardEventTabDate(ev) {
  const when = Number(ev?.when) || 0;
  if (!when || typeof cardDateCornerLabel !== "function") return "";
  const day = typeof planDayStart === "function" ? planDayStart(when) : when;
  return cardDateCornerLabel(day);
}

function boardActiveMessages() {
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const id = typeof S !== "undefined" ? S.activeView?.id : null;
  return (id && conn?.messages?.[id]) || [];
}

// Continuation must resolve everything displayed in the feed, including event notes.
function boardContinuationMessages() {
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const id = typeof S !== "undefined" ? S.activeView?.id : null;
  const ch = conn?.channels?.find((item) => item.id === id);
  const list = ch && typeof collatedChatMessages === "function" ? collatedChatMessages(ch) : boardActiveMessages();
  if (typeof boardKeepChains === "function") boardKeepChains(list);
  return list;
}

/** Your RSVP state for an event, used the same way everywhere (cards, the
 *  event list, the # picker, the event header, #labels):
 *    "need"  — RSVP is open to you and you haven't answered (shown by its control)
 *    "going" — you're going / signed up (normal)
 *    "out"   — you can't go (faded)
 *    "none"  — nothing to answer (your own event, or RSVP closed): normal */
function boardEventRsvpState(ev, conn) {
  if (!ev || ev._missing) return "none";
  const mine = typeof timelineMyRsvp === "function" ? timelineMyRsvp(ev) : null;
  if (mine === "out") return "out";
  if (mine) return "going";
  conn = conn || (typeof activeConn === "function" ? activeConn() : null);
  if (typeof timelineCanRsvp === "function" && !timelineCanRsvp(ev)) return "none";
  if (conn?.me?.id && ev.createdBy === conn.me.id) return "none";
  return "need";
}

/** Short event name for labels and the stepper: the event's own short name
 *  (first two words, ≤14 characters) — the card keeps the full title. */
function boardEventShortLabel(ev) {
  if (!ev) return "Event";
  const short = typeof eventShortName === "function" ? String(eventShortName(ev) || "").trim() : "";
  return short || boardEventTitle(ev);
}
