/* render-sidebar.js — sidebar render, pointer freeze, destination routing.
 * Globals out: renderSidebar, channelListSig, openSideDestination,
 *   flushDeferredSidebarRender, ensureSideNavTaps, cancelArmedSideNavTap,
 *   suppressSideNavTaps, paintSidebarUserPanel
 * Load after: render-help.js; before: render-sidebar-reorder.js
 */

/** While a finger is down on the drawer, don't rebuild its DOM (destroys the
 *  control mid-tap → feels like “need two clicks”). Queue one refresh instead. */
const _sidebarPtrIds = new Set();
let _sidebarRenderQueued = false;
let _sidebarFrozenConnId = null;
/** Channel list last painted into the drawer — adds/removes and role/privacy
 *  marks must refresh even while nav is open (create group otherwise stays
 *  invisible until the user closes the drawer or triggers another force render). */
let _sidebarFrozenChannelSig = "";
let _sideNavTapSuppressedUntil = 0;
let _cancelArmedSideNav = null;

function suppressSideNavTaps(ms = 600) {
  _sideNavTapSuppressedUntil = performance.now() + ms;
}

function cancelArmedSideNavTap() {
  try { if (typeof _cancelArmedSideNav === "function") _cancelArmedSideNav(); } catch {}
}

const BOARD_OPEN_KEY = "ash_board_open_v1";
/** @type {Record<string, string>|null} */
let _boardOpenCache = null;

function loadBoardOpenMap() {
  if (_boardOpenCache) return _boardOpenCache;
  try {
    const raw = JSON.parse(localStorage.getItem(BOARD_OPEN_KEY) || "{}");
    _boardOpenCache = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    _boardOpenCache = {};
  }
  return _boardOpenCache;
}

function saveBoardOpenMap() {
  try { localStorage.setItem(BOARD_OPEN_KEY, JSON.stringify(_boardOpenCache || {})); } catch {}
}

function storedOpenBoardId(conn = (typeof presentationConn === "function" ? presentationConn() : activeConn())) {
  const connId = conn?.id || "";
  if (!connId) return "";
  const map = loadBoardOpenMap();
  if (!Object.prototype.hasOwnProperty.call(map, connId)) return null;
  return String(map[connId] || "");
}

function persistOpenBoardId(boardId, conn = (typeof presentationConn === "function" ? presentationConn() : activeConn())) {
  const connId = conn?.id || "";
  if (!connId) return;
  const map = loadBoardOpenMap();
  map[connId] = String(boardId || "");
  _boardOpenCache = map;
  saveBoardOpenMap();
}

function boardIdForActiveView(conn = (typeof presentationConn === "function" ? presentationConn() : activeConn())) {
  if (S.activeProjection?.sourceBoardId) return shownBoardShadowId(
    S.activeProjection.sourceConnId,
    S.activeProjection.sourceBoardId
  );
  if (S.activeView?.kind !== "channel") return "";
  const ch = (conn?.channels || []).find(c => c.id === S.activeView.id);
  return ch?.boardId ? String(ch.boardId) : "";
}

function resolveOpenBoardId(conn, boardIds) {
  const ids = (boardIds || []).map(id => String(id || "")).filter(Boolean);
  const viewBoard = boardIdForActiveView(conn);
  let stored = storedOpenBoardId(conn);
  if (stored == null) {
    const next = (viewBoard && ids.includes(viewBoard)) ? viewBoard : (ids[0] || "");
    persistOpenBoardId(next, conn);
    return next;
  }
  if (viewBoard && ids.includes(viewBoard) && stored && stored !== viewBoard) {
    persistOpenBoardId(viewBoard, conn);
    return viewBoard;
  }
  if (stored && !ids.includes(stored)) {
    const next = (viewBoard && ids.includes(viewBoard)) ? viewBoard : (ids[0] || "");
    persistOpenBoardId(next, conn);
    return next;
  }
  return stored;
}


function landPendingBoard() {
  const pending = typeof S !== "undefined" ? S.pendingBoardLand : null;
  if (!pending) return false;
  const conn = typeof activeConn === "function" ? activeConn() : null;
  if (!conn || (pending.connId && conn.id !== pending.connId)) return false;
  const board = pending.boardId
    ? (conn.boards || []).find(b => b.id === pending.boardId)
    : [...(conn.boards || [])].reverse().find(b =>
      !b.sourceConnId && String(b.name || "") === String(pending.name || ""));
  if (!board) return false;
  S.pendingBoardLand = null;
  persistOpenBoardId(board.id, conn);
  const ch = typeof eventChannelForBoard === "function"
    ? eventChannelForBoard(board, conn)
    : (typeof channelForBoardShownKind === "function" ? channelForBoardShownKind(board, conn) : null);
  if (!ch) return true;
  if (typeof setBoardSurface === "function" && ch.kind === "event") {
    setBoardSurface(ch.id, "conversations");
  }
  if (S.activeView?.kind === "channel" && S.activeView.id === ch.id) return true;
  if (typeof Nav !== "undefined" && typeof Nav.openChannel === "function") Nav.openChannel(ch.id);
  if (ch.kind === "event") {
    S.activeEventChannelId = ch.id;
  } else {
    S.activeEventChannelId = null;
  }
  try { closeNav(); } catch {}
  try { rememberNav(); } catch {}
  try { renderSidebar(true); } catch {}
  try { renderView(); } catch {}
  return true;
}

function sideNavTapsBlocked() {
  return !!S.sidebarReorderActive || performance.now() < _sideNavTapSuppressedUntil;
}

/** Accepted events in this agenda, including its linked sources, from today onward. */
function sidebarAcceptedEventCount(conn, channel) {
  if (!conn || !channel) return 0;
  const events = collectChannelViewEvents(channel, conn);
  const seen = new Set();
  for (const ev of events) {
    if (!ev?.id || !isMainViewEvent(ev)) continue;
    const ownerId = ev._connId || conn.id;
    const owner = ownerId === conn.id ? conn : S.conns[ownerId];
    if (!owner) continue;
    if (typeof isUnansweredInvite === "function" && isUnansweredInvite(ev, owner)) continue;
    if (!eventIsAcceptedByMe(ev, owner)) continue;
    seen.add(ownerId + ":" + ev.id);
  }
  return seen.size;
}

/** Accepted count, plus needs-RSVP in notification blue: `5+2`. */
function sidebarEventCountMeta(acceptedCount, needsRsvp) {
  const accepted = Math.max(0, Number(acceptedCount) || 0);
  const rsvp = Math.max(0, Number(needsRsvp) || 0);
  if (!accepted && !rsvp) return { total: 0, rsvp: 0, label: "", html: "" };
  const label = rsvp
    ? `${accepted} accepted · ${rsvp === 1 ? "1 needs RSVP" : `${rsvp} need RSVP`}`
    : `${accepted} ${accepted === 1 ? "event" : "events"}`;
  const rsvpHtml = rsvp
    ? `<span class="side-board-rsvp-add">+${rsvp}</span>`
    : "";
  const html = `<span class="side-board-accepted-count${rsvp ? " has-rsvp" : ""}" title="${esc(label)}" aria-label="${esc(label)}">${accepted}${rsvpHtml}</span>`;
  return { total: accepted + rsvp, rsvp, label, html };
}

