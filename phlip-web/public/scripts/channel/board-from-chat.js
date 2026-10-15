/* board-from-chat.js — an event draft from chat messages: the title word picker, plan parsing across a group of messages, the draft bar, and creating or updating the event.
 *
 * Globals in:  shared board/chat state (S, Nav, activeConn), board-model.js
 * Globals out: boardFromChatBarHTML, boardSyncFromChat, boardWireFromChatBar, boardParseMessagesPlan, boardCreateFromChat, boardWritableCreateChannel
 * Load after:  board-composer.js
 * Load before: board-home.js
 *
 * Must not: ES modules, bundlers, unrelated feature work
 */

function boardFromChatChain(messageId) {
  const list = typeof boardActiveMessages === "function" ? boardActiveMessages() : [];
  const msg = list.find((m) => m && m.id === messageId);
  if (!msg) return { conversationId: "", ids: messageId ? [messageId] : [] };
  const conversationId = boardMessageConversationId(msg, list) || "";
  const ids = list
    .filter((m) => m && !m.activity && !m._eventLinkMarker && m.id && boardMessageConversationId(m, list) === conversationId)
    .sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0))
    .map((m) => m.id);
  return { conversationId, ids: ids.length ? ids : [messageId] };
}

// Per-message plan anchors: the user's pick when a date was ambiguous
// ("next Sunday" -> the coming one or the one after). Resolution itself is
// deterministic from each message's send time, so only overrides are stored.
const BOARD_PLAN_ANCHOR_KEY = "ash_plan_anchor_v1";

function boardPlanAnchorGet(messageId) {
  if (!messageId) return null;
  const all = typeof storageGetJson === "function" ? storageGetJson(BOARD_PLAN_ANCHOR_KEY, {}) : {};
  return (all && all[messageId]) || null;
}

function boardPlanAnchorSet(messageId, record) {
  if (!messageId || typeof storageGetJson !== "function") return;
  const all = storageGetJson(BOARD_PLAN_ANCHOR_KEY, {}) || {};
  if (record) all[messageId] = record;
  else delete all[messageId];
  storageSetJson(BOARD_PLAN_ANCHOR_KEY, all);
}

function boardMessageTs(messageId) {
  const list = typeof boardActiveMessages === "function" ? boardActiveMessages() : [];
  const m = list.find((item) => item && item.id === messageId);
  return Number(m?.ts) || Date.now();
}

/** Parse messages as one plan, anchored to their send times, with any stored
 *  "other date" pick applied. */
function boardParseMessagesPlan(messages, primaryId) {
  if (typeof planParseMessages !== "function") return null;
  const parsed = planParseMessages((messages || []).map((m) => ({
    id: m.id,
    ts: m.ts,
    text: boardMessagePlain(m),
  })), { primaryId: primaryId || "" });
  const anchor = boardPlanAnchorGet(parsed?.sources?.date);
  if (anchor && parsed.altDay != null && anchor.useAlt) {
    const swap = parsed.day;
    parsed.day = parsed.altDay;
    parsed.altDay = swap;
  }
  return parsed;
}

function boardFromChatParsed() {
  const mode = typeof S !== "undefined" ? S.boardFromChat : null;
  if (!mode) return null;
  return boardParseMessagesPlan(boardFromChatSelectedMessages(), mode.primaryId);
}

function boardToggleFromChatAltDate() {
  const parsed = boardFromChatParsed();
  const id = parsed?.sources?.date;
  if (!id || parsed.altDay == null) return;
  const cur = boardPlanAnchorGet(id);
  boardPlanAnchorSet(id, cur?.useAlt ? null : { useAlt: true, at: Date.now() });
  boardSyncFromChat();
}

function boardMessagePlain(m) {
  if (!m) return "";
  return typeof shownField === "function" ? shownField(m._text, m.text) : (m._text || m.text || "");
}

/** True when the plan date in a message (read from when it was sent) is
 *  already behind us: "Barbers 10am tomorrow" sent last Friday. */
function boardPlanDayPassed(body, sentAt) {
  if (!body || typeof planParse !== "function") return false;
  const day = planParse(body, sentAt).day;
  if (day == null || !Number.isFinite(Number(day))) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Number(day) < today.getTime();
}

function boardFromChatStaticBodyHTML(m) {
  const body = boardMessagePlain(m);
  const eventId = boardMessageEventId(m);
  // A plan whose day has passed is plain text: nothing to act on now.
  const plain = (t) => (typeof escLinkify === "function" ? escLinkify(t) : (typeof esc === "function" ? esc(t) : t));
  if (boardPlanDayPassed(body, Number(m?.ts) || Date.now())) return plain(body);
  if (!eventId) {
    const now = Number(m?.ts) || Date.now();
    const dated = !!(body && typeof planParse === "function" && planParse(body, now).dateRaw);
    if (dated && typeof chatPlanPromoteHTML === "function") {
      return chatPlanPromoteHTML(body, { marksOnly: true, dateOnly: true, now });
    }
  } else if (body && typeof chatPlanPromoteHTML === "function") {
    const conn = typeof activeConn === "function" ? activeConn() : null;
    const ev = typeof boardFindEvent === "function" ? boardFindEvent(eventId, null, conn) : null;
    if (ev && (typeof canEditEvent !== "function" || canEditEvent(ev))) {
      return chatPlanPromoteHTML(body, { marksOnly: true, whenOnly: true, event: ev, now: Number(m?.ts) || Date.now() });
    }
  }
  return plain(body);
}

