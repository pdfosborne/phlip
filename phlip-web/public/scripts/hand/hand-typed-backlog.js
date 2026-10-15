/* hand-typed-backlog.js — typed title/place backlog, promotion, migration.
 * Globals out: recordTypedValue, promoteTypedPlace, promoteTypedTitle,
 *   listTypedTitleUsage, freeformTitleEntriesFromEvents, …
 * Load after: hand-drafts.js; before: hand-locations.js
 */

/* ---- 011 · Typed-value backlog (one-off places + freeform titles) -------- */
const TYPED_BACKLOG_KEY = "ash_typed_backlog_v1";


/** Significant stem for clustering near-duplicates ("The Grove" / "grove pub"). */
function typedLabelStem(label) {
  const words = String(label || "").toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w && w !== "the" && w !== "a" && w !== "an" && w !== "pub" && w !== "bar" && w !== "cafe");
  return words.sort((a, b) => b.length - a.length)[0] || "";
}

function typedNormKey(label) {
  return String(label || "").trim().toLowerCase();
}

/** Loose match key — ignore case, punctuation, and spaces ("Tennis!" ≡ "tennis"). */
function typedMatchKey(label) {
  return String(label || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Existing deck type whose label loosely matches, or null. */
function findMatchingEventCard(label, connOrId) {
  const key = typedMatchKey(label);
  if (!key) return null;
  const conn = resolveTypedConn(connOrId);
  const cards = typeof eventTypeCards === "function"
    ? eventTypeCards(conn).filter(c => !c.custom && !c.somethingElse
      && !(typeof isImportedEventCardLabel === "function" && isImportedEventCardLabel(c.label)))
    : [];
  return (cards || []).find(c => typedMatchKey(c.label) === key) || null;
}

/** Existing place whose label loosely matches, or null. */
function findMatchingPlace(label, connOrId) {
  const key = typedMatchKey(label);
  if (!key) return null;
  const conn = resolveTypedConn(connOrId);
  const list = typeof locationsFor === "function"
    ? locationsFor(conn)
    : (typeof LOCATIONS !== "undefined" ? LOCATIONS : []);
  for (const l of (list || [])) {
    const lab = typeof l === "string" ? l : l?.label;
    if (typedMatchKey(lab) === key) {
      return typeof l === "string" ? { label: l } : l;
    }
  }
  return null;
}

function typedBucket(kind) {
  return kind === "place" ? "places" : "titles";
}

/** Resolve a connection for typed-backlog scope (per server / Personal). */
function resolveTypedConn(connOrId) {
  if (connOrId && typeof connOrId === "object" && connOrId.id != null) return connOrId;
  if (typeof connOrId === "string" && connOrId) {
    if (S.conns?.[connOrId]) return S.conns[connOrId];
    if (connOrId === "personal" && typeof PersonalSpace !== "undefined" && typeof PersonalSpace.conn === "function") {
      return PersonalSpace.conn() || { id: "personal" };
    }
    return { id: connOrId };
  }
  return activeConn() || { id: "personal" };
}

function typedConnId(connOrId) {
  return String(resolveTypedConn(connOrId)?.id || "personal");
}

function emptyTypedSlice() {
  return { places: {}, titles: {} };
}

/** Root store: `{ byServer: { [connId]: { places, titles } } }`. */
function loadTypedBacklogRoot() {
  const raw = loadJSON(TYPED_BACKLOG_KEY, null);
  if (raw && typeof raw === "object" && raw.byServer && typeof raw.byServer === "object") {
    const byServer = {};
    for (const [id, slice] of Object.entries(raw.byServer)) {
      if (!slice || typeof slice !== "object") continue;
      byServer[id] = {
        places: slice.places && typeof slice.places === "object" ? slice.places : {},
        titles: slice.titles && typeof slice.titles === "object" ? slice.titles : {},
      };
    }
    return { byServer };
  }
  return { byServer: {} };
}

function saveTypedBacklogRoot(root) {
  try {
    persistJSON(TYPED_BACKLOG_KEY, root || { byServer: {} });
  } catch {}
}

/** Per-server slice `{ places, titles }` (mutates root so callers can save). */
function typedBacklogScope(connOrId) {
  const id = typedConnId(connOrId);
  const root = loadTypedBacklogRoot();
  if (!root.byServer[id]) root.byServer[id] = emptyTypedSlice();
  return { root, id, data: root.byServer[id] };
}

function loadTypedBacklog(connOrId) {
  return typedBacklogScope(connOrId).data;
}

/** True when label already exists as a saved place / event card / schema type on this server. */
function isKnownTypedPreset(kind, label, connOrId) {
  const clean = String(label || "").trim();
  if (!clean) return true;
  const key = typedMatchKey(clean);
  if (!key) return true;
  const conn = resolveTypedConn(connOrId);
  if (kind === "place") {
    return !!findMatchingPlace(clean, conn);
  }
  if (findMatchingEventCard(clean, conn)) return true;
  // Also treat category-as-type names as known (empty / sole-type decks).
  const cats = typeof categoriesFor === "function" ? categoriesFor(conn) : [];
  const cat = (cats || []).find(c => typedMatchKey(c.name) === key);
  if (cat) {
    if (typeof hasServerTypes === "function" && hasServerTypes(conn)) {
      const types = (conn.eventTypes || []).filter(t => (t.categoryId || "other") === cat.id);
      if (types.length === 0) return true;
      if (types.length === 1 && typedMatchKey(types[0].name) === key) return true;
    } else if (typeof eventTypesInCategory === "function") {
      const types = eventTypesInCategory(cat.id);
      if (types.length === 0) return true;
      if (types.length === 1 && typedMatchKey(types[0].label) === key) return true;
    }
  }
  return false;
}


/**
 * Record a free-text one-off on this server. Returns the entry, or null if skipped.
 */
function recordTypedValue(kind, label, connOrId) {
  const clean = String(label || "").trim();
  if (!clean) return null;
  if (isKnownTypedPreset(kind, clean, connOrId)) {
    clearTypedBacklogFor(kind, clean, connOrId);
    return null;
  }
  const scope = typedBacklogScope(connOrId);
  const bucket = typedBucket(kind);
  const key = typedNormKey(clean);
  const entry = scope.data[bucket][key] || { label: clean, count: 0 };
  entry.label = clean;
  entry.count = (Number(entry.count) || 0) + 1;
  entry.lastTs = Date.now();
  scope.data[bucket][key] = entry;
  saveTypedBacklogRoot(scope.root);
  return entry;
}


/** Drop exact key, loose-match keys, and same-stem variants after promote or delete-reset. */
function clearTypedBacklogFor(kind, label, connOrId) {
  const clean = String(label || "").trim();
  if (!clean) return;
  const scope = typedBacklogScope(connOrId);
  const bucket = typedBucket(kind);
  const key = typedNormKey(clean);
  const matchKey = typedMatchKey(clean);
  const stem = typedLabelStem(clean);
  delete scope.data[bucket][key];
  for (const [k, entry] of Object.entries(scope.data[bucket])) {
    const lab = entry?.label || k;
    if (matchKey && typedMatchKey(lab) === matchKey) {
      delete scope.data[bucket][k];
      continue;
    }
    if (stem && typedLabelStem(lab) === stem) delete scope.data[bucket][k];
  }
  saveTypedBacklogRoot(scope.root);
}


/**
 * Freeform titles on server events (any member), keyed for Quick create.
 * Skips titles that already match a deck card / known type.
 */
function freeformTitleEntriesFromEvents(connOrId) {
  const conn = resolveTypedConn(connOrId);
  const byMatch = new Map();
  for (const ev of (conn?.events || [])) {
    if (!ev || !ev.id) continue;
    const title = (typeof shownField === "function"
      ? shownField(ev._title, ev.title)
      : (ev._title || ev.title) || "").trim();
    if (!title) continue;
    if (isKnownTypedPreset("title", title, conn)) continue;
    // Typed deck events aren't freeform candidates even if the display title differs.
    if (ev.typeId && typeof eventTypeById === "function") {
      const t = eventTypeById(ev.typeId, conn);
      if (t && String(t.name || "").trim()) continue;
    }
    const mk = typedMatchKey(title);
    if (!mk) continue;
    let row = byMatch.get(mk);
    if (!row) {
      row = { label: title, count: 0, lastTs: 0 };
      byMatch.set(mk, row);
    }
    row.count += 1;
    const when = Number(ev.when) || Number(ev.updatedAt) || Number(ev.createdAt) || 0;
    if (when >= (Number(row.lastTs) || 0)) {
      row.lastTs = when;
      row.label = title;
    }
  }
  return [...byMatch.values()];
}

/**
 * Title usage for Card manager: server-wide event counts, plus any local-only
 * typed backlog entries (this device) that aren't already covered by events.
 */
function listTypedTitleUsage({ minCount = 1, connId } = {}) {
  const conn = resolveTypedConn(connId);
  const byMatch = new Map();
  for (const e of freeformTitleEntriesFromEvents(conn)) {
    const mk = typedMatchKey(e.label);
    if (!mk) continue;
    byMatch.set(mk, {
      label: e.label,
      count: Number(e.count) || 0,
      lastTs: Number(e.lastTs) || 0,
    });
  }
  const data = loadTypedBacklog(conn);
  for (const e of Object.values(data.titles || {})) {
    if (!e || e.suppressed) continue;
    const lab = String(e.label || "").trim();
    if (!lab) continue;
    if (isKnownTypedPreset("title", lab, conn)) continue;
    const mk = typedMatchKey(lab);
    if (!mk) continue;
    if (byMatch.has(mk)) continue; // event counts are server-wide truth
    byMatch.set(mk, {
      label: lab,
      count: Number(e.count) || 0,
      lastTs: Number(e.lastTs) || 0,
    });
  }
  return [...byMatch.values()]
    .filter(e => (Number(e.count) || 0) >= minCount)
    .sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0)
      || (Number(b.lastTs) || 0) - (Number(a.lastTs) || 0)
      || String(a.label).localeCompare(String(b.label), undefined, { sensitivity: "base" }));
}