/** Uncompleted tasks in a board's Tasks channel. */
function sidebarOpenTaskCount(conn, channel) {
  if (!conn || !channel) return 0;
  const id = String(channel.id || "");
  if (!id) return 0;
  return (Array.isArray(conn.tasks) ? conn.tasks : []).filter((task) =>
    String(task?.channelId || "") === id
    && task?.completed !== true
    && task?.done !== true
  ).length;
}

function channelListSig(conn = (typeof presentationConn === "function" ? presentationConn() : activeConn())) {
  return (conn?.channels || []).map(c => {
    const viewKeys = (c.rolePerms && typeof c.rolePerms === "object")
      ? Object.keys(c.rolePerms).filter(k => c.rolePerms[k]?.view).sort().join(",")
      : "";
    const priv = Array.isArray(c.allowedUserIds) && !c.autoIncludeNewMembers ? "p" : "";
    const pinOn = c.pinnedUserId != null
      && typeof memberIsOnline === "function"
      && memberIsOnline(c.pinnedUserId)
      ? "1" : "0";
    const agendaIds = (c.kind === "chat" && typeof agendasLinkedToChat === "function")
      ? agendasLinkedToChat(c, conn).map(a => a.id).join(",")
      : "";
    const seen = (typeof channelVisibleTo === "function" && conn?.me)
      ? (channelVisibleTo(c, conn.me, conn) ? "1" : "0")
      : "1";
    const accepted = c.kind === "event" ? sidebarAcceptedEventCount(conn, c) : 0;
    const unread = channelUnreadCount(conn, c, conn.events);
    const openTasks = c.kind === "task" ? sidebarOpenTaskCount(conn, c) : 0;
    return `${c.id}:${c.kind || ""}:${priv}:${viewKeys}:${pinOn}:${c.linkedChatChannelId || ""}:${c.boardId || ""}:${agendaIds}:${seen}:${accepted}:${unread}:${openTasks}:${typeof channelSidebarLinkKinds === "function" ? channelSidebarLinkKinds(c, conn).join(",") : ""}`;
  }).join("\0") + "\0b:" + (conn?.boards || []).map(b => `${b.id}:${b.name || ""}:${b.sourceConnId || ""}:${b.sourceBoardId || ""}:${Array.isArray(b.hiddenKinds) ? b.hiddenKinds.join(".") : ""}:${b.shownKind || ""}`).join(",")
    + "\0s:" + (typeof loadShownBoards === "function" ? loadShownBoards().map(p => `${p.connId}:${p.boardId}`).join(",") : "");
}

function noteSidebarPointer(e, down) {
  if (down) _sidebarPtrIds.add(e.pointerId);
  else _sidebarPtrIds.delete(e.pointerId);
  if (!down && _sidebarPtrIds.size === 0 && _sidebarRenderQueued) {
    _sidebarRenderQueued = false;
    // Only flush if drawer closed or server changed — while open we stay frozen.
    const navOpen = Panel.navOpen();
    if (!navOpen || S.activeConnId !== _sidebarFrozenConnId) renderSidebar();
  }
}

function flushDeferredSidebarRender() {
  if (!_sidebarRenderQueued || _sidebarPtrIds.size > 0) return;
  _sidebarRenderQueued = false;
  renderSidebar(true);
}

/**
 * Activate sidebar rows on pointerup (not click). Click is unreliable inside a
 * pan-y scroller on Android WebView. Rebinds on each call so handler updates
 * land after asset bumps.
 *
 * Opening a modal on pointerup must swallow the synthetic click that follows —
 * otherwise that click hits the new backdrop and instantly dismisses the modal.
 */
