/* ---------------------- Tier 1 · Personal backup (Act 1) ----------------- */
/* Passphrase-encrypted export of personal space + device identity.
   Never writes joined-server caches. SAF on Android; blob/file fallback in browser. */

const BACKUP_REMINDER_KEY = "ash_backup_reminder_v1";
const BACKUP_LAST_EXPORT_KEY = "ash_backup_last_export_v1";
const BACKUP_SCHEMA = 1;
const BACKUP_PBKDF2_ITERS = 150000;
const BACKUP_MAX_PHOTO_CHARS = 200000;
const BACKUP_MAX_IMPORT_CHARS = 8 * 1024 * 1024;

function backupNativeAvailable() {
  return !!(window.AshNative
    && typeof AshNative.exportPersonalBackup === "function"
    && typeof AshNative.importPersonalBackup === "function");
}

function markPersonalBackupExported() {
  try {
    localStorage.setItem(BACKUP_LAST_EXPORT_KEY, String(Date.now()));
    localStorage.setItem(BACKUP_REMINDER_KEY, JSON.stringify({ dismissed: true, at: Date.now() }));
  } catch {}
}

function personalBackupEverExported() {
  try { return !!localStorage.getItem(BACKUP_LAST_EXPORT_KEY); } catch { return false; }
}

function personalBackupReminderDismissed() {
  try {
    const raw = JSON.parse(localStorage.getItem(BACKUP_REMINDER_KEY) || "null");
    return !!(raw && raw.dismissed);
  } catch { return false; }
}

function dismissPersonalBackupReminder() {
  try {
    localStorage.setItem(BACKUP_REMINDER_KEY, JSON.stringify({ dismissed: true, at: Date.now() }));
  } catch {}
}

/** Show dismissible reminder when ≥10 personal events and never exported. */
function shouldShowPersonalBackupReminder() {
  if (personalBackupEverExported() || personalBackupReminderDismissed()) return false;
  try {
    const store = typeof loadPersonalStore === "function" ? loadPersonalStore() : null;
    const n = Array.isArray(store?.events) ? store.events.length : 0;
    return n >= 10;
  } catch { return false; }
}

function personalBackupSuggestedName() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `phlip-backup-${y}-${m}-${day}.phlip`;
}

async function _prepareEventsForBackup(events) {
  const out = [];
  for (const ev of events || []) {
    const copy = JSON.parse(JSON.stringify(ev));
    if (Array.isArray(copy.notes)) {
      for (const n of copy.notes) {
        if (n.noteKind === "personal" && typeof n.text === "string" && n.text.startsWith("self:")) {
          const pt = typeof openSelfSeal === "function" ? await openSelfSeal(n.text) : null;
          n.text = pt != null ? pt : "";
          n._backupPlain = true;
        } else if (n._text != null && n.noteKind === "personal") {
          n.text = String(n._text);
          n._backupPlain = true;
        }
        delete n._text;
      }
    }
    delete copy._title;
    delete copy._where;
    delete copy._details;
    delete copy._sticker;
    out.push(copy);
  }
  return out;
}

async function _resealPersonalNotesInEvents(events) {
  for (const ev of events || []) {
    if (!Array.isArray(ev.notes)) continue;
    for (const n of ev.notes) {
      if (n.noteKind !== "personal") continue;
      const plain = n._backupPlain || (typeof n.text === "string" && !n.text.startsWith("self:"))
        ? String(n.text || "")
        : null;
      if (plain != null && typeof sealToSelf === "function") {
        n.text = plain ? await sealToSelf(plain) : "";
      }
      delete n._backupPlain;
      delete n._text;
    }
  }
  return events;
}

