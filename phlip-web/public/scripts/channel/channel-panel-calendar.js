/* channel-panel-calendar.js — My calendar tab on the right channel panel.
 * Globals out: renderChannelPanelCalendar, openCalendarConflictCheck,
 * calendarClearConflictCheck, calendarSyncFromTimeline, calendarConflictWindow,
 * calendarIntervalsOverlap
 * Load after: channel-panel.js
 */

const _CAL_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const _CAL_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

let _calSelectedDay = 0;
let _calMonthCursor = 0;
let _calFormOpen = false;
let _calFormError = false;
let _calFormTitle = "";
let _calFormStart = "18:00";
let _calFormEnd = "19:00";
let _calFormNote = "";
let _calSaving = false;
let _calConflictEventId = null;
let _calSwipeIgnoreClickUntil = 0;
let _calPickDateMode = false;
let _calPickDateCallback = null;

function calendarDayStart(ts) {
  if (typeof dayStart === "function") return dayStart(ts);
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function calendarWeekStartMon(ts) {
  if (typeof weekStartMon === "function") return weekStartMon(ts);
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

function calendarSetSelectedDay(day) {
  const ts = calendarDayStart(day);
  _calSelectedDay = ts;
  const d = new Date(ts);
  _calMonthCursor = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function calendarEnsureState() {
  if (!_calSelectedDay) calendarSetSelectedDay(Date.now());
  else if (!_calMonthCursor) {
    const d = new Date(_calSelectedDay);
    _calMonthCursor = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  }
}

function calendarSyncFromTimeline() {
  const day = typeof timelineFocusDay === "function"
    ? timelineFocusDay()
    : calendarDayStart(Date.now());
  calendarSetSelectedDay(day);
}

function calendarClearConflictCheck() {
  _calConflictEventId = null;
}

function calendarConflictEvent() {
  if (!_calConflictEventId) return null;
  if (typeof timelineFindEvent === "function") {
    const found = timelineFindEvent(_calConflictEventId);
    if (found) return found;
  }
  if (typeof collatedEvents === "function") {
    const found = collatedEvents().find(ev => ev?.id === _calConflictEventId);
    if (found) return found;
  }
  const conn = typeof activeConn === "function" ? activeConn() : null;
  return (conn?.events || []).find(ev => ev?.id === _calConflictEventId) || null;
}

function openCalendarConflictCheck(ev) {
  if (!ev?.id) return;
  const day = typeof timelineDay === "function" ? timelineDay(ev.when) : calendarDayStart(ev.when);
  calendarSetSelectedDay(day);
  _calConflictEventId = ev.id;
  const ch = typeof activeChannelForPanel === "function" ? activeChannelForPanel() : null;
  if (typeof openChannelPanelMode === "function") {
    openChannelPanelMode("info", ch?.id || null, { tab: "calendar", conflict: true });
  }
}

function calendarConfirmedEvents() {
  const personal = S.conns?.personal;
  const id = (typeof PersonalSpace !== "undefined" && PersonalSpace.MY_ACCEPTED_ID) || "pacc";
  const ch = (personal?.channels || []).find(c => c.id === id);
  if (typeof collectChannelViewEvents === "function" && ch && personal) {
    return collectChannelViewEvents(ch, personal);
  }
  if (typeof collectAcceptedEvents === "function") return collectAcceptedEvents();
  return [];
}

function calendarIsPersonalPlan(ev) {
  if (!ev) return false;
  const id = (typeof PersonalSpace !== "undefined" && PersonalSpace.MY_PLANS_ID) || "pch";
  if (ev._linked) return false;
  if (ev.channelId === id && (ev._connId === "personal" || !ev._connId)) return true;
  const conn = (ev._connId && S.conns?.[ev._connId]) || S.conns?.personal;
  const ch = (conn?.channels || []).find(c => c.id === ev.channelId);
  return !!(ch && ch.id === id && (ev._connId === "personal" || conn?.id === "personal"));
}

function calendarSourceLabel(ev) {
  if (calendarIsPersonalPlan(ev)) return "My plans";
  if (ev._linkedChannelName) return `#${ev._linkedChannelName}`;
  const conn = (ev._connId && S.conns?.[ev._connId])
    || (typeof activeConn === "function" ? activeConn() : null);
  const ch = (conn?.channels || []).find(c => c.id === ev.channelId)
    || (typeof group === "function" ? (group()?.channels || []).find(c => c.id === ev.channelId) : null);
  const id = (typeof PersonalSpace !== "undefined" && PersonalSpace.MY_PLANS_ID) || "pch";
  if (ch?.id === id) return "My plans";
  const name = String(ch?.name || "").trim() || "Events";
  return `#${name}`;
}

function calendarEventEndMs(ev) {
  if (typeof eventEndWhen === "function") {
    const end = eventEndWhen(ev);
    if (end) return end;
  }
  const start = Number(ev?.when) || 0;
  const dur = ev?.duration;
  if (typeof dur === "number" && dur > 1000) return start + dur;
  if (typeof durationToMs === "function") {
    const ms = durationToMs(dur);
    if (ms != null) return start + ms;
  }
  return start + 3600e3;
}

function calendarEventCoversDay(ev, day) {
  const start = calendarDayStart(ev.when);
  const endMs = calendarEventEndMs(ev);
  const last = calendarDayStart(endMs > (Number(ev.when) || 0) ? endMs - 1 : ev.when);
  return day >= start && day <= last;
}

function calendarClockLabel(ts) {
  const d = new Date(ts);
  if (typeof fmtHour === "function") return fmtHour(d.getHours(), d.getMinutes());
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(":00", "");
}

function calendarEventAllDay(ev) {
  return ev?.whenPrecision === "day" || String(ev?.duration || "") === "day";
}

function calendarEventHasClock(ev) {
  if (!ev || calendarEventAllDay(ev)) return false;
  if (ev.whenPrecision === "unconfirmed" || ev.whenPrecision === "day") return false;
  return Number.isFinite(Number(ev.when));
}

function calendarIntervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function calendarConflictWindow(blocks) {
  const items = Array.isArray(blocks) ? blocks : [];
  let minEvent = Infinity;
  let maxEvent = -Infinity;
  for (const block of items) {
    const start = Number(block?.startMin);
    const end = Number(block?.endMin);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    minEvent = Math.min(minEvent, start);
    maxEvent = Math.max(maxEvent, end);
  }
  if (!Number.isFinite(minEvent)) {
    minEvent = 8 * 60;
    maxEvent = 14 * 60;
  }
  let startMin = Math.max(0, Math.floor((minEvent - 60) / 60) * 60);
  let endMin = Math.min(24 * 60, Math.ceil((maxEvent + 60) / 60) * 60);
  if (endMin - startMin < 6 * 60) endMin = Math.min(24 * 60, startMin + 6 * 60);
  if (endMin - startMin < 6 * 60) startMin = Math.max(0, endMin - 6 * 60);
  return { startMin, endMin };
}

function calendarConflictMinutesOnDay(ev, day) {
  const startOfDay = calendarDayStart(day);
  const endOfDay = startOfDay + 86400000;
  const start = Number(ev?.when) || 0;
  const end = calendarEventEndMs(ev);
  const clampedStart = Math.max(start, startOfDay);
  const clampedEnd = Math.min(end, endOfDay);
  const startMin = Math.max(0, Math.floor((clampedStart - startOfDay) / 60000));
  const endMin = Math.min(24 * 60, Math.max(startMin + 15, Math.round((clampedEnd - startOfDay) / 60000)));
  return { startMin, endMin };
}

function calendarClockFromMinutes(mins) {
  const clamped = Math.max(0, Math.min(24 * 60, Number(mins) || 0));
  const h = Math.floor(clamped / 60) % 24;
  const min = clamped % 60;
  const day = _calSelectedDay || calendarDayStart(Date.now());
  const d = new Date(day);
  d.setHours(h, min, 0, 0);
  return calendarClockLabel(d.getTime());
}

function calendarEventTitle(ev) {
  if (typeof timelineEventTitle === "function") return timelineEventTitle(ev);
  if (typeof eventDisplayTitle === "function") return eventDisplayTitle(ev) || "Event";
  return (typeof shown === "function" ? shown(ev?._title || ev?.title || "") : (ev?._title || ev?.title || "")) || "Event";
}

function calendarLongDate(day) {
  const d = new Date(day);
  return `${_CAL_WEEKDAYS[d.getDay()]} ${d.getDate()} ${_CAL_MONTHS[d.getMonth()]}`;
}

function calendarParseHm(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || ""));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function calendarAtTime(day, hm) {
  const mins = calendarParseHm(hm);
  if (mins == null) return null;
  const h = Math.floor(mins / 60);
  const min = mins % 60;
  if (typeof atTime === "function") return atTime(day, h, min);
  const d = new Date(day);
  d.setHours(h, min, 0, 0);
  return d.getTime();
}

function calendarPersonalChannelId() {
  if (typeof defaultPersonalEventChannelId === "function") return defaultPersonalEventChannelId();
  const conn = S.conns?.personal;
  const pch = (typeof PersonalSpace !== "undefined" && PersonalSpace.MY_PLANS_ID) || "pch";
  const ch = (conn?.channels || []).find(c => c.kind === "event" && c.id === pch)
    || (conn?.channels || []).find(c => c.kind === "event"
      && !(typeof PersonalSpace !== "undefined" && PersonalSpace.isHiddenChannel(c, conn)));
  return ch?.id || pch;
}

function calendarReadForm(root) {
  const title = root.querySelector("#personal-title");
  const start = root.querySelector("#personal-start");
  const end = root.querySelector("#personal-end");
  const note = root.querySelector("#personal-note");
  if (title) _calFormTitle = title.value;
  if (start) _calFormStart = start.value;
  if (end) _calFormEnd = end.value;
  if (note) _calFormNote = note.value;
}

function calendarSetFormOpen(open) {
  _calFormOpen = !!open;
  if (open) _calFormError = false;
  else {
    _calFormTitle = "";
    _calFormNote = "";
    _calFormError = false;
  }
}

async function calendarSavePersonalEvent(body) {
  if (_calSaving) return;
  const title = String(_calFormTitle || "").trim();
  const startMins = calendarParseHm(_calFormStart);
  const endMins = calendarParseHm(_calFormEnd);
  if (!title || startMins == null || endMins == null || endMins <= startMins) {
    _calFormError = true;
    renderChannelPanelCalendar(body);
    return;
  }
  const personal = S.conns?.personal;
  const channelId = calendarPersonalChannelId();
  if (!personal || !channelId) {
    _calFormError = true;
    renderChannelPanelCalendar(body);
    return;
  }
  const when = calendarAtTime(_calSelectedDay, _calFormStart);
  const span = endMins - startMins;
  const duration = typeof durationCodeFromMinutes === "function"
    ? durationCodeFromMinutes(span)
    : `${span}m`;
  const note = String(_calFormNote || "").trim().slice(0, 120);
  const eventId = typeof genLocalId === "function" ? genLocalId() : undefined;
  _calSaving = true;
  try {
    const result = send({
      type: "createEvent",
      id: eventId,
      channelId,
      title,
      icon: "",
      when,
      where: "",
      details: note || "",
      duration,
      rsvp: "going",
      typeId: typeof typeIdForTitle === "function" ? (typeIdForTitle(title, personal) || "") : "",
      cat: "",
    }, "personal");
    if (result === "failed") {
      _calFormError = true;
      renderChannelPanelCalendar(body);
      return;
    }
    calendarSetFormOpen(false);
    renderChannelPanelCalendar(body);
  } catch {
    _calFormError = true;
    renderChannelPanelCalendar(body);
  } finally {
    _calSaving = false;
  }
}

function calendarDayMarks(events, channelId) {
  const anyDays = new Set();
  const channelDays = new Set();
  const chId = channelId != null ? String(channelId) : "";
  for (const ev of events || []) {
    if (!ev || ev.when == null) continue;
    const start = calendarDayStart(ev.when);
    const endMs = calendarEventEndMs(ev);
    const last = calendarDayStart(endMs > (Number(ev.when) || 0) ? endMs - 1 : ev.when);
    const onChannel = !!(chId && ev.channelId === chId);
    for (let t = start, n = 0; t <= last && n < 60; n++) {
      anyDays.add(t);
      if (onChannel) channelDays.add(t);
      const nd = new Date(t);
      t = calendarDayStart(new Date(nd.getFullYear(), nd.getMonth(), nd.getDate() + 1).getTime());
    }
  }
  return { anyDays, channelDays };
}

/** Shared month grid used by My calendar and the create/edit Date tab. */
function calendarMiniMonthHtml(opts = {}) {
  const monthCursor = Number(opts.monthCursor) || calendarDayStart(Date.now());
  const selectedDay = opts.selectedDay != null ? calendarDayStart(opts.selectedDay) : null;
  const events = opts.events || [];
  const disablePast = !!opts.disablePast;
  const dayAttr = opts.dayAttr || "data-cal-day";
  const idPrefix = opts.idPrefix || "sidebar";
  const extraClass = opts.className ? ` ${opts.className}` : "";
  const cursor = new Date(monthCursor);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const gridStart = calendarWeekStartMon(new Date(year, month, 1).getTime());
  const today = calendarDayStart(Date.now());
  const { anyDays, channelDays } = calendarDayMarks(events, opts.channelId);
  const grid0 = new Date(gridStart);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(grid0.getFullYear(), grid0.getMonth(), grid0.getDate() + i);
    cells.push({
      d,
      t: calendarDayStart(d.getTime()),
      muted: d.getMonth() !== month,
    });
  }
  while (cells.length > 7) {
    const tail = cells.slice(-7);
    if (tail.every(c => c.muted)) cells.splice(-7);
    else break;
  }
  let days = "";
  for (const cell of cells) {
    const cls = ["sidebar-mini-day"];
    if (cell.muted) cls.push("muted");
    if (cell.t === today) cls.push("today");
    if (selectedDay != null && cell.t === selectedDay) cls.push("selected");
    if (anyDays.has(cell.t)) cls.push("has-event", "has-confirmed");
    if (channelDays.has(cell.t)) cls.push("has-channel");
    const past = disablePast && cell.t < today;
    days += `<button type="button" class="${cls.join(" ")}" ${dayAttr}="${cell.t}"${past ? " disabled" : ""}>${cell.d.getDate()}</button>`;
  }
  const monthLabel = (typeof _CAL_MONTHS !== "undefined" ? _CAL_MONTHS[month] : cursor.toLocaleString([], { month: "long" }))
    + " " + year;
  return `
    <div class="sidebar-mini-calendar${extraClass}" id="${idPrefix}-mini-calendar">
      <div class="sidebar-mini-head">
        <span class="sidebar-mini-month" id="${idPrefix}-mini-month">${esc(monthLabel)}</span>
        <span class="sidebar-mini-nav">
          <button type="button" id="${idPrefix}-month-prev" aria-label="Previous month">${ic("chevron-left")}</button>
          <button type="button" id="${idPrefix}-month-next" aria-label="Next month">${ic("chevron-right")}</button>
        </span>
      </div>
      <div class="sidebar-mini-weekdays"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div>
      <div class="sidebar-mini-days" id="${idPrefix}-mini-days">${days}</div>
    </div>`;
}

function calendarMiniHtml(events) {
  const panelCh = typeof activeChannelForPanel === "function" ? activeChannelForPanel() : null;
  return calendarMiniMonthHtml({
    monthCursor: _calMonthCursor,
    selectedDay: _calSelectedDay,
    events,
    channelId: panelCh?.id || null,
    disablePast: false,
    dayAttr: "data-cal-day",
    idPrefix: "sidebar",
  });
}

function calendarAgendaHtml(events) {
  const panelCh = typeof activeChannelForPanel === "function" ? activeChannelForPanel() : null;
  const dayEvents = events.filter(ev => calendarEventCoversDay(ev, _calSelectedDay))
    .sort((a, b) => (Number(a.when) || 0) - (Number(b.when) || 0));
  if (!dayEvents.length) {
    return `<div class="sidebar-agenda" id="sidebar-agenda"><div class="agenda-empty">Nothing confirmed for this date.</div></div>`;
  }
  let rows = "";
  for (const ev of dayEvents) {
    const currentGroup = !!(panelCh && ev.channelId === panelCh.id);
    const isPersonal = calendarIsPersonalPlan(ev);
    const allDay = calendarEventAllDay(ev);
    const startLabel = allDay ? "All day" : calendarClockLabel(ev.when);
    const untilLabel = allDay ? "" : ` · until ${calendarClockLabel(calendarEventEndMs(ev))}`;
    const source = calendarSourceLabel(ev);
    const origin = typeof eventEditabilityLabel === "function" ? eventEditabilityLabel(ev) : "";
    const cls = ["agenda-event"];
    if (currentGroup) cls.push("current-group");
    if (isPersonal) cls.push("personal-plan");
    rows += `<div class="${cls.join(" ")}">`
      + `<span class="agenda-time">${esc(startLabel)}</span>`
      + `<span class="agenda-dot" aria-hidden="true"></span>`
      + `<span class="agenda-copy"><span class="agenda-main"><span class="agenda-title">${esc(calendarEventTitle(ev))}</span>`
      + `<span class="agenda-until">${esc(untilLabel)}</span></span>`
      + `<span class="agenda-meta"><span class="agenda-source">${esc(source)}</span>`
      + (origin ? `<span class="agenda-edit">${esc(origin)}</span>` : "")
      + `</span></span></div>`;
  }
  return `<div class="sidebar-agenda" id="sidebar-agenda"><section class="agenda-day">${rows}</section></div>`;
}

function calendarProposedWhenLabel(ev) {
  if (calendarEventAllDay(ev) || ev?.whenPrecision === "day") return "All day";
  if (ev?.whenPrecision === "unconfirmed") return "TBC";
  if (typeof timelineTimeLabel === "function") return timelineTimeLabel(ev, true);
  return calendarClockLabel(ev.when);
}

function calendarConflictHtml(events, proposed) {
  const others = events.filter(ev => ev.id !== proposed.id && calendarEventCoversDay(ev, _calSelectedDay));
  const timedOthers = others.filter(calendarEventHasClock);
  const allDayOthers = others.filter(ev => !calendarEventHasClock(ev));
  const proposedClock = calendarEventHasClock(proposed);
  const blocks = timedOthers.map(ev => ({ ev, isTarget: false, ...calendarConflictMinutesOnDay(ev, _calSelectedDay) }));
  if (proposedClock) {
    blocks.push({ ev: proposed, isTarget: true, ...calendarConflictMinutesOnDay(proposed, _calSelectedDay) });
  }
  const win = calendarConflictWindow(blocks);
  const span = Math.max(1, win.endMin - win.startMin);
  const height = Math.max(360, Math.round(span / 60 * 42));

  let allDayHtml = "";
  for (const ev of allDayOthers) {
    allDayHtml += `<div class="conflict-allday-row">`
      + `<span class="conflict-allday-title">${esc(calendarEventTitle(ev))}</span>`
      + `<span class="conflict-allday-source">${esc(calendarSourceLabel(ev))}</span></div>`;
  }

  let banner = "";
  if (!proposedClock) {
    const place = typeof timelineEventPlace === "function"
      ? timelineEventPlace(proposed)
      : String(proposed._where || proposed.where || "").trim();
    banner = `<div class="conflict-proposed-banner">`
      + `<div class="conflict-kicker">Proposed</div>`
      + `<div class="conflict-title">${esc(calendarEventTitle(proposed))}</div>`
      + `<div class="conflict-meta">${esc(calendarProposedWhenLabel(proposed))}`
      + (place ? ` · ${esc(place)}` : "")
      + `</div></div>`;
  }

  let axis = '<div class="conflict-time-axis">';
  let lines = "";
  for (let m = win.startMin; m <= win.endMin; m += 60) {
    const pct = (m - win.startMin) / span * 100;
    axis += `<span class="conflict-hour-label" style="top:${pct}%">${esc(calendarClockFromMinutes(m))}</span>`;
    lines += `<span class="conflict-hour-line" style="top:${pct}%"></span>`;
  }
  axis += "</div>";

  let blockHtml = "";
  for (const block of blocks) {
    const top = (block.startMin - win.startMin) / span * 100;
    const h = Math.max(5, (block.endMin - block.startMin) / span * 100);
    const overlaps = !!(block.isTarget && timedOthers.some(other => {
      const otherMins = calendarConflictMinutesOnDay(other, _calSelectedDay);
      return calendarIntervalsOverlap(block.startMin, block.endMin, otherMins.startMin, otherMins.endMin);
    }));
    const cls = ["conflict-block"];
    if (block.isTarget) cls.push("target");
    if (overlaps) cls.push("overlap");
    blockHtml += `<div class="${cls.join(" ")}" style="top:${top}%;height:${h}%">`
      + `<span class="conflict-block-time">${esc(calendarClockFromMinutes(block.startMin))}–${esc(calendarClockFromMinutes(block.endMin))}</span>`
      + `<span class="conflict-block-title">${esc(calendarEventTitle(block.ev))}${block.isTarget && overlaps ? " · overlap" : ""}</span>`
      + `<span class="conflict-block-source">${esc(block.isTarget ? "Proposed" : calendarSourceLabel(block.ev))}</span></div>`;
  }

  return `<div class="sidebar-agenda conflict-agenda" id="sidebar-agenda">`
    + banner + allDayHtml
    + `<div class="conflict-timeline" id="sidebar-conflict-timeline" style="height:${height}px">${axis}${lines}${blockHtml}</div>`
    + `</div>`;
}

function calendarAgendaOrConflictHtml(events) {
  const proposed = calendarConflictEvent();
  if (!proposed) {
    if (_calConflictEventId) _calConflictEventId = null;
    return calendarAgendaHtml(events);
  }
  return calendarConflictHtml(events, proposed);
}

function calendarIsPickDateMode() {
  return !!_calPickDateMode;
}


function calendarExitPickDateMode() {
  _calPickDateMode = false;
  _calPickDateCallback = null;
}

function calendarConfirmPickedDate() {
  const day = _calSelectedDay;
  const cb = _calPickDateCallback;
  calendarExitPickDateMode();
  if (typeof closeChannelPanel === "function") closeChannelPanel();
  if (cb && day) cb(day);
}

function calendarFormHtml() {
  const dateLabel = calendarLongDate(_calSelectedDay);
  const openClass = _calFormOpen ? " open" : "";
  const errClass = _calFormError ? " show" : "";
  const actionHidden = (_calFormOpen || _calPickDateMode) ? ` style="display:none"` : "";
  const pickHidden = _calPickDateMode ? "" : ` style="display:none"`;
  return `
    <button type="button" class="personal-event-action" id="personal-event-action"${actionHidden}>
      ${ic("plus")}<span>Add personal event</span>
    </button>
    <button type="button" class="personal-event-action" id="personal-pick-date"${pickHidden}>
      ${ic("calendar")}<span>Use this date</span>
    </button>
    <form class="personal-event-form${openClass}" id="personal-event-form"${_calPickDateMode ? ` style="display:none"` : ""}>
      <div class="personal-form-heading">
        <span class="personal-form-title">Add personal event</span>
        <span class="personal-form-date" id="personal-form-date">${esc(dateLabel)}</span>
      </div>
      <div class="personal-form-field">
        <label for="personal-title">Title</label>
        <input id="personal-title" name="personal-title" type="text" maxlength="60" placeholder="e.g. Dinner with parents" autocomplete="off" value="${esc(_calFormTitle)}">
      </div>
      <div class="personal-form-row">
        <div class="personal-form-field">
          <label for="personal-start">Starts</label>
          <input id="personal-start" name="personal-start" type="time" value="${esc(_calFormStart)}">
        </div>
        <div class="personal-form-field">
          <label for="personal-end">Ends</label>
          <input id="personal-end" name="personal-end" type="time" value="${esc(_calFormEnd)}">
        </div>
      </div>
      <div class="personal-form-field personal-form-note">
        <label for="personal-note">Note <span style="font-weight:400;">(optional)</span></label>
        <textarea id="personal-note" name="personal-note" maxlength="120" placeholder="Anything useful to remember">${esc(_calFormNote)}</textarea>
      </div>
      <div class="personal-form-error${errClass}" id="personal-form-error">Add a title and make sure the end time is after the start time.</div>
      <div class="personal-form-actions">
        <button type="button" class="personal-form-btn personal-form-cancel" id="personal-form-cancel">Cancel</button>
        <button type="submit" class="personal-form-btn personal-form-save">Save</button>
      </div>
    </form>`;
}

function calendarShiftMonth(delta, body) {
  const d = new Date(_calMonthCursor);
  _calMonthCursor = new Date(d.getFullYear(), d.getMonth() + delta, 1).getTime();
  renderChannelPanelCalendar(body);
}

function calendarWireMonthSwipe(cal, body) {
  if (!cal) return;
  let sx = 0;
  let sy = 0;
  cal.addEventListener("pointerdown", (e) => {
    sx = e.clientX;
    sy = e.clientY;
  });
  cal.addEventListener("pointerup", (e) => {
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      _calSwipeIgnoreClickUntil = performance.now() + 400;
      calendarShiftMonth(dx < 0 ? 1 : -1, body);
    }
  });
}

