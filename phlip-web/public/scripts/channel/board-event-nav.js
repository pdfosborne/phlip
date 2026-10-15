/* board-event-nav.js — All chat event bar, jump list and event stepper.
 *
 * A slim bar under the header names the next event. Tapping it drops a list of
 * live events (soonest first, then undated). Tapping a row pans the chat to
 * that event's card; its "N new" badge pans to the first unread message. Either
 * way a stepper above the composer walks through the event's blocks (↑ n/N ↓).
 * This never filters — the chat stays whole (the tag filter is separate).
 * Tagging the message box to an event shows the same stepper; after a jump,
 * tapping the message box pre-sets the jumped-to event as the tag.
 *
 * Globals in:  S, activeConn, conversationActiveEventChannel, board-feed.js and
 *              board-home.js helpers, shares-live.js seen cursors
 * Globals out: boardEventNavSync, boardEventNavOnScroll, boardEventNavClose,
 *              boardEventNavBack, boardEventStepClear, boardEventNavOpen,
 *              boardEventNavGo, boardEventNavItems, boardEventNavPrefillTag,
 *              boardEventNavFocus
 * Load after:  board-select.js
 *
 * Must not: ES modules, bundlers, filtering the feed, mutating chat rows
 */

const BOARD_EVENT_PAN_GAP = 16;   // a little air above a landed block
const BOARD_EVENT_NAV_QUIET_MS = 1500;

function boardEventNavConn() {
  return typeof activeConn === "function" ? activeConn() : null;
}

function boardEventNavChannelId() {
  return typeof S !== "undefined" ? S.activeView?.id || "" : "";
}

/** The bar belongs to plain All chat only: not the event page, a filtered or
 *  replying-into-event chat (the header is the event there), or Archive. */
function boardEventNavWanted() {
  if (typeof S === "undefined" || !S.boardChatHome) return false;
  if (typeof boardOnEventPage === "function" && boardOnEventPage()) return false;
  if (S.chatFilterEventId || S.boardPeoplePage) return false;
  if (typeof boardArchiveOn === "function" && boardArchiveOn()) return false;
  if (typeof boardFocusEvent === "function" && boardFocusEvent()) return false;
  if (typeof boardPageKind === "function" && boardPageKind() !== "chat") return false;
  return true;
}

function boardEventNavEvents() {
  const eventCh = typeof conversationActiveEventChannel === "function" ? conversationActiveEventChannel() : null;
  const conn = boardEventNavConn();
  if (!eventCh) return [];
  const events = typeof channelEventsForPanelChat === "function"
    ? channelEventsForPanelChat(eventCh)
    : (conn?.events || []);
  const live = typeof boardLiveEvents === "function" ? boardLiveEvents(events) : [];
  // isMainViewEvent reads a missing date as 1970 (past), so undated events
  // are picked here directly.
  const undated = (events || []).filter((ev) => ev && !ev.chainOf && !(Number(ev.when) > 0)
    && (typeof boardEventCompleted !== "function" || !boardEventCompleted(ev)));
  const seen = new Set();
  return live.concat(undated).filter((ev) => ev && ev.id && !seen.has(ev.id) && seen.add(ev.id));
}

/** Messages in this event from other people since the event's seen cursor. */
function boardEventNavUnread(ev, list, conn, chId) {
  const out = { count: 0, firstId: "" };
  if (!ev || !conn?.id || !chId || typeof getEventChatSeenTs !== "function") return out;
  const seenTs = getEventChatSeenTs(conn.id, chId, ev.id);
  if (!seenTs) return out;
  const me = conn.me?.id;
  for (const m of list || []) {
    if (!m || m.activity || m._eventLinkMarker) continue;
    if ((m.ts || 0) <= seenTs) continue;
    if (me && m.userId === me) continue;
    const ids = typeof messageMentionedEventIds === "function" ? messageMentionedEventIds(m) : [m.eventId];
    if (!ids.includes(ev.id)) continue;
    out.count++;
    if (!out.firstId) out.firstId = m.id;
  }
  return out;
}

function boardEventNavDay(ev) {
  const when = Number(ev?.when) || 0;
  if (!when) return "No date yet";
  const d = new Date(when);
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - start.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  try {
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "").replace("Sept", "Sep");
  } catch {
    return d.toDateString();
  }
}

function boardEventNavItems() {
  const conn = boardEventNavConn();
  const chId = boardEventNavChannelId();
  const list = typeof boardActiveMessages === "function" ? boardActiveMessages() : [];
  return boardEventNavEvents().map((ev) => {
    const unread = boardEventNavUnread(ev, list, conn, chId);
    const rsvp = typeof timelineMyRsvp === "function" ? timelineMyRsvp(ev) : null;
    return {
      ev,
      id: ev.id,
      title: typeof boardEventTitle === "function" ? boardEventTitle(ev) : (ev.title || "Event"),
      day: boardEventNavDay(ev),
      when: (typeof conversationWhenLabel === "function" && conversationWhenLabel(ev)) || "No date yet",
      dated: Number(ev.when) > 0,
      now: Number(ev.when) > 0 && Number(ev.when) <= Date.now()
        && (typeof boardEventCompleted !== "function" || !boardEventCompleted(ev)),
      rsvp,
      hidden: typeof boardEventIsHidden === "function" && boardEventIsHidden(ev),
      unread: unread.count,
      firstUnread: unread.firstId,
      needsRsvp: boardEventNavNeedsRsvp(ev, rsvp, conn),
      state: typeof boardEventRsvpState === "function" ? boardEventRsvpState(ev, conn) : (rsvp === "out" ? "out" : rsvp ? "going" : "need"),
      ...boardEventNavLatest(ev, list),
    };
  });
}

