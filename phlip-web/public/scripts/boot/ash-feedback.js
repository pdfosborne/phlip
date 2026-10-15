/* ash-feedback.js — live-region toast and one-action snackbar (CMP-feedback, INT-13).
 *
 * Globals in:  AshGesture (optional, swipe commit)
 * Globals out: AshFeedback, toast
 * Load after:  feel.js
 * Load before: first toast() consumer (crypto.js / net)
 *
 * Must not: ES modules, focus the host, a second toast() definition
 */
(() => {
  "use strict";

  const TOAST_SHORT_MS = 3000;
  const TOAST_LONG_MS = 5000;
  const TOAST_WORD_LIMIT = 6;
  const SNACKBAR_MS = 6000;

  let pending = null;
  let ui = null;

  function toastDurationMs(text) {
    const words = String(text || "").trim().split(/\s+/).filter(Boolean);
    return words.length > TOAST_WORD_LIMIT ? TOAST_LONG_MS : TOAST_SHORT_MS;
  }

  function clearTimer() {
    if (pending && pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = 0;
    }
  }

  function ensureUi() {
    if (typeof document === "undefined" || !document.body) return null;
    if (ui && ui.host && ui.host.parentNode) return ui;
    const host = document.createElement("div");
    host.id = "ash-feedback";
    host.className = "ash-feedback";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    const card = document.createElement("div");
    card.id = "toast";
    card.className = "toast";
    card.setAttribute("aria-hidden", "true");
    const msg = document.createElement("span");
    msg.className = "toast-msg";
    const action = document.createElement("button");
    action.type = "button";
    action.className = "toast-action";
    action.hidden = true;
    action.textContent = "Undo";
    card.appendChild(msg);
    card.appendChild(action);
    host.appendChild(card);
    document.body.appendChild(host);

    action.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      undoSnackbar();
    });

    const fineHover = () => {
      try {
        return !!(window.matchMedia
          && window.matchMedia("(hover: hover) and (pointer: fine)").matches);
      } catch {
        return false;
      }
    };
    card.addEventListener("pointerenter", () => {
      if (pending && pending.kind === "snackbar" && fineHover()) pauseTimer();
    });
    card.addEventListener("pointerleave", () => {
      if (pending && pending.kind === "snackbar" && fineHover()) resumeTimer();
    });
    card.addEventListener("focusin", () => {
      if (pending && pending.kind === "snackbar") pauseTimer();
    });
    card.addEventListener("focusout", () => {
      if (pending && pending.kind === "snackbar") resumeTimer();
    });

    let tracking = false;
    let pointerId = null;
    let startX = 0;
    let startT = 0;
    card.addEventListener("pointerdown", (e) => {
      if (!pending || pending.kind !== "snackbar") return;
      if (e.button != null && e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest(".toast-action")) return;
      tracking = true;
      pointerId = e.pointerId;
      startX = e.clientX;
      startT = Date.now();
      try { card.setPointerCapture(e.pointerId); } catch {}
    });
    card.addEventListener("pointermove", (e) => {
      if (!tracking || e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      card.style.transform = "translateY(0) translateX(" + dx + "px)";
    });
    const endSwipe = (e) => {
      if (!tracking || (e && e.pointerId !== pointerId)) return;
      tracking = false;
      pointerId = null;
      const dx = e && e.clientX != null ? e.clientX - startX : 0;
      const dt = Date.now() - startT;
      const travel = card.offsetWidth || 1;
      card.style.transform = "";
      const G = typeof AshGesture !== "undefined" ? AshGesture : null;
      const commit = G && typeof G.shouldCommit === "function"
        ? G.shouldCommit({ distance: dx, travel: travel, dt: dt })
        : Math.abs(dx) >= travel * 0.25;
      if (commit) commitSnackbar();
    };
    card.addEventListener("pointerup", endSwipe);
    card.addEventListener("pointercancel", endSwipe);

    ui = { host: host, card: card, msg: msg, action: action };
    return ui;
  }

  function paintCard(kind, text, actionLabel) {
    const nodes = ensureUi();
    if (!nodes) return;
    nodes.msg.textContent = text || "";
    if (kind === "snackbar") {
      nodes.action.hidden = false;
      nodes.action.textContent = actionLabel || "Undo";
      nodes.card.classList.add("is-snackbar");
    } else {
      nodes.action.hidden = true;
      nodes.card.classList.remove("is-snackbar");
    }
    nodes.card.classList.remove("is-leaving");
    nodes.card.setAttribute("aria-hidden", "false");
    void nodes.card.offsetWidth;
    nodes.card.classList.add("on");
  }

  function hideCard() {
    if (!ui || !ui.card) return;
    ui.card.classList.add("is-leaving");
    ui.card.classList.remove("on");
    ui.card.setAttribute("aria-hidden", "true");
    ui.action.hidden = true;
    ui.card.classList.remove("is-snackbar");
    ui.card.style.transform = "";
  }

  function armTimer(ms) {
    clearTimer();
    if (!pending) return;
    pending.remain = Math.max(0, ms);
    pending.startedAt = Date.now();
    pending.paused = false;
    pending.timer = setTimeout(() => {
      if (!pending) return;
      if (pending.kind === "snackbar") commitSnackbar();
      else clearPending(false);
    }, pending.remain);
  }

  function pauseTimer() {
    if (!pending || pending.paused) return;
    pending.paused = true;
    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = 0;
      pending.remain = Math.max(0, pending.remain - (Date.now() - pending.startedAt));
    }
  }

  function resumeTimer() {
    if (!pending || !pending.paused) return;
    pending.paused = false;
    if (pending.remain <= 0) {
      if (pending.kind === "snackbar") commitSnackbar();
      else clearPending(false);
      return;
    }
    armTimer(pending.remain);
  }

  function clearPending(runCommit) {
    const job = pending;
    pending = null;
    clearTimer();
    hideCard();
    if (runCommit && job && typeof job.onCommit === "function") {
      try { job.onCommit(); } catch (err) { console.warn("ash-feedback commit", err); }
    }
    return job;
  }

  function toast(text) {
    const msg = String(text || "");
    if (!msg) return;
    if (pending && pending.kind === "snackbar") return;
    clearPending(false);
    pending = { kind: "toast", onCommit: null, onUndo: null, timer: 0, remain: 0, startedAt: 0, paused: false };
    paintCard("toast", msg, "");
    armTimer(toastDurationMs(msg));
  }

  function snackbar(opts) {
    const o = opts || {};
    const message = String(o.message || "");
    if (!message) return;
    if (pending && pending.kind === "snackbar") commitSnackbar();
    else clearPending(false);
    pending = {
      kind: "snackbar",
      onCommit: typeof o.onCommit === "function" ? o.onCommit : null,
      onUndo: typeof o.onUndo === "function" ? o.onUndo : null,
      timer: 0,
      remain: SNACKBAR_MS,
      startedAt: 0,
      paused: false,
    };
    paintCard("snackbar", message, o.action || "Undo");
    armTimer(SNACKBAR_MS);
  }

  function commitSnackbar() {
    if (!pending || pending.kind !== "snackbar") return false;
    clearPending(true);
    return true;
  }

  function undoSnackbar() {
    if (!pending || pending.kind !== "snackbar") return false;
    const onUndo = pending.onUndo;
    clearPending(false);
    if (typeof onUndo === "function") {
      try { onUndo(); } catch (err) { console.warn("ash-feedback undo", err); }
    }
    return true;
  }

  function hasSnackbar() {
    return !!(pending && pending.kind === "snackbar");
  }

  window.AshFeedback = {
    toast: toast,
    snackbar: snackbar,
    commitSnackbar: commitSnackbar,
    undoSnackbar: undoSnackbar,
    hasSnackbar: hasSnackbar,
    toastDurationMs: toastDurationMs,
  };

  window.toast = toast;
})();
