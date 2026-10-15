/* render-sidebar-reorder.js — long-press board settings + reorder-mode drag.
 * Globals out: ensureSidebarChannelReorder, enterSidebarChannelReorderMode,
 *   exitSidebarChannelReorderMode, confirmSidebarChannelReorderMode,
 *   undoSidebarChannelReorderMode, sidebarReorderSectionRows, paintSidebarReorderModeChrome,
 *   nudgeChannelIds, sidebarChannelSectionState, nudgeSidebarChannel
 * Load after: render-sidebar.js; before: render-cosmetics.js
 */

const SIDEBAR_REORDER_HOLD_MS = (typeof AshGesture !== "undefined" && AshGesture.HOLD_MS) || 500;
const SIDEBAR_REORDER_SLOP = (typeof AshGesture !== "undefined" && AshGesture.TAP_SLOP) || 12;

function ensureSidebarChannelReorder() {
  const list = document.getElementById("side-list");
  if (!list) return;
  if (typeof onceFlag === "function") {
    if (!onceFlag(list, "channelReorder")) return;
  } else if (list.dataset.channelReorder) {
    return;
  } else {
    list.dataset.channelReorder = "1";
  }
  list.addEventListener("pointerdown", onSidebarChannelHoldPointerDown);
}

function sidebarReorderSectionRows(list, section) {
  const key = String(section || "");
  if (key === "board") {
    return [...list.querySelectorAll(".side-board[data-board-id]")].filter(
      el => el.dataset.sideSection === "board"
    );
  }
  return [...list.querySelectorAll(".side-row[data-channel-id]")].filter(
    el => el.dataset.sideSection === key
  );
}

function persistSidebarChannelOrder(ids, section) {
  const conn = typeof activeConn === "function" ? activeConn() : null;
  if (!conn) return false;
  const key = String(section || "");
  if (key === "board") {
    if (!Array.isArray(conn.boards) || typeof applyChannelOrder !== "function") return false;
    const localIds = (ids || []).filter(id => {
      const b = conn.boards.find(x => x.id === id);
      return b && !b.sourceConnId;
    });
    if (!applyChannelOrder(conn.boards, localIds)) return false;
    if (typeof send === "function") send({ type: "reorderBoards", boardIds: localIds });
    return true;
  }
  if (!Array.isArray(conn.channels)) return false;
  if (typeof applyChannelOrder !== "function") return false;
  if (!applyChannelOrder(conn.channels, ids)) return false;
  if (typeof send === "function") send({ type: "reorderChannels", channelIds: ids });
  return true;
}

/** Swap channelId with its neighbour at index+delta. Null if it cannot move. */
function nudgeChannelIds(ids, channelId, delta) {
  const list = Array.isArray(ids) ? ids.map(String) : [];
  const id = String(channelId || "");
  const step = Number(delta) || 0;
  if (!id || !step) return null;
  const i = list.indexOf(id);
  if (i < 0) return null;
  const j = i + step;
  if (j < 0 || j >= list.length) return null;
  const next = list.slice();
  const tmp = next[i];
  next[i] = next[j];
  next[j] = tmp;
  return next;
}

function sidebarChannelSectionState(channelId) {
  if (typeof canManageServer === "function" && !canManageServer()) return null;
  if (typeof document === "undefined") return null;
  const list = document.getElementById("side-list");
  if (!list) return null;
  const idRaw = String(channelId || "");
  if (!idRaw) return null;
  let row = list.querySelector(`.side-row[data-channel-id="${CSS.escape(idRaw)}"], .side-board[data-board-id="${CSS.escape(idRaw)}"]`);
  if (!row) return null;
  let id = idRaw;
  if (row.classList.contains("side-row") && row.dataset.boardId) {
    id = row.dataset.boardId;
    row = list.querySelector(`.side-board[data-board-id="${CSS.escape(id)}"]`);
    if (!row) return null;
  }
  const section = row.dataset.sideSection;
  if (!section) return null;
  const peers = sidebarReorderSectionRows(list, section);
  const ids = peers.map((el) => el.dataset.channelId || el.dataset.boardId).filter(Boolean);
  const index = ids.indexOf(id);
  if (index < 0) return null;
  return { ids, index, count: ids.length, section };
}