function _slimMeForBackup(me) {
  if (!me || typeof me !== "object") return { id: "me", name: "Me" };
  const out = {
    id: me.id,
    name: me.name || "Me",
  };
  if (me.offlineAvatar && typeof me.offlineAvatar === "object") {
    out.offlineAvatar = me.offlineAvatar;
  }
  if (typeof me.localPhoto === "string" && me.localPhoto
      && me.localPhoto.length <= BACKUP_MAX_PHOTO_CHARS) {
    out.localPhoto = me.localPhoto;
  }
  return out;
}

/** Build plaintext personal backup object (schema 1). */
async function buildPersonalBackupPayload() {
  if (typeof savePersonal === "function" && S?.conns?.personal) {
    try { savePersonal(); } catch {}
  }
  const store = typeof loadPersonalStore === "function"
    ? loadPersonalStore()
    : { channels: [], events: [], notifications: [], messages: {} };
  const events = await _prepareEventsForBackup(store.events || []);
  const identity = typeof _loadIdentityRecord === "function" ? _loadIdentityRecord() : null;
  if (!identity) {
    try { await ensureDeviceIdentity(); } catch {}
  }
  const idRec = typeof _loadIdentityRecord === "function" ? _loadIdentityRecord() : null;
  const me = typeof loadMe === "function" ? loadMe() : null;
  const load = (k, fallback) => {
    try {
      const v = JSON.parse(localStorage.getItem(k) || "null");
      return v == null ? fallback : v;
    } catch { return fallback; }
  };
  return {
    schema: BACKUP_SCHEMA,
    kind: "personal",
    exportedAt: Date.now(),
    appHint: "phlip",
    eventCount: events.length,
    personal: {
      boards: store.boards || [],
      channels: store.channels || [],
      events,
      tasks: store.tasks || [],
      routines: store.routines || [],
      notifications: store.notifications || [],
      messages: store.messages || {},
    },
    decks: {
      categories: load("ash_personal_categories_v1", null),
      cardCats: load("ash_personal_card_cats_v1", null),
      cardDurations: load("ash_personal_card_durs_v1", null),
      removedCards: load("ash_personal_removed_cards_v1", []),
      eventTypes: load("ash_personal_event_types_v1", null),
    },
    me: _slimMeForBackup(me),
    identity: idRec ? {
      v: idRec.v || 1,
      identityId: idRec.identityId,
      identityPub: idRec.identityPub,
      privateJwk: idRec.privateJwk,
    } : null,
  };
}

/** Seal payload JSON with passphrase → wire envelope object. */
async function sealPersonalBackupEnvelope(passphrase, payload) {
  const pass = String(passphrase || "");
  if (pass.length < 8) throw new Error("Passphrase must be at least 8 characters.");
  const salt = newPasswordSalt();
  const key = await deriveKey(pass, salt);
  const plain = JSON.stringify(payload);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const rawKey = ashRawKey(key);
  let ctBytes;
  if (rawKey) {
    const lite = _lite();
    if (!lite) throw new Error("Secure crypto isn't available.");
    ctBytes = lite.aesGcmEncrypt(rawKey, iv, _enc.encode(plain));
  } else {
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, _enc.encode(plain));
    ctBytes = new Uint8Array(ct);
  }
  return {
    phlip: 1,
    kind: "personal",
    kdf: "pbkdf2-sha256",
    iter: BACKUP_PBKDF2_ITERS,
    salt,
    iv: b64(iv),
    ct: b64(ctBytes),
  };
}

