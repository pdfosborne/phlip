/* board-card.js — the event card in All chat (a message from its creator) and its RSVP control.
 *
 * A compact box: title · date and time · place, RSVP bottom right; a dark
 * outline while it waits for your answer. The whole box
 * opens the event, except RSVP; a long-press opens its sheet (Hide / Show
 * chat, Open event). A hidden event keeps "Show chat" on the card.
 *
 * Globals in:  shared board/chat state (S, Nav, activeConn)
 * Globals out: boardEventCardHTML, boardEventPlace, boardEventPlaceHTML, boardEventRsvpControl, boardOpenRsvpMenu, boardCloseRsvpMenu, boardOpenEventCardSheet
 * Load after:  board-model.js
 * Load before: board-feed.js
 *
 * Must not: ES modules, bundlers, unrelated feature work
 */

/** RSVP on a card or event head. Needs an answer: a black ✓ and an outlined
 *  ✕ (the primary action on the screen, same as the event list). Answered:
 *  quiet status text — "✓ Going" / "Can't go" — that opens the menu to
 *  change it. Nothing when you can't answer and haven't. */
function boardEventRsvpControl(mine, ev) {
  const st = ev && typeof boardEventRsvpState === "function" ? boardEventRsvpState(ev) : "";
  const icon = (n) => (typeof ic === "function" ? ic(n) : "");
  if (st === "need") {
    const title = typeof boardEventTitle === "function" ? boardEventTitle(ev) : "this event";
    return `<div class="board-rsvp is-ask" role="group" aria-label="RSVP to ${esc(title)}">
      <button type="button" class="board-rsvp-yes" data-board-rsvp-answer="yes" data-event-id="${esc(ev.id)}" aria-label="Going">${icon("check")}</button>
      <button type="button" class="board-rsvp-no" data-board-rsvp-answer="no" data-event-id="${esc(ev.id)}" aria-label="Can\u2019t go">${icon("x")}</button>
    </div>`;
  }
  const going = mine === "going";
  const out = mine === "out";
  if (!going && !out) return "";
  const label = going ? "Going" : "Can\u2019t go";
  const mark = going ? `<span class="board-rsvp-check">${icon("check")}</span>` : "";
  return `<div class="board-rsvp"><button type="button" class="board-rsvp-toggle${going ? " is-going" : " is-out"}" data-board-rsvp-menu aria-haspopup="menu" aria-expanded="false" aria-label="${label}, change">${mark}<span class="board-rsvp-label">${label}</span></button></div>`;
}

if (typeof document !== "undefined") {
  // ✓ / ✕ on a card or the event head: answer in one tap (Change in the notice).
  document.addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-board-rsvp-answer]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof boardEventNavAnswer === "function") boardEventNavAnswer(btn.dataset.eventId, btn.dataset.boardRsvpAnswer === "yes");
  }, true);
}

function boardCloseRsvpMenu() {
  document.querySelectorAll("#chat-scroll .board-rsvp-menu").forEach((el) => el.remove());
  document.querySelectorAll("#chat-scroll .board-rsvp-toggle").forEach((btn) => {
    btn.setAttribute("aria-expanded", "false");
  });
  document.querySelectorAll("#chat-scroll .board-event-card.is-rsvp-open").forEach((card) => {
    card.classList.remove("is-rsvp-open");
  });
}

function boardOpenRsvpMenu(btn) {
  const card = btn?.closest(".board-event-card");
  if (!card || !btn) return;
  boardCloseRsvpMenu();
  const eventId = card.dataset.event || "";
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const ev = boardFindEvent(eventId, conn?.events, conn);
  if (!ev || typeof openEventRsvpMenu !== "function") return;
  // "Hide chat" lives on the card's third row (not in this menu).
  openEventRsvpMenu(ev, btn, () => {
    if (typeof renderView === "function") renderView(true);
  });
}

