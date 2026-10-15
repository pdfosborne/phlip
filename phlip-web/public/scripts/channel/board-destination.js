/* Explicit destination; leading # becomes a picker control, never message text. */
const boardDestinationState = { scope: "", value: null, picker: null, composing: false, dismissed: null };

function boardDestinationNavigate(view) {
  if (!boardDestinationState.scope || (view?.kind === "channel" && view.id === S.activeView?.id)) return;
  const conn = activeConn();
  const channels = typeof group === "function" ? group()?.channels || [] : [];
  const oldChannel = channels.find(c => c.id === S.activeView?.id);
  const nextChannel = view?.kind === "channel" && channels.find(c => c.id === view.id);
  const oldBoard = oldChannel && typeof boardForChannel === "function" ? boardForChannel(oldChannel, conn) : null;
  const nextBoard = nextChannel && typeof boardForChannel === "function" ? boardForChannel(nextChannel, conn) : null;
  if (oldBoard?.id && oldBoard.id === nextBoard?.id) return;
  Object.assign(boardDestinationState, { scope: "", value: null, picker: null, dismissed: null, composing: false });
}

function boardDestinationEnter(channelId) {
  const scope = `${activeConn()?.id || ""}:${channelId}`;
  if (boardDestinationState.scope === scope) return;
  Object.assign(boardDestinationState, { scope, value: null, picker: null, dismissed: null });
  boardDestinationLegacyReset();
}

function boardDestinationLegacyReset() {
  S.boardSendContinue = false;
  S.boardContinuing = null;
  S.boardContinueAnchor = null;
  S.boardContinueSeparate = false;
  S.boardConnect = null;
  S.boardFromChat = null;
  S.replyToMessage = null;
  S.mentionedEventIds = [];
  S.taggedEventId = null;
  S.autoTagEventId = null;
}

function boardDestinationTarget() {
  const d = boardDestinationState.value;
  if (!d?.eventId) return null;
  const event = boardFindEvent(d.eventId, null, activeConn());
  return { eventId: d.eventId, conversationId: d.conversationId, event: event && !event._missing ? event : null };
}

function boardDestinationLabel() {
  const d = boardDestinationState.value;
  return d?.eventId ? (boardDestinationTarget()?.event ? boardEventTitle(boardDestinationTarget().event) : d.label) : d?.label;
}

function boardDestinationChipHTML() {
  const d = boardDestinationState.value;
  if (!d) return "";
  const label = boardDestinationLabel() || "Conversation";
  // No per-event colour: the tag reads as "#name" in the focus colour (CSS).
  const color = "";
  // An untagged conversation has no name worth squeezing into the chip (a cut
  // message excerpt read as "Sund"), so it reads as a reply.
  const short = d.eventId && boardDestinationTarget()?.event ? eventShortName(boardDestinationTarget().event) : "Reply";
  return `<span class="board-destination-chip"${color ? ` style="--destination-color:${esc(color)}"` : ""}><span class="board-destination-label" aria-label="Destination: ${esc(label)}" title="${esc(label)}"><span aria-hidden="true" class="board-destination-symbol">${d.eventId ? "#" : "↩"}</span><span data-destination-short="${esc(short)}">${esc(short)}</span></span><button type="button" data-destination-clear class="board-destination-clear" aria-label="Remove destination: ${esc(label)}" title="Remove destination"><svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="m4 4 8 8m0-8-8 8"/></svg></button></span>`;
}

/** Sets (or clears) the message box tag. The keyboard only comes up when the
 *  message box already had it, or the caller asks (options.focus: swipe reply,
 *  Reply) — tagging from the # picker or a continue arrow leaves the person
 *  free to browse first; tapping the message box then opens the keyboard. */
