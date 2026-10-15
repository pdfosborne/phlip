/* Dual-path transport: prefer LAN on trusted Wi‑Fi, fall back to public tunnel. */

let _networkChangeTimer = null;
const PATH_NETWORK_DEBOUNCE_MS = 1200;
const PATH_LAN_HOLD_MS = 2000;
const PATH_LAN_UPGRADE_MS = 2000;

function clientNetworkTrust() {
  try {
    const raw = window.AshNative?.getNetworkTrust?.();
    if (raw) return String(raw).trim().toLowerCase();
  } catch {}
  if (window._ashNetworkTrust) return String(window._ashNetworkTrust).trim().toLowerCase();
  return "unknown";
}

/** GET /ash-ok with short timeout; optional joinTag match when server returns it. */
async function probeLanBase(httpBase, joinTag = "", timeoutMs = 800) {
  const base = normalizeDualHttpOrigin(httpBase);
  if (!base) return false;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/ash-ok`, {
      method: "GET",
      signal: ctrl.signal,
      cache: "no-store",
      mode: "cors",
      credentials: "same-origin",
    });
    if (!res.ok) return false;
    const text = await res.text();
    try {
      const parsed = JSON.parse(text);
      const want = normJoinTag(joinTag);
      if (want && parsed?.joinTag) {
        return normJoinTag(parsed.joinTag) === want;
      }
      return parsed?.ok === true || parsed?.name != null;
    } catch {
      return /^\s*\{/.test(text);
    }
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** Apply NSD-resolved LAN URL into conn + persist. */
function applyNsdLanUrl(conn, nsd) {
  if (!conn || !nsd?.url) return;
  const httpBase = typeof httpBaseFromUrl === "function"
    ? httpBaseFromUrl(nsd.url)
    : normalizeDualHttpOrigin(nsd.url);
  syncConnDualUrls(conn, {
    shareLan: httpBase || nsd.shareLan || "",
    joinTag: nsd.sid || conn.joinTag || "",
    joinBase: httpBase || "",
  });
  if (typeof persistConnSession === "function") {
    persistConnSession(conn, typeof dualUrlPersistFields === "function" ? dualUrlPersistFields(conn) : {});
  }
}

/** Resolve LAN base via Android NSD (joined members only; trusted Wi‑Fi). */
async function resolveLanViaNsd(joinTag, timeoutMs = 700) {
  const tag = normJoinTag(joinTag);
  if (!tag) return null;
  try {
    const raw = window.AshNative?.resolveJoinTag?.(tag, timeoutMs);
    if (!raw) return null;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed?.ok || !parsed?.url) return null;
    return parsed;
  } catch {
    return null;
  }
}

function logPathFlip(conn, fromPath, toPath, fromUrl, toUrl) {
  try {
    if (fromPath === toPath && fromUrl === toUrl) return;
    if (typeof console !== "undefined" && console.debug) {
      console.debug("[AshPath]", conn?.name || conn?.id, fromPath || "?", "→", toPath || "?", toUrl || "");
    }
  } catch {}
}

/** True when this conn already has a live HTTP poll or WS handshake. */
function connTransportHealthy(conn) {
  if (!conn) return false;
  if (conn._transport === "http") {
    return conn.status === "online" || conn.status === "connecting";
  }
  try {
    const ws = conn.ws;
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) {
      return conn.status === "online" || conn.status === "connecting";
    }
  } catch {}
  return false;
}

/**
 * Online-on-LAN must not bounce to public on one failed probe.
 * First miss (or another miss inside the hold window) stays on LAN.
 */
function shouldHoldLanPath(conn, resolvedPath, now) {
  if (!conn || resolvedPath !== "public") return false;
  if ((conn.activePath || "") !== "lan") return false;
  if (!connTransportHealthy(conn)) return false;
  const lastFail = Number(conn._lanProbeFailAt) || 0;
  const t = now || Date.now();
  if (!lastFail) return true;
  return (t - lastFail) < PATH_LAN_HOLD_MS;
}

function scheduleConnPathRecheck(conn, delayMs) {
  if (!conn || conn._pathRecheckTimer) return;
  conn._pathRecheckTimer = setTimeout(() => {
    conn._pathRecheckTimer = null;
    if (typeof reevaluateConnPath === "function") reevaluateConnPath(conn);
  }, delayMs);
}

/** One delayed LAN probe after landing on public while Wi-Fi is trusted. */
function maybeScheduleLanUpgrade(conn) {
  if (!conn) return;
  if ((conn.activePath || "") !== "public") return;
  if (clientNetworkTrust() !== "trusted") return;
  scheduleConnPathRecheck(conn, PATH_LAN_UPGRADE_MS);
}

/**
 * Pick ws/wss URL for this conn. Host bridge + personal are unchanged.
 * @returns {{ url: string, path: "lan"|"public" }}
 */
async function resolveConnUrl(conn) {
  if (!conn || PersonalSpace.isPersonal(conn)) {
    return { url: conn?.url || "", path: conn?.activePath || "" };
  }
  if (String(conn.id || "").startsWith("srv-local-")) {
    return { url: conn.url, path: "lan" };
  }
  syncConnDualUrls(conn);
  const publicUrl = conn.urlPublic || (/^wss:/i.test(conn.url) ? conn.url : "");
  const lanUrl = conn.urlLan || (/^ws:/i.test(conn.url) && !/^wss:/i.test(conn.url) ? conn.url : "");
  const fallback = publicUrl || lanUrl || conn.url || "";

  const trust = clientNetworkTrust();
  if (trust === "cellular" || trust === "unknown" || !lanUrl) {
    return { url: fallback, path: publicUrl && fallback === publicUrl ? "public" : (lanUrl && fallback === lanUrl ? "lan" : "") };
  }
  // v1: only TRUSTED networks attempt LAN probe (ONCE stays public until promoted).
  if (trust !== "trusted") {
    return { url: fallback, path: publicUrl && fallback === publicUrl ? "public" : "" };
  }

  const storedLanHttp = conn.shareLan || normalizeDualHttpOrigin(lanUrl);

  // Direct-locked: Soft-AP LAN only — never home Wi‑Fi NSD dual-path.
  if (typeof connIsDirectMembership === "function" && connIsDirectMembership(conn)) {
    const directHttp = (storedLanHttp && typeof isHotspotLanUrl === "function" && isHotspotLanUrl(storedLanHttp))
      ? storedLanHttp
      : "";
    if (directHttp) {
      const ok = await probeLanBase(directHttp, conn.joinTag);
      if (ok) {
        const ws = (typeof wsUrlFromHttpOrigin === "function")
          ? wsUrlFromHttpOrigin(directHttp)
          : lanUrl;
        return { url: ws || lanUrl, path: "lan" };
      }
    }
    return {
      url: publicUrl || fallback,
      path: publicUrl && (publicUrl === fallback || !directHttp) ? "public" : (lanUrl ? "lan" : ""),
    };
  }

  const nsdPromise = resolveLanViaNsd(conn.joinTag);
  const storedProbe = storedLanHttp
    ? probeLanBase(storedLanHttp, conn.joinTag).then((ok) => (ok ? { url: lanUrl, http: storedLanHttp, via: "stored" } : null))
    : Promise.resolve(null);

  const nsdProbe = nsdPromise.then(async (nsd) => {
    if (!nsd?.url) return null;
    applyNsdLanUrl(conn, nsd);
    const http = conn.shareLan || normalizeDualHttpOrigin(nsd.url);
    const ok = await probeLanBase(http, conn.joinTag);
    if (!ok) return null;
    return { url: conn.urlLan || nsd.url, http, via: "nsd" };
  });

  const winner = await Promise.race([
    storedProbe.then((r) => r || new Promise(() => {})),
    nsdProbe.then((r) => r || new Promise(() => {})),
    new Promise((resolve) => setTimeout(() => resolve(null), 850)),
  ]);

  if (winner?.url) {
    return { url: winner.url, path: "lan" };
  }
  return { url: publicUrl || fallback, path: "public" };
}

/** Debounced re-eval when Android reports a network change or app resumes. */
function onNetworkPossiblyChanged() {
  if (typeof isServedOrigin === "function" && isServedOrigin()) return;
  if (_networkChangeTimer) clearTimeout(_networkChangeTimer);
  _networkChangeTimer = setTimeout(() => {
    _networkChangeTimer = null;
    for (const c of Object.values(S.conns || {})) {
      if (!c || PersonalSpace.isPersonal(c)) continue;
      if (String(c.id).startsWith("srv-local-")) continue;
      if (!c.token && !c.joinIntent) continue;
      reevaluateConnPath(c);
    }
  }, PATH_NETWORK_DEBOUNCE_MS);
}

/** Switch transport if a better path is available; reconnect in-flight sessions. */
async function reevaluateConnPath(conn) {
  if (!conn || conn._pathResolving) return;
  conn._pathResolving = true;
  try {
    const prevUrl = conn.url;
    const prevPath = conn.activePath;
    const wasHealthy = connTransportHealthy(conn);
    const resolved = await resolveConnUrl(conn);
    if (!resolved.url) return;
    const pathChanged = resolved.url !== prevUrl || resolved.path !== prevPath;
    if (!pathChanged) {
      conn.activePath = resolved.path || conn.activePath;
      if (conn.activePath === "lan") conn._lanProbeFailAt = 0;
      return;
    }

    if (shouldHoldLanPath(conn, resolved.path)) {
      if (!conn._lanProbeFailAt) conn._lanProbeFailAt = Date.now();
      scheduleConnPathRecheck(conn, PATH_LAN_HOLD_MS);
      return;
    }

    conn._lanProbeFailAt = 0;
    if (conn._pathRecheckTimer) {
      clearTimeout(conn._pathRecheckTimer);
      conn._pathRecheckTimer = null;
    }
    logPathFlip(conn, prevPath, resolved.path, prevUrl, resolved.url);
    if (typeof clearConnReconnect === "function") clearConnReconnect(conn);
    if (typeof stopHttpTransport === "function") stopHttpTransport(conn);
    if (typeof retireConnSocket === "function") retireConnSocket(conn);
    else {
      try { conn.ws?.close(); } catch {}
      conn.ws = null;
    }
    conn.url = resolved.url;
    conn.activePath = resolved.path || conn.activePath;
    persistConnSession(conn);
    if (conn.status !== "waiting") {
      conn.status = wasHealthy && conn.me ? "online" : (conn.status === "offline" ? "connecting" : conn.status);
    }
    if (conn.token || conn.joinIntent) connect(conn);
    try { renderConnStatus(); } catch {}
    maybeScheduleLanUpgrade(conn);
  } finally {
    conn._pathResolving = false;
  }
}

window.ashNetworkChanged = (trustJson) => {
  try {
    if (trustJson && typeof trustJson === "object") {
      window._ashNetworkTrust = String(trustJson.trust || trustJson.level || "").toLowerCase();
    }
    const trust = clientNetworkTrust();
    if (trust === "trusted" && window.AshNative?.startMemberDiscovery) {
      try { window.AshNative.startMemberDiscovery(); } catch {}
    } else if (window.AshNative?.stopMemberDiscovery) {
      try { window.AshNative.stopMemberDiscovery(); } catch {}
    }
  } catch {}
  onNetworkPossiblyChanged();
  // Refresh Direct session Leave/Rejoin when Wi‑Fi changes.
  try { renderSidebar?.(true); } catch {}
};