/** Open wire envelope → plaintext payload. Throws on wrong passphrase / corrupt. */
async function openPersonalBackupEnvelope(passphrase, envelope) {
  if (!envelope || envelope.phlip !== 1 || envelope.kind !== "personal") {
    throw new Error("Not a Phlip personal backup.");
  }
  if (envelope.kdf !== "pbkdf2-sha256") {
    throw new Error("Unsupported backup encryption.");
  }
  const pass = String(passphrase || "");
  if (!pass) throw new Error("Passphrase required.");
  const salt = envelope.salt;
  const iv = unb64(envelope.iv);
  const ct = unb64(envelope.ct);
  if (!salt || iv.length !== 12 || !ct.length) throw new Error("Corrupt backup file.");
  const key = await deriveKey(pass, salt);
  const rawKey = ashRawKey(key);
  let pt;
  try {
    if (rawKey) {
      const lite = _lite();
      if (!lite) throw new Error("Secure crypto isn't available.");
      pt = lite.aesGcmDecrypt(rawKey, iv, ct);
    } else {
      pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    }
  } catch {
    throw new Error("Wrong passphrase or damaged file.");
  }
  const text = _dec.decode(pt);
  let payload;
  try { payload = JSON.parse(text); }
  catch { throw new Error("Corrupt backup contents."); }
  if (!payload || payload.schema !== BACKUP_SCHEMA || payload.kind !== "personal") {
    throw new Error("Unsupported backup version.");
  }
  return payload;
}

function personalBackupPreview(payload) {
  const p = payload?.personal || {};
  const decks = payload?.decks || {};
  const cats = Array.isArray(decks.categories) ? decks.categories.length
    : (decks.categories && typeof decks.categories === "object" ? Object.keys(decks.categories).length : 0);
  return {
    eventCount: Array.isArray(p.events) ? p.events.length : (payload?.eventCount || 0),
    channelCount: Array.isArray(p.channels) ? p.channels.length : 0,
    hasIdentity: !!(payload?.identity?.identityId && payload?.identity?.privateJwk),
    meName: payload?.me?.name || "",
    exportedAt: payload?.exportedAt || 0,
    deckHint: cats,
  };
}

function _installIdentityFromBackup(identity) {
  if (!identity?.identityId || !identity?.identityPub || !identity?.privateJwk) return false;
  const record = {
    v: identity.v || 1,
    identityId: identity.identityId,
    identityPub: identity.identityPub,
    privateJwk: identity.privateJwk,
  };
  const raw = JSON.stringify(record);
  if (typeof _identityNativePut === "function" && _identityNativePut(raw)) {
    try { localStorage.removeItem(IDENTITY_LS_KEY); } catch {}
    return true;
  }
  try {
    localStorage.setItem(IDENTITY_LS_KEY, raw);
    return true;
  } catch {
    return false;
  }
}

function _writeDeckKeys(decks) {
  if (!decks || typeof decks !== "object") return;
  const set = (k, v) => {
    if (v == null) return;
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  };
  set("ash_personal_categories_v1", decks.categories);
  set("ash_personal_card_cats_v1", decks.cardCats);
  set("ash_personal_card_durs_v1", decks.cardDurations);
  set("ash_personal_removed_cards_v1", decks.removedCards);
  set("ash_personal_event_types_v1", decks.eventTypes);
}

function _mergeById(localArr, incomingArr) {
  const local = Array.isArray(localArr) ? localArr.slice() : [];
  const map = new Map(local.map(x => [x?.id, x]));
  for (const item of incomingArr || []) {
    if (!item?.id) continue;
    if (map.has(item.id)) {
      const i = local.findIndex(x => x.id === item.id);
      if (i >= 0) local[i] = item;
    } else {
      local.push(item);
      map.set(item.id, item);
    }
  }
  return local;
}

/**
 * Apply decrypted payload.
 * @param {"merge"|"replace"} mode
 */
function _normalizeBackupRoutines(routines) {
  const out = [];
  const seen = new Set();
  for (const source of Array.isArray(routines) ? routines : []) {
    if (!source?.id) continue;
    const { channelId: _legacyChannelId, ...routine } = source;
    routine.routineStyle = routine.routineStyle || "rare-blue";
    routine.eventCardStyle = typeof eventCardPresetForRoutine === "function"
      ? eventCardPresetSnapshot(eventCardPresetForRoutine(routine))
      : (routine.eventCardStyle || null);
    const signature = JSON.stringify([
      routine.title || "", routine.subtitle || "", routine.typeId || "", routine.cat || "",
      routine.startMinute, routine.whenPrecision || "", routine.whenPeriod || "",
      routine.duration || "", routine.locationLabelId || "", routine.where || "", routine.icon || "",
      routine.eventCardStyle || null,
    ]);
    if (seen.has(signature)) continue;
    seen.add(signature);
    out.push(routine);
  }
  return out;
}

