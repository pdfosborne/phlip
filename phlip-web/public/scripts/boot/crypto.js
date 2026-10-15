/* ---------------------- end-to-end encryption (content) ------------------ */
/* Content is encrypted in the browser with a key derived from the group
   passphrase. The host stores and relays only ciphertext. */

const _enc = new TextEncoder();
const _dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const LOCK = "🔒 can't decrypt — wrong passphrase?";

/** true when Web Crypto SubtleCrypto is usable (HTTPS / localhost). */
const _hasSubtle = !!(globalThis.crypto && globalThis.crypto.subtle);
const _lite = () => globalThis.AshCryptoLite || null;

async function digestSha256(data) {
  const bytes = typeof data === "string" ? _enc.encode(data)
    : (data instanceof Uint8Array ? data : new Uint8Array(data));
  if (_hasSubtle) {
    try { return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)); }
    catch { /* fall through to lite */ }
  }
  const lite = _lite();
  if (!lite) throw new Error("Secure crypto isn't available in this browser context.");
  return lite.sha256(bytes);
}

async function pbkdf2Bits(password, saltB64, bits = 256) {
  const salt = unb64(saltB64);
  if (_hasSubtle) {
    try {
      const base = await crypto.subtle.importKey("raw", _enc.encode(password), "PBKDF2", false, ["deriveBits"]);
      return new Uint8Array(await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" },
        base, bits));
    } catch { /* fall through */ }
  }
  const lite = _lite();
  if (!lite) throw new Error("Secure crypto isn't available in this browser context.");
  return lite.pbkdf2(password, salt, 150000, bits / 8);
}

async function importAesKey(rawBits) {
  if (_hasSubtle) {
    try {
      return await crypto.subtle.importKey("raw", rawBits, "AES-GCM", false, ["encrypt", "decrypt"]);
    } catch { /* fall through */ }
  }
  return { __ashRaw: new Uint8Array(rawBits) };
}

function ashRawKey(key) {
  return key && key.__ashRaw ? key.__ashRaw : null;
}

async function deriveKey(pass, saltB64) {
  const bits = await pbkdf2Bits(pass, saltB64, 256);
  return importAesKey(bits);
}

/** PBKDF2 → AES key + auth verifier (SHA-256 of key bits). Password never leaves the device. */
async function deriveAuthBundle(password, saltB64) {
  const bits = await pbkdf2Bits(password, saltB64, 256);
  const verifier = b64(await digestSha256(bits));
  const key = await importAesKey(bits);
  return { key, verifier };
}

function newPasswordSalt() {
  return b64(crypto.getRandomValues(new Uint8Array(16)));
}

function deviceId() {
  try {
    let id = localStorage.getItem("ash_device_id");
    if (!id) {
      const b = crypto.getRandomValues(new Uint8Array(16));
      id = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
      localStorage.setItem("ash_device_id", id);
    }
    return id;
  } catch {
    return "anon";
  }
}

async function sha256Hex(text) {
  const dig = await digestSha256(text);
  return [...dig].map(x => x.toString(16).padStart(2, "0")).join("");
}

/** Stable device fingerprint for a server + username (hash only — sent to host).
 *  Uses deviceId + server key + username only — not User-Agent (UA churn forced
 *  re-entry of the rotating join code after app updates). */
async function fingerprintFor(serverKey, username) {
  return sha256Hex(`${deviceId()}|${serverKey || ""}|${String(username || "").toLowerCase()}`);
}

/** Prefer a key that stays the same across visits for this device+account.
 *  Browser host pages always use location.origin (join TAG must not change the
 *  hash — that forced the rotating invite on every sign-in). App clients prefer
 *  the stable join TAG so public hostname changes don't invalidate trust. */
function fingerprintServerKey(connOrKey) {
  if (typeof isServedOrigin === "function" && isServedOrigin()) {
    return location.origin || "";
  }
  if (connOrKey && typeof connOrKey === "object") {
    return connOrKey.joinTag || connOrKey.id || connOrKey.url || "";
  }
  return connOrKey || "";
}

async function setupKeyBytes(nonce, name) {
  return digestSha256(`${nonce}:${String(name || "").toLowerCase()}`);
}

async function decryptGroupKeyOnce(blob, setupNonce, name) {
  if (typeof blob !== "string" || !blob.startsWith("e2eonce:")) return null;
  try {
    const keyBytes = await setupKeyBytes(setupNonce, name);
    const key = await importAesKey(keyBytes);
    const raw = unb64(blob.slice(8));
    const iv = raw.slice(0, 12);
    const ct = raw.slice(12);
    const rawKey = ashRawKey(key);
    let pt;
    if (rawKey) {
      const lite = _lite();
      if (!lite) return null;
      pt = lite.aesGcmDecrypt(rawKey, iv, ct);
    } else {
      pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    }
    return _dec.decode(pt);
  } catch { return null; }
}

