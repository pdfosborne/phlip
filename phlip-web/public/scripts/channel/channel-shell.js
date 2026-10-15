/* channel-shell.js — footer, nav shell, header titles, mode tabs.
 * Globals out: renderFoot, openNav, closeNav, headerTitle, showEventsModeTabs, …
 * Load after: channel-moderation.js; before: channel-view.js
 */

function hostDeviceLabel(conn = activeConn()) {
  if (!conn || PersonalSpace.isPersonal(conn)) return "this device";
  const host = (conn.members || []).find(u => u?.isHost || effectiveRole(u) === ROLE_HOST);
  const meIsHost = !!(conn.me && (
    conn.me.isHost
    || (typeof effectiveRole === "function" && effectiveRole(conn.me) === ROLE_HOST)
    || (host && host.id && conn.me.id === host.id)
  ));
  // On the host phone, prefer User settings profile name over a stale mint name ("Host").
  let name = "";
  if (meIsHost) {
    try { name = String(typeof loadMe === "function" ? loadMe()?.name : "").trim(); } catch {}
    if (!name) name = String(conn.me?.name || "").trim();
  }
  if (!name) name = String(host?.name || "").trim();
  if (!name) return "an Android device";
  return `${name}'s Android device`;
}

function renderFoot() {
  // Host-foot chrome removed; callers still invoke this after presence updates.
}


function openNav() {
  closeChannelPanel();
  const app = document.getElementById("app");
  app.classList.add("nav-open");
  app.scrollLeft = 0;
  app.classList.remove("nav-sheet-dragging");
  document.querySelector(".main")?.style.removeProperty("--nav-sheet-x");
  // Swipe/pointerup is followed by a synthetic click on the timeline — ignore
  // that click so it doesn't instantly dismiss the nav we just opened.
  suppressNavDismissUntil = performance.now() + 450;
  try { _sidebarPtrIds.clear(); } catch {}
  // Drop keyboard / focus so inputs don't linger on the sliding sheet.
  const ae = document.activeElement;
  if (ae && ae.closest?.("#view > .composer")) try { ae.blur(); } catch {}
  try { window.OnboardingBus?.emit?.("sidebar:open", {}); } catch {}
}

function closeNav() {
  closeSideOverlay();
  const app = document.getElementById("app");
  app.classList.remove("nav-open");
  app.scrollLeft = 0;
  app.classList.remove("nav-sheet-dragging");
  document.querySelector(".main")?.style.removeProperty("--nav-sheet-x");
  try { window.OnboardingBus?.emit?.("sidebar:close", {}); } catch {}
  // Callers in the same turn (e.g. openSideDestination) may renderView next —
  // flush on microtask so they win; otherwise apply any deferred board paint.
  queueMicrotask(() => {
    if (Panel.navOpen()) return;
    try { flushDeferredSidebarRender?.(); } catch {}
    flushDeferredViewRender();
  });
}

/** Clear nav-open / sheet-drag when crossing to the wide (persistent nav) breakpoint. */
function wireShellBreakpoint() {
  if (wireShellBreakpoint._wired) return;
  wireShellBreakpoint._wired = true;
  try {
    const mq = window.matchMedia(typeof SHELL_NARROW_MQ === "string" ? SHELL_NARROW_MQ : "(max-width: 900px)");
    const onChange = () => {
      if (mq.matches) return; // still narrow
      const app = document.getElementById("app");
      app?.classList.remove("nav-open", "nav-sheet-dragging");
      document.querySelector(".main")?.style.removeProperty("--nav-sheet-x");
    };
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", onChange);
    else if (typeof mq.addListener === "function") mq.addListener(onChange);
  } catch { /* ignore */ }
}






/** Device-local calendar overlay consent control (highlight + persist). */

/**
 * Shared create/edit form for channel modal (create) and panel settings mode.
 * Mounts into [container]; wires fields and submit.
 */

/** Hosted-server name when Personal is showing a "shown in personal" board. */
function headerOriginFromLabel() {
  const presentation = typeof presentationConn === "function" ? presentationConn() : null;
  if (!presentation || (typeof PersonalSpace !== "undefined" && !PersonalSpace.isPersonal(presentation))) {
    return "";
  }
  const projected = typeof activeProjectionContext === "function" ? activeProjectionContext() : null;
  if (!projected?.projection?.sourceConnId) return "";
  const src = projected.sourceConn || projected.contentConn;
  if (!src) return "unavailable";
  if (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(src)) return "";
  return typeof connDisplayName === "function"
    ? connDisplayName(src)
    : (src.name || src.hostName || "Server");
}

function headerTitle(section) {
  const from = typeof headerOriginFromLabel === "function" ? headerOriginFromLabel() : "";
  const conn = activeConn();
  const server = PersonalSpace.isPersonal(conn) ? "Personal space" : (conn?.name || conn?.hostName || "Server");
  if (!section) return from ? `from: ${from}` : server;
  // Projected boards keep the board name; origin is "from:" in the title bar.
  if (from) return section;
  // Narrow / drawer layout: the back button already shows the server icon —
  // repeating "Mac Tennis Club · # …" forces the title wider than the head and
  // shoves wrench / history off-screen (and used to inflate the layout).
  try {
    if (typeof isNarrowShell === "function" ? isNarrowShell() : window.matchMedia("(max-width: 900px)").matches) {
      return section;
    }
  } catch { /* ignore */ }
  return `${server} · ${section}`;
}

