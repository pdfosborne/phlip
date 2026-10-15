/* channel-panel-actions.js — panel tap routing + pointer freeze.
 * Globals out: noteChannelPanelPointer, ensureChannelPanelTaps
 * Load after: channel-panel-state.js; with channel-panel.js
 */
function noteChannelPanelPointer(e, down) {
  if (down) _channelPanelPtrIds.add(e.pointerId);
  else _channelPanelPtrIds.delete(e.pointerId);
  if (!down && _channelPanelPtrIds.size === 0 && _channelPanelRenderQueued) {
    _channelPanelRenderQueued = false;
    renderChannelPanel(true);
  }
}

/**
 * Activate right-panel chrome on pointerup (same pattern as left sidebar).
 * Body form controls keep their own handlers; freeze stops mid-tap rebuilds.
 */
function ensureChannelPanelTaps() {
  const panel = document.getElementById("channel-panel");
  if (!panel) return;
  if (typeof onceFlag === "function") {
    if (!onceFlag(panel, "panelNavTaps")) return;
  } else if (panel.dataset.panelNavTaps) {
    return;
  } else {
    panel.dataset.panelNavTaps = "1";
  }
  let sx = 0, sy = 0, armed = null, ateClick = false;

  const resolveAction = (target) => {
    if (!target) return null;
    if (target.nodeType === Node.TEXT_NODE) target = target.parentElement;
    if (!target || !panel.contains(target)) return null;
    // Sticky invite uses its own onclick (capture stopPropagation
    // on this handler would swallow those clicks).
    if (target.closest("#channel-panel-invite, .server-share-invite-btn, #cp-invite")) return null;
    if (target.closest("#channel-panel-back")) {
      return () => {
        const personal = PersonalSpace.isPersonal(activeConn());
        channelPanelState.tab = typeof defaultChannelPanelTab === "function"
          ? defaultChannelPanelTab(personal)
          : "calendar";
        renderChannelPanel(true);
      };
    }
    const tabBtn = target.closest("[data-panel-tab]");
    if (tabBtn) {
      return () => {
        let next = tabBtn.getAttribute("data-panel-tab");
        if (next === "details" || next === "settings") {
          return;
        }
        if (next === "activity") {
          const ch = typeof activeChannelForPanel === "function" ? activeChannelForPanel() : null;
          if (ch?.id && typeof openChannelActivityPopup === "function") {
            openChannelActivityPopup(ch.id);
          }
          return;
        }
        const conn = activeConn();
        const personal = PersonalSpace.isPersonal(conn);
        if (next === "notes" || next === "description" || next === "memories" || next === "notifications" || next === "chat") {
          next = typeof defaultChannelPanelTab === "function" ? defaultChannelPanelTab(personal) : "calendar";
        }
        if (next === "people" || next === "events") next = "calendar";
        if (next !== "calendar") return;
        if (personal && (next === "chat" || next === "events")) {
          next = "calendar";
        }
        if (next === "events") {
          const ch = typeof activeChannelForPanel === "function" ? activeChannelForPanel() : null;
          if (typeof isChatKindChannel === "function" && !isChatKindChannel(ch)) return;
        }
        const feedTabs = ["chat", "description"];
        if (!feedTabs.includes(next) && typeof clearPanelEventChatFilter === "function") {
          clearPanelEventChatFilter();
        }
        if (feedTabs.includes(next)) S._edcTab = next;
        channelPanelState.mode = "info";
        if (next === "people") channelPanelState.peopleSub = "server";
        if (next === "calendar" && typeof calendarSyncFromTimeline === "function") {
          calendarSyncFromTimeline();
        }
        channelPanelState.tab = next;
        const panel = document.getElementById("channel-panel");
        if (panel) {
          panel.setAttribute("aria-label",
            next === "memories" ? "Memories"
              : next === "people" ? "People"
              : next === "notifications" ? "Notifications"
              : next === "description" ? "Description"
              : next === "events" ? "Events"
              : next === "calendar" ? "My calendar"
              : "Chat");
        }
        renderChannelPanel(true);
      };
    }
    const panelAct = target.closest("[data-panel-act]");
    if (panelAct) {
      const act = panelAct.getAttribute("data-panel-act");
      if (act === "invite") {
        return () => {
          if (typeof sharePersonalInviteLink === "function") sharePersonalInviteLink(activeConn());
        };
      }
      if (act === "settings") return null;
    }
    const shareAct = target.closest("[data-share-act]");
    if (shareAct) {
      const act = shareAct.getAttribute("data-share-act");
      return () => {
        if (typeof runServerShareAction === "function") runServerShareAction(act, activeConn());
      };
    }
    const appAct = target.closest("[data-app-act]");
    if (appAct) {
      const act = appAct.getAttribute("data-app-act");
      return () => runAppSettingsAction(act);
    }
    return null;
  };

  panel.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) { armed = null; return; }
    const action = resolveAction(e.target);
    if (!action) { armed = null; return; }
    sx = e.clientX; sy = e.clientY;
    armed = action;
  }, true);
  panel.addEventListener("pointerup", (e) => {
    const action = armed;
    armed = null;
    if (!action) return;
    if (Math.hypot(e.clientX - sx, e.clientY - sy) > 14) return;
    ateClick = true;
    setTimeout(() => { ateClick = false; }, 50);
    action();
  }, true);
  panel.addEventListener("pointercancel", () => { armed = null; }, true);
  panel.addEventListener("click", (e) => {
    const action = resolveAction(e.target);
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    if (ateClick) return;
    action();
  }, true);
}
