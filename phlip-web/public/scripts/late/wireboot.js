/* --------------------------------- wire up ------------------------------- */

$("#channel-info-btn").innerHTML = ic("calendar-days");
$("#channel-info-btn").setAttribute("aria-label", "My calendar");
$("#channel-info-btn").title = "My calendar";
$("#channel-info-btn").onclick = () => {
  try {
    const app = document.getElementById("app");
    const panel = document.getElementById("channel-panel");
    const drawerOpen = Panel.channelOpen()
      || panel?.classList.contains("is-calendar-drawer")
      || app?.classList.contains("calendar-drawer-open");
    if (drawerOpen) {
      closeChannelPanel();
      return;
    }
    if (typeof openActiveEventOrChannelPanel === "function") openActiveEventOrChannelPanel();
    else if (typeof openChannelPanel === "function") openChannelPanel(activeChannelForPanel());
  } catch (err) {
    console.warn("open calendar panel", err);
  }
};
syncChannelInfoBtn();

$("#btn-back").onclick = () => {
  if (document.body.classList.contains("tl-creating")
      || (typeof createDraftPending === "function" && createDraftPending())) {
    if (typeof closeCreateDraft === "function") closeCreateDraft(true);
    openNav();
    return;
  }
  if (Panel.channelOpen()) closeChannelPanel();
  else if (Panel.navOpen()) closeNav();
  else if (typeof conversationsHandleBack === "function" && conversationsHandleBack()) return;
  else openNav();
};

// Capture-phase: close nav drawer / channel panel on outside taps and swallow
// the gesture so the board behind never receives the same press/click.
const DISMISS_SUPPRESS_MS = (typeof AshGesture !== "undefined" && AshGesture.OUTSIDE_TAP_MS) || 450;
const NAV_OUTSIDE_SAFE =
  ".sidebar, .rail, #btn-back, #channel-info-btn, .modal-backdrop, #channel-panel, #ob-spotlight, .ob-bubble, .ob-skip";
const CHANNEL_PANEL_OUTSIDE_SAFE =
  "#channel-panel, #channel-info-btn, #btn-back, .modal-backdrop, #ob-spotlight, .ob-bubble, .ob-skip";
const CHROME_PASSTHROUGH = ".rail";

function channelPanelOutsideSafeZone() {
  const app = document.getElementById("app");
  const panel = document.getElementById("channel-panel");
  const drawer = panel?.classList.contains("is-calendar-drawer")
    || app?.classList.contains("calendar-drawer-open");
  // Calendar drawer: the top-bar button toggles it. A press must reach that
  // button, or the following click sees a closed sheet and opens it again.
  if (drawer) return "#channel-panel, #channel-info-btn, #btn-back, .modal-backdrop, #ob-spotlight, .ob-bubble, .ob-skip";
  return CHANNEL_PANEL_OUTSIDE_SAFE;
}

