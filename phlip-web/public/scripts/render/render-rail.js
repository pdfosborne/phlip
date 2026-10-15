/* render-rail.js — connection switching, rail chrome, logos, document title.
 * Globals out: switchConn, renderRail, syncDocumentTitle, connReachKind, …
 * Load after: render-core.js; before: render-side-overlay.js
 */

// Switches which conn is on screen, resetting the view-local state that
// otherwise wouldn't make sense carried over.
function switchConn(connId) {
  // Browser on a host URL: stay on this server — personal space is app-only.
  if (isServedOrigin() && connId === "personal") return;
  if (S.activeConnId === connId && !S.activeProjection) { openNav(); return; }
  if (typeof clearActiveProjection === "function") clearActiveProjection();
  if (S.activeConnId === connId) {
    const current = S.conns[connId];
    const dest = typeof lastDestFor === "function" ? lastDestFor(connId) : null;
    if (dest && typeof validatedNavView === "function") Nav.set(validatedNavView(current, dest));
    else Nav.landDefault(current);
    renderRail();
    renderSidebar(true);
    renderView(false, { force: true });
    openNav();
    return;
  }
  const next = S.conns[connId];
  // Stay-joined remotes reconnect with the saved token. Only prompt sign-in when
  // there is no session left (expired / kicked / never finished join).
  if (next && !PersonalSpace.isPersonal(next) && !String(connId).startsWith("srv-local-")
      && next.status !== "online" && next.status !== "connecting" && next.status !== "waiting") {
    if (next.token) {
      connect(next);
    } else {
      const entry = loadServers().find(s => s.id === connId) || {};
      let host = "";
      try { host = new URL(String(next.url || entry.url || "").replace(/^ws/i, "http")).hostname || ""; } catch {}
      openJoinModal({
        name: entry.userName || next._lastName || next.me?.name || loadMe().name || "",
        pass: "",
        rejoinUrl: next.url || entry.url || "",
        sid: entry.joinTag || next.joinTag || "",
        code: "",
        route: host,
        isPublic: /^wss:/i.test(next.url || entry.url || ""),
      });
    }
  }
  S.activeConnId = connId;
  applyCardTheme(serverSettings(next).cardTheme);
  const dest = typeof lastDestFor === "function" ? lastDestFor(connId) : null;
  if (dest && typeof validatedNavView === "function") {
    Nav.set(validatedNavView(next, dest));
  } else {
    Nav.landDefault(next);
  }
  if (S.activeView?.kind === "channel") {
    const ch = (next?.channels || []).find(c => c.id === S.activeView.id);
    S.activeEventChannelId = ch?.kind === "event" ? ch.id : null;
  } else {
    S.activeEventChannelId = null;
  }
  S.hand = { mode: "context", pending: null };
  landOnTodayWeekView();
  try { resetRsvpFilter(); } catch {}
  rememberNav();
  try { renderRail(); } catch (e) { console.error("renderRail", e); }
  try { renderView(false, { force: true }); } catch (e) { console.error("renderView", e); }
  try { renderSidebar(true); } catch (e) { console.error("renderSidebar", e); }
  try { renderFoot(); } catch (e) { console.error("renderFoot", e); }
  openNav();
  try { window.Onboarding?.noteAction?.("server"); } catch {}
}

// Server icons on the rail, top→bottom: personal (app only), then each joined
// server in join order (oldest first).
function railConnIds() {
  const served = isServedOrigin();
  const ids = served ? [] : ["personal"];
  for (const conn of orderedRemoteConns()) ids.push(conn.id);
  return ids;
}

// dir +1 = next down the rail, −1 = previous. Wraps at both ends.
function cycleRailConn(dir) {
  const ids = railConnIds();
  if (ids.length < 2) return;
  let i = ids.indexOf(S.activeConnId);
  if (i < 0) i = 0;
  const next = ids[(i + dir + ids.length) % ids.length];
  if (next === S.activeConnId) return;
  switchConn(next);
}

