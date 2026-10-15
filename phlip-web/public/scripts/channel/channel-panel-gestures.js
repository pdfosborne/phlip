/* channel-panel-gestures.js — nav sheet / side-overlay / channel-panel swipes.
 * Globals out: attachNavDismissSwipe, attachMainNavSheetSwipe,
 *   attachSideOverlaySwipeBack, attachChannelPanelDismissSwipe,
 *   NAV_DISMISS_IGNORE
 * Load after: channel-panel.js / channel-panel-actions.js
 */

/** Chrome that should stay tap-only. Channel rows / board heads are NOT listed —
 *  RTL swipe on those closes the overlay drawer. */
const NAV_DISMISS_IGNORE = "input, textarea, select, form, .side-add-ch, .side-feel-btn, .side-server-menu-btn, .side-user-chip, .side-overlay-back, #side-share-btn";

function attachNavDismissSwipe() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  // Always refresh tap handlers (safe to rebind) so asset bumps stick.
  try { ensureSideNavTaps(); } catch {}
  if (typeof onceFlag === "function") {
    if (!onceFlag(sidebar, "navDismissSwipe")) return;
  } else if (sidebar.dataset.navDismissSwipe) {
    return;
  } else {
    sidebar.dataset.navDismissSwipe = "1";
  }
  let sx = 0, sy = 0, st = 0, tracking = false, live = false;
  let ignoreCancel = false;
  // Track press so sync-driven renderSidebar() doesn't wipe buttons mid-tap.
  sidebar.addEventListener("pointerdown", (e) => { try { noteSidebarPointer(e, true); } catch {} }, true);
  sidebar.addEventListener("pointerup", (e) => { try { noteSidebarPointer(e, false); } catch {} }, true);
  sidebar.addEventListener("pointercancel", (e) => { try { noteSidebarPointer(e, false); } catch {} }, true);
  sidebar.addEventListener("pointerdown", (e) => {
    // Don't arm dismiss during open grace, or on add/menu/form chrome.
    if (performance.now() < suppressNavDismissUntil) { tracking = false; live = false; return; }
    if (e.target.closest(NAV_DISMISS_IGNORE)) {
      tracking = false; live = false;
      return;
    }
    sx = e.clientX; sy = e.clientY; st = performance.now();
    tracking = true; live = false;
  });
  sidebar.addEventListener("pointermove", (e) => {
    if (!tracking || live) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    // Vertical scroll wins — abandon dismiss.
    if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) {
      tracking = false;
      return;
    }
    const G = typeof AshGesture !== "undefined" ? AshGesture : null;
    const lockedRtl = (G && typeof G.axisLocked === "function")
      ? (dx < 0 && Math.abs(dx) >= Math.abs(dy) && G.axisLocked(dx, dy))
      : (dx < -12 && Math.abs(dx) > Math.abs(dy) * 1.2);
    if (lockedRtl) {
      live = true;
      try { if (typeof cancelArmedSideNavTap === "function") cancelArmedSideNavTap(); } catch {}
      ignoreCancel = true;
      try { sidebar.setPointerCapture(e.pointerId); } catch {}
      ignoreCancel = false;
    }
  });
  sidebar.addEventListener("pointerup", (e) => {
    const wasLive = live;
    tracking = false; live = false;
    if (!wasLive) return;
    if (!Panel.navOpen()) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    const dt = performance.now() - st;
    const G = typeof AshGesture !== "undefined" ? AshGesture : null;
    const axisH = (G && typeof G.axisLocked === "function")
      ? (dx < 0 && Math.abs(dx) >= Math.abs(dy) && G.axisLocked(dx, dy))
      : Math.abs(dx) > Math.abs(dy) * 1.15;
    const travel = sidebar.getBoundingClientRect().width || innerWidth;
    const committed = (G && typeof G.shouldCommit === "function")
      ? G.shouldCommit({ distance: dx, travel, dt })
      : dx < -48;
    if (axisH && committed) {
      try { if (typeof cancelArmedSideNavTap === "function") cancelArmedSideNavTap(); } catch {}
      closeNav();
    }
  });
  sidebar.addEventListener("pointercancel", (e) => {
    if (ignoreCancel) return;
    // Board/channel rows are <button> actions; aborting their click on
    // capture handoff must not drop a locked RTL dismiss (INT-3).
    if ((tracking || live) && e.target && e.target !== sidebar) return;
    tracking = false; live = false;
  });
  attachSideOverlaySwipeBack();
}

