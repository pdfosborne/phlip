/* hotspot-join-part1.js — split from hotspot-join.js (Part 3 size ceiling).
 * Load after: (prior deps); part of hotspot-join cluster.
 */

﻿/* Direct hotspot join â€” first-time Settings join + re-sync reconnect. */

let _hotspotSession = { active: false };

function hotspotApi(name, ...args) {
  if (!(window.AshNative && typeof AshNative[name] === "function")) return null;
  try {
    const raw = AshNative[name](...args);
    if (raw == null || raw === "") return {};
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    console.warn("hotspotApi", name, e);
    return { ok: false, error: String(e?.message || e) };
  }
}

window.ashHotspotSessionChanged = (info) => {
  _hotspotSession = info && info.active ? { ...info, active: true } : { active: false };
  try {
    const sid = String(_hotspotSession.serverId || "");
    for (const [id, conn] of Object.entries(S?.conns || {})) {
      if (!String(id).startsWith("srv-local-")) continue;
      const localId = id.slice("srv-local-".length);
      conn.hotspotActive = !!(_hotspotSession.active && sid && localId === sid);
    }
  } catch {}
  try { refreshHostSettingsPanel?.(); } catch {}
  try { refreshHostingGuide?.(); } catch {}
  try { removeHotspotResyncBanner?.(); } catch {}
  try { renderRail?.(); } catch {}
};

window.ashHotspotJoinReady = (payload) => {
  const joinUrl = String(payload?.joinUrl || "").trim();
  const inviteSlug = String(payload?.inviteSlug || payload?.slug || "").trim();
  const ssid = String(payload?.ssid || "").trim();
  const prefill = inviteSlug
    ? { url: joinUrl, inviteSlug }
    : joinUrl;
  try { hotspotApi("stopWatchHotspotJoin"); } catch {}
  // Drop the Wi‑Fi instructions overlay but keep _hotspotFirstJoin for welcome persist.
  try {
    document.querySelector(".hotspot-first-join-overlay")?.remove();
  } catch {}
  // Returning Direct member: rediscover Soft‑AP LAN + token reconnect (no join modal).
  try {
    const cont = continueDirectAfterSoftAp({ joinUrl, inviteSlug, ssid, fromWatch: true });
    if (cont && typeof cont.then === "function") {
      cont.then((done) => {
        if (done) return;
        if (typeof openJoinModal === "function") {
          openJoinModal(prefill);
          toast("Connected — finish joining the server");
        }
      }).catch(() => {
        if (typeof openJoinModal === "function") {
          openJoinModal(prefill);
          toast("Connected — finish joining the server");
        }
      });
      return;
    }
    if (cont) return;
  } catch (e) {
    console.warn("continueDirectAfterSoftAp", e);
  }
  if (typeof openJoinModal === "function") {
    openJoinModal(prefill);
    toast("Connected — finish joining the server");
  }
};

/** Prefer an existing Direct membership that matches Soft‑AP join context. */
function findDirectMembershipForContinue({ joinUrl, ssid, inviteSlug } = {}) {
  const conns = Object.values(S?.conns || {}).filter((c) => {
    if (!c || PersonalSpace?.isPersonal?.(c)) return false;
    if (String(c.id || "").startsWith("srv-local-")) return false;
    if (!(c.token || c.me)) return false;
    return typeof connIsDirectMembership === "function" ? connIsDirectMembership(c) : !!c.hotspotPreferred;
  });
  if (!conns.length) return null;
  const wantSsid = String(ssid || "").trim().toLowerCase();
  if (wantSsid) {
    const bySsid = conns.find((c) => {
      const saved = String(connHotspotCreds(c)?.ssid || c.hotspotSsid || "").trim().toLowerCase();
      return saved && saved === wantSsid;
    });
    if (bySsid) return bySsid;
  }
  const lan = String(joinUrl || "").trim();
  if (lan && typeof isHotspotLanUrl === "function" && isHotspotLanUrl(lan)) {
    const byLan = conns.find((c) => {
      const bases = [c.shareLan, c.urlLan, c.url].map((u) => String(u || ""));
      return bases.some((u) => u && (u.includes(lan) || lan.includes(String(c.shareLan || "").replace(/\/+$/, ""))));
    });
    if (byLan) return byLan;
  }
  const slug = String(inviteSlug || "").trim();
  if (slug) {
    const bySlug = conns.find((c) =>
      String(c.inviteSlug || c.me?.inviteSlug || "").trim() === slug);
    if (bySlug) return bySlug;
  }
  // Single Direct membership while on Soft‑AP — safe default.
  if (conns.length === 1 && (wantSsid || (lan && typeof isHotspotLanUrl === "function" && isHotspotLanUrl(lan))
    || looksLikeDirectHotspotSsid(readHotspotJoinStatus()?.connectedSsid))) {
    return conns[0];
  }
  return null;
}

