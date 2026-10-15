/* render-share.js — server/personal invite URLs, share sheet, join-code format.
 * Globals out: mountServerShareBlock, shareServerInvite, formatShareCode,
 *   composeJoinCode, serverInviteHost, …
 * Load after: render-side-overlay.js; before: channel-panel.js / render-join.js
 */

function runServerShareAction(act, conn = activeConn()) {
  if (!conn || PersonalSpace.isPersonal(conn)) return;
  if (act === "invite" || act === "personal" || act === "code") sharePersonalInviteLink(conn);
  else if (act === "groups") openCreateGroupInviteModal();
}

/**
 * Mount Invite (personal QR) + personal invite URL into a container.
 * @param {{ idPrefix?: string, actions?: boolean, label?: string|false }} [opts]
 * @returns {boolean} whether anything was mounted
 */
function mountServerShareBlock(parent, conn = activeConn(), {
  idPrefix = "ss",
  actions = true,
  label = "Server",
  inviteIcon = false,
  inviteChannelId = null,
} = {}) {
  if (!parent || !conn || PersonalSpace.isPersonal(conn)) return false;
  const manage = canManageServer(conn);
  const canInvite = typeof canInviteToGroup === "function" && canInviteToGroup(conn);
  // Channel-panel compact mode: managers still see URL/code even without action buttons.
  if (!manage && !canInvite) return false;
  if (!actions && !manage && !inviteIcon) return false;

  const wrap = document.createElement("div");
  wrap.className = "server-share-block" + (actions ? "" : " is-compact");

  if (label || (inviteIcon && canInvite)) {
    const head = document.createElement("div");
    head.className = "server-share-block-head";
    if (label) {
      const labelEl = document.createElement("div");
      labelEl.className = "channel-panel-section-label";
      labelEl.textContent = label;
      head.appendChild(labelEl);
    } else {
      head.appendChild(document.createElement("span"));
    }
    if (inviteIcon && canInvite) {
      const inv = document.createElement("button");
      inv.type = "button";
      inv.className = "server-share-invite-btn";
      inv.id = `${idPrefix}-invite`;
      inv.title = "Invite — show QR and link";
      inv.setAttribute("aria-label", "Invite — show QR and link");
      inv.innerHTML = ic("share");
      inv.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        sharePersonalInviteLink(conn);
      };
      head.appendChild(inv);
    }
    wrap.appendChild(head);
  }

  if (actions) {
    const shareRow = document.createElement("div");
    shareRow.className = "server-settings-share-row";
    shareRow.setAttribute("role", "group");
    shareRow.setAttribute("aria-label", "Share");
    const shareActions = [];
    if (canInvite || manage) {
      shareActions.push({ act: "invite", label: "Invite", title: "Show invite QR and link" });
    }
    for (const a of shareActions) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "server-settings-share-btn";
      b.dataset.shareAct = a.act;
      b.title = a.title;
      b.setAttribute("aria-label", a.title);
      b.innerHTML = `${ic("share", "ico-inline")}<span>${a.label}</span>`;
      b.onclick = (e) => {
        e.stopPropagation();
        runServerShareAction(a.act, conn);
      };
      shareRow.appendChild(b);
    }
    if (shareActions.length) wrap.appendChild(shareRow);
  }

  if (manage || canInvite) {
    const personal = typeof personalInviteUrl === "function" ? personalInviteUrl(conn) : "";
    const serverUrl = personal
      || (typeof serverInviteBaseLink === "function" ? serverInviteBaseLink(conn) : "");
    if (serverUrl) {
      const urlHint = document.createElement("div");
      urlHint.className = "side-role-hint ss-server-url";
      urlHint.id = `${idPrefix}-server-url`;
      urlHint.textContent = serverUrl.replace(/^https?:\/\//i, "");
      urlHint.title = serverUrl;
      wrap.appendChild(urlHint);
    }
  }

  if (!wrap.childNodes.length) return false;
  parent.appendChild(wrap);
  return true;
}