function boardOpenTasksForEvent(ev, conn) {
  if (!ev?.id || !conn) return [];
  const chatCh = (conn.channels || []).find((c) => c.id === ev.channelId)
    || (conn.channels || []).find((c) => c.kind === "chat" && c.boardId
      && (conn.channels || []).some((t) => t.boardId === c.boardId && t.kind === "task"));
  const taskCh = typeof boardTaskChannelForChat === "function"
    ? boardTaskChannelForChat(chatCh, conn)
    : (chatCh?.boardId
      ? (conn.channels || []).find((c) => c.boardId === chatCh.boardId && c.kind === "task")
      : null);
  if (!taskCh) return [];
  const eventId = String(ev.id);
  return (Array.isArray(conn.tasks) ? conn.tasks : []).filter((task) => {
    if (String(task?.channelId || "") !== String(taskCh.id)) return false;
    if (String(task?.eventId || "") !== eventId) return false;
    return !(task?.completed === true || task?.done === true);
  });
}

function boardEventTaskTitle(task) {
  if (typeof shownField === "function" && task && "text" in task) {
    return String(shownField(task._text, task.text) || "");
  }
  return String(task?._text || task?.text || task?.title || "");
}

function boardEventTasksHTML(ev) {
  const inEventTab = typeof S !== "undefined" && !!S.chatFilterEventId
    && String(S.chatFilterEventId) === String(ev?.id || "");
  if (!inEventTab || !ev || (typeof featureParked === "function" && featureParked("tasks"))) return "";
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const tasks = boardOpenTasksForEvent(ev, conn);
  const expanded = !!(typeof S !== "undefined" && S.boardExpandedEventTasks?.[ev.id]);
  const n = tasks.length;
  const label = n ? `Tasks (${n})` : "No tasks";
  const chevron = typeof ic === "function" ? ic("chevron-down") : "";
  const rows = tasks.length
    ? tasks.map((task) => {
      const title = boardEventTaskTitle(task) || "Task";
      return `<div class="board-event-task-row" data-task-id="${esc(task.id)}">
        <button type="button" class="board-event-task-complete" aria-pressed="false"
          aria-label="Complete ${esc(title)}"><span aria-hidden="true"></span></button>
        <span class="board-event-task-title">${esc(title)}</span>
      </div>`;
    }).join("")
    : `<p class="board-event-tasks-empty">No open tasks</p>`;
  return `<div class="board-event-tasks${expanded ? " is-open" : ""}" data-event="${esc(ev.id)}">
    <button type="button" class="board-event-tasks-toggle" data-board-event-tasks="${esc(ev.id)}"
      aria-expanded="${expanded ? "true" : "false"}">
      <span class="board-event-tasks-label">${esc(label)}</span>
      <span class="board-event-tasks-caret" aria-hidden="true">${chevron}</span>
    </button>
    ${expanded ? `<div class="board-event-tasks-list">${rows}</div>` : ""}
  </div>`;
}

/* ── The place: a name, linked to its map ────────────────────────────────
   A location given as a link shows as the place's name (from the link, or
   looked up for a short maps.app.goo.gl link and remembered on this phone),
   linked to the map. Whoever can edit the event saves that name as the
   location (the link moves to the event's Map), so everyone sees the name. */
const BOARD_PLACE_NAMES_KEY = "phlip-map-names-v1";
let boardPlaceNames = null;
const boardPlaceResolving = new Set();
const boardPlaceHealed = new Set();

function boardPlaceNameCache() {
  if (!boardPlaceNames) {
    try { boardPlaceNames = JSON.parse(localStorage.getItem(BOARD_PLACE_NAMES_KEY) || "{}") || {}; } catch { boardPlaceNames = {}; }
  }
  return boardPlaceNames;
}

function boardRememberPlaceName(href, name) {
  const cache = boardPlaceNameCache();
  cache[href] = name;
  try { localStorage.setItem(BOARD_PLACE_NAMES_KEY, JSON.stringify(cache)); } catch { /* memory only */ }
}

