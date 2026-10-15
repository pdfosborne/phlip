/* channel-timeline-settings.js — timeline ⋮ settings popup (filters + board opts).
 * Globals out: timelineSettingsMenuHTML, timelineSettingsWrapHTML, wireTimelineSettings,
 *   wireTimelineSettingsItems, openTimelineSettingsPopup, closeTimelineSettingsPopup
 * Load after: channel-events-board.js, channel-form-components.js
 */

const RSVP_FILTER_ROWS = [
  { mode: "all", icon: "layers", label: "All" },
  { mode: "only", icon: "bell", label: "Needs reply" },
  { mode: "hosting", icon: "flag", label: "Organising" },
];

const RSVP_FILTER_TOASTS = {
  all: "Showing all events",
  only: "Needs reply only",
  hosting: "Events you organise",
};

const EVENTS_LAYOUT_ROWS = [
  { mode: "list", icon: "layout-list", label: "List" },
  { mode: "cards", icon: "gallery-horizontal", label: "Cards" },
  { mode: "timeline", icon: "calendar", label: "Timeline" },
];

function closeTimelineSettingsPopup(exceptWrap = null) {
  document.querySelectorAll(".timeline-settings-wrap").forEach((wrap) => {
    if (wrap === exceptWrap) return;
    const menu = wrap.querySelector(".timeline-settings-popup");
    const btn = wrap.querySelector(".btn-timeline-settings");
    if (menu) menu.hidden = true;
    if (btn) btn.setAttribute("aria-expanded", "false");
  });
  if (!exceptWrap) document.body.classList.remove("timeline-settings-open");
}

function openTimelineSettingsMenu(wrap) {
  const popup = wrap.querySelector(".timeline-settings-popup");
  const btn = wrap.querySelector(".btn-timeline-settings");
  if (!popup) return;
  popup.hidden = false;
  if (btn) btn.setAttribute("aria-expanded", "true");
  document.body.classList.add("timeline-settings-open");
  wireTimelineSettingsOutsideClose(wrap);
  if (S._focusTimelineSetting) {
    const focus = S._focusTimelineSetting;
    S._focusTimelineSetting = false;
    focusTimelineSettingsRow(popup, focus);
  }
}

/** Show/hide row — eye open when visible, eye-off when hidden (muted). */
function timelineVisibilityRow(id, icon, label, showing) {
  const eye = showing ? "eye" : "eye-off";
  return `<button type="button" class="timeline-settings-item timeline-settings-vis-row${showing ? "" : " is-muted"}"` +
    ` id="${id}" data-showing="${showing ? "1" : "0"}"` +
    ` role="menuitemcheckbox" aria-checked="${showing ? "true" : "false"}"` +
    ` aria-label="${esc(label)}">` +
    `${ic(icon)}<span>${esc(label)}</span>` +
    `${ic(eye, "timeline-settings-eye")}</button>`;
}

/** Hide toggle — eye open when items show, eye-closed when they are hidden. */
function timelineHideToggleRow(id, icon, label, hiding) {
  const eye = hiding ? "eye-closed" : "eye";
  return `<button type="button" class="timeline-settings-item timeline-settings-vis-row${hiding ? " is-muted" : ""}"` +
    ` id="${id}" data-hiding="${hiding ? "1" : "0"}"` +
    ` role="menuitemcheckbox" aria-checked="${hiding ? "true" : "false"}"` +
    ` aria-label="${esc(label)}">` +
    `${ic(icon)}<span>${esc(label)}</span>` +
    `${ic(eye, "timeline-settings-eye")}</button>`;
}

function timelineSettingsDismiss(node) {
  closeTimelineSettingsPopup();
  if (node?.closest?.("#board-options") && typeof closeBoardOptions === "function") {
    closeBoardOptions({ restoreFocus: false });
  }
}

