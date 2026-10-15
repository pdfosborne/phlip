/* Event-note and organiser helpers (formerly channel-deck.js / channel-open-pitch.js). */
function eventSharedNotes(ev) {
  return (ev.notes || []).filter(n =>
    !n.activity && (n.noteKind === "shared" || n.pinned));
}

function isEventChatNote(n) {
  if (!n || n.activity) return false;
  if (n.noteKind === "personal" || n.noteKind === "shared") return false;
  if (n.pinned) return false;
  return true;
}

function eventChatAuthorIds(ev) {
  const ids = new Set();
  if (!ev) return ids;
  for (const n of ev.notes || []) {
    if (isEventChatNote(n) && n.userId) ids.add(n.userId);
  }
  const owner = (typeof ownerConnFor === "function" ? ownerConnFor(ev) : null)
    || (typeof activeConn === "function" ? activeConn() : null);
  const chId = ev.channelId;
  const msgs = chId && owner ? (owner.messages?.[chId] || []) : [];
  for (const m of msgs) {
    if (!m?.userId) continue;
    if (m.eventId === ev.id
        || (Array.isArray(m.mentionedEventIds) && m.mentionedEventIds.includes(ev.id))) {
      ids.add(m.userId);
    }
  }
  return ids;
}

function eventViewerId(ev, conn) {
  if (ev && ev._myId) return ev._myId;
  const src = conn && typeof sourceMeFor === "function" ? sourceMeFor(conn) : null;
  if (src && src.id) return src.id;
  if (conn && conn.me && conn.me.id) return conn.me.id;
  if (typeof myIdOf === "function" && ev) return myIdOf(ev);
  return null;
}

function isEventOrganiser(ev, conn) {
  if (!ev) return false;
  const meId = eventViewerId(ev, conn);
  return !!meId && ev.createdBy === meId;
}

function isUnansweredInvite(ev, conn) {
  if (!ev || ev.chainOf || ev.when == null) return false;
  if (isEventOrganiser(ev, conn)) return false;
  const meId = eventViewerId(ev, conn);
  if (!meId) return false;
  return !ev.rsvps?.[meId];
}

/* channel-ticket-cards.js — ticket/event card HTML + suggestion metadata.
 * Globals out: ticket, eventIcon, eventSuggestions, RSVP_BADGE,
 *   setEventRsvp, eventDetailRsvpRailHTML, eventSuggestDraftHTML, bindRsvpToggleRoot, …
 * Load after: channel-events-board.js; before: channel-chains.js
 * Size: cohesive card-rendering concern; may exceed 700-line ceiling.
 */

const RSVP_BADGE = {
  going: ic("free", "ico-inline"),
  signedUp: ic("hourglass", "ico-inline"),
  out: ic("busy", "ico-inline"),
};
const RSVP_NEEDS_REPLY_BADGE = ic("hourglass", "ico-inline");
const RSVP_STATUSES = ["going", "out"];
const RSVP_STATUS_LABEL = { going: "Going", signedUp: "Sign up", out: "Can't" };

/** Whether the viewer can set Going / Can't (or Sign up / Can't) on this event. */
function eventAllowsRsvpToggle(ev) {
  if (ev?.calendarImported) return false;
  if (!ev) return false;
  if (ev.approvalStatus === "pending" || ev.approvalStatus === "blocked") return false;
  // Guests lose the toggle once the event is past; organisers keep it so they
  // can still set/update Going · Can't on events they host.
  if (typeof past === "function" && past([ev]).length) {
    if (typeof isEventOrganiser !== "function" || !isEventOrganiser(ev)) return false;
  }
  const conn = (typeof ownerConnFor === "function" ? ownerConnFor(ev) : null)
    || (typeof ownerConnOf === "function" ? ownerConnOf(ev.id) : null)
    || (typeof activeConn === "function" ? activeConn() : null);
  if (typeof canRsvpInChannel === "function") return canRsvpInChannel(conn, ev.channelId);
  return typeof canMutateContent !== "function" || canMutateContent(conn);
}

function rsvpToggleOptionsHTML(current, { compact = false, ev = null } = {}) {
  const statuses = (typeof eventRsvpChoiceStatuses === "function" && ev)
    ? eventRsvpChoiceStatuses(ev)
    : RSVP_STATUSES;
  return statuses.map(status => {
    const on = current === status ? " on" : "";
    const label = (typeof eventRsvpChoiceLabel === "function")
      ? eventRsvpChoiceLabel(status, ev)
      : (RSVP_STATUS_LABEL[status] || status);
    const pressed = current === status ? "true" : "false";
    const badge = RSVP_BADGE[status] || RSVP_BADGE.going;
    if (compact) {
      return `<button type="button" class="rsvp-opt ${status}${on}" data-rsvp="${status}" title="${esc(label)}" aria-label="${esc(label)}" aria-pressed="${pressed}">${badge}</button>`;
    }
    return `<button type="button" class="rsvp-btn ${status}${on}" data-rsvp="${status}" aria-pressed="${pressed}"><span>${badge} ${esc(label)}</span></button>`;
  }).join("");
}

function eventCanSuggestTime(ev) {
  if (!ev) return false;
  const ownerConn = (typeof ownerConnFor === "function" ? ownerConnFor(ev) : null)
    || (typeof ownerConnOf === "function" ? ownerConnOf(ev.id) : null)
    || (typeof activeConn === "function" ? activeConn() : null);
  if (!ownerConn || (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(ownerConn))) return false;
  if (typeof canRsvpInChannel === "function") return canRsvpInChannel(ownerConn, ev.channelId);
  return typeof canCreateEvents !== "function" || canCreateEvents(ownerConn);
}

function eventDetailRsvpRailHTML(ev) {
  if (!eventAllowsRsvpToggle(ev)) return "";
  const mine = ev.rsvps?.[typeof myIdOf === "function" ? myIdOf(ev) : null] || null;
  return `<div class="event-card-popup-rsvp event-rsvp-row" role="group" aria-label="Your reply">${rsvpToggleOptionsHTML(mine, { ev })}</div>`;
}

/** Right-rail draft: full card copy; tap time slots to suggest another when. */
function eventSuggestDraftHTML(ev) {
  if (!ev || typeof eventCardHTML !== "function") return "";
  if (typeof eventCanSuggestTime === "function" && !eventCanSuggestTime(ev)) return "";
  const inner = eventCardHTML(ev, ev.when, {
    size: "building",
    omitPendingBanner: true,
    hostGem: true,
  });
  return `<div class="edc-suggest-draft edc-alt-slide-chrome" data-suggest-draft="${esc(ev.id)}" aria-label="New suggestion">
    <p class="edc-suggest-draft-hint edc-alt-slide-summary">New suggestion</p>
    <div class="edc-suggest-draft-card edc-alt-slide-face" aria-hidden="true">${inner}</div>
    <div class="edc-alt-slide-vote">
      <button type="button" class="edc-suggest-create-btn" data-alts-create-btn>Create</button>
    </div>
  </div>`;
}

