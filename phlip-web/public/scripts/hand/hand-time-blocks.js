/* hand-time-blocks.js — whole-day / timed / multi-day time blocks.
 * Globals out: channelAllowsTimeBlocks, timeBlockCreateCards, timeBlockRowEl,
 *   bindTimeBlockSheetHold, openTimeBlockComposer, openTimeBlockSheet, timeBlockWindowOnDay,
 *   timeBlockWhenOnDay, timeBlockLabel, CREATE_TIME_BLOCK_CARD
 * Load after: hand-availability.js; before: hand-agenda-week.js
 */

function channelAllowsTimeBlocks(conn = activeConn(), channelOrId = null) {
  const ch = typeof resolveEventChannel === "function"
    ? resolveEventChannel(conn, channelOrId)
    : null;
  if (!ch || ch.kind !== "event") return false;
  if (ch.pinnedLocationLabel != null || ch.pinnedUserId != null) return false;
  return typeof canCreateEvents === "function" ? canCreateEvents(conn, ch) : true;
}

const CREATE_TIME_BLOCK_CARD = {
  icon: "calendar-range",
  label: "Time block",
  createTimeBlock: true,
  kind: "pick",
  accent: "#5B7C99",
};

const TIME_BLOCK_ALL_DAY_END = 23 * 60 + 59;

function timeBlockCreateCards(conn = activeConn()) {
  // Time block creation moved to the timeline ⋮ menu — keep the card off the tray.
  return [];
}

function normalizeTimeBlockPeriod(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (!v || v === "null" || v === "day" || v === "whole") return null;
  if (v === "morning" || v === "afternoon" || v === "evening") return v;
  return null;
}

function normalizeTimeBlockMinutes(raw) {
  if (raw == null || raw === "" || raw === false) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(TIME_BLOCK_ALL_DAY_END, Math.round(n)));
}

function periodToStartMinutes(period) {
  const p = normalizeTimeBlockPeriod(period);
  if (p === "morning") return 8 * 60;
  if (p === "afternoon") return 12 * 60;
  if (p === "evening") return 18 * 60;
  return 0;
}

function periodToEndMinutes(period) {
  const p = normalizeTimeBlockPeriod(period);
  if (p === "morning") return 12 * 60;
  if (p === "afternoon") return 17 * 60;
  if (p === "evening") return 23 * 60;
  return TIME_BLOCK_ALL_DAY_END;
}

function timeBlockStartMinutes(block) {
  const m = normalizeTimeBlockMinutes(block?.startMinutes);
  if (m != null) return m;
  return periodToStartMinutes(block?.startPeriod);
}

function timeBlockEndMinutes(block) {
  const m = normalizeTimeBlockMinutes(block?.endMinutes);
  if (m != null) return m;
  const endDay = dayStart(Number(block?.endDay) || 0);
  const startDay = dayStart(Number(block?.startDay) || endDay);
  if (endDay > startDay) return periodToEndMinutes(block?.endPeriod);
  return periodToEndMinutes(block?.startPeriod);
}

function isTimeBlockAllDayMinutes(startM, endM) {
  return (startM == null || startM === 0)
    && (endM == null || endM === TIME_BLOCK_ALL_DAY_END);
}

