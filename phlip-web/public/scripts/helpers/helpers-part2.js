/* helpers-part2.js — split from helpers.js (Part 3 size ceiling).
 * Load after: helpers-part1.js; part of helpers cluster.
 */

function connForMember(uid) {
  if (!uid) return null;
  const active = activeConn();
  if (active) {
    if (active.me?.id === uid) return active;
    if ((active.members || []).some(u => u.id === uid)) return active;
  }
  for (const c of Object.values(S.conns || {})) {
    if (c === active) continue;
    if (c.me?.id === uid) return c;
    if ((c.members || []).some(u => u.id === uid)) return c;
  }
  return active || null;
}

function memberRecord(uid) {
  if (!uid) return null;
  const conn = connForMember(uid);
  if (!conn) return null;
  if (conn.me?.id === uid) return conn.me;
  return (conn.members || []).find(u => u.id === uid) || null;
}

/** Online on the server that owns this member — not merely the active rail tab. */
function memberIsOnline(uid) {
  if (!uid) return false;
  const conn = connForMember(uid);
  if (!conn) return false;
  if (PersonalSpace.isPersonal(conn)) return conn.me?.id === uid;
  return (conn.online || []).includes(uid);
}

/** Parse offline avatar from member payload or local me (per-server override when self). */
function memberOfflineAvatar(uid) {
  if (!uid) return null;
  const conn = connForMember(uid);
  const m = memberRecord(uid);
  const nameHint = m?.name || (typeof nameOf === "function" ? nameOf(uid) : "") || "?";
  if (conn?.me?.id === uid) {
    if (!PersonalSpace.isPersonal(conn) && typeof getServerProfileOverride === "function") {
      const o = getServerProfileOverride(conn.id);
      if (o?.offlineAvatar) return normalizeOfflineAvatar(o.offlineAvatar, uid, nameHint);
    }
    const localMe = loadMe();
    if (localMe.offlineAvatar) {
      return normalizeOfflineAvatar(localMe.offlineAvatar, uid, nameHint || localMe.name);
    }
  }
  if (m?.offlineAvatar) return normalizeOfflineAvatar(m.offlineAvatar, uid, nameHint);
  return null;
}

/**
 * Live/camera face for a member.
 * - off: never
 * - online: app + online + livePic (or self local photo)
 * - always: host profilePic (or self local), no online/served gates
 */
function memberProfilePic(uid) {
  if (!uid) return "";
  const conn = connForMember(uid);
  const mode = typeof serverSettings === "function"
    ? serverSettings(conn).liveProfilePhotos
    : "off";
  if (mode === "off") return "";

  if (mode === "always") {
    if (conn?.me?.id === uid) {
      if (!PersonalSpace.isPersonal(conn) && typeof effectiveServerLocalPhoto === "function") {
        return effectiveServerLocalPhoto(conn.id) || "";
      }
      return loadMe().localPhoto || "";
    }
    const m = memberRecord(uid);
    if (!m) return "";
    if (m.profilePic) return m.profilePic;
    if (m.livePic) return m.livePic;
    return "";
  }

  // online — session photos only while connected in the app
  if (typeof isServedOrigin === "function" && isServedOrigin()) return "";
  if (!memberIsOnline(uid)) return "";
  if (conn?.me?.id === uid) {
    if (!PersonalSpace.isPersonal(conn) && typeof effectiveServerLocalPhoto === "function") {
      return effectiveServerLocalPhoto(conn.id) || "";
    }
    return loadMe().localPhoto || "";
  }
  const m = memberRecord(uid);
  if (!m) return "";
  if (m.livePic) return m.livePic;
  // Legacy host JPEG only if they never set an offline avatar.
  if (!m.offlineAvatar && m.profilePic) return m.profilePic;
  return "";
}

const avatarStyle = (uid) => {
  const pic = memberProfilePic(uid);
  if (pic) {
    // Don't set color:transparent — reaction badges (.avatar-rx) live inside this
    // node and drawn reactions use currentColor (they'd vanish).
    return `background-image:url('${pic.replace(/'/g, "%27")}');background-size:cover;background-position:center`;
  }
  // On a server, a face without a photo takes its role's colour (plain for
  // Member / Viewer), the same as the name in chat.
  const roleFace = typeof memberAvatarRoleStyle === "function" ? memberAvatarRoleStyle(uid) : "";
  if (roleFace) return roleFace;
  const off = memberOfflineAvatar(uid);
  if (off?.mode === "draw") {
    const color = off.color || hueFor(uid).bg;
    return `background:${color};color:${contrastOn(color)}`;
  }
  if (off?.color) {
    return `background:${off.color};color:${contrastOn(off.color)}`;
  }
  const h = hueFor(uid);
  return `background:${h.bg};color:${h.fg}`;
};

/** Inner markup for an avatar face (photo → empty; drawn face → glyph; else letters/initials). */
function avatarFaceHtml(uid, name) {
  if (memberProfilePic(uid)) return "";
  const off = memberOfflineAvatar(uid);
  if (off?.mode === "draw" && off.draw) return ic(off.draw, "avatar-face-ico");
  if (off?.text) return esc(off.text);
  return esc(initials(name != null ? name : nameOf(uid)));
}

/** Patch live faces already on screen — never remount a view for a JPEG swap. */
function refreshLiveFacesInDom(root) {
  if (typeof document === "undefined") return;
  const scope = root || document;
  let nodes;
  try {
    nodes = scope.querySelectorAll(
      ".avatar-sm[data-uid], .avatar[data-uid], .people-avatar[data-uid], .side-user-avatar[data-uid], .ch-person-avatar[data-uid], .user-avatar-preview[data-uid], .side-pinned-person-avatar[data-uid], .side-avatar-preview[data-uid], .ticket-host-gem[data-uid], .ticket-stub-gem[data-uid]"
    );
  }
  catch { return; }
  nodes.forEach((el) => {
    const uid = el.getAttribute("data-uid") || el.dataset?.uid;
    if (!uid) return;
    if (typeof avatarStyle === "function") {
      const nextStyle = avatarStyle(uid);
      if (el.getAttribute("style") !== nextStyle) el.setAttribute("style", nextStyle);
    }
    if (typeof avatarFaceHtml !== "function") return;
    if (el.querySelector(".avatar-rx")) return;
    const nextFace = avatarFaceHtml(uid);
    if (el.innerHTML !== nextFace) el.innerHTML = nextFace;
  });
  try {
    scope.querySelectorAll("img.rail-pic[data-uid]").forEach((img) => {
      const uid = img.dataset?.uid;
      const pic = typeof memberProfilePic === "function" ? memberProfilePic(uid) : "";
      if (pic && img.getAttribute("src") !== pic) img.setAttribute("src", pic);
    });
  } catch {}
}

function contrastOn(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return "#294c7d";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#2a2a28" : "#f7f4ef";
}

const nameOf = (uid) => {
  if (!uid) return "someone";
  if (isBridgeGuestId(uid)) return bridgeGuestLabel(uid);
  const m = (S.members || []).find(u => u.id === uid);
  if (m?.name) return m.name;
  return "someone";
};

/** Broadcast / share-link guest RSVPs live on `ev.bridgeGuests` (label → status),
 *  not as real user ids — synthetic keys so avatarStack / nameOf still work. */
const BRIDGE_GUEST_PREFIX = "guest:";
function isBridgeGuestId(id) {
  return typeof id === "string" && id.startsWith(BRIDGE_GUEST_PREFIX);
}
function bridgeGuestId(label) {
  return BRIDGE_GUEST_PREFIX + String(label || "");
}
function bridgeGuestLabel(id) {
  return isBridgeGuestId(id) ? id.slice(BRIDGE_GUEST_PREFIX.length) : "";
}
function eventBridgeGuestIds(ev, status) {
  return Object.entries(ev?.bridgeGuests || {})
    .filter(([, st]) => st === status)
    .map(([label]) => bridgeGuestId(label));
}
/** Member + guest ids for one RSVP status (Going / Signed-up / Can't). */
function eventRsvpIds(ev, status) {
  const members = Object.entries(ev?.rsvps || {})
    .filter(([, v]) => v === status)
    .map(([u]) => u);
  return [...members, ...eventBridgeGuestIds(ev, status)];
}
function eventRsvpCount(ev, status) {
  return eventRsvpIds(ev, status).length;
}

