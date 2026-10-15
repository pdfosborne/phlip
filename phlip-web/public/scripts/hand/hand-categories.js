/* hand-categories.js — DEFAULT_CATEGORIES, palette, category/type resolution.
 * Globals out: DEFAULT_CATEGORIES, CATEGORY_PALETTE, catById, eventTypeCards, …
 * Load after: hand-storage.js; before: hand-cards.js
 */

/* ------------------------------ event categories --------------------------- */
/* Categories group event types and lead the creation flow. Four-value ramps
   (020): light surface+icon and dark surface+icon — never algorithmic invert. */
const DEFAULT_CATEGORIES = [
  { id: "entertainment", name: "Entertainment", icon: "film", color: "#4B3BB5", paletteId: "entertainment" },
  { id: "food", name: "Food", icon: "dinner", color: "#2E6B3D", paletteId: "food" },
  { id: "social", name: "Social", icon: "party", color: "#9B2C5E", paletteId: "social" },
  { id: "sport", name: "Sport", icon: "sport", color: "#993C1D", paletteId: "sport" },
  { id: "other", name: "Other", icon: "custom", color: "#4A5262", paletteId: "other" },
];
function categoriesFor(conn) {
  const raw = (conn?.categories && conn.categories.length) ? conn.categories : DEFAULT_CATEGORIES;
  return migrateCategoryColors(raw);
}

/** Curated dual ramps. `accent` mirrors lightIcon for pass encoding / legacy match. */
const CATEGORY_PALETTE = [
  { id: "amber", accent: "#d98c2b", lightSurface: "#f8edda", lightIcon: "#d98c2b", darkSurface: "#3d2a14", darkIcon: "#f0c078" },
  { id: "food", accent: "#2E6B3D", lightSurface: "#E4F1E8", lightIcon: "#2E6B3D", darkSurface: "#1B3A28", darkIcon: "#7FD9A0" },
  { id: "brown", accent: "#a3764a", lightSurface: "#f2e7da", lightIcon: "#a3764a", darkSurface: "#3a2a1c", darkIcon: "#d4b08a" },
  { id: "entertainment", accent: "#4B3BB5", lightSurface: "#EDEBFB", lightIcon: "#4B3BB5", darkSurface: "#2A2550", darkIcon: "#A79BF5" },
  { id: "sport", accent: "#993C1D", lightSurface: "#FBE5E3", lightIcon: "#993C1D", darkSurface: "#4A2620", darkIcon: "#F0A08C" },
  { id: "social", accent: "#9B2C5E", lightSurface: "#F9E6F3", lightIcon: "#9B2C5E", darkSurface: "#4A2338", darkIcon: "#F49CC4" },
  { id: "teal", accent: "#3e8fb0", lightSurface: "#e2eff3", lightIcon: "#3e8fb0", darkSurface: "#1a3340", darkIcon: "#7ec8e0" },
  { id: "other", accent: "#4A5262", lightSurface: "#E9EBEE", lightIcon: "#4A5262", darkSurface: "#2B3340", darkIcon: "#A9B4C2" },
];

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function tintFromHex(hex, amt) {
  const rgb = hexToRgb(hex);
  if (!rgb) return "var(--bottle-2)";
  const blend = amt ?? 0.85;
  const mix = (c) => Math.round(c + (255 - c) * blend);
  return `rgb(${mix(rgb.r)},${mix(rgb.g)},${mix(rgb.b)})`;
}

function paletteEntryById(id) {
  if (!id) return null;
  return CATEGORY_PALETTE.find(p => p.id === id) || null;
}

function paletteEntryForAccent(accentHex) {
  const needle = String(accentHex || "").toLowerCase();
  if (!needle) return null;
  return CATEGORY_PALETTE.find(p =>
    (p.accent || "").toLowerCase() === needle
    || (p.lightIcon || "").toLowerCase() === needle
    || (p.darkIcon || "").toLowerCase() === needle
  ) || null;
}

function paletteEntryForCategory(cat) {
  if (!cat) return paletteEntryById("other");
  return paletteEntryById(cat.paletteId)
    || paletteEntryForAccent(cat.color)
    || paletteEntryById("other");
}

function rampColors(entryOrHex) {
  const entry = entryOrHex && typeof entryOrHex === "object" && entryOrHex.lightIcon
    ? entryOrHex
    : paletteEntryForAccent(entryOrHex);
  if (entry) return { accent: entry.lightIcon, tint: entry.lightSurface };
  const hex = typeof entryOrHex === "string" ? entryOrHex : "#6b7280";
  return { accent: hex, tint: tintFromHex(hex) };
}

