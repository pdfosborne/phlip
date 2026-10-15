/* net-part1.js — split from net.js (Part 3 size ceiling).
 * Load after: (prior deps); part of net cluster.
 */

/* ------------------------------ connection ------------------------------- */

/** `device` | `direct` | `local`, else empty. */
function normalizeReachMode(mode) {
  const m = String(mode || "").trim().toLowerCase();
  if (m === "device" || m === "direct" || m === "local") return m;
  return "";
}

function persistReachMode(mode) {
  const m = normalizeReachMode(mode);
  return m === "device" || m === "direct" ? m : "local";
}

function normJoinTag(tag) {
  return String(tag || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
}

/** Stable rail id: prefer registry joinTag over URL hash. */
async function serverConnIdFrom(joinTag, url) {
  const tag = normJoinTag(joinTag);
  if (tag) return `srv-tag-${tag.toLowerCase()}`;
  try {
    const dig = await digestSha256(String(url || ""));
    const hex = [...dig].slice(0, 6).map(b => b.toString(16).padStart(2, "0")).join("");
    return `srv-${hex}`;
  } catch { /* fall through */ }
  const fnv = (str, seed) => {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  };
  const s = String(url || "");
  const a = fnv(s, 2166136261);
  const b = fnv(s, 0x811c9dc5 ^ s.length);
  return `srv-${(a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0")).slice(0, 12)}`;
}

function normalizeDualHttpOrigin(raw) {
  const s = String(raw || "").trim().replace(/\/+$/, "");
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) {
    try { return new URL(s).origin; } catch { return ""; }
  }
  if (/^wss?:\/\//i.test(s)) {
    try { return new URL(s.replace(/^ws/i, "http")).origin; } catch { return ""; }
  }
  return `http://${s}`.replace(/\/+$/, "");
}

function wsUrlFromHttpOrigin(origin) {
  const o = normalizeDualHttpOrigin(origin);
  if (!o) return "";
  try {
    const u = new URL(o);
    const host = u.host;
    if (!host) return "";
    const proto = u.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${host}/ws`;
  } catch { return ""; }
}

function wssUrlFromPublicOrigin(origin) {
  const o = normalizeDualHttpOrigin(origin);
  if (!o) return "";
  try {
    const u = new URL(o.replace(/^http:/i, "https:"));
    return `wss://${u.host}/ws`;
  } catch { return ""; }
}

/** Keep urlLan / urlPublic / shareLan / sharePublic aligned on a conn. */
function syncConnDualUrls(conn, hints = {}) {
  if (!conn || PersonalSpace.isPersonal(conn)) return;
  const shareLan = hints.shareLan ?? conn.shareLan ?? "";
  const sharePublic = hints.sharePublic ?? conn.sharePublic ?? "";
  if (shareLan) conn.shareLan = String(shareLan).trim();
  if (sharePublic) conn.sharePublic = String(sharePublic).trim();
  if (hints.joinTag) conn.joinTag = normJoinTag(hints.joinTag);
  const lanHttp = normalizeDualHttpOrigin(conn.shareLan || conn.urlLan || "");
  const pubHttp = normalizeDualHttpOrigin(conn.sharePublic || conn.urlPublic || "");
  if (lanHttp) {
    conn.shareLan = lanHttp;
    conn.urlLan = wsUrlFromHttpOrigin(lanHttp);
  }
  if (pubHttp) {
    conn.sharePublic = pubHttp.startsWith("https:") ? pubHttp : pubHttp.replace(/^http:/i, "https:");
    conn.urlPublic = wssUrlFromPublicOrigin(pubHttp);
  }
  if (!conn.urlLan && /^ws:/i.test(conn.url || "")) {
    const fromActive = typeof lanHttpOriginFromConnUrl === "function" ? lanHttpOriginFromConnUrl(conn.url) : "";
    if (fromActive) {
      conn.urlLan = conn.url;
      if (!conn.shareLan) conn.shareLan = fromActive;
    }
  }
  if (!conn.urlPublic && /^wss:/i.test(conn.url || "")) {
    conn.urlPublic = conn.url;
    try {
      const pub = new URL(conn.url.replace(/^ws/i, "http")).origin.replace(/^http:/i, "https:");
      if (!conn.sharePublic) conn.sharePublic = pub;
    } catch {}
  }
  if (hints.joinBase) {
    const base = String(hints.joinBase || "");
    if (/^https:/i.test(base)) {
      const pub = normalizeDualHttpOrigin(base);
      if (pub) {
        conn.sharePublic = pub;
        conn.urlPublic = wssUrlFromPublicOrigin(pub);
      }
    } else if (/^http:/i.test(base)) {
      const lan = normalizeDualHttpOrigin(base);
      if (lan) {
        conn.shareLan = lan;
        conn.urlLan = wsUrlFromHttpOrigin(lan);
      }
    }
  }
}

function dualUrlPersistFields(conn) {
  syncConnDualUrls(conn);
  return {
    urlPublic: conn.urlPublic || "",
    urlLan: conn.urlLan || "",
    joinTag: conn.joinTag || "",
  };
}