function nudgeSidebarChannel(channelId, delta) {
  const state = sidebarChannelSectionState(channelId);
  if (!state) return false;
  const next = nudgeChannelIds(state.ids, channelId, delta);
  if (!next) return false;
  if (!persistSidebarChannelOrder(next, state.section)) return false;
  if (typeof renderSidebar === "function") renderSidebar();
  return true;
}

function sidebarReorderTouchPoint(e) {
  const t = e.changedTouches?.[0] || e.touches?.[0];
  return t ? { x: t.clientX, y: t.clientY } : null;
}

/** Freeze the drawer scroller — Android WebView otherwise pans and pointercancel. */
function lockSidebarReorderScroll(list) {
  const sidebar = list.closest(".sidebar") || list;
  const top = list.scrollTop;
  sidebar.classList.add("is-reordering");
  list.classList.add("is-reordering");
  list.dataset.reorderScrollTop = String(top);
  list.style.overflow = "hidden";
  list.style.touchAction = "none";
  sidebar.style.touchAction = "none";
  const freeze = () => { list.scrollTop = top; };
  list._ashReorderFreezeScroll = freeze;
  list.addEventListener("scroll", freeze, { passive: true });
  freeze();
}

function unlockSidebarReorderScroll(list) {
  const sidebar = list.closest(".sidebar") || list;
  const top = Number(list.dataset.reorderScrollTop);
  const freeze = list._ashReorderFreezeScroll;
  if (freeze) {
    list.removeEventListener("scroll", freeze);
    delete list._ashReorderFreezeScroll;
  }
  sidebar.classList.remove("is-reordering");
  list.classList.remove("is-reordering");
  list.style.overflow = "";
  list.style.touchAction = "";
  sidebar.style.touchAction = "";
  delete list.dataset.reorderScrollTop;
  if (!Number.isNaN(top)) list.scrollTop = top;
}

function paintSidebarReorderModeChrome() {
  const app = document.getElementById("app");
  const sidebar = document.getElementById("sidebar");
  const list = document.getElementById("side-list");
  if (!sidebar || !list) return;
  const on = !!S.sidebarReorderMode;
  app?.classList.toggle("is-sidebar-reorder-mode", on);
  sidebar.classList.toggle("is-reorder-mode", on);
  list.classList.toggle("is-reorder-mode", on);
  const section = S.sidebarReorderSection || "";
  list.querySelectorAll(".side-row[data-channel-id], .side-board[data-board-id]").forEach((row) => {
    if (row.classList.contains("is-board-child")) {
      row.classList.remove("side-row-reorder-target");
      return;
    }
    row.classList.toggle("side-row-reorder-target", on && row.dataset.sideSection === section);
  });
  list.querySelectorAll(".side-row, .side-label, .side-add-ch, .side-lists-cluster, .side-board").forEach((el) => {
    if (el.classList.contains("is-board-child")) {
      el.classList.remove("side-reorder-dimmed");
      return;
    }
    const keep = on && el.classList.contains("side-row-reorder-target");
    el.classList.toggle("side-reorder-dimmed", on && !keep);
  });

  let bar = document.getElementById("sidebar-reorder-bar");
  if (on) {
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "sidebar-reorder-bar";
      bar.className = "sidebar-reorder-bar";
      bar.innerHTML = `
        <button type="button" class="sidebar-reorder-undo" id="sidebar-reorder-undo">Undo</button>
        <button type="button" class="sidebar-reorder-confirm" id="sidebar-reorder-confirm">Confirm</button>`;
      bar.querySelector("#sidebar-reorder-undo")?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        undoSidebarChannelReorderMode();
      });
      bar.querySelector("#sidebar-reorder-confirm")?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        confirmSidebarChannelReorderMode();
      });
      sidebar.appendChild(bar);
    }
    bar.hidden = false;
    list.style.paddingBottom = "72px";
  } else {
    if (bar) bar.hidden = true;
    list.style.paddingBottom = "";
    list.querySelectorAll(".side-reorder-dimmed").forEach((el) => {
      el.classList.remove("side-reorder-dimmed");
    });
  }

  // Remove legacy single Done button if present from earlier builds.
  document.getElementById("sidebar-reorder-done")?.remove();
}