/** After Approve: unwrap one-time group secret, set password credentials, store wrapped key. */
async function completePasswordSetup(conn, password, welcome) {
  const name = welcome.user?.name || conn.joinIntent?.name || conn.me?.name || "";
  const setupNonce = welcome.setupNonce || conn._setupNonce;
  let groupPass = null;
  if (welcome.groupKeyOnce && setupNonce) {
    groupPass = await decryptGroupKeyOnce(welcome.groupKeyOnce, setupNonce, name);
  }
  if (!groupPass) throw new Error("Couldn't finish password setup — ask the host to Approve again.");
  const salt = newPasswordSalt();
  const { key: pwKey, verifier } = await deriveAuthBundle(password, salt);
  const wrappedGroupKey = await encrypt(groupPass, pwKey);
  const fp = await fingerprintFor(fingerprintServerKey(conn), name);
  conn.pass = groupPass;
  if (welcome.e2eSalt) {
    conn.e2eSalt = welcome.e2eSalt;
    conn.key = await deriveKey(groupPass, welcome.e2eSalt);
  }
  const pwdMsg = {
    type: "setPassword",
    pwdSalt: salt,
    authVerifier: verifier,
    wrappedGroupKey,
    fingerprint: fp,
  };
  try {
    const idFields = await identityJoinFields();
    if (idFields.identityId) {
      pwdMsg.identityId = idFields.identityId;
      pwdMsg.identityPub = idFields.identityPub;
    }
  } catch {}
  // Always await HTTP /ash-rpc when we have a token. Local ws:// used to fire
  // setPassword before the socket was open, so authVerifier never saved and
  // every refresh demanded the join code again ("account isn't fully set up").
  if (conn.token) {
    let result = "failed";
    for (let i = 0; i < 6; i++) {
      result = await httpRpc(conn, pwdMsg);
      if (result === "sent") break;
      // Edge member bind can lag Approve — retry briefly before giving up.
      if (result !== "invite_lag") break;
      await new Promise((r) => setTimeout(r, 350 + i * 200));
    }
    if (result !== "sent") {
      throw new Error("Couldn't save your password — try signing in again.");
    }
  } else {
    sendTo(conn, pwdMsg);
  }
  conn._pendingPassword = null;
  conn._loginSalt = salt;
  saveCachedPwdSalt(conn.url || location.href, name, salt);
  persistConnSession(conn);
  return groupPass;
}

/** Returning member: unwrap stored group key with their password. */
async function unlockWrappedGroupKey(conn, password, welcome) {
  const saltRes = welcome._pwdSalt || welcome.pwdSalt || conn._pwdSalt;
  // Salt comes from /ash-auth-salt (invite-gated) or welcome.pwdSalt / local cache.
  const salt = saltRes || conn._loginSalt;
  if (!salt || !welcome.wrappedGroupKey) throw new Error("Missing credentials for this account.");
  const { key: pwKey } = await deriveAuthBundle(password, salt);
  const groupPass = await decrypt(welcome.wrappedGroupKey, pwKey);
  if (!groupPass) throw new Error("Wrong password.");
  conn.pass = groupPass;
  conn._loginSalt = salt;
  const nm = welcome.user?.name || conn.me?.name || "";
  if (nm) saveCachedPwdSalt(conn.url || location.href, nm, salt);
  if (welcome.e2eSalt) {
    conn.e2eSalt = welcome.e2eSalt;
    conn.key = await deriveKey(groupPass, welcome.e2eSalt);
  }
  persistConnSession(conn);
  return groupPass;
}

// key defaults to the active conn's — the majority of call sites act on
// whatever's currently on screen; interactions routed to a background conn
// (e.g. reacting to a remote event from the personal deck) pass that conn's
// key explicitly instead.
async function encrypt(text, key = S.key) {
  if (!key || !text) return text;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const rawKey = ashRawKey(key);
  let ctBytes;
  if (rawKey) {
    const lite = _lite();
    if (!lite) throw new Error("Secure crypto isn't available in this browser context.");
    ctBytes = lite.aesGcmEncrypt(rawKey, iv, _enc.encode(text));
  } else {
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, _enc.encode(text));
    ctBytes = new Uint8Array(ct);
  }
  const out = new Uint8Array(iv.length + ctBytes.byteLength);
  out.set(iv, 0); out.set(ctBytes, iv.length);
  return "e2e:" + b64(out);
}