/** Saves a looked-up name as the event's location (editors only, once). */
async function boardHealEventPlace(ev, href, name) {
  if (!ev || !ev.id || !name || boardPlaceHealed.has(ev.id)) return;
  if (typeof canEditEvent === "function" && !canEditEvent(ev)) return;
  boardPlaceHealed.add(ev.id);
  const conn = (typeof ownerConnFor === "function" ? ownerConnFor(ev) : null)
    || (typeof activeConn === "function" ? activeConn() : null);
  if (!conn || typeof send !== "function") return;
  try {
    const enc = async (t) => (typeof encrypt === "function" ? encrypt(t, conn.key) : t);
    if (typeof mergeEventMapDetails === "function" && typeof eventDetailsPlain === "function") {
      const details = mergeEventMapDetails(eventDetailsPlain(ev), href);
      const dc = await enc(details);
      send({ type: "setEventDetails", eventId: ev.id, details: dc }, conn.id);
      ev.details = dc;
      ev._details = details;
    }
    const wc = await enc(name);
    send({ type: "setEventWhere", eventId: ev.id, where: wc }, conn.id);
    ev.where = wc;
    ev._where = name;
    if (typeof rememberPlaceMapUrl === "function") rememberPlaceMapUrl(name, href);
  } catch { boardPlaceHealed.delete(ev.id); }
}

function boardResolvePlaceName(ev, href) {
  if (boardPlaceResolving.has(href) || typeof resolveMapLink !== "function") return;
  boardPlaceResolving.add(href);
  // The phone's lookup follows the short link's redirects and holds the page
  // while it does, so it waits for the chat to settle first (once per link).
  new Promise((resolve) => setTimeout(resolve, 800)).then(() => resolveMapLink(href)).then((found) => {
    const name = String(found?.name || "").trim();
    if (!name) return;
    boardRememberPlaceName(href, name);
    void boardHealEventPlace(ev, href, name);
    if (typeof renderView === "function") renderView();
  }).catch(() => { /* stays as a map link */ });
}

/** { text, href } for the card's place line; href "" when there's no link. */
function boardEventPlace(ev) {
  const raw = String((typeof timelineEventPlace === "function" ? timelineEventPlace(ev) : ev?._where) || "").trim();
  if (!raw) return { text: "", href: "" };
  CHAT_LINK_RE.lastIndex = 0;
  const m = typeof CHAT_LINK_RE !== "undefined" ? CHAT_LINK_RE.exec(raw) : null;
  if (m) {
    const url = chatSplitLink(m[0]).url;
    const href = chatLinkHref(url);
    const rest = (raw.slice(0, m.index) + " " + raw.slice(m.index + url.length))
      .replace(/\s+/g, " ").replace(/^[\s,·–—:-]+|[\s,·–—:@-]+$/g, "").replace(/\s+(?:at|@)$/i, "").trim();
    const map = typeof parseMapLink === "function" ? parseMapLink(href) : null;
    const known = map?.name || boardPlaceNameCache()[href] || "";
    if (rest) return { text: rest, href };
    if (known) {
      if (map) void boardHealEventPlace(ev, href, known);
      return { text: known, href };
    }
    if (map) boardResolvePlaceName(ev, href);
    let host = "";
    try { host = new URL(href).hostname.replace(/^www\./i, ""); } catch { host = url; }
    return { text: map ? "Map location" : host, href };
  }
  const mapHref = (typeof eventMapUrl === "function" ? eventMapUrl(ev) : "")
    || (typeof mapUrlForKnownPlace === "function" ? mapUrlForKnownPlace(raw) : "");
  return { text: raw, href: mapHref || "" };
}

function boardEventPlaceHTML(ev) {
  const place = boardEventPlace(ev);
  if (!place.text) return "";
  // A linked place shows just its name: the part before the first comma
  // ("Macclesfield Tennis Club", not the full address).
  const short = place.href ? (place.text.split(",")[0].trim() || place.text) : place.text;
  return place.href
    ? `<a class="board-event-meta-text board-event-place-link" href="${esc(place.href)}" target="_blank" rel="noopener noreferrer" data-board-place-link aria-label="${esc(place.text)}">${esc(short)}</a>`
    : `<span class="board-event-meta-text">${esc(place.text)}</span>`;
}

