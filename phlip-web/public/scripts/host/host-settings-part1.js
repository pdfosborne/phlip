/* host-settings-part1.js — split from host-settings.js (Part 3 size ceiling).
 * Load after: (prior deps); part of host-settings cluster.
 */

/* Host settings — left sidebar overlay; mirrors SettingsActivity HOST / HOST_INFO via AshNative. */

const HOSTING_UNAVAILABLE_COPY =
  "Hosting is not available on Apple devices. Android is required to host a server.";

let _hostStatusCache = null;
/** @type {"host"|"hostSetup"|null} */
let sideHostMode = null;

function hostNativeAvailable() {
  try {
    if (typeof isJoinOnlyNativeShell === "function" && isJoinOnlyNativeShell()) return true;
    if (typeof hostingAvailable === "function" && hostingAvailable()) {
      return !!(window.AshNative && typeof AshNative.hostStatus === "function");
    }
    return false;
  } catch { return false; }
}

function readHostStatus() {
  if (typeof isJoinOnlyNativeShell === "function" && isJoinOnlyNativeShell()) return null;
  if (!(window.AshNative && typeof AshNative.hostStatus === "function")) return null;
  try {
    const raw = AshNative.hostStatus();
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === "object") {
      _hostStatusCache = parsed;
      return parsed;
    }
  } catch (e) {
    console.warn("hostStatus failed", e);
  }
  return _hostStatusCache;
}

function isHostSettingsOpen() {
  const mode = Panel.hostMode();
  return Panel.sideOpen() && (mode === "host" || mode === "hostSetup");
}

function isHostedServerSettingsOpen() {
  return typeof sideOverlayKind !== "undefined" && sideOverlayKind === "hostServer";
}

/** Remount host UI in the left overlay after status / action changes. */
function refreshHostSettingsPanel() {
  if (isHostedServerSettingsOpen() && typeof fillHostedServerSettingsBody === "function") {
    const body = document.getElementById("side-overlay-body");
    if (body) fillHostedServerSettingsBody(body);
    return;
  }
  if (!isHostSettingsOpen()) return;
  mountHostSettingsOverlay(sideHostMode);
}

function applyHostStatusPush(status) {
  if (!status || typeof status !== "object") return;
  _hostStatusCache = status;
  if (isHostSettingsOpen() || isHostedServerSettingsOpen()) refreshHostSettingsPanel();
  if (typeof refreshHostingGuide === "function") refreshHostingGuide();
}

function hostCall(fnName, ...args) {
  if (typeof isJoinOnlyNativeShell === "function" && isJoinOnlyNativeShell()) {
    return { ok: false, error: HOSTING_UNAVAILABLE_COPY };
  }
  if (fnName === "setReachMode") {
    const mode = String(args[1] || "").trim().toLowerCase();
    if (mode === "local" || mode === "direct") {
      return { ok: false, error: "Same Wi-Fi and phone hotspot are no longer available. Use Internet sharing." };
    }
  }
  if (fnName === "startHotspotSession" || fnName === "rotateHotspotSession") {
    return { ok: false, error: "Phone hotspot is no longer available. Use Internet sharing." };
  }
  try {
    const fn = window.AshNative?.[fnName];
    if (typeof fn !== "function") return { ok: false, error: "Not available" };
    const raw = fn.apply(AshNative, args);
    if (raw == null || raw === "") return { ok: true };
    if (typeof raw === "string") {
      try { return JSON.parse(raw); } catch { return { ok: true }; }
    }
    return raw;
  } catch (e) {
    return { ok: false, error: e?.message || "Failed" };
  }
}

function openCurrentHostedServerSettings() {
  const conn = typeof activeConn === "function" ? activeConn() : null;
  if (conn && typeof isHostedBridgeConn === "function" && isHostedBridgeConn(conn)
      && typeof openHostedServerSettings === "function") {
    openHostedServerSettings(conn.id);
    return true;
  }
  if (typeof _hostedServerSettingsId === "string" && _hostedServerSettingsId
      && typeof openHostedServerSettings === "function") {
    openHostedServerSettings(_hostedServerSettingsId);
    return true;
  }
  return false;
}