function ensureSideNavTaps() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;

  // Drop prior listeners (dataset alone leaves stale closures after hot reloads).
  if (typeof sidebar._ashSideNavOff === "function") {
    try { sidebar._ashSideNavOff(); } catch {}
  }

  let sx = 0, sy = 0, armed = null, lastActAt = 0;

  const swallowGhostClick = () => {
    const until = performance.now() + 600;
    const swallow = (e) => {
      if (performance.now() > until) {
        document.removeEventListener("click", swallow, true);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      document.removeEventListener("click", swallow, true);
    };
    document.addEventListener("click", swallow, true);
  };

  const run = (fn, { fromPointer } = {}) => {
    if (typeof fn !== "function") return;
    const now = performance.now();
    if (now - lastActAt < 450) return;
    lastActAt = now;
    if (fromPointer) swallowGhostClick();
    try { fn(); } catch (err) {
      console.error(err);
      try { toast(err?.message || "Something went wrong"); } catch {}
    }
  };

  const resolveAction = (target) => {
    if (!target || !sidebar.contains(target)) return null;
    if (target.closest("#side-overlay") && !target.closest(".side-overlay-back")) return null;
    const keyed = target.closest("[data-side-key]");
    if (keyed?.dataset.sideKey) {
      const key = keyed.dataset.sideKey;
      if (key === "help-legal") {
        return () => { if (typeof openPhlipHelpLegalMenu === "function") openPhlipHelpLegalMenu(); };
      }
      if (key === "board-open" || key.startsWith("board-toggle:") || key.startsWith("board-open:")) {
        return () => openSidebarBoard(keyed);
      }
      return () => openSideDestination(key);
    }
    if (target.closest("#side-share-btn")) return () => {
      if (typeof sharePersonalInviteLink === "function") sharePersonalInviteLink(activeConn());
    };
    if (target.closest("#side-device-chip")) return () => {
      const c = activeConn();
      if (c?.drive) {
        if (typeof shareDriveFolder === "function") shareDriveFolder(c);
        return;
      }
      if (!c || typeof openHostingGuide !== "function") return;
      const rawId = String(c.id || "").replace(/^srv-local-/, "");
      const s = readHostStatus()?.servers?.find(s => String(s.id) === rawId);
      if (s && (s.isPublic || s.reachMode !== "device")) openHostedServerSettings(rawId);
      else openHostingGuide(rawId);
    };
    if (target.closest("#side-user-menu-btn")) {
      return () => {
        if (typeof openUserProfileOverlay === "function") openUserProfileOverlay();
      };
    }
    if (target.closest("#side-server-menu-btn")) {
      return () => {
        if (typeof openServerMenuSheet === "function") {
          openServerMenuSheet(typeof presentationConn === "function" ? presentationConn() : activeConn());
        }
      };
    }
    const settingsDirect = target.closest(".side-settings-direct");
    if (settingsDirect) {
      const which = settingsDirect.dataset.sideSettings;
      if (which === "leave") {
        return () => {
          const c = activeConn();
          if (c) confirmRemoveServer(c.id);
        };
      }
    }
    const addCh = target.closest(".side-add-ch");
    if (addCh) {
      const kind = addCh.dataset.channelKind;
      if (kind === "pinned") return () => openPinLocationPicker();
      if (kind === "pinned-people") return () => openPinPersonPicker();
      if (kind === "board") return () => {
        if (typeof openBoardModal === "function") openBoardModal();
        else if (typeof openChannelModal === "function") openChannelModal(null, "event");
      };
      return () => openChannelModal(null, kind === "event" ? "event" : "chat");
    }
    return null;
  };

  _cancelArmedSideNav = () => { armed = null; };

  const onDown = (e) => {
    if (sideNavTapsBlocked()) { armed = null; return; }
    if (e.pointerType === "mouse" && e.button !== 0) { armed = null; return; }
    const action = resolveAction(e.target);
    if (!action) { armed = null; return; }
    sx = e.clientX; sy = e.clientY;
    armed = action;
  };
  const onUp = (e) => {
    const action = armed;
    armed = null;
    if (sideNavTapsBlocked()) return;
    if (!action) return;
    const dx = Math.abs(e.clientX - sx);
    const dy = Math.abs(e.clientY - sy);
    // Vertical scroll in the drawer — not a tap.
    if (dy > 22 && dy > dx * 1.4) return;
    if (Math.hypot(dx, dy) > 32) return;
    run(action, { fromPointer: true });
  };
  const onCancel = () => { armed = null; };
  // Bubble click backup when pointerup was lost (some WebViews).
  const onClick = (e) => {
    if (sideNavTapsBlocked()) return;
    const action = resolveAction(e.target);
    if (!action) return;
    run(action);
  };

  sidebar.addEventListener("pointerdown", onDown, true);
  sidebar.addEventListener("pointerup", onUp, true);
  sidebar.addEventListener("pointercancel", onCancel, true);
  sidebar.addEventListener("click", onClick, false);
  sidebar.dataset.sideNavTaps = "1";
  sidebar._ashSideNavOff = () => {
    sidebar.removeEventListener("pointerdown", onDown, true);
    sidebar.removeEventListener("pointerup", onUp, true);
    sidebar.removeEventListener("pointercancel", onCancel, true);
    sidebar.removeEventListener("click", onClick, false);
    delete sidebar.dataset.sideNavTaps;
    delete sidebar._ashSideNavOff;
    _cancelArmedSideNav = null;
  };
  try { if (typeof ensureSidebarChannelReorder === "function") ensureSidebarChannelReorder(); } catch {}
}

/** Reach line in the sidebar head: uptime dot + type (PAT-servers). */
function hostedSidebarReach(conn) {
  if (conn?.drive) return { type: "Drive" };
  if (conn?.hostPublic === true) return { type: "Public" };
  return { type: "On this device" };
}

