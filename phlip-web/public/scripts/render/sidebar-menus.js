/* sidebar-menus.js — Discord-style bottom sheets for server title + profile chip.
 * Globals out: collectServerMenuItems, collectServerSettingsItems,
 *   collectServerHomeSettingsItems, collectServerOverlayListItems, collectUserMenuItems,
 *   openServerMenuSheet, openUserMenuSheet, closeSidebarMenuSheet,
 *   serverMenuOverlayHandleBack
 * Load after: channel-settings.js; before: channel-shell.js
 */

let _sidebarMenuSheetClose = null;
let _sidebarMenuSheetTrigger = null;
let _serverMenuPane = "home";
let _serverMenuHomeTitle = "Server";

function closeSidebarMenuSheet() {
  if (typeof _sidebarMenuSheetClose === "function") {
    const fn = _sidebarMenuSheetClose;
    _sidebarMenuSheetClose = null;
    try { fn(); } catch {}
    return;
  }
  if (typeof AshModal !== "undefined" && AshModal.close) {
    AshModal.close("sidebar-menu-sheet");
  }
}

function setSidebarMenuTriggerExpanded(trigger, expanded) {
  let el = trigger;
  if (!el || !el.isConnected) {
    const id = trigger && trigger.id;
    el = id ? document.getElementById(id) : null;
  }
  if (el) el.setAttribute("aria-expanded", expanded ? "true" : "false");
}

function bindSidebarMenuRowKeys(overlay) {
  overlay.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const rows = [...overlay.querySelectorAll(".sidebar-menu-row")];
    if (!rows.length) return;
    const i = rows.indexOf(document.activeElement);
    let next = 0;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = rows.length - 1;
    else if (e.key === "ArrowDown") next = i < 0 ? 0 : (i + 1) % rows.length;
    else next = i < 0 ? rows.length - 1 : (i - 1 + rows.length) % rows.length;
    e.preventDefault();
    e.stopPropagation();
    rows[next].focus();
  });
}

function collectPersonalSpaceMenuItems() {
  return [
    { key: "notifications", icon: "bell", label: "Notifications", title: "Notifications" },
    { key: "personal-settings", icon: "house", label: "Personal settings", title: "Personal space settings" },
    { key: "places", icon: "map-pin", label: "Places", title: "Your places and boards you follow" },
    { key: "appearance", icon: "palette", label: "Appearance", title: "Theme and card style" },
    { key: "sound", icon: "volume-2", label: "Sound", title: "Sound" },
    { key: "calendar-time", icon: "clock", label: "Calendar & time", title: "Day hours" },
    { key: "help", icon: "circle-question-mark", label: "Help & legal", title: "Legal, contact, and FAQs" },
  ];
}

/** Home-menu settings already listed outside the nested Settings pane. */
function collectServerHomeSettingsItems(conn = activeConn()) {
  if (!conn) return [];
  const items = [];
  const personal = typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn);

  if (typeof canSeeModerateMeta === "function" && canSeeModerateMeta(conn)) {
    const openReports = (S.reports || []).filter(r => r.status === "open").length;
    items.push({
      key: "moderate",
      icon: "shield",
      label: "Moderate",
      badge: openReports || 0,
      title: openReports
        ? `${openReports} open report${openReports === 1 ? "" : "s"}`
        : "Reports and moderation",
    });
  }
  if (typeof canManageServer === "function" && canManageServer(conn)) {
    items.push({
      key: "places",
      icon: "map-pin",
      label: "Places",
      title: "Places",
    });
    items.push({
      key: "drawings",
      icon: "edit",
      label: "Drawings",
      title: "Drawings",
    });
    if (!personal) {
      items.push({
        key: "roles",
        icon: "user-shield",
        label: "Roles",
        title: "Roles",
      });
      items.push({
        key: "delete-boards",
        icon: "trash",
        label: "Delete boards",
        title: "Remove boards and their events, chat, and tasks",
        danger: true,
      });
      items.push({
        key: "server-icon",
        icon: "image",
        label: "Server icon",
        title: "Change server icon",
      });
    }
  }
  if (!personal && typeof canSeeConsoleMeta === "function" && canSeeConsoleMeta(conn)) {
    items.push({
      key: "default-role",
      icon: "user-round",
      label: "Default role",
      title: "Role new people join as",
    });
    items.push({
      key: "profiles-media",
      icon: "image",
      label: "Profiles & media",
      title: "Profile photos and drawing",
    });
    items.push({
      key: "event-options",
      icon: "calendar",
      label: "Event options",
      title: "Places, approval, and pinned people",
    });
    items.push({
      key: "access-control",
      icon: "lock",
      label: "Access control",
      title: "Age rating",
    });
    items.push({
      key: "auto-delete",
      icon: "clock",
      label: "Auto-delete options",
      title: "Wipe ended events and old chat",
    });
    if (typeof serverSettings === "function" && serverSettings(conn).demoUsersEnabled) {
      items.push({
        key: "demo-users",
        icon: "users",
        label: "Demo users",
        title: "Add or remove demo members",
      });
    }
  }
  return items;
}

