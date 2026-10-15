/* channel-timeline-view.js — rolling future Timeline view.
 * Globals out: renderTimelineView, timelinePresentationState,
 * timelineMonthCells, timelineMultiDaySegments, openTimelineSheet,
 * timelineShowCreateFab, openEventConversation,
 * timelineFocusDay, timelineShellSignature, timelineSameMarkup,
 * timelineReconcileFeed, timelineCloseCalendar, timelineSheetIsExpanded
 * (pinned location/person views and the group Events tab "timeline" layout render a
 * compact agenda: timelineAgendaActive, timelineOccupancyDayStack,
 * timelineBuildOccupancySections)
 * Load after: channel-ticket-cards.js; before hand modules.
 */

let timelineCalendarOpen = false;
let timelineMonthCursor = 0;
let timelineFocusedEventId = null;
let timelineSheetEventId = null;
let timelineSheetTab = "chat";
let timelineJumpPendingDay = null;
let timelineFocusHold = false;
let timelineFocusScrollRaf = 0;
let timelineFocusResizeWired = false;
let timelineImeBaseline = 0;
let timelineImeWired = false;
let timelineEventsById = new Map();
let timelineFocusTabEventId = null;
let timelineFocusTabSwapGen = 0;
let timelineFocusTabSwapTimer = 0;
let timelinePeekExpandH = 0;
let timelineSheetExpanded = false;
let timelineSheetImeExpanded = false;
let timelineSheetImeSeen = false;
let timelineRefreshPending = false;
let timelineRefreshTimer = 0;
let timelineFeedScrolling = false;
let timelineSheetRestoreFocus = null;

/* Group-board Events tab (the board's conversation dock "Events" surface,
 * i.e. isBoardAgendaView): renders as the compact agenda (same rows/gaps as
 * pinned views) with RSVP state, going counts, tap-to-open event sheet and
 * a sticky "Events / New event" head. Behaves like the list layout for focus/sheet purposes.
 * The standalone timeline / list / cards layouts elsewhere are unchanged. */
function timelineAgendaActive(channel) {
  if (timelineOccupancyActive(channel)) return false;
  if (typeof isBoardAgendaView !== "function") return false;
  const ch = channel || (typeof conversationActiveEventChannel === "function"
    ? conversationActiveEventChannel() : null);
  return !!(ch && isBoardAgendaView(ch));
}

function timelineAgendaLike() {
  return timelineOccupancyActive() || timelineAgendaActive();
}

/** After Back from an event opened on the Events tab, show that row under the header. */
function timelineFocusAgendaEvent(eventId) {
  if (!eventId) return;
  const row = document.querySelector('.tl-ag-row[data-id="' + CSS.escape(eventId) + '"]');
  if (!row) return;
  document.querySelectorAll(".tl-ag-row.focused-highlight").forEach(function (el) {
    if (el !== row) el.classList.remove("focused-highlight");
  });
  row.classList.add("focused-highlight");
  const scroller = row.closest(".timeline-scroll");
  if (!scroller) return;
  const head = scroller.querySelector(".conv-page-head");
  const headBottom = head ? head.getBoundingClientRect().bottom : scroller.getBoundingClientRect().top;
  const rowTop = row.getBoundingClientRect().top;
  scroller.scrollTop += rowTop - headBottom - 12;
}

/** Board Events list: a tap opens the event chat, the same path as the Chats list. */
function timelineOpenAgendaEvent(eventId) {
  if (!eventId || !timelineAgendaActive()) return false;
  if (typeof openConversationsEvent !== "function") return false;
  openConversationsEvent(eventId);
  return true;
}

function timelineIsListLayout() {
  if (timelineOccupancyActive()) return false;
  if (timelineAgendaActive()) return true;
  if (typeof isBoardAgendaView === "function") {
    const ch = typeof conversationActiveEventChannel === "function"
      ? conversationActiveEventChannel() : null;
    if (ch && isBoardAgendaView(ch)) return true;
  }
  return typeof eventsLayoutMode === "function" && eventsLayoutMode() === "list";
}

function timelineIsCardLayout() {
  if (timelineOccupancyActive()) return false;
  if (typeof isBoardAgendaView === "function") {
    const ch = typeof conversationActiveEventChannel === "function"
      ? conversationActiveEventChannel() : null;
    if (ch && isBoardAgendaView(ch)) return false;
  }
  return typeof eventsLayoutMode === "function" && eventsLayoutMode() === "cards";
}

function timelineOccupancyTarget() {
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const id = (typeof S !== "undefined" && S.activeView?.kind === "channel")
    ? S.activeView.id
    : "";
  return (conn?.channels || []).find((c) => c.id === id) || null;
}

function timelineOccupancyActive(channel) {
  const ch = channel || timelineOccupancyTarget();
  if (typeof isPinnedOccupancyView === "function") return isPinnedOccupancyView(ch);
  return typeof isPinnedChannel === "function" && isPinnedChannel(ch);
}


const TL_OCCUPANCY_NO_ACCESS = "You do not have permission to see this event";

function timelineOccupancyPrefs(prefs) {
  const next = Object.assign({}, prefs || {});
  if (next.rsvpFilter === "only") next.rsvpFilter = "all";
  next.hideNo = false;
  next.hideMaybe = false;
  return next;
}

function timelineViewPrefs() {
  const prefs = typeof loadEventsViewPrefs === "function" ? loadEventsViewPrefs() : {};
  return timelineOccupancyActive() ? timelineOccupancyPrefs(prefs) : prefs;
}

function timelineOccupancyIsBand(ev) {
  const p = ev && ev.whenPrecision;
  return p === "day" || p === "unconfirmed" || p === "period" || !!(ev && ev.allDay);
}

function timelineOccupancyEndMs(ev) {
  if (typeof calendarEventEndMs === "function") return calendarEventEndMs(ev);
  const start = Number(ev && ev.when) || 0;
  const raw = ev && ev.duration;
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && asNum > 1000 && String(raw).trim() === String(asNum)) {
    return start + asNum;
  }
  if (typeof eventEndWhen === "function") {
    const end = eventEndWhen(ev);
    if (end) return end;
  }
  if (typeof eventDurationMsClient === "function") {
    return start + eventDurationMsClient(raw);
  }
  return start + 3600e3;
}

function timelineOccupancyDayBounds(day) {
  const next = new Date(day);
  next.setDate(next.getDate() + 1);
  return { start: day, end: next.getTime() };
}

function timelineOccupancyClip(ev, day) {
  const win = timelineOccupancyDayBounds(day);
  const start = Math.max(Number(ev && ev.when) || win.start, win.start);
  let end = timelineOccupancyEndMs(ev);
  if (!(end > start)) end = start + 3600e3;
  end = Math.min(end, win.end);
  if (end <= start) end = Math.min(start + 15 * 60e3, win.end);
  return { startMs: start, endMs: end };
}

function timelineOccupancyCoverDays(ev) {
  const start = timelineDay(ev && ev.when);
  const days = [start];
  if (timelineOccupancyIsBand(ev)) return days;
  const endMs = timelineOccupancyEndMs(ev);
  const last = timelineDay(endMs > Number(ev.when) ? endMs - 1 : ev.when);
  const cur = new Date(start);
  while (cur.getTime() < last) {
    cur.setDate(cur.getDate() + 1);
    days.push(cur.getTime());
  }
  return days;
}


function timelineOccupancyHomeChannelId(ev) {
  if (!ev || ev.limited) return "";
  const homeId = String(ev.channelId || "");
  const pin = timelineOccupancyTarget();
  if (!homeId || (pin && homeId === pin.id)) return "";
  return homeId;
}

function timelineOccupancyCanGo(ev) {
  const homeId = timelineOccupancyHomeChannelId(ev);
  if (!homeId) return false;
  const conn = timelineEventOwner(ev) || (typeof activeConn === "function" ? activeConn() : null);
  return !!(conn && (conn.channels || []).some(function (c) { return c.id === homeId; }));
}

function timelineOccupancySourceLabel(ev) {
  if (!ev) return "";
  const named = String(ev.sourceChannelName || "").trim();
  if (named) return named.charAt(0) === "#" ? named : "#" + named;
  if (ev.limited) return "";
  if (!timelineOccupancyHomeChannelId(ev)) return "";
  if (typeof calendarSourceLabel === "function") return calendarSourceLabel(ev);
  return timelineEventSource(ev);
}

function timelineOccupancyCreatorName(ev) {
  if (!ev) return "";
  if (typeof eventOrganiserName === "function") {
    const name = eventOrganiserName(ev);
    if (name) return name;
  }
  return String(ev.createdByName || "").trim();
}

function timelineOccupancyByHTML(ev) {
  const creator = timelineOccupancyCreatorName(ev);
  const source = timelineOccupancySourceLabel(ev);
  const bits = [];
  if (creator) bits.push("by " + esc(creator));
  if (source) bits.push(esc(source));
  if (!bits.length) return "";
  return '<p class="tl-invite-by">' + bits.join(" · ") + "</p>";
}

function timelineOccupancyTimeLabel(ev) {
  if (!ev) return "";
  if (ev.whenPrecision === "day" || ev.allDay) return "All day";
  if (ev.whenPrecision === "unconfirmed") return "TBC";
  if (ev.whenPrecision === "period") {
    return typeof periodLabelFor === "function"
      ? periodLabelFor(ev, ev.when)
      : timelineClockLabel(ev.when);
  }
  const start = timelineClockLabel(ev.when);
  const endMs = timelineOccupancyEndMs(ev);
  if (endMs > Number(ev.when)) return start + "–" + timelineClockLabel(endMs);
  return start;
}

function timelineOccupancyGoToEvent(ev) {
  const homeId = timelineOccupancyHomeChannelId(ev);
  if (!homeId || !ev) return;
  if (typeof setBoardSurface === "function") setBoardSurface(homeId, "conversations");
  if (typeof Nav !== "undefined" && typeof Nav.openChannel === "function") {
    Nav.openChannel(homeId);
  }
  if (typeof openConversationsEvent === "function") {
    openConversationsEvent(ev.id);
  }
  if (typeof S !== "undefined" && S.activeView?.id === homeId && typeof renderView === "function") {
    renderView();
  }
}

function timelineOccupancyIconName(ev) {
  if (ev && ev.limited) return "lock";
  return typeof eventIcon === "function" ? eventIcon(ev) : "calendar";
}

function timelineOccupancyTitle(ev) {
  if (ev && ev.limited) return TL_OCCUPANCY_NO_ACCESS;
  return timelineEventTitle(ev);
}

function timelineOccupancyPlace(ev) {
  if (!ev || ev.limited) return "";
  const pin = timelineOccupancyTarget();
  if (!(pin && pin.pinnedUserId != null)) return "";
  return timelineEventPlace(ev);
}


function timelineOccupancyOverflows(el) {
  if (!el) return false;
  return el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2;
}

function timelineOccupancyClipsBox(article, full) {
  if (!article || !full) return false;
  const box = article.getBoundingClientRect();
  const style = getComputedStyle(article);
  const top = box.top + parseFloat(style.paddingTop) + parseFloat(style.borderTopWidth);
  const bottom = box.bottom - parseFloat(style.paddingBottom) - parseFloat(style.borderBottomWidth);
  const left = box.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
  const right = box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
  const nodes = full.querySelectorAll("h5, .tl-invite-by, .tl-invite-meta, .tl-occupancy-go, .tl-invite-icon");
  for (let i = 0; i < nodes.length; i++) {
    const r = nodes[i].getBoundingClientRect();
    if (!r.width && !r.height) continue;
    if (r.bottom > bottom + 2 || r.right > right + 2 || r.top < top - 2 || r.left < left - 2) return true;
    if (timelineOccupancyOverflows(nodes[i])) return true;
  }
  return false;
}

function timelineSyncOccupancyMinis(root) {
  const scope = root && root.querySelectorAll ? root : document;
  scope.querySelectorAll(".tl-occupancy-block").forEach(function (article) {
    article.classList.remove("is-mini");
    const full = article.querySelector(".tl-occupancy-full");
    if (!full) return;
    void article.offsetHeight;
    article.classList.toggle("is-mini", timelineOccupancyClipsBox(article, full));
  });
}

function timelineOpenOccupancyInfo(ev) {
  if (!ev || typeof AshModal === "undefined" || typeof AshModal.open !== "function") return;
  const title = timelineOccupancyTitle(ev);
  const canGo = !ev.limited && timelineOccupancyCanGo(ev);
  const opened = AshModal.open({
    className: "tl-occupancy-info-modal",
    html: '<div class="modal-card tl-occupancy-info-card" role="dialog" aria-modal="true" aria-labelledby="tl-occ-info-title">'
      + '<button type="button" class="tl-occupancy-info-close" aria-label="Close">' + ic("x") + '</button>'
      + '<div class="tl-occupancy-info-hero" aria-hidden="true">' + ic(timelineOccupancyIconName(ev)) + '</div>'
      + '<h4 id="tl-occ-info-title">' + esc(title) + '</h4>'
      + timelineOccupancyByHTML(ev)
      + '<div class="tl-invite-meta"><strong>' + ic("clock", "ico-inline")
      + esc(timelineOccupancyTimeLabel(ev)) + '</strong>'
      + (timelineOccupancyPlace(ev)
        ? '<span>' + ic("pin", "ico-inline") + esc(timelineOccupancyPlace(ev)) + '</span>'
        : "")
      + '</div>'
      + '<div class="actions">'
      + (canGo
        ? '<div><button type="button" data-tl-go-event>Go to this event</button></div>'
        : '<div></div>')
      + '<div><button type="button" class="cancel" data-tl-occ-info-close>Close</button></div>'
      + '</div></div>',
    singleton: "replace",
    closeOnEscape: true,
    restoreFocus: true,
  });
  if (!opened) return;
  opened.overlay.querySelectorAll("[data-tl-occ-info-close], .tl-occupancy-info-close").forEach(function (btn) {
    btn.addEventListener("click", function () { opened.close(); });
  });
  opened.overlay.querySelector("[data-tl-go-event]")?.addEventListener("click", function () {
    opened.close();
    timelineOccupancyGoToEvent(ev);
  });
}


/* Pinned location / person agenda (compact rows).
 * Answers "what's coming up here, and where are the gaps?": one row per
 * event (time column, title always visible), explicit free gaps, a "now"
 * marker on today, overlap tags, and merged free-day ranges (see
 * timelineBuildFeed). Replaces the duration-lane canvas, which hid titles on
 * short events and wasted height on long ones. */
const TL_OCC_GAP_MIN_MS = 60 * 60e3;
const TL_OCC_LEAD_GAP_MIN_MS = 30 * 60e3;

function timelineOccupancyDurationText(ms) {
  const mins = Math.round(ms / 60e3);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return m + "m";
  return m ? h + "h " + m + "m" : h + "h";
}

function timelineOccupancyRowTimes(ev, clip, day) {
  if (timelineOccupancyIsBand(ev)) {
    return { start: timelineOccupancyTimeLabel(ev), end: "" };
  }
  const bounds = timelineOccupancyDayBounds(day);
  const startsBefore = Number(ev.when) < bounds.start;
  const endsAfter = timelineOccupancyEndMs(ev) > bounds.end;
  if (startsBefore && endsAfter) return { start: "All day", end: "" };
  if (startsBefore) return { start: "Until", end: timelineClockLabel(clip.endMs) };
  if (endsAfter) return { start: timelineClockLabel(clip.startMs), end: "onwards" };
  const end = clip.endMs > clip.startMs ? timelineClockLabel(clip.endMs) : "";
  return { start: timelineClockLabel(clip.startMs), end: end };
}

function timelineOccupancyRowTitle(ev) {
  return ev && ev.limited ? "Busy" : timelineEventTitle(ev);
}

function timelineOccupancyRowSub(ev) {
  if (ev && ev.limited) return "Private event";
  const bits = [];
  const creator = timelineOccupancyCreatorName(ev);
  const source = timelineOccupancySourceLabel(ev);
  const place = timelineOccupancyPlace(ev);
  if (creator) bits.push(creator);
  if (source) bits.push(source);
  if (place) bits.push(place);
  return bits.join(" · ");
}

function timelineAgendaReply(ev) {
  const state = timelinePresentationState(ev);
  if (state.organiser) return { text: "Organising", cls: "is-organiser", state: state };
  if (state.rsvp === "going") {
    return { text: typeof eventRsvpStatusLabel === "function" ? eventRsvpStatusLabel("going", ev) : "Going", cls: "is-going", state: state };
  }
  if (state.rsvp === "signedUp") return { text: "Signed up", cls: "is-going", state: state };
  if (state.kind === "declined") {
    return { text: typeof eventConfirmAttendance === "function" && eventConfirmAttendance(ev) ? "Declined" : "Can’t go", cls: "is-declined", state: state };
  }
  if (state.rsvp === "maybe") return { text: "Maybe", cls: "is-maybe", state: state };
  if (state.kind === "unanswered") return { text: "Reply?", cls: "is-unanswered", state: state };
  return { text: "", cls: "", state: state };
}

function timelineAgendaRow(ev, clip, day, f) {
  const times = timelineOccupancyRowTimes(ev, clip, day);
  const title = timelineEventTitle(ev);
  const reply = timelineAgendaReply(ev);
  const going = timelineGoingIds(ev).length;
  const chat = timelineChatMeta(ev);
  const declined = reply.cls === "is-declined";
  const unread = !declined && (chat.unread > 0
    || (typeof isEventRowUnread === "function" && isEventRowUnread(ev)));
  const organiser = typeof eventOrganiserName === "function" ? eventOrganiserName(ev) : "";
  const bits = [];
  if (f.now) bits.push("Happening now");
  if (ev.approvalStatus === "pending") bits.push("Awaiting approval");
  else if (!reply.state.organiser && organiser) bits.push("by " + organiser);
  if (going) bits.push(going + " going");
  if (f.overlap) bits.push("Overlaps");
  if (unread) bits.push(chat.unread > 0 ? chat.unread + " new" : "New messages");
  const sub = bits.join(" · ");
  const article = document.createElement("article");
  const opened = typeof S !== "undefined" && S.conversationLastOpenedId === ev.id;
  article.className = "tl-event-row tl-occupancy-block tl-occ-row tl-ag-row"
    + (f.past ? " is-past" : "")
    + (f.now ? " is-now" : "")
    + (f.overlap ? " is-overlap" : "")
    + (declined ? " is-declined" : "")
    + (unread ? " is-unread" : "")
    + (reply.cls === "is-unanswered" ? " is-unanswered" : "")
    + (opened ? " focused-highlight" : "")
    + (ev._pending ? " pending-sync" : "");
  article.dataset.id = ev.id;
  article.dataset.when = String(ev.when);
  article.dataset.day = String(day);
  article.tabIndex = 0;
  article.setAttribute("role", "button");
  const timeSpoken = times.end
    ? (times.start === "Until" ? "until " + times.end
      : times.end === "onwards" ? "from " + times.start + " onwards"
        : times.start + " to " + times.end)
    : times.start;
  article.setAttribute("aria-label", title + ", " + timeSpoken
    + (reply.text ? ", " + (reply.cls === "is-unanswered" ? "not replied yet"
      : reply.cls === "is-organiser" ? "you're organising" : reply.text) : "")
    + (sub ? ", " + sub.replace(/ · /g, ", ") : "")
    + (f.past ? ", finished" : ""));
  const icon = declined ? "minus" : (typeof eventIcon === "function" ? eventIcon(ev) : "calendar");
  let accessory = "";
  if (reply.cls === "is-unanswered" && reply.state.canRsvp) {
    const yes = typeof eventPositiveRsvpStatus === "function" ? eventPositiveRsvpStatus(ev) : "going";
    accessory = '<span class="tl-ag-rsvp">'
      + '<button type="button" class="tl-ag-rsvp-btn is-no" data-tl-rsvp="out" aria-label="'
      + esc(typeof eventRsvpNoActionLabel === "function" ? eventRsvpNoActionLabel(ev) : "Can't go") + ': ' + esc(title) + '">' + ic("cancel") + '</button>'
      + '<button type="button" class="tl-ag-rsvp-btn is-yes" data-tl-rsvp="' + esc(yes) + '" aria-label="'
      + esc(typeof eventRsvpYesActionLabel === "function" ? eventRsvpYesActionLabel(ev) : "Going") + ': ' + esc(title) + '">' + ic("check") + '</button>'
      + '</span>';
  } else if (reply.text && reply.cls !== "is-organiser") {
    accessory = '<span class="tl-occ-tag tl-ag-reply ' + reply.cls + '" aria-hidden="true">' + esc(reply.text) + '</span>';
  }
  article.innerHTML = '<span class="tl-occ-time" aria-hidden="true"><strong>' + esc(times.start) + '</strong>'
    + (times.end ? '<small>' + esc(times.end) + '</small>' : "") + '</span>'
    + '<span class="tl-occ-icon" aria-hidden="true">' + ic(icon) + '</span>'
    + '<span class="tl-occ-copy" aria-hidden="true"><strong class="tl-occ-title">' + esc(title) + '</strong>'
    + (sub ? '<small class="tl-occ-sub">' + esc(sub) + '</small>' : "") + '</span>'
    + accessory;
  return article;
}