function renderSidebar(force = false) {
  if (S.sidebarReorderActive) {
    _sidebarRenderQueued = true;
    return;
  }
  if (S.sidebarReorderMode && !force) {
    _sidebarRenderQueued = true;
    return;
  }
  const shellConn = typeof presentationConn === "function" ? presentationConn() : activeConn();
  if (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(shellConn)
      && typeof syncShownBoardsToPersonal === "function") {
    syncShownBoardsToPersonal();
  }
  const navOpen = Panel.navOpen();
  const chSig = channelListSig();
  const channelsChanged = chSig !== _sidebarFrozenChannelSig;
  // While the drawer is open, skip full rebuilds (sync storms wipe buttons mid-tap).
  // Still rebuild when the active server changes, channel list changes (create/
  // delete), or caller forces it.
  if (!force && !channelsChanged && navOpen && S.activeConnId === _sidebarFrozenConnId) {
    _sidebarRenderQueued = true;
    return;
  }
  if (!force && !channelsChanged && _sidebarPtrIds.size > 0) {
    _sidebarRenderQueued = true;
    return;
  }
  _sidebarFrozenConnId = S.activeConnId;
  _sidebarFrozenChannelSig = chSig;
  _sidebarRenderQueued = false;

  const conn = shellConn;
  if (!conn) return;
  const g = { channels: conn.channels || [], events: conn.events || [] };
  if (Panel.sideOpen() && (!conn || PersonalSpace.isPersonal(conn))) {
    const kind = typeof Panel.sideKind === "function" ? Panel.sideKind() : (typeof sideOverlayKind !== "undefined" ? sideOverlayKind : null);
    // Places stays open so pin / unpin can repaint the row in place.
    if (kind !== "userSettings" && kind !== "places") closeSideOverlay();
  }
  const titleEl = $("#group-name");
  if (titleEl) {
    titleEl.textContent = PersonalSpace.isPersonal(conn) ? "Personal space" : (conn.name || conn.hostName || "Server");
  }
  syncDocumentTitle();

  const head = document.querySelector(".sidebar-head");
  const menuBtn = document.getElementById("side-server-menu-btn");
  const canOpenServerMenu = !!conn;
  if (menuBtn) {
    menuBtn.disabled = !canOpenServerMenu;
    menuBtn.setAttribute("aria-haspopup", canOpenServerMenu ? "dialog" : "false");
    const serverSheetOpen = !!document.querySelector(".server-menu-overlay");
    menuBtn.setAttribute("aria-expanded", canOpenServerMenu && serverSheetOpen ? "true" : "false");
    menuBtn.title = canOpenServerMenu
      ? (PersonalSpace.isPersonal(conn) ? "Open Personal space settings" : `Open ${conn.name || conn.hostName || "server"} settings`)
      : (titleEl?.textContent || "");
    menuBtn.setAttribute("aria-label", menuBtn.title);
    const chevron = menuBtn.querySelector(".side-server-menu-chevron");
    if (chevron) {
      chevron.hidden = !canOpenServerMenu;
      chevron.innerHTML = canOpenServerMenu ? ic("chevron-right") : "";
    }
  }

  document.getElementById("side-server-icon")?.remove();

  let deviceChip = document.getElementById("side-device-chip");
  const hostRow = document.getElementById("sidebar-head-host-row") || head;
  const showDeviceChip = (typeof isHostedBridgeConn === "function" && isHostedBridgeConn(conn))
    || !!(conn && conn.drive);
  if (head && showDeviceChip) {
    if (!deviceChip) {
      deviceChip = document.createElement("button");
      deviceChip.type = "button";
      deviceChip.id = "side-device-chip";
      hostRow.insertBefore(deviceChip, hostRow.firstChild);
    } else if (deviceChip.parentNode !== hostRow) {
      hostRow.insertBefore(deviceChip, hostRow.firstChild);
    }
    const reach = hostedSidebarReach(conn);
    const displayStatus = typeof hostedBridgeDisplayStatus === "function"
      ? hostedBridgeDisplayStatus(conn)
      : (conn.status || "offline");
    const feel = typeof connFeelState === "function"
      ? connFeelState(conn)
      : { state: displayStatus === "online" ? "connected" : "unreachable", label: "", tone: "unknown" };
    const status = String(displayStatus || "offline").replace(/[^a-z-]/g, "") || "offline";
    const feelState = String(feel.state || "").replace(/[^a-z-]/g, "");
    deviceChip.className = "side-host-reach"
      + (feel.state === "connected" ? " is-feel-connected" : "")
      + (feel.state === "reaching" ? " is-feel-reaching" : "")
      + (feel.state === "unreachable" ? " is-feel-unreachable" : "")
      + (feel.tone === "aging" ? " is-feel-aging" : "")
      + (feel.tone === "stale" ? " is-feel-stale" : "");
    deviceChip.hidden = false;
    const live = status === "online" || feel.state === "connected";
    const hostState = feel.state === "reaching" ? "Syncing" : (live ? "Live" : "Paused");
    const medium = reach.type === "Drive" ? "Drive"
      : reach.type === "Public" || reach.type === "Internet" ? "Internet"
      : "Device only";
    const deviceOnly = medium === "Device only";
    const isDrive = medium === "Drive";
    const hostCopy = deviceOnly ? "Device only · Set up sharing" : `${medium} · ${hostState}`;
    deviceChip.innerHTML = `${ic("server", "ico-inline side-host-reach-icon")}` +
      `<span class="side-host-reach-label">${deviceOnly ? "Device only" : (isDrive ? "Drive" : "Sharing")}</span>` +
      `<span class="side-host-reach-status">${deviceOnly ? "Set up sharing" : `<span class="rail-dot ${status}${feelState ? ` feel-${feelState}` : ""}"></span>${esc(hostCopy)}`}</span>` +
      `${ic("chevron-right", "ico-inline side-host-reach-chevron")}`;
    const feelLabel = feel.label || (feel.state === "reaching" ? "Syncing…" : "");
    deviceChip.title = deviceOnly ? "Device only — set up sharing"
      : isDrive ? "Shared through Google Drive"
      : [hostCopy, feelLabel, "Sharing settings"].filter(Boolean).join(" — ");
    deviceChip.setAttribute("aria-label", deviceOnly ? "Device only. Set up sharing"
      : isDrive ? "Drive. Share the board folder"
      : `${hostCopy} sharing settings`);
    deviceChip.onclick = null; // ensureSideNavTaps
  } else if (deviceChip) {
    deviceChip.hidden = true;
  }

  // Invite — same row as the hosting chip. Only when a share path is actually live.
  let shareBtn = document.getElementById("side-share-btn");
  const canInvite = !PersonalSpace.isPersonal(conn)
    && (canManageServer(conn) || (typeof canInviteToGroup === "function" && canInviteToGroup(conn)));
  const canShare = canInvite
    && (typeof connInviteShareReady !== "function" || connInviteShareReady(conn));
  if (head && canShare) {
    if (!shareBtn) {
      shareBtn = document.createElement("button");
      shareBtn.type = "button";
      shareBtn.id = "side-share-btn";
      shareBtn.className = "side-share-btn";
      hostRow.appendChild(shareBtn);
    } else if (shareBtn.parentNode !== hostRow) {
      hostRow.appendChild(shareBtn);
    }
    shareBtn.hidden = false;
    shareBtn.innerHTML = `${ic("share")}<span class="side-share-label">Invite</span>`;
    shareBtn.title = "Invite";
    shareBtn.setAttribute("aria-label", "Invite");
    shareBtn.onclick = null; // ensureSideNavTaps
  } else if (shareBtn) {
    shareBtn.hidden = true;
  }
  if (hostRow && hostRow !== head) hostRow.hidden = !(showDeviceChip || canShare);

  let connectionStatus = document.getElementById("side-connection-status");
  if (head) {
    if (!connectionStatus) {
      connectionStatus = document.createElement("p");
      connectionStatus.id = "side-connection-status";
      connectionStatus.className = "side-connection-status";
      const menuBtnEl = document.getElementById("side-server-menu-btn");
      if (menuBtnEl?.parentNode === head) menuBtnEl.after(connectionStatus);
      else head.appendChild(connectionStatus);
    }
    if (PersonalSpace.isPersonal(conn)) {
      connectionStatus.textContent = "This device";
      connectionStatus.hidden = false;
    } else {
      const displayStatus = typeof hostedBridgeDisplayStatus === "function" ? hostedBridgeDisplayStatus(conn) : conn.status;
      const feel = typeof connFeelState === "function" ? connFeelState(conn) : {};
      const statusLabel = railDotStatusLabel(conn, displayStatus, feel);
      const memberN = (conn.members || []).length;
      const memberBit = `${memberN} ${memberN === 1 ? "Member" : "Members"}`;
      connectionStatus.textContent = [statusLabel, feel.label, memberBit].filter(Boolean).join(" · ");
      connectionStatus.hidden = false;
    }
  }

  const list = $("#side-list");
  const scrollTop = list.scrollTop;
  list.innerHTML = "";

  const painted = typeof viewIsPainted !== "function" || viewIsPainted();

  const showMeta = typeof showSocialMetaChannels === "function" ? showSocialMetaChannels(conn) : true;

  if (showMeta) {
    // No guest microsite broadcast list in v1.

  }

  const canManageChannels = canManageServer(conn);
  const me = conn.me;
  const channelShownToMe = (c) => {
    if (!c) return false;
    if (typeof PersonalSpace !== "undefined" && PersonalSpace.isHiddenChannel(c, conn)) return false;
    if (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn)) return true;
    if (typeof channelVisibleTo !== "function") return true;
    return channelVisibleTo(c, me, conn);
  };
  const welcomeChannels = (g.channels || []).filter(c =>
    c.kind !== "event" && typeof isWelcomeLobby === "function" && isWelcomeLobby(c) && channelShownToMe(c));
  const allBoards = (typeof boardsOf === "function" ? boardsOf(conn) : (conn.boards || [])).filter(board => {
    const ev = typeof eventChannelForBoard === "function" ? eventChannelForBoard(board, conn) : null;
    const chat = typeof chatChannelForBoard === "function" ? chatChannelForBoard(board, conn) : null;
    const task = typeof taskChannelForBoard === "function" ? taskChannelForBoard(board, conn) : null;
    return (ev && channelShownToMe(ev)) || (chat && channelShownToMe(chat)) || (task && channelShownToMe(task));
  });
  const boardList = allBoards.filter(b => !b.sourceConnId);
  const shownBoardList = PersonalSpace.isPersonal(conn)
    ? loadShownBoards().map(ref => resolveShownBoardProjection(ref)).filter(Boolean)
    : [];
  // Pinned people stay parked (helpers-part1.js). Location pins are a read-only timeline.
  const locationsParked = (typeof featureParked === "function" && featureParked("pinnedLocations"));
  const peopleParked = (typeof featureParked === "function" && featureParked("pinnedPeople"));
  const pinnedChannels = locationsParked ? [] : (g.channels || []).filter(c =>
    c.kind === "event" && c.pinnedLocationLabel != null && channelShownToMe(c));
  const pinnedPeopleChannels = PersonalSpace.isPersonal(conn) || peopleParked
    ? []
    : (g.channels || []).filter(c =>
      c.kind === "event" && c.pinnedUserId != null && channelShownToMe(c));
  const allowPinnedPeople = !PersonalSpace.isPersonal(conn) && !!serverSettings(conn).allowPinnedPeople;

  const paintSideChannelRow = (ch, preferredKind, opts = {}) => {
    const row = document.createElement("div");
    row.className = "side-row" + (opts.child ? " is-board-child" : "");
    row.dataset.sideSection = preferredKind;
    row.dataset.channelId = ch.id;
    if (opts.boardId) row.dataset.boardId = opts.boardId;
    const b = document.createElement("button");
    b.type = "button";
    const viewOnThisConn = opts.projection
      ? S.activeProjection?.sourceConnId === opts.projection.sourceConnId
      : S.activeView?.kind !== "channel"
      || (conn.channels || []).some(c => c.id === S.activeView.id);
    const isActive = painted && viewOnThisConn
      && S.activeView?.kind === "channel" && S.activeView.id === ch.id;
    b.className = "side-item" + (isActive ? " active" : "");
    if (isActive) b.setAttribute("aria-current", "page");
    b.dataset.sideKey = opts.projection
      ? `projected-ch:${encodeURIComponent(opts.projection.sourceConnId)}:${encodeURIComponent(opts.projection.sourceBoardId)}:${encodeURIComponent(ch.id)}`
      : "ch:" + ch.id;
    b.dataset.channelKind = ch.kind || preferredKind;
    if (ch.name) b.dataset.channelName = ch.name;
    const pinnedUid = ch.pinnedUserId;
    const staffMeta = typeof channelStaffMarkMeta === "function"
      ? channelStaffMarkMeta(ch, conn)
      : null;
    if (staffMeta) {
      b.classList.add("is-staff");
      b.style.setProperty("--role-color", staffMeta.color);
    }
    const unreadHome = opts.unreadConn || conn;
    const unreadCh = opts.unreadChannel || ch;
    const unreadEvents = opts.unreadEvents || (unreadHome === conn ? g.events : unreadHome.events);
    const unread = channelUnreadCount(unreadHome, unreadCh, unreadEvents);
    const visSrc = typeof visibilitySourceForChannel === "function" ? visibilitySourceForChannel(ch, conn) : ch;
    const isPrivate = Array.isArray(visSrc?.allowedUserIds) && !visSrc.autoIncludeNewMembers;
    const showLock = isPrivate && !opts.child;
    const lockHtml = showLock
      ? `<span class="side-ch-lock" title="Private — manual add only" aria-label="Private">${typeof ic === "function" ? ic("lock") : ""}</span>`
      : "";

    const channelKind = ch.kind || preferredKind;
    const isWelcome = preferredKind === "welcome"
      || (typeof isWelcomeLobby === "function" && isWelcomeLobby(ch));
    const iconInner = isWelcome
      ? (typeof ic === "function" ? ic("user-round-plus", "ico-inline") : "")
      : (channelKind === "event"
        ? (typeof ic === "function" ? ic("ticket", "ico-inline") : "")
        : (channelKind === "task"
          ? (typeof ic === "function" ? ic("square-check", "ico-inline") : "✓")
          : `<span class="hash">#</span>`));
    let icon = `<span class="side-ch-icon" aria-hidden="true">${iconInner}</span>`;
    const badges = [];
    if (pinnedUid != null && typeof avatarStyle === "function") {
      const member = typeof memberRecord === "function" ? memberRecord(pinnedUid) : null;
      const name = member?.name || ch.name || "?";
      const on = typeof memberIsOnline === "function" && memberIsOnline(pinnedUid);
      const face = typeof avatarFaceHtml === "function" ? avatarFaceHtml(pinnedUid, name) : "";
      badges.push(`<span class="side-ch-badge side-pinned-person-avatar${on ? " is-online" : " is-offline"}" style="${avatarStyle(pinnedUid)}" title="${esc(name)}" aria-label="Pinned person">${face}</span>`);
    }
    if (ch.pinnedLocationLabel != null && typeof ic === "function") {
      badges.push(`<span class="side-ch-badge" title="${esc(ch.pinnedLocationLabel)}" aria-label="${esc("Pinned location: " + ch.pinnedLocationLabel)}">${ic("pin", "ico-inline")}</span>`);
    }
    if (staffMeta && !opts.child && typeof ic === "function") {
      badges.push(`<span class="side-ch-badge is-staff" style="--role-color:${esc(staffMeta.color)}" title="${esc(staffMeta.label)}" aria-label="${esc(staffMeta.label)}">${ic("shield", "ico-inline")}</span>`);
    }
    icon = `<span class="side-ch-icon-wrap${showLock ? " is-private" : ""}">${icon}${badges.join("")}${lockHtml}</span>`;

    const chatUnread = ch.kind === "chat" ? unread : 0;
    const eventUnread = ch.kind === "event" ? unread : 0;
    if (chatUnread || eventUnread) b.classList.add("has-unread");
    if (chatUnread) b.classList.add("has-chat-unread");

    const trailing = [];
    if (channelKind === "event") {
      const eventMeta = sidebarEventCountMeta(opts.acceptedCount || 0, eventUnread);
      if (eventMeta.html) trailing.push(eventMeta.html);
    }
    if (opts.child && channelKind === "task" && opts.openTaskCount > 0) {
      const n = opts.openTaskCount;
      const openLabel = `${n} uncompleted ${n === 1 ? "task" : "tasks"}`;
      trailing.push(`<span class="side-board-accepted-count" title="${esc(openLabel)}" aria-label="${esc(openLabel)}">${n}</span>`);
    }
    const requiredMark = (typeof PersonalSpace !== "undefined" && PersonalSpace.isRequiredChannel(ch, conn) && !opts.child)
      ? `<span class="side-required-mark" title="Required — My calendar saves here">Required</span>`
      : "";
    const label = opts.childLabel || ch.name;
    b.innerHTML =
      `<span class="side-item-label">${icon}` +
        `<span class="side-item-name">${esc(label)}</span>` +
        requiredMark +
      `</span>` +
      (trailing.length ? `<span class="side-dots">${trailing.join("")}</span>` : "");
    row.appendChild(b);
    (opts.parent || list).appendChild(row);
  };

  const appendChannelSection = (title, channels, preferredKind, opts = {}) => {
    const sectionLabel = document.createElement("div");
    sectionLabel.className = "side-label";
    sectionLabel.dataset.sideSection = preferredKind;
    sectionLabel.innerHTML = `<span>${title}</span>`;
    const showAdd = canManageChannels && opts.hideAdd !== true;
    if (showAdd) {
      const addCh = document.createElement("button");
      addCh.className = "side-add-ch";
      addCh.type = "button";
      addCh.textContent = "+";
      addCh.dataset.channelKind = preferredKind;
      addCh.title = opts.addTitle || "New channel";
      addCh.setAttribute("aria-label", addCh.title);
      sectionLabel.appendChild(addCh);
    }
    list.appendChild(sectionLabel);
    for (const ch of channels || []) {
      if (!ch) continue;
      paintSideChannelRow(ch, preferredKind);
    }
  };

  for (const ch of welcomeChannels) {
    paintSideChannelRow(ch, "welcome");
  }
  if (conn.id === "personal") {
    const calendar = g.channels.find(c => typeof isDeviceCalendarChannel === "function" && isDeviceCalendarChannel(c, conn));
    if (calendar) paintSideChannelRow(calendar, "event");
  }

  const boardsLabel = document.createElement("div");
  boardsLabel.className = "side-label";
  boardsLabel.dataset.sideSection = "board";
  boardsLabel.innerHTML = `<span>Boards</span>`;
  if (canManageChannels) {
    const addBoard = document.createElement("button");
    addBoard.className = "side-add-ch";
    addBoard.type = "button";
    addBoard.textContent = "+";
    addBoard.dataset.channelKind = "board";
    addBoard.title = "New board";
    addBoard.setAttribute("aria-label", "New board");
    boardsLabel.appendChild(addBoard);
  }
  list.appendChild(boardsLabel);

  const accordionIds = [
    ...boardList.map(b => b.id),
    ...shownBoardList.map(p => shownBoardShadowId(p.ref.connId, p.ref.boardId)),
  ];
  resolveOpenBoardId(conn, accordionIds);

  const paintBoard = (board, opts = {}) => {
    const srcConn = opts.sourceConn || null;
    const srcBoard = opts.sourceBoard || board;
    const evHome = srcConn || conn;
    const ev = typeof eventChannelForBoard === "function" ? eventChannelForBoard(srcBoard, evHome) : null;
    const chat = typeof chatChannelForBoard === "function" ? chatChannelForBoard(srcBoard, evHome) : null;
    const task = typeof taskChannelForBoard === "function" ? taskChannelForBoard(srcBoard, evHome) : null;
    const localEv = opts.source ? ev : (typeof eventChannelForBoard === "function" ? eventChannelForBoard(board, conn) : null);
    const localChat = opts.source ? chat : (typeof chatChannelForBoard === "function" ? chatChannelForBoard(board, conn) : null);
    const localTask = opts.source ? task : (typeof taskChannelForBoard === "function" ? taskChannelForBoard(board, conn) : null);
    const sidebarBoardId = opts.sidebarBoardId || board.id;
    const wrap = document.createElement("div");
    wrap.className = "side-board is-entry" + (opts.source ? " is-source-board" : "");
    wrap.dataset.boardId = sidebarBoardId;
    if (opts.offline) wrap.classList.add("is-offline");
    if (opts.unavailable) wrap.classList.add("is-unavailable");
    wrap.dataset.sideSection = opts.source ? "shown-board" : "board";
    const visCh = ev || chat || task || board;
    const visConn = srcConn || conn;
    const access = typeof boardViewAccessMeta === "function"
      ? boardViewAccessMeta(visCh, visConn)
      : null;
    const head = document.createElement("button");
    head.type = "button";
    head.className = "side-board-head";
    head.dataset.sideKey = "board-open";
    head.dataset.boardId = sidebarBoardId;
    if (ev) head.dataset.eventChannelId = ev.id;
    if (opts.projection) {
      head.dataset.sourceConnId = opts.projection.sourceConnId || "";
      head.dataset.sourceBoardId = opts.projection.sourceBoardId || "";
    }
    if (opts.unavailable) head.dataset.unavailable = "1";
    const viewBoard = boardIdForActiveView(conn);
    const isCurrent = !!painted && viewBoard === String(sidebarBoardId);
    if (isCurrent) {
      wrap.classList.add("is-current");
      head.setAttribute("aria-current", "page");
    }
    const unreadConn = srcConn || conn;
    const evUnread = ev ? channelUnreadCount(unreadConn, ev, unreadConn.events) : 0;
    const chatUnread = chat ? channelUnreadCount(unreadConn, chat, unreadConn.events) : 0;
    const acceptedCount = ev ? sidebarAcceptedEventCount(unreadConn, ev) : 0;
    const eventMeta = sidebarEventCountMeta(acceptedCount, evUnread);
    const acceptedLabel = eventMeta.label;
    const acceptedBadge = eventMeta.html
      ? `<span class="side-board-collapse-accepted">${eventMeta.html}</span>`
      : "";
    if (evUnread || chatUnread) head.classList.add("has-unread");
    if (chatUnread) {
      head.classList.add("has-chat-unread");
      wrap.classList.add("has-chat-unread");
    }
    const accessIco = access?.icon && typeof ic === "function"
      ? `<span class="side-board-access-ico" aria-hidden="true">${ic(access.icon, "ico-inline")}</span>`
      : "";
    const isPersonalBoard = conn.id === "personal"
      && typeof PersonalSpace !== "undefined"
      && PersonalSpace.isRequiredBoard?.(board, conn);
    const requiredMark = (!isPersonalBoard && typeof PersonalSpace !== "undefined" && PersonalSpace.isRequiredBoard?.(board, conn))
      ? `<span class="side-required-mark" title="Required — My calendar saves here">Required</span>`
      : "";
    const ownerHtml = isPersonalBoard ? `<span class="side-board-owner">Just me</span>` : "";
    const shownInPersonal = !opts.source && typeof isBoardShownInPersonal === "function"
      && isBoardShownInPersonal(conn.id, board.id);
    let inboundSpeak = "";
    let inbound = false;
    if (opts.source) {
      inbound = true;
      if (srcConn) {
        const srcName = typeof connDisplayName === "function" ? connDisplayName(srcConn) : (srcConn.name || "Server");
        inboundSpeak = `from ${srcName}${opts.offline ? " · Offline" : ""}`;
      } else {
        inboundSpeak = "source unavailable";
      }
    } else if (!shownInPersonal && typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn)) {
      const feedId = ev?.id || chat?.id;
      const link = (feedId && typeof directLinkedEventSourcesFor === "function")
        ? (directLinkedEventSourcesFor(conn.id, feedId) || []).find(l => l?.connId && l.connId !== conn.id)
        : null;
      const fromConn = link ? S.conns?.[link.connId] : null;
      if (fromConn && !PersonalSpace.isPersonal(fromConn)) {
        inbound = true;
        const srcName = typeof connDisplayName === "function" ? connDisplayName(fromConn) : (fromConn.name || "Server");
        inboundSpeak = `from ${srcName}`;
      }
    }
    const originSpeak = shownInPersonal ? "shown in personal" : inboundSpeak;
    const originIcon = shownInPersonal ? "arrow-up-right" : (inbound ? "arrow-down-right" : "");
    const originTitle = shownInPersonal ? "Shown in personal" : (inboundSpeak ? inboundSpeak.replace(/^from /, "From ") : "");
    const hashIco = `<span class="side-ch-icon" aria-hidden="true"><span class="hash">#</span></span>`;
    const originMark = originIcon
      ? `<span class="side-board-shown-mark" title="${esc(originTitle)}" aria-hidden="true">${typeof ic === "function" ? ic(originIcon, "ico-inline") : ""}</span>`
      : "";
    const glyph = `<span class="side-board-glyph-wrap${shownInPersonal ? " is-shown" : ""}${inbound ? " is-from" : ""}">${hashIco}${originMark}</span>`;
    let sourceHtml = "";
    const permText = (() => {
      if (!access || access.kind === "personal") return "";
      // Short: the lowest role that can see it, the custom roles it's for,
      // or "N people" when private. The full list is in the board's settings.
      return access.label || "";
    })();
    const permHtml = permText
      ? `<span class="side-board-perm">${accessIco}<span class="side-board-perm-label">${esc(permText)}</span></span>`
      : "";
    const metaParts = [ownerHtml, permHtml, sourceHtml].filter(Boolean);
    const metaSpeak = [isPersonalBoard ? "Just me" : "", permText || "", originSpeak].filter(Boolean).join(", ");
    const metaHtml = metaParts.length
      ? `<span class="side-board-head-meta${sourceHtml ? " has-source" : ""}${isPersonalBoard ? " is-personal" : ""}"${metaSpeak ? ` aria-label="${esc(metaSpeak)}"` : ""}><span aria-hidden="true">${metaParts.join(`<span class="side-board-meta-sep">·</span>`)}</span></span>`
      : "";
    head.innerHTML =
      `<span class="side-board-head-top"><span class="side-board-head-label">${glyph}` +
        `<span class="side-item-name">${esc(board.name || srcBoard.name || "Board")}</span>${requiredMark}</span>` +
        metaHtml +
        `<span class="side-dots">${acceptedBadge}</span></span>`;
    const headSpeak = [
      board.name || srcBoard.name || "Board",
      acceptedLabel,
      chatUnread ? "Unread messages" : "",
      metaSpeak,
    ].filter(Boolean).join(", ");
    if (headSpeak) head.setAttribute("aria-label", headSpeak);
    wrap.appendChild(head);
    if (opts.unavailable && !localEv && !localChat && !localTask) {
      const unavailable = document.createElement("p");
      unavailable.className = "side-board-unavailable";
      unavailable.textContent = "Unavailable offline";
      wrap.appendChild(unavailable);
    }
    list.appendChild(wrap);
  };

  for (const board of boardList) {
    paintBoard(board);
  }
  for (const projected of shownBoardList) {
    const fallbackBoard = {
      id: projected.ref.boardId,
      name: projected.displayName,
      icon: projected.displayIcon,
    };
    paintBoard(projected.sourceBoard || fallbackBoard, {
      source: true,
      sourceConn: projected.contentConn,
      sourceBoard: projected.sourceBoard || fallbackBoard,
      sidebarBoardId: shownBoardShadowId(projected.ref.connId, projected.ref.boardId),
      projection: {
        sourceConnId: projected.ref.connId,
        sourceBoardId: projected.ref.boardId,
      },
      offline: projected.offline,
      unavailable: projected.unavailable,
    });
  }
  if (!locationsParked && pinnedChannels.length) {
    appendChannelSection(
      "Pinned locations",
      pinnedChannels,
      "pinned",
      { hideAdd: true },
    );
  }
  if (!peopleParked && ((allowPinnedPeople && canManageChannels) || pinnedPeopleChannels.length)) {
    appendChannelSection(
      "Pinned people",
      pinnedPeopleChannels,
      "pinned-people",
      {
        addTitle: "Pin a member’s calendar to a new channel",
        hideAdd: !allowPinnedPeople,
      },
    );
  }

  paintSidebarHelpAndLeave(list, conn);

  paintSidebarUserPanel(conn);

  list.style.paddingTop = "";
  list.style.paddingBottom = "";
  if (scrollTop != null) list.scrollTop = scrollTop;
  try { refreshSideOverlay(); } catch {}
  try {
    if (S.sidebarReorderMode && typeof paintSidebarReorderModeChrome === "function") {
      paintSidebarReorderModeChrome();
    }
  } catch {}
  try {
    if (typeof landPendingBoard === "function" && S.pendingBoardLand) {
      queueMicrotask(() => { try { landPendingBoard(); } catch {} });
    }
  } catch {}
}

