/* event-ics.js — RFC 5545 snapshot export for external calendar apps.
 * Globals in:  eventDisplayTitle, shown, eventEndWhen, ownerConnFor, activeConn,
 *              DAY_PERIODS, dayStart, DAY_MS, effectiveDuration, whenLabel,
 *              collectChannelViewEvents, toast, AshNative
 * Globals out: icsEscapeText, icsFoldLine, icsUtcStamp, icsLocalDate,
 *              buildIcsCalendar, buildEventIcs, eventToIcsFields,
 *              eventsForIcsExport, exportEventsToCalendar, exportEventToCalendar,
 *              exportChannelUpcomingToCalendar
 * Load after:  event-pass.js
 * Load before: contacts.js
 *
 * Must not: ES modules, server-side generation, WRITE_CALENDAR / EventKit insert
 */

const ICS_PRODID = "-//Phlip//Event Export//EN";
const ICS_AGENDA_CAP = 200;
const ICS_MAX_CHARS = 1000000;
const ICS_FALLBACK_PERIODS = [
  { id: "morning", label: "Morning", from: 8, to: 12 },
  { id: "afternoon", label: "Afternoon", from: 12, to: 17 },
  { id: "evening", label: "Evening", from: 18, to: 23 },
];

function icsEscapeText(s) {
  return String(s == null ? "" : s)
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\n|\r/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function icsPad2(n) {
  return String(n).padStart(2, "0");
}

function icsUtcStamp(ms) {
  const d = new Date(Number(ms) || 0);
  return d.getUTCFullYear()
    + icsPad2(d.getUTCMonth() + 1)
    + icsPad2(d.getUTCDate())
    + "T"
    + icsPad2(d.getUTCHours())
    + icsPad2(d.getUTCMinutes())
    + icsPad2(d.getUTCSeconds())
    + "Z";
}

function icsLocalDate(ms) {
  const d = new Date(Number(ms) || 0);
  return d.getFullYear() + icsPad2(d.getMonth() + 1) + icsPad2(d.getDate());
}

/** Fold at 75 octets (UTF-8), RFC 5545 CRLF + leading space continuations. */
function icsFoldLine(line) {
  const text = String(line == null ? "" : line);
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= 75) return text;
  const decode = new TextDecoder("utf-8", { fatal: false });
  const chunks = [];
  let i = 0;
  let limit = 75;
  while (i < bytes.length) {
    let end = Math.min(i + limit, bytes.length);
    while (end > i && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    if (end === i) end = Math.min(i + limit, bytes.length);
    chunks.push(decode.decode(bytes.subarray(i, end)));
    i = end;
    limit = 74;
  }
  return chunks.map((c, idx) => (idx === 0 ? c : " " + c)).join("\r\n");
}

function icsSanitizeToken(s, fallback) {
  const t = String(s || "").replace(/[^A-Za-z0-9._-]/g, "");
  return t || fallback || "local";
}

function eventIcsUid(ev, conn) {
  const cid = icsSanitizeToken(conn?.id || ev?._connId, "local");
  const eid = icsSanitizeToken(ev?.id, "event");
  return `${cid}-${eid}@phlip.app`;
}

function eventIcsFuzzy(ev) {
  const prec = ev?.whenPrecision;
  return prec === "day" || prec === "period" || prec === "unconfirmed";
}

function eventIcsAllDay(ev) {
  if (ev?.whenPrecision === "period") return false;
  const prec = ev?.whenPrecision;
  if (prec === "day" || prec === "unconfirmed") return true;
  const dur = (typeof effectiveDuration === "function")
    ? effectiveDuration(ev)
    : ev?.duration;
  return dur === "day";
}

function eventIcsPeriodList() {
  return (typeof DAY_PERIODS !== "undefined" && Array.isArray(DAY_PERIODS) && DAY_PERIODS.length)
    ? DAY_PERIODS
    : ICS_FALLBACK_PERIODS;
}

function eventIcsPeriodWindow(whenMs, periodId) {
  const periods = eventIcsPeriodList();
  const p = periods.find(x => x.id === periodId) || periods[0];
  const start = new Date(whenMs);
  start.setHours(p.from, 0, 0, 0);
  const end = new Date(whenMs);
  end.setHours(p.to, 0, 0, 0);
  let endMs = end.getTime();
  if (endMs <= start.getTime()) endMs = start.getTime() + 3600e3;
  return { start: start.getTime(), end: endMs };
}

function eventIcsDayStart(ms) {
  if (typeof dayStart === "function") return dayStart(ms);
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function eventIcsDayMs() {
  return (typeof DAY_MS === "number" && DAY_MS > 0) ? DAY_MS : 86400000;
}

function eventToIcsFields(ev) {
  const conn = (typeof ownerConnFor === "function" ? ownerConnFor(ev) : null)
    || (typeof activeConn === "function" ? activeConn() : null);
  const titleRaw = (typeof eventDisplayTitle === "function")
    ? eventDisplayTitle(ev, conn)
    : (ev?._title || ev?.title || "");
  const title = String(titleRaw || "Event").trim() || "Event";
  const location = String((typeof shown === "function" ? shown(ev?._where) : ev?._where) || "").trim();
  const details = String((typeof shown === "function" ? shown(ev?._details) : ev?._details) || "").trim();
  const sticker = String((typeof shown === "function" ? shown(ev?._sticker) : ev?._sticker) || "").trim();
  const descParts = [];
  if (details) descParts.push(details);
  if (sticker) descParts.push(sticker);
  const fuzzy = eventIcsFuzzy(ev);
  const allDay = eventIcsAllDay(ev);
  const period = ev?.whenPrecision === "period";
  let startMs = Number(ev?.when) || Date.now();
  let endMs = startMs + 3600e3;
  if (allDay) {
    startMs = eventIcsDayStart(startMs);
    endMs = startMs + eventIcsDayMs();
  } else if (period) {
    const win = eventIcsPeriodWindow(startMs, ev.whenPeriod);
    startMs = win.start;
    endMs = win.end;
  } else if (typeof eventEndWhen === "function") {
    const end = eventEndWhen(ev, conn);
    if (end != null) endMs = Number(end);
  }
  if (endMs <= startMs) endMs = startMs + (allDay ? eventIcsDayMs() : 3600e3);
  if (fuzzy) {
    if (typeof whenLabel === "function") descParts.push(whenLabel(ev));
    else descParts.push("Time TBC");
  }
  return {
    uid: eventIcsUid(ev, conn),
    title,
    location,
    description: descParts.filter(Boolean).join("\n"),
    startMs,
    endMs,
    allDay,
    status: fuzzy ? "TENTATIVE" : "CONFIRMED",
    stampMs: Date.now(),
    sequence: Math.max(0, Number(ev?.passRevision) || 0),
  };
}

function icsVeventLines(fields) {
  const f = fields || {};
  const startMs = Number(f.startMs) || 0;
  let endMs = Number(f.endMs) || startMs;
  const allDay = !!f.allDay;
  if (endMs <= startMs) endMs = startMs + (allDay ? 86400000 : 3600e3);
  const lines = [
    "BEGIN:VEVENT",
    `UID:${icsEscapeText(f.uid || "event@phlip.app")}`,
    `DTSTAMP:${icsUtcStamp(f.stampMs || Date.now())}`,
    `SEQUENCE:${Math.max(0, Number(f.sequence) || 0)}`,
    `STATUS:${f.status === "TENTATIVE" ? "TENTATIVE" : "CONFIRMED"}`,
    "CLASS:PRIVATE",
    `SUMMARY:${icsEscapeText(f.title || "Event")}`,
  ];
  if (allDay) {
    lines.push(`DTSTART;VALUE=DATE:${icsLocalDate(startMs)}`);
    lines.push(`DTEND;VALUE=DATE:${icsLocalDate(endMs)}`);
  } else {
    lines.push(`DTSTART:${icsUtcStamp(startMs)}`);
    lines.push(`DTEND:${icsUtcStamp(endMs)}`);
  }
  if (f.location) lines.push(`LOCATION:${icsEscapeText(f.location)}`);
  if (f.description) lines.push(`DESCRIPTION:${icsEscapeText(f.description)}`);
  lines.push("END:VEVENT");
  return lines;
}

function buildIcsCalendar(fieldsList) {
  const list = Array.isArray(fieldsList) ? fieldsList.filter(Boolean) : [];
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${ICS_PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const fields of list) lines.push(...icsVeventLines(fields));
  lines.push("END:VCALENDAR");
  return lines.map(icsFoldLine).join("\r\n") + "\r\n";
}

function buildEventIcs(evOrList) {
  const list = (Array.isArray(evOrList) ? evOrList : [evOrList]).filter(Boolean);
  return buildIcsCalendar(list.map(eventToIcsFields));
}

function eventsForIcsExport(ev) {
  if (!ev) return [];
  if (ev.chainOf) return [ev];
  const conn = (typeof ownerConnFor === "function" ? ownerConnFor(ev) : null)
    || (typeof activeConn === "function" ? activeConn() : null);
  const pool = conn?.events || [];
  const links = pool
    .filter(e => e && e.chainOf === ev.id)
    .sort((a, b) => (a.when || 0) - (b.when || 0));
  return [ev, ...links];
}

function icsFilenameFor(events) {
  if (!events || events.length !== 1) return "phlip-events.ics";
  const title = (typeof eventDisplayTitle === "function"
    ? eventDisplayTitle(events[0])
    : (events[0]?._title || events[0]?.title)) || "event";
  const slug = String(title).toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "event"}.ics`;
}

function downloadIcsFile(filename, text) {
  const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "event.ics";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function deliverIcs(ics, filename) {
  const body = String(ics || "");
  const name = filename || "event.ics";
  if (!body || body.length > ICS_MAX_CHARS) return false;
  if (window.AshNative && typeof window.AshNative.openCalendarIcs === "function") {
    try {
      window.AshNative.openCalendarIcs(body, name);
      return true;
    } catch {}
  }
  try {
    const file = new File([body], name, { type: "text/calendar" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return true;
    }
  } catch (e) {
    if (e && e.name === "AbortError") return true;
  }
  try {
    downloadIcsFile(name, body);
    if (typeof toast === "function") toast(`Saved ${name} — open it in your calendar app`);
    return true;
  } catch {
    if (typeof toast === "function") toast("Couldn't export this event");
    return false;
  }
}

async function exportEventsToCalendar(evOrList) {
  const list = (Array.isArray(evOrList) ? evOrList : [evOrList])
    .filter(e => e && e.when);
  if (!list.length) {
    if (typeof toast === "function") toast("Nothing to export");
    return false;
  }
  const ics = buildEventIcs(list);
  return deliverIcs(ics, icsFilenameFor(list));
}

async function exportEventToCalendar(ev) {
  if (!ev) return false;
  if (!ev.when) {
    if (typeof toast === "function") toast("This event has no time yet");
    return false;
  }
  return exportEventsToCalendar(eventsForIcsExport(ev));
}

async function exportChannelUpcomingToCalendar(channel) {
  if (!channel) return false;
  const conn = (typeof activeConn === "function" ? activeConn() : null);
  const pool = (typeof collectChannelViewEvents === "function")
    ? collectChannelViewEvents(channel, conn)
    : (conn?.events || []).filter(e => e.channelId === channel.id);
  const floor = eventIcsDayStart(Date.now());
  const upcoming = (pool || [])
    .filter(e => e && e.when >= floor)
    .sort((a, b) => (a.when || 0) - (b.when || 0));
  if (!upcoming.length) {
    if (typeof toast === "function") toast("No upcoming events to export");
    return false;
  }
  const capped = upcoming.slice(0, ICS_AGENDA_CAP);
  const ok = await exportEventsToCalendar(capped);
  if (ok && upcoming.length > ICS_AGENDA_CAP && typeof toast === "function") {
    toast(`Exported the next ${ICS_AGENDA_CAP} events`);
  }
  return ok;
}
