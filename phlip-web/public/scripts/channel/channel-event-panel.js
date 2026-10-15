/* channel-event-panel.js — Event facts, place editor, sign-ups and details for All chat filters and the Timeline sheet.
 *
 * Globals in:  shared board/chat state (S, Nav, activeConn)
 * Globals out: conversationEventPanelHTML, conversationWhenLabel, conversationFindEvent, conversationFeedScopeHTML, openEventRsvpMenu
 * Load after:  channel-board-nav.js
 * Load before: board-feed.js
 *
 * Must not: ES modules, bundlers, unrelated feature work
 */

function conversationDayStart(ts) {
  if (typeof dayStart === "function") return dayStart(ts);
  if (typeof timelineDay === "function") return timelineDay(ts);
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function conversationEventOwner(ev) {
  if (typeof timelineEventOwner === "function") return timelineEventOwner(ev);
  if (typeof ownerConnFor === "function") return ownerConnFor(ev);
  return typeof activeConn === "function" ? activeConn() : null;
}

function conversationPreviewText(m) {
  if (!m) return "";
  const raw = typeof shownField === "function"
    ? shownField(m._text, m.text)
    : typeof shown === "function"
      ? shown(m._text || m.text || "")
      : (m._text || m.text || "");
  return String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
}

function conversationAuthorLabel(m, conn) {
  if (!m) return "";
  const meId = conn?.me?.id;
  if (meId && m.userId === meId) return "You";
  return String(m.name || "").trim();
}

function conversationPreviewLine(m, conn) {
  const text = conversationPreviewText(m);
  if (!text) return "";
  const who = conversationAuthorLabel(m, conn);
  return who ? `${who}: ${text}` : text;
}

function conversationLastMessage(messages) {
  if (!messages || !messages.length) return null;
  let last = null;
  for (const m of messages) {
    if (!m || m.activity || m._eventLinkMarker) continue;
    if (!last || (m.ts || 0) >= (last.ts || 0)) last = m;
  }
  return last;
}

function conversationEventOriginTitle(ev, fallback) {
  return (ev && typeof eventDisplayTitle === "function" && eventDisplayTitle(ev))
    || ev?._title || ev?.title || fallback || "Event";
}

function conversationIsGeneralFeedMessage(m) {
  if (!m || m.activity || m._eventLinkMarker) return false;
  if (m._fromEventChannel || m._fromEventNote) return false;
  if (m.id && String(m.id).startsWith("note-")) return false;
  if (typeof messageMentionedEventIds === "function" && messageMentionedEventIds(m).length) return false;
  if (m.eventId) return false;
  return true;
}

function conversationMovedMessagesForEvent(messages, eventId) {
  if (!eventId) return [];
  const out = [];
  for (const m of messages || []) {
    if (!m || m.activity || m._eventLinkMarker) continue;
    if (m._fromEventChannel || m._fromEventNote) continue;
    if (m.id && String(m.id).startsWith("note-")) continue;
    const ids = typeof messageMentionedEventIds === "function"
      ? messageMentionedEventIds(m)
      : (m.eventId ? [m.eventId] : []);
    if (!ids.includes(eventId)) continue;
    out.push(m);
  }
  out.sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
  return out;
}

function conversationEventMoveMarkers(messages, events) {
  const byEvent = new Map();
  for (const m of messages || []) {
    if (!m || m.activity || m._eventLinkMarker) continue;
    if (m._fromEventChannel || m._fromEventNote) continue;
    if (m.id && String(m.id).startsWith("note-")) continue;
    const ids = typeof messageMentionedEventIds === "function"
      ? messageMentionedEventIds(m)
      : (m.eventId ? [m.eventId] : []);
    const eventId = ids[0];
    if (!eventId) continue;
    const list = byEvent.get(eventId) || [];
    list.push(m);
    byEvent.set(eventId, list);
  }
  const markers = [];
  for (const [eventId, moved] of byEvent) {
    moved.sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
    const first = moved[0];
    const ev = (events || []).find((e) => e && e.id === eventId) || null;
    const leftovers = typeof conversationMoveRelatedLeftovers === "function"
      ? conversationMoveRelatedLeftovers(messages, eventId)
      : [];
    markers.push({
      id: `moved:${eventId}`,
      ts: first?.ts || 0,
      eventId,
      mentionedEventIds: [eventId],
      _eventLinkMarker: true,
      _eventTitle: ev?._title || ev?.title || first?._eventTitle || "",
      _relatedLeftoverCount: leftovers.length,
      _movedMessages: moved,
    });
  }
  return markers;
}

function conversationMoveRelatedLeftovers(messages, eventId) {
  if (!eventId || typeof chatMoveRelatedIds !== "function") return [];
  const leftover = new Set();
  for (const m of messages || []) {
    if (!m?.id || m.activity || m._eventLinkMarker) continue;
    const ids = typeof messageMentionedEventIds === "function"
      ? messageMentionedEventIds(m)
      : (m.eventId ? [m.eventId] : []);
    if (!ids.includes(eventId)) continue;
    for (const id of chatMoveRelatedIds(messages, m.id)) {
      if (id === m.id) continue;
      leftover.add(id);
    }
  }
  return [...leftover];
}

function isChatMoveMarkerExpanded(eventId) {
  return !!(eventId && typeof S !== "undefined" && S.chatMoveMarkerExpanded?.[eventId]);
}

function applyChatMoveMarkerExpanded(root, open) {
  if (!root) return;
  root.classList.toggle("is-open", !!open);
  const details = root.querySelector(".chat-event-move-details");
  if (details) details.hidden = !open;
  const btn = root.querySelector("[data-move-expand]");
  if (btn) {
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.setAttribute("aria-label", open ? "Hide moved messages" : "Show moved messages");
  }
}

function toggleChatMoveMarkerExpanded(eventId, rootEl) {
  if (!eventId || typeof S === "undefined") return false;
  const next = { ...(S.chatMoveMarkerExpanded || {}) };
  const open = !next[eventId];
  if (open) next[eventId] = true;
  else delete next[eventId];
  S.chatMoveMarkerExpanded = next;
  applyChatMoveMarkerExpanded(rootEl, open);
  return open;
}

function conversationMovedMessageText(m) {
  if (!m) return "";
  const raw = typeof shownField === "function"
    ? shownField(m._text, m.text)
    : typeof shown === "function"
      ? shown(m._text || m.text || "")
      : (m._text || m.text || "");
  return String(raw == null ? "" : raw).trim();
}

function conversationMovedMessageLineHTML(m, conn) {
  const who = conversationAuthorLabel(m, conn) || String(m?.name || "").trim() || "Someone";
  const text = conversationMovedMessageText(m) || (m?.taskId ? "Task" : "");
  if (!text) return "";
  const when = (m?.ts && typeof fmtTime === "function") ? fmtTime(m.ts) : "";
  return `<div class="chat-event-move-msg">
    <span class="chat-event-move-msg-meta">${esc(who)}${when ? `<time>${esc(when)}</time>` : ""}</span>
    <span class="chat-event-move-msg-text">${esc(text)}</span>
  </div>`;
}

function conversationEventMoveMarkerHTML(ev, eventId, titleFallback, {
  leftoverCount = 0, movedMessages = [], conn = null,
} = {}) {
  const id = eventId || ev?.id;
  if (!id) return "";
  const title = conversationEventOriginTitle(ev, titleFallback);
  const date = typeof conversationEventNumericDate === "function"
    ? conversationEventNumericDate(ev)
    : "";
  const iconName = (ev && typeof eventIcon === "function") ? eventIcon(ev) : "calendar";
  const ico = typeof ic === "function" ? ic(iconName, "ico-inline") : "";
  const place = (typeof timelineEventPlace === "function" && ev)
    ? timelineEventPlace(ev)
    : (ev?._where || ev?.where || "");
  const time = (ev && typeof timelineTimeLabel === "function") ? timelineTimeLabel(ev, false) : "";
  const preview = [time, place].filter(Boolean).join(" · ");
  const moved = Array.isArray(movedMessages) ? movedMessages : [];
  const movedHTML = moved.map((m) => conversationMovedMessageLineHTML(m, conn)).filter(Boolean).join("");
  const leftover = leftoverCount > 0
    ? `<button type="button" class="chat-event-move-related" data-move-related="${esc(id)}">Move related messages</button>`
    : "";
  const hasDetails = !!(preview || leftover || movedHTML);
  const expanded = hasDetails && isChatMoveMarkerExpanded(id);
  const toggle = hasDetails
    ? `<button type="button" class="chat-event-move-toggle" data-move-expand="${esc(id)}" aria-expanded="${expanded ? "true" : "false"}" aria-label="${expanded ? "Hide moved messages" : "Show moved messages"}">${typeof ic === "function" ? ic("chevron-down") : "▾"}</button>`
    : "";
  const details = hasDetails
    ? `<div class="chat-event-move-details"${expanded ? "" : " hidden"}>
        ${preview ? `<span class="chat-event-move-preview">${esc(preview)}</span>` : ""}
        ${movedHTML ? `<div class="chat-event-move-msgs">${movedHTML}</div>` : ""}
        ${leftover}
      </div>`
    : "";
  return `<div class="chat-event-move${expanded ? " is-open" : ""}" data-chat-key="moved:${esc(id)}" data-move-event="${esc(id)}">
    <span class="chat-event-move-kicker">Moved to</span>
    <div class="chat-event-move-head">
      <button type="button" class="chat-event-move-main" data-conv-open="${esc(id)}" aria-label="${esc(`Open ${title}`)}">
        <span class="chat-event-move-ico" aria-hidden="true">${ico}</span>
        <span class="chat-event-move-title">
          <span class="chat-event-move-name">${esc(title)}</span>${date
            ? `<span class="chat-event-move-sep" aria-hidden="true"> – </span><span class="chat-event-move-date">${esc(date)}</span>`
            : ""}
        </span>
      </button>
      ${toggle}
    </div>
    ${details}
  </div>`;
}

function conversationEventOriginHintHTML(ev, eventId, titleFallback) {
  const id = eventId || ev?.id;
  if (!id) return "";
  const title = conversationEventOriginTitle(ev, titleFallback);
  const ico = typeof ic === "function" ? ic("corner-down-right", "ico-inline") : "↳";
  const chev = typeof ic === "function" ? ic("chevron-right", "ico-inline") : "›";
  return `<button type="button" class="chat-event-origin-hint" data-conv-open="${esc(id)}" aria-label="${esc(`Open ${title}`)}"><span class="chat-event-origin-ico" aria-hidden="true">${ico}</span><span class="chat-event-origin-name">${esc(title)}</span><span class="chat-event-origin-chev" aria-hidden="true">${chev}</span></button>`;
}

function conversationGeneralFeedItems(messages, events) {
  const untagged = (messages || []).filter(conversationIsGeneralFeedMessage);
  const markers = conversationEventMoveMarkers(messages, events);
  return [...untagged, ...markers].sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
}

function conversationEventMessages(ev, conn) {
  const eventCh = (conn?.channels || []).find(c => c.id === ev.channelId);
  const chat = conversationGeneralChannel(eventCh, conn);
  if (chat && typeof collatedChatMessages === "function") {
    const raw = collatedChatMessages(chat) || [];
    if (typeof messageMentionedEventIds === "function") {
      return raw.filter(m => messageMentionedEventIds(m).includes(ev.id));
    }
    return raw.filter(m => m.eventId === ev.id
      || (Array.isArray(m.mentionedEventIds) && m.mentionedEventIds.includes(ev.id)));
  }
  if (typeof timelineChatMeta === "function") return timelineChatMeta(ev).messages || [];
  return [];
}

function conversationEventMeta(ev) {
  const owner = conversationEventOwner(ev);
  const conn = owner || (typeof activeConn === "function" ? activeConn() : null);
  const messages = conversationEventMessages(ev, conn);
  const last = conversationLastMessage(messages);
  return {
    last,
    preview: conversationPreviewLine(last, conn),
  };
}

function conversationDateLabel(ev) {
  if (!ev || ev.when == null) return "";
  const today = conversationDayStart(Date.now());
  const day = conversationDayStart(ev.when);
  if (day === today) return "Today";
  if (day === today + 864e5) return "Tomorrow";
  // UK style everywhere ("Sun 18 Oct"), whatever the device locale.
  return new Date(ev.when).toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short",
  }).replace(",", "").replace("Sept", "Sep");
}