function openSidebarBoard(head) {
  if (!head) return;
  if (head.dataset.unavailable === "1") {
    try { toast("This board is unavailable offline"); } catch {}
    return;
  }
  const eventChannelId = head.dataset.eventChannelId;
  const boardId = head.dataset.boardId;
  const sourceConnId = head.dataset.sourceConnId;
  const sourceBoardId = head.dataset.sourceBoardId;
  if (!eventChannelId) {
    try { toast("This board has no conversations yet"); } catch {}
    return;
  }
  if (boardId && typeof persistOpenBoardId === "function") persistOpenBoardId(boardId);
  const sameChannel = S.activeView?.kind === "channel" && S.activeView.id === eventChannelId
    && (!sourceConnId || (S.activeProjection?.sourceConnId === sourceConnId
      && S.activeProjection?.sourceBoardId === sourceBoardId
      && S.activeProjection?.sourceChannelId === eventChannelId));
  const wasConversations = typeof boardSurfaceFor === "function"
    && boardSurfaceFor(eventChannelId) === "conversations";
  if (typeof setBoardSurface === "function") setBoardSurface(eventChannelId, "conversations");
  if (typeof S !== "undefined") S.conversationsReturn = null;
  if (sourceConnId && sourceBoardId && typeof Nav?.openProjectedChannel === "function") {
    Nav.openProjectedChannel({
      sourceConnId,
      sourceBoardId,
      sourceChannelId: eventChannelId,
    });
  } else if (typeof Nav?.openChannel === "function") {
    Nav.openChannel(eventChannelId);
  }
  S.activeEventChannelId = eventChannelId;
  try { closeNav(); } catch {}
  try { rememberNav(); } catch {}
  try { renderSidebar(); } catch {}
  if (!sameChannel || !wasConversations) {
    try { renderView(); } catch {}
  }
}

