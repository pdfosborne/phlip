/* hand-reactions.js — reaction catalog, per-user stacks, emoji encode and chips.
 * Globals out: normalizeReactionCards, applyReactionCardsCatalog, harvestDrawings,
 * stripDrawnPayloadFromConn, eventReactionsMap, rxParts, rxChipHTML, …
 * The tray's react / sticker / approve cards and reaction sending are archived (archive/web/E23-card-hand-open-pitch).
 * Load after: hand-core.js; before: hand-share.js
 */

/** Normalize catalog entries: legacy string → { card, createdBy, createdByName }. */
function normalizeReactionCardEntry(raw) {
  if (typeof raw === "string") {
    const card = raw.trim();
    return card ? { card, createdBy: null, createdByName: null } : null;
  }
  if (!raw || typeof raw !== "object") return null;
  const card = String(raw.card || raw.emoji || raw.id || "").trim();
  if (!card) return null;
  return {
    card,
    createdBy: raw.createdBy != null && String(raw.createdBy).trim()
      ? String(raw.createdBy).trim()
      : null,
    createdByName: raw.createdByName != null && String(raw.createdByName).trim()
      ? String(raw.createdByName).trim()
      : null,
  };
}

function normalizeReactionCards(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const entry = normalizeReactionCardEntry(raw);
    if (!entry || seen.has(entry.card)) continue;
    seen.add(entry.card);
    out.push(entry);
  }
  return out;
}

function reactionCardId(entry) {
  if (typeof entry === "string") return entry;
  return entry?.card || "";
}

function reactionCardCreatorLabel(entry) {
  if (!entry) return "Created by someone";
  const id = entry.createdBy;
  const name = (id && typeof nameOf === "function" ? nameOf(id) : null)
    || entry.createdByName
    || "";
  const who = String(name || "").trim() || "someone";
  return `Created by ${who}`;
}

/** Add a drawn card to the shared catalog if missing. Returns true when added. */
function upsertReactionCard(conn, emoji, author = null) {
  if (!conn || !emoji || (typeof isDrawnIcon === "function" && !isDrawnIcon(emoji))) return false;
  const cards = conn.reactionCards = normalizeReactionCards(conn.reactionCards || []);
  if (cards.some(c => c.card === emoji)) return false;
  const id = author?.id || author?.userId || conn.me?.id || null;
  const name = author?.name || author?.createdByName
    || (id && typeof nameOf === "function" ? nameOf(id) : null)
    || conn.me?.name
    || null;
  cards.push({
    card: emoji,
    createdBy: id ? String(id) : null,
    createdByName: name ? String(name).trim() || null : null,
  });
  return true;
}

/** Assign / normalize a catalog payload onto a connection. */
function applyReactionCardsCatalog(conn, rawList) {
  if (!conn || !Array.isArray(rawList)) return;
  conn.reactionCards = normalizeReactionCards(rawList);
}

/** Apply a host `reactionCards` fanout when present on any message. */
function applyReactionCardsIfPresent(conn, m) {
  if (!conn || !Array.isArray(m?.reactionCards)) return;
  applyReactionCardsCatalog(conn, m.reactionCards);
}

/** Unique drawn payloads used as event icons, leftover event reacts, or chat reacts. */
function harvestDrawings(conn) {
  const byCard = new Map();
  const add = (raw, kind, createdBy, createdByName) => {
    const card = String(raw || "").trim();
    if (!card || (typeof isDrawnIcon === "function" && !isDrawnIcon(card))) return;
    let row = byCard.get(card);
    if (!row) {
      row = {
        card,
        createdBy: createdBy != null && String(createdBy).trim() ? String(createdBy).trim() : null,
        createdByName: createdByName != null && String(createdByName).trim()
          ? String(createdByName).trim() : null,
        uses: new Set(),
      };
      byCard.set(card, row);
    } else {
      if (!row.createdBy && createdBy) row.createdBy = String(createdBy).trim() || null;
      if (!row.createdByName && createdByName) row.createdByName = String(createdByName).trim() || null;
    }
    if (kind) row.uses.add(kind);
  };
  for (const entry of normalizeReactionCards(conn?.reactionCards)) {
    add(entry.card, null, entry.createdBy, entry.createdByName);
  }
  for (const ev of conn?.events || []) {
    add(ev?.icon, "Event icon", ev?.createdBy, ev?.createdByName);
    for (const list of Object.values(ev?.reactionStacks || {})) {
      for (const em of list || []) add(em, "Event reaction");
    }
  }
  for (const t of conn?.eventTypes || []) add(t?.icon, "Event icon");
  for (const r of conn?.routines || []) add(r?.icon, "Event icon", r?.createdBy, r?.createdByName);
  for (const list of Object.values(conn?.messages || {})) {
    for (const msg of list || []) {
      for (const em of Object.values(msg?.reactions || {})) add(em, "Chat reaction");
    }
  }
  return [...byCard.values()];
}

function drawingUsageLabel(entry) {
  const uses = [...(entry?.uses || [])];
  if (!uses.length) return "";
  return uses.join(" · ");
}