function restoreSidebarReorderDomOrder(list, section, ids) {
  if (!list || !section || !Array.isArray(ids) || !ids.length) return;
  const rowsById = new Map(
    sidebarReorderSectionRows(list, section).map((el) => [el.dataset.channelId || el.dataset.boardId, el])
  );
  const ordered = ids.map((id) => rowsById.get(id)).filter(Boolean);
  if (!ordered.length) return;
  const firstCurrent = sidebarReorderSectionRows(list, section)[0];
  let ref = null;
  for (let i = 0; i < ordered.length; i++) {
    const row = ordered[i];
    if (i === 0) {
      if (firstCurrent && firstCurrent !== row) list.insertBefore(row, firstCurrent);
      ref = row;
      continue;
    }
    if (ref.nextSibling !== row) list.insertBefore(row, ref.nextSibling);
    ref = row;
  }
}

function enterSidebarChannelReorderMode(section, channelId) {
  if (typeof canManageServer === "function" && !canManageServer()) return;
  const list = document.getElementById("side-list");
  if (!list) return;
  const sec = String(section || "");
  if (!sec) return;
  const peers = sidebarReorderSectionRows(list, sec);
  if (peers.length < 2) return;
  S.sidebarReorderMode = true;
  S.sidebarReorderSection = sec;
  S.sidebarReorderFocusId = channelId ? String(channelId) : null;
  S.sidebarReorderSnapshot = peers.map((el) => el.dataset.channelId || el.dataset.boardId).filter(Boolean);
  if (typeof cancelArmedSideNavTap === "function") cancelArmedSideNavTap();
  if (typeof suppressSideNavTaps === "function") suppressSideNavTaps(400);
  paintSidebarReorderModeChrome();
  // Briefly arm the focus row so the user sees which section is active.
  const focusId = S.sidebarReorderFocusId;
  const focus = focusId && (
    list.querySelector(`.side-board[data-board-id="${CSS.escape(focusId)}"]`)
    || list.querySelector(`.side-row[data-channel-id="${CSS.escape(focusId)}"]`)
  );
  if (focus) {
    focus.classList.add("side-row-hold-armed");
    setTimeout(() => focus.classList.remove("side-row-hold-armed"), 500);
  }
}

function confirmSidebarChannelReorderMode() {
  if (!S.sidebarReorderMode) return;
  const list = document.getElementById("side-list");
  const section = S.sidebarReorderSection;
  if (list && section) {
    const ids = sidebarReorderSectionRows(list, section)
      .map((el) => el.dataset.channelId || el.dataset.boardId)
      .filter(Boolean);
    const snap = S.sidebarReorderSnapshot || [];
    if (ids.join("\0") !== snap.join("\0")) {
      persistSidebarChannelOrder(ids, section);
    }
  }
  exitSidebarChannelReorderMode();
}

function undoSidebarChannelReorderMode() {
  if (!S.sidebarReorderMode) return;
  const list = document.getElementById("side-list");
  const section = S.sidebarReorderSection;
  const snap = S.sidebarReorderSnapshot;
  if (list && section && Array.isArray(snap) && snap.length) {
    restoreSidebarReorderDomOrder(list, section, snap);
  }
  exitSidebarChannelReorderMode();
}

function exitSidebarChannelReorderMode() {
  S.sidebarReorderMode = false;
  S.sidebarReorderSection = null;
  S.sidebarReorderFocusId = null;
  S.sidebarReorderSnapshot = null;
  paintSidebarReorderModeChrome();
}