function timelineOccupancyRow(ev, clip, day, flags) {
  const f = flags || {};
  if (f.agenda) return timelineAgendaRow(ev, clip, day, f);
  const limited = !!(ev && ev.limited);
  const times = timelineOccupancyRowTimes(ev, clip, day);
  const title = timelineOccupancyRowTitle(ev);
  const sub = timelineOccupancyRowSub(ev);
  const article = document.createElement("article");
  article.className = "tl-event-row tl-occupancy-block tl-occ-row"
    + (limited ? " is-limited" : "")
    + (f.past ? " is-past" : "")
    + (f.now ? " is-now" : "")
    + (f.overlap ? " is-overlap" : "");
  article.dataset.id = ev.id;
  article.dataset.when = String(ev.when);
  article.dataset.day = String(day);
  article.tabIndex = 0;
  article.setAttribute("role", "button");
  const timeSpoken = times.end
    ? (times.start === "Until" ? "until " + times.end
      : times.end === "onwards" ? "from " + times.start + " onwards"
        : times.start + " to " + times.end)
    : times.start;
  article.setAttribute("aria-label", title + ", " + timeSpoken
    + (sub ? ", " + sub.replace(/ · /g, ", ") : "")
    + (f.now ? ", happening now" : "")
    + (f.overlap ? ", overlaps another event" : "")
    + (f.past ? ", finished" : ""));
  article.innerHTML = '<span class="tl-occ-time" aria-hidden="true"><strong>' + esc(times.start) + '</strong>'
    + (times.end ? '<small>' + esc(times.end) + '</small>' : "") + '</span>'
    + '<span class="tl-occ-icon" aria-hidden="true">' + ic(timelineOccupancyIconName(ev)) + '</span>'
    + '<span class="tl-occ-copy" aria-hidden="true"><strong class="tl-occ-title">' + esc(title) + '</strong>'
    + (sub ? '<small class="tl-occ-sub">' + esc(sub) + '</small>' : "") + '</span>'
    + (f.now ? '<span class="tl-occ-tag is-now" aria-hidden="true">Now</span>'
      : f.overlap ? '<span class="tl-occ-tag" aria-hidden="true">Overlaps</span>' : "");
  return article;
}

function timelineOccupancyGapRow(text, opts) {
  const o = opts || {};
  const gap = document.createElement("div");
  gap.className = "tl-occ-gap" + (o.now ? " is-now" : "");
  gap.dataset.gap = "1";
  gap.innerHTML = (o.now ? '<span class="tl-occ-now-label">Now</span>' : "")
    + '<span class="tl-occ-gap-text">' + esc(text) + '</span>';
  return gap;
}

function timelineOccupancyDayStack(day, events, opts) {
  const agenda = !!(opts && opts.agenda);
  const stack = document.createElement("div");
  stack.className = "tl-occupancy-stack tl-occ-agenda";
  stack.dataset.id = "occ-" + day;
  stack.dataset.day = String(day);

  const now = Date.now();
  const bounds = timelineOccupancyDayBounds(day);
  const isToday = now >= bounds.start && now < bounds.end;

  const bandEvs = [];
  const timed = [];
  (events || []).forEach(function (ev) {
    if (timelineOccupancyIsBand(ev)) bandEvs.push(ev);
    else {
      const clip = timelineOccupancyClip(ev, day);
      timed.push({ ev: ev, startMs: clip.startMs, endMs: clip.endMs });
    }
  });
  bandEvs.sort(function (a, b) { return Number(a.when) - Number(b.when); });
  timed.sort(function (a, b) { return a.startMs - b.startMs || a.endMs - b.endMs; });

  bandEvs.forEach(function (ev) {
    stack.appendChild(timelineOccupancyRow(ev, { startMs: bounds.start, endMs: bounds.end }, day, { agenda: agenda }));
  });

  if (!timed.length) {
    if (!bandEvs.length) {
      stack.appendChild(timelineOccupancyGapRow(isToday ? "Free for the rest of today" : "Free", { now: isToday }));
    }
    return stack;
  }

  // busyEnd = latest end among rows already shown (finished rows on today
  // don't count). Gaps are measured from busyEnd; on today never before now.
  let busyEnd = -Infinity;
  let nowShown = !isToday;
  timed.forEach(function (row) {
    const past = isToday && row.endMs <= now;
    const live = isToday && row.startMs <= now && row.endMs > now;
    if (!nowShown && row.startMs > now) {
      const lead = row.startMs - Math.max(now, busyEnd);
      stack.appendChild(timelineOccupancyGapRow(
        lead >= TL_OCC_LEAD_GAP_MIN_MS ? "Free until " + timelineClockLabel(row.startMs) : "Next up",
        { now: true }
      ));
      nowShown = true;
    } else if (!past && busyEnd > -Infinity) {
      const from = isToday ? Math.max(busyEnd, now) : busyEnd;
      if (row.startMs - from >= TL_OCC_GAP_MIN_MS) {
        stack.appendChild(timelineOccupancyGapRow(
          "Free " + timelineClockLabel(from) + "–" + timelineClockLabel(row.startMs)
            + " · " + timelineOccupancyDurationText(row.startMs - from)
        ));
      }
    }
    const overlap = !past && !live && row.startMs < busyEnd;
    if (live) nowShown = true;
    stack.appendChild(timelineOccupancyRow(row.ev, row, day, { past: past, now: live, overlap: overlap, agenda: agenda }));
    if (!past) busyEnd = Math.max(busyEnd, row.endMs);
  });
  if (isToday && !nowShown) {
    // Every timed event today has already finished.
    stack.appendChild(timelineOccupancyGapRow("Free for the rest of today", { now: true }));
  } else if (isToday && busyEnd > now && busyEnd < bounds.end - TL_OCC_GAP_MIN_MS) {
    stack.appendChild(timelineOccupancyGapRow("Free after " + timelineClockLabel(busyEnd)));
  }
  return stack;
}

function timelineOccupancyRangeHeading(first, last) {
  if (first === last) return timelineDateHeading(first);
  const a = new Date(first);
  const b = new Date(last);
  const month = function (d) {
    return d.toLocaleDateString([], { month: "short" }).replace(/\.$/, "").toUpperCase();
  };
  const crosses = a.getMonth() !== b.getMonth();
  return timelineDateHeading(first) + (crosses ? " " + month(a) : "")
    + " – " + timelineDateHeading(last) + (crosses ? " " + month(b) : "");
}

function timelineOccupancyRangeCount(first, last) {
  let n = 0;
  const cur = new Date(first);
  while (cur.getTime() <= last) { n += 1; cur.setDate(cur.getDate() + 1); }
  return n;
}

function timelineWireOccupancyMonth(scroller) {
  if (!scroller || !timelineAgendaLike()) return;
  const bind = typeof onceFlag === "function" ? onceFlag(scroller, "tlOccMonth") : !scroller.dataset.tlOccMonth;
  if (!bind) return;
  if (typeof onceFlag !== "function") scroller.dataset.tlOccMonth = "1";
  let raf = 0;
  scroller.addEventListener("scroll", function () {
    if (raf || !timelineAgendaLike()) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      const head = document.querySelector(".tl-sticky-head");
      const line = head ? head.getBoundingClientRect().bottom : scroller.getBoundingClientRect().top;
      const groups = scroller.querySelectorAll(".tl-day-group");
      for (let i = 0; i < groups.length; i++) {
        const r = groups[i].getBoundingClientRect();
        if (r.bottom > line + 8) {
          const day = Number(groups[i].dataset.day);
          if (Number.isFinite(day)) timelineSetHeaderMonth(day);
          break;
        }
      }
    });
  }, { passive: true });
}

function timelineComposerFocused() {
  try {
    return document.activeElement && document.activeElement.id === "tl-sheet-input";
  } catch {
    return false;
  }
}

function timelineVisibleHeight() {
  const inner = (typeof window !== "undefined" && window.innerHeight) || 0;
  const vv = (typeof window !== "undefined" && window.visualViewport
    && window.visualViewport.height) || inner;
  return Math.min(inner || vv, vv || inner);
}

function timelineImeVisible() {
  const h = timelineVisibleHeight();
  if (h > timelineImeBaseline) timelineImeBaseline = h;
  return timelineNativeImeCssPx() > 80 || timelineImeBaseline - h > 80;
}

function timelineNativeImeCssPx() {
  let native = 0;
  let live = false;
  try {
    if (typeof window !== "undefined" && window.AshNative
      && typeof AshNative.imeInsetPx === "function") {
      native = Number(AshNative.imeInsetPx()) || 0;
      live = true;
    }
  } catch {}
  if (!live && typeof window !== "undefined") {
    native = Number(window.__ashImeInsetPx) || 0;
  }
  if (!native) return 0;
  const layoutH = (typeof window !== "undefined" && window.innerHeight) || 0;
  const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  if (layoutH && native > layoutH * 0.85) native = Math.round(native / dpr);
  return native;
}

function timelineVisibleBottomPx() {
  const layoutH = (typeof window !== "undefined" && window.innerHeight) || 0;
  const vv = typeof window !== "undefined" && window.visualViewport;
  const vvBottom = vv ? Math.round(vv.offsetTop + vv.height) : layoutH;
  let bottom = layoutH ? Math.min(layoutH, vvBottom) : vvBottom;
  const native = timelineNativeImeCssPx();
  const layoutResized = timelineImeBaseline > 0 && layoutH < timelineImeBaseline - 80;
  const viewportResized = !!(vv && layoutH && vv.height < layoutH - 80);
  // Native insets are only needed while the keyboard overlays an unchanged
  // viewport. With ADJUST_RESIZE, subtracting them again hides the composer.
  if (native > 0 && layoutH && !layoutResized && !viewportResized) {
    bottom = Math.min(bottom, layoutH - native);
  }
  return bottom;
}

function timelineImeInsetPx(sheet) {
  if (!sheet || typeof window === "undefined") return 0;
  const viewBottom = timelineVisibleBottomPx();
  const overlap = Math.ceil(sheet.getBoundingClientRect().bottom - viewBottom);
  return overlap > 0 ? overlap : 0;
}

function timelineSetNativeKeyboardOverlay(on) {
  try {
    if (typeof window !== "undefined" && window.AshNative
      && typeof AshNative.setKeyboardOverlay === "function") {
      AshNative.setKeyboardOverlay(!!on);
    }
  } catch {}
}

function timelineAttachSheetHost(expanded) {
  const host = document.getElementById("tl-sheet-host");
  const mode = document.querySelector(".timeline-view-mode");
  if (mode) mode.classList.toggle("is-sheet-expanded", !!expanded);
  if (!host) return;
  host.classList.toggle("is-expanded", !!expanded);
  if (mode && host.parentElement !== mode) mode.appendChild(host);
}

function timelineSetSheetExpanded(on, opts) {
  const fromIme = !!(opts && opts.fromIme);
  if (!fromIme) {
    timelineSheetImeExpanded = false;
    timelineSheetImeSeen = false;
  }
  const next = !!(on && timelineSheetEventId);
  const input = document.getElementById("tl-sheet-input");
  const keepFocus = !!(input && document.activeElement === input);
  if (!next && keepFocus && input) {
    try { input.blur(); } catch {}
  }
  timelineSheetExpanded = next;
  const handle = document.querySelector(".tl-sheet-handle");
  if (handle) {
    handle.setAttribute("aria-expanded", next ? "true" : "false");
    handle.setAttribute("aria-label", next ? "Collapse" : "Expand");
  }
  const sheet = document.querySelector(".tl-event-sheet");
  if (sheet) {
    sheet.classList.toggle("is-expanded", next);
    sheet.style.transform = "";
  }
  timelineAttachSheetHost(next);
  timelineSyncSheetHeight();
  timelineSyncIme();
  if (next && keepFocus && input) {
    try { input.focus({ preventScroll: true }); } catch {
      try { input.focus(); } catch {}
    }
  }
}

function timelineSyncIme() {
  if (typeof document === "undefined") return;
  const ime = timelineImeVisible();
  document.documentElement.classList.toggle("ime-open", ime);
  const creating = typeof document !== "undefined" && document.body.classList.contains("tl-creating");
  const sheetOpen = !!timelineSheetEventId;
  const editingDesc = !!document.querySelector(".tl-desc-editor");
  // Event chat uses the platform's resize mode so its composer has a real,
  // keyboard-safe viewport. The create flow retains its overlay treatment.
  timelineSetNativeKeyboardOverlay(creating);
  const insetOn = !!(sheetOpen && ime && !editingDesc);
  const mode = document.querySelector(".timeline-view-mode");
  if (mode) mode.classList.toggle("is-ime", insetOn);
  const sheet = document.querySelector(".tl-event-sheet");
  if (sheet) sheet.classList.toggle("is-ime", insetOn);
  if (insetOn && sheet) {
    if (timelineSheetImeExpanded) timelineSheetImeSeen = true;
    const inset = timelineImeInsetPx(sheet);
    if (mode) mode.style.setProperty("--tl-ime-inset", inset + "px");
    sheet.style.setProperty("--tl-ime-inset", inset + "px");
    timelineSyncSheetHeight();
    const msgs = document.getElementById("tl-sheet-messages");
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  } else {
    if (mode) mode.style.removeProperty("--tl-ime-inset");
    if (sheet) sheet.style.removeProperty("--tl-ime-inset");
    if (timelineSheetImeExpanded && (timelineSheetImeSeen || !timelineComposerFocused())) {
      timelineSheetImeExpanded = false;
      timelineSheetImeSeen = false;
      timelineSetSheetExpanded(false, { fromIme: true });
      return;
    }
    if (timelineSheetExpanded) timelineSyncSheetHeight();
    if (timelineRefreshPending) timelineQueueLiveRefresh();
  }
}

function timelineWireIme() {
  if (timelineImeWired || typeof window === "undefined") return;
  timelineImeWired = true;
  timelineSyncIme();
  window.addEventListener("resize", timelineSyncIme);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", timelineSyncIme);
    window.visualViewport.addEventListener("scroll", timelineSyncIme);
  }
  window.addEventListener("ash-ime-inset", timelineSyncIme);
}

function timelineDay(ts) {
  return dayStart(Number(ts) || Date.now());
}