/** Refresh avatar chat badges on a live timeline ticket (panel-open safe). */
function refreshTicketPeopleRow(eventId) {
  if (!eventId) return;
  let ev = null;
  if (typeof resolveEventForPanelFeed === "function") {
    try { ev = resolveEventForPanelFeed(eventId)?.ev || null; } catch {}
  }
  if (!ev) {
    const g = typeof group === "function" ? group() : null;
    ev = (g?.events || []).find(e => e.id === eventId) || null;
  }
  if (!ev || typeof eventPeopleSummaryHTML !== "function") return;
  const row = document.querySelector(`#ticket-list .ticket[data-id="${CSS.escape(eventId)}"]`);
  if (!row) return;
  const html = eventPeopleSummaryHTML(ev, 6, {
    includeHost: true,
    hostAfterAttendees: true,
    recentReactionOnly: true,
    chatUnreadOnly: true,
  });
  const peopleEl = row.querySelector(".ticket-people");
  if (!html) {
    peopleEl?.remove();
    return;
  }
  if (peopleEl) peopleEl.innerHTML = html;
  else {
    const anchor = row.querySelector(".ticket-top") || row.querySelector(".ticket-body");
    if (anchor) {
      const el = document.createElement("div");
      el.className = "ticket-people";
      el.innerHTML = html;
      anchor.insertAdjacentElement("afterend", el);
    }
  }
}

function setEventRsvp(eventId, status) {
  const conn = (typeof ownerConnOf === "function" ? ownerConnOf(eventId) : null)
    || (typeof activeConn === "function" ? activeConn() : null);
  const ev = conn?.events?.find(e => e.id === eventId)
    || (typeof group === "function" ? group()?.events?.find(e => e.id === eventId) : null);
  if (!ev || !eventAllowsRsvpToggle(ev)) return false;
  const allowed = (typeof eventRsvpChoiceStatuses === "function")
    ? eventRsvpChoiceStatuses(ev)
    : RSVP_STATUSES;
  if (!allowed.includes(status)) return false;
  const sendConn = (typeof ownerConnFor === "function" ? ownerConnFor(ev) : null) || conn;
  const me = (typeof myIdOf === "function" ? myIdOf(ev) : null) || sendConn?.me?.id || null;
  // Optimistic local write so switching Going↔Can't updates immediately
  // (same shape as net-part2 `rsvp`), including when editing an existing reply.
  if (me) {
    ev.rsvps = { ...(ev.rsvps || {}), [me]: status };
    if (ev.addedBy) delete ev.addedBy[me];
    if (status === "out" && typeof eventSignupGroups === "function") {
      eventSignupGroups(ev).forEach((g) => {
        g.memberIds = (g.memberIds || []).filter((id) => id !== me);
      });
    }
  }
  try {
    const row = document.querySelector(`#ticket-list .ticket[data-id="${CSS.escape(eventId)}"]`);
    if (row && typeof applyTicketResponseClass === "function") applyTicketResponseClass(row, status);
  } catch {}
  try {
    document.querySelectorAll(".event-card-popup-rsvp [data-rsvp]").forEach(btn => {
      const on = btn.dataset.rsvp === status;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  } catch {}
  send({ type: "rsvp", eventId, status }, sendConn?.id);
  try { CardFeel.softConfirm(); } catch {}
  try { ashOnboardEmit("hand:action", { kind: "rsvp", eventId, status }); } catch {}
  return true;
}

function setMemberRsvp(eventId, userId, status) {
  if (!eventId || !userId || !["going", "signedUp", "out"].includes(status)) return false;
  const conn = (typeof ownerConnOf === "function" ? ownerConnOf(eventId) : null)
    || (typeof activeConn === "function" ? activeConn() : null);
  const ev = conn?.events?.find(e => e.id === eventId)
    || (typeof group === "function" ? group()?.events?.find(e => e.id === eventId) : null);
  if (!ev || typeof canEditEvent !== "function" || !canEditEvent(ev)) return false;
  const me = (typeof myIdOf === "function" ? myIdOf(ev) : null) || conn?.me?.id;
  if (me && userId === me) return false;
  ev.rsvps = { ...(ev.rsvps || {}), [userId]: status };
  if (ev.addedBy) delete ev.addedBy[userId];
  if (status === "out" && typeof eventSignupGroups === "function") {
    eventSignupGroups(ev).forEach((g) => {
      g.memberIds = (g.memberIds || []).filter((id) => id !== userId);
    });
  }
  const sendConn = (typeof ownerConnFor === "function" ? ownerConnFor(ev) : null) || conn;
  send({ type: "setMemberRsvp", eventId, userId, status }, sendConn?.id);
  try { CardFeel.softConfirm(); } catch {}
  if (typeof refreshEventAttendanceUI === "function") refreshEventAttendanceUI(ev);
  else if (typeof renderView === "function") renderView();
  return true;
}

function collapseTicketChoiceMenus() {
  document.querySelectorAll(".ticket-choice.is-expanded").forEach(el => {
    el.classList.remove("is-expanded");
    el.setAttribute("aria-expanded", "false");
    el.querySelector(".ticket-choice-menu")?.remove();
  });
}

let _ticketChoiceOutsideBound = false;
function ensureTicketChoiceOutsideClose() {
  if (_ticketChoiceOutsideBound) return;
  _ticketChoiceOutsideBound = true;
  document.addEventListener("pointerdown", (e) => {
    if (e.target.closest?.(".ticket-choice.is-expanded")) return;
    collapseTicketChoiceMenus();
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") collapseTicketChoiceMenus();
  });
}

function bindTicketChoiceToggle(choiceEl, ev) {
  if (!choiceEl || !ev || !eventAllowsRsvpToggle(ev)) return;
  ensureTicketChoiceOutsideClose();
  choiceEl.classList.add("ticket-choice-interactive");
  if (choiceEl.tagName !== "BUTTON") {
    choiceEl.setAttribute("role", "button");
    choiceEl.tabIndex = 0;
  }
  choiceEl.setAttribute("aria-haspopup", "true");
  choiceEl.setAttribute("aria-expanded", "false");
  const openMenu = (e) => {
    e.stopPropagation();
    e.preventDefault();
    const wasOpen = choiceEl.classList.contains("is-expanded");
    collapseTicketChoiceMenus();
    if (wasOpen) return;
    choiceEl.classList.add("is-expanded");
    choiceEl.setAttribute("aria-expanded", "true");
    const mine = ev.rsvps?.[myIdOf(ev)] || null;
    const menu = document.createElement("div");
    menu.className = "ticket-choice-menu";
    menu.setAttribute("role", "group");
    menu.setAttribute("aria-label", "Set reply");
    menu.innerHTML = rsvpToggleOptionsHTML(mine, { compact: true, ev });
    choiceEl.appendChild(menu);
    menu.querySelectorAll("[data-rsvp]").forEach(btn => {
      btn.addEventListener("pointerup", (ev2) => {
        ev2.stopPropagation();
        ev2.preventDefault();
        setEventRsvp(ev.id, btn.dataset.rsvp);
        collapseTicketChoiceMenus();
      });
    });
  };
  choiceEl.addEventListener("click", openMenu);
  choiceEl.addEventListener("pointerdown", (e) => e.stopPropagation());
  choiceEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") openMenu(e);
  });
}

