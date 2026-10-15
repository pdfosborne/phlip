/* channel-agenda.js — board helpers: today anchor, period label, head taps, edge swipes.
 * Globals out: landOnTodayWeekView, anchorDay, periodMonthLabel, wireBoardHeadTap,
 *   attachModeSwipe, attachSwipeBack, attachDoubleTapBack, eventSourceConnIconHTML
 * Month / Week / Day zoom and period navigation are archived (archive/web/A-month-week-day).
 * Load after: channel-history.js; before: channel-memory.js
 */

// Historical name retained for callers; Events always opens in the Timeline.
function landOnTodayWeekView() {
  S.anchor = 0;           // 0 → today via anchorDay()
  S.viewingHistory = false;
}

const anchorDay = () => S.anchor || dayStart(Date.now());

// Header label for the viewed period. Month + week use a short month name
// (Feb) so the ‹ › control stays compact; year only when it differs.
function periodMonthLabel(ts) {
  const a = new Date(ts);
  const month = a.toLocaleDateString([], { month: "short" }).replace(/\.$/, "");
  return a.getFullYear() !== new Date().getFullYear()
    ? `${month} ${a.getFullYear()}`
    : month;
}

/**
 * Board-head controls: activate on pointerup (click is unreliable inside a
 * pan scroller on Android — especially right after a week swipe rebuild).
 * Shared suppress: renderView() replaces the button, so a per-element flag
 * would miss the delayed synthetic click on the new node (and double-cycle
 * filters / zoom / period arrows).
 */
let _boardHeadTapSuppressUntil = 0;
function wireBoardHeadTap(el, fn) {
  if (!el || typeof fn !== "function") return;
  let sx = 0, sy = 0, armed = false;
  const run = () => {
    if (el.disabled) return;
    try { fn(); } catch (err) { console.error(err); }
  };
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) { armed = false; return; }
    if (el.disabled) { armed = false; return; }
    sx = e.clientX; sy = e.clientY; armed = true;
  });
  el.addEventListener("pointerup", (e) => {
    if (!armed) return;
    armed = false;
    if (Math.hypot(e.clientX - sx, e.clientY - sy) > 14) return;
    // Android WebView may dispatch the synthetic click well after pointerup
    // when the timeline was just panned / rebuilt. Treat the real release as
    // the action and suppress that delayed duplicate across re-renders.
    _boardHeadTapSuppressUntil = performance.now() + 500;
    e.preventDefault();
    e.stopPropagation();
    run();
  });
  el.addEventListener("pointercancel", () => { armed = false; });
  el.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (performance.now() < _boardHeadTapSuppressUntil) return;
    run();
  });
}