function makeConn({ id, url, name, token, pass, iconText, serverPic, joinTag, e2eSalt, userName, urlPublic, urlLan, activePath, hotspotSsid, hotspotPassword, hotspotPreferred, reachMode }) {
  return {
    id, url, name, token: token || null, pass: pass || null, key: null,
    ws: null, me: null, hostName: name || "", boards: [], channels: [], events: [], routines: [], categories: [],
    cardCats: {}, removedCards: [], locations: [],
    cardDurations: {},
    messages: {}, members: [], online: [], pendingReqs: [], invite: null, notifications: [],
    reports: [], blocked: [],
    serverSettings: { allowUserCreateEvents: true, createEvents: "everyone", createEventTypes: "moderator", addLocations: "moderator", inviteToGroup: "admin", liveProfilePhotos: "off", allowProfilePics: false, allowUserDraw: true, cardTheme: "classic", forceJoinCode: false, purgeEndedEvents: false, chatRetentionDays: 0, allowMultiLocations: false, allowPinnedPeople: false },
    iconText: iconText || "",
    serverPic: serverPic || "",
    joinTag: joinTag || "",
    urlPublic: urlPublic || "",
    urlLan: urlLan || "",
    shareLan: "",
    sharePublic: "",
    activePath: activePath || "",
    e2eSalt: e2eSalt || "",
    hotspotSsid: hotspotSsid || "",
    hotspotPassword: hotspotPassword || "",
    hotspotPreferred: !!hotspotPreferred,
    reachMode: normalizeReachMode(reachMode),
    _lastName: userName || "",
    // While joining (before welcome), keep invite+name so a dropped socket can
    // re-send join instead of reconnecting anonymously and never getting a token.
    joinIntent: null,
    status: "connecting", local: false, retryDelay: 2000,
    outbox: loadOutbox(id),
  };
}

/** Persist membership so the Android client stays joined across app restarts.
 *  Browser (served origin): remember username only — never token/pass, so the
 *  public link alone cannot restore membership. */
function persistConnSession(conn, extra = {}) {
  if (!conn?.id || PersonalSpace.isPersonal(conn) || conn.demo) return;
  if (typeof isDemoMode === "function" && isDemoMode()) return;
  if (typeof isServedOrigin === "function" && isServedOrigin()) {
    const name = extra.userName || conn.me?.name || conn._lastName || "";
    if (name) saveBrowserMemberName(name);
    // After welcome only — next visit may skip Agree (returning member).
    // Defer while member password setup is still required (needsPassword).
    if (!extra.deferRulesAccepted) {
      try { saveBrowserRulesAccepted(true); } catch {}
    }
    return;
  }
  syncConnDualUrls(conn, extra);
  upsertServerEntry({
    id: conn.id,
    url: conn.url,
    name: conn.name || conn.hostName || "",
    pass: conn.pass || null,
    token: conn.token || null,
    iconText: conn.iconText || "",
    serverPic: conn.serverPic || "",
    userName: conn.me?.name || conn._lastName || "",
    joinTag: conn.joinTag || "",
    e2eSalt: conn.e2eSalt || "",
    inviteSlug: conn.inviteSlug || conn._joinInviteSlug || conn.me?.inviteSlug || "",
    inviteUrl: conn.inviteUrl || conn.me?.inviteUrl || "",
    hotspotSsid: conn.hotspotSsid || "",
    hotspotPassword: conn.hotspotPassword || "",
    hotspotPreferred: !!conn.hotspotPreferred,
    reachMode: persistReachMode(conn.reachMode),
    ...dualUrlPersistFields(conn),
    ...extra,
  });
}

/** Move a conn to a tag-based id (merge duplicates on the rail). */
function remigrateConnId(conn, newId) {
  if (!conn || !newId || conn.id === newId) return conn?.id || newId;
  const oldId = conn.id;
  if (S.conns[oldId] === conn) delete S.conns[oldId];
  if (S.conns[newId] && S.conns[newId] !== conn) {
    const other = S.conns[newId];
    if (!conn.token && other.token) conn.token = other.token;
    if (!conn.pass && other.pass) conn.pass = other.pass;
    if (!conn.joinTag && other.joinTag) conn.joinTag = other.joinTag;
    if (!conn.urlPublic && other.urlPublic) conn.urlPublic = other.urlPublic;
    if (!conn.urlLan && other.urlLan) conn.urlLan = other.urlLan;
    if (!conn.shareLan && other.shareLan) conn.shareLan = other.shareLan;
    if (!conn.sharePublic && other.sharePublic) conn.sharePublic = other.sharePublic;
    if (!conn.hotspotSsid && other.hotspotSsid) conn.hotspotSsid = other.hotspotSsid;
    if (!conn.hotspotPassword && other.hotspotPassword) conn.hotspotPassword = other.hotspotPassword;
    if (!conn.hotspotPreferred && other.hotspotPreferred) conn.hotspotPreferred = true;
    try { other.ws?.close(); } catch {}
    stopHttpTransport(other);
    delete S.conns[newId];
  }
  conn.id = newId;
  S.conns[newId] = conn;
  const order = loadRailOrder().map(id => (id === oldId ? newId : id));
  saveRailOrder([...new Set(order)]);
  try {
    const cached = localStorage.getItem(`ash_cache_${oldId}`);
    if (cached && !localStorage.getItem(`ash_cache_${newId}`)) {
      localStorage.setItem(`ash_cache_${newId}`, cached);
    }
    localStorage.removeItem(`ash_cache_${oldId}`);
    const outKey = `ash_outbox_${oldId}`;
    const outRaw = localStorage.getItem(outKey);
    if (outRaw && !localStorage.getItem(`ash_outbox_${newId}`)) {
      localStorage.setItem(`ash_outbox_${newId}`, outRaw);
    }
    localStorage.removeItem(outKey);
  } catch {}
  if (S.activeConnId === oldId) S.activeConnId = newId;
  removeServerEntry(oldId);
  persistConnSession(conn);
  return newId;
}