/* ── roles & permissions (mirrors DrServer.kt) ─────────────────────────── */
const ROLE_HOST = "host";
const ROLE_ADMIN = "admin";
const ROLE_MODERATOR = "moderator";
const ROLE_USER = "user";
const ROLE_VIEWER = "viewer";
/** Reserved — never assigned to custom / member / viewer tags. */
const ROLE_ADMIN_COLOR = "#FF4646";      // rgb(255, 70, 70)
const ROLE_MODERATOR_COLOR = "#3E7BDB";  // blue (purple is reserved for focus)

function normalizeRoleHex(color) {
  const s = String(color || "").trim();
  const rgb = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) {
    return "#" + [rgb[1], rgb[2], rgb[3]]
      .map(n => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, "0"))
      .join("");
  }
  const m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return "";
  let h = m[1].toLowerCase();
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  return `#${h}`;
}

function isStaffReservedColor(color) {
  const hex = normalizeRoleHex(color);
  return hex === normalizeRoleHex(ROLE_ADMIN_COLOR)
    || hex === normalizeRoleHex(ROLE_MODERATOR_COLOR);
}

const CHANNEL_MATRIX_FIXED_KEYS = [ROLE_MODERATOR, ROLE_USER, ROLE_VIEWER];
/** Channel “who can see this” rows — Moderator / Member / Viewer (Host/Admin always see). */
const CHANNEL_VIEW_FIXED_KEYS = [ROLE_MODERATOR, ROLE_USER, ROLE_VIEWER];
const CHANNEL_PERM_FLAGS = ["view", "rsvp", "create", "react", "edit", "stickers", "repeats", "chains", "requireApproval", "canApprove"];
/** Server-wide invent flags — Roles editor only, not channel visibility matrices. */
const ROLE_INVENT_FLAGS = ["createEventTypes", "addLocations"];
/** Configurable Roles-editor flags. Obsolete keys stay on CHANNEL_PERM_FLAGS for old snapshots. */
const ROLE_CONFIG_PERM_FLAGS = ["view", "create", "requireApproval", "canApprove", "createEventTypes"];
const ROLE_EDITOR_PERM_FLAGS = ROLE_CONFIG_PERM_FLAGS;
const CHANNEL_PERM_FLAG_LABELS = {
  view: "View",
  rsvp: "RSVP",
  create: "Create",
  react: "React",
  edit: "Edit",
  stickers: "Stickers",
  repeats: "Repeats",
  chains: "Chains",
  requireApproval: "Require approval",
  canApprove: "Approve",
  createEventTypes: "Create event types",
  addLocations: "New places",
};

function emptyRolePermFlags() {
  return { view: false, rsvp: false, create: false, react: false, edit: false, stickers: false, repeats: false, chains: false, requireApproval: false, canApprove: false };
}

/** Full trust: every flag on except "requireApproval" (a fully-trusted role's own events shouldn't need approval). */
function allRolePermFlags() {
  return { view: true, rsvp: true, create: true, react: true, edit: true, stickers: true, repeats: true, chains: true, requireApproval: false, canApprove: true };
}

function defaultMemberRolePermFlags(canCreate = true) {
  return {
    view: true, rsvp: true, create: !!canCreate, react: true,
    edit: false, stickers: true, repeats: !!canCreate, chains: !!canCreate,
    requireApproval: false, canApprove: false,
  };
}

function orRolePermFlags(a, b) {
  const out = emptyRolePermFlags();
  for (const f of CHANNEL_PERM_FLAGS) out[f] = !!(a?.[f] || b?.[f]);
  for (const f of ROLE_INVENT_FLAGS) out[f] = !!(a?.[f] || b?.[f]);
  return out;
}

function defaultInventFlag(roleKey, flag, conn) {
  if (roleKey === ROLE_ADMIN || roleKey === ROLE_HOST) return true;
  const ss = typeof serverSettings === "function" ? serverSettings(conn) : (conn?.serverSettings || {});
  const raw = flag === "createEventTypes" ? ss.createEventTypes : ss.addLocations;
  const level = typeof normalizeMemberPerm === "function"
    ? normalizeMemberPerm(raw, "moderator")
    : "moderator";
  if (roleKey === ROLE_MODERATOR) return level !== "admin";
  if (roleKey === ROLE_USER) return level === "everyone";
  return false;
}

/** Fill invent flags + implied view/create mappings. `edit` is never edit-any on matrix rows. */
function normalizeRolePermFlags(flags, roleKey, conn) {
  const src = flags && typeof flags === "object" ? flags : {};
  const out = { ...emptyRolePermFlags(), ...src };
  for (const f of ROLE_INVENT_FLAGS) {
    if (!Object.prototype.hasOwnProperty.call(src, f)) {
      if (f === "addLocations" && (src.create || out.create)) out[f] = true;
      else out[f] = defaultInventFlag(roleKey, f, conn);
    }
  }
  if (out.view) {
    if (!Object.prototype.hasOwnProperty.call(src, "rsvp")) out.rsvp = true;
    if (!Object.prototype.hasOwnProperty.call(src, "react")) out.react = true;
    if (!Object.prototype.hasOwnProperty.call(src, "stickers")) out.stickers = true;
  }
  if (out.create) {
    if (!Object.prototype.hasOwnProperty.call(src, "repeats")) out.repeats = true;
    if (!Object.prototype.hasOwnProperty.call(src, "chains")) out.chains = true;
    if (!Object.prototype.hasOwnProperty.call(src, "addLocations")) out.addLocations = true;
  }
  out.edit = false;
  return out;
}

function stripRolePermFlagsForWrite(flags) {
  const src = flags && typeof flags === "object" ? flags : {};
  const out = {};
  for (const f of ROLE_CONFIG_PERM_FLAGS) out[f] = !!src[f];
  return out;
}

function stripEventRolePermsForWrite(map) {
  const out = {};
  if (!map || typeof map !== "object") return out;
  for (const [k, v] of Object.entries(map)) out[k] = stripRolePermFlagsForWrite(v);
  return out;
}

/** Elevated content powers for Moderators — not forced channel view. */
function moderatorActionFlags() {
  return {
    ...allRolePermFlags(),
    view: false,
    createEventTypes: true,
    addLocations: true,
  };
}

function finalizeEventRolePerms(map, conn) {
  if (!map || typeof map !== "object") return map;
  for (const key of CHANNEL_MATRIX_FIXED_KEYS) {
    if (!map[key]) map[key] = emptyRolePermFlags();
    map[key] = normalizeRolePermFlags(map[key], key, conn);
  }
  const roles = typeof customRolesOf === "function" ? customRolesOf(conn) : [];
  for (const role of roles) {
    if (!map[role.id]) {
      const base = role.baseRole === ROLE_VIEWER ? ROLE_VIEWER : ROLE_USER;
      map[role.id] = { ...(map[base] || emptyRolePermFlags()) };
    } else {
      map[role.id] = normalizeRolePermFlags(map[role.id], role.id, conn);
    }
  }
  return map;
}

/** Coarse ceiling for older hosts that still read serverSettings invent scopes. */
function inventCeilingFromRolePerms(conn, flag) {
  const perms = conn?.eventRolePerms || {};
  if (perms[ROLE_USER]?.[flag] || perms[ROLE_VIEWER]?.[flag]) return "everyone";
  const customs = typeof customRolesOf === "function" ? customRolesOf(conn) : [];
  if (customs.some(r => perms[r.id]?.[flag])) return "everyone";
  if (perms[ROLE_MODERATOR]?.[flag]) return "moderator";
  return "admin";
}

function syncInventServerSettings(conn) {
  if (!conn || (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn))) return;
  const createEventTypes = inventCeilingFromRolePerms(conn, "createEventTypes");
  const addLocations = inventCeilingFromRolePerms(conn, "addLocations");
  const ss = conn.serverSettings || {};
  if (ss.createEventTypes === createEventTypes && ss.addLocations === addLocations) return;
  if (typeof send === "function") send({ type: "updateServerSettings", createEventTypes, addLocations });
  conn.serverSettings = { ...ss, createEventTypes, addLocations };
}