function bindRsvpToggleRoot(root, eventId) {
  if (!root || !eventId) return;
  root.querySelectorAll("[data-rsvp]").forEach(btn => {
    const apply = (e) => {
      e.stopPropagation();
      e.preventDefault();
      setEventRsvp(eventId, btn.dataset.rsvp);
    };
    // pointerup is more reliable than click for retaps on Android WebView.
    btn.addEventListener("pointerup", apply);
  });
}

// A small glyph for an event, matched from its title back to the event-card set
// (a generic pin for freeform/custom titles). Shown just before the title.
function eventIcon(evOrTitle) {
  if (evOrTitle && typeof evOrTitle === "object") {
    const explicit = (evOrTitle.icon || "").trim();
    // blank / custom / pin = unset — fall through to card / type lookup
    if (explicit && explicit !== "custom" && explicit !== "pin") {
      return REMOVED_ICON_FALLBACK[explicit] || explicit;
    }
    if (typeof eventTypeForEvent === "function") {
      const t = eventTypeForEvent(evOrTitle);
      const ico = String(t?.icon || "").trim();
      if (ico && ico !== "custom" && ico !== "pin") {
        return REMOVED_ICON_FALLBACK[ico] || ico;
      }
    }
    evOrTitle = shownField(evOrTitle._title, evOrTitle.title);
  }
  const t = (evOrTitle || "").trim().toLowerCase();
  const ov = typeof cardIconOverride === "function" ? cardIconOverride(evOrTitle) : null;
  if (ov) return REMOVED_ICON_FALLBACK[ov] || ov;
  if (typeof eventTypeForTitleStr === "function") {
    const conn = typeof activeConn === "function" ? activeConn() : null;
    const schema = eventTypeForTitleStr(evOrTitle, conn);
    const ico = String(schema?.icon || "").trim();
    if (ico && ico !== "custom" && ico !== "pin") {
      return REMOVED_ICON_FALLBACK[ico] || ico;
    }
  }
  const c = EVENT_CARDS.find(c => !c.custom && c.label.toLowerCase() === t)
    || CUSTOM_CARDS.find(c => c.label.toLowerCase() === t && c.icon && c.icon !== "custom");
  return c ? c.icon : "pin";
}

function eventCardNoteKind(ev) {
  if (!ev) return "";
  const detailsPlain = String(typeof eventDetailsNotes === "function"
    ? eventDetailsNotes(ev)
    : ((typeof shown === "function" ? shown(ev._details || "") : ev._details) || "")).trim();
  if (detailsPlain) return "note";
  const hasSharedNote = typeof eventSharedNotes === "function"
    ? eventSharedNotes(ev).length > 0
    : !!(ev?.notes || []).some(n => !n.activity && (n.noteKind === "shared" || n.pinned));
  return hasSharedNote ? "pin" : "";
}

function eventCardNoteBadgeHTML(ev, { interactive = false } = {}) {
  const kind = eventCardNoteKind(ev);
  if (!kind) return "";
  const title = kind === "note" ? "Has description" : "Pinned message";
  const icoName = kind === "note" ? "note" : "pin";
  if (interactive) {
    const tab = kind === "note" ? "description" : "chat";
    return `<button type="button" class="ticket-stub-note" data-ed-open="note" data-ed-tab="${tab}" title="${esc(title)}" aria-label="Open event note">${ic(icoName)}</button>`;
  }
  return `<span class="ticket-stub-note" title="${esc(title)}" aria-label="${esc(title)}">${ic(icoName)}</span>`;
}

function eventCardLiveBadgeHTML(ev) {
  if (typeof shareForEvent !== "function" || typeof liveDotHTML !== "function") return "";
  const share = shareForEvent(ev);
  const html = liveDotHTML(share);
  return html ? `<span class="ticket-stub-live">${html}</span>` : "";
}

// A not-yet-posted event, rendered inline right where it'll end up once
// confirmed. Still a valid flick target for other cards (availability,
// reactions, responses — see playCardOnDraft()), so the whole thing can be
// composed before it's actually sent to the host.
// Event card sizes: stub 52×73 · building 92×129 · full 220×308 (340:476).
const EVENT_CARD_DEFAULT_ART = "images/event-card-default-art.svg";

function eventCardDefaultArtUrl() {
  try {
    if (typeof document !== "undefined" && document.baseURI) {
      return new URL(EVENT_CARD_DEFAULT_ART, document.baseURI).href;
    }
  } catch {}
  return EVENT_CARD_DEFAULT_ART;
}

function eventCardCoverUrl(ev, opts = {}) {
  if (opts.form === "simple") return "";
  if (opts.coverUrl) return String(opts.coverUrl);
  try {
    if (ev?.id && typeof getLocalMemoryPhoto === "function") {
      const local = getLocalMemoryPhoto(ev) || "";
      if (local) return local;
    }
  } catch {}
  return eventCardDefaultArtUrl();
}

function eventCardDayPart(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const wd = d.toLocaleDateString([], { weekday: "short" }).replace(/\.$/, "");
  const mon = d.toLocaleDateString([], { month: "short" }).replace(/\.$/, "");
  return `${wd} ${d.getDate()} ${mon}`;
}

function eventCardWhenPlain(ev, ts, slots, hasWhen, precision, timeInner) {
  if (slots.timeLabel) return String(slots.timeLabel);
  let clock = "";
  if (timeInner && typeof timeInner === "object") {
    clock = `${timeInner.start}–${timeInner.end}`;
  }
  if (!hasWhen || precision === "unconfirmed") return clock || "";
  const dayPart = eventCardDayPart(ts);
  if (precision === "day") return dayPart ? `${dayPart} · All day` : "All day";
  if (precision === "period" && ["morning", "afternoon", "evening"].includes(ev?.whenPeriod)) {
    const label = ev.whenPeriod === "morning" ? "Morning"
      : ev.whenPeriod === "afternoon" ? "Afternoon" : "Evening";
    return dayPart ? `${dayPart} · ${label}` : label;
  }
  if (precision === "partial-hour") {
    const d = new Date(ts);
    clock = clock || `${d.getHours()}:__`;
  }
  if (!clock && hasWhen) {
    const d = new Date(ts);
    const start = formatClockTime(d.getTime());
    clock = start;
    try {
      const endTs = typeof eventEndWhen === "function"
        ? eventEndWhen(ev)
        : (typeof durationToMs === "function" && typeof effectiveDuration === "function"
          ? Number(ts) + (durationToMs(effectiveDuration(ev)) || 3600e3)
          : null);
      if (endTs && Number.isFinite(endTs) && endTs > Number(ts)) {
        const ed = new Date(endTs);
        clock = `${start}–${formatClockTime(ed.getTime())}`;
      }
    } catch {}
  }
  if (clock && dayPart) return `${dayPart} · ${clock}`;
  return clock || dayPart || "";
}

function eventCardChannelTag(ev) {
  try {
    const conn = (typeof ownerConnFor === "function" ? ownerConnFor(ev) : null)
      || (typeof activeConn === "function" ? activeConn() : null);
    const ch = (conn?.channels || []).find(c => c.id === ev?.channelId);
    const name = String(ch?.name || "").trim();
    if (!name) return "";
    return "#" + name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toUpperCase();
  } catch { return ""; }
}

function eventCardGroupTag(ev) {
  try {
    const conn = (typeof ownerConnFor === "function" ? ownerConnFor(ev) : null)
      || (typeof activeConn === "function" ? activeConn() : null);
    const name = String(conn?.name || conn?.hostName || "").trim();
    return name ? name.toUpperCase() : "";
  } catch { return ""; }
}

