/* board-composer.js — the All chat message box: keyboard and IME, floating and docking, jump to latest, scrolling to a continued message, Enter to send and the send button.
 *
 * Globals in:  shared board/chat state (S, Nav, activeConn), board-model.js
 * Globals out: boardFloatComposer, boardSyncKeyboard, boardFocusComposerInput, boardHomeComposerExtra, boardSendButtonHTML, boardScanToContinued
 * Load after:  board-continue.js
 * Load before: board-from-chat.js
 *
 * Must not: ES modules, bundlers, unrelated feature work
 */

function boardSyncIme() {
  const view = document.getElementById("view");
  if (!view || typeof S === "undefined" || !S.boardChatHome) return;
  try {
    if (window.AshNative && typeof AshNative.setKeyboardOverlay === "function") {
      AshNative.setKeyboardOverlay(false);
    }
  } catch {}
  const layoutH = window.innerHeight || 0;
  const vv = window.visualViewport;
  const vvBottom = vv ? Math.round(vv.offsetTop + vv.height) : layoutH;
  let bottom = layoutH ? Math.min(layoutH, vvBottom) : vvBottom;
  let native = 0;
  try {
    if (window.AshNative && typeof AshNative.imeInsetPx === "function") {
      native = Number(AshNative.imeInsetPx()) || 0;
    }
  } catch {}
  const dpr = window.devicePixelRatio || 1;
  if (layoutH && native > layoutH * 0.85) native = Math.round(native / dpr);
  if (!boardSyncIme.baseline || layoutH > boardSyncIme.baseline) boardSyncIme.baseline = layoutH;
  const base = boardSyncIme.baseline || layoutH;
  const layoutResized = base > 0 && layoutH < base - 80;
  const viewportResized = !!(vv && layoutH && vv.height < layoutH - 80);
  if (native > 0 && layoutH && !layoutResized && !viewportResized) {
    bottom = Math.min(bottom, layoutH - native);
  }
  const inset = Math.max(0, Math.round(layoutH - bottom));
  view.style.paddingBottom = inset ? inset + "px" : "";
}

function boardComposerFocusWanted() {
  return !!boardComposerFocusWanted.want;
}

function boardClearComposerFocusWanted() {
  boardComposerFocusWanted.want = false;
}

function boardComposerNote() {
  return "";
}

function boardHomeComposerExtra() {
  if (typeof S === "undefined" || !S.boardChatHome) return "";
  return `${boardFromChatBarHTML()}${boardHiddenNoteHTML()}${boardContinuationHTML()}${boardComposerNote()}`;
}

function boardFitComposerField(view) {
  const root = view || document.getElementById("view");
  const input = root?.querySelector?.(".composer.is-board #composer-input");
  if (!input || input.tagName !== "TEXTAREA") return;
  const before = input.offsetHeight;
  const max = parseFloat(getComputedStyle(input).maxHeight);
  input.style.height = "0px";
  const full = input.scrollHeight;
  const cap = Number.isFinite(max) && max > 20 ? max : full;
  const next = Math.max(0, Math.min(full, cap));
  input.style.height = next + "px";
  input.style.overflowY = full > cap + 1 ? "auto" : "hidden";
  if (next === before) return;
  boardFloatComposer(root);
  if (typeof boardScanToContinued === "function" && boardScanToContinued.id) {
    boardScanToContinued(boardScanToContinued.id, false);
  }
}

function boardComposerEnterSend(input, event) {
  if (event.defaultPrevented || boardDestinationState.composing || boardDestinationState.picker) return;
  if (!input || input.disabled || input.tagName !== "TEXTAREA") return;
  if (event.isComposing || event.keyCode === 229 || event.shiftKey) return;
  const enter = event.key === "Enter" || event.inputType === "insertLineBreak";
  if (!enter) return;
  event.preventDefault();
  if (input._boardEnterSend) return;
  if (!(input.value || "").trim()) return;
  const form = input.form || document.getElementById("composer-form");
  if (!form) return;
  const sendBtn = document.querySelector(".board-compose-send");
  if (sendBtn && sendBtn.disabled) return;
  input._boardEnterSend = true;
  try {
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  } catch {}
  setTimeout(() => { input._boardEnterSend = false; }, 400);
}

