/* hand-create-swipe-model.js — shared helpers for the in-feed draft card:
 * dirty slots, post readiness, FTUE filters, icon commit, day rebase.
 * Globals out: markCreateDirty, createDraftHasManual, createSwipeReadyToPost, applyFtueCreateFilter,
 *   ftueSimpleCreateActive, commitCreateIcon, rebasePendingOntoDay
 * The old swipe-create sheet is archived (archive/web/B-old-create).
 * Load after: hand-create-entry.js; before: hand-create-time.js
 */

function markCreateDirty(slot) {
  const p = typeof S !== "undefined" ? S.hand?.pending : null;
  if (!p) return;
  p.dirtySlots = p.dirtySlots || {};
  p.dirtySlots[slot] = true;
}

function createDraftHasManual(pending, slot) {
  return !!(pending?.dirtySlots && pending.dirtySlots[slot]);
}

function createSwipeReadyToPost(pending) {
  const p = pending || (typeof S !== "undefined" ? S.hand?.pending : null);
  if (!p) return false;
  const title = String(p.title || p.subtitle || "").trim();
  if (!title) return false;
  if (p.day == null && p.when == null) return false;
  if (typeof createDraftLocationBlocked === "function" && createDraftLocationBlocked(p)) return false;
  return true;
}

function applyFtueCreateFilter(mode, cards) {
  try {
    if (typeof window.Onboarding?.filterCreateOptions === "function") {
      const next = window.Onboarding.filterCreateOptions(mode, cards);
      if (Array.isArray(next)) return next;
    }
  } catch {}
  return cards;
}

function ftueSimpleCreateActive() {
  try {
    return !!(typeof window.Onboarding?.ftueSimpleCreate === "function"
      && window.Onboarding.ftueSimpleCreate());
  } catch {
    return false;
  }
}

function commitCreateIcon(pending, icon) {
  if (!pending) return;
  pending.icon = icon || "calendar";
  pending.iconExplicit = true;
  pending.card = pending.card || {};
  pending.card.icon = pending.icon;
  pending.card.label = pending.title || pending.card.label || "";
  markCreateDirty("icon");
}

/** Move pending.when onto dayTs, preserving clock / period / fuzzy precision. */
function rebasePendingOntoDay(pending, dayTs) {
  if (!pending || dayTs == null) return pending;
  pending.day = dayTs;
  if (pending.when == null) return pending;
  const like = {
    when: pending.when,
    whenPrecision: pending.whenPrecision || null,
    whenPeriod: pending.whenPeriod || pending.period || null,
  };
  if (typeof whenOnDay === "function") {
    const next = whenOnDay(like, dayTs);
    pending.when = next.when;
    if ("whenPrecision" in next) pending.whenPrecision = next.whenPrecision;
    if ("whenPeriod" in next) {
      pending.whenPeriod = next.whenPeriod;
      if (next.whenPeriod) pending.period = next.whenPeriod;
    }
  } else {
    const src = new Date(pending.when);
    const d = new Date(dayTs);
    d.setHours(src.getHours(), src.getMinutes(), 0, 0);
    pending.when = d.getTime();
  }
  if (typeof markCreateDirty === "function") markCreateDirty("time");
  return pending;
}