// Edge swipe on a board: from the right ~10% → open the server/channel panel,
// unless the caller passed navOnly (INT-3: only the four reserved full-width
// swipes). Narrow LTR anywhere on .main is attachMainNavSheetSwipe.
function attachModeSwipe(el, { openNavOnRight = false, navOnly = false, openChannelPanelOnLeft = true } = {}) {
  let sx = 0, sy = 0, st = 0, live = false, fromRightEdge = false;
  let suppressClickUntil = 0;
  const onDown = (e) => {
    const edge = Math.max(28, innerWidth * 0.1);
    const nearRight = e.clientX >= innerWidth - edge;
    // Edge pulls open drawers — win over buttons (detail close, scrim, share).
    if (nearRight) {
      if (e.target.closest(".card-hand, input, textarea")) {
        live = false;
        return;
      }
      sx = e.clientX; sy = e.clientY; st = performance.now(); live = true;
      fromRightEdge = true;
      return;
    }
    if (e.target.closest(".card-hand, input, textarea, button, form, select")) {
      live = false;
      return;
    }
    sx = e.clientX; sy = e.clientY; st = performance.now(); live = true;
    fromRightEdge = false;
  };
  const onUp = (e) => {
    if (!live) return; live = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    const dt = performance.now() - st;
    const G = typeof AshGesture !== "undefined" ? AshGesture : null;
    const axisH = (G && typeof G.axisLocked === "function")
      ? (dx !== 0 && Math.abs(dx) >= Math.abs(dy) && G.axisLocked(dx, dy))
      : Math.abs(dx) > Math.abs(dy) * 1.15;
    const commitH = (G && typeof G.shouldCommit === "function")
      ? G.shouldCommit({ distance: dx, travel: 96, dt })
      : Math.abs(dx) >= 24;
    // Right-edge → channel panel. navOnly callers already have the reserved
    // main-sheet / nav / overlay / panel swipes; don't add a fifth.
    if (!navOnly && fromRightEdge && openChannelPanelOnLeft && dx < 0 && axisH && commitH) {
      try {
        if (window.Onboarding?.ftueBlockNavEdgeSwipe?.()) return;
      } catch {}
      suppressClickUntil = performance.now() + 450;
      try { e.preventDefault(); } catch {}
      if (typeof openActiveEventOrChannelPanel === "function") {
        openActiveEventOrChannelPanel();
      } else {
        openChannelPanel(activeChannelForPanel());
      }
    }
  };
  // Capture so event-detail close / share buttons can't eat the edge start.
  el.addEventListener("pointerdown", onDown, true);
  el.addEventListener("pointerup", onUp, true);
  el.addEventListener("click", (e) => {
    if (performance.now() >= suppressClickUntil) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  el.addEventListener("pointercancel", () => { live = false; }, true);
}

// Swipe right or double-tap to leave a detail page (same thresholds as the
// events-board swipe / timeline double-tap undo).
function attachSwipeBack(el, onBack) {
  let sx = 0, sy = 0, st = 0, live = false;
  let lastTap = 0;
  const TAP_MS = (typeof AshGesture !== "undefined" && AshGesture.DOUBLE_TAP_MS) || 320;
  const TAP_SLOP = (typeof AshGesture !== "undefined" && AshGesture.TAP_SLOP) || 12;
  el.addEventListener("pointerdown", (e) => {
    if (e.target.closest("input, textarea, button, form, select, a")) { live = false; return; }
    sx = e.clientX; sy = e.clientY; st = performance.now(); live = true;
  });
  el.addEventListener("pointerup", (e) => {
    if (!live) return; live = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    const dt = performance.now() - st;
    const G = typeof AshGesture !== "undefined" ? AshGesture : null;
    const axisH = (G && typeof G.axisLocked === "function")
      ? (dx > 0 && Math.abs(dx) >= Math.abs(dy) && G.axisLocked(dx, dy))
      : (Math.abs(dx) > Math.abs(dy) * 1.6 && dx > 0);
    const travel = el.clientWidth || innerWidth;
    const commitH = (G && typeof G.shouldCommit === "function")
      ? G.shouldCommit({ distance: dx, travel, dt })
      : dx > 60;
    if (axisH && commitH) { lastTap = 0; onBack(); return; }
    // Double-tap → same as back (event detail / notifications).
    if (Math.hypot(dx, dy) > TAP_SLOP || dt > 400) return;
    const now = performance.now();
    if (now - lastTap < TAP_MS) {
      lastTap = 0;
      onBack();
      return;
    }
    lastTap = now;
  });
  el.addEventListener("pointercancel", () => { live = false; });
}

// Double-tap to leave a scroll pane that already has its own swipe handlers
// (e.g. chat's left-edge → sidebar).
function attachDoubleTapBack(el, onBack) {
  let sx = 0, sy = 0, st = 0, live = false;
  let lastTap = 0;
  const TAP_MS = 320, TAP_SLOP = 12;
  el.addEventListener("pointerdown", (e) => {
    if (e.target.closest("input, textarea, button, form, select, a")) { live = false; return; }
    sx = e.clientX; sy = e.clientY; st = performance.now(); live = true;
  });
  el.addEventListener("pointerup", (e) => {
    if (!live) return; live = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    const dt = performance.now() - st;
    if (Math.hypot(dx, dy) > TAP_SLOP || dt > 400) return;
    const now = performance.now();
    if (now - lastTap < TAP_MS) {
      lastTap = 0;
      onBack();
      return;
    }
    lastTap = now;
  });
  el.addEventListener("pointercancel", () => { live = false; });
}

// On the personal collated timeline an event may live on a remote server — name
// that server (with an offline dot) so its origin is clear. Blank for a purely
// local personal event or when viewing a server directly.
function eventSourceConnIconHTML(connId) {
  const conn = S.conns[connId];
  if (!conn || PersonalSpace.isPersonal(conn)) return ic("pin", "ico-inline");
  return `<span class="ticket-server-ico" aria-hidden="true">${connIconHTML(conn)}</span>`;
}