function minutesToTimeInputValue(mins) {
  const m = normalizeTimeBlockMinutes(mins) ?? 0;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function parseTimeInputToMinutes(val) {
  const raw = String(val || "").trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) return null;
  const h = Number(match[1]);
  const min = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function minutesToClockLabel(mins) {
  const m = normalizeTimeBlockMinutes(mins) ?? 0;
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (typeof fmtTime === "function") {
    return fmtTime(atTime(dayStart(Date.now()), h, min));
  }
  if (typeof fmtHour === "function") return fmtHour(h, min);
  return minutesToTimeInputValue(m);
}

function msFromDayMinutes(dayTs, minutes) {
  const m = normalizeTimeBlockMinutes(minutes) ?? 0;
  return atTime(dayStart(dayTs), Math.floor(m / 60), m % 60);
}

/** Inclusive day range label, with clocks on the first/last day. */
function timeBlockLabel(block, dayTs = null) {
  if (!block) return "";
  const start = dayStart(Number(block.startDay) || 0);
  const end = dayStart(Number(block.endDay) || start);
  const startM = timeBlockStartMinutes(block);
  const endM = timeBlockEndMinutes(block);
  const allDay = isTimeBlockAllDayMinutes(startM, endM);
  const startLbl = minutesToClockLabel(startM);
  const endLbl = minutesToClockLabel(endM);

  if (dayTs != null) {
    const d = dayStart(dayTs);
    if (d === start && d === end) {
      return allDay ? "All day" : `${startLbl}–${endLbl}`;
    }
    if (d === start) return allDay || startM === 0 ? "All day" : `From ${startLbl}`;
    if (d === end) return allDay || endM === TIME_BLOCK_ALL_DAY_END ? "All day" : `Until ${endLbl}`;
    return "All day";
  }

  if (start === end) return allDay ? "All day" : `${startLbl}–${endLbl}`;

  const a = new Date(start);
  const b = new Date(end);
  const dayBit = (dt) => `${WEEKDAYS[dt.getDay()]} ${dt.getDate()}`;
  let left = dayBit(a);
  let right = dayBit(b);
  if (!allDay && startM !== 0) left = `${startLbl} ${left}`;
  if (!allDay && endM !== TIME_BLOCK_ALL_DAY_END) right = `${right} ${endLbl}`;
  return `${left}–${right}`;
}

/**
 * Absolute time window for a block on one calendar day (for day-zoom wash).
 * Middle days are whole-day; first/last use start/end minutes.
 */
function timeBlockWindowOnDay(block, dayTs) {
  if (!block) return null;
  const d0 = dayStart(dayTs);
  const start = dayStart(Number(block.startDay) || 0);
  const end = dayStart(Number(block.endDay) || start);
  if (d0 < start || d0 > end) return null;
  const startM = timeBlockStartMinutes(block);
  const endM = timeBlockEndMinutes(block);
  const allDay = isTimeBlockAllDayMinutes(startM, endM);
  if (d0 === start && d0 === end) {
    if (allDay) return { start: d0, end: d0 + DAY_MS, period: null };
    return { start: msFromDayMinutes(d0, startM), end: msFromDayMinutes(d0, endM), period: null };
  }
  if (d0 === start) {
    if (allDay || startM === 0) return { start: d0, end: d0 + DAY_MS, period: null };
    return { start: msFromDayMinutes(d0, startM), end: d0 + DAY_MS, period: null };
  }
  if (d0 === end) {
    if (allDay || endM === TIME_BLOCK_ALL_DAY_END) return { start: d0, end: d0 + DAY_MS, period: null };
    return { start: d0, end: msFromDayMinutes(d0, endM), period: null };
  }
  return { start: d0, end: d0 + DAY_MS, period: null };
}

/** Sort key / when for agenda merge on a given day. */
function timeBlockWhenOnDay(block, dayTs) {
  const win = timeBlockWindowOnDay(block, dayTs);
  return win?.start ?? dayStart(dayTs);
}

function timeBlockTitleShown(block) {
  return (typeof shownField === "function"
    ? shownField(block._title, block.title)
    : (block._title || "")).trim();
}

function timeBlockWhereShown(block) {
  return (typeof shownField === "function"
    ? shownField(block._where, block.where)
    : (block._where || "")).trim();
}

function timeBlockSignups(block) {
  return Array.isArray(block?.signups) ? block.signups : [];
}

function timeBlockSignupIds(block) {
  return timeBlockSignups(block).map(s => s.userId).filter(Boolean);
}

function isSignedUpToTimeBlock(block, userId) {
  return !!userId && timeBlockSignupIds(block).includes(userId);
}

function timeBlockSignupName(signup) {
  const id = signup?.userId;
  const n = id && typeof nameOf === "function" ? nameOf(id) : "";
  if (n && n !== "someone") return n;
  return String(signup?.name || "").trim() || "Someone";
}

function applyLocalTimeBlockSignup(block, conn, remove) {
  if (!block || !conn?.me?.id) return;
  const mine = conn.me.id;
  const list = Array.isArray(block.signups) ? block.signups : [];
  if (remove) {
    block.signups = list.filter(s => s.userId !== mine);
  } else {
    block.signups = list.filter(s => s.userId !== mine);
    block.signups.push({ userId: mine, name: conn.me.name, ts: Date.now() });
  }
}

const TIME_BLOCK_SHEET_HOLD_MS = (typeof AshGesture !== "undefined" && AshGesture.HOLD_MS) || 500;
const TIME_BLOCK_SHEET_HOLD_SLOP = 18;

/** Press-hold opens the time block sheet (plain tap does nothing). */
function bindTimeBlockSheetHold(el, blockId) {
  let holdTimer = 0;
  let sx = 0;
  let sy = 0;
  let holdFired = false;

  const clearHold = () => {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = 0;
    }
  };

  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    holdFired = false;
    sx = e.clientX;
    sy = e.clientY;
    clearHold();
    holdTimer = setTimeout(() => {
      holdTimer = 0;
      holdFired = true;
      openTimeBlockSheet(blockId);
    }, TIME_BLOCK_SHEET_HOLD_MS);
  });

  el.addEventListener("pointermove", (e) => {
    if (!holdTimer) return;
    if (Math.hypot(e.clientX - sx, e.clientY - sy) > TIME_BLOCK_SHEET_HOLD_SLOP) clearHold();
  });

  el.addEventListener("pointerup", () => clearHold());
  el.addEventListener("pointercancel", () => clearHold());

  el.addEventListener("click", (e) => {
    if (holdFired) {
      e.preventDefault();
      e.stopPropagation();
      holdFired = false;
    }
  });
}