function seedEventChannelRolePerms(minRole, createLevel) {
  const floor = normalizeChannelMinRole(minRole) || ROLE_VIEWER;
  const createPerm = normalizeCreateEvents(createLevel, true);
  const canView = (role) => roleRank(role) >= roleRank(floor);
  const canCreate = (role) => {
    if (!canView(role)) return false;
    if (createPerm === "everyone") return role === ROLE_USER || role === ROLE_MODERATOR || role === ROLE_ADMIN || role === ROLE_HOST;
    if (createPerm === "moderator") return role === ROLE_MODERATOR || role === ROLE_ADMIN || role === ROLE_HOST;
    return role === ROLE_ADMIN || role === ROLE_HOST;
  };
  const map = {};
  map[ROLE_VIEWER] = { ...emptyRolePermFlags(), view: canView(ROLE_VIEWER) };
  map[ROLE_USER] = canView(ROLE_USER)
    ? defaultMemberRolePermFlags(canCreate(ROLE_USER))
    : emptyRolePermFlags();
  map[ROLE_MODERATOR] = canView(ROLE_MODERATOR)
    ? (() => {
        const flags = allRolePermFlags();
        if (!canCreate(ROLE_MODERATOR)) {
          flags.create = false;
          flags.repeats = false;
          flags.chains = false;
        }
        return flags;
      })()
    : emptyRolePermFlags();
  return map;
}

function defaultEventChannelRolePerms(conn = activeConn()) {
  return seedEventChannelRolePerms(null, serverSettings(conn).createEvents);
}

/** Keep only view flags (channel visibility map). */
function viewOnlyRolePerms(full) {
  const out = {};
  const src = full && typeof full === "object" ? full : {};
  for (const [key, flags] of Object.entries(src)) {
    out[key] = { ...emptyRolePermFlags(), view: !!flags?.view };
  }
  const viewKeys = typeof CHANNEL_VIEW_FIXED_KEYS !== "undefined"
    ? CHANNEL_VIEW_FIXED_KEYS
    : CHANNEL_MATRIX_FIXED_KEYS;
  for (const fixed of viewKeys) {
    if (!out[fixed]) {
      // Missing moderator.view stays visible (mods used to always see) unless later set false.
      const staffDefault = fixed === ROLE_ADMIN || fixed === ROLE_MODERATOR;
      out[fixed] = { ...emptyRolePermFlags(), view: staffDefault };
    }
  }
  return out;
}

/** Default per-channel visibility from the server action matrix's view column. */
function defaultEventChannelViewPerms(conn = activeConn()) {
  return viewOnlyRolePerms(ensureServerEventRolePerms(conn));
}

/** Server-wide event action matrix (Roles settings). */
function ensureServerEventRolePerms(conn = activeConn()) {
  if (!conn) return defaultEventChannelRolePerms();
  if (conn.eventRolePerms && typeof conn.eventRolePerms === "object"
      && Object.keys(conn.eventRolePerms).length) {
    return finalizeEventRolePerms(conn.eventRolePerms, conn);
  }
  conn.eventRolePerms = finalizeEventRolePerms(defaultEventChannelRolePerms(conn), conn);
  return conn.eventRolePerms;
}

/** Channel visibility map (view-only) for event, chat, and task boards. */
function ensureChannelRolePerms(ch, conn = activeConn()) {
  if (!ch || !["event", "chat", "task"].includes(ch.kind)) return null;
  const viewKeys = typeof CHANNEL_VIEW_FIXED_KEYS !== "undefined"
    ? CHANNEL_VIEW_FIXED_KEYS
    : CHANNEL_MATRIX_FIXED_KEYS;
  if (ch.rolePerms && typeof ch.rolePerms === "object" && Object.keys(ch.rolePerms).length) {
    for (const key of viewKeys) {
      if (!ch.rolePerms[key]) {
        const staffDefault = key === ROLE_ADMIN
          || (key === ROLE_MODERATOR && moderatorViewDefault(ch, ch.rolePerms, conn));
        ch.rolePerms[key] = {
          ...emptyRolePermFlags(),
          view: staffDefault || (key !== ROLE_MODERATOR && !!ensureServerEventRolePerms(conn)[key]?.view),
        };
      } else {
        // Strip any leftover action flags from older clients.
        ch.rolePerms[key] = { ...emptyRolePermFlags(), view: !!ch.rolePerms[key].view };
      }
    }
    return ch.rolePerms;
  }
  if (ch.kind === "chat" || ch.kind === "task") {
    ch.rolePerms = viewOnlyRolePerms(
      seedEventChannelRolePerms(ch.minRole, serverSettings(conn).createEvents)
    );
    return ch.rolePerms;
  }
  ch.rolePerms = defaultEventChannelViewPerms(conn);
  return ch.rolePerms;
}

function customRolesOf(conn = activeConn()) {
  return Array.isArray(conn?.customRoles) ? conn.customRoles.slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)) : [];
}

function matrixRowLabel(key, conn = activeConn()) {
  if (key === ROLE_ADMIN) return "Admin";
  if (key === ROLE_MODERATOR) return "Moderator";
  if (key === ROLE_USER) return "Member";
  if (key === ROLE_VIEWER) return "Viewer";
  const tag = customRolesOf(conn).find(r => r.id === key);
  return tag?.name || key;
}

/** Hosted event channels that mirror chat into this chat. Personal always []. */
function agendasLinkedToChat(ch, conn = activeConn()) {
  if (!ch || ch.kind !== "chat" || !conn) return [];
  if (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn)) return [];
  if (typeof eventChannelsImportingInto !== "function") return [];
  return eventChannelsImportingInto(ch.id, conn) || [];
}

function channelIsManualPrivate(ch, conn = activeConn()) {
  const src = (typeof visibilitySourceForChannel === "function")
    ? visibilitySourceForChannel(ch, conn)
    : ch;
  return Array.isArray(src?.allowedUserIds) && !src.autoIncludeNewMembers;
}

function isPinnedChannel(ch) {
  return !!(ch && (ch.pinnedLocationLabel != null || ch.pinnedUserId != null));
}

/** Pinned location/people boards are occupancy review, not RSVP timelines. */
function isPinnedOccupancyView(ch) {
  return isPinnedChannel(ch);
}

function isWelcomeLobby(ch) {
  if (!ch || ch.kind !== "chat" || ch.boardId) return false;
  if (ch.welcomeChannel) return true;
  return String(ch.name || "").toLowerCase() === "welcome";
}


function boardsOf(conn = activeConn()) {
  return Array.isArray(conn?.boards) ? conn.boards : [];
}

function boardById(boardId, conn = activeConn()) {
  const id = String(boardId || "");
  if (!id) return null;
  return boardsOf(conn).find(b => b && b.id === id) || null;
}

function boardForChannel(ch, conn = activeConn()) {
  if (!ch) return null;
  return boardById(ch.boardId, conn);
}

function visibilitySourceForChannel(ch, conn = activeConn()) {
  return boardForChannel(ch, conn) || ch;
}

function eventChannelForBoard(boardOrId, conn = activeConn()) {
  const id = typeof boardOrId === "string" ? boardOrId : boardOrId?.id;
  if (!id) return null;
  return (conn?.channels || []).find(c =>
    c.boardId === id && c.kind === "event" && !isPinnedChannel(c)) || null;
}

function chatChannelForBoard(boardOrId, conn = activeConn()) {
  const id = typeof boardOrId === "string" ? boardOrId : boardOrId?.id;
  if (!id) return null;
  return (conn?.channels || []).find(c =>
    c.boardId === id && c.kind === "chat" && !isWelcomeLobby(c)) || null;
}

function taskChannelForBoard(boardOrId, conn = activeConn()) {
  const id = typeof boardOrId === "string" ? boardOrId : boardOrId?.id;
  if (!id) return null;
  return (conn?.channels || []).find(c =>
    c.boardId === id && c.kind === "task") || null;
}

function normalizeBoardShownKind(raw) {
  const kind = String(raw || "").trim().toLowerCase();
  return kind === "chat" || kind === "task" ? kind : "event";
}

const BOARD_CHILD_KINDS = ["event", "chat", "task"];

function normalizeBoardKind(raw) {
  const kind = String(raw || "").trim().toLowerCase();
  return BOARD_CHILD_KINDS.includes(kind) ? kind : "";
}

function normalizeBoardHiddenKinds(raw) {
  const hidden = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const kind = normalizeBoardKind(item);
      if (kind && !hidden.includes(kind)) hidden.push(kind);
    }
  }
  if (hidden.length >= BOARD_CHILD_KINDS.length) {
    return hidden.filter(kind => kind !== "event");
  }
  return hidden;
}

function boardHiddenKinds(board) {
  return normalizeBoardHiddenKinds(board?.hiddenKinds);
}

/** Every board shows events, chat, and tasks. A saved hiddenKinds list does not hide a kind. */
function boardKindVisible() {
  return true;
}

function firstVisibleBoardKind(board) {
  const hidden = new Set(boardHiddenKinds(board));
  const preferred = boardShownKind(board);
  if (!hidden.has(preferred)) return preferred;
  return BOARD_CHILD_KINDS.find(kind => !hidden.has(kind)) || "event";
}

