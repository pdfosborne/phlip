/* hand-locations.js — location collection, migration, filtering, place cards.
 * Globals out: LOCATIONS, locationsFor, harvestUsedPlaces, locationCards, flatLocationCards, …
 * Load after: hand-typed-backlog.js; before: hand-borrow.js
 */

// Saved locations: [{ label, categoryId, uses, address?, mapUrl? }]
// Place categoryId uses the SAME shared taxonomy as event decks (categoriesFor).
const PLACE_CAT_TO_SHARED = {
  food: "food",
  leisure: "entertainment",
  entertainment: "entertainment",
  social: "social",
  sport: "sport",
  work: "other",
  home: "other",
  out: "other",
  other: "other",
};

const DEFAULT_LOCATION_CATEGORY_BY_LABEL = {
  "home": "other",
  "friend's place": "other",
  "town": "other",
  "city centre": "other",
  "pub": "food",
  "coffee shop": "food",
  "restaurant": "food",
  "park": "entertainment",
  "cinema": "entertainment",
  "gym": "sport",
  "work": "other",
};


/** Map legacy place-category ids onto the shared deck taxonomy. */
function remapPlaceCategoryId(id) {
  const raw = String(id || "").trim();
  if (!raw) return "other";
  if (PLACE_CAT_TO_SHARED[raw]) return PLACE_CAT_TO_SHARED[raw];
  // Custom cats (loc_*) keep their id when promoted into shared categories.
  if (/^loc_/i.test(raw)) return raw;
  if (DEFAULT_CATEGORIES.some(c => c.id === raw)) return raw;
  return "other";
}

function inferLocationCategoryId(label) {
  const key = String(label || "").trim().toLowerCase();
  return DEFAULT_LOCATION_CATEGORY_BY_LABEL[key] || "other";
}

function normalizePlaceEntry(raw) {
  if (typeof raw === "string") {
    const label = raw.trim();
    if (!label) return null;
    return { label, categoryId: inferLocationCategoryId(label), uses: {} };
  }
  if (!raw || typeof raw !== "object") return null;
  const label = String(raw.label || "").trim();
  if (!label) return null;
  const categoryId = remapPlaceCategoryId(
    String(raw.categoryId || "").trim() || inferLocationCategoryId(label)
  );
  return {
    label,
    categoryId,
    uses: raw.uses && typeof raw.uses === "object" ? { ...raw.uses } : {},
    ...(raw.lastUsed ? { lastUsed: Number(raw.lastUsed) || 0 } : {}),
    ...(raw.address ? { address: String(raw.address) } : {}),
    ...(raw.mapUrl ? { mapUrl: String(raw.mapUrl) } : {}),
  };
}

function defaultLocationEntries() {
  // 007 — lean personal starter; full list available via borrow / New place.
  return PERSONAL_STARTER_LOCATIONS.map(label => ({
    label,
    categoryId: inferLocationCategoryId(label),
    uses: {},
  }));
}