function relinkEventsToCard(conn, { label, icon, typeId, categoryId } = {}) {
  const cx = conn || activeConn();
  const clean = String(label || "").trim();
  if (!cx || !clean) return 0;
  const lower = clean.toLowerCase();
  const nextIcon = String(icon || "").trim();
  const realIcon = nextIcon && !isUnsetEventIcon(nextIcon) ? nextIcon : "";
  const nextTypeId = typeId ? String(typeId) : "";
  const nextCat = categoryId ? String(categoryId) : "";
  let n = 0;
  for (const ev of (cx.events || [])) {
    if (!ev || !ev.id) continue;
    const title = (typeof shownField === "function"
      ? shownField(ev._title, ev.title)
      : (ev._title || ev.title) || "").trim();
    if (!title || title.toLowerCase() !== lower) continue;

    const existingTypeId = ev.typeId ? String(ev.typeId) : "";
    if (existingTypeId && nextTypeId && existingTypeId !== nextTypeId) {
      const known = typeof eventTypeById === "function" ? eventTypeById(existingTypeId, cx) : null;
      if (known) continue;
    }
    if (existingTypeId && !nextTypeId) {
      const known = typeof eventTypeById === "function" ? eventTypeById(existingTypeId, cx) : null;
      if (known && String(known.name || "").trim().toLowerCase() !== lower) continue;
    }

    let changed = false;
    if (realIcon && isUnsetEventIcon(ev.icon)) {
      try {
        send({ type: "setEventIcon", eventId: ev.id, icon: realIcon }, cx.id);
      } catch {
        ev.icon = realIcon;
      }
      changed = true;
    }
    if (nextTypeId && existingTypeId !== nextTypeId) {
      ev.typeId = nextTypeId;
      changed = true;
    }
    if (nextCat && ev.cat !== nextCat) {
      ev.cat = nextCat;
      changed = true;
    }
    if (changed) n++;
  }
  if (nextCat) {
    if (!cx.cardCats) cx.cardCats = {};
    cx.cardCats[clean] = nextCat;
    if (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(cx)) {
      try {
        const personal = loadJSON("ash_personal_card_cats_v1", null) || {};
        personal[clean] = nextCat;
        persistJSON("ash_personal_card_cats_v1", personal);
      } catch {}
    }
  }
  if (n && typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(cx)
    && typeof savePersonal === "function") {
    try { savePersonal(); } catch {}
  }
  if (n && typeof renderView === "function" && (cx.id === S.activeConnId || PersonalSpace.isPersonal(cx))) {
    try { renderView(); } catch {}
  }
  return n;
}

/** Rematch freeform events for every type currently on this conn (+ personal customs). */
function relinkEventsForConnCards(conn) {
  const cx = conn || activeConn();
  if (!cx) return;
  if (typeof hasServerTypes === "function" && hasServerTypes(cx)) {
    for (const t of (cx.eventTypes || [])) {
      const name = String(t?.name || "").trim();
      if (!name) continue;
      relinkEventsToCard(cx, {
        label: name,
        icon: t.icon || "",
        typeId: t.id || "",
        categoryId: t.categoryId || "",
      });
    }
  }
  if (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(cx)) {
    for (const c of (CUSTOM_CARDS || [])) {
      const name = String(c?.label || "").trim();
      if (!name) continue;
      relinkEventsToCard(cx, {
        label: name,
        icon: c.icon || "",
        categoryId: c.cat || (cx.cardCats && cx.cardCats[name]) || "",
      });
    }
  }
}
