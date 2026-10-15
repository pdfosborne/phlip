/* board-drag.js — drag picked messages onto an event in All chat.
 *
 * A left-to-right swipe on general chat starts the tag state (board-select.js):
 * messages are picked by tapping, and every event in view shows as a place to
 * drop. Press a picked message briefly (or, with a mouse, just drag it) and
 * all the picked messages lift off together; dropping on an event's messages,
 * icon or card adds them to that event, with Undo. A quick swipe still
 * scrolls the chat.
 *
 * Globals in:  S, activeConn, boardFindEvent, boardEventTitle,
 *   boardEventShortLabel, boardWriteMessagesToEvent, boardSelectSnackbar,
 *   boardScrollAnchor, boardRestoreScrollAnchor, renderView, esc
 * Globals out: boardDragActive, boardDropZonesPaint
 * Load after:  board-select.js
 * Load before: board-event-nav.js
 *
 * Must not: ES modules, bundlers, unrelated feature work
 */

const BOARD_DRAG_HOLD_MS = 180;
const BOARD_DRAG_SLOP_PX = 8;
const BOARD_DRAG_EDGE_PX = 56;

const boardDragState = { press: null, drag: null };

function boardDragActive() {
  return !!boardDragState.drag;
}

/** Everything picked in the tag state, in chat order. */
function boardDragGroup() {
  return [...document.querySelectorAll("#chat-scroll .msg.is-selected[data-msg-id]")];
}

/** Drop zones: one per stretch of an event in the chat — its card and the
 *  messages that follow, consecutive messages about it — rather than one per
 *  line. Client-coordinate boxes, in chat order. */
function boardDropZones() {
  const scroll = document.querySelector("#chat-scroll.is-board-feed");
  if (!scroll) return [];
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const box = scroll.getBoundingClientRect();
  const own = typeof boardOwnEvents === "function" ? boardOwnEvents() : null;
  const ownIds = own ? new Set(own.map((ev) => ev.id)) : null;
  const zones = [];
  let cur = null;
  for (const el of scroll.querySelectorAll(".board-event-card[data-event], .msg[data-msg-id]")) {
    if (el.classList.contains("msg") && el.closest(".board-event-card")) continue;
    const rects = el.getClientRects();
    if (!rects.length) continue; // hidden (another event while one is in focus)
    const id = el.dataset.event || "";
    const r = el.getBoundingClientRect();
    if (!id) { cur = null; continue; }
    if (cur && cur.eventId === id) {
      cur.bottom = Math.max(cur.bottom, r.bottom);
      continue;
    }
    const ev = typeof boardFindEvent === "function" ? boardFindEvent(id, null, conn) : null;
    if (!ev || ev._missing || (ownIds && !ownIds.has(id))
        || (typeof boardEventCompleted === "function" && boardEventCompleted(ev))) { cur = null; continue; }
    cur = { eventId: id, top: r.top, bottom: r.bottom, left: box.left + 4, right: box.right - 4 };
    zones.push(cur);
  }
  return zones;
}

/** The event under a point: the drop zone that contains it. */
function boardDragEventAt(x, y) {
  const zones = boardDragState.drag?.zones || boardDropZones();
  const scroll = document.querySelector("#chat-scroll.is-board-feed");
  const box = scroll?.getBoundingClientRect();
  if (!box || y < box.top || y > box.bottom) return "";
  const hit = zones.find((z) => y >= z.top - 6 && y <= z.bottom + 6 && x >= z.left && x <= z.right);
  return hit ? hit.eventId : "";
}

/** Paints the zones over the chat while tagging (a layer in #view, so the
 *  chat's own rows are never touched). The one under the finger fills in. */