function clampBoardShownKind(board) {
  if (!board) return "event";
  const next = firstVisibleBoardKind(board);
  board.shownKind = next;
  board.hiddenKinds = boardHiddenKinds(board);
  return next;
}

function applyBoardHiddenKinds(board, hiddenKinds) {
  if (!board) return [];
  board.hiddenKinds = normalizeBoardHiddenKinds(hiddenKinds);
  clampBoardShownKind(board);
  return board.hiddenKinds;
}

function boardShownKind(board) {
  return normalizeBoardShownKind(board?.shownKind);
}

function channelForBoardKind(board, kind, conn = activeConn()) {
  const key = normalizeBoardKind(kind) || normalizeBoardShownKind(kind);
  if (key === "chat") return chatChannelForBoard(board, conn);
  if (key === "task") return taskChannelForBoard(board, conn);
  return eventChannelForBoard(board, conn);
}

function channelForBoardShownKind(board, conn = activeConn()) {
  const event = eventChannelForBoard(board, conn);
  if (event) return event;
  const kind = firstVisibleBoardKind(board);
  return channelForBoardKind(board, kind, conn);
}

/** One event lookup for All chat cards and the Timeline sheet. */
function findEventById(eventId, events, conn) {
  if (!eventId) return null;
  const pools = [events, conn?.events, (typeof group === "function" ? group()?.events : null)];
  for (const pool of pools) {
    if (!Array.isArray(pool)) continue;
    const hit = pool.find((e) => e && e.id === eventId);
    if (hit) return hit;
  }
  return null;
}

/** Normal board event channel — All chat is the home, not Timeline. */
function boardUsesChatHome(ch, conn = activeConn()) {
  if (!ch || ch.kind !== "event") return false;
  if (typeof isPinnedChannel === "function" && isPinnedChannel(ch)) return false;
  if (typeof isDeviceCalendarChannel === "function" && isDeviceCalendarChannel(ch, conn)) return false;
  return !!ch.boardId;
}

function boardSurfaceFor(channelId) {
  if (typeof S === "undefined") return "conversations";
  if (!S.boardSurfaces || typeof S.boardSurfaces !== "object") S.boardSurfaces = {};
  const id = String(channelId || "");
  const mode = S.boardSurfaces[id];
  // A parked page (helpers-part1.js) shows All chat instead.
  if (mode === "agenda" && !(typeof featureParked === "function" && featureParked("timeline"))) return mode;
  if (mode === "polls" && !(typeof featureParked === "function" && featureParked("polls"))) return mode;
  return "conversations";
}

function setBoardSurface(channelId, mode) {
  if (typeof S === "undefined") return "conversations";
  if (!S.boardSurfaces || typeof S.boardSurfaces !== "object") S.boardSurfaces = {};
  const id = String(channelId || "");
  if (!id) return "conversations";
  const next = mode === "agenda" || mode === "polls" ? mode : "conversations";
  S.boardSurfaces[id] = next;
  return next;
}

function isBoardConversationsView(ch, conn = activeConn()) {
  return boardUsesChatHome(ch, conn) && boardSurfaceFor(ch.id) === "conversations";
}

function isBoardAgendaView(ch, conn = activeConn()) {
  return boardUsesChatHome(ch, conn) && boardSurfaceFor(ch.id) === "agenda";
}

function isBoardPollsView(ch, conn = activeConn()) {
  return boardUsesChatHome(ch, conn) && boardSurfaceFor(ch.id) === "polls";
}

function boardTitle(ch, conn = activeConn()) {
  const board = boardForChannel(ch, conn);
  if (board?.name) return board.name;
  return ch?.name || "";
}

function channelHeadTitle(ch, conn = activeConn()) {
  if (!ch) return "";
  if (isWelcomeLobby(ch)) return ch.name || "Welcome";
  if (isPinnedChannel(ch)) return ch.name || "Pinned";
  const board = boardForChannel(ch, conn);
  if (board?.name) {
    if (ch.kind === "event") return board.name;
    if (ch.kind === "task") return `${board.name} · Tasks`;
    return typeof conversationBoardChatLabel === "function"
      ? conversationBoardChatLabel()
      : "All chat";
  }
  return `# ${ch.name}`;
}

function copyAllowList(src) {
  return Array.isArray(src) ? src.slice() : null;
}

function applyBoardVisibility(conn, board) {
  if (!conn || !board) return;
  const event = eventChannelForBoard(board, conn);
  const chat = chatChannelForBoard(board, conn);
  const task = taskChannelForBoard(board, conn);
  const allow = copyAllowList(board.allowedUserIds);
  const perms = board.rolePerms && typeof board.rolePerms === "object" ? board.rolePerms : null;
  board.autoIncludeNewMembers = !!(allow && board.autoIncludeNewMembers);
  for (const ch of [event, chat, task]) {
    if (!ch) continue;
    ch.name = board.name;
    ch.allowedUserIds = copyAllowList(allow);
    ch.autoIncludeNewMembers = board.autoIncludeNewMembers;
    if (perms) ch.rolePerms = perms;
    ch.minRole = null;
    ch.boardId = board.id;
  }
  if (event && chat) event.linkedChatChannelId = chat.id;
}

function genBoardId() {
  if (typeof genLocalId === "function") return genLocalId();
  return "b" + Math.random().toString(36).slice(2, 10);
}

/**
 * Group event/chat/task channels into boards. Idempotent. Welcome, pinned, Accepted stay standalone.
 */
function ensureConnBoards(conn) {
  if (!conn) return false;
  if (!Array.isArray(conn.boards)) conn.boards = [];
  if (!Array.isArray(conn.channels)) conn.channels = [];
  if (!Array.isArray(conn.tasks)) conn.tasks = [];
  let changed = false;
  const personal = typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn);
  const acceptedId = typeof PersonalSpace !== "undefined" && PersonalSpace.MY_ACCEPTED_ID;

  const isHidden = (ch) => {
    if (!ch) return true;
    if (typeof isDeviceCalendarChannel === "function" && isDeviceCalendarChannel(ch, conn)) return true;
    if (personal && acceptedId && ch.id === acceptedId) return true;
    if (typeof PersonalSpace !== "undefined" && PersonalSpace.isHiddenChannel(ch, conn)) return true;
    return false;
  };

  const makeBoardFrom = (ch) => {
    const board = {
      id: genBoardId(),
      name: String(ch.name || "Board").trim().slice(0, 32) || "Board",
      icon: ch.icon || null,
      shownKind: typeof normalizeBoardShownKind === "function"
        ? normalizeBoardShownKind(ch.kind)
        : "event",
      allowedUserIds: copyAllowList(ch.allowedUserIds),
      autoIncludeNewMembers: !!(ch.autoIncludeNewMembers && Array.isArray(ch.allowedUserIds)),
      rolePerms: ch.rolePerms || null,
    };
    conn.boards.push(board);
    return board;
  };

  const addChild = (board, kind, extra) => {
    const ch = {
      id: extra?.id || genBoardId(),
      name: board.name,
      kind,
      allowedUserIds: copyAllowList(board.allowedUserIds),
      autoIncludeNewMembers: !!board.autoIncludeNewMembers,
      rolePerms: board.rolePerms || null,
      boardId: board.id,
      linkedChatChannelId: extra?.linkedChatChannelId || null,
      mirrorActivity: false,
    };
    conn.channels.push(ch);
    return ch;
  };

  for (const board of conn.boards.slice()) {
    let events = conn.channels.filter(c => c.boardId === board.id && c.kind === "event" && !isPinnedChannel(c));
    let chats = conn.channels.filter(c => c.boardId === board.id && c.kind === "chat" && !isWelcomeLobby(c));
    let tasks = conn.channels.filter(c => c.boardId === board.id && c.kind === "task");
    events.slice(1).forEach(c => { c.boardId = null; changed = true; });
    chats.slice(1).forEach(c => { c.boardId = null; changed = true; });
    tasks.slice(1).forEach(c => { c.boardId = null; changed = true; });
    events = events.slice(0, 1);
    chats = chats.slice(0, 1);
    tasks = tasks.slice(0, 1);
    if (!events.length) {
      events = [addChild(board, "event")];
      changed = true;
    }
    if (!chats.length) {
      chats = [addChild(board, "chat")];
      changed = true;
    }
    if (!tasks.length) {
      tasks = [addChild(board, "task")];
      changed = true;
    }
    const ev = events[0];
    const chat = chats[0];
    if (ev.linkedChatChannelId !== chat.id) {
      ev.linkedChatChannelId = chat.id;
      changed = true;
    }
    applyBoardVisibility(conn, board);
  }

  for (const ev of conn.channels.slice()) {
    if (ev.kind !== "event" || ev.boardId || isPinnedChannel(ev) || isHidden(ev)) continue;
    const chat = ev.linkedChatChannelId
      && conn.channels.find(c => c.id === ev.linkedChatChannelId && c.kind === "chat"
        && !c.boardId && !isWelcomeLobby(c));
    if (!chat) continue;
    const board = makeBoardFrom(ev);
    ev.boardId = board.id;
    chat.boardId = board.id;
    addChild(board, "task");
    applyBoardVisibility(conn, board);
    changed = true;
  }

  for (const ev of conn.channels.slice()) {
    if (ev.kind !== "event" || ev.boardId || isPinnedChannel(ev) || isHidden(ev)) continue;
    const board = makeBoardFrom(ev);
    ev.boardId = board.id;
    addChild(board, "chat");
    addChild(board, "task");
    applyBoardVisibility(conn, board);
    changed = true;
  }

  for (const chat of conn.channels.slice()) {
    if (chat.kind !== "chat" || chat.boardId || isWelcomeLobby(chat) || isHidden(chat)) continue;
    const board = makeBoardFrom(chat);
    chat.boardId = board.id;
    addChild(board, "event", { linkedChatChannelId: chat.id });
    addChild(board, "task");
    applyBoardVisibility(conn, board);
    changed = true;
  }

  for (const task of conn.channels.slice()) {
    if (task.kind !== "task" || task.boardId || isHidden(task)) continue;
    const board = makeBoardFrom(task);
    task.boardId = board.id;
    const chat = addChild(board, "chat");
    addChild(board, "event", { linkedChatChannelId: chat.id });
    applyBoardVisibility(conn, board);
    changed = true;
  }

  const live = new Set(conn.channels.map(c => c.boardId).filter(Boolean));
  const before = conn.boards.length;
  conn.boards = conn.boards.filter(b => live.has(b.id) || !!(b.sourceConnId && b.sourceBoardId));
  if (conn.boards.length !== before) changed = true;
  return changed;
}