/** Condensed agenda row — avail-like, no stub/icon/subtitle. */
function timeBlockRowEl(block, dayTs) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "time-block-row";
  el.dataset.timeBlockId = block.id;
  const whenLbl = timeBlockLabel(block, dayTs);
  const title = timeBlockTitleShown(block) || "Time block";
  const whereShown = timeBlockWhereShown(block);
  const whereOk = whereShown && whereShown !== "…" && whereShown !== "🔒";
  const faceIds = timeBlockSignupIds(block);
  const faces = (faceIds.length && typeof avatarStack === "function")
    ? avatarStack(faceIds, 2)
    : "";
  const who = faceIds.map(id => (typeof nameOf === "function" ? nameOf(id) : "")).filter(Boolean).join(", ");
  el.setAttribute("aria-label",
    `${whenLbl}${title ? `, ${title}` : ""}${whereOk ? ` — ${whereShown}` : ""}${who ? ` — ${who}` : ""}`);
  el.innerHTML =
    `<span class="time-block-when">${esc(whenLbl)}</span>` +
    `<span class="time-block-title">${esc(title)}</span>` +
    (whereOk ? `<span class="time-block-where">${esc(whereShown)}</span>` : "") +
    (faces ? `<span class="avail-faces">${faces}</span>` : "");
  bindTimeBlockSheetHold(el, block.id);
  bindTimeBlockRowNudge(el, block.id);
  return el;
}

function timeBlockModalOpen() {
  return !!document.querySelector(".modal-backdrop:not([hidden])");
}

function canEditTimeBlock(block, conn = activeConn()) {
  if (!block || !conn) return false;
  const meId = conn.me?.id;
  if (block.createdBy === meId) return true;
  if (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn)) return true;
  return typeof canModerateEvents === "function" && canModerateEvents(conn);
}

/** ArrowUp / ArrowDown shift a timed block by 15 minutes (INT-5). */
function bindTimeBlockRowNudge(el, blockId) {
  el.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    if (timeBlockModalOpen()) return;
    e.preventDefault();
    nudgeTimeBlockMinutes(blockId, e.key === "ArrowUp" ? -15 : 15);
  });
}

function nudgeTimeBlockMinutes(blockId, deltaMin) {
  const conn = activeConn();
  const block = (conn?.timeBlocks || []).find(b => b.id === blockId);
  if (!block || !canEditTimeBlock(block, conn)) return false;
  const startM = timeBlockStartMinutes(block);
  const endM = timeBlockEndMinutes(block);
  if (isTimeBlockAllDayMinutes(startM, endM)) return false;
  const nextStart = startM + deltaMin;
  const nextEnd = endM + deltaMin;
  if (nextStart < 0 || nextEnd > TIME_BLOCK_ALL_DAY_END) return false;
  const startDay = dayStart(Number(block.startDay) || 0);
  const endDay = dayStart(Number(block.endDay) || startDay);
  if (endDay === startDay && nextEnd <= nextStart) return false;
  send({
    type: "updateTimeBlock",
    timeBlockId: block.id,
    startDay,
    endDay,
    startMinutes: nextStart,
    endMinutes: nextEnd,
    startPeriod: "",
    endPeriod: "",
  }, conn.id);
  return true;
}

