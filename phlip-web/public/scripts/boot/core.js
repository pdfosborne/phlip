/* Phlip client */

const $ = (s) => document.querySelector(s);

// Multi-server state model. S.conns holds one entry per connected server plus
// a pseudo-connection "personal" for the purely local, device-only space.
// conn = { id, url, name, ws, token, pass, key, me, hostName, groups,
//          messages, members, online, pendingReqs, invite, notifications,
//          status: "connecting"|"online"|"offline"|"waiting"|"denied", local, retryDelay }
const S = {
  conns: {},
  activeConnId: "personal",
  // A board opened from Personal while its canonical content remains owned by
  // another connection. The rail/drawer use activeConnId; content helpers use
  // this source context (see activeConn in feel.js).
  activeProjection: null, // { sourceConnId, sourceBoardId, sourceChannelId }
  activeView: null,   // { kind: "channel", id } or { kind: "events" }
  hand: { mode: "context", pending: null }, // current create-draft session; no card-hand tray
  sidebarReorderActive: false, // channel drag in progress in the left drawer
  sidebarReorderMode: false,   // explicit reorder mode (drag channels)
  sidebarReorderSection: null, // data-side-section while sidebarReorderMode
  sidebarReorderFocusId: null, // channel id that opened reorder mode
  sidebarReorderSnapshot: null, // channel ids at enter — Undo restores this
  activeEventChannelId: null,  // which event channel the events board is currently scoped to (create target)
  boardSurfaces: {},           // event channelId → "conversations" | "agenda"
  conversationsReturn: null,   // { connId, eventChannelId, projection } when a row was opened from the list
  conversationsThread: null,   // { eventId, tab: "chat"|"attendance"|"description" } event sub-chat from Conversations
  anchor: 0,                   // midnight ms of the day anchoring the viewed period (0 → today)
  viewingHistory: false,       // Memories (History): past-only monthly timeline
  memoriesChannelId: null,     // null = all event groups
  memoriesMemberId: null,      // null = anyone
  // Live meta channel (personal): guest microsites currently broadcasting
  // across joined servers — see renderLiveChannel / allActiveShares.
  historyAnchor: 0,            // midnight ms of a day in the history month being viewed (0 → this month)
  taggedEventId: null,   // legacy single #tag — prefer mentionedEventIds
  mentionedEventIds: [], // 030 — events #mentioned on the composer (multi)
  taggedMirrorChatKey: null, // personal chat → remote mirror: "connId|channelId"
  chatFilterEventId: null, // 030 — sticky-forward filter on event-group chat
  chatFilterUntagged: false, // General chat: messages with no event attached
  memoryChatReadonly: false, // past event opened from Memories — keep filter, lock composer
  autoTagEventId: null,  // 030 — suggested auto-tag chip (removable)
  /** Latest Worker KV meter from edge pull / share push (`writes`, `budget`, `plan`, `limited`). */
  edgeKv: null,
  mentionedUserIds: [],  // chat / event-thread composer: people @-mentioned (notified on send)
  taskDrafts: new Map(), // task-channel id → unsaved composer text
  taskUiState: new Map(), // task-channel id → local presentation state
  pendingEventId: null,  // from a shared ?event= deep link — consumed once that event's conn welcomes in
  pendingInviteLink: null, // from an invite link opened in a browser — prefills the join modal after boot
  pendingFocusNewEvent: false, // next eventCreated by us should take the focus band
  eventsViewPrefs: { rsvpFilter: "all", hideTimeBlocks: false, hideAvailability: false, hideMaybe: false, hideNo: false },
  feelPrefs: {
    muteSound: false,
    soundStrength: 0.55,
    soundFlick: true,
    soundScroll: true,
    soundConfirm: true,
  },
};

const FEEL_PREFS_KEY = "ash_feel_prefs_v1";
function clamp01(n, fallback = 0.5) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(0, Math.min(1, x));
}
/** Missing keys count as on — older saved prefs stay fully enabled per type. */
function feelChannelOn(prefs, channel) {
  const key = ({ flick: "soundFlick", scroll: "soundScroll", confirm: "soundConfirm" })[channel];
  if (!key) return true;
  return prefs?.[key] !== false;
}
function loadFeelPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(FEEL_PREFS_KEY) || "null");
    if (raw && typeof raw === "object") {
      S.feelPrefs = {
        muteSound: !!raw.muteSound,
        soundStrength: clamp01(raw.soundStrength, 0.55),
        soundFlick: raw.soundFlick !== false,
        soundScroll: raw.soundScroll !== false,
        soundConfirm: raw.soundConfirm !== false,
      };
    }
  } catch {}
  return S.feelPrefs;
}
function saveFeelPrefs() {
  try {
    localStorage.setItem(FEEL_PREFS_KEY, JSON.stringify(S.feelPrefs));
  } catch {}
}
loadFeelPrefs();

