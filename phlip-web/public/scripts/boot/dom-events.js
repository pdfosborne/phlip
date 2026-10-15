/* dom-events.js — root-scoped delegated event helpers.
 *
 * Globals in:  none
 * Globals out: onDelegated, onceFlag
 * Load after:  storage.js
 * Load before: panels/sidebars that remount often
 *
 * Use for simple click/change routing on a stable root. Do not replace gesture
 * listeners that need precise capture/passive options until their subsystem
 * extraction phase.
 */
(function () {
  "use strict";

  const FLAG = "__phlipBound";

  /** Mark a root so repeated mounts skip rebinding the same listener key. */
  function onceFlag(root, key) {
    if (!root) return false;
    const bag = root[FLAG] || (root[FLAG] = Object.create(null));
    if (bag[key]) return false;
    bag[key] = true;
    return true;
  }

  /**
   * Bind a delegated listener on root. selector may be a CSS selector string
   * or a predicate (el) => bool. handler(event, matchedEl).
   * Returns an unbind function.
   */
  function onDelegated(root, type, selector, handler, options) {
    if (!root || typeof handler !== "function") return () => {};
    const match = typeof selector === "function"
      ? selector
      : (el) => el && el.closest && el.closest(selector);
    const listener = (e) => {
      const start = e.target;
      if (!start || start === root) return;
      const el = typeof selector === "function"
        ? (function walk(n) {
            while (n && n !== root) {
              if (selector(n)) return n;
              n = n.parentElement;
            }
            return null;
          })(start.nodeType === 1 ? start : start.parentElement)
        : (start.closest ? start.closest(selector) : null);
      if (!el || (root.contains && !root.contains(el))) return;
      handler(e, el);
    };
    root.addEventListener(type, listener, options || false);
    return () => root.removeEventListener(type, listener, options || false);
  }

  window.onceFlag = onceFlag;
  window.onDelegated = onDelegated;
})();
