/**
 * Phlip edge Worker — personal-invite gate + event Broadcast KV + tiered origin proxy.
 *
 * Bindings: KV (namespace), EDGE_SECRET, ORIGIN, HOST_SYNC
 * Public hostnames route here; ORIGIN is unguessable o-<random>.apex via tunnel.
 * Bare public URL exposes returning-member sign-in only. New joins require a
 * personal /j/<slug> invite — no rotating join codes.
 */

const COOKIE = "phlip_edge";
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
/** Bumped when Worker behavior changes — returned on join errors for deploy checks. */
const EDGE_VER = "20260814open3";
const HSTS_HEADER = "max-age=31536000; includeSubDomains";

/** In-memory share-join throttle (per isolate). Must not use KV — free write caps are tiny. */
const SHARE_JOIN_RATE = new Map();
/** Personal invite /j/* throttle (per IP and per slug). Memory only. */
const JOIN_META_RATE = new Map();
const JOIN_REQ_IP_RATE = new Map();
const JOIN_REQ_SLUG_RATE = new Map();
/** Bare-root returning-member salt/login throttle (per isolate). */
const PUBLIC_LOGIN_RATE = new Map();
/** Live share snapshots when KV writes are capped (per isolate; Cache API backs it up). */
const SHARE_MEM = new Map();
/** Host inbox when KV writes are capped. */
const INBOX_MEM = new Map();
/** Offline join-request queue when origin is down (per isolate fallback). */
const JOINREQ_MEM = new Map();
/** hostname → Set of live share ids (when shares: index KV writes fail). */
const SHARES_BY_HOST = new Map();
/** hostname → "free" | "paid" (host-confirmed Workers plan). */
const PLAN_MEM = new Map();
/** Per-isolate KV write meter for the UTC day (flushed to Cache API — not KV). */
const KV_METER_MEM = { day: "", writes: 0, limited: false };

/**
 * Turnstile: when env.TURNSTILE_SECRET is set, browser POSTs to /j/:slug/request
 * should include turnstileToken. Native/app clients may omit it. When the secret
 * is not configured, verification is skipped (documented Stage 5 behavior).
 */

const INVITE_PATHS = new Set([
  "/ash-ok",
  "/ash-auth-salt",
  "/ash-login",
  "/ash-join",
  "/ash-join-wait",
]);

const MEMBER_EXTRA = new Set([
  "/ash-poll",
  "/ash-leave",
  "/ash-rpc",
]);

const STATIC_EXT = /\.(js|css|png|svg|ico|webmanifest|woff2?)$/i;

function json(obj, status = 200, extra = {}, req = null) {
  const headers = {
    "content-type": "application/json; charset=UTF-8",
    "cache-control": "no-store",
    ...corsHeaders(req),
    ...extra,
  };
  let body;
  try {
    body = JSON.stringify(obj);
  } catch (_) {
    status = 500;
    body = JSON.stringify({ type: "error", error: "Couldn't build the response." });
  }
  return new Response(body, { status, headers });
}

function corsAllowedOrigin(req) {
  const origin = req.headers.get("Origin") || "";
  if (!origin) return null;
  const host = hostOf(req);
  try {
    const o = new URL(origin);
    if (o.protocol !== "https:" && o.protocol !== "http:") return null;
    // Same host (share page / browser on public hostname).
    if (o.hostname.toLowerCase() === host) return origin;
    // Android WebView asset origin (credentialed join to public hosts).
    if (o.hostname === "appassets.androidplatform.net" && o.protocol === "https:") {
      return origin;
    }
  } catch (_) {}
  return null;
}

function corsHeaders(req) {
  if (!req) return {};
  const allowed = corsAllowedOrigin(req);
  const base = {
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers":
      "Content-Type, X-Ash-Pass, X-Ash-Token, X-Phlip-Edge, X-Phlip-Invite, X-Phlip-Host-Sync, Accept",
  };
  if (allowed) {
    return {
      ...base,
      "access-control-allow-origin": allowed,
      "access-control-allow-credentials": "true",
      "vary": "Origin",
    };
  }
  // Unknown Origin: no ACAO (browser blocks credentialed cross-origin).
  return base;
}

