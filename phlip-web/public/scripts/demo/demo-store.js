/* demo-store.js — IndexedDB snapshots for the local browser demo.
 *
 * Globals in:  Dexie, isDemoMode, DemoMode
 * Globals out: DemoStore
 * Load after:  dexie, demo-mode.js
 * Load before: demo-fixture.js, demo-boot.js, personal.js
 *
 * Must not: send state to a backend; reuse phlip-local-sync-v1
 */
const DemoStore = (() => {
  const DB_NAME = "phlip-demo-v1";
  const DB_VERSION = 1;
  let db = null;
  let memory = { me: null, conns: {}, nav: null, fixtureVersion: null };
  let persistTimer = null;
  let persistChain = Promise.resolve();

  function available() {
    return typeof isDemoMode === "function" && isDemoMode()
      && typeof Dexie !== "undefined" && typeof indexedDB !== "undefined";
  }

  function openDb() {
    if (db) return db;
    db = new Dexie(DB_NAME);
    db.version(DB_VERSION).stores({
      meta: "key",
      conns: "id",
    });
    return db;
  }

  function stripTransient(value) {
    if (Array.isArray(value)) return value.map(stripTransient);
    if (!value || typeof value !== "object") return value;
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith("_") && key !== "_title" && key !== "_where"
          && key !== "_details" && key !== "_sticker" && key !== "_subtitle") continue;
      if (key === "ws" || key === "key" || key === "livePic" || key === "outbox") continue;
      out[key] = stripTransient(child);
    }
    return out;
  }

  function snapshotConn(conn) {
    if (!conn) return null;
    const copy = stripTransient(conn);
    copy.demo = true;
    copy.local = true;
    copy.status = "online";
    copy.url = null;
    copy.token = null;
    copy.pass = null;
    copy.ws = null;
    copy.key = null;
    return copy;
  }

  async function init() {
    if (!available()) return false;
    try {
      await openDb().open();
      return true;
    } catch (e) {
      console.warn("demo store init", e);
      db = null;
      return false;
    }
  }

  function getMe() {
    return memory.me || null;
  }

  function setMe(me) {
    memory.me = me ? { ...me } : null;
  }

  async function loadAll() {
    if (!db) return null;
    try {
      const meRow = await db.meta.get("me");
      const navRow = await db.meta.get("nav");
      const verRow = await db.meta.get("fixtureVersion");
      const rows = await db.conns.toArray();
      if (!rows.length) return null;
      const conns = {};
      for (const row of rows) {
        if (row?.id) conns[row.id] = row.data || row;
      }
      memory = {
        me: meRow?.data || null,
        conns,
        nav: navRow?.data || null,
        fixtureVersion: verRow?.data ?? null,
      };
      return memory;
    } catch (e) {
      console.warn("demo store load", e);
      return null;
    }
  }

  async function saveAll(bundle) {
    if (bundle?.me) memory.me = bundle.me;
    if (bundle?.nav) memory.nav = bundle.nav;
    if (bundle?.fixtureVersion != null) memory.fixtureVersion = bundle.fixtureVersion;
    const incoming = bundle?.conns ? Object.entries(bundle.conns) : null;
    if (incoming) {
      const next = {};
      for (const [id, conn] of incoming) {
        next[id] = snapshotConn(conn);
      }
      memory.conns = next;
    }
    if (!db) return;
    try {
      await db.transaction("rw", db.meta, db.conns, async () => {
        await db.conns.clear();
        if (memory.me) await db.meta.put({ key: "me", data: memory.me });
        if (memory.nav) await db.meta.put({ key: "nav", data: memory.nav });
        if (memory.fixtureVersion != null) {
          await db.meta.put({ key: "fixtureVersion", data: memory.fixtureVersion });
        }
        for (const [id, data] of Object.entries(memory.conns)) {
          await db.conns.put({ id, data });
        }
      });
    } catch (e) {
      console.warn("demo store save", e);
    }
  }

  function persistConn(conn) {
    if (!conn?.id) return;
    memory.conns[conn.id] = snapshotConn(conn);
    if (conn.me && (conn.id === "personal" || conn.me.id === memory.me?.id)) {
      memory.me = { ...conn.me };
    }
    scheduleFlush();
  }

  function persistAllFromState() {
    if (typeof S === "undefined" || !S.conns) return persistChain;
    for (const conn of Object.values(S.conns)) persistConn(conn);
    if (S.activeConnId) {
      memory.nav = {
        connId: S.activeConnId,
        view: S.activeView || { kind: "events" },
        eventChannelId: S.activeEventChannelId || null,
      };
    }
    return flushNow();
  }

  function saveNav(nav) {
    memory.nav = nav || null;
    scheduleFlush();
  }

  function scheduleFlush() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => { persistTimer = null; flushNow(); }, 50);
  }

  function flushNow() {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    persistChain = persistChain.then(() => saveAll(memory)).catch((e) => {
      console.warn("demo store flush", e);
    });
    return persistChain;
  }

  async function clear() {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    memory = { me: null, conns: {}, nav: null, fixtureVersion: null };
    try { window.DemoMode?.clearPrefixed?.(); } catch {}
    if (!db) {
      try {
        await new Dexie(DB_NAME).delete();
      } catch {}
      return;
    }
    try {
      await db.delete();
    } catch {}
    db = null;
  }

  return {
    init, loadAll, saveAll, persistConn, persistAllFromState, flushNow,
    saveNav, getMe, setMe, clear, available,
  };
})();
window.DemoStore = DemoStore;