/** True when every linked agenda is a manual people list (hosted chat only). */
function chatMirrorsPrivateOnly(ch, conn = activeConn()) {
  const agendas = agendasLinkedToChat(ch, conn);
  return !!agendas.length && agendas.every(channelIsManualPrivate);
}

/** Union of linked-agenda view flags — does not write onto the chat. */
function mergeAgendaViewRolePerms(agendas, conn = activeConn()) {
  const out = {};
  for (const a of agendas || []) {
    const perms = (a.rolePerms && typeof a.rolePerms === "object" && Object.keys(a.rolePerms).length)
      ? a.rolePerms
      : (typeof ensureChannelRolePerms === "function" ? ensureChannelRolePerms(a, conn) : null);
    if (!perms) continue;
    for (const [key, flags] of Object.entries(perms)) {
      if (!out[key]) {
        out[key] = typeof emptyRolePermFlags === "function"
          ? { ...emptyRolePermFlags(), view: false }
          : { view: false };
      }
      if (flags?.view) out[key].view = true;
    }
  }
  return out;
}

function chatFollowsAgendasSummaryText(ch, conn = activeConn()) {
  const linked = agendasLinkedToChat(ch, conn);
  if (!linked.length) return "";
  const names = linked.map(a => a.name || "Agenda").join(", ");
  return `Follows linked agenda${linked.length === 1 ? "" : "s"}: ${names}`;
}

/** Missing moderator.view is true unless this is an Admins-only board. */
function moderatorViewDefault(ch, perms, conn = activeConn()) {
  const map = perms && typeof perms === "object" ? perms : {};
  if (map[ROLE_MODERATOR] && Object.prototype.hasOwnProperty.call(map[ROLE_MODERATOR], "view")) {
    return !!map[ROLE_MODERATOR].view;
  }
  const min = typeof normalizeChannelMinRole === "function"
    ? normalizeChannelMinRole(ch?.minRole)
    : null;
  if (min === ROLE_ADMIN) return false;
  const keys = Object.keys(map);
  if (!keys.length) return true;
  if (map[ROLE_USER]?.view || map[ROLE_VIEWER]?.view) return true;
  const custom = typeof customRolesOf === "function" ? customRolesOf(conn) : [];
  if (custom.some(r => map[r.id]?.view)) return true;
  if (keys.some(k => k !== ROLE_ADMIN && k !== ROLE_MODERATOR && k !== ROLE_USER && k !== ROLE_VIEWER && map[k]?.view)) {
    return true;
  }
  if (min === ROLE_MODERATOR) return true;
  return false;
}


/** Host and admin — locked onto private people-lists. Moderators follow visibility. */
function isAlwaysChannelViewer(user) {
  if (!user) return false;
  if (user.isHost) return true;
  const r = effectiveRole(user);
  return r === ROLE_HOST || r === ROLE_ADMIN;
}

function ladderActionKey(role) {
  if (role === ROLE_HOST || role === ROLE_ADMIN || role === ROLE_MODERATOR) return ROLE_MODERATOR;
  if (role === ROLE_VIEWER) return ROLE_VIEWER;
  return ROLE_USER;
}

/**
 * Action flags from server matrix; view from channel visibility.
 * Host/Admin see all. Moderators get elevated actions only after view is granted.
 */
function effectiveChannelFlags(user, channel, conn = activeConn()) {
  const server = ensureServerEventRolePerms(conn) || {};
  const primary = effectiveRole(user);
  const tags = Array.isArray(user?.roleTagIds) ? user.roleTagIds : [];
  let flags = emptyRolePermFlags();

  if (primary === ROLE_HOST || primary === ROLE_ADMIN) {
    flags = { ...allRolePermFlags(), createEventTypes: true, addLocations: true };
    flags.view = true;
    return flags;
  }

  const createSources = [];
  if (primary === ROLE_MODERATOR) {
    flags = moderatorActionFlags();
    createSources.push({ create: true, requireApproval: false });
  } else {
    const primaryKey = ladderActionKey(primary);
    if (server[primaryKey]) {
      flags = orRolePermFlags(flags, server[primaryKey]);
      createSources.push(server[primaryKey]);
    }
  }
  for (const tagId of tags) {
    if (server[tagId]) {
      flags = orRolePermFlags(flags, server[tagId]);
      createSources.push(server[tagId]);
    }
  }

  const creating = createSources.filter(s => s.create);
  if (primary === ROLE_MODERATOR) flags.requireApproval = false;
  else if (creating.length) flags.requireApproval = creating.every(s => !!s.requireApproval);
  else flags.requireApproval = false;

  const linkedAgendas = typeof agendasLinkedToChat === "function"
    ? agendasLinkedToChat(channel, conn) : [];
  if (channel?.kind === "chat" && linkedAgendas.length) {
    flags.view = linkedAgendas.some(a => channelVisibleTo(a, user, conn));
    return flags;
  }

  const hadVis = !!(channel?.rolePerms && Object.keys(channel.rolePerms).length);
  const vis = ensureChannelRolePerms(channel, conn) || {};
  const viewKey = primary === ROLE_MODERATOR ? ROLE_MODERATOR : ladderActionKey(primary);
  let canView = false;
  if (!hadVis) {
    canView = primary === ROLE_MODERATOR
      ? moderatorViewDefault(channel, vis, conn)
      : !!flags.view;
  } else {
    if (viewKey === ROLE_MODERATOR && vis[ROLE_MODERATOR] == null) {
      canView = moderatorViewDefault(channel, vis, conn);
    } else if (vis[viewKey]?.view) {
      canView = true;
    }
    for (const tagId of tags) {
      if (vis[tagId]?.view) canView = true;
    }
  }
  flags.view = channelIsManualPrivate(channel, conn)
    ? userOnChannelAllowList(channel, user)
    : canView;
  return flags;
}