const EVENTS_VIEW_PREFS_KEY = "ash_events_view_prefs_v1";
/** RSVP view filter: all → needs-reply only → I'm hosting. Hide maybe/no are separate prefs. */
const RSVP_FILTER_MODES = ["all", "only", "hosting"];
function normalizeRsvpFilter(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "hide") return "all";
  return RSVP_FILTER_MODES.includes(v) ? v : "all";
}
function rsvpFilterMode(prefs = loadEventsViewPrefs()) {
  if (typeof S !== "undefined" && S.activeConnId === "personal" && S.activeView?.kind === "channel"
      && S.activeView.id === "pch-device-calendar") return "all";
  if (prefs.rsvpFilter != null) return normalizeRsvpFilter(prefs.rsvpFilter);
  return "all";
}
/** No RSVP yet (can still reply). Organiser check left to callers that need it. */
function isUnansweredRsvp(ev) {
  const meId = myIdOf(ev);
  if (!meId) return false;
  return !ev?.rsvps?.[meId];
}
function isMaybeRsvp(ev) {
  return ev?.rsvps?.[myIdOf(ev)] === "maybe";
}
function isOutRsvp(ev) {
  return ev?.rsvps?.[myIdOf(ev)] === "out";
}
function setRsvpFilter(mode, prefs = loadEventsViewPrefs()) {
  prefs.rsvpFilter = normalizeRsvpFilter(mode);
  delete prefs.hideDeclined;
  delete prefs.hideUnanswered;
  S.eventsViewPrefs = prefs;
  saveEventsViewPrefs();
  return prefs.rsvpFilter;
}
function hideTimeBlocksPref(prefs = loadEventsViewPrefs()) {
  return !!prefs.hideTimeBlocks;
}
function setHideTimeBlocks(on, prefs = loadEventsViewPrefs()) {
  prefs.hideTimeBlocks = !!on;
  S.eventsViewPrefs = prefs;
  saveEventsViewPrefs();
  return prefs.hideTimeBlocks;
}
function hideAvailabilityPref(prefs = loadEventsViewPrefs()) {
  return !!prefs.hideAvailability;
}
function setHideAvailability(on, prefs = loadEventsViewPrefs()) {
  prefs.hideAvailability = !!on;
  S.eventsViewPrefs = prefs;
  saveEventsViewPrefs();
  return prefs.hideAvailability;
}
function hideNoPref(prefs = loadEventsViewPrefs()) {
  return !!prefs.hideNo;
}
function setHideNo(on, prefs = loadEventsViewPrefs()) {
  prefs.hideNo = !!on;
  S.eventsViewPrefs = prefs;
  saveEventsViewPrefs();
  return prefs.hideNo;
}
/** Explicit ⋮ choice, or unset for auto (wide → list, narrow → timeline). */
function normalizeEventsLayout(raw) {
  const v = String(raw || "").trim().toLowerCase();
  return v === "list" || v === "timeline" || v === "cards" ? v : "";
}
function eventsLayoutMode(prefs = loadEventsViewPrefs()) {
  const explicit = normalizeEventsLayout(prefs && prefs.eventsLayout);
  if (explicit) return explicit;
  return (typeof isNarrowShell === "function" && isNarrowShell()) ? "timeline" : "list";
}
function setEventsLayout(mode, prefs = loadEventsViewPrefs()) {
  const v = String(mode || "").trim().toLowerCase();
  if (v === "auto" || v === "") delete prefs.eventsLayout;
  else if (v === "list" || v === "timeline" || v === "cards") prefs.eventsLayout = v;
  S.eventsViewPrefs = prefs;
  saveEventsViewPrefs();
  return eventsLayoutMode(prefs);
}
function migrateHideRsvpPrefs(prefs, raw = null) {
  let hideMaybe = !!prefs.hideMaybe;
  let hideNo = !!prefs.hideNo;
  if (String(prefs.rsvpFilter || "").toLowerCase() === "hide") {
    prefs.rsvpFilter = "all";
    hideMaybe = true;
    hideNo = true;
  }
  if (raw?.hideMaybe != null) hideMaybe = !!raw.hideMaybe;
  if (raw?.hideNo != null) hideNo = !!raw.hideNo;
  if (!hideMaybe && !hideNo && (prefs.hideDeclined || prefs.hideUnanswered)) {
    hideMaybe = true;
    hideNo = true;
  }
  prefs.hideMaybe = hideMaybe;
  prefs.hideNo = hideNo;
}
/** Back to show-all (session-only; not written to disk). */
function resetRsvpFilter() {
  const prefs = loadEventsViewPrefs();
  if (rsvpFilterMode(prefs) === "all") return false;
  prefs.rsvpFilter = "all";
  delete prefs.hideDeclined;
  delete prefs.hideUnanswered;
  S.eventsViewPrefs = prefs;
  return true;
}
function loadEventsViewPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(EVENTS_VIEW_PREFS_KEY) || "null");
    if (raw && typeof raw === "object") {
      // rsvpFilter is session-only — restart always starts at show-all.
      // Keep the in-memory mode across mid-session load() calls.
      const sessionFilter = S.eventsViewPrefs?.rsvpFilter != null
        ? normalizeRsvpFilter(S.eventsViewPrefs.rsvpFilter)
        : "all";
      S.eventsViewPrefs = {
        rsvpFilter: sessionFilter,
        hideTimeBlocks: !!raw.hideTimeBlocks,
        hideAvailability: !!raw.hideAvailability,
        hideMaybe: !!raw.hideMaybe,
        hideNo: !!raw.hideNo,
      };
      const layout = normalizeEventsLayout(raw.eventsLayout);
      if (layout) S.eventsViewPrefs.eventsLayout = layout;
      migrateHideRsvpPrefs(S.eventsViewPrefs, raw);
    }
  } catch {}
  if (!S.eventsViewPrefs) {
    S.eventsViewPrefs = { rsvpFilter: "all", hideTimeBlocks: false, hideAvailability: false, hideMaybe: false, hideNo: false };
  } else {
    if (S.eventsViewPrefs.rsvpFilter == null) S.eventsViewPrefs.rsvpFilter = "all";
    if (S.eventsViewPrefs.hideTimeBlocks == null) S.eventsViewPrefs.hideTimeBlocks = false;
    if (S.eventsViewPrefs.hideAvailability == null) S.eventsViewPrefs.hideAvailability = false;
    if (S.eventsViewPrefs.hideMaybe == null) S.eventsViewPrefs.hideMaybe = false;
    if (S.eventsViewPrefs.hideNo == null) S.eventsViewPrefs.hideNo = false;
    migrateHideRsvpPrefs(S.eventsViewPrefs);
  }
  return S.eventsViewPrefs;
}
function saveEventsViewPrefs() {
  try {
    const prefs = S.eventsViewPrefs || loadEventsViewPrefs();
    // RSVP filter is session-only; the rest persists.
    const saved = {
      hideTimeBlocks: !!prefs.hideTimeBlocks,
      hideAvailability: !!prefs.hideAvailability,
      hideMaybe: !!prefs.hideMaybe,
      hideNo: !!prefs.hideNo,
    };
    const layout = normalizeEventsLayout(prefs.eventsLayout);
    if (layout) saved.eventsLayout = layout;
    localStorage.setItem(EVENTS_VIEW_PREFS_KEY, JSON.stringify(saved));
  } catch {}
}
/** Primary events only — chain rows follow their primary. */
function eventPassesRsvpFilter(ev, prefs = loadEventsViewPrefs()) {
  if (!ev || ev.chainOf) return true;
  const mode = rsvpFilterMode(prefs);
  if (mode === "only" && !isUnansweredRsvp(ev)) return false;
  if (mode === "hosting") {
    if (typeof isEventOrganiser === "function") {
      if (!isEventOrganiser(ev)) return false;
    } else {
      const meId = myIdOf(ev);
      if (!meId || ev.createdBy !== meId) return false;
    }
  }
  if (prefs.hideMaybe && isMaybeRsvp(ev)) return false;
  if (prefs.hideNo && isOutRsvp(ev)) return false;
  return true;
}
loadEventsViewPrefs();

const LINKED_EVENT_FEEDS_KEY = "ash_linked_event_feeds_v1";
/** @type {Record<string, {connId:string, channelId:string}[]>} */
let linkedEventFeedsCache = null;

function linkedFeedKey(connId, channelId) {
  return `${connId || ""}:${channelId || ""}`;
}
function loadLinkedEventFeeds() {
  if (linkedEventFeedsCache) return linkedEventFeedsCache;
  try {
    const raw = JSON.parse(localStorage.getItem(LINKED_EVENT_FEEDS_KEY) || "{}");
    linkedEventFeedsCache = raw && typeof raw === "object" ? raw : {};
  } catch {
    linkedEventFeedsCache = {};
  }
  return linkedEventFeedsCache;
}
function saveLinkedEventFeeds() {
  try {
    localStorage.setItem(LINKED_EVENT_FEEDS_KEY, JSON.stringify(linkedEventFeedsCache || {}));
  } catch {}
}
function linkedEventSourcesFor(connId, channelId) {
  const map = loadLinkedEventFeeds();
  const list = map[linkedFeedKey(connId, channelId)];
  return Array.isArray(list) ? list.filter(l => l && l.connId && l.channelId) : [];
}
/**
 * Direct links plus nested ones (pass-through). If Plans links A+B and Events
 * links Plans, Events resolves to Plans, A, and B. Cycle-safe.
 */