function boardDestinationSet(value, options = {}) {
  const input = document.querySelector("#composer-input");
  const focus = options.focus ?? (!!input && document.activeElement === input);
  const draft = input?.value || "";
  const start = input?.selectionStart ?? draft.length;
  const end = input?.selectionEnd ?? start;
  boardSaveChatMemory();
  boardDestinationLegacyReset();
  S.replyToMessage = options.reply || null;
  boardDestinationState.value = value;
  boardDestinationState.picker = null;
  S.chatFilterEventId = null;
  S.chatFilterUntagged = false;
  const mem = boardChatMemory();
  mem.draft = draft;
  mem.continuing = null;
  mem.anchor = null;
  const view = typeof boardScrollAnchor === "function" ? boardScrollAnchor() : null;
  renderView(true);
  if (typeof boardRestoreScrollAnchor === "function") boardRestoreScrollAnchor(view);
  const fresh = document.querySelector("#composer-input");
  if (fresh) {
    fresh.value = draft;
    if (focus) {
      fresh.focus({ preventScroll: true });
      fresh.setSelectionRange(start, end);
    }
  }
  boardDestinationSync();
}

function boardDestinationContinue(messageId, options = {}) {
  const list = boardContinuationMessages();
  const message = list.find(m => m.id === messageId);
  if (!message || boardArchiveOn()) return;
  const conversationId = boardMessageConversationId(message, list);
  const eventId = boardConversationEventId(list, conversationId) || boardMessageEventId(message) || null;
  const first = boardConversationMessages(list, conversationId).find(m => !m.activity) || message;
  const preview = String(shownField(first._text, first.text) || "").replace(/\s+/g, " ").trim();
  const sender = activeConn()?.members?.find(m => m.id === first.userId)?.name || first.name || first.senderName || "Conversation";
  boardDestinationSet({ eventId, conversationId, label: eventId ? boardEventTitle(boardFindEvent(eventId, null, activeConn())) : (preview.slice(0, 60) || sender) }, { reply: options.keepReply ? S.replyToMessage : null, focus: options.focus });
}

function boardDestinationRoute() {
  const d = boardDestinationState.value;
  if (d?.eventId) {
    const event = boardDestinationTarget()?.event;
    if (!event || boardEventCompleted(event) || !boardContinueEventTargets().some(t => t.eventId === d.eventId)) {
      toast("This event is unavailable. Remove or change the destination to send.");
      return null;
    }
  } else if (d && !boardContinuationMessages().some(m => boardMessageConversationId(m, boardContinuationMessages()) === d.conversationId)) {
    toast("This conversation is unavailable. Remove or change the destination to send.");
    return null;
  }
  const conversationId = d?.conversationId || boardFreshConversationId();
  if (d) d.conversationId = conversationId;
  S.boardOutgoingConversationId = conversationId;
  return { conversationId, mentionedEventIds: d?.eventId ? [d.eventId] : null };
}

function boardDestinationChoices() {
  const query = (boardDestinationState.picker?.query || "").trim().toLocaleLowerCase();
  const words = query.split(/\s+/).filter(Boolean);
  return boardContinueEventTargets().filter(t => words.every(w => (boardEventTitle(t.event) + " " + eventShortName(t.event)).toLocaleLowerCase().includes(w)))
    .sort((a, b) => ((Number(a.event.when) || Infinity) - (Number(b.event.when) || Infinity)) || boardEventTitle(a.event).localeCompare(boardEventTitle(b.event)));
}

/** Opens the # picker with an empty query (selftests and tools). */
function boardDestinationOpen() {
  boardDestinationState.picker = { start: null, end: null, query: "", highlighted: -1 };
  boardDestinationPaintPicker();
  document.querySelector("#composer-input")?.focus({ preventScroll: true });
}

function boardDestinationDismiss(focus = false) {
  const p = boardDestinationState.picker;
  if (p?.virtual && p.query) {
    const input = document.querySelector("#composer-input");
    if (input) {
      const start = input.selectionStart, end = input.selectionEnd;
      input.setRangeText("#", 0, 0, "preserve");
      input.setSelectionRange(start + 1, end + 1);
    }
  }
  if (p?.start != null) boardDestinationState.dismissed = p.start;
  boardDestinationState.picker = null;
  boardDestinationPaintPicker();
  if (focus) document.querySelector("#composer-input")?.focus({ preventScroll: true });
}