/** "Jump to latest": shown once the reader is more than a screen above the
 *  newest message. Lives in #view so it floats above the composer. */
function boardWireJumpLatest(view) {
  const scroll = view?.querySelector("#chat-scroll");
  if (!scroll) return;
  const host = view.querySelector(":scope > .composer.is-board") || view;
  let btn = host.querySelector(":scope > #board-jump-latest");
  if (!btn) {
    view.querySelector("#board-jump-latest")?.remove();
    btn = document.createElement("button");
    btn.type = "button";
    btn.id = "board-jump-latest";
    btn.className = "board-jump-latest";
    btn.setAttribute("aria-label", "Jump to latest");
    btn.hidden = true;
    btn.innerHTML = typeof ic === "function" ? ic("chevron-down") : "↓";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const live = document.querySelector("#chat-scroll");
      if (typeof boardEventStepClear === "function") boardEventStepClear();
      if (live) live.scrollTo({ top: live.scrollHeight, behavior: "smooth" });
    });
    host.appendChild(btn);
  }
  if (!scroll._boardJumpWired) {
    scroll._boardJumpWired = true;
    scroll.addEventListener("scroll", () => {
      boardSyncJumpLatest();
      if (typeof boardEventNavOnScroll === "function") boardEventNavOnScroll(scroll);
    }, { passive: true });
  }
  if (!boardWireJumpLatest.resizeWired) {
    boardWireJumpLatest.resizeWired = true;
    window.addEventListener("resize", () => boardSyncJumpLatest(), { passive: true });
  }
  boardSyncJumpLatest();
  requestAnimationFrame(() => boardSyncJumpLatest());
  setTimeout(() => boardSyncJumpLatest(), 350);
}

/** Looks up the live scroll area and button each time, so a re-rendered
 *  composer (new button) is never left out of sync. */
function boardSyncJumpLatest() {
  const scroll = document.querySelector("#chat-scroll");
  const btn = document.querySelector("#board-jump-latest");
  if (!scroll || !btn) return;
  const away = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight;
  const show = away > scroll.clientHeight && !(typeof S !== "undefined" && (S.boardSelect || S.boardFromChat));
  if (btn.hidden === show) btn.hidden = !show;
}

function boardSyncClose(view) {
  const btn = view?.querySelector("#board-compose-close");
  const input = view?.querySelector("#composer-input");
  if (!btn) return;
  const typed = !!(input && String(input.value || "").trim());
  btn.classList.toggle("is-reserved", typed);
  btn.tabIndex = typed ? -1 : 0;
  btn.setAttribute("aria-hidden", typed ? "true" : "false");
}

function boardDestinationPickerHostHTML() {
  return `<div id="board-destination-picker" class="board-destination-picker" role="listbox" aria-label="Choose event" hidden></div>`;
}

/** Keep the keyboard up when cancelling a reply. */
function boardWireFieldActions(root) {
  const composer = root?.querySelector?.(":scope > .composer.is-board") || document.querySelector("#view > .composer.is-board");
  if (!composer || composer._boardFieldWired) return;
  composer._boardFieldWired = true;
  const holdField = (e) => {
    if (e.target.closest(".composer-reply-cancel")) e.preventDefault();
  };
  composer.addEventListener("pointerdown", holdField);
  composer.addEventListener("mousedown", holdField);
}