/** Hosting setup overlay, or a shim onto the active server’s hosting page. */
function openHostSettingsPanel(mode = "host") {
  if (mode !== "hostSetup") {
    if (openCurrentHostedServerSettings()) return;
    toast("Open a hosted server from the rail, then tap its reach line.");
    return;
  }
  if (typeof isJoinOnlyNativeShell === "function" && isJoinOnlyNativeShell()) {
    try { window.OnboardingBus?.emit?.("settings:open", { kind: "hostSetup" }); } catch {}
    if (typeof openNav === "function") openNav();
    if (typeof closeChannelPanel === "function" && Panel.channelOpen()) closeChannelPanel();
    sideHostMode = "hostSetup";
    mountHostUnavailableOverlay();
    return;
  }
  if (!hostNativeAvailable()) {
    try {
      if (window.AshNative?.openAppSettings) {
        AshNative.openAppSettings("hostSetup");
        return;
      }
    } catch {}
    toast("Hosting setup is in the Phlip app");
    return;
  }
  readHostStatus();
  try { window.OnboardingBus?.emit?.("settings:open", { kind: "hostSetup" }); } catch {}
  if (typeof openNav === "function") openNav();
  if (typeof closeChannelPanel === "function" && Panel.channelOpen()) closeChannelPanel();
  sideHostMode = "hostSetup";
  mountHostSettingsOverlay("hostSetup");
}

function mountHostUnavailableOverlay() {
  if (typeof openSideOverlay === "function") {
    sideHostMode = "host";
    openSideOverlay({
      kind: "host",
      title: "Host settings",
      bodyClass: "host-settings-body",
      mount: (body) => {
        const wrap = document.createElement("div");
        wrap.className = "ss-main host-settings-main host-unavailable";
        const p = document.createElement("p");
        p.className = "channel-panel-empty host-unavailable-copy";
        p.textContent = HOSTING_UNAVAILABLE_COPY;
        wrap.appendChild(p);
        body.appendChild(wrap);
      },
    });
    return;
  }
  const overlay = document.getElementById("side-overlay");
  const body = document.getElementById("side-overlay-body");
  const title = document.getElementById("side-overlay-title");
  const back = document.getElementById("side-overlay-back");
  if (!overlay || !body) return;
  sideHostMode = "host";
  if (typeof sideOverlayKind !== "undefined") sideOverlayKind = "host";
  if (title) title.textContent = "Host settings";
  if (back) {
    back.innerHTML = typeof ic === "function" ? ic("back") : "←";
    back.onclick = (e) => {
      e.stopPropagation();
      if (typeof closeSideOverlay === "function") closeSideOverlay();
    };
  }
  body.classList.remove("server-settings-body", "host-settings-body");
  body.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "ss-main host-settings-main host-unavailable";
  const p = document.createElement("p");
  p.className = "channel-panel-empty host-unavailable-copy";
  p.textContent = HOSTING_UNAVAILABLE_COPY;
  wrap.appendChild(p);
  body.appendChild(wrap);
  overlay.hidden = false;
  overlay.setAttribute("aria-hidden", "false");
  document.getElementById("sidebar")?.classList.add("side-overlay-open");
}

function mountHostSettingsOverlay(mode) {
  if (typeof isJoinOnlyNativeShell === "function" && isJoinOnlyNativeShell()) {
    mountHostUnavailableOverlay();
    return;
  }
  sideHostMode = "hostSetup";
  const backToServer = () => {
    if (!openCurrentHostedServerSettings()) closeSideOverlay();
  };
  if (typeof openSideOverlay === "function") {
    openSideOverlay({
      kind: "hostSetup",
      title: "Hosting on this phone",
      bodyClass: "host-settings-body",
      onBack: backToServer,
      mount: (body) => {
        if (typeof fillHostSetupBody === "function") fillHostSetupBody(body);
        else body.innerHTML = `<p class="channel-panel-empty">Hosting setup requires the Phlip app.</p>`;
      },
    });
    return;
  }
  const overlay = document.getElementById("side-overlay");
  const body = document.getElementById("side-overlay-body");
  const title = document.getElementById("side-overlay-title");
  const back = document.getElementById("side-overlay-back");
  if (!overlay || !body) return;
  if (typeof sideOverlayKind !== "undefined") sideOverlayKind = "hostSetup";
  if (title) title.textContent = "Hosting setup";
  if (back) {
    back.innerHTML = typeof ic === "function" ? ic("back") : "←";
    back.onclick = (e) => {
      e.stopPropagation();
      backToServer();
    };
  }
  body.classList.remove("server-settings-body", "host-settings-body");
  body.innerHTML = "";
  if (typeof fillHostSetupBody === "function") fillHostSetupBody(body);
  else body.innerHTML = `<p class="channel-panel-empty">Hosting setup requires the Phlip app.</p>`;
  overlay.hidden = false;
  overlay.setAttribute("aria-hidden", "false");
  document.getElementById("sidebar")?.classList.add("side-overlay-open");
}