function timelineDateKey(ts) {
  const d = new Date(timelineDay(ts));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

function timelineMonthStart(ts) {
  const d = new Date(timelineDay(ts));
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function timelineEventTitle(ev) {
  if (!ev) return "Event";
  if (ev.limited && timelineOccupancyActive()) return TL_OCCUPANCY_NO_ACCESS;
  return (typeof eventDisplayTitle === "function" && eventDisplayTitle(ev))
    || shown(ev._title || ev.title || "")
    || "Event";
}

function timelineEventPlace(ev) {
  if (!ev) return "";
  const raw = ev._where != null ? ev._where : ev.where;
  if (typeof raw === "boolean") return "";
  return String(typeof shown === "function" ? shown(raw || "") : (raw || "")).trim();
}

function timelineEventSource(ev) {
  if (!ev) return "";
  if (ev._linkedChannelName) return "# " + ev._linkedChannelName;
  if (ev._serverName && ev._connId && ev._connId !== S.activeConnId) return ev._serverName;
  return "";
}

function timelineEventOwner(ev) {
  return (typeof ownerConnFor === "function" ? ownerConnFor(ev) : null)
    || (typeof activeConn === "function" ? activeConn() : null);
}

function timelineMyRsvp(ev) {
  const uid = typeof myIdOf === "function" ? myIdOf(ev) : null;
  return uid && ev && ev.rsvps ? ev.rsvps[uid] || null : null;
}

function timelineCanRsvp(ev) {
  return !!(ev && (typeof eventAllowsRsvpToggle !== "function" || eventAllowsRsvpToggle(ev)));
}

function timelinePresentationState(ev) {
  if (timelineOccupancyActive()) {
    return { kind: "occupancy", rsvp: null, organiser: false, canRsvp: false };
  }
  const rsvp = timelineMyRsvp(ev);
  const organiser = !!(ev && typeof isEventOrganiser === "function" && isEventOrganiser(ev));
  const canRsvp = timelineCanRsvp(ev);
  let kind = "compact";
  if (rsvp === "out") kind = "declined";
  else if (!rsvp && !organiser && canRsvp
      && ev.approvalStatus !== "pending" && ev.approvalStatus !== "blocked") {
    kind = "unanswered";
  }
  return { kind: kind, rsvp: rsvp, organiser: organiser, canRsvp: canRsvp };
}

function timelineEventEnd(ev) {
  const start = Number(ev && ev.when) || 0;
  const duration = Math.max(0, Number(ev && ev.duration) || 0);
  return start + duration;
}

function timelineMultiDaySegments(ev, cells) {
  if (!ev || !Array.isArray(cells)) return [];
  const start = timelineDay(ev.when);
  const rawEnd = timelineEventEnd(ev);
  const end = timelineDay(rawEnd > ev.when ? rawEnd - 1 : ev.when);
  if (end <= start) return [];
  return cells.filter(function (cell) {
    return cell.day >= start && cell.day <= end;
  }).map(function (cell) {
    const d = new Date(cell.day);
    const monday = d.getDay() === 1;
    const sunday = d.getDay() === 0;
    return {
      day: cell.day,
      eventId: ev.id,
      starts: cell.day === start,
      ends: cell.day === end,
      rowStarts: monday,
      rowEnds: sunday,
      showTitle: cell.day === start || monday,
    };
  });
}

function timelineFutureEvents(events, prefs, now) {
  const floor = timelineDay(now == null ? Date.now() : now);
  return (events || []).filter(function (ev) {
    if (!ev || ev.chainOf || (Number(ev.when) < floor && !(ev.calendarImported && ev.calendarEndMs > floor))) return false;
    return typeof eventPassesRsvpFilter !== "function"
      || eventPassesRsvpFilter(ev, prefs);
  }).slice().sort(function (a, b) {
    return Number(a.when) - Number(b.when);
  });
}

function timelineHiddenCount(events, prefs, now) {
  const floor = timelineDay(now == null ? Date.now() : now);
  let all = 0;
  let shown = 0;
  (events || []).forEach(function (ev) {
    if (!ev || ev.chainOf || Number(ev.when) < floor) return;
    all += 1;
    if (typeof eventPassesRsvpFilter !== "function" || eventPassesRsvpFilter(ev, prefs)) {
      shown += 1;
    }
  });
  return Math.max(0, all - shown);
}

function timelineShownCount(events, prefs, now) {
  const floor = timelineDay(now == null ? Date.now() : now);
  let shown = 0;
  (events || []).forEach(function (ev) {
    if (!ev || ev.chainOf || Number(ev.when) < floor) return;
    if (typeof eventPassesRsvpFilter !== "function" || eventPassesRsvpFilter(ev, prefs)) {
      shown += 1;
    }
  });
  return shown;
}

function timelineStatusCountText(events, prefs, now) {
  const mode = typeof rsvpFilterMode === "function" ? rsvpFilterMode(prefs) : "all";
  if (mode === "only" || mode === "hosting") {
    return String(timelineShownCount(events, prefs, now));
  }
  const hidden = timelineHiddenCount(events, prefs, now);
  return hidden > 0 ? hidden + " hidden" : "";
}

function timelineFilterLabel(mode) {
  if (mode === "only") return "needs reply";
  if (mode === "hosting") return "organising";
  return "";
}

function timelineWeekMonday(ts) {
  const d = new Date(timelineDay(ts));
  const mondayOffset = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - mondayOffset).getTime();
}

/** Days from today through the Sunday of next week (Monday-start weeks). */
function timelineScaffoldDays(now) {
  const today = timelineDay(now == null ? Date.now() : now);
  const monday = timelineWeekMonday(today);
  const end = new Date(monday);
  end.setDate(end.getDate() + 13);
  const days = [];
  const cursor = new Date(today);
  while (cursor.getTime() <= end.getTime()) {
    days.push(cursor.getTime());
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function timelineMonthCells(year, month, todayTs, selectedTs, events) {
  const first = new Date(year, month, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - mondayOffset);
  const today = timelineDay(todayTs);
  const selected = timelineDay(selectedTs);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const day = d.getTime();
    const touching = (events || []).filter(function (ev) {
      const start = timelineDay(ev.when);
      const rawEnd = timelineEventEnd(ev);
      const end = timelineDay(rawEnd > ev.when ? rawEnd - 1 : ev.when);
      return day >= start && day <= end;
    });
    cells.push({
      day: day,
      key: timelineDateKey(day),
      number: d.getDate(),
      muted: d.getMonth() !== month,
      today: day === today,
      selected: day === selected,
      past: day < today,
      events: touching,
    });
  }
  while (cells.length > 7) {
    const tail = cells.slice(-7);
    if (tail.every(function (c) { return c.muted; })) cells.splice(-7);
    else break;
  }
  return cells;
}

function timelineClockLabel(ts) {
  if (typeof formatClockTime === "function") return formatClockTime(ts);
  const d = new Date(ts);
  const h24 = d.getHours();
  const mins = d.getMinutes();
  const h12 = h24 % 12 || 12;
  const ap = h24 < 12 ? "am" : "pm";
  return mins ? h12 + ":" + String(mins).padStart(2, "0") + ap : String(h12) + ap;
}

function timelineTimeLabel(ev, includeEnd) {
  if (!ev) return "";
  if (ev.whenPrecision === "day") return "All day";
  if (ev.whenPrecision === "unconfirmed") return "TBC";
  if (ev.whenPrecision === "period") {
    return typeof periodLabelFor === "function"
      ? periodLabelFor(ev, ev.when)
      : timelineClockLabel(ev.when);
  }
  const start = timelineClockLabel(ev.when);
  if (!includeEnd || !(Number(ev.duration) > 0)) return start;
  return start + "–" + timelineClockLabel(Number(ev.when) + Number(ev.duration));
}

function timelineGoingIds(ev) {
  return Object.keys(ev && ev.rsvps || {}).filter(function (id) {
    return ev.rsvps[id] === "going";
  });
}

/** True when someone besides you has RSVP'd or written a note (PAT-destructive-5). */
function timelineEventOthersInvolved(ev) {
  const me = typeof myIdOf === "function" ? myIdOf(ev) : null;
  if (!ev || !me) return true;
  const rsvps = ev.rsvps || {};
  for (const id of Object.keys(rsvps)) {
    if (id && id !== me) return true;
  }
  const notes = ev.notes || [];
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (n && n.userId && n.userId !== me && !n.activity) return true;
  }
  return false;
}

function hideLocalTimelineEvent(owner, ev) {
  if (!owner || !Array.isArray(owner.events) || !ev) return null;
  const index = owner.events.findIndex(e => e.id === ev.id);
  if (index < 0) return null;
  const saved = owner.events[index];
  owner.events.splice(index, 1);
  return { owner, index, ev: saved };
}

function restoreLocalTimelineEvent(snap) {
  if (!snap || !snap.owner || !snap.ev) return;
  const list = snap.owner.events || (snap.owner.events = []);
  const i = Math.min(Math.max(0, snap.index), list.length);
  list.splice(i, 0, snap.ev);
}

/** True when someone besides the current user can see this event's home group. */
function timelineEventHasOtherViewers(ev) {
  const owner = timelineEventOwner(ev);
  if (!owner) return false;
  if (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(owner)) return false;
  const me = typeof myIdOf === "function" ? myIdOf(ev) : owner.me && owner.me.id;
  const ch = (owner.channels || []).find(function (c) { return c.id === ev.channelId; });
  if (!ch) return false;
  return (owner.members || []).some(function (user) {
    if (!user || user.id === me) return false;
    return typeof channelVisibleTo !== "function" || channelVisibleTo(ch, user, owner);
  });
}

function timelineChatMeta(ev) {
  const owner = timelineEventOwner(ev);
  const messages = typeof eventDetailChatMessages === "function"
    ? eventDetailChatMessages(ev, owner)
    : [];
  const unread = typeof eventDetailChatUnreadCount === "function"
    ? eventDetailChatUnreadCount(ev, owner, messages)
    : (typeof isEventRowUnread === "function" && isEventRowUnread(ev) ? 1 : 0);
  return { count: messages.length, unread: unread, messages: messages, owner: owner };
}

function timelineEventActions(ev) {
  if (ev?.calendarImported) return [];
  const state = timelinePresentationState(ev);
  const owner = timelineEventOwner(ev);
  const me = typeof myIdOf === "function" ? myIdOf(ev) : owner && owner.me && owner.me.id;
  const editable = typeof canEditEvent === "function"
    ? canEditEvent(ev)
    : (typeof canManage === "function" && canManage(ev));
  const manageable = typeof canManage === "function" && canManage(ev);
  const actions = [];
  if (state.kind === "unanswered") {
    actions.push("accept", "decline");
  } else if (state.canRsvp) {
    actions.push("rsvp");
  }
  if (editable) actions.push("edit");
  actions.push("image", "share");
  actions.push("art");
  try {
    if (typeof getLocalMemoryPhoto === "function" && getLocalMemoryPhoto(ev)) actions.push("clear-art");
  } catch {}
  if (owner && typeof canManageRoutines === "function" && canManageRoutines(owner)) {
    actions.push("routine");
  }
  if (owner && typeof canReport === "function" && canReport(owner)
      && ev.createdBy && ev.createdBy !== me) {
    actions.push("report");
  }
  if (manageable || editable) actions.push("delete");
  return actions;
}

function timelineDateHeading(day) {
  const today = timelineDay(Date.now());
  if (day === today) return "TODAY";
  const d = new Date(day);
  return d.toLocaleDateString([], { weekday: "short" }).toUpperCase() + " " + d.getDate();
}

function timelineMonthName(day) {
  if (typeof periodMonthLabel === "function") return periodMonthLabel(day);
  const d = new Date(timelineDay(day));
  const month = d.toLocaleDateString([], { month: "short" }).replace(/\.$/, "");
  return d.getFullYear() !== new Date().getFullYear()
    ? month + " " + d.getFullYear()
    : month;
}

/** "This week" / "Next week"; farther days show the month of that day. */
function timelineContextLabel(day, now) {
  const ts = timelineDay(day);
  const nowDay = timelineDay(now == null ? Date.now() : now);
  const weekStart = timelineWeekMonday(ts);
  const thisMon = timelineWeekMonday(nowDay);
  if (weekStart === thisMon) return "This week";
  const nextMon = new Date(thisMon);
  nextMon.setDate(nextMon.getDate() + 7);
  if (weekStart === nextMon.getTime()) return "Next week";
  return timelineMonthName(ts);
}

function timelineSourceEvents(context) {
  return timelineFutureEvents(context.events, timelineViewPrefs(), Date.now());
}

function timelineEmptyState(context, events) {
  if (events.length) return null;
  const hidden = timelineHiddenCount(context.events, timelineViewPrefs(), Date.now()) > 0;
  return hidden
    ? { text: "No events match your filters", action: "Show all events", reset: true }
    : { text: timelineOccupancyActive(context && context.targetChannel) ? "Nothing booked" : "No upcoming events", action: timelineShowCreateFab() ? "New event" : "", reset: false };
}

function timelinePaintEmptyState(view, context, events) {
  const state = timelineEmptyState(context, events);
  let empty = view.querySelector(".tl-empty-state");
  if (!state) { if (empty) empty.remove(); return; }
  if (!empty) {
    empty = document.createElement("section");
    empty.className = "tl-empty-state";
    view.querySelector(".tl-sticky-head").after(empty);
  }
  empty.innerHTML = '<p role="status">' + esc(state.text) + '</p>'
    + (state.action ? '<button type="button">' + esc(state.action) + '</button>'
      : '<small>Events cannot be added in this view.</small>');
  const button = empty.querySelector("button");
  if (button) button.onclick = function () {
    if (state.reset) {
      setRsvpFilter("all");
      setHideNo(false);
      const prefs = loadEventsViewPrefs();
      prefs.hideMaybe = false;
      saveEventsViewPrefs();
      renderView();
    } else {
      document.getElementById("tl-create-fab")?.click();
    }
  };
}

function timelineSetHeaderMonth(day) {
  const label = document.getElementById("timeline-month-label-text");
  if (label) label.textContent = periodMonthLabel(day);
}

function timelineBuildHeader(targetChannel, countText) {
  if (typeof isBoardAgendaView === "function" && isBoardAgendaView(targetChannel)) {
    timelineCalendarOpen = false;
    return "";
  }
  const mode = typeof rsvpFilterMode === "function" ? rsvpFilterMode() : "all";
  const filterText = timelineFilterLabel(mode);
  const label = filterText
    ? '<span class="tl-view-label">' + esc(filterText) + "</span>"
    : "";
  const count = countText
    ? '<span class="tl-view-hidden">' + esc(String(countText)) + "</span>"
    : "";
  return '<div class="board-head timeline-board-head tl-board-head">'
    + '<div class="board-head-main tl-month-nav">'
    + '<button type="button" class="btn-focus-today" id="focus-today" aria-label="Go to today" title="Go to today">'
    + ic("locate") + '</button>'
    + '<button type="button" class="tl-month-toggle" id="timeline-month-toggle" aria-expanded="'
    + (timelineCalendarOpen ? "true" : "false") + '"><span id="timeline-month-label-text">'
    + esc(periodMonthLabel(anchorDay())) + '</span>' + ic("chevronDown") + '</button></div>'
    + '<div class="board-head-actions">'
    + '<span class="tl-view-status">'
    + label
    + count
    + "</span>"
    + (typeof timelineSettingsWrapHTML === "function" ? timelineSettingsWrapHTML(targetChannel) : "")
    + '</div></div>';
}

function timelineBuildCalendar(events) {
  const cursor = timelineMonthCursor || timelineMonthStart(anchorDay());
  const d = new Date(cursor);
  const cells = timelineMonthCells(
    d.getFullYear(), d.getMonth(), Date.now(), anchorDay(), events
  );
  const atMinMonth = timelineMonthStart(cursor) <= timelineMonthStart(Date.now());
  let days = "";
  cells.forEach(function (cell) {
    let inner = '<button type="button" class="tl-month-day-hit" data-day="' + cell.day + '" '
      + (cell.past ? 'disabled aria-disabled="true"' : "")
      + '><span class="tl-month-number">' + cell.number + '</span>';
    if (cell.events.length) {
      inner += '<span class="tl-month-dot" aria-hidden="true"></span>';
    }
    inner += '</button>';
    days += '<div class="tl-month-day'
      + (cell.muted ? " muted" : "")
      + (cell.today ? " today" : "")
      + (cell.selected ? " selected" : "")
      + (cell.past ? " past" : "")
      + '" data-date-key="' + cell.key + '">' + inner + '</div>';
  });
  return '<section class="tl-calendar-shell'
    + (timelineCalendarOpen ? " open" : "")
    + '" id="timeline-calendar-shell" aria-label="Choose a date">'
    + '<div class="tl-calendar-head"><strong>'
    + esc(new Date(cursor).toLocaleDateString([], { month: "long", year: "numeric" }))
    + '</strong><span><button type="button" id="tl-month-prev" aria-label="Previous month"'
    + (atMinMonth ? " disabled aria-disabled=\"true\"" : "") + ">"
    + ic("chevronLeft") + '</button><button type="button" id="tl-month-next" aria-label="Next month">'
    + ic("chevronRight") + '</button></span></div>'
    + '<div class="tl-month-weekdays"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div>'
    + '<div class="tl-month-days">' + days + '</div></section>';
}

function timelineInviteAcceptBox(gridTop, metaTop, conflictBottom) {
  return {
    top: Math.round(metaTop - gridTop),
    size: Math.max(32, Math.round(conflictBottom - metaTop)),
  };
}

function timelineTextTop(el) {
  if (!el || typeof document === "undefined" || !document.createTreeWalker) {
    return el ? el.getBoundingClientRect().top : 0;
  }
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let top = Infinity;
  let node;
  while ((node = walker.nextNode())) {
    if (!String(node.textContent || "").trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    if (rect.height > 0) top = Math.min(top, rect.top);
  }
  if (Number.isFinite(top)) return top;
  return el.getBoundingClientRect().top;
}

function timelineSyncInviteAccept(grid) {
  if (!grid) return;
  const meta = grid.querySelector(".tl-invite-meta");
  const conflicts = grid.querySelector(".tl-check-conflicts");
  const accept = grid.querySelector(".tl-rsvp-yes");
  if (!meta || !conflicts || !accept) return;
  const gridRect = grid.getBoundingClientRect();
  const time = meta.querySelector("strong") || meta;
  const timeTop = timelineTextTop(time);
  const conflictBottom = conflicts.getBoundingClientRect().bottom;
  if (!(conflictBottom > timeTop)) return;
  const box = timelineInviteAcceptBox(gridRect.top, timeTop, conflictBottom);
  accept.style.top = box.top + "px";
  accept.style.width = box.size + "px";
  accept.style.height = box.size + "px";
}

const TL_FOCUS_GUTTER_PX = 228;

function timelineFocusGutterPx() {
  const mode = document.querySelector(".timeline-view-mode");
  if (mode) {
    const styles = getComputedStyle(mode);
    const n = parseFloat(styles.getPropertyValue("--tl-focus-gutter"));
    if (n > 0) return n;
    const rsvp = parseFloat(styles.getPropertyValue("--tl-rsvp-h"));
    const row = parseFloat(styles.getPropertyValue("--tl-row-h"));
    if (rsvp > 0 && row > 0) return rsvp + 2 * row;
  }
  return TL_FOCUS_GUTTER_PX;
}

function timelineHeadHeightPx() {
  const head = document.querySelector(".timeline-view-mode .tl-board-head");
  if (!head) return 0;
  const h = head.getBoundingClientRect().height;
  return h > 0 ? Math.ceil(h) : 0;
}

function timelineSyncSheetHeight() {
  const mode = document.querySelector(".timeline-view-mode");
  const host = document.getElementById("tl-sheet-host");
  if (!mode) return 0;
  const head = mode.querySelector(".tl-board-head");
  const hostRect = (host || mode).getBoundingClientRect();
  const headBottom = head ? head.getBoundingClientRect().bottom : hostRect.top;
  const slot = timelineFocusGutterPx();
  const sheetH = Math.max(280, Math.round(hostRect.bottom - headBottom - slot));
  mode.style.setProperty("--tl-head-h", Math.max(0, Math.round(headBottom - hostRect.top)) + "px");
  mode.style.setProperty("--tl-focus-gutter", slot + "px");
  mode.style.setProperty("--tl-sheet-h", sheetH + "px");
  const sheet = host && host.querySelector(".tl-event-sheet");
  const ime = !!(sheet && timelineImeVisible() && !document.querySelector(".tl-desc-editor"));
  // Derive the covered area from the host and visible viewport, never from
  // the sheet's current bounds. That prevents repeated resize/IME passes from
  // accumulating a gap beneath an expanded sheet.
  const visibleBottom = ime ? timelineVisibleBottomPx() : hostRect.bottom;
  const inset = Math.max(0, Math.round(hostRect.bottom - visibleBottom));
  if (sheet && timelineSheetExpanded) {
    // Keep the expanded event context full-height. The chat composer reserves
    // the IME inset inside this layout, which guarantees the field itself is
    // visible even on WebViews whose overlay viewport does not resize.
    const expandedH = Math.max(240, Math.round(hostRect.height));
    sheet.style.setProperty("top", "auto", "important");
    sheet.style.setProperty("bottom", "0px", "important");
    sheet.style.setProperty("height", expandedH + "px", "important");
  } else if (sheet) {
    sheet.style.setProperty("top", "auto", "important");
    sheet.style.setProperty("bottom", inset + "px", "important");
    sheet.style.setProperty("height", Math.max(240, sheetH - inset) + "px", "important");
  }
  return sheetH;
}

function timelineSheetHeightPx(sheet) {
  if (sheet) {
    const h = sheet.getBoundingClientRect().height;
    if (h > 8) return h;
  }
  const mode = document.querySelector(".timeline-view-mode");
  const viewH = mode ? mode.getBoundingClientRect().height : (window.innerHeight || 800);
  return Math.max(280, Math.round(viewH - timelineHeadHeightPx() - timelineFocusGutterPx()));
}

function timelineFocusTitleHTML(ev) {
  const title = timelineEventTitle(ev);
  const source = timelineEventSource(ev);
  return esc(title) + (source ? ' <small>' + esc(source) + '</small>' : "");
}

function timelineFocusMetaHTML(ev) {
  const organiser = typeof eventOrganiserName === "function" ? eventOrganiserName(ev) : "";
  const time = timelineTimeLabel(ev, true);
  const place = timelineEventPlace(ev);
  const going = timelineGoingIds(ev).length;
  const bits = [];
  if (organiser) bits.push('<span>' + ic("user", "ico-inline") + esc(organiser) + '</span>');
  if (time) bits.push('<span>' + ic("clock", "ico-inline") + esc(time) + '</span>');
  if (place) {
    const mapHref = typeof eventMapUrl === "function" ? eventMapUrl(ev) : "";
    bits.push('<span>' + ic("pin", "ico-inline") + esc(place)
      + (mapHref
        ? ' <a class="tl-sheet-map" href="' + esc(mapHref) + '" target="_blank" rel="noopener">Map</a>'
        : "")
      + '</span>');
  }
  if (going) bits.push('<span>' + ic("users", "ico-inline") + going + " going</span>");
  return bits.join("");
}

function timelineCardPreviewHTML(ev) {
  const face = typeof eventCardHTML === "function"
    ? eventCardHTML(ev, ev.when, {
        size: "full",
        omitPendingBanner: true,
        preserveEmptySlots: false,
      })
    : "";
  return '<div class="tl-card-preview" aria-hidden="true"><div class="tl-card-preview-scale">' + face + '</div></div>';
}

function timelineFocusDateHTML(ev) {
  const day = timelineDay(ev && ev.when);
  const heading = timelineDateHeading(day);
  const context = timelineContextLabel(day);
  return '<div class="tl-focus-date" aria-hidden="true">'
    + '<span class="tl-date-label">' + esc(heading) + '</span><i></i>'
    + '<span class="tl-date-context">' + esc(context) + '</span></div>';
}

function timelineEventRow(ev) {
  const state = timelinePresentationState(ev);
  const title = timelineEventTitle(ev);
  const place = timelineEventPlace(ev);
  const mapHref = typeof eventMapUrl === "function" ? eventMapUrl(ev) : "";
  const source = timelineEventSource(ev);
  const organiser = typeof eventOrganiserName === "function" ? eventOrganiserName(ev) : "";
  const iconName = typeof eventIcon === "function" ? eventIcon(ev) : "calendar";
  const chat = timelineChatMeta(ev);
  const going = timelineGoingIds(ev);
  const declined = state.kind === "declined";
  const unread = !declined && (chat.unread > 0
    || (typeof isEventRowUnread === "function" && isEventRowUnread(ev)));
  const article = document.createElement("article");
  article.className = "tl-event-row tl-event-" + state.kind
    + (unread ? " is-unread" : "")
    + (ev._pending ? " pending-sync" : "")
    + (ev.approvalStatus === "pending" ? " needs-approval" : "")
    + (ev.approvalStatus === "blocked" ? " is-blocked" : "");
  article.dataset.id = ev.id;
  article.dataset.when = String(ev.when);
  article.dataset.day = String(timelineDay(ev.when));
  article.tabIndex = 0;
  article.setAttribute("role", "button");
  const replyLabel = state.organiser ? "Organiser"
    : state.rsvp === "going" ? (typeof eventRsvpStatusLabel === "function" ? eventRsvpStatusLabel("going", ev) : "Going")
    : state.rsvp === "signedUp" ? "Signed up"
    : declined ? (typeof eventConfirmAttendance === "function" && eventConfirmAttendance(ev) ? "Declined" : "Can’t go")
    : state.kind === "unanswered" ? "Invited" : "Read-only";
  article.setAttribute("aria-label", title + ", " + timelineDateHeading(timelineDay(ev.when))
    + " at " + timelineTimeLabel(ev, true) + ", " + replyLabel
    + (chat.unread > 0 ? ", " + chat.unread + " unread messages" : ""));

  const dateChip = timelineFocusDateHTML(ev);
  if (state.kind === "unanswered") {
    article.innerHTML = dateChip
      + '<div class="tl-invite-wash" aria-hidden="true"></div>'
      + '<div class="tl-invite-grid"><div class="tl-invite-icon" aria-hidden="true">' + ic(iconName) + '</div>'
      + '<div class="tl-invite-copy"><h5>' + esc(title) + '</h5>'
      + '<p class="tl-invite-by">' + (organiser ? "by " + esc(organiser) : "Invitation")
      + (source ? ' <span>· ' + esc(source) + '</span>' : "") + '</p>'
      + '<div class="tl-invite-meta"><strong>' + ic("clock", "ico-inline")
      + esc(timelineTimeLabel(ev, true)) + '</strong>'
      + (place ? '<span>' + ic("pin", "ico-inline") + esc(place)
        + (mapHref
          ? ' <a class="tl-sheet-map" href="' + esc(mapHref) + '" target="_blank" rel="noopener" data-event-map>Map</a>'
          : "")
        + '</span>' : "") + '</div>'
      + '<button type="button" class="tl-check-conflicts">Check conflicts</button></div>'
      + '<button type="button" class="tl-rsvp-no" data-tl-rsvp="out" aria-label="'
      + esc(typeof eventRsvpNoActionLabel === "function" ? eventRsvpNoActionLabel(ev) : "Can't") + '">' + ic("cancel") + '</button>'
      + '<button type="button" class="tl-rsvp-yes" data-tl-rsvp="'
      + esc(typeof eventPositiveRsvpStatus === "function" ? eventPositiveRsvpStatus(ev) : "going")
      + '" aria-label="'
      + esc(typeof eventRsvpYesActionLabel === "function" ? eventRsvpYesActionLabel(ev) : "Going") + '">' + ic("check") + '</button></div>';
  } else {
    const statusIcon = state.kind === "declined"
      ? '<span class="tl-compact-declined">' + ic("minus") + '</span>'
      : '<span class="tl-compact-icon">' + ic(iconName) + '</span>';
    let accessory = "";
    const soloHosted = state.organiser && !timelineEventHasOtherViewers(ev);
    if (declined || soloHosted) {
      accessory = "";
    } else if (state.organiser && going.length > 1) {
      accessory = '<button type="button" class="tl-row-accessory" data-tl-open="chat" aria-label="Open chat">'
        + '<b>' + going.length + '</b>'
        + '<span class="tl-row-hosting-icon">' + ic("users")
        + (unread ? ic("message-circle", "tl-unread-bubble") : "")
        + '</span></button>';
    } else if (chat.count > 0) {
      accessory = '<button type="button" class="tl-row-accessory" data-tl-open="chat" aria-label="Open chat">'
        + '<span class="tl-row-chat-icon">' + ic("message")
        + (unread ? '<i class="tl-unread-dot"></i>' : "")
        + '</span></button>';
    }
    article.innerHTML = dateChip
      + '<span class="tl-compact-time">' + esc(timelineTimeLabel(ev, false)) + '</span>'
      + '<span class="tl-compact-card">' + statusIcon + '</span>'
      + '<span class="tl-compact-title">' + esc(title) + (source ? ' <small>' + esc(source) + '</small>' : "") + '</span>'
      + accessory;
  }
  const chains = timelineEventsById.size
    ? Array.from(timelineEventsById.values()).filter(function (candidate) {
        return candidate.chainOf === ev.id;
      }).sort(function (a, b) { return a.when - b.when; })
    : [];
  if (chains.length) {
    const chain = document.createElement("div");
    chain.className = "tl-chain";
    chain.innerHTML = chains.map(function (item) {
      return '<span>' + ic("circle-arrow-right", "ico-inline") + esc(timelineEventTitle(item)) + '</span>';
    }).join("");
    article.appendChild(chain);
  }
  return article;
}

function timelineFeedRow(el) {
  if (!el || !el.classList) return null;
  if (el.classList.contains("tl-event-row")) return el;
  if (el.classList.contains("tl-occupancy-stack")) return el;
  return null;
}

function timelineFeedSectionHead(section) {
  if (!section || !section.children) return null;
  for (let i = 0; i < section.children.length; i++) {
    const child = section.children[i];
    if (child.classList && child.classList.contains("tl-date-separator")) return child;
  }
  return null;
}

function timelineFeedSectionRows(section) {
  if (!section || !section.children) return [];
  const rows = [];
  for (let i = 0; i < section.children.length; i++) {
    const child = section.children[i];
    if (timelineFeedRow(child)) rows.push(child);
  }
  return rows;
}

function timelineSameMarkup(a, b) {
  return !!(a && b && a.outerHTML === b.outerHTML);
}

function timelineReconcileSection(current, incoming) {
  if (!current || !incoming) return true;
  current.className = incoming.className;
  const incomingHead = timelineFeedSectionHead(incoming);
  const currentHead = timelineFeedSectionHead(current);
  if (currentHead && incomingHead && !timelineSameMarkup(currentHead, incomingHead)) {
    currentHead.replaceWith(incomingHead);
  } else if (!currentHead && incomingHead) {
    current.insertBefore(incomingHead, current.firstChild);
  }
  const keepHead = timelineFeedSectionHead(current);
  const existingRows = new Map();
  timelineFeedSectionRows(current).forEach(function (el) {
    if (el.dataset && el.dataset.id) existingRows.set(el.dataset.id, el);
  });
  const frag = document.createDocumentFragment();
  if (keepHead) frag.appendChild(keepHead);
  let replaced = false;
  timelineFeedSectionRows(incoming).forEach(function (incomingRow) {
    const id = incomingRow.dataset && incomingRow.dataset.id;
    const currentRow = id ? existingRows.get(id) : null;
    if (currentRow && timelineSameMarkup(currentRow, incomingRow)) {
      frag.appendChild(currentRow);
    } else {
      frag.appendChild(incomingRow);
      replaced = true;
    }
  });
  current.replaceChildren(frag);
  return replaced;
}

function timelineReconcileFeed(feed, nextFeed) {
  if (!feed || !nextFeed) return true;
  const existing = new Map();
  [...feed.children].forEach(function (el) {
    const key = el.dataset && el.dataset.day;
    if (key) existing.set(key, el);
  });
  const frag = document.createDocumentFragment();
  let replaced = false;
  [...nextFeed.children].forEach(function (incoming) {
    const key = incoming.dataset && incoming.dataset.day;
    const current = key ? existing.get(key) : null;
    if (current && timelineSameMarkup(current, incoming)) {
      frag.appendChild(current);
    } else if (current) {
      if (timelineReconcileSection(current, incoming)) replaced = true;
      frag.appendChild(current);
    } else {
      frag.appendChild(incoming);
      replaced = true;
    }
  });
  feed.replaceChildren(frag);
  return replaced;
}

function timelineWireFeed(feed) {
  if (!feed) return;
  const bind = typeof onceFlag === "function"
    ? onceFlag(feed, "tlFeed")
    : !feed.dataset.tlFeed;
  if (!bind) return;
  if (typeof onceFlag !== "function") feed.dataset.tlFeed = "1";

  feed.addEventListener("click", function (event) {
    if (event.target.closest("a[data-event-map], a.tl-sheet-map")) return;
    const rsvp = event.target.closest("[data-tl-rsvp]");
    if (rsvp && feed.contains(rsvp)) {
      event.preventDefault();
      event.stopPropagation();
      const row = rsvp.closest(".tl-event-row");
      const eventId = row && row.dataset.id;
      if (!eventId || typeof setEventRsvp !== "function") return;
      row.classList.add("is-resolving");
      if (setEventRsvp(eventId, rsvp.dataset.tlRsvp)) {
        setTimeout(function () {
          if (typeof renderView === "function") renderView();
        }, 260);
      }
      return;
    }
    const conflicts = event.target.closest(".tl-check-conflicts");
    if (conflicts && feed.contains(conflicts)) {
      event.preventDefault();
      event.stopPropagation();
      const row = conflicts.closest(".tl-event-row");
      const ev = row && timelineFindEvent(row.dataset.id);
      if (ev && typeof openCalendarConflictCheck === "function") openCalendarConflictCheck(ev);
      return;
    }
    const infoBtn = event.target.closest("[data-tl-occ-info]");
    if (infoBtn && feed.contains(infoBtn)) {
      event.preventDefault();
      event.stopPropagation();
      const row = infoBtn.closest(".tl-event-row");
      const ev = row && timelineFindEvent(row.dataset.id);
      if (ev) {
        timelineSetFocus(row.dataset.id, { anchor: true });
        timelineOpenOccupancyInfo(ev);
      }
      return;
    }
    const goBtn = event.target.closest("[data-tl-go-event]");
    if (goBtn && feed.contains(goBtn)) {
      event.preventDefault();
      event.stopPropagation();
      const row = goBtn.closest(".tl-event-row");
      const ev = row && timelineFindEvent(row.dataset.id);
      if (ev) timelineOccupancyGoToEvent(ev);
      return;
    }
    const openBtn = event.target.closest("[data-tl-open]");
    if (openBtn && feed.contains(openBtn)) {
      event.preventDefault();
      event.stopPropagation();
      const row = openBtn.closest(".tl-event-row");
      if (row && !timelineOpenAgendaEvent(row.dataset.id)) {
        openTimelineSheet(row.dataset.id, openBtn.dataset.tlOpen || "chat");
      }
      return;
    }
    const row = event.target.closest(".tl-event-row");
    if (row && feed.contains(row)) {
      if (timelineOccupancyActive()) {
        timelineSetFocus(row.dataset.id, { anchor: true });
        const ev = timelineFindEvent(row.dataset.id);
        if (ev) timelineOpenOccupancyInfo(ev);
        return;
      }
      if (!timelineOpenAgendaEvent(row.dataset.id)) {
        openTimelineSheet(row.dataset.id, "chat", { focusComposer: false });
      }
      return;
    }
    if (timelineIsListLayout()) timelineSetFocus(null, { instant: true });
  });

  feed.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest(".tl-event-row");
    if (!row || !feed.contains(row) || event.target !== row) return;
    event.preventDefault();
    if (timelineOccupancyActive()) {
      timelineSetFocus(row.dataset.id, { anchor: true });
      const ev = timelineFindEvent(row.dataset.id);
      if (ev) timelineOpenOccupancyInfo(ev);
      return;
    }
    if (!timelineOpenAgendaEvent(row.dataset.id)) {
      openTimelineSheet(row.dataset.id, "chat", { focusComposer: false });
    }
  });

  let longTimer = 0;
  let sx = 0;
  let sy = 0;
  const clearLong = function () {
    if (longTimer) clearTimeout(longTimer);
    longTimer = 0;
  };
  feed.addEventListener("pointerdown", function (event) {
    const row = event.target.closest(".tl-event-row");
    if (!row || !feed.contains(row) || event.target.closest("button")) return;
    if (timelineOccupancyActive()) return;
    sx = event.clientX;
    sy = event.clientY;
    clearLong();
    longTimer = setTimeout(function () {
      longTimer = 0;
      const ev = timelineFindEvent(row.dataset.id);
      if (ev) timelineOpenQuickMenu(ev, row);
    }, 520);
  });
  feed.addEventListener("pointermove", function (event) {
    if (longTimer && Math.hypot(event.clientX - sx, event.clientY - sy) > 12) clearLong();
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach(function (name) {
    feed.addEventListener(name, clearLong);
  });
}

function timelineBuildFeed(events) {
  const feed = document.createElement("div");
  feed.id = "ticket-list";
  feed.className = "tl-feed";
  const agenda = timelineAgendaActive();
  const list = timelineIsListLayout() && !agenda;
  const groups = new Map();
  const today = timelineDay(Date.now());
  if (!list) {
    timelineScaffoldDays(today).forEach(function (day) {
      groups.set(day, []);
    });
  }
  events.forEach(function (ev) {
    if (timelineOccupancyActive() || agenda) {
      timelineOccupancyCoverDays(ev).forEach(function (day) {
        if (!groups.has(day)) groups.set(day, []);
        groups.get(day).push(ev);
      });
      return;
    }
    const day = timelineDay(ev.when);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(ev);
  });
  const selected = timelineDay(anchorDay());
  if (!list && selected >= today && !groups.has(selected)) groups.set(selected, []);
  const occupancy = timelineOccupancyActive();
  const sortedDays = Array.from(groups.keys()).sort(function (a, b) { return a - b; });
  if (occupancy || agenda) {
    timelineBuildOccupancySections(feed, sortedDays, groups, selected, today, { agenda: agenda });
    return feed;
  }
  Array.from(groups.keys()).sort(function (a, b) { return a - b; }).forEach(function (day) {
    const rows = groups.get(day) || [];
    if (list && !rows.length) return;
    const section = document.createElement("section");
    section.className = "tl-day-group";
    section.dataset.day = String(day);
    section.id = "tl-day-" + day;
    if (timelineCalendarOpen && day === selected) section.classList.add("calendar-glance");
    const head = document.createElement("div");
    head.className = "tl-date-separator";
    const heading = timelineDateHeading(day);
    const context = timelineContextLabel(day);
    head.dataset.context = context;
    head.setAttribute("aria-label", heading + ", " + context);
    head.innerHTML = '<span class="tl-date-label">' + esc(heading) + '</span><i></i>'
      + '<span class="tl-date-context">' + esc(context) + '</span>';
    section.appendChild(head);
    if (!rows.length) {
      section.classList.add("is-empty");
      if (timelineOccupancyActive()) section.appendChild(timelineOccupancyDayStack(day, []));
    } else if (timelineOccupancyActive()) {
      section.appendChild(timelineOccupancyDayStack(day, rows));
    } else {
      rows.forEach(function (ev) { section.appendChild(timelineEventRow(ev)); });
    }
    feed.appendChild(section);
  });
  return feed;
}

/* Occupancy feed: one section per day with bookings; consecutive empty days
 * collapse into a single "free" range. Each collapsed day keeps an id anchor
 * (tl-day-<day>) so calendar jumps and "Go to today" still land. */
function timelineBuildOccupancySections(feed, sortedDays, groups, selected, today, opts) {
  const agenda = !!(opts && opts.agenda);
  let i = 0;
  let lastDay = null;
  while (i < sortedDays.length) {
    const day = sortedDays[i];
    const rows = groups.get(day) || [];
    const section = document.createElement("section");
    section.className = "tl-day-group";
    section.dataset.day = String(day);
    section.id = "tl-day-" + day;
    if (timelineCalendarOpen && day === selected) section.classList.add("calendar-glance");
    const head = document.createElement("div");
    head.className = "tl-date-separator";
    head.setAttribute("role", "heading");
    head.setAttribute("aria-level", "3");
    const context = timelineContextLabel(day);
    head.dataset.context = context;

    if (rows.length || day === today) {
      const heading = timelineDateHeading(day);
      head.setAttribute("aria-label", heading + ", " + context);
      head.innerHTML = '<span class="tl-date-label">' + esc(heading) + '</span><i></i>'
        + '<span class="tl-date-context">' + esc(context) + '</span>';
      section.appendChild(head);
      if (!rows.length) section.classList.add("is-empty");
      section.appendChild(timelineOccupancyDayStack(day, rows, { agenda: agenda }));
      feed.appendChild(section);
      lastDay = day;
      i += 1;
      continue;
    }

    // Run of empty days (today is never folded in, so "now" stays visible).
    let j = i;
    while (j + 1 < sortedDays.length
      && !(groups.get(sortedDays[j + 1]) || []).length
      && sortedDays[j + 1] !== today) {
      const next = new Date(sortedDays[j]);
      next.setDate(next.getDate() + 1);
      if (next.getTime() !== sortedDays[j + 1]) break;
      j += 1;
    }
    const first = day;
    const last = sortedDays[j];
    const count = timelineOccupancyRangeCount(first, last);
    const heading = timelineOccupancyRangeHeading(first, last);
    const freeText = count > 1 ? count + " days free" : "Free all day";
    section.classList.add("is-empty", "tl-occ-free-range");
    if (count > 1) section.dataset.lastDay = String(last);
    head.setAttribute("aria-label", heading + ", " + freeText);
    head.innerHTML = '<span class="tl-date-label">' + esc(heading) + '</span><i></i>'
      + '<span class="tl-date-context">' + esc(context) + '</span>';
    section.appendChild(head);
    const cur = new Date(first);
    cur.setDate(cur.getDate() + 1);
    while (cur.getTime() <= last) {
      const anchor = document.createElement("span");
      anchor.className = "tl-day-anchor";
      anchor.id = "tl-day-" + cur.getTime();
      anchor.dataset.anchorDay = String(cur.getTime());
      anchor.setAttribute("aria-hidden", "true");
      section.appendChild(anchor);
      cur.setDate(cur.getDate() + 1);
    }
    const free = document.createElement("div");
    free.className = "tl-occupancy-stack tl-occ-agenda";
    free.dataset.id = "occ-" + first;
    free.dataset.day = String(first);
    free.appendChild(timelineOccupancyGapRow(freeText));
    section.appendChild(free);
    feed.appendChild(section);
    lastDay = last;
    i = j + 1;
  }
  if (lastDay != null) {
    const end = document.createElement("p");
    end.className = "tl-occ-end";
    end.dataset.day = "end";
    end.textContent = lastDay === today
      ? "Nothing else " + (agenda ? "planned" : "booked") + " after today"
      : "Nothing " + (agenda ? "planned" : "booked") + " after " + new Date(lastDay).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
    feed.appendChild(end);
  }
}

function timelineFocusSummary(ev) {
  const owner = timelineEventOwner(ev);
  const organiser = typeof eventOrganiserName === "function" ? eventOrganiserName(ev) : "";
  const chat = timelineChatMeta(ev);
  return {
    title: timelineEventTitle(ev),
    icon: typeof eventIcon === "function" ? eventIcon(ev) : "calendar",
    organiser: organiser,
    time: timelineTimeLabel(ev, true),
    place: timelineEventPlace(ev),
    going: timelineGoingIds(ev).length,
    chat: chat.count,
    unread: chat.unread > 0,
    owner: owner,
  };
}

function timelinePrefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function timelineFocusSwapDir(fromId, toId) {
  if (!fromId || !toId || typeof document === "undefined") return "down";
  const esc = typeof CSS !== "undefined" && CSS.escape ? CSS.escape : String;
  const from = document.querySelector('.tl-event-row[data-id="' + esc(fromId) + '"]');
  const to = document.querySelector('.tl-event-row[data-id="' + esc(toId) + '"]');
  if (!from || !to) return "down";
  return (from.compareDocumentPosition(to) & Node.DOCUMENT_POSITION_FOLLOWING)
    ? "down"
    : "up";
}

function timelineCancelFocusTabSwap() {
  timelineFocusTabSwapGen += 1;
  if (timelineFocusTabSwapTimer) {
    clearTimeout(timelineFocusTabSwapTimer);
    timelineFocusTabSwapTimer = 0;
  }
}

function timelineResetFocusTabSwap(tab) {
  timelineCancelFocusTabSwap();
  if (tab) {
    tab.classList.remove("is-swap-out", "is-swap-in", "is-swap-up", "is-swap-down");
  }
}

function timelineFillFocusTab(tab, ev) {
  if (!tab || !ev) return;
  const data = timelineFocusSummary(ev);
  const preview = tab.querySelector(".tl-focus-preview");
  if (preview) preview.innerHTML = timelineCardPreviewHTML(ev);
  const title = tab.querySelector(".tl-focus-title");
  if (title) title.innerHTML = timelineFocusTitleHTML(ev);
  const meta = tab.querySelector(".tl-focus-meta");
  if (meta) meta.innerHTML = timelineFocusMetaHTML(ev);
  const chat = tab.querySelector(".tl-focus-chat");
  if (chat) {
    const declined = timelinePresentationState(ev).kind === "declined";
    chat.hidden = declined;
    chat.classList.toggle("is-unread", !declined && data.unread);
    const badge = chat.querySelector("b");
    if (badge) badge.textContent = declined || !data.chat ? "" : (data.chat > 99 ? "…" : data.chat);
    chat.setAttribute("aria-label", "Open chat" + (!declined && data.unread ? ", unread messages" : ""));
  }
  timelineFocusTabEventId = ev.id;
}

function timelineSwapFocusTabContent(tab, ev) {
  const dir = timelineFocusSwapDir(timelineFocusTabEventId, ev.id);
  timelineCancelFocusTabSwap();
  const gen = timelineFocusTabSwapGen;
  tab.classList.remove("is-swap-in", "is-swap-up", "is-swap-down");
  tab.classList.add(dir === "up" ? "is-swap-up" : "is-swap-down", "is-swap-out");
  timelineFocusTabSwapTimer = setTimeout(function () {
    if (gen !== timelineFocusTabSwapGen) return;
    timelineFillFocusTab(tab, ev);
    tab.classList.add("is-swap-in");
    tab.classList.remove("is-swap-out");
    const finish = function () {
      if (gen !== timelineFocusTabSwapGen) return;
      tab.classList.remove("is-swap-in", "is-swap-up", "is-swap-down");
    };
    const preview = tab.querySelector(".tl-focus-preview");
    if (preview) {
      const onEnd = function (event) {
        if (event.target !== preview) return;
        preview.removeEventListener("animationend", onEnd);
        finish();
      };
      preview.addEventListener("animationend", onEnd);
    }
    timelineFocusTabSwapTimer = setTimeout(finish, 280);
  }, 160);
}

function timelinePaintFocusTab(ev, opts) {
  const tab = document.getElementById("tl-focus-tab");
  if (!tab) return;
  if (timelineOccupancyActive() || timelineAgendaActive()) {
    timelineResetFocusTabSwap(tab);
    timelineFocusTabEventId = null;
    tab.classList.add("is-empty");
    tab.classList.remove("is-revealed", "is-dragging");
    tab.style.transform = "";
    tab.setAttribute("aria-hidden", "true");
    document.querySelector(".timeline-view-mode")?.classList.remove("has-focus-tab");
    return;
  }
  if (!ev) {
    timelineResetFocusTabSwap(tab);
    timelineFocusTabEventId = null;
    tab.classList.add("is-empty");
    tab.classList.remove("is-revealed", "is-dragging");
    tab.style.transform = "";
    tab.setAttribute("aria-hidden", "true");
    return;
  }
  const already = tab.classList.contains("is-revealed");
  tab.classList.remove("is-empty");
  tab.removeAttribute("aria-hidden");
  const same = timelineFocusTabEventId === ev.id;
  if (already && timelineFocusTabEventId && !same && !timelinePrefersReducedMotion()) {
    timelineSwapFocusTabContent(tab, ev);
    tab.classList.add("is-revealed");
    return;
  }
  timelineResetFocusTabSwap(tab);
  timelineFillFocusTab(tab, ev);
  if (already || (opts && opts.instant)) {
    tab.classList.add("is-revealed");
    return;
  }
  tab.classList.remove("is-revealed");
  void tab.offsetWidth;
  tab.classList.add("is-revealed");
}

function timelineSetOpenSheetClass(open) {
  const mode = document.querySelector(".timeline-view-mode");
  if (!mode) return;
  mode.classList.toggle("has-open-sheet", !!open);
  if (!open) {
    mode.style.removeProperty("--tl-sheet-pad");
    const sheet = document.querySelector(".tl-event-sheet");
    if (sheet) {
      sheet.style.removeProperty("top");
      sheet.style.removeProperty("bottom");
      sheet.style.removeProperty("height");
    }
    return;
  }
  timelineSyncSheetHeight();
  requestAnimationFrame(timelineSyncSheetHeight);
}

function timelineScrollFocusedRow() {
  const scroller = document.querySelector(".timeline-view-mode .timeline-scroll");
  const row = timelineFocusedEventId
    ? document.querySelector('.tl-event-row[data-id="' + CSS.escape(timelineFocusedEventId) + '"]')
    : null;
  const sheet = document.querySelector("#tl-sheet-host.open .tl-event-sheet");
  const mode = document.querySelector(".timeline-view-mode");
  if (!scroller || !row) return;
  const slot = timelineFocusGutterPx();
  const scrollerRect = scroller.getBoundingClientRect();
  const head = scroller.querySelector(".tl-sticky-head, .timeline-board-head, .tl-board-head");
  const headBottom = head ? head.getBoundingClientRect().bottom : scrollerRect.top;
  const visibleTop = scrollerRect.top + Math.max(16, Math.ceil(headBottom - scrollerRect.top));
  timelineSyncSheetHeight();
  void scroller.offsetHeight;
  const rowRect = row.getBoundingClientRect();
  let targetTop;
  if (sheet) {
    if (mode) mode.style.setProperty("--tl-sheet-pad", Math.ceil(timelineSheetHeightPx(sheet) + slot) + "px");
    targetTop = visibleTop + (slot - rowRect.height) / 2;
  } else {
    targetTop = timelineFocusLineY(scroller) - rowRect.height / 2;
  }
  const nextTop = scroller.scrollTop + (rowRect.top - targetTop);
  let behavior = "smooth";
  try {
    if (timelinePrefersReducedMotion()) behavior = "auto";
  } catch {}
  if (typeof scroller.scrollTo === "function") {
    scroller.scrollTo({ top: nextTop, behavior: behavior });
  } else {
    scroller.scrollTop = nextTop;
  }
}

function timelineSetFocus(eventId, opts) {
  const ev = eventId ? timelineFindEvent(eventId) : null;
  timelineFocusedEventId = ev ? ev.id : null;
  document.querySelectorAll(".tl-event-row").forEach(function (row) {
    row.classList.toggle("focused-highlight", !!(ev && row.dataset.id === ev.id));
  });
  document.querySelector(".timeline-view-mode")?.classList.toggle("has-focus-tab", !!(ev && !timelineAgendaLike()));
  timelinePaintFocusTab(ev, opts);
  if (ev && opts && opts.anchor) {
    S.anchor = timelineDay(ev.when);
    timelineSetHeaderMonth(S.anchor);
  }
}

function timelineFocusDay() {
  const onFocus = document.querySelector(".timeline-view-mode .tl-day-group.is-on-focus");
  if (onFocus) {
    const day = Number(onFocus.dataset.day);
    if (Number.isFinite(day)) return timelineDay(day);
  }
  if (timelineFocusedEventId) {
    const ev = timelineFindEvent(timelineFocusedEventId);
    if (ev && ev.when != null) return timelineDay(ev.when);
  }
  if (typeof S !== "undefined" && S.anchor) return timelineDay(S.anchor);
  return timelineDay(Date.now());
}

function timelineFocusLineY(scroller) {
  const rect = scroller.getBoundingClientRect();
  return rect.top + rect.height * 0.35;
}

function timelineEventCoversFocusLine(rect, line, bottomSlop) {
  if (!rect || !Number.isFinite(line)) return false;
  const slop = Number(bottomSlop) > 0 ? Number(bottomSlop) : 0;
  return line >= rect.top && line <= rect.bottom + slop;
}

function timelineRectHitsFocusLine(rect, lineY) {
  if (!rect || !Number.isFinite(lineY)) return false;
  return rect.top < lineY + 2 && rect.bottom > lineY;
}

function timelineDateRuleHitsFocusLine(rect, lineY) {
  return timelineRectHitsFocusLine(rect, lineY);
}

function timelineEventIsFirstOnDay(row) {
  const prev = row && row.previousElementSibling;
  return !!(prev && prev.classList && prev.classList.contains("tl-date-separator"));
}

function timelineSameDayGapKeepsFocus(scroller, line, eventId) {
  if (!scroller || !eventId || !Number.isFinite(line)) return false;
  const row = typeof scroller.querySelector === "function"
    ? scroller.querySelector('.tl-event-row[data-id="' + CSS.escape(eventId) + '"]')
    : null;
  const group = row && typeof row.closest === "function" ? row.closest(".tl-day-group") : null;
  if (!group || !timelineRectHitsFocusLine(group.getBoundingClientRect(), line)) return false;
  const sep = typeof group.querySelector === "function"
    ? group.querySelector(".tl-date-separator")
    : null;
  if (sep && timelineDateRuleHitsFocusLine(sep.getBoundingClientRect(), line)) return false;
  if (timelineEventIsFirstOnDay(row)) {
    const rowRect = typeof row.getBoundingClientRect === "function"
      ? row.getBoundingClientRect()
      : null;
    if (rowRect && line < rowRect.top) return false;
  }
  return true;
}

function timelineSyncDateFocusRules(scroller, lineY) {
  if (!scroller) return;
  const line = Number.isFinite(lineY) ? lineY : timelineFocusLineY(scroller);
  scroller.querySelectorAll(".tl-day-group").forEach(function (group) {
    const dayHit = timelineRectHitsFocusLine(group.getBoundingClientRect(), line);
    group.classList.toggle("is-on-focus", dayHit);
    const sep = group.querySelector(".tl-date-separator");
    if (!sep) return;
    const ctx = sep.querySelector(".tl-date-context");
    if (ctx) ctx.setAttribute("aria-hidden", dayHit ? "false" : "true");
  });
}

function timelineRowIsScrollFocusable(row, focusedId) {
  if (!row || !row.classList) return false;
  if (row.classList.contains("tl-event-declined")
    && row.dataset.id !== focusedId) {
    return false;
  }
  return true;
}

function timelineFocusEventIdAtLine(entries, line, heldId) {
  let best = null;
  let bestDist = Infinity;
  (entries || []).forEach(function (entry) {
    if (!entry) return;
    const slop = heldId && entry.id === heldId ? 6 : 0;
    if (!timelineEventCoversFocusLine(entry, line, slop)) return;
    const dist = Math.abs((entry.top + entry.bottom) / 2 - line);
    if (dist < bestDist) {
      bestDist = dist;
      best = entry;
    }
  });
  return best ? best.id : null;
}

function timelinePlaceFocusLine(scroller) {
  const line = document.getElementById("tl-focus-line");
  if (!line || !scroller) return;
  const rect = scroller.getBoundingClientRect();
  line.style.top = (rect.top + rect.height * 0.35) + "px";
  line.style.left = rect.left + "px";
  line.style.width = rect.width + "px";
}

function timelineKickFocusSync() {
  if (timelineFocusScrollRaf) return;
  timelineFocusScrollRaf = requestAnimationFrame(function () {
    timelineFocusScrollRaf = 0;
    if (timelineSheetEventId && !timelineSheetExpanded) timelineSyncSheetHeight();
    if (timelineIsListLayout() || timelineIsCardLayout() || timelineOccupancyActive()) return;
    const scroller = document.querySelector(".timeline-view-mode .timeline-scroll");
    if (!scroller) return;
    timelinePlaceFocusLine(scroller);
    timelineSyncFocus(scroller);
  });
}

function timelineSyncFocus(scroller) {
  if (!scroller) scroller = document.querySelector(".timeline-view-mode .timeline-scroll");
  if (!scroller) return;
  if (timelineCalendarOpen || timelineSheetEventId) return;
  const line = timelineFocusLineY(scroller);
  timelineSyncDateFocusRules(scroller, line);
  if (timelineFocusHold) {
    const held = timelineFocusedEventId
      ? scroller.querySelector('.tl-event-row[data-id="' + CSS.escape(timelineFocusedEventId) + '"]')
      : null;
    if (held) {
      const mid = (held.getBoundingClientRect().top + held.getBoundingClientRect().bottom) / 2;
      if (Math.abs(mid - line) >= 28) return;
    }
    timelineFocusHold = false;
  }
  let hitId = null;
  const entries = [];
  scroller.querySelectorAll(".tl-event-row").forEach(function (row) {
    if (!timelineRowIsScrollFocusable(row, timelineFocusedEventId)) return;
    const rect = row.getBoundingClientRect();
    entries.push({ id: row.dataset.id, top: rect.top, bottom: rect.bottom });
  });
  hitId = timelineFocusEventIdAtLine(entries, line, timelineFocusedEventId);
  if (!hitId) {
    if (timelineFocusedEventId
      && timelineSameDayGapKeepsFocus(scroller, line, timelineFocusedEventId)) {
      return;
    }
    if (timelineFocusedEventId) timelineSetFocus(null, { instant: true });
    const onFocus = scroller.querySelector(".tl-day-group.is-on-focus");
    if (onFocus) {
      const day = Number(onFocus.dataset.day);
      if (Number.isFinite(day) && typeof S !== "undefined") {
        S.anchor = timelineDay(day);
      }
    }
    return;
  }
  if (hitId === timelineFocusedEventId) return;
  timelineSetFocus(hitId, { anchor: true, instant: true });
}

function timelineOnViewportChange() {
  timelineKickFocusSync();
  const view = document.querySelector(".timeline-view-mode.tl-occupancy-mode");
  if (view) timelineSyncOccupancyMinis(view);
}

function timelineWireFocusScroll(scroller) {
  if (scroller) {
    const bind = typeof onceFlag === "function"
      ? onceFlag(scroller, "tlFocusScroll")
      : !scroller.dataset.tlFocusScroll;
    if (bind) {
      if (typeof onceFlag !== "function") scroller.dataset.tlFocusScroll = "1";
      scroller.addEventListener("scroll", timelineKickFocusSync, { passive: true });
    }
  }
  if (!timelineFocusResizeWired && typeof window !== "undefined") {
    timelineFocusResizeWired = true;
    window.addEventListener("resize", timelineOnViewportChange);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", timelineOnViewportChange);
    }
  }
}

function timelineScrollDayIntoView(day, scroller) {
  const scroll = scroller || document.querySelector(".timeline-scroll");
  if (!scroll) return;
  let target = document.getElementById("tl-day-" + day);
  if (!target && timelineIsListLayout()) {
    const groups = scroll.querySelectorAll(".tl-day-group");
    for (let i = 0; i < groups.length; i++) {
      const nextDay = Number(groups[i].dataset.day);
      if (Number.isFinite(nextDay) && nextDay >= day) {
        target = groups[i];
        break;
      }
    }
  }
  if (!target) return;
  const head = document.querySelector(".tl-sticky-head") || document.querySelector(".tl-board-head");
  const pageHead = timelineAgendaActive() ? scroll.querySelector(".tl-events-wrap > .conv-page-head") : null;
  const topGap = (head ? head.getBoundingClientRect().height : 54)
    + (pageHead ? pageHead.getBoundingClientRect().height : 0)
    + (timelineAgendaLike() ? 8 : 0);
  scroll.scrollTop += target.getBoundingClientRect().top
    - scroll.getBoundingClientRect().top - topGap;
}

function timelineMarkCalendarDay(day) {
  document.querySelectorAll("#timeline-calendar-shell .tl-month-day").forEach(function (el) {
    const hit = el.querySelector("[data-day]");
    el.classList.toggle("selected", !!(hit && Number(hit.dataset.day) === day));
  });
  document.querySelectorAll(".tl-day-group").forEach(function (el) {
    el.classList.toggle("calendar-glance", Number(el.dataset.day) === day);
  });
}

function timelineJumpToDay(day, opts) {
  if (day < timelineDay(Date.now())) return;
  const keepOpen = !!(opts && opts.keepOpen);
  S.anchor = timelineDay(day);
  timelineMonthCursor = timelineMonthStart(day);
  if (!keepOpen) timelineCalendarOpen = false;
  timelineFocusedEventId = null;
  closeTimelineSheet();
  if (keepOpen && timelineCalendarOpen && document.getElementById("timeline-calendar-shell")) {
    timelineSetHeaderMonth(S.anchor);
    timelineMarkCalendarDay(S.anchor);
    if (timelineIsCardLayout() && typeof timelineCardDeckJumpToDay === "function") {
      timelineCardDeckJumpToDay(S.anchor);
    } else {
      timelineSetFocus(null, { instant: true });
      timelineScrollDayIntoView(S.anchor);
    }
    return;
  }
  timelineJumpPendingDay = S.anchor;
  renderView();
}

function timelineSyncCalendarOpenClass() {
  const mode = document.querySelector(".timeline-view-mode");
  if (mode) mode.classList.toggle("calendar-open", !!timelineCalendarOpen);
  const toggle = document.getElementById("timeline-month-toggle");
  if (toggle) toggle.setAttribute("aria-expanded", timelineCalendarOpen ? "true" : "false");
  if (!timelineCalendarOpen) {
    document.querySelectorAll(".tl-day-group.calendar-glance").forEach(function (el) {
      el.classList.remove("calendar-glance");
    });
    timelineKickFocusSync();
  }
}

function timelineReplaceCalendar(events) {
  const old = document.getElementById("timeline-calendar-shell");
  if (!old) return;
  const holder = document.createElement("div");
  holder.innerHTML = timelineBuildCalendar(events);
  old.replaceWith(holder.firstElementChild);
  timelineWireCalendarShell(events);
  timelineSyncCalendarOpenClass();
}

function timelineCloseCalendar() {
  if (!timelineCalendarOpen) return false;
  timelineCalendarOpen = false;
  const events = timelineEventsById.size
    ? Array.from(timelineEventsById.values())
    : (typeof group === "function" ? (group().events || []) : []);
  timelineReplaceCalendar(events);
  timelineSyncCalendarOpenClass();
  return true;
}

function timelineSheetIsExpanded() {
  return !!timelineSheetExpanded;
}

function timelineShiftCalendarMonth(delta, events) {
  const d = new Date(timelineMonthCursor || timelineMonthStart(anchorDay()));
  const next = new Date(d.getFullYear(), d.getMonth() + delta, 1).getTime();
  if (next < timelineMonthStart(Date.now())) return;
  timelineMonthCursor = next;
  timelineReplaceCalendar(events);
}

function timelineWireCalendarShell(events) {
  document.getElementById("tl-month-prev")?.addEventListener("click", function () {
    timelineShiftCalendarMonth(-1, events);
  });
  document.getElementById("tl-month-next")?.addEventListener("click", function () {
    timelineShiftCalendarMonth(1, events);
  });
  document.querySelectorAll("#timeline-calendar-shell .tl-month-day-hit").forEach(function (button) {
    button.addEventListener("click", function () {
      timelineJumpToDay(Number(button.dataset.day), { keepOpen: true });
    });
  });
  const shell = document.getElementById("timeline-calendar-shell");
  if (!shell) return;
  let sx = 0;
  let sy = 0;
  shell.addEventListener("pointerdown", function (event) {
    sx = event.clientX;
    sy = event.clientY;
  });
  shell.addEventListener("pointerup", function (event) {
    const dx = event.clientX - sx;
    const dy = event.clientY - sy;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      timelineShiftCalendarMonth(dx < 0 ? 1 : -1, events);
    }
  });
}