function timeBlockDateInputValue(ts) {
  const d = new Date(dayStart(ts));
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDayDmy(ts) {
  const d = new Date(dayStart(ts));
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatIsoDateDmy(iso) {
  const day = parseDateInputToDay(iso);
  return day ? formatDayDmy(day) : "";
}

function parseDateInputToDay(val) {
  if (!val) return null;
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(val).trim());
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    const t = new Date(year, month - 1, day).getTime();
    return Number.isFinite(t) ? dayStart(t) : null;
  }
  const t = new Date(`${val}T00:00:00`).getTime();
  return Number.isFinite(t) ? dayStart(t) : null;
}

function timeBlockDateFieldHtml(id, isoVal, ariaLabel) {
  return `<div class="tb-date-wrap">
    <span class="tb-date-face" aria-hidden="true">${esc(formatIsoDateDmy(isoVal))}</span>
    <input type="date" id="${esc(id)}" value="${esc(isoVal)}" lang="en-GB" aria-label="${esc(ariaLabel)}" />
  </div>`;
}

function wireTimeBlockDateFaces(root) {
  root.querySelectorAll(".tb-date-wrap input[type='date']").forEach((inp) => {
    const face = inp.parentElement.querySelector(".tb-date-face");
    const syncFace = () => {
      const day = parseDateInputToDay(inp.value);
      if (face) face.textContent = day ? formatDayDmy(day) : "";
    };
    inp.addEventListener("input", () => {
      syncFace();
      syncTimeBlockComposerRangeUI(root);
    });
    inp.addEventListener("change", () => {
      syncFace();
      syncTimeBlockComposerRangeUI(root);
    });
    syncFace();
  });
  syncTimeBlockComposerRangeUI(root);
}

function syncTimeBlockComposerRangeUI(root) {
  const startDay = parseDateInputToDay(root.querySelector("#tb-start")?.value);
  const endDay = parseDateInputToDay(root.querySelector("#tb-end")?.value) || startDay;
  const multi = !!(startDay && endDay && endDay > startDay);
  const endHint = root.querySelector("#tb-end-hint");
  if (endHint) {
    endHint.textContent = multi
      ? "Times apply on the first and last day; days in between are whole day."
      : "Optional end date for multi-day blocks.";
  }
}

function timeBlockComposerFieldsHtml({
  startVal, endVal, startMinutes, endMinutes,
  titlePlain = "", wherePlain = "", detailsPlain = "",
  hint = "",
}) {
  const startM = normalizeTimeBlockMinutes(startMinutes ?? 0) ?? 0;
  const endM = normalizeTimeBlockMinutes(endMinutes ?? TIME_BLOCK_ALL_DAY_END) ?? TIME_BLOCK_ALL_DAY_END;
  const startH = Math.floor(startM / 60);
  const startMin = startM % 60;
  const endH = Math.floor(endM / 60);
  const endMin = endM % 60;
  const startLabel = typeof formatTimeFieldLabel === "function"
    ? formatTimeFieldLabel(startH, startMin)
    : minutesToClockLabel(startM);
  const endLabel = typeof formatTimeFieldLabel === "function"
    ? formatTimeFieldLabel(endH, endMin)
    : minutesToClockLabel(endM);
  return `
      <label class="field">Title
        <input type="text" id="tb-title" maxlength="80" placeholder="e.g. Away, Tournament" required value="${esc(titlePlain)}" />
      </label>
      <div class="field">
        <span class="field-label">Starts</span>
        <div class="tb-datetime-row">
          ${timeBlockDateFieldHtml("tb-start", startVal, "Start date")}
          <button type="button" class="time-field-btn" id="tb-start-time" data-hour="${startH}" data-minute="${startMin}" aria-label="Start time">${esc(startLabel)}</button>
        </div>
      </div>
      <div class="field">
        <span class="field-label">Ends</span>
        <div class="tb-datetime-row">
          ${timeBlockDateFieldHtml("tb-end", endVal, "End date")}
          <button type="button" class="time-field-btn" id="tb-end-time" data-hour="${endH}" data-minute="${endMin}" aria-label="End time">${esc(endLabel)}</button>
        </div>
      </div>
      <p class="ch-scope-summary" id="tb-end-hint" style="margin:0 0 8px">${esc(hint)}</p>
      <label class="field">Place <span class="muted">(optional)</span>
        <input type="text" id="tb-where" maxlength="80" placeholder="Where" value="${esc(wherePlain)}" />
      </label>
      <label class="field">Note <span class="muted">(optional)</span>
        <input type="text" id="tb-details" maxlength="120" placeholder="Anything helpful" value="${esc(detailsPlain)}" />
      </label>`;
}