async function applyPersonalBackup(payload, mode) {
  if (!payload || payload.kind !== "personal") throw new Error("Invalid backup.");
  const replace = mode === "replace";

  if (replace) {
    // Install identity first so re-seal uses the restored keypair.
    if (payload.identity) _installIdentityFromBackup(payload.identity);
    const personal = payload.personal || { boards: [], channels: [], events: [], tasks: [], notifications: [], messages: {} };
    const events = await _resealPersonalNotesInEvents(
      JSON.parse(JSON.stringify(personal.events || [])),
    );
    const store = {
      boards: personal.boards || [],
      channels: personal.channels || [],
      events,
      tasks: personal.tasks || [],
      routines: _normalizeBackupRoutines(personal.routines),
      notifications: personal.notifications || [],
      messages: personal.messages || {},
    };
    localStorage.setItem("ash_personal_v1", JSON.stringify(store));
    _writeDeckKeys(payload.decks || {});
    if (payload.me) {
      try {
        localStorage.setItem("ash_me", JSON.stringify(_slimMeForBackup(payload.me)));
        localStorage.setItem("ash_me_named", "1");
      } catch {}
    }
  } else {
    // Merge: keep local identity; re-seal notes to this device.
    const cur = typeof loadPersonalStore === "function"
      ? loadPersonalStore()
      : { boards: [], channels: [], events: [], tasks: [], notifications: [], messages: {} };
    const incoming = payload.personal || {};
    const eventsIn = await _resealPersonalNotesInEvents(
      JSON.parse(JSON.stringify(incoming.events || [])),
    );
    const store = {
      boards: _mergeById(cur.boards, incoming.boards),
      channels: _mergeById(cur.channels, incoming.channels),
      events: _mergeById(cur.events, eventsIn),
      tasks: _mergeById(cur.tasks, incoming.tasks),
      routines: _normalizeBackupRoutines(_mergeById(cur.routines, incoming.routines)),
      notifications: _mergeById(cur.notifications, incoming.notifications),
      messages: { ...(cur.messages || {}), ...(incoming.messages || {}) },
    };
    localStorage.setItem("ash_personal_v1", JSON.stringify(store));
    // Decks: fill gaps only (don't clobber local vocabulary).
    const decks = payload.decks || {};
    const fill = (key, incomingVal) => {
      if (incomingVal == null) return;
      try {
        const existing = JSON.parse(localStorage.getItem(key) || "null");
        if (existing == null) {
          localStorage.setItem(key, JSON.stringify(incomingVal));
        } else if (Array.isArray(existing) && Array.isArray(incomingVal)) {
          localStorage.setItem(key, JSON.stringify(_mergeById(existing, incomingVal)));
        } else if (typeof existing === "object" && typeof incomingVal === "object") {
          localStorage.setItem(key, JSON.stringify({ ...incomingVal, ...existing }));
        }
      } catch {
        try { localStorage.setItem(key, JSON.stringify(incomingVal)); } catch {}
      }
    };
    fill("ash_personal_categories_v1", decks.categories);
    fill("ash_personal_card_cats_v1", decks.cardCats);
    fill("ash_personal_card_durs_v1", decks.cardDurations);
    fill("ash_personal_removed_cards_v1", decks.removedCards);
    fill("ash_personal_event_types_v1", decks.eventTypes);
    if (payload.me?.name && typeof saveMe === "function") {
      const me = loadMe();
      if (!me.name || me.name === "Me") saveMe({ name: payload.me.name });
    }
  }

  // Rebuild live personal conn from disk.
  try {
    if (S?.conns) {
      S.conns.personal = makePersonalConn();
      if (S.activeConnId === "personal" || !S.activeConnId) {
        S.activeConnId = "personal";
      }
    }
  } catch {}
  try { renderSidebar(); } catch {}
  try { renderView(); } catch {}
}