function attachRailGestures(rail) {
  if (!rail) return;
  if (typeof onceFlag === "function") {
    if (!onceFlag(rail, "railSwipe")) return;
  } else if (rail.dataset.railSwipe) {
    return;
  } else {
    rail.dataset.railSwipe = "1";
  }
  let sx = 0, sy = 0, st = 0, live = false, ignoreClick = false;
  const clearIgnoreClick = () => { ignoreClick = false; };
  rail.addEventListener("click", (e) => {
    if (!ignoreClick) return;
    ignoreClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  rail.addEventListener("pointerdown", (e) => {
    // Don't steal join / personal / brand controls — those stay plain taps.
    if (e.target.closest(".rail-btn.add, .rail-btn.rail-personal, .rail-btn.rail-brand")) {
      clearIgnoreClick();
      live = false;
      return;
    }
    // Server icons: clear stale swallow so the first tap switches immediately.
    if (e.target.closest(".rail-btn[data-conn-id]")) clearIgnoreClick();
    sx = e.clientX; sy = e.clientY; st = performance.now(); live = true;
  });
  rail.addEventListener("pointerup", (e) => {
    if (!live) return;
    live = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    const dt = performance.now() - st;
    const G = typeof AshGesture !== "undefined" ? AshGesture : null;
    const axisOk = (a, b) => (G && typeof G.axisLocked === "function")
      ? Math.abs(a) >= Math.abs(b) && G.axisLocked(a, b)
      : Math.abs(a) > Math.abs(b) * 1.15;
    const commit = (distance) => (G && typeof G.shouldCommit === "function")
      ? G.shouldCommit({ distance, travel: 96, dt })
      : Math.abs(distance) >= 24;
    // Swipe left closes the server drawer (same as sidebar dismiss).
    if (Panel.navOpen() && dx < 0 && axisOk(dx, dy) && commit(dx)) {
      ignoreClick = true;
      closeNav();
      setTimeout(clearIgnoreClick, 400);
      return;
    }
    // Clear vertical swipe only — remaining horizontal drift is ignored.
    if (!(dy && axisOk(dy, dx) && commit(dy))) return;
    ignoreClick = true;
    // Finger up → next server further down; finger down → previous.
    cycleRailConn(dy < 0 ? 1 : -1);
    setTimeout(clearIgnoreClick, 400);
  });
  rail.addEventListener("pointercancel", () => { live = false; });
}

/** Served host URL: non-interactive mark (no personal space). */
function appendServedRailBrand(rail) {
  const brand = document.createElement("div");
  brand.className = "rail-btn rail-personal rail-brand";
  brand.innerHTML = ic("user-lock");
  brand.title = "Phlip";
  brand.setAttribute("role", "img");
  brand.setAttribute("aria-label", "Phlip");
  rail.appendChild(brand);
}

function railDotStatusLabel(conn, displayStatus, feel) {
  const feelState = String(feel?.state || "");
  const status = String(displayStatus || "");
  if (feelState === "reaching" || status === "connecting" || status === "waiting") return "Syncing";
  if (typeof isHostedBridgeConn === "function" && isHostedBridgeConn(conn)) {
    return status === "online" ? "Hosting" : "Offline";
  }
  if (status === "online") return "Online";
  return "Offline";
}

/** App WebView: personal space button. */
function appendAppRailPersonal(rail) {
  const personalBtn = document.createElement("button");
  personalBtn.type = "button";
  const selected = S.activeConnId === "personal";
  personalBtn.className = "rail-btn rail-personal" + (selected ? " active" : "");
  personalBtn.innerHTML = ic("user-lock");
  personalBtn.title = "Personal space";
  personalBtn.setAttribute("aria-label", "Personal space");
  personalBtn.setAttribute("aria-selected", selected ? "true" : "false");
  personalBtn.onclick = () => switchConn("personal");
  rail.appendChild(personalBtn);
}

function appendRailRemoteServers(rail) {
  for (const conn of orderedRemoteConns()) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.connId = conn.id;
    const displayStatus = typeof hostedBridgeDisplayStatus === "function"
      ? hostedBridgeDisplayStatus(conn)
      : conn.status;
    const feel = typeof connFeelState === "function"
      ? connFeelState(conn)
      : { state: displayStatus === "online" ? "connected" : "unreachable", label: "", tone: "unknown" };
    const selected = conn.id === S.activeConnId;
    b.className = "rail-btn"
      + (selected ? " active" : "")
      + (feel.state === "connected" ? " is-feel-connected" : "")
      + (feel.state === "reaching" ? " is-feel-reaching" : "")
      + (feel.state === "unreachable" ? " is-feel-unreachable" : "")
      + (feel.tone === "aging" ? " is-feel-aging" : "")
      + (feel.tone === "stale" ? " is-feel-stale" : "");
    const statusLabel = railDotStatusLabel(conn, displayStatus, feel);
    b.innerHTML = `${connIconHTML(conn)}${connReachKindHTML(conn)}<span class="rail-dot ${displayStatus} feel-${feel.state}" role="img" aria-label="${esc(statusLabel)}"></span>`;
    b.querySelectorAll("img").forEach(img => { img.draggable = false; img.setAttribute("draggable", "false"); });
    const paths = connReachPaths(conn);
    const reachLabel = paths.length === 2
      ? (paths.includes("direct") ? "Direct + Public" : "Local + Public")
      : paths[0] === "public" ? "Public"
        : paths[0] === "direct" ? "Direct"
          : paths[0] === "lan" ? "Local" : "";
    const name = conn.name || conn.hostName || conn.url || "Server";
    const feelLabel = feel.label || (feel.state === "reaching" ? "Syncing…" : "");
    b.title = [name, reachLabel, feelLabel].filter(Boolean).join(" · ");
    b.setAttribute("aria-label", [name, statusLabel, feelLabel].filter(Boolean).join(" · "));
    b.setAttribute("aria-selected", selected ? "true" : "false");
    b.setAttribute("aria-description", statusLabel);
    b.onclick = () => switchConn(conn.id);
    rail.appendChild(b);
  }
}

/** App-only: multi-server join (host URL is already one server). */
function appendAppRailJoin(rail) {
  if (typeof isDemoMode === "function" && isDemoMode()) return;
  const add = document.createElement("button");
  add.type = "button";
  add.className = "rail-btn add rail-join";
  add.dataset.obGate = "join";
  add.innerHTML = ic("plus");
  add.title = "Add a server";
  add.setAttribute("aria-label", "Add a server");
  add.onclick = () => {
    if (typeof openAddServerMenu === "function") openAddServerMenu();
    else openJoinModal();
  };
  rail.appendChild(add);
}

function renderRail() {
  const rail = $("#rail");
  if (!rail) return;
  rail.innerHTML = "";
  // Prefer the early HTML flag so rail UX can't miss served-host detection.
  const served = document.documentElement.dataset.servedHost === "1" || isServedOrigin();

  if (served) appendServedRailBrand(rail);
  else appendAppRailPersonal(rail);

  appendRailRemoteServers(rail);
  if (!served) appendAppRailJoin(rail);

  attachRailGestures(rail);
  renderNavIcon();
  // Re-derive action-based chrome (servers / chat channels may have changed).
  try { window.Onboarding?.noteAction?.("chrome"); } catch {}
}

// Short rail/nav glyph: personal uses the Phlip text logo; servers use iconText or name shorthand.
function appLogoTextSrc() {
  return "app-logo-text.png";
}
function syncAppLogoIcons() {
  const src = appLogoTextSrc();
  document.querySelectorAll("img.app-logo-icon").forEach((img) => {
    if (img.getAttribute("src") !== src) img.setAttribute("src", src);
  });
}
function connIconText(conn) {
  if (!conn || PersonalSpace.isPersonal(conn)) return "";
  const custom = normalizeIconText(conn.iconText);
  if (custom) return custom;
  return serverIconShorthand(conn.name || conn.hostName || "?");
}
function connIconHTML(conn) {
  if (!conn || PersonalSpace.isPersonal(conn)) return ic("user-lock");
  if (conn.serverPic) return `<img class="rail-pic" src="${esc(conn.serverPic)}" alt="">`;
  const named = String(conn.serverIcon || "").trim();
  if (named && typeof ic === "function") {
    const mark = ic(named);
    if (mark.indexOf("<svg") >= 0) return mark;
  }
  return `<span class="rail-label">${esc(connIconText(conn))}</span>`;
}

/** True while this device is hosting this server via the native bridge (`srv-local-*`). */
function isHostedBridgeConn(conn) {
  return !!(conn && String(conn.id || "").startsWith("srv-local-"));
}

/**
 * Rail/status for the host's own server: while native hosting is running,
 * don't paint Offline during brief loopback WS reconnects.
 */
function hostedBridgeDisplayStatus(conn) {
  if (!isHostedBridgeConn(conn)) return conn?.status || "offline";
  if (conn.status === "online") return "online";
  if (conn.status === "waiting") return "waiting";
  try {
    const st = JSON.parse(window.AshNative?.hostStatus?.() || "{}");
    if (!st.running) return conn.status;
    const rawId = String(conn.id).replace(/^srv-local-/, "");
    const listed = Array.isArray(st.servers)
      && st.servers.some((s) => String(s.id) === rawId);
    if (listed && conn.me) return "connecting";
  } catch {}
  return conn.status;
}

/** True while this membership is a Direct hotspot path (host live session or remembered joiner). */
function connIsDirectSession(conn) {
  if (!conn || PersonalSpace.isPersonal(conn)) return false;
  if (conn.hotspotActive === true) return true;
  if (typeof connIsDirectMembership === "function" && connIsDirectMembership(conn)) return true;
  try {
    const sid = String(conn.id || "").replace(/^srv-local-/, "");
    if (!sid || !String(conn.id || "").startsWith("srv-local-")) return false;
    return !!(typeof _hotspotSession !== "undefined" && _hotspotSession?.active
      && String(_hotspotSession.serverId || "") === sid);
  } catch {
    return false;
  }
}

/** True while this device is hosting this server as On this device (not Public). */
function connIsDeviceOnly(conn) {
  if (!isHostedBridgeConn(conn)) return false;
  if (conn.hostPublic === true) return false;
  return (typeof normalizeReachMode === "function"
    ? normalizeReachMode(conn.reachMode)
    : String(conn.reachMode || "").toLowerCase()) === "device";
}

/** Invite/share is possible: permission plus a live Drive / LAN / public / Direct path. */
function connInviteShareReady(conn) {
  if (!conn) return false;
  if (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn)) return false;
  if (conn.drive) return true;
  if (connIsDeviceOnly(conn)) return false;
  const paths = connReachPaths(conn);
  return paths.includes("public") || paths.includes("lan") || paths.includes("direct");
}