function withCors(res, req) {
  const headers = new Headers(res.headers);
  const cors = corsHeaders(req);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function responseNonce() {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Final HTTPS boundary for every Worker response. Cloudflare zone HSTS also
 * covers managed challenge/error pages that execute before this Worker.
 */
async function withEdgeSecurity(res, req) {
  const headers = new Headers(res.headers);
  headers.set("strict-transport-security", HSTS_HEADER);

  const contentType = (headers.get("content-type") || "").toLowerCase();
  const isHtml = contentType.includes("text/html");
  if (!isHtml || headers.has("content-security-policy")) {
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  }

  const nonce = responseNonce();
  headers.set(
    "content-security-policy",
    [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      "script-src-attr 'none'",
      `style-src 'nonce-${nonce}'`,
      "style-src-attr 'none'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "child-src 'self' blob:",
      "frame-src 'self'",
      "manifest-src 'self'",
      "media-src 'self' blob:",
      "form-action 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-ancestors 'none'",
    ].join("; "),
  );

  if (req.method === "HEAD") {
    return new Response(null, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  }

  let body = await res.text();
  body = body
    .replace(/<script(?=[\s>])/gi, `<script nonce="${nonce}"`)
    .replace(/<style(?=[\s>])/gi, `<style nonce="${nonce}"`);
  headers.delete("content-encoding");
  headers.delete("content-length");
  return new Response(body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

/** Bare public host — no join form; personal /j/<slug> invite required. */
function gateHtml(host, err, req = null) {
  const msg = err ? `<p class="err">${esc(err)}</p>` : "";
  const body = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>Invite required — Phlip</title>
<style>
body{font-family:system-ui,sans-serif;background:#1a1a18;color:#f2efe8;margin:0;
display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.card{max-width:360px;width:100%;background:#242420;padding:28px 24px;border-radius:12px}
h1{font-size:1.25rem;margin:0 0 8px;font-weight:600}
p{color:#a8a49a;font-size:.9rem;line-height:1.4;margin:0 0 12px}
.err{color:#e07070;margin:0 0 12px}
.hint{margin:0;font-size:.8rem;color:#7a766c}
</style></head><body>
<div class="card">
<h1>Invite link required</h1>
<p>You need a personal invite link from someone on this server to request to join.</p>
${msg}
<p class="hint">Ask them to share their Phlip invite (a link that looks like …/j/…).</p>
</div></body></html>`;
  return new Response(body, {
    status: err ? 401 : 200,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "cache-control": "no-store",
      ...corsHeaders(req),
    },
  });
}

/** Unknown, rotated, or revoked personal invite — no join surface. */
function inviteLinkExpiredHtml(req = null) {
  const body = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>Invite link expired — Phlip</title>
<style>
body{font-family:system-ui,sans-serif;background:#1a1a18;color:#f2efe8;margin:0;
display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.card{max-width:360px;width:100%;background:#242420;padding:28px 24px;border-radius:12px;text-align:center}
h1{font-size:1.25rem;margin:0 0 8px;font-weight:600}
p{color:#a8a49a;font-size:.9rem;line-height:1.4;margin:0}
</style></head><body>
<div class="card">
<h1>Invite link expired</h1>
<p>This link may have been replaced or revoked. Ask someone on the server to send you a new invite.</p>
</div></body></html>`;
  return new Response(body, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "cache-control": "no-store",
      ...corsHeaders(req),
    },
  });
}

/** Shown when `?s=` names a Broadcast that was stopped. */
function broadcastEndedHtml(req = null) {
  const body = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>Broadcast ended — Phlip</title>
<style>
body{font-family:system-ui,sans-serif;background:#1a1a18;color:#f2efe8;margin:0;
display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.card{max-width:360px;width:100%;background:#242420;padding:28px 24px;border-radius:12px;text-align:center}
h1{font-size:1.25rem;margin:0 0 8px;font-weight:600}
p{color:#a8a49a;font-size:.9rem;line-height:1.4;margin:0}
</style></head><body>
<div class="card">
<h1>This event isn’t being broadcast anymore</h1>
<p>The host stopped the Broadcast — this link is closed.</p>
</div></body></html>`;
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "cache-control": "no-store",
      ...corsHeaders(req),
    },
  });
}

/** Share id present but no live record (host push failed / not synced yet). */
function broadcastUnavailableHtml(req = null) {
  const body = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>Broadcast unavailable — Phlip</title>
<style>
body{font-family:system-ui,sans-serif;background:#1a1a18;color:#f2efe8;margin:0;
display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.card{max-width:360px;width:100%;background:#242420;padding:28px 24px;border-radius:12px;text-align:center}
h1{font-size:1.25rem;margin:0 0 8px;font-weight:600}
p{color:#a8a49a;font-size:.9rem;line-height:1.4;margin:0}
</style></head><body>
<div class="card">
<h1>This Broadcast isn’t available yet</h1>
<p>Ask the host to open the event and tap Refresh, then reload this page.</p>
</div></body></html>`;
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "cache-control": "no-store",
      ...corsHeaders(req),
    },
  });
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const dig = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time hex/string compare (equal length required). */
function timingSafeEqual(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret, msg) {
  const enc = new TextEncoder();
  // Web Crypto rejects empty HMAC keys — never pass a zero-length secret.
  let raw = enc.encode(String(secret || ""));
  if (raw.byteLength === 0) raw = enc.encode("phlip-edge");
  const key = await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(String(msg || "")));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Guest session proof — passcode never re-checked after join. */
async function guestSessionProof(env, token, shareId, name) {
  const secret = env.EDGE_SECRET || env.HOST_SYNC || "phlip-edge";
  return hmacHex(secret, `guest|${token}|${shareId}|${name}`);
}

async function verifyGuestSession(env, guest) {
  if (!guest || !guest.token || !guest.shareId) return false;
  const expect = await guestSessionProof(env, guest.token, guest.shareId, guest.name || "");
  return timingSafeEqual(guest.proof || "", expect);
}

/** Host upsert authenticity for share records pushed to KV. */
async function shareUpsertMac(env, share) {
  return hmacHex(
    env.HOST_SYNC || env.EDGE_SECRET,
    `share|${share.id}|${share.passHash || ""}|${share.expiresAt || 0}|${share.refId || ""}`,
  );
}

function parseCookies(req) {
  const raw = req.headers.get("cookie") || "";
  const out = {};
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function hostOf(req) {
  return (req.headers.get("host") || "").split(":")[0].toLowerCase();
}

async function kvGetJson(env, key) {
  const raw = await env.KV.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function utcDayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function loadKvMeter() {
  const day = utcDayKey();
  if (KV_METER_MEM.day === day) return;
  KV_METER_MEM.day = day;
  KV_METER_MEM.writes = 0;
  KV_METER_MEM.limited = false;
  try {
    const cached = await cacheGetJson(`kvmeter:${day}`);
    if (cached) {
      KV_METER_MEM.writes = Math.max(0, Number(cached.writes) || 0);
      KV_METER_MEM.limited = !!cached.limited;
    }
  } catch (_) {}
}

async function flushKvMeter() {
  if (!KV_METER_MEM.day) return;
  try {
    await cachePutJson(
      `kvmeter:${KV_METER_MEM.day}`,
      { writes: KV_METER_MEM.writes, limited: KV_METER_MEM.limited },
      86400 * 2,
    );
  } catch (_) {}
}

async function noteKvWriteSuccess() {
  await loadKvMeter();
  KV_METER_MEM.writes += 1;
  await flushKvMeter();
}

async function noteKvWriteLimited() {
  await loadKvMeter();
  KV_METER_MEM.limited = true;
  await flushKvMeter();
}

async function kvMeterSnapshot(plan) {
  await loadKvMeter();
  return {
    writes: KV_METER_MEM.writes,
    budget: 1000,
    plan: plan === "paid" ? "paid" : "free",
    limited: !!KV_METER_MEM.limited,
    day: KV_METER_MEM.day || utcDayKey(),
    edgeVer: EDGE_VER,
  };
}

async function kvPutJson(env, key, obj, expirationTtl) {
  const opts = expirationTtl ? { expirationTtl } : undefined;
  try {
    await env.KV.put(key, JSON.stringify(obj), opts);
    await noteKvWriteSuccess();
  } catch (e) {
    if (isKvWriteLimitError(e)) await noteKvWriteLimited();
    throw e;
  }
}

function isKvWriteLimitError(e) {
  return /limit exceeded/i.test(String((e && e.message) || e || ""));
}

async function workersPlanFor(env, host) {
  const h = String(host || "").toLowerCase();
  if (!h) return "free";
  if (PLAN_MEM.has(h)) return PLAN_MEM.get(h);
  try {
    const cached = await cacheGetJson(`workersPlan:${h}`);
    if (cached && (cached.plan === "paid" || cached.plan === "free")) {
      PLAN_MEM.set(h, cached.plan);
      return cached.plan;
    }
  } catch (_) {}
  try {
    const fromKv = await kvGetJson(env, `workersPlan:${h}`);
    if (fromKv && (fromKv.plan === "paid" || fromKv.plan === "free")) {
      PLAN_MEM.set(h, fromKv.plan);
      return fromKv.plan;
    }
  } catch (_) {}
  return "free";
}

async function setWorkersPlan(env, host, plan) {
  const h = String(host || "").toLowerCase();
  if (!h) return;
  const p = plan === "paid" ? "paid" : "free";
  PLAN_MEM.set(h, p);
  try {
    await cachePutJson(`workersPlan:${h}`, { plan: p }, 86400 * 30);
  } catch (_) {}
  // Rare host-driven write — make Paid/Free visible across colos.
  try {
    await kvPutJson(env, `workersPlan:${h}`, { plan: p }, 86400 * 30);
  } catch (e) {
    if (!isKvWriteLimitError(e)) throw e;
  }
}

async function maybeSyncPlanFromRequest(req, env, hostname) {
  const hdr = (req.headers.get("x-phlip-workers-plan") || "").trim().toLowerCase();
  if (hdr !== "paid" && hdr !== "free") return;
  const host = String(hostname || hostOf(req)).toLowerCase();
  if (!host) return;
  const cur = await workersPlanFor(env, host);
  if (cur !== hdr) await setWorkersPlan(env, host, hdr);
}

function cacheKeyUrl(key) {
  return new Request(`https://phlip-edge.internal/cache/${encodeURIComponent(key)}`);
}

async function cacheGetJson(key) {
  try {
    const hit = await caches.default.match(cacheKeyUrl(key));
    if (!hit) return null;
    return await hit.json();
  } catch {
    return null;
  }
}

async function cachePutJson(key, obj, ttlSec) {
  const ttl = Math.max(60, Number(ttlSec) || 3600);
  await caches.default.put(
    cacheKeyUrl(key),
    new Response(JSON.stringify(obj), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `max-age=${ttl}`,
      },
    }),
  );
}

/** Guest sessions: KV first; Cache API if the daily KV write cap is hit. */
async function guestStoreGet(env, token) {
  const key = `guest:${token}`;
  return (await kvGetJson(env, key)) || (await cacheGetJson(key));
}

async function guestStorePut(env, token, guest) {
  const key = `guest:${token}`;
  try {
    await kvPutJson(env, key, guest, 86400 * 2);
  } catch (e) {
    if (!isKvWriteLimitError(e)) throw e;
    await cachePutJson(key, guest, 86400 * 2);
  }
}

async function shareGuestsGet(env, sid) {
  const key = `shareGuests:${sid}`;
  return (await kvGetJson(env, key)) || (await cacheGetJson(key)) || { tokens: [] };
}

async function shareGuestsPut(env, sid, glist) {
  const key = `shareGuests:${sid}`;
  try {
    await kvPutJson(env, key, glist, 86400 * 2);
  } catch (e) {
    if (!isKvWriteLimitError(e)) throw e;
    await cachePutJson(key, glist, 86400 * 2);
  }
}

/** Share snapshot: KV first (global), then Cache, then memory.
 *  Always re-check KV so Stop→Broadcast reopen and cross-colo updates aren't stuck
 *  behind a stale SHARE_MEM / Cache closed copy. */
async function shareRecordGet(env, shareId) {
  const sid = String(shareId || "").trim();
  if (!sid) return null;
  const fromKv = await kvGetJson(env, `share:${sid}`);
  if (fromKv) {
    SHARE_MEM.set(sid, fromKv);
    return fromKv;
  }
  const fromCache = await cacheGetJson(`share:${sid}`);
  if (fromCache) {
    SHARE_MEM.set(sid, fromCache);
    return fromCache;
  }
  if (SHARE_MEM.has(sid)) return SHARE_MEM.get(sid);
  return null;
}

async function shareRecordPut(env, share, opts = {}) {
  const sid = String(share?.id || "").trim();
  if (!sid) throw new Error("share id required");
  SHARE_MEM.set(sid, share);
  try {
    await kvPutJson(env, `share:${sid}`, share, 86400 * 14);
    return "kv";
  } catch (e) {
    if (!isKvWriteLimitError(e)) throw e;
    if (opts.requireKv) throw e;
    await cachePutJson(`share:${sid}`, share, 86400 * 14);
    return "cache";
  }
}

/** Durable “Broadcast stopped” marker — survives KV write failures via Cache API. */
async function markShareClosed(env, id) {
  const sid = String(id || "").trim();
  if (!sid) return;
  try {
    await cachePutJson(`shareClosed:${sid}`, { closed: true, at: Date.now() }, 86400 * 14);
  } catch (_) {}
  let share = await shareRecordGet(env, sid);
  if (share) {
    share = { ...share, closed: true };
    SHARE_MEM.set(sid, share);
    try {
      await kvPutJson(env, `share:${sid}`, share, 3600);
    } catch (e) {
      if (isKvWriteLimitError(e)) {
        try {
          await cachePutJson(`share:${sid}`, share, 3600);
        } catch (_) {}
      }
    }
  } else {
    SHARE_MEM.set(sid, { id: sid, closed: true });
  }
}

/** Host live upsert clears stop marks so Stop→Broadcast again (same id) works. */
async function clearShareClosed(env, id) {
  const sid = String(id || "").trim();
  if (!sid) return;
  try {
    await caches.default.delete(cacheKeyUrl(`shareClosed:${sid}`));
  } catch (_) {}
  const mem = SHARE_MEM.get(sid);
  if (mem && mem.closed) {
    mem.closed = false;
    SHARE_MEM.set(sid, mem);
  }
}

/**
 * Host upsert is source of truth. A colo-local Cache "stopped" mark must not
 * override a live share (closed:false) from KV — that caused guests to see
 * "host stopped" while the phone still showed Broadcast live.
 */
async function isShareClosed(env, shareId) {
  const sid = String(shareId || "").trim();
  if (!sid) return true;
  const share = await shareRecordGet(env, sid);
  if (share) {
    if (!share.closed) {
      try {
        await caches.default.delete(cacheKeyUrl(`shareClosed:${sid}`));
      } catch (_) {}
      return false;
    }
    return true;
  }
  try {
    const mark = await cacheGetJson(`shareClosed:${sid}`);
    if (mark && mark.closed) return true;
  } catch (_) {}
  return false;
}

function requireHostSync(req, env) {
  const got = req.headers.get("x-phlip-host-sync") || "";
  return got && env.HOST_SYNC && got === env.HOST_SYNC;
}

async function tierFor(req, env, hostname) {
  // Member bearer first. Invite cookie / X-Phlip-Invite must not trap an approved
  // client (Android WebView keeps the invite header after join).
  const bearer =
    req.headers.get("x-ash-token") ||
    new URL(req.url).searchParams.get("token") ||
    "";
  if (bearer) {
    const hash = await sha256Hex(bearer);
    const key = `member:${hostname}:${hash}`;
    const mem = (await kvGetJson(env, key)) || (await cacheGetJson(key));
    if (mem && (!mem.exp || mem.exp > Date.now())) {
      return { tier: "member", token: bearer };
    }
  }
  const cookies = parseCookies(req);
  const edgeTok =
    cookies[COOKIE] ||
    String(req.headers.get("x-phlip-invite") || "").trim();
  if (edgeTok) {
    const sess = await kvGetJson(env, `edge:${hostname}:${edgeTok}`);
    if (sess && sess.tier === "invite" && (!sess.exp || sess.exp > Date.now())) {
      return { tier: "invite", token: edgeTok };
    }
  }
  return { tier: "none" };
}

function isStaticPath(pathname) {
  if (pathname === "/" || pathname === "/index.html") return true;
  if (STATIC_EXT.test(pathname)) return true;
  if (pathname.startsWith("/assets/")) return true;
  return [
    "/favicon.ico",
    "/manifest.webmanifest",
    "/sw.js",
    "/theme-boot.js",
    "/register-sw.js",
    "/style.css",
  ].includes(pathname);
}

function allowedProxy(tier, pathname) {
  if (tier === "member") {
    return (
      INVITE_PATHS.has(pathname) ||
      MEMBER_EXTRA.has(pathname) ||
      isStaticPath(pathname)
    );
  }
  if (tier === "invite") {
    return INVITE_PATHS.has(pathname) || isStaticPath(pathname);
  }
  return false;
}

/**
 * Reject paths that could rewrite the fetch host via the two-arg URL ctor
 * (protocol-relative `//…`) or confuse origin routing.
 */
function isSafeProxyPath(pathname) {
  if (!pathname || pathname[0] !== "/") return false;
  if (pathname.startsWith("//")) return false;
  if (pathname.includes("\\") || /[\u0000-\u001f\u007f]/.test(pathname)) return false;
  // Collapse accidental multi-slash so //evil never slips through later joins.
  if (pathname.includes("//")) return false;
  return true;
}

function clientIp(req) {
  const cf = (req.headers.get("CF-Connecting-IP") || "").split(",")[0].trim();
  if (cf) return cf;
  const xff = (req.headers.get("X-Forwarded-For") || "").split(",")[0].trim();
  return xff || "unknown";
}

/** Share-join brute-force throttle: 5 fails → 60s lock. Memory only (no KV writes). */
function shareJoinRateCheck(ip) {
  const now = Date.now();
  if (SHARE_JOIN_RATE.size > 2000) {
    for (const [k, v] of SHARE_JOIN_RATE) {
      if (!v || (v.until && v.until < now) || (!v.until && !(v.fails > 0))) {
        SHARE_JOIN_RATE.delete(k);
      }
    }
  }
  const rec = SHARE_JOIN_RATE.get(ip) || { fails: 0, until: 0 };
  if (rec.until && rec.until > now) {
    return { ok: false, retryAfterMs: rec.until - now };
  }
  return { ok: true, rec, ip };
}

function shareJoinRateFail(check) {
  if (!check || !check.ip) return;
  const now = Date.now();
  const fails = (check.rec?.fails || 0) + 1;
  const until = fails >= 5 ? now + 60_000 : 0;
  SHARE_JOIN_RATE.set(check.ip, { fails: until ? 0 : fails, until });
}

function shareJoinRateClear(check) {
  if (check && check.ip) SHARE_JOIN_RATE.delete(check.ip);
}

/** Sliding-window rate limit helper (memory Map). */
function rateCheck(map, key, limit, windowMs) {
  const now = Date.now();
  if (map.size > 4000) {
    for (const [k, v] of map) {
      if (!v || !Array.isArray(v.ts) || !v.ts.length || v.ts[v.ts.length - 1] < now - windowMs * 2) {
        map.delete(k);
      }
    }
  }
  const rec = map.get(key) || { ts: [] };
  rec.ts = (rec.ts || []).filter((t) => t > now - windowMs);
  if (rec.ts.length >= limit) {
    const retryAfterMs = Math.max(250, (rec.ts[0] || now) + windowMs - now);
    return { ok: false, retryAfterMs };
  }
  rec.ts.push(now);
  map.set(key, rec);
  return { ok: true };
}

function normPersonalSlug(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 32);
}

function parsePersonalInvitePath(pathname) {
  const m = String(pathname || "").match(/^\/j\/([a-z0-9]+)(?:\/(request))?\/?$/i);
  if (!m) return null;
  const slug = normPersonalSlug(m[1]);
  if (slug.length < 8) return null;
  return { slug, isRequest: !!m[2] };
}

async function loadHostSlugs(env, hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host) return null;
  return (
    (await kvGetJson(env, `slugs:${host}`)) ||
    (await cacheGetJson(`slugs:${host}`)) ||
    null
  );
}

/** Best-effort delete of a personal slug record (KV + Cache API). */
async function deleteSlugKey(env, slug) {
  const s = normPersonalSlug(slug);
  if (s.length < 8) return;
  const key = `slug:${s}`;
  try {
    await env.KV.delete(key);
  } catch (_) {}
  try {
    await caches.default.delete(cacheKeyUrl(key));
  } catch (_) {}
}

function packHasSlug(pack, slug) {
  const s = normPersonalSlug(slug);
  if (s.length < 8) return false;
  const list = Array.isArray(pack?.slugs) ? pack.slugs : [];
  return list.some((x) => normPersonalSlug(x) === s);
}

async function resolveSlugRecord(env, slug, hintHostname) {
  const s = normPersonalSlug(slug);
  if (s.length < 8) return null;
  const direct = await kvGetJson(env, `slug:${s}`);
  if (direct && direct.hostname) {
    const host = String(direct.hostname || "").toLowerCase();
    const pack = await loadHostSlugs(env, host);
    // Pack is the allowlist — rotated/orphan slug: keys must not keep /j/<old> alive.
    if (!packHasSlug(pack, s)) {
      await deleteSlugKey(env, s);
      // Fall through to hintHostname pack membership below.
    } else {
      return { ...direct, slug: s };
    }
  }
  const host = String(hintHostname || "").toLowerCase();
  if (host) {
    const pack = await loadHostSlugs(env, host);
    if (packHasSlug(pack, s)) {
      return {
        slug: s,
        hostname: host,
        hostDisplayName: pack.hostDisplayName || "",
        publicHost: host,
      };
    }
  }
  return null;
}

async function slugAllowedForHost(env, hostname, slug) {
  const rec = await resolveSlugRecord(env, slug, hostname);
  if (!rec) return false;
  const host = String(hostname || "").toLowerCase();
  if (host && String(rec.hostname || "").toLowerCase() !== host) return false;
  // Re-check pack so a race between resolve and rotate still rejects stale slugs.
  const pack = await loadHostSlugs(env, String(rec.hostname || host || "").toLowerCase());
  return packHasSlug(pack, slug);
}

async function originBaseFor(env, hostname) {
  const mapped = await kvGetJson(env, `origin:${hostname}`);
  if (mapped && mapped.url) return String(mapped.url).replace(/\/+$/, "");
  return String(env.ORIGIN || "").replace(/\/+$/, "");
}

/** Probe origin /ash-ok — used for tunnelUp metadata (best-effort, short timeout). */
async function probeOriginUp(env, hostname) {
  const origin = await originBaseFor(env, hostname);
  const secret = env.EDGE_SECRET || "";
  if (!origin || !secret) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    try {
      const res = await fetch(`${origin}/ash-ok`, {
        method: "GET",
        headers: { Accept: "application/json", "X-Phlip-Edge": secret },
        signal: ctrl.signal,
        redirect: "manual",
      });
      return res.ok;
    } finally {
      clearTimeout(t);
    }
  } catch (_) {
    return false;
  }
}

/**
 * Turnstile siteverify when TURNSTILE_SECRET is bound.
 * Skipped entirely when secret is missing (local/dev / not configured).
 */
async function verifyTurnstileIfConfigured(env, token, ip, opts = {}) {
  const secret = String(env.TURNSTILE_SECRET || "").trim();
  if (!secret) return { ok: true, skipped: true };
  const tok = String(token || "").trim();
  // Native app path may omit token; browsers should send one when configured.
  if (!tok) {
    if (opts.requireToken) return { ok: false, error: "Complete the human check and try again." };
    return { ok: true, skipped: true };
  }
  try {
    const body = new URLSearchParams();
    body.set("secret", secret);
    body.set("response", tok);
    if (ip && ip !== "unknown") body.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (data && data.success) return { ok: true };
    return { ok: false, error: "Human check failed. Refresh and try again." };
  } catch (_) {
    // Fail open on verify outage — DrServer still rate-limits.
    return { ok: true, skipped: true };
  }
}

function wantsHtml(req) {
  const mode = (req.headers.get("sec-fetch-mode") || "").toLowerCase();
  const dest = (req.headers.get("sec-fetch-dest") || "").toLowerCase();
  if (mode === "navigate" || dest === "document") return true;
  const accept = (req.headers.get("accept") || "").toLowerCase();
  if (accept.includes("application/json")) return false;
  return accept.includes("text/html") || accept.includes("*/*") || !accept;
}

function isJsonClient(req, ct) {
  const accept = (req.headers.get("accept") || "").toLowerCase();
  if (accept.includes("application/json")) return true;
  return (ct || "").includes("application/json");
}

const JOIN_UI_CSS = `
body{font-family:system-ui,sans-serif;background:#1a1a18;color:#f2efe8;margin:0;
display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
form,.card{max-width:400px;width:100%;background:#242420;padding:28px 24px;border-radius:12px}
h1{font-size:1.25rem;margin:0 0 8px;font-weight:600}
h2{font-size:1rem;margin:16px 0 8px;font-weight:600}
p{color:#a8a49a;font-size:.9rem;line-height:1.4;margin:0 0 12px}
.hint{font-size:.85rem}
.err{color:#e07070}
input[type=text],input[type=password]{width:100%;box-sizing:border-box;padding:12px;border-radius:8px;
border:1px solid #3a3a34;background:#1a1a18;color:#f2efe8;font-size:1rem;margin:0 0 10px}
button{margin-top:12px;width:100%;padding:12px;border:0;border-radius:8px;background:#c4a35a;
color:#1a1a18;font-weight:600;font-size:1rem;cursor:pointer}
button:disabled{opacity:.6;cursor:default}
.store{margin-top:16px;font-size:.85rem}
.store a{color:#c4a35a}
.agree-head{margin:0 0 12px}
.agree-name{font-weight:600;font-size:1.05rem;color:#f2efe8}
.agree-age{font-size:.85rem;color:#a8a49a;margin-top:2px}
.agree-list{margin:0 0 12px;padding-left:1.15rem;color:#a8a49a;font-size:.85rem;line-height:1.45}
.agree-list li{margin:0 0 6px}
.agree-check{display:flex;gap:10px;align-items:flex-start;margin:0 0 14px;font-size:.9rem;color:#f2efe8}
.agree-check input{margin-top:3px;flex-shrink:0}
.field-label{display:block;font-size:.8rem;color:#a8a49a;margin:0 0 4px}
.phlip-open-in-app{position:fixed;top:0;left:0;right:0;z-index:10;display:flex;align-items:center;
flex-wrap:nowrap;gap:10px;padding:10px 14px;background:#e8b84a;color:#15171b;border-bottom:1px solid #c4922a;
font-size:14px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,.25)}
.phlip-open-in-app>span{white-space:nowrap}
.phlip-open-in-app-link{width:auto;margin:0;border:0;border-radius:8px;padding:8px 12px;background:#15171b;color:#fff;
font-weight:700;font-size:13px;cursor:pointer;text-decoration:none;display:inline-block}
.phlip-open-in-app-dismiss{width:auto;margin:0 0 0 auto;border:0;background:transparent;color:#15171b;font-size:22px;
line-height:1;cursor:pointer;padding:2px 8px;font-weight:700}
`;

/** Persist welcome and open the SPA at /. */
function joinWelcomeBootstrapHtml(welcome, req = null) {
  const welcomeLit = JSON.stringify(welcome == null ? {} : welcome).replace(/</g, "\\u003c");
  const body = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>Opening Phlip…</title>
<style>${JOIN_UI_CSS}</style></head><body>
<div class="card"><h1>You're in</h1><p>Opening Phlip…</p></div>
<script>
(function () {
  try {
    var welcome = ${welcomeLit};
    sessionStorage.setItem("ash_edge_welcome", JSON.stringify(welcome));
  } catch (e) {}
  location.replace("/");
})();
</script>
</body></html>`;
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "cache-control": "no-store",
      ...corsHeaders(req),
    },
  });
}

async function mintInviteCookie(env, hostname) {
  const token = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const exp = Date.now() + INVITE_TTL_MS;
  await kvPutJson(env, `edge:${hostname}:${token}`, { tier: "invite", exp }, 86400);
  const cookie =
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=86400`;
  return { token, cookie };
}

/** Waiting page: invite cookie already set; poll ash-join-wait until welcome. */
function joinWaitingHtml(requestId, setupNonce, slug, req = null, extraHeaders = {}) {
  const body = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>Waiting for host — Phlip</title>
<style>${JOIN_UI_CSS}</style></head><body>
<div class="card" id="card">
<h1>Waiting for the host</h1>
<p id="msg">Your request was sent. You’ll enter automatically once they approve.</p>
<p class="hint">Keep this page open.</p>
</div>
<script>
(function () {
  var requestId = ${JSON.stringify(String(requestId || ""))};
  var setupNonce = ${JSON.stringify(String(setupNonce || ""))};
  var deadline = Date.now() + 5 * 60 * 1000;
  var msg = document.getElementById("msg");
  function bootWelcome(welcome) {
    try { sessionStorage.setItem("ash_edge_welcome", JSON.stringify(welcome)); } catch (e) {}
    location.replace("/");
  }
  async function tick() {
    if (Date.now() > deadline) {
      if (msg) msg.textContent = "Timed out waiting for approval. Ask the host to Approve, then open this invite link again.";
      return;
    }
    try {
      var res = await fetch("/ash-join-wait?id=" + encodeURIComponent(requestId), {
        method: "GET",
        credentials: "include",
        headers: { "Accept": "application/json" },
        cache: "no-store",
      });
      var data = await res.json().catch(function () { return null; });
      if (!data) { setTimeout(tick, 1000); return; }
      if (data.type === "waiting") { setTimeout(tick, 900); return; }
      if (data.type === "denied") {
        if (msg) msg.textContent = "The host didn't let you in this time.";
        return;
      }
      if (data.type === "welcome") {
        if (setupNonce && !data.setupNonce) data.setupNonce = setupNonce;
        bootWelcome(data);
        return;
      }
      if (data.type === "error") {
        if (msg) msg.textContent = data.error || "Join request expired.";
        return;
      }
    } catch (e) {}
    setTimeout(tick, 1200);
  }
  tick();
})();
</script>
</body></html>`;
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "cache-control": "no-store",
      ...corsHeaders(req),
      ...extraHeaders,
    },
  });
}

function personalInviteHtml(slug, meta, err, req = null) {
  const serverLabel = String(meta?.hostDisplayName || "").trim() || "this server";
  const fallbackName = esc(serverLabel);
  const msg = err
    ? `<p class="err" id="err">${esc(err)}</p>`
    : `<p id="lead">Request to join <strong id="lead-name">${fallbackName}</strong>. Accept the rules, then the host will approve you.</p>`;
  const slugJs = JSON.stringify(String(slug || ""));
  const seedNameJs = JSON.stringify(serverLabel === "this server" ? "Phlip server" : serverLabel);
  let inviteHref = "";
  try {
    const parsed = new URL(req?.url || "");
    inviteHref = `${parsed.origin}/j/${encodeURIComponent(String(slug || ""))}`;
  } catch (_) {}
  const deepHref = `phlip://join?url=${encodeURIComponent(inviteHref)}&slug=${encodeURIComponent(String(slug || ""))}`;
  const intentHref =
    `intent://join?url=${encodeURIComponent(inviteHref)}&slug=${encodeURIComponent(String(slug || ""))}` +
    `#Intent;scheme=phlip;package=com.phlip;S.browser_fallback_url=${encodeURIComponent(inviteHref)};end`;
  const openHref = /Android/i.test(String(req?.headers?.get("user-agent") || "")) ? intentHref : deepHref;
  const body = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>Request to join — Phlip</title>
<style>${JOIN_UI_CSS}</style></head><body>
<div class="phlip-open-in-app" id="phlip-open-in-app" role="region" aria-label="Open this invite in the Phlip app">
  <span>Have Phlip installed?</span>
  <a class="phlip-open-in-app-link" id="open-in-phlip" href="${esc(openHref)}">Open in Phlip</a>
  <button type="button" class="phlip-open-in-app-dismiss" id="dismiss-open-in-phlip" aria-label="Dismiss">×</button>
</div>
<form id="join-form" method="POST" action="/j/${esc(slug)}/request">
<h1>Request to join</h1>
${msg}
<div id="agree-block" hidden>
  <div class="agree-head">
    <div class="agree-name" id="agree-name">${esc(serverLabel === "this server" ? "Phlip server" : serverLabel)}</div>
    <div class="agree-age" id="agree-age">Age rating: 18+</div>
  </div>
  <h2>Server rules</h2>
  <ul class="agree-list" id="agree-list"></ul>
  <label class="agree-check">
    <input type="checkbox" id="terms" required>
    <span id="terms-label">I meet the age requirement and agree to these server rules</span>
  </label>
</div>
<label class="field-label" for="name">Display name</label>
<input id="name" name="name" type="text" maxlength="24" autocomplete="nickname" required placeholder="Your display name"/>
<label class="field-label" for="pass">Password for this server</label>
<input id="pass" name="pass" type="password" autocomplete="new-password" required minlength="1" placeholder="Choose a password"/>
<button type="submit" id="btn" disabled>Request to join</button>
<p class="store">Have the app? Open this same link in Phlip, or stay on this page to request from the browser.</p>
</form>
<script>
(function () {
  var slug = ${slugJs};
  var form = document.getElementById("join-form");
  var btn = document.getElementById("btn");
  var nameEl = document.getElementById("name");
  var passEl = document.getElementById("pass");
  var termsEl = document.getElementById("terms");
  var agreeBlock = document.getElementById("agree-block");
  var inviteTok = "";
  var minAge = 18;
  var seedName = ${seedNameJs};

  document.getElementById("open-in-phlip").addEventListener("click", function () {
    var origin = String(location.origin || "");
    var inviteUrl = origin + "/j/" + encodeURIComponent(slug);
    var encodedInvite = encodeURIComponent(inviteUrl);
    var encodedSlug = encodeURIComponent(slug);
    var deep = "phlip://join?url=" + encodedInvite + "&slug=" + encodedSlug;
    if (/Android/i.test(String(navigator.userAgent || ""))) {
      location.href = "intent://join?url=" + encodedInvite + "&slug=" + encodedSlug
        + "#Intent;scheme=phlip;package=com.phlip;S.browser_fallback_url="
        + encodedInvite + ";end";
      return;
    }
    location.href = deep;
  });
  document.getElementById("dismiss-open-in-phlip").addEventListener("click", function () {
    var banner = document.getElementById("phlip-open-in-app");
    if (banner) banner.remove();
  });

  function clampAge(n) {
    n = Number(n);
    if (!isFinite(n) || n < 18) return 18;
    if (n > 99) return 99;
    return Math.floor(n);
  }
  function showErr(text) {
    var err = document.getElementById("err");
    if (!err) {
      err = document.createElement("p");
      err.className = "err";
      err.id = "err";
      form.insertBefore(err, agreeBlock || nameEl);
    }
    err.textContent = text || "Something went wrong.";
  }
  function syncSubmit() {
    var ok = !!(termsEl && termsEl.checked)
      && !!(nameEl.value || "").trim()
      && !!(passEl.value || "");
    btn.disabled = !ok;
  }
  function renderAgree(meta) {
    minAge = clampAge(meta && meta.minAge);
    var fromOk = String((meta && meta.name) || "").trim();
    var seeded = String(seedName || "").trim();
    var serverName = fromOk;
    if (!serverName || (serverName === "Phlip server" && seeded && seeded !== "Phlip server")) {
      serverName = seeded || "Phlip server";
    }
    document.getElementById("agree-name").textContent = serverName;
    document.getElementById("agree-age").textContent = "Age rating: " + minAge + "+";
    var leadName = document.getElementById("lead-name");
    if (leadName) leadName.textContent = serverName;
    document.getElementById("agree-list").innerHTML =
      "<li>You confirm you are <strong>at least " + minAge + " years old</strong> (this server’s age rating).</li>" +
      "<li>This group’s data lives on the <strong>host’s phone</strong> — not on a Phlip company server.</li>" +
      "<li>The host sees your <strong>display name</strong>, can <strong>Approve or Deny</strong> you, and can remove you later.</li>" +
      "<li>You create your own <strong>password for this server</strong>. Keep it private; the host never receives it in plain text.</li>" +
      "<li>This server’s <strong>icon</strong> will be saved on your device so you can recognise it in your list.</li>" +
      "<li>Only join people and servers you trust. If you leave or are removed, your access ends.</li>";
    document.getElementById("terms-label").textContent =
      "I am at least " + minAge + " years old and agree to these server rules";
    agreeBlock.hidden = false;
    syncSubmit();
  }
  function bootWelcome(welcome) {
    try { sessionStorage.setItem("ash_edge_welcome", JSON.stringify(welcome)); } catch (e) {}
    location.replace("/");
  }
  function stashPassword(pw) {
    try { sessionStorage.setItem("ash_edge_pending_pw", String(pw || "")); } catch (e) {}
  }
  function bytesToB64(bytes) {
    var arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var out = "";
    for (var i = 0; i < arr.length; i++) out += String.fromCharCode(arr[i]);
    return btoa(out);
  }
  function b64ToBytes(text) {
    var raw = atob(String(text || ""));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function browserDeviceId() {
    try {
      var id = localStorage.getItem("ash_device_id");
      if (!id) {
        var bytes = crypto.getRandomValues(new Uint8Array(16));
        id = Array.prototype.map.call(bytes, function (x) {
          return x.toString(16).padStart(2, "0");
        }).join("");
        localStorage.setItem("ash_device_id", id);
      }
      return id;
    } catch (e) {
      return "anon";
    }
  }
  async function sha256(bytes) {
    return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  }
  async function deriveLoginVerifier(password, saltB64) {
    if (!crypto || !crypto.subtle) throw new Error("Secure sign-in isn't available in this browser.");
    var enc = new TextEncoder();
    var base = await crypto.subtle.importKey(
      "raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    var bits = new Uint8Array(await crypto.subtle.deriveBits({
      name: "PBKDF2",
      salt: b64ToBytes(saltB64),
      iterations: 150000,
      hash: "SHA-256",
    }, base, 256));
    return bytesToB64(await sha256(bits));
  }
  async function browserFingerprint(name) {
    var enc = new TextEncoder();
    var source = browserDeviceId() + "|" + String(location.origin || "") + "|" +
      String(name || "").toLowerCase();
    var digest = await sha256(enc.encode(source));
    return Array.prototype.map.call(digest, function (x) {
      return x.toString(16).padStart(2, "0");
    }).join("");
  }
  async function tryExistingLogin(name, pass) {
    if (!crypto || !crypto.subtle) return false;
    var headers = { "Accept": "application/json" };
    if (inviteTok) headers["X-Phlip-Invite"] = inviteTok;
    var query = new URLSearchParams();
    query.set("name", name);
    query.set("inviteSlug", slug);
    var saltRes = await fetch("/ash-auth-salt?" + query.toString(), {
      method: "GET",
      credentials: "include",
      headers: headers,
      cache: "no-store",
    });
    var saltData = await saltRes.json().catch(function () { return null; });
    if (!saltRes.ok || !saltData || saltData.type !== "authSalt" || !saltData.salt) {
      if (saltRes.status === 429 || saltRes.status === 403) {
        throw new Error((saltData && saltData.error) || "Too many attempts. Wait a minute and try again.");
      }
      return false;
    }
    var verifier = await deriveLoginVerifier(pass, saltData.salt);
    var fingerprint = await browserFingerprint(name);
    var loginRes = await fetch("/ash-login", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...(inviteTok ? { "X-Phlip-Invite": inviteTok } : {}),
      },
      body: JSON.stringify({
        name: name,
        fingerprint: fingerprint,
        authVerifier: verifier,
        inviteSlug: slug,
      }),
      cache: "no-store",
    });
    var loginData = await loginRes.json().catch(function () { return null; });
    if (loginData && loginData.type === "welcome" && loginData.token) {
      bootWelcome(loginData);
      return true;
    }
    if (loginRes.status === 429) {
      throw new Error((loginData && loginData.error) || "Too many attempts. Wait a minute and try again.");
    }
    // Generic login failure is deliberately indistinguishable from a new or
    // incomplete account. Fall through to the personal request path.
    return false;
  }
  function showWaiting(requestId, setupNonce) {
    document.body.innerHTML = '<div class="card"><h1>Waiting for the host</h1><p id="msg">Your request was sent. You’ll enter automatically once they approve.</p><p class="hint">Keep this page open.</p></div>';
    var msg = document.getElementById("msg");
    var deadline = Date.now() + 5 * 60 * 1000;
    async function tick() {
      if (Date.now() > deadline) {
        if (msg) msg.textContent = "Timed out waiting for approval. Ask the host to Approve, then open this invite link again.";
        return;
      }
      try {
        var headers = { "Accept": "application/json" };
        if (inviteTok) headers["X-Phlip-Invite"] = inviteTok;
        var res = await fetch("/ash-join-wait?id=" + encodeURIComponent(requestId), {
          method: "GET",
          credentials: "include",
          headers: headers,
          cache: "no-store",
        });
        var data = await res.json().catch(function () { return null; });
        if (!data) { setTimeout(tick, 1000); return; }
        if (data.type === "waiting") { setTimeout(tick, 900); return; }
        if (data.type === "denied") {
          if (msg) msg.textContent = "The host didn't let you in this time.";
          return;
        }
        if (data.type === "welcome") {
          if (setupNonce && !data.setupNonce) data.setupNonce = setupNonce;
          if (inviteTok) data.inviteToken = inviteTok;
          bootWelcome(data);
          return;
        }
        if (data.type === "error") {
          if (msg) msg.textContent = data.error || "Join request expired.";
          return;
        }
      } catch (e) {}
      setTimeout(tick, 1200);
    }
    tick();
  }

  termsEl.addEventListener("change", syncSubmit);
  nameEl.addEventListener("input", syncSubmit);
  passEl.addEventListener("input", syncSubmit);

  (async function loadMeta() {
    try {
      var gateRes = await fetch("/edge/gate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ slug: slug, inviteSlug: slug }),
        cache: "no-store",
      });
      var gateData = await gateRes.json().catch(function () { return null; });
      if (gateData && gateData.token) inviteTok = String(gateData.token);
    } catch (e) {}
    try {
      var headers = { "Accept": "application/json" };
      if (inviteTok) headers["X-Phlip-Invite"] = inviteTok;
      var okRes = await fetch("/ash-ok", {
        method: "GET",
        credentials: "include",
        headers: headers,
        cache: "no-store",
      });
      var okData = await okRes.json().catch(function () { return null; });
      if (okData && typeof okData === "object") {
        renderAgree(okData);
        return;
      }
    } catch (e) {}
    renderAgree({ name: seedName, minAge: 18 });
  })();

  form.addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var name = (nameEl.value || "").trim().slice(0, 24);
    var pass = passEl.value || "";
    if (!termsEl.checked) { showErr("Accept the server rules to continue."); return; }
    if (!name) { showErr("Enter a display name."); return; }
    if (!pass) { showErr("Choose a password for this server."); return; }
    stashPassword(pass);
    btn.disabled = true;
    btn.textContent = "Checking account…";
    try {
      if (!inviteTok) {
        try {
          var gateRes2 = await fetch("/edge/gate", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({ slug: slug, inviteSlug: slug }),
            cache: "no-store",
          });
          var gateData2 = await gateRes2.json().catch(function () { return null; });
          if (gateData2 && gateData2.token) inviteTok = String(gateData2.token);
        } catch (e) {}
      }
      if (await tryExistingLogin(name, pass)) return;
      btn.textContent = "Sending…";
      var res = await fetch("/j/" + encodeURIComponent(slug) + "/request", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ name: name }),
        cache: "no-store",
      });
      var data = await res.json().catch(function () { return null; });
      if (!data) {
        showErr("Couldn't reach the host. Try again.");
        syncSubmit();
        btn.textContent = "Request to join";
        return;
      }
      if (data.inviteToken) inviteTok = String(data.inviteToken);
      if (data.type === "welcome") {
        if (inviteTok) data.inviteToken = inviteTok;
        bootWelcome(data);
        return;
      }
      if (data.type === "waiting" && data.requestId) {
        showWaiting(data.requestId, data.setupNonce || "");
        return;
      }
      if (data.type === "queued") {
        document.body.innerHTML = '<div class="card"><h1>Request saved</h1><p>' +
          (data.message || "Host isn't reachable. Your request was saved.") +
          "</p></div>";
        return;
      }
      showErr(data.error || "Couldn't send the request.");
      syncSubmit();
      btn.textContent = "Request to join";
    } catch (e) {
      showErr("Couldn't reach the host. Try again.");
      syncSubmit();
      btn.textContent = "Request to join";
    }
  });
})();
</script>
</body></html>`;
  return new Response(body, {
    status: err ? 400 : 200,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "cache-control": "no-store",
      ...corsHeaders(req),
    },
  });
}

async function issueInviteTierCookie(env, hostname, req, wantsJson) {
  const { token, cookie } = await mintInviteCookie(env, hostname);
  if (wantsJson) {
    return json({ type: "ok", tier: "invite", token, edgeVer: EDGE_VER }, 200, { "set-cookie": cookie }, req);
  }
  return new Response(null, {
    status: 303,
    headers: { location: "/", "set-cookie": cookie, ...corsHeaders(req) },
  });
}

async function handlePersonalInviteGet(req, env, hostname, slug) {
  const ip = clientIp(req);
  const limited = rateCheck(JOIN_META_RATE, `meta:${ip}`, 30, 60_000);
  if (!limited.ok) {
    return json(
      { ok: false, slug, message: "Too many requests. Try again shortly.", edgeVer: EDGE_VER },
      429,
      { "retry-after": String(Math.ceil((limited.retryAfterMs || 1000) / 1000)) },
      req,
    );
  }
  const rec = await resolveSlugRecord(env, slug, hostname);
  if (!rec) {
    const payload = {
      ok: false,
      slug,
      tunnelUp: false,
      message: "That invite link isn't recognised.",
      edgeVer: EDGE_VER,
    };
    if (wantsHtml(req)) return inviteLinkExpiredHtml(req);
    return json(payload, 404, {}, req);
  }
  const host = String(rec.hostname || hostname).toLowerCase();
  const tunnelUp = await probeOriginUp(env, host);
  const hostDisplayName = String(rec.hostDisplayName || "").trim().slice(0, 40);
  const publicHost = String(rec.publicHost || host || "").toLowerCase();
  const message = tunnelUp
    ? "Host is reachable on the internet."
    : "Host isn't reachable on the internet. Connect to the same Wi‑Fi as the host, or ask them to start a Direct session.";
  const payload = {
    ok: true,
    slug,
    hostDisplayName: hostDisplayName || undefined,
    tunnelUp,
    publicHost: publicHost || undefined,
    publicUrl: publicHost ? `https://${publicHost}` : undefined,
    message,
    edgeVer: EDGE_VER,
  };
  // Never expose roster / member list.
  if (wantsHtml(req)) return personalInviteHtml(slug, payload, null, req);
  return json(payload, 200, {}, req);
}