function boardWordTokens(text) {
  const src = String(text || "");
  const tokens = [];
  const re = /\S+/g;
  let match;
  while ((match = re.exec(src))) {
    tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

function boardWordKey(text) {
  return String(text || "").replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, "").toLowerCase();
}

function boardMatchWordIndexes(tokens, phrase) {
  const want = boardWordTokens(phrase).map((token) => boardWordKey(token.text)).filter(Boolean);
  const indexes = [];
  let from = 0;
  for (const key of want) {
    for (let i = from; i < tokens.length; i++) {
      if (boardWordKey(tokens[i].text) === key) {
        indexes.push(i);
        from = i + 1;
        break;
      }
    }
  }
  return indexes;
}

function boardWordHTML(text, included) {
  const src = String(text || "");
  const tokens = boardWordTokens(src);
  const on = new Set(included || []);
  const escape = typeof esc === "function" ? esc : (value) => String(value);
  let html = "";
  let cursor = 0;
  tokens.forEach((token, index) => {
    html += escape(src.slice(cursor, token.start));
    html += `<span class="board-word${on.has(index) ? " is-on" : ""}" data-board-word="${index}" role="button" aria-pressed="${on.has(index) ? "true" : "false"}">${escape(token.text)}</span>`;
    cursor = token.end;
  });
  html += escape(src.slice(cursor));
  return html;
}

/** Messages the draft can draw from: the selected ones, their conversation,
 *  and untagged messages nearby (±8 messages, within 3 hours, same day). */
function boardFromChatCandidates() {
  const mode = typeof S !== "undefined" ? S.boardFromChat : null;
  if (!mode) return new Set();
  const list = (typeof boardActiveMessages === "function" ? boardActiveMessages() : [])
    .filter((m) => m && m.id && !m.activity && !m._eventLinkMarker)
    .sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
  const key = `${(mode.selected || []).join(",")}|${mode.conversationId || ""}|${list.length}`;
  if (boardFromChatCandidates.key === key && boardFromChatCandidates.mode === mode) return boardFromChatCandidates.set;
  const selected = new Set(mode.selected || []);
  const out = new Set(selected);
  const ownEvent = mode.eventId || "";
  list.forEach((m, i) => {
    if (!selected.has(m.id)) return;
    const day = new Date(Number(m.ts) || 0).toDateString();
    for (let k = Math.max(0, i - 8); k <= Math.min(list.length - 1, i + 8); k++) {
      const near = list[k];
      if (new Date(Number(near.ts) || 0).toDateString() !== day) continue;
      if (Math.abs((Number(near.ts) || 0) - (Number(m.ts) || 0)) > 3 * 3600 * 1000) continue;
      const tag = boardMessageEventId(near);
      if (tag && tag !== ownEvent) continue;
      out.add(near.id);
    }
  });
  if (mode.conversationId) {
    for (const m of list) if (boardMessageConversationId(m, list) === mode.conversationId) out.add(m.id);
  }
  boardFromChatCandidates.key = key;
  boardFromChatCandidates.mode = mode;
  boardFromChatCandidates.set = out;
  return out;
}

/** Word picks for a field, in the order they were tapped: [{ msgId, idx }]. */
function boardWordPicks(field) {
  const pick = typeof S !== "undefined" ? S.boardFromChat?.words?.[field] : null;
  if (!pick) return [];
  if (!Array.isArray(pick.picks)) {
    pick.picks = (pick.included || []).slice().sort((a, b) => a - b).map((idx) => ({ msgId: pick.messageId, idx }));
    delete pick.included;
  }
  return pick.picks;
}

function boardWordIndexesFor(field, messageId) {
  return boardWordPicks(field).filter((p) => p.msgId === messageId).map((p) => p.idx);
}

function boardFromChatBodyHTML(m) {
  const mode = typeof S !== "undefined" ? S.boardFromChat : null;
  const field = mode?.correcting || "";
  if (field && m && boardFromChatCandidates().has(m.id)) {
    return boardWordHTML(boardMessagePlain(m), boardWordIndexesFor(field, m.id));
  }
  return boardFromChatStaticBodyHTML(m);
}

function boardFromChatSelectedMessages() {
  const ids = new Set((typeof S !== "undefined" && S.boardFromChat && S.boardFromChat.selected) || []);
  return (typeof boardActiveMessages === "function" ? boardActiveMessages() : [])
    .filter((m) => m && ids.has(m.id))
    .sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
}

function boardSuggestPhrase(field, body, now = Date.now()) {
  if (typeof planParse !== "function") return "";
  const parsed = planParse(body, now);
  if (field === "title") {
    if (typeof planTitleFrom !== "function") return "";
    const title = planTitleFrom(body, [parsed.dateRaw, parsed.timeRaw, parsed.placeRaw]);
    return title && title !== "Plan" ? title : "";
  }
  if (field === "place") return parsed.where || "";
  if (field === "date") return parsed.dateRaw || "";
  if (field === "time") return parsed.timeRaw || "";
  return "";
}

function boardSuggestWordIndexes(field, body, now) {
  const phrase = boardSuggestPhrase(field, body, now);
  if (!phrase) return [];
  return boardMatchWordIndexes(boardWordTokens(body), phrase);
}

function boardWordSourceId(field, phrase) {
  const msgs = boardFromChatSelectedMessages();
  const parsed = boardFromChatParsed() || {};
  const dateRaw = String(parsed.dateRaw || "").toLowerCase();
  let dated = "";
  let any = "";
  const want = boardWordTokens(phrase).filter((token) => boardWordKey(token.text)).length;
  for (const m of msgs) {
    const body = boardMessagePlain(m);
    const found = boardMatchWordIndexes(boardWordTokens(body), phrase).length;
    if (!want || found < want) continue;
    if (!any) any = m.id;
    if (dateRaw && body.toLowerCase().includes(dateRaw) && field === "title") {
      dated = m.id;
      break;
    }
    if (field === "place" || field === "date" || field === "time") return m.id;
  }
  return dated || any || msgs[0]?.id || "";
}

function boardFromChatWordPhrase(field) {
  const picks = boardWordPicks(field);
  if (!picks.length) return "";
  const list = typeof boardActiveMessages === "function" ? boardActiveMessages() : [];
  const tokensFor = new Map();
  const parts = picks.map((p) => {
    if (!tokensFor.has(p.msgId)) {
      tokensFor.set(p.msgId, boardWordTokens(boardMessagePlain(list.find((m) => m && m.id === p.msgId))));
    }
    const raw = tokensFor.get(p.msgId)[p.idx]?.text || "";
    return raw.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, "");
  }).filter(Boolean);
  let phrase = parts.join(" ");
  if (field === "title" && phrase) phrase = phrase.charAt(0).toUpperCase() + phrase.slice(1);
  return phrase;
}

function boardFromChatDateLabel(day) {
  if (day == null || typeof cardDateCornerLabel !== "function") return "";
  return cardDateCornerLabel(day);
}

/** Typed text for a field (the person typed it in the draft bar), or null.
 *  Typed beats tapped words, which beat the parse. "" means cleared. */
function boardFromChatTyped(field) {
  const typed = typeof S !== "undefined" ? S.boardFromChat?.typed : null;
  return typed && Object.prototype.hasOwnProperty.call(typed, field) ? String(typed[field] || "") : null;
}

/** The person's own pick for a field: typed text, else tapped words. */
function boardFromChatOwnPhrase(field) {
  const typed = boardFromChatTyped(field);
  return typed != null ? typed.trim() : boardFromChatWordPhrase(field);
}

/** Has the person chosen this field themselves (typed, tapped or cleared)? */
function boardFromChatOwnsField(field) {
  const mode = typeof S !== "undefined" ? S.boardFromChat : null;
  return boardFromChatTyped(field) != null || !!mode?.words?.[field];
}

/** Anchor for reading a typed or tapped date: the source message's send time
 *  for tapped words, now for typed text. */
