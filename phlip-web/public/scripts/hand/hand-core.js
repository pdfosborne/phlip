/* hand-core.js — day/period/duration helpers + onboard emit.
 * Globals out: ashOnboardEmit, DAY_MS, dayStart, DAY_PERIODS, duration helpers, day ink
 * Load after: hand-edit.js (or earlier hand data); before: other new hand-* modules
 */

function ashOnboardEmit(type, detail) {
  try { window.OnboardingBus?.emit?.(type, detail || {}); } catch {}
}


/* --------------------- day → period → hour helpers ------------------------ */

const DAY_MS = 86400000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Building-card / ticket date corner: "Sun 23 Aug". */
function cardDateCornerLabel(dayTs) {
  if (dayTs == null) return "";
  const d = new Date(dayTs);
  if (Number.isNaN(d.getTime())) return "";
  const mon = d.toLocaleDateString([], { month: "short" }).replace(/\.$/, "");
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${mon}`;
}

const dayStart = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const atHour = (day, hour) => { const d = new Date(day); d.setHours(hour, 0, 0, 0); return d.getTime(); };
const atTime = (day, hour, minute = 0) => { const d = new Date(day); d.setHours(hour, minute, 0, 0); return d.getTime(); };
const fmtHour = (h, m = 0) => {
  const suffix = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hr}:${String(m).padStart(2, "0")}${suffix}` : `${hr}${suffix}`;
};


const DAY_PERIODS = [
  { id: "morning", label: "Morning", icon: "morning", hour: 9, from: 8, to: 12 },
  { id: "afternoon", label: "Afternoon", icon: "afternoon", hour: 14, from: 12, to: 17 },
  { id: "evening", label: "Evening", icon: "evening", hour: 19, from: 18, to: 23 },
];

/** Weekday / weekend day inks for pill + rail numerals (not category). */
const DAY_INK_KEY = "ash_day_ink_v1";
const DAY_INK_DEFAULT = "navy";
const PAST_DAY_INK = "#b0b5bd";
const DAY_INK_PRESETS = [
  { id: "black", label: "Black",
    weekday: "#1a1d24", weekend: "#0c0e12",
    weekdayDark: "#e4e6ea", weekendDark: "#ffffff" },
  { id: "slate", label: "Slate",
    weekday: "#3d4654", weekend: "#252b36",
    weekdayDark: "#c5cad3", weekendDark: "#eef0f3" },
  { id: "navy", label: "Navy",
    weekday: "#1e3a5f", weekend: "#12263f",
    weekdayDark: "#9db8d9", weekendDark: "#cfe0f2" },
  { id: "forest", label: "Forest",
    weekday: "#1a4a3a", weekend: "#0f2f26",
    weekdayDark: "#8fc4b0", weekendDark: "#c5e6d8" },
  { id: "burgundy", label: "Burgundy",
    weekday: "#5c1a2e", weekend: "#3d101e",
    weekdayDark: "#d4a0b0", weekendDark: "#ecc8d4" },
  { id: "plum", label: "Plum",
    weekday: "#4a2a5a", weekend: "#30183c",
    weekdayDark: "#c9a8d8", weekendDark: "#e6d0f0" },
  { id: "teal", label: "Teal",
    weekday: "#1a4a5a", weekend: "#0f303c",
    weekdayDark: "#8ec4d4", weekendDark: "#c5e4ee" },
  { id: "rust", label: "Rust",
    weekday: "#8a3a22", weekend: "#5c2616",
    weekdayDark: "#e0a890", weekendDark: "#f0d0c0" },
];
let activeDayInkId = DAY_INK_DEFAULT;

function dayInkPresetById(id) {
  return DAY_INK_PRESETS.find(p => p.id === id)
    || DAY_INK_PRESETS.find(p => p.id === DAY_INK_DEFAULT)
    || DAY_INK_PRESETS[0];
}

function dayInkFor(dayTs, { past = false } = {}) {
  if (past) return PAST_DAY_INK;
  const p = dayInkPresetById(activeDayInkId);
  return isWeekendDay(dayTs) ? p.weekend : p.weekday;
}