function boardPlaceFieldLine() {
  const composer = document.querySelector("#view > .composer.is-board");
  const send = composer?.querySelector(".board-compose-send");
  if (!composer || !send || composer.classList.contains("is-separate")) return;
  const composerBox = composer.getBoundingClientRect();
  const end = Math.max(0, Math.round(composerBox.bottom - send.getBoundingClientRect().top));
  composer.style.setProperty("--field-line-end", end + "px");
  const preview = composer.querySelector(".board-field-preview");
  if (preview && !composer.classList.contains("is-adjacent")) {
    const top = Math.round(preview.getBoundingClientRect().top - composerBox.top);
    composer.style.setProperty("--preview-line-top", Math.max(0, top) + "px");
  } else {
    composer.style.removeProperty("--preview-line-top");
  }
}

/** Composer state for the current destination. The rail bridge between the
 *  last message and the composer is gone with the rails. */
function boardSyncConnector(view) {
  const root = view || document.getElementById("view");
  if (!root || typeof S === "undefined" || !S.boardChatHome) return;
  const composer = root.querySelector(":scope > .composer.is-board");
  if (!composer) return;
  const separate = !!S.boardContinueSeparate;
  composer.classList.toggle("is-separate", separate);
  composer.classList.remove("is-adjacent", "is-reach", "is-bridged");
  composer.style.removeProperty("--rail-up");
  composer.style.removeProperty("--rail-join");
  composer.classList.toggle("is-chain", !separate && !!boardExtendTarget());
  root.querySelectorAll("#chat-scroll .board-msg-run.is-joined").forEach((el) => el.classList.remove("is-joined"));
  boardDestinationSync();
  boardWireFieldActions(root);
  boardPlaceFieldLine();
}

function boardImeVisible() {
  const layoutH = window.innerHeight || 0;
  if (!boardSyncIme.baseline || layoutH > boardSyncIme.baseline) boardSyncIme.baseline = layoutH;
  const base = boardSyncIme.baseline || layoutH;
  const vv = window.visualViewport;
  let native = 0;
  try {
    if (window.AshNative && typeof AshNative.imeInsetPx === "function") native = Number(AshNative.imeInsetPx()) || 0;
  } catch {}
  const dpr = window.devicePixelRatio || 1;
  if (layoutH && native > layoutH * 0.85) native = Math.round(native / dpr);
  const layoutResized = base > 0 && layoutH < base - 80;
  const viewportResized = !!(vv && layoutH && vv.height < layoutH - 80);
  if (layoutResized || viewportResized) return true;
  return native > 80 && !layoutResized && !viewportResized;
}

function boardClearContinueScan() {
  boardScanToContinued.id = "";
  boardScanToContinued.until = 0;
  clearTimeout(boardScanToContinued.timer);
  const scroll = document.querySelector("#chat-scroll");
  scroll?.querySelector(":scope > .board-scan-spacer")?.remove();
  if (typeof boardFloatComposer === "function") boardFloatComposer();
}

function boardContinueGap() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--space-12");
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 12;
}

function boardChatEndGap() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--space-48");
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 48;
}