/** Narrow: LTR anywhere on .main slides the sheet to reveal full-screen nav. */
function attachMainNavSheetSwipe() {
  const main = document.querySelector(".main");
  const app = document.getElementById("app");
  if (!main || !app) return;
  if (typeof onceFlag === "function") {
    if (!onceFlag(main, "navSheetSwipe")) return;
  } else if (main.dataset.navSheetSwipe) {
    return;
  } else {
    main.dataset.navSheetSwipe = "1";
  }

  let sx = 0, sy = 0, st = 0, tracking = false, locked = false, lx = 0;
  let suppressClickUntil = 0;
  let ignoreCancel = false;
  const IGNORE = ".card-hand, .tl-focus-tab, .tl-calendar-shell, .tl-card-deck, input, textarea, #channel-panel, .modal-backdrop";
  const peekOpts = { capture: true, passive: true };
  const moveOpts = { capture: true, passive: false };
  const narrow = () => (typeof isNarrowShell === "function"
    ? isNarrowShell()
    : window.matchMedia("(max-width: 900px)").matches);
  const sheetW = () => main.getBoundingClientRect().width || innerWidth;
  // Event chat still swipes back to the board. Tasks and Polls keep the
  // sideways swipe for the left sidebar, same as Chats and Timeline.
  const returningToConversations = () => {
    if (typeof S === "undefined" || !S.conversationsReturn) return false;
    const view = S.activeView;
    if (view?.kind !== "channel" || typeof group !== "function") return true;
    const ch = (group()?.channels || []).find(c => c.id === view.id);
    if (!ch) return true;
    if (ch.kind === "task") return false;
    if (typeof isBoardPollsView === "function" && isBoardPollsView(ch)) return false;
    return true;
  };
  const setX = (px) => {
    const x = Math.max(0, Math.min(sheetW(), px));
    main.style.setProperty("--nav-sheet-x", x + "px");
  };

  const stopDrag = () => {
    tracking = false;
    locked = false;
    app.classList.remove("nav-sheet-dragging");
    // Interrupted gestures (including a new pointerdown) must not retain a
    // partial offset after their listeners have been removed.
    main.style.removeProperty("--nav-sheet-x");
    document.removeEventListener("pointermove", onPeekMove, peekOpts);
    document.removeEventListener("pointermove", onMove, moveOpts);
    document.removeEventListener("pointerup", onUp, true);
    document.removeEventListener("pointercancel", onCancel, true);
  };
  const onPeekMove = (e) => {
    if (!tracking || locked) return;
    lx = e.clientX;
    const dx = lx - sx;
    const dy = e.clientY - sy;
    if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) {
      stopDrag();
      return;
    }
    if (dx < -12 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      stopDrag();
      return;
    }
    if (dx > 12 && dx > Math.abs(dy) * 1.2) {
      locked = true;
      const toList = returningToConversations();
      if (!toList) app.classList.add("nav-sheet-dragging");
      ignoreCancel = true;
      try { main.setPointerCapture(e.pointerId); } catch {}
      ignoreCancel = false;
      document.removeEventListener("pointermove", onPeekMove, peekOpts);
      document.addEventListener("pointermove", onMove, moveOpts);
      try { e.preventDefault(); } catch {}
      if (!toList) setX(dx);
    }
  };
  const onMove = (e) => {
    if (!tracking || !locked) return;
    lx = e.clientX;
    try { e.preventDefault(); } catch {}
    if (!returningToConversations()) setX(lx - sx);
  };
  const onUp = (e) => {
    if (!tracking && !locked) return;
    const wasLocked = locked;
    const dx = (typeof e.clientX === "number" ? e.clientX : lx) - sx;
    const dt = performance.now() - st;
    stopDrag();
    if (!wasLocked) return;
    const w = sheetW();
    const G = typeof AshGesture !== "undefined" ? AshGesture : null;
    const committed = (G && typeof G.shouldCommit === "function")
      ? G.shouldCommit({ distance: dx, travel: w, dt })
      : (dx > w * 0.25);
    suppressClickUntil = performance.now() + 450;
    try { e.preventDefault(); } catch {}
    if (committed) {
      if (returningToConversations()
          && typeof conversationsHandleBack === "function"
          && conversationsHandleBack()) {
        return;
      }
      openNav();
    }
    else main.style.removeProperty("--nav-sheet-x");
  };
  const onCancel = (e) => {
    if (ignoreCancel) return;
    // Conversation rows (and other action buttons) fire pointercancel when
    // their click is aborted by capture handoff. Same as lostpointercapture:
    // only main's own cancel should drop a locked sheet.
    if (locked && e && e.type === "pointercancel"
        && e.target && e.target !== main && e.target !== document) {
      return;
    }
    if (!locked) { stopDrag(); return; }
    stopDrag();
    main.style.removeProperty("--nav-sheet-x");
  };

  main.addEventListener("lostpointercapture", (e) => {
    // Touch starts with implicit capture on the timeline child. Taking capture
    // on main releases that child asynchronously; its bubbling event is not
    // an interruption of the sheet's newly acquired capture.
    if (e.target === main) onCancel();
  });
  window.addEventListener("blur", onCancel);

  main.addEventListener("pointerdown", (e) => {
    stopDrag();
    if (!narrow()) return;
    if (Panel.navOpen() || Panel.channelOpen()) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest?.(IGNORE)) return;
    // Left-to-right on an untagged chat message tags it; the edge still opens nav.
    if (typeof chatSwipeOwnsStart === "function" && chatSwipeOwnsStart(e)) return;
    try {
      if (window.Onboarding?.ftueBlockNavEdgeSwipe?.()) return;
    } catch {}
    sx = lx = e.clientX;
    sy = e.clientY;
    st = performance.now();
    tracking = true;
    document.addEventListener("pointermove", onPeekMove, peekOpts);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onCancel, true);
  }, true);
  main.addEventListener("click", (e) => {
    if (performance.now() >= suppressClickUntil) return;
    if (e.target.closest?.(".rail")) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
}

/** Swipe right on a side overlay — same as the back arrow (nested onBack, else close). */
function attachSideOverlaySwipeBack() {
  const overlay = document.getElementById("side-overlay");
  if (!overlay) return;
  if (typeof onceFlag === "function") {
    if (!onceFlag(overlay, "swipeBack")) return;
  } else if (overlay.dataset.swipeBack) {
    return;
  } else {
    overlay.dataset.swipeBack = "1";
  }
  const lockPx = () => (typeof AshGesture !== "undefined" && AshGesture.AXIS_LOCK_PX) || 12;
  const grace = () => (typeof AshGesture !== "undefined" && AshGesture.OUTSIDE_TAP_MS) || 450;
  const lockedH = (dx, dy) => (typeof AshGesture !== "undefined" && typeof AshGesture.axisLocked === "function")
    ? (dx > 0 && Math.abs(dx) >= Math.abs(dy) && AshGesture.axisLocked(dx, dy))
    : (dx > 24 && Math.abs(dx) > Math.abs(dy) * 1.2);
  const commitSwipe = (dx, dt) => {
    const travel = overlay.getBoundingClientRect().width || innerWidth;
    if (typeof AshGesture !== "undefined" && typeof AshGesture.shouldCommit === "function") {
      return AshGesture.shouldCommit({ distance: dx, travel, dt });
    }
    return dx > travel * 0.25;
  };
  let sx = 0, sy = 0, st = 0, tracking = false, live = false;
  let suppressClickUntil = 0;
  overlay.addEventListener("pointerdown", (e) => {
    if (e.target.closest("input, textarea, select")) { tracking = false; live = false; return; }
    sx = e.clientX; sy = e.clientY; st = performance.now();
    tracking = true; live = false;
  });
  overlay.addEventListener("pointermove", (e) => {
    if (!tracking || live) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dy) > lockPx() && Math.abs(dy) >= Math.abs(dx)) {
      tracking = false;
      return;
    }
    if (lockedH(dx, dy)) {
      live = true;
      try { overlay.setPointerCapture(e.pointerId); } catch {}
    }
  });
  overlay.addEventListener("pointerup", (e) => {
    const wasLive = live;
    tracking = false; live = false;
    if (!wasLive) return;
    if (typeof Panel === "undefined" || !Panel.sideOpen()) return;
    const dx = e.clientX - sx;
    const dt = performance.now() - st;
    suppressClickUntil = performance.now() + grace();
    try { e.preventDefault(); } catch {}
    if (commitSwipe(dx, dt)) {
      if (typeof sideOverlayGoBack === "function") sideOverlayGoBack();
      else if (typeof closeSideOverlay === "function") closeSideOverlay();
    }
  });
  overlay.addEventListener("pointercancel", () => { tracking = false; live = false; });
  overlay.addEventListener("click", (e) => {
    if (performance.now() >= suppressClickUntil) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
}

/** Swipe right on the channel panel closes it. */
function attachChannelPanelDismissSwipe() {
  const panel = document.getElementById("channel-panel");
  if (!panel) return;
  if (typeof onceFlag === "function") {
    if (!onceFlag(panel, "panelDismissSwipe")) return;
  } else if (panel.dataset.panelDismissSwipe) {
    return;
  } else {
    panel.dataset.panelDismissSwipe = "1";
  }
  try { ensureChannelPanelTaps(); } catch {}
  let sx = 0, sy = 0, st = 0, tracking = false, live = false;
  panel.addEventListener("pointerdown", (e) => { try { noteChannelPanelPointer(e, true); } catch {} }, true);
  panel.addEventListener("pointerup", (e) => { try { noteChannelPanelPointer(e, false); } catch {} }, true);
  panel.addEventListener("pointercancel", (e) => { try { noteChannelPanelPointer(e, false); } catch {} }, true);
  panel.addEventListener("pointerdown", (e) => {
    if (performance.now() < suppressChannelPanelDismissUntil) { tracking = false; live = false; return; }
    if (e.target.closest("input, textarea, select, form, button, a, label, [role='button'], [data-app-act], [data-panel-act], .sidebar-mini-calendar")) {
      tracking = false; live = false;
      return;
    }
    sx = e.clientX; sy = e.clientY; st = performance.now();
    tracking = true; live = false;
  });
  panel.addEventListener("pointermove", (e) => {
    if (!tracking || live) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) {
      tracking = false;
      return;
    }
    if (dx > 24 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      live = true;
      try { panel.setPointerCapture(e.pointerId); } catch {}
    }
  });
  panel.addEventListener("pointerup", (e) => {
    const wasLive = live;
    tracking = false; live = false;
    if (!wasLive) return;
    if (!Panel.channelOpen()) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    const dt = performance.now() - st;
    const G = typeof AshGesture !== "undefined" ? AshGesture : null;
    const axisH = (G && typeof G.axisLocked === "function")
      ? (dx > 0 && Math.abs(dx) >= Math.abs(dy) && G.axisLocked(dx, dy))
      : Math.abs(dx) > Math.abs(dy) * 1.15;
    const travel = panel.getBoundingClientRect().width || innerWidth;
    const committed = (G && typeof G.shouldCommit === "function")
      ? G.shouldCommit({ distance: dx, travel, dt })
      : dx > 48;
    if (axisH && committed) closeChannelPanel();
  });
  panel.addEventListener("pointercancel", () => { tracking = false; live = false; });
}