function makeOutsideDismissHandler({ isOpen, getSuppressUntil, setSuppressUntil, safeZone, dismiss }) {
  const zoneNow = () => (typeof safeZone === "function" ? safeZone() : safeZone);
  return function dismissOutside(e) {
    const now = performance.now();
    const zone = zoneNow();
    // Close a covering drawer on the click, not the press. Closing on pointerdown
    // drops the rail back under the board before pointerup, so the click misses
    // the server button and a second tap is required. The rail is already part of
    // the open sidebar, so that sheet stays up — closing it slides the board over the nav.
    if (e.target.closest?.(CHROME_PASSTHROUGH)) {
      if (e.type === "click" && isOpen() && !e.target.closest?.(zone)) dismiss();
      return;
    }
    if (now < getSuppressUntil()) {
      // Ghost click after a pointerdown dismiss — keep it off the main view.
      if ((e.type === "click" || e.type === "pointerdown") && !e.target.closest?.(zone)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (!isOpen()) return;
    if (e.target.closest?.(zone)) return;
    setSuppressUntil(now + DISMISS_SUPPRESS_MS);
    dismiss();
    e.preventDefault();
    e.stopPropagation();
  };
}

const dismissNavOutside = makeOutsideDismissHandler({
  isOpen: () => Panel.navOpen(),
  getSuppressUntil: () => suppressNavDismissUntil,
  setSuppressUntil: (t) => { suppressNavDismissUntil = t; },
  safeZone: NAV_OUTSIDE_SAFE,
  dismiss: () => closeNav(),
});

const dismissChannelPanelOutside = makeOutsideDismissHandler({
  isOpen: () => Panel.channelOpen(),
  getSuppressUntil: () => suppressChannelPanelDismissUntil,
  setSuppressUntil: (t) => { suppressChannelPanelDismissUntil = t; },
  safeZone: channelPanelOutsideSafeZone,
  dismiss: () => closeChannelPanel(),
});

function dismissShellOutside(e) {
  // Panel first — matches #btn-back priority; openNav already closes panel.
  if (Panel.channelOpen()) dismissChannelPanelOutside(e);
  // Overlay: back arrow / LTR swipe / Back / Escape (INT-9) — not outside tap.
  else if (typeof Panel.sideOpen === "function" && Panel.sideOpen()) return;
  else if (Panel.navOpen()) dismissNavOutside(e);
}

document.addEventListener("pointerdown", dismissShellOutside, true);
document.addEventListener("click", dismissShellOutside, true);

try { attachNavDismissSwipe(); } catch {}
try { attachMainNavSheetSwipe(); } catch {}
try { attachChannelPanelDismissSwipe(); } catch {}

// The shared style guide is light-only. Keep these compatibility hooks because
// native shells and older served pages may still call them.

function applyCardTheme(theme) {
  const t = ["classic", "bold", "soft", "mono"].includes(theme) ? theme : "classic";
  const app = document.getElementById("app");
  if (app) app.dataset.cardTheme = t;
}

function applyTheme(t) {
  t = "light";
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("dp_theme", t); } catch {}
  try {
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", "#ffffff");
  } catch {}
  try { window.AshNative?.setUiTheme?.(t); } catch {}
  syncAppLogoIcons();
  // Day-ink / category rail tints follow light/dark — refresh timeline if open.
  if (typeof syncUiAccentFromDayTheme === "function") syncUiAccentFromDayTheme();
  if (typeof viewingEventsBoard === "function" && viewingEventsBoard()
      && typeof renderView === "function") {
    try { renderView(); } catch { /* ignore mid-boot */ }
  }
}
function initTheme() {
  applyTheme("light");
  applyCardTheme(serverSettings().cardTheme);
}
window.ashSetTheme = applyTheme;
window.ashToggleTheme = () => applyTheme("light");
initTheme();

// Device-local day-view hour window (inclusive start/end). Applies on every
// server’s Day zoom — events outside the window sit under "Anytime" at the top.
function dayHoursWindow() {
  try {
    const raw = JSON.parse(localStorage.getItem("dp_day_hours") || "null");
    const start = Number(raw?.start), end = Number(raw?.end);
    if (Number.isInteger(start) && Number.isInteger(end)
        && start >= 0 && end <= 23 && start <= end) {
      return { start, end };
    }
  } catch { /* ignore bad prefs */ }
  return { start: 7, end: 21 };
}
function saveDayHours(start, end) {
  const s = Math.max(0, Math.min(23, start | 0));
  const e = Math.max(s, Math.min(23, end | 0));
  localStorage.setItem("dp_day_hours", JSON.stringify({ start: s, end: e }));
  return { start: s, end: e };
}
function openDayHoursModal() {
  const cur = dayHoursWindow();
  const opts = Array.from({ length: 24 }, (_, h) =>
    `<option value="${h}">${fmtHour(h)}</option>`).join("");
  const opened = AshModal.open({
    className: "day-hours",
    html: `
    <div class="modal-card">
      <h4>Day hours</h4>
      <p class="modal-note">Hours shown in Day view on every server. Events outside this window still appear under Anytime at the top of the day.</p>
      <form id="day-hours-form">
        <div class="row">
          <div class="field"><label for="dh-start">From</label><select id="dh-start">${opts}</select></div>
          <div class="field"><label for="dh-end">To</label><select id="dh-end">${opts}</select></div>
        </div>
        <div class="actions">
          <button type="button" class="cancel" id="dh-reset">All day</button>
          <div>
            <button type="button" class="cancel" id="dh-cancel">Cancel</button>
            <button type="submit" class="save">Save</button>
          </div>
        </div>
      </form>
    </div>`,
    singleton: "return",
  });
  if (!opened) return;
  const { overlay, close } = opened;
  const startEl = overlay.querySelector("#dh-start");
  const endEl = overlay.querySelector("#dh-end");
  startEl.value = String(cur.start);
  endEl.value = String(cur.end);
  overlay.querySelector("#dh-cancel").onclick = close;
  overlay.querySelector("#dh-reset").onclick = () => {
    startEl.value = "0";
    endEl.value = "23";
  };
  overlay.querySelector("#day-hours-form").onsubmit = (e) => {
    e.preventDefault();
    let start = Number(startEl.value), end = Number(endEl.value);
    if (start > end) [start, end] = [end, start];
    saveDayHours(start, end);
    close();
  };
}
window.ashOpenDayHours = openDayHoursModal;

/* --------------------------------- boot ------------------------------------ */

// Served shell (isServedOrigin, join gate, etc.) lives in served.js.

// Deep links: invite fragment, personal /j/<slug>, or ?slug=.
function bootstrapFromUrl() {
  if (!isServedOrigin()) return;
  const params = new URLSearchParams(location.search);
  const eventId = params.get("event");
  if (eventId) {
    S.pendingEventId = eventId;
    try { sessionStorage.setItem("ash_pending_event", eventId); } catch {}
  }
  // Ignore legacy ?token=&pass= — membership requires invite + password + host approve.
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
  const hasInvite = hashParams.get("c") || hashParams.get("t");
  const slug = params.get("slug")
    || hashParams.get("slug")
    || (typeof extractInviteSlug === "function" ? extractInviteSlug(location.href) : "")
    || (location.pathname.match(/\/j\/([a-z0-9]+)/i) || [])[1]
    || "";
  if (hasInvite || slug) S.pendingInviteLink = location.href;
  if (eventId || hasInvite || slug || params.get("token")) {
    history.replaceState(null, "", location.pathname);
  }
}

// A shared event card's link opens the served host's page — resolved here
// once that conn's own welcome arrives with its groups populated. Not an
// Android App Link (see feature-planning/whatsapp-share.md): dynamic Cloudflare
// Tunnel domains can't be statically declared, so the link is a plain https
// URL that opens in a browser — a served host still serves the client for
// exactly this reason.
function consumePendingEventId(conn) {
  if (!S.pendingEventId) return;
  if (!(conn.events || []).some(e => e.id === S.pendingEventId)) return;
  const id = S.pendingEventId;
  S.pendingEventId = null;
  try { sessionStorage.removeItem("ash_pending_event"); } catch {}
  if (S.activeConnId !== conn.id) S.activeConnId = conn.id;
  Nav.openEventDetail(id);
  renderAll();
}

// An invite opened in a browser — prefill code/password; user still confirms name.
function consumePendingInviteLink() {
  if (!S.pendingInviteLink) return;
  const link = S.pendingInviteLink;
  S.pendingInviteLink = null;
  openJoinModal(link);
}

/**
 * Browser handoff after Worker /j/<slug> request approved (or immediate welcome).
 * Welcome JSON was stored in sessionStorage by the edge invite page.
 */
async function consumeEdgeWelcome() {
  let raw = "";
  try {
    raw = sessionStorage.getItem("ash_edge_welcome") || "";
    if (raw) sessionStorage.removeItem("ash_edge_welcome");
  } catch {
    return false;
  }
  if (!raw) return false;
  let welcome = null;
  try {
    welcome = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!welcome || welcome.type !== "welcome" || !welcome.token) return false;

  const httpBase = String(location.origin || "").replace(/\/+$/, "");
  if (!httpBase || !/^https?:/i.test(httpBase)) return false;

  try {
    if (welcome.inviteToken && typeof rememberEdgeInvite === "function") {
      rememberEdgeInvite(httpBase, welcome.inviteToken);
    }
  } catch {}

  const url = typeof normalizeServerUrl === "function"
    ? normalizeServerUrl(httpBase)
    : httpBase.replace(/^http/i, (m) => (m.toLowerCase() === "https" ? "wss" : "ws")) + "/ws";
  if (!url) return false;

  const joinTag = typeof normJoinTag === "function"
    ? normJoinTag(welcome.joinTag || "")
    : String(welcome.joinTag || "").replace(/[^a-z0-9]/gi, "").slice(0, 4);
  const id = typeof serverConnIdFrom === "function"
    ? await serverConnIdFrom(joinTag, url)
    : `srv-${joinTag || "edge"}`;

  let conn = S.conns[id];
  if (!conn || (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn))) {
    conn = makeConn({
      id,
      url,
      name: welcome.hostName || "",
      token: welcome.token,
      joinTag: joinTag || "",
    });
    S.conns[id] = conn;
  } else {
    try { stopHttpTransport?.(conn); } catch {}
    try { conn.ws?.close(); } catch {}
    conn.ws = null;
    conn.url = url;
    if (welcome.hostName) conn.name = welcome.hostName;
    if (joinTag) conn.joinTag = joinTag;
  }
  conn._joinHttpBase = httpBase;
  if (typeof syncConnDualUrls === "function") {
    syncConnDualUrls(conn, { joinBase: httpBase, joinTag });
  }
  if (welcome.setupNonce) conn._setupNonce = welcome.setupNonce;
  conn.pass = null;
  try {
    const pendingPw = sessionStorage.getItem("ash_edge_pending_pw") || "";
    if (pendingPw) {
      conn._pendingPassword = pendingPw;
      sessionStorage.removeItem("ash_edge_pending_pw");
    }
  } catch {}

  // Keep served gate locked until welcome auth finishes (password setup).
  if (typeof setServedGate === "function") setServedGate(true);
  handle(conn, welcome);
  S.activeConnId = id;
  connect(conn);
  let admitted = true;
  if (conn._welcomeAuth) {
    try {
      await conn._welcomeAuth;
    } catch (e) {
      console.warn("edge welcome auth", e);
      admitted = false;
    }
  }
  const hostishWelcome = !!(welcome.user?.isHost
    || welcome.user?.role === "host"
    || (typeof effectiveRole === "function" && effectiveRole(welcome.user) === ROLE_HOST));
  const couldFinishPw = !!(welcome.groupKeyOnce && (welcome.setupNonce || conn._setupNonce));
  if (welcome.needsPassword && couldFinishPw && !hostishWelcome && !conn.pass && !conn._passwordReady) {
    // Password setup failed or was cancelled — do not unlock the SPA.
    admitted = false;
  }
  if (!admitted) {
    try { stopHttpTransport?.(conn); } catch {}
    try { conn.ws?.close(); } catch {}
    conn.token = null;
    conn.status = "offline";
    delete S.conns[id];
    if (typeof setServedGate === "function") setServedGate(true);
    try { toast("Choose a password to finish joining this server."); } catch {}
    return false;
  }
  if (typeof setServedGate === "function") setServedGate(false);
  try { tryRestoreNav?.({ servedConnId: id }); } catch {}
  try { renderAll(); } catch {}
  return true;
}