function timelineWireCalendar(scroller, events) {
  const toggle = document.getElementById("timeline-month-toggle");
  const bindToggle = !toggle ? false
    : (typeof onceFlag === "function" ? onceFlag(toggle, "tlCalToggle") : !toggle.dataset.tlCalToggle);
  if (toggle && bindToggle) {
    if (typeof onceFlag !== "function") toggle.dataset.tlCalToggle = "1";
    toggle.addEventListener("click", function () {
      timelineCalendarOpen = !timelineCalendarOpen;
      timelineReplaceCalendar(events);
    });
  }
  const bindCalDismiss = function (el) {
    if (!el) return;
    const bind = typeof onceFlag === "function"
      ? onceFlag(el, "tlCalDismiss")
      : !el.dataset.tlCalDismiss;
    if (!bind) return;
    if (typeof onceFlag !== "function") el.dataset.tlCalDismiss = "1";
    el.addEventListener("pointerdown", function (event) {
      if (!timelineCalendarOpen) return;
      event.preventDefault();
      event.stopPropagation();
      timelineCalendarOpen = false;
      timelineReplaceCalendar(events);
    }, true);
  };
  bindCalDismiss(document.querySelector(".tl-feed"));
  bindCalDismiss(document.querySelector(".tl-card-deck"));
  timelineWireCalendarShell(events);
  timelineSyncCalendarOpenClass();
}