// Returns plaintext, the original string if it wasn't encrypted, or null on failure.
async function decrypt(s, key) {
  if (typeof s !== "string" || !s.startsWith("e2e:")) return s;
  if (!key) return null;
  try {
    const raw = unb64(s.slice(4));
    const iv = raw.slice(0, 12);
    const ct = raw.slice(12);
    const rawKey = ashRawKey(key);
    let pt;
    if (rawKey) {
      const lite = _lite();
      if (!lite) return null;
      pt = lite.aesGcmDecrypt(rawKey, iv, ct);
    } else {
      pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    }
    return _dec.decode(pt);
  } catch { return null; }
}

// Decrypted values are cached on the object under _-prefixed fields so that
// rendering can stay synchronous. undefined = not yet, null = failed.
async function decMsg(m, key) {
  if (typeof hydratePlainMessage === "function") hydratePlainMessage(m);
  if (m._text === undefined) m._text = await decrypt(m.text, key);
  if (m.eventTitle && m._eventTitle === undefined) m._eventTitle = await decrypt(m.eventTitle, key);
}
async function decEvent(ev, key, meId = null) {
  ev._title = await decrypt(ev.title, key);
  ev._shortName = ev.shortName ? await decrypt(ev.shortName, key) : "";
  ev._where = ev.where ? await decrypt(ev.where, key) : "";
  ev._details = ev.details ? await decrypt(ev.details, key) : "";
  ev._sticker = ev.sticker ? await decrypt(ev.sticker, key) : "";
  ev._subtitle = ev.subtitle ? await decrypt(ev.subtitle, key) : "";
  for (const n of ev.notes || []) {
    await decEventNoteText(n, key, meId);
    if (n.linkedEventTitle) n._linkedEventTitle = await decrypt(n.linkedEventTitle, key);
  }
}
/** § Open availability — decrypt opaque where/details into `_` caches. */
async function decAvailability(avail, key) {
  if (!avail) return;
  avail._where = avail.where ? await decrypt(avail.where, key) : "";
  avail._details = avail.details ? await decrypt(avail.details, key) : "";
}

/** Time blocks — decrypt title/where/details. */
async function decTimeBlock(block, key) {
  if (!block) return;
  block._title = block.title ? await decrypt(block.title, key) : "";
  block._where = block.where ? await decrypt(block.where, key) : "";
  block._details = block.details ? await decrypt(block.details, key) : "";
}
/** Tasks — decrypt the opaque checklist text. */
async function decTask(task, key) {
  if (!task) return;
  task._text = task.text ? await decrypt(task.text, key) : "";
}
/** Polls — decrypt the question and each option label. */
async function decPoll(poll, key) {
  if (!poll) return;
  const cipher = (s) => typeof s === "string" && (s.startsWith("e2e:") || s.startsWith("box:") || s.startsWith("self:"));
  if (!key || !cipher(poll.question)) hydratePlainPoll(poll);
  if (key && cipher(poll.question)) poll._question = poll.question ? await decrypt(poll.question, key) : "";
  for (const opt of poll.options || []) {
    if (!opt) continue;
    if (key && cipher(opt.label)) opt._label = opt.label ? await decrypt(opt.label, key) : "";
    else if (opt._label === undefined) opt._label = opt.label || "";
  }
}
/** Routine snapshots use the same opaque event fields as their source event. */
async function decRoutine(routine, key) {
  if (!routine) return;
  routine._title = routine.title ? await decrypt(routine.title, key) : "";
  routine._where = routine.where ? await decrypt(routine.where, key) : "";
  routine._subtitle = routine.subtitle ? await decrypt(routine.subtitle, key) : "";
}
// Decrypts everything belonging to one connection (its own key — never the
// active conn's, since a background conn can resync while another is on screen).
async function decryptAll(conn) {
  if (typeof hydratePlainMessages === "function") hydratePlainMessages(conn);
  const jobs = [];
  const meId = conn?.me?.id || null;
  for (const arr of Object.values(conn.messages || {})) for (const m of arr) jobs.push(decMsg(m, conn.key));
  for (const ev of conn.events || []) jobs.push(decEvent(ev, conn.key, meId));
  for (const a of conn.availabilities || []) jobs.push(decAvailability(a, conn.key));
  for (const b of conn.timeBlocks || []) jobs.push(decTimeBlock(b, conn.key));
  for (const task of conn.tasks || []) jobs.push(decTask(task, conn.key));
  for (const poll of conn.polls || []) jobs.push(decPoll(poll, conn.key));
  for (const r of conn.routines || []) jobs.push(decRoutine(r, conn.key));
  await Promise.all(jobs);
}
const shown = (v) => v === null ? LOCK : v === undefined ? "…" : v;
// Prefer the decrypted `_` cache; fall back to plaintext wire (never e2e/box ciphertext).
function shownField(cached, wire) {
  if (cached !== undefined) return shown(cached);
  if (typeof wire === "string" && !wire.startsWith("e2e:") && !wire.startsWith("box:") && !wire.startsWith("self:")) {
    return wire;
  }
  return shown(undefined);
}
/** Sync plaintext wire → `_` caches so personal persist doesn't race async decrypt. */
function hydratePlainEvent(ev) {
  if (!ev) return;
  const plain = (s) => typeof s === "string" && !s.startsWith("e2e:") && !s.startsWith("self:") && !s.startsWith("box:");
  if (ev._title === undefined && plain(ev.title)) ev._title = ev.title;
  if (ev._where === undefined && (ev.where === "" || plain(ev.where))) ev._where = ev.where || "";
  if (ev._details === undefined && (ev.details === "" || plain(ev.details))) ev._details = ev.details || "";
  if (ev._sticker === undefined && (ev.sticker === "" || plain(ev.sticker))) ev._sticker = ev.sticker || "";
  if (ev._shortName === undefined && (!ev.shortName || plain(ev.shortName))) ev._shortName = ev.shortName || "";
  if (ev._subtitle === undefined && (ev.subtitle === "" || plain(ev.subtitle))) ev._subtitle = ev.subtitle || "";
  for (const n of ev.notes || []) {
    if (n._text === undefined && plain(n.text)) n._text = n.text;
  }
}

