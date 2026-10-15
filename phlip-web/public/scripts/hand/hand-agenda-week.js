/* hand-agenda-week.js — date helpers kept from the archived Month / Week / Day views:
 * week start, day labels and headings, weekend check, create-day seed, date divider.
 * Globals out: weekStartMon, relativeDayLabel, dayHeading, dayBandClass, isWeekendDay, seedCreateDayTs, dateDivider, …
 * The agenda week / month views are archived (archive/web/A-month-week-day).
 * Load after: hand-availability.js; before: hand-create-entry.js
 */

// Monday-start week containing a timestamp — drives the always-visible week
// label in the header.
function weekStartMon(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // 0=Mon … 6=Sun
  return d.getTime();
}

function dayOrdinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  const suf = { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
  return `${n}${suf}`;
}

function dayDatePhrase(ts) {
  const d = new Date(dayStart(ts));
  const month = d.toLocaleDateString([], { month: "short" }).replace(/\.$/, "");
  return `${dayOrdinal(d.getDate())} ${month}`;
}

// Relative day wording: Today / Tomorrow / weekday further out.
// Week context comes from agenda week dividers, not "This/Next" prefixes.
function relativeDayLabel(ts, { compact = false } = {}) {
  const day = dayStart(ts);
  const today = dayStart(Date.now());
  const dow = WEEKDAYS[new Date(day).getDay()];
  if (day === today) return "Today";
  if (day === today + DAY_MS) return "Tomorrow";
  if (day === today - DAY_MS) return "Yesterday";

  const d = new Date(day);
  if (compact) return dow;
  return `${dow} ${dayOrdinal(d.getDate())} ${d.toLocaleDateString([], { month: "short" }).replace(/\.$/, "")}`;
}

// Which relative band a day sits in — drives timeline colouring.
function dayWeekBand(dayTs) {
  const day = dayStart(dayTs);
  const today = dayStart(Date.now());
  if (day === today) return "today";
  if (day < today) return "past";
  const weeksAhead = Math.round((weekStartMon(day) - weekStartMon(today)) / (7 * DAY_MS));
  if (weeksAhead === 0) return "this-week";
  if (weeksAhead === 1) return "next-week";
  return "later";
}

// Timeline day heading: "Today 27th Jul", then plain "Sat 1st Aug".
// Week boundaries are marked with agenda week dividers (not "This/Next").
function dayHeading(dayTs) {
  const day = dayStart(dayTs);
  const today = dayStart(Date.now());
  const dow = WEEKDAYS[new Date(day).getDay()];
  const datePart = dayDatePhrase(day);
  if (day === today) return `Today ${datePart}`;
  if (day === today + DAY_MS) return `Tomorrow ${datePart}`;
  if (day === today - DAY_MS) return `Yesterday ${datePart}`;
  return `${dow} ${datePart}`;
}

function dayBandClass(dayTs) {
  const band = dayWeekBand(dayTs);
  if (band === "today") return "is-today week-this";
  if (band === "this-week") return "week-this";
  if (band === "next-week") return "week-next";
  if (band === "later") return "week-later";
  return "week-past";
}

function isWeekendDay(dayTs) {
  const dow = new Date(dayStart(dayTs)).getDay();
  return dow === 0 || dow === 6;
}

/** Calendar day to pre-fill on create: explicit day, timeline focus line, then
 * locked gap/pill, then the board anchor. Past days clamp to today. */
function seedCreateDayTs(explicitDay) {
  const today = typeof dayStart === "function" ? dayStart(Date.now()) : Date.now();
  const clamp = (raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return today;
    const d = typeof dayStart === "function" ? dayStart(n) : n;
    return d < today ? today : d;
  };
  if (explicitDay != null && explicitDay !== "") return clamp(explicitDay);
  if (typeof timelineFocusDay === "function") {
    const focus = timelineFocusDay();
    if (focus != null && Number.isFinite(Number(focus))) return clamp(focus);
  }
  const locked = typeof lockedCreateDayTs === "function" ? lockedCreateDayTs() : null;
  if (locked != null && Number.isFinite(Number(locked))) return clamp(locked);
  if (typeof anchorDay === "function") return clamp(anchorDay());
  if (typeof S !== "undefined" && S.anchor) return clamp(S.anchor);
  return today;
}

// A per-date section header in the timeline (same look as the old week
// dividers). Kept for day-zoom / history; agenda week/month uses the gutter.
function dateDivider(dayTs) {
  const el = document.createElement("div");
  el.className = `week-divider date-divider ${dayBandClass(dayTs)}`;
  el.dataset.day = String(dayTs);
  el.dataset.when = String(dayTs);
  el.innerHTML = `<span>${dayHeading(dayTs)}</span>`;
  return el;
}