/** Merge ash_servers_v1 rows that share a joinTag; rewrite ids to srv-tag-*. */
function migrateServerEntries(list) {
  const rows = Array.isArray(list) ? list.map(e => ({ ...e })) : [];
  const byTag = new Map();
  const out = [];
  for (const entry of rows) {
    const tag = normJoinTag(entry.joinTag);
    if (!tag) { out.push(entry); continue; }
    const key = tag.toLowerCase();
    const canonId = `srv-tag-${key}`;
    const prev = byTag.get(key);
    if (!prev) {
      const merged = { ...entry, id: canonId, joinTag: tag };
      byTag.set(key, merged);
      out.push(merged);
      continue;
    }
    prev.token = prev.token || entry.token || null;
    prev.pass = prev.pass || entry.pass || null;
    prev.urlPublic = prev.urlPublic || entry.urlPublic || "";
    prev.urlLan = prev.urlLan || entry.urlLan || "";
    prev.url = prev.url || entry.url || "";
    prev.name = prev.name || entry.name || "";
    prev.userName = prev.userName || entry.userName || "";
    prev.iconText = prev.iconText || entry.iconText || "";
    prev.serverPic = prev.serverPic || entry.serverPic || "";
    prev.e2eSalt = prev.e2eSalt || entry.e2eSalt || "";
  }
  return out;
}

/** Last successful browser sign-in name for this host origin (localStorage is origin-scoped). */
function loadBrowserMemberName() {
  try { return String(localStorage.getItem("ash_browser_user") || "").trim(); } catch { return ""; }
}
function saveBrowserMemberName(name) {
  try {
    const n = String(name || "").trim();
    if (n) localStorage.setItem("ash_browser_user", n);
    else localStorage.removeItem("ash_browser_user");
  } catch {}
}

/** Local/Public browser: after a successful welcome, skip Agree on return.
 *  Key v2 — v1 was wrongly set when the agree page merely loaded. */
function loadBrowserRulesAccepted() {
  try { return localStorage.getItem("ash_rules_ok_v2") === "1"; } catch { return false; }
}
function saveBrowserRulesAccepted(ok = true) {
  try {
    if (ok) localStorage.setItem("ash_rules_ok_v2", "1");
    else localStorage.removeItem("ash_rules_ok_v2");
    // Drop the buggy v1 flag so first sign-ups aren't stuck on Sign in.
    localStorage.removeItem("ash_rules_ok_v1");
  } catch {}
}

/** Per-origin cache of a member's public pwdSalt (also sent on welcome). */
function pwdSaltStorageKey(originOrUrl, name) {
  let origin = "";
  try { origin = new URL(originOrUrl || location.href).origin; } catch {
    try { origin = location.origin; } catch { origin = String(originOrUrl || ""); }
  }
  return `ash_pwd_salt_v1:${origin}:${String(name || "").trim().toLowerCase()}`;
}
function loadCachedPwdSalt(originOrUrl, name) {
  try { return localStorage.getItem(pwdSaltStorageKey(originOrUrl, name)) || ""; } catch { return ""; }
}
function saveCachedPwdSalt(originOrUrl, name, salt) {
  try {
    const s = String(salt || "").trim();
    const n = String(name || "").trim();
    if (!s || !n) return;
    localStorage.setItem(pwdSaltStorageKey(originOrUrl, n), s);
  } catch {}
}