async function queueJoinRequest(env, hostname, entry) {
  const host = String(hostname || "").toLowerCase();
  const id = entry.id || crypto.randomUUID();
  const key = `joinreq:${host}:${id}`;
  const record = { ...entry, id, hostname: host, queuedAt: Date.now() };
  JOINREQ_MEM.set(key, record);
  try {
    await kvPutJson(env, key, record, 86400 * 14);
  } catch (e) {
    if (!isKvWriteLimitError(e)) throw e;
    await cachePutJson(key, record, 86400 * 14);
  }
  const idxKey = `joinreqs:${host}`;
  let idx =
    (await kvGetJson(env, idxKey)) ||
    (await cacheGetJson(idxKey)) ||
    JOINREQ_MEM.get(idxKey) ||
    { ids: [] };
  idx.ids = Array.isArray(idx.ids) ? idx.ids : [];
  if (!idx.ids.includes(id)) idx.ids.push(id);
  if (idx.ids.length > 200) idx.ids = idx.ids.slice(-150);
  JOINREQ_MEM.set(idxKey, idx);
  try {
    await kvPutJson(env, idxKey, idx, 86400 * 14);
  } catch (e) {
    if (isKvWriteLimitError(e)) await cachePutJson(idxKey, idx, 86400 * 14);
    else throw e;
  }
  return record;
}