/* -------- remember last channel across minimize / process death -------- */
const ASH_NAV_KEY = "ash_last_nav_v1";
const ASH_DEST_KEY = "ash_last_dest_v1";
let navRestoredThisBoot = false;
/** @type {Record<string, {kind?: string, id?: string|null, userId?: string|null}>|null} */
let _destCache = null;

function loadDestMap() {
  if (_destCache) return _destCache;
  try {
    const raw = JSON.parse(localStorage.getItem(ASH_DEST_KEY) || "{}");
    _destCache = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    _destCache = {};
  }
  return _destCache;
}

function saveDestMap() {
  try { localStorage.setItem(ASH_DEST_KEY, JSON.stringify(_destCache || {})); } catch {}
}

function persistLastDest(connId, view) {
  const id = String(connId || "");
  if (!id || !view?.kind) return;
  const map = loadDestMap();
  map[id] = { kind: view.kind, id: view.id || null, userId: view.userId || null };
  _destCache = map;
  saveDestMap();
}

function lastDestFor(connId) {
  const id = String(connId || "");
  if (!id) return null;
  const dest = loadDestMap()[id];
  return dest && typeof dest === "object" ? dest : null;
}

function rememberNav() {
  try {
    if (typeof shareIdFromPath === "function" && shareIdFromPath()) return;
    if (typeof isShareGuest === "function" && isShareGuest()) return;
  } catch {}
  // Projected channels are canonical remote destinations presented inside
  // Personal. Do not overwrite Personal's normal landing destination with a
  // channel that is not owned by the Personal connection.
  if (S.activeProjection) return;
  const payload = {
    connId: S.activeConnId || "personal",
    view: S.activeView ? { kind: S.activeView.kind, id: S.activeView.id || null, userId: S.activeView.userId || null } : { kind: "events" },
    eventChannelId: S.activeEventChannelId || null,
  };
  persistLastDest(payload.connId, payload.view);
  if (typeof isDemoMode === "function" && isDemoMode()) {
    try { DemoStore?.saveNav?.(payload); } catch {}
    return;
  }
  try {
    localStorage.setItem(ASH_NAV_KEY, JSON.stringify(payload));
  } catch {}
}