// The personal store holds channels/events directly now. Older stores nested them
// under a single group ("pg") — migrate that shape on load.
function normalizeRoutineCatalog(routines) {
  const out = [];
  const seen = new Set();
  for (const source of Array.isArray(routines) ? routines : []) {
    const { channelId: _legacyChannelId, ...routine } = source || {};
    if (!routine.id) continue;
    routine.routineStyle = routine.routineStyle || "rare-blue";
    routine.eventCardStyle = typeof eventCardPresetForRoutine === "function"
      ? eventCardPresetSnapshot(eventCardPresetForRoutine(routine))
      : (routine.eventCardStyle || null);
    const signature = JSON.stringify([
      routine.title || "", routine.subtitle || "", routine.typeId || "", routine.cat || "",
      routine.startMinute, routine.whenPrecision || "", routine.whenPeriod || "",
      routine.duration || "", routine.locationLabelId || "", routine.where || "", routine.icon || "",
      routine.eventCardStyle || null,
    ]);
    if (seen.has(signature)) continue;
    seen.add(signature);
    out.push(routine);
  }
  return out;
}

function personalMyPlansId() {
  return (typeof PersonalSpace !== "undefined" && PersonalSpace.MY_PLANS_ID) || "pch";
}

function personalMyPlansBoardId() {
  return (typeof PersonalSpace !== "undefined" && PersonalSpace.MY_PLANS_BOARD_ID) || "pch-board";
}

function personalMyPlansChatId() {
  return (typeof PersonalSpace !== "undefined" && PersonalSpace.MY_PLANS_CHAT_ID) || "pch-chat";
}

function personalMyPlansName() {
  return (typeof PersonalSpace !== "undefined" && PersonalSpace.MY_PLANS_NAME) || "My plans";
}

function personalAcceptedId() {
  return (typeof PersonalSpace !== "undefined" && PersonalSpace.MY_ACCEPTED_ID) || "pacc";
}

function personalAcceptedName() {
  return (typeof PersonalSpace !== "undefined" && PersonalSpace.MY_ACCEPTED_NAME) || "Accepted";
}

function defaultPersonalMyPlansChannel() {
  return { id: personalMyPlansId(), kind: "event", name: personalMyPlansName(), boardId: personalMyPlansBoardId() };
}

function defaultPersonalMyPlansChat() {
  return { id: personalMyPlansChatId(), kind: "chat", name: personalMyPlansName(), boardId: personalMyPlansBoardId() };
}

function defaultPersonalMyPlansBoard() {
  return { id: personalMyPlansBoardId(), name: personalMyPlansName() };
}

/** Insert or rename pch so My calendar always has a required personal agenda. */
function ensurePersonalMyPlansChannel(channels, boards) {
  if (!Array.isArray(channels)) return false;
  const id = personalMyPlansId();
  const name = personalMyPlansName();
  const boardId = personalMyPlansBoardId();
  const chatId = personalMyPlansChatId();
  let dirty = false;
  let ch = channels.find(c => c && c.id === id);
  if (!ch) {
    channels.unshift({ id, kind: "event", name, boardId });
    dirty = true;
    ch = channels[0];
  }
  if (ch.kind !== "event") {
    ch.kind = "event";
    dirty = true;
  }
  if (ch.name !== name) {
    ch.name = name;
    dirty = true;
  }
  if (ch.boardId !== boardId) {
    ch.boardId = boardId;
    dirty = true;
  }
  let chat = channels.find(c => c && c.id === chatId);
  if (!chat) {
    channels.splice(1, 0, { id: chatId, kind: "chat", name, boardId, linkedChatChannelId: null });
    dirty = true;
    chat = channels.find(c => c.id === chatId);
  }
  if (chat && chat.boardId !== boardId) {
    chat.boardId = boardId;
    dirty = true;
  }
  if (ch && chat) ch.linkedChatChannelId = chat.id;
  if (Array.isArray(boards)) {
    let board = boards.find(b => b && b.id === boardId);
    if (!board) {
      boards.unshift({ id: boardId, name });
      dirty = true;
    } else if (board.name !== name) {
      board.name = name;
      dirty = true;
    }
  }
  return dirty;
}

/** Hidden read-only board of everything this user has accepted. */
function ensurePersonalAcceptedChannel(channels) {
  if (!Array.isArray(channels)) return false;
  const id = personalAcceptedId();
  const name = personalAcceptedName();
  let dirty = false;
  let ch = channels.find(c => c && c.id === id);
  if (!ch) {
    channels.push({ id, kind: "event", name, hidden: true });
    return true;
  }
  if (ch.kind !== "event") {
    ch.kind = "event";
    dirty = true;
  }
  if (ch.name !== name) {
    ch.name = name;
    dirty = true;
  }
  if (ch.hidden !== true) {
    ch.hidden = true;
    dirty = true;
  }
  return dirty;
}

function loadPersonalStore() {
  const raw = JSON.parse(localStorage.getItem("ash_personal_v1") || "null");
  if (raw && raw.groups) {
    const g = raw.groups[0] || {};
    return {
      channels: g.channels || [],
      events: g.events || [],
      notifications: raw.notifications || [],
      messages: raw.messages || {},
    };
  }
  if (raw) return raw;
  return {
    channels: [defaultPersonalMyPlansChannel(), defaultPersonalMyPlansChat()],
    boards: [defaultPersonalMyPlansBoard()],
    events: [],
    availabilities: [],
    timeBlocks: [],
    notifications: [],
    messages: {},
  };
}