/** Strip a drawing from catalog, event icons, leftover stacks, types, routines, and chat. */
function stripDrawnPayloadFromConn(conn, card) {
  if (!conn || !card) return;
  conn.reactionCards = (typeof normalizeReactionCards === "function"
    ? normalizeReactionCards(conn.reactionCards)
    : (conn.reactionCards || [])
  ).filter(c => (typeof reactionCardId === "function" ? reactionCardId(c) : c) !== card);
  for (const ev of conn.events || []) {
    if (ev.icon === card) ev.icon = null;
    if (!ev.reactionStacks) continue;
    for (const [uid, list] of Object.entries(ev.reactionStacks)) {
      const next = (list || []).filter(em => em !== card);
      if (next.length) ev.reactionStacks[uid] = next;
      else delete ev.reactionStacks[uid];
    }
    if (typeof syncEventReactionSummary === "function") syncEventReactionSummary(ev);
  }
  for (const t of conn.eventTypes || []) {
    if (t.icon === card) t.icon = "custom";
  }
  for (const r of conn.routines || []) {
    if (r.icon === card) r.icon = "custom";
  }
  for (const list of Object.values(conn.messages || {})) {
    for (const msg of list || []) {
      if (!msg?.reactions) continue;
      let changed = false;
      const next = { ...msg.reactions };
      for (const [uid, em] of Object.entries(next)) {
        if (em === card) {
          delete next[uid];
          changed = true;
        }
      }
      if (changed) msg.reactions = Object.keys(next).length ? next : null;
    }
  }
}

/**
 * Per-user ordered reaction list. Prefers reactionStacks; falls back to legacy
 * reactions map ("emoji" / "emoji|count").
 */
function eventReactionStacks(ev) {
  if (!ev) return {};
  if (ev.reactionStacks && typeof ev.reactionStacks === "object") {
    const out = {};
    for (const [uid, list] of Object.entries(ev.reactionStacks)) {
      if (Array.isArray(list) && list.length) out[uid] = list.slice();
    }
    return out;
  }
  const out = {};
  for (const [uid, v] of Object.entries(ev.reactions || {})) {
    const { emoji, count } = rxParts(v);
    if (!emoji) continue;
    out[uid] = Array(Math.max(1, count)).fill(emoji);
  }
  return out;
}

/** Compact legacy map for avatar badges / aggregate chips. */
function eventReactionsMap(ev) {
  const stacks = eventReactionStacks(ev);
  const map = {};
  for (const [uid, list] of Object.entries(stacks)) {
    if (!list?.length) continue;
    const last = list[list.length - 1];
    map[uid] = list.length > 1 ? rxEncode(last, list.length) : last;
  }
  return map;
}

/** Timeline avatar badges: latest emoji per user, no ×count multiplier. */
function eventReactionsMapRecent(ev) {
  const stacks = eventReactionStacks(ev);
  const map = {};
  for (const [uid, list] of Object.entries(stacks)) {
    if (list?.length) map[uid] = list[list.length - 1];
  }
  return map;
}

function syncEventReactionSummary(ev) {
  if (!ev) return;
  const stacks = eventReactionStacks(ev);
  ev.reactionStacks = Object.keys(stacks).length ? stacks : null;
  const map = eventReactionsMap(ev);
  ev.reactions = Object.keys(map).length ? map : null;
}

// Legacy encode: bare emoji or "emoji|count".
function rxParts(v) {
  if (v && typeof v === "object") return { emoji: v.emoji || "", count: Math.max(1, Number(v.count) || 1) };
  const s = String(v || "");
  const i = s.lastIndexOf("|");
  let emoji, count;
  if (i > 0 && /^\d+$/.test(s.slice(i + 1))) {
    emoji = s.slice(0, i);
    count = Math.max(1, Number(s.slice(i + 1)));
  } else {
    emoji = s;
    count = 1;
  }
  if (emoji && [...emoji].every(c => c === "\uFFFD")) return { emoji: "", count: 1 };
  return { emoji, count };
}
function rxEncode(emoji, count = 1) {
  const n = Math.max(1, Math.min(99, Number(count) || 1));
  return n > 1 ? `${emoji}|${n}` : emoji;
}
function rxAggregate(map) {
  const counts = {};
  for (const v of Object.values(map || {})) {
    const { emoji, count } = rxParts(v);
    if (!emoji) continue;
    counts[emoji] = (counts[emoji] || 0) + count;
  }
  return counts;
}
function rxDisplay(em) {
  if (typeof isDrawnIcon === "function" && isDrawnIcon(em)) {
    return ic(em, "ico-inline rx-drawn");
  }
  return esc(em);
}
function rxChipHTML(map, { mine, interactive, className = "", canModerate = false, conn = activeConn() } = {}) {
  const counts = rxAggregate(reactionsVisible(map, conn));
  const myEmoji = mine != null ? rxParts(map?.[mine]).emoji : null;
  return Object.entries(counts).map(([em, c]) => {
    const glyph = rxDisplay(em);
    const label = c > 1 ? `${glyph} ×${c}` : `${glyph} ${c}`;
    if (interactive) {
      const mineOn = myEmoji === em;
      const cls = ["rx", className, mineOn ? "on" : "", canModerate && !mineOn ? "rx-mod" : ""]
        .filter(Boolean).join(" ");
      const title = canModerate && !mineOn
        ? "Tap to remove this reaction"
        : (mineOn ? "Tap to remove your reaction" : "Tap to react");
      return `<button type="button" class="${cls}" data-em="${esc(em)}" title="${esc(title)}">${label}</button>`;
    }
    return `<span class="rx-chip">${label}</span>`;
  }).join("");
}