function syncDayInkCssVars() {
  const p = dayInkPresetById(activeDayInkId);
  const weekday = p.weekday;
  const weekend = p.weekend;
  const root = document.documentElement;
  root.style.setProperty("--day-ink", weekday);
  root.style.setProperty("--day-ink-weekend", weekend);
  /* Outline buttons + text indicators follow Day color, not highlight pack theme. */
  root.style.setProperty("--ui-accent", weekday);
  root.style.setProperty("--ui-accent-dim", weekend);
  root.style.setProperty("--ui-tint", `color-mix(in srgb, ${weekday} 10%, var(--card-bg))`);
}

function applyDayInk(id, { persist = true, refresh = true } = {}) {
  const p = dayInkPresetById(id);
  activeDayInkId = p.id;
  syncDayInkCssVars();
  if (persist) {
    if (typeof storageSetText === "function") storageSetText(DAY_INK_KEY, p.id);
    else try { localStorage.setItem(DAY_INK_KEY, p.id); } catch { /* ignore */ }
  }
  if (refresh && typeof viewingEventsBoard === "function" && viewingEventsBoard()
      && typeof renderView === "function") {
    try { renderView(); } catch { /* ignore mid-boot */ }
  }
}

function initDayInk() {
  // Day colour is fixed; the Theme picker is archived.
  applyDayInk(DAY_INK_DEFAULT, { persist: false, refresh: false });
}
initDayInk();

/**
 * UI chrome accent for focus-day pill fill / week label — follows Day color
 * preset (outline buttons, text indicators), not highlight pack theme.
 */
function syncUiAccentFromDayTheme() {
  syncDayInkCssVars();
}


// Map a clock hour onto Morning / Afternoon / Evening for day-zoom sections
// (boundaries match DAY_PERIODS: morning < afternoon.from < evening.from).
function daySectionForHour(h) {
  if (h < DAY_PERIODS[1].from) return "morning";
  if (h < DAY_PERIODS[2].from) return "afternoon";
  return "evening";
}

/** Morning / afternoon / evening for an event (period TBD or clock hour). */
function eventPeriodId(evLike, when) {
  const ev = (evLike && typeof evLike === "object") ? evLike : null;
  if (ev?.whenPrecision === "period" && ["morning", "afternoon", "evening"].includes(ev.whenPeriod)) {
    return ev.whenPeriod;
  }
  if (ev?.whenPrecision === "day" || ev?.whenPrecision === "unconfirmed") return "tbd";
  const ts = when ?? ev?.when;
  if (!ts) return "tbd";
  const h = new Date(ts).getHours();
  return (typeof daySectionForHour === "function" ? daySectionForHour(h) : null)
    || periodOfHour(h)
    || "tbd";
}

/** Rail colours: category accent/tint; period id/label still drive time shorthand. */
function periodStyleFor(evLike, when) {
  const id = eventPeriodId(evLike, when);
  const p = DAY_PERIODS.find(x => x.id === id);
  const ev = (evLike && typeof evLike === "object")
    ? evLike
    : { when: when ?? evLike };
  const cat = (typeof catStyleFor === "function")
    ? catStyleFor(ev)
    : { accent: "#6b7280", tint: "#f3f4f6" };
  return {
    period: id,
    label: p?.label || "TBD",
    icon: p?.icon || "clock",
    accent: cat.accent,
    tint: cat.tint,
  };
}

/** Fixed + period duration presets for events (default 1h). */
const DURATION_PRESETS = [
  { id: "5m", label: "5 min", icon: "clock", mins: 5 },
  { id: "10m", label: "10 min", icon: "clock", mins: 10 },
  { id: "15m", label: "15 min", icon: "clock", mins: 15 },
  { id: "30m", label: "30 min", icon: "clock", mins: 30 },
  { id: "45m", label: "45 min", icon: "clock", mins: 45 },
  { id: "1h", label: "1 hr", icon: "clock", mins: 60 },
  { id: "2h", label: "2 hr", icon: "clock", mins: 120 },
  { id: "3h", label: "3 hr", icon: "clock", mins: 180 },
  { id: "4h", label: "4 hr", icon: "clock", mins: 240 },
  { id: "morning", label: "All morning", icon: "morning", period: "morning" },
  { id: "afternoon", label: "All afternoon", icon: "afternoon", period: "afternoon" },
  { id: "evening", label: "All evening", icon: "evening", period: "evening" },
  { id: "day", label: "All day", icon: "sun", period: "day" },
];
const DEFAULT_DURATION = "1h";
const DURATION_CODES = new Set(DURATION_PRESETS.map(p => p.id));