function boardFromChatDateAnchor(field) {
  return boardFromChatTyped(field) != null ? Date.now() : boardMessageTs(S.boardFromChat?.words?.[field]?.messageId);
}

/** Reads the field's date from tapped words, anchored on the message's send time. */
function boardFromChatReadDate(field, phrase) {
  if (!phrase || typeof planInterpretDate !== "function") return null;
  return planInterpretDate(phrase, boardFromChatDateAnchor(field));
}

function boardFromChatChoiceLabel(field) {
  const phrase = boardFromChatOwnPhrase(field);
  if (!phrase) return "";
  if (field === "title") return phrase.charAt(0).toUpperCase() + phrase.slice(1);
  if (field === "date" && typeof planInterpretDate === "function") {
    const parsed = boardFromChatReadDate(field, phrase);
    return boardFromChatDateLabel(parsed?.day) || phrase;
  }
  if (field === "time" && typeof planInterpretTime === "function") {
    return planInterpretTime(phrase)?.label || phrase;
  }
  return phrase;
}

function boardFromChatChips() {
  const parsed = boardFromChatParsed() || {};
  const mode = typeof S !== "undefined" ? S.boardFromChat : null;
  const correcting = mode?.correcting || "";
  if (!mode) return [];
  const chips = [];
  const push = (field, role, label) => {
    const custom = boardFromChatOwnsField(field);
    const text = custom ? boardFromChatChoiceLabel(field) : label;
    const own = custom ? boardFromChatOwnPhrase(field) : "";
    // A typed or tapped date / time that can't be read as one.
    const unreadable = !!own && ((field === "date" && typeof planInterpretDate === "function" && boardFromChatReadDate(field, own)?.day == null)
      || (field === "time" && typeof planInterpretTime === "function" && !planInterpretTime(own)));
    chips.push({
      field,
      role,
      label: text || "",
      // What the box shows when typing: dates and times as read, words as picked.
      typed: boardFromChatTyped(field) ?? (custom && field !== "date" && field !== "time" ? own : (text || "")),
      on: !!text,
      unreadable,
      correcting: correcting === field,
      typing: correcting === field && mode.typing === field && BOARD_FROM_TYPABLE.includes(field),
    });
  };
  if (mode.eventId) {
    const ev = boardFromChatEvent();
    const eventDate = ev?.when != null && typeof planDayStart === "function" ? boardFromChatDateLabel(planDayStart(ev.when)) : "";
    const eventTime = boardEventClockLabel(ev);
    push("date", "Date", boardFromChatDateLabel(parsed.day) || eventDate);
    push("time", "Time", parsed.timeText || parsed.timeRaw || eventTime);
    const date = chips.find((chip) => chip.field === "date");
    const time = chips.find((chip) => chip.field === "time");
    if (date) date.before = eventDate;
    if (time) time.before = eventTime;
    return chips;
  }
  // Only a plan (a date, time or place) names the event from the chat text.
  const hasPlan = parsed.day != null || !!parsed.timeText || !!parsed.where;
  push("title", "Title", hasPlan && parsed.title && parsed.title !== "Plan" ? parsed.title : "");
  push("date", "Date", boardFromChatDateLabel(parsed.day));
  push("time", "Time", parsed.timeText || parsed.timeRaw);
  push("place", "Location", parsed.where || parsed.placeRaw);
  return chips;
}

function boardFromChatEvent() {
  const id = typeof S !== "undefined" ? S.boardFromChat?.eventId : "";
  if (!id || typeof boardFindEvent !== "function") return null;
  const conn = typeof activeConn === "function" ? activeConn() : null;
  return boardFindEvent(id, null, conn);
}

function boardEventClockLabel(ev) {
  const min = ev && typeof planEventStartMin === "function" ? planEventStartMin(ev) : null;
  if (min == null) return "";
  return typeof formatCreateClockMins === "function" ? formatCreateClockMins(min) : "";
}

function boardEventUpdateDiff() {
  const mode = typeof S !== "undefined" ? S.boardFromChat : null;
  const ev = mode?.eventId ? boardFromChatEvent() : null;
  if (!mode?.eventId || !ev) return null;
  const opts = boardFromChatFields()?.opts || {};
  const eventDay = ev.when != null && typeof planDayStart === "function" ? planDayStart(ev.when) : null;
  const nextDay = opts.day != null && typeof planDayStart === "function" ? planDayStart(opts.day) : null;
  const dateDiff = nextDay != null && nextDay !== eventDay;
  let nextMin = null;
  if (opts.timeText && typeof planInterpretTime === "function") nextMin = planInterpretTime(opts.timeText)?.startMin ?? null;
  const currentMin = typeof planEventStartMin === "function" ? planEventStartMin(ev) : null;
  const timeDiff = nextMin != null && nextMin !== currentMin;
  return { ev, opts, dateDiff, timeDiff, nextMin };
}

function boardFromChatFields() {
  const mode = typeof S !== "undefined" ? S.boardFromChat : null;
  if (!mode) return null;
  const parsed = boardFromChatParsed() || {};
  const chips = boardFromChatChips();
  const on = (field) => chips.some((chip) => chip.field === field && chip.on);
  const opts = {};
  if (boardFromChatOwnsField("title")) {
    const label = boardFromChatOwnPhrase("title");
    if (label) opts.title = label.charAt(0).toUpperCase() + label.slice(1);
  } else if (on("title") && parsed.title && parsed.title !== "Plan") opts.title = parsed.title;
  if (boardFromChatOwnsField("date")) {
    const phrase = boardFromChatOwnPhrase("date");
    const day = phrase && typeof planInterpretDate === "function"
      ? boardFromChatReadDate("date", phrase)
      : null;
    if (day?.day != null) opts.day = day.day;
  } else if (on("date") && parsed.day != null) opts.day = parsed.day;
  if (boardFromChatOwnsField("time")) {
    const phrase = boardFromChatOwnPhrase("time");
    const time = phrase && typeof planInterpretTime === "function" ? planInterpretTime(phrase) : null;
    if (time?.label) opts.timeText = time.label;
    else if (phrase) opts.timeText = phrase;
    if (time?.period) opts.whenPeriod = time.period;
  } else if (on("time") && parsed.timeText) opts.timeText = parsed.timeText;
  if (boardFromChatOwnsField("place")) {
    const label = boardFromChatOwnPhrase("place");
    if (label) opts.where = label;
  } else if (on("place") && parsed.where) opts.where = parsed.where;
  const conn = typeof activeConn === "function" ? activeConn() : null;
  if (mode.confirmAttendance) opts.confirmAttendance = true;
  return {
    opts,
    postable: !!(opts.title && opts.day != null),
    fromChat: {
      messageId: (mode.selected || [])[0] || "",
      messageIds: (mode.selected || []).slice(),
      channelId: S.activeView?.id || "",
      connId: conn?.id || null,
    },
    snapshot: {
      selected: (mode.selected || []).slice(),
      dropped: { ...(mode.dropped || {}) },
      conversationId: mode.conversationId || "",
      words: mode.words ? JSON.parse(JSON.stringify(mode.words)) : null,
      typed: mode.typed ? { ...mode.typed } : null,
      correcting: mode.correcting || null,
    },
  };
}