/** § Open availability — plaintext wire → `_` caches (personal / non-e2e). */
function hydratePlainAvailability(avail) {
  if (!avail) return;
  const plain = (s) => typeof s === "string" && !s.startsWith("e2e:") && !s.startsWith("self:") && !s.startsWith("box:");
  if (avail._where === undefined && (avail.where === "" || plain(avail.where))) avail._where = avail.where || "";
  if (avail._details === undefined && (avail.details === "" || plain(avail.details))) avail._details = avail.details || "";
}

/** Time blocks — plaintext wire → `_` caches. */
function hydratePlainTimeBlock(block) {
  if (!block) return;
  const plain = (s) => typeof s === "string" && !s.startsWith("e2e:") && !s.startsWith("self:") && !s.startsWith("box:");
  if (block._title === undefined && (block.title === "" || plain(block.title))) block._title = block.title || "";
  if (block._where === undefined && (block.where === "" || plain(block.where))) block._where = block.where || "";
  if (block._details === undefined && (block.details === "" || plain(block.details))) block._details = block.details || "";
}

function hydratePlainTask(task) {
  if (!task) return;
  const plain = (s) => typeof s === "string" && !s.startsWith("e2e:") && !s.startsWith("self:") && !s.startsWith("box:");
  if (task._text === undefined && (task.text === "" || plain(task.text))) task._text = task.text || "";
}

function hydratePlainPoll(poll) {
  if (!poll) return;
  const plain = (s) => typeof s === "string" && !s.startsWith("e2e:") && !s.startsWith("self:") && !s.startsWith("box:");
  if (poll._question === undefined && (poll.question === "" || plain(poll.question))) poll._question = poll.question || "";
  for (const opt of poll.options || []) {
    if (opt && opt._label === undefined && (opt.label === "" || plain(opt.label))) opt._label = opt.label || "";
  }
}

/** Chat — plaintext wire → `_text` so personal persist/reload doesn't render "…". */
function hydratePlainMessage(m) {
  if (!m) return;
  const plain = (s) => typeof s === "string" && !s.startsWith("e2e:") && !s.startsWith("self:") && !s.startsWith("box:");
  if (m._text === undefined && (m.text === "" || plain(m.text))) m._text = m.text || "";
  if (m.eventTitle && m._eventTitle === undefined && plain(m.eventTitle)) m._eventTitle = m.eventTitle;
}

function hydratePlainMessages(conn) {
  if (!conn) return;
  for (const arr of Object.values(conn.messages || {})) {
    for (const m of arr || []) hydratePlainMessage(m);
  }
}

/* ---------------------- 016 · device identity keypair -------------------- */
/* ECDH P-256; private JWK sealed via AshNative → DeviceKeyStore when available. */