function expandedLinkedEventSourcesFor(connId, channelId) {
  const out = [];
  const seen = new Set([linkedFeedKey(connId, channelId)]);
  const queue = [...directLinkedEventSourcesFor(connId, channelId)];
  while (queue.length) {
    const l = queue.shift();
    if (!l?.connId || !l?.channelId) continue;
    const k = linkedFeedKey(l.connId, l.channelId);
    if (seen.has(k)) continue;
    seen.add(k);
    // Meta board id is not a real calendar — never treat it as a feed source.
    if (isPersonalMetaEventsLinkTarget(l.connId, l.channelId)) continue;
    // Nested pass-through also skips Personal when the root target is a shared server.
    const rootIsPersonal = connId === "personal"
      || (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(S.conns?.[connId]));
    if (!rootIsPersonal && (l.connId === "personal"
        || (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(S.conns?.[l.connId])))) {
      continue;
    }
    out.push({ connId: l.connId, channelId: l.channelId });
    for (const nested of directLinkedEventSourcesFor(l.connId, l.channelId)) {
      queue.push(nested);
    }
  }
  return out;
}
/**
 * Stored direct links. Meta Events may only point at calendars on the same
 * server; nested cross-server links still arrive via pass-through.
 * Shared-server targets never keep Personal sources (Personal is import-only).
 */
function directLinkedEventSourcesFor(connId, channelId) {
  const list = linkedEventSourcesFor(connId, channelId);
  if (isPersonalMetaEventsLinkTarget(connId, channelId)) {
    return list.filter(l => l.connId === connId);
  }
  const targetIsPersonal = connId === "personal"
    || (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(S.conns?.[connId]));
  if (targetIsPersonal) return list;
  return list.filter(l => {
    if (!l?.connId) return false;
    if (l.connId === "personal") return false;
    const c = S.conns?.[l.connId];
    return !(c && typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(c));
  });
}
function setLinkedEventSources(connId, channelId, sources) {
  const map = loadLinkedEventFeeds();
  const key = linkedFeedKey(connId, channelId);
  const meta = isPersonalMetaEventsLinkTarget(connId, channelId);
  const targetIsPersonal = connId === "personal"
    || (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(S.conns?.[connId]));
  const clean = (sources || [])
    .filter(l => l && l.connId && l.channelId)
    .filter(l => !(l.connId === connId && l.channelId === channelId))
    .filter(l => !meta || l.connId === connId)
    // Personal never outbound-links into another server’s event channel.
    .filter(l => {
      if (targetIsPersonal) return true;
      if (l.connId === "personal") return false;
      const c = S.conns?.[l.connId];
      return !(c && typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(c));
    });
  // Dedupe.
  const seen = new Set();
  const out = [];
  for (const l of clean) {
    const k = linkedFeedKey(l.connId, l.channelId);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ connId: l.connId, channelId: l.channelId });
  }
  if (out.length) map[key] = out;
  else delete map[key];
  linkedEventFeedsCache = map;
  saveLinkedEventFeeds();
}
function sourceChannelsFor(conn) {
  if (!conn) return [];
  if (Array.isArray(conn.channels) && conn.channels.length) return conn.channels;
  return loadCache(conn.id)?.channels || [];
}
function connDisplayName(conn) {
  if (!conn) return "Server";
  if (PersonalSpace.isPersonal(conn)) return "Personal";
  return conn.name || conn.hostName || "Server";
}
/**
 * Event channels available to link into a target (import sources).
 * Meta Events: same server only.
 * Personal targets: may import from any joined server.
 * Shared-server targets: never offer Personal (Personal is import-only, never outbound).
 */
function allLinkableEventChannels(excludeConnId, excludeChannelId, opts = {}) {
  const onlyConnId = opts.onlyConnId
    || (isPersonalMetaEventsLinkTarget(excludeConnId, excludeChannelId) ? excludeConnId : null);
  const targetIsPersonal = excludeConnId === "personal"
    || (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(S.conns?.[excludeConnId]));
  const rows = [];
  for (const c of Object.values(S.conns || {})) {
    if (!c) continue;
    if (onlyConnId && c.id !== onlyConnId) continue;
    // Personal never appears as a link source for another server’s channels.
    if (!targetIsPersonal && (c.id === "personal" || PersonalSpace.isPersonal(c))) continue;
    const serverName = connDisplayName(c);
    for (const ch of sourceChannelsFor(c)) {
      const isEvent = ch.kind === "event" || (!ch.kind && PersonalSpace.isPersonal(c));
      if (!isEvent) continue;
      if (typeof PersonalSpace !== "undefined" && PersonalSpace.isHiddenChannel(ch, c)) continue;
      if (c.id === excludeConnId && ch.id === excludeChannelId) continue;
      rows.push({
        connId: c.id,
        channelId: ch.id,
        serverName,
        channelName: ch.name || "Events",
      });
    }
  }
  return rows;
}

/** Device-local: personal chat channels that pull messages from remote chats. */
const LINKED_CHAT_MIRRORS_KEY = "ash_linked_chat_mirrors_v1";
/** @type {Record<string, {connId:string, channelId:string}[]>} */
let linkedChatMirrorsCache = null;

function loadLinkedChatMirrors() {
  if (linkedChatMirrorsCache) return linkedChatMirrorsCache;
  try {
    const raw = JSON.parse(localStorage.getItem(LINKED_CHAT_MIRRORS_KEY) || "{}");
    linkedChatMirrorsCache = raw && typeof raw === "object" ? raw : {};
  } catch {
    linkedChatMirrorsCache = {};
  }
  return linkedChatMirrorsCache;
}
function saveLinkedChatMirrors() {
  try {
    localStorage.setItem(LINKED_CHAT_MIRRORS_KEY, JSON.stringify(linkedChatMirrorsCache || {}));
  } catch {}
}

/** Mirrors stored for a personal chat channel id. */
function directLinkedChatMirrorsFor(personalChatId) {
  const id = String(personalChatId || "").trim();
  if (!id) return [];
  const map = loadLinkedChatMirrors();
  const list = map[linkedFeedKey("personal", id)];
  return Array.isArray(list) ? list.filter(l => l && l.connId && l.channelId) : [];
}

function setLinkedChatMirrors(personalChatId, sources) {
  const id = String(personalChatId || "").trim();
  if (!id) return;
  const map = loadLinkedChatMirrors();
  const key = linkedFeedKey("personal", id);
  const clean = (sources || [])
    .filter(l => l && l.connId && l.channelId)
    .filter(l => l.connId !== "personal");
  const seen = new Set();
  const out = [];
  for (const l of clean) {
    const k = linkedFeedKey(l.connId, l.channelId);
    if (seen.has(k)) continue;
    // Only keep entries that still resolve to a chat channel when known.
    const c = S.conns?.[l.connId];
    if (c) {
      if (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(c)) continue;
      const ch = sourceChannelsFor(c).find(x => x.id === l.channelId);
      if (!ch || ch.kind === "event") continue;
    }
    seen.add(k);
    out.push({ connId: l.connId, channelId: l.channelId });
  }
  if (out.length) map[key] = out;
  else delete map[key];
  linkedChatMirrorsCache = map;
  saveLinkedChatMirrors();
}