function timelineFindEvent(eventId) {
  return timelineEventsById.get(eventId)
    || (typeof group === "function" ? (group().events || []).find(function (ev) { return ev.id === eventId; }) : null);
}

function timelineAttendanceHTML(ev) {
  const going = typeof eventRsvpIds === "function"
    ? eventRsvpIds(ev, "going")
    : Object.keys(ev.rsvps || {}).filter(function (id) { return ev.rsvps[id] === "going"; });
  const signedUp = typeof eventRsvpIds === "function"
    ? eventRsvpIds(ev, "signedUp")
    : Object.keys(ev.rsvps || {}).filter(function (id) { return ev.rsvps[id] === "signedUp"; });
  const out = typeof eventRsvpIds === "function"
    ? eventRsvpIds(ev, "out")
    : Object.keys(ev.rsvps || {}).filter(function (id) { return ev.rsvps[id] === "out"; });
  if (typeof eventRsvpPeopleHTML === "function") {
    return eventRsvpPeopleHTML(ev, { going: going, signedUp: signedUp, out: out });
  }
  const all = going.concat(signedUp, out);
  if (!all.length) return '<p class="tl-sheet-empty">No one has responded yet.</p>';
  return all.map(function (id) {
    const name = typeof eventRsvpPersonName === "function" ? eventRsvpPersonName(id, ev) : id;
    return '<div class="tl-attendee"><span>' + esc(name.charAt(0).toUpperCase()) + '</span>' + esc(name) + '</div>';
  }).join("");
}

