/* channel-panel.js — open/close/sync/render right channel panel.
 * Globals out: openChannelPanel, closeChannelPanel, syncChannelPanel, renderChannelPanel,
 *   openChannelActivityPopup, …
 * Load after: channel-panel-state.js, channel-access.js
 */

/**
 * Default right-panel tab when opening without an explicit opts.tab.
 * My calendar everywhere. Chat lives on the event sheet.
 */
function defaultChannelPanelTab(
  personal = PersonalSpace.isPersonal(activeConn()),
  ch = (typeof activeChannelForPanel === "function" ? activeChannelForPanel() : null),
) {
  return "calendar";
}

function openChannelPanel(ch, mode = "info") {
  const channelId = ch?.id || activeChannelForPanel()?.id || null;
  openChannelPanelMode("info", channelId);
}

/** Open the right panel on My calendar (all servers). */
function openActiveEventOrChannelPanel() {
  const ch = typeof activeChannelForPanel === "function" ? activeChannelForPanel() : null;
  if (typeof clearPanelEventChatFilter === "function") clearPanelEventChatFilter();
  openChannelPanelMode("info", ch?.id || null, { tab: "calendar" });
}

/** Open the right-edge panel. Tabs: calendar | events | chat | description | memories | people | notifications.
 *  Legacy "notes" maps to Description. Activity opens as a popup. */
function openChannelPanelMode(mode = "info", channelId = null, opts = {}) {
  // Host settings / setup live in the left sidebar overlay — never the right panel.
  if (mode === "host" || mode === "hostSetup") {
    if (typeof openHostSettingsPanel === "function") openHostSettingsPanel(mode);
    return;
  }
  closeNav();
  if (!opts.conflict && typeof calendarClearConflictCheck === "function") {
    calendarClearConflictCheck();
  }
  // openEventChatFiltered passes opts.eventId — keep that filter; otherwise clear sticky scope.
  if (!opts.eventId && typeof clearPanelEventChatFilter === "function") {
    clearPanelEventChatFilter();
  }
  let id = channelId || activeChannelForPanel()?.id || null;
  // If the requested channel isn't on the active conn, fall back so open isn't a silent no-op.
  if (id && !(group()?.channels || []).some(c => c.id === id)) {
    const fallback = activeChannelForPanel()?.id || null;
    if (fallback) id = fallback;
  }
  const conn = activeConn();
  const personal = PersonalSpace.isPersonal(conn);
  const panelCh = (id && (group()?.channels || []).find(c => c.id === id))
    || (typeof activeChannelForPanel === "function" ? activeChannelForPanel() : null);

  if (opts.tab === "activity" && !personal) {
    const sid = panelCh?.id || id;
    if (sid && typeof openChannelActivityPopup === "function") {
      // Still open the panel on a sensible feed tab underneath.
      opts = { ...opts, tab: defaultChannelPanelTab(personal, panelCh) };
      // Fall through to open panel, then popup after.
      const afterOpen = () => {
        if (typeof openChannelActivityPopup === "function") openChannelActivityPopup(sid);
      };
      // Defer popup until panel open completes below.
      queueMicrotask(afterOpen);
    }
  }

  let tab = defaultChannelPanelTab(personal, panelCh);
  const wantTab = opts.tab || null;
  if (wantTab === "details" || wantTab === "settings" || wantTab === "activity") {
    tab = defaultChannelPanelTab(personal, panelCh);
  } else if (wantTab === "calendar") {
    tab = wantTab;
  } else if (wantTab === "people" || wantTab === "events" || wantTab === "notes" || wantTab === "description" || wantTab === "memories"
      || wantTab === "notifications" || wantTab === "chat" || wantTab === "info") {
    tab = defaultChannelPanelTab(personal, panelCh);
  }
  if (personal && (tab === "chat" || tab === "activity" || tab === "events"
      || tab === "people" || tab === "notifications" || tab === "description" || tab === "memories")) {
    tab = "calendar";
  }
  // Events tab is hosted chat only.
  if (tab === "events" && (personal || (typeof isChatKindChannel === "function" && !isChatKindChannel(panelCh)))) {
    tab = defaultChannelPanelTab(personal, panelCh);
  }
  // Chat is the event pull-up, not the sidebar.
  if (tab === "chat") {
    tab = defaultChannelPanelTab(personal, panelCh);
  }
  // The right panel is My calendar only.
  if (tab === "people" || tab === "events") tab = "calendar";
  // Keep feed sub-state aligned with the panel tab.
  if (typeof normalizeEdcTab === "function" && normalizeEdcTab(tab)) {
    S._edcTab = normalizeEdcTab(tab);
  } else if (tab === "chat") {
    S._edcTab = "chat";
  }
  if (S._edcTab === "notes") S._edcTab = "description";
  if (S._edcTab === "activity") S._edcTab = "chat";
  if (tab === "calendar" && !opts.conflict && typeof calendarSyncFromTimeline === "function") {
    const creating = typeof createDraftPending === "function" && createDraftPending();
    const picking = typeof calendarIsPickDateMode === "function" && calendarIsPickDateMode();
    if (!creating && !picking) calendarSyncFromTimeline();
  }
  channelPanelState = { channelId: id, mode: "info", tab, peopleSub: "server" };
  const panel = document.getElementById("channel-panel");
  const app = document.getElementById("app");
  renderChannelPanel(true);
  // renderChannelPanel may clear a missing channelId — recover before the open rAF.
  if (!channelPanelState.channelId) {
    const recovered = activeChannelForPanel()?.id || null;
    if (recovered) channelPanelState.channelId = recovered;
  }
  if (panel) {
    panel.setAttribute("aria-hidden", "false");
    const label = channelPanelState.tab === "memories" ? "Memories"
      : channelPanelState.tab === "people" ? "People"
      : channelPanelState.tab === "notifications" ? "Notifications"
      : channelPanelState.tab === "description" ? "Description"
      : channelPanelState.tab === "events" ? "Events"
      : channelPanelState.tab === "calendar" ? "My calendar"
      : "My calendar";
    panel.setAttribute("aria-label", label);
  }
  // Paint closed (off-screen) first, then slide in. Token so a quick close
  // before the rAF can't re-add channel-panel-open (would leave .main with
  // pointer-events:none and hide the card hand with the panel off-screen).
  if (channelPanelState.tab === "calendar") {
    syncCalendarDrawerFrame();
    wireCalendarDrawerFrame();
  }
  const openToken = ++_channelPanelOpenToken;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (openToken !== _channelPanelOpenToken) return;
      // Prefer opening with content; empty Chat shell beats a silent no-op.
      if (panel?.classList.contains("is-calendar-drawer")) syncCalendarDrawerFrame();
      app?.classList.add("channel-panel-open");
      if (panel?.classList.contains("is-calendar-drawer")) {
        app?.classList.add("calendar-drawer-open");
      }
      syncChannelInfoBtn();
    });
  });
  suppressChannelPanelDismissUntil = performance.now() + 450;
  try { _channelPanelPtrIds.clear(); } catch {}
  const ae = document.activeElement;
  if (ae && ae.closest?.("#view > .composer, #channel-panel")) try { ae.blur(); } catch {}
}

