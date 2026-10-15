/* hand-create-time.js — NLP time parse + 15-minute start/end grid.
 * Typed clock values keep their minutes; the chevron grid still snaps to 15.
 * Load after: hand-create-swipe-model.js; before: hand-create-swipe-chrome.js
 */

function snapCreateMinutes15(mins) {
  const n = Number(mins);
  if (!Number.isFinite(n)) return 0;
  const snapped = Math.round(n / 15) * 15;
  if (snapped >= 24 * 60) return 23 * 60 + 45;
  if (snapped < 0) return 0;
  return snapped;
}

function formatCreateClockMins(mins) {
  const total = ((Number(mins) % (24 * 60)) + (24 * 60)) % (24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const hr = h % 12 === 0 ? 12 : h % 12;
  const ap = h >= 12 ? "pm" : "am";
  return m ? hr + ":" + String(m).padStart(2, "0") + ap : String(hr) + ap;
}

function formatCreateTimeRange(startMin, endMin) {
  if (startMin == null || !Number.isFinite(Number(startMin))) return "";
  const start = formatCreateClockMins(startMin);
  if (endMin == null || !Number.isFinite(Number(endMin))) return start;
  return start + "–" + formatCreateClockMins(endMin);
}

function parseCreateClockToken(raw, inheritPm) {
  const v = String(raw || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!v) return null;
  const m = v.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  let min = parseInt(m[2] || "0", 10);
  if (!Number.isFinite(h) || h > 23 || min > 59) return null;
  const ap = m[3] || "";
  if (h > 12) return (h * 60 + min) % (24 * 60);
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (!ap) {
    if (inheritPm === "pm" && h < 12) h += 12;
    else if (inheritPm === "am" && h === 12) h = 0;
    else if (!inheritPm && h > 0 && h < 7) h += 12;
  }
  return h * 60 + min;
}

function parseCreateDurationToken(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return null;
  let m = s.match(/^(\d+(?:\.\d+)?)\s*(hours?|hrs?|h)$/);
  if (m) return snapCreateMinutes15(parseFloat(m[1]) * 60);
  m = s.match(/^(\d+(?:\.\d+)?)\s*(minutes?|mins?|m)$/);
  if (m) return snapCreateMinutes15(parseFloat(m[1]));
  m = s.match(/^(\d+)\s*hour(?:s)?\s*(\d+)\s*(?:minutes?|mins?|m)?$/);
  if (m) return snapCreateMinutes15(parseInt(m[1], 10) * 60 + parseInt(m[2], 10));
  return null;
}

/** Parse free-form time into { startMin, endMin, label } or null. */
function parseCreateTimeNlp(value) {
  let s = String(value || "").trim().toLowerCase();
  if (!s || s === "tbd" || s === "tbc") return null;
  s = s.replace(/[—–]/g, "-").replace(/\s+to\s+/g, "-").replace(/\s+until\s+/g, "-");
  s = s.replace(/\s*-\s*/g, "-");
  s = s.replace(/\s+for\s+/g, " ");

  const rangeParts = s.split("-").map((p) => p.trim()).filter(Boolean);
  if (rangeParts.length >= 2) {
    const start = parseCreateClockToken(rangeParts[0]);
    if (start == null) return null;
    const startAp = /pm/.test(rangeParts[0]) ? "pm" : (/am/.test(rangeParts[0]) ? "am" : null);
    const end = parseCreateClockToken(rangeParts[1], startAp)
      ?? parseCreateClockToken(rangeParts[1] + (/am|pm/.test(rangeParts[0]) ? (rangeParts[0].match(/am|pm/) || [""])[0] : ""));
    if (end == null) {
      const label = formatCreateTimeRange(start, start + 60);
      return { startMin: start, endMin: start + 60, label };
    }
    let endMin = end;
    if (endMin <= start) endMin += 12 * 60;
    if (endMin <= start) endMin = start + 60;
    if (endMin >= 24 * 60) endMin = 24 * 60;
    const label = formatCreateTimeRange(start, endMin);
    return { startMin: start, endMin, label };
  }

  const durMatch = s.match(/^(.*?)(?:\s+)(\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m))$/);
  if (durMatch) {
    const start = parseCreateClockToken(durMatch[1]);
    const dur = parseCreateDurationToken(durMatch[2]);
    if (start != null && dur != null && dur > 0) {
      let endMin = start + dur;
      if (endMin >= 24 * 60) endMin = 24 * 60;
      return { startMin: start, endMin, label: formatCreateTimeRange(start, endMin) };
    }
  }

  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    const start = parseCreateClockToken(tokens[0]);
    const dur = parseCreateDurationToken(tokens.slice(1).join(" "));
    if (start != null && dur != null && dur > 0) {
      let endMin = start + dur;
      if (endMin >= 24 * 60) endMin = 24 * 60;
      return { startMin: start, endMin, label: formatCreateTimeRange(start, endMin) };
    }
  }

  const start = parseCreateClockToken(s);
  if (start == null) return null;
  const endMin = Math.min(start + 60, 24 * 60);
  return { startMin: start, endMin, label: formatCreateTimeRange(start, endMin) };
}