function boardCorrectFromChatTap(msg, target) {
  const mode = typeof S !== "undefined" ? S.boardFromChat : null;
  const field = mode?.correcting || "";
  if (!mode || !field) return;
  const id = msg?.dataset?.msgId || "";
  if (!id || !boardFromChatCandidates().has(id)) return;
  mode.words = mode.words || {};
  if (mode.typed) delete mode.typed[field];
  mode.typing = null;
  const word = target?.closest?.("[data-board-word]");
  const index = word ? Number(word.dataset.boardWord) : NaN;
  const selected = mode.selected || [];
  if (!selected.includes(id)) {
    // Another message: it becomes the first guess, re-seeded from its text.
    mode.selected = selected.concat(id);
    mode.primaryId = id;
    const body = boardMessagePlain(
      (typeof boardActiveMessages === "function" ? boardActiveMessages() : []).find((m) => m && m.id === id)
    );
    const seeded = boardSuggestWordIndexes(field, body, boardMessageTs(id));
    if (Number.isInteger(index) && !seeded.includes(index)) seeded.push(index);
    mode.words[field] = { messageId: id, picks: seeded.map((idx) => ({ msgId: id, idx })) };
  } else if (Number.isInteger(index)) {
    // Same selection: toggle the word, keeping the order words were tapped in.
    const picks = boardWordPicks(field);
    const at = picks.findIndex((p) => p.msgId === id && p.idx === index);
    if (at >= 0) picks.splice(at, 1);
    else picks.push({ msgId: id, idx: index });
    mode.words[field] = { messageId: picks[0]?.msgId || id, picks };
  } else {
    return;
  }
  boardSyncFromChat();
  boardRevealWordSource();
}

/** Empties a field so it can be set from scratch (typed or tapped). */
function boardClearFromChatField(field) {
  const mode = typeof S !== "undefined" ? S.boardFromChat : null;
  if (!mode || !["title", "date", "time", "place"].includes(field)) return;
  mode.typed = mode.typed || {};
  mode.typed[field] = "";
  mode.words = mode.words || {};
  mode.words[field] = { messageId: mode.words[field]?.messageId || (mode.selected || [])[0] || "", picks: [] };
  mode.correcting = field;
  const typing = mode.typing === field;
  boardSyncFromChat();
  if (typing) document.querySelector(`[data-board-from-type="${field}"]`)?.focus({ preventScroll: true });
}

/** "Type": the active choice to type a field instead of tapping words. The
 *  box takes the keyboard straight away, with its text selected. */
function boardTypeItFromChat(field) {
  const mode = typeof S !== "undefined" ? S.boardFromChat : null;
  if (!mode || !BOARD_FROM_TYPABLE.includes(field)) return;
  mode.correcting = field;
  mode.typing = field;
  boardSyncFromChat();
  const input = document.querySelector(`[data-board-from-type="${field}"]`);
  if (!input) return;
  input.focus({ preventScroll: true });
  input.select();
}

/** Typed text for the field being set. Updates state and the buttons in place
 *  (no re-render, so the keyboard and caret stay put). */
function boardTypeFromChatField(field, value) {
  const mode = typeof S !== "undefined" ? S.boardFromChat : null;
  if (!mode) return;
  mode.typed = mode.typed || {};
  mode.typed[field] = value;
  // Typed text replaces tapped words: un-highlight them.
  if (mode.words?.[field]?.picks?.length) {
    mode.words[field] = { messageId: mode.words[field].messageId, picks: [] };
    boardPaintFromChatWords();
  }
  const bar = document.querySelector(".board-from-bar");
  if (!bar) return;
  if (field === "place") {
    const box = bar.querySelector("#board-from-suggest");
    if (box) box.outerHTML = boardFromChatPlaceSuggestHTML();
    boardWireFromChatSuggest(bar);
  }
  const chip = boardFromChatChips().find((c) => c.field === field);
  bar.querySelector(`[data-board-from-type="${field}"]`)?.closest(".board-from-field")?.classList.toggle("is-unreadable", !!chip?.unreadable);
  const updating = !!mode.eventId;
  const diff = updating ? boardEventUpdateDiff() : null;
  const postable = updating ? !!(diff && (diff.dateDiff || diff.timeDiff)) : !!boardFromChatFields()?.postable;
  bar.querySelector("[data-board-from-go], [data-board-from-update]")?.toggleAttribute("disabled", !postable);
  const clear = bar.querySelector(`[data-board-from-clear="${field}"]`);
  if (!value && clear) clear.remove();
  if (value && !clear) {
    const input = bar.querySelector(`[data-board-from-type="${field}"]`);
    input?.insertAdjacentHTML("afterend", `<button type="button" class="board-from-act" data-board-from-clear="${esc(field)}" aria-label="Clear">${BOARD_FROM_ICON("x", "\u00d7")}</button>`);
    const btn = bar.querySelector(`[data-board-from-clear="${field}"]`);
    btn?.addEventListener("pointerdown", (e) => e.preventDefault());
    btn?.addEventListener("click", (e) => { e.preventDefault(); boardClearFromChatField(field); });
  }
}

function boardBeginWordCorrect(field) {
  const mode = typeof S !== "undefined" ? S.boardFromChat : null;
  if (!mode || (field !== "title" && field !== "place" && field !== "date" && field !== "time")) return;
  if (mode.correcting === field) {
    mode.correcting = null;
    mode.typing = null;
    boardSyncFromChat();
    return;
  }
  mode.words = mode.words || {};
  if (!mode.words[field]) {
    const parsed = boardFromChatParsed() || {};
    let phrase = "";
    if (field === "title") phrase = parsed.title && parsed.title !== "Plan" ? parsed.title : "";
    else if (field === "place") phrase = parsed.where || "";
    else if (field === "date") phrase = parsed.dateRaw || "";
    else if (field === "time") phrase = parsed.timeRaw || "";
    const messageId = boardWordSourceId(field, phrase);
    const body = boardMessagePlain(
      (typeof boardActiveMessages === "function" ? boardActiveMessages() : []).find((m) => m && m.id === messageId)
    );
    mode.words[field] = {
      messageId,
      picks: boardMatchWordIndexes(boardWordTokens(body), phrase).map((idx) => ({ msgId: messageId, idx })),
    };
  }
  mode.correcting = field;
  mode.typing = null;
  if (mode.dropped) delete mode.dropped[field];
  boardSyncFromChat();
  boardRevealWordSource();
}