function boardDropZonesPaint() {
  const view = document.getElementById("view");
  const on = typeof S !== "undefined" && !!S.boardSelect?.tagging;
  let layer = view?.querySelector(":scope > #board-drop-zones");
  if (!on || !view) { layer?.remove(); return; }
  const scroll = document.querySelector("#chat-scroll.is-board-feed");
  if (!scroll) { layer?.remove(); return; }
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "board-drop-zones";
    layer.className = "board-drop-zones";
    layer.setAttribute("aria-hidden", "true");
    view.appendChild(layer);
  }
  if (!scroll._dropZonesWired) {
    scroll._dropZonesWired = true;
    scroll.addEventListener("scroll", () => {
      if (typeof S !== "undefined" && S.boardSelect?.tagging) requestAnimationFrame(boardDropZonesPaint);
    }, { passive: true });
  }
  const viewBox = view.getBoundingClientRect();
  const box = scroll.getBoundingClientRect();
  layer.style.top = `${Math.round(box.top - viewBox.top)}px`;
  layer.style.left = `${Math.round(box.left - viewBox.left)}px`;
  layer.style.width = `${Math.round(box.width)}px`;
  layer.style.height = `${Math.round(box.height)}px`;
  const zones = boardDropZones();
  if (boardDragState.drag) boardDragState.drag.zones = zones;
  const target = boardDragState.drag?.target || "";
  const conn = typeof activeConn === "function" ? activeConn() : null;
  layer.innerHTML = zones.map((z) => {
    const ev = boardFindEvent(z.eventId, null, conn);
    const name = typeof boardEventShortLabel === "function" ? boardEventShortLabel(ev) : boardEventTitle(ev);
    return `<div class="board-drop-zone${z.eventId === target ? " is-over" : ""}" data-zone="${esc(z.eventId)}" style="top:${Math.round(z.top - box.top - 4)}px;height:${Math.round(z.bottom - z.top + 8)}px"><span class="board-drop-zone-name">#${esc(name)}</span></div>`;
  }).join("");
}

function boardDragPaintTarget(eventId) {
  const drag = boardDragState.drag;
  if (!drag || drag.target === eventId) return;
  drag.target = eventId;
  document.querySelectorAll("#board-drop-zones .board-drop-zone").forEach((el) => el.classList.toggle("is-over", el.dataset.zone === eventId));
  const hint = drag.ghost.querySelector(".board-drag-hint");
  if (eventId) {
    const ev = boardFindEvent(eventId, null, typeof activeConn === "function" ? activeConn() : null);
    const name = typeof boardEventShortLabel === "function" ? boardEventShortLabel(ev) : boardEventTitle(ev);
    if (hint) hint.textContent = `Add to #${name}`;
  } else if (hint) {
    hint.textContent = "Drop on an event";
  }
  drag.ghost.classList.toggle("is-over", !!eventId);
}

function boardDragStart(press, x, y) {
  const scroll = document.querySelector("#chat-scroll.is-board-feed");
  if (!scroll) return;
  const els = boardDragGroup();
  if (!els.length) return;
  const first = press.msg.getBoundingClientRect();
  const ghost = document.createElement("div");
  ghost.className = "board-drag-ghost";
  ghost.setAttribute("aria-hidden", "true");
  ghost.innerHTML = `<div class="board-drag-hint">Drop on an event</div>`;
  // The ghost shows the pressed message; more picked ones show as a count.
  for (const el of [press.msg]) {
    const copy = el.cloneNode(true);
    copy.removeAttribute("data-msg-id");
    copy.removeAttribute("data-chat-key");
    copy.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
    ghost.appendChild(copy);
  }
  if (els.length > 1) ghost.insertAdjacentHTML("beforeend", `<div class="board-drag-more">+${els.length - 1} more</div>`);
  ghost.style.width = `${Math.round(first.width)}px`;
  document.body.appendChild(ghost);
  els.forEach((el) => el.classList.add("is-drag-source"));
  document.body.classList.add("board-dragging");
  boardDragState.drag = {
    pointerId: press.pointerId,
    ids: els.map((el) => el.dataset.msgId).filter(Boolean),
    els,
    ghost,
    dx: x - first.left,
    dy: y - first.top,
    x,
    y,
    target: null,
    raf: 0,
    scroll,
  };
  try { press.handle.setPointerCapture(press.pointerId); } catch {}
  boardDropZonesPaint();
  boardDragMove(x, y);
  boardDragAutoScroll();
}

function boardDragMove(x, y) {
  const drag = boardDragState.drag;
  if (!drag) return;
  drag.x = x;
  drag.y = y;
  drag.ghost.style.transform = `translate(${Math.round(x - drag.dx)}px, ${Math.round(y - drag.dy - 26)}px)`;
  boardDragPaintTarget(boardDragEventAt(x, y));
}

/** Near the top or bottom of the chat, scroll so far-away events are reachable. */
function boardDragAutoScroll() {
  const drag = boardDragState.drag;
  if (!drag) return;
  const box = drag.scroll.getBoundingClientRect();
  let step = 0;
  if (drag.y < box.top + BOARD_DRAG_EDGE_PX) step = -Math.ceil((box.top + BOARD_DRAG_EDGE_PX - drag.y) / 4);
  else if (drag.y > box.bottom - BOARD_DRAG_EDGE_PX) step = Math.ceil((drag.y - (box.bottom - BOARD_DRAG_EDGE_PX)) / 4);
  if (step) {
    drag.scroll.scrollTop += step;
    boardDropZonesPaint();
    boardDragPaintTarget(boardDragEventAt(drag.x, drag.y));
  }
  drag.raf = requestAnimationFrame(boardDragAutoScroll);
}