/** Nested Settings pane — empty once remaining items live on the home menu. */
function collectServerSettingsItems(conn = activeConn()) {
  return [];
}

function collectServerOverlayListItems(conn = activeConn()) {
  if (!conn) return [];
  const items = [];
  const personal = typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn);
  const served = typeof isServedOrigin === "function" && isServedOrigin();

  if (!personal) {
    const pendingN = (typeof canManageServer === "function" && canManageServer(conn))
      ? (conn.pendingReqs || []).length
      : 0;
    items.push({
      key: "members",
      icon: "users",
      label: "People",
      badge: pendingN || 0,
      title: pendingN ? `${pendingN} waiting to join` : "People on this server",
    });
    items.push({
      key: "info",
      icon: "info",
      label: "Server info",
      title: "About this server",
    });
    if (collectServerSettingsItems(conn).length) {
      items.push({
        key: "settings",
        icon: "settings",
        label: "Settings",
        title: "Server settings",
      });
    }
    if (typeof isHostedBridgeConn === "function" && isHostedBridgeConn(conn)) {
      items.push({
        key: "server-data",
        icon: "database-backup",
        label: "Backup & restore",
        title: "Server backups and deletion",
      });
    }
  }
  items.push({
    key: "help",
    icon: "circle-question-mark",
    label: "Help & legal",
    title: "Legal, contact, and FAQs",
  });
  if (!served && ((typeof connIsDirectMembership === "function" && connIsDirectMembership(conn))
      || (typeof connHasHotspotCreds === "function" && connHasHotspotCreds(conn)))) {
    const creds = typeof connHotspotCreds === "function" ? connHotspotCreds(conn) : null;
    items.push({
      key: "hotspot-change-wifi",
      icon: "wifi",
      label: "Change Wi-Fi network",
      title: creds?.ssid
        ? `Open Wi‑Fi picker (saved: ${creds.ssid})`
        : "Open Wi‑Fi picker",
    });
  }
  const isHost = !!(conn?.me?.isHost
    || (typeof effectiveRole === "function" && effectiveRole(conn?.me) === ROLE_HOST));
  if (conn.me && !personal && !isHost) {
    items.push({
      key: "leave",
      icon: "log-out",
      label: "Leave server",
      title: "Leave this server",
      danger: true,
    });
  }
  return items;
}

function collectServerMenuItems(conn = activeConn()) {
  const unread = typeof mergedUnreadNotificationCount === "function" ? mergedUnreadNotificationCount() : 0;
  return [
    { key: "notifications", icon: "bell", label: "Notifications", badge: unread || 0, title: "Notifications" },
    { key: "memories", icon: "rotate-ccw-clock", label: "Archive", title: "Past plans" },
  ].concat(
    collectServerHomeSettingsItems(conn),
    collectServerOverlayListItems(conn),
  );
}