/** Paths this membership can use: "lan" | "direct" and/or "public". Hosted HOME can be both. */
function connReachPaths(conn) {
  if (!conn || PersonalSpace.isPersonal(conn)) return [];
  const hosted = String(conn.id || "").startsWith("srv-local-");
  const device = hosted && (typeof normalizeReachMode === "function"
    ? normalizeReachMode(conn.reachMode)
    : String(conn.reachMode || "").toLowerCase()) === "device";
  // Local-only hosting: public glyph only when Public is actually ON.
  const hasPublic = hosted
    ? conn.hostPublic === true
    : !!(conn.urlPublic || conn.sharePublic || /^wss:/i.test(conn.url || ""));
  const hasLan = hosted
    ? !device
    : !!(conn.urlLan || conn.shareLan || (/^ws:/i.test(conn.url || "") && !/^wss:/i.test(conn.url || "")));
  const out = [];
  if (hasLan) out.push(connIsDirectSession(conn) ? "direct" : "lan");
  if (hasPublic) out.push("public");
  return out;
}

/** Primary path for share/invite copy — public wins when the server is public. */
function connReachKind(conn) {
  const paths = connReachPaths(conn);
  if (!paths.length) return null;
  if (paths.includes("public") && (conn.hostPublic === true || conn.activePath === "public" || paths.length === 1)) {
    return "public";
  }
  // Direct is still a LAN-style http invite (hotspot AP URL).
  if (paths.includes("lan") || paths.includes("direct")) return "lan";
  return paths[0] || null;
}