function ticketBlockHTML(evLike, when, opts = {}) {
  const size = opts.size || "stub";
  const html = eventCardHTML(evLike, when, { ...opts, size });
  return typeof ticketCardNoteHostHTML === "function"
    ? ticketCardNoteHostHTML(evLike, html, size)
    : html;
}

/**
 * One event-card component — size "stub" | "building" | "full".
 * Building / full add title + place slots with empty/partial/filled states.
 */
const _eventCardHtmlCache = new Map();
function eventCardHTML(evLike, when, opts = {}) {
  const ev = evLike && typeof evLike === "object" ? evLike : null;
  const rsvp = ev?.rsvps
    ? Object.keys(ev.rsvps).sort().map((id) => id + "=" + ev.rsvps[id]).join(",")
    : "";
  const key = ev?.id && !opts.slots
    ? [ev.id, ev.updatedAt || 0, ev.when || "", ev.title || "", ev.where || "", ev.icon || "",
        ev.approvalStatus || "", rsvp, opts.size || "stub"].join("\u001f")
    : "";
  if (key && _eventCardHtmlCache.has(key)) return _eventCardHtmlCache.get(key);
  const html = renderEventCardHTML(evLike, when, opts);
  if (key) {
    if (_eventCardHtmlCache.size > 400) _eventCardHtmlCache.clear();
    _eventCardHtmlCache.set(key, html);
  }
  return html;
}