/** Device-local: hosted boards the user chose to show in Personal. */
const PERSONAL_SHOWN_BOARDS_KEY = "ash_personal_shown_boards_v1";
/** @type {{connId:string, boardId:string}[]} */
let shownBoardsCache = null;
let _shownBoardsSyncing = false;

function shownBoardKey(connId, boardId) {
  return `${String(connId || "")}:${String(boardId || "")}`;
}

function shownBoardShadowId(connId, boardId) {
  const key = shownBoardKey(connId, boardId);
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return "psrc-" + (h >>> 0).toString(16);
}

function isSourceBoard(board) {
  return !!(board && board.sourceConnId && board.sourceBoardId);
}

function loadShownBoards() {
  if (shownBoardsCache) return shownBoardsCache;
  try {
    const raw = JSON.parse(localStorage.getItem(PERSONAL_SHOWN_BOARDS_KEY) || "[]");
    shownBoardsCache = Array.isArray(raw)
      ? raw.filter(p => p && p.connId && p.boardId).map(p => ({
        connId: String(p.connId),
        boardId: String(p.boardId),
        cachedName: String(p.cachedName || "").trim().slice(0, 32),
        cachedIcon: String(p.cachedIcon || "").trim() || null,
        missingSyncs: Math.max(0, Number(p.missingSyncs) || 0),
      }))
      : [];
  } catch {
    shownBoardsCache = [];
  }
  return shownBoardsCache;
}

/** Resolve a Personal sidebar reference without manufacturing Personal data. */
function resolveShownBoardProjection(ref) {
  if (!ref?.connId || !ref?.boardId) return null;
  const sourceConn = S.conns?.[ref.connId] || null;
  const cache = typeof loadCache === "function" ? loadCache(ref.connId) : null;
  const boards = (sourceConn?.boards?.length ? sourceConn.boards : cache?.boards) || [];
  const channels = (sourceConn?.channels?.length ? sourceConn.channels : cache?.channels) || [];
  const hasLiveShape = !!(sourceConn?.boards?.length && sourceConn?.channels?.length);
  const contentConn = hasLiveShape
    ? sourceConn
    : sourceConn
      ? {
        ...sourceConn,
        boards,
        channels,
        events: cache?.events || sourceConn.events || [],
        tasks: cache?.tasks || sourceConn.tasks || [],
        polls: cache?.polls || sourceConn.polls || [],
        messages: cache?.messages || sourceConn.messages || {},
        members: cache?.members || sourceConn.members || [],
      }
    : (cache ? { ...cache, id: ref.connId, status: "offline", boards, channels } : null);
  const sourceBoard = boards.find(b => b.id === ref.boardId) || null;
  const eventChannel = sourceBoard && typeof eventChannelForBoard === "function"
    ? eventChannelForBoard(sourceBoard, contentConn)
    : null;
  const chatChannel = sourceBoard && typeof chatChannelForBoard === "function"
    ? chatChannelForBoard(sourceBoard, contentConn)
    : null;
  // Cached projections remain readable, but mutations must wait for a fully
  // live source connection so Personal can never diverge from its origin.
  const offline = !sourceConn || !hasLiveShape || sourceConn.status !== "online";
  return {
    ref,
    sourceConn,
    contentConn,
    sourceBoard,
    eventChannel,
    chatChannel,
    offline,
    unavailable: !sourceBoard,
    displayName: sourceBoard?.name || ref.cachedName || "Unavailable board",
    displayIcon: sourceBoard?.icon || ref.cachedIcon || null,
  };
}

function activeProjectionContext() {
  const p = S.activeConnId === "personal" ? S.activeProjection : null;
  if (!p?.sourceConnId || !p?.sourceBoardId || !p?.sourceChannelId) return null;
  const resolved = resolveShownBoardProjection({ connId: p.sourceConnId, boardId: p.sourceBoardId });
  if (!resolved?.contentConn || !resolved.sourceBoard) return { ...resolved, projection: p };
  const channel = (resolved.contentConn.channels || []).find(c => c.id === p.sourceChannelId)
    || [resolved.eventChannel, resolved.chatChannel].find(c => c?.id === p.sourceChannelId)
    || null;
  return { ...resolved, projection: p, channel };
}

function clearActiveProjection() {
  S.activeProjection = null;
}

function saveShownBoards() {
  try {
    localStorage.setItem(PERSONAL_SHOWN_BOARDS_KEY, JSON.stringify(shownBoardsCache || []));
  } catch {}
}

function isBoardShownInPersonal(connId, boardId) {
  const key = shownBoardKey(connId, boardId);
  return loadShownBoards().some(p => shownBoardKey(p.connId, p.boardId) === key);
}

function boardAllowsShowInPersonal(board) {
  return !board || board.allowShowInPersonal !== false;
}

function findShownBoardShadow(personal, connId, boardId) {
  if (!personal) return null;
  const id = shownBoardShadowId(connId, boardId);
  return (personal.boards || []).find(b =>
    b.id === id || (b.sourceConnId === connId && b.sourceBoardId === boardId)
  ) || null;
}

function removeShownBoardShadow(connId, boardId) {
  const personal = S.conns?.personal;
  if (!personal) return false;
  const board = findShownBoardShadow(personal, connId, boardId);
  if (!board) return false;
  const ev = typeof eventChannelForBoard === "function" ? eventChannelForBoard(board, personal) : null;
  const chat = typeof chatChannelForBoard === "function" ? chatChannelForBoard(board, personal) : null;
  if (ev) setLinkedEventSources("personal", ev.id, []);
  if (chat) setLinkedChatMirrors(chat.id, []);
  const childIds = new Set((personal.channels || []).filter(c => c.boardId === board.id).map(c => c.id));
  personal.boards = (personal.boards || []).filter(b => b.id !== board.id);
  personal.channels = (personal.channels || []).filter(c => c.boardId !== board.id);
  if (ev) personal.events = (personal.events || []).filter(e => e.channelId !== ev.id);
  personal.tasks = (personal.tasks || []).filter(t => !childIds.has(t.channelId));
  if (chat && personal.messages) delete personal.messages[chat.id];
  const viewId = S.activeView?.kind === "channel" ? S.activeView.id : null;
  if (viewId && childIds.has(viewId) && S.activeConnId === "personal") {
    try { Nav.set({ kind: "events" }); } catch {}
  }
  if (typeof savePersonal === "function") savePersonal(personal);
  return true;
}