function readTimeBlockComposerForm(overlay) {
  const titlePlain = String(overlay.querySelector("#tb-title")?.value || "").trim();
  if (!titlePlain) {
    toast("Add a title");
    return null;
  }
  let startDay = parseDateInputToDay(overlay.querySelector("#tb-start")?.value);
  let endDay = parseDateInputToDay(overlay.querySelector("#tb-end")?.value) || startDay;
  if (!startDay) {
    toast("Pick a start date");
    return null;
  }
  if (!endDay || endDay < startDay) endDay = startDay;
  const startBtn = overlay.querySelector("#tb-start-time");
  const endBtn = overlay.querySelector("#tb-end-time");
  const startMinutes = startBtn
    ? (Number(startBtn.dataset.hour) * 60 + Number(startBtn.dataset.minute))
    : parseTimeInputToMinutes(startBtn?.value);
  const endMinutes = endBtn
    ? (Number(endBtn.dataset.hour) * 60 + Number(endBtn.dataset.minute))
    : parseTimeInputToMinutes(endBtn?.value);
  if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) {
    toast("Pick a start and end time");
    return null;
  }
  if (endDay === startDay && endMinutes <= startMinutes) {
    toast("End time must be after start time");
    return null;
  }
  return {
    titlePlain,
    startDay,
    endDay,
    startMinutes,
    endMinutes,
    wherePlain: String(overlay.querySelector("#tb-where")?.value || "").trim(),
    detailsPlain: String(overlay.querySelector("#tb-details")?.value || "").trim(),
  };
}

function bindTimeBlockComposerTimeButtons(overlay) {
  if (!overlay || typeof bindTimeFieldButton !== "function") return;
  const wire = (id, title) => {
    const btn = overlay.querySelector(`#${id}`);
    if (!btn) return;
    bindTimeFieldButton(btn, {
      title,
      get: () => ({
        hour: Number(btn.dataset.hour) || 0,
        minute: Number(btn.dataset.minute) || 0,
      }),
      set: ({ hour, minute }) => {
        btn.dataset.hour = String(hour);
        btn.dataset.minute = String(typeof snapTimeMinutes5 === "function" ? snapTimeMinutes5(minute) : minute);
      },
    });
  };
  wire("tb-start-time", "Start time");
  wire("tb-end-time", "End time");
}

function consumeTimeBlockDaySpan() {
  if (typeof clearTimeBlockDaySpan === "function") clearTimeBlockDaySpan();
}