function closeChannelPanel() {
  const app = document.getElementById("app");
  const panel = document.getElementById("channel-panel");
  _channelPanelOpenToken++;
  if (typeof calendarExitPickDateMode === "function") calendarExitPickDateMode();
  // Drop IME when the sidebar closes — blur alone is flaky in the WebView.
  try {
    const ae = document.activeElement;
    if (ae && ae.closest?.("#channel-panel, #view > .composer")) ae.blur();
  } catch {}
  try {
    panel?.querySelectorAll("input, textarea, [contenteditable='true']").forEach((el) => {
      try { el.blur(); } catch {}
    });
  } catch {}
  try { window.AshNative?.hideKeyboard?.(); } catch {}
  app?.classList.remove("channel-panel-open");
  if (panel?.classList.contains("is-calendar-drawer")) {
    const closeToken = _channelPanelOpenToken;
    let settled = false;
    const finishCalendarDrawer = () => {
      if (settled || closeToken !== _channelPanelOpenToken || Panel.channelOpen()) return;
      settled = true;
      panel.classList.remove("is-calendar-drawer");
      app?.classList.remove("calendar-drawer-open");
    };
    panel.addEventListener("transitionend", (ev) => {
      if (ev.target === panel && ev.propertyName === "transform") finishCalendarDrawer();
    });
    setTimeout(finishCalendarDrawer, 400);
  } else {
    app?.classList.remove("calendar-drawer-open");
    panel?.classList.remove("is-calendar-drawer");
  }
  if (panel) panel.setAttribute("aria-hidden", "true");
  channelPanelState = { channelId: null, mode: "info", tab: "calendar", peopleSub: "server" };
  S._edcTab = "chat";
  _channelPanelFrozenKey = null;
  if (typeof calendarClearConflictCheck === "function") calendarClearConflictCheck();
  if (typeof clearPanelEventChatFilter === "function") clearPanelEventChatFilter();
  try { window.OnboardingBus?.emit?.("panel:close", {}); } catch {}
  syncChannelInfoBtn();
  queueMicrotask(() => {
    if (Panel.channelOpen()) return;
    flushDeferredViewRender();
  });
}