function renderEventCardHTML(evLike, when, opts = {}) {
  const size = opts.size === "full" ? "full"
    : opts.size === "building" ? "building"
    : "stub";
  const slots = opts.slots || {};
  const face = true;
  const ev = (evLike && typeof evLike === "object")
    ? evLike
    : { when, whenPrecision: null };
  const routineStyle = ev?.routineId
    ? String(ev.routineStyle || "rare-blue").replace(/[^a-z0-9-]/gi, "")
    : "";
  const routineClass = ev?.routineId
    ? `routine-origin routine-style-${routineStyle || "rare-blue"}`
    : "";
  const routineAttr = ev?.routineId
    ? ` data-routine-id="${esc(ev.routineId)}" data-routine-style="${esc(routineStyle || "rare-blue")}"`
    : "";
  // § approvals — faded/dashed treatment while awaiting an approver, or once declined.
  const isPending = ev?.approvalStatus === "pending";
  const isDeclined = ev?.approvalStatus === "blocked";
  // § pinned location channels — redacted stub for events whose home
  // channel the viewer can't see (server never sent title/where/details).
  if (ev?.limited && typeof limitedStubHTML === "function") {
    return limitedStubHTML(ev, { size });
  }
  const ts = when ?? ev.when;
  const hasWhen = ts != null && !Number.isNaN(Number(ts));
  const { accent, tint, label, period } = (typeof periodStyleFor === "function")
    ? periodStyleFor(ev, hasWhen ? ts : Date.now())
    : { accent: "var(--sage)", tint: "var(--bottle-2)", label: "Time", period: "tbd" };
  const d = new Date(hasWhen ? ts : Date.now());
  const dayTs = hasWhen
    ? ((typeof dayStart === "function") ? dayStart(ts) : ts)
    : null;
  const weekend = dayTs != null
    ? ((typeof isWeekendDay === "function") ? isWeekendDay(dayTs) : (d.getDay() === 0 || d.getDay() === 6))
    : false;
  const dayInk = (typeof dayInkFor === "function")
    ? dayInkFor(dayTs || Date.now(), { past: !!opts.past })
    : "#1a1d24";
  const precision = ev.whenPrecision || "";
  const typeIcon = (typeof eventIcon === "function") ? eventIcon(ev) : "custom";
  const hasType = slots.hasType != null
    ? !!slots.hasType
    : !!(ev.typeId || (ev.icon && ev.icon !== "custom") || (ev.title || ev._title));

  // Face cards omit the category gem badge (Figma detail layout). Stub never
  // showed one either — create-swipe still maps a logical gem pick onto art.
  const gemHtml = "";
  // 007 — borrowed-deck badge, bottom-left (squared tile).
  let borrowHtml = "";
  const borrowConnId = ev?.borrowSourceConnId || null;
  if (borrowConnId && typeof eventSourceConnIconHTML === "function") {
    const bConn = S.conns?.[borrowConnId];
    const bName = bConn ? (bConn.name || bConn.hostName || "Server") : "Server";
    borrowHtml = `<span class="ticket-borrow-badge" title="From ${esc(bName)}" aria-label="From ${esc(bName)}">${eventSourceConnIconHTML(borrowConnId)}</span>`;
  }

  let timeInner;
  let timeState = slots.timeState || null; // off | part | on
  let timeSplitHtml = null; // face: separate start/end chips
  if (slots.timeStart != null || slots.timeEnd != null) {
    timeSplitHtml = true;
    timeInner = {
      start: String(slots.timeStart || "TBD"),
      end: String(slots.timeEnd || "TBD"),
    };
    timeState = timeState || "part";
  } else if (slots.timeLabel) {
    timeInner = esc(slots.timeLabel);
    timeState = timeState || "part";
  } else if (!hasWhen || precision === "unconfirmed") {
    timeInner = face ? "time" : "TBC";
    timeState = timeState || (face ? "off" : "on");
  } else if (precision === "period" && ["morning", "afternoon", "evening"].includes(ev.whenPeriod)) {
    const short = ev.whenPeriod === "morning" ? "morn"
      : ev.whenPeriod === "afternoon" ? "aft"
      : "eve";
    timeInner = face
      ? esc(ev.whenPeriod === "morning" ? "Morning"
        : ev.whenPeriod === "afternoon" ? "Afternoon" : "Evening")
      : esc(short);
    timeState = timeState || "part";
  } else if (precision === "day") {
    timeInner = "All day";
    timeState = timeState || "on";
  } else if (precision === "partial-hour") {
    const hh = d.getHours();
    timeInner = `${hh}:__`;
    timeState = timeState || "part";
  } else {
    const hh = d.getHours();
    const mm = String(d.getMinutes()).padStart(2, "0");
    const clock = formatClockTime(d.getTime());
    // Building / full (event detail): separate start / end chips for editing.
    let endClock = "";
    if (face) {
      try {
        const endTs = typeof eventEndWhen === "function"
          ? eventEndWhen(ev)
          : (typeof durationToMs === "function" && typeof effectiveDuration === "function"
            ? Number(ts) + (durationToMs(effectiveDuration(ev)) || 3600e3)
            : null);
        if (endTs && Number.isFinite(endTs) && endTs > Number(ts)) {
          const ed = new Date(endTs);
          endClock = formatClockTime(ed.getTime());
        }
      } catch {}
    }
    if (face && endClock) {
      timeSplitHtml = true;
      timeInner = { start: clock, end: endClock };
    } else {
      timeInner = face && endClock ? `${clock}–${endClock}` : clock;
    }
    timeState = timeState || "on";
  }

  const titleRaw = slots.title !== undefined
    ? slots.title
    : (typeof eventTypeLabel === "function"
      ? eventTypeLabel(ev)
      : (typeof ev._title === "string" ? ev._title : (ev.title || "")));
  const titleText = titleRaw != null ? String(titleRaw).trim() : "";
  const titleOn = !!titleText;

  const subRaw = slots.subtitle !== undefined
    ? slots.subtitle
    : (typeof eventSubtitleText === "function"
      ? eventSubtitleText(ev)
      : (typeof ev._subtitle === "string" ? ev._subtitle : ""));
  const subtitleText = subRaw != null ? String(subRaw).trim() : "";
  const subtitleOn = !!subtitleText;
  const subtitlePlaceholder = !subtitleOn && slots.subtitlePlaceholder != null
    ? String(slots.subtitlePlaceholder).trim()
    : "";

  const whereRaw = slots.where !== undefined
    ? slots.where
    : (typeof ev._where === "string" ? ev._where : (ev.where || ""));
  const whereText = whereRaw != null ? String(whereRaw).trim() : "";
  const placeOn = whereText !== "";

  const dateRaw = slots.dateLabel !== undefined
    ? slots.dateLabel
    : (hasWhen && typeof cardDateCornerLabel === "function"
      ? cardDateCornerLabel(d)
      : (hasWhen && typeof WEEKDAYS !== "undefined"
        ? `${WEEKDAYS[d.getDay()]} ${d.getDate()}`
        : ""));
  const dateText = dateRaw != null ? String(dateRaw).trim() : "";
  const dateOn = !!dateText;

  // Building / full face: hero (art + type + date) → subtitle → footer (time + place).
  const artCls = hasType ? "on" : "off";
  const timeCls = timeState === "on" ? "on"
    : timeState === "suggest" ? "suggest"
    : timeState === "part" ? "part" : "off";
  const placeCls = placeOn
    ? (slots.placeSuggested ? "suggest" : "on")
    : "off";
  const sizeCls = size === "full" ? "ticket-full" : (size === "building" ? "ticket-building" : "ticket-stub");
  const pendingBanner = opts.omitPendingBanner ? ""
    : isPending
      ? `<div class="ticket-pending-badge" title="Awaiting approval">${ic("clock")} Pending approval</div>`
      : isDeclined
        ? `<div class="ticket-pending-badge" title="Declined">${ic("cancel")} Blocked</div>`
        : "";
  const preserveEmptySlots = opts.preserveEmptySlots != null
    ? !!opts.preserveEmptySlots
    : size !== "stub";
  const liveBadge = eventCardLiveBadgeHTML(ev);
  const hostGem = (opts.hostGem && typeof eventCardHostGemHTML === "function")
    ? eventCardHostGemHTML(ev)
    : "";
  const displayTitle = subtitleOn ? subtitleText : (titleOn ? titleText : "Untitled");
  const titleInSubtitle = !!opts.titleInSubtitleWhenEmpty && !subtitleOn;
  const editableTitle = !!opts.editableTitle;
  const titleValue = subtitleOn ? subtitleText : "";
  const titlePlaceholder = subtitlePlaceholder || "TITLE";
  const localPhoto = eventCardCoverUrl(ev, opts);
  const pictured = !!localPhoto;
  const mapHref = (size !== "stub" && typeof eventMapUrl === "function") ? eventMapUrl(ev) : "";
  const placeMapHtml = mapHref
    ? `<a class="event-card-map-link" href="${esc(mapHref)}" target="_blank" rel="noopener" data-event-map>Map</a>`
    : "";
  const whenPlain = eventCardWhenPlain(ev, ts, slots, hasWhen, precision, timeInner);
  const whoName = typeof eventOrganiserName === "function" ? (eventOrganiserName(ev) || "") : "";
  const channelTag = eventCardChannelTag(ev);
  const groupTag = eventCardGroupTag(ev);
  const preset = opts.eventCardPreset
    || ((ev?.id || ev?.routineId) && typeof eventCardPresetForEvent === "function"
      ? eventCardPresetForEvent(ev)
      : (typeof activeEventCardPreset === "function" ? activeEventCardPreset() : null));
  const treat = typeof eventCardTreatId === "function"
    ? eventCardTreatId(preset)
    : "light";
  const presetCss = preset && typeof eventCardStyleCssText === "function" ? eventCardStyleCssText(preset, ev) : "";
  const showTimeRow = !!(whenPlain || preserveEmptySlots);
  const showPlaceRow = !!(placeOn || preserveEmptySlots);
  const showWhoRow = pictured && !!whoName;
  const placeLabel = placeOn
    ? whereText
    : (slots.placePlaceholder !== undefined ? String(slots.placePlaceholder) : "Add place");
  const timeLabel = whenPlain || (preserveEmptySlots ? "Add time" : "");
  const timeRowHtml = preserveEmptySlots && timeSplitHtml && timeInner && typeof timeInner === "object"
    ? `<div class="ticket-build-time-row">
      <div class="ticket-build-line ticket-build-time ticket-build-start ${timeCls}${slots.timePlaceholder ? " has-placeholder" : ""}" data-slot="start" title="Start time">${esc(timeInner.start)}</div>
      <span class="ticket-build-time-sep" aria-hidden="true">–</span>
      <div class="ticket-build-line ticket-build-time ticket-build-end ${timeCls}${slots.timePlaceholder ? " has-placeholder" : ""}" data-slot="end" title="End time">${esc(timeInner.end)}</div>
    </div>`
    : `<div class="ticket-build-line ticket-build-time ${timeCls}${slots.timePlaceholder || (!whenPlain && preserveEmptySlots) ? " has-placeholder" : ""}">${esc(timeLabel)}</div>`;
  const timeRowAttrs = !(preserveEmptySlots && timeSplitHtml)
    ? ` data-slot="time" title="Edit time" aria-label="Edit time"`
    : "";
  const titleSlot = subtitleOn || titleInSubtitle || editableTitle ? "subtitle" : "title";
  const titleHtml = editableTitle
    ? `<input type="text" class="cs-card-title-input event-card-title" id="cs-card-title-input" maxlength="80" placeholder="${esc(titlePlaceholder)}" value="${esc(titleValue)}" autocomplete="off" enterkeyhint="done" aria-label="Event title" />`
    : `<div class="event-card-title" data-slot="${titleSlot}" title="${titleSlot === "subtitle" ? "Edit title" : "Edit event type"}">${esc(displayTitle)}</div>`;
  const subtitleSlot = (editableTitle || titleInSubtitle)
    ? ` data-slot="subtitle" title="${titleInSubtitle ? "Add title" : "Edit title"}" aria-label="${titleInSubtitle ? "Add title" : "Edit title"}"`
    : "";
  const typeIconHtml = `<div class="event-card-type-icon ${artCls}" data-slot="art" aria-hidden="${hasType ? "false" : "true"}">${ic(typeIcon)}</div>`;
  const artHtml = pictured
    ? `<div class="event-card-art"><img class="event-card-image" src="${esc(localPhoto)}" alt=""></div>`
    : "";
  const whoHtml = showWhoRow
    ? `<div class="event-card-detail-row event-card-who-row">${ic("user", "ico-inline")}<div class="ticket-build-line">${esc(whoName)}</div></div>`
    : "";
  const footHtml = pictured && (channelTag || groupTag)
    ? `<div class="event-card-foot">${channelTag ? `<span class="event-card-channel">${esc(channelTag)}</span>` : "<span></span>"}${groupTag ? `<span class="event-card-group">${esc(groupTag)}</span>` : ""}</div>`
    : "";
  const formCls = pictured ? "event-card-pictured" : "event-card-simple";
  const treatCls = `event-card-treat-${treat}`;
  const sizeExtra = size === "stub" ? "ticket-block" : "";
  const faceCls = [
    "ticket-card",
    "event-card-template",
    sizeCls,
    sizeExtra,
    formCls,
    treatCls,
    `period-${esc(period)}`,
    weekend ? "is-weekend" : "is-weekday",
    (isPending || isDeclined) ? "ticket-pending" : "",
    routineClass,
    opts.hideDate ? "hide-date" : "",
  ].filter(Boolean).join(" ");
  return `<div class="${faceCls}" data-size="${size}" data-card-form="${pictured ? "pictured" : "simple"}" data-card-treat="${esc(treat)}"${routineAttr} style="--accent:${accent};--tint:${tint};--day-ink:${dayInk};${presetCss}" title="${esc(label)}">
    ${pendingBanner}
    ${borrowHtml}
    ${liveBadge}
    ${hostGem}
    ${artHtml}
    <div class="event-card-box"${subtitleSlot}>
      ${typeIconHtml}
      ${titleHtml}
      <div class="event-card-meta">
        ${showTimeRow ? `<div class="event-card-detail-row event-card-time-row"${timeRowAttrs}>${ic("clock", "ico-inline")}${timeRowHtml}</div>` : ""}
        ${showPlaceRow ? `<div class="event-card-detail-row event-card-place-row" data-slot="place" title="Edit location" aria-label="Edit location">${ic("pin", "ico-inline")}<div class="ticket-build-line ticket-build-place ${placeCls}${!placeOn && slots.placePlaceholder ? " has-placeholder" : ""}">${esc(placeLabel)}</div>${placeMapHtml}</div>` : ""}
        ${whoHtml}
      </div>
      ${footHtml}
    </div>
  </div>`;
}