function _downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function _pickTextFile() {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".phlip,application/octet-stream,application/json,text/plain,*/*";
    inp.style.display = "none";
    document.body.appendChild(inp);
    const done = (text) => {
      inp.remove();
      resolve(text);
    };
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) { done(null); return; }
      if (f.size > BACKUP_MAX_IMPORT_CHARS) { done(null); return; }
      const reader = new FileReader();
      reader.onload = () => done(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => done(null);
      reader.readAsText(f);
    };
    inp.oncancel = () => done(null);
    inp.click();
  });
}

/** Write sealed envelope to disk (SAF or download). Resolves true on success. */
function writePersonalBackupFile(envelopeJson, filename) {
  const name = filename || personalBackupSuggestedName();
  const body = typeof envelopeJson === "string" ? envelopeJson : JSON.stringify(envelopeJson);
  if (backupNativeAvailable()) {
    return new Promise((resolve) => {
      window.__ashOnBackupExport = (ok) => resolve(!!ok);
      try {
        AshNative.exportPersonalBackup(body, name);
      } catch {
        window.__ashOnBackupExport = null;
        resolve(false);
      }
    });
  }
  try {
    _downloadTextFile(name, body);
    return Promise.resolve(true);
  } catch {
    return Promise.resolve(false);
  }
}

/** Read backup file text (SAF or file picker). */
function readPersonalBackupFile() {
  if (backupNativeAvailable()) {
    return new Promise((resolve) => {
      window.__ashOnBackupImport = (text) => {
        resolve(text == null || text === "" ? null : String(text));
      };
      try {
        AshNative.importPersonalBackup();
      } catch {
        window.__ashOnBackupImport = null;
        resolve(null);
      }
    });
  }
  return _pickTextFile();
}

/** Full export flow: build → seal → write. */
async function runPersonalBackupExport(passphrase) {
  const payload = await buildPersonalBackupPayload();
  const env = await sealPersonalBackupEnvelope(passphrase, payload);
  const ok = await writePersonalBackupFile(JSON.stringify(env), personalBackupSuggestedName());
  if (ok) markPersonalBackupExported();
  return ok;
}

/** Parse + decrypt file text; returns payload. */
async function decryptPersonalBackupFileText(fileText, passphrase) {
  if (!fileText || fileText.length > BACKUP_MAX_IMPORT_CHARS) {
    throw new Error("Backup file missing or too large.");
  }
  let envelope;
  try { envelope = JSON.parse(fileText); }
  catch { throw new Error("Not a valid backup file."); }
  return openPersonalBackupEnvelope(passphrase, envelope);
}


const SERVER_BACKUP_KIND_FULL = "server-full";

function serverBackupNativeAvailable() {
  return !!(window.AshNative
    && typeof AshNative.exportServerBackup === "function"
    && typeof AshNative.importServerBackup === "function"
    && typeof AshNative.unlockServerBackup === "function"
    && typeof AshNative.hostingAvailable === "function"
    && AshNative.hostingAvailable());
}

function writeServerBackupViaNative(serverId, kind, passphrase, suggestedName) {
  return new Promise((resolve) => {
    window.__ashOnServerBackupExport = (ok) => resolve(!!ok);
    try {
      AshNative.exportServerBackup(serverId, kind, passphrase, suggestedName || "phlip-server-backup.phlip");
    } catch {
      window.__ashOnServerBackupExport = null;
      resolve(false);
    }
  });
}

function pickServerBackupViaNative() {
  return new Promise((resolve) => {
    window.__ashOnServerBackupPicked = (ok) => resolve(!!ok);
    try {
      AshNative.importServerBackup();
    } catch {
      window.__ashOnServerBackupPicked = null;
      resolve(false);
    }
  });
}