/** Rows inside the ⋮ menu. The board Events tab shows these in the title dropdown. */
function timelineSettingsMenuHTML(channel) {
  const cur = typeof rsvpFilterMode === "function" ? rsvpFilterMode() : "all";
  const occupancy = typeof isPinnedChannel === "function" && isPinnedChannel(channel);
  const occupancyCur = occupancy
    ? (cur === "hosting" ? "hosting" : "all")
    : cur;
  const filterModes = occupancy
    ? RSVP_FILTER_ROWS.filter((r) => r.mode === "all" || r.mode === "hosting")
    : RSVP_FILTER_ROWS;
  const filterRows = filterModes.map((r) => {
    const on = occupancyCur === r.mode;
    return `<button type="button" class="timeline-settings-item${on ? " on" : ""}"` +
      ` data-rsvp-filter="${esc(r.mode)}" role="menuitemradio" aria-checked="${on ? "true" : "false"}">` +
      `${ic(r.icon)}<span>${esc(r.label)}</span>` +
      `${on ? ic("check", "timeline-settings-check") : ""}</button>`;
  }).join("");

  if (occupancy) return filterRows;

  const layoutCur = typeof eventsLayoutMode === "function" ? eventsLayoutMode() : "timeline";
  const hideLayout = typeof isBoardAgendaView === "function" && isBoardAgendaView(channel);
  const layoutRows = hideLayout ? "" : EVENTS_LAYOUT_ROWS.map((r) => {
    const on = layoutCur === r.mode;
    return `<button type="button" class="timeline-settings-item${on ? " on" : ""}"` +
      ` data-events-layout="${esc(r.mode)}" role="menuitemradio" aria-checked="${on ? "true" : "false"}">` +
      `${ic(r.icon)}<span>${esc(r.label)}</span>` +
      `${on ? ic("check", "timeline-settings-check") : ""}</button>`;
  }).join("");

  const hideNo = typeof hideNoPref === "function" && hideNoPref();
  if (typeof isDeviceCalendarChannel === "function" && isDeviceCalendarChannel(channel)) {
    return layoutRows
      + '<div class="timeline-settings-divider" role="separator"></div>'
      + '<button type="button" class="timeline-settings-item" id="tl-import-calendar" role="menuitem"' + (DeviceCalendarImport.busy() ? ' disabled' : '') + '>' + ic("calendar") + '<span>' + (channel.lastImportedAt ? "Re-import" : "Import") + '</span></button>'
      + (channel.lastImportedAt ? '<button type="button" class="timeline-settings-item" id="tl-change-calendars" role="menuitem"' + (DeviceCalendarImport.busy() ? ' disabled' : '') + '>' + ic("settings") + '<span>Change calendars</span></button>' : '')
      + '<button type="button" class="timeline-settings-item" id="tl-calendar-info" role="menuitem">' + ic("info") + '<span>Info</span></button>';
  }
  const hideBlocks = typeof hideTimeBlocksPref === "function" && hideTimeBlocksPref();
  const availEnabled = (typeof openAvailabilityUiEnabled !== "function" || openAvailabilityUiEnabled())
    && channel
    && typeof channelAllowsAvailability === "function"
    && channelAllowsAvailability(activeConn(), channel);
  const showAvail = !(typeof hideAvailabilityPref === "function" && hideAvailabilityPref());

  let showRows = timelineHideToggleRow("tl-show-no", "busy", "Show Can’t go", hideNo)
    + timelineHideToggleRow("tl-show-time-blocks", "hourglass", "Show time blocks", hideBlocks);
  if (availEnabled) {
    showRows += timelineVisibilityRow("tl-show-availability", "handsUp", "Show availability", showAvail);
  }

  const canTimeBlock = typeof channelAllowsTimeBlocks === "function"
    && channelAllowsTimeBlocks(activeConn(), channel);
  const canOpenAvail = (typeof openAvailabilityUiEnabled !== "function" || openAvailabilityUiEnabled())
    && typeof channelAllowsAvailability === "function"
    && channelAllowsAvailability(activeConn(), channel);
  let createActions = "";
  if (canTimeBlock) {
    createActions += `<button type="button" class="timeline-settings-item" id="tl-create-time-block" role="menuitem">` +
      `${ic("calendar-range")}<span>Create time block</span>${ic("plus", "timeline-settings-trailing")}</button>`;
  }
  if (canOpenAvail) {
    createActions += `<button type="button" class="timeline-settings-item" id="tl-create-availability" role="menuitem">` +
      `${ic("handsUp")}<span>Create availability</span>${ic("plus", "timeline-settings-trailing")}</button>`;
  }
  if (createActions) {
    createActions += `<div class="timeline-settings-divider" role="separator"></div>`;
  }

  return `${layoutRows ? `${layoutRows}<div class="timeline-settings-divider" role="separator"></div>` : ""}`
    + createActions
    + filterRows
    + '<div class="timeline-settings-divider" role="separator"></div>'
    + showRows;
}