function boardDestinationSyncAdd(input) {
  const add = document.querySelector("#board-compose-add");
  if (!add) return;
  const hash = !!boardDestinationState.picker;
  add.classList.toggle("is-hash", hash);
  add.setAttribute("aria-label", hash ? "Cancel tagging" : "Tag an event");
  if (input) input.placeholder = hash ? "Find event…" : "Message…";
}

function boardDestinationQuery(input, reason) {
  if (boardDestinationState.composing) return false;
  let caret = input.selectionStart;
  const active = boardDestinationState.picker;
  if (active?.virtual) {
    // A tap into the box before anything is typed: the search goes at the
    // start (ahead of any draft), so put the caret there.
    if (reason === "tap" && !active.query) {
      input.setSelectionRange(0, 0);
      return true;
    }
    if (input.selectionEnd !== caret || input.value.slice(0, caret).includes("\n")) {
      boardDestinationDismiss();
      return false;
    }
    const query = input.value.slice(0, caret);
    boardDestinationState.picker = { ...active, end: caret, query, highlighted: query === active.query ? active.highlighted : -1 };
    boardDestinationPaintPicker();
    return true;
  }
  if (input.value.startsWith("#") && caret > 0 && input.selectionEnd === caret && boardDestinationState.dismissed !== 0) {
    input.setRangeText("", 0, 1, "preserve");
    input.setSelectionRange(--caret, caret);
    boardDestinationState.picker = { start: 0, end: caret, query: input.value.slice(0, caret), highlighted: -1, virtual: true };
    boardDestinationPaintPicker();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  const match = /(?:^|\s)#([^#\n]*)$/.exec(input.value.slice(0, caret));
  const start = match ? caret - match[1].length - 1 : null;
  if (!match || input.selectionEnd !== caret) {
    if (boardDestinationState.picker?.start != null) boardDestinationDismiss();
    boardDestinationState.dismissed = null;
    return !!boardDestinationState.picker;
  }
  if (start === boardDestinationState.dismissed) return false;
  const old = boardDestinationState.picker;
  boardDestinationState.picker = { start, end: caret, query: match[1], highlighted: old?.start === start && old?.query === match[1] ? old.highlighted : -1 };
  boardDestinationPaintPicker();
  return true;
}

function boardDestinationChoose(eventId) {
  const item = boardDestinationChoices().find(t => t.eventId === eventId);
  if (!item) return;
  const p = boardDestinationState.picker;
  const input = document.querySelector("#composer-input");
  if (input && p?.start != null) {
    boardDestinationState.picker = null;
    input.setRangeText("", p.start, p.end, "end");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  boardDestinationState.dismissed = null;
  boardDestinationSet({ eventId, conversationId: item.conversationId, label: boardEventTitle(item.event) });
}

function boardDestinationEntries() {
  return boardDestinationChoices().map(t => ({ ...t, label: boardEventTitle(t.event) }));
}

function boardDestinationActivate(entry) {
  if (!entry || entry.disabled) return;
  boardDestinationChoose(entry.eventId);
}

function boardDestinationPaintPicker() {
  boardDestinationSyncAdd(document.querySelector("#composer-input"));
  const box = document.querySelector("#board-destination-picker");
  const input = document.querySelector("#composer-input");
  if (!box) return;
  const p = boardDestinationState.picker;
  box.hidden = !p;
  input?.setAttribute("aria-expanded", String(!!p));
  input?.removeAttribute("aria-activedescendant");
  if (!p) { box.innerHTML = ""; return; }
  const entries = boardDestinationEntries();
  const row = (t, i) => `<button type="button" role="option" id="board-destination-option-${i}" aria-selected="${i === p.highlighted}" data-destination-index="${i}" class="board-destination-option${i === p.highlighted ? " is-highlighted" : ""}${t.event && typeof boardEventRsvpState === "function" ? ` is-rsvp-${boardEventRsvpState(t.event)}` : ""}"${t.disabled ? " disabled" : ""}>${t.event && typeof boardEventIconWithStateHTML === "function" ? boardEventIconWithStateHTML(t.event, "board-destination-option-icon") : ""}<span class="board-destination-option-title">${esc(t.label)}</span>${t.event ? `<span class="board-destination-option-date">${esc(boardContinueWhenDetail(t.event))}</span>` : ""}</button>`;
  box.innerHTML = `<div class="board-destination-results">${entries.length ? entries.map(row).join("") : `<div class="board-destination-empty" role="status">No matching events</div>`}</div>`;
  box.querySelectorAll("[data-destination-index]").forEach(button => {
    button.addEventListener("pointerdown", e => e.preventDefault());
    button.addEventListener("click", () => boardDestinationActivate(entries[Number(button.dataset.destinationIndex)]));
  });
  if (p.highlighted >= 0 && entries[p.highlighted]) {
    input?.setAttribute("aria-activedescendant", `board-destination-option-${p.highlighted}`);
    box.querySelector(`#board-destination-option-${p.highlighted}`)?.scrollIntoView({ block: "nearest" });
  }
}

function boardDestinationFit() {
  const label = document.querySelector("[data-destination-short]");
  if (!label || !label.clientWidth) return;
  const style = getComputedStyle(label);
  const canvas = boardDestinationFit.canvas || (boardDestinationFit.canvas = document.createElement("canvas"));
  const context = canvas.getContext("2d");
  context.font = style.font;
  const spacing = parseFloat(style.letterSpacing) || 0;
  label.textContent = compactDestinationName(label.dataset.destinationShort, text => context.measureText(text).width + Math.max(0, eventNameCharacters(text).length - 1) * spacing <= label.clientWidth + 1.5); // clientWidth is rounded down; allow sub-pixel slack
}

function boardDestinationSync() {
  const host = document.querySelector("#board-destination-slot");
  if (!host) return;
  const html = boardDestinationChipHTML();
  if (host._chipHTML !== html) {
    host._fitObserver?.disconnect();
    host.innerHTML = html;
    host._chipHTML = html;
  }
  host.hidden = !boardDestinationState.value;
  // An event tag shows as the event bar above the box while that is up
  // (board-event-nav.js); the in-field chip is for replies and fallback.
  host.classList.toggle("is-event", !!boardDestinationState.value?.eventId);
  const add = document.querySelector("#board-compose-add");
  // "#" tags a message to an event: it appears once there is one to pick.
  if (add) add.hidden = !!boardDestinationState.value?.eventId || (!boardDestinationState.picker && !boardContinueEventTargets().length);
  if (!host._destinationWired) {
    host._destinationWired = true;
    host.addEventListener("pointerdown", e => {
      if (e.target.closest("[data-destination-clear]")) e.preventDefault();
    });
    host.addEventListener("click", e => {
      if (e.target.closest("[data-destination-clear]")) boardDestinationSet(null);
    });
  }
  const input = document.querySelector("#composer-input");
  boardDestinationSyncAdd(input);
  if (input) input.placeholder = "Message…";
  if (!host._fitObserver && typeof ResizeObserver !== "undefined") {
    host._fitObserver = new ResizeObserver(boardDestinationFit);
  }
  host._fitObserver?.observe(host);
  const shortLabel = host.querySelector("[data-destination-short]");
  if (shortLabel) host._fitObserver?.observe(shortLabel);
  requestAnimationFrame(boardDestinationFit);
  boardDestinationPaintPicker();
}

/** "#" opens the event picker. Without the keyboard: the list is tappable
 *  straight away, and tapping the message box brings the keyboard up to type
 *  a search (caret at the start, where the query goes). Keeps the keyboard if
 *  it was already up. */
function boardDestinationStartHash(input) {
  if (!input || input.disabled || boardDestinationState.composing) return;
  // With the keyboard up the search starts at the caret's new home; without
  // it, the tap that brings the keyboard up puts the caret there
  // (boardDestinationQuery, "tap").
  if (document.activeElement === input) input.setSelectionRange(0, 0);
  boardDestinationState.dismissed = null;
  boardDestinationState.picker = { start: 0, end: 0, query: "", highlighted: -1, virtual: true };
  boardDestinationPaintPicker();
}

function boardDestinationWireSend(view, input) {
  const target = view.querySelector(".board-send-gesture");
  if (!target || target._destinationWired) return;
  target._destinationWired = true;
  let drag = null;
  let suppressClick = false;
  target.addEventListener("pointerdown", e => {
    suppressClick = false;
    if (e.button !== 0 || e.isPrimary === false || input.disabled || input.form?._composerSendLocked || boardDestinationState.composing) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    try { e.target.setPointerCapture(e.pointerId); } catch {}
  });
  target.addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8) drag.moved = true;
  });
  target.addEventListener("pointerup", e => {
    if (!drag || e.pointerId !== drag.id) return;
    const up = drag.y - e.clientY;
    const across = Math.abs(e.clientX - drag.x);
    suppressClick = drag.moved || Math.hypot(across, up) > 8;
    drag = null;
    if (suppressClick) { e.preventDefault(); e.stopPropagation(); }
    if (up >= 32 && up > across * 1.25) boardDestinationStartHash(input);
  });
  target.addEventListener("pointercancel", () => { drag = null; suppressClick = true; });
  target.addEventListener("click", e => {
    if (!suppressClick) return;
    suppressClick = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
}

function boardDestinationWire(view) {
  const input = view.querySelector(".composer.is-board #composer-input");
  if (!input) return;
  boardDestinationSync();
  boardDestinationWireSend(view, input);
  if (input._destinationWired) return;
  input._destinationWired = true;
  input.setAttribute("aria-controls", "board-destination-picker");
  input.addEventListener("compositionstart", () => { boardDestinationState.composing = true; });
  input.addEventListener("compositionend", () => { boardDestinationState.composing = false; boardDestinationQuery(input); });
  input.addEventListener("input", () => boardDestinationQuery(input));
  input.addEventListener("click", () => boardDestinationQuery(input, "tap"));
  input.addEventListener("keyup", e => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) boardDestinationQuery(input); });
  const handle = e => {
    if (e.isComposing || boardDestinationState.composing || e.keyCode === 229) return;
    const backspace = e.key === "Backspace" || e.inputType === "deleteContentBackward";
    if (backspace && input.selectionStart === 0 && input.selectionEnd === 0 && boardDestinationState.picker?.virtual) {
      e.preventDefault(); e.stopImmediatePropagation(); boardDestinationDismiss(true); return;
    }
    if (backspace && input.selectionStart === 0 && input.selectionEnd === 0 && boardDestinationState.value) {
      e.preventDefault(); e.stopImmediatePropagation(); boardDestinationSet(null); return;
    }
    const p = boardDestinationState.picker;
    if (!p) return;
    const enter = e.key === "Enter" || e.inputType === "insertLineBreak";
    if (!["ArrowDown", "ArrowUp", "Escape"].includes(e.key) && !enter) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.key === "Escape") { boardDestinationDismiss(true); return; }
    const choices = boardDestinationEntries();
    if (enter) { if (p.highlighted >= 0 && choices[p.highlighted]) boardDestinationActivate(choices[p.highlighted]); return; }
    if (!choices.length) return;
    p.highlighted = p.highlighted < 0 ? (e.key === "ArrowDown" ? 0 : choices.length - 1) : (p.highlighted + (e.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length;
    while (choices[p.highlighted]?.disabled && choices.some(t => !t.disabled)) p.highlighted = (p.highlighted + (e.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length;
    boardDestinationPaintPicker();
  };
  input.addEventListener("keydown", handle, true);
  input.addEventListener("beforeinput", handle, true);
}

document.addEventListener("pointerdown", e => {
  if (boardDestinationState.picker && !e.target.closest("#board-destination-picker, #composer-input, [data-destination-picker], #board-compose-add")) boardDestinationDismiss();
});

document.fonts?.addEventListener("loadingdone", boardDestinationFit);
window.addEventListener("resize", boardDestinationFit);
