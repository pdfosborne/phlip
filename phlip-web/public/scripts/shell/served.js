/* Host-served browser shell (Public / LAN URL from a phone host).
 *
 * Not the Android/iOS WebView. Detection is also set early in theme-boot.js
 * (data-served-host) for CSS before paint. Boot (initConns) stays in wireboot.js.
 * ========================================================================== */

// True when this page is served by a host phone, not the app WebView.
// Opening a public link alone must NOT look like membership.
// /demo/ is an explicit local-browser mode — never the join gate.
function isServedOrigin() {
  try {
    if (typeof isDemoMode === "function" && isDemoMode()) return false;
    if (document.documentElement?.dataset?.demoMode === "1") return false;
  } catch {}
  try {
    if (document.documentElement?.dataset?.servedHost === "1") return true;
    if (document.documentElement?.classList?.contains("served-host")) return true;
  } catch {}
  return location.hostname !== "appassets.androidplatform.net" && location.protocol !== "file:";
}

/** Keep html flags in sync so CSS (hand dock, chrome) can't miss browser mode. */
function markServedHostChrome() {
  if (!isServedOrigin()) return;
  try {
    document.documentElement.dataset.servedHost = "1";
    document.documentElement.classList.add("served-host");
  } catch {}
}

/** Public / LAN browser: hide the app until this host has welcomed the user. */
function setServedGate(locked) {
  if (!isServedOrigin()) return;
  const app = document.getElementById("app");
  if (!app) return;
  if (locked) {
    app.classList.remove("on");
    app.setAttribute("aria-hidden", "true");
  } else {
    app.classList.add("on");
    app.removeAttribute("aria-hidden");
  }
}

function openServedJoinGate(prefill = "") {
  if (!isServedOrigin()) return;
  setServedGate(true);
  // Local opens Sign in / Sign up. Bare Public opens returning-member Sign in;
  // a pending personal invite still carries the new-member Agree context.
  const publicReturn = location.protocol !== "http:" &&
    (typeof loadBrowserRulesAccepted === "function" && loadBrowserRulesAccepted());
  if (S.pendingInviteLink) {
    const link = S.pendingInviteLink;
    S.pendingInviteLink = null;
    if (publicReturn || location.protocol === "http:") {
      const parsed = typeof parseInviteLink === "function" ? parseInviteLink(link) : null;
      openJoinModal({
        name: loadBrowserMemberName(),
        invite: parsed?.token || parsed?.invite || "",
        token: parsed?.token || "",
        ...(parsed?.invite || parsed?.token ? { code: parsed.token || parsed.invite } : {}),
        url: parsed?.base || link,
      });
    } else {
      // Invite link already carries the join code → skip straight to agree/login.
      openJoinModal(link);
    }
  } else if (prefill && typeof prefill === "object") {
    openJoinModal({ ...prefill, name: prefill.name || loadBrowserMemberName() });
  } else if (prefill) {
    openJoinModal(prefill);
  } else {
    openJoinModal({ name: loadBrowserMemberName() });
  }
}

/** After a kick / session end, lock the app and reopen the join gate. */
function promptServedRejoin(conn, error) {
  if (!isServedOrigin()) return;
  if (document.querySelector(".modal-backdrop")) return;
  const name = conn?.me?.name || conn?._lastName || loadBrowserMemberName() || "";
  if (name) {
    try { sessionStorage.setItem("ash_rejoin_name", name); } catch {}
    saveBrowserMemberName(name);
  }
  // Never autofill the member password (and never put the group secret in that field).
  try { sessionStorage.removeItem("ash_rejoin_pass"); } catch {}
  const onLocal = location.protocol === "http:";
  toast(error || (onLocal
    ? "Session ended — Sign in, or Sign up if you’re new."
    : "Session ended — sign in with your name and password."));
  openServedJoinGate({ name });
}

/** Open one complete joinable invite URL in the app. */
function openPhlipJoinDeepLink(inviteUrl) {
  const url = String(inviteUrl || "").trim();
  if (!url) return;
  const encoded = encodeURIComponent(url);
  const slug = typeof extractInviteSlug === "function"
    ? extractInviteSlug(url)
    : "";
  const slugPart = slug ? `&slug=${encodeURIComponent(slug)}` : "";
  const fallback = encoded;
  const deep = `phlip://join?url=${encoded}${slugPart}`;
  const ua = String(navigator.userAgent || "");
  const isAndroid = /Android/i.test(ua);
  try {
    if (isAndroid) {
      // Opens Phlip if installed; Chrome handles this more reliably than phlip:// alone.
      location.href =
        `intent://join?url=${encoded}${slugPart}#Intent;scheme=phlip;package=com.phlip;S.browser_fallback_url=${fallback};end`;
      return;
    }
    location.href = deep;
  } catch {
    try { location.href = deep; } catch {}
  }
}