function nearestPaletteId(accentHex) {
  const hit = paletteEntryForAccent(accentHex);
  if (hit) return hit.id;
  const rgb = hexToRgb(accentHex);
  if (!rgb) return "other";
  let best = CATEGORY_PALETTE[CATEGORY_PALETTE.length - 1];
  let bestDist = Infinity;
  for (const p of CATEGORY_PALETTE) {
    const pr = hexToRgb(p.lightIcon);
    if (!pr) continue;
    const d = (pr.r - rgb.r) ** 2 + (pr.g - rgb.g) ** 2 + (pr.b - rgb.b) ** 2;
    if (d < bestDist) { bestDist = d; best = p; }
  }
  return best.id;
}

function migrateCategoryColors(cats) {
  if (!Array.isArray(cats)) return cats;
  return cats.map(c => {
    if (!c) return c;
    const entry = paletteEntryById(c.paletteId)
      || paletteEntryForAccent(c.color)
      || paletteEntryById(nearestPaletteId(c.color))
      || paletteEntryById("other");
    return { ...c, paletteId: entry.id, color: entry.lightIcon };
  });
}
// Built-in label → category (mirrors EVENT_CARDS; host overrides via cardCats).
function defaultCardCats() {
  return {
    "Film night": "entertainment",
    "Games": "entertainment",
    "Dinner": "food",
    "Coffee": "food",
    "Lunch": "food",
    "Brunch": "food",
    "Pizza": "food",
    "Drinks": "social",
    "Hike": "social",
    "Party": "social",
    "Sport": "sport",
  };
}
function cardCatsFor(conn) {
  const base = defaultCardCats();
  const saved = conn?.cardCats;
  if (saved && typeof saved === "object") Object.assign(base, saved);
  // Built-in EVENT_CARDS always win over stale saved mappings (e.g. Dinner→entertainment).
  for (const c of EVENT_CARDS) {
    if (!c.custom && c.label && c.cat) base[c.label] = c.cat;
  }
  for (const c of CUSTOM_CARDS) {
    if (c.label && (saved?.[c.label] || c.cat)) base[c.label] = saved?.[c.label] || c.cat;
  }
  // §5: server event types drive category grouping when present.
  if (hasServerTypes(conn)) {
    for (const t of conn.eventTypes) { if (t.name && t.categoryId) base[t.name] = t.categoryId; }
  }
  return base;
}
const cardCat = (card) => {
  if (!card) return "other";
  const label = card.label;
  // Stock event types keep their shipped category — ignore corrupted cardCats.
  if (label) {
    const builtin = EVENT_CARDS.find(c => !c.custom && c.label === label);
    if (builtin?.cat) return builtin.cat;
  }
  const conn = activeConn();
  if (label && conn?.cardCats?.[label]) return conn.cardCats[label];
  if (card.cat) return card.cat;
  return "other";
};
// Fallback color covers categories saved before the color field existed.
function catById(id, conn) {
  const c = categoriesFor(conn || activeConn()).find(x => x.id === id)
    || { id: id || "other", name: id || "Other", icon: "custom" };
  return c.color ? c : { ...c, color: "#6b7280" };
}
function catAccent(catId) {
  const cat = catById(catId);
  return rampColors(paletteEntryForCategory(cat)).accent;
}