const SERVER_MENU_SECTIONS = [
  { label: "Content", keys: ["notifications", "memories", "places", "drawings"] },
  { label: "Management", keys: ["moderate", "roles", "members", "delete-boards"] },
  { label: "Customisation", keys: ["server-icon", "default-role", "profiles-media", "event-options", "access-control", "auto-delete"] },
  { label: "Data", keys: ["server-data", "demo-users"] },
  { label: "Information", keys: ["info", "settings", "help"] },
];
const SERVER_MENU_TAIL = ["hotspot-change-wifi", "leave"];

function serverMenuSectionsHTML(conn) {
  const items = collectServerMenuItems(conn);
  const byKey = new Map(items.map((item) => [item.key, item]));
  const used = new Set();
  const parts = [];
  for (const sec of SERVER_MENU_SECTIONS) {
    const rows = sec.keys.map((k) => byKey.get(k)).filter(Boolean);
    if (!rows.length) continue;
    rows.forEach((row) => used.add(row.key));
    parts.push(`<div class="sidebar-menu-section-label">${esc(sec.label)}</div>`);
    parts.push(rows.map(sidebarMenuRowHTML).join(""));
  }
  const leftover = items.filter((item) => !used.has(item.key) && !SERVER_MENU_TAIL.includes(item.key));
  if (leftover.length) parts.push(leftover.map(sidebarMenuRowHTML).join(""));
  const tail = SERVER_MENU_TAIL.map((k) => byKey.get(k)).filter(Boolean);
  if (tail.length) parts.push(tail.map(sidebarMenuRowHTML).join(""));
  return parts.join("");
}


function collectUserMenuItems(conn = activeConn()) {
  const items = [];
  const personal = typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn);
  if (!personal && conn?.me) {
    const hostSet = !!conn.me.nameHostSet;
    items.push({
      key: "server-options",
      icon: "sliders-horizontal",
      label: "Server options",
      extra: hostSet
        ? ` <span class="people-host-set-badge">Host-set</span>`
        : "",
      title: "Your profile on this server",
    });
  }
  items.push({
    key: "user-settings",
    icon: "user-round-cog",
    label: "User settings",
    title: "User settings",
  });
  items.push({
    key: "app-style",
    icon: "palette",
    label: "App style settings",
    title: "Theme and card style",
  });
  return items;
}

function runSidebarMenuAction(key) {
  const conn = typeof activeConn === "function" ? activeConn() : null;
  if (key === "moderate" || key === "members" || key === "info") {
    if (typeof openSideDestination === "function") openSideDestination(key);
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
    if (typeof openDeleteBoardsModal === "function") openDeleteBoardsModal(conn);
    return;
  }
  if (key === "places") {
    if (typeof openPlacesManager === "function") openPlacesManager();
    return;
  }
  if (key === "drawings" || key === "reactions") {
    if (typeof openDrawingsManager === "function") openDrawingsManager();
    return;
  }
  if (key === "roles") {
    if (typeof openRolesEditorModal === "function") openRolesEditorModal();
    return;
  }
  if (key === "server-icon") {
    if (typeof openServerIconModal === "function") openServerIconModal();
    return;
  }
  if (key === "server-data") {
    if (conn && typeof openHostedServerDataSettings === "function") {
      openHostedServerDataSettings(String(conn.id || "").replace(/^srv-local-/, ""));
    }
    return;
  }
  if (key === "hotspot-change-wifi") {
    if (typeof openHotspotWifiPicker === "function") openHotspotWifiPicker();
    else if (typeof hotspotApi === "function") hotspotApi("openWifiSettings");
    return;
  }
  if (key === "server-options") {
    if (conn && typeof openServerOptionsPanel === "function") openServerOptionsPanel(conn);
    return;
  }
  if (key === "personal-settings") {
    if (typeof openUserProfileOverlay === "function") openUserProfileOverlay({ pane: "personal" });
    return;
  }
  if (key === "appearance") {
    if (typeof openUserProfileOverlay === "function") openUserProfileOverlay({ pane: "style" });
    return;
  }
  if (key === "sound") {
    if (typeof openUserProfileOverlay === "function") openUserProfileOverlay({ pane: "sound" });
    return;
  }
  if (key === "calendar-time") {
    if (typeof openUserProfileOverlay === "function") openUserProfileOverlay({ pane: "other" });
    return;
  }
  if (key === "user-settings") {
    if (typeof openUserSettings === "function") openUserSettings();
    else if (typeof openUserSettingsModal === "function") openUserSettingsModal();
    return;
  }
  if (key === "app-style") {
    if (typeof openCosmeticsModal === "function") openCosmeticsModal();
    return;
  }
  if (key === "invite") {
    if (typeof sharePersonalInviteLink === "function") sharePersonalInviteLink(conn);
    return;
  }
  if (key === "notifications") {
    if (typeof openPersonalNotificationsBoard === "function") {
      openPersonalNotificationsBoard();
      try { rememberNav(); } catch {}
    }
    return;
  }
  if (key === "memories") {
    if (typeof openSideDestination === "function") openSideDestination("memories");
    return;
  }
  if (key === "help") {
    if (typeof openPhlipHelpLegalMenu === "function") openPhlipHelpLegalMenu();
    return;
  }
  if (key === "leave") {
    if (typeof isServedOrigin === "function" && isServedOrigin()) {
      if (typeof confirmLeaveServedServer === "function") confirmLeaveServedServer();
      return;
    }
    if (conn && typeof confirmRemoveServer === "function") confirmRemoveServer(conn.id);
  }
}