function boardEventCardHTML(ev, { compact = false, ts = 0 } = {}) {
  if (!ev) return "";
  const title = boardEventTitle(ev);
  const when = typeof conversationWhenLabel === "function" ? conversationWhenLabel(ev) : "";
  const where = ev._where || "";
  const mine = typeof timelineMyRsvp === "function" ? timelineMyRsvp(ev) : null;
  if (compact) {
    const detail = [when || "Time to be decided", boardEventPlace(ev).text].filter(Boolean).join(" · ");
    return `<section class="board-event-card is-pinned-compact" data-event="${esc(ev.id)}" aria-label="${esc(title)} event">
      <div class="board-event-top"><button type="button" class="board-event-title" data-board-event-page="${esc(ev.id)}" aria-label="Open ${esc(title)}"><span class="board-event-title-text">${esc(title)}</span></button>${boardEventRsvpControl(mine, ev)}</div>
      <div class="board-event-facts"><span class="board-event-meta-text">${esc(detail)}</span></div>
    </section>`;
  }
  // In All chat the event reads as a message from whoever added it, led by the
  // event (its icon in the left column: tap to message this event), with the
  // creator's face, name and time on the name line, then the event box
  // (title, when · where, RSVP; the whole box opens the event).
  const hidden = boardEventIsHidden(ev);
  const inEventTab = typeof S !== "undefined" && !!S.chatFilterEventId;
  const who = ev.createdByName || (typeof eventOrganiserName === "function" ? eventOrganiserName(ev) : "") || "Someone";
  const uid = ev.createdBy || "";
  const created = Number(ev.createdAt) || 0;
  const fallback = Number(ts) || 0;
  const at = created && (!fallback || created <= fallback) && created <= Date.now() ? created : (fallback || created);
  // Three rows: title + RSVP · date and time · place. The only button on the
  // card is RSVP; "Hide chat" is in the long-press sheet
  // (boardOpenEventCardSheet). A hidden event keeps "Show chat" on the card —
  // the visible way back.
  const st = boardEventRsvpState(ev);
  // Icon > date > time when another event in view shares this icon.
  const leadExtras = !inEventTab && typeof boardLeadExtras === "function" ? boardLeadExtras(ev) : [];
  const fold = !inEventTab && hidden
    ? `<button type="button" class="board-event-fold" data-board-show="${esc(ev.id)}">Show chat</button>`
    : "";
  return `<section class="board-event-card is-message is-rsvp-${st}${hidden ? " is-collapsed" : ""}" data-event="${esc(ev.id)}" aria-label="${esc(title)} event, added by ${esc(who)}">
    <div class="msg head-gap board-event-msg${leadExtras.length ? ` lead-sub-${leadExtras.length}` : ""}" data-event="${esc(ev.id)}">
      <button type="button" class="msg-ev-lead${leadExtras.length ? ` has-sub has-sub-${leadExtras.length}` : ""}" data-board-lead-event="${esc(ev.id)}" aria-label="Message in ${esc([title, ...leadExtras].join(", "))}">${boardEventLeadInnerHTML(ev, leadExtras)}</button>
      <div class="msg-main">
        <div class="msg-meta"><span class="avatar msg-who-face" style="${typeof avatarStyle === "function" ? avatarStyle(uid) : ""}" aria-hidden="true">${typeof avatarFaceHtml === "function" ? avatarFaceHtml(uid, who) : ""}</span><span class="who"${typeof roleNameStyle === "function" && roleNameStyle(uid) ? ` style="${roleNameStyle(uid)}"` : ""}>${esc(who)}</span><span class="when">${esc(boardMessageWhenLabel(at))}</span><span class="board-event-added">added an event</span></div>
        <div class="board-event-box${fold ? " has-fold" : ""}" data-board-event-page="${esc(ev.id)}">
          <div class="board-event-top">
            <button type="button" class="board-event-title" data-board-event-page="${esc(ev.id)}" aria-label="Open ${esc(title)}"><span class="board-event-title-text">${esc(title)}</span></button>
            ${boardEventRsvpControl(mine, ev)}
          </div>
          ${fold}
          <div class="board-event-facts">
            <span class="board-event-meta-text board-event-when-line">${esc(when || "Time to be decided")}</span>
            ${where ? `<span class="board-event-place-line">${boardEventPlaceHTML(ev)}</span>` : ""}
          </div>
          ${boardEventTasksHTML(ev)}
        </div>
      </div>
    </div>
  </section>`;
}