/** Compose a new time block (single day or range). */
async function openTimeBlockComposer(opts = {}) {
  const conn = activeConn();
  if (!conn || !channelAllowsTimeBlocks(conn)) {
    toast("You can’t add time blocks here");
    return;
  }
  const ch = typeof resolveEventChannel === "function" ? resolveEventChannel(conn) : null;
  if (!ch) return;
  const span = (opts.startDay != null)
    ? { start: dayStart(opts.startDay), end: dayStart(opts.endDay ?? opts.startDay) }
    : null;
  let startDay = span
    ? Math.min(span.start, span.end)
    : (opts.day != null ? dayStart(opts.day) : dayStart(Date.now()));
  let endDay = span ? Math.max(span.start, span.end) : startDay;
  const startVal = timeBlockDateInputValue(startDay);
  const endVal = timeBlockDateInputValue(endDay);
  const opened = AshModal.open({
    className: "time-block-composer-modal",
    html: `
    <div class="modal-card">
      <h4>Time block</h4>
      <p class="cat-hint">Block time with a start and end. Multi-day spans use time blocks (not events).</p>
      ${timeBlockComposerFieldsHtml({
        startVal, endVal,
        startMinutes: 0,
        endMinutes: TIME_BLOCK_ALL_DAY_END,
      })}
      <div class="actions">
        <div></div>
        <div>
          <button type="button" class="cancel" id="tb-cancel">Cancel</button>
          <button type="button" class="save" id="tb-save">Save</button>
        </div>
      </div>
    </div>`,
    singleton: "return",
    onClose: consumeTimeBlockDaySpan,
  });
  if (!opened) return;
  const { overlay, close } = opened;
  wireTimeBlockDateFaces(overlay);
  bindTimeBlockComposerTimeButtons(overlay);
  overlay.querySelector("#tb-cancel").onclick = close;
  overlay.querySelector("#tb-save").onclick = async () => {
    const form = readTimeBlockComposerForm(overlay);
    if (!form) return;
    const id = typeof genLocalId === "function" ? genLocalId() : undefined;
    const title = (typeof encrypt === "function" && conn.key)
      ? await encrypt(form.titlePlain, conn.key) : form.titlePlain;
    const where = form.wherePlain && typeof encrypt === "function" && conn.key
      ? await encrypt(form.wherePlain, conn.key) : form.wherePlain;
    const details = form.detailsPlain && typeof encrypt === "function" && conn.key
      ? await encrypt(form.detailsPlain, conn.key) : form.detailsPlain;
    send({
      type: "createTimeBlock",
      id, channelId: ch.id,
      title: title || "",
      where: where || "",
      details: details || "",
      startDay: form.startDay,
      endDay: form.endDay,
      startMinutes: form.startMinutes,
      endMinutes: form.endMinutes,
      startPeriod: "",
      endPeriod: "",
    }, conn.id);
    close();
    toast("Time block saved");
  };
}

/** View / edit / delete sheet. */
async function openTimeBlockSheet(blockId) {
  const conn = activeConn();
  const block = (conn?.timeBlocks || []).find(b => b.id === blockId);
  if (!block) return;
  if (conn.key && typeof decTimeBlock === "function"
      && (block._title === undefined || block._where === undefined || block._details === undefined)) {
    try { await decTimeBlock(block, conn.key); } catch {}
  } else if (typeof hydratePlainTimeBlock === "function") {
    hydratePlainTimeBlock(block);
  }
  const meId = conn.me?.id;
  const isOwner = block.createdBy === meId;
  const canMod = typeof canModerateEvents === "function" && canModerateEvents(conn);
  const canEdit = isOwner || canMod || PersonalSpace.isPersonal(conn);
  const title = timeBlockTitleShown(block) || "Time block";
  const whenLbl = timeBlockLabel(block);
  const whereShown = timeBlockWhereShown(block);
  const detailsShown = (typeof shownField === "function"
    ? shownField(block._details, block.details)
    : (block._details || "")).trim();
  const whereOk = whereShown && whereShown !== "…" && whereShown !== "🔒";
  const detailsOk = detailsShown && detailsShown !== "…" && detailsShown !== "🔒";
  const signups = timeBlockSignups(block);
  const joined = isSignedUpToTimeBlock(block, meId);
  const signupPeople = signups.map((s) => {
    const id = s.userId;
    const name = timeBlockSignupName(s);
    const mine = id === meId ? " (you)" : "";
    const face = (id && typeof avatarStack === "function") ? avatarStack([id], 1) : "";
    return `<div class="tb-signup-person">${face}<span>${esc(name)}${esc(mine)}</span></div>`;
  }).join("");
  const signupsHtml =
    `<div class="tb-sheet-signups">
      <span class="avail-sheet-k">Signed up</span>
      ${signups.length
        ? `<div class="tb-signup-people">${signupPeople}</div>`
        : `<p class="tb-signup-empty">Nobody yet</p>`}
    </div>`;
  const metaHtml =
    `<p class="avail-sheet-meta"><span class="avail-sheet-k">When</span> ${esc(whenLbl)}</p>` +
    (whereOk
      ? `<p class="avail-sheet-meta"><span class="avail-sheet-k">Place</span> ${esc(whereShown)}</p>`
      : "") +
    (detailsOk
      ? `<p class="avail-sheet-meta"><span class="avail-sheet-k">Note</span> ${esc(detailsShown)}</p>`
      : "") +
    signupsHtml;
  const opened = AshModal.open({
    className: "time-block-sheet-modal",
    html: `
    <div class="modal-card">
      <h4>${esc(title)}</h4>
      ${metaHtml}
      <div class="actions">
        <div>${canEdit ? `<button type="button" class="danger" id="tb-delete">Delete</button>` : ""}</div>
        <div>
          <button type="button" class="cancel" id="tb-close">Close</button>
          ${joined
            ? `<button type="button" class="cancel" id="tb-leave">Leave</button>`
            : `<button type="button" class="save" id="tb-join">Join</button>`}
          ${canEdit ? `<button type="button" class="save" id="tb-edit">Edit time</button>` : ""}
        </div>
      </div>
    </div>`,
    singleton: "return",
  });
  if (!opened) return;
  const { overlay, close } = opened;
  overlay.querySelector("#tb-close").onclick = close;
  overlay.querySelector("#tb-delete")?.addEventListener("click", () => {
    send({ type: "deleteTimeBlock", timeBlockId: block.id }, conn.id);
    close();
    toast("Time block deleted");
  });
  overlay.querySelector("#tb-edit")?.addEventListener("click", () => {
    close();
    openTimeBlockEditor(block.id);
  });
  overlay.querySelector("#tb-join")?.addEventListener("click", () => {
    applyLocalTimeBlockSignup(block, conn, false);
    send({ type: "signupTimeBlock", timeBlockId: block.id }, conn.id);
    close();
    toast("You’re signed up");
    openTimeBlockSheet(block.id);
  });
  overlay.querySelector("#tb-leave")?.addEventListener("click", () => {
    applyLocalTimeBlockSignup(block, conn, true);
    send({ type: "signupTimeBlock", timeBlockId: block.id, remove: true }, conn.id);
    close();
    toast("Left time block");
    openTimeBlockSheet(block.id);
  });
}