/**
 * @param {string} serverId
 * @param {"server-structure"|"server-full"} kind
 * @param {string} serverName
 */
function openServerBackupExportFlow(serverId, kind, serverName) {
  if (!serverBackupNativeAvailable()) {
    toast("Server backups need the Phlip app on the host phone.");
    return;
  }
  const isFull = kind === SERVER_BACKUP_KIND_FULL;
  const title = isFull ? "Full server backup" : "Structure backup";
  const note = isFull
    ? "Includes people, events, messages, and the server identity. Anyone with this file and passphrase can impersonate the server — keep it private."
    : "Saves channels, cards, roles, and settings — not people or events. Use to rebuild vocabulary after issues.";
  if (typeof openPersonalBackupPassphraseModal !== "function") {
    toast("Backup UI unavailable");
    return;
  }
  openPersonalBackupPassphraseModal({
    title,
    confirmLabel: "Export…",
    onConfirm: async (passphrase) => {
      toast(isFull ? "Building full backup…" : "Building structure backup…");
      let name = "";
      try {
        name = AshNative.serverBackupSuggestedName?.(serverId, kind) || "";
      } catch {}
      if (!name) {
        const d = new Date();
        const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
        const safe = String(serverName || "server").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "server";
        name = `${isFull ? "phlip-server-full" : "phlip-server-structure"}-${safe}-${stamp}.phlip`;
      }
      const ok = await writeServerBackupViaNative(serverId, kind, passphrase, name);
      toast(ok ? "Backup saved" : "Backup cancelled or failed");
    },
  });
  // Prepend note into the open modal if present.
  queueMicrotask(() => {
    const hint = document.querySelector(".backup-pass-modal .feel-strength-hint");
    if (hint) hint.textContent = `${note} If you forget the passphrase, this backup cannot be opened.`;
  });
}

function openServerBackupRestoreFlow(servers) {
  if (!serverBackupNativeAvailable()) {
    toast("Server backups need the Phlip app on the host phone.");
    return;
  }
  if (typeof openPersonalBackupUnlockModal !== "function") {
    toast("Backup UI unavailable");
    return;
  }
  (async () => {
    const picked = await pickServerBackupViaNative();
    if (!picked) {
      toast("No backup selected");
      return;
    }
    openPersonalBackupUnlockModal({
      onConfirm: async (passphrase) => {
        let raw = "";
        try {
          raw = AshNative.unlockServerBackup(passphrase) || "";
        } catch (e) {
          throw new Error(e?.message || "Couldn’t unlock backup");
        }
        let preview;
        try { preview = JSON.parse(raw); }
        catch { throw new Error("Couldn’t unlock backup"); }
        if (!preview?.ok) throw new Error(preview?.error || "Wrong passphrase or corrupt file");
        openServerBackupPreviewModal(preview, servers || []);
      },
    });
  })().catch((err) => toast(err?.message || "Restore failed"));
}