function timelineSettingsWrapHTML(channel) {
  const menu = timelineSettingsMenuHTML(channel);
  if (!menu) return "";
  const calendar = typeof isDeviceCalendarChannel === "function" && isDeviceCalendarChannel(channel);
  const label = calendar ? "Calendar view menu" : "Timeline settings";
  return `<div class="timeline-settings-wrap">
    <button type="button" class="btn-timeline-settings" id="btn-timeline-settings"` +
      ` aria-label="${label}" title="${label}" aria-haspopup="menu" aria-expanded="false">` +
      `${ic("more")}</button>
    <div class="timeline-settings-popup" id="timeline-settings-popup" hidden role="menu">
      ${menu}
    </div>
  </div>`;
}

function focusTimelineSettingsRow(popup, focus) {
  if (!popup || !focus) return;
  const row = popup.querySelector(`#tl-${focus}-row`) || popup.querySelector(`#tl-${focus}`);
  if (!row) return;
  requestAnimationFrame(() => {
    row.classList.add("timeline-settings-focus");
    try { row.querySelector("input")?.focus?.(); } catch {}
    setTimeout(() => row.classList.remove("timeline-settings-focus"), 2200);
  });
}

const TL_SETTINGS_DISMISS_SUPPRESS_MS = (typeof AshGesture !== "undefined" && AshGesture.OUTSIDE_TAP_MS) || 450;

function wireTimelineSettingsOutsideClose(wrap) {
  clearTimeout(wrap._tlSettingsDocTimer);
  wrap._tlSettingsDocTimer = setTimeout(() => {
    let suppressUntil = 0;
    const onDoc = (e) => {
      const now = performance.now();
      const inside = !!e.target.closest?.(".timeline-settings-wrap");
      if (now < suppressUntil) {
        if (!inside) {
          e.preventDefault();
          e.stopPropagation();
        }
        if (e.type === "click") {
          document.removeEventListener("pointerdown", onDoc, true);
          document.removeEventListener("click", onDoc, true);
        }
        return;
      }
      if (inside) return;
      closeTimelineSettingsPopup();
      suppressUntil = now + TL_SETTINGS_DISMISS_SUPPRESS_MS;
      e.preventDefault();
      e.stopPropagation();
      if (e.type === "click") {
        document.removeEventListener("pointerdown", onDoc, true);
        document.removeEventListener("click", onDoc, true);
      }
    };
    document.addEventListener("pointerdown", onDoc, true);
    document.addEventListener("click", onDoc, true);
  }, 0);
}

/** Show-section rows: eye open = visible. Setter still stores the hide flag. */
function wireTimelineVisibilityRow(popup, id, setter, showMsg, hideMsg) {
  const btn = popup.querySelector(`#${id}`);
  if (!btn || typeof setter !== "function") return;
  wireBoardHeadTap(btn, () => {
    const nextShowing = btn.dataset.showing !== "1";
    setter(!nextShowing);
    toast(nextShowing ? showMsg : hideMsg);
    renderView();
  });
}

function timelinePaintHideToggleRow(btn, hiding) {
  if (!btn) return;
  btn.dataset.hiding = hiding ? "1" : "0";
  btn.setAttribute("aria-checked", hiding ? "true" : "false");
  btn.classList.toggle("is-muted", !!hiding);
  const eye = btn.querySelector(".timeline-settings-eye");
  if (eye && typeof ic === "function") {
    const hold = document.createElement("span");
    hold.innerHTML = ic(hiding ? "eye-closed" : "eye", "timeline-settings-eye");
    const next = hold.firstElementChild;
    if (next) eye.replaceWith(next);
  }
}