/** An event this person still has to answer (and hasn't hidden): what the
 *  bar's "N new" counts. State rules live in boardEventRsvpState. */
function boardEventNavNeedsRsvp(ev, rsvp, conn) {
  const st = typeof boardEventRsvpState === "function" ? boardEventRsvpState(ev, conn) : (rsvp ? "going" : "need");
  if (st !== "need") return false;
  return !(typeof boardEventIsHidden === "function" && boardEventIsHidden(ev));
}

/** The latest message in an event's conversation, for the list preview. */
function boardEventNavLatest(ev, list) {
  for (let i = (list || []).length - 1; i >= 0; i--) {
    const m = list[i];
    if (!m || m.activity || m._eventLinkMarker) continue;
    const ids = typeof messageMentionedEventIds === "function" ? messageMentionedEventIds(m) : [m.eventId];
    if (!ids.includes(ev.id)) continue;
    const text = String((typeof shownField === "function" ? shownField(m._text, m.text) : (m._text || m.text)) || "").replace(/\s+/g, " ").trim();
    return { lastWho: m.name || "Someone", lastText: text };
  }
  return { lastWho: "", lastText: "" };
}

/* ── Bar ──────────────────────────────────────────────────────────────── */

/** What the closed bar says, plainly, so it's clear what it's for:
 *    events to answer → "2 events to answer" (bold: it needs you)
 *    otherwise        → "Next: Pub quiz night · Tomorrow" ("Now: …" while on)
 *    only undated     → "3 events, no dates yet"
 *    no events        → "No events yet" and a "New event" button
 *  The list chevron follows; "+" (create event) sits at the right. */
function boardEventNavBarState(items) {
  const fresh = items.filter((item) => item.needsRsvp).length;
  const count = items.length;
  if (!count) return { label: "", summary: "No events yet", fresh: 0, count: 0, empty: true };
  // Up next leads with something you might attend: skip events you can't go to.
  const next = items.find((item) => item.dated && item.state !== "out") || items.find((item) => item.dated) || null;
  if (!next) {
    return { label: "", summary: `${count} event${count === 1 ? "" : "s"}, no date${count === 1 ? "" : "s"} yet`, fresh, count };
  }
  const now = next.now;
  const time = now && typeof timelineTimeLabel === "function" ? timelineTimeLabel(next.ev, false) : "";
  return { label: now ? "Now" : "Next", next, when: time || next.day, fresh, count };
}

function boardEventNavBarHTML(items) {
  const st = boardEventNavBarState(items);
  const chev = typeof ic === "function" ? ic("chevron-down") : "\u2304";
  const plus = typeof ic === "function" ? ic("plus") : "+";
  const cal = typeof ic === "function" ? ic("calendar") : "";
  const open = !!(typeof S !== "undefined" && S.boardEventNavOpen);
  const canCreate = typeof boardWritableCreateChannel !== "function" || !!boardWritableCreateChannel();
  // Events are made from chat: muted until there's a message to make one from.
  const muted = canCreate && typeof featureParked === "function" && featureParked("manualCreate")
    && typeof boardHasChatMessages === "function" && !boardHasChatMessages();
  const lead = `<span class="board-event-bar-icon" aria-hidden="true">${cal}</span>`;
  if (st.empty) {
    return `<div id="board-event-bar" class="board-event-bar is-empty">
    <span class="board-event-bar-btn is-static">${lead}<span class="board-event-bar-copy"><span class="board-event-bar-summary">No events yet</span></span></span>
    ${canCreate ? `<button type="button" class="board-event-bar-new-event${muted ? " is-muted" : ""}" data-event-nav-create${muted ? ' aria-disabled="true"' : ""}>${plus}<span>New event</span></button>` : ""}
  </div>`;
  }
  let body;
  let aria;
  if (st.fresh) {
    const text = `${st.fresh > 99 ? "99+" : st.fresh} event${st.fresh === 1 ? "" : "s"} to answer`;
    body = `<span class="board-event-bar-copy"><span class="board-event-bar-ask">${esc(text)}</span></span>`;
    aria = text;
  } else if (st.next) {
    body = `<span class="board-event-bar-copy"><span class="board-event-bar-label">${esc(st.label)}:</span><span class="board-event-bar-name">${esc(st.next.title)}</span><span class="board-event-bar-when">\u00b7 ${esc(st.when)}</span></span>`;
    aria = `${st.label}: ${st.next.title}, ${st.when}`;
  } else {
    body = `<span class="board-event-bar-copy"><span class="board-event-bar-summary">${esc(st.summary)}</span></span>`;
    aria = st.summary;
  }
  aria += `. ${st.count} event${st.count === 1 ? "" : "s"}, show list`;
  return `<div id="board-event-bar" class="board-event-bar${open ? " is-open" : ""}${st.next?.now ? " is-now" : ""}${st.fresh ? " is-ask" : ""}"${st.next ? ` data-event="${esc(st.next.id)}"` : ""}>
    <button type="button" class="board-event-bar-btn" data-event-nav-toggle aria-haspopup="dialog" aria-expanded="${open ? "true" : "false"}" aria-label="${esc(aria)}">
      ${lead}${body}
      <span class="board-event-bar-chev" aria-hidden="true">${chev}</span>
    </button>
    ${canCreate ? `<button type="button" class="board-event-bar-add${muted ? " is-muted" : ""}" data-event-nav-create aria-label="${muted ? "Create event (send a message first)" : "Create event"}"${muted ? ' aria-disabled="true"' : ""}>${plus}</button>` : ""}
  </div>`;
}