const CONV_HEADER_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

const CONV_RSVP_DISMISS_KEY = "ash_conv_rsvp_dismiss_v1";

function conversationHeaderDateLabel(ev) {
  if (!ev || ev.when == null) return "";
  const today = conversationDayStart(Date.now());
  const day = conversationDayStart(ev.when);
  if (day === today) return "Today";
  if (day === today + 864e5) return "Tomorrow";
  const d = new Date(ev.when);
  const wk = d.toLocaleDateString("en-GB", { weekday: "short" }).replace(/\.$/, "");
  return `${wk} ${d.getDate()} ${CONV_HEADER_MONTHS[d.getMonth()] || ""}`.trim();
}

function conversationScopeSubtitleHTML(ev) {
  if (!ev || ev.when == null) {
    return `<span class="chat-feed-select-sub">No date yet</span>`;
  }
  const date = conversationHeaderDateLabel(ev);
  const time = typeof timelineTimeLabel === "function" ? timelineTimeLabel(ev, false) : "";
  const place = typeof timelineEventPlace === "function" ? timelineEventPlace(ev) : "";
  const parts = [];
  if (date) parts.push(`<span class="chat-feed-sub-date">${esc(date)}</span>`);
  if (time) parts.push(`<span class="chat-feed-sub-time">${esc(time)}</span>`);
  if (place) parts.push(`<span class="chat-feed-sub-place">${esc(place)}</span>`);
  if (!parts.length) return `<span class="chat-feed-select-sub">No date yet</span>`;
  return `<span class="chat-feed-select-sub">${parts.join(`<span class="chat-feed-sub-sep" aria-hidden="true">·</span>`)}</span>`;
}

function loadConvRsvpDismissMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(CONV_RSVP_DISMISS_KEY) || "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

function conversationRsvpDismissed(eventId) {
  const id = String(eventId || "");
  if (!id) return false;
  return !!loadConvRsvpDismissMap()[id];
}

function setConversationRsvpDismissed(eventId, on) {
  const id = String(eventId || "");
  if (!id) return;
  const map = loadConvRsvpDismissMap();
  if (on) map[id] = 1;
  else delete map[id];
  try { localStorage.setItem(CONV_RSVP_DISMISS_KEY, JSON.stringify(map)); } catch {}
}

function conversationWhenLabel(ev) {
  if (!ev || ev.when == null) return "";
  const date = conversationDateLabel(ev);
  const time = typeof timelineTimeLabel === "function" ? timelineTimeLabel(ev, false) : "";
  return date && time ? `${date} · ${time}` : (date || time);
}

function conversationThreadTab() {
  const thread = typeof S !== "undefined" ? S.conversationsThread : null;
  const t = thread?.tab;
  const tab = t === "attendance" || t === "description" ? t : "chat";
  return tab;
}

function conversationCanDeleteEvent(ev) {
  if (!ev) return false;
  if (typeof canEditEvent === "function" && canEditEvent(ev)) return true;
  return typeof canManage === "function" && canManage(ev);
}

function conversationEventMenuActions(ev) {
  if (!ev || ev.calendarImported) return [];
  const state = typeof timelinePresentationState === "function"
    ? timelinePresentationState(ev)
    : {};
  const actions = [];
  const dismissed = conversationRsvpDismissed(ev.id);
  if (state.canRsvp && !state.organiser) {
    const inlineDecline = state.kind === "unanswered" && !dismissed;
    const yes = typeof eventPositiveRsvpStatus === "function" ? eventPositiveRsvpStatus(ev) : "going";
    if (state.rsvp !== yes && !inlineDecline) actions.push("accept");
    if (state.rsvp !== "out" && !inlineDecline) actions.push("decline");
    if (state.kind === "unanswered" && !dismissed) actions.push("dismiss");
  }
  if (typeof canEditEvent === "function" && canEditEvent(ev)) actions.push("edit");
  actions.push("share", "art");
  try {
    if (typeof getLocalMemoryPhoto === "function" && getLocalMemoryPhoto(ev)) {
      actions.push("clear-art");
    }
  } catch {}
  const owner = conversationEventOwner(ev);
  const me = typeof myIdOf === "function" ? myIdOf(ev) : owner?.me?.id;
  if (owner && typeof canReport === "function" && canReport(owner)
      && ev.createdBy && ev.createdBy !== me) {
    actions.push("report");
  }
  if (typeof canCreateEvents !== "function" || canCreateEvents()) actions.push("duplicate");
  actions.push("view-text");
  if (conversationCanDeleteEvent(ev)) actions.push("delete");
  return actions;
}

function conversationFindEvent(eventId) {
  const conn = typeof activeConn === "function" ? activeConn() : null;
  if (typeof findEventById === "function") return findEventById(eventId, null, conn);
  if (!eventId) return null;
  const g = typeof group === "function" ? group() : null;
  return (conn?.events || g?.events || []).find(e => e.id === eventId) || null;
}

