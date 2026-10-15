/* render-join-parse.js — invite URL/code parse, host recall, bootstrap helpers.
 * Load after: render-user-settings.js; before: render-join-modal.js
 */

function normalizeServerUrl(input) {
  let s = input.trim();
  if (!s) return null;
  if (/^wss?:\/\//i.test(s)) { /* already ws(s):// */ }
  else if (/^https?:\/\//i.test(s)) s = s.replace(/^http/i, "ws");
  else s = "ws://" + s;
  s = s.replace(/\/+$/, "").replace(/\/ws$/i, "");
  return s + "/ws";
}

// An invite link is `<addr>/#join&s=<serverName>&c=<inviteCode>&t=<groupToken>&p=<passphrase>`
// or a personal invite `<server-origin>/j/<slug>` / `?slug=` / hash `slug=`.
// Secrets ride in the URL fragment so they never reach the host's request logs
// or the Cloudflare edge. Returns null if it isn't one.
function parseInviteLink(link) {
  let u;
  try { u = new URL(String(link).trim()); } catch { return null; }
  const pathSlug = extractInviteSlug(u.href);
  const p = new URLSearchParams(u.hash.replace(/^#/, ""));
  const token = (p.get("t") || "").trim();
  const invite = (p.get("c") || "").trim();
  const hashSlug = normInviteSlug(p.get("slug") || "");
  const slug = pathSlug || hashSlug || normInviteSlug(u.searchParams.get("slug") || "");
  if (!invite && !token && !slug) return null;
  const isPersonalPath = /\/j\/[a-z0-9]+/i.test(u.pathname || "");
  // Apex App Link is not a game-server host — keep slug only. Server-origin
  // `/j/<slug>` (LAN or that server's public HTTPS) keeps u.origin as join base.
  const isApexAppLink = isPersonalPath && /^(?:www\.)?phlipapp\.com$/i.test(u.hostname || "");
  return {
    base: isApexAppLink ? "" : u.origin,
    name: p.get("s") || (isApexAppLink ? "" : u.hostname),
    invite: invite || token || "",
    token,
    pass: p.get("p") || "",
    inviteSlug: slug,
  };
}

function isCleartextJoinHost(hostOrUrl) {
  let h = String(hostOrUrl || "").trim().toLowerCase();
  if (!h) return false;
  if (/^(?:https?|wss?):\/\//i.test(h)) {
    try {
      h = new URL(h.replace(/^ws/i, "http").replace(/^wss/i, "https")).host;
    } catch {
      h = h.replace(/^(?:https?|wss?):\/\//i, "").replace(/\/.*$/, "");
    }
  } else {
    h = h.replace(/\/.*$/, "");
  }
  let host = h;
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    if (end > 0) host = h.slice(1, end);
  } else {
    const m = /^([^:]+):(\d+)$/.exec(h);
    if (m) host = m[1];
  }
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  if (host.endsWith(".local")) return true;
  const parts = host.split(".").map(Number);
  if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    if (parts[0] === 10) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
  }
  return false;
}

/** Origin for join probes: https for Public hostnames, http for LAN/loopback. */
function httpsBaseFromHost(raw) {
  let h = String(raw || "").trim();
  if (!h) return "";
  if (/^https?:\/\//i.test(h)) {
    try {
      const u = new URL(h);
      if (isCleartextJoinHost(u.hostname) || isCleartextJoinHost(u.host)) {
        const port = u.port || "3000";
        return `http://${u.hostname}:${port}`;
      }
      return u.origin;
    } catch { return ""; }
  }
  h = h.replace(/\/.*$/, "").toLowerCase();
  if (!h) return "";
  const clear = isCleartextJoinHost(h);
  // Local servers listen from ServerRegistry.BASE_PORT (3000); bare host → :3000.
  if (clear && !/:\d+$/.test(h) && !h.startsWith("[")) h = `${h}:3000`;
  return `${clear ? "http" : "https"}://${h}`;
}

function parseJoinCodeSections(raw) {
  const empty = { tag: "", invite: "", host: "", pass: "", token: "", rot: "", inviteSlug: "" };
  let s = String(raw || "").trim();
  if (!s) return empty;

  const fromSlug = extractInviteSlug(s);
  if (fromSlug && !/^phlip:\/\//i.test(s) && (/\/j\//i.test(s) || /[?&#]slug=/i.test(s))) {
    let host = "";
    try {
      const href = /^https?:\/\//i.test(s) ? s : `https://${s}`;
      const u = new URL(href);
      // Apex App Link is not a game server; keep other origins (incl. LAN).
      if (u.hostname && !/^(?:www\.)?phlipapp\.com$/i.test(u.hostname)) {
        host = `${u.origin}/j/${encodeURIComponent(fromSlug)}`;
      }
    } catch { /* ignore */ }
    return { ...empty, inviteSlug: fromSlug, host, pass: "" };
  }

  // Whole share blob: "Join code: …" / "Link: …" / "Server password: …"
  const passM = /(?:server\s*)?password\s*[:：]\s*(\S+)/i.exec(s);
  const pass = passM ? passM[1].trim() : "";
  const codeM = /join\s*code\s*[:：]\s*([^\s\n]+)/i.exec(s);
  const linkM = /(?:(?:public\s*)?link|server\s*url|invite\s*link)\s*[:：]\s*(\S+)/i.exec(s);
  const bareUrlM = /https?:\/\/[^\s]+/i.exec(s);
  if (codeM || linkM || (bareUrlM && /join\s*code/i.test(s))) {
    const fromCode = codeM ? unpackInviteCode(codeM[1].trim()) : null;
    let host = "";
    const linkRaw = (linkM && linkM[1]) || (bareUrlM && bareUrlM[0]) || "";
    let inviteSlug = "";
    if (linkRaw) {
      inviteSlug = extractInviteSlug(linkRaw);
      try {
        const u = new URL(/^https?:\/\//i.test(linkRaw) ? linkRaw : `https://${linkRaw}`);
        if (!/phlipapp\.com$/i.test(u.hostname || "")) host = u.hostname;
      } catch { host = ""; }
    }
    // phlip://join?url=https://…
    if (!host && /^phlip:\/\//i.test(s)) {
      try {
        const u = new URL(s);
        const q = u.searchParams.get("url") || u.searchParams.get("host") || "";
        if (q) host = new URL(/^https?:\/\//i.test(q) ? q : `https://${q}`).hostname;
      } catch { /* ignore */ }
    }
    return {
      tag: fromCode?.sid || "",
      invite: fromCode?.invite || "",
      host: fromCode?.host || host || "",
      pass,
      inviteSlug: inviteSlug || fromSlug || "",
    };
  }

  if (/^phlip:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const q = u.searchParams.get("url") || u.searchParams.get("host") || "";
      const slugQ = normInviteSlug(u.searchParams.get("slug") || "");
      if (q) {
        const href = /^https?:\/\//i.test(q) ? q : `https://${q}`;
        const target = new URL(href);
        const targetSlug = slugQ || extractInviteSlug(target.href) || fromSlug;
        const host = targetSlug
          ? `${target.origin}/j/${encodeURIComponent(targetSlug)}`
          : target.origin;
        return { ...empty, host, pass, inviteSlug: targetSlug };
      }
      if (slugQ || fromSlug) return { ...empty, pass, inviteSlug: slugQ || fromSlug };
    } catch { /* fall through */ }
  }

  if (/^https?:\/\//i.test(s)) {
    try {
      const fromLink = parseInviteLink(s);
      if (fromLink) {
        return {
          tag: "",
          invite: normJoinAlpha(fromLink.token || fromLink.invite) || fromLink.token || fromLink.invite || "",
          host: fromLink.base ? new URL(fromLink.base).hostname : "",
          pass: fromLink.pass || pass,
          token: fromLink.token || "",
          rot: fromLink.invite && fromLink.token ? fromLink.invite : "",
          inviteSlug: fromLink.inviteSlug || "",
        };
      }
      const u = new URL(s);
      return { ...empty, host: u.hostname, pass, inviteSlug: extractInviteSlug(s) };
    } catch { /* fall through */ }
  }

  const packed = unpackInviteCode(s);
  if (!packed) {
    if (/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/i.test(s.replace(/^https?:\/\//, ""))) {
      return { ...empty, host: s.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase(), pass };
    }
    if (fromSlug) return { ...empty, inviteSlug: fromSlug, pass };
    return { ...empty, pass };
  }

  return {
    tag: packed.sid || "",
    invite: packed.invite || "",
    host: packed.host || "",
    pass: packed.pass || pass,
    inviteSlug: fromSlug || "",
  };
}

const ASH_PUBLIC_ROUTE_KEY = "ash_public_route";

function rememberPublicHost(host) {
  const h = String(host || "").trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!h) return;
  if (typeof storageSetText === "function") storageSetText(ASH_PUBLIC_ROUTE_KEY, `host|${h}`);
  else try { localStorage.setItem(ASH_PUBLIC_ROUTE_KEY, `host|${h}`); } catch {}
}

function recalledPublicHost() {
  try {
    const v = (typeof storageGetText === "function"
      ? (storageGetText(ASH_PUBLIC_ROUTE_KEY, "") || "")
      : (localStorage.getItem(ASH_PUBLIC_ROUTE_KEY) || ""));
    if (v.startsWith("host|")) return v.slice(5) || null;
    return null;
  } catch { return null; }
}

/** Resolve typed invites: XXXXXX[@host], TAG-XXXXXX[@host], legacy ash1 / #join links. */
function unpackInviteCode(raw) {
  const original = String(raw || "").trim();
  const s = original.replace(/\s+/g, "");
  if (!s) return null;
  const asLink = parseInviteLink(original) || parseInviteLink(s);
  if (asLink) return asLink;

  // Legacy packed form (still accepted if someone has an old share).
  const ash = /^ash1\.([A-Za-z0-9_-]+)$/i.exec(s);
  if (ash) {
    try {
      let b64 = ash[1].replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      const bin = atob(b64);
      const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
      const text = new TextDecoder().decode(bytes);
      const parts = text.split("\0");
      const base = (parts[0] || "").trim();
      const invite = (parts[1] || "").trim();
      const name = (parts[2] || "").trim();
      if (!base || !invite) return null;
      return { base, invite, name, pass: "", sid: "" };
    } catch {
      return null;
    }
  }

  // Public / domain form: XXXXXX@hostname (no TAG — domain is the server id).
  const pub = /^([A-Za-z0-9]{6,})@([A-Za-z0-9][A-Za-z0-9.-]*)$/i.exec(s);
  if (pub) {
    const invite = pub[1].toUpperCase();
    const host = pub[2].trim().toLowerCase();
    return { base: httpsBaseFromHost(host), invite, name: "", pass: "", sid: "", host };
  }

  // Bare rotating code (already on the host page / known URL).
  if (/^[A-Za-z0-9]{6,}$/i.test(s) && !s.includes("-")) {
    return { base: "", invite: s.toUpperCase(), name: "", pass: "", sid: "", host: "" };
  }

  // Local / legacy: TAG-XXXXXX or TAG-XXXXXX@hostname (optional legacy +…/… suffix ignored)
  const m = /^([A-Za-z0-9]{4})-([A-Za-z0-9]{6,})(?:\+[A-Za-z0-9]+(?:\/[A-Za-z0-9][A-Za-z0-9.-]*)?)?(?:@([A-Za-z0-9][A-Za-z0-9.-]*))?$/i.exec(s);
  if (!m) return null;
  const sid = m[1].toUpperCase();
  const invite = m[2].toUpperCase();
  const host = (m[3] || "").trim().toLowerCase();
  if (host) {
    const base = httpsBaseFromHost(host);
    return { base, invite, name: "", pass: "", sid, host };
  }
  return { base: "", invite, name: "", pass: "", sid, host: "" };
}

function normalizeJoinPrefill(prefill) {
  const empty = { sections: { tag: "", invite: "", host: "", token: "", rot: "", inviteSlug: "" }, pass: "", name: "", rejoinUrl: "" };
  if (!prefill) return empty;
  if (typeof prefill === "object") {
    const code = prefill.sid && prefill.code
      ? formatShareCode(prefill.sid, prefill.code, prefill.isPublic ? prefill.route : null)
      : (prefill.code || "").trim();
    let sections = code ? parseJoinCodeSections(code) : { tag: "", invite: "", host: "", pass: "", token: "", rot: "", inviteSlug: "" };
    if (prefill.sid && !sections.tag) {
      sections = { ...sections, tag: normJoinAlpha(prefill.sid).slice(0, 4) };
    }
    if (prefill.route && !sections.host) sections = { ...sections, host: String(prefill.route) };
    if (prefill.url || prefill.host) {
      const fromUrl = parseJoinCodeSections(prefill.url || prefill.host);
      if (fromUrl.host) sections = { ...sections, host: fromUrl.host };
      if (fromUrl.invite && !sections.invite) sections = { ...sections, invite: fromUrl.invite };
      if (fromUrl.token) sections = { ...sections, token: fromUrl.token, rot: fromUrl.rot || sections.rot || "" };
      if (fromUrl.inviteSlug) sections = { ...sections, inviteSlug: fromUrl.inviteSlug };
    }
    if (prefill.invite && !sections.invite) {
      sections = { ...sections, invite: normJoinAlpha(prefill.invite) || prefill.invite };
    }
    if (prefill.inviteSlug || prefill.slug) {
      sections = { ...sections, inviteSlug: normInviteSlug(prefill.inviteSlug || prefill.slug) };
    }
    if (prefill.token) {
      sections = {
        ...sections,
        token: prefill.token,
        invite: sections.invite || prefill.token,
      };
    }
    return {
      sections,
      pass: prefill.pass || "",
      name: prefill.name || "",
      rejoinUrl: prefill.rejoinUrl || "",
    };
  }
  const s = String(prefill).trim();
  if (!s) return empty;
  return { sections: parseJoinCodeSections(s), pass: "", name: "", rejoinUrl: "" };
}

// Local-network discovery: servers this device's own MainActivity can see nearby
// via NSD (mDNS) — pushed live while "Add a server" is open (see AshNative.startDiscovery
// in the join modal below). Each entry: { id, name, url, code, pass }.
let discoveredServers = [];
let onDiscoveredChange = null;
window.ashDiscoveredServers = (list) => {
  discoveredServers = Array.isArray(list) ? list : [];
  onDiscoveredChange?.(discoveredServers);
};

/** Already-joined conn for this server's joinTag (NSD sid). */
function findKnownMemberConnByTag(sid) {
  const tag = normJoinTag(typeof normJoinAlpha === "function" ? normJoinAlpha(sid) : sid);
  if (!tag) return null;
  const tagId = `srv-tag-${tag.toLowerCase()}`;
  const live = S.conns[tagId];
  if (live?.token) return live;
  for (const conn of Object.values(S.conns || {})) {
    if (!conn || PersonalSpace.isPersonal(conn)) continue;
    if (normJoinTag(conn.joinTag) === tag && conn.token) return conn;
  }
  for (const entry of loadServers()) {
    if (normJoinTag(entry.joinTag) === tag && entry.token) {
      return S.conns[entry.id] || null;
    }
  }
  return null;
}

/** NSD row matching a public invite's joinTag — prefer LAN when on same Wi‑Fi. */
function nearbyForJoinTag(sid) {
  const tag = normJoinTag(typeof normJoinAlpha === "function" ? normJoinAlpha(sid) : sid);
  if (!tag) return null;
  for (const d of discoveredServers) {
    if (normJoinTag(d.sid) === tag && d.url) return d;
  }
  return null;
}

/** True if this LAN discovery hit is already on the rail (joined or hosted here). */
function discoveredAlreadyJoined(d) {
  if (!d) return true;
  if (d.id && S.conns["srv-local-" + d.id]) return true;
  const discNorm = normalizeServerUrl(d.url || "") || "";
  const discBase = httpBaseFromUrl(discNorm || d.url || "").toLowerCase();
  let discHost = "";
  try { discHost = discBase ? new URL(discBase).host.toLowerCase() : ""; } catch {}
  const discSid = String(d.sid || "").trim().toUpperCase();
  for (const conn of Object.values(S.conns || {})) {
    if (!conn || PersonalSpace.isPersonal(conn)) continue;
    if (d.id && conn.id === "srv-local-" + d.id) return true;
    const cNorm = normalizeServerUrl(conn.url || "") || "";
    if (discNorm && cNorm && discNorm === cNorm) return true;
    const cBase = httpBaseFromUrl(cNorm || conn.url || "").toLowerCase();
    if (discBase && cBase && discBase === cBase) return true;
    try {
      const cHost = cBase ? new URL(cBase).host.toLowerCase() : "";
      if (discHost && cHost && discHost === cHost) return true;
    } catch {}
    // Same server via public URL still shares joinTag / NSD sid.
    if (discSid && String(conn.joinTag || "").trim().toUpperCase() === discSid) return true;
  }
  return false;
}

/** Already-joined online conn that matches this invite's host (for §10 redeem). */
function findOnlineConnForGroupInvite(pre, token) {
  if (!token) return null;
  const wantHost = String(pre?.sections?.host || "").trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const served = isServedOrigin();
  for (const conn of Object.values(S.conns || {})) {
    if (!conn || PersonalSpace.isPersonal(conn)) continue;
    if (conn.status !== "online" || !conn.token) continue;
    if (served && conn.url && httpBaseFromUrl(conn.url) === location.origin) return conn;
    if (!wantHost) continue;
    try {
      const cHost = new URL(httpBaseFromUrl(conn.url || "") || conn.url || "").hostname.toLowerCase();
      if (cHost && cHost === wantHost) return conn;
    } catch {}
  }
  return null;
}

const PERSONAL_INVITE_OFFLINE_COPY =
  "Host isn't reachable on the internet. Connect to the same Wi‑Fi as the host, or ask them to start a Direct session.";

/** Saved / online conn that already knows this personal invite slug. */
function findSavedConnForInviteSlug(slug) {
  const s = normInviteSlug(slug);
  if (!s) return null;
  for (const c of Object.values(S.conns || {})) {
    if (!c || PersonalSpace.isPersonal(c)) continue;
    const hit =
      normInviteSlug(c.inviteSlug || c._joinInviteSlug || c.joinIntent?.inviteSlug || "") === s;
    if (hit) return c;
  }
  try {
    for (const e of loadServers()) {
      if (normInviteSlug(e.inviteSlug || e._joinInviteSlug || "") !== s) continue;
      const live = S.conns[e.id];
      if (live) return live;
      return {
        id: e.id,
        url: e.url,
        sharePublic: e.sharePublic || e.urlPublic || "",
        shareLan: e.shareLan || e.urlLan || "",
        urlPublic: e.urlPublic || "",
        urlLan: e.urlLan || "",
        joinTag: e.joinTag || "",
        inviteSlug: e.inviteSlug || s,
        token: e.token || null,
        name: e.name || "",
      };
    }
  } catch {}
  return null;
}

/**
 * Dual bootstrap for personal invite links.
 * Order: saved conn → Worker public URL if tunnelUp → LAN discovery → Direct guidance.
 * States: resolving | public | local_required | direct_required
 */
async function resolvePersonalInviteBootstrap(slug, opts = {}) {
  const s = normInviteSlug(slug);
  if (!s) return { state: "local_required", slug: "", message: PERSONAL_INVITE_OFFLINE_COPY };
  const saved = findSavedConnForInviteSlug(s);
  if (saved) {
    const pub = String(saved.sharePublic || saved.urlPublic || "").trim();
    const lan = String(saved.shareLan || saved.urlLan || "").trim();
    let base = "";
    if (pub && /^https:/i.test(pub)) base = httpBaseFromUrl(pub) || pub;
    else if (lan) base = httpBaseFromUrl(lan) || lan;
    else if (saved.url) {
      const u = String(saved.url);
      base = /^wss:/i.test(u)
        ? u.replace(/^wss:/i, "https:")
        : (/^ws:/i.test(u) ? u.replace(/^ws:/i, "http:") : (httpBaseFromUrl(u) || u));
    }
    if (base) {
      return {
        state: "public",
        slug: s,
        base: String(base).replace(/\/+$/, ""),
        hostDisplayName: saved.name || saved.hostName || "",
        joinTag: saved.joinTag || "",
        message: "Using your saved connection.",
        savedConn: saved,
      };
    }
  }
  if (typeof fetchPersonalInviteMeta === "function") {
    const meta = await fetchPersonalInviteMeta(s);
    if (meta?.ok && meta.tunnelUp && meta.publicUrl) {
      return {
        state: "public",
        slug: s,
        base: String(meta.publicUrl).replace(/\/+$/, ""),
        hostDisplayName: meta.hostDisplayName || "",
        message: meta.message || "Host is reachable on the internet.",
        meta,
      };
    }
    if (meta?.ok && !meta.tunnelUp) {
      const near = nearbyForJoinTag(opts.joinTag || "") || null;
      if (near?.url) {
        return {
          state: "public",
          slug: s,
          base: httpBaseFromUrl(near.url) || near.url,
          hostDisplayName: near.name || meta.hostDisplayName || "",
          joinTag: near.sid || "",
          message: "Found the host on the same Wi‑Fi.",
          meta,
        };
      }
      const hotspot = typeof window !== "undefined" && !!window.AshNative?.hotspotJoinAvailable;
      return {
        state: hotspot ? "direct_required" : "local_required",
        slug: s,
        hostDisplayName: meta.hostDisplayName || "",
        message: PERSONAL_INVITE_OFFLINE_COPY,
        meta,
      };
    }
  }
  for (let i = 0; i < 6; i++) {
    if (discoveredServers.length) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (discoveredServers.length === 1 && discoveredServers[0]?.url) {
    const d = discoveredServers[0];
    return {
      state: "public",
      slug: s,
      base: httpBaseFromUrl(d.url) || d.url,
      hostDisplayName: d.name || "",
      joinTag: d.sid || "",
      message: "Found a Nearby server on the same Wi‑Fi.",
    };
  }
  const hotspot = typeof window !== "undefined" && !!window.AshNative?.hotspotJoinAvailable;
  return {
    state: hotspot ? "direct_required" : "local_required",
    slug: s,
    message: PERSONAL_INVITE_OFFLINE_COPY,
  };
}