function loadSavedNav() {
  return loadJSON(ASH_NAV_KEY, null);
}

function validatedNavView(conn, view) {
  if (!conn || !view || !view.kind) return { kind: "events" };
  const kind = view.kind;
  if (kind === "channel") {
    const ch = (conn.channels || []).find(c => c.id === view.id);
    const hidden = !ch
      || (typeof PersonalSpace !== "undefined" && PersonalSpace.isHiddenChannel(ch, conn));
    const shown = !hidden && (
      (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn))
      || typeof channelVisibleTo !== "function"
      || channelVisibleTo(ch, conn.me, conn)
    );
    if (!shown) {
      return typeof defaultAgendaView === "function" ? defaultAgendaView(conn) : { kind: "events" };
    }
    return { kind: "channel", id: view.id };
  }
  if (kind === "eventDetail") {
    // The detail popup is archived; a saved detail view lands on the agenda.
    return typeof defaultAgendaView === "function" ? defaultAgendaView(conn) : { kind: "events" };
  }
  if (kind === "sharedHistory") {
    if (!view.userId) return { kind: "members" };
    return { kind: "sharedHistory", userId: view.userId };
  }
  if (kind === "live" && !PersonalSpace.isPersonal(conn)) {
    return typeof defaultAgendaView === "function" ? defaultAgendaView(conn) : { kind: "events" };
  }
  if (kind === "notifications") {
    if (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn)) {
      return { kind: "notifications" };
    }
    return typeof defaultAgendaView === "function" ? defaultAgendaView(conn) : { kind: "events" };
  }
  if (kind === "memories") {
    return { kind: "memories" };
  }
  if (kind === "hosting" || kind === "invited" || kind === "deck") {
    return typeof defaultAgendaView === "function" ? defaultAgendaView(conn) : { kind: "events" };
  }
  if (kind === "members") {
    if (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn)) {
      return typeof defaultAgendaView === "function" ? defaultAgendaView(conn) : { kind: "events" };
    }
    return { kind: "members" };
  }
  if (kind === "serverInfo") {
    if (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn)) {
      return typeof defaultAgendaView === "function" ? defaultAgendaView(conn) : { kind: "events" };
    }
    return { kind: "serverInfo" };
  }
  if (kind === "events") {
    return typeof defaultAgendaView === "function" ? defaultAgendaView(conn) : { kind };
  }
  if (kind === "live") {
    return { kind };
  }
  return typeof defaultAgendaView === "function" ? defaultAgendaView(conn) : { kind: "events" };
}

