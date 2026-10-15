/* render-side-overlay.js — side overlay open/close/refresh lifecycle.
 * Globals out: openSideOverlay, closeSideOverlay, sideOverlayGoBack,
 *   refreshSideOverlay, openServerSharePanel, sideOverlayKind,
 *   sideOverlayBeforeClose
 * Load after: render-rail.js; before: render-share.js
 */

/** Which left-sidebar overlay is open (Host/Share + admin surfaces). */
let sideOverlayKind = null;
/** Optional flush before overlay teardown (e.g. Places persist). */
let sideOverlayBeforeClose = null;
/** Nested overlay step (hosting guide / host setup). Same as the back arrow. */
let sideOverlayOnBack = null;

/**
 * Open the left sidebar layer. Keeps nav open; main board unchanged.
 * @param {{ kind: string, title: string, bodyClass?: string|string[], mount: (body: HTMLElement) => void, onBack?: () => void }} opts
 */
function openSideOverlay({ kind, title, bodyClass, mount, onBack } = {}) {
  if (!kind || typeof mount !== "function") return null;
  // Persist the previous overlay draft before replacing it.
  const prevFlush = sideOverlayBeforeClose;
  sideOverlayBeforeClose = null;
  if (typeof prevFlush === "function") {
    try { prevFlush(); } catch (err) { console.error(err); }
  }
  try { window.OnboardingBus?.emit?.("settings:open", { kind }); } catch {}
  if (typeof openNav === "function") openNav();
  if (typeof closeChannelPanel === "function" && Panel.channelOpen()) closeChannelPanel();
  if (typeof sideHostMode !== "undefined" && kind !== "host" && kind !== "hostSetup") {
    sideHostMode = null;
  }
  const overlay = document.getElementById("side-overlay");
  const body = document.getElementById("side-overlay-body");
  const titleEl = document.getElementById("side-overlay-title");
  const back = document.getElementById("side-overlay-back");
  const headActions = document.getElementById("side-overlay-actions");
  if (!overlay || !body) return null;
  sideOverlayKind = kind;
  sideOverlayOnBack = typeof onBack === "function" ? onBack : null;
  if (titleEl) titleEl.textContent = title || "";
  if (headActions) {
    headActions.innerHTML = "";
    headActions.hidden = true;
  }
  if (back) {
    back.innerHTML = typeof ic === "function" ? ic("back") : "←";
    back.onclick = (e) => {
      e.stopPropagation();
      sideOverlayGoBack();
    };
  }
  body.className = "side-overlay-body";
  const classes = Array.isArray(bodyClass) ? bodyClass : (bodyClass ? [bodyClass] : []);
  for (const c of classes) if (c) body.classList.add(c);
  body.innerHTML = "";
  try { mount(body); } catch (err) {
    console.error(err);
    body.innerHTML = `<p class="channel-panel-empty">${esc(err?.message || "Couldn’t open")}</p>`;
  }
  overlay.hidden = false;
  overlay.setAttribute("aria-hidden", "false");
  document.getElementById("sidebar")?.classList.add("side-overlay-open");
  return body;
}

/** Open share info filling the left sidebar (personal invite + QR). */
function openServerSharePanel() {
  const conn = activeConn();
  if (!conn || PersonalSpace.isPersonal(conn)) return;
  const canShare = canManageServer(conn)
    || (typeof canInviteToGroup === "function" && canInviteToGroup(conn));
  if (!canShare) {
    toast("Only hosts and admins can share invites");
    return;
  }
  openSideOverlay({
    kind: "share",
    title: "Share info",
    bodyClass: "server-settings-body",
    mount: (body) => fillServerShareBody(body),
  });
}

function isSideOverlayOpen() {
  return !!document.getElementById("sidebar")?.classList.contains("side-overlay-open");
}

/** Match the overlay back arrow: nested onBack when set, else close. */
function sideOverlayGoBack() {
  const fn = sideOverlayOnBack;
  if (typeof fn === "function") {
    fn();
    return;
  }
  closeSideOverlay();
}

function closeSideOverlay() {
  const before = sideOverlayBeforeClose;
  sideOverlayBeforeClose = null;
  const cleanup = () => {
    const overlay = document.getElementById("side-overlay");
    const body = document.getElementById("side-overlay-body");
    const headActions = document.getElementById("side-overlay-actions");
    if (overlay) {
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
    }
    if (body) {
      body.className = "side-overlay-body";
      body.innerHTML = "";
    }
    if (headActions) {
      headActions.innerHTML = "";
      headActions.hidden = true;
    }
    sideOverlayKind = null;
    sideOverlayOnBack = null;
    if (typeof sideHostMode !== "undefined") sideHostMode = null;
    document.getElementById("sidebar")?.classList.remove("side-overlay-open");
  };
  if (typeof before === "function") {
    const rearm = () => { sideOverlayBeforeClose = before; };
    try {
      const result = before();
      if (result && typeof result.then === "function") {
        result.then((ok) => {
          if (ok === false) rearm();
          else cleanup();
        }, () => { rearm(); });
        return;
      }
      if (result === false) {
        rearm();
        return;
      }
    } catch (err) {
      console.error(err);
      rearm();
      return;
    }
  }
  cleanup();
}

/** Remount the open admin/settings overlay after sidebar refresh / settings echo. */
function refreshSideOverlay() {
  if (!isSideOverlayOpen() || !sideOverlayKind) return;
  const kind = sideOverlayKind;
  const conn = typeof activeConn === "function" ? activeConn() : null;
  if (kind === "console" || kind === "setup" || (typeof isConsoleSectionKind === "function" && isConsoleSectionKind(kind))) {
    if (!canSeeConsoleMeta(conn)) { closeSideOverlay(); return; }
    if (typeof openConsoleSectionOverlay === "function") {
      openConsoleSectionOverlay(kind === "console" || kind === "setup" ? "default-role" : kind);
    }
  } else if (kind === "moderate") {
    if (!canSeeModerateMeta(conn)) { closeSideOverlay(); return; }
    openModerateSideOverlay();
  } else if (kind === "serverOptions") {
    if (!conn || PersonalSpace.isPersonal(conn) || !conn.me) closeSideOverlay();
  } else if (kind === "userSettings") {
    return;
  } else if (kind === "categories" || kind === "roles") {
    if (!canManageServer(conn)) closeSideOverlay();
  } else if (kind === "share") {
    if (!conn || PersonalSpace.isPersonal(conn)) closeSideOverlay();
  } else if (kind === "host" || kind === "hostSetup" || kind === "hostServer") {
    if (typeof refreshHostSettingsPanel === "function") refreshHostSettingsPanel();
  } else if (kind === "hostGuide") {
    if (typeof refreshHostingGuide === "function") refreshHostingGuide();
  } else if (kind === "places" && typeof repaintPlacesOverlay === "function") {
    repaintPlacesOverlay();
  }
}

