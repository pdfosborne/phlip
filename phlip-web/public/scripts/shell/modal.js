/* AshModal — thin shell for `.modal-backdrop` overlays. Deleting this file
   must leave the app fully working: every consumer falls back to its own
   createElement / appendChild / backdrop-click boilerplate.

   Owns create, append, backdrop dismiss, optional Escape, optional focus
   trap/restore, and close cleanup. Callers still own modal-card HTML and
   Save/Cancel wiring. Grown with the call-site migration (see "Modal-backdrop
   cleanup") rather than a full dialog framework. */
(() => {
  "use strict";

  const ESC_KEY = "_ashModalEsc";
  const TRAP_KEY = "_ashModalTrap";
  const INERT_KEY = "_ashModalInert";
  const RESTORE_KEY = "_ashModalRestore";

  function normalizeClass(className) {
    const raw = String(className || "").trim();
    if (!raw) return "modal-backdrop";
    return raw.split(/\s+/).includes("modal-backdrop")
      ? raw
      : `modal-backdrop ${raw}`;
  }

  function selectorFor(className) {
    const parts = normalizeClass(className).split(/\s+/).filter(Boolean);
    return "." + parts.map((p) => CSS.escape(p)).join(".");
  }

  function isOpen(modifier) {
    if (!modifier) return !!document.querySelector(".modal-backdrop");
    return !!document.querySelector(selectorFor(modifier));
  }

  function isTop(overlay) {
    const list = document.querySelectorAll(".modal-backdrop");
    return list[list.length - 1] === overlay;
  }

  function detachEsc(overlay) {
    const onKey = overlay && overlay[ESC_KEY];
    if (!onKey) return;
    document.removeEventListener("keydown", onKey);
    try { delete overlay[ESC_KEY]; } catch { overlay[ESC_KEY] = null; }
  }

  function focusables(root) {
    if (!root) return [];
    return [...root.querySelectorAll(
      "a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])"
    )].filter((el) => {
      if (el.closest("[hidden]")) return false;
      if (el.getAttribute("aria-hidden") === "true") return false;
      return el.tabIndex >= 0;
    });
  }

  function detachFocus(overlay) {
    if (!overlay) return;
    const onKey = overlay[TRAP_KEY];
    if (onKey) document.removeEventListener("keydown", onKey, true);
    try { delete overlay[TRAP_KEY]; } catch { overlay[TRAP_KEY] = null; }
    if (overlay[INERT_KEY]) {
      const app = document.getElementById("app");
      if (app) app.removeAttribute("inert");
      overlay[INERT_KEY] = false;
    }
  }

  function restoreFocus(overlay) {
    const rec = overlay && overlay[RESTORE_KEY];
    if (!rec) return;
    overlay[RESTORE_KEY] = null;
    let el = rec.node;
    if (!el || !el.isConnected) {
      if (rec.id) el = document.getElementById(rec.id);
    }
    if (el && typeof el.focus === "function") {
      // Restoring a trigger inside the sliding nav must not scroll the shell
      // horizontally to reveal the transformed content beside it.
      try { el.focus({ preventScroll: true }); } catch {}
    }
  }

  function attachFocus(overlay, opts) {
    if (opts.restoreFocus) {
      const ae = document.activeElement;
      overlay[RESTORE_KEY] = {
        node: ae && ae !== document.body ? ae : null,
        id: ae && ae.id ? ae.id : "",
      };
    }
    if (opts.trapFocus) {
      const app = document.getElementById("app");
      if (app && !overlay.contains(app)) {
        app.setAttribute("inert", "");
        overlay[INERT_KEY] = true;
      }
      const onKey = (e) => {
        if (!overlay.isConnected) return;
        if (!isTop(overlay)) return;
        if (e.key !== "Tab") return;
        const list = focusables(overlay);
        if (!list.length) {
          e.preventDefault();
          return;
        }
        const first = list[0];
        const last = list[list.length - 1];
        const active = document.activeElement;
        if (e.shiftKey) {
          if (active === first || !overlay.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last || !overlay.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      };
      overlay[TRAP_KEY] = onKey;
      document.addEventListener("keydown", onKey, true);
    }
    if (opts.trapFocus || opts.initialFocus || opts.restoreFocus) {
      const move = () => {
        if (!overlay.isConnected) return;
        let target = null;
        if (typeof opts.initialFocus === "string") {
          target = overlay.querySelector(opts.initialFocus);
        } else if (opts.initialFocus && opts.initialFocus.nodeType === 1) {
          target = opts.initialFocus;
        }
        if (!target || !overlay.contains(target)) {
          const list = focusables(overlay);
          target = list[0]
            || overlay.querySelector("[tabindex='-1']")
            || overlay;
        }
        try { target.focus({ preventScroll: true }); } catch {}
      };
      requestAnimationFrame(move);
    }
  }

  function runOverlayClose(overlay) {
    const fn = overlay && overlay._ashModalClose;
    if (typeof fn === "function") {
      fn();
      return true;
    }
    if (!overlay) return false;
    detachEsc(overlay);
    detachFocus(overlay);
    overlay.remove();
    restoreFocus(overlay);
    return true;
  }

  function close(elOrSelector) {
    let overlay = null;
    if (!elOrSelector) return false;
    if (typeof elOrSelector === "string") {
      overlay = document.querySelector(selectorFor(elOrSelector));
    } else if (elOrSelector.nodeType === 1) {
      overlay = elOrSelector;
    }
    if (!overlay) return false;
    return runOverlayClose(overlay);
  }

  function closeTop() {
    const list = document.querySelectorAll(".modal-backdrop");
    if (!list.length) return false;
    return runOverlayClose(list[list.length - 1]);
  }

  /**
   * @param {object} opts
   * @param {string} opts.className
   * @param {string} [opts.html]
   * @param {Record<string,string>} [opts.attrs]
   * @param {"return"|"replace"|false} [opts.singleton]
   * @param {boolean} [opts.closeOnBackdrop]
   * @param {boolean} [opts.closeOnEscape]
   * @param {number} [opts.graceMs]
   * @param {boolean} [opts.trapFocus]
   * @param {boolean} [opts.restoreFocus]
   * @param {string|HTMLElement} [opts.initialFocus]
   * @param {() => void} [opts.onClose]
   * @returns {{ overlay: HTMLElement, close: () => void } | null}
   */
  function open(opts = {}) {
    const className = normalizeClass(opts.className);
    const singleton = opts.singleton === undefined ? "return" : opts.singleton;
    const sel = selectorFor(className);
    const existing = document.querySelector(sel);

    if (singleton === "return" && existing) return null;
    if (singleton === "replace" && existing) {
      detachEsc(existing);
      detachFocus(existing);
      existing.remove();
    }

    const overlay = document.createElement("div");
    overlay.className = className;
    const attrs = opts.attrs || {};
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null) continue;
      overlay.setAttribute(k, String(v));
    }
    if (opts.html != null) overlay.innerHTML = opts.html;
    document.body.appendChild(overlay);
    // Settings sheets have their own higher layer. Child dialogs must sit
    // above every existing modal, regardless of their default CSS z-index.
    let layer = Number.parseInt(getComputedStyle(overlay).zIndex, 10) || 200;
    for (const other of document.querySelectorAll(".modal-backdrop")) {
      if (other === overlay) continue;
      layer = Math.max(layer, (Number.parseInt(getComputedStyle(other).zIndex, 10) || 200) + 1);
    }
    overlay.style.zIndex = String(layer);

    let closed = false;
    const doClose = () => {
      if (closed) return;
      closed = true;
      detachEsc(overlay);
      detachFocus(overlay);
      overlay.remove();
      restoreFocus(overlay);
      try { opts.onClose?.(); } catch {}
    };
    overlay._ashModalClose = doClose;

    if (opts.closeOnBackdrop !== false) {
      const graceMs = Number(opts.graceMs) || 0;
      const openedAt = performance.now();
      overlay.addEventListener("click", (e) => {
        if (e.target !== overlay) return;
        if (graceMs && performance.now() - openedAt < graceMs) return;
        doClose();
      });
    }

    if (opts.closeOnEscape) {
      const onKey = (e) => {
        if (!overlay.isConnected) return;
        if (!isTop(overlay)) return;
        if (e.key !== "Escape") return;
        e.preventDefault();
        doClose();
      };
      overlay[ESC_KEY] = onKey;
      document.addEventListener("keydown", onKey);
    }

    attachFocus(overlay, opts);

    return { overlay, close: doClose };
  }

  window.AshModal = { open, close, closeTop, isOpen };
})();