function conversationMenuButtonHTML(action, ev) {
  const danger = action === "delete" ? ` class="danger"` : "";
  let icon = "";
  let label = action;
  if (action === "dismiss") {
    icon = typeof ic === "function" ? ic("minus", "ico-inline") : "";
    label = "Dismiss";
  } else if (action === "accept") {
    icon = typeof ic === "function" ? ic("check", "ico-inline") : "";
    label = typeof eventRsvpAcceptMenuLabel === "function" ? eventRsvpAcceptMenuLabel(ev) : "Accept";
  } else if (action === "decline") {
    icon = typeof ic === "function" ? ic("cancel", "ico-inline") : "";
    label = typeof eventRsvpNoActionLabel === "function" ? eventRsvpNoActionLabel(ev) : "Can't";
  } else if (action === "duplicate") {
    icon = typeof ic === "function" ? ic("copy", "ico-inline") : "";
    label = conversationEventHasEnded(ev) ? "Plan again" : "Duplicate";
  } else if (action === "view-text") {
    icon = typeof ic === "function" ? ic("file-text", "ico-inline") : "";
    label = "View as text";
  } else {
    const raw = typeof timelineActionIcon === "function" ? timelineActionIcon(action, ev) : "more";
    const name = raw === "check-circle" ? "circle-check" : raw;
    icon = typeof ic === "function" ? ic(name, "ico-inline") : "";
    label = typeof timelineActionLabel === "function" ? timelineActionLabel(action, ev) : action;
  }
  return `<button type="button" data-conv-action="${esc(action)}"${danger}>${icon}<span>${esc(label)}</span></button>`;
}

function conversationRefreshAfterMenu() {
  if (typeof timelineCloseQuickMenu === "function") timelineCloseQuickMenu();
  const view = document.getElementById("view");
  const g = typeof group === "function" ? group() : null;
  const ch = (g?.channels || []).find(c => c.id === (typeof S !== "undefined" ? S.activeView?.id : null));
  if (view && ch && typeof renderChat === "function") renderChat(view, ch);
}

async function conversationRunMenuAction(ev, action) {
  if (action === "dismiss") {
    setConversationRsvpDismissed(ev.id, true);
    conversationRefreshAfterMenu();
    return;
  }
  if (action === "accept" || action === "decline") {
    const status = action === "accept"
      ? (typeof eventPositiveRsvpStatus === "function" ? eventPositiveRsvpStatus(ev) : "going")
      : "out";
    setConversationRsvpDismissed(ev.id, false);
    if (typeof setEventRsvp === "function") setEventRsvp(ev.id, status);
    conversationRefreshAfterMenu();
    return;
  }
  if (action === "edit") {
    if (typeof timelineCloseQuickMenu === "function") timelineCloseQuickMenu();
    if (typeof openEditEventDraft === "function") openEditEventDraft(ev);
    return;
  }
  if (action === "duplicate" || action === "view-text") {
    if (typeof timelineCloseQuickMenu === "function") timelineCloseQuickMenu();
    await conversationRunDetailAction(ev, action);
    return;
  }
  if (typeof timelineRunAction === "function") {
    await timelineRunAction(ev, action);
  }
  if (action !== "delete") return;
  if (conversationFindEvent(ev.id)) return;
  if (typeof S !== "undefined") {
    if (S.conversationsThread?.eventId === ev.id) S.conversationsThread = null;
    if (S.chatFilterEventId === ev.id) S.chatFilterEventId = null;
  }
  const ch = conversationActiveEventChannel();
  if (ch && typeof Nav?.openChannel === "function" && S.activeView?.id !== ch.id) {
    Nav.openChannel(ch.id);
    if (typeof renderView === "function") renderView(false, { force: true });
  }
}

function conversationEnsureQuickMenu() {
  if (!document.getElementById("tl-quick-menu")) {
    const host = document.getElementById("view") || document.body;
    const backdrop = document.createElement("button");
    backdrop.type = "button";
    backdrop.className = "tl-quick-backdrop";
    backdrop.id = "tl-quick-backdrop";
    backdrop.hidden = true;
    backdrop.setAttribute("aria-label", "Close menu");
    const menu = document.createElement("div");
    menu.className = "tl-quick-menu";
    menu.id = "tl-quick-menu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");
    host.append(backdrop, menu);
  }
  if (typeof timelineWireQuickBackdrop === "function") timelineWireQuickBackdrop();
}

let eventRsvpMenuAnchor = null;

function closeEventRsvpMenuAnchor() {
  if (!eventRsvpMenuAnchor) return;
  eventRsvpMenuAnchor.setAttribute("aria-expanded", "false");
  eventRsvpMenuAnchor = null;
}

function openEventRsvpMenu(ev, anchor, onChosen) {
  if (!ev) return;
  conversationEnsureQuickMenu();
  const menu = document.getElementById("tl-quick-menu");
  const backdrop = document.getElementById("tl-quick-backdrop");
  if (!menu || !backdrop) return;
  closeEventRsvpMenuAnchor();
  eventRsvpMenuAnchor = anchor || null;
  menu.innerHTML = (typeof eventRsvpChoiceStatuses === "function"
    ? eventRsvpChoiceStatuses(ev)
    : ["going", "out"]).map((status) => {
    const label = typeof eventRsvpChoiceLabel === "function"
      ? eventRsvpChoiceLabel(status, ev)
      : (status === "going" ? "Going" : "Can’t go");
    const icon = status === "out" ? "cancel" : "check";
    return `<button type="button" data-conv-rsvp-choice="${esc(status)}">${typeof ic === "function" ? ic(icon, "ico-inline") : ""}<span>${esc(label)}</span></button>`;
  }).join("");
  if (anchor) {
    const rect = anchor.getBoundingClientRect();
    menu.style.top = `${Math.min(innerHeight - 200, Math.max(12, rect.bottom + 6))}px`;
    menu.style.right = `${Math.max(12, innerWidth - rect.right)}px`;
    anchor.setAttribute("aria-expanded", "true");
  }
  backdrop.hidden = false;
  menu.hidden = false;
  const close = () => {
    closeEventRsvpMenuAnchor();
    if (typeof timelineCloseQuickMenu === "function") timelineCloseQuickMenu();
    else {
      menu.hidden = true;
      backdrop.hidden = true;
    }
  };
  menu.querySelectorAll("[data-conv-rsvp-choice]").forEach((choice) => {
    choice.addEventListener("click", () => {
      const status = choice.dataset.convRsvpChoice;
      if (status !== "going" && status !== "signedUp" && status !== "out") return;
      if (typeof setEventRsvp === "function") setEventRsvp(ev.id, status);
      close();
      if (typeof onChosen === "function") onChosen(status);
    });
  });
}

