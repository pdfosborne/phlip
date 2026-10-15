/* ash-gesture.js — INT-2 gesture constants, commit helpers, pressed class.
 *
 * Globals in:  none
 * Globals out: AshGesture (window.AshGesture)
 * Load after:  core.js
 * Load before: rail, sidebar, channel-panel-gestures,
 *   channel-timeline-view, hand-time-blocks, wireboot
 *
 * Must not: ES modules, new swipe handlers, haptics
 */
(() => {
  "use strict";

  const TAP_SLOP = 12;
  const AXIS_LOCK_PX = 12;
  const AXIS_RATIO = 1.2;
  const HOLD_MS = 500;
  const DOUBLE_TAP_MS = 320;
  const COMMIT_FRACTION = 0.25;
  const FLICK_PX_MS = 0.5;
  const FLICK_MIN_PX = 24;
  const OUTSIDE_TAP_MS = 450;
  const PRESSED_SEL = ".tl-event-row, .side-item, .tl-create-fab, #btn-back, .rail-btn, .composer button, .tl-card-deck-nav";

  function axisLocked(dx, dy) {
    const ax = Math.abs(Number(dx) || 0);
    const ay = Math.abs(Number(dy) || 0);
    const dominant = Math.max(ax, ay);
    const other = Math.min(ax, ay);
    return dominant >= AXIS_LOCK_PX && dominant >= other * AXIS_RATIO;
  }

  function shouldCommit({ distance, travel, dt } = {}) {
    const d = Math.abs(Number(distance) || 0);
    const t = Math.max(0, Number(travel) || 0);
    const time = Math.max(1, Number(dt) || 0);
    if (t > 0 && d >= t * COMMIT_FRACTION) return true;
    if (d >= FLICK_MIN_PX && (d / time) >= FLICK_PX_MS) return true;
    return false;
  }

  function pressedFromEvent(e) {
    const t = e && e.target;
    if (!t || typeof t.closest !== "function") return null;
    if (t.closest("input, textarea, select")) return null;
    return t.closest(PRESSED_SEL);
  }

  function bindPressed() {
    if (typeof document === "undefined" || !document.addEventListener) return;
    const live = new Map();
    const clear = (e) => {
      const el = live.get(e.pointerId);
      if (!el) return;
      el.classList.remove("is-pressed");
      live.delete(e.pointerId);
    };
    document.addEventListener("pointerdown", (e) => {
      if (e.button != null && e.button !== 0) return;
      const el = pressedFromEvent(e);
      if (!el) return;
      el.classList.add("is-pressed");
      live.set(e.pointerId, el);
    }, true);
    document.addEventListener("pointerup", clear, true);
    document.addEventListener("pointercancel", clear, true);
    document.addEventListener("lostpointercapture", clear, true);
  }

  bindPressed();

  window.AshGesture = {
    TAP_SLOP,
    AXIS_LOCK_PX,
    AXIS_RATIO,
    HOLD_MS,
    DOUBLE_TAP_MS,
    COMMIT_FRACTION,
    FLICK_PX_MS,
    FLICK_MIN_PX,
    OUTSIDE_TAP_MS,
    PRESSED_SEL,
    axisLocked,
    shouldCommit,
  };
})();