const IDENTITY_SECRET_ALIAS = "identity_p256_jwk";
const IDENTITY_LS_KEY = "ash_identity_v1";

function _identityNativeGet() {
  try {
    if (window.AshNative?.getDeviceSecret)
      return String(AshNative.getDeviceSecret(IDENTITY_SECRET_ALIAS) || "");
  } catch {}
  return "";
}

function _identityNativePut(value) {
  try {
    if (window.AshNative?.putDeviceSecret)
      return !!AshNative.putDeviceSecret(IDENTITY_SECRET_ALIAS, value);
  } catch {}
  return false;
}

async function _spkiToIdentityId(spkiBuf) {
  const dig = await digestSha256(spkiBuf);
  return [...dig].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

async function _generateIdentityKeypair() {
  if (!_hasSubtle) throw new Error("Web Crypto unavailable for identity keys");
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const privJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const identityId = await _spkiToIdentityId(spki);
  const identityPub = b64(spki);
  const record = { v: 1, identityId, identityPub, privateJwk: privJwk };
  const raw = JSON.stringify(record);
  if (!_identityNativePut(raw)) {
    try { localStorage.setItem(IDENTITY_LS_KEY, raw); } catch {}
  } else {
    try { localStorage.removeItem(IDENTITY_LS_KEY); } catch {}
  }
  return { identityId, identityPub, privateJwk: privJwk };
}

function _loadIdentityRecord() {
  let raw = _identityNativeGet();
  if (!raw) {
    try { raw = localStorage.getItem(IDENTITY_LS_KEY) || ""; } catch { raw = ""; }
  }
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (!o?.identityId || !o?.identityPub || !o?.privateJwk) return null;
    return o;
  } catch {
    return null;
  }
}

/** Ensure a device identity exists; returns { identityId, identityPub }. */
async function ensureDeviceIdentity() {
  const existing = _loadIdentityRecord();
  if (existing) {
    if (_identityNativeGet() === "" && window.AshNative?.putDeviceSecret) {
      try {
        const raw = localStorage.getItem(IDENTITY_LS_KEY);
        if (raw && _identityNativePut(raw)) localStorage.removeItem(IDENTITY_LS_KEY);
      } catch {}
    }
    return { identityId: existing.identityId, identityPub: existing.identityPub };
  }
  try {
    const fresh = await _generateIdentityKeypair();
    return { identityId: fresh.identityId, identityPub: fresh.identityPub };
  } catch (e) {
    console.warn("identity keygen failed", e);
    return { identityId: "", identityPub: "" };
  }
}

/** Fields to attach on join / setPassword. */
async function identityJoinFields() {
  const id = await ensureDeviceIdentity();
  if (!id.identityId) return {};
  return { identityId: id.identityId, identityPub: id.identityPub };
}

/* ---------------------- 018 · seal personal notes to identity ------------- */

async function _identityAesKey() {
  if (!_hasSubtle) throw new Error("Web Crypto unavailable for personal notes");
  await ensureDeviceIdentity();
  const rec = _loadIdentityRecord();
  if (!rec?.privateJwk || !rec?.identityPub) throw new Error("No device identity");
  const priv = await crypto.subtle.importKey(
    "jwk", rec.privateJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  const pub = await crypto.subtle.importKey(
    "spki", unb64(rec.identityPub),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256);
  return crypto.subtle.importKey("raw", bits, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Encrypt plaintext so only this device's identity can read it (`self:` prefix). */
async function sealToSelf(text) {
  if (!text) return text;
  const key = await _identityAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, _enc.encode(text)));
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv, 0); out.set(ct, iv.length);
  return "self:" + b64(out);
}

/** Decrypt a `self:` blob; returns null on failure / wrong device. */
async function openSelfSeal(s) {
  if (typeof s !== "string" || !s.startsWith("self:")) return s;
  try {
    const key = await _identityAesKey();
    const raw = unb64(s.slice(5));
    const iv = raw.slice(0, 12);
    const ct = raw.slice(12);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return _dec.decode(pt);
  } catch {
    return null;
  }
}

async function decEventNoteText(n, key, meId) {
  if (!n) return;
  if (n.noteKind === "personal") {
    if (meId && n.userId === meId && typeof n.text === "string" && n.text.startsWith("self:")) {
      n._text = await openSelfSeal(n.text);
    } else if (meId && n.userId === meId) {
      // Legacy / mis-sealed — try group key as fallback.
      n._text = key ? await decrypt(n.text, key) : null;
    } else {
      n._text = null; // opaque to everyone else
    }
    return;
  }
  n._text = await decrypt(n.text, key);
}