/** Refresh open panel after sync / navigate; close if channel gone. */
function syncChannelPanel() {
  if (!Panel.channelOpen()) {
    syncChannelInfoBtn();
    return;
  }
  // Server / host settings live in the left sidebar overlay — not channel-scoped.
  if (channelPanelState.mode === "server-settings"
      || channelPanelState.mode === "host"
      || channelPanelState.mode === "hostSetup") {
    channelPanelState.mode = "info";
  }
  const active = activeChannelForPanel();
  if (channelPanelState.channelId) {
    const still = (group()?.channels || []).find(c => c.id === channelPanelState.channelId);
    if (!still) {
      channelPanelState.channelId = active?.id || null;
      channelPanelState.mode = "info";
    } else if (active && active.id !== channelPanelState.channelId) {
      channelPanelState.channelId = active.id;
      channelPanelState.mode = "info";
    }
  } else if (active) {
    channelPanelState.channelId = active.id;
  }
  // Description with an event filter remounts the event feed. Chat keeps
  // the channel shell (same message styling as unfiltered) and refreshes below.
  if (typeof isPanelFeedTab === "function" && isPanelFeedTab(channelPanelState.tab)
      && S.chatFilterEventId
      && channelPanelState.tab !== "chat"
      && typeof refreshPanelEventFeed === "function") {
    if (!refreshPanelEventFeed(S.chatFilterEventId)) {
      renderChannelPanel(true);
    } else {
      syncChannelPanelNotifBadge();
    }
    syncChannelInfoBtn();
    return;
  }
  if (channelPanelState.tab === "chat" && channelPanelState.channelId
      && typeof refreshActiveChatIncrementally === "function") {
    if (!refreshActiveChatIncrementally(channelPanelState.channelId)) {
      renderChannelPanel(true);
    } else {
      syncChannelPanelNotifBadge();
    }
    syncChannelInfoBtn();
    return;
  }
  if (channelPanelState.tab === "description"
      || channelPanelState.tab === "memories"
      || channelPanelState.tab === "people"
      || channelPanelState.tab === "notifications"
      || channelPanelState.tab === "events"
      || channelPanelState.tab === "calendar") {
    renderChannelPanel(true);
    syncChannelInfoBtn();
    return;
  }
  renderChannelPanel();
  syncChannelInfoBtn();
}

/** Unread badge on the panel Notifications icon tab (without remounting the body). */
function syncChannelPanelNotifBadge() {
  const notifTab = document.getElementById("channel-panel-tab-notifications");
  if (!notifTab || typeof ic !== "function") return;
  const unread = (S.notifications || []).filter(n => !n.read).length;
  notifTab.innerHTML = `${ic("bell")}${unread ? `<span class="channel-panel-tab-badge">${unread > 99 ? "99+" : unread}</span>` : ""}`;
  notifTab.title = unread ? `Notifications · ${unread} unread` : "Notifications";
  notifTab.setAttribute("aria-label", unread ? `Notifications, ${unread} unread` : "Notifications");
}

/** Remount People / Notifications panel tabs after member or notif sync. */
function refreshChannelPanelMetaTabs() {
  if (!Panel.channelOpen()) {
    syncChannelPanelNotifBadge();
    return;
  }
  if (channelPanelState.tab === "people"
      || channelPanelState.tab === "notifications") {
    renderChannelPanel(true);
    return;
  }
  syncChannelPanelNotifBadge();
}