function conversationParseDetails(raw) {
  const text = String(raw || "").replace(/\r\n/g, "\n").trim();
  if (!text) return { fields: [], notes: "" };
  const fields = [];
  const noteLines = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const match = trimmed.match(/^(?:\*\*)?([A-Za-z][A-Za-z0-9 /&'-]{0,32})(?:\*\*)?:\s+(.+)$/);
    const label = match ? match[1].trim() : "";
    const value = match ? match[2].trim().replace(/^\*\*|\*\*$/g, "") : "";
    if (label && value && !label.includes(".") && label.split(/\s+/).length <= 4) {
      if (typeof isReservedMapDetailsField === "function"
        ? isReservedMapDetailsField(label, value)
        : (/^map$/i.test(label) && typeof parseMapLink === "function" && parseMapLink(value))) {
        continue;
      }
      fields.push({ label, value });
    } else {
      noteLines.push(line);
    }
  }
  return { fields, notes: noteLines.join("\n").trim() };
}

function conversationEventTimeRange(ev) {
  if (!ev || ev.when == null) return { when: "No date yet", duration: "" };
  const date = conversationHeaderDateLabel(ev);
  if (ev.whenPrecision === "day") {
    return { when: date ? `${date}, All day` : "All day", duration: "" };
  }
  if (ev.whenPrecision === "unconfirmed") {
    return { when: date ? `${date}, TBC` : "TBC", duration: "" };
  }
  const clockFn = typeof timelineClockLabel === "function"
    ? timelineClockLabel
    : (typeof formatClockTime === "function" ? formatClockTime : null);
  if (ev.whenPrecision === "period") {
    const time = typeof timelineTimeLabel === "function" ? timelineTimeLabel(ev, false) : "";
    return { when: [date, time].filter(Boolean).join(", "), duration: "" };
  }
  const start = clockFn ? clockFn(ev.when) : "";
  let end = "";
  try {
    const endTs = typeof eventEndWhen === "function" ? eventEndWhen(ev) : null;
    if (endTs && Number.isFinite(endTs) && endTs > Number(ev.when) && clockFn) {
      end = clockFn(endTs);
    }
  } catch {}
  let clock = start;
  if (start && end) {
    const startAp = /[ap]m$/i.test(start) ? start.slice(-2) : "";
    const endAp = /[ap]m$/i.test(end) ? end.slice(-2) : "";
    clock = (startAp && startAp === endAp)
      ? `${start.slice(0, -2)}–${end}`
      : `${start}–${end}`;
  }
  let duration = "";
  if (typeof durationLabel === "function" && typeof effectiveDuration === "function") {
    duration = durationLabel(effectiveDuration(ev));
  }
  return {
    when: date && clock ? `${date}, ${clock}` : (date || clock || "No date yet"),
    duration,
  };
}

function conversationEventActionRowHTML({ icon, text, sub = "", rowAction, label, trail = "", trailHref = "" }) {
  const ico = typeof ic === "function" ? ic(icon, "ico-inline") : "";
  const chev = typeof ic === "function" ? ic("chevron-right", "ico-inline") : "›";
  const link = trailHref && trail
    ? `<a class="conv-event-row-trail is-link conv-event-row-directions" href="${esc(trailHref)}" target="_blank" rel="noopener">${esc(trail)}${typeof ic === "function" ? ic("external-link", "ico-inline") : ""}</a>`
    : "";
  return `<div class="conv-event-row has-action">
    <button type="button" class="conv-event-row-main" data-conv-detail="${esc(rowAction)}" aria-label="${esc(label)}">
      <span class="conv-event-row-ico" aria-hidden="true">${ico}</span>
      <span class="conv-event-row-copy"><span class="conv-event-row-text">${esc(text)}</span>${sub ? `<small class="conv-event-row-sub">${esc(sub)}</small>` : ""}</span>
      ${link ? "" : `<span class="conv-event-row-chev" aria-hidden="true">${chev}</span>`}
    </button>
    ${link}
  </div>`;
}

function conversationEventFactRowHTML({ icon, text, trail = "", trailHref = "", trailAction = "", stack = false, editAction = "" }) {
  if (!text && !trail && !editAction) return "";
  const ico = typeof ic === "function" ? ic(icon, "ico-inline") : "";
  let trailHtml = "";
  if (trailHref && trail) {
    trailHtml = `<a class="conv-event-row-trail is-link" href="${esc(trailHref)}" target="_blank" rel="noopener">${esc(trail)}</a>`;
  } else if (trailAction && trail) {
    trailHtml = `<button type="button" class="conv-event-row-trail is-link" data-conv-detail="${esc(trailAction)}">${esc(trail)}</button>`;
  } else if (stack && trail) {
    const bits = String(trail).trim().match(/^(\d+)\s*(.*)$/);
    trailHtml = bits
      ? `<span class="conv-event-row-trail is-stack"><strong>${esc(bits[1])}</strong><em>${esc(bits[2])}</em></span>`
      : `<span class="conv-event-row-trail">${esc(trail)}</span>`;
  } else if (trail) {
    trailHtml = `<span class="conv-event-row-trail">${esc(trail)}</span>`;
  }
  const editHtml = editAction
    ? `<button type="button" class="conv-event-notes-edit conv-event-row-edit" data-conv-detail="${esc(editAction)}" aria-label="Edit">${typeof ic === "function" ? ic("pencil", "ico-inline") : ""}</button>`
    : "";
  return `<div class="conv-event-row">
    <span class="conv-event-row-ico" aria-hidden="true">${ico}</span>
    <span class="conv-event-row-text">${esc(text)}</span>
    ${trailHtml}
    ${editHtml}
  </div>`;
}

function conversationEventFactsHTML(ev) {
  if (!ev) return "";
  const parsed = conversationParseDetails(typeof shown === "function"
    ? shown(ev._details || "")
    : (ev._details || ""));
  const { when } = conversationEventTimeRange(ev);
  const place = typeof timelineEventPlace === "function" ? timelineEventPlace(ev) : "";
  const host = typeof eventOrganiserName === "function" ? eventOrganiserName(ev) : "";
  const mapHref = typeof eventMapUrl === "function" ? eventMapUrl(ev) : "";
  const canEditPlace = typeof canEditEvent === "function" && canEditEvent(ev);
  const canEdit = canEditPlace;
  const mapName = mapHref
    ? (conversationEventMapLabel(ev).name
      || (typeof parseMapLink === "function" ? String(parseMapLink(mapHref)?.name || "").trim() : ""))
    : "";
  const mapIsSearch = /\/maps\/search\//i.test(mapHref) || /[?&]api=1/i.test(mapHref);
  const personal = conversationEventIsPersonalOnly(ev);
  let placeSub = "";
  if (canEditPlace) {
    if (!mapHref) placeSub = place ? (personal ? "Add a map for directions" : "Add a map so guests can get directions") : "";
    else if (mapName && place && mapName.toLowerCase() !== place.toLowerCase()) placeSub = `Map: ${mapName}`;
    else placeSub = mapIsSearch ? "Map: Google Maps search" : "Map attached";
  }
  const rows = [
    canEdit
      ? conversationEventActionRowHTML({
        icon: "clock", text: when, rowAction: "edit-time", label: `Edit time, ${when}`,
      })
      : conversationEventFactRowHTML({ icon: "clock", text: when }),
    canEditPlace
      ? conversationEventActionRowHTML({
        icon: "pin",
        text: place || (mapHref ? (mapName || "Pinned place") : "Add a place"),
        sub: placeSub,
        rowAction: "edit-place",
        label: place ? `Edit place, ${place}` : "Add a place",
        trail: mapHref ? "Directions" : "",
        trailHref: mapHref || "",
      })
      : conversationEventFactRowHTML({
        icon: "pin",
        text: place || (mapHref ? (mapName || "Pinned place") : ""),
        trail: mapHref ? "Directions" : "",
        trailHref: mapHref || "",
      }),
    personal
      ? conversationEventFactRowHTML({ icon: "lock", text: "Personal", trail: "Only you can see this" })
      : conversationEventFactRowHTML({
        icon: "user",
        text: host ? `Hosted by ${host}` : "",
      }),
    ...parsed.fields.map((field) => conversationEventFactRowHTML({
      icon: "layout-list",
      text: field.label,
      trail: field.value,
    })),
  ].filter(Boolean).join("");
  return rows ? `<div class="conv-event-facts">${rows}</div>` : "";
}

function conversationEventOriginHTML(ev) {
  const conn = conversationEventOwner(ev) || (typeof activeConn === "function" ? activeConn() : null);
  const messages = conversationEventMessages(ev, conn) || [];
  const origin = messages.find(m => m && !m.activity && !m._eventLinkMarker);
  if (!origin) return "";
  const name = origin.name || "Someone";
  const text = String(typeof shown === "function"
    ? shown(origin._text || origin.text || "")
    : (origin._text || origin.text || "")).trim();
  if (!text) return "";
  const ico = typeof ic === "function" ? ic("messages-square", "ico-inline") : "";
  const chev = typeof ic === "function" ? ic("chevron-down", "ico-inline") : "";
  return `<details class="conv-event-origin">
    <summary>
      <span class="conv-event-origin-ico" aria-hidden="true">${ico}</span>
      <span>How this started</span>
      <span class="conv-event-origin-chev" aria-hidden="true">${chev}</span>
    </summary>
    <p class="conv-event-origin-body"><strong>${esc(name)}</strong> ${esc(text)}</p>
  </details>`;
}

function conversationEventAsText(ev) {
  const lines = [];
  const title = typeof eventDisplayTitle === "function"
    ? eventDisplayTitle(ev)
    : (ev._title || ev.title || "");
  if (title) lines.push(`# ${title}`);
  const { when } = conversationEventTimeRange(ev);
  if (when) lines.push(when);
  const place = typeof timelineEventPlace === "function" ? timelineEventPlace(ev) : "";
  if (place) lines.push(place);
  const mapUrl = typeof eventMapUrl === "function" ? eventMapUrl(ev) : "";
  if (mapUrl) lines.push(`Map: ${mapUrl}`);
  const host = typeof eventOrganiserName === "function" ? eventOrganiserName(ev) : "";
  if (host) lines.push(`Hosted by ${host}`);
  const parsed = conversationParseDetails(typeof shown === "function"
    ? shown(ev._details || "")
    : (ev._details || ""));
  if (parsed.notes) lines.push("", parsed.notes);
  for (const field of parsed.fields) lines.push(`${field.label}: ${field.value}`);
  return lines.join("\n").trim();
}

function conversationOpenEventText(ev) {
  const text = conversationEventAsText(ev);
  if (typeof AshModal === "undefined" || typeof AshModal.open !== "function") {
    try { navigator.clipboard.writeText(text); } catch {}
    if (typeof toast === "function") toast("Copied as text");
    return;
  }
  const opened = AshModal.open({
    className: "conv-event-text-sheet",
    html: `<div class="modal-card" role="dialog" aria-modal="true" aria-label="Event as text">
      <button type="button" class="modal-card-close" data-conv-text-close aria-label="Close">${typeof ic === "function" ? ic("cancel") : "×"}</button>
      <h4>View as text</h4>
      <textarea id="conv-event-text" readonly>${esc(text)}</textarea>
      <div class="actions">
        <button type="button" class="cancel" data-conv-text-close>Close</button>
        <button type="button" class="save" id="conv-event-text-copy">Copy</button>
      </div>
    </div>`,
    singleton: "return",
  });
  if (!opened) return;
  const { overlay, close } = opened;
  overlay.querySelectorAll("[data-conv-text-close]").forEach((btn) => {
    btn.addEventListener("click", close);
  });
  overlay.querySelector("#conv-event-text-copy")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      if (typeof toast === "function") toast("Copied");
    } catch {
      if (typeof toast === "function") toast("Couldn't copy");
    }
  });
}