/**
 * After Soft‑AP connect (watch or deep link): reconnect existing members;
 * otherwise caller opens first-join modal. Never uses WifiNetworkSpecifier.
 */
async function continueDirectAfterSoftAp(opts = {}) {
  const st = readHotspotJoinStatus?.() || null;
  const want = String(opts.ssid || "").trim().toLowerCase();
  const connected = String(st?.connectedSsid || "").trim().toLowerCase();
  const onDirectNet = !!(opts.fromWatch === true
    || st?.onHostHotspot === true
    || st?.onWatchNetwork === true
    || looksLikeDirectHotspotSsid(connected)
    || (want && connected && want === connected));
  // Don't attempt rediscover until the device is actually on Soft‑AP.
  if (!onDirectNet) return false;
  const joinUrl = String(opts.joinUrl || opts.url || "").trim();
  const conn = findDirectMembershipForContinue(opts);
  if (!conn) return false;
  toast("Welcome back — reconnecting…");
  try { if (typeof switchConn === "function") switchConn(conn.id); } catch {}
  // Prefer rediscover on Soft‑AP; if joinUrl already Soft‑AP, apply it first.
  if (joinUrl && typeof isHotspotLanUrl === "function" && isHotspotLanUrl(joinUrl)) {
    try {
      syncConnDualUrls?.(conn, { shareLan: joinUrl, joinBase: joinUrl, joinTag: conn.joinTag });
      const ws = typeof wsUrlFromHttpOrigin === "function" ? wsUrlFromHttpOrigin(joinUrl) : "";
      if (ws) conn.url = ws;
      persistConnSession?.(conn);
    } catch {}
  }
  const ok = await rediscoverAndReconnectDirect(conn);
  if (ok) toast("Reconnected");
  return ok;
}

/** Deep link / URL QR: Soft‑AP LAN → seamless reconnect when already a member. */
async function continueDirectFromJoinUrl(raw) {
  const text = String(raw || "").trim();
  if (!text) return false;
  let joinUrl = text;
  try {
    if (/^phlip:\/\/join/i.test(text)) {
      const u = new URL(text);
      joinUrl = u.searchParams.get("url") || u.searchParams.get("host") || text;
    }
  } catch {}
  if (!(typeof isHotspotLanUrl === "function" && isHotspotLanUrl(joinUrl))) {
    // Also accept ws:// Soft‑AP hosts
    try {
      const u = new URL(joinUrl.replace(/^ws/i, "http"));
      if (!(u.hostname.startsWith("192.168.43.") || u.hostname.startsWith("192.168.49.")
        || u.hostname.startsWith("192.168.75.") || u.hostname.startsWith("192.168.137."))) {
        return false;
      }
      joinUrl = u.origin;
    } catch {
      return false;
    }
  }
  return continueDirectAfterSoftAp({
    joinUrl,
    ssid: String(readHotspotJoinStatus()?.connectedSsid || "").trim(),
  });
}


/** Open the system Wiâ€‘Fi quick panel (or full Settings) so the user can switch networks. */
function openHotspotWifiPicker() {
  if (!hotspotClientAvailable() && !(window.AshNative && typeof AshNative.openWifiSettings === "function")) {
    toast("Wiâ€‘Fi picker needs the Phlip app");
    return;
  }
  const res = hotspotApi("openWifiSettings");
  if (res?.ok === false) {
    toast(res.error || "Could not open Wiâ€‘Fi settings");
    return;
  }
  toast("Pick a Wiâ€‘Fi network, then return to Phlip");
}

function hotspotClientAvailable() {
  return !!(window.AshNative && typeof AshNative.reconnectToHotspot === "function"
    && typeof AshNative.leaveDirectSession === "function");
}

function connHotspotCreds(conn) {
  if (!conn || PersonalSpace?.isPersonal?.(conn)) return null;
  if (String(conn.id || "").startsWith("srv-local-")) return null;
  let ssid = String(conn.hotspotSsid || "").trim();
  let password = String(conn.hotspotPassword || "").trim();
  if ((!ssid || !password) && typeof loadServers === "function") {
    const entry = loadServers().find((s) => s.id === conn.id);
    if (entry) {
      ssid = ssid || String(entry.hotspotSsid || "").trim();
      password = password || String(entry.hotspotPassword || "").trim();
    }
  }
  if (!ssid || !password) return null;
  return { ssid, password };
}

function connHasHotspotCreds(conn) {
  return !!connHotspotCreds(conn);
}