function appendHostNetworkPausedBanner(parent, setup = {}) {
  if (!setup.networkSuspended) return;
  const banner = document.createElement("div");
  banner.className = "host-network-paused";
  const offline = !!setup.networkOffline;
  banner.style.cssText = "padding:12px 14px;border-radius:12px;margin:0 0 12px;background:" +
    (!offline && setup.liveBusy ? "#FFE8E5" : "#FFF0D6") + ";";
  const bt = document.createElement("div");
  bt.style.cssText = "font-weight:700;margin-bottom:6px;";
  bt.textContent = offline
    ? (setup.networkOfflineTitle || "No network")
    : (setup.networkPauseTitle || "Hosting paused — new network");
  banner.appendChild(bt);
  const bd = document.createElement("p");
  bd.className = "side-role-hint";
  bd.style.margin = "0 0 8px";
  bd.textContent = offline
    ? (setup.networkOfflineText || "Consider using Direct connect so nearby phones can join without shared Wi‑Fi.")
    : (setup.networkPendingLabel
      ? `Approve “${setup.networkPendingLabel}” before guests can join.`
      : (setup.networkPauseText || "Tap to approve before guests can join."));
  banner.appendChild(bd);
  if (!offline) {
    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";
    const onceBtn = document.createElement("button");
    onceBtn.type = "button";
    onceBtn.className = "channel-panel-pill host-emph-btn";
    onceBtn.textContent = setup.networkApproveOnce || "Approve once";
    onceBtn.onclick = () => {
      const res = hostCall("approveHostNetwork", "once");
      toast(res?.ok === false ? res.error || "Could not approve network" : "Network approved once");
      setTimeout(() => { readHostStatus(); refreshHostSettingsPanel(); refreshHostingGuide(); }, 200);
    };
    const trustBtn = document.createElement("button");
    trustBtn.type = "button";
    trustBtn.className = "channel-panel-pill";
    trustBtn.textContent = setup.networkAlwaysTrust || "Always trust";
    trustBtn.onclick = () => {
      const res = hostCall("approveHostNetwork", "trusted");
      toast(res?.ok === false ? res.error || "Could not approve network" : "Network remembered on this phone");
      setTimeout(() => { readHostStatus(); refreshHostSettingsPanel(); refreshHostingGuide(); }, 200);
    };
    actions.appendChild(onceBtn);
    actions.appendChild(trustBtn);
    banner.appendChild(actions);
  }
  parent.appendChild(banner);
}

function appendApprovedNetworksButton(parent) {
  const netsBtn = document.createElement("button");
  netsBtn.type = "button";
  netsBtn.className = "channel-panel-pill";
  netsBtn.textContent = "Approved networks";
  netsBtn.onclick = () => { hostCall("openApprovedNetworks"); };
  parent.appendChild(netsBtn);
}

function appendHostStartButton(parent) {
  const start = document.createElement("button");
  start.type = "button";
  start.className = "channel-panel-pill host-emph-btn";
  start.textContent = "Start hosting";
  start.onclick = () => {
    const res = hostCall("startHosting");
    if (res?.ok === false) toast(res.error || "Could not start");
    else toast("Starting host…");
    setTimeout(() => { readHostStatus(); refreshHostSettingsPanel(); }, 400);
  };
  parent.appendChild(start);
}

function appendHostStopButton(parent) {
  const stop = document.createElement("button");
  stop.type = "button";
  stop.className = "server-settings-row remove-server-link host-stop-row";
  stop.textContent = "Stop hosting on this phone";
  stop.onclick = async () => {
    if (!(await ashConfirm("Stop hosting on this phone? On-device servers disappear from the rail until you start again, and connected friends will disconnect.", { danger: true }))) return;
    hostCall("stopHosting");
    toast("Hosting stopped");
    setTimeout(() => { readHostStatus(); refreshHostSettingsPanel(); }, 300);
  };
  parent.appendChild(stop);
}

/** Which hosted server cards have details expanded. Default: collapsed. */
const _hostServerExpanded = Object.create(null);