function boardDragEnd(drop) {
  const drag = boardDragState.drag;
  boardDragState.drag = null;
  if (!drag) return;
  cancelAnimationFrame(drag.raf);
  drag.ghost.remove();
  drag.els.forEach((el) => el.classList.remove("is-drag-source"));
  document.querySelectorAll("#board-drop-zones .is-over").forEach((el) => el.classList.remove("is-over"));
  document.body.classList.remove("board-dragging");
  if (drop && drag.target && typeof S !== "undefined") {
    S.boardSelect = null;
    if (typeof boardSelectSync === "function") boardSelectSync();
  }
  // The tap that ends a drag must not also open or select anything.
  const swallow = (e) => { e.preventDefault(); e.stopPropagation(); };
  document.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => document.removeEventListener("click", swallow, { capture: true }), 400);
  if (!drop || !drag.target) return;
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const ev = boardFindEvent(drag.target, null, conn);
  if (!ev || ev._missing || typeof boardWriteMessagesToEvent !== "function") return;
  const anchor = typeof boardScrollAnchor === "function" ? boardScrollAnchor() : null;
  const done = boardWriteMessagesToEvent(drag.ids.map((id) => ({ id })), drag.target);
  if (typeof renderView === "function") renderView(true);
  if (typeof boardRestoreScrollAnchor === "function") boardRestoreScrollAnchor(anchor);
  if (done && typeof boardSelectSnackbar === "function") {
    const n = done.count;
    boardSelectSnackbar(`${n === 1 ? "Added to" : `Added ${n} messages to`} ${boardEventTitle(ev)}`, done.channelId, done.snapshot);
  }
}

function boardDragCancelPress() {
  const press = boardDragState.press;
  if (press) clearTimeout(press.timer);
  boardDragState.press = null;
}

(function wireBoardDrag() {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  // Capture phase: in the tag state a press on a picked message belongs to
  // dragging, not to the chat's other gestures.
  document.addEventListener("pointerdown", (e) => {
    if (typeof S === "undefined" || !S.boardSelect?.tagging) return;
    const msg = e.target.closest?.("#chat-scroll.is-board-feed .msg.is-selected[data-msg-id]");
    if (!msg || (e.button != null && e.button !== 0)) return;
    const handle = msg;
    e.stopPropagation();
    boardDragCancelPress();
    const press = { handle, msg, pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, ready: e.pointerType === "mouse", timer: 0 };
    // Touch: hold briefly to pick up, so a swipe that starts on a face scrolls.
    if (!press.ready) {
      press.timer = setTimeout(() => {
        if (boardDragState.press !== press) return;
        press.ready = true;
        boardDragStart(press, press.x, press.y);
      }, BOARD_DRAG_HOLD_MS);
    }
    boardDragState.press = press;
  }, true);

  document.addEventListener("pointermove", (e) => {
    const drag = boardDragState.drag;
    if (drag) {
      if (e.pointerId !== drag.pointerId) return;
      e.preventDefault();
      boardDragMove(e.clientX, e.clientY);
      return;
    }
    const press = boardDragState.press;
    if (!press || e.pointerId !== press.pointerId) return;
    press.x = e.clientX;
    press.y = e.clientY;
    const moved = Math.hypot(e.clientX - press.sx, e.clientY - press.sy) > BOARD_DRAG_SLOP_PX;
    if (!moved) return;
    if (press.ready) {
      boardDragState.press = null;
      boardDragStart(press, e.clientX, e.clientY);
    } else {
      boardDragCancelPress(); // moved before the hold: it's a scroll
    }
  }, true);

  // Once a drag is on, the chat must not scroll under the finger.
  document.addEventListener("touchmove", (e) => {
    if (boardDragState.drag) e.preventDefault();
  }, { passive: false, capture: true });

  document.addEventListener("pointerup", (e) => {
    if (boardDragState.drag && e.pointerId === boardDragState.drag.pointerId) boardDragEnd(true);
    else boardDragCancelPress();
  }, true);
  document.addEventListener("pointercancel", () => {
    boardDragCancelPress();
    if (boardDragState.drag) boardDragEnd(false);
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && boardDragState.drag) boardDragEnd(false);
  });
  // No context menu (or long-press select) from holding a picked message.
  document.addEventListener("contextmenu", (e) => {
    if (typeof S !== "undefined" && S.boardSelect?.tagging && e.target.closest?.("#chat-scroll .msg.is-selected")) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
})();