async function pullJoinRequests(env, hostname) {
  const host = String(hostname || "").toLowerCase();
  const idxKey = `joinreqs:${host}`;
  const idx =
    (await kvGetJson(env, idxKey)) ||
    (await cacheGetJson(idxKey)) ||
    JOINREQ_MEM.get(idxKey) ||
    { ids: [] };
  const ids = Array.isArray(idx.ids) ? idx.ids : [];
  const requests = [];
  for (const id of ids) {
    const key = `joinreq:${host}:${id}`;
    const rec =
      (await kvGetJson(env, key)) ||
      (await cacheGetJson(key)) ||
      JOINREQ_MEM.get(key);
    if (rec) requests.push(rec);
    try {
      await env.KV.delete(key);
    } catch (_) {}
    JOINREQ_MEM.delete(key);
    try {
      await caches.default.delete(cacheKeyUrl(key));
    } catch (_) {}
  }
  JOINREQ_MEM.delete(idxKey);
  try {
    await env.KV.delete(idxKey);
  } catch (_) {}
  try {
    await caches.default.delete(cacheKeyUrl(idxKey));
  } catch (_) {}
  return requests;
}

/** Best-effort wipe of all KV / cache / memory state for a public hostname. */
async function clearHostnameState(env, hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host) return 0;
  let n = 0;
  const del = async (key) => {
    if (!key) return;
    try {
      await env.KV.delete(key);
      n++;
    } catch (_) {}
    try {
      await caches.default.delete(cacheKeyUrl(key));
    } catch (_) {}
    JOINREQ_MEM.delete(key);
    INBOX_MEM.delete(key);
  };

  // Personal slug records pointed at this host.
  const slugPack =
    (await kvGetJson(env, `slugs:${host}`)) || (await cacheGetJson(`slugs:${host}`));
  if (slugPack && Array.isArray(slugPack.slugs)) {
    for (const s of slugPack.slugs) {
      await del(`slug:${normPersonalSlug(s)}`);
    }
  }

  // Live Broadcast shares indexed for this host.
  const shareIdx =
    (await kvGetJson(env, `shares:${host}`)) ||
    (await cacheGetJson(`shares:${host}`)) ||
    { ids: [...((SHARES_BY_HOST.get(host) || new Set()))] };
  const shareIds = Array.isArray(shareIdx.ids) ? shareIdx.ids : [];
  for (const id of shareIds) {
    await del(`share:${id}`);
    try {
      await caches.default.delete(cacheKeyUrl(`shareClosed:${id}`));
    } catch (_) {}
    SHARE_MEM.delete(id);
  }
  SHARES_BY_HOST.delete(host);

  // Offline join-request queue.
  await pullJoinRequests(env, host);

  // Prefix sweeps (member sessions, invite-tier cookies, stray joinreq keys).
  for (const prefix of [`member:${host}:`, `edge:${host}:`, `joinreq:${host}:`]) {
    try {
      let cursor;
      do {
        const listed = await env.KV.list({ prefix, limit: 100, cursor });
        for (const k of listed.keys || []) {
          await del(k.name);
        }
        cursor = listed.list_complete ? null : listed.cursor;
      } while (cursor);
    } catch (_) {}
  }

  for (const key of [
    `origin:${host}`,
    `invite:${host}`,
    `slugs:${host}`,
    `relay:${host}`,
    `relayEnabled:${host}`,
    `workersPlan:${host}`,
    `joinreqs:${host}`,
    `shares:${host}`,
  ]) {
    await del(key);
  }
  PLAN_MEM.delete(host);
  return n;
}

