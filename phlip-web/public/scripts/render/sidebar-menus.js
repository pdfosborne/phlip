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
let _serverMenuFlush = null;
let _serverMenuCardHeight = 0;

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
    { key: "personal-settings", icon: "house", label: "Personal settings", title: "Personal space settings" },
    { key: "places", icon: "map-pin", label: "Places", title: "Your places and boards you follow" },
    { key: "appearance", icon: "palette", label: "Appearance", title: "Theme and card style" },
    { key: "sound", icon: "volume-2", label: "Sound", title: "Sound" },
    { key: "calendar-time", icon: "clock", label: "Calendar & time", title: "Day hours" },
    { key: "help", icon: "circle-question-mark", label: "Help & legal", title: "Legal, contact, and FAQs" },
  ];
}

function serverMenuUserIsHost(conn) {
  if (!conn) return false;
  if (conn.me?.isHost) return true;
  if (typeof effectiveRole === "function" && typeof ROLE_HOST !== "undefined"
      && effectiveRole(conn.me) === ROLE_HOST) return true;
  return typeof isHostedBridgeConn === "function" && isHostedBridgeConn(conn);
}

/** Community plus roles rows that used to live as separate one-control screens. */
function collectServerHomeSettingsItems(conn = activeConn()) {
  if (!conn) return [];
  const items = [];
  const personal = typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn);
  if (personal) return items;

  if (typeof canManageServer === "function" && canManageServer(conn)) {
    items.push({
      key: "places",
      icon: "map-pin",
      label: "Places",
      title: "Map links, duplicates, and pinned locations",
    });
    items.push({
      key: "drawings",
      icon: "edit",
      label: "Drawings",
      title: "Custom drawn icons and reactions",
    });
    items.push({
      key: "roles",
      icon: "user-shield",
      label: "Roles & permissions",
      title: "Default role, custom roles, and permissions",
    });
    items.push({
      key: "delete-boards",
      icon: "trash",
      label: "Delete boards",
      title: "Remove boards and their events, chat, and tasks",
      danger: true,
    });
  }
  if (typeof canSeeConsoleMeta === "function" && canSeeConsoleMeta(conn)) {
    items.push({
      key: "event-options",
      icon: "calendar",
      label: "Event & media rules",
      title: "Events, profile photos, drawing, and age rating",
    });
    items.push({
      key: "auto-delete",
      icon: "clock",
      label: "Auto-delete",
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
  if (typeof canSeeModerateMeta === "function" && canSeeModerateMeta(conn)) {
    const openReports = (S.reports || []).filter(r => r.status === "open").length;
    items.push({
      key: "moderate",
      icon: "shield",
      label: "Moderation & reports",
      badge: openReports || 0,
      title: openReports
        ? `${openReports} open report${openReports === 1 ? "" : "s"}`
        : "Open reports and the admin log",
    });
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
      label: "Server info & icon",
      title: "Description, staff, and server icon",
    });
    if (typeof isHostedBridgeConn === "function" && isHostedBridgeConn(conn)) {
      items.push({
        key: "server-data",
        icon: "database-backup",
        label: "Backup & restore",
        title: "Structure and full encrypted backups",
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
  const isHost = serverMenuUserIsHost(conn);
  if (!personal && isHost) {
    items.push({
      key: "delete-server",
      icon: "trash",
      label: "Delete server",
      title: "Permanently delete this server",
      danger: true,
    });
  } else if (conn.me && !personal && !isHost) {
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
  return collectServerHomeSettingsItems(conn).concat(collectServerOverlayListItems(conn));
}

const SERVER_MENU_SECTIONS = [
  { label: "Community", keys: ["members", "info", "places", "drawings"] },
  { label: "Roles & rules", keys: ["roles", "event-options", "moderate"] },
  { label: "Data & maintenance", keys: ["auto-delete", "server-data", "demo-users", "delete-boards"] },
  { label: "General", keys: ["hotspot-change-wifi", "help", "delete-server", "leave"] },
];
const SERVER_MENU_TAIL = [];

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

const SERVER_MENU_PANES = new Set([
  "members", "info", "places", "drawings", "roles", "event-options", "moderate",
  "auto-delete", "server-data", "demo-users", "delete-boards", "delete-server", "help",
  "personal-settings", "appearance", "sound", "calendar-time",
]);

const SERVER_MENU_PANE_TITLES = {
  members: "People",
  info: "Server info & icon",
  places: "Places",
  drawings: "Drawings",
  roles: "Roles & permissions",
  "event-options": "Event & media rules",
  moderate: "Moderation & reports",
  "auto-delete": "Auto-delete",
  "server-data": "Backup & restore",
  "demo-users": "Demo users",
  "delete-boards": "Delete boards",
  "delete-server": "Delete server",
  help: "Help & legal",
  "personal-settings": "Personal settings",
  appearance: "Appearance",
  sound: "Sound",
  "calendar-time": "Calendar & time",
};

function flushServerMenuEdits() {
  const fn = _serverMenuFlush;
  _serverMenuFlush = null;
  if (typeof fn === "function") {
    try { fn(); } catch (err) { console.error(err); }
  }
}

function clearServerMenuActions() {
  const actions = document.getElementById("server-menu-actions");
  if (!actions) return;
  actions.hidden = true;
  actions.innerHTML = "";
}

function serverMenuConn() {
  return (_serverMenuConnId && S.conns?.[_serverMenuConnId])
    || (typeof activeConn === "function" ? activeConn() : null);
}

function serverMenuSectionLabel(root, text) {
  const el = document.createElement("div");
  el.className = "people-section-label";
  el.textContent = text;
  root.appendChild(el);
}

function mountServerMenuConsole(body, conn, fills) {
  body.innerHTML = `<div class="console-sections" id="server-menu-console"></div>`;
  const root = body.querySelector("#server-menu-console");
  for (const fill of fills) {
    if (fill.label) serverMenuSectionLabel(root, fill.label);
    if (typeof fill.fn === "function") fill.fn(root, conn);
  }
}

function mountServerInfoPane(body, conn) {
  if (typeof renderServerInfo === "function") renderServerInfo(body, conn);
  if (typeof canManageServer !== "function" || !canManageServer(conn)) return;
  if (typeof mountServerIconControls !== "function") return;
  const slot = document.createElement("div");
  slot.className = "server-info-section";
  const label = document.createElement("div");
  label.className = "people-section-label";
  label.textContent = "Server icon";
  slot.appendChild(label);
  const editor = document.createElement("div");
  slot.appendChild(editor);
  const wrap = body.querySelector(".events-wrap") || body;
  const firstSection = wrap.querySelector(".server-info-section");
  if (firstSection) wrap.insertBefore(slot, firstSection);
  else wrap.prepend(slot);
  mountServerIconControls(editor, conn);
}

function mountServerHelpPane(body) {
  const row = (act, title, sub) => `
    <button type="button" class="ch-manage-btn sidebar-menu-row" data-help-act="${act}">
      <span class="sidebar-menu-row-main"><span class="sidebar-menu-row-label">${title}<br><span class="muted">${sub}</span></span></span>
    </button>`;
  body.innerHTML = `
    <p class="empty-note" style="margin:0 0 10px">FAQs, how to reach the developers, and Phlip’s legal documents.</p>
    <div class="channel-settings-sheet-actions sidebar-menu-actions">
      ${row("legal", "Legal", "Terms, moderation, privacy, and licence")}
      ${row("contact", "Contact &amp; Bug Report", "Reach the developers or report a bug")}
      ${row("help", "Help", "FAQs on phlipapp.com")}
    </div>`;
  body.querySelectorAll("[data-help-act]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const act = btn.getAttribute("data-help-act");
      if (act === "help" && typeof openPhlipHelpFaqs === "function") openPhlipHelpFaqs();
      else if (act === "contact" && typeof openPhlipDocsModal === "function") openPhlipDocsModal("contact");
      else if (typeof openPhlipDocsModal === "function") openPhlipDocsModal("legal");
    });
  });
}

function mountDeleteServerPane(body, conn) {
  const hosted = typeof isHostedBridgeConn === "function" && isHostedBridgeConn(conn);
  const name = conn?.name || conn?.hostName || "this server";
  body.innerHTML = `
    <div class="server-menu-danger">
      <p>${hosted
        ? `Delete “${esc(name)}” from this phone. This cannot be undone.`
        : `Remove “${esc(name)}” from this device. This cannot be undone.`}</p>
      <ul>
        ${hosted
          ? `<li>The hosted server, its members, and join links</li>
             <li>Boards, events, chat, places, and drawings stored with it</li>`
          : `<li>This server’s local copy on this device</li>
             <li>Cached plans, chat, and settings kept only here</li>`}
      </ul>
      <label class="field" for="server-delete-confirm">Type DELETE to confirm
        <input id="server-delete-confirm" maxlength="16" autocomplete="off" placeholder="DELETE">
      </label>
      <button type="button" class="danger" id="server-delete-go">Delete server</button>
    </div>`;
  body.querySelector("#server-delete-go")?.addEventListener("click", () => {
    const typed = String(body.querySelector("#server-delete-confirm")?.value || "").trim().toUpperCase();
    if (typed !== "DELETE") {
      toast("Type DELETE to confirm");
      return;
    }
    if (hosted) {
      const rawId = String(conn?.id || "").replace(/^srv-local-/, "");
      if (typeof hostCall === "function") hostCall("deleteHostedServer", rawId);
      toast("Server deleted");
      closeSidebarMenuSheet();
      setTimeout(() => { try { readHostStatus(); } catch {} }, 300);
      return;
    }
    const id = conn?.id;
    try { if (typeof disconnectConn === "function") disconnectConn(conn); } catch {}
    try { if (id && S.conns) delete S.conns[id]; } catch {}
    try { if (id && typeof removeServerEntry === "function") removeServerEntry(id); } catch {}
    if (id && S.activeConnId === id) {
      const fallback = (typeof railConnIds === "function" ? railConnIds() : []).find(x => x !== id)
        || (typeof isServedOrigin === "function" && isServedOrigin() ? null : "personal");
      if (fallback && typeof switchConn === "function") switchConn(fallback);
      else try { renderRail(); } catch {}
    } else {
      try { renderRail(); } catch {}
    }
    toast("Server removed from this device");
    closeSidebarMenuSheet();
  });
}

function mountServerMenuPaneBody(pane, body, conn) {
  if (pane === "members" && typeof renderMembersView === "function") {
    renderMembersView(body, { panel: true });
    return;
  }
  if (pane === "info") {
    mountServerInfoPane(body, conn);
    return;
  }
  if (pane === "places" && typeof openPlacesManagerBody === "function") {
    _serverMenuFlush = openPlacesManagerBody(conn, body) || null;
    return;
  }
  if (pane === "drawings" && typeof openDrawingsManagerBody === "function") {
    openDrawingsManagerBody(conn, body);
    return;
  }
  if (pane === "roles") {
    body.innerHTML = `
      <div id="server-menu-default-role" class="console-sections"></div>
      <div id="server-menu-roles"></div>`;
    if (typeof canSeeConsoleMeta === "function" && canSeeConsoleMeta(conn)
        && typeof fillConsoleDefaultRole === "function") {
      fillConsoleDefaultRole(body.querySelector("#server-menu-default-role"), conn);
    }
    if (typeof mountRolesEditor === "function") mountRolesEditor(body.querySelector("#server-menu-roles"), conn);
    return;
  }
  if (pane === "event-options") {
    mountServerMenuConsole(body, conn, [
      { label: "Events", fn: typeof fillConsoleEventsSettings === "function" ? fillConsoleEventsSettings : null },
      { label: "Profiles & media", fn: typeof fillConsoleProfilesMedia === "function" ? fillConsoleProfilesMedia : null },
      { label: "Access", fn: typeof fillConsoleAccessControl === "function" ? fillConsoleAccessControl : null },
    ]);
    return;
  }
  if (pane === "moderate" && typeof mountModeratePanel === "function") {
    mountModeratePanel(body);
    return;
  }
  if (pane === "auto-delete") {
    mountServerMenuConsole(body, conn, [
      { fn: typeof fillConsoleAutoDelete === "function" ? fillConsoleAutoDelete : null },
    ]);
    return;
  }
  if (pane === "server-data" && typeof fillHostedServerDataSettingsBody === "function") {
    try { _hostedServerSettingsId = String(conn?.id || "").replace(/^srv-local-/, ""); } catch {}
    fillHostedServerDataSettingsBody(body);
    return;
  }
  if (pane === "demo-users") {
    mountServerMenuConsole(body, conn, [
      { fn: typeof fillConsoleDemoUsers === "function" ? fillConsoleDemoUsers : null },
    ]);
    return;
  }
  if (pane === "delete-boards" && typeof mountDeleteBoardsPane === "function") {
    mountDeleteBoardsPane(body, conn);
    return;
  }
  if (pane === "delete-server") {
    mountDeleteServerPane(body, conn);
    return;
  }
  if (pane === "help") {
    mountServerHelpPane(body);
    return;
  }
  if (pane === "personal-settings" && typeof mountUserPersonalSpaceSettings === "function") {
    mountUserPersonalSpaceSettings(body, { close: closeSidebarMenuSheet });
    return;
  }
  if (pane === "appearance") {
    if (typeof openCosmeticsModal === "function") {
      openCosmeticsModal({ root: body });
      _serverMenuFlush = typeof body._ashCosmeticsFlush === "function" ? body._ashCosmeticsFlush : null;
    } else {
      body.innerHTML = `<p class="empty-note">Appearance settings aren’t available in this build.</p>`;
    }
    return;
  }
  if (pane === "sound" && typeof mountUserSoundSettings === "function") {
    mountUserSoundSettings(body);
    return;
  }
  if (pane === "calendar-time" && typeof mountUserOtherSettings === "function") {
    mountUserOtherSettings(body);
  }
}

function runServerOverlayAction(key) {
  if (key === "settings") {
    showServerMenuPane("home");
    return;
  }
  if (SERVER_MENU_PANES.has(key)) {
    showServerMenuPane(key);
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

  flushServerMenuEdits();
  clearServerMenuActions();

  _serverMenuPane = pane || "home";
  const isHome = _serverMenuPane === "home";
  if (back) back.hidden = isHome;
  if (title) title.textContent = isHome ? _serverMenuHomeTitle : (SERVER_MENU_PANE_TITLES[_serverMenuPane] || "Settings");
  body.innerHTML = "";
  body.style.cssText = "";
  body.classList.remove("deck-editor-side-body");

  const conn = serverMenuConn();
  if (isHome) {
    const personal = typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn);
    body.innerHTML = `
      <div class="channel-settings-sheet-actions sidebar-menu-actions">
        ${personal
          ? collectPersonalSpaceMenuItems().map(sidebarMenuRowHTML).join("")
          : serverMenuSectionsHTML(conn)}
      </div>`;
    applyServerMenuCardHeight();
    return;
  }

  try {
    mountServerMenuPaneBody(_serverMenuPane, body, conn);
  } catch (err) {
    console.error(err);
    body.innerHTML = `<p class="empty-note">${esc(err?.message || "Couldn’t open this setting")}</p>`;
  }
  applyServerMenuCardHeight();
}

/** Keep every pane as tall as the home menu so the sheet doesn’t jump shorter. */
function applyServerMenuCardHeight() {
  const card = document.querySelector(".server-menu-overlay-card");
  if (!card) return;
  if (!_serverMenuCardHeight) {
    card.style.height = "";
    const h = Math.round(card.getBoundingClientRect().height);
    if (h > 80) _serverMenuCardHeight = h;
  }
  if (_serverMenuCardHeight) card.style.height = `${_serverMenuCardHeight}px`;
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
            <span class="server-menu-actions" id="server-menu-actions" hidden></span>
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
        flushServerMenuEdits();
        _serverMenuCardHeight = 0;
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
  const closeSheet = () => {
    flushServerMenuEdits();
    close();
  };
  if (typeof overlay._ashModalClose === "function") overlay._ashModalClose = closeSheet;
  _sidebarMenuSheetClose = closeSheet;
  _sidebarMenuSheetTrigger = triggerEl;
  setSidebarMenuTriggerExpanded(triggerEl, true);
  const card = overlay.querySelector(".server-menu-overlay-card");
  if (card && typeof bindChannelSettingsSheetDismiss === "function") {
    bindChannelSettingsSheetDismiss(overlay, card, closeSheet);
  }
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) flushServerMenuEdits();
  }, true);
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