function timelineSheetChannel(ev) {
  const owner = timelineEventOwner(ev);
  return ((owner && owner.channels) || []).find(function (candidate) {
    return candidate.id === ev.channelId;
  }) || ((owner && owner.channels) || []).find(function (candidate) {
    return candidate.kind === "event";
  }) || null;
}

function timelineSheetCanCompose(ev) {
  if (!ev) return false;
  const owner = timelineEventOwner(ev);
  if (!owner) return false;
  if (typeof eventHasPanelChat === "function" && !eventHasPanelChat(ev)) return false;
  if (typeof canMutateContent === "function" && !canMutateContent(owner)) return false;
  return !!timelineSheetChannel(ev);
}

function timelineMarkdownInline(text) {
  return String(text || "")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (_, label, href) {
      return '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + label + "</a>";
    });
}

function timelineMarkdownHTML(raw) {
  const src = String(typeof shown === "function" ? shown(raw || "") : (raw || "")).trim();
  if (!src) return "";
  const lines = esc(src).split(/\n/);
  const out = [];
  let list = "";
  const flushList = function () {
    if (!list) return;
    out.push("<ul>" + list + "</ul>");
    list = "";
  };
  lines.forEach(function (line) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (heading) {
      flushList();
      const n = heading[1].length;
      out.push("<h" + n + ">" + timelineMarkdownInline(heading[2]) + "</h" + n + ">");
      return;
    }
    if (bullet) {
      list += "<li>" + timelineMarkdownInline(bullet[1]) + "</li>";
      return;
    }
    flushList();
    if (!line) return;
    out.push("<p>" + timelineMarkdownInline(line) + "</p>");
  });
  flushList();
  return out.join("");
}

function timelineSheetPeekTransform(peekH, lift) {
  const shown = Math.max(0, Number(peekH) || 0) + Math.max(0, Number(lift) || 0);
  return "translate(-50%, calc(100% - " + shown + "px))";
}

function timelineOpenDescriptionEditor(ev) {
  const host = document.getElementById("tl-sheet-host")
    || document.getElementById("view");
  if (!host || !ev) return;
  host.querySelector(".tl-desc-editor")?.remove();
  const details = String(typeof eventDetailsNotes === "function"
    ? eventDetailsNotes(ev)
    : (typeof shown === "function" ? shown(ev._details || "") : (ev._details || ""))).trim();
  const wrap = document.createElement("div");
  wrap.className = "tl-desc-editor";
  wrap.innerHTML = '<div class="tl-desc-editor-card" role="dialog" aria-modal="true" aria-label="Edit description">'
    + '<header><h4>Description</h4>'
    + '<p>Markdown supported — **bold**, *italic*, lists, links.</p></header>'
    + '<textarea id="tl-desc-input" maxlength="8000" placeholder="Write a description…">'
    + esc(details) + '</textarea>'
    + '<div class="tl-desc-editor-actions">'
    + '<button type="button" class="tl-desc-cancel">Cancel</button>'
    + '<button type="button" class="tl-desc-save">Save</button></div></div>';
  host.appendChild(wrap);
  timelineSyncIme();
  const input = wrap.querySelector("#tl-desc-input");
  const close = function () {
    wrap.remove();
    timelineSyncIme();
  };
  wrap.addEventListener("click", function (event) {
    if (event.target === wrap) close();
  });
  wrap.querySelector(".tl-desc-cancel")?.addEventListener("click", close);
  wrap.querySelector(".tl-desc-save")?.addEventListener("click", function () {
    const notes = String(input && input.value || "").trim();
    const mapUrl = typeof eventMapUrl === "function" ? eventMapUrl(ev) : "";
    const next = typeof mergeEventMapDetails === "function"
      ? mergeEventMapDetails(notes, mapUrl)
      : notes;
    if (typeof applyEventDetails === "function") applyEventDetails(ev.id, next);
    ev._details = next;
    const panel = host.querySelector('.tl-sheet-panel[data-tl-panel="description"]');
    if (panel) {
      const canEdit = typeof canEditEvent === "function" ? canEditEvent(ev) : false;
      panel.innerHTML = (notes
        ? '<div class="tl-description">' + timelineMarkdownHTML(notes) + "</div>"
        : '<p class="tl-sheet-empty">No description yet.</p>')
        + (canEdit
          ? '<button type="button" class="tl-sheet-edit" data-tl-sheet-edit>'
            + ic("pencil", "ico-inline") + " Edit</button>"
          : "");
      panel.querySelector("[data-tl-sheet-edit]")?.addEventListener("click", function () {
        timelineOpenDescriptionEditor(ev);
      });
    }
    const convPanel = document.getElementById("conv-event-panel");
    if (convPanel && typeof conversationEventPanelHTML === "function") {
      const tmp = document.createElement("div");
      tmp.innerHTML = conversationEventPanelHTML(ev);
      const nextEl = tmp.firstElementChild;
      if (nextEl) convPanel.replaceWith(nextEl);
    }
    close();
  });
  requestAnimationFrame(function () {
    try { input.focus(); input.setSelectionRange(input.value.length, input.value.length); } catch {}
  });
}

function timelineSheetHTML(ev) {
  if (ev?.calendarImported) {
    return '<section class="tl-event-sheet" role="dialog" aria-modal="true" aria-label="Device calendar event">'
      + '<header><div class="tl-sheet-heading"><h4>' + esc(ev._title || ev.title) + '</h4><p>Device calendar · Read-only</p></div>'
      + '<button type="button" data-tl-sheet-close aria-label="Close">' + ic("x") + '</button></header>'
      + '<div class="tl-sheet-panel on" style="padding:20px;overflow:auto"><p>' + esc(ev.whenPrecision === "day" ? new Date(ev.when).toLocaleDateString() + " · All day" : new Date(ev.when).toLocaleString()) + '</p>'
      + '<p>' + esc(ev._where || ev.where || "") + '</p><p>Edit this event in your calendar app, then Re-import from the Device calendar channel.</p></div></section>';
  }
  const summary = timelineFocusSummary(ev);
  const chat = timelineChatMeta(ev);
  const messages = chat.messages.length
    ? chat.messages.map(function (message) {
        return typeof eventDetailChatMsgHTML === "function"
          ? eventDetailChatMsgHTML(message, ev)
          : '<p>' + esc(shown(message._text || message.text || "")) + '</p>';
      }).join("")
    : '<p class="tl-sheet-empty">No messages yet.</p>';
  const details = String(typeof eventDetailsNotes === "function"
    ? eventDetailsNotes(ev)
    : (typeof shown === "function" ? shown(ev._details || "") : (ev._details || ""))).trim();
  const canCompose = timelineSheetCanCompose(ev);
  const canEdit = typeof canEditEvent === "function" ? canEditEvent(ev) : false;
  const composer = canCompose
    ? '<div class="tl-sheet-compose-wrap">'
      + '<div class="tag-suggest" id="tl-task-suggest" hidden></div>'
      + '<form class="tl-sheet-compose" id="tl-sheet-compose">'
      + '<input id="tl-sheet-input" type="text" maxlength="2000" autocomplete="off" '
      + 'placeholder="Message about ' + esc(summary.title) + '…" aria-label="Message about ' + esc(summary.title) + '">'
      + '<button type="submit" hidden aria-label="Send">' + ic("arrow-right") + '</button></form></div>'
    : '<p class="tl-sheet-compose-locked">View-only — you can read but not post</p>';
  const description = (details
      ? '<div class="tl-description">' + timelineMarkdownHTML(details) + "</div>"
      : '<p class="tl-sheet-empty">No description yet.</p>')
    + (canEdit
      ? '<button type="button" class="tl-sheet-edit" data-tl-sheet-edit>'
        + ic("pencil", "ico-inline") + " Edit</button>"
      : "");
  return '<button type="button" class="tl-sheet-scrim" data-tl-sheet-close aria-label="Close"></button>'
    + '<section class="tl-event-sheet" role="dialog" aria-modal="true" aria-label="' + esc(summary.title) + '">'
    + '<button type="button" class="tl-sheet-handle" aria-label="'
    + (timelineSheetExpanded ? "Collapse" : "Expand") + '" aria-expanded="'
    + (timelineSheetExpanded ? "true" : "false") + '"></button>'
    + '<header>' + timelineCardPreviewHTML(ev)
    + '<div class="tl-sheet-heading"><h4>' + timelineFocusTitleHTML(ev) + '</h4>'
    + '<p class="tl-sheet-meta">' + timelineFocusMetaHTML(ev) + '</p>'
    + (typeof eventEditabilityLabel === "function"
      ? '<p class="tl-sheet-origin">' + esc(eventEditabilityLabel(ev)) + '</p>'
      : "")
    + '</div>'
    + '<button type="button" id="tl-sheet-more" aria-label="More options">' + ic("more") + '</button>'
    + '<button type="button" data-tl-sheet-close aria-label="Close">' + ic("x") + '</button></header>'
    + '<nav class="tl-sheet-tabs" role="tablist" aria-label="Event details">'
    + timelineSheetTabButtonHTML("chat", "Chat" + (chat.count ? " " + chat.count : ""))
    + timelineSheetTabButtonHTML("attendance", "Sign-ups")
    + timelineSheetTabButtonHTML("description", "Description")
    + '</nav>'
    + timelineSheetPanelHTML("chat", '<div class="tl-sheet-messages" id="tl-sheet-messages">' + messages + '</div>' + composer)
    + timelineSheetPanelHTML("attendance", timelineAttendanceHTML(ev))
    + timelineSheetPanelHTML("description", description)
    + '</section>';
}

function timelineSheetTabButtonHTML(id, label) {
  const on = timelineSheetTab === id;
  return '<button type="button" role="tab" id="tl-sheet-tab-' + id + '"'
    + ' data-tl-sheet-tab="' + id + '"'
    + ' aria-controls="tl-sheet-panel-' + id + '"'
    + ' aria-selected="' + (on ? "true" : "false") + '"'
    + ' tabindex="' + (on ? "0" : "-1") + '"'
    + (on ? ' class="on"' : "") + '>' + label + '</button>';
}

function timelineSheetPanelHTML(id, inner) {
  const on = timelineSheetTab === id;
  return '<div class="tl-sheet-panel' + (on ? " on" : "") + '"'
    + ' role="tabpanel" id="tl-sheet-panel-' + id + '"'
    + ' data-tl-panel="' + id + '"'
    + ' aria-labelledby="tl-sheet-tab-' + id + '"'
    + (on ? "" : " hidden") + '>' + inner + '</div>';
}

function timelineWireSheetTabs(root, opts) {
  const tabs = [...(root?.querySelectorAll("[data-tl-sheet-tab]") || [])];
  tabs.forEach(function (button, i) {
    button.addEventListener("click", function () {
      timelineSheetTab = button.dataset.tlSheetTab;
      timelineRenderSheet();
    });
    button.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
      e.preventDefault();
      let next = 0;
      if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
      else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === "End") next = tabs.length - 1;
      const id = tabs[next]?.dataset.tlSheetTab;
      if (!id) return;
      timelineSheetTab = id;
      timelineRenderSheet({ focusActiveTab: true });
    });
  });
  if (opts && opts.focusActiveTab) {
    requestAnimationFrame(function () {
      try { root.querySelector("[data-tl-sheet-tab].on")?.focus(); } catch {}
    });
  }
}

function timelineSheetPeekPx() {
  const tab = document.getElementById("tl-focus-tab");
  return tab && tab.classList.contains("is-revealed") ? tab.offsetHeight : 0;
}

function bindTimelineSheetMessageHold(host) {
  if (!host) return;
  if (typeof onceFlag === "function" && !onceFlag(host, "edcMsgHold")) return;
  let timer = 0;
  let target = null;
  const clear = function () {
    if (timer) clearTimeout(timer);
    timer = 0;
    target = null;
  };
  const openHeld = function (msgEl) {
    if (!msgEl || msgEl.dataset.realChat !== "1") return;
    const ev = timelineSheetEventId ? timelineFindEvent(timelineSheetEventId) : null;
    const ch = ev && typeof timelineSheetChannel === "function" ? timelineSheetChannel(ev) : null;
    if (!ch || typeof openChatMessageOptions !== "function") return;
    const owner = typeof timelineEventOwner === "function" ? timelineEventOwner(ev) : null;
    openChatMessageOptions(ch, msgEl.dataset.msgId, owner);
  };
  host.addEventListener("pointerdown", function (e) {
    if (e.target.closest(".edc-pin, .rx, .msg-reply-quote, .chat-msg-toolbar")) return;
    const msgs = host.querySelector("#tl-sheet-messages");
    const msg = e.target.closest(".edc-msg");
    if (!msgs || !msg || !msgs.contains(msg) || (e.button && e.button !== 0)) return;
    if (msg.dataset.realChat !== "1") return;
    clear();
    target = msg;
    timer = setTimeout(function () {
      if (target) openHeld(target);
      clear();
    }, 480);
  });
  host.addEventListener("pointerup", clear);
  host.addEventListener("pointercancel", clear);
  host.addEventListener("pointermove", function (e) {
    if (Math.hypot(e.movementX || 0, e.movementY || 0) > 8) clear();
  });
  host.addEventListener("contextmenu", function (e) {
    if (e.target.closest(".edc-pin, .chat-msg-toolbar")) return;
    const msgs = host.querySelector("#tl-sheet-messages");
    const msg = e.target.closest(".edc-msg");
    if (!msgs || !msg || !msgs.contains(msg)) return;
    if (msg.dataset.realChat !== "1") return;
    e.preventDefault();
    clear();
    openHeld(msg);
  });
  host.addEventListener("click", function (e) {
    if (typeof handleChatPlanPromoteClick !== "function") return;
    const ev = timelineSheetEventId ? timelineFindEvent(timelineSheetEventId) : null;
    const ch = ev && typeof timelineSheetChannel === "function" ? timelineSheetChannel(ev) : null;
    const owner = ev && typeof timelineEventOwner === "function" ? timelineEventOwner(ev) : null;
    handleChatPlanPromoteClick(e, { ch, ownerConn: owner });
  });
}

function timelineRenderSheet(opts) {
  const host = document.getElementById("tl-sheet-host");
  if (!host) return;
  const ev = timelineSheetEventId ? timelineFindEvent(timelineSheetEventId) : null;
  if (!ev) {
    host.innerHTML = "";
    host.classList.remove("open");
    timelineSetOpenSheetClass(false);
    return;
  }
  const alreadyOpen = host.classList.contains("open") && host.querySelector(".tl-event-sheet");
  const stayPeek = !!(opts && opts.stayPeek);
  const firstOpen = !alreadyOpen && !stayPeek;
  if (firstOpen) {
    const ae = document.activeElement;
    timelineSheetRestoreFocus = (ae && ae !== document.body && typeof ae.focus === "function")
      ? ae
      : document.getElementById("tl-focus-tab");
  }
  const peekH = alreadyOpen && !stayPeek
    ? 0
    : (Number(opts && opts.peekH) > 0 ? Number(opts.peekH) : timelineSheetPeekPx());
  const scrollToRow = !!(opts && opts.scrollToRow);
  host.innerHTML = timelineSheetHTML(ev);
  const sheet = host.querySelector(".tl-event-sheet");
  if (timelineSheetExpanded && sheet) sheet.classList.add("is-expanded");
  if (peekH && sheet) {
    sheet.style.transition = "none";
    sheet.style.transform = timelineSheetPeekTransform(peekH, 0);
  }
  host.classList.add("open");
  if (timelineSheetExpanded) {
    host.classList.add("is-expanded");
    timelineAttachSheetHost(true);
  }
  timelineSetOpenSheetClass(true);
  timelineSyncIme();
  if (peekH && sheet && !stayPeek) {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        sheet.style.transition = "";
        sheet.style.transform = "";
        if (scrollToRow) timelineScrollFocusedRow();
      });
    });
  } else if (!stayPeek && scrollToRow) {
    requestAnimationFrame(timelineScrollFocusedRow);
  }
  host.querySelectorAll("[data-tl-sheet-close]").forEach(function (button) {
    button.addEventListener("click", closeTimelineSheet);
  });
  timelineWireSheetTabs(host, opts);
  if (firstOpen && !(opts && opts.focusComposer)) {
    requestAnimationFrame(function () {
      try { host.querySelector("header [data-tl-sheet-close]")?.focus(); } catch {}
    });
  }
  document.getElementById("tl-sheet-more")?.addEventListener("click", function (event) {
    event.stopPropagation();
    timelineOpenQuickMenu(ev, event.currentTarget);
  });
  host.querySelector("[data-tl-sheet-edit]")?.addEventListener("click", function () {
    timelineOpenDescriptionEditor(ev);
  });
  timelineWireSheetGestures(host);
  if (typeof attachModeSwipe === "function"
      && (typeof onceFlag !== "function" || onceFlag(host, "sheetCalSwipe"))) {
    attachModeSwipe(host, { openNavOnRight: true, openChannelPanelOnLeft: true });
  }
  const form = document.getElementById("tl-sheet-compose");
  const input = document.getElementById("tl-sheet-input");
  const taskSuggest = document.getElementById("tl-task-suggest");
  if (form && input) {
    const tlTaskCtx = function () {
      const owner = timelineEventOwner(ev);
      return {
        conn: owner,
        chatChannel: timelineSheetChannel(ev),
        input: input,
        eventId: ev.id,
        encryptKey: owner && owner.key,
        extraPayload: {
          eventId: ev.id,
          mentionedEventIds: [ev.id],
          replyTo: S.replyToMessage && S.replyToMessage.id || "",
        },
        afterPost: function () {
          if (S.replyToMessage) {
            S.replyToMessage = null;
            document.querySelector("#tl-sheet-compose .composer-reply-chip")?.remove();
          }
          const msgs = document.getElementById("tl-sheet-messages");
          const chat = typeof timelineChatMeta === "function" ? timelineChatMeta(ev) : null;
          if (msgs && chat && typeof eventDetailChatMsgHTML === "function") {
            msgs.innerHTML = chat.messages.length
              ? chat.messages.map(function (message) {
                  return eventDetailChatMsgHTML(message, ev);
                }).join("")
              : '<p class="tl-sheet-empty">No messages yet.</p>';
            msgs.scrollTop = msgs.scrollHeight;
          }
          requestAnimationFrame(function () {
            try { input.focus(); } catch {}
          });
        },
      };
    };
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      timelineSubmitSheetChat(ev, input);
    });
    if (typeof bindComposerSendVisibility === "function") {
      bindComposerSendVisibility(form, input);
    }
    if (taskSuggest && typeof paintChatTaskSuggestions === "function") {
      input.addEventListener("input", function () {
        paintChatTaskSuggestions(input, taskSuggest, tlTaskCtx());
      });
    }
    input.addEventListener("pointerdown", function () {
      timelineSetNativeKeyboardOverlay(false);
    });
    input.addEventListener("focus", function () {
      timelineSetNativeKeyboardOverlay(false);
      if (!timelineSheetExpanded) {
        timelineSheetImeExpanded = true;
        timelineSheetImeSeen = false;
        timelineSetSheetExpanded(true, { fromIme: true });
      }
      requestAnimationFrame(function () {
        timelineSyncIme();
        requestAnimationFrame(timelineSyncIme);
      });
    });
    input.addEventListener("blur", function () {
      setTimeout(timelineSyncIme, 80);
    });
    requestAnimationFrame(function () {
      const msgs = document.getElementById("tl-sheet-messages");
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
      if (opts && opts.focusComposer) {
        try { input.focus(); } catch {}
      }
    });
  }
  bindTimelineSheetMessageHold(host);
  if (typeof paintTimelineSheetReplyChip === "function") paintTimelineSheetReplyChip();
}

function timelineSheetActiveScroller(sheet) {
  const root = sheet || document.querySelector(".tl-event-sheet");
  if (!root) return null;
  const panel = root.querySelector(".tl-sheet-panel.on");
  if (!panel) return null;
  if (panel.getAttribute("data-tl-panel") === "chat") {
    return panel.querySelector(".tl-sheet-messages") || panel;
  }
  return panel;
}