function renderChannelPanelCalendar(body) {
  if (!body) return;
  calendarEnsureState();
  const events = calendarConfirmedEvents();
  body.innerHTML = `
    ${calendarMiniHtml(events)}
    <div class="sidebar-selected-day" id="sidebar-selected-day">
      <span class="sidebar-selected-date" id="sidebar-selected-date">${esc(calendarLongDate(_calSelectedDay))}</span>
    </div>
    ${calendarFormHtml()}
    ${calendarAgendaOrConflictHtml(events)}`;

  body.querySelector("#sidebar-month-prev")?.addEventListener("click", () => {
    calendarShiftMonth(-1, body);
  });
  body.querySelector("#sidebar-month-next")?.addEventListener("click", () => {
    calendarShiftMonth(1, body);
  });
  calendarWireMonthSwipe(body.querySelector("#sidebar-mini-calendar"), body);
  body.querySelectorAll("[data-cal-day]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (performance.now() < _calSwipeIgnoreClickUntil) return;
      const day = Number(btn.getAttribute("data-cal-day"));
      if (!Number.isFinite(day)) return;
      if (day !== _calSelectedDay) calendarClearConflictCheck();
      calendarSetSelectedDay(day);
      renderChannelPanelCalendar(body);
    });
  });
  body.querySelector("#personal-event-action")?.addEventListener("click", () => {
    calendarSetFormOpen(true);
    renderChannelPanelCalendar(body);
    queueMicrotask(() => body.querySelector("#personal-title")?.focus());
  });
  body.querySelector("#personal-pick-date")?.addEventListener("click", () => {
    calendarConfirmPickedDate();
  });
  body.querySelector("#personal-form-cancel")?.addEventListener("click", () => {
    calendarSetFormOpen(false);
    renderChannelPanelCalendar(body);
  });
  const form = body.querySelector("#personal-event-form");
  form?.addEventListener("input", () => calendarReadForm(body));
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    calendarReadForm(body);
    void calendarSavePersonalEvent(body);
  });
}