function conversationDuplicateEvent(ev) {
  if (typeof canCreateEvents === "function" && !canCreateEvents()) {
    if (typeof toast === "function") toast("You can't create events here");
    return;
  }
  if (typeof openCreateDraft !== "function") return;
  const title = typeof eventDisplayTitle === "function"
    ? eventDisplayTitle(ev)
    : (ev._title || ev.title || "");
  const where = typeof timelineEventPlace === "function" ? timelineEventPlace(ev) : "";
  const detailsRaw = String(typeof shown === "function"
    ? shown(ev._details || "")
    : (ev._details || "")).trim();
  const split = typeof splitEventMapDetails === "function"
    ? splitEventMapDetails(detailsRaw)
    : { rest: detailsRaw, mapUrl: "" };
  const details = split.rest;
  let timeText = "";
  if (ev.when != null && ev.whenPrecision !== "day" && ev.whenPrecision !== "period"
      && typeof formatClockTime === "function") {
    timeText = formatClockTime(ev.when);
  }
  openCreateDraft({
    title,
    where,
    details,
    mapUrl: split.mapUrl,
    timeText,
    day: ev.when || Date.now(),
    fromEventId: ev.id,
    createFromEvent: true,
  });
}

function conversationRefreshEventPanel(ev) {
  const convPanel = document.getElementById("conv-event-panel");
  if (!convPanel || !ev || typeof conversationEventPanelHTML !== "function") return;
  const tmp = document.createElement("div");
  tmp.innerHTML = conversationEventPanelHTML(ev);
  const nextEl = tmp.firstElementChild;
  if (nextEl) convPanel.replaceWith(nextEl);
}

async function conversationAttachMap(ev) {
  if (!ev) return;
  conversationOpenPlaceEditor(ev, { mode: "paste" });
}

function conversationMapSearchUrl(name) {
  const q = String(name || "").trim();
  return q ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q) : "";
}

function conversationEventConn(ev) {
  return (typeof ownerConnOf === "function" ? ownerConnOf(ev.id) : null)
    || (typeof ownerConnFor === "function" ? ownerConnFor(ev) : null)
    || (typeof activeConn === "function" ? activeConn() : null);
}

async function conversationSetEventWhere(ev, name) {
  const conn = conversationEventConn(ev);
  if (!ev || !conn) return false;
  const clean = String(name || "").trim();
  const cipher = clean && typeof encrypt === "function" ? await encrypt(clean, conn.key) : clean;
  if (typeof send === "function") send({ type: "setEventWhere", eventId: ev.id, where: cipher }, conn.id);
  ev.where = cipher;
  ev._where = clean;
  return true;
}

async function conversationClearEventMap(ev) {
  const conn = conversationEventConn(ev);
  if (!ev || !conn || typeof mergeEventMapDetails !== "function") return false;
  const raw = typeof eventDetailsPlain === "function" ? eventDetailsPlain(ev) : String(ev._details || "");
  const next = mergeEventMapDetails(raw, "");
  const cipher = next && typeof encrypt === "function" ? await encrypt(next, conn.key) : (next || "");
  if (typeof send === "function") send({ type: "setEventDetails", eventId: ev.id, details: cipher }, conn.id);
  ev.details = cipher;
  ev._details = next;
  return true;
}

function conversationMapProvider(href) {
  let host = "";
  try { host = new URL(href).hostname.replace(/^www\./, "").toLowerCase(); } catch { return /^geo:/i.test(href || "") ? "Map pin" : ""; }
  if (host.includes("apple.com")) return "Apple Maps";
  if (host.includes("openstreetmap") || host === "osm.org") return "OpenStreetMap";
  if (host.includes("goo.gl") || host.includes("google.")) return "Google Maps";
  return "Map";
}

function conversationMapNameParts(full) {
  const s = String(full || "").replace(/\s+/g, " ").trim();
  if (!s) return { name: "", address: "" };
  const bits = s.split(",").map((p) => p.trim()).filter(Boolean);
  if (bits.length >= 2 && bits[0].length >= 2 && bits[0].length <= 60) {
    return { name: bits[0], address: bits.slice(1).join(", ") };
  }
  return { name: s, address: "" };
}

function conversationMapLabelFromText(text) {
  const raw = String(text || "");
  const m = raw.match(/https?:\/\/\S+|geo:\S+/i);
  const before = (m ? raw.slice(0, m.index) : raw).replace(/[—–-]\s*$/, "").trim();
  if (!before) return { name: "", address: "" };
  const parts = before.split(/\n|\s·\s|\s\|\s/).map(p => p.trim()).filter(Boolean);
  return { name: parts[0] || "", address: parts.slice(1).join(", ") };
}

function conversationEventMapLabel(ev) {
  const raw = typeof eventDetailsPlain === "function" ? eventDetailsPlain(ev) : String(ev?._details || "");
  const line = raw.split(/\r?\n/).find(l => /^(?:\*\*)?Map(?:\*\*)?:\s+/i.test(l.trim()));
  if (!line) return { name: "", address: "" };
  return conversationMapLabelFromText(line.trim().replace(/^(?:\*\*)?Map(?:\*\*)?:\s+/i, ""));
}

async function conversationWriteEventMapLabel(ev, href, label) {
  const conn = conversationEventConn(ev);
  if (!ev || !conn || !href || !label?.name || typeof splitEventMapDetails !== "function") return;
  const raw = typeof eventDetailsPlain === "function" ? eventDetailsPlain(ev) : String(ev._details || "");
  const rest = splitEventMapDetails(raw).rest;
  const text = [label.name, label.address].filter(Boolean).join(" · ").replace(/\s+/g, " ");
  const line = `Map: ${text} — ${href}`;
  const next = rest ? `${rest}\n\n${line}` : line;
  const cipher = typeof encrypt === "function" ? await encrypt(next, conn.key) : next;
  if (typeof send === "function") send({ type: "setEventDetails", eventId: ev.id, details: cipher }, conn.id);
  ev.details = cipher;
  ev._details = next;
}

function conversationShortUrl(href) {
  try {
    const u = new URL(href);
    const path = (u.pathname + (u.search ? u.search : "")).replace(/\/$/, "");
    const shown = u.hostname.replace(/^www\./, "") + path;
    return shown.length > 38 ? shown.slice(0, 36) + "…" : shown;
  } catch { return String(href || "").slice(0, 38); }
}