function setBoardShownInPersonal(connId, boardId, on) {
  const cid = String(connId || "");
  const bid = String(boardId || "");
  if (!cid || !bid) return false;
  const pins = loadShownBoards();
  const key = shownBoardKey(cid, bid);
  const idx = pins.findIndex(p => shownBoardKey(p.connId, p.boardId) === key);
  if (on) {
    const srcConn = S.conns?.[cid];
    const srcBoard = (srcConn?.boards || []).find(b => b.id === bid);
    if (!srcConn || !srcBoard) return false;
    if (srcBoard.allowShowInPersonal === false) return false;
    if (idx < 0) {
      pins.push({
        connId: cid,
        boardId: bid,
        cachedName: String(srcBoard.name || "Board").trim().slice(0, 32),
        cachedIcon: srcBoard.icon || null,
      });
      shownBoardsCache = pins;
      saveShownBoards();
    }
    removeShownBoardShadow(cid, bid);
    return true;
  }
  if (idx >= 0) {
    pins.splice(idx, 1);
    shownBoardsCache = pins;
    saveShownBoards();
  }
  removeShownBoardShadow(cid, bid);
  return true;
}

function syncShownBoardsToPersonal() {
  if (_shownBoardsSyncing) return;
  _shownBoardsSyncing = true;
  try {
    const personal = S.conns?.personal;
    if (!personal) return;
    const pins = loadShownBoards();
    const next = [];
    for (const p of pins) {
      const c = S.conns?.[p.connId];
      if (!c) {
        const remembered = (typeof loadServers === "function" ? loadServers() : [])
          .some(s => s.id === p.connId);
        if (remembered || (typeof PersonalVault !== "undefined" && PersonalVault.applying)) next.push(p);
        else removeShownBoardShadow(p.connId, p.boardId);
        continue;
      }
      if (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(c)) {
        removeShownBoardShadow(p.connId, p.boardId);
        continue;
      }
      const srcBoard = (c.boards || []).find(b => b.id === p.boardId);
      if (!srcBoard) {
        if (c.status === "connecting" || c.status === "waiting") next.push(p);
        else if (!(c.boards || []).length) next.push(p);
        else if ((Number(p.missingSyncs) || 0) < 1) next.push({ ...p, missingSyncs: 1 });
        removeShownBoardShadow(p.connId, p.boardId);
        continue;
      }
      if (srcBoard.allowShowInPersonal === false) {
        removeShownBoardShadow(p.connId, p.boardId);
        continue;
      }
      const srcEv = typeof eventChannelForBoard === "function" ? eventChannelForBoard(srcBoard, c) : null;
      if (srcEv && c.me && typeof channelVisibleTo === "function" && !channelVisibleTo(srcEv, c.me, c)) {
        removeShownBoardShadow(p.connId, p.boardId);
        continue;
      }
      next.push({
        ...p,
        cachedName: String(srcBoard.name || p.cachedName || "Board").trim().slice(0, 32),
        cachedIcon: srcBoard.icon || p.cachedIcon || null,
        missingSyncs: 0,
      });
      // One-way shadow records from older clients are derived data. Remove
      // them while retaining the canonical source reference above.
      removeShownBoardShadow(p.connId, p.boardId);
    }
    const keep = new Set(next.map(p => shownBoardKey(p.connId, p.boardId)));
    for (const b of (personal.boards || []).slice()) {
      if (!isSourceBoard(b)) continue;
      if (!keep.has(shownBoardKey(b.sourceConnId, b.sourceBoardId))) {
        removeShownBoardShadow(b.sourceConnId, b.sourceBoardId);
      }
    }
    if (next.length !== pins.length
      || next.some((p, i) => shownBoardKey(p.connId, p.boardId) !== shownBoardKey(pins[i]?.connId, pins[i]?.boardId)
        || p.cachedName !== pins[i]?.cachedName || p.cachedIcon !== pins[i]?.cachedIcon
        || p.missingSyncs !== pins[i]?.missingSyncs)) {
      shownBoardsCache = next;
      saveShownBoards();
    }
  } finally {
    _shownBoardsSyncing = false;
  }
}

/** Chat channels on joined non-personal servers (for personal chat mirror picker). */
function allLinkableRemoteChatChannels() {
  const rows = [];
  for (const c of Object.values(S.conns || {})) {
    if (!c || PersonalSpace.isPersonal(c)) continue;
    const serverName = connDisplayName(c);
    for (const ch of sourceChannelsFor(c)) {
      if (ch.kind === "event") continue;
      rows.push({
        connId: c.id,
        channelId: ch.id,
        serverName,
        channelName: ch.name || "Chat",
      });
    }
  }
  return rows;
}

function linkedChatMirrorsSummaryText(personalChatId) {
  const links = directLinkedChatMirrorsFor(personalChatId);
  if (!links.length) return "None — only this chat’s messages";
  const labels = links.map(l => {
    const c = S.conns[l.connId];
    const ch = sourceChannelsFor(c).find(x => x.id === l.channelId);
    const server = connDisplayName(c);
    const name = ch?.name || "Chat";
    return `${server} · #${name}`;
  });
  return labels.length <= 2 ? labels.join(", ") : `${labels.slice(0, 2).join(", ")} +${labels.length - 2} more`;
}

/** Mirrored remote chats selectable as composer reply targets. */
function mirroredChatTagTargets(personalChatId) {
  const out = [];
  for (const link of directLinkedChatMirrorsFor(personalChatId)) {
    const c = S.conns?.[link.connId];
    if (!c || (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(c))) continue;
    const ch = sourceChannelsFor(c).find(x => x.id === link.channelId);
    if (!ch || ch.kind === "event") continue;
    out.push({
      connId: link.connId,
      channelId: link.channelId,
      serverName: connDisplayName(c),
      chatName: ch.name || "Chat",
      key: linkedFeedKey(link.connId, link.channelId),
    });
  }
  return out;
}

/** Events on event-groups that import into a mirrored remote chat. */
function eventsForMirroredRemoteChat(connId, remoteChatId) {
  const c = S.conns?.[connId];
  if (!c || (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(c))) return [];
  const chatId = String(remoteChatId || "").trim();
  if (!chatId) return [];
  const serverName = connDisplayName(c);
  const eventChanIds = new Set(
    sourceChannelsFor(c)
      .filter(ch => ch.kind === "event" && ch.linkedChatChannelId === chatId)
      .map(ch => ch.id)
  );
  if (!eventChanIds.size) return [];
  const live = (c.events || []).filter(e => eventChanIds.has(e.channelId));
  const cached = (!live.length && typeof loadCache === "function")
    ? (loadCache(c.id)?.events || []).filter(e => eventChanIds.has(e.channelId))
    : [];
  const list = live.length ? live : cached;
  const out = [];
  for (const ev of list) {
    if (typeof isMainViewEvent === "function" && !isMainViewEvent(ev)) continue;
    out.push({
      ...ev,
      _connId: connId,
      _serverName: serverName,
      _mirrorChannelId: chatId,
      _myId: c.me?.id,
    });
  }
  return out;
}