async function openTimeBlockEditor(blockId) {
  const conn = activeConn();
  const block = (conn?.timeBlocks || []).find(b => b.id === blockId);
  if (!block) return;
  if (conn.key && typeof decTimeBlock === "function") {
    try { await decTimeBlock(block, conn.key); } catch {}
  } else if (typeof hydratePlainTimeBlock === "function") {
    hydratePlainTimeBlock(block);
  }
  const titlePlain = timeBlockTitleShown(block);
  const wherePlain = timeBlockWhereShown(block);
  const detailsPlain = (typeof shownField === "function"
    ? shownField(block._details, block.details)
    : (block._details || "")).trim();
  const startVal = timeBlockDateInputValue(block.startDay);
  const endVal = timeBlockDateInputValue(block.endDay);
  const clean = (v) => (v === "…" || v === "🔒" ? "" : v);
  const opened = AshModal.open({
    className: "time-block-composer-modal",
    html: `
    <div class="modal-card">
      <h4>Edit time block</h4>
      ${timeBlockComposerFieldsHtml({
        startVal, endVal,
        startMinutes: timeBlockStartMinutes(block),
        endMinutes: timeBlockEndMinutes(block),
        titlePlain: clean(titlePlain),
        wherePlain: clean(wherePlain),
        detailsPlain: clean(detailsPlain),
      })}
      <div class="actions">
        <div></div>
        <div>
          <button type="button" class="cancel" id="tb-cancel">Cancel</button>
          <button type="button" class="save" id="tb-save">Save</button>
        </div>
      </div>
    </div>`,
    singleton: "return",
  });
  if (!opened) return;
  const { overlay, close } = opened;
  wireTimeBlockDateFaces(overlay);
  bindTimeBlockComposerTimeButtons(overlay);
  overlay.querySelector("#tb-cancel").onclick = close;
  overlay.querySelector("#tb-save").onclick = async () => {
    const form = readTimeBlockComposerForm(overlay);
    if (!form) return;
    const title = (typeof encrypt === "function" && conn.key)
      ? await encrypt(form.titlePlain, conn.key) : form.titlePlain;
    const where = form.wherePlain && typeof encrypt === "function" && conn.key
      ? await encrypt(form.wherePlain, conn.key) : form.wherePlain;
    const details = form.detailsPlain && typeof encrypt === "function" && conn.key
      ? await encrypt(form.detailsPlain, conn.key) : form.detailsPlain;
    send({
      type: "updateTimeBlock",
      timeBlockId: block.id,
      title: title || "",
      where: where || "",
      details: details || "",
      startDay: form.startDay,
      endDay: form.endDay,
      startMinutes: form.startMinutes,
      endMinutes: form.endMinutes,
      startPeriod: "",
      endPeriod: "",
    }, conn.id);
    close();
    toast("Time block updated");
  };
}