function conversationOpenPlaceEditor(ev, opts = {}) {
  if (!ev) return;
  if (typeof AshModal === "undefined" || typeof AshModal.open !== "function") {
    if (typeof openEditEventDraft === "function") openEditEventDraft(ev, { focusField: "place" });
    return;
  }
  const conn = conversationEventConn(ev);
  const place = typeof timelineEventPlace === "function" ? timelineEventPlace(ev) : "";
  const mapHref = typeof eventMapUrl === "function" ? eventMapUrl(ev) : "";
  const eventLabel = conversationEventMapLabel(ev);
  const ico = (name) => (typeof ic === "function" ? ic(name, "ico-inline") : "");
  const parse = (u) => (u && typeof parseMapLink === "function" ? parseMapLink(u) : null);
  const knownFor = (name) => (typeof mapUrlForKnownPlace === "function" ? mapUrlForKnownPlace(name, conn) : "");
  const knownLabelFor = (href) => {
    const list = typeof locationsFor === "function" ? (locationsFor(conn) || []) : [];
    const hit = list.find(l => String(l.mapUrl || "").trim() === href);
    return hit ? String(hit.label || "").trim() : "";
  };
  let manual = null;      // { href, label, fromClipboard }
  let removed = false;
  let accepted = false;
  const resolved = new Map();
  const html = `<div class="modal-card conv-place-card" role="dialog" aria-modal="true" aria-labelledby="conv-place-title">
      <button type="button" class="modal-card-close" data-place-close aria-label="Close">${ico("cancel")}</button>
      <h4 id="conv-place-title">Where</h4>
      <input id="conv-place-name" class="conv-place-input" type="text" autocomplete="off" value="${esc(place)}" placeholder="Place name" aria-label="Place name">
      <p class="conv-place-label">Map link</p>
      <div class="conv-place-preview-card" aria-live="polite"></div>
      <div class="conv-place-acts"></div>
      <div class="actions conv-place-actions">
        <button type="button" class="cancel" data-place-close>Cancel</button>
        <button type="button" class="save conv-place-save" data-place-save>Save</button>
      </div>
    </div>`;
  const opened = AshModal.open({ className: "conv-event-text-sheet conv-place-sheet", html, singleton: "replace" });
  if (!opened) return;
  const { overlay, close } = opened;
  const nameInput = overlay.querySelector("#conv-place-name");
  const card = overlay.querySelector(".conv-place-preview-card");
  const acts = overlay.querySelector(".conv-place-acts");

  const current = () => {
    const name = nameInput.value.trim();
    if (manual) return { href: manual.href, src: manual.fromClipboard ? "clipboard" : "manual", linked: true, label: manual.label };
    if (!removed && mapHref) return { href: mapHref, src: "event", linked: true, label: eventLabel };
    const known = knownFor(name);
    if (!removed && known) return { href: known, src: "known", linked: true, label: { name: knownLabelFor(known) || name, address: "" } };
    if (name) return { href: conversationMapSearchUrl(name), src: "suggested", linked: accepted, label: { name, address: "" } };
    return { href: "", src: "none", linked: false, label: { name: "", address: "" } };
  };

  const lookUp = (href) => {
    if (!href || resolved.has(href)) return;
    const quick = parse(href);
    if (quick && quick.name && !(typeof isMapShortLink === "function" && isMapShortLink(href))) {
      resolved.set(href, conversationMapNameParts(quick.name));
      return;
    }
    resolved.set(href, null);
    if (typeof resolveMapLink !== "function") { resolved.set(href, { name: "", address: "" }); return; }
    resolveMapLink(href)
      .then((r) => resolved.set(href, conversationMapNameParts(r?.name || "")))
      .catch(() => resolved.set(href, { name: "", address: "" }))
      .finally(paint);
  };

  const actBtn = (act, icon, label, cls = "", tag = "button", href = "") => tag === "a"
    ? `<a class="conv-place-act${cls ? " " + cls : ""}" href="${esc(href)}" target="_blank" rel="noopener">${ico(icon)}<span>${label}</span></a>`
    : `<button type="button" class="conv-place-act${cls ? " " + cls : ""}" data-place-act="${act}">${ico(icon)}<span>${label}</span></button>`;

  function paint() {
    const cur = current();
    const { href, src, linked, label } = cur;
    const provider = src === "suggested" ? "Google Maps" : conversationMapProvider(href);
    if (!href) {
      card.className = "conv-place-preview-card is-empty";
      card.innerHTML = `<span class="conv-place-current-ico" aria-hidden="true">${ico("map-pin-off")}</span>
        <span class="conv-place-current-text"><strong>No map linked</strong><em>Type a place name above, or copy a link from your map app</em></span>`;
    } else {
      lookUp(href);
      const r = resolved.get(href);
      const fromLink = r && r.name ? r : null;
      let title = fromLink?.name || label?.name || "";
      const address = fromLink?.address || label?.address || "";
      let hint = "";
      if (!title) {
        if (r == null) title = "Checking link…";
        else {
          title = "Unnamed map pin";
          hint = "Open the link to check the place";
        }
      }
      const status = {
        clipboard: ["New", "From your clipboard · not saved yet"],
        manual: ["New", "Pasted · not saved yet"],
        event: ["Linked", ""],
        known: ["Linked", "Used before for this place"],
        suggested: linked ? ["Will link", "Google Maps search for this name"] : ["Suggestion", "Google Maps search for this name"],
      }[src];
      const changed = href !== mapHref && !(src === "suggested" && !linked);
      const chip = changed ? "New" : status[0];
      card.className = "conv-place-preview-card"
        + (src === "suggested" && !linked ? " is-suggested" : "")
        + (changed ? " is-new" : (linked ? " is-linked" : ""));
      card.innerHTML = `<span class="conv-place-current-ico" aria-hidden="true">${ico(src === "suggested" ? "search" : "map-pin")}</span>
        <span class="conv-place-current-text">
          <span class="conv-place-chip${changed ? " is-new" : (linked ? " is-on" : "")}">${esc(chip)}</span>
          <strong>${esc(title)}</strong>
          ${address ? `<span class="conv-place-addr">${esc(address)}</span>` : ""}
          ${hint ? `<span class="conv-place-addr">${esc(hint)}</span>` : ""}
          ${status[1] ? `<em>${esc(status[1])}</em>` : ""}
          <em class="conv-place-url">${esc(provider)} · ${esc(conversationShortUrl(href))}</em>
        </span>`;
    }
    const buttons = [];
    if (src === "suggested" && !linked) buttons.push(actBtn("accept", "check", "Use this map", "is-primary"));
    if (src === "suggested" && linked) buttons.push(actBtn("unaccept", "undo-2", "Don't use this map"));
    if (src === "clipboard" || src === "manual") buttons.push(actBtn("discard", "undo-2", "Don't use this link"));
    if (href) buttons.push(actBtn("", "external-link", `Open in ${provider} to check`, "", "a", href));
    buttons.push(actBtn("paste", "clipboard-paste", href && src !== "suggested" ? "Paste a different map link" : "Paste a map link"));
    if (linked && (src === "event" || src === "known")) buttons.push(actBtn("remove", "trash", "Remove map link", "is-danger"));
    acts.innerHTML = buttons.join("");
  }

  const stageText = (text, fromClipboard) => {
    const parsed = parse(String(text || "").trim());
    if (!parsed) return false;
    if (manual?.href === parsed.href) return true;
    manual = { href: parsed.href, label: conversationMapLabelFromText(text), fromClipboard: !!fromClipboard };
    removed = false;
    paint();
    return true;
  };

  const readClipboard = async () => {
    try {
      if (window.AshNative?.readClipboardText) {
        const native = String(AshNative.readClipboardText() || "").trim();
        if (native) return native;
      }
    } catch {}
    try {
      if (navigator.clipboard?.readText) return String(await navigator.clipboard.readText() || "");
    } catch {}
    return "";
  };

  nameInput.addEventListener("input", () => { accepted = false; paint(); });
  overlay.addEventListener("click", async (e) => {
    if (e.target.closest("[data-place-close]")) { close(); return; }
    const act = e.target.closest("[data-place-act]")?.dataset.placeAct;
    if (act === "accept") { accepted = true; paint(); return; }
    if (act === "unaccept") { accepted = false; paint(); return; }
    if (act === "discard") { manual = null; paint(); return; }
    if (act === "remove") {
      manual = null; removed = true; accepted = false; paint();
      if (typeof toast === "function") toast("Map link will be removed when you save");
      return;
    }
    if (act === "paste") {
      const text = await readClipboard();
      if (text && stageText(text, true)) return;
      if (typeof toast === "function") toast(text ? "That isn't a map link" : "Copy a map link first");
      return;
    }
    if (e.target.closest("[data-place-save]")) {
      const name = nameInput.value.trim();
      const cur = current();
      const target = cur.linked ? cur.href : "";
      if (name !== place) await conversationSetEventWhere(ev, name);
      if (!target && mapHref) {
        await conversationClearEventMap(ev);
        if (typeof toast === "function") toast("Map link removed");
      } else if (target && target !== mapHref && typeof applyEventMapUrl === "function") {
        await applyEventMapUrl(ev, target, name);
        let savedLabel = cur.label;
        if (cur.src === "clipboard" || cur.src === "manual") {
          const got = resolved.get(target);
          if (got?.name) savedLabel = { name: got.name, address: got.address || cur.label?.address || "" };
          else if (!savedLabel?.name && typeof resolveMapLink === "function") {
            try {
              const parts = conversationMapNameParts((await resolveMapLink(target))?.name || "");
              if (parts.name) savedLabel = parts;
            } catch { /* keep the clipboard label */ }
          }
        }
        if (savedLabel?.name && (cur.src === "clipboard" || cur.src === "manual")) {
          await conversationWriteEventMapLabel(ev, target, savedLabel);
        }
      } else if (name !== place && typeof toast === "function") {
        toast("Place updated");
      }
      close();
      conversationRefreshEventPanel(ev);
    }
  });
  paint();
  // Check the clipboard straight away: a fresh map link there is used automatically.
  readClipboard().then((text) => {
    const parsed = parse(text);
    if (parsed && parsed.href !== mapHref) stageText(text, true);
  });
  if (opts.mode === "paste") overlay.querySelector('[data-place-act="paste"]')?.click();
}