/** Joined server remembered as Direct (SSID and/or preferred flag), even without password. */
function connIsDirectMembership(conn) {
  if (!conn || PersonalSpace?.isPersonal?.(conn)) return false;
  if (String(conn.id || "").startsWith("srv-local-")) return false;
  if (String(conn.reachMode || "").toLowerCase() === "direct") return true;
  if (conn.hotspotPreferred) return true;
  if (String(conn.hotspotSsid || "").trim()) return true;
  try {
    const entry = typeof loadServers === "function"
      ? loadServers().find((s) => s.id === conn.id)
      : null;
    if (String(entry?.reachMode || "").toLowerCase() === "direct") return true;
    if (entry?.hotspotPreferred || String(entry?.hotspotSsid || "").trim()) return true;
  } catch {}
  return false;
}

function looksLikeDirectHotspotSsid(ssid) {
  const s = String(ssid || "").trim();
  if (!s) return false;
  return /^phlip-/i.test(s)
    || /^AndroidShare_/i.test(s)
    || /^AndroidAP/i.test(s)
    || /^DIRECT-/i.test(s);
}

function isHotspotLanUrl(url) {
  try {
    const u = new URL(String(url || "").trim());
    const host = u.hostname || "";
    return host.startsWith("192.168.43.")
      || host.startsWith("192.168.49.")
      || host.startsWith("192.168.75.")
      || host.startsWith("192.168.137.");
  } catch {
    return /192\.168\.(43|49|75|137)\./.test(String(url || ""));
  }
}

function readHotspotJoinStatus() {
  return hotspotApi("hotspotJoinStatus") || null;
}

/** Apply Direct Soft-AP creds from welcome / hotspotSession / shareReach. */
function applyHotspotSessionFields(conn, m) {
  if (!conn || !m || typeof m !== "object") return;
  if (String(conn.id || "").startsWith("srv-local-")) return;
  if ("reachMode" in m) {
    const mode = String(m.reachMode || "").trim().toLowerCase();
    if (mode === "direct" || mode === "local") {
      conn.reachMode = mode;
      if (mode === "direct") {
        conn.hotspotPreferred = true;
        try { upsertServerEntry?.({ id: conn.id, reachMode: "direct", hotspotPreferred: true }); } catch {}
      } else {
        // Host edited back to Local â€” drop Direct preference (creds may remain unused).
        conn.hotspotPreferred = false;
        try { upsertServerEntry?.({ id: conn.id, reachMode: "local", hotspotPreferred: false }); } catch {}
      }
    }
  }
  const active = m.hotspotActive === true || m.active === true
    || (m.hotspotSsid != null && String(m.hotspotSsid).trim());
  const ssid = m.hotspotSsid == null || m.hotspotSsid === ""
    ? ""
    : String(m.hotspotSsid).trim();
  const password = m.hotspotPassword == null || m.hotspotPassword === ""
    ? ""
    : String(m.hotspotPassword).trim();
  if (active && ssid) {
    if (password && typeof persistConnHotspotCreds === "function") {
      persistConnHotspotCreds(conn, ssid, password);
    } else {
      conn.hotspotSsid = ssid;
      conn.hotspotPreferred = true;
      if (password) conn.hotspotPassword = password;
      try {
        upsertServerEntry?.({
          id: conn.id,
          hotspotSsid: ssid,
          hotspotPassword: password || conn.hotspotPassword || "",
          hotspotPreferred: true,
        });
      } catch {}
    }
    try { renderSidebar?.(true); renderRail?.(); } catch {}
    return;
  }
  if (String(conn.reachMode || "").toLowerCase() === "direct") {
    conn.hotspotPreferred = true;
  }
  if (m.type === "hotspotSession" && m.active === false) {
    // Soft-AP ended â€” keep Direct lock + saved creds until host switches to Local.
    try { renderSidebar?.(true); } catch {}
  }
}

