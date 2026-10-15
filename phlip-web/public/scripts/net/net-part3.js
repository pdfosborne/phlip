/* net-part3.js — split from net.js (Part 3 size ceiling).
 * Load after: net-part2.js; part of net cluster.
 */

function stripLivePic(user) {
  if (!user || !user.livePic) return user;
  const { livePic, ...rest } = user;
  return rest;
}

function stripRoutinePlaintext(routine) {
  if (!routine) return routine;
  const { _title, _where, _subtitle, ...sealed } = routine;
  return sealed;
}

function stripTaskPlaintext(task) {
  if (!task) return task;
  const { _text, _taskOptimistic, ...sealed } = task;
  return sealed;
}

function stripPollPlaintext(poll) {
  if (!poll) return poll;
  const { _question, _pollOptimistic, options, ...sealed } = poll;
  return {
    ...sealed,
    options: (options || []).map(opt => {
      if (!opt) return opt;
      const { _label, ...rest } = opt;
      return rest;
    }),
  };
}

const _cacheConnTimers = new Map();
function cacheConn(conn, immediate = false) {
  if (!conn || PersonalSpace.isPersonal(conn)) return;
  const id = conn.id || "";
  if (!immediate) {
    const prev = _cacheConnTimers.get(id);
    if (prev) clearTimeout(prev);
    _cacheConnTimers.set(id, setTimeout(() => cacheConn(conn, true), 200));
    return;
  }
  _cacheConnTimers.delete(id);
  if (typeof LocalSyncStore !== "undefined" && LocalSyncStore.isReady()
      && LocalSyncStore.persistConn(conn)) return;
  localStorage.setItem(`ash_cache_${conn.id}`, JSON.stringify({
    hostName: conn.hostName, iconText: conn.iconText || "",
    serverPic: conn.serverPic || "",
    me: stripLivePic(conn.me),
    // Live camera photos are session-only — never freeze them in the offline cache.
    members: (conn.members || []).map(stripLivePic),
    channels: conn.channels, events: conn.events,
    availabilities: conn.availabilities || [],
    timeBlocks: conn.timeBlocks || [],
    categories: conn.categories || [],
    eventTypes: conn.eventTypes || [], reactionCards: conn.reactionCards || [], customRoles: conn.customRoles || [],
    eventRolePerms: conn.eventRolePerms || null,
    cardCats: conn.cardCats || {}, cardDurations: conn.cardDurations || {}, locations: conn.locations || [],
    ts: Date.now(),
    lastSyncAt: Number(conn.lastSyncAt) || Date.now(),
  }));
}

/** Keep the rail icon on the device so it still shows when the host is offline. */
function persistServerIcon(conn) {
  if (!conn || PersonalSpace.isPersonal(conn)) return;
  try {
    upsertServerEntry({
      id: conn.id,
      iconText: conn.iconText || "",
      serverPic: conn.serverPic || "",
      name: conn.name || conn.hostName || "",
    });
    cacheConn(conn);
  } catch {}
}
function loadCache(id) {
  try {
    const indexed = typeof LocalSyncStore !== "undefined" ? LocalSyncStore.peek(id) : null;
    if (indexed) return indexed;
  } catch {}
  try {
    const cached = JSON.parse(localStorage.getItem(`ash_cache_${id}`) || "null");
    if (!cached) return null;
    if (cached.me) cached.me = stripLivePic(cached.me);
    if (Array.isArray(cached.members)) cached.members = cached.members.map(stripLivePic);
    return cached;
  } catch { return null; }
}

async function requestSliceSync(conn) {
  if (!conn || PersonalSpace.isPersonal(conn) || !conn.me?.id || conn._sliceRequestedForSession) return false;
  if (typeof LocalSyncStore === "undefined" || !LocalSyncStore.isReady()) return false;
  conn._sliceRequestedForSession = true;
  try {
    const manifest = await LocalSyncStore.manifestFor(conn);
    sendTo(conn, {
      type: "syncRequest",
      protocol: 1,
      principalId: conn.me.id,
      manifest,
    });
    return true;
  } catch (err) {
    conn._sliceRequestedForSession = false;
    console.warn("slice sync request failed", err);
    return false;
  }
}