async function conversationRunDetailAction(ev, action) {
  if (!ev || !action) return;
  if (action === "calendar") {
    if (typeof exportEventToCalendar === "function") await exportEventToCalendar(ev);
    return;
  }
  if (action === "share-card") {
    if (typeof openEventCardSheet === "function") openEventCardSheet(ev);
    return;
  }
  if (action === "share-menu") {
    conversationOpenShareChooser(ev);
    return;
  }
  if (action === "notes") {
    if (typeof timelineOpenDescriptionEditor === "function") timelineOpenDescriptionEditor(ev);
    return;
  }
  if (action === "share-link") {
    if (typeof openPassSendModal === "function") openPassSendModal(ev);
    return;
  }
  if (action === "view-text") {
    conversationOpenEventText(ev);
    return;
  }
  if (action === "add-map") {
    await conversationAttachMap(ev);
    return;
  }
  if (action === "edit") {
    if (typeof openEditEventDraft === "function") openEditEventDraft(ev);
    return;
  }
  if (action === "edit-time") {
    if (typeof openEditEventDraft === "function") openEditEventDraft(ev, { focusField: "time" });
    return;
  }
  if (action === "edit-place") {
    conversationOpenPlaceEditor(ev);
    return;
  }
  if (action === "duplicate") {
    conversationDuplicateEvent(ev);
    return;
  }
  if (action === "cancel") {
    await conversationRunMenuAction(ev, "delete");
  }
}

function conversationOpenEventMenu(ev, anchor) {
  if (!ev) return;
  conversationEnsureQuickMenu();
  const menu = document.getElementById("tl-quick-menu");
  const backdrop = document.getElementById("tl-quick-backdrop");
  if (!menu || !backdrop) return;
  const actions = conversationEventMenuActions(ev);
  if (!actions.length) return;
  menu.innerHTML = actions.map((action) => conversationMenuButtonHTML(action, ev)).join("");
  if (anchor) {
    const rect = anchor.getBoundingClientRect();
    menu.style.top = `${Math.min(innerHeight - 360, Math.max(12, rect.bottom + 6))}px`;
    menu.style.right = `${Math.max(12, innerWidth - rect.right)}px`;
  }
  backdrop.hidden = false;
  menu.hidden = false;
  menu.querySelectorAll("[data-conv-action]").forEach((button) => {
    button.addEventListener("click", () => {
      void conversationRunMenuAction(ev, button.dataset.convAction);
    });
  });
}

function conversationRsvpTickHTML(ev) {
  if (!ev) return "";
  const state = typeof timelinePresentationState === "function"
    ? timelinePresentationState(ev)
    : {};
  if (state.organiser) return "";
  if (state.rsvp === "going" || state.rsvp === "signedUp") {
    const aria = typeof eventRsvpStatusLabel === "function"
      ? eventRsvpStatusLabel(state.rsvp, ev)
      : (state.rsvp === "signedUp" ? "Signed up" : "Going");
    const label = String(aria || "").toLowerCase();
    return `<button type="button" class="chat-feed-rsvp is-on" data-conv-rsvp="${esc(state.rsvp)}" aria-pressed="true" aria-label="${esc(aria)}"><span class="chat-feed-rsvp-label">${esc(label)}</span></button>`;
  }
  if (!state.canRsvp) return "";
  if (state.kind !== "unanswered" || conversationRsvpDismissed(ev.id)) return "";
  const check = typeof ic === "function" ? ic("check") : "✓";
  const yes = typeof eventPositiveRsvpStatus === "function" ? eventPositiveRsvpStatus(ev) : "going";
  const yesAria = typeof eventRsvpYesActionLabel === "function" ? eventRsvpYesActionLabel(ev) : "Accept";
  const noAria = typeof eventRsvpNoActionLabel === "function" ? eventRsvpNoActionLabel(ev) : "Decline";
  return `<button type="button" class="chat-feed-rsvp-decline" data-conv-rsvp="out" aria-label="${esc(noAria)}">${esc(noAria.toLowerCase())}</button>`
    + `<button type="button" class="chat-feed-rsvp" data-conv-rsvp="${esc(yes)}" aria-pressed="false" aria-label="${esc(yesAria)}">${check}</button>`;
}

function conversationEventIsPersonalOnly(ev) {
  if (!ev) return false;
  const owner = conversationEventOwner(ev);
  if (typeof PersonalSpace === "undefined" || !PersonalSpace.isPersonal(owner)) return false;
  const ch = (owner.channels || []).find(c => c.id === ev.channelId);
  const board = typeof boardForChannel === "function"
    ? boardForChannel(ch, owner)
    : (owner.boards || []).find(b => b && b.id === ch?.boardId);
  if (typeof PersonalSpace.isSourceBoard === "function" && PersonalSpace.isSourceBoard(board)) return false;
  return true;
}

function conversationEventTabsHTML(ev) {
  if (!ev) return "";
  const tab = conversationThreadTab();
  const going = (typeof timelineGoingIds === "function") ? timelineGoingIds(ev).length : 0;
  const goingBit = going
    ? ` <span class="conv-event-tab-count">${going}</span>`
    : "";
  return `<nav class="conv-event-tabs" role="tablist" aria-label="Event details">
      <button type="button" role="tab" data-conv-tab="chat" aria-selected="${tab === "chat" ? "true" : "false"}"${tab === "chat" ? ` class="on"` : ""}>Chat</button>
      <button type="button" role="tab" data-conv-tab="attendance" aria-selected="${tab === "attendance" ? "true" : "false"}"${tab === "attendance" ? ` class="on"` : ""}>Sign-ups${goingBit}</button>
      <button type="button" role="tab" data-conv-tab="description" aria-selected="${tab === "description" ? "true" : "false"}"${tab === "description" ? ` class="on"` : ""}>Details</button>
    </nav>`;
}

function conversationOpenShareChooser(ev) {
  if (!ev) return;
  if (typeof AshModal === "undefined" || typeof AshModal.open !== "function") {
    void conversationRunDetailAction(ev, "share-card");
    return;
  }
  const ico = (name) => (typeof ic === "function" ? ic(name, "ico-inline") : "");
  const opened = AshModal.open({
    className: "conv-event-text-sheet conv-share-sheet",
    html: `<div class="modal-card conv-share-card" role="dialog" aria-modal="true" aria-labelledby="conv-share-title">
      <button type="button" class="modal-card-close" data-share-close aria-label="Close">${ico("cancel")}</button>
      <h4 id="conv-share-title">Share</h4>
      <button type="button" class="conv-share-opt" data-share-pick="share-card">
        <span class="conv-share-ico" aria-hidden="true">${ico("ticket")}</span>
        <span class="conv-place-opt-copy"><strong>Share card</strong><small>A picture of the event to post or send</small></span>
      </button>
      <button type="button" class="conv-share-opt" data-share-pick="share-link">
        <span class="conv-share-ico" aria-hidden="true">${ico("link")}</span>
        <span class="conv-place-opt-copy"><strong>Send link</strong><small>People open it to see details and reply</small></span>
      </button>
    </div>`,
    singleton: "replace",
    closeOnEscape: true,
  });
  if (!opened) return;
  const { overlay, close } = opened;
  overlay.addEventListener("click", (e) => {
    if (e.target.closest("[data-share-close]")) { close(); return; }
    const pick = e.target.closest("[data-share-pick]");
    if (pick) {
      close();
      void conversationRunDetailAction(ev, pick.dataset.sharePick);
    }
  });
}

function conversationEventHasEnded(ev) {
  if (!ev || ev.when == null) return false;
  const end = typeof timelineOccupancyEndMs === "function"
    ? timelineOccupancyEndMs(ev)
    : Number(ev.when) + 3600e3;
  return Number(end) > 0 && Number(end) < Date.now();
}

function conversationEditabilityNote(ev, canEdit) {
  if (typeof eventEditabilityLabel !== "function") return "";
  const raw = String(eventEditabilityLabel(ev) || "");
  let text = raw;
  if (canEdit && /^Edits go to /.test(raw)) {
    const conn = conversationEventConn(ev);
    const ch = (conn?.channels || []).find(c => c.id === ev.channelId);
    const board = String(ch?.name || "").trim();
    text = board ? `Changes you make are shared with everyone in ${board}` : "Changes you make are shared with everyone who can see this event";
  } else if (/^My plans · You can edit this$/.test(raw)) {
    text = "Only you can see this";
  }
  return text ? `<p class="conv-event-editability">${esc(text)}</p>` : "";
}

