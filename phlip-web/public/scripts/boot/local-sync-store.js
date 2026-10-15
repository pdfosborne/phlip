/* Local-first remote persistence. UI state remains the existing in-memory conn;
 * this module only owns durable, principal-scoped wire snapshots. */
const LocalSyncStore = (() => {
  const DB_NAME = "phlip-local-sync-v1";
  const DB_VERSION = 1;
  const CAPABILITY = "slice-sync-v1";
  const memory = new Map();
  let db = null;
  let ready = false;
  let failed = false;
  let initPromise = null;
  const pendingWrites = new Map();

  function targetEnabled() {
    try { if (typeof isDemoMode === "function" && isDemoMode()) return false; } catch {}
    try { if (localStorage.getItem("ash_sync_v2_disabled") === "1") return false; } catch {}
    // The packaged iOS shell is file: + a join-only AshNative bridge.
    try {
      if (location.protocol === "file:" && window.AshNative
          && typeof AshNative.hostingAvailable === "function"
          && !AshNative.hostingAvailable()) return false;
    } catch { return false; }
    try {
      if (location.hostname === "appassets.androidplatform.net") return true;
      if (window.AshNative && typeof AshNative.hostingAvailable === "function") {
        return !!AshNative.hostingAvailable();
      }
      return location.protocol === "http:" || location.protocol === "https:";
    } catch { return false; }
  }

  function available() {
    return targetEnabled() && typeof Dexie !== "undefined" && typeof indexedDB !== "undefined";
  }

  function scopeOf(connId, principalId) {
    return `${String(connId || "")}::${String(principalId || "")}`;
  }

  function stripTransient(value) {
    if (Array.isArray(value)) return value.map(stripTransient);
    if (!value || typeof value !== "object") return value;
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith("_") || key === "livePic" || key === "ws" || key === "key") continue;
      out[key] = stripTransient(child);
    }
    return out;
  }

  function rootFromCache(cache) {
    const root = stripTransient(cache || {});
    for (const key of ["channels", "events", "availabilities", "timeBlocks", "messages"])
      delete root[key];
    return root;
  }

  function channelSlicesFromCache(cache) {
    const slices = [];
    const messages = cache?.messages || {};
    for (const channel of cache?.channels || []) {
      const channelId = channel?.id;
      if (!channelId) continue;
      const inChannel = (list) => (list || []).filter(row => row?.channelId === channelId).map(stripTransient);
      slices.push({
        key: `channel:${channelId}`,
        data: {
          channel: stripTransient(channel),
          events: inChannel(cache.events),
          availabilities: inChannel(cache.availabilities),
          timeBlocks: inChannel(cache.timeBlocks),
          messages: (messages[channelId] || []).map(stripTransient),
          messageCount: (messages[channelId] || []).length,
          hasOlderMessages: false,
        },
      });
    }
    return slices;
  }

  function legacyCache(connId) {
    try {
      const parsed = JSON.parse(localStorage.getItem(`ash_cache_${connId}`) || "null");
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch { return null; }
  }

  async function open() {
    if (ready || failed) return ready;
    if (!available()) { failed = true; return false; }
    const started = typeof AshPerf !== "undefined" ? AshPerf.begin("localStore.open") : 0;
    try {
      db = new Dexie(DB_NAME);
      db.version(DB_VERSION).stores({
        principals: "&scope,connId,principalId,lastSyncAt",
        slices: "&id,scope,key",
        manifests: "&scope,baseRevision",
        outbox: "&id,scope,createdAt,status",
      });
      await db.open();
      ready = true;
      return true;
    } catch (err) {
      console.warn("local sync store unavailable", err);
      failed = true;
      try { db?.close(); } catch {}
      db = null;
      return false;
    } finally {
      if (typeof AshPerf !== "undefined") AshPerf.end("localStore.open", started, 100);
    }
  }

  async function init(serverEntries = []) {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const started = typeof AshPerf !== "undefined" ? AshPerf.begin("localStore.hydrate") : 0;
      if (!(await open())) return false;
      const entries = Array.isArray(serverEntries) ? serverEntries : [];
      for (const entry of entries) {
        const legacy = legacyCache(entry.id);
        const principalId = legacy?.me?.id || "";
        if (!principalId) continue;
        const scope = scopeOf(entry.id, principalId);
        const existing = await db.principals.get(scope);
        if (!existing && legacy) await persistSnapshot(entry.id, principalId, legacy, { importedLegacy: true });
      }
      const principals = await db.principals.toArray();
      for (const principal of principals) {
        const cache = await materialize(principal.scope);
        if (cache) memory.set(principal.connId, cache);
      }
      if (typeof AshPerf !== "undefined") AshPerf.end("localStore.hydrate", started, 250);
      return true;
    })();
    return initPromise;
  }

  async function persistSnapshot(connId, principalId, cache, meta = {}) {
    if (!ready || !db || !connId || !principalId || !cache) return false;
    const started = typeof AshPerf !== "undefined" ? AshPerf.begin("localStore.persist") : 0;
    const scope = scopeOf(connId, principalId);
    const sliceRows = [
      { id: `${scope}::root`, scope, key: "root", data: rootFromCache(cache) },
      ...channelSlicesFromCache(cache).map(row => ({ id: `${scope}::${row.key}`, scope, ...row })),
    ];
    try {
      await db.transaction("rw", db.principals, db.slices, async () => {
        await db.principals.put({
          scope, connId, principalId,
          lastSyncAt: Number(cache.lastSyncAt || cache.ts) || Date.now(),
          importedLegacy: !!meta.importedLegacy,
        });
        await db.slices.where("scope").equals(scope).delete();
        await db.slices.bulkPut(sliceRows);
      });
      memory.set(connId, stripTransient(cache));
      return true;
    } catch (err) {
      console.warn("local sync persist failed", err);
      return false;
    } finally {
      if (typeof AshPerf !== "undefined") AshPerf.end("localStore.persist", started, 50);
    }
  }

  function snapshotFromConn(conn) {
    return {
      hostName: conn.hostName, iconText: conn.iconText || "", serverPic: conn.serverPic || "",
      me: stripTransient(conn.me), members: (conn.members || []).map(stripTransient),
      boards: stripTransient(conn.boards || []),
      channels: stripTransient(conn.channels || []), events: stripTransient(conn.events || []),
      availabilities: stripTransient(conn.availabilities || []),
      timeBlocks: stripTransient(conn.timeBlocks || []),
      categories: stripTransient(conn.categories || []), eventTypes: stripTransient(conn.eventTypes || []),
      reactionCards: stripTransient(conn.reactionCards || []), customRoles: stripTransient(conn.customRoles || []),
      eventRolePerms: stripTransient(conn.eventRolePerms || null), cardCats: stripTransient(conn.cardCats || {}),
      cardDurations: stripTransient(conn.cardDurations || {}), locations: stripTransient(conn.locations || []),
      messages: stripTransient(conn.messages || {}), serverSettings: stripTransient(conn.serverSettings || {}),
      notifications: stripTransient(conn.notifications || []), blocked: stripTransient(conn.blocked || []),
      ts: Date.now(), lastSyncAt: Number(conn.lastSyncAt) || Date.now(),
    };
  }

  function persistConn(conn) {
    if (!ready || !conn?.id || !conn.me?.id || conn.local) return false;
    const previous = pendingWrites.get(conn.id) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => persistSnapshot(conn.id, conn.me.id, snapshotFromConn(conn)));
    const tracked = next.finally(() => {
      if (pendingWrites.get(conn.id) === tracked) pendingWrites.delete(conn.id);
    });
    pendingWrites.set(conn.id, tracked);
    return true;
  }

  async function materialize(scope) {
    if (!ready || !db) return null;
    const rows = await db.slices.where("scope").equals(scope).toArray();
    const root = rows.find(row => row.key === "root")?.data;
    if (!root) return null;
    const cache = { ...stripTransient(root), channels: [], events: [], availabilities: [], timeBlocks: [], messages: {}, _messagePaging: {} };
    for (const row of rows.filter(row => row.key.startsWith("channel:"))) {
      const data = row.data || {};
      if (data.channel) cache.channels.push(stripTransient(data.channel));
      for (const key of ["events", "availabilities", "timeBlocks"])
        cache[key].push(...stripTransient(data[key] || []));
      const channelId = data.channel?.id || row.key.slice(8);
      cache.messages[channelId] = stripTransient(data.messages || []);
      cache._messagePaging[channelId] = {
        hasMore: !!data.hasOlderMessages,
        total: Number(data.messageCount) || cache.messages[channelId].length,
      };
    }
    if (!cache.me && cache.user) cache.me = stripTransient(cache.user);
    return cache;
  }

  async function applySyncResponse(conn, response) {
    if (!ready || !db || !conn?.id || response?.principalId !== conn.me?.id) return null;
    const scope = scopeOf(conn.id, conn.me.id);
    const started = typeof AshPerf !== "undefined" ? AshPerf.begin("localStore.syncApply") : 0;
    try {
      await db.transaction("rw", db.principals, db.slices, db.manifests, async () => {
        for (const key of response.removed || []) await db.slices.delete(`${scope}::${key}`);
        for (const changed of response.changed || []) {
          if (!changed?.key || !changed.data) continue;
          let data = stripTransient(changed.data);
          if (changed.key.startsWith("channel:")) {
            const previous = await db.slices.get(`${scope}::${changed.key}`);
            const byId = new Map((previous?.data?.messages || []).filter(row => row?.id).map(row => [row.id, row]));
            for (const row of data.messages || []) {
              if (!row?.id) continue;
              const prev = byId.get(row.id);
              if (prev?.conversationId && !row.conversationId) row.conversationId = prev.conversationId;
              byId.set(row.id, row);
            }
            data.messages = [...byId.values()]
              .sort((a, b) => (a.ts || 0) - (b.ts || 0) || String(a.id || "").localeCompare(String(b.id || "")))
              .slice(-500);
          }
          await db.slices.put({ id: `${scope}::${changed.key}`, scope, key: changed.key, hash: changed.hash || "", data });
        }
        await db.manifests.put({ scope, baseRevision: response.baseRevision || "", values: response.manifest || {} });
        await db.principals.put({ scope, connId: conn.id, principalId: conn.me.id, lastSyncAt: Date.now() });
      });
      const cache = await materialize(scope);
      if (cache) memory.set(conn.id, cache);
      return cache;
    } catch (err) {
      console.warn("slice sync transaction failed", err);
      return null;
    } finally {
      if (typeof AshPerf !== "undefined") AshPerf.end("localStore.syncApply", started, 100);
    }
  }

  async function manifestFor(conn) {
    if (!ready || !db || !conn?.me?.id) return {};
    const row = await db.manifests.get(scopeOf(conn.id, conn.me.id));
    const values = { ...(row?.values || {}) };
    const cache = memory.get(conn.id);
    const boardIds = new Set((cache?.boards || []).map(board => board.id));
    // Older client snapshots omitted boards while keeping their channel IDs.
    // Refetch root metadata even if the server's revision has not changed.
    if (!Array.isArray(cache?.boards)
        || (cache.channels || []).some(channel => channel.boardId && !boardIds.has(channel.boardId))) {
      delete values.root;
    }
    return values;
  }

  async function removeConn(connId, principalId = "") {
    if (!ready || !db) return;
    const principals = principalId
      ? [{ scope: scopeOf(connId, principalId) }]
      : await db.principals.where("connId").equals(connId).toArray();
    for (const item of principals) {
      await db.transaction("rw", db.principals, db.slices, db.manifests, db.outbox, async () => {
        await db.slices.where("scope").equals(item.scope).delete();
        await db.outbox.where("scope").equals(item.scope).delete();
        await db.manifests.delete(item.scope);
        await db.principals.delete(item.scope);
      });
    }
    memory.delete(connId);
  }

  return {
    CAPABILITY, targetEnabled, available, init, isReady: () => ready && !failed,
    peek: (connId) => memory.get(connId) || null,
    persistConn, applySyncResponse, manifestFor, removeConn, stripTransient,
  };
})();
