/* ---------------------- 030 · Chat scope (sticky-forward) ---------------- */



/** Explicit event ids on a message (multi + legacy single eventId). */
function messageMentionedEventIds(m) {
  if (!m) return [];
  const out = [];
  const seen = new Set();
  const add = (id) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  if (Array.isArray(m.mentionedEventIds)) {
    for (const id of m.mentionedEventIds) add(id);
  }
  add(m.eventId);
  return out;
}


/**
 * Explicit tags only. Nearby messages do not inherit an event, and replies
 * join a conversation group instead of copying a tag by position.
 */
function assignChatRunningScopes(messages) {
  const out = [];
  for (const m of messages || []) {
    const explicit = messageMentionedEventIds(m);
    m._explicitEventIds = explicit;
    m._scopeEventId = explicit.length ? explicit[explicit.length - 1] : null;
    out.push(m);
  }
  return out;
}

/** Seen-cursor key for General (unattached) chat, distinct from event threads. */
const CHAT_GENERAL_SEEN_ID = "__general__";

/** Messages with no explicit event attach (General “not on an event” filter). */
function messagesNotAttachedToEvent(messages) {
  return (messages || []).filter(m => !messageMentionedEventIds(m).length);
}

function clearChatStreamFilters() {
  if (typeof S === "undefined") return;
  S.chatFilterEventId = null;
  S.chatFilterUntagged = false;
  S.memoryChatReadonly = false;
}

/** Event filters use explicit mentions, just like All chat. */
function messagesInEventScope(messages, eventId) {
  if (!eventId) return messages || [];
  return assignChatRunningScopes((messages || []).map(m => ({ ...m })))
    .filter(m => m._explicitEventIds.includes(eventId));
}

/** Explicit mention count for an event (card badge — not inferred). */
function explicitEventMentionCount(messages, eventId) {
  if (!eventId) return 0;
  let n = 0;
  for (const m of messages || []) {
    if (messageMentionedEventIds(m).includes(eventId)) n++;
  }
  return n;
}

/**
 * Events for the chat card rail, by event date.
 * Default: only events with an explicit mention in the stream.
 * `includeAll`: every event in scope (right-sidebar filters before any chat).
 * Past calendar days are excluded (they live in Memories).
 */
function chatRailEvents(messages, events, limit = 12, { includeAll = false } = {}) {
  const keep = (e) => (typeof isMainViewEvent === "function" ? isMainViewEvent(e) : !!(e && !e.chainOf));
  if (includeAll) {
    return (events || [])
      .filter(keep)
      .sort((a, b) => (Number(a.when) || 0) - (Number(b.when) || 0))
      .slice(0, Math.max(0, limit));
  }
  const byId = new Map((events || []).filter(keep).map(e => [e.id, e]));
  const seen = new Set();
  for (const m of messages || []) {
    for (const id of messageMentionedEventIds(m)) {
      if (byId.has(id)) seen.add(id);
    }
  }
  return [...seen]
    .map(id => byId.get(id))
    .filter(Boolean)
    .sort((a, b) => (Number(a.when) || 0) - (Number(b.when) || 0))
    .slice(0, limit);
}


/** Primary tag key for same-author stacking: first mentioned event id, or "" if unattached. */
function chatMessageGroupTag(m) {
  if (!m) return "";
  const ids = typeof messageMentionedEventIds === "function"
    ? messageMentionedEventIds(m)
    : (m.eventId ? [m.eventId] : []);
  return ids[0] || "";
}

/**
 * Render-only: consecutive plain messages from the same person in the same tag
 * (or both unattached) within 5 minutes stack under one head.
 */
function chatMessagesGroupTogether(prev, next) {
  if (!prev || !next) return false;
  if (prev.activity || next.activity || prev._eventLinkMarker || next._eventLinkMarker) return false;
  if (prev.taskId || next.taskId) return false;
  if (!prev.userId || prev.userId !== next.userId) return false;
  if (chatMessageGroupTag(prev) !== chatMessageGroupTag(next)) return false;
  const prevTs = Number(prev.ts) || 0;
  const nextTs = Number(next.ts) || 0;
  return nextTs - prevTs < 5 * 60e3;
}

const SHARE_EVENT_GRACE_MS = 2 * 60 * 60 * 1000;