function migrateLocationsList(list, opts = {}) {
  const seedDefaults = opts.seedDefaults !== false;
  if (!Array.isArray(list) || !list.length) return seedDefaults ? defaultLocationEntries() : [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const n = normalizePlaceEntry(raw);
    if (!n) continue;
    const key = n.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out.length ? out : (seedDefaults ? defaultLocationEntries() : []);
}

let LOCATIONS = (() => {
  const loaded = loadJSON("ash_locations_v1", null);
  const migrated = migrateLocationsList(loaded);
  try { persistJSON("ash_locations_v1", migrated); } catch {}
  return migrated;
})();

function locationsFor(conn) {
  const cx = conn || activeConn();
  if (!cx || PersonalSpace.isPersonal(cx)) return LOCATIONS.slice();
  const list = Array.isArray(cx.locations) ? cx.locations : [];
  const normalized = migrateLocationsList(list, { seedDefaults: false });
  // Overlay this device's usage / address onto the host list.
  const localByKey = new Map(LOCATIONS.map(l => [String(l.label).toLowerCase(), l]));
  return normalized.map(l => {
    const prev = localByKey.get(String(l.label).toLowerCase());
    return {
      ...l,
      uses: { ...(prev?.uses || {}), ...(l.uses || {}) },
      ...(prev?.address && !l.address ? { address: prev.address } : {}),
      ...(!l.mapUrl && prev?.mapUrl ? { mapUrl: prev.mapUrl } : {}),
    };
  });
}

/** Curated registry plus one-off places used on events / routines / typed backlog. */
function harvestUsedPlaces(conn) {
  const cx = conn || activeConn();
  const byKey = new Map();
  const add = (raw, extra = {}) => {
    const label = String(raw || "").trim();
    if (!label) return;
    const parts = typeof parseEventPlaces === "function" ? parseEventPlaces(label) : [label];
    for (const part of parts) {
      const clean = String(part || "").trim();
      if (!clean) continue;
      if (typeof isCreatePlaceTbd === "function" ? isCreatePlaceTbd(clean) : /^tbd$/i.test(clean)) continue;
      const key = clean.toLowerCase();
      if (byKey.has(key)) continue;
      const categoryId = extra.categoryId
        || (typeof inferLocationCategoryId === "function" ? inferLocationCategoryId(clean) : "other");
      byKey.set(key, {
        label: clean,
        categoryId: typeof remapPlaceCategoryId === "function" ? remapPlaceCategoryId(categoryId) : categoryId,
        uses: extra.uses && typeof extra.uses === "object" ? { ...extra.uses } : {},
        ...(extra.address ? { address: String(extra.address) } : {}),
        ...(extra.mapUrl ? { mapUrl: String(extra.mapUrl) } : {}),
      });
    }
  };

  for (const loc of locationsFor(cx)) add(loc.label, loc);
  const shownWhere = (item) => (typeof shownField === "function"
    ? shownField(item?._where, item?.where)
    : (item?._where || item?.where || ""));
  for (const ev of (cx?.events || [])) add(shownWhere(ev));
  for (const routine of (cx?.routines || [])) {
    add(shownWhere(routine) || routine?.locationLabelId);
  }
  if (typeof loadTypedBacklog === "function") {
    const places = loadTypedBacklog(cx)?.places || {};
    for (const entry of Object.values(places)) {
      if (entry?.suppressed) continue;
      add(entry.label);
    }
  }
  return [...byKey.values()];
}

function locationCatUseKey(catId) {
  return catId ? `cat:${catId}` : null;
}
function recordLocationUse(place, catId, typeLabel, opts = {}) {
  const clean = (place || "").trim();
  if (!clean) return;
  // TBD is a create-flow placeholder string, not a curated place.
  if (typeof isCreatePlaceTbd === "function" ? isCreatePlaceTbd(clean) : /^tbd$/i.test(clean)) return;
  const places = typeof parseEventPlaces === "function" ? parseEventPlaces(clean) : [clean];
  if (places.length > 1) {
    for (const part of places) recordLocationUse(part, catId, typeLabel, opts);
    return;
  }
  // Usage stats stay device-local even on a server — they rank places for this
  // device. Server place cards still come from the host's curated list.
  let loc = LOCATIONS.find(l => l.label.toLowerCase() === clean.toLowerCase());
  if (!loc) {
    // 007 — borrowed / one-off places must not dump into personal registry.
    if (opts.borrowOnly || opts.skipPersist) return;
    loc = { label: clean, categoryId: remapPlaceCategoryId(inferLocationCategoryId(clean)), uses: {} };
    LOCATIONS.push(loc);
  }
  if (!loc.categoryId) loc.categoryId = remapPlaceCategoryId(inferLocationCategoryId(clean));
  else loc.categoryId = remapPlaceCategoryId(loc.categoryId);
  if (!loc.uses) loc.uses = {};
  const typeKey = String(typeLabel || "").trim();
  if (typeKey) loc.uses[typeKey] = (loc.uses[typeKey] || 0) + 1;
  const key = locationCatUseKey(catId);
  if (key) loc.uses[key] = (loc.uses[key] || 0) + 1;
  loc.uses._total = (loc.uses._total || 0) + 1;
  loc.lastUsed = Date.now();
  persistJSON("ash_locations_v1", LOCATIONS);
  maybeCurateLocation(clean, loc.categoryId);
}

function placeTokens(label) {
  return String(label || "").toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function placeNumbers(label) {
  return placeTokens(label).filter(w => /^\d+$/.test(w));
}

/** Words that identify a place, without a leading "the" or a court number. */
function placeWords(label) {
  return placeTokens(label).filter(w => w !== "the" && w !== "a" && w !== "an" && !/^\d+$/.test(w));
}

/** Every long word plus the same numbers. Court 1 and Court 2 do not share a key. */
function placeClusterKeys(label) {
  const nums = placeNumbers(label);
  const suffix = nums.length ? ":" + nums.join("-") : "";
  return placeWords(label).filter(w => w.length >= 4).map(w => w + suffix);
}

/**
 * Longest identifying word, with numbers so Court 1 and Court 2 stay apart.
 */
function placeDuplicateKey(label) {
  const keys = placeClusterKeys(label);
  return keys.slice().sort((a, b) => b.length - a.length)[0] || "";
}

function placeNamesLookSimilar(a, b) {
  const left = String(a || "").trim().toLowerCase();
  const right = String(b || "").trim().toLowerCase();
  if (!left || !right || left === right) return false;
  if (placeNumbers(a).join("-") !== placeNumbers(b).join("-")) return false;
  const wordsA = new Set(placeWords(a).filter(w => w.length >= 4));
  return placeWords(b).some(w => w.length >= 4 && wordsA.has(w));
}

function placeMapNameAgrees(label, mapName) {
  const map = String(mapName || "").trim();
  if (!map) return true;
  const a = String(label || "").trim().toLowerCase();
  const b = map.toLowerCase();
  if (!a || a === b) return true;
  const keyA = placeDuplicateKey(label);
  const keyB = placeDuplicateKey(map);
  if (keyA && keyA === keyB) return true;
  const wordsA = placeWords(label);
  const wordsB = placeWords(map);
  if (!wordsA.length || !wordsB.length) return true;
  const shorter = wordsA.length <= wordsB.length ? wordsA : wordsB;
  const longer = wordsA.length <= wordsB.length ? wordsB : wordsA;
  return shorter.every(w => longer.includes(w));
}

/** Places on boards shown in Personal. Read-only here; the server owns the names. */
function collectShownBoardPlaces() {
  const byKey = new Map();
  const refs = typeof loadShownBoards === "function" ? loadShownBoards() : [];
  for (const ref of refs) {
    const projected = typeof resolveShownBoardProjection === "function"
      ? resolveShownBoardProjection(ref) : null;
    const src = projected?.contentConn;
    const board = projected?.sourceBoard;
    if (!src || !board) continue;
    const evCh = typeof eventChannelForBoard === "function" ? eventChannelForBoard(board, src) : null;
    const sourceName = board.name || "Board";
    const registry = typeof locationsFor === "function" ? locationsFor(src) : (src.locations || []);
    const mapFor = (label) => {
      const hit = (registry || []).find(l => String(l.label || "").toLowerCase() === String(label || "").toLowerCase());
      return String(hit?.mapUrl || "").trim();
    };
    const add = (label, mapUrl) => {
      const clean = String(label || "").trim();
      if (!clean) return;
      const key = clean.toLowerCase();
      let row = byKey.get(key);
      if (!row) {
        row = { label: clean, mapUrl: mapUrl || "", sources: [] };
        byKey.set(key, row);
      }
      if (!row.mapUrl && mapUrl) row.mapUrl = mapUrl;
      if (!row.sources.some(s => s.boardId === board.id && s.connId === src.id)) {
        row.sources.push({ connId: src.id, boardId: board.id, name: sourceName });
      }
    };
    if (!evCh) continue;
    for (const ev of src.events || []) {
      if (ev.channelId !== evCh.id) continue;
      const where = String(ev._where || ev.locationLabelId || "").trim();
      const parts = typeof parseEventPlaces === "function" ? parseEventPlaces(where) : [where];
      const eventMap = typeof eventMapUrl === "function" ? eventMapUrl(ev) : "";
      for (const part of parts) add(part, mapFor(part) || eventMap);
    }
    if (Array.isArray(evCh.enabledLocations)) {
      for (const label of evCh.enabledLocations) add(label, mapFor(label));
    }
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

function shownBoardPlaceLabel(label) {
  const want = String(label || "").trim().toLowerCase();
  if (!want) return "";
  const hit = collectShownBoardPlaces().find(row => row.label.toLowerCase() === want);
  return hit ? hit.label : "";
}

function rememberPlaceMapUrl(label, mapUrl) {
  const clean = String(label || "").trim();
  const href = (typeof parseMapLink === "function" ? parseMapLink(mapUrl)?.href : "")
    || String(mapUrl || "").trim();
  if (!clean || !href) return;
  if (typeof isCreatePlaceTbd === "function" && isCreatePlaceTbd(clean)) return;
  let loc = LOCATIONS.find(l => l.label.toLowerCase() === clean.toLowerCase());
  if (!loc) {
    loc = {
      label: clean,
      categoryId: remapPlaceCategoryId(inferLocationCategoryId(clean)),
      uses: {},
      mapUrl: href,
    };
    LOCATIONS.push(loc);
  } else if (loc.mapUrl === href) {
    return;
  } else {
    loc.mapUrl = href;
  }
  persistJSON("ash_locations_v1", LOCATIONS);
}

/** §3: when the member may add locations, promote a newly used place onto the
 *  shared curated list so everyone sees it next time. */
function maybeCurateLocation(place, categoryId) {
  const clean = (place || "").trim();
  if (!clean) return;
  // Multi-place joins are not a location; recordLocationUse splits them first.
  if (clean.includes(" · ")) return;
  const conn = activeConn();
  if (!conn || PersonalSpace.isPersonal(conn)) return;
  if (!canAddLocations(conn)) return;
  const list = locationsFor(conn).map(l => l.label);
  if (list.some(l => l.toLowerCase() === clean.toLowerCase())) return;
  const category = remapPlaceCategoryId(categoryId || inferLocationCategoryId(clean));
  if (!Array.isArray(conn.locations)) conn.locations = [];
  if (!conn.locations.some(l => String(l.label || "").toLowerCase() === clean.toLowerCase())) {
    conn.locations.push({ label: clean, categoryId: category });
  }
  send({
    type: "addLocation",
    location: clean,
    categoryId: category,
  });
}


function flatLocationCards(eventCatId, typeLabel) {
  const conn = activeConn();
  const ch = activeEventChannel();
  let list = locationsFor(conn);
  if (ch?.enabledLocations) {
    const set = new Set(ch.enabledLocations.map(l => String(l).toLowerCase()));
    list = list.filter(l => set.has(String(l.label).toLowerCase()));
  }
  const allowed = S.hand?.pending?.card?.allowedLocations
    || null;
  if (Array.isArray(allowed) && allowed.length) {
    const set = new Set(allowed.map(l => String(l).toLowerCase()));
    list = list.filter(l => set.has(String(l.label).toLowerCase()));
  }
  const localUses = new Map(LOCATIONS.map(l => [String(l.label).toLowerCase(), l.uses || {}]));
  list = list.map(l => ({
    ...l,
    categoryId: remapPlaceCategoryId(l.categoryId || inferLocationCategoryId(l.label)),
    uses: { ...(localUses.get(String(l.label).toLowerCase()) || {}), ...(l.uses || {}) },
  }));

  const catOrder = categoriesFor(conn).map(c => c.id).filter(Boolean);
  for (const l of list) {
    if (l.categoryId && !catOrder.includes(l.categoryId)) catOrder.push(l.categoryId);
  }
  if (!catOrder.includes("other")) catOrder.push("other");

  void eventCatId;
  void typeLabel;
  const out = [];
  for (const locCatId of catOrder) {
    const inCat = list.filter(l => (l.categoryId || "other") === locCatId);
    const cards = inCat.map(l => ({
        icon: "pin",
        label: l.label,
        place: l.label,
        locCat: locCatId,
        kind: "pick",
      }));
    out.push(...cards);
  }
  return out;
}

/** Place options for the create panel — flat by loc category; filtered when set. */
const CREATE_PLACE_TBD = "TBD";

/** True when place is unset or the TBD placeholder (shown as location text). */
function isCreatePlaceTbd(where) {
  const w = where == null ? "" : String(where).trim();
  return w === "" || w.toLowerCase() === CREATE_PLACE_TBD.toLowerCase();
}

function swipeCreatePlaceOptions() {
  const p = S.hand?.pending;
  if (!p) return [];
  const catId = p.catId || (p.card && typeof cardCat === "function" ? cardCat(p.card) : null);
  const typeLabel = p.card?.catPreview ? null : (p.card?.label || null);
  const cards = flatLocationCards(catId, typeLabel);
  // TBD first = default location text (leave place "open" / unset semantics).
  cards.unshift({
    icon: "pin",
    label: CREATE_PLACE_TBD,
    place: CREATE_PLACE_TBD,
    leaveOpen: true,
    skipPlace: true,
    kind: "avail",
    locOpen: true,
  });
  return applyFtueCreateFilter("pick-place", cards);
}

function locationCards(catId, typeLabel) {
  return flatLocationCards(catId, typeLabel);
}
