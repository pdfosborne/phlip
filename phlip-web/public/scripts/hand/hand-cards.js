/* hand-cards.js — EVENT_CARDS, starter packs, accent/tab/badge, icon overrides.
 * Globals out: EVENT_CARDS, playCardAccent, playCardInnerHtml, CARD_ICON_*, …
 * Load after: hand-categories.js; before: hand-drafts.js
 */

const EVENT_CARDS = [
  { icon: "dinner", label: "Dinner", kind: "event", cat: "food" },
  { icon: "coffee", label: "Coffee", kind: "event", cat: "food" },
  { icon: "lunch", label: "Lunch", kind: "event", cat: "food" },
  { icon: "brunch", label: "Brunch", kind: "event", cat: "food" },
  { icon: "pizza", label: "Pizza", kind: "event", cat: "food" },
  { icon: "drinks", label: "Drinks", kind: "event", cat: "social" },
  { icon: "film", label: "Film night", kind: "event", cat: "entertainment" },
  { icon: "games", label: "Games", kind: "event", cat: "entertainment" },
  { icon: "hike", label: "Hike", kind: "event", cat: "social" },
  { icon: "party", label: "Party", kind: "event", cat: "social" },
  { icon: "sport", label: "Sport", kind: "event", cat: "sport" },
  // Freeform — always under the Other category; each use asks for a name.
  { icon: "custom", label: "Other", custom: true, kind: "event", cat: "other" },
];

/** Lean personal pack during guided FTUE create only — full EVENT_CARDS otherwise. */
const PERSONAL_STARTER_CARDS = [
  { icon: "coffee", label: "Coffee", kind: "event", cat: "food" },
  { icon: "dinner", label: "Dinner", kind: "event", cat: "food" },
  { icon: "drinks", label: "Drinks", kind: "event", cat: "social" },
  { icon: "custom", label: "Other", custom: true, kind: "event", cat: "other" },
];

/** 007 — lean personal places; more via New place or borrow from a server. */
const PERSONAL_STARTER_LOCATIONS = [
  "Home",
  "Town",
  "Work",
  "Friend's place",
];

function playCardAccent(card) {
  if (!card) return null;
  if (card.accent) return rampColors(card.accent).accent;
  if (card.cancel || card.createEventType || card.locStart || card.subPick
      || card.rsvp || card.react || card.repeat !== undefined
      || card.allDay || card.somePeriod || card.unconfirmedTime
      || card.place || card.draftLocation || card.newPlace
      || card.draftAction || card.shareConnId || card.shareChannelId
      || card.createConnId || card.createChannelId
      || card.borrowStart || card.borrowConnId || card.borrowKind || card.borrowDone)
    return null;
  const catId = card.catPick || card.cat
    || (card.kind === "event" && card.label && !card.custom ? cardCat(card) : null);
  return catId ? catAccent(catId) : null;
}

function currentCardType() {
  return window.SUPPORTER?.selectedCardType || document.documentElement.dataset.cardType || "simple";
}

/** Typed layout (tab + icon ring) — used for sticker face type. */
function useTypedCardLayout() {
  return currentCardType() === "sticker";
}

function playCardTabLabel(card) {
  if (!card) return "";
  if (card.handDraftId) return "Draft";
  const catId = card.catPick || card.cat
    || (card.kind === "event" && card.label && !card.custom ? cardCat(card) : null);
  if (catId && catId !== "other") return catById(catId).name;
  return "";
}


function playCardBorrowBadgeHtml(card) {
  const connId = card?.borrowSourceConnId;
  if (!connId) return "";
  const conn = S.conns?.[connId];
  const name = conn ? (conn.name || conn.hostName || "Server") : "Server";
  const ico = (typeof eventSourceConnIconHTML === "function")
    ? eventSourceConnIconHTML(connId)
    : ic("pin", "ico-inline");
  return `<span class="pc-borrow-badge" title="From ${esc(name)}" aria-label="From ${esc(name)}">${ico}</span>`;
}