function sidebarMenuRowHTML(item) {
  const ico = typeof ic === "function" ? ic(item.icon, "ico-inline") : "";
  const badge = item.badge
    ? `<span class="dot" title="${esc(item.title || "")}">${item.badge > 99 ? "99+" : item.badge}</span>`
    : "";
  const title = item.title ? ` title="${esc(item.title)}"` : "";
  const danger = item.danger ? " sidebar-menu-row-danger" : "";
  return `<button type="button" class="ch-manage-btn sidebar-menu-row${danger}" data-sidebar-menu-key="${esc(item.key)}"${title}>
    <span class="sidebar-menu-row-main">${ico}<span class="sidebar-menu-row-label">${esc(item.label)}${item.extra || ""}</span></span>
    ${badge}
  </button>`;
}

function openSidebarMenuSheet({ title, labelledBy, items, trigger, triggerKind }) {
  const rows = (items || []).filter(Boolean);
  if (!rows.length) return;

  if (typeof cancelArmedSideNavTap === "function") cancelArmedSideNavTap();
  if (typeof suppressSideNavTaps === "function") suppressSideNavTaps(500);
  closeSidebarMenuSheet();

  const triggerEl = trigger || document.activeElement;
  const titleId = labelledBy || "sidebar-menu-title";
  const opened = typeof AshModal !== "undefined" && AshModal.open
    ? AshModal.open({
      className: "channel-settings-sheet sidebar-menu-sheet",
      attrs: triggerKind ? { "data-sidebar-menu-trigger": triggerKind } : {},
      html: `
        <div class="channel-settings-sheet-card" role="dialog" aria-modal="true" aria-labelledby="${esc(titleId)}">
          <div class="channel-settings-sheet-handle" aria-hidden="true"></div>
          <div class="channel-settings-sheet-head">
            <h4 id="${esc(titleId)}" class="channel-settings-sheet-title" tabindex="-1">${esc(title)}</h4>
          </div>
          <div class="channel-settings-sheet-body">
            <div class="channel-settings-sheet-actions sidebar-menu-actions">
              ${rows.map(sidebarMenuRowHTML).join("")}
            </div>
          </div>
        </div>`,
      singleton: "replace",
      graceMs: 450,
      closeOnEscape: true,
      closeOnBackdrop: true,
      trapFocus: true,
      restoreFocus: true,
      initialFocus: `#${titleId}`,
      onClose: () => {
        _sidebarMenuSheetClose = null;
        setSidebarMenuTriggerExpanded(_sidebarMenuSheetTrigger, false);
        _sidebarMenuSheetTrigger = null;
      },
    })
    : null;
  if (!opened) return;

  const { overlay, close } = opened;
  _sidebarMenuSheetClose = close;
  _sidebarMenuSheetTrigger = triggerEl && triggerEl.id ? triggerEl : triggerEl;
  setSidebarMenuTriggerExpanded(triggerEl, true);
  const card = overlay.querySelector(".channel-settings-sheet-card");
  if (card && typeof bindChannelSettingsSheetDismiss === "function") {
    bindChannelSettingsSheetDismiss(overlay, card, close);
  }
  bindSidebarMenuRowKeys(overlay);
  overlay.querySelectorAll("[data-sidebar-menu-key]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const key = btn.dataset.sidebarMenuKey;
      close();
      setTimeout(() => {
        try { runSidebarMenuAction(key); } catch (err) {
          console.error(err);
          try { toast(err?.message || "Something went wrong"); } catch {}
        }
      }, 40);
    });
  });
}