/** Fit My calendar to the main column, under the top bar. */
function syncCalendarDrawerFrame() {
  const head = document.querySelector(".main-head");
  const main = document.querySelector(".main");
  if (!head || !main) return;
  const headBox = head.getBoundingClientRect();
  const mainBox = main.getBoundingClientRect();
  const root = document.documentElement;
  root.style.setProperty("--calendar-top", Math.max(0, Math.round(headBox.bottom)) + "px");
  root.style.setProperty("--calendar-left", Math.max(0, Math.round(mainBox.left)) + "px");
  root.style.setProperty("--calendar-right", Math.max(0, Math.round(window.innerWidth - mainBox.right)) + "px");
}

function wireCalendarDrawerFrame() {
  if (wireCalendarDrawerFrame.wired) return;
  wireCalendarDrawerFrame.wired = true;
  window.addEventListener("resize", () => {
    if (!document.getElementById("app")?.classList.contains("calendar-drawer-open")) return;
    syncCalendarDrawerFrame();
  });
}

function syncChannelInfoBtn() {
  const btn = document.getElementById("channel-info-btn");
  if (!btn) return;
  // Only when a channel is in scope — without one, openChannelPanelMode
  // refuses to open (info with no channelId), so the button would do nothing
  // on Settings / Notifications / People / Moderate / decks / etc.
  // Event chat keeps the button: the same top bar opens My calendar there too.
  btn.hidden = !activeChannelForPanel();
  btn.classList.toggle("on", Panel.channelOpen());
  btn.setAttribute("aria-pressed", Panel.channelOpen() ? "true" : "false");

  btn.classList.remove("has-unread");
  btn.dataset.unreadCount = "";
  btn.setAttribute("aria-label", "My calendar");
  btn.title = "My calendar";
  btn.dataset.btnMode = "calendar";
  btn.innerHTML = typeof ic === "function" ? ic("calendar-days") : "";
}

/** Channel used for the Chat tab (event group or plain chat in panel scope). */

function runAppSettingsAction(act) {
  const native = (screen) => {
    try {
      if (window.AshNative?.openAppSettings) {
        AshNative.openAppSettings(screen);
        return true;
      }
    } catch { /* fall through */ }
    return false;
  };
  if (act === "dayHours") {
    closeChannelPanel();
    if (typeof openDayHoursModal === "function") openDayHoursModal();
    return;
  }
  if (act === "support") {
    if (native("support")) { closeChannelPanel(); return; }
    closeChannelPanel();
    if (typeof openSupportSheet === "function") openSupportSheet();
    return;
  }
  if (act === "legal") {
    if (native("legal")) { closeChannelPanel(); return; }
    closeChannelPanel();
    if (typeof openPhlipDocsModal === "function") openPhlipDocsModal("legal");
    return;
  }
  if (act === "contact") {
    if (native("contact")) { closeChannelPanel(); return; }
    closeChannelPanel();
    if (typeof openPhlipDocsModal === "function") openPhlipDocsModal("contact");
    return;
  }
  if (act === "help") {
    if (native("help")) { closeChannelPanel(); return; }
    closeChannelPanel();
    if (typeof openPhlipHelpFaqs === "function") openPhlipHelpFaqs();
  }
}

function appSettingsLinksHTML() {
  // Day hours → User settings. Hosting is per-server (reach line), not a hub here.
  const chips = [
    { act: "support", label: "Support" },
    { act: "legal", label: "Legal" },
    { act: "contact", label: "Contact" },
    { act: "help", label: "Help" },
  ];
  return `
    <div class="channel-panel-section-label">App</div>
    <div class="channel-panel-app-links">
      ${chips.map(r => `
        <button type="button" class="channel-panel-link" data-app-act="${esc(r.act)}">${esc(r.label)}</button>`).join("")}
    </div>`;
}

function wireAppSettingsLinks(root) {
  // Clicks handled by ensureChannelPanelTaps (pointerup) — keep for keyboard fallback.
  root?.querySelectorAll("[data-app-act]").forEach((btn) => {
    btn.onclick = null;
  });
}