/** #suggest rows: mirrored chats first, then their linked events. */
function taggableMirrorTargetsForPersonalChat(personalChatId) {
  const chats = [];
  const events = [];
  for (const t of mirroredChatTagTargets(personalChatId)) {
    chats.push({
      id: `mirrorChat:${t.key}`,
      _mirrorChat: true,
      _mirrorChatKey: t.key,
      _connId: t.connId,
      _mirrorChannelId: t.channelId,
      _serverName: t.serverName,
      _title: `#${t.chatName}`,
      when: 0,
      channelId: t.channelId,
    });
    for (const ev of eventsForMirroredRemoteChat(t.connId, t.channelId)) {
      events.push(ev);
    }
  }
  return { chats, events };
}

function findMirrorEventById(personalChatId, eventId) {
  if (!eventId) return null;
  for (const t of mirroredChatTagTargets(personalChatId)) {
    for (const ev of eventsForMirroredRemoteChat(t.connId, t.channelId)) {
      if (ev.id === eventId) return ev;
    }
  }
  return null;
}

function personalChatRequiresMirrorAttach(ch) {
  const conn = typeof activeConn === "function" ? activeConn() : S.conns?.[S.activeConnId];
  if (!conn || typeof PersonalSpace === "undefined" || !PersonalSpace.isPersonal(conn)) return false;
  if (!ch || ch.kind !== "chat") return false;
  const mirrors = directLinkedChatMirrorsFor(ch.id);
  if (mirrors.length === 1) return false;
  return mirrors.length > 0;
}

/** One mirror: compose stays normal; send auto-routes to that hosted chat. */
function personalChatAutoRoutesMirror(ch) {
  const conn = typeof activeConn === "function" ? activeConn() : S.conns?.[S.activeConnId];
  if (!conn || typeof PersonalSpace === "undefined" || !PersonalSpace.isPersonal(conn)) return false;
  if (!ch || ch.kind !== "chat") return false;
  return directLinkedChatMirrorsFor(ch.id).length === 1;
}

function composerHasMirrorAttach(personalChatId) {
  if (S.taggedMirrorChatKey) return true;
  const chatId = personalChatId
    || (S.activeView?.kind === "channel" ? S.activeView.id : null);
  if (!chatId) return false;
  const ids = [];
  if (Array.isArray(S.mentionedEventIds)) {
    for (const id of S.mentionedEventIds) if (id) ids.push(id);
  }
  if (S.taggedEventId) ids.push(S.taggedEventId);
  if (S.chatFilterEventId) ids.push(S.chatFilterEventId);
  for (const id of ids) {
    if (findMirrorEventById(chatId, id)) return true;
  }
  return false;
}

/**
 * Route a Personal composer send to a mirrored remote chat, or null when no mirrors.
 * @returns {{ connId, channelId, key, eventIds, serverName, chatName } | { error: string } | null}
 */
function resolvePersonalChatSendRoute(personalChat, { mirrorChatKey, eventIds } = {}) {
  if (!personalChat?.id) return { error: "No channel" };
  const targets = mirroredChatTagTargets(personalChat.id);
  if (!targets.length) return null;

  let routeKey = mirrorChatKey || null;
  const resolvedEventIds = [];
  const seenEv = new Set();
  for (const eid of (eventIds || [])) {
    if (!eid || seenEv.has(eid)) continue;
    const ev = findMirrorEventById(personalChat.id, eid);
    if (!ev) continue;
    const key = linkedFeedKey(ev._connId, ev._mirrorChannelId);
    if (routeKey && routeKey !== key) {
      return { error: "Tag events from one mirrored chat only" };
    }
    routeKey = key;
    seenEv.add(eid);
    resolvedEventIds.push(eid);
  }

  if (!routeKey && targets.length === 1) routeKey = targets[0].key;
  if (!routeKey) return { error: "Pick a mirrored chat or #tag an event" };
  const target = targets.find(t => t.key === routeKey);
  if (!target) return { error: "Mirrored chat not found" };

  const owner = S.conns?.[target.connId];
  if (!owner) return { error: "Server offline" };
  if (owner.status === "offline" || owner.status === "denied" || owner.status === "waiting") {
    return { error: "Server offline" };
  }
  if (typeof canMutateContent === "function" && !canMutateContent(owner)) {
    return { error: "View-only on that server" };
  }
  if (!owner.key && !owner.local) return { error: "Server not ready" };

  return {
    connId: target.connId,
    channelId: target.channelId,
    key: owner.key,
    eventIds: resolvedEventIds,
    serverName: target.serverName,
    chatName: target.chatName,
  };
}

/** Personal Events board feed id — opt-in calendars, not auto-all-servers. */
const PERSONAL_META_EVENTS_ID = "__events__";

function isPersonalMetaEventsLinkTarget(connId, channelId) {
  return connId === "personal" && channelId === PERSONAL_META_EVENTS_ID;
}

/** Events for personal Events meta: linked calendars + their nested links. */
function collectPersonalMetaEvents() {
  const personal = S.conns.personal;
  if (!personal?.me?.id) return [];
  const links = expandedLinkedEventSourcesFor("personal", PERSONAL_META_EVENTS_ID);
  if (!links.length) return [];
  const seen = new Set();
  const out = [];
  for (const l of links) {
    const c = S.conns[l.connId];
    if (!c) continue;
    const meId = sourceMeFor(c)?.id || (PersonalSpace.isPersonal(c) ? c.me?.id : null);
    if (!meId) continue;
    const offline = !PersonalSpace.isPersonal(c)
      && c.status !== "online" && c.status !== "connecting" && c.status !== "waiting";
    const serverName = connDisplayName(c);
    const chMeta = sourceChannelsFor(c).find(ch => ch.id === l.channelId);
    const linkedChannelName = chMeta?.name || "Events";
    for (const ev of sourceEventsFor(c)) {
      if (ev.channelId !== l.channelId) continue;
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      if (PersonalSpace.isPersonal(c)) {
        out.push({ ...ev, _connId: "personal", _myId: meId, originKind: ev.calendarImported ? "device" : (ev.originKind || "personal") });
      } else {
        out.push({
          ...ev,
          _connId: c.id,
          _myId: meId,
          _serverName: serverName,
          _offline: offline,
          _linked: true,
          _linkedChannelName: linkedChannelName,
          originKind: "server",
        });
      }
    }
  }
  return out;
}
/**
 * Whether two half-open intervals [aStart, aStart+aDur) and [bStart, bStart+bDur) overlap.
 */
function intervalsOverlapMs(aStart, aDur, bStart, bDur) {
  const as = Number(aStart) || 0;
  const ad = Number(aDur) || 0;
  const bs = Number(bStart) || 0;
  const bd = Number(bDur) || 0;
  if (ad <= 0 || bd <= 0) return false;
  return as < bs + bd && bs < as + ad;
}

/** Event duration code → ms (defaults to 1h). */
function eventDurationMs(ev) {
  if (typeof durationToMs === "function") {
    const ms = durationToMs(ev?.duration);
    if (ms > 0) return ms;
  }
  return 3_600_000;
}

function availabilityOverlapsEvent(avail, ev) {
  if (!avail || !ev || !ev.when) return false;
  return intervalsOverlapMs(avail.when, avail.duration, ev.when, eventDurationMs(ev));
}

