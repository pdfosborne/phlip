/* ui-confirm.js — inline confirm show/hide/restore (not AshModal).
 *
 * Globals in:  none
 * Globals out: inlineConfirmShow, inlineConfirmHide, inlineConfirmBind
 * Load after:  dom-events.js
 * Load before: channel / destructive UI that adopts the helper
 *
 * Manages hidden inline confirm strips (e.g. #ch-people-confirm). Modal
 * singleton behavior stays in AshModal / modal.js.
 */
(function () {
  "use strict";

  function inlineConfirmHide(el) {
    if (el) el.hidden = true;
  }

  function inlineConfirmShow(el, messageEl, message) {
    if (!el) return;
    if (messageEl && message != null) messageEl.textContent = message;
    el.hidden = false;
  }

  /**
   * Wire apply/undo buttons inside a confirm root.
   * opts: { applySelector, undoSelector, onApply, onUndo }
   * Returns unbind().
   */
  function inlineConfirmBind(root, opts) {
    if (!root || !opts) return () => {};
    const applySel = opts.applySelector || "[data-confirm-apply]";
    const undoSel = opts.undoSelector || "[data-confirm-undo]";
    const onApply = opts.onApply;
    const onUndo = opts.onUndo;
    const onClick = (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      if (onApply && t.closest(applySel)) {
        e.preventDefault();
        onApply(e);
        return;
      }
      if (onUndo && t.closest(undoSel)) {
        e.preventDefault();
        onUndo(e);
      }
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }

  window.inlineConfirmHide = inlineConfirmHide;
  window.inlineConfirmShow = inlineConfirmShow;
  window.inlineConfirmBind = inlineConfirmBind;
})();