/** Long-press a board header → board settings; in reorder mode → immediate drag. */
function onSidebarChannelHoldPointerDown(e) {
  if (S.sidebarReorderActive) return;
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const list = e.currentTarget;
  if (!list || list.id !== "side-list") return;
  const boardWrap = e.target.closest(".side-board[data-board-id]");
  const row = e.target.closest(".side-row[data-channel-id]");
  if ((!row && !boardWrap) || (row && !list.contains(row)) || (boardWrap && !list.contains(boardWrap))) return;
  if (e.target.closest(".side-add-ch")) return;
  const liftEl = boardWrap || row;
  const section = liftEl.dataset.sideSection;
  if (!section) return;
  const boardId = boardWrap?.dataset.boardId || "";

  if (S.sidebarReorderMode) {
    if (section !== S.sidebarReorderSection) return;
    if (typeof canManageServer === "function" && !canManageServer()) {
      exitSidebarChannelReorderMode();
      return;
    }
    const peers = sidebarReorderSectionRows(list, section);
    if (peers.length < 2) {
      exitSidebarChannelReorderMode();
      return;
    }
    e.preventDefault();
    if (typeof cancelArmedSideNavTap === "function") cancelArmedSideNavTap();
    beginSidebarChannelDrag(
      { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY },
      list,
      liftEl,
      section
    );
    return;
  }

  const pinnedHold = row
    && (section === "pinned" || section === "pinned-people")
    && row.dataset.channelId
    && typeof canManageServer === "function"
    && canManageServer();
  const boardHeadHold = e.target.closest(".side-board-head") && boardId;
  if (!pinnedHold && !boardHeadHold) return;

  const sx = e.clientX, sy = e.clientY;
  let holdTimer = 0;

  const clearHold = () => {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
    liftEl.classList.remove("side-row-hold-armed");
  };

  const abortWait = () => {
    clearHold();
    document.removeEventListener("pointermove", onWaitMove);
    document.removeEventListener("pointerup", onWaitUp);
    document.removeEventListener("pointercancel", onWaitUp);
  };

  const onWaitMove = (e2) => {
    if (Math.hypot(e2.clientX - sx, e2.clientY - sy) > SIDEBAR_REORDER_SLOP) abortWait();
  };
  const onWaitUp = () => abortWait();

  liftEl.classList.add("side-row-hold-armed");
  holdTimer = setTimeout(() => {
    holdTimer = 0;
    abortWait();
    if (!liftEl.isConnected) return;
    if (typeof cancelArmedSideNavTap === "function") cancelArmedSideNavTap();
    if (typeof suppressSideNavTaps === "function") suppressSideNavTaps(500);
    if (pinnedHold) {
      if (typeof openPinnedChannelSheet === "function") openPinnedChannelSheet(row.dataset.channelId);
      return;
    }
    if (typeof openBoardSettingsSheet === "function") openBoardSettingsSheet(boardId);
  }, SIDEBAR_REORDER_HOLD_MS);

  document.addEventListener("pointermove", onWaitMove);
  document.addEventListener("pointerup", onWaitUp);
  document.addEventListener("pointercancel", onWaitUp);
}

