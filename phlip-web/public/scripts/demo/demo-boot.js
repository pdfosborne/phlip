/* demo-boot.js — hydrate local demo conns, chrome bar, and Reset.
 *
 * Globals in:  S, DemoStore, DemoFixture, Nav, decryptAll, renderAll
 * Globals out: DemoBoot
 * Load after:  demo-fixture.js, personal-space.js
 * Load before: wireboot.js (called from initConns)
 *
 * Must not: open WebSocket, fetch /ash-*, or restore ash_servers_v1
 */
const DemoBoot = (() => {
  "use strict";

  function applySnapshot(bundle) {
    const me = bundle.me || DemoFixture.build().me;
    if (typeof DemoStore !== "undefined") DemoStore.setMe(me);
    S.conns = {};
    for (const [id, raw] of Object.entries(bundle.conns || {})) {
      const conn = { ...raw };
      conn.id = id;
      conn.demo = true;
      conn.local = true;
      conn.status = "online";
      conn.url = null;
      conn.token = null;
      conn.pass = null;
      conn.ws = null;
      conn.key = null;
      conn.retryDelay = 0;
      conn.me = conn.me && conn.me.id === me.id ? { ...me, ...conn.me, id: me.id } : (conn.me || me);
      if (id === "personal") {
        conn.name = conn.name || "Personal";
        conn.hostName = "this device";
      } else {
        // Keep a Demo tag on every demo server name so rail, sidebar, and titles stay clear.
        const base = String(conn.name || conn.hostName || "Server")
          .replace(/\s*·\s*Demo\s*$/i, "")
          .trim() || "Server";
        conn.name = `${base} · Demo`;
      }
      if (!Array.isArray(conn.members) || !conn.members.length) conn.members = [conn.me];
      else {
        conn.members = conn.members.map((m) => (m.id === me.id ? { ...m, ...conn.me } : m));
      }
      conn.online = (conn.members || []).map(m => m.id);
      conn.messages = conn.messages || {};
      conn.events = conn.events || [];
      conn.channels = conn.channels || [];
      conn.boards = conn.boards || [];
      if (typeof ensureConnBoards === "function") ensureConnBoards(conn);
      conn.routines = conn.routines || [];
      conn.notifications = conn.notifications || [];
      for (const ev of conn.events) {
        try {
          if (typeof hydratePlainEvent === "function") hydratePlainEvent(ev);
        } catch {}
      }
      S.conns[id] = conn;
    }
    return bundle.nav || { connId: "demo-friends", view: { kind: "events" } };
  }

  function needsFreshFixture(bundle) {
    if (!bundle || !bundle.conns || !Object.keys(bundle.conns).length) return true;
    const current = typeof DemoFixture !== "undefined" ? DemoFixture.VERSION : 2;
    return bundle.fixtureVersion !== current;
  }

  function applyFixtureLinks(links) {
    try { linkedEventFeedsCache = {}; } catch {}
    try { localStorage.setItem("ash_linked_event_feeds_v1", "{}"); } catch {}
    if (typeof setLinkedEventSources === "function") {
      for (const row of links?.events || []) {
        if (!row?.connId || !row?.channelId) continue;
        setLinkedEventSources(row.connId, row.channelId, row.sources || []);
      }
    }
    try { linkedChatMirrorsCache = {}; } catch {}
    try { localStorage.setItem("ash_linked_chat_mirrors_v1", "{}"); } catch {}
    if (typeof setLinkedChatMirrors === "function") {
      for (const row of links?.chats || []) {
        if (!row?.channelId) continue;
        setLinkedChatMirrors(row.channelId, row.sources || []);
      }
    }
  }

  function mountBar() {
    if (document.getElementById("phlip-demo-bar")) return;
    const bar = document.createElement("div");
    bar.id = "phlip-demo-bar";
    bar.className = "phlip-demo-bar";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Interactive demo");
    bar.innerHTML = `<span class="phlip-demo-bar-copy">Demo — stored only in this browser</span>
      <button type="button" class="phlip-demo-bar-reset">Reset</button>`;
    bar.querySelector(".phlip-demo-bar-reset")?.addEventListener("click", () => {
      void resetDemo();
    });
    const mount = () => {
      if (document.getElementById("phlip-demo-bar")) return;
      const user = document.getElementById("side-user-panel");
      const sidebar = document.getElementById("sidebar");
      if (user && user.parentNode) user.parentNode.insertBefore(bar, user);
      else if (sidebar) sidebar.appendChild(bar);
      else (document.body || document.documentElement).appendChild(bar);
    };
    if (document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount, { once: true });
  }

  async function resetDemo() {
    const ok = typeof ashConfirm === "function"
      ? await ashConfirm("Reset the demo? Your events, RSVPs, and chat in this browser will be replaced with the original fixture.")
      : true;
    if (!ok) return;
    try { await DemoStore.clear(); } catch (e) { console.warn("demo reset", e); }
    location.reload();
  }

  async function start() {
    mountBar();
    try { await DemoStore.init(); } catch (e) { console.warn("demo store", e); }
    let bundle = null;
    try { bundle = await DemoStore.loadAll(); } catch {}
    const fresh = needsFreshFixture(bundle);
    if (fresh) {
      if (bundle && bundle.fixtureVersion != null) {
        try { window.DemoMode?.clearPrefixed?.(); } catch {}
      }
      bundle = DemoFixture.build();
      try { await DemoStore.saveAll(bundle); } catch {}
    }
    const nav = applySnapshot(bundle);
    if (fresh) {
      applyFixtureLinks(bundle.links);
      if (typeof saveRailOrder === "function") {
        saveRailOrder(["demo-family", "demo-friends", "demo-tennis"]);
      }
    }
    for (const conn of Object.values(S.conns)) {
      try { await decryptAll(conn); } catch {}
      try { seedEventSeenCursors(conn); } catch {}
    }
    const connId = (nav.connId && S.conns[nav.connId]) ? nav.connId : "demo-friends";
    S.activeConnId = connId;
    const view = nav.view && nav.view.kind ? nav.view : { kind: "events" };
    if (typeof Nav !== "undefined" && Nav.set) Nav.set(view);
    else S.activeView = view;
    if (nav.eventChannelId) S.activeEventChannelId = nav.eventChannelId;
    try { wireShellBreakpoint?.(); } catch {}
    try { bootPaint(); } catch (e) { console.error("demo bootPaint", e); }
    try { renderAll(); } catch (e) { console.error("demo renderAll", e); }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        try { rememberNav(); } catch {}
        try { DemoStore.persistAllFromState(); } catch {}
      }
    });
    window.addEventListener("pagehide", () => {
      try { rememberNav(); } catch {}
      try { DemoStore.persistAllFromState(); } catch {}
    });
    try { window.Onboarding?.maybeStart?.(); } catch {}
  }

  return { start, resetDemo, mountBar };
})();
window.DemoBoot = DemoBoot;