async function forwardJoinToOrigin(env, hostname, payload) {
  const origin = await originBaseFor(env, hostname);
  const secret = env.EDGE_SECRET || "";
  if (!origin || !secret) return { ok: false, unreachable: true };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(`${origin}/ash-join`, {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=UTF-8",
          accept: "application/json",
          "X-Phlip-Edge": secret,
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
        redirect: "manual",
      });
      const text = await res.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch (_) {
        body = null;
      }
      return { ok: res.ok, status: res.status, body, unreachable: false };
    } finally {
      clearTimeout(t);
    }
  } catch (_) {
    return { ok: false, unreachable: true };
  }
}

async function handlePersonalInviteRequest(req, env, hostname, slug) {
  const ip = clientIp(req);
  const ipLim = rateCheck(JOIN_REQ_IP_RATE, `jip:${ip}`, 8, 60_000);
  if (!ipLim.ok) {
    return json(
      { type: "error", error: "Too many join requests from this network.", edgeVer: EDGE_VER },
      429,
      {},
      req,
    );
  }
  const slugLim = rateCheck(JOIN_REQ_SLUG_RATE, `jslug:${slug}`, 20, 60_000);
  if (!slugLim.ok) {
    return json(
      { type: "error", error: "Too many requests for this invite link. Try again shortly.", edgeVer: EDGE_VER },
      429,
      {},
      req,
    );
  }
  const rec = await resolveSlugRecord(env, slug, hostname);
  if (!rec) {
    return json({ type: "error", error: "That invite link isn't recognised.", edgeVer: EDGE_VER }, 404, {}, req);
  }
  const host = String(rec.hostname || hostname).toLowerCase();
  let name = "";
  let fingerprint = "";
  let turnstileToken = "";
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    name = String(body.name || "").trim();
    fingerprint = String(body.fingerprint || "").trim().toLowerCase();
    turnstileToken = String(body.turnstileToken || body["cf-turnstile-response"] || "").trim();
  } else {
    const form = await req.formData().catch(() => null);
    name = form ? String(form.get("name") || "").trim() : "";
    fingerprint = form ? String(form.get("fingerprint") || "").trim().toLowerCase() : "";
    turnstileToken = form
      ? String(form.get("turnstileToken") || form.get("cf-turnstile-response") || "").trim()
      : "";
  }
  name = name.slice(0, 24);
  if (!name) {
    if (wantsHtml(req) || !ct.includes("application/json")) {
      return personalInviteHtml(slug, { hostDisplayName: rec.hostDisplayName, tunnelUp: false }, "Enter a display name.", req);
    }
    return json({ type: "error", error: "Pick a name so friends know who you are." }, 400, {}, req);
  }
  const isBrowser = !!(req.headers.get("Origin") || wantsHtml(req) || ct.includes("application/x-www-form-urlencoded"));
  const turnstile = await verifyTurnstileIfConfigured(env, turnstileToken, ip, {
    requireToken: isBrowser && !!String(env.TURNSTILE_SECRET || "").trim(),
  });
  if (!turnstile.ok) {
    return json({ type: "error", error: turnstile.error || "Human check failed." }, 403, {}, req);
  }
  if (fingerprint.length < 16) {
    fingerprint = `edge${[...crypto.getRandomValues(new Uint8Array(12))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")}`;
  }
  const joinPayload = {
    name,
    fingerprint,
    inviteSlug: slug,
    invite: "",
    authVerifier: "",
  };
  const forwarded = await forwardJoinToOrigin(env, host, joinPayload);
  const preferJson = isJsonClient(req, ct);

  if (forwarded.unreachable) {
    const queued = await queueJoinRequest(env, host, {
      ...joinPayload,
      id: crypto.randomUUID(),
      kind: "joinreq",
      sourceIp: ip,
    });
    const queuedBody = {
      type: "queued",
      requestId: queued.id,
      message:
        "Host isn't reachable on the internet. Your request was saved — connect to the same Wi‑Fi as the host, or ask them to start a Direct session.",
      edgeVer: EDGE_VER,
    };
    if (!preferJson) {
      return new Response(
        `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Request saved — Phlip</title>
<style>${JOIN_UI_CSS}</style></head>
<body><div class="card"><h1>Request saved</h1><p>${esc(queuedBody.message)}</p></div></body></html>`,
        { status: 202, headers: { "content-type": "text/html; charset=UTF-8", "cache-control": "no-store", ...corsHeaders(req) } },
      );
    }
    return json(queuedBody, 202, {}, req);
  }

  if (forwarded.body) {
    const body = { ...forwarded.body, edgeVer: EDGE_VER };
    const type = String(body.type || "");
    if (forwarded.ok && type === "welcome" && body.token) {
      await bindVerifiedMember(env, host, body.token, body.user?.id || "");
    }

    // Classic form POST (no fetch): return HTML handoff pages, never raw JSON.
    if (!preferJson) {
      if (type === "welcome") {
        const minted = await mintInviteCookie(env, host);
        const res = joinWelcomeBootstrapHtml(body, req);
        const headers = new Headers(res.headers);
        headers.append("set-cookie", minted.cookie);
        return new Response(res.body, { status: res.status, headers });
      }
      if (type === "waiting" && body.requestId) {
        const minted = await mintInviteCookie(env, host);
        return joinWaitingHtml(body.requestId, body.setupNonce || "", slug, req, {
          "set-cookie": minted.cookie,
        });
      }
      if (type === "error" || type === "denied") {
        return personalInviteHtml(
          slug,
          { hostDisplayName: rec.hostDisplayName, tunnelUp: true },
          body.error || "Couldn't join.",
          req,
        );
      }
    }

    // JSON clients (app + fetch form): include invite cookie so wait polls work.
    const extra = {};
    if (type === "waiting" || type === "welcome") {
      try {
        const minted = await mintInviteCookie(env, host);
        extra["set-cookie"] = minted.cookie;
        body.inviteToken = minted.token;
      } catch (_) {}
    }
    return json(body, forwarded.status || 200, extra, req);
  }

  if (!preferJson) {
    return personalInviteHtml(
      slug,
      { hostDisplayName: rec.hostDisplayName, tunnelUp: true },
      "Host couldn't accept the join request.",
      req,
    );
  }
  return json(
    { type: "error", error: "Host couldn't accept the join request.", edgeVer: EDGE_VER },
    forwarded.status || 502,
    {},
    req,
  );
}