function openSideDestination(key) {
  if (key === "live"
    && typeof showSocialMetaChannels === "function"
    && !showSocialMetaChannels()) {
    return;
  }
  if (key === "notifications") {
    openPersonalNotificationsBoard();
    return;
  }
  if (key === "memories") {
    try { closeSideOverlay(); } catch {}
    if (typeof closeChannelPanel === "function" && Panel.channelOpen()) {
      try { closeChannelPanel(); } catch {}
    }
    Nav.set({ kind: "memories" });
    closeNav();
    rememberNav();
    renderSidebar();
    renderView();
    return;
  }
  if (key === "members" || key === "info") {
    if (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(activeConn())) {
      return;
    }
    try { closeSideOverlay(); } catch {}
    if (typeof closeChannelPanel === "function" && Panel.channelOpen()) {
      try { closeChannelPanel(); } catch {}
    }
    Nav.set({ kind: key === "info" ? "serverInfo" : "members" });
    closeNav();
    rememberNav();
    renderSidebar();
    renderView();
    return;
  }
  if (key === "console" || key === "setup" || key === "default-role" || key === "profiles-media"
      || key === "event-options" || key === "access-control"
      || key === "demo-users" || key === "auto-delete") {
    if (typeof openConsoleSectionOverlay === "function") {
      openConsoleSectionOverlay(key === "console" || key === "setup" ? "default-role" : key);
    }
    return;
  }
  if (key === "delete-boards" || key === "delete-channels" || key === "channel-edit") {
    if (typeof openDeleteBoardsModal === "function") openDeleteBoardsModal(activeConn());
    return;
  }
  if (key === "moderate" || key === "reports") {
    openModerateSideOverlay();
    return;
  }
  if (key === "live") {
    Nav.set({ kind: "live" });
  } else if (key.startsWith("projected-ch:")) {
    const parts = key.slice("projected-ch:".length).split(":").map(decodeURIComponent);
    const [sourceConnId, sourceBoardId, sourceChannelId] = parts;
    const projected = resolveShownBoardProjection({ connId: sourceConnId, boardId: sourceBoardId });
    const sourceConn = projected?.contentConn;
    const ch = (sourceConn?.channels || []).find(c => c.id === sourceChannelId);
    if (!sourceConn || !ch) {
      toast("This board is unavailable offline");
      return;
    }
    const prevEventScope = S.activeView?.kind === "channel" ? S.activeView.id : null;
    Nav.openProjectedChannel({ sourceConnId, sourceBoardId, sourceChannelId });
    persistOpenBoardId(shownBoardShadowId(sourceConnId, sourceBoardId), presentationConn());
    if (ch.kind === "event") {
      if (prevEventScope !== sourceChannelId) {
        try { resetRsvpFilter(); } catch {}
      }
      S.activeEventChannelId = sourceChannelId;
      landOnTodayWeekView();
    } else {
      S.activeEventChannelId = null;
      if (!projected.offline) markChannelRead(sourceConn, sourceChannelId);
    }
  } else if (key.startsWith("ch:")) {
    const id = key.slice(3);
    const prevEventScope = S.activeView?.kind === "channel"
      ? S.activeView.id
      : (S.activeView?.kind === "events" ? S.activeEventChannelId : null);
    Nav.openChannel(id);
    const ch = group()?.channels.find(c => c.id === id);
    if (ch?.boardId && typeof persistOpenBoardId === "function") persistOpenBoardId(ch.boardId);
    if (ch?.kind === "event") {
      // Filter is per board look — reset when the event channel changes.
      if (prevEventScope !== id) {
        try { resetRsvpFilter(); } catch {}
      }
      S.activeEventChannelId = id;
      landOnTodayWeekView();
    } else if (ch) {
      markChannelRead(activeConn(), id);
    }
  } else return;
  closeNav();
  rememberNav();
  renderSidebar();
  renderView();
}