function applyCreateTimeParse(pending, raw) {
  if (!pending) return false;
  const parsed = parseCreateTimeNlp(raw);
  if (!parsed) return false;
  pending.timeText = parsed.label;
  pending.timeStartMin = parsed.startMin;
  pending.timeEndMin = parsed.endMin;
  pending.whenPrecision = "";
  pending.whenPeriod = "";
  if (pending.day != null && typeof atTime === "function") {
    pending.when = atTime(pending.day, Math.floor(parsed.startMin / 60), parsed.startMin % 60);
  }
  const span = parsed.endMin - parsed.startMin;
  if (span > 0 && typeof durationCodeFromMinutes === "function") {
    pending.duration = durationCodeFromMinutes(span);
  }
  return true;
}

function clearCreateTime(pending) {
  if (!pending) return;
  pending.timeText = "";
  pending.timeStartMin = null;
  pending.timeEndMin = null;
  pending.when = null;
  pending.whenPrecision = "unconfirmed";
  pending.duration = "";
}

function createTimeHourRangeClass(h, start, end) {
  if (start == null || !Number.isFinite(Number(start))) return "";
  const sh = Math.floor(Number(start) / 60);
  if (end == null || !Number.isFinite(Number(end))) return sh === h ? " is-start" : "";
  const eh = Math.floor(Number(end) / 60);
  if (sh === eh) return sh === h ? " is-start" : "";
  if (h === sh) return " is-start";
  if (h === eh) return " is-end";
  if (sh < eh && h > sh && h < eh) return " is-in";
  if (sh > eh && (h > sh || h < eh)) return " is-in";
  return "";
}

function renderCreateTimeGridHtml(pending) {
  const start = pending?.timeStartMin;
  const end = pending?.timeEndMin;
  const hours = [];
  for (let h = 1; h <= 23; h++) hours.push(h);
  hours.push(0);
  const hourBtns = hours.map((h) => {
    const label = typeof fmtHourGridLabel === "function" ? fmtHourGridLabel(h) : formatCreateClockMins(h * 60);
    const cls = createTimeHourRangeClass(h, start, end);
    return `<button type="button" class="cd-time-hour${cls}" data-cd-hour="${h}">${esc(label)}</button>`;
  }).join("");
  const mins = [0, 15, 30, 45].map((m) => {
    const active = start != null ? (start % 60) : (pending?._timeGridMinute ?? 0);
    const on = active === m;
    return `<button type="button" class="cd-time-min${on ? " is-on" : ""}" data-cd-min="${m}">:${String(m).padStart(2, "0")}</button>`;
  }).join("");
  return `<div class="cd-popover-kicker"><span>Time</span></div>`
    + `<div class="cd-time-grid"><div class="cd-time-hours">${hourBtns}</div>`
    + `<div class="cd-time-split" role="separator"></div>`
    + `<div class="cd-time-mins">${mins}</div></div>`;
}

function createTimeGridMinute(pending) {
  if (pending?._timeGridMinute != null) return pending._timeGridMinute;
  if (pending?.timeStartMin != null) return pending.timeStartMin % 60;
  return 0;
}

function createTimeGridDurationMins(pending) {
  if (pending?.timeStartMin != null && pending?.timeEndMin != null) {
    const span = Number(pending.timeEndMin) - Number(pending.timeStartMin);
    if (span > 0) return span;
  }
  if (pending?.duration && typeof parseDurationMins === "function") {
    const n = parseDurationMins(pending.duration);
    if (n != null && n > 0) return n;
  }
  return 60;
}

function stampCreateTimeGrid(pending) {
  if (!pending || pending.timeStartMin == null) return;
  pending.timeText = formatCreateTimeRange(pending.timeStartMin, pending.timeEndMin);
  pending.whenPrecision = "";
  if (pending.day != null && typeof atTime === "function") {
    pending.when = atTime(pending.day, Math.floor(pending.timeStartMin / 60), pending.timeStartMin % 60);
  }
  const span = pending.timeEndMin - pending.timeStartMin;
  if (span > 0 && typeof durationCodeFromMinutes === "function") {
    pending.duration = durationCodeFromMinutes(span);
  }
}

function applyCreateTimeRangeFromStart(pending, startMin, durationMins) {
  const start = snapCreateMinutes15(startMin);
  const dur = Math.max(15, Number(durationMins) || 60);
  pending.timeStartMin = start;
  pending.timeEndMin = Math.min(start + dur, 24 * 60 - 15);
  pending._timeGridMinute = start % 60;
  stampCreateTimeGrid(pending);
}

/** Minute chips rewrite start in place; end stays start + current duration. */
function applyCreateTimeGridMinute(pending, minute) {
  if (!pending) return;
  const m = snapCreateMinutes15(Number(minute) || 0) % 60;
  pending._timeGridMinute = m;
  if (pending.timeStartMin == null) return;
  const hour = Math.floor(pending.timeStartMin / 60);
  applyCreateTimeRangeFromStart(pending, hour * 60 + m, createTimeGridDurationMins(pending));
}

function applyCreateTimeGridHour(pending, hour) {
  if (!pending) return;
  const minute = createTimeGridMinute(pending);
  if (pending._timeGridStep !== "end" || pending.timeStartMin == null) {
    const dur = pending.timeStartMin != null ? createTimeGridDurationMins(pending) : 60;
    applyCreateTimeRangeFromStart(pending, hour * 60 + minute, dur);
    pending._timeGridStep = "end";
    return;
  }
  const startH = Math.floor(pending.timeStartMin / 60);
  let durH = hour - startH;
  if (durH <= 0) durH = 1;
  applyCreateTimeRangeFromStart(pending, pending.timeStartMin, durH * 60);
  pending._timeGridStep = "start";
}