/** Hide toggles: click hides (eye-closed), click again shows (eye open). */
function wireTimelineHideToggleRow(popup, id, setter, hideMsg, showMsg) {
  const btn = popup.querySelector(`#${id}`);
  if (!btn || typeof setter !== "function") return;
  wireBoardHeadTap(btn, () => {
    const nextHiding = btn.dataset.hiding !== "1";
    setter(nextHiding);
    timelinePaintHideToggleRow(btn, nextHiding);
    toast(nextHiding ? hideMsg : showMsg);
    renderView();
  });
}

function wireTimelineSettingsItems(popup) {
  if (!popup) return;
  popup.querySelectorAll("[data-rsvp-filter]").forEach((item) => {
    wireBoardHeadTap(item, () => {
      const mode = item.dataset.rsvpFilter;
      if (typeof setRsvpFilter === "function") setRsvpFilter(mode);
      toast(RSVP_FILTER_TOASTS[mode] || "Filter updated");
      timelineSettingsDismiss(item);
      renderView();
    });
  });
  const importButton = popup.querySelector("#tl-import-calendar");
  if (importButton) wireBoardHeadTap(importButton, () => { timelineSettingsDismiss(importButton); DeviceCalendarImport.start(); });
  const changeCals = popup.querySelector("#tl-change-calendars");
  if (changeCals) wireBoardHeadTap(changeCals, () => { timelineSettingsDismiss(changeCals); DeviceCalendarImport.start({ change: true }); });
  const infoButton = popup.querySelector("#tl-calendar-info");
  if (infoButton) wireBoardHeadTap(infoButton, () => { timelineSettingsDismiss(infoButton); DeviceCalendarImport.showInfo(); });

  popup.querySelectorAll("[data-events-layout]").forEach((item) => {
    wireBoardHeadTap(item, () => {
      const mode = item.dataset.eventsLayout;
      if (typeof setEventsLayout === "function") setEventsLayout(mode);
      toast(mode === "list" ? "List view" : (mode === "cards" ? "Cards view" : "Timeline view"));
      timelineSettingsDismiss(item);
      renderView();
    });
  });

  const timeBlockBtn = popup.querySelector("#tl-create-time-block");
  if (timeBlockBtn && typeof openTimeBlockComposer === "function") {
    wireBoardHeadTap(timeBlockBtn, () => {
      timelineSettingsDismiss(timeBlockBtn);
      openTimeBlockComposer();
    });
  }

  const openAvailBtn = popup.querySelector("#tl-create-availability");
  if (openAvailBtn && typeof openAvailabilityComposer === "function") {
    wireBoardHeadTap(openAvailBtn, () => {
      timelineSettingsDismiss(openAvailBtn);
      openAvailabilityComposer();
    });
  }

  wireTimelineHideToggleRow(popup, "tl-show-no", setHideNo, "Hiding Can’t go events", "Showing Can’t go events");
  wireTimelineHideToggleRow(popup, "tl-show-time-blocks", setHideTimeBlocks, "Hiding time blocks", "Showing time blocks");
  wireTimelineVisibilityRow(popup, "tl-show-availability", setHideAvailability, "Showing availability", "Hiding availability");
}

function wireTimelineSettings(root, channel) {
  const wrap = root?.querySelector?.(".timeline-settings-wrap");
  if (!wrap) return;
  const btn = wrap.querySelector("#btn-timeline-settings");
  const popup = wrap.querySelector("#timeline-settings-popup");
  if (!btn || !popup) return;

  wrap.addEventListener("click", (e) => e.stopPropagation());

  wireBoardHeadTap(btn, () => {
    const open = popup.hidden;
    closeTimelineSettingsPopup();
    if (open) openTimelineSettingsMenu(wrap);
  });

  wireTimelineSettingsItems(popup);
}

function openTimelineSettingsPopup({ focus } = {}) {
  if (focus) S._focusTimelineSetting = focus;
  const wrap = document.querySelector(".timeline-settings-wrap");
  if (!wrap) {
    toast("Open the timeline first");
    return;
  }
  closeTimelineSettingsPopup();
  openTimelineSettingsMenu(wrap);
}