function renderChannelPanelAppFooter(show) {
  const appFoot = document.getElementById("channel-panel-app");
  if (!appFoot) return;
  if (!show) {
    appFoot.hidden = true;
    appFoot.innerHTML = "";
    return;
  }
  appFoot.hidden = false;
  appFoot.innerHTML = "";

  // Shared servers: server URL, join code, and invite icon in the Server section.
  const conn = activeConn();
  const personal = PersonalSpace.isPersonal(conn);
  if (conn && !personal && typeof mountServerShareBlock === "function") {
    mountServerShareBlock(appFoot, conn, {
      idPrefix: "cp",
      actions: false,
      inviteIcon: typeof canInviteToGroup === "function" && canInviteToGroup(conn),
      inviteChannelId: channelPanelState.channelId || null,
    });
  }

  const appWrap = document.createElement("div");
  appWrap.innerHTML = appSettingsLinksHTML();
  while (appWrap.firstChild) appFoot.appendChild(appWrap.firstChild);
  wireAppSettingsLinks(appFoot);
}

/** Swipe left on the server drawer closes it (mirror of left-edge → open). */

function renderChannelPanel(force = false) {
  const open = Panel.channelOpen();
  const key = channelPanelRenderKey();
  // While open, skip full rebuilds from sync storms (same as left drawer).
  if (!force && open && key === _channelPanelFrozenKey) {
    _channelPanelRenderQueued = true;
    return;
  }
  if (!force && _channelPanelPtrIds.size > 0) {
    _channelPanelRenderQueued = true;
    return;
  }
  _channelPanelFrozenKey = key;
  _channelPanelRenderQueued = false;

  const panel = document.getElementById("channel-panel");
  const body = document.getElementById("channel-panel-body");
  const titleEl = document.getElementById("channel-panel-title");
  const backBtn = document.getElementById("channel-panel-back");
  if (!panel || !body) return;

  body.classList.remove("server-settings-body", "host-settings-body");
  // Chat event-feed mode zeros padding + locks overflow — always clear before
  // remounting other tabs (Settings/People/etc.) or the form can't scroll.
  body.classList.remove("channel-panel-body-event-feed");
  // People / Notifications set inline flex styles on the body — clear so Settings
  // keeps normal block flow, padding, and a single vertical scroll.
  try { body.style.cssText = ""; } catch {}

  // Host settings moved to the left sidebar overlay — never render here.
  if (channelPanelState.mode === "host" || channelPanelState.mode === "hostSetup") {
    channelPanelState.mode = "info";
  }

  const ch = channelPanelState.channelId
    ? (group()?.channels || []).find(c => c.id === channelPanelState.channelId)
    : null;
  if (channelPanelState.channelId && !ch) {
    const fallback = activeChannelForPanel();
    channelPanelState.channelId = fallback?.id || null;
    channelPanelState.mode = "info";
  }

  // Always use tab-based info mode (Settings is a tab, not a nested mode).
  channelPanelState.mode = "info";
  _channelPanelFrozenKey = channelPanelRenderKey();

  if (backBtn) {
    backBtn.hidden = true;
    backBtn.onclick = null;
  }

  const conn = activeConn();
  const personal = PersonalSpace.isPersonal(conn);
  const chatKind = isChatKindChannel(ch);

  // Normalize legacy tab ids. Settings is gone; activity is a popup.
  if (channelPanelState.tab === "details" || channelPanelState.tab === "settings") {
    channelPanelState.tab = defaultChannelPanelTab(personal, ch);
  }
  if (channelPanelState.tab === "activity") {
    const sid = ch?.id || channelPanelState.channelId;
    channelPanelState.tab = defaultChannelPanelTab(personal, ch);
    if (sid && !personal && typeof openChannelActivityPopup === "function") {
      queueMicrotask(() => openChannelActivityPopup(sid));
    }
  }
  if (channelPanelState.tab === "notes") channelPanelState.tab = defaultChannelPanelTab(personal, ch);
  if (S._edcTab === "notes") S._edcTab = "description";
  // Keep feed state aligned with the selected panel tab.
  if (typeof normalizeEdcTab === "function" && normalizeEdcTab(channelPanelState.tab)) {
    S._edcTab = normalizeEdcTab(channelPanelState.tab);
  }

  if (channelPanelState.tab === "people" || channelPanelState.tab === "events") channelPanelState.tab = "calendar";
  if (channelPanelState.tab === "info") channelPanelState.tab = "calendar";
  if (personal && (channelPanelState.tab === "chat" || channelPanelState.tab === "activity"
      || channelPanelState.tab === "events" || channelPanelState.tab === "settings"
      || channelPanelState.tab === "description" || channelPanelState.tab === "memories"
      || channelPanelState.tab === "notifications")) {
    channelPanelState.tab = "calendar";
  }
  if (channelPanelState.tab === "events" && (personal || !chatKind)) {
    channelPanelState.tab = defaultChannelPanelTab(personal, ch);
  }
  if (channelPanelState.tab === "chat") {
    channelPanelState.tab = defaultChannelPanelTab(personal, ch);
  }
  if (channelPanelState.tab === "description" || channelPanelState.tab === "memories"
      || channelPanelState.tab === "notifications") {
    channelPanelState.tab = defaultChannelPanelTab(personal, ch);
  }
  if (!["people", "events", "calendar"].includes(channelPanelState.tab)) {
    channelPanelState.tab = defaultChannelPanelTab(personal, ch);
  }

  const tabsEl = document.getElementById("channel-panel-tabs");
  const tabsTopEl = document.getElementById("channel-panel-tabs-top");
  const memoriesTab = document.getElementById("channel-panel-tab-memories");
  if (memoriesTab) memoriesTab.hidden = true;
  const activityTab = document.getElementById("channel-panel-tab-activity");
  if (activityTab) activityTab.hidden = true;
  const descriptionTab = document.getElementById("channel-panel-tab-description");
  if (descriptionTab) descriptionTab.hidden = true;
  const chatTab = document.getElementById("channel-panel-tab-chat");
  if (chatTab) chatTab.hidden = true;
  const eventsTab = document.getElementById("channel-panel-tab-events");
  if (eventsTab) eventsTab.hidden = true;
  const calendarTab = document.getElementById("channel-panel-tab-calendar");
  if (calendarTab) calendarTab.hidden = channelPanelState.tab === "calendar";
  const peopleTab = document.getElementById("channel-panel-tab-people");
  if (peopleTab) peopleTab.hidden = true;
  const settingsTab = document.getElementById("channel-panel-tab-settings");
  if (settingsTab) settingsTab.hidden = true;
  const infoTab = document.getElementById("channel-panel-tab-info");
  if (infoTab) infoTab.hidden = true;
  const notifTabEarly = document.getElementById("channel-panel-tab-notifications");
  if (notifTabEarly) notifTabEarly.hidden = true;
  if (tabsEl) tabsEl.hidden = !eventsTab || eventsTab.hidden;
  const tabIcons = {
    chat: { icon: "message", label: "Chat" },
    events: { icon: "ticket", label: "Events" },
    description: { icon: "note", label: "Description" },
    memories: { icon: "rotate-ccw-clock", label: "Memories" },
    people: { icon: "users", label: "People" },
    calendar: { icon: "calendar-days", label: "My calendar" },
  };
  for (const [id, meta] of Object.entries(tabIcons)) {
    const btn = document.getElementById(`channel-panel-tab-${id}`);
    if (!btn || btn.hidden) continue;
    btn.innerHTML = ic(meta.icon);
    btn.title = meta.label;
    btn.setAttribute("aria-label", meta.label);
  }
  // Notifications tab — bell + unread badge on every server (and personal).
  const notifTab = document.getElementById("channel-panel-tab-notifications");
  if (notifTab && !notifTab.hidden) {
    const unread = (S.notifications || []).filter(n => !n.read).length;
    notifTab.innerHTML = `${ic("bell")}${unread ? `<span class="channel-panel-tab-badge">${unread > 99 ? "99+" : unread}</span>` : ""}`;
    notifTab.title = unread ? `Notifications · ${unread} unread` : "Notifications";
    notifTab.setAttribute("aria-label", unread ? `Notifications, ${unread} unread` : "Notifications");
  }
  const panelEl = document.getElementById("channel-panel");
  panelEl?.querySelectorAll("[data-panel-tab]").forEach((btn) => {
    const id = btn.getAttribute("data-panel-tab");
    if (btn.hidden) {
      btn.setAttribute("aria-selected", "false");
      return;
    }
    btn.setAttribute("aria-selected", channelPanelState.tab === id ? "true" : "false");
  });
  if (tabsTopEl) {
    const topVisible = [...tabsTopEl.querySelectorAll("[data-panel-tab]")].some((btn) => !btn.hidden);
    tabsTopEl.hidden = !topVisible;
  }
  if (titleEl) {
    const labels = {
      chat: "Chat",
      events: "Events",
      description: "Description",
      memories: "Memories",
      people: "People",
      notifications: "Notifications",
      calendar: "My calendar",
    };
    titleEl.hidden = false;
    titleEl.textContent = labels[channelPanelState.tab] || "Channel";
  }
  const subEl = document.getElementById("channel-panel-sub");
  if (subEl) {
    const onCalendar = channelPanelState.tab === "calendar";
    subEl.hidden = !onCalendar;
    if (onCalendar) subEl.textContent = "All your accepted events";
  }

  const feedTab = (typeof normalizeEdcTab === "function" && normalizeEdcTab(channelPanelState.tab)) || null;
  const onFeedTab = !!feedTab;
  body.classList.toggle("channel-panel-body-chat", onFeedTab);
  body.classList.toggle("channel-panel-body-memories", channelPanelState.tab === "memories");
  body.classList.toggle("channel-panel-body-people", channelPanelState.tab === "people");
  body.classList.toggle("channel-panel-body-settings", false);
  body.classList.toggle("channel-panel-body-notifications", channelPanelState.tab === "notifications");
  body.classList.toggle("channel-panel-body-events", channelPanelState.tab === "events");
  body.classList.toggle("channel-panel-body-calendar", channelPanelState.tab === "calendar");
  if (channelPanelState.tab === "calendar") panel.classList.add("is-calendar-drawer");
  const appEl = document.getElementById("app");
  if (appEl?.classList.contains("channel-panel-open")) {
    appEl.classList.toggle("calendar-drawer-open", panel.classList.contains("is-calendar-drawer"));
  }
  const closeBtn = document.getElementById("channel-panel-close");
  if (closeBtn) {
    const showClose = panel.classList.contains("is-calendar-drawer");
    closeBtn.hidden = !showClose;
    if (showClose && !closeBtn.querySelector(".ico") && typeof ic === "function") {
      closeBtn.innerHTML = ic("x");
    }
    if (!closeBtn.dataset.wired) {
      closeBtn.dataset.wired = "1";
      closeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeChannelPanel();
      });
    }
  }

  if (onFeedTab) {
    renderChannelPanelAppFooter(false);
    const chatCh = ch || activeChannelForPanelChat();

    // Event-scoped Description uses the event feed. Chat stays on the
    // channel chat shell so messages match the unfiltered list (day rules, chips, actions).
    // Memories / past read-only chat also uses the event feed (archived notes + messages).
    let filtered = null;
    if (S.chatFilterEventId) {
      filtered = typeof resolveEventForPanelChat === "function"
        ? resolveEventForPanelChat(chatCh)
        : (typeof resolveEventForPanelFeed === "function"
          ? resolveEventForPanelFeed(S.chatFilterEventId) : null);
    }
    if (filtered?.ev && !filtered.ev._availability && (feedTab !== "chat" || S.memoryChatReadonly)
        && typeof mountPanelEventFeed === "function") {
      body.classList.add("channel-panel-body-event-feed");
      mountPanelEventFeed(body, filtered.ev, {
        tab: feedTab,
        readOnly: !!S.memoryChatReadonly,
      });
      return;
    }
    body.classList.remove("channel-panel-body-event-feed");
    if (!chatCh) {
      body.innerHTML = `<p class="channel-panel-empty">Open a channel to ${feedTab === "chat" ? "chat" : "view this"}.</p>`;
      return;
    }
    if (typeof mountPanelChannelFeed === "function") {
      body.classList.add("channel-panel-body-event-feed");
      mountPanelChannelFeed(body, chatCh, { tab: feedTab });
      return;
    }
    // Fallback without channel shell (chat only).
    if (feedTab === "chat") {
      if (!body.querySelector("#chat-scroll")) body._chatShellSignature = null;
      if (typeof renderChat === "function") renderChat(body, chatCh, true);
      else body.innerHTML = `<p class="channel-panel-empty">Chat unavailable.</p>`;
      return;
    }
    body.innerHTML = `<p class="channel-panel-empty">Unavailable.</p>`;
    return;
  }

  if (channelPanelState.tab === "events") {
    renderChannelPanelAppFooter(false);
    const chatCh = ch || activeChannelForPanelChat();
    if (!chatCh || !isChatKindChannel(chatCh)) {
      body.innerHTML = `<p class="channel-panel-empty">Open a chat to see events.</p>`;
      return;
    }
    if (typeof mountPanelChatEvents === "function") {
      mountPanelChatEvents(body, chatCh);
    } else {
      body.innerHTML = `<p class="channel-panel-empty">Events unavailable.</p>`;
    }
    return;
  }

  if (channelPanelState.tab === "memories") {
    renderChannelPanelAppFooter(false);
    const g = group();
    if (!g) {
      body.innerHTML = `<p class="channel-panel-empty">Nothing here yet.</p>`;
      return;
    }
    const memCh = ch?.kind === "event" ? ch : null;
    if (typeof renderHistory === "function") renderHistory(body, g, memCh);
    else body.innerHTML = `<p class="channel-panel-empty">Memories unavailable.</p>`;
    return;
  }

  if (channelPanelState.tab === "calendar") {
    renderChannelPanelAppFooter(false);
    if (typeof renderChannelPanelCalendar === "function") renderChannelPanelCalendar(body);
    else body.innerHTML = `<p class="channel-panel-empty">Calendar unavailable.</p>`;
    return;
  }

  if (channelPanelState.tab === "people") {
    renderChannelPanelAppFooter(false);
    channelPanelState.peopleSub = "server";
    body.innerHTML = `
      <div class="channel-panel-people-head">
        <h4 class="channel-panel-people-title">Server members</h4>
      </div>
      <div class="channel-panel-people-server" id="channel-panel-people-server"></div>`;
    const serverMount = body.querySelector("#channel-panel-people-server");
    if (serverMount && typeof renderMembersView === "function") {
      renderMembersView(serverMount, { panel: true });
    } else if (serverMount) {
      serverMount.innerHTML = `<p class="channel-panel-empty">People unavailable.</p>`;
    }
    return;
  }

  if (channelPanelState.tab === "notifications") {
    renderChannelPanelAppFooter(false);
    body.innerHTML = "";
    if (typeof renderNotifications === "function") renderNotifications(body, { panel: true });
    else body.innerHTML = `<p class="channel-panel-empty">Notifications unavailable.</p>`;
    return;
  }

  // Fallback — unknown tab.
  channelPanelState.tab = defaultChannelPanelTab(personal, ch);
  renderChannelPanel(true);
}