/** Share info — personal invite QR / link (no card editor / decks). */
function fillServerShareBody(body) {
  const conn = activeConn();
  if (!conn || !body || PersonalSpace.isPersonal(conn)) return;
  body.classList.add("server-settings-body");
  body.innerHTML = "";

  const main = document.createElement("div");
  main.className = "ss-main";
  body.appendChild(main);
  mountServerShareBlock(main, conn, { idPrefix: "ss" });
}

function serverInviteHost(conn) {
  const pub = String(conn?.sharePublic || "").trim();
  if (pub) {
    try {
      return new URL(/^https?:\/\//i.test(pub) ? pub : `https://${pub}`).hostname || "";
    } catch { /* fall through */ }
  }
  const fromCode = String(conn?.shareCode || "").trim().split("@")[1] || "";
  if (fromCode && !/^(127\.0\.0\.1|localhost)$/i.test(fromCode)) return fromCode.toLowerCase();
  const url = String(conn?.url || "");
  if (/^wss:/i.test(url)) {
    try {
      const h = new URL(url.replace(/^ws/i, "http")).hostname || "";
      if (h && h !== "127.0.0.1" && h !== "localhost") return h;
    } catch { /* fall through */ }
  }
  return "";
}

/** Canonical join string for sharing: prefer personal invite URL; legacy `XXXXXX@host` fallback. */
function serverShareJoinCode(conn) {
  if (!conn || PersonalSpace.isPersonal(conn)) return "";
  const personal = personalInviteUrl(conn);
  if (personal) return personal;
  const cached = String(conn.shareCode || "").trim();
  const invite = normJoinAlpha(conn.invite?.code || "");
  if (!invite) return cached;
  const host = serverInviteHost(conn);
  return composeJoinCode({ invite, host }) || cached || invite;
}

/** Clickable http(s) origin for invites — matches hosting mode (Local vs Public). */
function serverInviteBaseLink(conn) {
  if (!conn || PersonalSpace.isPersonal(conn)) return "";
  const kind = typeof connReachKind === "function" ? connReachKind(conn) : null;
  const wantPublic = kind === "public" || (kind !== "lan" && !!String(conn.sharePublic || "").trim());

  if (wantPublic) {
    const pub = String(conn.sharePublic || "").trim().replace(/\/+$/, "");
    if (pub) {
      if (/^https?:\/\//i.test(pub)) return pub;
      return `https://${pub}`;
    }
    // Public mode but tunnel URL not ready yet — named host if we have one.
    const host = serverInviteHost(conn);
    if (host) return `https://${host}`;
    return "";
  }

  // Local hosting: the host phone's LAN URL — never this device's own IP.
  let lan = String(conn.shareLan || "").trim();
  if (!lan) {
    try {
      const fromBridge = window.AshNative?.shareBaseForServer?.(conn.id) || "";
      // Only trust the bridge on the host WebView (srv-local-*). Remote admins
      // must not call lanIp() — that returns *their* Wi‑Fi address.
      if (fromBridge && String(conn.id || "").startsWith("srv-local-")) lan = fromBridge;
    } catch {}
  }
  if (lan && /^https:/i.test(lan)) lan = "";
  if (lan) {
    if (/^https?:\/\//i.test(lan)) return lan.replace(/\/+$/, "");
    return `http://${lan}`.replace(/\/+$/, "");
  }
  // Joined clients: derive from the ws://host:port they already use.
  const fromConn = lanHttpOriginFromConnUrl(conn.url);
  if (fromConn) return fromConn;
  // Host bridge only: rebuild from this phone's LAN IP + bridged port.
  if (String(conn.id || "").startsWith("srv-local-") && window.AshNative?.lanIp && conn.url) {
    let ip = "", port = "";
    try { ip = window.AshNative.lanIp() || ""; } catch {}
    try { port = new URL(String(conn.url).replace(/^ws/i, "http")).port; } catch {}
    if (ip && port && ip !== "127.0.0.1" && ip.toLowerCase() !== "localhost") {
      return `http://${ip}:${port}`;
    }
  }
  return "";
}

/** `ws://192.168.x.x:port/ws` → `http://192.168.x.x:port` (skips loopback). */
function lanHttpOriginFromConnUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || "").replace(/^ws/i, "http"));
    if (u.protocol !== "http:") return "";
    const host = (u.hostname || "").toLowerCase();
    if (!host || host === "127.0.0.1" || host === "localhost") return "";
    return u.origin;
  } catch {
    return "";
  }
}