/** Minutes for `90m` / `2h`, or a fixed preset — null for period/day codes. */
function parseDurationMins(code) {
  const c = String(code || "").trim();
  if (!c) return null;
  const preset = DURATION_PRESETS.find(p => p.id === c);
  if (preset) return preset.mins != null ? preset.mins : null;
  const m = /^(\d+)m$/i.exec(c);
  if (m) return Math.max(1, Math.min(24 * 60, Number(m[1])));
  const h = /^(\d+)h$/i.exec(c);
  if (h) return Math.max(1, Math.min(24, Number(h[1]))) * 60;
  return null;
}

/** Prefer a named preset when mins match; else `Nm` for arbitrary end clocks. */
function durationCodeFromMinutes(mins) {
  const n = Math.max(5, Math.round(Number(mins) / 5) * 5);
  const preset = DURATION_PRESETS.find(p => p.mins === n);
  return preset ? preset.id : `${n}m`;
}

function normalizeDuration(code) {
  const c = String(code || "").trim();
  if (DURATION_CODES.has(c)) return c;
  const mins = parseDurationMins(c);
  if (mins != null) return durationCodeFromMinutes(mins);
  return DEFAULT_DURATION;
}

function durationLabel(code) {
  const c = normalizeDuration(code);
  const preset = DURATION_PRESETS.find(p => p.id === c);
  if (preset) return preset.label;
  const mins = parseDurationMins(c);
  if (mins == null) return "1 hr";
  if (mins % 60 === 0) {
    const hrs = mins / 60;
    return hrs === 1 ? "1 hr" : `${hrs} hr`;
  }
  return `${mins} min`;
}

function durationToMs(code) {
  const c = normalizeDuration(code);
  const preset = DURATION_PRESETS.find(x => x.id === c);
  if (preset?.mins != null) return preset.mins * 60e3;
  const mins = parseDurationMins(c);
  return mins != null ? mins * 60e3 : null;
}

function cardDurationsFor(conn = activeConn()) {
  const saved = conn?.cardDurations;
  const out = (saved && typeof saved === "object") ? { ...saved } : {};
  // §5: server event types carry their own default duration when present.
  if (hasServerTypes(conn)) {
    for (const t of conn.eventTypes) { if (t.name && t.defaultDuration) out[t.name] = t.defaultDuration; }
  }
  return out;
}

/** Default duration for an event type label (server/personal setting), else 1h. */
function defaultDurationForTitle(title, conn = activeConn()) {
  const plain = String(shown(title) || title || "").trim();
  if (!plain) return DEFAULT_DURATION;
  const map = cardDurationsFor(conn);
  return normalizeDuration(map[plain] || DEFAULT_DURATION);
}

function effectiveDuration(ev, conn = ownerConnFor(ev) || activeConn()) {
  if (ev?.duration) {
    const raw = String(ev.duration).trim();
    if (DURATION_CODES.has(raw) || parseDurationMins(raw) != null) return normalizeDuration(raw);
  }
  return defaultDurationForTitle(ev?._title || ev?.title, conn);
}

/** End timestamp from start + duration (period presets end at period close). */
function eventEndWhen(ev, conn = ownerConnFor(ev) || activeConn()) {
  if (ev?.calendarImported && Number.isFinite(ev.calendarEndMs)) return ev.calendarEndMs;
  if (!ev?.when) return null;
  const code = effectiveDuration(ev, conn);
  const fixed = durationToMs(code);
  if (fixed != null) return ev.when + fixed;
  const day = dayStart(ev.when);
  if (code === "day") return day + DAY_MS;
  const p = DAY_PERIODS.find(x => x.id === code);
  if (p) {
    const end = day + p.to * 3600e3;
    return Math.max(end, ev.when + 5 * 60e3);
  }
  return ev.when + 3600e3;
}

// What to show in place of an exact clock time, based on how precisely the
// event's time was actually pinned down.
function whenLabel(ev) {
  if (ev.whenPrecision === "unconfirmed") return "Time TBC";
  if (ev.whenPrecision === "period") {
    const p = DAY_PERIODS.find(p => p.id === ev.whenPeriod);
    return p ? `${p.label} Time TBC` : "Time TBC";
  }
  // "day" — the drag was released just on a day chip, before narrowing to a
  // period or exact hour at all, so there's nothing more specific to show.
  if (ev.whenPrecision === "day") return "Time TBC";
  return fmtTime(ev.when);
}