function boardSyncFromChatChrome() {
  const on = typeof S !== "undefined" && !!S.boardChatHome && !!S.boardFromChat;
  document.body?.classList.toggle("board-from-chat", on);
  if (!on && typeof document !== "undefined" && document.querySelector(".board-from-pop")) boardCloseFromChatPicker();
}

const BOARD_FROM_PLACEHOLDER = { title: "Event name", place: "Where" };

/** Fields that can be typed (the active fallback). Date and time come from
 *  tapped words, the parse, or "Edit draft". */
const BOARD_FROM_TYPABLE = ["title", "place"];

/** Fields with a picker (the fallback for date and time): the create card's
 *  month calendar and hour / minute grid. */
const BOARD_FROM_PICKABLE = { date: "calendar", time: "clock" };

/** The field being typed into — only after "Type" was tapped, an active
 *  choice; tapping words in the chat stays the default way to set a field. */
function boardFromChatInputHTML(chip) {
  const icons = { date: "calendar", time: "clock", place: "map-pin" };
  const icon = icons[chip.field];
  const pin = icon && typeof ic === "function"
    ? `<span class="board-from-pin" aria-hidden="true">${ic(icon)}</span>`
    : "";
  const title = chip.field === "title" ? " is-title" : "";
  const clear = chip.typed
    ? `<button type="button" class="board-from-act" data-board-from-clear="${esc(chip.field)}" aria-label="Clear ${esc(chip.role.toLowerCase())}">${BOARD_FROM_ICON("x", "\u00d7")}</button>`
    : "";
  return `<label class="board-from-field is-correcting is-typing${title}${chip.unreadable ? " is-unreadable" : ""}">${pin}<input class="board-from-input" type="text" data-board-from-type="${esc(chip.field)}" value="${esc(chip.typed || "")}" placeholder="${esc(BOARD_FROM_PLACEHOLDER[chip.field] || chip.role)}" aria-label="${esc(chip.role)}" autocomplete="off" enterkeyhint="done">${clear}</label>`;
}

const BOARD_FROM_ICON = (name, fallback) => (typeof ic === "function" ? ic(name) : fallback);

/** Small buttons beside a field: on the field being set, "Type" (keyboard,
 *  the fallback to tapping words) and ✕ (empty it); the title always has ✕ so
 *  it can be started from scratch. */
function boardFromChatActionsHTML(chip) {
  const role = esc(chip.role.toLowerCase());
  const type = chip.correcting && BOARD_FROM_TYPABLE.includes(chip.field)
    ? `<button type="button" class="board-from-act" data-board-from-typeit="${esc(chip.field)}" aria-label="Type the ${role}">${BOARD_FROM_ICON("keyboard", "⌨")}</button>`
    : (chip.correcting && BOARD_FROM_PICKABLE[chip.field]
      ? `<button type="button" class="board-from-act" data-board-from-pick="${esc(chip.field)}" aria-label="Pick the ${role}" aria-haspopup="dialog">${BOARD_FROM_ICON(BOARD_FROM_PICKABLE[chip.field], "…")}</button>`
      : "");
  const clear = chip.label && (chip.correcting || chip.field === "title")
    ? `<button type="button" class="board-from-act" data-board-from-clear="${esc(chip.field)}" aria-label="Clear ${role}">${BOARD_FROM_ICON("x", "×")}</button>`
    : "";
  return type || clear ? `<span class="board-from-acts">${type}${clear}</span>` : "";
}

function boardFromChatWrap(chip, field) {
  const acts = boardFromChatActionsHTML(chip);
  return acts ? `<div class="board-from-field-row${chip.field === "date" || chip.field === "time" ? " is-half" : ""}">${field}${acts}</div>` : field;
}

function boardFromChatFieldHTML(chip) {
  if (chip.typing) return boardFromChatInputHTML(chip);
  const empty = chip.label ? "" : " is-empty";
  const title = chip.field === "title" ? " is-title" : "";
  const place = chip.field === "place" ? " is-place" : "";
  const correcting = chip.correcting ? " is-correcting" : "";
  const icons = { date: "calendar", time: "clock", place: "map-pin" };
  const icon = icons[chip.field];
  const pin = icon && typeof ic === "function"
    ? `<span class="board-from-pin" aria-hidden="true">${ic(icon)}</span>`
    : "";
  const shown = chip.label || chip.role;
  const label = chip.label ? `${chip.role}, ${chip.label}` : chip.role;
  const field = `<button type="button" class="board-from-field${title}${place}${empty}${correcting}${chip.unreadable ? " is-unreadable" : ""}" data-board-from-correct="${esc(chip.field)}" aria-pressed="${chip.correcting ? "true" : "false"}" aria-label="${esc(label)}">${pin}<span class="board-from-value">${esc(shown)}</span></button>`;
  return boardFromChatWrap(chip, field);
}

function boardFromChatChangeHTML(chip) {
  if (chip.typing) return boardFromChatInputHTML(chip);
  const before = chip.before || "";
  const after = chip.label || "";
  const same = before && before === after ? " is-same" : "";
  const correcting = chip.correcting ? " is-correcting" : "";
  const icons = { date: "calendar", time: "clock" };
  const icon = icons[chip.field];
  const pin = icon && typeof ic === "function"
    ? `<span class="board-from-pin" aria-hidden="true">${ic(icon)}</span>`
    : "";
  const arrow = typeof ic === "function" ? ic("chevron-right") : "";
  const beforeText = before || chip.role;
  const afterText = after || chip.role;
  const described = before
    ? `${chip.role}, ${beforeText} to ${afterText}`
    : `${chip.role}, ${afterText}`;
  return boardFromChatWrap(chip, `<button type="button" class="board-from-field board-from-change${same}${correcting}" data-board-from-correct="${esc(chip.field)}" aria-pressed="${chip.correcting ? "true" : "false"}" aria-label="${esc(described)}">${pin}<span class="board-from-before${before ? "" : " is-empty"}">${esc(beforeText)}</span><span class="board-from-arrow" aria-hidden="true">${arrow}</span><span class="board-from-value${after ? "" : " is-empty"}">${esc(afterText)}</span></button>`);
}