/** Duration ms matching host purge window (incl. period codes). */
function eventDurationMsClient(code) {
  const mins = typeof durationToMs === "function" ? durationToMs(code) : null;
  if (mins != null) return mins;
  const c = typeof normalizeDuration === "function" ? normalizeDuration(code) : code;
  if (c === "morning" || c === "afternoon" || c === "evening") return 4 * 3600e3;
  if (c === "day") return 12 * 3600e3;
  return 3600e3;
}

function eventEndedAtMs(ev) {
  if (!ev?.when) return null;
  return ev.when + eventDurationMsClient(ev.duration) + SHARE_EVENT_GRACE_MS;
}

function ensureActiveEventChannel() {
  const conn = activeConn();
  const eventChannels = (conn?.channels || group()?.channels || []).filter(c => c.kind === "event");
  const viewed = eventChannelIdFromView();
  if (viewed && eventChannels.some(c => c.id === viewed)) {
    S.activeEventChannelId = viewed;
    return viewed;
  }
  if (!S.activeEventChannelId || !eventChannels.some(c => c.id === S.activeEventChannelId))
    S.activeEventChannelId = eventChannels[0]?.id || null;
  return S.activeEventChannelId;
}

/** Event channel id for the view the user is looking at, if any. */
function eventChannelIdFromView() {
  const g = group();
  if (!g || !S.activeView) return null;
  if (S.activeView.kind === "channel") {
    const ch = g.channels.find(c => c.id === S.activeView.id);
    return ch?.kind === "event" ? ch.id : null;
  }
  if (S.activeView.kind === "eventDetail") {
    const ev = g.events.find(e => e.id === S.activeView.id);
    return ev?.channelId || null;
  }
  return null;
}

/** If this server has no event group yet, create a default "Plans" channel so an event can be created. */
async function ensureOrCreateEventChannel() {
  const existing = ensureActiveEventChannel();
  if (existing) return existing;
  const conn = activeConn();
  if (!conn || PersonalSpace.isPersonal(conn) || !canManageServer(conn)) return null;
  const msg = {
    type: "createChannel",
    name: "Plans",
    kind: "event",
    allowedUserIds: conn.me?.id ? [conn.me.id] : undefined,
  };
  if (conn._transport === "http") {
    await httpRpc(conn, msg);
  } else {
    send(msg);
    for (let i = 0; i < 40 && !ensureActiveEventChannel(); i++) {
      await new Promise(r => setTimeout(r, 50));
    }
  }
  return ensureActiveEventChannel();
}

const CHANNEL_READ_KEY = "ash_channel_read_v1";
let channelReadCache = null;

function loadChannelReadMap() {
  if (channelReadCache) return channelReadCache;
  try {
    channelReadCache = JSON.parse(localStorage.getItem(CHANNEL_READ_KEY) || "{}") || {};
  } catch {
    channelReadCache = {};
  }
  return channelReadCache;
}

function saveChannelReadMap() {
  try {
    localStorage.setItem(CHANNEL_READ_KEY, JSON.stringify(channelReadCache || {}));
  } catch {}
}

function channelReadKey(connId, channelId) {
  return `${connId || ""}:${channelId || ""}`;
}

function getChannelReadTs(connId, channelId) {
  const v = loadChannelReadMap()[channelReadKey(connId, channelId)];
  return typeof v === "number" ? v : 0;
}

function setChannelReadTs(connId, channelId, ts) {
  if (!connId || !channelId) return;
  const map = loadChannelReadMap();
  const key = channelReadKey(connId, channelId);
  const next = Math.max(0, Number(ts) || 0);
  if ((map[key] || 0) >= next) return;
  map[key] = next;
  channelReadCache = map;
  saveChannelReadMap();
}

/** Seed unread cursors so existing history isn’t treated as unread on first load. */
function seedChannelReadCursors(conn) {
  if (!conn?.id || !conn.messages) return;
  const map = loadChannelReadMap();
  let changed = false;
  for (const [chId, list] of Object.entries(conn.messages)) {
    const key = channelReadKey(conn.id, chId);
    if (map[key] != null) continue;
    let maxTs = 0;
    for (const m of list || []) if ((m.ts || 0) > maxTs) maxTs = m.ts || 0;
    map[key] = maxTs || Date.now();
    changed = true;
  }
  if (changed) {
    channelReadCache = map;
    saveChannelReadMap();
  }
}