function timelineSheetCanScroll(sheet, dy) {
  const scroller = timelineSheetActiveScroller(sheet);
  if (!scroller) return false;
  const max = scroller.scrollHeight - scroller.clientHeight;
  if (max <= 1) return false;
  if (dy > 0) return scroller.scrollTop > 1;
  if (dy < 0) return scroller.scrollTop < max - 1;
  return false;
}

function timelineSheetScrollBy(sheet, dy) {
  const scroller = timelineSheetActiveScroller(sheet);
  if (!scroller) return false;
  const next = scroller.scrollTop - dy;
  const max = scroller.scrollHeight - scroller.clientHeight;
  scroller.scrollTop = Math.max(0, Math.min(max, next));
  return true;
}

function timelineWireSheetGestures(host) {
  const sheet = host.querySelector(".tl-event-sheet");
  if (!sheet) return;
  let sy = 0;
  let lastY = 0;
  let st = 0;
  let pointerId = 0;
  let dragging = false;
  let tracking = false;
  let fromChrome = false;
  let finished = false;
  let swallowHandleClick = false;
  const tapSlop = () => (typeof AshGesture !== "undefined" && AshGesture.TAP_SLOP) || 12;
  const commitAlong = (distance, dt) => {
    const travel = sheet.getBoundingClientRect().height || innerHeight;
    if (typeof AshGesture !== "undefined" && typeof AshGesture.shouldCommit === "function") {
      return AshGesture.shouldCommit({ distance, travel, dt });
    }
    return Math.abs(distance) >= travel * 0.25;
  };
  const onHandle = function (event) {
    if (event.target.closest(".tl-sheet-handle")) return true;
    if (event.target.closest("button")) return false;
    return event.clientY - sheet.getBoundingClientRect().top <= 36;
  };
  const unbindWin = function () {
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onCancel, true);
    window.removeEventListener("touchmove", onTouchMove, true);
    window.removeEventListener("touchend", onTouchEnd, true);
    window.removeEventListener("touchcancel", onTouchCancel, true);
  };
  const moveTo = function (y, event) {
    if (event && event.cancelable) event.preventDefault();
    const frameDy = y - lastY;
    lastY = y;
    if (!dragging) {
      if (!fromChrome && timelineSheetCanScroll(sheet, frameDy)) {
        timelineSheetScrollBy(sheet, frameDy);
        sy = y;
        return;
      }
      if (Math.abs(y - sy) <= tapSlop()) return;
      dragging = true;
      sheet.classList.add("is-dragging");
    }
    const dy = y - sy;
    const shift = timelineSheetExpanded ? Math.max(0, dy) : dy;
    sheet.style.transform = "translate(-50%, " + shift + "px)";
  };
  const onMove = function (event) {
    if (event.pointerId !== pointerId) return;
    if (!tracking && !dragging) return;
    if (event.pointerType === "touch") return;
    moveTo(event.clientY, event);
  };
  const onTouchMove = function (event) {
    if (!tracking && !dragging) return;
    const touch = event.touches[0] || event.changedTouches[0];
    if (!touch) return;
    moveTo(touch.clientY, event);
  };
  const finish = function (y) {
    if (finished) return;
    finished = true;
    unbindWin();
    sheet.classList.remove("is-dragging");
    const dy = (y || lastY) - sy;
    const dt = performance.now() - st;
    if (dragging) swallowHandleClick = true;
    if (timelineSheetExpanded) {
      if (dragging && dy > 0 && commitAlong(dy, dt)) timelineSetSheetExpanded(false);
      else sheet.style.transform = "";
    } else if (dragging && dy < 0 && commitAlong(dy, dt)) {
      timelineSetSheetExpanded(true);
    } else if (dragging && dy > 0 && commitAlong(dy, dt)) {
      closeTimelineSheet();
    } else {
      sheet.style.transform = "";
    }
    dragging = false;
    tracking = false;
    fromChrome = false;
    if (timelineRefreshPending) timelineQueueLiveRefresh();
  };
  const onUp = function (event) {
    if (event.pointerId !== pointerId) return;
    finish(event.clientY || lastY);
  };
  const onCancel = function (event) {
    if (event.pointerId !== pointerId) return;
    if (event.cancelable) event.preventDefault();
  };
  const onTouchEnd = function (event) {
    if (!tracking && !dragging) return;
    const touch = event.changedTouches && event.changedTouches[0];
    finish(touch ? touch.clientY : lastY);
  };
  const onTouchCancel = function (event) {
    if (event.cancelable) event.preventDefault();
  };
  sheet.addEventListener("pointerdown", function (event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (timelineComposerFocused()) return;
    const onHandleBtn = !!event.target.closest(".tl-sheet-handle");
    if (!onHandleBtn && event.target.closest("button, input, textarea, a, .edc-msg, .chat-msg-toolbar")) return;
    if (event.clientX >= innerWidth - Math.max(28, innerWidth * 0.1)) return;
    if (!finished && (tracking || dragging)) finish(lastY);
    unbindWin();
    swallowHandleClick = false;
    fromChrome = onHandle(event) || !event.target.closest(".tl-sheet-panel");
    pointerId = event.pointerId;
    sy = lastY = event.clientY;
    st = performance.now();
    dragging = false;
    tracking = true;
    finished = false;
    window.addEventListener("pointermove", onMove, { capture: true, passive: false });
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onCancel, true);
    window.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    window.addEventListener("touchend", onTouchEnd, true);
    window.addEventListener("touchcancel", onTouchCancel, true);
  });
  sheet.querySelector(".tl-sheet-handle")?.addEventListener("click", function (event) {
    if (swallowHandleClick) {
      event.preventDefault();
      event.stopPropagation();
      swallowHandleClick = false;
      return;
    }
    timelineSetSheetExpanded(!timelineSheetExpanded);
  });
}

async function timelineSubmitSheetChat(ev, input) {
  const text = String(input && input.value || "").trim();
  if (!text || !timelineSheetCanCompose(ev)) return;
  const owner = timelineEventOwner(ev);
  const channel = timelineSheetChannel(ev);
  if (!owner || !channel) return;
  if (typeof handleChatTaskComposerSubmit === "function") {
    const outcome = await handleChatTaskComposerSubmit({
      conn: owner,
      chatChannel: channel,
      eventId: ev.id,
      text: input.value,
      encryptKey: owner.key,
      extraPayload: {
        eventId: ev.id,
        mentionedEventIds: [ev.id],
        replyTo: S.replyToMessage && S.replyToMessage.id || "",
      },
    });
    if (outcome === "blocked") {
      const box = document.getElementById("tl-task-suggest");
      if (box && typeof paintChatTaskSuggestions === "function") {
        paintChatTaskSuggestions(input, box, {
          conn: owner, chatChannel: channel, input: input, eventId: ev.id, encryptKey: owner.key,
        });
      }
      return;
    }
    if (outcome === "posted") {
      input.value = "";
      if (typeof syncComposerSendButton === "function") {
        syncComposerSendButton(document.getElementById("tl-sheet-compose"), input);
      }
      if (S.replyToMessage) {
        S.replyToMessage = null;
        document.querySelector("#tl-sheet-compose .composer-reply-chip")?.remove();
      }
      const msgs = document.getElementById("tl-sheet-messages");
      const chat = typeof timelineChatMeta === "function" ? timelineChatMeta(ev) : null;
      if (msgs && chat && typeof eventDetailChatMsgHTML === "function") {
        msgs.innerHTML = chat.messages.length
          ? chat.messages.map(function (message) {
              return eventDetailChatMsgHTML(message, ev);
            }).join("")
          : '<p class="tl-sheet-empty">No messages yet.</p>';
        msgs.scrollTop = msgs.scrollHeight;
      }
      requestAnimationFrame(function () {
        try { input.focus(); } catch {}
      });
      return;
    }
  }
  const replyTo = S.replyToMessage?.id || "";
  input.value = "";
  if (typeof syncComposerSendButton === "function") {
    syncComposerSendButton(document.getElementById("tl-sheet-compose"), input);
  }
  const msgs = document.getElementById("tl-sheet-messages");
  if (msgs) {
    msgs.querySelector(".tl-sheet-empty")?.remove();
    const optimistic = {
      name: owner.me && owner.me.name || "Me",
      userId: owner.me && owner.me.id,
      text: text,
      _text: text,
      ts: Date.now(),
      replyToId: replyTo || undefined,
    };
    if (typeof eventDetailChatMsgHTML === "function") {
      msgs.insertAdjacentHTML("beforeend", eventDetailChatMsgHTML(optimistic, ev, { canPin: false }));
    }
    msgs.scrollTop = msgs.scrollHeight;
  }
  const cipher = typeof encrypt === "function" ? await encrypt(text, owner.key) : text;
  send({
    type: "sendMessage",
    channelId: channel.id,
    text: cipher,
    eventId: ev.id,
    mentionedEventIds: [ev.id],
    replyTo: replyTo,
  }, owner.id);
  if (replyTo) {
    S.replyToMessage = null;
    document.querySelector("#tl-sheet-compose .composer-reply-chip")?.remove();
  }
  try { CardFeel.softConfirm(); } catch {}
  requestAnimationFrame(function () {
    try { input.focus(); } catch {}
  });
}

function openEventConversation(eventId, tab) {
  if (!eventId) return false;
  try { if (typeof closeChannelPanel === "function") closeChannelPanel(); } catch {}
  const wantTab = tab || "chat";
  timelineSheetEventId = eventId;
  timelineSheetTab = wantTab;
  if (document.getElementById("tl-sheet-host")) {
    openTimelineSheet(eventId, wantTab);
    return true;
  }
  const ev = timelineFindEvent(eventId);
  const chId = ev && ev.channelId;
  if (chId && S.activeProjection && typeof Nav?.openProjectedChannel === "function") {
    Nav.openProjectedChannel({
      sourceConnId: S.activeProjection.sourceConnId,
      sourceBoardId: S.activeProjection.sourceBoardId,
      sourceChannelId: chId,
    });
  } else if (chId && typeof Nav !== "undefined" && typeof Nav.openChannel === "function") {
    Nav.openChannel(chId);
  } else if (typeof Nav !== "undefined" && typeof Nav.landDefault === "function") {
    Nav.landDefault();
  }
  if (typeof renderView === "function") renderView();
  return true;
}

function openTimelineSheet(eventId, tab, opts) {
  if (!eventId) return;
  if (timelineOccupancyActive()) {
    timelineSetFocus(eventId, { anchor: true });
    return;
  }
  if (timelineSheetEventId && timelineSheetEventId !== eventId && timelineSheetImeExpanded) {
    timelineSheetImeExpanded = false;
    timelineSheetImeSeen = false;
    timelineSheetExpanded = false;
  }
  timelineFocusHold = true;
  timelineSetFocus(eventId, { anchor: true });
  timelineSheetEventId = eventId;
  timelineSheetTab = tab || "chat";
  timelineRenderSheet({
    scrollToRow: !opts || opts.scrollToRow !== false,
    focusComposer: !!(opts && opts.focusComposer),
    stayPeek: !!(opts && opts.stayPeek),
    peekH: opts && opts.peekH,
  });
}

function closeTimelineSheet() {
  timelineSheetEventId = null;
  timelineSheetExpanded = false;
  timelineSheetImeExpanded = false;
  timelineSheetImeSeen = false;
  timelineFocusHold = false;
  if (typeof timelineSetFocus === "function") timelineSetFocus(null, { instant: true });
  const host = document.getElementById("tl-sheet-host");
  const main = document.querySelector(".main");
  const mode = document.querySelector(".timeline-view-mode");
  if (main) main.classList.remove("is-tl-sheet-expanded");
  if (mode) mode.classList.remove("is-sheet-expanded");
  timelineSyncIme();
  if (host) {
    const sheet = host.querySelector(".tl-event-sheet");
    const peekH = timelineSheetPeekPx();
    host.classList.remove("open", "is-expanded");
    if (sheet) sheet.classList.remove("is-expanded");
    timelineSetOpenSheetClass(false);
    if (sheet && peekH) {
      sheet.style.transform = "translate(-50%, calc(100% - " + peekH + "px))";
    }
    setTimeout(function () {
      if (timelineSheetEventId) return;
      if (host) host.innerHTML = "";
      timelineAttachSheetHost(false);
    }, 240);
  }
  timelineCloseQuickMenu();
  const restore = timelineSheetRestoreFocus;
  timelineSheetRestoreFocus = null;
  if (restore && restore.id !== "tl-focus-tab"
      && restore.isConnected
      && !restore.closest?.("#tl-sheet-host")
      && typeof restore.focus === "function") {
    try { restore.focus(); } catch {}
  }
}

function timelineActionLabel(action, ev) {
  const labels = {
    accept: (typeof eventRsvpAcceptMenuLabel === "function" ? eventRsvpAcceptMenuLabel(ev) : "Accept"),
    decline: "Can't",
    rsvp: "Change RSVP",
    image: "Share image",
    art: "Change art",
    "clear-art": "Remove art",
    share: "Share",
    edit: "Edit",
    routine: ev && ev.routineId ? "Remove routine" : "Save as routine",
    report: "Report",
    delete: "Delete",
  };
  return labels[action] || action;
}

function timelineActionIcon(action, ev) {
  const icons = {
    accept: "check",
    decline: "cancel",
    rsvp: "check-circle",
    image: "image",
    art: "image-plus",
    "clear-art": "image-off",
    share: "share",
    edit: "pencil",
    routine: ev && ev.routineId ? "bookmark-check" : "bookmark-plus",
    report: "flag",
    delete: "trash",
  };
  return icons[action] || "more";
}

function timelineOpenQuickMenu(ev, anchor) {
  if (timelineOccupancyActive()) return;
  const menu = document.getElementById("tl-quick-menu");
  const backdrop = document.getElementById("tl-quick-backdrop");
  if (!menu || !backdrop || !ev) return;
  const actions = timelineEventActions(ev);
  menu.innerHTML = actions.map(function (action) {
    return '<button type="button" data-tl-action="' + action + '"'
      + (action === "delete" ? ' class="danger"' : "")
      + '>' + ic(timelineActionIcon(action, ev), "ico-inline")
      + '<span>' + esc(timelineActionLabel(action, ev)) + '</span></button>';
  }).join("");
  if (anchor) {
    const rect = anchor.getBoundingClientRect();
    menu.style.top = Math.min(innerHeight - 360, Math.max(12, rect.bottom + 6)) + "px";
    menu.style.right = Math.max(12, innerWidth - rect.right) + "px";
  } else {
    menu.style.top = "50%";
    menu.style.right = "50%";
  }
  backdrop.hidden = false;
  menu.hidden = false;
  menu.querySelectorAll("[data-tl-action]").forEach(function (button) {
    button.addEventListener("click", function () {
      timelineRunAction(ev, button.dataset.tlAction, button);
    });
  });
}

function timelineCloseQuickMenu() {
  if (typeof closeEventRsvpMenuAnchor === "function") closeEventRsvpMenuAnchor();
  const menu = document.getElementById("tl-quick-menu");
  const backdrop = document.getElementById("tl-quick-backdrop");
  if (menu) menu.hidden = true;
  if (backdrop) backdrop.hidden = true;
}

async function timelineRunAction(ev, action, button) {
  timelineCloseQuickMenu();
  if (action === "accept" || action === "decline") {
    const status = action === "accept"
      ? (typeof eventPositiveRsvpStatus === "function" ? eventPositiveRsvpStatus(ev) : "going")
      : "out";
    if (typeof setEventRsvp === "function") setEventRsvp(ev.id, status);
    closeTimelineSheet();
    renderView();
    return;
  }
  if (action === "rsvp") {
    if (typeof openEventRsvpMenu === "function") {
      openEventRsvpMenu(ev, button, () => {
        closeTimelineSheet();
        renderView();
      });
    }
    return;
  }
  if (action === "clear-art") {
    if (typeof setLocalMemoryPhoto === "function") setLocalMemoryPhoto(ev, "");
    toast("Art removed");
    if (typeof renderView === "function") renderView();
    return;
  }
  if (action === "art") {
    if (typeof pickLocalMemoryPhoto !== "function") {
      toast("Photo picker isn’t available");
      return;
    }
    try {
      const data = await pickLocalMemoryPhoto(ev);
      if (data === null) return;
      toast("Saved on this device only");
      if (typeof renderView === "function") renderView();
    } catch (err) {
      toast(err?.message || "Couldn’t save photo");
    }
    return;
  }
  if (action === "image") {
    if (typeof openEventCardSheet === "function") openEventCardSheet(ev);
    return;
  }
  if (action === "edit") {
    if (typeof openEditEventDraft === "function") openEditEventDraft(ev);
    return;
  }
  if (action === "share") {
    if (typeof openPassSendModal === "function") openPassSendModal(ev);
    return;
  }
  if (action === "routine") {
    const owner = timelineEventOwner(ev);
    if (ev.routineId) {
      const conn = owner || activeConn();
      const routine = (conn?.routines || []).find(r => r.id === ev.routineId);
      if (routine && typeof snackbarDeleteRoutine === "function") {
        snackbarDeleteRoutine(conn, routine, owner && owner.id, () => {
          if (typeof renderView === "function") renderView();
        });
        return;
      }
      send({ type: "deleteRoutine", routineId: ev.routineId }, owner && owner.id);
      toast("Routine removed");
    } else {
      send({ type: "createRoutine", eventId: ev.id }, owner && owner.id);
      toast("Routine saved");
    }
    renderView();
    return;
  }
  if (action === "report") {
    const owner = timelineEventOwner(ev);
    if (typeof openReportModal === "function") {
      openReportModal({
        targetType: "event",
        targetId: ev.id,
        channelId: ev.channelId || null,
        targetLabel: "this event",
        connId: owner && owner.id,
      });
    }
    return;
  }
  if (action === "delete") {
    const owner = timelineEventOwner(ev);
    if (timelineEventOthersInvolved(ev)) {
      if (!(await ashConfirm("Delete “" + timelineEventTitle(ev) + "”?", {
        ok: "Delete", danger: true,
      }))) return;
      send({ type: "deleteEvent", eventId: ev.id }, owner && owner.id);
      closeTimelineSheet();
      renderView();
      return;
    }
    const eventId = ev.id;
    closeTimelineSheet();
    const snap = hideLocalTimelineEvent(owner, ev);
    renderView();
    const fb = typeof AshFeedback !== "undefined" ? AshFeedback : null;
    const commit = () => send({ type: "deleteEvent", eventId: eventId }, owner && owner.id);
    if (!snap || !fb || typeof fb.snackbar !== "function") {
      commit();
      return;
    }
    fb.snackbar({
      message: "Event deleted · Undo",
      action: "Undo",
      onUndo() {
        restoreLocalTimelineEvent(snap);
        renderView();
      },
      onCommit() { commit(); },
    });
  }
}

function timelineWireHeader(scroller, targetChannel) {
  const head = document.querySelector(".tl-board-head");
  const bind = !head ? false
    : (typeof onceFlag === "function" ? onceFlag(head, "tlHeader") : !head.dataset.tlHeader);
  if (head && bind) {
    if (typeof onceFlag !== "function") head.dataset.tlHeader = "1";
    wireBoardHeadTap(document.getElementById("focus-today"), function () {
      S.anchor = timelineDay(Date.now());
      timelineMonthCursor = timelineMonthStart(S.anchor);
      timelineJumpPendingDay = S.anchor;
      renderView();
    });
  }
  if (typeof wireTimelineSettings === "function") {
    const wrap = document.querySelector(".timeline-settings-wrap");
    const bindSettings = !wrap ? false
      : (typeof onceFlag === "function" ? onceFlag(wrap, "tlSettings") : !wrap.dataset.tlSettings);
    if (bindSettings) {
      if (typeof onceFlag !== "function" && wrap) wrap.dataset.tlSettings = "1";
      wireTimelineSettings(document.getElementById("view"), targetChannel);
    }
  }
  if (typeof attachModeSwipe === "function") {
    attachModeSwipe(scroller, { openNavOnRight: true, openChannelPanelOnLeft: true });
  }
}

function timelineShowCreateFab() {
  return typeof canCreateEvents !== "function" || canCreateEvents();
}