function conversationEventPanelHTML(ev) {
  const tab = conversationThreadTab();
  if (tab === "attendance") {
    const body = typeof timelineAttendanceHTML === "function" ? timelineAttendanceHTML(ev) : "";
    return `<div class="conv-event-panel" id="conv-event-panel">${body || `<p class="tl-sheet-empty">No one has responded yet.</p>`}</div>`;
  }
  if (tab === "description") {
    const parsed = conversationParseDetails(typeof shown === "function"
      ? shown(ev._details || "")
      : (ev._details || ""));
    const canEdit = typeof canEditEvent === "function" && canEditEvent(ev);
    const canDup = typeof canCreateEvents !== "function" || canCreateEvents();
    const ended = conversationEventHasEnded(ev);
    const personal = conversationEventIsPersonalOnly(ev);
    const canCancel = conversationCanDeleteEvent(ev) && !ended;
    const dated = ev.when != null && !ended;
    const md = parsed.notes && typeof timelineMarkdownHTML === "function"
      ? timelineMarkdownHTML(parsed.notes)
      : esc(parsed.notes);
    const ico = (name) => (typeof ic === "function" ? ic(name, "ico-inline") : "");
    const notesWord = personal ? "Description" : "Notes";
    const addNotesWord = personal ? "Add description" : "Add notes";
    const notes = parsed.notes
      ? `<section class="conv-event-notes">
          <div class="conv-event-notes-head">
            <h4 class="conv-event-notes-label">${notesWord}</h4>
            ${canEdit
              ? `<button type="button" class="conv-event-notes-edit" data-conv-desc-edit>${ico("pencil")} Edit</button>`
              : ""}
          </div>
          <div class="tl-description">${md}</div>
        </section>`
      : (canEdit
        ? `<button type="button" class="conv-event-notes-add" data-conv-desc-edit>${ico("pencil")} ${addNotesWord}</button>`
        : "");
    const actionRows = [
      dated ? conversationEventActionRowHTML({
        icon: "calendar", text: "Add to calendar", rowAction: "calendar", label: "Add to calendar",
      }) : "",
      conversationEventActionRowHTML({
        icon: "share", text: "Share",
        sub: personal ? "Send as a card or a link" : "Invite people with a card or a link",
        rowAction: "share-menu", label: "Share",
      }),
      canEdit && !parsed.notes ? conversationEventActionRowHTML({
        icon: "pencil", text: addNotesWord, rowAction: "notes", label: addNotesWord,
      }) : "",
    ].filter(Boolean).join("");
    const menuEmpty = !(typeof conversationEventMenuActions === "function" && conversationEventMenuActions(ev).length);
    return `<div class="conv-event-panel" id="conv-event-panel">
      <div class="conv-event-details">
        ${ended ? `<p class="conv-event-ended" role="status">${ico("history")} This event has ended</p>` : ""}
        ${conversationEventFactsHTML(ev)}
        ${actionRows ? `<div class="conv-event-facts conv-event-actions">${actionRows}</div>` : ""}
        ${parsed.notes ? notes : ""}
        ${personal ? "" : conversationEditabilityNote(ev, canEdit)}
        ${conversationEventOriginHTML(ev)}
        ${menuEmpty ? `<div class="conv-event-power"><button type="button" data-conv-detail="view-text">View as text</button></div>` : ""}
      </div>
    </div>`;
  }
  return "";
}

function conversationEventNeedsRsvp(ev) {
  const state = typeof timelinePresentationState === "function"
    ? timelinePresentationState(ev)
    : null;
  if (state?.kind !== "unanswered") return false;
  return !conversationRsvpDismissed(ev.id);
}

function conversationEventAttendance(ev) {
  if (!ev || conversationEventIsPersonalOnly(ev)) {
    return {
      hosting: false, going: false, signedUp: false, needsRsvp: false, declined: false,
      goingLabel: "Going", signedUpLabel: "Signed up",
    };
  }
  const state = typeof timelinePresentationState === "function"
    ? timelinePresentationState(ev)
    : {};
  const hosting = !!state.organiser;
  return {
    hosting,
    going: !hosting && state.rsvp === "going",
    signedUp: !hosting && state.rsvp === "signedUp",
    needsRsvp: !hosting && conversationEventNeedsRsvp(ev),
    declined: !hosting && state.rsvp === "out",
    goingLabel: typeof eventRsvpStatusLabel === "function" ? eventRsvpStatusLabel("going", ev) : "Going",
    signedUpLabel: typeof eventRsvpStatusLabel === "function" ? eventRsvpStatusLabel("signedUp", ev) : "Signed up",
  };
}

function conversationEventListDate(ev) {
  if (!ev) return "";
  if (ev.when == null) return "No date yet";
  return conversationHeaderDateLabel(ev);
}

function conversationEventNumericDate(ev) {
  if (!ev || ev.when == null) return "";
  const d = new Date(ev.when);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function conversationDayOffset(fromTs, days) {
  const d = new Date(conversationDayStart(fromTs));
  d.setDate(d.getDate() + days);
  return conversationDayStart(d.getTime());
}

function conversationWeekStartMonday(ts) {
  const d = new Date(conversationDayStart(ts));
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return conversationDayStart(d.getTime());
}

function conversationEventListStamp(ev) {
  if (!ev) return "";
  if (ev.when == null) return "No date yet";
  const today = conversationDayStart(Date.now());
  const day = conversationDayStart(ev.when);
  if (day === today) return "Today";
  if (day === conversationDayOffset(today, 1)) return "Tomorrow";
  const weekday = new Date(day).toLocaleDateString("en-GB", { weekday: "short" }).replace(/\.$/, "");
  const thisWeekStart = conversationWeekStartMonday(today);
  const nextWeekStart = conversationDayOffset(thisWeekStart, 7);
  const followingWeekStart = conversationDayOffset(thisWeekStart, 14);
  if (day > today && day < nextWeekStart) return `This ${weekday}`;
  if (day >= nextWeekStart && day < followingWeekStart) return `Next ${weekday}`;
  return conversationHeaderDateLabel(ev);
}

function conversationEventClockLabel(ev) {
  if (!ev || ev.when == null || ev.allDay) return "";
  const precision = ev.whenPrecision;
  if (precision === "day" || precision === "unconfirmed") return "";
  const time = typeof timelineTimeLabel === "function" ? timelineTimeLabel(ev, false) : "";
  if (!time || time === "All day" || time === "TBC") return "";
  return time;
}

function conversationEventWhenStamp(ev) {
  if (!ev) return "";
  if (ev.when == null) return "No date";
  const date = conversationEventListStamp(ev);
  const time = conversationEventClockLabel(ev);
  return time ? `${date} · ${time}` : date;
}

function conversationFeedPickerEvents(fallbackEvents) {
  const eventCh = conversationActiveEventChannel();
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const g = typeof group === "function" ? group() : null;
  if (eventCh && conn) {
    const events = typeof collectChannelViewEvents === "function"
      ? collectChannelViewEvents(eventCh, conn)
      : (g?.events || []).filter((ev) => ev.channelId === eventCh.id);
    return events.filter((ev) => ev && !ev.chainOf);
  }
  return Array.isArray(fallbackEvents) ? fallbackEvents : [];
}

function conversationFeedPickerIsOpen() {
  return false;
}

function closeConversationFeedPicker() {}

function conversationFeedScopeHTML({ filterEv } = {}) {
  if (!filterEv) return "";
  const title = (typeof eventDisplayTitle === "function" && eventDisplayTitle(filterEv)) || "Event";
  const rsvpTick = conversationRsvpTickHTML(filterEv);
  const menuActions = typeof conversationEventMenuActions === "function"
    ? conversationEventMenuActions(filterEv)
    : [];
  const more = menuActions.length
    ? `<button type="button" class="conv-event-more" data-conv-event-menu aria-label="Event options" title="Event options" aria-haspopup="menu">${typeof ic === "function" ? ic("more") : "⋮"}<span class="conv-sr-only">Event options</span></button>`
    : "";
  const actions = (rsvpTick || more)
    ? `<span class="chat-feed-head-actions">${rsvpTick}${more}</span>`
    : "";
  const tabs = conversationEventTabsHTML(filterEv);
  return `<div class="chat-feed-scope" id="chat-feed-scope">
    <div class="chat-feed-head">
      <div class="chat-feed-picker-bar">
        <div class="chat-feed-select" id="chat-feed-select">
          <span class="chat-feed-select-title"><span class="chat-feed-select-name">${esc(title)}</span></span>
        </div>
        ${actions}
      </div>
      ${conversationScopeSubtitleHTML(filterEv)}
    </div>
    ${tabs}
  </div>`;
}