// Cards that can be placed into a category (built-ins + this device's customs),
// minus any the host has deleted from this space.
function removedCardsFor(conn) {
  const list = conn?.removedCards;
  return Array.isArray(list) ? list.map(l => String(l || "").trim()).filter(Boolean) : [];
}
function isRemovedEventCard(label, conn) {
  const needle = String(label || "").trim().toLowerCase();
  if (!needle) return false;
  return removedCardsFor(conn || activeConn()).some(l => l.toLowerCase() === needle);
}
function assignableEventCards(conn) {
  const cx = conn || activeConn();
  return [
    ...EVENT_CARDS.filter(c => !c.custom),
    ...CUSTOM_CARDS.map(c => ({ ...c, kind: "event" })),
  ].filter(c => !isRemovedEventCard(c.label, cx))
    .map(c => {
      const ov = cardIconOverride(c.label);
      return ov ? { ...c, icon: ov } : c;
    });
}
// The category an event title belongs to, resolved back through the card set.
function catOfTitle(title, conn) {
  const plain = (title || "").trim();
  const cx = conn || activeConn();
  const mapped = plain ? cardCatsFor(cx)[plain] : null;
  if (mapped) return mapped;
  const t = plain.toLowerCase();
  const c = EVENT_CARDS.find(c => !c.custom && c.label.toLowerCase() === t)
    || CUSTOM_CARDS.find(c => c.label.toLowerCase() === t);
  return c ? cardCat(c) : "other";
}
function catOfEvent(ev, conn) {
  const cx = conn || (ev?.id ? ownerConnOf(ev.id) : null);
  // Typed events resolve their category from the type; freeform "Other" events
  // carry a plaintext `cat`; legacy events fall back to matching the title.
  const t = eventTypeForEvent(ev, cx);
  if (t && t.categoryId) return t.categoryId;
  if (ev?.cat && categoriesFor(cx).some(c => c.id === ev.cat)) return ev.cat;
  return catOfTitle(shownField(ev?._title, ev?.title) || "", cx);
}
// The {accent, tint, icon} a ticket colors itself with — the event's own icon
// (its specific type, e.g. a custom card's face) paired with its type's colour
// band (§5), falling back to the category colour.
function catStyleFor(eventOrTitle) {
  const isObj = eventOrTitle && typeof eventOrTitle === "object";
  const catId = isObj ? catOfEvent(eventOrTitle) : catOfTitle(eventOrTitle);
  const cat = catById(catId);
  // Colour lives on the deck (category) only (006). Historical typeColorSnap
  // still wins so past events don’t recolour when a type was once overridden.
  let band = cat.color;
  let entry = paletteEntryForCategory(cat);
  if (isObj && eventOrTitle.typeColorSnap) {
    band = eventOrTitle.typeColorSnap;
    entry = paletteEntryForAccent(band) || entry;
  }
  const ramp = entry ? rampColors(entry) : rampColors(band);
  return { accent: ramp.accent, tint: ramp.tint, icon: eventIcon(eventOrTitle) };
}

/* --------------------------- first-class event types ---------------------- */
/* §5: when a server sends an `eventTypes` schema it is the shared source of
   truth for the type vocabulary — name, glyph, colour band, default duration,
   allowed locations, who-can-create. Personal space and
   older servers fall back to the built-in EVENT_CARDS pack + device customs.
   Personal `eventTypes` (e.g. pass imports) are additive — they must not hide
   the built-in Dinner / Film night pack the category editor still assigns. */

function hasServerTypes(conn = activeConn()) {
  return Array.isArray(conn?.eventTypes) && conn.eventTypes.length > 0;
}

function builtinEventTypeCards(conn = activeConn()) {
  // Personal gets the full built-in pack outside guided FTUE create. During
  // FTUE, Onboarding.filterCreateOptions further collapses to one choice;
  // lean starter avoids a long unused scroll behind that coach.
  const lean = !!(PersonalSpace.isPersonal(conn) && typeof ftueSimpleCreateActive === "function"
    && ftueSimpleCreateActive());
  const pack = lean ? PERSONAL_STARTER_CARDS : EVENT_CARDS;
  return [
    ...pack.filter(c => !c.custom),
    ...CUSTOM_CARDS.map(c => ({ ...c, kind: "event" })),
    ...pack.filter(c => c.custom),
  ].filter(c => {
    // Permanent user customs are authoritative once present; removedCards only
    // hides built-ins (and freeform Other always stays).
    if (c.custom) return true;
    if ((CUSTOM_CARDS || []).some(x =>
      String(x.label || "").toLowerCase() === String(c.label || "").toLowerCase())) {
      return true;
    }
    return !isRemovedEventCard(c.label, conn);
  });
}

function schemaEventTypeCards(conn = activeConn()) {
  // Colour comes from the deck (category) only — never from the card/type (006).
  return conn.eventTypes.slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map(t => ({
      kind: "event",
      typeId: t.id,
      icon: t.icon || "custom",
      label: t.name,
      cat: t.categoryId || "other",
      defaultDuration: t.defaultDuration || null,
      allowedLocations: Array.isArray(t.allowedLocations) && t.allowedLocations.length
        ? t.allowedLocations : null,
      whoCanCreate: t.whoCanCreate || null,
    }));
}