function markChannelRead(conn, channelId) {
  if (!conn?.id || !channelId) return;
  const list = conn.messages?.[channelId] || [];
  let maxTs = Date.now();
  for (const m of list) if ((m.ts || 0) > maxTs) maxTs = m.ts;
  setChannelReadTs(conn.id, channelId, maxTs);
}

const EVENT_CHAT_SEEN_KEY = "ash_event_chat_seen_v1";
let eventChatSeenCache = null;

function loadEventChatSeenMap() {
  if (eventChatSeenCache) return eventChatSeenCache;
  try {
    eventChatSeenCache = JSON.parse(localStorage.getItem(EVENT_CHAT_SEEN_KEY) || "{}") || {};
  } catch {
    eventChatSeenCache = {};
  }
  return eventChatSeenCache;
}

function saveEventChatSeenMap() {
  try {
    localStorage.setItem(EVENT_CHAT_SEEN_KEY, JSON.stringify(eventChatSeenCache || {}));
  } catch {}
}

function eventChatSeenKey(connId, channelId, eventId) {
  return `${connId || ""}:${channelId || ""}:${eventId || ""}`;
}

function getEventChatSeenTs(connId, channelId, eventId) {
  const v = loadEventChatSeenMap()[eventChatSeenKey(connId, channelId, eventId)];
  return typeof v === "number" ? v : 0;
}

function setEventChatSeenTs(connId, channelId, eventId, ts) {
  if (!connId || !channelId || !eventId) return;
  const map = loadEventChatSeenMap();
  const key = eventChatSeenKey(connId, channelId, eventId);
  const next = Math.max(0, Number(ts) || 0);
  if ((map[key] || 0) >= next) return;
  map[key] = next;
  eventChatSeenCache = map;
  saveEventChatSeenMap();
}

function maxExplicitMentionTs(messages, eventId) {
  let maxTs = 0;
  if (!eventId || typeof messageMentionedEventIds !== "function") return maxTs;
  for (const m of messages || []) {
    if (!messageMentionedEventIds(m).includes(eventId)) continue;
    if ((m.ts || 0) > maxTs) maxTs = m.ts || 0;
  }
  return maxTs;
}

/** First sight of a rail event — treat current mentions as already read. */
function seedEventChatFilterSeen(conn, channelId, eventId, messages) {
  if (!conn?.id || !channelId || !eventId) return;
  const map = loadEventChatSeenMap();
  const key = eventChatSeenKey(conn.id, channelId, eventId);
  if (map[key] != null) return;
  map[key] = maxExplicitMentionTs(messages, eventId) || Date.now();
  eventChatSeenCache = map;
  saveEventChatSeenMap();
}

/** Opening / filtering an event chat clears that event's mention badge to read. */
function markEventChatFilterSeen(conn, channelId, eventId, messages) {
  if (!conn?.id || !channelId || !eventId) return;
  const maxTs = Math.max(Date.now(), maxExplicitMentionTs(messages, eventId));
  setEventChatSeenTs(conn.id, channelId, eventId, maxTs);
}

/** True when someone else's explicit mention is newer than the filter seen cursor. */
function eventChatFilterHasUnread(messages, eventId, conn, channelId) {
  if (!conn?.id || !channelId || !eventId) return false;
  const seenTs = getEventChatSeenTs(conn.id, channelId, eventId);
  if (!seenTs) return false;
  const meId = conn.me?.id;
  if (typeof messageMentionedEventIds !== "function") return false;
  for (const m of messages || []) {
    if ((m.ts || 0) <= seenTs) continue;
    if (meId && m.userId === meId) continue;
    if (messageMentionedEventIds(m).includes(eventId)) return true;
  }
  return false;
}

const EVENT_SEEN_KEY = "ash_event_seen_v1";
let eventSeenCache = null;

function loadEventSeenMap() {
  if (eventSeenCache) return eventSeenCache;
  try {
    eventSeenCache = JSON.parse(localStorage.getItem(EVENT_SEEN_KEY) || "{}") || {};
  } catch {
    eventSeenCache = {};
  }
  return eventSeenCache;
}