/** Apply saved nav once per cold start. Returns true when applied. */
function tryRestoreNav({ servedConnId = null } = {}) {
  if (navRestoredThisBoot) return false;
  if (S.pendingEventId) { navRestoredThisBoot = true; return false; }
  try {
    if (typeof shareIdFromPath === "function" && shareIdFromPath()) {
      navRestoredThisBoot = true;
      return false;
    }
  } catch {}
  const saved = loadSavedNav();
  if (!saved || typeof saved !== "object") return false;

  let connId = saved.connId || "personal";
  if (typeof isServedOrigin === "function" && isServedOrigin()) {
    // Browser on a host URL: stay on that server; only restore the channel/view.
    if (!servedConnId) return false;
    connId = servedConnId;
  } else if (connId !== "personal" && !S.conns[connId]) {
    // Local host conn may appear a tick later via ashSyncServers — retry then.
    if (String(connId).startsWith("srv-local-")) return false;
    connId = "personal";
  }

  const conn = S.conns[connId];
  if (!conn) return false;

  S.activeConnId = connId;
  Nav.set(validatedNavView(conn, saved.view));
  if (saved.eventChannelId && (conn.channels || []).some(c =>
    c.id === saved.eventChannelId && c.kind === "event"
    && !(typeof PersonalSpace !== "undefined" && PersonalSpace.isHiddenChannel(c, conn)))) {
    S.activeEventChannelId = saved.eventChannelId;
  }
  try { applyCardTheme(serverSettings(conn).cardTheme); } catch {}
  navRestoredThisBoot = true;
  return true;
}

