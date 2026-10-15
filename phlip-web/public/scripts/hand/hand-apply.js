/* hand-apply.js — event field helpers still used outside the archived tray.
 * Globals out: CHAIN_GAP_MS, applyEventDetails, applyEventIcon, applyEventCategory
 * The tray's card-play helpers are archived (archive/web/E23-card-hand-open-pitch).
 * Load after: hand-render.js; before: hand.js facade
 */


// Purely a sort-order placeholder for chain links — how far apart they land
// in the list relative to one another and the primary. Not shown to the
// user: chain links start as "Time TBD" (see whenPrecision below) since
// there's no reason to assume any particular gap between them until someone
// actually sets one, from the event's own detail page, after it's created.
const CHAIN_GAP_MS = 2 * 3600e3;

async function applyEventDetails(eventId, details) {
  const conn = ownerConnOf(eventId) || activeConn();
  const plain = (details || "").trim();
  const cipher = plain ? await encrypt(plain, conn.key) : "";
  send({ type: "setEventDetails", eventId, details: cipher }, conn.id);
  const ev = conn?.events?.find(e => e.id === eventId);
  if (ev) { ev.details = cipher; ev._details = plain; }
  toast(plain ? "Description saved" : "Description cleared");
  ashOnboardEmit("hand:action", { kind: "details", eventId, details: plain });
}

async function applyEventIcon(eventId, icon) {
  const conn = ownerConnOf(eventId) || activeConn();
  send({
    type: "setEventIcon",
    eventId,
    icon: (icon || "").trim(),
  }, conn.id);
}

function applyEventCategory(eventId, categoryId) {
  const conn = ownerConnOf(eventId) || activeConn();
  const ev = conn.events.find(e => e.id === eventId);
  const label = shown(ev?._title)?.trim();
  if (!label || !categoryId) return;
  if (!conn.cardCats) conn.cardCats = {};
  conn.cardCats[label] = categoryId;
  const custom = CUSTOM_CARDS.find(c => c.label.toLowerCase() === label.toLowerCase());
  if (custom) {
    custom.cat = categoryId;
    persistJSON("ash_custom_cards_v1", CUSTOM_CARDS);
  }
  if (PersonalSpace.isPersonal(conn)) {
    const personal = loadJSON("ash_personal_card_cats_v1", null) || {};
    personal[label] = categoryId;
    persistJSON("ash_personal_card_cats_v1", personal);
  }
  cacheConn(conn);
  toast(`Category updated to ${catById(categoryId).name}`);
  if (affectsActiveView(conn, eventId)) renderView();
  send({ type: "setEventCategory", label, categoryId }, conn.id);
}

// spec: number of days to add, or "month" to add one calendar month.