function boardFromChatBarHTML() {
  boardSyncFromChatChrome();
  if (typeof S === "undefined" || !S.boardChatHome || !S.boardFromChat) return "";
  const updating = !!S.boardFromChat.eventId;
  const correcting = !!S.boardFromChat.correcting;
  const diff = updating ? boardEventUpdateDiff() : null;
  const postable = updating ? !!(diff && (diff.dateDiff || diff.timeDiff)) : !!boardFromChatFields()?.postable;
  const chips = boardFromChatChips();
  const field = (name) => boardFromChatFieldHTML(chips.find((chip) => chip.field === name) || { field: name, role: name, label: "" });
  const heading = correcting
    ? (S.boardFromChat.typing ? "Type it" : (BOARD_FROM_PICKABLE[S.boardFromChat.correcting] ? "Tap words in the chat, or pick" : "Tap words in the chat, or Type"))
    : (updating ? `Update ${boardEventTitle(boardFromChatEvent())}` : "Event draft");
  const close = typeof ic === "function" ? ic("x") : "";
  const primary = correcting
    ? `<button type="button" data-board-from-done>Done</button>`
    : (updating
      ? `<button type="button" data-board-from-update${postable ? "" : " disabled"}>Update</button>`
      : `<button type="button" data-board-from-go${postable ? "" : " disabled"}>Create</button>`);
  const change = (name) => boardFromChatChangeHTML(chips.find((chip) => chip.field === name) || { field: name, role: name, label: "", before: "" });
  const parsed = !updating && !correcting && !boardFromChatOwnsField("date") ? boardFromChatParsed() : null;
  const altLabel = parsed?.altDay != null ? boardFromChatDateLabel(parsed.altDay) : "";
  const alt = altLabel
    ? `<button type="button" class="board-from-alt" data-board-from-alt aria-label="Use ${esc(altLabel)} instead">or ${esc(altLabel)}</button>`
    : "";
  // The alternative day sits inside the date field's right side (where its
  // buttons go while it's being set), so no row comes and goes.
  let dateHTML = field("date");
  if (alt && !/board-from-acts/.test(dateHTML)) {
    dateHTML = `<div class="board-from-field-row is-half has-alt">${dateHTML}<span class="board-from-acts">${alt}</span></div>`;
  }
  const when = `<div class="board-from-when">${dateHTML}${field("time")}</div>`;
  const body = updating ? `${change("date")}${change("time")}` : `${field("title")}${when}${field("place")}${boardFromChatPlaceSuggestHTML()}`;
  return `<div class="board-from-bar" role="toolbar" aria-label="${updating ? "Update event from chat" : "Create event from chat"}">
    <div class="board-from-head">
      ${heading ? `<p class="board-from-kicker">${esc(heading)}</p>` : ""}
      <button type="button" data-board-from-cancel aria-label="Cancel">${close}</button>
    </div>
    ${body}
    <div class="board-from-foot">
      ${updating ? "" : `<label class="board-from-opt"><input type="checkbox" role="switch" data-board-from-confirm${S.boardFromChat.confirmAttendance ? " checked" : ""}><span>Confirm attendance</span></label>`}
      ${primary}
    </div>
  </div>`;
}

async function boardApplyEventUpdate() {
  const diff = boardEventUpdateDiff();
  if (!diff || (!diff.dateDiff && !diff.timeDiff) || typeof send !== "function") return;
  const ev = diff.ev;
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const owner = typeof planOwnerConnForEvent === "function" ? planOwnerConnForEvent(ev, conn) : conn;
  if (!owner) return;
  let when = null;
  let whenPrecision = "";
  if (diff.timeDiff && diff.nextMin != null) {
    const dayTs = diff.dateDiff ? diff.opts.day : ev.when;
    const day = typeof planDayStart === "function" ? planDayStart(dayTs) : dayTs;
    const h = Math.floor(diff.nextMin / 60);
    const m = diff.nextMin % 60;
    when = typeof atTime === "function"
      ? atTime(day, h, m)
      : (() => { const d = new Date(day); d.setHours(h, m, 0, 0); return d.getTime(); })();
  } else if (diff.dateDiff && typeof planEventWhenForDate === "function") {
    const next = planEventWhenForDate(ev, diff.opts.day);
    when = next.when;
    whenPrecision = next.whenPrecision || "";
  }
  if (when == null) return;
  const result = send({
    type: "setEventTimePrecision",
    eventId: ev.id,
    when,
    whenPrecision,
  }, owner.id);
  if (result === "failed") {
    try { toast("Couldn't update the event"); } catch {}
    return;
  }
  try { toast(diff.dateDiff && diff.timeDiff ? "Date and time updated" : (diff.dateDiff ? "Date updated" : "Time updated")); } catch {}
  if (typeof S !== "undefined") S.boardFromChat = null;
  if (typeof renderView === "function") renderView(true);
}

let boardFromChatSaving = false;

function boardWritableCreateChannel() {
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const ch = typeof conversationActiveEventChannel === "function" ? conversationActiveEventChannel() : null;
  if (typeof createDraftChannelWritable === "function") {
    return createDraftChannelWritable(ch, conn) ? ch : null;
  }
  return ch && ch.kind === "event" && !ch.deviceCalendar ? ch : null;
}

async function boardCreateFromChat() {
  if (boardFromChatSaving) return;
  const packed = boardFromChatFields();
  if (!packed || !packed.postable) return;
  if (typeof openCreateDraft !== "function" || typeof commitCreateDraft !== "function") return;
  const eventCh = boardWritableCreateChannel();
  if (!eventCh) {
    try { toast("Couldn't save that event on this board"); } catch {}
    return;
  }
  const conn = typeof activeConn === "function" ? activeConn() : null;
  boardFromChatSaving = true;
  const snapshot = packed.snapshot;
  if (typeof S !== "undefined") {
    S.createDraftFromChat = packed.fromChat;
    S.boardFromChat = null;
  }
  const restore = () => {
    if (typeof closeCreateDraft === "function" && S.hand?.mode === "createDraft") closeCreateDraft(true);
    if (typeof S !== "undefined") {
      S.createDraftFromChat = null;
      S.boardFromChat = snapshot;
    }
    if (typeof renderView === "function") renderView(true);
  };
  try {
    openCreateDraft({
      ...packed.opts,
      skipUi: true,
      createChannelId: eventCh.id,
      createConnId: conn?.id || null,
    });
    if (typeof S === "undefined" || S.hand?.mode !== "createDraft") {
      restore();
      return;
    }
    await commitCreateDraft();
    if (S.hand?.mode === "createDraft") restore();
  } catch {
    restore();
  } finally {
    boardFromChatSaving = false;
  }
}

function boardSyncFromChat() {
  const mode = typeof S !== "undefined" ? S.boardFromChat : null;
  if (!mode) return;
  const selected = new Set(mode.selected || []);
  document.querySelectorAll("#chat-scroll .msg[data-msg-id]").forEach((el) => {
    const on = selected.has(el.dataset.msgId || "");
    el.classList.toggle("is-from-chat", on);
    if (on) el.dataset.fromChat = "1";
  });
  const host = document.querySelector("#view > .composer.is-board");
  const html = boardFromChatBarHTML();
  if (!host || !html) return;
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const next = tmp.firstElementChild;
  if (!next) return;
  const bar = host.querySelector(".board-from-bar");
  if (bar) bar.replaceWith(next);
  else host.prepend(next);
  boardWireFromChatBar(document.getElementById("view"));
  boardPaintFromChatWords();
  boardFloatComposer();
}