// Server types mapped into the hand's card shape ({icon,label,cat,kind,…}), or
// the built-in pack (+ this device's customs) for personal / legacy conns.
function eventTypeCards(conn = activeConn()) {
  if (hasServerTypes(conn)) {
    const fromSchema = schemaEventTypeCards(conn);
    // Hosted server schema is exclusive. Personal imports are additive so
    // category-assigned built-ins (Dinner, Games, …) stay in the type hand.
    if (!PersonalSpace.isPersonal(conn)) return fromSchema;
    const seen = new Set(fromSchema.map(c => String(c.label || "").toLowerCase()));
    const extras = builtinEventTypeCards(conn)
      .filter(c => !seen.has(String(c.label || "").toLowerCase()));
    return [...fromSchema, ...extras];
  }
  return builtinEventTypeCards(conn);
}

/** Types a channel can restrict — Card manager / create-hand vocabulary, minus freeform Other. */
function channelFilterableEventTypes(conn = activeConn()) {
  return eventTypeCards(conn).filter(c => !c.custom && !c.somethingElse);
}

function eventTypeChannelKeys(card) {
  return [card?.typeId, card?.id, card?.label]
    .map(v => String(v || "").trim())
    .filter(Boolean);
}

function eventTypePersistId(card) {
  return String(card?.typeId || card?.id || card?.label || "").trim();
}

function eventTypeCategoryId(card) {
  return card?.cat || card?.categoryId || "other";
}

/** Channel `enabledCardIds` may be schema ids or labels (legacy). */
function eventTypeAllowedByEnabledIds(card, enabledCardIds) {
  if (!Array.isArray(enabledCardIds)) return true;
  const set = new Set(enabledCardIds.map(id => String(id).trim().toLowerCase()).filter(Boolean));
  if (!set.size) return false;
  return eventTypeChannelKeys(card).some(k => set.has(k.toLowerCase()));
}

// Raw server type record by id (carries categoryId etc.), or null.
function eventTypeById(id, conn = activeConn()) {
  if (!id || !hasServerTypes(conn)) return null;
  return conn.eventTypes.find(t => t.id === id) || null;
}

// Raw server type record whose name matches a (possibly encrypted) title.
function eventTypeForTitleStr(title, conn = activeConn()) {
  const t = String(shown(title) || title || "").trim().toLowerCase();
  if (!t || !hasServerTypes(conn)) return null;
  return conn.eventTypes.find(x => String(x.name || "").trim().toLowerCase() === t) || null;
}

// Resolve the type for an event: by its plaintext typeId, else by title match.
function eventTypeForEvent(ev, conn = (ev && ev.id ? ownerConnOf(ev.id) : activeConn())) {
  if (!ev) return null;
  return eventTypeById(ev.typeId, conn) || eventTypeForTitleStr(ev._title || ev.title, conn);
}

/** User-facing event title: `Type: Subtitle` when a subtitle is set, else the title. */
function eventDisplayTitle(ev, conn = (ev && ev.id ? ownerConnOf(ev.id) : activeConn())) {
  if (!ev) return "";
  const base = eventTypeLabel(ev, conn);
  const subtitle = eventSubtitleText(ev);
  if (!subtitle) return base;
  if (!base || base === "…" || (typeof LOCK === "string" && base === LOCK)) return base;
  return `${base}: ${subtitle}`;
}

/** Type / title line only (no subtitle) — used on the detail building card. */
function eventTypeLabel(ev, conn = (ev && ev.id ? ownerConnOf(ev.id) : activeConn())) {
  if (!ev) return "";
  const rawTitle = typeof shown === "function" ? shown(ev._title) : (ev._title || "");
  const typeName = (ev.typeNameSnap
    || eventTypeForEvent(ev, conn)?.name
    || rawTitle
    || "").trim();
  return typeName || rawTitle || "";
}

/** Plain subtitle text, or "" when missing / sealed. */
function eventSubtitleText(ev) {
  if (!ev) return "";
  const sub = (typeof shown === "function" ? shown(ev._subtitle) : (ev._subtitle || ""));
  if (!sub || sub === "…" || (typeof LOCK === "string" && sub === LOCK)) return "";
  return String(sub).trim();
}

// Whether this member may create an event of the given type card (who-can-create).
function canUseEventType(card, conn = activeConn()) {
  if (card && card.whoCanCreate === ROLE_MODERATOR) return canModerateEvents(conn);
  return true;
}

// The typeId to stamp on a new event created with the given title, or "" when
// the title doesn't map to a server type (freeform / personal / legacy).
function typeIdForTitle(title, conn = activeConn()) {
  return eventTypeForTitleStr(title, conn)?.id || "";
}