function makePersonalConn() {
  const me = loadMe();
  const stored = loadPersonalStore();
  const channels = Array.isArray(stored.channels) && stored.channels.length
    ? stored.channels
    : [defaultPersonalMyPlansChannel(), defaultPersonalMyPlansChat()];
  const boards = Array.isArray(stored.boards) ? stored.boards : [defaultPersonalMyPlansBoard()];
  const repairedPlans = ensurePersonalMyPlansChannel(channels, boards);
  const repairedAccepted = ensurePersonalAcceptedChannel(channels);
  const repairedCalendar = typeof ensureDeviceCalendarChannel === "function" && ensureDeviceCalendarChannel(channels);
  const conn = {
    id: "personal", url: null, name: "Personal", token: null, pass: null, key: null,
    ws: null, me, hostName: "this device",
    boards, channels, events: stored.events || [], availabilities: stored.availabilities || [],
    timeBlocks: stored.timeBlocks || [],
    categories: loadJSON("ash_personal_categories_v1", null) || DEFAULT_CATEGORIES.slice(),
    cardCats: loadJSON("ash_personal_card_cats_v1", null) || defaultCardCats(),
    cardDurations: loadJSON("ash_personal_card_durs_v1", null) || {},
    removedCards: loadJSON("ash_personal_removed_cards_v1", []) || [],
    eventTypes: loadJSON("ash_personal_event_types_v1", null) || [],
    messages: stored.messages || {},
    members: [me], online: [me.id], pendingReqs: [], invite: null,
    notifications: stored.notifications || [],
    iconText: "",
    status: "online", local: true, retryDelay: 0,
  };
  const repairedBoards = typeof ensureConnBoards === "function" ? ensureConnBoards(conn) : false;
  if (typeof hydratePlainMessages === "function") hydratePlainMessages(conn);
  if (repairedPlans || repairedAccepted || repairedCalendar || repairedBoards) {
    savePersonal(conn);
  }
  return conn;
}

function loadMe() {
  if (typeof isDemoMode === "function" && isDemoMode()) {
    const demoMe = typeof DemoStore !== "undefined" ? DemoStore.getMe() : null;
    if (demoMe) return demoMe;
  }
  let me = JSON.parse(localStorage.getItem("ash_me") || "null");
  if (!me) {
    const b = crypto.getRandomValues(new Uint8Array(6));
    me = { id: [...b].map(x => x.toString(16).padStart(2, "0")).join(""), name: AVATAR_PLACEHOLDER_NAME };
    localStorage.setItem("ash_me", JSON.stringify(me));
  }
  const before = me.offlineAvatar && typeof me.offlineAvatar === "object"
    ? JSON.stringify(me.offlineAvatar)
    : "";
  if (!me.offlineAvatar || typeof me.offlineAvatar !== "object") {
    me.offlineAvatar = defaultOfflineAvatar(me.id, me.name);
  } else {
    me.offlineAvatar = normalizeOfflineAvatar(me.offlineAvatar, me.id, me.name);
  }
  if (JSON.stringify(me.offlineAvatar) !== before) {
    try { localStorage.setItem("ash_me", JSON.stringify(me)); } catch {}
  }
  return me;
}

function saveMe(patch = {}) {
  const prev = loadMe();
  const me = { ...prev, ...patch };
  if ("localPhoto" in patch && !patch.localPhoto) delete me.localPhoto;
  if (patch.offlineAvatar) {
    me.offlineAvatar = normalizeOfflineAvatar(patch.offlineAvatar, me.id, me.name);
  } else if (patch.name && String(patch.name).trim() !== String(prev.name || "").trim()) {
    // Renaming only refreshes placeholder letters — leave a drawn face alone.
    if (me.offlineAvatar?.mode !== "draw") {
      const prevLetters = prev.offlineAvatar?.text || "";
      if (isPlaceholderAvatarLetters(prevLetters, prev.name)
        || prevLetters === avatarLettersFromName(prev.name)) {
        me.offlineAvatar = normalizeOfflineAvatar(
          { ...(me.offlineAvatar || {}), text: "" },
          me.id,
          me.name,
        );
      }
    }
  }
  localStorage.setItem("ash_me", JSON.stringify(me));
  if (typeof isDemoMode === "function" && isDemoMode()) {
    try { DemoStore?.setMe?.(me); } catch {}
    if (S.conns) {
      for (const c of Object.values(S.conns)) {
        if (!c) continue;
        if (c.me && c.me.id === me.id) {
          c.me = { ...c.me, name: me.name, id: me.id, offlineAvatar: me.offlineAvatar };
          if (me.localPhoto) c.me.localPhoto = me.localPhoto;
          else delete c.me.localPhoto;
        }
        if (Array.isArray(c.members)) {
          c.members = c.members.map((m) => {
            if (m?.id !== me.id) return m;
            const next = { ...m, name: me.name, offlineAvatar: me.offlineAvatar };
            if (me.localPhoto) next.localPhoto = me.localPhoto;
            else delete next.localPhoto;
            return next;
          });
        }
        try { DemoStore?.persistConn?.(c); } catch {}
      }
    }
    return me;
  }
  if (S.conns?.personal?.me) {
    S.conns.personal.me = {
      ...S.conns.personal.me,
      name: me.name,
      id: me.id,
      offlineAvatar: me.offlineAvatar,
    };
    if (me.localPhoto) S.conns.personal.me.localPhoto = me.localPhoto;
    else delete S.conns.personal.me.localPhoto;
    S.conns.personal.members = normalizeConnMembers(S.conns.personal, [S.conns.personal.me]);
  }
  return me;
}