/** Optional App Link prefix only — not used for Copy/Share. */
const PERSONAL_INVITE_APP_LINK_BASE = "https://phlipapp.com/j/";

/** Normalize personal invite slug (alphanumeric, lowercase). */
function normInviteSlug(raw) {
  return String(raw || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24);
}

/** Extract slug from `/j/<slug>`, `?slug=`, hash `slug=`, or bare slug-ish token. */
function extractInviteSlug(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  try {
    let href = "";
    if (/^https?:\/\//i.test(s)) href = s;
    else if (s.startsWith("/")) href = `http://local.invalid${s}`;
    else if (/\/j\/[a-z0-9]/i.test(s)) href = `https://${s.replace(/^\/\//, "")}`;
    if (href) {
      const u = new URL(href);
      const m = /\/j\/([a-z0-9]+)/i.exec(u.pathname || "");
      if (m) return normInviteSlug(m[1]);
      const q = u.searchParams.get("slug");
      if (q) return normInviteSlug(q);
      const h = new URLSearchParams(u.hash.replace(/^#/, "")).get("slug");
      if (h) return normInviteSlug(h);
    }
  } catch { /* fall through */ }
  const pathM = /(?:^|\/)j\/([a-z0-9]{8,})/i.exec(s);
  if (pathM) return normInviteSlug(pathM[1]);
  const qM = /[?&#]slug=([a-z0-9]+)/i.exec(s);
  if (qM) return normInviteSlug(qM[1]);
  return "";
}

/** Build invite URL on this server's own origin (never phlipapp.com apex).
 *  Public → `https://host/j/<slug>`; Local → bare `http://lan:port`. */
function buildPersonalInviteUrl(slug, conn) {
  const base = String(typeof serverInviteBaseLink === "function" ? serverInviteBaseLink(conn) : "")
    .trim()
    .replace(/\/+$/, "");
  if (!base) return "";
  const wantPublic = conn?.hostPublic === true
    || (typeof connReachKind === "function" && connReachKind(conn) === "public")
    || (/^https:/i.test(base) && !!String(conn?.sharePublic || conn?.urlPublic || "").trim());
  if (!wantPublic) return base;
  const s = normInviteSlug(slug);
  if (!s) return "";
  return `${base}/j/${s}`;
}

/**
 * Invite URL for this member — Public uses `/j/<slug>`; Local is the bare LAN origin.
 */
function personalInviteUrl(conn) {
  if (!conn || PersonalSpace.isPersonal(conn)) return "";
  const slug = normInviteSlug(conn.me?.inviteSlug || conn.inviteSlug || "");
  const built = buildPersonalInviteUrl(slug, conn);
  if (built) return built;
  const fromUser = String(conn.me?.inviteUrl || conn.inviteUrl || "").trim();
  if (!fromUser || /phlipapp\.com\/j\//i.test(fromUser)) return "";
  // Legacy local `/j/slug` → bare origin.
  if (/^http:/i.test(fromUser) && /\/j\//i.test(fromUser)) {
    try { return new URL(fromUser).origin; } catch { /* fall through */ }
  }
  return fromUser;
}

/** Fetch or rotate personal invite link via RPC. */
function requestPersonalInviteLink(conn = activeConn(), { rotate = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!conn) { reject(new Error("No server")); return; }
    S.inviteLinkWaiters = S.inviteLinkWaiters || {};
    const prev = S.inviteLinkWaiters[conn.id];
    if (typeof prev === "function") {
      try { prev({ type: "error", error: "Superseded" }); } catch {}
    }
    const timer = setTimeout(() => {
      if (S.inviteLinkWaiters?.[conn.id] === finish) delete S.inviteLinkWaiters[conn.id];
      reject(new Error("Timed out"));
    }, 8000);
    const finish = (m) => {
      clearTimeout(timer);
      delete S.inviteLinkWaiters[conn.id];
      if (m?.type === "error") reject(new Error(m.error || "Couldn't get invite link"));
      else resolve(m);
    };
    S.inviteLinkWaiters[conn.id] = finish;
    send({ type: rotate ? "rotateInviteLink" : "getInviteLink" }, conn.id);
  });
}

/** Ensure conn has inviteUrl; fetch from server if missing. */
async function ensurePersonalInviteUrl(conn = activeConn()) {
  const existing = personalInviteUrl(conn);
  if (existing) return existing;
  try {
    const m = await requestPersonalInviteLink(conn, { rotate: false });
    const url = String(m?.url || "").trim()
      || (m?.slug ? buildPersonalInviteUrl(m.slug, conn) : "");
    if (url) {
      conn.inviteUrl = url;
      conn.inviteSlug = normInviteSlug(m.slug || extractInviteSlug(url));
      if (conn.me) {
        conn.me.inviteUrl = url;
        conn.me.inviteSlug = conn.inviteSlug;
      }
    }
    return url;
  } catch {
    return "";
  }
}

/** Bare rotating invite (no @hostname) — legacy only. */
function serverShareInviteOnly(conn) {
  const invite = normJoinAlpha(conn?.invite?.code || "");
  if (invite) return invite;
  const cached = String(conn?.shareCode || "").trim();
  const beforeAt = cached.split("@")[0] || "";
  return normJoinAlpha(beforeAt) || beforeAt || cached;
}

/**
 * Clickable invite for messengers — server's own origin + `/j/<slug>`.
 * Legacy deep links may still carry `c=` for one release when no personal URL.
 */
function serverInviteDeepLink(conn) {
  const personal = personalInviteUrl(conn);
  if (personal) return personal;
  const base = String(serverInviteBaseLink(conn) || "").replace(/\/+$/, "");
  if (!base) return "";
  const invite = serverShareInviteOnly(conn);
  if (!invite) return base;
  const name = String(conn?.name || conn?.hostName || "").trim();
  const parts = ["join"];
  if (name) parts.push(`s=${encodeURIComponent(name)}`);
  parts.push(`c=${encodeURIComponent(invite)}`);
  return `${base}/#${parts.join("&")}`;
}

function serverInviteShareText(conn) {
  const name = conn?.name || conn?.hostName || "server";
  const personal = personalInviteUrl(conn);
  const deep = personal || serverInviteDeepLink(conn);
  const lines = [`Join my Phlip server "${name}"`];
  if (deep) {
    lines.push("", deep);
  } else {
    const legacy = serverShareJoinCode(conn);
    if (legacy) lines.push("", legacy);
  }
  lines.push("", "Pick your own name and password when you join — I’ll approve new people.");
  return lines.join("\n");
}

/** Share/copy plain text (invite blurb, bare URL, or join code). */
async function sharePlainText(text, { copiedToast = "Copied", fallbackToast = "" } = {}) {
  const body = String(text || "").trim();
  if (!body) return false;
  if (window.AshNative?.shareText) {
    try { window.AshNative.shareText(body); return true; } catch {}
  }
  if (navigator.share) {
    try { await navigator.share({ text: body }); return true; } catch (e) {
      if (e?.name === "AbortError") return true;
    }
  }
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(body); toast(copiedToast); return true; } catch {}
  }
  if (fallbackToast) toast(fallbackToast);
  return false;
}

/** Draw a QR for an invite URL when qrcode helper is available. */
function mountInviteQr(hostEl, url, { size = 4 } = {}) {
  if (!hostEl || !url) return false;
  try {
    if (typeof qrcode !== "function") return false;
    const qr = qrcode(0, "M");
    qr.addData(url, "Byte");
    qr.make();
    hostEl.innerHTML = qr.createSvgTag(size, 0);
    return true;
  } catch {
    return false;
  }
}

/** Host/admin/member: copy personal invite link (with optional QR overlay). */
async function sharePersonalInviteLink(conn = activeConn()) {
  if (typeof isDemoMode === "function" && isDemoMode()) {
    toast("Demo is local — invites stay on this browser");
    return;
  }
  if (!conn || PersonalSpace.isPersonal(conn)) return;
  if (conn.drive) {
    if (typeof shareDriveFolder === "function") shareDriveFolder(conn);
    return;
  }
  const canShare = canManageServer(conn)
    || (typeof canInviteToGroup === "function" && canInviteToGroup(conn));
  if (!canShare) {
    toast("Only hosts and admins can share invites");
    return;
  }
  if (typeof connIsDeviceOnly === "function" && connIsDeviceOnly(conn)
      && typeof openHostingGuide === "function") {
    const rawId = String(conn.id || "").replace(/^srv-local-/, "");
    openHostingGuide(rawId, { then: () => sharePersonalInviteLink(conn) });
    return;
  }
  // Direct Soft‑AP: tabbed Wi‑Fi + Server QRs (not personal /j/ invite).
  const hostedDirect = String(conn.id || "").startsWith("srv-local-")
    && (
      String(conn.reachMode || "").toLowerCase() === "direct"
      || conn.hotspotActive
      || (typeof connIsDirectSession === "function" && connIsDirectSession(conn))
    );
  if (hostedDirect && typeof openDirectJoinQrModal === "function") {
    const ok = openDirectJoinQrModal({ conn });
    if (ok) return;
    // Soft‑AP not started — fall through only if we still want a LAN invite; otherwise stop.
    toast("Start Direct link to share join QRs");
    return;
  }
  const url = await ensurePersonalInviteUrl(conn);
  if (!url) {
    toast("No invite link ready yet — try again in a moment");
    return;
  }
  if (typeof qrcode === "function") {
    const opened = AshModal.open({
      className: "modal-backdrop personal-invite-qr",
      html: `
      <div class="modal-card">
        <h4>Invite link</h4>
        <p class="cat-hint">${esc(url)}</p>
        <div id="personal-invite-qr-host" class="event-pass-qr-host" style="display:flex;justify-content:center;margin:12px 0"></div>
        <div class="actions">
          <button type="button" class="cancel" id="personal-invite-qr-close">Close</button>
          <button type="button" class="save" id="personal-invite-qr-copy">Copy</button>
          <button type="button" class="save" id="personal-invite-qr-share">Share</button>
        </div>
      </div>`,
      singleton: "return",
    });
    if (opened) {
      const { overlay, close } = opened;
      mountInviteQr(overlay.querySelector("#personal-invite-qr-host"), url);
      overlay.querySelector("#personal-invite-qr-close").onclick = close;
      overlay.querySelector("#personal-invite-qr-copy").onclick = async () => {
        await sharePlainText(url, { copiedToast: "Invite link copied", fallbackToast: url });
      };
      overlay.querySelector("#personal-invite-qr-share").onclick = async () => {
        await sharePlainText(serverInviteShareText(conn), {
          copiedToast: "Invite link copied",
          fallbackToast: url,
        });
      };
      return;
    }
  }
  await sharePlainText(serverInviteShareText(conn), {
    copiedToast: "Invite link copied",
    fallbackToast: url,
  });
}

/** Host/admin: open the system share sheet with the current join invite. */
async function shareServerInvite(conn = activeConn()) {
  return sharePersonalInviteLink(conn);
}

function formatShareCode(sid, code, route = null) {
  const rot = String(code || "").trim().toUpperCase().replace(/-/g, "");
  const host = String(route?.host || route?.hostname || route || "").trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (host) return rot ? `${rot}@${host}` : host;
  return rot;
}

const JOIN_CODE_ALPHA = /[^A-Z0-9]/gi;

function normJoinAlpha(s) {
  return String(s || "").toUpperCase().replace(JOIN_CODE_ALPHA, "");
}

/** Sections → canonical join string (case-normalized).
 *  Public: invite → `XXXXXX@host`. Local / same Wi‑Fi: bare invite (Nearby picks the host). */
function composeJoinCode({ tag, invite, host }) {
  const inv = normJoinAlpha(invite);
  const h = String(host || "").trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (h) return inv ? `${inv}@${h}` : "";
  return inv || "";
}