function stopHeartbeat(conn) {
  if (conn._heartbeat) {
    clearInterval(conn._heartbeat);
    conn._heartbeat = null;
  }
}

function stopHttpTransport(conn) {
  signalHttpLeave(conn);
  conn._transport = null;
  if (conn._httpAbort) {
    try { conn._httpAbort.abort(); } catch {}
    conn._httpAbort = null;
  }
}

/** Tell the host this HTTP session is gone so presence drops immediately. */
function signalHttpLeave(conn) {
  if (!conn || PersonalSpace.isPersonal(conn) || !conn.token) return;
  if (conn._transport !== "http" && !/^wss:/i.test(conn.url || "")) return;
  const base = httpBaseFromConn(conn);
  if (!base) return;
  const token = conn.token;
  try {
    fetch(`${base}/ash-leave`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Ash-Token": token,
      },
      body: JSON.stringify({ token }),
      keepalive: true,
      credentials: /^https:/i.test(base) ? "include" : "same-origin",
      cache: "no-store",
      mode: "cors",
    }).catch(() => {});
  } catch {}
}

function httpBaseFromUrl(url) {
  return String(url || "")
    .replace(/^wss:\/\//i, "https://")
    .replace(/^ws:\/\//i, "http://")
    .replace(/\/+$/, "")
    .replace(/\/ws$/i, "");
}

function httpBaseFromConn(conn) {
  return httpBaseFromUrl(conn?.url);
}

function startHeartbeat(conn) {
  stopHeartbeat(conn);
  // Cloudflare idle-closes WebSockets after ~100s with no traffic; browsers
  // can't send WS ping frames, so send a tiny app-level ping instead.
  conn._heartbeat = setInterval(() => {
    if (!conn.ws || conn.ws.readyState !== WebSocket.OPEN) return;
    try { conn.ws.send(JSON.stringify({ type: "ping" })); } catch {}
  }, 25000);
}

/** Public HTTPS: long-poll instead of WSS (Cloudflare + NanoHTTPD drops sockets). */
function startHttpTransport(conn) {
  if (!conn.token) return;
  stopHeartbeat(conn);
  stopHttpTransport(conn);
  if (typeof retireConnSocket === "function") retireConnSocket(conn);
  else if (conn.ws) {
    try {
      conn.ws.onclose = null;
      conn.ws.close();
    } catch {}
    conn.ws = null;
  }
  conn._transport = "http";
  conn.status = conn.me ? "online" : "connecting";
  if (conn.me) markConnSynced(conn);
  renderConnStatus();
  if (conn.me) flushOutbox(conn);
  const ac = new AbortController();
  conn._httpAbort = ac;
  const base = httpBaseFromConn(conn);

  const markSessionDead = (error) => {
    // Token no longer maps to a member — treat as removal (drop rail + personal note).
    applyRemovedFromServer(conn, error || "Removed from this server");
  };

  const loop = async () => {
    while (S.conns[conn.id] === conn && conn._transport === "http" && !ac.signal.aborted) {
      try {
        if (!conn.token) return;
        const url = `${base}/ash-poll`;
        const res = await serverFetch(url, {
          method: "GET",
          signal: ac.signal,
          headers: {
            "X-Ash-Token": conn.token || "",
          },
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          const errText = String(errBody.error || "");
          if (res.status === 403 || errBody.type === "kicked") {
            markSessionDead(errText || "Removed from this server");
            return;
          }
          throw new Error(`poll ${res.status}`);
        }
        const data = await res.json();
        // Invite-tier stub while member bind propagates — keep retrying quietly.
        if (data?.type === "error" && /waiting for the host to approve/i.test(data.error || "")) {
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }
        conn.status = "online";
        conn.retryDelay = 2000;
        markConnSynced(conn);
        renderConnStatus();
        const msgs = Array.isArray(data.messages) ? data.messages : [];
        for (const m of msgs) {
          if (m && m.type === "pong") continue;
          handle(conn, m);
          if (conn._removedHandled || !S.conns[conn.id]) return;
        }
        flushOutbox(conn);
      } catch (err) {
        if (ac.signal.aborted || S.conns[conn.id] !== conn || conn._transport !== "http") return;
        if (conn.status !== "waiting") {
          markConnDisconnected(conn);
          conn.status = "offline";
          conn._lastLivePicSent = "";
        }
        renderConnStatus();
        try { await tryFetchRelayCache(conn); } catch {}
        await new Promise((r) => setTimeout(r, Math.min(conn.retryDelay || 2000, 5000)));
        conn.retryDelay = Math.min((conn.retryDelay || 2000) * 1.5, 15000);
      }
    }
  };
  loop();
}

/** Drop a socket without letting onclose paint offline or schedule reconnect. */
function retireConnSocket(conn, socket) {
  const ws = socket || (conn && conn.ws);
  if (!ws) return false;
  try {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
  } catch {}
  if (conn && conn.ws === ws) conn.ws = null;
  try { ws.close(); } catch {}
  return true;
}

function clearConnReconnect(conn) {
  if (!conn || !conn._reconnectTimer) return;
  clearTimeout(conn._reconnectTimer);
  conn._reconnectTimer = null;
}

async function httpRpc(conn, m) {
  if (!conn.token) return "failed";
  ensureClientActionIds(m);
  const base = httpBaseFromConn(conn);
  try {
    const res = await serverFetch(`${base}/ash-rpc`, {
      method: "POST",
      // charset=UTF-8 is required: NanoHTTPD defaults bare application/json
      // to US-ASCII and turns reaction emoji into � replacement chars.
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Ash-Token": conn.token || "",
      },
      body: JSON.stringify({ ...m, token: conn.token }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 || data.type === "kicked") {
      applyRemovedFromServer(conn, data.error || "Removed from this server");
      return "failed";
    }
    // Edge KV member bind can lag Approve by a beat — don't toast a false "waiting".
    if (data.type === "error" && /waiting for the host to approve/i.test(data.error || "")) {
      return "invite_lag";
    }
    if (!res.ok || data.type === "error") {
      const error = data.error || `${conn.name || conn.hostName || "Server"} rejected that action`;
      toast(error);
      return "failed";
    }
    const msgs = Array.isArray(data.messages) ? data.messages : [];
    for (const msg of msgs) {
      if (msg && msg.type === "pong") continue;
      handle(conn, msg);
    }
    return "sent";
  } catch {
    if (queueUnreachable(conn, m)) return "queued";
    toast(`${conn.name || conn.hostName || "Server"} is unreachable`);
    return "failed";
  }
}

function connect(conn) {
  if (conn?.demo || PersonalSpace.isPersonal(conn)) { conn.status = "online"; return; }
  if (conn?.drive) {
    if (typeof driveStartSync === "function") driveStartSync(conn);
    else conn.status = "online";
    return;
  }
  // Host bridge is always loopback — skip dual-path resolution (avoids races).
  if (String(conn.id || "").startsWith("srv-local-")) {
    connectCore(conn);
    return;
  }
  if (typeof resolveConnUrl === "function" && !conn._pathResolving) {
    conn._pathResolving = true;
    Promise.resolve(resolveConnUrl(conn)).then((resolved) => {
      conn._pathResolving = false;
      if (!S.conns[conn.id] || S.conns[conn.id] !== conn) return;
      if (resolved?.url && resolved.url !== conn.url) {
        stopHttpTransport(conn);
        if (typeof clearConnReconnect === "function") clearConnReconnect(conn);
        if (typeof retireConnSocket === "function") retireConnSocket(conn);
        else {
          try { conn.ws?.close(); } catch {}
          conn.ws = null;
        }
        conn.url = resolved.url;
        conn.activePath = resolved.path || conn.activePath;
        persistConnSession(conn);
      } else if (resolved?.path) {
        conn.activePath = resolved.path;
      }
      if (typeof maybeScheduleLanUpgrade === "function") maybeScheduleLanUpgrade(conn);
      connectCore(conn);
    }).catch(() => {
      conn._pathResolving = false;
      connectCore(conn);
    });
    return;
  }
  connectCore(conn);
}

function connectCore(conn) {
  if (conn?.demo || PersonalSpace.isPersonal(conn)) { conn.status = "online"; return; }
  // Public tunnel: skip flaky WSS and use HTTP long-poll (same path as join).
  if (/^wss:/i.test(conn.url) && conn.token && !conn.joinIntent) {
    startHttpTransport(conn);
    return;
  }
  stopHttpTransport(conn);
  // Already opening/open on this conn — don't spawn a second socket (reconnect storm).
  if (conn.ws && (conn.ws.readyState === WebSocket.CONNECTING || conn.ws.readyState === WebSocket.OPEN)) {
    return;
  }
  if (conn._reconnectTimer) {
    clearTimeout(conn._reconnectTimer);
    conn._reconnectTimer = null;
  }
  stopHeartbeat(conn);

  const proto = conn.url.startsWith("wss:") ? "wss" : "ws";
  const rest = conn.url.replace(/^wss?:\/\//, "");
  let ws;
  try { ws = new WebSocket(`${proto}://${rest}`); } catch {
    markConnDisconnected(conn);
    conn.status = "offline";
    renderConnStatus();
    return;
  }

  // Retire the previous socket without letting its onclose schedule another connect.
  const prev = conn.ws;
  conn.ws = ws;
  conn._wsOpened = false;
  if (prev && prev !== ws) {
    if (typeof retireConnSocket === "function") retireConnSocket(conn, prev);
    else {
      try {
        prev.onopen = null;
        prev.onmessage = null;
        prev.onerror = null;
        prev.onclose = null;
        prev.close();
      } catch {}
    }
  }

  ws.onopen = () => {
    if (conn.ws !== ws) return;
    conn._wsOpened = true;
    conn.retryDelay = 2000;
    conn.status = "connecting";
    if (conn.token)
      sendTo(conn, { type: "join", token: conn.token, pass: conn.pass || "" });
    else if (conn.joinIntent)
      sendTo(conn, {
        type: "join",
        name: conn.joinIntent.name,
        invite: conn.joinIntent.invite || "",
        inviteSlug: conn.joinIntent.inviteSlug || "",
        fingerprint: conn.joinIntent.fingerprint || "",
        authVerifier: conn.joinIntent.authVerifier || "",
        identityId: conn.joinIntent.identityId || "",
        identityPub: conn.joinIntent.identityPub || "",
      });
    else {
      // Opened with neither token nor join intent — close so we don't hang.
      try { ws.close(); } catch {}
    }
    startHeartbeat(conn);
    renderConnStatus();
  };

  // If the TCP/WSS handshake never completes (common through some tunnels).
  if (conn.joinIntent) {
    setTimeout(() => {
      if (conn._wsOpened || !conn.joinIntent) return;
      if (conn.ws !== ws) return;
      try { ws.close(); } catch {}
      document.dispatchEvent(new CustomEvent("ash:conn-status", {
        detail: { connId: conn.id, status: "error", error: "WebSocket timed out — toggle Public off/on on the host and retry." },
      }));
    }, 15000);
  }

  ws.onerror = () => {
    if (conn.ws !== ws) return;
    if (conn.joinIntent && !conn._wsOpened) {
      document.dispatchEvent(new CustomEvent("ash:conn-status", {
        detail: { connId: conn.id, status: "error", error: `Couldn't reach the server${conn._joinHost ? ` (${conn._joinHost})` : ""}. Check the join code and your connection.` },
      }));
    }
  };

  ws.onmessage = (e) => {
    if (conn.ws !== ws) return;
    let m;
    try { m = JSON.parse(e.data); } catch (err) {
      console.warn("bad ws message", err);
      return;
    }
    if (m && m.type === "pong") return;
    handle(conn, m);
  };

  ws.onclose = () => {
    // Superseded by a newer connect() — do not reconnect or flash offline.
    if (conn.ws !== ws) return;
    stopHeartbeat(conn);
    conn.ws = null;
    // Failed initial join — don't spin retry loops while the modal is waiting.
    if (conn.joinIntent && !conn._wsOpened) {
      document.dispatchEvent(new CustomEvent("ash:conn-status", {
        detail: { connId: conn.id, status: "error", error: "Couldn't reach the server. Check the join code and try again." },
      }));
      delete S.conns[conn.id];
      return;
    }
    // Public: after a token is known, prefer HTTP transport over fighting WSS.
    if (/^wss:/i.test(conn.url) && conn.token && !conn.joinIntent) {
      startHttpTransport(conn);
      return;
    }
    // Keep joinIntent / waiting semantics across blips — only paint offline when
    // we weren't mid-approval; reconnect will re-send joinIntent or token.
    if (conn.status !== "waiting") {
      markConnDisconnected(conn);
      conn.status = "offline";
      conn._lastLivePicSent = ""; // re-publish face on next online
    }
    renderConnStatus();
    try { tryFetchRelayCache(conn); } catch {}
    if (S.conns[conn.id] !== conn) return; // removed server — stop retrying
    // While waiting for host Approve, retry quickly — Approve may already be queued.
    const delay = conn.status === "waiting" || conn.joinIntent
      ? Math.min(conn.retryDelay || 2000, 2000)
      : (conn.retryDelay || 2000);
    if (conn._reconnectTimer) clearTimeout(conn._reconnectTimer);
    conn._reconnectTimer = setTimeout(() => {
      conn._reconnectTimer = null;
      connect(conn);
    }, delay);
    conn.retryDelay = Math.min((conn.retryDelay || 2000) * 1.5, 30000);
  };
}

// Renders just the bits that show a conn's live status (rail dots, reconnect
// banner) without a full re-render — called on every open/close so switching
// networks doesn't feel laggy.
let _reconnectBannerTimer = null;
function renderConnStatus() {
  renderRail();
  const c = activeConn();
  const el = $("#reconnect");
  if (!el) return;
  if (!c || PersonalSpace.isPersonal(c) || !c.me || isHostedBridgeConn(c)) {
    if (_reconnectBannerTimer) {
      clearTimeout(_reconnectBannerTimer);
      _reconnectBannerTimer = null;
    }
    el.classList.remove("on", "is-soft", "is-syncing");
    return;
  }
  const feel = connFeelState(c);
  if (feel.state === "connected") {
    if (_reconnectBannerTimer) {
      clearTimeout(_reconnectBannerTimer);
      _reconnectBannerTimer = null;
    }
    el.classList.remove("on", "is-soft", "is-syncing");
    return;
  }

  const applyBanner = () => {
    const cur = activeConn();
    if (!cur || PersonalSpace.isPersonal(cur) || !cur.me
      || (typeof isHostedBridgeConn === "function" && isHostedBridgeConn(cur))) {
      el.classList.remove("on", "is-soft", "is-syncing");
      return;
    }
    const f = connFeelState(cur);
    if (f.state === "connected") {
      el.classList.remove("on", "is-soft", "is-syncing");
      return;
    }
    ensureOutbox(cur);
    const n = (cur.outbox || []).length;
    const disconnectAt = Number(cur._lastDisconnectAt) || 0;
    const reachingLong = f.state === "reaching"
      && disconnectAt
      && (Date.now() - disconnectAt) >= CONN_FEEL_REACHING_BANNER_MS;

    if (f.state === "reaching" && n > 0) {
      el.textContent = `Syncing ${n} change${n === 1 ? "" : "s"}…`;
      el.classList.add("on", "is-soft", "is-syncing");
      el.classList.remove("is-alert");
      return;
    }
    if (f.state === "reaching" && n === 0) {
      if (!reachingLong) {
        el.classList.remove("on", "is-soft", "is-syncing", "is-alert");
        return;
      }
      el.textContent = "Reaching host…";
      el.classList.add("on", "is-soft", "is-syncing");
      el.classList.remove("is-alert");
      return;
    }
    // unreachable
    if (f.viaRelay) {
      el.textContent = f.relayIncomplete
        ? "Relay incomplete — showing last known snapshot"
        : (f.label || "Viewing relay cache");
      el.classList.add("on", "is-soft");
      el.classList.remove("is-syncing", "is-alert");
      return;
    }
    if (n > 0) {
      el.textContent = `${n} change${n === 1 ? "" : "s"} waiting — will sync when the host is back`;
      el.classList.add("on", "is-soft");
      el.classList.remove("is-syncing", "is-alert");
      return;
    }
    // Snapshot viewing — no blocking banner
    el.classList.remove("on", "is-soft", "is-syncing", "is-alert");
  };

  // Debounce brief tunnel blips so the banner doesn't strobe.
  if (el.classList.contains("on") || _reconnectBannerTimer) {
    applyBanner();
    return;
  }
  _reconnectBannerTimer = setTimeout(() => {
    _reconnectBannerTimer = null;
    applyBanner();
  }, 4000);
}

// Routes an outgoing message. Explicit connId wins; otherwise event-addressed
// messages (rsvp/react/eventNote/setEventTimePrecision/deleteEvent/addPerson,
// and a chained createEvent) resolve the owning conn by looking up the event
// they target, so acting on a remote event from the personal collated view
// reaches the right server; everything else goes to whatever's on screen.
const EVENT_ADDRESSED = ["rsvp", "react", "eventNote", "deleteEventNote", "pinEventNote", "publishPersonalNote", "setEventTimePrecision", "setEventWhere", "setEventDetails", "setEventIcon", "setEventSticker", "setEventSubtitle", "setEventType", "setEventDuration", "setEventCardStyle", "deleteEvent", "addPerson", "removePerson", "setMemberRsvp", "setEventConfirmAttendance", "setEventSignupGroups", "assignEventGroup", "setChainMode", "promoteChainEvent", "realizeChainEvent", "clearChainDepWarn", "lockEventSuggestions", "suggestEventWhen", "suggestEvent", "supportEventSuggestion", "promoteEventSuggestion", "removeEventSuggestion", "approveEvent", "blockEvent", "setEventHost"];
function send(m, connId) {
  if (connId) return sendTo(S.conns[connId], m);
  const eventId = EVENT_ADDRESSED.includes(m.type) ? m.eventId : (m.type === "createEvent" ? m.chainOf : null);
  if (eventId) {
    const owner = ownerConnOf(eventId);
    if (owner) return sendTo(owner, m);
  }
  return sendTo(activeConn(), m);
}

function sendTo(conn, m) {
  if (!conn) return "failed";
  ensureClientActionIds(m);
  if (conn.local) {
    localApply(conn, m);
    return "sent";
  }
  const previewMutation = () => {
    if (m.type === "sendMessage") {
      try { optimisticApply(conn, m); } catch {}
    }
  };
  const useHttp = conn._transport === "http"
    || !!(conn.token && /^wss:/i.test(conn.url || ""));
  if (useHttp) {
    // Known-offline: queue immediately so callers (e.g. confirmDraft) see "queued".
    if (conn.status === "offline") {
      if (queueUnreachable(conn, m)) return "queued";
      toast(`${conn.name || conn.hostName || "Server"} is unreachable`);
      return "failed";
    }
    previewMutation();
    httpRpc(conn, m);
    return "sent";
  }
  if (conn.ws && conn.ws.readyState === 1) {
    previewMutation();
    conn.ws.send(JSON.stringify(m));
    return "sent";
  }
  if (queueUnreachable(conn, m)) return "queued";
  toast(`${conn.name || conn.hostName || "Server"} is unreachable`);
  return "failed";
}

function isShareGuest() {
  return false;
}

// True when a change to `conn` should repaint whatever's currently on screen:
// the conn itself is active, or (personal is active) the touched event is
// part of the collated set.
function affectsActiveView(conn, eventId) {
  if (conn.id === S.activeConnId) return true;
  // Event-channel views can pull linked feeds from other servers.
  if (linkedFeedsAffectConn(conn)) return true;
  if (S.activeConnId !== "personal") return false;
  if (eventId == null) return false;
  return collatedEvents().some(e => e.id === eventId);
}

/** Keep shareCode / personal inviteSlug in sync when welcome/sync/invite arrives. */
function applyInviteShareFields(conn) {
  if (!conn) return;
  const slug = String(conn.me?.inviteSlug || conn.inviteSlug || "").trim();
  const url = String(conn.me?.inviteUrl || conn.inviteUrl || "").trim();
  if (slug) conn.inviteSlug = slug;
  if (url && !/phlipapp\.com\/j\//i.test(url)) conn.inviteUrl = url;
  else if (slug && typeof buildPersonalInviteUrl === "function") {
    conn.inviteUrl = buildPersonalInviteUrl(slug, conn);
  } else if (slug && typeof personalInviteUrl === "function") {
    conn.inviteUrl = personalInviteUrl(conn);
  }
  // Legacy rotating code — keep parsing for one release; not required for share UX.
  const inv = normJoinAlpha(conn.invite?.code || "");
  if (inv) {
    const host = serverInviteHost(conn);
    conn.shareCode = composeJoinCode({ invite: inv, host }) || inv;
  } else if (conn.me && !canManageServer(conn)) {
    conn.shareCode = "";
  }
}

/** Host-advertised Local/Public bases (welcome/sync/shareReach) for manager share links. */
function applyShareReachFields(conn, m) {
  if (!conn || !m || typeof m !== "object") return;
  const hints = {};
  const reachMode = ("reachMode" in m)
    ? String(m.reachMode || "").trim().toLowerCase()
    : String(conn.reachMode || "").trim().toLowerCase();
  if (reachMode === "direct" || reachMode === "local" || reachMode === "device") {
    conn.reachMode = reachMode;
  }
  if ("shareLan" in m) {
    const lan = m.shareLan == null || m.shareLan === "" ? "" : String(m.shareLan).trim();
    if (lan) {
      hints.shareLan = lan;
    } else if (reachMode === "direct") {
      // Direct-only: clear STA LAN bases when Soft-AP is not publishing.
      conn.shareLan = "";
      conn.urlLan = "";
    } else {
      hints.shareLan = lan;
    }
  }
  if ("sharePublic" in m) {
    const pub = m.sharePublic == null || m.sharePublic === "" ? "" : String(m.sharePublic).trim();
    hints.sharePublic = pub;
  }
  if ("joinTag" in m) hints.joinTag = m.joinTag;
  syncConnDualUrls(conn, hints);
  if ("isPublic" in m) {
    conn.hostPublic = m.isPublic === true || m.isPublic === "true";
  }
  if (reachMode === "direct") {
    conn.hotspotPreferred = true;
    try { upsertServerEntry?.({ id: conn.id, reachMode: "direct", hotspotPreferred: true }); } catch {}
  } else if (reachMode === "local" && "reachMode" in m) {
    conn.hotspotPreferred = false;
    try { upsertServerEntry?.({ id: conn.id, reachMode: "local", hotspotPreferred: false }); } catch {}
  } else if (hints.shareLan && typeof isHotspotLanUrl === "function" && isHotspotLanUrl(hints.shareLan)) {
    conn.hotspotPreferred = true;
  }
  if (typeof applyHotspotSessionFields === "function") applyHotspotSessionFields(conn, m);
}
