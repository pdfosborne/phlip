/* hand-storage.js — hand-owned localStorage keys, loadJSON, custom cards, usage.
 * Globals out: loadJSON, persistJSON, CUSTOM_CARDS, CARD_USAGE, CAT_USAGE, recordCardUse, …
 * Load after: storage.js, core.js; before: other hand-* modules
 */

/* --------------------- personal card memory (device-local) ----------------- */
/* Custom event-type cards, per-slot usage counts, and saved locations are
   planning habits, not server data — they live in localStorage on this device
   and never leave it (events still carry only their encrypted title/where). */

const loadJSON = storageGetJson;
const persistJSON = storageSetJson;

// User-made event-type cards: [{ icon, label }] — icon is an emoji (rendered
// as-is by ic()'s text fallback) or "custom" for the generic glyph.
// Permanent customs must NOT set `custom: true` — that flag is only for freeform Other.
let CUSTOM_CARDS = loadJSON("ash_custom_cards_v1", []);



// How often each event card lands on each weekday + time-of-day slot
// (kept for stats; hand order is user-controlled — see HAND_ORDER).
let CARD_USAGE = loadJSON("ash_card_usage_v1", {});
const periodOfHour = (h) => h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";

function recordCardUse(label, when) {
  const clean = (label || "").trim();
  if (!clean || !when) return;
  const d = new Date(when);
  const u = (CARD_USAGE[clean] ||= {});
  const k = `${d.getDay()}|${periodOfHour(d.getHours())}`;
  u[k] = (u[k] || 0) + 1;
  u._total = (u._total || 0) + 1;
  persistJSON("ash_card_usage_v1", CARD_USAGE);
}


// Category usage (stats only — hand order is user-controlled).
let CAT_USAGE = loadJSON("ash_cat_usage_v1", {});