/** The event list is the compact view of event chat. Each row shows what
 *  matters for its RSVP state:
 *    needs RSVP — bold name · date and time · one-tap ✓ / ✕ (no menu)
 *    going      — name and date · latest message (bold when unread)
 *    can't go   — faded name · date and time
 *  Sorted by event date, undated events last. Tapping a row goes to the
 *  event in All chat — its first unread message if there is one; the ›
 *  on the right opens the event page (details, sign-ups, its own chat). */
function boardEventNavListHTML(items) {
  const row = (item) => {
    const st = item.state || "need";
    const showChat = st === "going" || st === "none";
    const line2 = showChat && item.lastText
      ? `<span class="board-event-row-who">${esc(item.lastWho)}:</span> ${esc(item.lastText)}`
      : esc(item.hidden && st !== "out" ? `${item.when} \u00b7 Hidden in chat` : item.when);
    const answer = st === "need"
      ? `<span class="board-event-row-answer" role="group" aria-label="RSVP to ${esc(item.title)}">
          <button type="button" data-event-nav-answer="yes" data-event-id="${esc(item.id)}" aria-label="Going">${typeof ic === "function" ? ic("check") : "\u2713"}</button>
          <button type="button" data-event-nav-answer="no" data-event-id="${esc(item.id)}" aria-label="Can\u2019t go">${typeof ic === "function" ? ic("x") : "\u00d7"}</button>
        </span>`
      : "";
    const mode = showChat && item.unread && item.firstUnread ? "unread" : "start";
    const focus = typeof S !== "undefined" && S.boardEventStep?.eventId === item.id;
    const stateText = st === "need" ? "needs your RSVP" : st === "going" ? "going" : st === "out" ? "can\u2019t go" : "";
    const label = `${item.title}, ${item.when}${stateText ? `, ${stateText}` : ""}${showChat && item.unread ? `, ${item.unread} unread` : ""}`;
    return `<div class="board-event-row is-rsvp-${st}${item.hidden ? " is-hidden" : ""}${focus ? " is-focus" : ""}${showChat && item.unread ? " is-unread" : ""}" role="listitem">
      <button type="button" class="board-event-row-main" data-event-nav-go="${esc(item.id)}" data-event-nav-mode="${mode}" aria-label="${esc(label)}">
        ${(typeof boardEventIconHTML === "function" && boardEventIconHTML(item.ev, "board-event-row-icon")) || `<span class="board-event-row-icon" aria-hidden="true">${typeof ic === "function" ? ic("calendar") : ""}</span>`}
        <span class="board-event-row-copy">
          <span class="board-event-row-top"><span class="board-event-row-name">${esc(item.title)}</span>${showChat ? `<span class="board-event-row-when">${esc(item.day)}</span>` : ""}</span>
          <span class="board-event-row-last">${line2}</span>
        </span>
      </button>
      ${answer}
      <button type="button" class="board-event-row-open" data-event-nav-page="${esc(item.id)}" aria-label="Open ${esc(item.title)}">${typeof ic === "function" ? ic("chevron-right") : "\u203a"}</button>
    </div>`;
  };
  // Items arrive soonest first (boardEventNavItems); undated ones go last.
  // The heading is "Upcoming" (the dated events); undated ones follow under
  // their own label. The hint says what the two tap targets do.
  const group = (label, rows) => rows.length
    ? `${label ? `<p class="board-event-list-label">${esc(label)}</p>` : ""}<div role="list">${rows.map(row).join("")}</div>` : "";
  const dated = items.filter((item) => item.dated);
  const body = group("", dated) + group(dated.length ? "No date yet" : "", items.filter((item) => !item.dated));
  return `<div class="board-event-list-scrim" data-event-nav-close aria-hidden="true"></div>
  <div id="board-event-list" class="board-event-list" role="dialog" aria-label="Upcoming events in this chat">
    <div class="board-event-list-head">
      <span class="board-event-list-title">${dated.length ? "Upcoming" : "No date yet"}</span>
      <span class="board-event-list-hints" aria-hidden="true"><span>Tap icon to show in chat</span></span>
    </div>
    ${body}
  </div>`;
}