async function proxyOrigin(req, env, url, hostname) {
  let origin = "";
  const mapped = await kvGetJson(env, `origin:${hostname}`);
  if (mapped && mapped.url) origin = String(mapped.url).replace(/\/+$/, "");
  if (!origin) origin = (env.ORIGIN || "").replace(/\/+$/, "");
  const secret = env.EDGE_SECRET || "";
  if (!origin || !secret) {
    return new Response("Edge not configured", { status: 502 });
  }
  if (!isSafeProxyPath(url.pathname)) {
    return json({ type: "error", error: "Bad path" }, 400, {}, req);
  }
  // Assign onto a fixed origin URL — never pass attacker path as URL() first arg
  // (protocol-relative //host would otherwise steal EDGE_SECRET via SSRF).
  let target;
  try {
    target = new URL(origin);
    if (!/^https?:$/i.test(target.protocol)) {
      return new Response("Bad origin", { status: 502 });
    }
    target.pathname = url.pathname;
    target.search = url.search;
  } catch (_) {
    return new Response("Bad origin", { status: 502 });
  }
  if (target.origin !== new URL(origin).origin) {
    return json({ type: "error", error: "Bad path" }, 400, {}, req);
  }
  const headers = new Headers(req.headers);
  headers.set("X-Phlip-Edge", secret);
  headers.delete("host");
  const init = { method: req.method, headers, redirect: "manual" };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.body;
  }
  return fetch(target.toString(), init);
}

async function bindVerifiedMember(env, hostname, token, userId = "") {
  const bearer = String(token || "");
  if (!bearer) return false;
  const hash = await sha256Hex(bearer);
  const key = `member:${String(hostname || "").toLowerCase()}:${hash}`;
  const exp = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const record = { userId: String(userId || ""), exp };
  try {
    await kvPutJson(env, key, record, 86400 * 31);
  } catch (_) {
    // Colo-local fallback removes the response→host-sync race even if KV is capped.
    await cachePutJson(key, record, 86400 * 31);
  }
  return true;
}

/**
 * Admission is trusted only when the edge-authenticated origin returns a real
 * welcome. Bind that bearer immediately so the next poll/RPC crosses member tier.
 */
async function proxyOriginAdmission(req, env, url, hostname) {
  const response = await proxyOrigin(req, env, url, hostname);
  if (!response.ok) return response;
  let body = null;
  try {
    body = await response.clone().json();
  } catch (_) {}
  if (body?.type === "welcome" && body.token) {
    await bindVerifiedMember(env, hostname, body.token, body.user?.id || "");
  }
  return response;
}

/** Anonymous health probe: never forward origin metadata or future fields. */
async function proxyAnonymousOk(req, env, url, hostname) {
  const response = await proxyOrigin(req, env, url, hostname);
  if (!response.ok) {
    return json(
      { ok: false, error: "Server unavailable." },
      response.status,
      {},
      req,
    );
  }
  if (req.method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
  let body = null;
  try {
    body = await response.json();
  } catch (_) {}
  if (!body || body.ok !== true) {
    return json({ ok: false, error: "Server unavailable." }, 502, {}, req);
  }
  // Exact projection: no server name, age, icon, joinTag, roster, or settings.
  return json({ ok: true }, 200, {}, req);
}

async function handleGatePost(req, env, hostname) {
  let slug = "";
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    slug = normPersonalSlug(body.slug || body.inviteSlug || body.code || body.invite || "");
  } else {
    const form = await req.formData().catch(() => null);
    slug = form
      ? normPersonalSlug(
          form.get("slug") || form.get("inviteSlug") || form.get("code") || "",
        )
      : "";
  }
  const wantsJson =
    ct.includes("application/json") || (req.headers.get("accept") || "").includes("application/json");

  // Personal invite slug only — rotating join codes are retired.
  if (slug.length >= 8) {
    if (await slugAllowedForHost(env, hostname, slug)) {
      return issueInviteTierCookie(env, hostname, req, wantsJson);
    }
    return wantsJson
      ? json(
          {
            type: "error",
            error: "That invite link isn't recognised for this host.",
            needInviteLink: true,
            edgeVer: EDGE_VER,
          },
          401,
          {},
          req,
        )
      : gateHtml(hostname, "That invite link isn't recognised for this host.", req);
  }

  return wantsJson
    ? json(
        {
          type: "error",
          error: "Open a personal invite link from someone on this server.",
          needInviteLink: true,
          edgeVer: EDGE_VER,
        },
        401,
        {},
        req,
      )
    : gateHtml(hostname, "Open a personal invite link from someone on this server.", req);
}

async function handleHostSync(req, env, hostname) {
  if (!requireHostSync(req, env)) {
    return json({ type: "error", error: "Forbidden" }, 403);
  }
  await maybeSyncPlanFromRequest(req, env, hostname);
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/edge/host/plan" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const host = String(body.hostname || hostname).toLowerCase();
    const plan = String(body.plan || "").toLowerCase() === "paid" ? "paid" : "free";
    await setWorkersPlan(env, host, plan);
    if (typeof body.relayEnabled === "boolean") {
      try {
        await kvPutJson(env, `relayEnabled:${host}`, { enabled: body.relayEnabled }, 86400 * 30);
      } catch (e) {
        if (!isKvWriteLimitError(e)) throw e;
      }
    }
    return json({
      type: "ok",
      plan,
      kv: await kvMeterSnapshot(plan),
      edgeVer: EDGE_VER,
    });
  }

  // Opt-in read-only relay cache (encrypted snapshot). Worker never decrypts.
  if (path === "/edge/host/relay" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const host = String(body.hostname || hostname).toLowerCase();
    if (!host) return json({ type: "error", error: "hostname required" }, 400);
    const enabled = body.enabled !== false;
    const plan = await workersPlanFor(env, host);
    try {
      await kvPutJson(env, `relayEnabled:${host}`, { enabled }, 86400 * 30);
    } catch (e) {
      if (isKvWriteLimitError(e)) {
        return json(
          {
            type: "error",
            error: "Cloudflare KV write limit — relay cache can't update. Wait until 00:00 UTC or upgrade Workers.",
            kv: await kvMeterSnapshot(plan),
            edgeVer: EDGE_VER,
          },
          503,
        );
      }
      throw e;
    }
    if (!enabled) {
      try {
        await env.KV.delete(`relay:${host}`);
      } catch (_) {}
      return json({
        type: "ok",
        enabled: false,
        kv: await kvMeterSnapshot(plan),
        edgeVer: EDGE_VER,
      });
    }
    const sealed = body.sealed;
    if (typeof sealed !== "string" || !sealed.startsWith("e2e:")) {
      return json({ type: "error", error: "sealed e2e blob required" }, 400);
    }
    const seq = Math.max(0, Number(body.seq) || 0);
    const pack = {
      seq,
      sealed,
      updatedAt: Date.now(),
      enabled: true,
    };
    try {
      await kvPutJson(env, `relay:${host}`, pack, 86400 * 14);
    } catch (e) {
      if (isKvWriteLimitError(e)) {
        return json(
          {
            type: "error",
            error: "Cloudflare KV write limit — relay cache can't update. Wait until 00:00 UTC or upgrade Workers.",
            kv: await kvMeterSnapshot(plan),
            edgeVer: EDGE_VER,
          },
          503,
        );
      }
      throw e;
    }
    return json({
      type: "ok",
      enabled: true,
      seq,
      kv: await kvMeterSnapshot(plan),
      edgeVer: EDGE_VER,
    });
  }

  if (path === "/edge/host/invite" && req.method === "POST") {
    // Rotating join-code hash publish is retired. Delete any leftover invite key.
    const body = await req.json().catch(() => ({}));
    const host = String(body.hostname || hostname).toLowerCase();
    if (host) {
      try {
        await env.KV.delete(`invite:${host}`);
      } catch (_) {}
    }
    return json({ type: "ok", retired: true, edgeVer: EDGE_VER });
  }

  // Tear down all edge KV for a public hostname (server delete / Disconnect).
  if (path === "/edge/host/clear" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const host = String(body.hostname || hostname).toLowerCase();
    if (!host) return json({ type: "error", error: "hostname required" }, 400);
    const cleared = await clearHostnameState(env, host);
    return json({ type: "ok", cleared, edgeVer: EDGE_VER });
  }

  // Active personal invite slugs for request-to-join.
  if (path === "/edge/host/slugs" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const host = String(body.hostname || hostname).toLowerCase();
    const rawSlugs = Array.isArray(body.slugs) ? body.slugs : [];
    const slugs = [
      ...new Set(
        rawSlugs
          .map((s) => normPersonalSlug(s))
          .filter((s) => s.length >= 8),
      ),
    ].slice(0, 500);
    const hostDisplayName = String(body.hostDisplayName || body.serverName || "")
      .trim()
      .slice(0, 40);
    const prevPack = await loadHostSlugs(env, host);
    const prevList = Array.isArray(prevPack?.slugs)
      ? prevPack.slugs.map((s) => normPersonalSlug(s)).filter((s) => s.length >= 8)
      : [];
    const nextSet = new Set(slugs);
    for (const old of prevList) {
      if (!nextSet.has(old)) await deleteSlugKey(env, old);
    }
    const pack = {
      slugs,
      hostDisplayName,
      publicHost: host,
      updatedAt: Date.now(),
    };
    try {
      await kvPutJson(env, `slugs:${host}`, pack, 86400 * 30);
    } catch (e) {
      if (isKvWriteLimitError(e)) await cachePutJson(`slugs:${host}`, pack, 86400 * 30);
      else throw e;
    }
    for (const s of slugs) {
      const rec = { hostname: host, hostDisplayName, publicHost: host, updatedAt: Date.now() };
      try {
        await kvPutJson(env, `slug:${s}`, rec, 86400 * 30);
      } catch (e) {
        if (isKvWriteLimitError(e)) await cachePutJson(`slug:${s}`, rec, 86400 * 30);
        else throw e;
      }
    }
    return json({ type: "ok", count: slugs.length, edgeVer: EDGE_VER });
  }

  if (path === "/edge/host/origin" && req.method === "POST") {
    const body = await req.json();
    const host = String(body.hostname || hostname).toLowerCase();
    const originUrl = String(body.originUrl || "").replace(/\/+$/, "");
    if (!originUrl) return json({ type: "error", error: "originUrl required" }, 400);
    await kvPutJson(env, `origin:${host}`, { url: originUrl }, 86400 * 30);
    return json({ type: "ok" });
  }

  if (path === "/edge/host/member" && req.method === "POST") {
    const body = await req.json();
    const host = String(body.hostname || hostname).toLowerCase();
    const tokenHash = String(body.tokenHash || "");
    if (!tokenHash) return json({ type: "error", error: "tokenHash required" }, 400);
    const exp = body.exp || Date.now() + 30 * 24 * 60 * 60 * 1000;
    await kvPutJson(
      env,
      `member:${host}:${tokenHash}`,
      { userId: body.userId || "", exp },
      86400 * 31,
    );
    if (body.oldTokenHash) {
      await env.KV.delete(`member:${host}:${body.oldTokenHash}`);
    }
    return json({ type: "ok" });
  }

  if (path === "/edge/host/pull" && req.method === "GET") {
    const host = String(url.searchParams.get("hostname") || hostname).toLowerCase();
    const since = Number(url.searchParams.get("since") || "0");
    const plan = await workersPlanFor(env, host);
    const inbox = await readInbox(env, host);
    const events = (inbox.events || []).filter((e) => (e.ts || 0) > since);
    return json({
      type: "pull",
      events,
      serverTime: Date.now(),
      kv: await kvMeterSnapshot(plan),
      edgeVer: EDGE_VER,
    });
  }

  // Offline join requests queued while tunnel was down (clear-on-pull).
  if (path === "/edge/host/join-requests" && req.method === "GET") {
    const host = String(url.searchParams.get("hostname") || hostname).toLowerCase();
    const requests = await pullJoinRequests(env, host);
    return json({
      type: "joinRequests",
      requests,
      serverTime: Date.now(),
      edgeVer: EDGE_VER,
    });
  }

  return json({ type: "error", error: "Unknown host sync path" }, 404);
}