/** Channel matrix flag (host always views). Legacy chat without rolePerms uses minRole. */
function canChannelPerm(userOrConn, channel, flag, connArg) {
  let user, conn;
  if (userOrConn && userOrConn.me) {
    conn = userOrConn;
    user = conn.me;
  } else {
    user = userOrConn;
    conn = connArg || activeConn();
  }
  if (!conn || PersonalSpace.isPersonal(conn)) return true;
  if (!channel) return false;
  const linkedAgendas = typeof agendasLinkedToChat === "function"
    ? agendasLinkedToChat(channel, conn) : [];
  if (channel.kind === "chat" && linkedAgendas.length) {
    const anyView = linkedAgendas.some(a => canChannelPerm(user, a, "view", conn));
    if (flag === "view") return anyView;
    if (!anyView) return false;
    return canMutateContent(conn);
  }
  if (flag === "view" && isAlwaysChannelViewer(user)) return true;
  if (flag !== "view" && canManageServer(conn) && user?.id === conn.me?.id) return true;
  const usesMatrix = channel.kind === "event" || channel.kind === "task"
    || (channel.rolePerms && typeof channel.rolePerms === "object" && Object.keys(channel.rolePerms).length);
  if (!usesMatrix) {
    if (!channelVisibleTo(channel, user, conn)) return false;
    return flag === "view" ? true : canMutateContent(conn);
  }
  const flags = effectiveChannelFlags(user, channel, conn);
  if (!flags.view) return false;
  const allowed = channel.allowedUserIds;
  // Private allow-list: staff still see; others must be listed.
  if (Array.isArray(allowed) && !allowed.includes(user?.id) && !isAlwaysChannelViewer(user)) return false;
  if (flag === "view") return true;
  if (channel.kind !== "event") return canMutateContent(conn);
  return !!flags[flag];
}

/** Manual private list gate — staff still see (same as canChannelPerm). */
function userOnChannelAllowList(channel, user) {
  const allowed = channel?.allowedUserIds;
  if (!Array.isArray(allowed)) return true;
  if (allowed.includes(user?.id)) return true;
  return typeof isAlwaysChannelViewer === "function" && isAlwaysChannelViewer(user);
}

function channelVisibleTo(channel, user, conn = activeConn()) {
  if (!channel) return false;
  if (!conn || PersonalSpace.isPersonal(conn)) return true;
  if (isAlwaysChannelViewer(user)) return true;
  const board = typeof boardForChannel === "function" ? boardForChannel(channel, conn) : null;
  if (board) {
    const visCh = { ...channel, allowedUserIds: board.allowedUserIds, autoIncludeNewMembers: board.autoIncludeNewMembers, rolePerms: board.rolePerms };
    if (channelIsManualPrivate(visCh, conn) && !userOnChannelAllowList(visCh, user)) return false;
    return canChannelPerm(user, visCh, "view", conn);
  }
  const linkedAgendas = typeof agendasLinkedToChat === "function"
    ? agendasLinkedToChat(channel, conn) : [];
  if (channel.kind === "chat" && linkedAgendas.length) {
    return linkedAgendas.some(a => channelVisibleTo(a, user, conn));
  }
  if (channelIsManualPrivate(channel, conn) && !userOnChannelAllowList(channel, user)) {
    return false;
  }
  const usesMatrix = channel.kind === "event" || channel.kind === "task"
    || (channel.rolePerms && typeof channel.rolePerms === "object" && Object.keys(channel.rolePerms).length);
  if (usesMatrix) return canChannelPerm(user, channel, "view", conn);
  const floor = normalizeChannelMinRole(channel.minRole) || ROLE_VIEWER;
  if (roleRank(effectiveRole(user)) < roleRank(floor)) return false;
  const allowed = channel.allowedUserIds;
  return !Array.isArray(allowed) || allowed.includes(user?.id);
}

function resolveEventChannel(conn = activeConn(), channelOrId = null) {
  if (!conn) return null;
  if (channelOrId && typeof channelOrId === "object") return channelOrId.kind === "event" ? channelOrId : null;
  if (typeof channelOrId === "string") {
    return (conn.channels || []).find(c => c.id === channelOrId && c.kind === "event") || null;
  }
  if (typeof activeEventChannel === "function") {
    const active = activeEventChannel();
    if (active) return active;
  }
  const id = S.activeEventChannelId;
  if (id) return (conn.channels || []).find(c => c.id === id && c.kind === "event") || null;
  const events = (conn.channels || []).filter(c =>
    c.kind === "event"
    && !(typeof PersonalSpace !== "undefined" && PersonalSpace.isHiddenChannel(c, conn)));
  return events.length === 1 ? events[0] : null;
}

function effectiveRole(user = S.me) {
  if (!user) return ROLE_USER;
  if (user.isHost || user.role === ROLE_HOST) return ROLE_HOST;
  const r = String(user.role || ROLE_USER).toLowerCase();
  return [ROLE_ADMIN, ROLE_MODERATOR, ROLE_USER, ROLE_VIEWER].includes(r) ? r : ROLE_USER;
}

function roleLabel(role) {
  return ({ host: "Host", admin: "Admin", moderator: "Moderator", user: "Member", viewer: "Viewer" })[role] || "Member";
}

/** Short People/Roles line: grants, not per-channel view. */
function roleAccessSummary(user, conn = activeConn()) {
  const r = effectiveRole(user);
  if (r === ROLE_HOST || r === ROLE_ADMIN) {
    return "Sees all channels · Manages server · Edit anyone’s content";
  }
  if (r === ROLE_MODERATOR) {
    return "Edit others’ content where they have access · Approve · Visibility set per channel";
  }
  const server = typeof ensureServerEventRolePerms === "function"
    ? ensureServerEventRolePerms(conn) : (conn?.eventRolePerms || {});
  let flags = emptyRolePermFlags();
  const primaryKey = r === ROLE_VIEWER ? ROLE_VIEWER : ROLE_USER;
  if (server[primaryKey]) flags = orRolePermFlags(flags, server[primaryKey]);
  const createSources = server[primaryKey] ? [server[primaryKey]] : [];
  for (const tagId of (user?.roleTagIds || [])) {
    if (server[tagId]) {
      flags = orRolePermFlags(flags, server[tagId]);
      createSources.push(server[tagId]);
    }
  }
  const creating = createSources.filter(s => s.create);
  const needsApproval = creating.length ? creating.every(s => !!s.requireApproval) : false;
  const parts = [];
  if (flags.view) parts.push("View");
  if (flags.create) parts.push(needsApproval ? "Create (needs approval)" : "Create");
  if (flags.create) parts.push("Edit own");
  if (flags.canApprove) parts.push("Approve");
  if (flags.createEventTypes) parts.push("Create event types");
  return parts.join(" · ") || "No extra access";
}

/** Channel visibility floor: null = everyone (viewers included). */
function normalizeChannelMinRole(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (!v || v === "viewer" || v === "everyone") return null;
  if (v === "user" || v === "member") return ROLE_USER;
  if (v === "moderator" || v === "mod") return ROLE_MODERATOR;
  if (v === "admin") return ROLE_ADMIN;
  return null;
}

function channelMinRoleTitle(minRole) {
  const floor = normalizeChannelMinRole(minRole);
  if (floor === ROLE_ADMIN) return "Admins only";
  if (floor === ROLE_MODERATOR) return "Moderators and above";
  if (floor === ROLE_USER) return "Members and above";
  return "Everyone (including viewers)";
}


function roleRank(role) {
  const r = String(role || ROLE_USER).toLowerCase();
  if (r === ROLE_VIEWER) return 0;
  if (r === ROLE_USER) return 1;
  if (r === ROLE_MODERATOR) return 2;
  if (r === ROLE_ADMIN) return 3;
  if (r === ROLE_HOST) return 4;
  return 1;
}

/** Members visible in a channel: allow-list ∩ roster, or role matrix / legacy floor when open. */
function channelMemberList(ch, conn = activeConn()) {
  const members = [...(conn?.members || S.members || [])];
  if (!ch) return [];
  const list = members.filter(m => channelVisibleTo(ch, m, conn));
  const order = { host: 0, admin: 1, moderator: 2, user: 3, viewer: 4 };
  return list.sort((a, b) => {
    const ra = effectiveRole(a), rb = effectiveRole(b);
    if ((order[ra] ?? 9) !== (order[rb] ?? 9)) return (order[ra] ?? 9) - (order[rb] ?? 9);
    return (a.name || "").localeCompare(b.name || "");
  });
}

/**
 * Camera profile photos on this server: off | online | always.
 * Prefer liveProfilePhotos; map legacy allowProfilePics (true/missing → online).
 */
function normalizeLiveProfilePhotos(ss = {}) {
  const raw = String(ss.liveProfilePhotos || "").trim().toLowerCase();
  if (raw === "off" || raw === "online" || raw === "always") return raw;
  if (ss.allowProfilePics === false) return "off";
  return "online";
}

