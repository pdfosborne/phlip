/* hand-create-entry.js — create entry for the in-feed draft card, plus the event-type lists.
 * Globals out: startFlatTypePick, eventTypesInCategory, …
 * The old category / type / new-type pick flow is archived (archive/web/B-old-create).
 * Load after: hand-agenda-week.js; before: hand-create-swipe-model.js
 */

/** After Create event (day locked): open the in-timeline draft card. */
function startFlatTypePick(opts = {}) {
  if (typeof openCreateDraft === "function") openCreateDraft(opts);
}

// Non-custom event types in a category (freeform Other is ignored for the
// exact-match "category is the event" shortcut below).
function eventTypesInCategory(catId) {
  const map = cardCatsFor(activeConn());
  const all = typeof createVisibleEventCards === "function"
    ? createVisibleEventCards()
    : enabledEventCards().filter(c => !c.custom);
  return all.filter(c => {
    const assigned = (c.label && map[c.label]) || c.cat || cardCat(c);
    return assigned === catId;
  });
}

function createVisibleEventCards(conn = activeConn(), { channel } = {}) {
  const cx = conn || activeConn();
  if (!cx) return [];
  const ch = channel !== undefined ? channel : activeEventChannel();
  return eventCardsForChannel(cx, ch).filter(c => !c.custom && !c.somethingElse);
}

// Shared eligibility for the current create surfaces. Freeform Other remains
// available even when a channel restricts its fixed event types.
function eventCardsForChannel(conn, ch) {
  // eventTypeCards already merges personal imports with the built-in pack.
  let cards = eventTypeCards(conn)
    .filter(c => canUseEventType(c, conn) && !isImportedEventCardLabel(c.label));
  if (ch?.enabledCardIds) {
    cards = cards.filter(c => c.custom || eventTypeAllowedByEnabledIds(c, ch.enabledCardIds));
  }
  return cards;
}

function enabledEventCards() {
  return eventCardsForChannel(activeConn(), activeEventChannel());
}