function openServerBackupPreviewModal(preview, servers) {
  const when = preview.exportedAt
    ? new Date(preview.exportedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
    : "unknown date";
  const isFull = preview.kind === SERVER_BACKUP_KIND_FULL;
  const list = Array.isArray(servers) ? servers : [];
  const options = list.map((s) =>
    `<option value="${esc(s.id)}">${esc(s.name || s.id)}</option>`,
  ).join("");
  const opened = AshModal.open({
    className: "backup-preview",
    html: `
    <div class="modal-card backup-preview-modal">
      <div class="user-settings-top"><h4>${isFull ? "Restore full backup" : "Restore structure"}</h4></div>
      <div class="user-settings-body">
        <p class="feel-strength-hint">Exported ${esc(when)}${preview.serverName ? ` · ${esc(preview.serverName)}` : ""}</p>
        <ul class="backup-preview-stats">
          <li><strong>${preview.channelCount || 0}</strong> channels</li>
          <li><strong>${preview.eventTypeCount || 0}</strong> event types</li>
          ${isFull ? `<li><strong>${preview.memberCount || 0}</strong> members</li><li><strong>${preview.eventCount || 0}</strong> events</li>` : ""}
        </ul>
        ${isFull ? `
          <p class="feel-strength-hint"><strong>Replace</strong> installs this backup as server id <code>${esc(preview.serverId || "?")}</code>. Existing data for that id on this phone is wiped. Connected members keep the same server only if this is that server’s backup.</p>
          <div class="actions backup-preview-actions">
            <button type="button" class="cancel" id="srv-bak-cancel">Cancel</button>
            <button type="button" class="save danger" id="srv-bak-full">Replace server</button>
          </div>
        ` : `
          <p class="feel-strength-hint">Apply channels/cards/roles/settings onto an existing server (people &amp; events kept), or create a new empty server with this structure.</p>
          <div class="field">
            <label for="srv-bak-target">Apply to</label>
            <select id="srv-bak-target">
              <option value="">Create new server…</option>
              ${options}
            </select>
          </div>
          <div class="field" id="srv-bak-new-wrap">
            <label for="srv-bak-new-name">New server name</label>
            <input id="srv-bak-new-name" maxlength="40" value="${esc((preview.serverName || "Server") + " (copy)")}">
          </div>
          <div class="actions backup-preview-actions">
            <button type="button" class="cancel" id="srv-bak-cancel">Cancel</button>
            <button type="button" class="save" id="srv-bak-struct">Restore structure</button>
          </div>
        `}
      </div>
    </div>`,
    singleton: "return",
  });
  if (!opened) return;
  const { overlay, close } = opened;
  overlay.querySelector("#srv-bak-cancel")?.addEventListener("click", () => close());
  if (isFull) {
    overlay.querySelector("#srv-bak-full")?.addEventListener("click", async () => {
      const ok = await ashConfirm(
        `Replace all data for “${preview.serverName || preview.serverId}”? This cannot be undone.`,
        { danger: true },
      );
      if (!ok) return;
      let res;
      try { res = JSON.parse(AshNative.applyServerFullBackup() || "{}"); }
      catch { res = { ok: false, error: "Restore failed" }; }
      if (!res.ok) { toast(res.error || "Restore failed"); return; }
      close();
      toast("Server restored");
      try { readHostStatus(); refreshHostSettingsPanel(); } catch {}
    });
    return;
  }
  const target = overlay.querySelector("#srv-bak-target");
  const newWrap = overlay.querySelector("#srv-bak-new-wrap");
  const syncNew = () => {
    if (newWrap) newWrap.hidden = !!(target && target.value);
  };
  target?.addEventListener("change", syncNew);
  syncNew();
  overlay.querySelector("#srv-bak-struct")?.addEventListener("click", async () => {
    const tid = String(target?.value || "").trim();
    const newName = String(overlay.querySelector("#srv-bak-new-name")?.value || "").trim();
    if (tid) {
      const label = list.find((x) => x.id === tid)?.name || tid;
      const ok = await ashConfirm(
        `Overwrite channels, cards, roles, and settings on “${label}”? Members and events stay.`,
        { danger: true },
      );
      if (!ok) return;
    }
    let hostName = "Host";
    try {
      const me = typeof loadMe === "function" ? loadMe() : null;
      if (me?.name) hostName = me.name;
    } catch {}
    let res;
    try {
      res = JSON.parse(AshNative.applyServerStructureBackup(tid, newName, hostName) || "{}");
    } catch { res = { ok: false, error: "Restore failed" }; }
    if (!res.ok) { toast(res.error || "Restore failed"); return; }
    close();
    toast(tid ? "Structure restored" : "Server created from structure");
    try { readHostStatus(); refreshHostSettingsPanel(); } catch {}
  });
}