function beginSidebarChannelDrag(originEvent, list, liftEl, section) {
  S.sidebarReorderActive = true;
  if (typeof cancelArmedSideNavTap === "function") cancelArmedSideNavTap();
  if (typeof suppressSideNavTaps === "function") suppressSideNavTaps(700);
  lockSidebarReorderScroll(list);
  liftEl.classList.add("side-row-reordering");
  const originNext = liftEl.nextSibling;
  const pointerId = originEvent.pointerId;
  let originX = originEvent.clientX;
  let originY = originEvent.clientY;
  let moved = false;

  try { liftEl.setPointerCapture(pointerId); } catch {}

  const paintLift = (clientX, clientY) => {
    const dx = clientX - originX;
    const dy = clientY - originY;
    liftEl.style.transition = "none";
    liftEl.style.transform =
      `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(1.03)`;
  };

  const flipSwap = (mutate) => {
    const others = sidebarReorderSectionRows(list, section).filter(el => el !== liftEl);
    const first = new Map(others.map(el => [el, el.getBoundingClientRect()]));
    const liftBefore = liftEl.getBoundingClientRect();
    mutate();
    const liftAfter = liftEl.getBoundingClientRect();
    originX += liftAfter.left - liftBefore.left;
    originY += liftAfter.top - liftBefore.top;
    others.forEach(el => {
      const f = first.get(el);
      if (!f) return;
      const l = el.getBoundingClientRect();
      const dy = f.top - l.top;
      if (Math.abs(dy) < 0.5) return;
      el.style.transition = "none";
      el.style.transform = `translateY(${dy.toFixed(1)}px)`;
      el.getBoundingClientRect();
      el.style.transition = "transform .28s cubic-bezier(.22, 1.15, .36, 1)";
      el.style.transform = "";
    });
  };

  const moveSlot = (clientY) => {
    const others = sidebarReorderSectionRows(list, section).filter(el => el !== liftEl);
    let insertBefore = null;
    for (const sib of others) {
      const r = sib.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) { insertBefore = sib; break; }
    }
    if (!insertBefore) {
      const last = others[others.length - 1];
      insertBefore = last ? last.nextSibling : null;
      if (insertBefore === liftEl) insertBefore = liftEl.nextSibling;
    }
    if (insertBefore === liftEl || insertBefore === liftEl.nextSibling) return;
    moved = true;
    flipSwap(() => {
      if (insertBefore) list.insertBefore(liftEl, insertBefore);
      else list.appendChild(liftEl);
    });
  };

  const dragTo = (x, y) => {
    moveSlot(y);
    paintLift(x, y);
  };

  const unbind = () => {
    document.removeEventListener("pointermove", onPtrMove, true);
    document.removeEventListener("pointerup", onPtrUp, true);
    document.removeEventListener("pointercancel", onPtrCancel, true);
    document.removeEventListener("touchmove", onTouchMove, true);
    document.removeEventListener("touchend", onTouchEnd, true);
    document.removeEventListener("touchcancel", onTouchCancel, true);
  };

  const finish = (commit) => {
    if (finish.done) return;
    finish.done = true;
    unbind();
    try { liftEl.releasePointerCapture(pointerId); } catch {}
    unlockSidebarReorderScroll(list);
    liftEl.classList.remove("side-row-reordering");
    liftEl.style.transition = "transform .22s cubic-bezier(.22, 1.15, .36, 1)";
    liftEl.style.transform = "";
    const shouldCommit = commit && (moved || liftEl.nextSibling !== originNext);
    if (!shouldCommit && originNext !== liftEl.nextSibling) {
      if (originNext) list.insertBefore(liftEl, originNext);
      else list.appendChild(liftEl);
    }
    S.sidebarReorderActive = false;
    if (typeof suppressSideNavTaps === "function") suppressSideNavTaps(500);
    // In explicit reorder mode, keep DOM changes provisional until Confirm.
    if (S.sidebarReorderMode) {
      paintSidebarReorderModeChrome();
    } else if (shouldCommit) {
      const ids = sidebarReorderSectionRows(list, section)
        .map(el => el.dataset.channelId)
        .filter(Boolean);
      persistSidebarChannelOrder(ids);
    }
    setTimeout(() => {
      if (!liftEl.isConnected) return;
      liftEl.style.transition = "";
      liftEl.style.transform = "";
    }, 260);
  };

  const onPtrMove = (e2) => {
    if (e2.pointerId !== pointerId) return;
    e2.preventDefault();
    dragTo(e2.clientX, e2.clientY);
  };
  const onPtrUp = (e2) => {
    if (e2.pointerId !== pointerId) return;
    e2.preventDefault();
    finish(true);
  };
  // Scroller may cancel the pointer — keep going on touchmove until the finger lifts.
  const onPtrCancel = (e2) => {
    if (e2.pointerId !== pointerId) return;
    e2.preventDefault();
  };
  const onTouchMove = (e2) => {
    const p = sidebarReorderTouchPoint(e2);
    if (!p) return;
    e2.preventDefault();
    dragTo(p.x, p.y);
  };
  const onTouchEnd = (e2) => {
    const p = sidebarReorderTouchPoint(e2);
    if (p) dragTo(p.x, p.y);
    if (e2.cancelable) e2.preventDefault();
    finish(true);
  };
  const onTouchCancel = (e2) => {
    if (e2.cancelable) e2.preventDefault();
  };

  paintLift(originEvent.clientX, originEvent.clientY);
  document.addEventListener("pointermove", onPtrMove, { capture: true, passive: false });
  document.addEventListener("pointerup", onPtrUp, { capture: true });
  document.addEventListener("pointercancel", onPtrCancel, { capture: true });
  document.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
  document.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });
  document.addEventListener("touchcancel", onTouchCancel, { capture: true, passive: false });
}