function saveEventSeenMap() {
  try {
    localStorage.setItem(EVENT_SEEN_KEY, JSON.stringify(eventSeenCache || {}));
  } catch {}
}

function eventSeenKey(connId, eventId) {
  return `${connId || ""}:${eventId || ""}`;
}

function getEventSeenTs(connId, eventId) {
  const v = loadEventSeenMap()[eventSeenKey(connId, eventId)];
  return typeof v === "number" ? v : 0;
}

function setEventSeenTs(connId, eventId, ts) {
  if (!connId || !eventId) return;
  const map = loadEventSeenMap();
  const key = eventSeenKey(connId, eventId);
  const next = Math.max(0, Number(ts) || 0);
  if ((map[key] || 0) >= next) return;
  map[key] = next;
  eventSeenCache = map;
  saveEventSeenMap();
}

/** Seed so existing notes aren’t all treated as unread on first load / upgrade. */
function seedEventSeenCursors(conn) {
  if (!conn?.id || !conn.events) return;
  const map = loadEventSeenMap();
  let changed = false;
  for (const ev of conn.events) {
    if (!ev?.id) continue;
    const key = eventSeenKey(conn.id, ev.id);
    if (map[key] != null) continue;
    let maxTs = 0;
    for (const n of ev.notes || []) if ((n.ts || 0) > maxTs) maxTs = n.ts || 0;
    map[key] = maxTs || Date.now();
    changed = true;
  }
  if (changed) {
    eventSeenCache = map;
    saveEventSeenMap();
  }
}

/** Mark an event seen through the latest note timestamp (014: seen = opened). */
function markEventSeen(conn, ev) {
  if (!conn?.id || !ev?.id) return;
  let maxTs = Date.now();
  for (const n of ev.notes || []) if ((n.ts || 0) > maxTs) maxTs = n.ts;
  setEventSeenTs(conn.id, ev.id, maxTs);
}

/** Unread count for a sidebar channel row (chat messages or event invites). */
function channelUnreadCount(conn, ch, events) {
  if (!conn || !ch) return 0;
  if (ch.kind === "event") {
    const today = typeof dayStart === "function" ? dayStart(Date.now()) : Date.now() - 864e5;
    let n = 0;
    for (const ev of events || conn.events || []) {
      if (ev.channelId !== ch.id || ev.chainOf || ev.when == null || ev.when < today) continue;
      if (typeof isUnansweredInvite === "function" && isUnansweredInvite(ev, conn)) n++;
    }
    const avails = typeof upcomingChannelAvailabilities === "function"
      ? upcomingChannelAvailabilities(conn, ch)
      : [];
    for (const a of avails) {
      if (typeof isUnansweredAvailability === "function" && isUnansweredAvailability(a, conn)) n++;
    }
    return n;
  }
  return channelMessageUnreadCount(conn, ch);
}

/** Unread chat messages in a channel (excludes own). Used by the header Chat icon. */
function channelMessageUnreadCount(conn, ch) {
  if (!conn || !ch) return 0;
  const meId = conn.me?.id;
  const readTs = getChannelReadTs(conn.id, ch.id);
  if (!readTs) return 0;
  let n = 0;
  for (const m of conn.messages?.[ch.id] || []) {
    if ((m.ts || 0) <= readTs) continue;
    if (meId && m.userId === meId) continue;
    n++;
  }
  return n;
}

const upcoming = (events) => events.filter(e => e.when >= Date.now() - 3 * 3600e3).sort((a, b) => a.when - b.when);
const past = (events) => events.filter(e => e.when < Date.now() - 3 * 3600e3).sort((a, b) => a.when - b.when).slice(-10);

function isEventPastDay(ev) {
  if (!ev || ev.when == null) return false;
  const today = typeof dayStart === "function"
    ? dayStart(Date.now())
    : new Date().setHours(0, 0, 0, 0);
  return Number(ev.when) < today;
}

function isMainViewEvent(ev) {
  return !!(ev && !ev.chainOf && !isEventPastDay(ev));
}

const viewingEvent = (id) => S.activeView?.kind === "eventDetail" && S.activeView.id === id;

const fmtTime = (ts) => formatClockTime(ts);
const fmtDay = (ts) => new Date(ts).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