function ticketMetaHTML(evLike, whereText) {
  if (!whereText) return "";
  return `<div class="ticket-meta"><span class="ticket-meta-place">${esc(whereText)}</span></div>`;
}

/** Emphasized memorable note — not the generic where/title. */
function ticketStickerHTML(evLike) {
  let text = typeof evLike._sticker === "string" ? evLike._sticker.trim() : "";
  if (!text && typeof evLike.sticker === "string" && !evLike.sticker.startsWith("e2e:")) {
    text = evLike.sticker.trim();
  }
  const shared = !!text;
  // No shared sticker → fall back to this device's personal note.
  if (!text && evLike?.id && typeof getLocalSticker === "function") {
    text = getLocalSticker(evLike.id);
  }
  if (!text) return "";
  // Color alone marks personal (custom) vs shared — no poster avatar.
  const personal = !shared;
  const cls = personal ? "ticket-sticker ticket-sticker-personal" : "ticket-sticker";
  const title = personal ? "Personal sticker (this device only)" : "Sticker";
  return `<div class="${cls}" title="${esc(title)}">${ic("custom", "ico-inline")}<span>${esc(text)}</span></div>`;
}

/** Live suggestions on an event (001/010), excluding expired. */
function eventSuggestions(ev) {
  const list = Array.isArray(ev?.suggestions) ? ev.suggestions : [];
  if (!list.length) return [];
  const today = dayStart(Date.now());
  return list.filter(s => s && s.when != null && Number(s.when) >= today);
}


/** 014 — field edits that make an agenda row unread (not RSVP / people / suggestions). */
const EVENT_CHANGE_ACTIVITIES = new Set(["time", "where", "duration", "sticker", "icon"]);

/** True when a note should drive the row unread dot for someone other than me. */
function noteMarksEventUnread(note, meId) {
  if (!note) return false;
  if (meId && note.userId === meId) return false;
  if (note.noteKind === "personal") return false; // sealed; never news for others
  const act = note.activity || "";
  if (!act) return true; // freeform event chat or shared note
  return EVENT_CHANGE_ACTIVITIES.has(act);
}

/** 014 — trailing-edge unread: unseen change or chat note from someone else. */
function isEventRowUnread(ev) {
  if (!ev?.id) return false;
  const conn = (typeof ownerConnFor === "function" ? ownerConnFor(ev) : null)
    || (typeof ownerConnOf === "function" ? ownerConnOf(ev.id) : null)
    || (typeof activeConn === "function" ? activeConn() : null);
  if (!conn?.id) return false;
  const seenTs = typeof getEventSeenTs === "function" ? getEventSeenTs(conn.id, ev.id) : 0;
  if (!seenTs) return false; // unseeded → treat as read until seed runs
  const meId = typeof myIdOf === "function" ? myIdOf(ev) : conn.me?.id;
  for (const n of ev.notes || []) {
    if ((n.ts || 0) <= seenTs) continue;
    if (noteMarksEventUnread(n, meId)) return true;
  }
  // 021 — dependency warn on a linked follow-on is also unread news.
  if (ev.chainDepWarnWhen && Number(ev.chainDepWarnWhen) > seenTs) return true;
  return false;
}

function suggestionStackBodyLine(_ev) {
  // Stack + badge already signals alternatives on the timeline — no body CTA.
  return "";
}

/** Note mark as last child of the card face so absolute coords are vs the card
 *  box (a wrapping host with fit-content was expanding around the overhang and
 *  doubling the corner offset on Android WebView). */
function ticketCardNoteHostHTML(ev, cardHtml, size = "stub", opts = {}) {
  if (!cardHtml || opts.omitNote || size === "stub") return cardHtml;
  const html = String(cardHtml);
  if (html.includes("ticket-stub-note")) return cardHtml;
  const note = eventCardNoteBadgeHTML(ev, {
    interactive: size === "building" || size === "full",
  });
  if (!note) return cardHtml;
  const i = html.lastIndexOf("</div>");
  if (i < 0) return html + note;
  return html.slice(0, i) + note + html.slice(i);
}


/** Wrap card HTML in peeking stack when alternatives exist (001 mock). */
function ticketCardStackHTML(ev, cardHtml, size = "stub", opts = {}) {
  const hosted = ticketCardNoteHostHTML(ev, cardHtml, size, opts);
  const list = eventSuggestions(ev);
  if (!list.length) return hosted;
  const n = list.length;
  const peeks = Math.min(5, n);
  let under = "";
  for (let i = peeks; i >= 1; i--) {
    under += `<div class="ticket-stub-under" style="--peek:${i}" aria-hidden="true"></div>`;
  }
  const sizeCls = size === "building" || size === "full" ? " ticket-card-stack-building" : "";
  return `<div class="ticket-stub-holder${sizeCls}" data-alt-count="${n}" style="--alt-count:${n}" title="${n} alternative${n === 1 ? "" : "s"}">
    ${under}
    ${hosted}
    <span class="ticket-stub-badge">+${n}</span>
  </div>`;
}

/** Wrap stub HTML in peeking stack when alternatives exist (001 mock). */
function ticketStubStackHTML(ev, stubHtml) {
  return ticketCardStackHTML(ev, stubHtml, "stub");
}