function serverSettings(conn = activeConn()) {
  const ss = conn?.serverSettings || {};
  const liveProfilePhotos = normalizeLiveProfilePhotos(ss);
  return {
    allowUserCreateEvents: ss.allowUserCreateEvents !== false,
    createEvents: normalizeCreateEvents(ss.createEvents, ss.allowUserCreateEvents !== false),
    createEventTypes: normalizeMemberPerm(ss.createEventTypes, "moderator"),
    addLocations: normalizeMemberPerm(ss.addLocations, "moderator"),
    // Invite is admin-only for now (selector removed from Setup).
    inviteToGroup: "admin",
    liveProfilePhotos,
    allowProfilePics: liveProfilePhotos !== "off",
    allowUserDraw: ss.allowUserDraw !== false,
    cardTheme: ss.cardTheme || "classic",
    forceJoinCode: !!ss.forceJoinCode,
    codeChallenge: Math.max(0, Number(ss.codeChallenge) || 0),
    defaultRole: ss.defaultRole || ROLE_USER,
    minAge: clampServerMinAge(ss.minAge),
    purgeEndedEvents: !!ss.purgeEndedEvents,
    chatRetentionDays: clampChatRetentionDays(ss.chatRetentionDays),
    allowFreeform: ss.allowFreeform !== false,
    // Clubs: one event may use several places at once (e.g. Court 1 + Court 3).
    allowMultiLocations: !!ss.allowMultiLocations,
    // § pinned people — opt-in aggregation boards for a member's visible calendar.
    allowPinnedPeople: !!ss.allowPinnedPeople,
    // Creator-set blurb shown on the Server info page.
    description: String(ss.description || ""),
    // § approvals — server-wide fallback; a channel's own toggle can also opt in.
    eventsRequireApprovalDefault: !!ss.eventsRequireApprovalDefault,
    // App-developer kill switch (server-reported, not host-editable) — see DEMO_USERS_FEATURE_ENABLED.
    demoUsersEnabled: !!ss.demoUsersEnabled,
  };
}

/** §3 permission scopes: everyone (= members+) | moderator | admin. Viewers never. */
function normalizeMemberPerm(raw, fallback = "moderator") {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "user" || v === "member") return "everyone"; // members and above
  return (v === "everyone" || v === "moderator" || v === "admin") ? v : fallback;
}

/** Create-events scope; migrates legacy boolean allowUserCreateEvents. */
function normalizeCreateEvents(raw, allowUserFallback = true) {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "user" || v === "member") return "everyone";
  if (v === "everyone" || v === "moderator" || v === "admin") return v;
  return allowUserFallback ? "everyone" : "moderator";
}

function memberPermLabel(level) {
  const v = normalizeMemberPerm(level, "admin");
  if (v === "everyone") return "Members and above";
  if (v === "moderator") return "Moderators and above";
  return "Admin only";
}

function meetsMemberPerm(level, conn = activeConn()) {
  if (!conn || PersonalSpace.isPersonal(conn)) return true;
  const r = effectiveRole(conn.me);
  if (r === ROLE_VIEWER) return false;
  const perm = normalizeMemberPerm(level, "admin");
  if (perm === "everyone") return r === ROLE_USER || canModerateEvents(conn);
  if (perm === "moderator") return canModerateEvents(conn);
  return canManageServer(conn);
}

function clampChatRetentionDays(raw) {
  const n = Number(raw);
  if (n === 1 || n === 7 || n === 30 || n === 90) return n;
  return 0;
}

function clampServerMinAge(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 18) return 18;
  if (n > 99) return 99;
  return Math.floor(n);
}

/** Public HTTPS edge Worker: cookies when allowed; X-Phlip-Invite when WebView blocks them. */
const EDGE_INVITE_BY_HOST = new Map(); // hostname → invite gate token

function rememberEdgeInvite(httpBase, token) {
  const tok = String(token || "").trim();
  if (!tok) return;
  try {
    const host = new URL(String(httpBase || "").replace(/\/+$/, "")).hostname.toLowerCase();
    if (host) EDGE_INVITE_BY_HOST.set(host, tok);
  } catch { /* ignore */ }
}

function clearEdgeInvite(httpBaseOrUrl) {
  try {
    const host = new URL(String(httpBaseOrUrl || "").replace(/\/+$/, "")).hostname.toLowerCase();
    if (host) EDGE_INVITE_BY_HOST.delete(host);
  } catch { /* ignore */ }
}

function edgeInviteForUrl(url) {
  try {
    return EDGE_INVITE_BY_HOST.get(new URL(String(url)).hostname.toLowerCase()) || "";
  } catch {
    return "";
  }
}

function serverFetch(url, init = {}) {
  if (typeof isDemoMode === "function" && isDemoMode()) {
    return Promise.reject(new Error("demo-offline"));
  }
  const opts = { cache: "no-store", mode: "cors", ...init };
  if (/^https:/i.test(String(url))) {
    if (!opts.credentials) opts.credentials = "include";
    const headers = new Headers(opts.headers || {});
    // Approved sessions: member bearer wins — do not keep sending invite gate.
    if (!headers.has("X-Ash-Token")) {
      const tok = edgeInviteForUrl(url);
      if (tok && !headers.has("X-Phlip-Invite")) headers.set("X-Phlip-Invite", tok);
    } else {
      headers.delete("X-Phlip-Invite");
    }
    opts.headers = headers;
  }
  return fetch(url, opts);
}

function extractMapUrlString(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const m = text.match(/https?:\/\/[^\s<>"]+/i) || text.match(/\bgeo:[^\s<>"]+/i);
  return m ? m[0].replace(/[),.;]+$/g, "") : "";
}

function isMapHostName(host, path) {
  host = String(host || "").replace(/^www\./i, "").toLowerCase();
  path = String(path || "").toLowerCase();
  if (host === "maps.app.goo.gl") return true;
  if (host === "goo.gl" && path.startsWith("/maps")) return true;
  if (host === "maps.google.com" || /^maps\.google\./.test(host)) return true;
  if ((host === "google.com" || /^google\./.test(host)) && path.includes("/maps")) return true;
  if (host === "maps.apple.com") return true;
  if (host === "openstreetmap.org" || host === "osm.org" || host.endsWith(".openstreetmap.org")) return true;
  return false;
}

function mapQueryIsCoords(q) {
  return /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(String(q || "").trim());
}

function decodeMapPlaceName(seg) {
  let s = String(seg || "");
  try { s = decodeURIComponent(s.replace(/\+/g, " ")); } catch {
    s = s.replace(/[+_]/g, " ");
  }
  s = s.replace(/\/data=!.*$/i, "").split("@")[0];
  s = s.replace(/,/g, ", ").replace(/\s+/g, " ").trim();
  if (!s || mapQueryIsCoords(s) || /^-?\d+(\.\d+)?$/.test(s)) return "";
  if (/^[2-9C-HJ-NP-Z]{4,8}\+[2-9C-HJ-NP-Z]{2,3}$/i.test(s.replace(/\s+/g, ""))) return "";
  if (/^ChIJ[A-Za-z0-9_-]+$/.test(s) || /^0x[0-9a-f]+(:0x[0-9a-f]+)?$/i.test(s)) return "";
  if (/^\d+°/.test(s) || s.length > 180) {
    const head = s.split(",")[0].trim();
    if (!head || head.length > 80 || head === s) return "";
    s = head;
  }
  if (/^(current location|your location|my location|untitled)$/i.test(s)) return "";
  return s;
}

function nameFromMapQuery(q) {
  const raw = String(q || "").trim();
  if (!raw) return "";
  const paren = raw.match(/\(([^)]+)\)\s*$/);
  if (paren) return decodeMapPlaceName(paren[1]);
  if (mapQueryIsCoords(raw)) return "";
  return decodeMapPlaceName(raw);
}

function mapNameFromDataBlob(href) {
  const m = String(href || "").match(/!2s([^!]+)/);
  return m ? decodeMapPlaceName(m[1]) : "";
}