// Native bridge: MainActivity hands the full set of servers this device is
// hosting (each `srv-local-<id>`). Upsert + (re)connect each, and drop any
// previously-bridged local server that's no longer in the list (deleted, or
// hosting stopped). Idempotent — called on every page load, resume, and host
// status change, so it must not churn a healthy live connection.
window.ashSyncServers = (list) => {
  const wanted = new Map((list || []).map(s => [s.id, s]));
  for (const id of Object.keys(S.conns)) {
    if (!id.startsWith("srv-local-") || wanted.has(id)) continue;
    try { S.conns[id].ws?.close(); } catch {}
    delete S.conns[id];
    removeServerEntry(id);
    if (S.activeConnId === id) switchConn("personal");
  }
  for (const s of wanted.values()) {
    const { id, url, name, token, pass } = s;
    upsertServerEntry({ id, url, name, token, pass });
    let cur = S.conns[id];
    // Reclaim a remigrated srv-tag-* / joinTag twin so Soft-AP status pushes
    // do not create a second rail glyph for the same hosted server.
    if (!cur && s.joinTag && typeof remigrateConnId === "function") {
      const tagKey = String(normJoinTag?.(s.joinTag) || s.joinTag).trim().toLowerCase();
      const twin = Object.values(S.conns || {}).find((c) => {
        if (!c || c.id === id) return false;
        if (String(c.id || "").startsWith("srv-local-")) return false;
        const jt = String(c.joinTag || "").trim().toLowerCase();
        return jt && tagKey && jt === tagKey;
      });
      if (twin) {
        try { remigrateConnId(twin, id); } catch {}
        cur = S.conns[id];
      }
    }
    // Keep an in-flight host bridge connect alive across frequent status pushes
    // (invite slug mint / NSD / network gate). Tearing down mid-connect flashes
    // Online↔Offline and prevents welcome + inviteUrl from ever landing.
    const sameEndpoint = cur && cur.url === url && cur.token === token;
    const isHostBridge = String(id).startsWith("srv-local-");
    const inFlight = sameEndpoint &&
      (cur.status === "connecting" || cur.status === "waiting");
    const healthy = sameEndpoint && cur.me &&
      (cur.status === "online" || cur.status === "connecting");
    // Host bridge: keep across offline blips while native hosting is still up.
    const keepHostBridge = isHostBridge && sameEndpoint && !!cur.me;
    if (healthy || inFlight || keepHostBridge) {
      cur.name = name; cur.pass = pass;
      // Shareable bases for /s/<id> links (host WebView can't read a routable origin).
      cur.shareLan = s.lanUrl || cur.shareLan || "";
      // Clear when Local — do not keep a stale public URL after demote.
      cur.sharePublic = s.publicUrl || "";
      cur.hostPublic = s.isPublic === true || s.isPublic === "true";
      if (!cur.hostPublic) {
        cur.urlPublic = "";
        cur.sharePublic = "";
      }
      cur.hotspotActive = s.hotspotActive === true || s.hotspotActive === "true";
      if (s.hotspotSsid) cur.hotspotSsid = s.hotspotSsid;
      if (s.hotspotPassword) cur.hotspotPassword = s.hotspotPassword;
      if (s.hotspotPreferred) cur.hotspotPreferred = true;
      if (String(s.reachMode || "").toLowerCase() === "direct") {
        cur.reachMode = "direct";
        cur.hotspotPreferred = true;
      } else if (String(s.reachMode || "").toLowerCase() === "device") {
        cur.reachMode = "device";
      } else if (String(s.reachMode || "").toLowerCase() === "local") {
        cur.reachMode = "local";
      }
      if (s.joinTag) cur.joinTag = s.joinTag;
      if (s.shareCode) cur.shareCode = s.shareCode;
      if (s.inviteCode) {
        cur.invite = {
          code: s.inviteCode,
          expiry: Number(s.inviteExpiry) || cur.invite?.expiry || 0,
        };
      }
      if (s.inviteUrl) {
        cur.inviteUrl = s.inviteUrl;
        if (cur.me) cur.me.inviteUrl = s.inviteUrl;
      }
      if (s.inviteSlug) {
        cur.inviteSlug = s.inviteSlug;
        if (cur.me) cur.me.inviteSlug = s.inviteSlug;
      }
      // Native Approve/Deny: pending queue lives in HostService, not only WS.
      if (Array.isArray(s.pending)) cur.pendingReqs = s.pending;
      if (keepHostBridge && cur.status === "offline" && typeof connect === "function") {
        connect(cur);
      }
      continue;
    }
    if (cur) { try { cur.ws?.close(); } catch {} }
    const conn = makeConn({ id, url, name, token, pass, joinTag: s.joinTag || "" });
    // Seed from cache so the sidebar isn't empty while welcome is in flight.
    const cached = loadCache(id);
    if (cached) {
      conn.hostName = cached.hostName || name;
      conn.me = cached.me;
      conn.members = normalizeConnMembers(conn, cached.members);
      conn.channels = cached.channels || [];
      conn.boards = cached.boards || [];
      if (typeof ensureConnBoards === "function") ensureConnBoards(conn);
      if (typeof syncShownBoardsToPersonal === "function") syncShownBoardsToPersonal();
      conn.events = cached.events || [];
      conn.routines = normalizeRoutineCatalog(cached.routines);
      conn.categories = cached.categories || [];
      conn.eventTypes = cached.eventTypes || [];
      conn.customRoles = cached.customRoles || [];
      if (cached.eventRolePerms) conn.eventRolePerms = cached.eventRolePerms;
      if (cached.cardCats) conn.cardCats = cached.cardCats;
      if (cached.cardDurations) conn.cardDurations = cached.cardDurations;
      if (cached.locations) conn.locations = cached.locations;
      if (cached.iconText != null) conn.iconText = cached.iconText;
      if (cached.serverPic) conn.serverPic = cached.serverPic;
      try { applyCachedFeel(conn, cached); } catch {}
    }
    ensureOutbox(conn);
    refreshPendingFlags(conn);
    conn.shareLan = s.lanUrl || "";
    conn.sharePublic = s.publicUrl || "";
    conn.hostPublic = s.isPublic === true || s.isPublic === "true";
    if (!conn.hostPublic) {
      conn.urlPublic = "";
      conn.sharePublic = "";
    }
    conn.hotspotActive = s.hotspotActive === true || s.hotspotActive === "true";
    if (s.hotspotSsid) conn.hotspotSsid = s.hotspotSsid;
    if (s.hotspotPassword) conn.hotspotPassword = s.hotspotPassword;
    if (s.hotspotPreferred) conn.hotspotPreferred = true;
    if (String(s.reachMode || "").toLowerCase() === "direct") {
      conn.reachMode = "direct";
      conn.hotspotPreferred = true;
    } else if (String(s.reachMode || "").toLowerCase() === "device") {
      conn.reachMode = "device";
    } else if (String(s.reachMode || "").toLowerCase() === "local") {
      conn.reachMode = "local";
    }
    if (Array.isArray(s.pending)) conn.pendingReqs = s.pending;
    if (s.shareCode) conn.shareCode = s.shareCode;
    if (s.inviteCode) {
      conn.invite = {
        code: s.inviteCode,
        expiry: Number(s.inviteExpiry) || 0,
      };
    }
    if (s.inviteUrl) conn.inviteUrl = s.inviteUrl;
    if (s.inviteSlug) conn.inviteSlug = s.inviteSlug;
    S.conns[id] = conn;
    connect(conn);
  }
  if (typeof syncShownBoardsToPersonal === "function") syncShownBoardsToPersonal();
  // Cold start: local host servers arrive here after initConns — restore now if needed.
  tryRestoreNav();
  bootPaint();
};