/* ── Long-press on an event card: its sheet ─────────────────────────────
   Hold the card (not its RSVP or icon) → Hide / Show chat and Open event.
   The tap that ends the hold doesn't also open the event. */
const BOARD_CARD_HOLD_MS = 480;

function boardOpenEventCardSheet(eventId) {
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const ev = typeof boardFindEvent === "function" ? boardFindEvent(eventId, null, conn) : null;
  if (!ev || ev._missing || typeof AshModal === "undefined" || !AshModal.open) return false;
  const title = typeof boardEventTitle === "function" ? boardEventTitle(ev) : "Event";
  const opened = AshModal.open({
    className: "channel-settings-sheet chat-msg-sheet board-card-sheet",
    html: `<div class="channel-settings-sheet-card chat-msg-sheet-card" tabindex="-1" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="channel-settings-sheet-handle" aria-hidden="true"></div>
        <p class="board-card-sheet-title">${esc(title)}</p>
        <div class="chat-msg-sheet-body" role="menu"></div>
      </div>`,
    singleton: "replace",
    graceMs: 280,
    closeOnBackdrop: true,
    trapFocus: true,
    initialFocus: ".chat-msg-sheet-card",
  });
  if (!opened) return false;
  const body = opened.overlay.querySelector(".chat-msg-sheet-body");
  const hidden = typeof boardEventIsHidden === "function" && boardEventIsHidden(ev);
  const item = (icon, label, run) => {
    const btn = typeof chatMsgOptionsItem === "function"
      ? chatMsgOptionsItem({ icon, label, onClick: () => { opened.close(); run(); } })
      : null;
    if (btn) { btn.dataset.boardCardAct = icon; body.appendChild(btn); }
  };
  item(hidden ? "eye" : "eye-off", hidden ? "Show chat" : "Hide chat", () => {
    if (typeof boardSetEventOverride === "function") boardSetEventOverride(ev.id, !hidden);
    if (typeof renderView === "function") renderView(true);
  });
  item("arrow-up-right", "Open event", () => {
    if (typeof boardOpenEventPage === "function") boardOpenEventPage(ev.id);
  });
  return true;
}

if (typeof document !== "undefined") {
  const hold = { timer: 0, x: 0, y: 0, card: null, until: 0 };
  const stop = () => { clearTimeout(hold.timer); hold.timer = 0; hold.card = null; };
  const target = (e) => {
    const card = e.target.closest?.("#chat-scroll .board-event-card.is-message[data-event]");
    if (!card || e.target.closest(".board-rsvp, .msg-ev-lead, [data-board-show]")) return null;
    return card;
  };
  document.addEventListener("pointerdown", (e) => {
    stop();
    if (e.button && e.button !== 0) return;
    const card = target(e);
    if (!card || (typeof S !== "undefined" && (S.boardSelect || S.boardFromChat))) return;
    hold.card = card;
    hold.x = e.clientX;
    hold.y = e.clientY;
    hold.timer = setTimeout(() => {
      const id = hold.card?.dataset.event;
      stop();
      if (id && boardOpenEventCardSheet(id)) {
        hold.until = Date.now() + 700;
        try { navigator.vibrate?.(10); } catch {}
      }
    }, BOARD_CARD_HOLD_MS);
  }, true);
  document.addEventListener("pointermove", (e) => {
    if (hold.card && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 8) stop();
  }, true);
  document.addEventListener("pointerup", () => { if (hold.timer) stop(); }, true);
  document.addEventListener("pointercancel", stop, true);
  // The click that ends a hold must not open the event underneath.
  document.addEventListener("click", (e) => {
    if (Date.now() < hold.until && e.target.closest?.("#chat-scroll .board-event-card")) {
      e.preventDefault();
      e.stopPropagation();
      hold.until = 0;
    }
  }, true);
  document.addEventListener("contextmenu", (e) => {
    const card = target(e);
    if (!card) return;
    e.preventDefault();
    stop();
    boardOpenEventCardSheet(card.dataset.event);
  }, true);
}