/** Remove availabilities in channel that an event now fills; returns deleted ids. */
function clearOverlappingAvailabilities(conn, ev) {
  if (!conn || !ev?.channelId || !ev.when) return [];
  const list = conn.availabilities || [];
  const doomed = list.filter(a => a.channelId === ev.channelId && availabilityOverlapsEvent(a, ev));
  if (!doomed.length) return [];
  const ids = new Set(doomed.map(a => a.id));
  conn.availabilities = list.filter(a => !ids.has(a.id));
  return [...ids];
}

/** Availabilities for the current agenda scope (channel or all on meta). */
function availabilitiesForAgenda(conn, channel) {
  const list = conn?.availabilities || [];
  if (!list.length) return [];
  let scoped;
  if (channel?.id) {
    scoped = list.filter(a => a.channelId === channel.id);
  } else {
    const ids = new Set((conn.channels || []).filter(c => c.kind === "event").map(c => c.id));
    scoped = list.filter(a => ids.has(a.channelId));
  }
  // Hide marks already filled by a normal event (client-side safety net).
  const events = conn.events || [];
  return scoped.filter(a => !events.some(ev =>
    ev.channelId === a.channelId && availabilityOverlapsEvent(a, ev)));
}

/** Upcoming availability marks on an event channel (not already filled by an event). */
function availabilityAsChatEvent(avail, conn = activeConn()) {
  if (!avail?.id) return null;
  const faceIds = [avail.userId, ...((avail.signals || []).map(s => s.userId))].filter(Boolean);
  const n = Math.max(1, new Set(faceIds).size);
  const who = n === 1
    ? `${String(avail.userName || (typeof nameOf === "function" ? nameOf(avail.userId) : "") || "Someone").trim() || "Someone"} available`
    : `${n} available`;
  const duration = Number(avail.duration) || 0;
  return {
    id: avail.id,
    channelId: avail.channelId,
    when: Number(avail.when) || 0,
    duration,
    durationMs: duration,
    _title: who,
    title: who,
    icon: "handsUp",
    _availability: true,
    availabilityId: avail.id,
    createdBy: avail.userId,
    userId: avail.userId,
    _where: avail._where,
    where: avail.where,
  };
}

function availabilityChatEventsForChannel(ch, conn = activeConn()) {
  if (!conn) return [];
  const toEv = (a) => availabilityAsChatEvent(a, conn);
  const fromChannel = (c) => {
    const list = typeof upcomingChannelAvailabilities === "function"
      ? upcomingChannelAvailabilities(conn, c)
      : [];
    return list.map(toEv).filter(Boolean);
  };
  if (ch?.id && ch.kind === "event") return fromChannel(ch);
  const meta = !ch
    || (typeof isAllEventsMetaBoard === "function" && isAllEventsMetaBoard());
  if (!meta) return [];
  const out = [];
  const seen = new Set();
  for (const c of (conn.channels || []).filter(x => x.kind === "event")) {
    for (const ev of fromChannel(c)) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      out.push(ev);
    }
  }
  return out;
}

function mergeAvailabilityChatEvents(events, ch, conn = activeConn()) {
  const extra = availabilityChatEventsForChannel(ch, conn);
  if (!extra.length) return events || [];
  const seen = new Set((events || []).map(e => e.id));
  return (events || []).concat(extra.filter(e => !seen.has(e.id)));
}

/** Upcoming availability marks on an event channel (not already filled by an event). */
function upcomingChannelAvailabilities(conn, ch) {
  if (!ch?.id || ch.kind !== "event") return [];
  if (ch.pinnedLocationLabel != null || ch.pinnedUserId != null) return [];
  const list = typeof availabilitiesForAgenda === "function"
    ? availabilitiesForAgenda(conn, ch)
    : (conn?.availabilities || []).filter(a => a.channelId === ch.id);
  return list.filter(a => typeof isEventPastDay !== "function" || !isEventPastDay(a));
}

/** True when someone else marked available and this user hasn’t signalled yet. */
function isUnansweredAvailability(avail, conn = activeConn()) {
  if (!avail) return false;
  const meId = conn?.me?.id;
  if (!meId || avail.userId === meId) return false;
  if (typeof isEventPastDay === "function" && isEventPastDay(avail)) return false;
  return !(avail.signals || []).some(s => s.userId === meId);
}


/**
 * Whether an event belongs on a pinned-location aggregation board.
 * Prefer plaintext `locationLabelId` (may be several labels joined with " · ");
 * also match decrypted `_where` / personal plaintext `where` so existing
 * bookings surface without a re-create.
 */
function eventMatchesPinnedLocation(ev, pinLabel, conn = null) {
  if (!ev || pinLabel == null) return false;
  const pin = String(pinLabel).trim();
  if (!pin) return false;
  const hasPlace = typeof eventWhereHasPlace === "function"
    ? (src) => eventWhereHasPlace(src, pin)
    : (src) => String(src || "").trim().toLowerCase() === pin.toLowerCase();
  if (ev.locationLabelId && hasPlace(ev.locationLabelId)) return true;
  const where = String(ev._where || "").trim()
    || (conn && typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn)
      ? String(ev.where || "").trim()
      : "");
  if (!where) return false;
  return hasPlace(where);
}

/**
 * Whether an event belongs on a pinned-people aggregation board.
 * Stubs arrive with channelId = the pinned board; full events keep their home
 * channelId when the viewer can already see that home (match via pinnee visibility).
 */
function eventMatchesPinnedPerson(ev, pinnedChannel, conn = null) {
  if (!ev || !pinnedChannel?.pinnedUserId || !conn) return false;
  if (ev.channelId === pinnedChannel.id) return true;
  if (ev.limited) return false;
  const home = (conn.channels || []).find(c => c.id === ev.channelId);
  if (!home || home.kind !== "event") return false;
  if (home.pinnedLocationLabel != null || home.pinnedUserId != null) return false;
  const pinnee = (conn.members || []).find(m => m.id === pinnedChannel.pinnedUserId);
  if (!pinnee) return false;
  return typeof channelVisibleTo === "function" && channelVisibleTo(home, pinnee, conn);
}

/** Bookings at [label] on boards shown in Personal. */
function collectShownBoardPlaceEvents(label) {
  const pin = String(label || "").trim();
  if (!pin || typeof loadShownBoards !== "function") return [];
  const out = [];
  const seen = new Set();
  for (const ref of loadShownBoards()) {
    const projected = typeof resolveShownBoardProjection === "function"
      ? resolveShownBoardProjection(ref) : null;
    const src = projected?.contentConn;
    const board = projected?.sourceBoard;
    if (!src || !board) continue;
    const evCh = typeof eventChannelForBoard === "function" ? eventChannelForBoard(board, src) : null;
    if (!evCh) continue;
    for (const ev of src.events || []) {
      if (!ev || ev.channelId !== evCh.id || seen.has(ev.id)) continue;
      if (!eventMatchesPinnedLocation(ev, pin, src)) continue;
      seen.add(ev.id);
      out.push({
        ...ev,
        _connId: src.id,
        _linked: true,
        _serverName: typeof connDisplayName === "function" ? connDisplayName(src) : (src.name || ""),
        _linkedChannelName: board.name || "Board",
        _sourceBoardId: board.id,
        sourceChannelName: board.name || "",
        originKind: "server",
      });
    }
  }
  return out;
}