/** Host settings panel — status snapshot from MainActivity / HostService. */
window.ashSyncHostStatus = (status) => {
  try {
    if (typeof applyHostStatusPush === "function") applyHostStatusPush(status);
  } catch (e) {
    console.warn("ashSyncHostStatus", e);
  }
};

/** HostService → People "Waiting to join" (native Approve doesn't use the WS path). */
window.ashSyncPending = (list) => {
  for (const s of list || []) {
    const conn = S.conns[s.id];
    if (!conn) continue;
    conn.pendingReqs = Array.isArray(s.pending) ? s.pending : [];
  }
  try {
    if (typeof renderSidebar === "function") renderSidebar();
    if (S.activeView?.kind === "members" || S.activeView?.kind === "sharedHistory") {
      if (typeof renderView === "function") renderView();
    }
    if (typeof refreshChannelPanelMetaTabs === "function") refreshChannelPanelMetaTabs();
  } catch {}
};

/** Paint the main board as soon as personal exists — initConns awaits decrypt/restore
 *  and native ashSyncServers may refresh the rail first, so never leave #view empty. */
function bootPaint() {
  if (!S.activeView && S.conns?.personal && !isServedOrigin()) {
    S.activeConnId = S.activeConnId || "personal";
    Nav.set({ kind: "events" });
  }
  try { renderAll(); } catch (e) { console.error("bootPaint", e); }
}