/** After welcome: remember Direct Wiâ€‘Fi so Rejoin + Direct glyph work on this device. */
function rememberDirectSessionOnWelcome(conn) {
  if (!conn || PersonalSpace?.isPersonal?.(conn)) return;
  if (String(conn.id || "").startsWith("srv-local-")) return;
  if (String(conn.reachMode || "").toLowerCase() === "direct") {
    conn.hotspotPreferred = true;
    try { upsertServerEntry?.({ id: conn.id, hotspotPreferred: true, reachMode: "direct" }); } catch {}
  }
  const pending = (typeof _hotspotFirstJoin !== "undefined" && _hotspotFirstJoin) || null;
  if (pending?.ssid && pending?.password && typeof persistConnHotspotCreds === "function") {
    persistConnHotspotCreds(conn, pending.ssid, pending.password);
    try { _hotspotFirstJoin = null; } catch {}
    return;
  }
  const st = readHotspotJoinStatus();
  const connected = String(st?.connectedSsid || "").trim();
  const existingPass = String(conn.hotspotPassword || "").trim();
  const joinBase = conn._joinHttpBase || conn.shareLan || conn.urlLan || conn.url || "";
  const onDirectNet = looksLikeDirectHotspotSsid(connected)
    || !!st?.onWatchNetwork
    || isHotspotLanUrl(joinBase);
  if (connected && onDirectNet) {
    if (existingPass && typeof persistConnHotspotCreds === "function") {
      persistConnHotspotCreds(conn, connected, existingPass);
    } else {
      conn.hotspotSsid = connected;
      conn.hotspotPreferred = true;
      try {
        upsertServerEntry?.({
          id: conn.id,
          hotspotSsid: connected,
          hotspotPreferred: true,
        });
      } catch {}
    }
  } else if (onDirectNet) {
    conn.hotspotPreferred = true;
    try { upsertServerEntry?.({ id: conn.id, hotspotPreferred: true }); } catch {}
  }
}


let _hotspotReconnectWaiter = null;

window.ashHotspotReconnectResult = (payload) => {
  const waiter = _hotspotReconnectWaiter;
  _hotspotReconnectWaiter = null;
  try { waiter?.(payload || {}); } catch (e) { console.warn("ashHotspotReconnectResult", e); }
};


/**
 * Soft-AP gateway probe by joinTag â€” refreshes LAN URL then token-reconnects.
 * Same membership; only transport (SSID/IP) changes.
 * Explicit Rejoin / post-Wiâ€‘Fi only â€” never from network-change or resolveConnUrl.
 */
let _directRediscoverInflight = null;
async function rediscoverAndReconnectDirect(conn) {
  if (_directRediscoverInflight) return _directRediscoverInflight;
  _directRediscoverInflight = (async () => {
    const tag = String(conn?.joinTag || "").trim();
    if (!tag) {
      toast("Missing server id â€” open Add a server (Nearby) once");
      return false;
    }
    toast("Finding host on Direct Wiâ€‘Fiâ€¦");
    let res = null;
    try {
      res = hotspotApi("rediscoverDirectServer", tag);
    } catch (e) {
      console.warn("rediscoverDirectServer", e);
    }
    if (!res?.ok) {
      await new Promise((r) => setTimeout(r, 500));
      try { res = hotspotApi("rediscoverDirectServer", tag); } catch {}
    }
    if (!res?.ok) {
      toast(res?.error || "Host not found on this Wiâ€‘Fi â€” wait a moment and try Rejoin");
      return false;
    }
    const shareLan = String(res.shareLan || "").trim();
    const wsUrl = String(res.url || "").trim();
    const newSsid = String(res.ssid || "").trim();
    if (shareLan || wsUrl) {
      try {
        syncConnDualUrls?.(conn, {
          shareLan: shareLan || undefined,
          joinTag: tag,
          joinBase: shareLan || undefined,
        });
      } catch {}
      if (wsUrl) conn.url = wsUrl;
      if (shareLan) {
        conn.shareLan = shareLan;
        conn.urlLan = wsUrl || conn.urlLan;
      }
    }
    if (newSsid) {
      const pass = connHotspotCreds(conn)?.password || conn.hotspotPassword || "";
      if (pass) persistConnHotspotCreds(conn, newSsid, pass);
      else {
        conn.hotspotSsid = newSsid;
        try { upsertServerEntry?.({ id: conn.id, hotspotSsid: newSsid, hotspotPreferred: true }); } catch {}
      }
    }
    try { persistConnSession?.(conn); } catch {}
    toast("Connected to host Wiâ€‘Fi");
    if (typeof connect === "function") connect(conn);
    try { renderSidebar?.(true); renderRail?.(); } catch {}
    setTimeout(() => { try { renderSidebar?.(true); } catch {} }, 800);
    return true;
  })().finally(() => { _directRediscoverInflight = null; });
  return _directRediscoverInflight;
}


function removeHotspotResyncBanner() {
  document.getElementById("hotspot-resync-banner")?.remove();
}

function persistConnHotspotCreds(conn, ssid, password) {
  if (!conn) return;
  conn.hotspotSsid = ssid;
  conn.hotspotPassword = password;
  conn.hotspotPreferred = true;
  try { upsertServerEntry?.({ id: conn.id, hotspotSsid: ssid, hotspotPassword: password, hotspotPreferred: true }); } catch {}
}

/** Resolve Direct Soft‑AP join payload from host status row, session, or hosted conn. */