function removeOpenInPhlipBanner() {
  document.getElementById("phlip-open-in-app")?.remove();
}

function completeOpenInPhlipTarget(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value, location.origin);
    if (!/^https?:$/i.test(parsed.protocol)) return "";
    const slug = typeof extractInviteSlug === "function" ? extractInviteSlug(parsed.href) : "";
    // Public HTTPS must always carry the complete personal /j/<slug> invite.
    // Local/Direct HTTP uses its full server URL as the join target.
    if (parsed.protocol === "https:" && !slug) return "";
    return slug
      ? `${parsed.origin}/j/${encodeURIComponent(slug)}`
      : parsed.href.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/**
 * Served browser page: show only when we have a complete invite target.
 * Anonymous bare Public roots intentionally remain banner-free.
 */
function offerOpenInPhlipBanner(inviteUrl = "") {
  if (!isServedOrigin() || window.AshNative) {
    removeOpenInPhlipBanner();
    return;
  }
  try {
    if (new URLSearchParams(location.search || "").has("s")) {
      removeOpenInPhlipBanner();
      return;
    }
  } catch {}
  const host = String(location.hostname || "");
  const softAp = host.startsWith("192.168.43.")
    || host.startsWith("192.168.49.")
    || host.startsWith("192.168.75.")
    || host.startsWith("192.168.137.");
  const publicHttps = location.protocol === "https:";
  if (!softAp && !publicHttps) {
    removeOpenInPhlipBanner();
    return;
  }
  let joinUrl = completeOpenInPhlipTarget(inviteUrl);
  if (!joinUrl) {
    const pageSlug = typeof extractInviteSlug === "function"
      ? extractInviteSlug(location.href)
      : "";
    if (pageSlug) joinUrl = completeOpenInPhlipTarget(`${location.origin}/j/${encodeURIComponent(pageSlug)}`);
  }
  if (!joinUrl) {
    removeOpenInPhlipBanner();
    return;
  }
  const existing = document.getElementById("phlip-open-in-app");
  if (existing) {
    existing.dataset.inviteUrl = joinUrl;
    return;
  }
  const bar = document.createElement("div");
  bar.id = "phlip-open-in-app";
  bar.className = "phlip-open-in-app";
  bar.dataset.inviteUrl = joinUrl;
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "Open this server in the Phlip app");
  bar.innerHTML = `<span class="phlip-open-in-app-copy">Have Phlip installed?</span>
    <button type="button" class="phlip-open-in-app-link">Open in Phlip</button>
    <button type="button" class="phlip-open-in-app-dismiss" aria-label="Dismiss">×</button>`;
  const mount = () => {
    if (document.getElementById("phlip-open-in-app")) return;
    (document.body || document.documentElement).prepend(bar);
    bar.querySelector(".phlip-open-in-app-link")?.addEventListener("click", (e) => {
      e.preventDefault();
      openPhlipJoinDeepLink(bar.dataset.inviteUrl || "");
    });
    bar.querySelector(".phlip-open-in-app-dismiss")?.addEventListener("click", () => bar.remove());
  };
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
}

async function offerAuthenticatedOpenInPhlipBanner(conn) {
  if (!conn?.token || !conn?.me) return;
  let inviteUrl = "";
  try {
    if (typeof personalInviteUrl === "function") inviteUrl = personalInviteUrl(conn);
    if (!inviteUrl && typeof ensurePersonalInviteUrl === "function") {
      inviteUrl = await ensurePersonalInviteUrl(conn);
    }
  } catch {}
  offerOpenInPhlipBanner(inviteUrl);
}

try {
  document.addEventListener("ash:welcome", (e) => {
    if (!isServedOrigin()) return;
    const id = e.detail?.connId;
    const conn = id && typeof S !== "undefined" ? S.conns?.[id] : null;
    if (conn) void offerAuthenticatedOpenInPhlipBanner(conn);
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { try { offerOpenInPhlipBanner(); } catch {} });
  } else {
    offerOpenInPhlipBanner();
  }
} catch {}