function connReachKindHTML(conn) {
  const paths = connReachPaths(conn);
  if (!paths.length) return "";
  const hosted = String(conn.id || "").startsWith("srv-local-");
  const activeRaw = conn.activePath === "lan" || conn.activePath === "public" ? conn.activePath : null;
  // Hosted Direct is the live LAN path while the hotspot session is up.
  const active = activeRaw === "lan" && paths.includes("direct") ? "direct" : activeRaw;
  const parts = paths.map((kind) => {
    const label = kind === "public"
      ? (hosted ? "Public · you’re hosting" : "Public server")
      : kind === "direct"
        ? (hosted ? "Direct · you’re hosting" : "Direct session")
        : (hosted ? "Local · you’re hosting" : "Local network");
    const glyph = kind === "public" ? "globe" : kind === "direct" ? "wifi" : "network";
    const live = !active || active === kind ? " is-live" : " is-idle";
    return `<span class="rail-kind ${kind}${hosted ? " hosted" : " joined"}${live}" title="${esc(label)}" aria-label="${esc(label)}">${ic(glyph, "rail-kind-ico")}</span>`;
  });
  if (parts.length === 1) return parts[0];
  return `<span class="rail-kind-stack">${parts.join("")}</span>`;
}

function renderNavIcon() {
  const btn = $("#btn-back");
  if (!btn) return;
  // Back chevron opens the left sidebar (same as a rightward sheet swipe).
  const conn = activeConn();
  const name = PersonalSpace.isPersonal(conn) ? "Personal space"
    : (conn?.name || conn?.hostName || "Server");
  btn.innerHTML = ic("chevronLeft") + '<span class="nav-server-icon" aria-hidden="true">' + connIconHTML(conn) + '</span>';
  btn.classList.add("is-menu");
  btn.classList.remove("is-personal");
  const toList = (typeof S !== "undefined" && S.conversationsReturn)
    || (typeof conversationActiveEventChannel === "function"
      && typeof isBoardAgendaView === "function"
      && isBoardAgendaView(conversationActiveEventChannel()));
  btn.title = toList ? "Back to conversations" : (name + " · Back to boards");
  btn.setAttribute("aria-label", btn.title);
}

function syncDocumentTitle() {
  const conn = activeConn();
  const name = PersonalSpace.isPersonal(conn)
    ? "Personal space"
    : String(conn?.name || conn?.hostName || "").trim();
  document.title = name ? `Phlip - ${name}` : "Phlip";
}