function boardMarkContinueFocus(on, opts) {
  document.querySelectorAll("#chat-scroll .is-continue-target").forEach((el) => el.classList.remove("is-continue-target"));
  if (!on || typeof S === "undefined" || S.boardContinueSeparate || S.boardConnect) return;
  const list = typeof boardActiveMessages === "function" ? boardActiveMessages() : [];
  let messageId = S.boardContinueAnchor || "";
  let conversationId = "";
  if (messageId && typeof boardMessageConversationId === "function") {
    const message = list.find((item) => item && item.id === messageId);
    if (message) conversationId = boardMessageConversationId(message, list) || "";
  }
  if (!conversationId) conversationId = S.boardContinuing || "";
  if (!messageId && conversationId && typeof boardConversationMessages === "function") {
    const members = boardConversationMessages(list, conversationId);
    const last = members.length ? members[members.length - 1] : null;
    messageId = last ? last.id : "";
  }
  if (!messageId && !conversationId) return;
  const cssId = (id) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(String(id)) : String(id).replace(/"/g, ""));
  if (conversationId) {
    document.querySelectorAll(`#chat-scroll .board-msg-run[data-conversation="${cssId(conversationId)}"]`).forEach((el) => {
      el.classList.add("is-continue-target");
    });
  }
  const msg = messageId ? document.querySelector(`#chat-scroll [data-msg-id="${cssId(messageId)}"]`) : null;
  if (!msg) return;
  msg.classList.add("is-continue-target");
  const run = msg.closest(".board-msg-run");
  if (run) run.classList.add("is-continue-target");
  const scroll = document.querySelector("#chat-scroll");
  const composer = document.querySelector("#view > .composer.is-board");
  if (!scroll) return;
  const rect = msg.getBoundingClientRect();
  const top = scroll.getBoundingClientRect().top;
  const bottom = composer ? composer.getBoundingClientRect().top : scroll.getBoundingClientRect().bottom;
  if (opts && opts.stay) return;
  if ((rect.bottom < top + 8 || rect.top > bottom - 8) && typeof boardScanToContinued === "function") {
    boardScanToContinued(messageId, false);
  }
}

function boardScanToContinued(messageId, arm) {
  const scroll = document.querySelector("#chat-scroll");
  if (!scroll || typeof S === "undefined" || !S.boardChatHome || !messageId) return;
  boardScanToContinued.id = messageId;
  if (arm) boardScanToContinued.until = Date.now() + 700;
  const apply = (smooth) => {
    const live = document.querySelector("#chat-scroll");
    const id = boardScanToContinued.id;
    if (!live || !id) return;
    const sel = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : String(id).replace(/"/g, "");
    const msg = live.querySelector(`[data-msg-id="${sel}"]`);
    if (!msg) return;
    msg.classList.toggle("is-continuing", !!(typeof S !== "undefined" && S.replyToMessage && S.replyToMessage.id === id));
    const composer = document.querySelector("#view > .composer.is-board");
    const scrollRect = live.getBoundingClientRect();
    const limit = composer ? composer.getBoundingClientRect().top : scrollRect.bottom;
    const fadeRaw = getComputedStyle(document.documentElement).getPropertyValue("--space-32");
    const fade = composer ? (parseFloat(fadeRaw) || 32) : 0;
    const clearance = fade + boardContinueGap();
    let spacer = live.querySelector(":scope > .board-scan-spacer");
    const spacerH = spacer ? spacer.offsetHeight : 0;
    const msgBottom = msg.getBoundingClientRect().bottom;
    const naturalMax = Math.max(0, live.scrollHeight - spacerH - live.clientHeight);
    const want = Math.max(0, Math.round(live.scrollTop + msgBottom - limit + clearance));
    const need = Math.max(0, want - naturalMax);
    if (need) {
      if (!spacer) {
        spacer = document.createElement("div");
        spacer.className = "board-scan-spacer";
        spacer.setAttribute("aria-hidden", "true");
        live.appendChild(spacer);
      }
      if (spacer.style.height !== need + "px") spacer.style.height = need + "px";
    } else if (spacer) {
      spacer.remove();
    }
    const max = Math.max(0, live.scrollHeight - live.clientHeight);
    const next = Math.min(max, want);
    if (smooth && Math.abs(live.scrollTop - next) > 8) live.scrollTo({ top: next, behavior: "smooth" });
    else live.scrollTop = next;
  };
  apply(!!arm);
  requestAnimationFrame(() => {
    apply(false);
    requestAnimationFrame(() => apply(false));
  });
  clearTimeout(boardScanToContinued.timer);
  boardScanToContinued.timer = setTimeout(() => apply(false), arm ? 480 : 320);
}

function boardPinChatEnd(arm) {
  if (boardScanToContinued.id) boardClearContinueScan();
  const scroll = document.querySelector("#chat-scroll");
  if (!scroll || typeof S === "undefined" || !S.boardChatHome) return;
  if (arm) boardPinChatEnd.until = Date.now() + 480;
  const pin = () => {
    const live = document.querySelector("#chat-scroll");
    if (!live) return;
    live.scrollTop = live.scrollHeight;
  };
  pin();
  requestAnimationFrame(() => {
    pin();
    requestAnimationFrame(pin);
  });
  clearTimeout(boardPinChatEnd.timer);
  boardPinChatEnd.timer = setTimeout(pin, 320);
}

function boardSyncKeyboard() {
  if (typeof S === "undefined" || !S.boardChatHome) return;
  if (!document.getElementById("composer-input")) {
    boardSyncKeyboard.wasOpen = false;
    return;
  }
  const scroll = document.querySelector("#chat-scroll");
  const atEnd = !!(scroll && scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 24);
  const open = boardImeVisible();
  const was = !!boardSyncKeyboard.wasOpen;
  boardSyncIme();
  const settling = Date.now() < (boardPinChatEnd.until || 0);
  if (boardScanToContinued.id) boardScanToContinued(boardScanToContinued.id, false);
  else if (open && !was) boardPinChatEnd(true);
  else if (settling) boardPinChatEnd(false);
  else if (!open && was && atEnd) boardPinChatEnd(false);
  if (open && !was) boardSyncKeyboard.since = Date.now();
  boardSyncKeyboard.wasOpen = open;
  const view = document.getElementById("view");
  if (view) boardSyncConnector(view);
  boardFloatComposer(view);
}

function boardFloatComposer(view, opts = {}) {
  const root = view || document.getElementById("view");
  if (!root || typeof S === "undefined" || !S.boardChatHome) return;
  const scroll = root.querySelector("#chat-scroll");
  const composer = root.querySelector(":scope > .composer.is-board");
  if (!scroll || !composer) return;
  const scrollBox = scroll.getBoundingClientRect();
  const composerBox = composer.getBoundingClientRect();
  const overlap = Math.max(0, Math.ceil(scrollBox.bottom - composerBox.top));
  const gap = boardChatEndGap();
  const correcting = !!S.boardFromChat?.correcting;
  // Room for the event stepper above the composer, so it never covers a message.
  const stepper = root.querySelector("#board-event-stepper") ? 52 : 0;
  const pad = overlap + gap + (correcting ? 48 : 0) + stepper;
  const atEnd = scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 24;
  scroll.style.paddingBottom = pad + "px";
  // keep: the caller is mid-pan (event stepper) — don't snap back to the end.
  if (atEnd && !opts.keep) scroll.scrollTop = scroll.scrollHeight;
}

function boardExpandComposer() {
  const form = document.querySelector("#view > .composer.is-board #composer-form");
  if (!form) return;
  form.classList.remove("is-expand");
  void form.offsetWidth;
  form.classList.add("is-expand");
}

function boardFocusComposerInput() {
  const input = document.querySelector("#composer-input");
  if (!input) return;
  try { input.focus({ preventScroll: true }); } catch { try { input.focus(); } catch {} }
  boardMarkContinueFocus(document.activeElement === input);
}

function boardDockInlineComposer(view) {
  const composer = view.querySelector(":scope > .composer.is-board");
  if (!composer) return;
  composer.classList.remove("is-inline", "is-merging");
  composer.style.position = "";
  composer.style.top = "";
  composer.style.left = "";
  composer.style.width = "";
  composer.style.right = "";
  composer.style.bottom = "";
  composer.style.transform = "";
}

function boardWirePullBreak(view) {
  const scroll = view.querySelector("#chat-scroll");
  if (!scroll || scroll._boardPullWired) return;
  scroll._boardPullWired = true;
  scroll.addEventListener("scroll", () => {
    boardSyncConnector(view);
  }, { passive: true });
}

function boardSendContinueActive() { return !!boardDestinationState.value?.eventId; }

function boardSendButtonHTML(sendLocked) {
  return `<span class="board-send-gesture"><button type="submit" class="board-compose-send" form="composer-form" aria-label="Send"${sendLocked ? " disabled" : ""}>${ic("arrow-right")}</button></span>`;
}