function boardEventNavSync(view) {
  view = view || document.getElementById("view");
  const scroll = view?.querySelector(":scope > #chat-scroll");
  const old = view?.querySelector(":scope > #board-event-bar");
  const wanted = !!scroll && boardEventNavWanted();
  const items = wanted ? boardEventNavItems() : [];
  if (!items.length) {
    view?.querySelectorAll(":scope > .board-event-list, :scope > .board-event-list-scrim").forEach((el) => el.remove());
    if (typeof S !== "undefined") S.boardEventNavOpen = false;
    boardEventStepClear();
    // No events yet: the bar stays, saying so, with "New event".
    if (!wanted) { old?.remove(); return; }
  }
  const html = boardEventNavBarHTML(items);
  if (!old || old._html !== html) {
    const holder = document.createElement("div");
    holder.innerHTML = html;
    const bar = holder.firstElementChild;
    bar._html = html;
    if (old) old.replaceWith(bar);
    else scroll.before(bar);
    bar.querySelector("[data-event-nav-toggle]")?.addEventListener("click", (e) => {
      e.preventDefault();
      if (S.boardEventNavOpen) boardEventNavClose();
      else boardEventNavOpen();
    });
    bar.querySelector("[data-event-nav-create]")?.addEventListener("click", (e) => {
      e.preventDefault();
      boardEventNavClose();
      if (typeof boardOpenCreateEvent === "function") boardOpenCreateEvent();
    });
  }
  if (S.boardEventNavOpen) boardEventNavPaintList(view, items);
  boardEventStepSync();
}

function boardEventNavPaintList(view, items) {
  view = view || document.getElementById("view");
  if (!view) return;
  view.querySelectorAll(":scope > .board-event-list, :scope > .board-event-list-scrim").forEach((el) => el.remove());
  const bar = view.querySelector(":scope > #board-event-bar");
  if (!bar) return;
  const list = items || boardEventNavItems();
  bar.insertAdjacentHTML("afterend", boardEventNavListHTML(list));
  const panel = view.querySelector(":scope > .board-event-list");
  const scrim = view.querySelector(":scope > .board-event-list-scrim");
  const top = bar.offsetTop + bar.offsetHeight;
  if (panel) panel.style.top = `${top}px`;
  if (scrim) scrim.style.top = `${top}px`;
  scrim?.addEventListener("click", (e) => { e.preventDefault(); boardEventNavClose(); });
  panel?.addEventListener("click", (e) => {
    const ans = e.target.closest?.("[data-event-nav-answer]");
    if (ans) {
      e.preventDefault();
      boardEventNavAnswer(ans.dataset.eventId, ans.dataset.eventNavAnswer === "yes");
      return;
    }
    const page = e.target.closest?.("[data-event-nav-page]");
    if (page) {
      e.preventDefault();
      boardEventNavClose();
      if (typeof boardOpenEventPage === "function") boardOpenEventPage(page.dataset.eventNavPage);
      return;
    }
    const go = e.target.closest?.("[data-event-nav-go]");
    if (!go) return;
    e.preventDefault();
    boardEventNavGo(go.dataset.eventNavGo, go.dataset.eventNavMode === "unread" ? "unread" : "start");
  });
}

/** One-tap RSVP from the list. RSVP can't go back to "unanswered", so the
 *  notice offers "Change" (switch to the other answer) rather than Undo. */
function boardEventNavAnswer(eventId, yes) {
  const conn = boardEventNavConn();
  const ev = typeof boardFindEvent === "function" ? boardFindEvent(eventId, null, conn) : null;
  if (!ev || typeof setEventRsvp !== "function") return;
  const choices = typeof eventRsvpChoiceStatuses === "function" ? eventRsvpChoiceStatuses(ev) : ["going", "out"];
  const yesStatus = choices.find((c) => c !== "out") || "going";
  const status = yes ? yesStatus : "out";
  if (setEventRsvp(ev.id, status) === false) return;
  const title = typeof boardEventTitle === "function" ? boardEventTitle(ev) : "the event";
  if (typeof renderView === "function") renderView(true);
  try {
    if (typeof AshFeedback !== "undefined" && AshFeedback.snackbar) {
      AshFeedback.snackbar({
        message: yes ? `Going to ${title}` : `Can\u2019t go to ${title}`,
        action: "Change",
        onUndo: () => {
          setEventRsvp(ev.id, yes ? "out" : yesStatus);
          if (typeof renderView === "function") renderView(true);
        },
      });
    }
  } catch {}
}

function boardEventNavOpen() {
  if (typeof S === "undefined") return;
  if (typeof boardSelectActive === "function" && boardSelectActive()) boardSelectClear();
  try { document.activeElement?.blur?.(); } catch {}
  S.boardEventNavOpen = true;
  document.body.classList.add("board-event-nav-open");
  const bar = document.getElementById("board-event-bar");
  bar?.classList.add("is-open");
  bar?.querySelector("[data-event-nav-toggle]")?.setAttribute("aria-expanded", "true");
  boardEventNavPaintList();
}

function boardEventNavClose() {
  if (typeof S === "undefined" || !S.boardEventNavOpen) return false;
  S.boardEventNavOpen = false;
  document.body.classList.remove("board-event-nav-open");
  document.querySelectorAll(".board-event-list, .board-event-list-scrim").forEach((el) => el.remove());
  const bar = document.getElementById("board-event-bar");
  bar?.classList.remove("is-open");
  bar?.querySelector("[data-event-nav-toggle]")?.setAttribute("aria-expanded", "false");
  return true;
}

/* ── Panning ──────────────────────────────────────────────────────────── */