/** Activity popup — not the deleted channel-settings sheet. */
function openChannelActivityPopup(channelId) {
  const conn = activeConn();
  const personal = typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn);
  if (personal) return;
  const id = String(channelId || "");
  const ch = (conn?.channels || []).find(c => c.id === id);
  if (!ch) return;

  const opened = typeof AshModal !== "undefined" && AshModal.open
    ? AshModal.open({
      className: "channel-activity-popup",
      html: `
        <div class="modal-card channel-activity-popup-card" role="dialog" aria-modal="true" aria-labelledby="ch-activity-title">
          <div class="channel-activity-popup-head">
            <h4 id="ch-activity-title">Activity</h4>
            <button type="button" class="channel-activity-popup-close" id="ch-activity-close" aria-label="Close">${typeof ic === "function" ? ic("x") : "×"}</button>
          </div>
          <div class="channel-activity-popup-body" id="ch-activity-body"></div>
        </div>`,
      singleton: "replace",
      graceMs: 300,
      closeOnEscape: true,
      closeOnBackdrop: true,
    })
    : null;
  if (!opened) return;
  const { overlay, close } = opened;
  overlay.querySelector("#ch-activity-close")?.addEventListener("click", () => close());

  const body = overlay.querySelector("#ch-activity-body");
  if (!body) return;
  if (typeof channelWideActivityRows === "function" && typeof channelWideActivityRowHTML === "function") {
    const rows = channelWideActivityRows(ch);
    body.innerHTML = rows.length
      ? rows.map(channelWideActivityRowHTML).join("")
      : `<p class="edc-empty">No activity yet</p>`;
    body.querySelectorAll(".edc-event-chip-link, .edc-desc-row").forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const eid = btn.dataset.event;
        const tab = (typeof normalizeEdcTab === "function" && normalizeEdcTab(btn.dataset.edcOpenTab)) || "description";
        close();
        if (eid && typeof openEventChatFiltered === "function") {
          openEventChatFiltered(ch.id, eid, { tab });
        }
      };
    });
  } else if (typeof mountPanelChannelFeed === "function") {
    mountPanelChannelFeed(body, ch, { tab: "activity" });
  } else {
    body.innerHTML = `<p class="edc-empty">Activity unavailable</p>`;
  }
}