/** 1–2 letters for offline avatars (A–Z / 0–9); empty → initials from name. */
function normalizeAvatarLetters(raw, name) {
  const cleaned = String(raw || "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .slice(0, 2)
    .toUpperCase();
  if (cleaned) return cleaned;
  const fromName = typeof initials === "function" ? initials(name || "?") : "";
  return (fromName || "?").slice(0, 2).toUpperCase();
}

/** Default device name before the user picks one — letters "ME" are a placeholder. */
const AVATAR_PLACEHOLDER_NAME = "Me";

function avatarLettersFromName(name) {
  return normalizeAvatarLetters("", name || "?");
}

/** True when stored letters are the unset “Me” default, not a custom / matching-name face. */
function isPlaceholderAvatarLetters(text, name) {
  const stored = String(text || "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .slice(0, 2)
    .toUpperCase();
  if (!stored) return true;
  const fromName = avatarLettersFromName(name);
  if (stored === fromName) return false;
  return stored === avatarLettersFromName(AVATAR_PLACEHOLDER_NAME);
}

function defaultOfflineAvatar(uid, name) {
  const color = (() => {
    try { return hueFor(uid || "me").bg; } catch { return "#a9c8ef"; }
  })();
  return {
    mode: "letters",
    text: normalizeAvatarLetters("", name || "?"),
    color,
  };
}

function normalizeOfflineAvatar(raw, uid, name) {
  const fallbackName = name != null && String(name).trim()
    ? String(name).trim()
    : (typeof nameOf === "function" ? nameOf(uid) : "") || "?";
  if (!raw || typeof raw !== "object") return defaultOfflineAvatar(uid, fallbackName);
  const fallback = defaultOfflineAvatar(uid, fallbackName).color;
  const color = /^#[0-9a-fA-F]{6}$/.test(String(raw.color || "").trim())
    ? String(raw.color).trim()
    : fallback;
  // Drawn face (when the server allows drawing) — keep strokes + colour.
  if (raw.mode === "draw" && typeof raw.draw === "string"
      && (typeof isDrawnIcon !== "function" || isDrawnIcon(raw.draw))) {
    return { mode: "draw", draw: raw.draw, color };
  }
  // Letters are the default offline face. Stale “ME” from the default name “Me” yields
  // to the current name; a custom abbreviation (or initials that really are ME) stays.
  const stored = String(raw.text || raw.letters || "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .slice(0, 2)
    .toUpperCase();
  const text = isPlaceholderAvatarLetters(stored, fallbackName)
    ? avatarLettersFromName(fallbackName)
    : stored;
  return { mode: "letters", text, color };
}

/** Per-server profile pic overrides (device-local). Missing key ⇒ User settings defaults. */
const SERVER_PROFILES_KEY = "ash_server_profiles_v1";

function loadServerProfiles() {
  try {
    const raw = JSON.parse(localStorage.getItem(SERVER_PROFILES_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function getServerProfileOverride(serverId) {
  const id = String(serverId || "").trim();
  if (!id) return null;
  const raw = loadServerProfiles()[id];
  return raw && typeof raw === "object" ? raw : null;
}

function setServerProfileOverride(serverId, patch) {
  const id = String(serverId || "").trim();
  if (!id) return null;
  const map = loadServerProfiles();
  const me = loadMe();
  const next = { ...(map[id] || {}), ...(patch || {}) };
  if ("localPhoto" in (patch || {}) && !patch.localPhoto) delete next.localPhoto;
  if ("name" in (patch || {})) {
    const nm = String(patch.name || "").trim().slice(0, 24);
    if (nm) next.name = nm;
    else delete next.name;
  }
  const refName = next.name || me.name;
  if (patch?.offlineAvatar) {
    next.offlineAvatar = normalizeOfflineAvatar(patch.offlineAvatar, me.id, refName);
  }
  map[id] = next;
  localStorage.setItem(SERVER_PROFILES_KEY, JSON.stringify(map));
  return next;
}

function clearServerProfileOverride(serverId) {
  const id = String(serverId || "").trim();
  if (!id) return;
  const map = loadServerProfiles();
  if (!(id in map)) return;
  delete map[id];
  localStorage.setItem(SERVER_PROFILES_KEY, JSON.stringify(map));
}

/** Effective offline avatar for this device on a given server (override or User settings). */
function effectiveServerOfflineAvatar(serverId) {
  const me = loadMe();
  const conn = (typeof S !== "undefined" && S.conns) ? S.conns[serverId] : null;
  const name = String(conn?.me?.name || "").trim() || me.name;
  const o = getServerProfileOverride(serverId);
  if (o?.offlineAvatar) return normalizeOfflineAvatar(o.offlineAvatar, me.id, name);
  return normalizeOfflineAvatar(me.offlineAvatar, me.id, name);
}

/** Effective online photo for this device on a given server (override or User settings). */
function effectiveServerLocalPhoto(serverId) {
  const o = getServerProfileOverride(serverId);
  if (o && Object.prototype.hasOwnProperty.call(o, "localPhoto")) {
    return typeof o.localPhoto === "string" ? o.localPhoto : "";
  }
  return loadMe().localPhoto || "";
}

function savePersonal(conn = S.conns.personal) {
  if (!conn) return;
  if (conn.id && conn.id !== "personal" && !conn.demo) return;
  if (typeof isDemoMode === "function" && isDemoMode()) {
    try { DemoStore?.persistConn?.(conn); } catch {}
    return;
  }
  if (conn.demo && conn.id !== "personal") return;
  localStorage.setItem("ash_personal_v1", JSON.stringify({
    boards: conn.boards || [],
    channels: conn.channels,
    events: conn.events,
    availabilities: conn.availabilities || [],
    timeBlocks: conn.timeBlocks || [],
    notifications: conn.notifications,
    messages: conn.messages || {},
  }));
}

function loadServers() {
  if (typeof isDemoMode === "function" && isDemoMode()) return [];
  return JSON.parse(localStorage.getItem("ash_servers_v1") || "[]");
}
function saveServers(list) {
  if (typeof isDemoMode === "function" && isDemoMode()) return;
  localStorage.setItem("ash_servers_v1", JSON.stringify(list));
}
function upsertServerEntry(entry) {
  const list = loadServers();
  const i = list.findIndex(s => s.id === entry.id);
  if (i >= 0) list[i] = { ...list[i], ...entry }; else list.push(entry);
  saveServers(list);
  if (entry?.id) ensureRailOrderId(entry.id);
}
function removeServerEntry(id) {
  try { LocalSyncStore?.removeConn?.(id); } catch {}
  saveServers(loadServers().filter(s => s.id !== id));
  localStorage.removeItem(`ash_cache_${id}`);
  localStorage.removeItem(`ash_outbox_${id}`);
  removeRailOrderId(id);
}

/** Persisted top→bottom order of joined servers on the rail (personal is fixed first). */
const RAIL_ORDER_KEY = "ash_rail_order_v1";
function loadRailOrder() {
  try {
    const raw = JSON.parse(localStorage.getItem(RAIL_ORDER_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter(id => typeof id === "string" && id && id !== "personal") : [];
  } catch { return []; }
}
function saveRailOrder(ids) {
  const clean = [...new Set((ids || []).filter(id => id && id !== "personal"))];
  localStorage.setItem(RAIL_ORDER_KEY, JSON.stringify(clean));
}
function ensureRailOrderId(id) {
  if (!id || id === "personal") return;
  const order = loadRailOrder();
  if (order.includes(id)) return;
  order.push(id);
  saveRailOrder(order);
}
function removeRailOrderId(id) {
  saveRailOrder(loadRailOrder().filter(x => x !== id));
}
/** Joined (non-personal) conns in join order (append-only; no drag reorder). */
function orderedRemoteConns() {
  const remotes = Object.values(S.conns || {}).filter(c => c && !PersonalSpace.isPersonal(c));
  const hostedTags = new Set();
  for (const c of remotes) {
    if (!String(c.id || "").startsWith("srv-local-")) continue;
    const tag = typeof normJoinTag === "function" ? normJoinTag(c.joinTag) : String(c.joinTag || "").trim().toUpperCase();
    if (tag) hostedTags.add(tag);
  }
  const visible = remotes.filter((c) => {
    if (String(c.id || "").startsWith("srv-local-")) return true;
    const tag = typeof normJoinTag === "function" ? normJoinTag(c.joinTag) : String(c.joinTag || "").trim().toUpperCase();
    return !(tag && hostedTags.has(tag));
  });
  const byId = Object.fromEntries(visible.map(c => [c.id, c]));
  const out = [];
  for (const id of loadRailOrder()) {
    if (byId[id]) { out.push(byId[id]); delete byId[id]; }
  }
  // New / unordered servers keep a stable fallback after saved ones.
  for (const c of visible) {
    if (byId[c.id]) out.push(c);
  }
  return out;
}

/** Event mutations that stay usable while the host is unreachable. */
const QUEUEABLE_TYPES = new Set([
  "createEvent", "createEventFromRoutine", "createRoutine", "updateRoutine", "deleteRoutine", "rsvp", "react", "eventNote", "addPerson", "removePerson",
  "setMemberRsvp", "setEventConfirmAttendance", "setEventSignupGroups", "assignEventGroup",
  "sendMessage",
  "createTask", "updateTask", "setTaskCompleted", "deleteTask",
  "createPoll", "updatePoll", "votePoll", "closePoll",
  "setEventTimePrecision", "setEventWhere", "setEventDetails", "setEventIcon", "setEventSticker", "setEventSubtitle", "setEventType", "setEventDuration",
  "setEventCardStyle", "setUserEventCardStyle",
]);

function loadOutbox(connOrId) {
  const id = typeof connOrId === "string" ? connOrId : connOrId?.id;
  if (!id) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(`ash_outbox_${id}`) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

function saveOutbox(conn) {
  if (!conn || PersonalSpace.isPersonal(conn)) return;
  localStorage.setItem(`ash_outbox_${conn.id}`, JSON.stringify(conn.outbox || []));
}

function outboxEventId(entry) {
  if (!entry) return null;
  if (entry.eventId) return entry.eventId;
  const p = entry.payload;
  if (!p) return null;
  if ((p.type === "createEvent" || p.type === "createEventFromRoutine") && p.id) return p.id;
  return p.eventId || null;
}

function refreshPendingFlags(conn) {
  if (!conn || PersonalSpace.isPersonal(conn)) return;
  const pending = new Set();
  for (const e of conn.outbox || []) {
    const eid = outboxEventId(e);
    if (eid) pending.add(eid);
  }
  for (const ev of conn.events || []) ev._pending = pending.has(ev.id);
}

function ensureOutbox(conn) {
  if (!conn || PersonalSpace.isPersonal(conn)) return;
  if (!Array.isArray(conn.outbox)) conn.outbox = loadOutbox(conn);
}

/** Mint client ids so offline replay is idempotent. Mutates m in place. */
function ensureClientActionIds(m) {
  if (!m || !QUEUEABLE_TYPES.has(m.type)) return m;
  if ((m.type === "createEvent" || m.type === "createEventFromRoutine") && !m.id) m.id = genLocalId();
  if (m.type === "eventNote" && !m.noteId) m.noteId = genLocalId();
  if (m.type === "sendMessage" && !m.id) m.id = genLocalId();
  if (m.type === "createTask" && !m.id) m.id = genLocalId();
  if (m.type === "createPoll" && !m.id) m.id = genLocalId();
  if (m.type === "createTask" || m.type === "updateTask" || m.type === "setTaskCompleted" || m.type === "deleteTask"
      || m.type === "createPoll" || m.type === "updatePoll" || m.type === "votePoll" || m.type === "closePoll") {
    if (!m.actionId) m.actionId = genLocalId();
  }
  return m;
}

/** After optimistic react apply, store absolute set/clear for safe flush. */
function absoluteReactPayload(conn, m, prevEncoded) {
  if (!conn?.me || m.type !== "react") return { ...m };
  // Moderation / explicit clears / appends are already absolute.
  if (m.clearEmoji || m.remove || m.removeAll || m.append || m.add) return { ...m };
  const ev = conn.events.find(e => e.id === m.eventId);
  const cur = ev?.reactions?.[conn.me.id];
  if (!cur) {
    const cleared = (prevEncoded && rxParts(prevEncoded).emoji) || m.emoji;
    return { type: "react", eventId: m.eventId, emoji: cleared, remove: true };
  }
  const { emoji, count } = rxParts(cur);
  return { type: "react", eventId: m.eventId, emoji, count };
}

function enqueueOutbox(conn, payload) {
  ensureOutbox(conn);
  const entry = {
    id: genLocalId(),
    type: payload.type,
    payload: { ...payload },
    createdAt: Date.now(),
    eventId: (payload.type === "createEvent" || payload.type === "createEventFromRoutine")
      ? (payload.id || null) : (payload.eventId || null),
  };
  conn.outbox.push(entry);
  saveOutbox(conn);
  refreshPendingFlags(conn);
  return entry;
}

function canQueueMessage(conn, m) {
  return !!(conn && !PersonalSpace.isPersonal(conn) && conn.me && conn.token
    && m && QUEUEABLE_TYPES.has(m.type));
}

function queueUnreachable(conn, m) {
  if (!canQueueMessage(conn, m)) return false;
  // Flush failures stay in the outbox; don't re-apply or duplicate.
  if (conn._flushingOutbox) return false;
  ensureClientActionIds(m);
  let prevReact = null;
  if (m.type === "react" && conn.me) {
    prevReact = conn.events.find(e => e.id === m.eventId)?.reactions?.[conn.me.id] || null;
  }
  optimisticApply(conn, m);
  const payload = m.type === "react" ? absoluteReactPayload(conn, m, prevReact) : { ...m };
  ensureOutbox(conn);
  const first = !(conn.outbox || []).length;
  enqueueOutbox(conn, payload);
  if (first) {
    toast("Saved offline — will sync when the host is back");
  }
  renderConnStatus();
  return true;
}

/** Apply a queued mutation locally so the client stays usable while offline. */