function boardEventNavSel(id) {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(String(id)) : String(id).replace(/"/g, "");
}

/** The places the stepper stops at, top to bottom: the event card, then each
 *  block of the event. Blocks joined to the card or to the block above are
 *  part of that stop already. */
function boardEventStops(eventId) {
  const scroll = document.querySelector("#chat-scroll");
  if (!scroll || !eventId) return [];
  const sel = boardEventNavSel(eventId);
  return [...scroll.querySelectorAll(`.board-event-card[data-event="${sel}"], .board-msg-run[data-event="${sel}"]`)]
    .filter((el) => !el.classList.contains("is-pinned-compact")
      // A run that continues the chain above belongs to the same stop.
      && !(el.classList.contains("board-msg-run") && el.querySelector(":scope > .msg")?.classList.contains("chain-prev")));
}

function boardEventNavFlash(el) {
  if (!el) return;
  if (typeof boardFlashRun === "function") boardFlashRun(el);
  else {
    el.classList.add("is-arrive");
    setTimeout(() => el.classList.remove("is-arrive"), 1200);
  }
}

function boardEventPanTo(el) {
  const scroll = document.querySelector("#chat-scroll");
  if (!scroll || !el) return;
  const top = scroll.scrollTop + el.getBoundingClientRect().top - scroll.getBoundingClientRect().top - BOARD_EVENT_PAN_GAP;
  if (S.boardEventStep) S.boardEventStep.quietUntil = Date.now() + BOARD_EVENT_NAV_QUIET_MS;
  scroll.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  // A joined card + block flash together.
  const group = [el];
  let next = el.nextElementSibling;
  while (next && (next.classList.contains("is-attached") || next.classList.contains("join-above"))) {
    group.push(next);
    next = next.nextElementSibling;
  }
  group.forEach(boardEventNavFlash);
}

/** Go to an event in All chat. mode "start" lands on its card (or first block);
 *  "unread" on its first unread message. Hidden events whose messages aren't in
 *  All chat open the event's tag filter for unread instead. */
function boardEventNavGo(eventId, mode) {
  if (typeof S === "undefined" || !eventId) return;
  boardEventNavClose();
  if (typeof boardSelectActive === "function" && boardSelectActive()) boardSelectClear();
  if (S.boardFromChat) {
    S.boardFromChat = null;
    if (typeof renderView === "function") renderView(true);
  }
  // Picking an event from the list also tags the message box to it (no
  // keyboard): what you write next goes there. Done first — it re-renders.
  if (boardEventStops(eventId).length) boardEventNavTagFor(eventId);
  const item = boardEventNavItems().find((x) => x.id === eventId);
  const scroll = document.querySelector("#chat-scroll");
  if (!scroll) return;
  let target = null;
  let stopEl = null;
  if (mode === "unread" && item?.firstUnread) {
    const msg = scroll.querySelector(`.msg[data-msg-id="${boardEventNavSel(item.firstUnread)}"]`);
    if (msg) {
      target = msg;
      stopEl = msg.closest(".board-msg-run") || msg;
    } else if (typeof boardSelectTab === "function") {
      // Not in All chat (hidden event): the event's own chat has it.
      boardEventStepClear();
      boardSelectTab(eventId);
      return;
    }
  }
  const stops = boardEventStops(eventId);
  if (!target) {
    stopEl = stops[0] || null;
    target = stopEl;
  }
  if (!target) {
    if (typeof boardSelectTab === "function") boardSelectTab(eventId);
    return;
  }
  const prev = S.boardEventStep;
  S.boardEventStep = {
    eventId,
    source: "nav",
    returnAnchor: prev?.returnAnchor || (typeof boardScrollAnchor === "function" ? boardScrollAnchor() : null),
    quietUntil: Date.now() + BOARD_EVENT_NAV_QUIET_MS,
    prefilled: true,
  };
  if (mode === "unread" && target !== stopEl) {
    // Land on the message itself, flash its block.
    const top = scroll.scrollTop + target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - BOARD_EVENT_PAN_GAP;
    scroll.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    boardEventNavFlash(stopEl);
  } else {
    boardEventPanTo(target);
  }
  boardEventStepSync();
}

/** A message's #label: focus that event where you are — other events hide,
 *  its bar shows and the message box is tagged to it. Nothing scrolls. */
function boardEventNavFocus(eventId) {
  if (typeof S === "undefined" || !eventId || !boardEventNavWanted()) return;
  boardEventNavClose();
  if (S.boardEventStep?.eventId === eventId) { boardEventFocusExit(); return; }   // tap again to let go
  S.boardEventStep = {
    eventId,
    source: "nav",
    returnAnchor: null,
    quietUntil: Date.now() + BOARD_EVENT_NAV_QUIET_MS,
    prefilled: true,
  };
  // Focus and tag are one: the message box is tagged to the event too.
  boardEventNavTagFor(eventId);
  boardEventStepSync();
}

/* ── Stepper ──────────────────────────────────────────────────────────── */

/** Leave an event's focus, however it began (list jump, #label, tag or event
 *  icon): the stepper goes, other events show again, and a message box tag
 *  for this event is removed too (the draft text stays). */
function boardEventFocusExit() {
  if (typeof S === "undefined") return;
  const id = S.boardEventStep?.eventId || "";
  if (id && boardEventNavTaggedId() === id && typeof boardDestinationSet === "function") {
    S.boardEventStep = null;
    boardDestinationSet(null);
  }
  boardEventStepClear();
  boardEventStepSync();
}

function boardEventStepClear() {
  if (typeof S === "undefined") return;
  S.boardEventStep = null;
  boardEventStepRemove();
  boardEventFocusPaint(null);
}

function boardEventStepRemove() {
  const had = document.querySelectorAll("#board-event-stepper");
  had.forEach((el) => el.remove());
  document.body.classList.remove("board-event-stepping");
  if (had.length && typeof boardFloatComposer === "function") boardFloatComposer(document.getElementById("view"));
}

/** While an event is in focus (its stepper is up), other events' blocks and
 *  cards fade strongly and untagged chat lightly. Done with one generated
 *  rule keyed on data-event, so chat rows are never touched after render. */
/** What the reader is looking at, held in place while other events are
 *  hidden or shown: the focused event's first message in view, else the first
 *  message in view that stays visible either way (general chat). */
function boardEventFocusAnchor(eventId) {
  const scroll = document.querySelector("#chat-scroll");
  if (!scroll) return null;
  const atEnd = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 4;
  const box = scroll.getBoundingClientRect();
  let fallback = null;
  for (const el of scroll.querySelectorAll(".msg[data-msg-id], .board-event-card[data-event]")) {
    const ev = el.dataset.event || el.closest("[data-event]")?.dataset.event || "";
    if (ev && ev !== eventId) continue;
    const r = el.getBoundingClientRect();
    if (!r.height || r.bottom <= box.top + 1 || r.top >= box.bottom) continue;
    const hit = { el, offset: r.top - box.top, atEnd };
    if (eventId && ev === eventId) return hit;
    if (!fallback) fallback = hit;
  }
  return fallback || { el: null, offset: 0, atEnd };
}

function boardEventFocusRestore(anchor) {
  const scroll = document.querySelector("#chat-scroll");
  if (!scroll || !anchor) return;
  if (anchor.atEnd) { scroll.scrollTop = scroll.scrollHeight; return; }
  if (!anchor.el || !anchor.el.isConnected) return;
  scroll.scrollTop += (anchor.el.getBoundingClientRect().top - scroll.getBoundingClientRect().top) - anchor.offset;
}

/** Focus on one event (after a jump, a tag, or a #label): other events'
 *  messages and cards are hidden and general chat fades to half, as context. */
function boardEventFocusPaint(eventId) {
  if (typeof document === "undefined") return;
  const id = eventId ? String(eventId) : "";
  let tag = document.getElementById("board-step-focus-style");
  const key = id || "";
  const changed = (tag?.dataset.key || "") !== key;
  const anchor = changed ? boardEventFocusAnchor(id) : null;
  document.body.classList.toggle("board-step-focus", !!id);
  if (!id) {
    if (tag) { tag.textContent = ""; tag.dataset.key = ""; }
    if (changed) boardEventFocusRestore(anchor);
    return;
  }
  if (!tag) {
    tag = document.createElement("style");
    tag.id = "board-step-focus-style";
    document.head.appendChild(tag);
  }
  const sel = boardEventNavSel(id);
  const on = "body.board-step-focus:not(.board-selecting):not(.board-from-chat) #chat-scroll.is-board-feed";
  const css = `${on} .board-msg-run[data-event]:not([data-event="${sel}"]),
${on} .board-event-card:not([data-event="${sel}"]) { display: none; }
${on} .board-msg-run:not([data-event]) { opacity: 0.5; }
${on} .msg-event-tag[data-event-tag="${sel}"],
${on} .board-event-card[data-event="${sel}"] .board-event-title,
body.board-step-focus #board-event-bar[data-event="${sel}"] .board-event-bar-name { color: var(--accent); }
${on} .msg.chain-next[data-event="${sel}"]::after,
${on} .msg.chain-end[data-event="${sel}"]::after,
${on} .msg.chain-prev.head-gap[data-event="${sel}"]::before { background: var(--accent); }
${on} .msg[data-event="${sel}"] > .msg-ev-lead { border-color: var(--accent); color: var(--accent); }`;
  if (tag.textContent !== css) tag.textContent = css;
  tag.dataset.key = key;
  if (changed) boardEventFocusRestore(anchor);
}

/** Index of the stop the reader is at: the last one whose top has reached the
 *  landing line. -1 when above the first. */
function boardEventStepIndex(stops) {
  const scroll = document.querySelector("#chat-scroll");
  if (!scroll) return -1;
  const r = scroll.getBoundingClientRect();
  // At the very bottom nothing more can scroll up to the line: count the
  // stops that are in view instead, so the newest reads n/n.
  const atEnd = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 4;
  const line = atEnd ? r.bottom - 24 : r.top + BOARD_EVENT_PAN_GAP + 12;
  let idx = -1;
  stops.forEach((el, i) => { if (el.getBoundingClientRect().top <= line) idx = i; });
  return idx;
}

/** The event the message box is tagged to, if any. */
function boardEventNavTaggedId() {
  const target = typeof boardDestinationTarget === "function" ? boardDestinationTarget() : null;
  return target?.event && !target.event._missing ? target.eventId : "";
}

/** A tag in the message box shows that event's stepper (no pan). A jump from
 *  the event list ("nav") takes priority until it is closed. */
function boardEventStepFollowTag() {
  if (typeof S === "undefined") return;
  const tagged = boardEventNavTaggedId();
  const step = S.boardEventStep;
  if (tagged && (!step || (step.source === "tag" && step.eventId !== tagged))) {
    S.boardEventStep = { eventId: tagged, source: "tag", returnAnchor: null, quietUntil: 0 };
  } else if (!tagged && step?.source === "tag") {
    S.boardEventStep = null;
  }
}

function boardEventStepSync() {
  if (boardEventNavWanted()) boardEventStepFollowTag();
  const step = typeof S !== "undefined" ? S.boardEventStep : null;
  const view = document.getElementById("view");
  if (!step || !view || !boardEventNavWanted()) {
    if (step && !boardEventNavWanted()) S.boardEventStep = null;
    boardEventStepRemove();
    boardEventFocusPaint(null);
    return;
  }
  const stops = boardEventStops(step.eventId);
  const conn = boardEventNavConn();
  const ev = typeof boardFindEvent === "function" ? boardFindEvent(step.eventId, null, conn) : null;
  if (!stops.length || !ev || ev._missing) { boardEventStepClear(); return; }
  boardEventFocusPaint(step.eventId);
  const host = view.querySelector(":scope > .composer.is-board") || view;
  let el = host.querySelector(":scope > #board-event-stepper");
  if (!el) {
    view.querySelectorAll("#board-event-stepper").forEach((x) => x.remove());
    const up = typeof ic === "function" ? ic("chevron-up") : "↑";
    const down = typeof ic === "function" ? ic("chevron-down") : "↓";
    const x = typeof ic === "function" ? ic("x") : "×";
    el = document.createElement("div");
    el.id = "board-event-stepper";
    el.className = "board-event-stepper";
    el.setAttribute("role", "group");
    const more = typeof ic === "function" ? ic("chevron-right") : "\u203a";
    el.innerHTML = `<button type="button" class="board-event-stepper-name" data-event-step-page><span class="board-event-stepper-hash" aria-hidden="true">#</span><span class="board-event-stepper-title"></span>${more}</button>
      <button type="button" class="board-event-stepper-btn" data-event-step="-1" aria-label="Previous in this event">${up}</button>
      <span class="board-event-stepper-pos" aria-live="polite"></span>
      <button type="button" class="board-event-stepper-btn" data-event-step="1" aria-label="Next in this event">${down}</button>
      <button type="button" class="board-event-stepper-btn is-close" data-event-step-close aria-label="Leave this event">${x}</button>`;
    el.addEventListener("pointerdown", (e) => { if (e.target.closest("button")) e.preventDefault(); });
    el.addEventListener("click", (e) => {
      const btn = e.target.closest?.("button");
      if (!btn) return;
      e.preventDefault();
      if (btn.hasAttribute("data-event-step-close")) { boardEventFocusExit(); return; }
      if (btn.hasAttribute("data-event-step-page")) {
        const id = S.boardEventStep?.eventId;
        if (id && typeof boardOpenEventPage === "function") boardOpenEventPage(id);
        return;
      }
      boardEventStepMove(Number(btn.dataset.eventStep) || 0);
    });
    host.appendChild(el);
    if (typeof boardFloatComposer === "function") boardFloatComposer(view, { keep: true });
  }
  const title = typeof boardEventTitle === "function" ? boardEventTitle(ev) : "Event";
  const idx = boardEventStepIndex(stops);
  el.setAttribute("aria-label", `${title} in chat`);
  el.querySelector(".board-event-stepper-title").textContent = typeof boardEventShortLabel === "function" ? boardEventShortLabel(ev) : title;
  el.querySelector("[data-event-step-page]").setAttribute("aria-label", `Open ${title}`);
  el.querySelector(".board-event-stepper-pos").textContent = `${Math.max(1, idx + 1)}/${stops.length}`;
  const scroll = document.querySelector("#chat-scroll");
  const atEnd = !scroll || scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 4;
  el.querySelector('[data-event-step="-1"]').disabled = idx <= 0 && !boardEventStepInsideStop(stops, idx);
  // Past the event's last stop, ↓ goes on to the latest message (the stepper
  // stands in for the jump-to-latest button while it shows).
  const down = el.querySelector('[data-event-step="1"]');
  const toLatest = idx >= stops.length - 1;
  down.disabled = atEnd;
  down.setAttribute("aria-label", toLatest ? "Latest messages" : "Next in this event");
  document.body.classList.add("board-event-stepping");
  // One stop: nothing to step through.
  el.classList.toggle("is-single", stops.length < 2);
}

/** True when the reader is part-way down a long stop (↑ returns to its top). */
function boardEventStepInsideStop(stops, idx) {
  const scroll = document.querySelector("#chat-scroll");
  if (!scroll || idx < 0 || !stops[idx]) return false;
  const line = scroll.getBoundingClientRect().top + BOARD_EVENT_PAN_GAP;
  return stops[idx].getBoundingClientRect().top < line - 16;
}

function boardEventStepMove(dir) {
  const step = typeof S !== "undefined" ? S.boardEventStep : null;
  if (!step || !dir) return;
  const stops = boardEventStops(step.eventId);
  if (!stops.length) return;
  const idx = boardEventStepIndex(stops);
  let target;
  if (dir > 0 && idx >= stops.length - 1) {
    const scroll = document.querySelector("#chat-scroll");
    if (scroll) scroll.scrollTo({ top: scroll.scrollHeight, behavior: "smooth" });
    // Going to the latest ends a jump (as the old jump button did); a tag's
    // stepper stays while the tag does.
    setTimeout(() => {
      if (S.boardEventStep === step && step.source !== "tag") boardEventStepClear();
      boardEventStepSync();
    }, 500);
    return;
  }
  if (dir < 0) target = boardEventStepInsideStop(stops, idx) ? stops[idx] : stops[Math.max(0, idx - 1)];
  else target = stops[Math.min(stops.length - 1, idx + 1)];
  if (target) boardEventPanTo(target);
  setTimeout(boardEventStepSync, 450);
}

/* ── Scroll, seen cursors, back ───────────────────────────────────────── */

/** Called from the chat scroll listener. Keeps the stepper position current,
 *  drops it once the reader scrolls back to the latest messages themselves,
 *  and marks messages read as they come into view. */
function boardEventNavOnScroll(scroll) {
  const step = typeof S !== "undefined" ? S.boardEventStep : null;
  if (step) {
    const atEnd = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 4;
    if (atEnd && step.source !== "tag" && Date.now() > (step.quietUntil || 0)) {
      boardEventStepClear();
      boardEventStepSync();   // a tag in the message box brings its own stepper back
    }
    else boardEventStepSync();
  }
  clearTimeout(boardEventNavOnScroll.timer);
  boardEventNavOnScroll.timer = setTimeout(boardEventNavMarkSeen, 450);
}

/** Event messages on screen count as read for that event's "new" badge. */
function boardEventNavMarkSeen() {
  const scroll = document.querySelector("#chat-scroll");
  const conn = boardEventNavConn();
  const chId = boardEventNavChannelId();
  if (!scroll || !conn?.id || !chId || typeof setEventChatSeenTs !== "function" || !boardEventNavWanted()) return;
  const r = scroll.getBoundingClientRect();
  if (!r.height) return;
  const list = typeof boardActiveMessages === "function" ? boardActiveMessages() : [];
  const byId = new Map(list.map((m) => [m && m.id, m]));
  const newest = new Map();
  scroll.querySelectorAll(".msg[data-msg-id]").forEach((el) => {
    const b = el.getBoundingClientRect();
    if (b.bottom <= r.top || b.top >= r.bottom || !b.height) return;
    const m = byId.get(el.dataset.msgId);
    if (!m) return;
    const ids = typeof messageMentionedEventIds === "function" ? messageMentionedEventIds(m) : [m.eventId];
    for (const id of ids) if (id && (m.ts || 0) > (newest.get(id) || 0)) newest.set(id, m.ts || 0);
  });
  let changed = false;
  newest.forEach((ts, id) => {
    const before = typeof getEventChatSeenTs === "function" ? getEventChatSeenTs(conn.id, chId, id) : 0;
    if (!before || ts <= before) return;   // never seeded: nothing to clear
    setEventChatSeenTs(conn.id, chId, id, ts);
    changed = true;
  });
  if (changed) boardEventNavSync();
}

/** Android back: close the list, else return from a jump to where you were. */
function boardEventNavBack() {
  if (boardEventNavClose()) return true;
  const step = typeof S !== "undefined" ? S.boardEventStep : null;
  // A tag's stepper isn't a jump: Back has nothing to return to here.
  if (!step || step.source === "tag") return false;
  const anchor = step.returnAnchor;
  // The jump's tag goes with it (the draft stays).
  if (boardEventNavTaggedId() === step.eventId && typeof boardDestinationSet === "function") {
    S.boardEventStep = null;
    boardDestinationSet(null);
  }
  boardEventStepClear();
  // A focus from a #label didn't move the chat: nothing to return to.
  if (anchor && typeof boardRestoreScrollAnchor === "function") boardRestoreScrollAnchor(anchor);
  return true;
}

/** After a #label focus, tapping the message box pre-sets that event as the
 *  tag (a pick from the event list tags it straight away). Once per focus. */
function boardEventNavPrefillTag() {
  const step = typeof S !== "undefined" ? S.boardEventStep : null;
  if (!step || step.source !== "nav" || step.prefilled) return false;
  if (!boardEventNavWanted() || S.boardSelect || S.boardFromChat || S.replyToMessage) return false;
  if (typeof boardDestinationState === "undefined" || boardDestinationState.value || boardDestinationState.picker) return false;
  if (typeof canMutateContent === "function" && !canMutateContent()) return false;
  step.prefilled = true;
  return boardEventNavTagFor(step.eventId);
}

/** Tag the message box to an event (its latest conversation), keeping the
 *  draft and leaving the keyboard down. False when it can't be written to. */
function boardEventNavTagFor(eventId) {
  if (typeof S === "undefined" || S.boardSelect || S.boardFromChat) return false;
  if (typeof canMutateContent === "function" && !canMutateContent()) return false;
  if (typeof boardDestinationState !== "undefined" && boardDestinationState.value?.eventId === eventId) return true;
  const target = typeof boardContinueEventTargets === "function"
    ? boardContinueEventTargets().find((t) => t.eventId === eventId) : null;
  if (!target || typeof boardDestinationSet !== "function") return false;
  boardDestinationSet({ eventId: target.eventId, conversationId: target.conversationId, label: boardEventTitle(target.event) }, { focus: false });
  return true;
}

if (typeof document !== "undefined") {
  document.addEventListener("focusin", (e) => {
    if (e.target?.id === "composer-input") boardEventNavPrefillTag();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && typeof S !== "undefined" && S.boardEventNavOpen) {
      e.preventDefault();
      boardEventNavClose();
    }
  }, true);
}