function serverMenuIco(name) {
  return typeof ic === "function" ? ic(name, "ico-inline") : "";
}


function bindServerMenuOverlayClicks(overlay) {
  overlay.addEventListener("click", (e) => {
    const action = e.target.closest("[data-server-menu-action]");
    if (action && overlay.contains(action)) {
      e.preventDefault();
      e.stopPropagation();
      runServerOverlayAction(action.dataset.serverMenuAction);
      return;
    }
    const row = e.target.closest("[data-sidebar-menu-key]");
    if (row && overlay.contains(row)) {
      e.preventDefault();
      e.stopPropagation();
      runServerOverlayAction(row.dataset.sidebarMenuKey);
    }
  });
}

function runServerOverlayAction(key) {
  if (key === "settings") {
    showServerMenuPane("settings");
    return;
  }
  closeSidebarMenuSheet();
  setTimeout(() => {
    try { runSidebarMenuAction(key); } catch (err) {
      console.error(err);
      try { toast(err?.message || "Something went wrong"); } catch {}
    }
  }, 40);
}

function showServerMenuPane(pane) {
  const overlay = document.querySelector(".server-menu-overlay");
  if (!overlay) return;
  const body = overlay.querySelector("#server-menu-body");
  const title = overlay.querySelector("#sidebar-server-menu-title");
  const back = overlay.querySelector("#server-menu-back");
  if (!body) return;

  _serverMenuPane = pane || "home";
  const isHome = _serverMenuPane === "home";
  if (back) back.hidden = isHome;
  if (title) title.textContent = isHome ? _serverMenuHomeTitle : "Settings";
  body.innerHTML = "";

  const conn = (_serverMenuConnId && S.conns?.[_serverMenuConnId])
    || (typeof activeConn === "function" ? activeConn() : null);
  if (isHome) {
    const personal = typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn);
    if (personal) {
      body.innerHTML = `
      <div class="channel-settings-sheet-actions sidebar-menu-actions">
        ${collectPersonalSpaceMenuItems().map(sidebarMenuRowHTML).join("")}
      </div>`;
      return;
    }
      body.innerHTML = `
      <div class="channel-settings-sheet-actions sidebar-menu-actions">
        ${serverMenuSectionsHTML(conn)}
      </div>`;
      return;
  }

  const rows = collectServerSettingsItems(conn);
  body.innerHTML = `
    <div class="channel-settings-sheet-actions sidebar-menu-actions">
      ${rows.map(sidebarMenuRowHTML).join("")}
    </div>`;
}

function serverMenuOverlayHandleBack() {
  const overlay = document.querySelector(".server-menu-overlay");
  if (!overlay) return false;
  const modals = document.querySelectorAll(".modal-backdrop");
  if (modals.length && modals[modals.length - 1] !== overlay) return false;
  if (_serverMenuPane !== "home") {
    showServerMenuPane("home");
    return true;
  }
  closeSidebarMenuSheet();
  return true;
}