// Minimal preview: stub + two-line body (024 / 028). Full RSVP / chat on detail.
// Response state is card physics on the stub (026), reinforced by text tags.
function ticketResponseState(ev, rsvp) {
  if (ev?.approvalStatus === "pending") {
    return {
      title: "NEEDS APPROVAL",
      cls: " needs-approval",
      suppressUnanswered: true,
      forceTextTag: true,
    };
  }
  if (ev?.approvalStatus === "blocked") {
    return {
      title: "Blocked",
      cls: " on-blocked",
      suppressUnanswered: true,
      forceTextTag: true,
    };
  }
  const organiser = isEventOrganiser(ev);
  const unanswered = !rsvp && !organiser;
  const title = rsvp === "going"
    ? (typeof eventRsvpStatusLabel === "function" ? eventRsvpStatusLabel("going", ev) : "Going")
    : rsvp === "signedUp"
      ? (typeof eventRsvpStatusLabel === "function" ? eventRsvpStatusLabel("signedUp", ev) : "Signed up")
    : rsvp === "out"
      ? (typeof eventConfirmAttendance === "function" && eventConfirmAttendance(ev) ? "Declined" : "Can't go")
    : (organiser ? "Organising" : "Not answered");
  const cls = rsvp ? ` on-${rsvp}` : (organiser ? " on-host" : " needs-reply");
  return { title, cls, suppressUnanswered: false, unanswered, forceTextTag: false };
}

function ticket(ev, g, isPast, showChannelPill, opts = {}) {
  const el = document.createElement("article");
  const mine = ev.rsvps[myIdOf(ev)];
  const resp = ticketResponseState(ev, mine);
  const unanswered = resp.unanswered ?? false;
  el.className = "ticket"
    + (isPast ? " past" : "")
    + (mine === "out" ? " declined" : "")
    + (mine === "signedUp" ? " signed-up" : "")
    + (resp.suppressUnanswered ? "" : (unanswered ? " unanswered" : ""))
    + (ev.approvalStatus === "pending" ? " ticket-needs-approval" : "")
    + (eventSuggestions(ev).length ? " has-alts" : "")
    + (isEventRowUnread(ev) ? " ticket-unread" : "")
    + (ev._pending ? " pending-sync" : "")
    + (opts.dayTimeline ? " day-tl-mini" : "")
    + (ev.routineId ? ` routine-origin routine-style-${String(ev.routineStyle || "rare-blue").replace(/[^a-z0-9-]/gi, "")}` : "");
  el.dataset.id = ev.id;
  el.dataset.focusKey = "ev:" + ev.id;
  el.dataset.when = String(ev.when);
  el.dataset.day = String(dayStart(ev.when));
  if (ev.routineId) {
    el.dataset.routineId = ev.routineId;
    el.dataset.routineStyle = ev.routineStyle || "rare-blue";
  }
  {
    const { accent, tint } = periodStyleFor(ev, ev.when);
    el.style.setProperty("--accent", accent);
    el.style.setProperty("--tint", tint);
    const dayInk = (typeof dayInkFor === "function")
      ? dayInkFor(ev.when, { past: isPast })
      : null;
    if (dayInk) el.style.setProperty("--day-ink", dayInk);
  }

  const choiceTitle = resp.title;
  const choiceCls = resp.cls;
  // Pending / declined: text tags (026). Going / maybe: compact icon badges.
  const choiceInner = resp.forceTextTag
    ? `<span class="ticket-choice-tag">${esc(choiceTitle)}</span>`
    : (mine === "out" || unanswered)
      ? `<span class="ticket-choice-tag">${esc(choiceTitle)}</span>`
      : (mine ? RSVP_BADGE[mine]
        : (isEventOrganiser(ev) ? `<span class="ticket-choice-tag">${esc(choiceTitle)}</span>` : RSVP_NEEDS_REPLY_BADGE));
  const titleLabel = typeof eventTypeLabel === "function" ? eventTypeLabel(ev) : eventDisplayTitle(ev);
  const subtitleLabel = typeof eventSubtitleText === "function" ? eventSubtitleText(ev) : "";

  // Day zoom timed canvas — floating start row + vertical duration bar.
  if (opts.dayTimeline) {
    const typeIcon = eventIcon(ev);
    // Compact badge: icon for going/maybe/out (never the truncated "Can't" tag).
    const dayChoiceInner = resp.forceTextTag
      ? `<span class="ticket-choice-tag">${esc(choiceTitle)}</span>`
      : mine === "out"
        ? RSVP_BADGE.out
        : unanswered
          ? RSVP_NEEDS_REPLY_BADGE
          : (mine ? RSVP_BADGE[mine]
            : (isEventOrganiser(ev) ? `<span class="ticket-choice-tag">${esc(choiceTitle)}</span>` : RSVP_NEEDS_REPLY_BADGE));
    // Compact chain: plain titles under the event name (no chip strip).
    const parentPast = ev.when != null && ev.when < Date.now() - 3 * 3600e3;
    const chainLinks = (opts.chainLinks
      || (g?.events || []).filter(e => e.chainOf === ev.id)
        .sort((a, b) => (a.when || 0) - (b.when || 0)))
      .filter(e => !parentPast || chainStatusOf(e) === "linked");
    const chainHtml = chainLinks.length
      ? `<div class="day-tl-chain">${chainLinks.map(link =>
          `<button type="button" class="day-tl-chain-item" data-id="${esc(link.id)}"><span class="day-tl-chain-ar" aria-hidden="true">→</span>${esc(eventDisplayTitle(link) || "Next")}</button>`
        ).join("")}</div>`
      : "";
    const canToggleRsvp = eventAllowsRsvpToggle(ev);
    const choiceTag = canToggleRsvp ? "button" : "span";
    const choiceAttrs = canToggleRsvp
      ? ` type="button" class="ticket-choice day-tl-response ticket-choice-interactive${choiceCls}" title="${esc(choiceTitle)}" aria-label="${esc(choiceTitle)}" aria-haspopup="true" aria-expanded="false"`
      : ` class="ticket-choice day-tl-response${choiceCls}" title="${esc(choiceTitle)}"`;
    el.innerHTML = `
      <div class="day-tl-rail">
        <div class="day-tl-ico-wrap">
          <div class="day-tl-ico" aria-hidden="true">${ic(typeIcon)}</div>
          <${choiceTag}${choiceAttrs}>${dayChoiceInner}</${choiceTag}>
        </div>
        <div class="day-tl-bar" aria-hidden="true"></div>
      </div>
      <div class="day-tl-head">
        <span class="day-tl-title">${esc(titleLabel)}</span>
        ${chainHtml}
      </div>`;
    el.querySelectorAll(".day-tl-chain-item").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (!id) return;
        if (typeof openEventDetail === "function") openEventDetail(id, btn);
        else { Nav.openEventDetail(id); renderView(); }
      });
    });
    bindTicketChoiceToggle(el.querySelector(".ticket-choice"), ev);
    return el;
  }

  const peopleHTML = eventPeopleSummaryHTML(ev, 6, {
    includeHost: true,
    hostAfterAttendees: true,
    recentReactionOnly: true,
    chatUnreadOnly: true,
  });
  // Foreign / linked sources only — drop the routine same-board channel pill (028).
  let chName = null;
  if (ev._linked && ev._linkedChannelName) {
    const where = ev._connId && ev._connId !== S.activeConnId
      ? `${eventSourceConnIconHTML(ev._connId)} ${esc(ev._serverName || "Server")} · `
      : "";
    chName = `${ic("share", "ico-inline")} ${where}${ic("ticket", "ico-inline event-outline-icon")} ${esc(ev._linkedChannelName)}${ev._offline ? " · offline" : ""}`;
  } else if (ev._connId && ev._connId !== "personal" && (S.activeConnId === "personal" || ev._connId !== S.activeConnId)) {
    chName = `${eventSourceConnIconHTML(ev._connId)} ${esc(ev._serverName)}${ev._offline ? " · offline" : ""}`;
  }
  void showChannelPill; // retained for call-site compatibility

  const whereHtml = ticketMetaHTML(ev, ev.where ? shown(ev._where) : "");
  const subtitleHtml = subtitleLabel
    ? `<div class="ticket-subtitle">${esc(subtitleLabel)}</div>`
    : "";
  const whoHtml = peopleHTML ? `<div class="ticket-people">${peopleHTML}</div>` : "";
  const textBlock = `<div class="ticket-text">
      <h5><span class="ticket-title-text">${esc(titleLabel)}</span>${ticketStickerHTML(ev)}${ev._pending ? `<span class="pending-sync-chip">Pending</span>` : ""}</h5>
      ${subtitleHtml}
      ${whereHtml}
    </div>`;
  const altsLine = suggestionStackBodyLine(ev);
  const stub = ticketStubStackHTML(ev, ticketBlockHTML(ev, ev.when, { ...opts, past: isPast }));

  const canToggleRsvp = eventAllowsRsvpToggle(ev);
  const choiceTag = canToggleRsvp ? "button" : "span";
  const choiceAttrs = canToggleRsvp
    ? ` type="button" class="ticket-choice ticket-choice-interactive${choiceCls}" title="${esc(choiceTitle)}" aria-label="${esc(choiceTitle)}" aria-haspopup="true" aria-expanded="false"`
    : ` class="ticket-choice${choiceCls}" title="${esc(choiceTitle)}"`;
  el.innerHTML = `
    ${stub}
    <div class="ticket-body">
      <div class="ticket-top">
        ${textBlock}
        <${choiceTag}${choiceAttrs}>${choiceInner}</${choiceTag}>
      </div>
      ${chName ? `<div class="ticket-chan">${chName}</div>` : ""}
      ${whoHtml}
      ${altsLine}
    </div>`;

  if (opts.inDayCluster) el.classList.add("in-day-cluster");

  // Taps are handled by attachTimelineGestures: tap opens; in Day view,
  // press-hold then drag onto an hour to reschedule.
  // Stack badge opens the event sheet.
  el.querySelector(".ticket-stub-badge")?.addEventListener("click", (e) => {
    e.stopPropagation();
    Nav.openEventDetail(ev.id);
  });
  el.querySelector(".ticket-alts")?.addEventListener("click", (e) => {
    e.stopPropagation();
    Nav.openEventDetail(ev.id);
  });
  bindTicketChoiceToggle(el.querySelector(".ticket-choice"), ev);
  return el;
}