/**
 * Events for an event-channel timeline: this channel plus linked feeds
 * (including nested pass-through). Pass [homeConn] when not the active conn.
 */
function collectChannelViewEvents(channel, homeConn = activeConn()) {
  const conn = homeConn;
  if (!channel || !conn) return conn?.events || [];
  if (typeof PersonalSpace !== "undefined" && PersonalSpace.isAcceptedChannel(channel, conn)) {
    return typeof collectAcceptedEvents === "function" ? collectAcceptedEvents() : [];
  }
  // § pinned location channels — a read-only aggregation of every booking of
  // that place, not an independent per-channelId store: events the viewer can
  // already see keep their real channelId (server sends them once), while
  // events outside their visibility arrive as a redacted stub already tagged
  // with this channel's id. Merge both by locationLabelId instead of the
  // usual single-channelId filter.
  if (channel.pinnedLocationLabel != null) {
    const local = (conn.events || []).filter(ev =>
      ev.channelId === channel.id
      || eventMatchesPinnedLocation(ev, channel.pinnedLocationLabel, conn));
    if (!(typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn))) return local;
    const extra = collectShownBoardPlaceEvents(channel.pinnedLocationLabel);
    const seen = new Set(local.map(ev => ev && ev.id));
    return local.concat(extra.filter(ev => ev && !seen.has(ev.id)));
  }
  // § pinned people channels — same pattern keyed by the pinnee's channelVisible.
  if (channel.pinnedUserId != null) {
    return (conn.events || []).filter(ev =>
      eventMatchesPinnedPerson(ev, channel, conn));
  }
  const sources = [
    { connId: conn.id, channelId: channel.id },
    ...expandedLinkedEventSourcesFor(conn.id, channel.id),
  ];
  const seen = new Set();
  const out = [];
  for (const src of sources) {
    const c = S.conns[src.connId];
    if (!c) continue;
    const meId = sourceMeFor(c)?.id || (PersonalSpace.isPersonal(c) ? c.me?.id : null);
    if (!meId) continue;
    const offline = !PersonalSpace.isPersonal(c)
      && c.status !== "online" && c.status !== "connecting" && c.status !== "waiting";
    const serverName = connDisplayName(c);
    const chMeta = sourceChannelsFor(c).find(ch => ch.id === src.channelId);
    const linkedChannelName = chMeta?.name || "Events";
    const isHome = src.connId === conn.id && src.channelId === channel.id;
    for (const ev of sourceEventsFor(c)) {
      if (ev.channelId !== src.channelId) continue;
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      if (isHome && c.id === conn.id && !PersonalSpace.isPersonal(conn)) {
        out.push(ev);
        continue;
      }
      if (isHome && PersonalSpace.isPersonal(conn)) {
        out.push({ ...ev, _connId: "personal", _myId: meId, originKind: ev.calendarImported ? "device" : (ev.originKind || "personal") });
        continue;
      }
      // Linked (or personal home stamped for routing consistency).
      out.push({
        ...ev,
        _connId: c.id,
        _myId: meId,
        _serverName: serverName,
        _offline: offline,
        _linked: !isHome,
        _linkedChannelName: linkedChannelName,
        originKind: isHome ? (ev.calendarImported ? "device" : "personal") : "server",
      });
    }
  }
  return out;
}

/** RSVP going, organiser, or a My plans event — the Accepted calendar set. */
function eventIsAcceptedByMe(ev, conn) {
  if (!ev || !conn) return false;
  const meId = (typeof sourceMeFor === "function" ? sourceMeFor(conn)?.id : null)
    || conn.me?.id || ev._myId;
  const pch = (typeof PersonalSpace !== "undefined" && PersonalSpace.MY_PLANS_ID) || "pch";
  if (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn) && ev.channelId === pch) {
    return true;
  }
  if (meId && ev.createdBy === meId) return true;
  return !!(meId && ev.rsvps && ev.rsvps[meId] === "going");
}

/** Cross-server accepted events for the hidden Personal Accepted channel. */
function collectAcceptedEvents() {
  const seen = new Set();
  const out = [];
  for (const c of Object.values(S.conns || {})) {
    if (!c) continue;
    const meId = (typeof sourceMeFor === "function" ? sourceMeFor(c)?.id : null)
      || (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(c) ? c.me?.id : null);
    if (!meId) continue;
    const events = typeof sourceEventsFor === "function" ? sourceEventsFor(c) : (c.events || []);
    const channels = typeof sourceChannelsFor === "function" ? sourceChannelsFor(c) : (c.channels || []);
    const personal = typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(c);
    const offline = !personal
      && c.status !== "online" && c.status !== "connecting" && c.status !== "waiting";
    const serverName = typeof connDisplayName === "function" ? connDisplayName(c) : (c.name || "Server");
    for (const ev of events) {
      if (!ev?.id || seen.has(ev.id)) continue;
      if (typeof PersonalSpace !== "undefined" && PersonalSpace.isAcceptedChannel(ev.channelId, c)) continue;
      if (!eventIsAcceptedByMe(ev, c)) continue;
      seen.add(ev.id);
      const chMeta = channels.find(ch => ch.id === ev.channelId);
      if (personal) {
        out.push({ ...ev, _connId: "personal", _myId: meId, originKind: ev.calendarImported ? "device" : (ev.originKind || "personal") });
      } else {
        out.push({
          ...ev,
          _connId: c.id,
          _myId: meId,
          _serverName: serverName,
          _offline: offline,
          _linked: true,
          _linkedChannelName: chMeta?.name || "Events",
          originKind: "server",
        });
      }
    }
  }
  return out;
}

/** Conn ids linked onto any personal event channel (for archives / Live filters). */
function personalLinkedConnIds() {
  const personal = S.conns.personal;
  if (!personal) return new Set();
  const ids = new Set();
  for (const ch of (personal.channels || []).filter(c => c.kind === "event")) {
    if (typeof PersonalSpace !== "undefined" && PersonalSpace.isHiddenChannel(ch, personal)) continue;
    for (const l of expandedLinkedEventSourcesFor(personal.id, ch.id)) {
      if (l.connId) ids.add(l.connId);
    }
  }
  for (const l of expandedLinkedEventSourcesFor("personal", PERSONAL_META_EVENTS_ID)) {
    if (l.connId) ids.add(l.connId);
  }
  return ids;
}
function linkedFeedsAffectConn(conn) {
  if (!conn) return false;
  // Personal Events meta board: any linked calendar (incl. nested).
  if (S.activeConnId === "personal" && S.activeView?.kind === "events") {
    return expandedLinkedEventSourcesFor("personal", PERSONAL_META_EVENTS_ID)
      .some(l => l.connId === conn.id);
  }
  if (S.activeView?.kind !== "channel") return false;
  const chId = S.activeView.id;
  if (!chId) return false;
  return expandedLinkedEventSourcesFor(S.activeConnId, chId).some(l => l.connId === conn.id);
}