function timelineWireFocusTab() {
  const tab = document.getElementById("tl-focus-tab");
  if (!tab) return;
  const bindTab = typeof onceFlag === "function"
    ? onceFlag(tab, "tlFocusTab")
    : !tab.dataset.tlFocusTab;
  if (!bindTab) {
    timelineWireCreateFab();
    return;
  }
  if (typeof onceFlag !== "function") tab.dataset.tlFocusTab = "1";
  const openPeek = function () {
    if (!timelineFocusedEventId) return;
    if (timelineOpenAgendaEvent(timelineFocusedEventId)) return;
    openTimelineSheet(timelineFocusedEventId, "chat", { focusComposer: false });
  };
  tab.addEventListener("click", function (event) {
    if (event.target.closest(".tl-focus-chat")) return;
    if (tab._didDrag) return;
    openPeek();
  });
  tab.querySelector(".tl-focus-chat")?.addEventListener("click", function (event) {
    event.stopPropagation();
    if (tab._didDrag) return;
    openPeek();
  });
  let sx = 0;
  let sy = 0;
  let dragging = false;
  let tracking = false;
  tab.addEventListener("pointerdown", function (event) {
    if (event.target.closest(".tl-focus-chat")) return;
    sx = event.clientX;
    sy = event.clientY;
    dragging = false;
    tracking = true;
    tab._didDrag = false;
  });
  tab.addEventListener("pointermove", function (event) {
    const captured = tab.hasPointerCapture && tab.hasPointerCapture(event.pointerId);
    if (!tracking && !captured) return;
    const dx = event.clientX - sx;
    const dy = event.clientY - sy;
    const lift = -dy;
    if (!dragging) {
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        tracking = false;
        return;
      }
      if (lift > 8 && lift >= Math.abs(dx)) {
        dragging = true;
        tracking = false;
        tab._didDrag = true;
        tab.classList.add("is-dragging");
        timelinePeekExpandH = tab.offsetHeight;
        try { tab.setPointerCapture(event.pointerId); } catch {}
        if (timelineFocusedEventId) {
          if (timelineOpenAgendaEvent(timelineFocusedEventId)) {
            dragging = false;
            tracking = false;
            tab.classList.remove("is-dragging");
            return;
          }
          openTimelineSheet(timelineFocusedEventId, "chat", {
            focusComposer: false,
            stayPeek: true,
            scrollToRow: false,
            peekH: timelinePeekExpandH,
          });
        }
      } else {
        return;
      }
    }
    const sheet = document.querySelector("#tl-sheet-host.open .tl-event-sheet");
    if (sheet) {
      sheet.classList.add("is-dragging");
      const maxLift = Math.max(0, sheet.getBoundingClientRect().height - timelinePeekExpandH);
      sheet.style.transform = timelineSheetPeekTransform(timelinePeekExpandH, Math.min(lift, maxLift));
    }
  });
  const endDrag = function (event) {
    tracking = false;
    if (tab.hasPointerCapture && tab.hasPointerCapture(event.pointerId)) {
      try { tab.releasePointerCapture(event.pointerId); } catch {}
    }
    const lift = sy - event.clientY;
    tab.classList.remove("is-dragging");
    tab.style.transform = "";
    const sheet = document.querySelector("#tl-sheet-host.open .tl-event-sheet");
    if (dragging && sheet) {
      sheet.classList.remove("is-dragging");
      if (lift > 28) {
        sheet.style.transition = "";
        sheet.style.transform = "translate(-50%, 0)";
        timelineScrollFocusedRow();
      } else {
        closeTimelineSheet();
      }
    }
    dragging = false;
    if (timelineRefreshPending) timelineQueueLiveRefresh();
  };
  tab.addEventListener("pointerup", endDrag);
  tab.addEventListener("pointercancel", endDrag);
  timelineWireCreateFab();
}

function timelineWireCreateFab() {
  const fab = document.getElementById("tl-create-fab");
  if (!fab) {
    return;
  }
  const bind = typeof onceFlag === "function" ? onceFlag(fab, "tlFab") : !fab.dataset.tlFab;
  if (bind) {
    if (typeof onceFlag !== "function") fab.dataset.tlFab = "1";
    fab.addEventListener("click", function () {
      const scroller = document.querySelector(".timeline-view-mode .timeline-scroll");
      if (scroller) {
        try { timelineSyncFocus(scroller); } catch {}
      }
      const day = timelineFocusDay();
      if (typeof startFlatTypePick === "function") {
        startFlatTypePick({ createFromEvent: true, day: day });
      }
    });
  }
}

function timelineShellSignature(context) {
  const connId = (typeof S !== "undefined" && S.activeConnId) || "";
  const channelId = (context && context.targetChannel && context.targetChannel.id) || "";
  const meta = context && context.isMetaBoard ? "1" : "0";
  const fab = timelineShowCreateFab() ? "1" : "0";
  const cal = timelineCalendarOpen ? "1" : "0";
  const layout = timelineIsCardLayout() ? "cards" : (timelineIsListLayout() ? "list" : "timeline");
  const occupancy = timelineOccupancyActive(context && context.targetChannel) ? "occ"
    : (timelineAgendaActive(context && context.targetChannel) ? "agenda" : "rsvp");
  return [connId, channelId, meta, fab, cal, layout, occupancy].join("|");
}

function timelineInteractionActive() {
  if (typeof document !== "undefined" && document.body.classList.contains("tl-creating")) return true;
  if (timelineFeedScrolling) return true;
  if (typeof document === "undefined") return false;
  if (document.querySelector(".tl-event-sheet.is-dragging")) return true;
  if (document.querySelector(".tl-focus-tab.is-dragging")) return true;
  if (document.querySelector(".tl-card-deck.is-dragging")) return true;
  const h = typeof timelineVisibleHeight === "function" ? timelineVisibleHeight() : 0;
  if (h && timelineImeBaseline && timelineImeBaseline - h > 80) return true;
  return false;
}

function timelineShouldDeferLivePaint(view) {
  if (timelineJumpPendingDay != null) return false;
  if (!view || !view.querySelector || !view.querySelector(".timeline-scroll")) return false;
  return timelineInteractionActive();
}

function timelineQueueLiveRefresh() {
  timelineRefreshPending = true;
  if (timelineRefreshTimer) return;
  timelineRefreshTimer = setTimeout(function () {
    timelineRefreshTimer = 0;
    if (!timelineRefreshPending) return;
    if (timelineInteractionActive()) {
      timelineQueueLiveRefresh();
      return;
    }
    timelineRefreshPending = false;
    if (typeof renderView === "function") renderView();
  }, 90);
}

function timelineWireFeedScrollDefer(scroller) {
  if (!scroller) return;
  const bind = typeof onceFlag === "function"
    ? onceFlag(scroller, "tlDeferScroll")
    : !scroller.dataset.tlDeferScroll;
  if (!bind) return;
  if (typeof onceFlag !== "function") scroller.dataset.tlDeferScroll = "1";
  let quiet = 0;
  scroller.addEventListener("scroll", function () {
    timelineFeedScrolling = true;
    clearTimeout(quiet);
    quiet = setTimeout(function () {
      timelineFeedScrolling = false;
      if (timelineRefreshPending) timelineQueueLiveRefresh();
    }, 90);
  }, { passive: true });
}

function timelinePatchHeader(countText) {
  const status = document.querySelector(".tl-view-status");
  if (!status) return;
  const mode = typeof rsvpFilterMode === "function" ? rsvpFilterMode() : "all";
  const filterText = timelineFilterLabel(mode);
  let label = status.querySelector(".tl-view-label");
  if (filterText) {
    if (!label) {
      label = document.createElement("span");
      label.className = "tl-view-label";
      status.insertBefore(label, status.firstChild);
    }
    label.textContent = filterText;
  } else if (label) {
    label.remove();
  }
  let count = status.querySelector(".tl-view-hidden");
  if (countText) {
    if (!count) {
      count = document.createElement("span");
      count.className = "tl-view-hidden";
      status.appendChild(count);
    }
    count.textContent = String(countText);
  } else if (count) {
    count.remove();
  }
}

function timelinePatchCalendar(events) {
  const old = document.getElementById("timeline-calendar-shell");
  if (!old) return;
  const holder = document.createElement("div");
  holder.innerHTML = timelineBuildCalendar(events);
  const next = holder.firstElementChild;
  if (!next || timelineSameMarkup(old, next)) return;
  timelineReplaceCalendar(events);
}

function timelinePatchOpenSheet() {
  if (!timelineSheetEventId) return;
  const host = document.getElementById("tl-sheet-host");
  if (!host || !host.classList.contains("open")) return;
  const ev = timelineFindEvent(timelineSheetEventId);
  if (!ev) {
    closeTimelineSheet();
    return;
  }
  const sheet = host.querySelector(".tl-event-sheet");
  if (!sheet) {
    timelineRenderSheet({ stayPeek: true, focusComposer: false });
    return;
  }
  const tmp = document.createElement("div");
  tmp.innerHTML = timelineSheetHTML(ev);
  const nextSheet = tmp.querySelector(".tl-event-sheet");
  if (!nextSheet) return;
  const swap = function (sel) {
    const a = sheet.querySelector(sel);
    const b = nextSheet.querySelector(sel);
    if (a && b && !timelineSameMarkup(a, b)) a.replaceWith(b);
  };
  swap(".tl-card-preview");
  swap(".tl-sheet-heading");
  const tabs = sheet.querySelector(".tl-sheet-tabs");
  const nextTabs = nextSheet.querySelector(".tl-sheet-tabs");
  if (tabs && nextTabs && !timelineSameMarkup(tabs, nextTabs)) {
    tabs.replaceWith(nextTabs);
    timelineWireSheetTabs(host);
  }
  const msgs = sheet.querySelector("#tl-sheet-messages");
  const nextMsgs = nextSheet.querySelector("#tl-sheet-messages");
  if (msgs && nextMsgs && msgs.innerHTML !== nextMsgs.innerHTML) {
    if (host._chatMsgToolbarOpen) {
      host._pendingChatRefresh = true;
    } else {
      const follow = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 48;
      msgs.innerHTML = nextMsgs.innerHTML;
      if (follow) msgs.scrollTop = msgs.scrollHeight;
    }
  }
  swap('.tl-sheet-panel[data-tl-panel="attendance"]');
  const desc = sheet.querySelector('.tl-sheet-panel[data-tl-panel="description"]');
  const nextDesc = nextSheet.querySelector('.tl-sheet-panel[data-tl-panel="description"]');
  if (desc && nextDesc && desc.innerHTML !== nextDesc.innerHTML) {
    desc.innerHTML = nextDesc.innerHTML;
    desc.querySelector("[data-tl-sheet-edit]")?.addEventListener("click", function () {
      timelineOpenDescriptionEditor(ev);
    });
  }
}

function timelineWireQuickBackdrop() {
  const backdrop = document.getElementById("tl-quick-backdrop");
  if (!backdrop) return;
  const bind = typeof onceFlag === "function"
    ? onceFlag(backdrop, "tlBackdrop")
    : !backdrop.dataset.tlBackdrop;
  if (!bind) return;
  if (typeof onceFlag !== "function") backdrop.dataset.tlBackdrop = "1";
  backdrop.addEventListener("click", timelineCloseQuickMenu);
}

function timelineSyncInviteGrids(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll(".tl-invite-grid").forEach(timelineSyncInviteAccept);
  if (timelineOccupancyActive()) timelineSyncOccupancyMinis(root);
}

function timelinePaintLive(view, context, rootEvents, countText) {
  timelinePaintEmptyState(view, context, rootEvents);
  timelinePatchHeader(countText);
  timelinePatchCalendar(rootEvents);
  if (timelineIsCardLayout()) {
    const opts = {};
    if (timelineJumpPendingDay != null) {
      opts.day = timelineJumpPendingDay;
      timelineJumpPendingDay = null;
    }
    if (typeof timelinePaintCardDeck === "function") timelinePaintCardDeck(view, rootEvents, opts);
    timelineSyncInviteGrids(view);
    if (timelineSheetEventId && !timelineOccupancyActive()) timelinePatchOpenSheet();
    if (typeof syncCreateDraftSlot === "function") syncCreateDraftSlot();
    return;
  }
  const feed = view.querySelector("#ticket-list");
  const next = timelineBuildFeed(rootEvents);
  if (feed) timelineReconcileFeed(feed, next);
  else {
    const slot = document.getElementById("tl-feed-slot");
    if (slot) slot.replaceWith(next);
  }
  const liveFeed = view.querySelector("#ticket-list");
  timelineWireFeed(liveFeed);
  timelineSyncInviteGrids(view);
  if (timelineSheetEventId && !timelineOccupancyActive()) timelinePatchOpenSheet();
  const scroller = view.querySelector(".timeline-scroll");
  const list = timelineIsListLayout();
  const occupancy = timelineOccupancyActive();
  if (!list && !occupancy) timelinePlaceFocusLine(scroller);
  if (timelineJumpPendingDay != null) {
    const pending = timelineJumpPendingDay;
    timelineJumpPendingDay = null;
    timelineScrollDayIntoView(pending, scroller);
    timelineSetFocus(null, { instant: true });
  } else if (timelineSheetEventId) {
    timelineSetFocus(timelineSheetEventId, { anchor: true, instant: true });
  } else if (list || occupancy) {
    if (timelineFocusedEventId && timelineFindEvent(timelineFocusedEventId)) {
      timelineSetFocus(timelineFocusedEventId, { instant: true });
    }
  } else {
    timelineSyncFocus(scroller);
  }
  if (typeof syncCreateDraftSlot === "function") syncCreateDraftSlot();
}

function renderTimelineView(view, g, channel, context) {
  if (timelineShouldDeferLivePaint(view)) {
    timelineQueueLiveRefresh();
    return;
  }
  timelineRefreshPending = false;
  const previousScroller = view.querySelector(".timeline-scroll");
  const carry = previousScroller ? previousScroller.scrollTop : null;
  const previousFocused = timelineFocusedEventId;
  const signature = timelineShellSignature(context);
  const reuseShell = !!(previousScroller
    && view._timelineShellSignature === signature
    && (timelineIsCardLayout()
      ? view.querySelector(".tl-card-deck")
      : view.querySelector("#ticket-list.tl-feed")));

  view.style.cssText = "display:flex;flex-direction:column;flex:1;min-height:0";
  view.classList.add("timeline-view-mode");
  view.classList.toggle("tl-layout-list", timelineIsListLayout());
  view.classList.toggle("tl-layout-cards", timelineIsCardLayout());
  const occupancy = timelineOccupancyActive(context.targetChannel);
  view.classList.toggle("tl-occupancy-mode", occupancy);
  view.classList.toggle("tl-agenda-mode", !occupancy && timelineAgendaActive(context.targetChannel));
  view.classList.toggle("calendar-open", !!timelineCalendarOpen);
  if (occupancy) {
    timelineSheetEventId = null;
    timelineSheetExpanded = false;
  }
  document.body.classList.add("timeline-view-active");
  if (!timelineMonthCursor) timelineMonthCursor = timelineMonthStart(anchorDay());
  if (timelineMonthCursor < timelineMonthStart(Date.now())) {
    timelineMonthCursor = timelineMonthStart(Date.now());
  }

  const rootEvents = timelineSourceEvents(context);
  const prefs = timelineViewPrefs();
  const countText = timelineStatusCountText(context.events, prefs, Date.now());
  timelineEventsById = new Map();
  (context.events || []).forEach(function (ev) { timelineEventsById.set(ev.id, ev); });

  if (reuseShell) {
    timelinePaintLive(view, context, rootEvents, countText);
    timelineWireFeedScrollDefer(previousScroller);
    timelineWireOccupancyMonth(previousScroller);
    try { window.OnboardingBus?.emit?.("view:rendered", { kind: "events", zoom: "timeline" }); } catch {}
    return;
  }

  const portaledHost = document.getElementById("tl-sheet-host");
  if (portaledHost && !view.contains(portaledHost)) portaledHost.remove();


  view.innerHTML = '<div class="events-scroll timeline-scroll">'
    + '<div class="tl-focus-line" id="tl-focus-line" aria-hidden="true"></div>'
    + '<div class="events-wrap tl-events-wrap">'
    + '<div class="poll-head conv-page-head"><h2 class="poll-title">Timeline</h2>'
    + (timelineShowCreateFab()
      ? '<button type="button" class="poll-primary" data-board-create>New event</button>'
      : "")
    + '</div>'
    + '<div class="tl-sticky-head">'
    + timelineBuildHeader(context.targetChannel, countText)
    + timelineBuildCalendar(rootEvents)
    + '</div>'
    + '<div id="tl-feed-slot"></div></div></div>'
    + (timelineShowCreateFab()
      ? '<button type="button" class="tl-create-fab" id="tl-create-fab" aria-label="Create event">' + ic("plus") + '</button>'
      : "")
    + '<button type="button" class="tl-focus-tab is-empty" id="tl-focus-tab" aria-hidden="true">'
    + '<span class="tl-focus-handle" aria-hidden="true"></span>'
    + '<span class="tl-focus-preview"></span>'
    + '<span class="tl-focus-copy"><strong class="tl-focus-title"></strong><small class="tl-focus-meta"></small></span>'
    + '<span class="tl-focus-chat" aria-hidden="true">' + ic("message") + '<b></b><i></i></span></button>'
    + '<div class="tl-sheet-host" id="tl-sheet-host"></div>'
    + '<button type="button" class="tl-quick-backdrop" id="tl-quick-backdrop" hidden aria-label="Close menu"></button>'
    + '<div class="tl-quick-menu" id="tl-quick-menu" hidden role="menu"></div>';

  view._timelineShellSignature = signature;
  timelinePaintEmptyState(view, context, rootEvents);
  const slot = document.getElementById("tl-feed-slot");
  const jumped = timelineJumpPendingDay != null;
  if (timelineIsCardLayout() && typeof timelinePaintCardDeck === "function") {
    const deckOpts = jumped ? { day: timelineJumpPendingDay } : {};
    timelineJumpPendingDay = null;
    timelinePaintCardDeck(view, rootEvents, deckOpts);
  } else {
    slot.replaceWith(timelineBuildFeed(rootEvents));
  }
  const scroller = view.querySelector(".timeline-scroll");
  const feed = view.querySelector("#ticket-list");

  timelineWireHeader(scroller, context.targetChannel);
  timelineWireCalendar(scroller, rootEvents);
  if (feed) timelineWireFeed(feed);
  timelineWireFocusTab();
  timelineWireFocusScroll(scroller);
  timelineWireFeedScrollDefer(scroller);
  timelineWireOccupancyMonth(scroller);
  timelineWireIme();
  timelineWireQuickBackdrop();

  requestAnimationFrame(function () {
    timelineSyncInviteGrids(view);
    [50, 150].forEach(function (ms) { setTimeout(function () { timelineSyncInviteGrids(view); }, ms); });
    if (timelineIsCardLayout()) {
      if (timelineSheetEventId && !timelineOccupancyActive()) {
        timelineRenderSheet({ scrollToRow: true, focusComposer: false });
      }
      if (typeof syncCreateDraftSlot === "function") syncCreateDraftSlot();
      return;
    }
    if (!timelineIsListLayout() && !timelineOccupancyActive()) timelinePlaceFocusLine(scroller);
    if (timelineJumpPendingDay != null) {
      const pending = timelineJumpPendingDay;
      timelineJumpPendingDay = null;
      timelineScrollDayIntoView(pending, scroller);
    } else if (carry != null) {
      scroller.scrollTop = carry;
    }
    if (jumped) {
      timelineSetFocus(null, { instant: true });
      if (typeof syncCreateDraftSlot === "function") syncCreateDraftSlot();
      return;
    }
    if (timelineIsListLayout()) {
      if (timelineSheetEventId) {
        timelineSetFocus(timelineSheetEventId, {
          anchor: true,
          instant: true,
        });
        if (!timelineOccupancyActive()) {
          timelineRenderSheet({ scrollToRow: true, focusComposer: false });
        }
      } else {
        timelineSetFocus(null, { instant: true });
      }
      if (typeof syncCreateDraftSlot === "function") syncCreateDraftSlot();
      return;
    }
    if (timelineSheetEventId || previousFocused) {
      timelineSetFocus(timelineSheetEventId || previousFocused, {
        anchor: !!timelineSheetEventId,
        instant: true,
      });
      if (timelineSheetEventId && !timelineOccupancyActive()) {
        timelineRenderSheet({ scrollToRow: true, focusComposer: false });
      }
      if (typeof syncCreateDraftSlot === "function") syncCreateDraftSlot();
      return;
    }
    if (!timelineOccupancyActive()) timelineSyncFocus(scroller);
    if (typeof syncCreateDraftSlot === "function") syncCreateDraftSlot();
  });
  try { window.OnboardingBus?.emit?.("view:rendered", { kind: "events", zoom: "timeline" }); } catch {}
}