/** Member read of opt-in encrypted relay snapshot (no origin / no decrypt). */
async function handleRelayGet(req, env, hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host) return json({ type: "error", error: "hostname required" }, 400, {}, req);
  const { tier } = await tierFor(req, env, host);
  if (tier !== "member") {
    return json(
      { type: "error", error: "Member session required", needGate: true, edgeVer: EDGE_VER },
      401,
      {},
      req,
    );
  }
  let enabled = true;
  try {
    const flag = await kvGetJson(env, `relayEnabled:${host}`);
    if (flag && flag.enabled === false) enabled = false;
  } catch (_) {}
  if (!enabled) {
    return json({ type: "error", error: "Relay cache off", edgeVer: EDGE_VER }, 404, {}, req);
  }
  const pack =
    (await kvGetJson(env, `relay:${host}`)) ||
    (await cacheGetJson(`relay:${host}`));
  if (!pack || !pack.sealed) {
    return json({ type: "error", error: "No relay snapshot", edgeVer: EDGE_VER }, 404, {}, req);
  }
  if (pack.enabled === false) {
    return json({ type: "error", error: "Relay cache off", edgeVer: EDGE_VER }, 404, {}, req);
  }
  return json(
    {
      type: "relay",
      seq: Number(pack.seq) || 0,
      sealed: pack.sealed,
      updatedAt: Number(pack.updatedAt) || 0,
      edgeVer: EDGE_VER,
    },
    200,
    {},
    req,
  );
}

async function pushInbox(env, hostname, event, opts = {}) {
  const host = String(hostname || "").toLowerCase();
  const key = `inbox:${host}`;
  let inbox =
    (await kvGetJson(env, key)) ||
    (await cacheGetJson(key)) ||
    INBOX_MEM.get(key) ||
    { events: [] };
  inbox.events = Array.isArray(inbox.events) ? inbox.events : [];
  inbox.events.push({ ...event, ts: Date.now(), id: crypto.randomUUID() });
  if (inbox.events.length > 500) inbox.events = inbox.events.slice(-400);
  INBOX_MEM.set(key, inbox);
  try {
    await kvPutJson(env, key, inbox, 86400 * 7);
  } catch (e) {
    if (!isKvWriteLimitError(e)) throw e;
    if (opts.requireKv) throw e;
    await cachePutJson(key, inbox, 86400 * 7);
  }
}

async function readInbox(env, hostname) {
  const host = String(hostname || "").toLowerCase();
  const key = `inbox:${host}`;
  return (
    (await kvGetJson(env, key)) ||
    (await cacheGetJson(key)) ||
    INBOX_MEM.get(key) ||
    { events: [] }
  );
}

/** Keep edge guest RSVPs/reactions when the host re-pushes a share snapshot. */
function mergeShareGuestState(prev, next) {
  if (!prev || !next) return next;
  const prevEv = prev.event && typeof prev.event === "object" ? prev.event : {};
  const nextEv = next.event && typeof next.event === "object" ? next.event : {};
  next.event = {
    ...prevEv,
    ...nextEv,
    guests: { ...(prevEv.guests || {}), ...(nextEv.guests || {}) },
    reactions: { ...(prevEv.reactions || {}), ...(nextEv.reactions || {}) },
  };
  return next;
}

async function sharePayloadFromRecord(share, guest, opts = {}) {
  const displayIn = (share && typeof share.display === "object" && !Array.isArray(share.display))
    ? share.display : {};
  const eventIn = (share && typeof share.event === "object" && !Array.isArray(share.event))
    ? share.event : {};
  const display = { ...displayIn };
  const ev = { ...eventIn };
  // Top-level event* fields are the reliable label channel (same idea as eventCreatorName).
  const take = (top, ...rest) => {
    for (const raw of [top, ...rest]) {
      if (raw == null || typeof raw === "object") continue;
      const s = String(raw).trim();
      if (s && !s.startsWith("e2e:")) return s;
    }
    return "";
  };
  const eventTitle = take(share.eventTitle, display.title, ev.title);
  const eventWhere = take(share.eventWhere, display.where, ev.where);
  const eventDetails = take(share.eventDetails, display.details, ev.details);
  const eventSticker = take(share.eventSticker, display.sticker, ev.sticker);
  if (eventTitle) { display.title = eventTitle; ev.title = eventTitle; }
  if (eventWhere) { display.where = eventWhere; ev.where = eventWhere; }
  if (eventDetails) { display.details = eventDetails; ev.details = eventDetails; }
  if (eventSticker) { display.sticker = eventSticker; ev.sticker = eventSticker; }
  // Never fall back person fields to share.hostName (that's the server label).
  const creator = share.eventCreatorName || display.creator || "someone";
  const hostDevice = share.serverHostName || display.hostDevice || "an Android device";
  // Keep join payload lean — huge data-URL icons can break JSON responses.
  let serverPic = share.serverPic || null;
  if (typeof serverPic === "string" && serverPic.length > 120_000) serverPic = null;
  const base = {
    type: "share",
    kind: share.kind || "event",
    id: share.id,
    mode: share.mode || "join",
    hostName: share.hostName || "Phlip host",
    serverName: share.serverName || share.hostName || "Phlip host",
    serverHostName: hostDevice,
    eventCreatorName: creator,
    eventTitle: eventTitle || "",
    eventWhere: eventWhere || "",
    eventDetails: eventDetails || "",
    eventSticker: eventSticker || "",
    serverPic,
    enc: (share.enc && typeof share.enc === "object" && !Array.isArray(share.enc)) ? share.enc : {},
    display,
    event: ev,
    ended: !!share.closed,
  };
  if (opts.workersPlan === "paid" || opts.workersPlan === "free") {
    base.workersPlan = opts.workersPlan;
  }
  if (guest) {
    const tok = String(guest.token || "");
    base.self = {
      name: guest.name || "Guest",
      pid: guest.pitchId || ("g" + tok.slice(0, 11)),
    };
  }
  return base;
}

/** Post-pass preview — Worker-held display labels + creator; no guest token. */
function shareInvitePreview(share) {
  const displayIn = share.display || {};
  const encIn = share.enc || {};
  const ev = share.event || {};
  const pick = (key, top) => {
    const t = String(top || "").trim();
    if (t && !t.startsWith("e2e:")) return t;
    const a = String(displayIn[key] || "").trim();
    if (a && !a.startsWith("e2e:")) return a;
    const b = String(ev[key] || "").trim();
    if (b && !b.startsWith("e2e:")) return b;
    const c = String(encIn[key] || "").trim();
    if (c && !c.startsWith("e2e:")) return c;
    return "";
  };
  const display = {};
  const title = pick("title", share.eventTitle);
  const where = pick("where", share.eventWhere);
  const sticker = pick("sticker", share.eventSticker);
  const creator = pick("creator") || share.eventCreatorName || "";
  const hostDevice = pick("hostDevice") || share.serverHostName || "";
  if (title) display.title = title;
  if (where) display.where = where;
  if (sticker) display.sticker = sticker;
  if (creator) display.creator = creator;
  if (hostDevice) display.hostDevice = hostDevice;
  const enc = {};
  // Legacy ciphertext only if still no plaintext title.
  if (!display.title && encIn.title) enc.title = encIn.title;
  return {
    type: "invite",
    hostName: creator || "someone",
    serverName: share.serverName || share.hostName || "Phlip host",
    serverHostName: hostDevice || "an Android device",
    eventCreatorName: creator || "someone",
    eventTitle: title || "",
    eventWhere: where || "",
    eventSticker: sticker || "",
    minAge: share.minAge || 18,
    serverPic: share.serverPic || null,
    display,
    enc,
  };
}

/** Active Broadcast only — used so `?s=` cannot probe/proxy the phone cold. */
async function liveShareRecord(env, shareId) {
  const sid = String(shareId || "").trim();
  if (!sid) return null;
  if (await isShareClosed(env, sid)) return null;
  const share = await shareRecordGet(env, sid);
  if (!share || share.closed) return null;
  // Broadcast stays live until the host Stops.
  return share;
}