function playCardInnerHtml(card, extras = {}) {
  const corner = card.corner ?? (card.cat ? catById(cardCat(card)).icon : card.icon);
  const mult = extras.mult || "";
  if (card.routineId) {
    const routineTitle = card.label || "Routine";
    const routineSubtitle = String(card.routineSubtitle || "").trim();
    if (typeof eventCardHTML === "function") {
      const routineFace = eventCardHTML({
        ...card,
        _title: routineTitle,
        _subtitle: routineSubtitle,
        _where: card.routineLocation || "",
        when: null,
        whenPrecision: "unconfirmed",
      }, null, {
        size: "building",
        hideDate: true,
        omitPendingBanner: true,
        preserveEmptySlots: false,
        eventCardPreset: typeof eventCardPresetForRoutine === "function"
          ? eventCardPresetForRoutine(card)
          : null,
        slots: {
          title: routineTitle,
          subtitle: routineSubtitle,
          timeLabel: card.routineTime || "",
          timeState: card.routineTime ? "on" : "off",
          where: card.routineLocation || "",
        },
      });
      return `<span class="pc-routine-canonical">${routineFace}</span>${mult}`;
    }
    return `
      <span class="pc-routine-face">
        <span class="pc-routine-image-zone"><span class="pc-routine-visual"><span class="pc-routine-icon">${ic(card.icon || "calendar-sync")}</span></span><span class="pc-routine-title">${esc(routineTitle)}</span></span>
        <span class="pc-routine-subtitle${routineSubtitle ? " on" : " off"}">${routineSubtitle ? esc(routineSubtitle) : ""}</span>
        <span class="pc-routine-info-zone">
          ${card.routineTime ? `<span class="pc-routine-time">${ic("clock", "ico-inline")}${esc(card.routineTime)}</span>` : ""}
          ${card.routineLocation ? `<span class="pc-routine-location">${ic("pin", "ico-inline")}${esc(card.routineLocation)}</span>` : ""}
        </span>
      </span>
      ${mult}`;
  }
  const isDraft = !!card.handDraftId;
  const isQuick = !!card.quickField;
  const cornerMark = isDraft ? "edit" : corner;
  // Skip corner glyphs when they'd just duplicate the face icon (Busy, React, …).
  // Keep them for distinct marks: category gems, date numbers, draft pencil, etc.
  const showCorners = !!cornerMark && (isDraft || String(cornerMark) !== String(card.icon || ""));
  const draftSub = (isDraft || (isQuick && card.draftSub))
    ? `<span class="pc-draft-sub">${esc(card.draftSub || (isDraft ? "Keep building" : ""))}</span>` : "";
  const draftRibbon = isDraft
    ? `<span class="pc-draft-ribbon" aria-hidden="true">Draft</span>` : "";
  const borrowBadge = playCardBorrowBadgeHtml(card);
  const roleMarks = card.roleMarksHtml || "";
  if (useTypedCardLayout()) {
    const tab = playCardTabLabel(card);
    const tabHtml = tab ? `<span class="pc-tab">${esc(tab).toUpperCase()}</span>` : "";
    return `
      ${draftRibbon}
      ${tabHtml}
      <span class="pc-body">
        <span class="pc-icon-ring">
          <span class="pc-icon${card.corner ? " pc-icon-text" : ""}">${ic(card.icon)}${card.selectedIcon ? `<span class="pc-mult">✓</span>` : ""}</span>
        </span>
        ${card.label ? `<span class="pc-label">${esc(card.label)}</span>` : ""}
        ${roleMarks}
        ${draftSub}
      </span>
      ${borrowBadge}
      ${mult}`;
  }
  const brCorner = borrowBadge
    || (showCorners ? `<span class="pc-corner pc-corner-br">${ic(cornerMark)}</span>` : "");
  return `
    ${draftRibbon}
    ${showCorners ? `<span class="pc-corner pc-corner-tl">${ic(cornerMark)}</span>` : ""}
    <span class="pc-icon${card.corner ? " pc-icon-text" : ""}">${ic(card.icon)}${card.selectedIcon ? `<span class="pc-mult">✓</span>` : ""}</span>
    ${card.label ? `<span class="pc-label">${esc(card.label)}</span>` : ""}
    ${roleMarks}
    ${draftSub}
    ${brCorner}
    ${mult}`;
}

/** Personal overrides for built-in EVENT_CARDS icons (label → icon id). */
let CARD_ICON_OVERRIDES = (() => {
  const raw = loadJSON("ash_personal_card_icons_v1", null);
  return raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
})();
function cardIconOverride(label) {
  const key = String(label || "").trim();
  if (!key) return null;
  const direct = CARD_ICON_OVERRIDES[key];
  if (direct) return String(direct);
  const hit = Object.entries(CARD_ICON_OVERRIDES).find(([k]) =>
    k.toLowerCase() === key.toLowerCase());
  return hit ? String(hit[1]) : null;
}


// Icons a custom card can wear — the expressive subset of the app's flat
// outline pack (pure-UI glyphs like check/trash/back are left out).
const CARD_ICON_CHOICES = [
  // Food & drink.
  "dinner", "drinks", "coffee", "lunch", "brunch", "pizza", "cake",
  // Sport.
  "sport",
  // Entertainment & social.
  "film", "games", "hike", "party",
  "sun", "moon", "morning", "afternoon", "evening",
  // Scheduling / planning semantics.
  "calendar", "clock", "hourglass", "repeat", "pitch",
  // People + comms.
  "person", "addperson", "message", "share", "bell", "react",
  // Location / misc.
  "pin", "locate", "ticket", "flag",
  // “Other” style glyphs that still render as event-type icons.
  "free", "maybe", "conflict", "busy", "check",
];

/** Stable key for an event card: icon + label (moved here from the archived pitch-part1.js). */
function typeKey(c) {
  return `${c.icon}|${c.label}`;
}