let _serverMenuConnId = null;
function openServerMenuSheet(connOverride = null) {
  const conn = connOverride || (typeof activeConn === "function" ? activeConn() : null);
  if (!conn) return;
  _serverMenuConnId = conn.id || null;
  const title = (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn))
    ? "Personal space"
    : (conn?.name || conn?.hostName || "Server");
  _serverMenuHomeTitle = title;

  if (typeof cancelArmedSideNavTap === "function") cancelArmedSideNavTap();
  if (typeof suppressSideNavTaps === "function") suppressSideNavTaps(500);
  if (typeof closeUserProfileOverlay === "function") closeUserProfileOverlay();
  closeSidebarMenuSheet();

  const triggerEl = document.getElementById("side-server-menu-btn");
  const ico = serverMenuIco;
  const opened = typeof AshModal !== "undefined" && AshModal.open
    ? AshModal.open({
      className: "channel-settings-sheet sidebar-menu-sheet server-menu-overlay",
      attrs: { "data-sidebar-menu-trigger": "server" },
      html: `
        <div class="channel-settings-sheet-card server-menu-overlay-card" role="dialog" aria-modal="true" aria-labelledby="sidebar-server-menu-title">
          <div class="channel-settings-sheet-handle" aria-hidden="true"></div>
          <div class="channel-settings-sheet-head server-menu-overlay-head">
            <button type="button" class="server-menu-back" id="server-menu-back" hidden aria-label="Back">${ico("chevron-left")}</button>
            <h4 id="sidebar-server-menu-title" class="channel-settings-sheet-title" tabindex="-1">${esc(title)}</h4>
            <button type="button" class="server-menu-close" id="server-menu-close" aria-label="Close">${ico("x")}</button>
          </div>
          <div class="channel-settings-sheet-body" id="server-menu-body"></div>
        </div>`,
      singleton: "replace",
      graceMs: 450,
      closeOnEscape: false,
      closeOnBackdrop: true,
      trapFocus: true,
      restoreFocus: true,
      initialFocus: "#sidebar-server-menu-title",
      onClose: () => {
        _sidebarMenuSheetClose = null;
        _serverMenuPane = "home";
        _serverMenuConnId = null;
        setSidebarMenuTriggerExpanded(_sidebarMenuSheetTrigger, false);
        _sidebarMenuSheetTrigger = null;
      },
    })
    : null;
  if (!opened) return;

  const { overlay, close } = opened;
  _sidebarMenuSheetClose = close;
  _sidebarMenuSheetTrigger = triggerEl;
  setSidebarMenuTriggerExpanded(triggerEl, true);
  const card = overlay.querySelector(".server-menu-overlay-card");
  if (card && typeof bindChannelSettingsSheetDismiss === "function") {
    bindChannelSettingsSheetDismiss(overlay, card, close);
  }
  overlay.querySelector("#server-menu-close")?.addEventListener("click", (e) => {
    e.preventDefault();
    closeSidebarMenuSheet();
  });
  overlay.querySelector("#server-menu-back")?.addEventListener("click", (e) => {
    e.preventDefault();
    showServerMenuPane("home");
  });
  overlay.querySelector("#sidebar-server-menu-title")?.addEventListener("click", () => {
    if (_serverMenuPane !== "home") showServerMenuPane("home");
  });
  bindSidebarMenuRowKeys(overlay);
  bindServerMenuOverlayClicks(overlay);
  showServerMenuPane("home");
}

function openUserMenuSheet() {
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const items = collectUserMenuItems(conn);
  if (!items.length) return;
  const me = typeof loadMe === "function" ? loadMe() : null;
  const name = String(conn?.me?.name || me?.name || "").trim() || "You";
  openSidebarMenuSheet({
    title: name,
    labelledBy: "sidebar-user-menu-title",
    items,
    trigger: document.getElementById("side-user-menu-btn"),
    triggerKind: "user",
  });
}