function showPlainTitle(text, opts) {
  const title = $("#view-title");
  title.hidden = false;
  title.textContent = opts?.raw ? text : headerTitle(text);
  const manageBtn = $("#quick-manage");
  if (manageBtn) manageBtn.hidden = true;
  syncViewTitleLinkedMarks();
  syncChannelInfoBtn();
}

/** Linked-channel marks beside the channel title in the top bar (every server). */
function syncViewTitleLinkedMarks(ch) {
  const el = document.getElementById("view-link-marks");
  if (!el) return;
  const conn = typeof activeConn === "function" ? activeConn() : null;
  let channel = ch;
  if (channel === undefined) {
    channel = null;
    if (conn && S.activeView?.kind === "channel" && S.activeView.id) {
      const g = typeof group === "function" ? group() : null;
      channel = (g?.channels || []).find(c => c.id === S.activeView.id) || null;
    }
  }
  const from = typeof headerOriginFromLabel === "function" ? headerOriginFromLabel() : "";
  const fromHtml = from
    ? `<span class="view-from-origin"><span class="view-link-label">from:</span><span class="view-from-name">${esc(from)}</span></span>`
    : "";
  if (channel?.kind === "chat") {
    if (!fromHtml) {
      el.innerHTML = "";
      el.hidden = true;
      return;
    }
    el.innerHTML = fromHtml;
    el.hidden = false;
    return;
  }
  const html = (conn && channel && typeof channelLinkedServerMarksHtml === "function")
    ? channelLinkedServerMarksHtml(channel, conn, { max: 3 })
    : "";
  if (!fromHtml && !html) {
    el.innerHTML = "";
    el.hidden = true;
    return;
  }
  el.innerHTML = fromHtml
    + (html ? `<span class="view-link-label">linked to:</span>${html}` : "");
  el.hidden = false;
}

/**
 * Personal: mirrored remote chats as reply-target chips (above the composer).
 * Hosted "Mirroring" event-channel chips live on the Events panel tab instead.
 */
function chatMirroredEventsBarHTML(ch, { selectedKey = null } = {}) {
  if (!ch?.id || ch.kind !== "chat") return "";
  const conn = activeConn();
  if (!PersonalSpace.isPersonal(conn) || typeof directLinkedChatMirrorsFor !== "function") return "";
  const links = directLinkedChatMirrorsFor(ch.id);
  if (!links.length) return "";
  const chips = links.map(l => {
    const c = S.conns?.[l.connId];
    const remote = sourceChannelsFor(c).find(x => x.id === l.channelId);
    const server = connDisplayName(c);
    const name = remote?.name || "Chat";
    const key = typeof linkedFeedKey === "function"
      ? linkedFeedKey(l.connId, l.channelId)
      : `${l.connId}|${l.channelId}`;
    const label = `${server} · ${name}`;
    const on = selectedKey && selectedKey === key;
    return `<button type="button" class="chat-mirror-chip${on ? " on" : ""}" data-conn="${esc(l.connId)}" data-channel="${esc(l.channelId)}" data-mirror-key="${esc(key)}" aria-pressed="${on ? "true" : "false"}" title="Reply on ${esc(label)}">` +
      `${typeof ic === "function" ? ic("server", "ico-inline") : ""}` +
      `<span>${esc(label)}</span>` +
    `</button>`;
  }).join("");
  return `<div class="chat-mirror-bar chat-mirror-bar-composer" role="group" aria-label="Reply on mirrored chats">
    <span class="chat-mirror-bar-label">Reply on</span>
    <div class="chat-mirror-bar-chips">${chips}</div>
  </div>`;
}

/** Hosted chat: event groups that mirror chat into this channel (Events tab footer). */
function chatHostedMirroringBarHTML(ch) {
  if (!ch?.id || ch.kind !== "chat") return "";
  const conn = activeConn();
  if (PersonalSpace.isPersonal(conn)) return "";
  if (typeof eventChannelsImportingInto !== "function") return "";
  const linked = eventChannelsImportingInto(ch.id);
  if (!linked.length) return "";
  const chips = linked.map(c =>
    `<button type="button" class="chat-mirror-chip" data-channel="${esc(c.id)}" title="Open ${esc(c.name || "event group")}">` +
      `${typeof ic === "function" ? ic("ticket", "ico-inline event-outline-icon") : ""}` +
      `<span>${esc(c.name || "Event")}</span>` +
    `</button>`
  ).join("");
  return `<div class="chat-mirror-bar chat-mirror-bar-panel" role="navigation" aria-label="Mirrored event chats">
    <span class="chat-mirror-bar-label">Mirroring</span>
    <div class="chat-mirror-bar-chips">${chips}</div>
  </div>`;
}

function showEventsModeTabs(section = "All events") {
  const title = $("#view-title");
  title.hidden = false;
  title.textContent = headerTitle(section);
  syncViewTitleLinkedMarks();
  syncChannelInfoBtn();
}

let _viewRenderPending = false;
let _viewRenderKeepScroll;

function flushDeferredViewRender() {
  if (!_viewRenderPending) return;
  if (Panel.navOpen() || Panel.channelOpen()) return;
  _viewRenderPending = false;
  renderView(_viewRenderKeepScroll);
}