function boardPaintFromChatWords() {
  const mode = typeof S !== "undefined" ? S.boardFromChat : null;
  const field = mode?.correcting || "";
  const candidates = field ? boardFromChatCandidates() : new Set();
  const list = typeof boardActiveMessages === "function" ? boardActiveMessages() : [];
  document.querySelectorAll("#chat-scroll .msg[data-msg-id]").forEach((el) => {
    const bodyEl = el.querySelector(".msg-body");
    if (!bodyEl) return;
    const id = el.dataset.msgId || "";
    if (field && candidates.has(id)) {
      const msg = list.find((m) => m && m.id === id);
      bodyEl.innerHTML = boardWordHTML(boardMessagePlain(msg), boardWordIndexesFor(field, id));
      bodyEl.dataset.boardWords = "1";
      return;
    }
    if (bodyEl.dataset.boardWords === "1") {
      const msg = list.find((m) => m && m.id === id);
      bodyEl.innerHTML = boardFromChatStaticBodyHTML(msg);
      delete bodyEl.dataset.boardWords;
    }
  });
}

function boardRevealMessages(ids, gap) {
  const scroll = document.querySelector("#chat-scroll");
  const composer = document.querySelector("#view > .composer.is-board");
  if (!scroll || !composer || !ids.length) return;
  boardFloatComposer();
  const clearance = typeof gap === "number" ? gap : 12;
  const limit = composer.getBoundingClientRect().top - clearance;
  const viewBottom = scroll.getBoundingClientRect().bottom;
  let overflow = 0;
  for (const id of ids) {
    const sel = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : String(id).replace(/"/g, "");
    const el = scroll.querySelector(`.msg[data-msg-id="${sel}"]`);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (rect.top > viewBottom) continue;
    if (rect.bottom > limit) overflow = Math.max(overflow, rect.bottom - limit);
  }
  if (overflow > 1) scroll.scrollTop += overflow;
}

function boardRevealFromChat() {
  const ids = (typeof S !== "undefined" && S.boardFromChat && S.boardFromChat.selected) || [];
  boardRevealMessages(ids);
}

function boardRevealWordSource() {
  const mode = typeof S !== "undefined" ? S.boardFromChat : null;
  const ids = (mode?.selected || []).slice();
  const id = mode?.words?.[mode.correcting]?.messageId || "";
  if (id && !ids.includes(id)) ids.push(id);
  if (ids.length) boardRevealMessages(ids, 48);
}

function boardWireFromChatBar(view) {
  const root = view || document.getElementById("view");
  if (!root) return;
  root.querySelector("[data-board-from-cancel]")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (typeof S !== "undefined") S.boardFromChat = null;
    if (typeof renderView === "function") renderView(true);
  });
  root.querySelector("[data-board-from-done]")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (typeof S !== "undefined" && S.boardFromChat) { S.boardFromChat.correcting = null; S.boardFromChat.typing = null; }
    boardSyncFromChat();
  });
  root.querySelector("[data-board-from-go]")?.addEventListener("click", (e) => {
    e.preventDefault();
    boardCreateFromChat();
  });
  root.querySelector("[data-board-from-update]")?.addEventListener("click", (e) => {
    e.preventDefault();
    boardApplyEventUpdate();
  });
  root.querySelector("[data-board-from-confirm]")?.addEventListener("change", (e) => {
    if (typeof S !== "undefined" && S.boardFromChat) S.boardFromChat.confirmAttendance = !!e.target.checked;
  });
  root.querySelector("[data-board-from-alt]")?.addEventListener("click", (e) => {
    e.preventDefault();
    boardToggleFromChatAltDate();
  });
  root.querySelectorAll("[data-board-from-correct]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      boardBeginWordCorrect(btn.dataset.boardFromCorrect || "");
    });
  });
  root.querySelectorAll("[data-board-from-clear]").forEach((btn) => {
    btn.addEventListener("pointerdown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      boardClearFromChatField(btn.dataset.boardFromClear || "");
    });
  });
  root.querySelectorAll("[data-board-from-type]").forEach((input) => {
    const field = input.dataset.boardFromType || "";
    input.addEventListener("input", () => boardTypeFromChatField(field, input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      e.preventDefault();
      if (typeof S !== "undefined" && S.boardFromChat) { S.boardFromChat.correcting = null; S.boardFromChat.typing = null; }
      boardSyncFromChat();
    });
  });
  boardWireFromChatSuggest(root);
  root.querySelectorAll("[data-board-from-pick]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      boardOpenFromChatPicker(btn.dataset.boardFromPick || "", btn);
    });
  });
  root.querySelectorAll("[data-board-from-typeit]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      boardTypeItFromChat(btn.dataset.boardFromTypeit || "");
    });
  });
  root.querySelectorAll("[data-board-from-drop]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (typeof S === "undefined" || !S.boardFromChat) return;
      const field = btn.dataset.boardFromDrop || "";
      S.boardFromChat.dropped = S.boardFromChat.dropped || {};
      if (field) {
        if (S.boardFromChat.dropped[field]) delete S.boardFromChat.dropped[field];
        else S.boardFromChat.dropped[field] = true;
      }
      boardSyncFromChat();
    });
  });
}

/* ── Date / time pickers (quick create) ──────────────────────────────── */

function boardCloseFromChatPicker() {
  document.querySelectorAll(".board-from-pop").forEach((el) => el.remove());
}

/** Sets a field from a picker: stored as typed text the readers understand
 *  ("2026-10-17", "7:30pm"), replacing any tapped words. */
function boardSetFromChatPicked(field, text) {
  const mode = typeof S !== "undefined" ? S.boardFromChat : null;
  if (!mode) return;
  mode.typed = mode.typed || {};
  mode.typed[field] = text;
  mode.words = mode.words || {};
  if (mode.words[field]) mode.words[field] = { messageId: mode.words[field].messageId, picks: [] };
  if (mode.dropped) delete mode.dropped[field];
  mode.correcting = null;
  mode.typing = null;
  boardCloseFromChatPicker();
  boardSyncFromChat();
  if (typeof boardPaintFromChatWords === "function") boardPaintFromChatWords();
}