async function initConns() {
  if (typeof isDemoMode === "function" && isDemoMode()) {
    if (typeof DemoBoot !== "undefined" && DemoBoot.start) return DemoBoot.start();
  }
  markServedHostChrome();
  if (isServedOrigin()) {
    try { await LocalSyncStore?.init?.([]); } catch (e) { console.warn("local sync init", e); }
  }
  try { wireShellBreakpoint?.(); } catch {}
  try { S.pendingEventId = sessionStorage.getItem("ash_pending_event") || null; } catch {}

  S.conns.personal = makePersonalConn();
  if (!isServedOrigin()) {
    S.activeConnId = "personal";
    Nav.set({ kind: "events" });
  }
  bootPaint();
  // Personal store keeps wire fields (title/sticker/…) but UI reads `_` caches.
  // Remote conns rehydrate via decryptAll on reconnect; personal must do it here
  // or restart shows "…" titles and missing stickers even when data is on disk.
  try {
    await decryptAll(S.conns.personal);
    savePersonal();
  } catch {}
  try { seedEventSeenCursors(S.conns.personal); } catch {}
  // First run only: welcome splash (name entry).
  // Skip on host URLs — personal space is app-only there.
  if (!isServedOrigin() && !localStorage.getItem("ash_me_named")) {
    // Render the personal board behind the opaque splash so the welcome card can
    // flip onto its personal example draft (measured at flip time).
    S.activeConnId = "personal";
    Nav.set({ kind: "events" });
    try { renderAll(); } catch {}
    const result = await (window.Onboarding?.showWelcomeSplash?.() || Promise.resolve(null));
    localStorage.setItem("ash_me_named", "1");
    const name = result?.name;
    if (name && String(name).trim()) {
      saveMe({ name: String(name).trim() });
    }
  }

  bootstrapFromUrl();

  // App client: restore saved remote memberships and reconnect — join once, stay in.
  // Served browser origins still gate on join (link alone must not restore membership).
  if (!isServedOrigin()) {
    const rawServers = loadServers();
    const migrated = migrateServerEntries(rawServers);
    if (JSON.stringify(migrated) !== JSON.stringify(rawServers)) saveServers(migrated);
    try { await LocalSyncStore?.init?.(migrated); } catch (e) {
      console.warn("local sync init", e);
    }
    for (const entry of migrated) {
      try {
      if (entry.drive) continue;
      // Host-bridged local servers reconnect via ashSyncServers (token + group secret).
      if (String(entry.id || "").startsWith("srv-local-")) continue;
      const conn = makeConn({ ...entry });
      syncConnDualUrls(conn);
      const cached = loadCache(entry.id);
      if (cached) {
        conn.hostName = cached.hostName; conn.me = cached.me;
        conn.members = normalizeConnMembers(conn, cached.members);
        conn.channels = cached.channels || [];
        conn.boards = cached.boards || [];
        if (typeof ensureConnBoards === "function") ensureConnBoards(conn);
        conn.events = cached.events || []; conn.categories = cached.categories || [];
        conn.eventTypes = cached.eventTypes || [];
        conn.customRoles = cached.customRoles || [];
      if (cached.eventRolePerms) conn.eventRolePerms = cached.eventRolePerms;
        if (cached.cardCats) conn.cardCats = cached.cardCats;
        if (cached.cardDurations) conn.cardDurations = cached.cardDurations;
        if (cached.locations) conn.locations = cached.locations;
        if (cached.iconText != null) conn.iconText = cached.iconText;
        if (cached.serverPic) conn.serverPic = cached.serverPic;
        try { applyCachedFeel(conn, cached); } catch {}
      }
      // Saved membership entry may hold the icon even when the full cache is empty.
      if (!conn.serverPic && entry.serverPic) conn.serverPic = entry.serverPic;
      if (!conn.iconText && entry.iconText) conn.iconText = entry.iconText;
      ensureOutbox(conn);
      refreshPendingFlags(conn);
      if (conn.pass && conn.e2eSalt) {
        try { conn.key = await deriveKey(conn.pass, conn.e2eSalt); } catch {}
      }
      S.conns[entry.id] = conn;
      // Older installs saved a token without the group secret — one password
      // sign-in upgrades them to stay-joined. Don't half-reconnect encrypted.
      if (conn.token && !conn.pass) {
        conn.token = null;
        conn.status = "offline";
        upsertServerEntry({ id: entry.id, token: null });
      } else if (conn.token) {
        connect(conn);
        if (conn.key) {
          try { await decryptAll(conn); } catch {}
        }
        try { seedEventSeenCursors(conn); } catch {}
      } else {
        conn.status = "offline";
        try { seedEventSeenCursors(conn); } catch {}
      }
      } catch (e) {
        console.error("initConns restore server", entry?.id, e);
      }
    }
    if (typeof syncShownBoardsToPersonal === "function") syncShownBoardsToPersonal();
    if (window.AshNative?.startMemberDiscovery && clientNetworkTrust?.() === "trusted") {
      try { window.AshNative.startMemberDiscovery(); } catch {}
    }
  }

  // Host URL: never land on personal. App: restore last channel, else personal.
  if (isServedOrigin()) {
    S.activeConnId = "personal";
    Nav.set({ kind: "events" });
  } else if (!tryRestoreNav()) {
    S.activeConnId = "personal";
    Nav.set({ kind: "events" });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      rememberNav();
      return;
    }
    if (document.visibilityState === "visible") {
      for (const c of Object.values(S.conns)) {
        if (PersonalSpace.isPersonal(c) || c.demo) continue;
        if (c.status === "offline") connect(c);
        else if (c.status === "online") {
          flushOutbox(c);
          if (typeof reevaluateConnPath === "function") reevaluateConnPath(c);
        }
      }
      if (typeof onNetworkPossiblyChanged === "function") onNetworkPossiblyChanged();
    }
  });
  // Leaving the page: drop presence without waiting for the host idle timer.
  window.addEventListener("pagehide", () => {
    rememberNav();
    for (const c of Object.values(S.conns)) {
      if (PersonalSpace.isPersonal(c) || c.demo) continue;
      if (c.drive) continue;
      signalHttpLeave(c);
      if (c.ws && c.ws.readyState === WebSocket.OPEN) {
        try { c.ws.close(); } catch {}
      }
    }
  });
  // iOS suspends installed PWAs hard; a bfcache restore fires pageshow without a
  // visibilitychange, so reconnect here too rather than waiting out the retry timer.
  window.addEventListener("pageshow", () => {
    for (const c of Object.values(S.conns)) {
      if (PersonalSpace.isPersonal(c) || c.demo) continue;
      if (c.drive) {
        if (typeof driveStartSync === "function") driveStartSync(c);
        continue;
      }
      if (c.status === "offline") connect(c);
    }
  });
  document.addEventListener("ash:welcome", (e) => {
    if (!isServedOrigin()) return;
    const id = e.detail?.connId;
    if (id && S.conns[id]?.token) {
      setServedGate(false);
      S.activeConnId = id;
      tryRestoreNav({ servedConnId: id });
      renderAll();
    }
  });
  bootPaint();

  try { window.Onboarding?.maybeStart?.(); } catch {}
  window.Onboarding?.finishWelcome?.();

  if (isServedOrigin()) {
    const handedOff = await consumeEdgeWelcome();
    if (!handedOff) openServedJoinGate();
  } else {
    consumePendingInviteLink();
  }
}

initConns().catch((e) => console.error("initConns unhandled", e));