function extractMapCoords(href) {
  const s = String(href || "");
  let m = s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
  m = s.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
  m = s.match(/[?&](?:ll|center|sll)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
  m = s.match(/[?&](?:q|query)=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:&|$)/i);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
  m = s.match(/^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
  return null;
}

function isMapShortLink(href) {
  try {
    const u = new URL(extractMapUrlString(href) || href);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    const path = u.pathname.toLowerCase();
    return host === "maps.app.goo.gl" || (host === "goo.gl" && path.startsWith("/maps"));
  } catch {
    return false;
  }
}

function parseMapLink(raw) {
  const href = extractMapUrlString(raw);
  if (!href) return null;
  if (/^geo:/i.test(href)) {
    const q = href.match(/[?&]q=([^&]+)/i);
    return { href, name: q ? nameFromMapQuery(q[1]) : "", coords: extractMapCoords(href) };
  }
  try {
    const u = new URL(href);
    if (!isMapHostName(u.hostname, u.pathname)) return null;
    const q = u.searchParams.get("q")
      || u.searchParams.get("query")
      || u.searchParams.get("destination")
      || u.searchParams.get("daddr")
      || u.searchParams.get("address")
      || u.searchParams.get("origin")
      || u.searchParams.get("saddr")
      || "";
    const place = u.pathname.match(/\/(?:maps\/)?place\/([^/]+)/i);
    const search = u.pathname.match(/\/maps\/search\/([^/]+)/i);
    let name = "";
    if (place) name = decodeMapPlaceName(place[1]);
    if (!name && search) name = decodeMapPlaceName(search[1]);
    if (!name && q) name = nameFromMapQuery(q);
    if (!name) name = nameFromMapQuery(u.searchParams.get("name") || "");
    if (!name) {
      const dir = u.pathname.match(/\/maps\/dir\/(.+)$/i);
      if (dir) {
        const parts = dir[1].split("/").map(decodeMapPlaceName).filter(Boolean);
        name = parts[parts.length - 1] || "";
      }
    }
    if (!name) name = mapNameFromDataBlob(href + (u.hash || ""));
    return { href, name, coords: extractMapCoords(href) };
  } catch {
    return null;
  }
}

function nativeMapExpansion(href) {
  if (typeof AshNative === "undefined" || typeof AshNative.expandMapLink !== "function") return null;
  try {
    const raw = String(AshNative.expandMapLink(href) || "").trim();
    if (!raw) return null;
    const info = JSON.parse(raw);
    let name = String(info.name || "").replace(/\s+/g, " ").trim();
    name = name.replace(/\s*[|·–—-]\s*Google Maps.*$/i, "").trim();
    if (/^google maps$/i.test(name)) name = "";
    return { url: String(info.url || "").trim(), name };
  } catch { return null; }
}

async function expandMapShortUrl(href) {
  const url = extractMapUrlString(href) || String(href || "").trim();
  if (!url || !isMapShortLink(url)) return "";
  const tryFetch = async (mode) => {
    const res = await fetch(url, { method: "GET", redirect: "follow", mode, cache: "no-store" });
    const finalUrl = String(res.url || "").trim();
    if (finalUrl && finalUrl !== url && parseMapLink(finalUrl)) return finalUrl;
    return "";
  };
  try {
    const cors = await tryFetch("cors");
    if (cors) return cors;
  } catch { /* CORS on Google short links is expected in browsers */ }
  try {
    const opaque = await tryFetch("no-cors");
    if (opaque) return opaque;
  } catch { /* ignore */ }
  return "";
}

async function reverseGeocodeMapName(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  const ctrl = typeof AbortSignal !== "undefined" && AbortSignal.timeout
    ? AbortSignal.timeout(5000)
    : undefined;
  const url = `https://photon.komoot.io/reverse?lon=${encodeURIComponent(lng)}&lat=${encodeURIComponent(lat)}&limit=1&lang=en`;
  const res = await fetch(url, { signal: ctrl, cache: "no-store" });
  if (!res.ok) return "";
  const data = await res.json();
  const props = data && data.features && data.features[0] && data.features[0].properties;
  if (!props) return "";
  const name = String(props.name || "").trim();
  if (name) return name;
  const street = [props.housenumber, props.street].filter(Boolean).join(" ").trim();
  if (street) return street;
  return String(props.locality || props.city || props.town || props.village || "").trim();
}

async function resolveMapLink(raw) {
  const parsed = parseMapLink(raw);
  if (!parsed) return null;
  let href = parsed.href;
  let name = parsed.name || "";
  let coords = parsed.coords || extractMapCoords(href);
  if (!name && isMapShortLink(href)) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const native = nativeMapExpansion(href);
    const expanded = (native?.url && parseMapLink(native.url) ? native.url : "") || await expandMapShortUrl(href);
    if (expanded) {
      const next = parseMapLink(expanded);
      if (next) {
        name = next.name || native?.name || "";
        coords = next.coords || coords;
      } else if (native?.name) name = native.name;
    } else if (native?.name) name = native.name;
  }
  if (!name && coords) {
    try { name = await reverseGeocodeMapName(coords.lat, coords.lng); } catch { name = ""; }
  }
  return { href, name, coords };
}


function isReservedMapDetailsField(label, value) {
  return /^map$/i.test(String(label || "").trim()) && !!parseMapLink(value);
}

function eventDetailsPlain(ev) {
  if (!ev) return "";
  return String(typeof shown === "function"
    ? shown(ev._details || "")
    : (ev._details || ""));
}

function splitEventMapDetails(raw) {
  const text = String(raw || "").replace(/\r\n/g, "\n");
  if (!text.trim()) return { mapUrl: "", rest: "" };
  const rest = [];
  let mapUrl = "";
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const match = trimmed.match(/^(?:\*\*)?(Map)(?:\*\*)?:\s+(.+)$/i);
    const value = match ? match[2].trim() : "";
    const parsed = match ? parseMapLink(value) : null;
    if (parsed) {
      mapUrl = parsed.href;
      continue;
    }
    rest.push(line);
  }
  return { mapUrl, rest: rest.join("\n").replace(/^\n+|\n+$/g, "").trim() };
}

function mergeEventMapDetails(raw, mapUrl) {
  const split = splitEventMapDetails(raw);
  const href = (parseMapLink(mapUrl)?.href || String(mapUrl || "").trim());
  const rest = split.rest;
  if (!href) return rest;
  return rest ? `${rest}\n\nMap: ${href}` : `Map: ${href}`;
}

function eventDetailsNotes(evOrRaw) {
  const raw = evOrRaw && typeof evOrRaw === "object"
    ? eventDetailsPlain(evOrRaw)
    : String(evOrRaw || "");
  return splitEventMapDetails(raw).rest;
}

function eventMapUrl(ev) {
  return splitEventMapDetails(eventDetailsPlain(ev)).mapUrl;
}

function mapUrlForKnownPlace(label, conn) {
  const clean = String(label || "").trim();
  if (!clean) return "";
  const list = typeof locationsFor === "function"
    ? locationsFor(conn || (typeof activeConn === "function" ? activeConn() : null))
    : [];
  const hit = (list || []).find(l => String(l.label || "").toLowerCase() === clean.toLowerCase());
  return String(hit?.mapUrl || "").trim();
}

async function applyEventMapUrl(ev, href, nameHint) {
  if (!ev) return false;
  const parsed = parseMapLink(href);
  const url = parsed?.href || "";
  if (!url) return false;
  const conn = (typeof ownerConnOf === "function" ? ownerConnOf(ev.id) : null)
    || (typeof ownerConnFor === "function" ? ownerConnFor(ev) : null)
    || (typeof activeConn === "function" ? activeConn() : null);
  if (!conn) return false;
  const next = mergeEventMapDetails(eventDetailsPlain(ev), url);
  const cipher = next && typeof encrypt === "function" ? await encrypt(next, conn.key) : (next || "");
  if (typeof send === "function") send({ type: "setEventDetails", eventId: ev.id, details: cipher }, conn.id);
  ev.details = cipher;
  ev._details = next;
  const place = typeof timelineEventPlace === "function" ? timelineEventPlace(ev) : "";
  let named = place || parsed.name || String(nameHint || "").trim();
  if (!place && !named && typeof resolveMapLink === "function") {
    try {
      const resolved = await resolveMapLink(href);
      if (resolved && resolved.name) named = resolved.name;
    } catch { /* keep empty */ }
  }
  if (!place && named) {
    const whereCipher = typeof encrypt === "function" ? await encrypt(named, conn.key) : named;
    if (typeof send === "function") {
      send({ type: "setEventWhere", eventId: ev.id, where: whereCipher }, conn.id);
    }
    ev.where = whereCipher;
    ev._where = named;
  }
  if (typeof rememberPlaceMapUrl === "function") {
    rememberPlaceMapUrl(place || named, url);
  }
  if (typeof toast === "function") toast("Map attached");
  return true;
}

/**
 * Unlock the Cloudflare edge gate before any origin proxy.
 * Public unlock uses a personal invite slug only (rotating join codes retired).
 * No-op for LAN / missing Worker.
 */