function boardOpenFromChatPicker(field, anchor) {
  if (!BOARD_FROM_PICKABLE[field] || typeof S === "undefined" || !S.boardFromChat) return;
  boardCloseFromChatPicker();
  try { document.activeElement?.blur?.(); } catch {}
  const pop = document.createElement("div");
  pop.className = "cd-popover board-from-pop open";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", field === "date" ? "Pick a date" : "Pick a time");
  document.body.appendChild(pop);
  const opts = boardFromChatFields()?.opts || {};
  const place = () => {
    const a = (anchor?.isConnected ? anchor : document.querySelector(".board-from-bar"))?.getBoundingClientRect();
    if (!a) return;
    const r = pop.getBoundingClientRect();
    const top = Math.max(8, a.top - r.height - 8);
    const left = Math.max(10, Math.min(a.right - r.width, window.innerWidth - r.width - 10));
    pop.style.top = `${Math.round(top)}px`;
    pop.style.left = `${Math.round(left)}px`;
  };
  if (field === "date") {
    const dayStartOf = (t) => (typeof calendarDayStart === "function" ? calendarDayStart(t) : t);
    const selected = opts.day != null ? dayStartOf(opts.day) : null;
    const start = new Date(selected ?? Date.now());
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1).getTime();
    const conn = typeof activeConn === "function" ? activeConn() : null;
    const paint = () => {
      pop.innerHTML = `<div class="cd-popover-kicker"><span>Date</span></div>${typeof calendarMiniMonthHtml === "function"
        ? calendarMiniMonthHtml({ monthCursor: cursor, selectedDay: selected, events: conn?.events || [], disablePast: false, dayAttr: "data-bf-day", idPrefix: "bf" })
        : ""}`;
      const step = (n) => (e) => {
        e.preventDefault();
        e.stopPropagation();
        const d = new Date(cursor);
        cursor = new Date(d.getFullYear(), d.getMonth() + n, 1).getTime();
        paint();
      };
      pop.querySelector("#bf-month-prev")?.addEventListener("click", step(-1));
      pop.querySelector("#bf-month-next")?.addEventListener("click", step(1));
      pop.querySelectorAll("[data-bf-day]").forEach((el) => el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const d = new Date(Number(el.getAttribute("data-bf-day")));
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        boardSetFromChatPicked("date", iso);
      }));
      place();
    };
    paint();
  } else {
    const now = opts.timeText && typeof planInterpretTime === "function" ? planInterpretTime(opts.timeText) : null;
    const pending = { timeStartMin: now?.startMin ?? null, timeEndMin: null, _timeGridMinute: now?.startMin != null ? now.startMin % 60 : 0 };
    const clock = (min) => (typeof formatCreateClockMins === "function"
      ? formatCreateClockMins(min)
      : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`);
    const paint = () => {
      pop.innerHTML = typeof renderCreateTimeGridHtml === "function" ? renderCreateTimeGridHtml(pending) : "";
      pop.querySelectorAll("[data-cd-min]").forEach((el) => el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        pending._timeGridMinute = Number(el.getAttribute("data-cd-min")) || 0;
        if (pending.timeStartMin != null) pending.timeStartMin = Math.floor(pending.timeStartMin / 60) * 60 + pending._timeGridMinute;
        paint();
      }));
      pop.querySelectorAll("[data-cd-hour]").forEach((el) => el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        boardSetFromChatPicked("time", clock(Number(el.getAttribute("data-cd-hour")) * 60 + (pending._timeGridMinute || 0)));
      }));
      place();
    };
    paint();
  }
  // Tap outside (not the button that opened it) closes the picker.
  const away = (e) => {
    if (!pop.isConnected) { document.removeEventListener("pointerdown", away, true); return; }
    if (e.target.closest?.(".board-from-pop, [data-board-from-pick]")) return;
    boardCloseFromChatPicker();
    document.removeEventListener("pointerdown", away, true);
  };
  document.addEventListener("pointerdown", away, true);
}

/* ── Place suggestions (quick create) ───────────────────────────────────
   Known places (saved locations, past events) offered only when what was
   written is very nearly one of them: the same apart from capitals,
   spacing or punctuation; the start of it (3+ letters); or one typo (two in
   longer names). Never restricts: whatever was written can be created. */

function boardPlaceNorm(text) {
  return String(text || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function boardEditDistance(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Very close known places for what was written (best first, at most 3). */
function boardFromChatPlaceMatches(written) {
  const raw = String(written || "").trim();
  const q = boardPlaceNorm(raw);
  if (q.length < 3 || typeof createDraftKnownPlaces !== "function") return [];
  const out = [];
  for (const place of createDraftKnownPlaces()) {
    if (place === raw) return [];   // written exactly as known: nothing to suggest
    const full = boardPlaceNorm(place);
    const main = boardPlaceNorm(String(place).split(",")[0]);
    const bare = main.replace(/^(?:the|a|an) /, "");   // "anchor" for "The Anchor"
    const names = [...new Set([full, main, bare])];
    const cap = (n) => (n <= 6 ? 1 : 2);
    let score = 0;
    if (names.includes(q)) score = 3;                                   // capitals / punctuation
    else if (names.some((n) => n.startsWith(q))) score = 2;              // the start of it
    else if (names.some((n) => boardEditDistance(q, n, cap(n.length)) <= cap(n.length))) score = 1;   // a typo
    if (score) out.push({ place, score });
  }
  return out.sort((a, b) => b.score - a.score || a.place.length - b.place.length).slice(0, 3).map((x) => x.place);
}

function boardFromChatPlaceSuggestHTML() {
  const mode = typeof S !== "undefined" ? S.boardFromChat : null;
  const written = mode && !mode.eventId && mode.correcting === "place" ? boardFromChatOwnPhrase("place") : "";
  const hits = written ? boardFromChatPlaceMatches(written) : [];
  if (!hits.length) return `<div id="board-from-suggest" class="board-from-suggest" hidden></div>`;
  const pin = typeof ic === "function" ? ic("map-pin") : "";
  return `<div id="board-from-suggest" class="board-from-suggest" role="group" aria-label="Did you mean">
    <span class="board-from-suggest-label">Did you mean</span>
    ${hits.map((v) => `<button type="button" class="board-from-suggest-chip" data-board-from-place="${esc(v)}">${pin}<span>${esc(v)}</span></button>`).join("")}
  </div>`;
}

function boardWireFromChatSuggest(root) {
  root?.querySelectorAll?.("[data-board-from-place]").forEach((btn) => {
    if (btn._wired) return;
    btn._wired = true;
    btn.addEventListener("pointerdown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const mode = typeof S !== "undefined" ? S.boardFromChat : null;
      if (!mode) return;
      mode.typed = mode.typed || {};
      mode.typed.place = btn.dataset.boardFromPlace || "";
      if (mode.words?.place) mode.words.place = { messageId: mode.words.place.messageId, picks: [] };
      mode.correcting = null;
      mode.typing = null;
      boardSyncFromChat();
      if (typeof boardPaintFromChatWords === "function") boardPaintFromChatWords();
    });
  });
}