/** 026 — flip agenda ticket response classes in place so the stub can spring. */
function applyTicketResponseClass(el, rsvp) {
  if (!el) return;
  const id = el.dataset?.id;
  const ev = id ? (group()?.events?.find(e => e.id === id) || null) : null;
  const resp = ticketResponseState(ev, rsvp);
  const organiser = ev ? isEventOrganiser(ev) : false;
  const unanswered = resp.unanswered ?? false;
  el.classList.toggle("unanswered", !resp.suppressUnanswered && unanswered);
  el.classList.toggle("ticket-needs-approval", ev?.approvalStatus === "pending");
  el.classList.toggle("signed-up", rsvp === "signedUp");
  el.classList.toggle("declined", rsvp === "out");
  const choice = el.querySelector(".ticket-choice");
  if (!choice) return;
  const title = resp.title;
  const dayMini = el.classList.contains("day-tl-mini");
  const interactive = choice.classList.contains("ticket-choice-interactive");
  choice.className = "ticket-choice"
    + (dayMini ? " day-tl-response" : "")
    + (interactive ? " ticket-choice-interactive" : "")
    + resp.cls;
  choice.title = title;
  // Day mini: always icon badges (out = red X). Agenda keeps text tags for out/unanswered.
  if (dayMini) {
    if (resp.forceTextTag) {
      choice.innerHTML = `<span class="ticket-choice-tag">${esc(title)}</span>`;
    } else if (rsvp === "out") choice.innerHTML = RSVP_BADGE.out;
    else if (unanswered) choice.innerHTML = RSVP_NEEDS_REPLY_BADGE;
    else if (!rsvp && organiser) choice.innerHTML = `<span class="ticket-choice-tag">${esc(title)}</span>`;
    else choice.innerHTML = RSVP_BADGE[rsvp] || "";
    return;
  }
  if (resp.forceTextTag || rsvp === "out" || unanswered || (!rsvp && organiser)) {
    choice.innerHTML = `<span class="ticket-choice-tag">${esc(title)}</span>`;
  } else {
    choice.innerHTML = RSVP_BADGE[rsvp] || "";
  }
}

// ─── 021 · Event chain strip ───────────────────────────────────────────────

/** proposal (dashed) vs linked (solid). Legacy null → proposal. */

/**
 * Face-down stub for events whose home channel the viewer can't see (§ pinned
 * location / pinned people channels). The server sends only
 * `{id, when, duration, locationLabelId, rsvpCount, limited:true, createdBy,
 * createdByName, sourceChannelName}`, so title/details stay hidden but occupancy
 * can still name the organiser and source board. Moved here from shell/sealed-ui.js
 * when sealed cards were archived.
 * @param {object} ev limited event stub (`ev._limited` truthy)
 * @param {{ size?: string }} opts
 */
function limitedStubHTML(ev, opts = {}) {
  const size = opts.size === "full" ? "full"
    : opts.size === "building" ? "building"
    : "stub";
  const goingCount = Number(ev?.rsvpCount) || 0;
  const goingLabel = `${goingCount} going`;
  const hint = `Reserved · ${goingLabel}`;
  if (size === "stub") {
    return `<div class="ticket-card ticket-stub ticket-block ticket-limited-stub" data-size="stub" title="${esc(hint)}">
      <div class="ticket-stub-art" aria-hidden="true">${typeof ic === "function" ? ic("lock") : ""}</div>
      <span class="ticket-stub-time">${esc(goingLabel)}</span>
    </div>`;
  }
  const sizeCls = size === "full" ? "ticket-full" : "ticket-building";
  return `<div class="ticket-card ${sizeCls} ticket-limited-stub" data-size="${size}" title="${esc(hint)}">
    <div class="ticket-stub-art on" aria-hidden="true">${typeof ic === "function" ? ic("lock") : ""}</div>
    <div class="ticket-build-title on">RESERVED</div>
    <div class="ticket-build-date off">Booked</div>
    <div class="ticket-build-line ticket-build-place on">${esc(goingLabel)}</div>
  </div>`;
}
