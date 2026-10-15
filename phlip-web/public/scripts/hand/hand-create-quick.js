/* hand-create-quick.js — learned time / subtitle / type-icon helpers used by the in-feed draft card.
 * Globals out: fmtHourGridLabel, recordTimeUse, recordSubtitleUse, subtitleCreateScope, harvestTypeEvents, lookupTypeIcon, …
 * The old assemble quick options are archived (archive/web/B-old-create).
 * Load after: hand-create-suggest.js; before: hand-create.js
 */

const TIME_USAGE_KEY = "ash_time_usage_v1";

const SUBTITLE_USAGE_KEY = "ash_subtitle_usage_v1";

let TIME_USAGE = loadJSON(TIME_USAGE_KEY, {});

let SUBTITLE_USAGE = loadJSON(SUBTITLE_USAGE_KEY, {});

/** 12h grid label: 7pm, 12am. Never 24h. */
function fmtHourGridLabel(hour) {
  const h = ((Number(hour) % 24) + 24) % 24;
  const hr = h % 12 === 0 ? 12 : h % 12;
  return hr + (h >= 12 ? "pm" : "am");
}

function timeUsageBucket(title) {
  const key = String(title || "").trim() || "_";
  return (TIME_USAGE[key] ||= { clocks: {}, periods: {}, recent: [] });
}

function recordTimeUse(title, when, whenPrecision, whenPeriod) {
  const clean = String(title || "").trim();
  if (!clean || when == null) return;
  const b = timeUsageBucket(clean);
  if (whenPrecision === "period" && whenPeriod) {
    b.periods[whenPeriod] = (b.periods[whenPeriod] || 0) + 1;
  } else if (!whenPrecision || whenPrecision === "partial-hour") {
    const d = new Date(when);
    const clock = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
    b.clocks[clock] = (b.clocks[clock] || 0) + 1;
    b.recent = [clock, ...(b.recent || []).filter(c => c !== clock)].slice(0, 8);
  }
  persistJSON(TIME_USAGE_KEY, TIME_USAGE);
}

function subtitleUsageBucket(title) {
  const key = String(title || "").trim() || "_";
  return (SUBTITLE_USAGE[key] ||= {});
}

function recordSubtitleUse(text, title) {
  const clean = String(text || "").trim();
  if (!clean) return;
  const bucket = subtitleUsageBucket(title);
  const u = (bucket[clean] ||= { n: 0, last: 0 });
  u.n += 1;
  u.last = Date.now();
  const pending = typeof S !== "undefined" ? S.hand?.pending : null;
  const conn = typeof activeConn === "function" ? activeConn() : null;
  u.connId = pending?.createConnId || conn?.id || u.connId || "";
  u.channelId = pending?.createChannelId
    || (typeof S !== "undefined" ? S.activeEventChannelId : null)
    || u.channelId || "";
  persistJSON(SUBTITLE_USAGE_KEY, SUBTITLE_USAGE);
}

function subtitleCreateScope() {
  const pending = typeof S !== "undefined" ? S.hand?.pending : null;
  const conn = (pending?.createConnId && S.conns?.[pending.createConnId])
    || (typeof activeConn === "function" ? activeConn() : null);
  const channelId = pending?.createChannelId
    || (typeof activeEventChannel === "function" ? activeEventChannel()?.id : null)
    || (typeof S !== "undefined" ? S.activeEventChannelId : null)
    || "";
  const meId = (typeof sourceMeFor === "function" && conn ? sourceMeFor(conn)?.id : null)
    || conn?.me?.id || "";
  return { conn, channelId, meId };
}

function typeSuggestKey(label) {
  return typeof typedMatchKey === "function"
    ? typedMatchKey(label)
    : String(label || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function typeLabelFromEvent(ev, conn) {
  const label = (typeof eventTypeLabel === "function"
    ? eventTypeLabel(ev, conn)
    : (typeof shown === "function" ? shown(ev?._title) : (ev?._title || "")));
  return String(label || "").trim();
}

function harvestTypeEvents(scope) {
  const conn = scope.conn;
  if (!conn) return [];
  const events = typeof sourceEventsFor === "function"
    ? sourceEventsFor(conn)
    : (conn.events || []);
  return (events || []).filter(ev => ev && typeLabelFromEvent(ev, conn));
}

function typeIconCounts(title) {
  const key = typeSuggestKey(title);
  if (!key) return [];
  const scope = subtitleCreateScope();
  const map = new Map();
  for (const ev of harvestTypeEvents(scope)) {
    if (typeSuggestKey(typeLabelFromEvent(ev, scope.conn)) !== key) continue;
    const icon = String(ev.icon || "").trim();
    if (!icon) continue;
    const last = Number(ev.when) || Number(ev.updatedAt) || Number(ev.createdAt) || 0;
    const cur = map.get(icon) || { icon, n: 0, last: 0 };
    cur.n += 1;
    if (last >= cur.last) cur.last = last;
    map.set(icon, cur);
  }
  return [...map.values()].sort((a, b) => b.n - a.n || b.last - a.last);
}

/** Most-used icon for this type on this server, else deck card icon, else custom. */
function lookupTypeIcon(title, ctx) {
  const ov = typeof cardIconOverride === "function" ? cardIconOverride(title) : null;
  if (ov) return ov;
  const ranked = typeIconCounts(title);
  if (ranked[0]?.icon) return ranked[0].icon;
  const conn = (ctx?.createConnId && typeof S !== "undefined" && S.conns?.[ctx.createConnId])
    || (typeof activeConn === "function" ? activeConn() : null);
  const matched = typeof findMatchingEventCard === "function"
    ? findMatchingEventCard(title, conn)
    : null;
  if (matched?.icon) return matched.icon;
  return "custom";
}