function mergedUnreadNotificationCount() {
  const conns = S.conns || {};
  let n = 0;
  for (const cc of Object.values(conns)) {
    for (const item of (cc.notifications || [])) {
      if (item.read) continue;
      if (item.fromUserId && typeof isBlocked === "function" && isBlocked(item.fromUserId, cc)) continue;
      n++;
    }
  }
  return n;
}

function sidebarUserAvatarHTML(conn) {
  const me = typeof loadMe === "function" ? (loadMe() || {}) : {};
  const name = String(conn?.me?.name || me.name || "").trim() || "Me";
  const uid = conn?.me?.id || me.id;
  if (uid && typeof avatarStyle === "function") {
    const face = typeof avatarFaceHtml === "function" ? avatarFaceHtml(uid, name) : "";
    return `<span class="side-user-avatar" style="${avatarStyle(uid)}" aria-hidden="true">${face}</span>`;
  }
  const letters = typeof initials === "function" ? initials(name) : name.slice(0, 1);
  return `<span class="side-user-avatar" aria-hidden="true">${esc(letters || "?")}</span>`;
}

function paintSidebarHelpAndLeave(list, conn) {
  if (!list) return;
  const served = typeof isServedOrigin === "function" && isServedOrigin();
  if (served) {
    const help = document.createElement("button");
    help.type = "button";
    help.className = "side-item served-info-link";
    help.dataset.sideKey = "help-legal";
    help.textContent = "Help & legal";
    help.title = "Legal, contact, and FAQs";
    list.appendChild(help);
  }
}

function paintSidebarUserPanel(conn) {
  window.Onboarding?.sync?.();
  window.Onboarding?.paintChecklist?.(conn);
  const panel = document.getElementById("side-user-panel");
  if (!panel) return;
  const me = typeof loadMe === "function" ? (loadMe() || {}) : {};
  const name = String(conn?.me?.name || me.name || "").trim() || "Me";
  const userSheetOpen = !!document.querySelector(".user-profile-overlay");
  panel.innerHTML = `
    <button type="button" class="side-user-chip" id="side-user-menu-btn" aria-haspopup="dialog" aria-expanded="${userSheetOpen ? "true" : "false"}" title="Account menu" aria-label="Account menu, ${esc(name)}">
      ${sidebarUserAvatarHTML(conn)}
      <span class="side-user-name-wrap">
        <span class="side-user-name">${esc(name)}</span>
      </span>
      <span class="side-user-menu-chevron" aria-hidden="true">${typeof ic === "function" ? ic("chevron-right") : ""}</span>
    </button>`;
}