async function handleShareJoin(req, env, hostname) {
  let step = "start";
  try {
    const body = await req.json().catch(() => ({}));
    const sid = String(body.s || "");
    const ip = clientIp(req);
    step = "rate";
    const rate = shareJoinRateCheck(ip);
    if (!rate.ok) {
      return json(
        { type: "error", error: "Too many attempts. Wait a minute and try again.", edgeVer: EDGE_VER },
        429,
        {},
        req,
      );
    }
    step = "share";
    const share = await liveShareRecord(env, sid);
    if (!share) {
      const stopped = await isShareClosed(env, sid);
      return json(
        {
          type: "ended",
          reason: stopped ? "stopped" : "unavailable",
          edgeVer: EDGE_VER,
        },
        200,
        {},
        req,
      );
    }
    // Passcode is checked only here at the edge — never forwarded to the phone.
    const needPass = !!share.requirePass || !!share.passHash;
    if (needPass) {
      const pass = String(body.pass || "").trim();
      if (!pass) {
        return json({ type: "needPass", minAge: share.minAge || 18, edgeVer: EDGE_VER }, 200, {}, req);
      }
      step = "pass";
      const ph = await sha256Hex(pass);
      if (!share.passHash || !timingSafeEqual(ph, String(share.passHash))) {
        shareJoinRateFail(rate);
        return json({ type: "error", error: "Wrong passcode.", edgeVer: EDGE_VER }, 200, {}, req);
      }
    }
    const name = String(body.name || "").trim().slice(0, 24);
    // Pass OK but gate incomplete → invite preview (title + creator), no session yet.
    if (!body.ageOk || !name) {
      step = "invite";
      const preview = shareInvitePreview(share);
      preview.edgeVer = EDGE_VER;
      return json(preview, 200, {}, req);
    }

    step = "clear-rate";
    shareJoinRateClear(rate);

    step = "token";
    const token = [...crypto.getRandomValues(new Uint8Array(16))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const claimToken =
      body.claim && body.claimToken
        ? String(body.claimToken)
        : [...crypto.getRandomValues(new Uint8Array(16))]
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
    step = "proof";
    const proof = await guestSessionProof(env, token, sid, name);
    const guest = {
      token,
      shareId: sid,
      name,
      pitchId: "g" + token.slice(0, 11),
      claimToken,
      proof,
      queue: [],
      joinedAt: Date.now(),
    };
    // Broadcast guests stay on the Worker (KV) for the whole session.
    step = "kv-guest";
    await guestStorePut(env, token, guest);
    step = "kv-index";
    const glist = await shareGuestsGet(env, sid);
    if (!Array.isArray(glist.tokens)) glist.tokens = [];
    glist.tokens.push(token);
    if (glist.tokens.length > 200) glist.tokens = glist.tokens.slice(-150);
    await shareGuestsPut(env, sid, glist);

    step = "payload";
    let payload;
    const plan = await workersPlanFor(env, hostname);
    try {
      payload = await sharePayloadFromRecord(share, guest, { workersPlan: plan });
    } catch (_) {
      payload = {
        type: "share",
        kind: "event",
        id: share.id,
        mode: share.mode || "join",
        hostName: share.hostName || "Phlip host",
        serverName: share.serverName || share.hostName || "Phlip host",
        serverHostName: share.serverHostName || "an Android device",
        workersPlan: plan,
        eventCreatorName: share.eventCreatorName || "someone",
        eventTitle: share.eventTitle || (share.display && share.display.title) || "Event",
        eventWhere: share.eventWhere || "",
        eventSticker: share.eventSticker || "",
        display: share.display && typeof share.display === "object" ? share.display : {},
        enc: {},
        event: share.event && typeof share.event === "object" ? share.event : { id: share.refId },
        ended: false,
        self: { name, pid: guest.pitchId },
      };
    }
    payload.type = "share";
    payload.token = token;
    payload.claimToken = claimToken;
    payload.edgeVer = EDGE_VER;
    step = "respond";
    return json(payload, 200, {}, req);
  } catch (e) {
    const detail = String((e && e.message) || e || "error").slice(0, 80);
    const limit = isKvWriteLimitError(e);
    return json(
      {
        type: "error",
        edgeVer: EDGE_VER,
        error: limit
          ? "Cloudflare KV daily write limit reached — Public Broadcasts need Workers Paid (or wait until 00:00 UTC)."
          : `Couldn't complete join (${step}: ${detail}). Try again.`,
      },
      500,
      {},
      req,
    );
  }
}

async function handleSharePoll(req, env, hostname) {
  const url = new URL(req.url);
  const token =
    req.headers.get("x-ash-token") || url.searchParams.get("token") || "";
  const guest = await guestStoreGet(env, token);
  if (!guest || !(await verifyGuestSession(env, guest))) return json({ type: "ended" });
  if (guest.ended || (await isShareClosed(env, guest.shareId))) {
    return json({ type: "ended" });
  }
  const share = await shareRecordGet(env, guest.shareId);
  if (!share || share.closed) return json({ type: "ended" });

  const messages = guest.queue || [];
  // Only write when draining a non-empty queue — empty polls must not burn KV quota.
  if (messages.length > 0) {
    guest.queue = [];
    guest.lastSeen = Date.now();
    try {
      await guestStorePut(env, token, guest);
    } catch (_) {}
    return json({ type: "poll", messages });
  }

  // Short hold: re-read once; still no write unless messages appeared.
  await new Promise((r) => setTimeout(r, 2500));
  const again = await guestStoreGet(env, token);
  if (!again || again.ended || (await isShareClosed(env, again.shareId))) {
    return json({ type: "ended" });
  }
  if (again && (await verifyGuestSession(env, again)) && again.queue && again.queue.length) {
    const msgs = again.queue;
    again.queue = [];
    again.lastSeen = Date.now();
    try {
      await guestStorePut(env, token, again);
    } catch (_) {}
    return json({ type: "poll", messages: msgs });
  }
  // No fanout writes: push a fresh share snapshot so RSVP/label updates reach guests.
  const liveShare = await shareRecordGet(env, guest.shareId);
  if (!liveShare || liveShare.closed) return json({ type: "ended" });
  try {
    const host = String(hostname || "").toLowerCase();
    const plan = host ? await workersPlanFor(env, host) : "free";
    const snap = await sharePayloadFromRecord(liveShare, again || guest, { workersPlan: plan });
    return json({ type: "poll", messages: [snap] });
  } catch (_) {
    return json({ type: "poll", messages: [] });
  }
}

async function handleShareRpc(req, env, hostname) {
  const body = await req.json().catch(() => ({}));
  const token = String(body.token || req.headers.get("x-ash-token") || "");
  const guest = await guestStoreGet(env, token);
  if (!guest || !(await verifyGuestSession(env, guest))) return json({ type: "ended" });
  if (guest.ended || (await isShareClosed(env, guest.shareId))) {
    return json({ type: "ended" });
  }
  const share = await shareRecordGet(env, guest.shareId);
  if (!share || share.closed) return json({ type: "ended" });
  const type = String(body.type || "");
  const plan = await workersPlanFor(env, hostname);

  if (type === "ping") {
    return json({ type: "pong", messages: guest.queue || [] });
  }

  if (type === "rsvp") {
    const status = String(body.status || "going");
    share.event = share.event || {};
    share.event.guests = share.event.guests || {};
    // Same status → no KV write.
    if (share.event.guests[guest.name] === status) {
      return json({ type: "ok", messages: [], edgeVer: EDGE_VER });
    }
    share.event.guests[guest.name] = status;
    // Host pull rebuilds RSVP from the share snapshot — skip inbox write.
    try {
      await shareRecordPut(env, share, { requireKv: true });
    } catch (e) {
      if (isKvWriteLimitError(e)) {
        return json({
          type: "error",
          error: "Cloudflare KV daily write limit reached — guest sign-ups can’t sync until it resets (00:00 UTC) or the Workers plan is upgraded.",
          edgeVer: EDGE_VER,
        });
      }
      throw e;
    }
    return json({ type: "ok", messages: [], edgeVer: EDGE_VER });
  }

  if (type === "react") {
    if (plan !== "paid") {
      // Guest keeps the reaction on-device; don't burn KV or error-toast.
      return json({ type: "ok", localOnly: true, edgeVer: EDGE_VER });
    }
    let emoji = String(body.emoji || "");
    const count = Math.max(1, Math.min(99, Number(body.count) || 1));
    share.event = share.event || {};
    share.event.reactions = share.event.reactions || {};
    let stored = "";
    if (!emoji) {
      delete share.event.reactions[guest.name];
    } else {
      const pipe = emoji.lastIndexOf("|");
      if (pipe > 0 && /^\d+$/.test(emoji.slice(pipe + 1))) {
        stored = emoji;
      } else {
        if (emoji.length > 8000) emoji = emoji.slice(0, 8000);
        stored = count > 1 ? `${emoji}|${count}` : emoji;
      }
      share.event.reactions[guest.name] = stored;
    }
    // Host pull rebuilds reactions from the share snapshot — skip inbox write.
    try {
      await shareRecordPut(env, share, { requireKv: true });
    } catch (e) {
      if (isKvWriteLimitError(e)) {
        return json({
          type: "error",
          error: "Cloudflare KV daily write limit reached — reactions can’t sync until it resets (00:00 UTC) or the Workers plan is upgraded.",
          edgeVer: EDGE_VER,
        });
      }
      throw e;
    }
    return json({ type: "ok", messages: [], edgeVer: EDGE_VER });
  }

  if (type === "report") {
    const event = {
      kind: "report",
      shareId: share.id,
      refId: share.refId,
      name: guest.name,
      reason: String(body.reason || "other").slice(0, 32),
      note: String(body.note || "").slice(0, 1000),
    };
    try {
      await pushInbox(env, hostname, event, { requireKv: true });
    } catch (e) {
      if (isKvWriteLimitError(e)) {
        return json({
          type: "error",
          error: "Cloudflare KV daily write limit reached — try again after 00:00 UTC or upgrade Workers.",
          edgeVer: EDGE_VER,
        });
      }
      throw e;
    }
    return json({ type: "ok", messages: [], edgeVer: EDGE_VER });
  }

  return json({ type: "error", error: "Not allowed" });
}

/** @deprecated Fanout burned N KV writes per guest; polls carry share snapshots instead. */
async function fanoutShare(_env, _share) {}

/** @deprecated Stop is visible via isShareClosed on the next poll. */
async function fanoutShareEnded(_env, _shareId) {}

const workerHandler = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const hostname = hostOf(request);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    let res;
    // Host sync (phone → Worker)
    if (path.startsWith("/edge/host/")) {
      res = await handleHostSync(request, env, hostname);
      return withCors(res, request);
    }

    // Personal invite routes — bypass invite-hash gate entirely.
    const personal = parsePersonalInvitePath(path);
    if (personal) {
      if (personal.isRequest) {
        if (request.method !== "POST") {
          return withCors(json({ type: "error", error: "POST required" }, 405, {}, request), request);
        }
        res = await handlePersonalInviteRequest(request, env, hostname, personal.slug);
        return withCors(res, request);
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        return withCors(json({ type: "error", error: "GET required" }, 405, {}, request), request);
      }
      res = await handlePersonalInviteGet(request, env, hostname, personal.slug);
      return withCors(res, request);
    }

    // Join-code gate (legacy rotating code + personal slug unlock)
    if (path === "/edge/gate") {
      if (request.method === "POST") return handleGatePost(request, env, hostname);
      return gateHtml(hostname, null, request);
    }

    // Read-only relay cache — Worker serves ciphertext without origin.
    if (path === "/edge/relay" || path === "/edge/relay/") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return withCors(json({ type: "error", error: "GET required" }, 405, {}, request), request);
      }
      res = await handleRelayGet(request, env, hostname);
      return withCors(res, request);
    }

    const { tier } = await tierFor(request, env, hostname);

    if (tier === "none") {
      // Public shell is login-only; server data remains behind the member tier.
      if (isStaticPath(path)) {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return withCors(json({ type: "error", error: "GET required" }, 405, {}, request), request);
        }
        res = await proxyOrigin(request, env, url, hostname);
        return withCors(res, request);
      }
      if (path === "/ash-ok" || path === "/ash-ok/") {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return withCors(json({ type: "error", error: "GET required" }, 405, {}, request), request);
        }
        const limit = rateCheck(PUBLIC_LOGIN_RATE, `meta:${clientIp(request)}`, 30, 60_000);
        if (!limit.ok) {
          return json(
            { type: "error", error: "Too many attempts. Wait a minute and try again." },
            429,
            { "retry-after": String(Math.ceil(limit.retryAfterMs / 1000)) },
            request,
          );
        }
        res = await proxyAnonymousOk(request, env, url, hostname);
        return withCors(res, request);
      }
      if (path === "/ash-auth-salt" || path === "/ash-auth-salt/") {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return withCors(json({ type: "error", error: "GET required" }, 405, {}, request), request);
        }
        const limit = rateCheck(PUBLIC_LOGIN_RATE, `salt:${clientIp(request)}`, 20, 60_000);
        if (!limit.ok) {
          return json(
            { type: "error", error: "Too many attempts. Wait a minute and try again." },
            429,
            { "retry-after": String(Math.ceil(limit.retryAfterMs / 1000)) },
            request,
          );
        }
        res = await proxyOrigin(request, env, url, hostname);
        return withCors(res, request);
      }
      if (path === "/ash-login" || path === "/ash-login/") {
        if (request.method !== "POST") {
          return withCors(json({ type: "error", error: "POST required" }, 405, {}, request), request);
        }
        const limit = rateCheck(PUBLIC_LOGIN_RATE, `login:${clientIp(request)}`, 8, 60_000);
        if (!limit.ok) {
          return json(
            { type: "error", error: "Too many attempts. Wait a minute and try again." },
            429,
            { "retry-after": String(Math.ceil(limit.retryAfterMs / 1000)) },
            request,
          );
        }
        res = await proxyOriginAdmission(request, env, url, hostname);
        return withCors(res, request);
      }
      // New joins and all member APIs remain behind invite/member tier.
      if (path.startsWith("/ash-")) {
        return json(
          {
            type: "error",
            error: "Sign in with an existing account, or open a current personal invite link to join.",
            needGate: true,
            needInviteLink: true,
            edgeVer: EDGE_VER,
          },
          401,
          {},
          request,
        );
      }
      return gateHtml(hostname, "Sign in at this server's main address, or open a current invite link.", request);
    }

    if (!allowedProxy(tier, path)) {
      if (tier === "invite" && (path === "/ash-poll" || path === "/ash-rpc")) {
        return json(
          { type: "error", error: "Waiting for the host to approve you." },
          200,
          {},
          request,
        );
      }
      return withCors(new Response("Forbidden", { status: 403 }), request);
    }

    const admissionPath =
      path === "/ash-login" || path === "/ash-login/" ||
      path === "/ash-join" || path === "/ash-join/" ||
      path === "/ash-join-wait" || path === "/ash-join-wait/";
    res = admissionPath
      ? await proxyOriginAdmission(request, env, url, hostname)
      : await proxyOrigin(request, env, url, hostname);
    return withCors(res, request);
  },
};

export default {
  async fetch(request, env) {
    const response = await workerHandler.fetch(request, env);
    return withEdgeSecurity(response, request);
  },
};
