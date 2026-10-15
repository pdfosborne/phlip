/* helpers-part1.js — split from helpers.js (Part 3 size ceiling).
 * Load after: (prior deps); part of helpers cluster.
 */

/* -------------------------------- helpers -------------------------------- */

/** Features parked while core chat is refined and tested (Oct 2026): their
 *  ways in are hidden (board menu, sidebar sections) and their pages fall
 *  back to All chat. The code and data stay; set a flag to false to bring
 *  that feature back. */
const PHLIP_PARKED = Object.freeze({
  timeline: true,         // board menu → Timeline
  tasks: true,            // board menu → Tasks, an event's task list
  polls: true,            // board menu → Polls
  pinnedLocations: false, // sidebar → Pinned locations (read-only occupancy timeline)
  pinnedPeople: true,     // sidebar → Pinned people
  manualCreate: true,     // board → "+" / New event open quick create; the form stays as Edit event (and Duplicate)
});
function featureParked(name) {
  return !!PHLIP_PARKED[name];
}

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Web links in chat text: http(s)://… and www.… (trailing punctuation left
 *  outside the link). */
const CHAT_LINK_RE = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;
function chatLinkHref(raw) {
  const url = String(raw || "");
  return /^www\./i.test(url) ? `https://${url}` : url;
}
function chatSplitLink(match) {
  const m = String(match || "").match(/^(.*?)([).,;:!?'"\]]*)$/);
  return { url: m ? m[1] : match, tail: m ? m[2] : "" };
}
/** Escapes text and turns its web links into underlined links that open in
 *  the phone's browser (or the Maps app for a map link). */
function escLinkify(text) {
  const src = String(text == null ? "" : text);
  let out = "";
  let at = 0;
  CHAT_LINK_RE.lastIndex = 0;
  let m;
  while ((m = CHAT_LINK_RE.exec(src))) {
    const { url, tail } = chatSplitLink(m[0]);
    if (!url || /^(?:https?:\/\/|www\.)$/i.test(url)) continue;
    out += esc(src.slice(at, m.index));
    out += `<a class="msg-link" href="${esc(chatLinkHref(url))}" target="_blank" rel="noopener noreferrer" data-msg-link>${esc(url)}</a>${esc(tail)}`;
    at = m.index + m[0].length;
  }
  return out + esc(src.slice(at));
}
const initials = (name) => {
  const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).slice(0, 2).toUpperCase();
  return (parts[0] || "?").slice(0, 2).toUpperCase();
};

/** Custom server rail glyph — up to 4 visible letters/emoji. */
function normalizeIconText(s) {
  return [...String(s || "").trim()].slice(0, 4).join("");
}

/** Default server rail glyph from name when no custom iconText is set. */
function serverIconShorthand(name) {
  const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0].slice(0, 2) + parts[1].slice(0, 2)).slice(0, 4).toUpperCase();
  }
  return (parts[0] || "?").slice(0, 4).toUpperCase();
}

/** Phone / sliding-sheet shell vs laptop persistent rail+sidebar. Matches style.css 900px. */
const SHELL_NARROW_MQ = "(max-width: 900px)";
function isNarrowShell() {
  try { return window.matchMedia(SHELL_NARROW_MQ).matches; } catch { return true; }
}

// Lucide line icons (ISC licence) — app/UI + legacy semantic keys.
// Lucide pack (LUCIDE_ICON_PACK) loads first; APP_ICONS wins on name clashes so
// stored event/channel aliases (dinner, addperson, …) keep rendering.
const APP_ICONS = {
  // Radar sweep — "Broadcast" (guest microsite for one event).
  radar: `<path d="M19.07 4.93A10 10 0 0 0 6.99 3.34" /> <path d="M4 6h.01" /> <path d="M2.29 9.62A10 10 0 1 0 21.31 8.35" /> <path d="M16.24 7.76A6 6 0 1 0 8.23 16.67" /> <path d="M12 18h.01" /> <path d="M17.99 11.66A6 6 0 0 1 15.77 16.67" /> <circle cx="12" cy="12" r="2" /> <path d="m13.41 10.59 5.66-5.66" />`,
  // Connected nodes — LAN vs public reach on the server rail.
  network: `<rect x="16" y="16" width="6" height="6" rx="1" /> <rect x="2" y="16" width="6" height="6" rx="1" /> <rect x="9" y="2" width="6" height="6" rx="1" /> <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" /> <path d="M12 12V8" />`,
  // Wi‑Fi arcs — Direct hotspot session (host phone as access point).
  wifi: `<path d="M12 20h.01" /> <path d="M2 8.82a15 15 0 0 1 20 0" /> <path d="M5 12.859a10 10 0 0 1 14 0" /> <path d="M8.5 16.429a5 5 0 0 1 7 0" />`,
  ellipsis: `<circle cx="12" cy="12" r="1" /> <circle cx="19" cy="12" r="1" /> <circle cx="5" cy="12" r="1" />`,
  // Lucide list-todo lives in the text category, which the generated pack omits.
  "list-todo": `<rect x="3" y="5" width="6" height="6" rx="1" /> <path d="m3 17 2 2 4-4" /> <path d="M13 6h8" /> <path d="M13 12h8" /> <path d="M13 18h8" />`,
  dinner: `<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" /> <path d="M7 2v20" /> <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />`,
  drinks: `<path d="M17 11h1a3 3 0 0 1 0 6h-1" /> <path d="M9 12v6" /> <path d="M13 12v6" /> <path d="M14 7.5c-1 0-1.44.5-3 .5s-2-.5-3-.5-1.72.5-2.5.5a2.5 2.5 0 0 1 0-5c.78 0 1.57.5 2.5.5S9.44 2 11 2s2 1.5 3 1.5 1.72-.5 2.5-.5a2.5 2.5 0 0 1 0 5c-.78 0-1.5-.5-2.5-.5Z" /> <path d="M5 8v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8" />`,
  film: `<path d="m12.296 3.464 3.02 3.956" /> <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z" /> <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /> <path d="m6.18 5.276 3.1 3.899" />`,
  games: `<rect width="12" height="12" x="2" y="10" rx="2" ry="2" /> <path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6" /> <path d="M6 18h.01" /> <path d="M10 14h.01" /> <path d="M15 6h.01" /> <path d="M18 9h.01" />`,
  hike: `<path d="m8 3 4 8 5-5 5 15H2L8 3z" />`,
  party: `<path d="M5.8 11.3 2 22l10.7-3.79" /> <path d="M4 3h.01" /> <path d="M22 8h.01" /> <path d="M15 2h.01" /> <path d="M22 20h.01" /> <path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10" /> <path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17" /> <path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7" /> <path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z" />`,
  sport: `<path d="M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z" /> <path d="m2.5 21.5 1.4-1.4" /> <path d="m20.1 3.9 1.4-1.4" /> <path d="M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z" /> <path d="m9.6 14.4 4.8-4.8" />`,
  coffee: `<path d="M10 2v2" /> <path d="M14 2v2" /> <path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1" /> <path d="M6 2v2" />`,
  lunch: `<path d="M3 11v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3" /> <path d="M12 19H4a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-3.83" /> <path d="m3 11 2.45-4.9A2 2 0 0 1 7.24 5h9.52a2 2 0 0 1 1.8 1.1L21 11" /> <path d="M12 19v3" />`,
  brunch: `<path d="m4.6 13.11 5.79-3.21c1.89-1.05 4.79 1.78 3.71 3.71l-3.22 5.81C8.8 23.16.79 15.23 4.6 13.11Z" /> <path d="m10.5 9.5-1-2.29C9.2 6.48 8.8 6 8 6H4.5C2.79 6 2 6.5 2 8.5a7.71 7.71 0 0 0 2 4.83" /> <path d="M8 6c0-1.55.24-4-2-4-2 0-2.5 2.17-2.5 4" /> <path d="m14.5 13.5 2.29 1c.73.3 1.21.7 1.21 1.5v3.5c0 1.71-.5 2.5-2.5 2.5a7.71 7.71 0 0 1-4.83-2" /> <path d="M18 16c1.55 0 4-.24 4 2 0 2-2.17 2.5-4 2.5" />`,
  pizza: `<path d="M15 11h.01" /> <path d="M11 15h.01" /> <path d="M16 16h.01" /> <path d="m2 16 20 6-6-20A20 20 0 0 0 2 12" /> <path d="M5.71 17.11a17.04 17.04 0 0 1 11.4-11.4" />`,
  cake: `<path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8" /> <path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1" /> <path d="M2 21h20" /> <path d="M7 8v3" /> <path d="M12 8v3" /> <path d="M17 8v3" /> <path d="M7 4h.01" /> <path d="M12 4h.01" /> <path d="M17 4h.01" />`,
  salad: `<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" /> <path d="M2 21c0-3 3.5-4.5 6.5-4.5S15 18 15 21" />`,
  custom: `<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" /> <path d="M20 2v4" /> <path d="M22 4h-4" /> <circle cx="4" cy="20" r="2" />`,
  free: `<circle cx="12" cy="12" r="10" /> <path d="m9 12 2 2 4-4" />`,
  // Raised hand — “Open availability” / volunteer.
  handsUp: `<path d="M18 11V7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v1" /> <path d="M14 10V5a2 2 0 0 0-2-2 2 2 0 0 0-2 2v6" /> <path d="M10 10.5V7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8" /> <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />`,
  conflict: `<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /> <path d="M12 9v4" /> <path d="M12 17h.01" />`,
  busy: `<circle cx="12" cy="12" r="10" /> <path d="m15 9-6 6" /> <path d="m9 9 6 6" />`,
  ban: `<circle cx="12" cy="12" r="10" /> <path d="m4.9 4.9 14.2 14.2" />`,
  hourglass: `<path d="M5 22h14" /> <path d="M5 2h14" /> <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" /> <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />`,
  repeat: `<path d="m17 2 4 4-4 4" /> <path d="M3 11v-1a4 4 0 0 1 4-4h14" /> <path d="m7 22-4-4 4-4" /> <path d="M21 13v1a4 4 0 0 1-4 4H3" />`,
  react: `<circle cx="12" cy="12" r="10" /> <path d="M8 14s1.5 2 4 2 4-2 4-2" /> <line x1="9" x2="9.01" y1="9" y2="9" /> <line x1="15" x2="15.01" y1="9" y2="9" />`,
  addperson: `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /> <circle cx="9" cy="7" r="4" /> <line x1="19" x2="19" y1="8" y2="14" /> <line x1="22" x2="16" y1="11" y2="11" />`,
  // Remove from server — person with X (not a trash bin).
  userX: `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /> <circle cx="9" cy="7" r="4" /> <line x1="17" x2="22" y1="8" y2="13" /> <line x1="22" x2="17" y1="8" y2="13" />`,
  lock: `<rect width="18" height="11" x="3" y="11" rx="2" ry="2" /> <path d="M7 11V7a5 5 0 0 1 10 0v4" />`,
  shield: `<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />`,
  star: `<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />`,
  person: `<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /> <circle cx="12" cy="7" r="4" />`,
  edit: `<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /> <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />`,
  "square-pen": `<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /> <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />`,
  wrench: `<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />`,
  plus: `<path d="M5 12h14" /> <path d="M12 5v14" />`,
  copy: `<rect width="14" height="14" x="8" y="8" rx="2" ry="2" /> <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />`,
  // Follow-on / "What's next" — Lucide circle-arrow-right (alias kept for old cards).
  followUp: `<circle cx="12" cy="12" r="10" /> <path d="m12 16 4-4-4-4" /> <path d="M8 12h8" />`,
  clock: `<circle cx="12" cy="12" r="10" /> <path d="M12 6v6l4 2" />`,
  morning: `<path d="M12 2v8" /> <path d="m4.93 10.93 1.41 1.41" /> <path d="M2 18h2" /> <path d="M20 18h2" /> <path d="m19.07 10.93-1.41 1.41" /> <path d="M22 22H2" /> <path d="m8 6 4-4 4 4" /> <path d="M16 18a4 4 0 0 0-8 0" />`,
  afternoon: `<circle cx="12" cy="12" r="4" /> <path d="M12 2v2" /> <path d="M12 20v2" /> <path d="m4.93 4.93 1.41 1.41" /> <path d="m17.66 17.66 1.41 1.41" /> <path d="M2 12h2" /> <path d="M20 12h2" /> <path d="m6.34 17.66-1.41 1.41" /> <path d="m19.07 4.93-1.41 1.41" />`,
  evening: `<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />`,
  cancel: `<path d="M18 6 6 18" /> <path d="m6 6 12 12" />`,
  back: `<path d="M9 14 4 9l5-5" /> <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />`,
  check: `<path d="M20 6 9 17l-5-5" />`,
  trash: `<path d="M10 11v6" /> <path d="M14 11v6" /> <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /> <path d="M3 6h18" /> <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />`,
  logout: `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /> <polyline points="16 17 21 12 16 7" /> <line x1="21" x2="9" y1="12" y2="12" />`,
  login: `<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /> <polyline points="10 17 15 12 10 7" /> <line x1="15" x2="3" y1="12" y2="12" />`,
  history: `<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /> <path d="M3 3v5h5" /> <path d="M12 7v5l4 2" />`,
  calendar: `<path d="M8 2v4" /> <path d="M16 2v4" /> <rect width="18" height="18" x="3" y="4" rx="2" /> <path d="M3 10h18" />`,
  "calendar-days": `<path d="M8 2v4" /> <path d="M16 2v4" /> <rect width="18" height="18" x="3" y="4" rx="2" /> <path d="M3 10h18" /> <path d="M8 14h.01" /> <path d="M12 14h.01" /> <path d="M16 14h.01" /> <path d="M8 18h.01" /> <path d="M12 18h.01" /> <path d="M16 18h.01" />`,
  locate: `<line x1="2" x2="5" y1="12" y2="12" /> <line x1="19" x2="22" y1="12" y2="12" /> <line x1="12" x2="12" y1="2" y2="5" /> <line x1="12" x2="12" y1="19" y2="22" /> <circle cx="12" cy="12" r="7" />`,
  focusband: `<rect x="3" y="4" width="18" height="16" rx="2" /> <line x1="2" x2="22" y1="12" y2="12" />`,
  ticket: `<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" /> <path d="M13 5v2" /> <path d="M13 17v2" /> <path d="M13 11v2" />`,
  // Playing card — Card manager (distinct from event-channel `ticket`).
  playingCard: `<rect x="5" y="2" width="14" height="20" rx="2" /> <path d="m12 8.5 3 3-3 3-3-3z" />`,
  message: `<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />`,
  note: `<path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z" /> <path d="M15 3v4a2 2 0 0 0 2 2h4" />`,
  bell: `<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /> <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />`,
  users: `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />`,
  flag: `<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528" />`,
  pin: `<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" /> <circle cx="12" cy="10" r="3" />`,
  // Pushpin. `pin` stays the location marker used across the app.
  thumbtack: `<path d="M12 17v5" /> <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />`,
  more: `<circle cx="12" cy="12" r="1" /> <circle cx="12" cy="5" r="1" /> <circle cx="12" cy="19" r="1" />`,
  grip: `<circle cx="9" cy="5" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="9" cy="19" r="1" /><circle cx="15" cy="5" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="19" r="1" />`,
  chevronDown: `<path d="m6 9 6 6 6-6" />`,
  chevronUp: `<path d="m18 15-6-6-6 6" />`,
  chevronLeft: `<path d="m15 18-6-6 6-6" />`,
  chevronRight: `<path d="m9 18 6-6-6-6" />`,
  info: `<circle cx="12" cy="12" r="10" /> <path d="M12 16v-4" /> <path d="M12 8h.01" />`,
  maybe: `<circle cx="12" cy="12" r="10" /> <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /> <path d="M12 17h.01" />`,
  sun: `<circle cx="12" cy="12" r="4" /> <path d="M12 2v2" /> <path d="M12 20v2" /> <path d="m4.93 4.93 1.41 1.41" /> <path d="m17.66 17.66 1.41 1.41" /> <path d="M2 12h2" /> <path d="M20 12h2" /> <path d="m6.34 17.66-1.41 1.41" /> <path d="m19.07 4.93-1.41 1.41" />`,
  moon: `<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />`,
  palette: `<circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /> <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /> <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /> <circle cx="6.5" cy="12" r=".5" fill="currentColor" /> <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />`,
  share: `<circle cx="18" cy="5" r="3" /> <circle cx="6" cy="12" r="3" /> <circle cx="18" cy="19" r="3" /> <line x1="8.59" x2="15.42" y1="13.51" y2="17.49" /> <line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />`,
  image: `<rect width="18" height="18" x="3" y="3" rx="2" ry="2" /> <circle cx="9" cy="9" r="2" /> <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />`,
  volume: `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /> <path d="M15.54 8.46a5 5 0 0 1 0 7.07" /> <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />`,
  volumeOff: `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /> <line x1="22" x2="16" y1="9" y2="15" /> <line x1="16" x2="22" y1="9" y2="15" />`,
  pitch: `<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" /> <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" /> <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />`,
  layers: `<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" /> <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" /> <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />`,
  server: `<rect width="20" height="8" x="2" y="2" rx="2" ry="2" /> <rect width="20" height="8" x="2" y="14" rx="2" ry="2" /> <line x1="6" x2="6.01" y1="6" y2="6" /> <line x1="6" x2="6.01" y1="18" y2="18" />`,
  menu: `<line x1="4" x2="20" y1="6" y2="6" /> <line x1="4" x2="20" y1="12" y2="12" /> <line x1="4" x2="20" y1="18" y2="18" />`,
  "list-chevrons-down-up": `<path d="M3 5h8" /> <path d="M3 12h8" /> <path d="M3 19h8" /> <path d="m15 5 3 3 3-3" /> <path d="m15 19 3-3 3 3" />`,
  "list-chevrons-up-down": `<path d="M3 5h8" /> <path d="M3 12h8" /> <path d="M3 19h8" /> <path d="m15 8 3-3 3 3" /> <path d="m15 16 3 3 3-3" />`,
};

/** Merged registry: Lucide pack first, then app aliases (app wins on clash). */
const ICONS = {
  ...(typeof LUCIDE_ICON_PACK === "object" && LUCIDE_ICON_PACK ? LUCIDE_ICON_PACK : {}),
  ...APP_ICONS,
};

// Hand-drawn icons are stored as "d:" + base64url(JSON array of stroke paths).
const DRAW_ICON_PREFIX = "d:";
const REMOVED_ICON_FALLBACK = {
  run: "sport", bike: "sport", swim: "sport", gym: "sport", dumbbell: "sport",
  tennis: "tennis-ball", pingpong: "ping-pong", skateboard: "sport", goal: "sport",
  medal: "sport", trophy: "sport",
  game: "games", // server presets historically used "game"; glyph key is "games"
};

function isDrawnIcon(name) {
  return typeof name === "string" && name.startsWith(DRAW_ICON_PREFIX);
}

function parseDrawnIcon(name) {
  if (!isDrawnIcon(name)) return null;
  try {
    const b64 = name.slice(DRAW_ICON_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    const strokes = JSON.parse(atob(b64 + pad));
    return Array.isArray(strokes) ? strokes : null;
  } catch { return null; }
}

function encodeDrawnIcon(strokes) {
  const json = JSON.stringify(strokes);
  const b64 = btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return DRAW_ICON_PREFIX + b64;
}

function normalizeDrawStrokes(strokes, viewSize = 24, margin = 2) {
  if (!strokes?.length) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) {
    if (!Array.isArray(s) || s.length < 4) continue;
    for (let i = 0; i < s.length; i += 2) {
      const x = Number(s[i]), y = Number(s[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return [];

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const w = Math.max(1e-6, maxX - minX);
  const h = Math.max(1e-6, maxY - minY);
  const target = viewSize - 2 * margin;
  const scale = target / Math.max(w, h);

  // Transform so the drawing is centered at (viewSize/2, viewSize/2) and
  // fills the box with padding; clamp back to the view range.
  const out = [];
  const half = viewSize / 2;
  for (const s of strokes) {
    if (!Array.isArray(s) || s.length < 4) continue;
    const t = [];
    let bad = false;
    for (let i = 0; i < s.length; i += 2) {
      const x = Number(s[i]), y = Number(s[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) { bad = true; break; }
      const nx = half + (x - cx) * scale;
      const ny = half + (y - cy) * scale;
      t.push(
        Math.max(0, Math.min(viewSize, nx)),
        Math.max(0, Math.min(viewSize, ny)),
      );
    }
    if (!bad && t.length >= 4) out.push(t);
  }
  return out;
}

function strokesToSvgMarkup(strokes) {
  if (!strokes?.length) return "";
  const norm = normalizeDrawStrokes(strokes);
  return norm.map(s => {
    if (!s || s.length < 4) return "";
    // Coordinates are numeric-only after normalize — safe in path attributes.
    let d = `M ${s[0]} ${s[1]}`;
    for (let i = 2; i < s.length; i += 2) d += ` L ${s[i]} ${s[i + 1]}`;
    return `<path d="${d}" />`;
  }).join(" ");
}

function drawPadTheme(el) {
  const cs = getComputedStyle(el || document.documentElement);
  return {
    bg: cs.getPropertyValue("--card-bg").trim() || "#ffffff",
    fg: cs.getPropertyValue("--chalk").trim() || "#111827",
  };
}

function redrawIconCanvas(ctx, strokes, size, themeEl) {
  const { bg, fg } = drawPadTheme(themeEl);
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = fg;
  ctx.lineWidth = Math.max(2, size / 24);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const scale = size / 24;
  // Raw strokes while sketching — no center/fit until submit.
  for (const s of strokes) {
    if (!s || s.length < 4) continue;
    ctx.beginPath();
    ctx.moveTo(s[0] * scale, s[1] * scale);
    for (let i = 2; i < s.length; i += 2) ctx.lineTo(s[i] * scale, s[i + 1] * scale);
    ctx.stroke();
  }
}

function openDrawIconModal({ initialIcon, onSave, onCancel }) {
  let saved = false;
  const opened = AshModal.open({
    className: "draw-icon-modal",
    html: `
    <div class="modal-card draw-icon-card">
      <h4>Draw an icon</h4>
      <p class="draw-icon-hint">Sketch with your finger or mouse — keep it simple.</p>
      <div class="draw-icon-canvas-wrap">
        <canvas id="draw-icon-canvas" width="264" height="264"></canvas>
      </div>
      <div class="draw-icon-actions">
        <button type="button" class="cancel" id="draw-icon-clear">Clear</button>
        <button type="button" class="cancel" id="draw-icon-cancel">Cancel</button>
        <button type="button" class="save" id="draw-icon-save">Use this</button>
      </div>
    </div>`,
    singleton: "return",
    onClose: () => { if (!saved) onCancel?.(); },
  });
  if (!opened) return;
  const { overlay, close } = opened;

  const canvas = overlay.querySelector("#draw-icon-canvas");
  const ctx = canvas.getContext("2d");
  const size = canvas.width;
  let strokes = parseDrawnIcon(initialIcon) || [];
  let drawing = false, liveStroke = null;

  const norm = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 24;
    const y = ((e.clientY - r.top) / r.height) * 24;
    return [Math.max(0, Math.min(24, x)), Math.max(0, Math.min(24, y))];
  };

  const addPoint = (x, y) => {
    const n = liveStroke.length;
    if (n >= 2) {
      const dx = x - liveStroke[n - 2], dy = y - liveStroke[n - 1];
      if (dx * dx + dy * dy < 0.09) return;
    }
    liveStroke.push(x, y);
  };

  const paint = () => redrawIconCanvas(ctx, [...strokes, ...(liveStroke ? [liveStroke] : [])], size, canvas);
  paint();

  overlay.querySelector("#draw-icon-cancel").onclick = () => close();
  overlay.querySelector("#draw-icon-clear").onclick = () => { strokes = []; liveStroke = null; paint(); };
  overlay.querySelector("#draw-icon-save").onclick = () => {
    const all = [...strokes, ...(liveStroke?.length >= 4 ? [liveStroke] : [])];
    const valid = all.filter(s => s.length >= 4);
    if (!valid.length) { toast("Draw something first"); return; }
    // Center and scale-to-fit only once, on submit — keeps sketching natural.
    const encoded = encodeDrawnIcon(normalizeDrawStrokes(valid));
    saved = true;
    close();
    queueMicrotask(() => onSave?.(encoded));
  };

  const down = (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    const [x, y] = norm(e);
    liveStroke = [x, y];
    paint();
  };
  const move = (e) => {
    if (!drawing || !liveStroke) return;
    e.preventDefault();
    const [x, y] = norm(e);
    addPoint(x, y);
    paint();
  };
  const up = (e) => {
    if (!drawing) return;
    e.preventDefault();
    drawing = false;
    if (liveStroke?.length >= 4) strokes.push(liveStroke);
    liveStroke = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
    paint();
  };

  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
}


/* ── photo compress / pick ─────────────────────────────────────────────── */
const PHOTO_MAX_EDGE = 1280;
const PHOTO_JPEG_Q = 0.72;
/** Live online face — tiny avatar transfer (app only; ~few KB data-URL). */
const LIVE_PIC_MAX_BYTES = 10000;
const LIVE_PIC_OUT_PX = 96;
const SERVER_PIC_OUT_PX = 192;
const SERVER_PIC_MAX_BYTES = 150000;
const LIVE_PIC_JPEG_Q = 0.62;

function compressImageFile(file, maxBytes) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(w, h));
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      let q = PHOTO_JPEG_Q;
      let data = canvas.toDataURL("image/jpeg", q);
      while (data.length > maxBytes && q > 0.4) {
        q -= 0.08;
        data = canvas.toDataURL("image/jpeg", q);
      }
      if (data.length > maxBytes) reject(new Error("Image too large after compress"));
      else resolve(data);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read image")); };
    img.src = url;
  });
}

function pickImageBrowser() {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.onchange = () => resolve(inp.files?.[0] || null);
    inp.click();
  });
}

async function pickAndCompressImage(maxBytes) {
  let file = null;
  if (window.AshNative && typeof AshNative.pickImage === "function") {
    const dataUrl = await new Promise((resolve) => {
      window.__ashOnPickedImage = (b64) => {
        window.__ashOnPickedImage = null;
        resolve(b64 || null);
      };
      try { AshNative.pickImage(); } catch { resolve(null); }
      setTimeout(() => { if (window.__ashOnPickedImage) { window.__ashOnPickedImage = null; resolve(null); } }, 120000);
    });
    if (dataUrl) {
      // Native may return raw base64 or data URL — normalize then re-compress via blob if needed
      if (dataUrl.startsWith("data:image")) {
        const res = await fetch(dataUrl);
        file = new File([await res.blob()], "photo.jpg", { type: "image/jpeg" });
      } else {
        const bin = atob(dataUrl);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        file = new File([arr], "photo.jpg", { type: "image/jpeg" });
      }
    }
  }
  if (!file) file = await pickImageBrowser();
  if (!file) return null;
  return compressImageFile(file, maxBytes);
}

/** Pick a photo then let the user zoom/pan a square crop (profile / server icons). */
async function pickAndCropProfileImage(maxBytes = LIVE_PIC_MAX_BYTES, outPx = LIVE_PIC_OUT_PX) {
  let file = null;
  if (window.AshNative && typeof AshNative.pickImage === "function") {
    const dataUrl = await new Promise((resolve) => {
      window.__ashOnPickedImage = (b64) => {
        window.__ashOnPickedImage = null;
        resolve(b64 || null);
      };
      try { AshNative.pickImage(); } catch { resolve(null); }
      setTimeout(() => { if (window.__ashOnPickedImage) { window.__ashOnPickedImage = null; resolve(null); } }, 120000);
    });
    if (dataUrl) {
      if (dataUrl.startsWith("data:image")) return openPhotoCropModal({ src: dataUrl, maxBytes, outPx });
      const bin = atob(dataUrl);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      file = new File([arr], "photo.jpg", { type: "image/jpeg" });
    }
  }
  if (!file) file = await pickImageBrowser();
  if (!file) return null;
  const src = URL.createObjectURL(file);
  try {
    return await openPhotoCropModal({ src, maxBytes, revokeSrc: true, outPx });
  } catch (err) {
    URL.revokeObjectURL(src);
    throw err;
  }
}

/**
 * Square crop editor: drag to pan, pinch / wheel / slider to zoom.
 * Resolves to a JPEG data URL, or null if cancelled.
 */
function openPhotoCropModal({ src, maxBytes = LIVE_PIC_MAX_BYTES, revokeSrc = false, initialZoom = 1, outPx = LIVE_PIC_OUT_PX } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const opened = AshModal.open({
      className: "photo-crop",
      html: `
      <div class="modal-card photo-crop-card">
        <h4>Adjust photo</h4>
        <p class="photo-crop-hint">Pinch or use the slider to zoom — drag to reposition.</p>
        <div class="photo-crop-stage" id="photo-crop-stage">
          <div class="photo-crop-viewport" id="photo-crop-viewport">
            <img id="photo-crop-img" alt="" draggable="false">
          </div>
        </div>
        <div class="photo-crop-zoom-row">
          <span aria-hidden="true">−</span>
          <input type="range" id="photo-crop-zoom" min="100" max="400" value="100" step="1" aria-label="Zoom">
          <span aria-hidden="true">+</span>
        </div>
        <div class="draw-icon-actions">
          <button type="button" class="cancel" id="photo-crop-cancel">Cancel</button>
          <button type="button" class="save" id="photo-crop-use">Use photo</button>
        </div>
      </div>`,
      singleton: "return",
      onClose: () => {
        if (settled) return;
        settled = true;
        if (revokeSrc) try { URL.revokeObjectURL(src); } catch {}
        resolve(null);
      },
    });
    if (!opened) {
      if (revokeSrc) try { URL.revokeObjectURL(src); } catch {}
      resolve(null);
      return;
    }
    const { overlay, close } = opened;

    const img = overlay.querySelector("#photo-crop-img");
    const viewport = overlay.querySelector("#photo-crop-viewport");
    const zoomInp = overlay.querySelector("#photo-crop-zoom");
    let nw = 0, nh = 0;
    let zoom = Math.max(1, Number(initialZoom) || 1); // 1 = cover
    let ox = 0, oy = 0; // pan in viewport px (image center relative to viewport center)
    let dragging = false, lastX = 0, lastY = 0;
    const pointers = new Map();
    let pinchStartDist = 0, pinchStartZoom = 1;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      close();
      if (revokeSrc) try { URL.revokeObjectURL(src); } catch {}
      resolve(value);
    };

    const viewSize = () => viewport.clientWidth || 280;
    const coverScale = () => {
      const v = viewSize();
      return Math.max(v / nw, v / nh);
    };
    const dispScale = () => coverScale() * zoom;
    const clampPan = () => {
      const v = viewSize();
      const dw = nw * dispScale(), dh = nh * dispScale();
      const maxX = Math.max(0, (dw - v) / 2);
      const maxY = Math.max(0, (dh - v) / 2);
      ox = Math.max(-maxX, Math.min(maxX, ox));
      oy = Math.max(-maxY, Math.min(maxY, oy));
    };
    const paint = () => {
      clampPan();
      const s = dispScale();
      img.style.width = `${nw * s}px`;
      img.style.height = `${nh * s}px`;
      img.style.transform = `translate(calc(-50% + ${ox}px), calc(-50% + ${oy}px))`;
      zoomInp.value = String(Math.round(zoom * 100));
    };
    const setZoom = (z, aroundX, aroundY) => {
      const v = viewSize();
      const prev = zoom;
      zoom = Math.max(1, Math.min(4, z));
      if (aroundX != null && aroundY != null && prev > 0) {
        // Keep the point under the fingers stable while zooming.
        const cx = aroundX - v / 2, cy = aroundY - v / 2;
        const ratio = zoom / prev;
        ox = cx - (cx - ox) * ratio;
        oy = cy - (cy - oy) * ratio;
      }
      paint();
    };

    img.onload = () => {
      nw = img.naturalWidth || img.width;
      nh = img.naturalHeight || img.height;
      if (!nw || !nh) { finish(null); return; }
      zoom = Math.max(1, Number(initialZoom) || 1);
      ox = 0; oy = 0;
      paint();
    };
    img.onerror = () => finish(null);
    img.src = src;

    zoomInp.oninput = () => setZoom(Number(zoomInp.value) / 100);

    const pointerPos = (e) => {
      const r = viewport.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const pinchDist = () => {
      const pts = [...pointers.values()];
      if (pts.length < 2) return 0;
      const dx = pts[0].x - pts[1].x, dy = pts[0].y - pts[1].y;
      return Math.hypot(dx, dy);
    };
    const pinchCenter = () => {
      const pts = [...pointers.values()];
      return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    };

    viewport.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      viewport.setPointerCapture(e.pointerId);
      const p = pointerPos(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 1) {
        dragging = true;
        lastX = p.x; lastY = p.y;
      } else if (pointers.size === 2) {
        dragging = false;
        pinchStartDist = pinchDist();
        pinchStartZoom = zoom;
      }
    });
    viewport.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      e.preventDefault();
      const p = pointerPos(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 2 && pinchStartDist > 0) {
        const c = pinchCenter();
        setZoom(pinchStartZoom * (pinchDist() / pinchStartDist), c.x, c.y);
      } else if (dragging && pointers.size === 1) {
        ox += p.x - lastX;
        oy += p.y - lastY;
        lastX = p.x; lastY = p.y;
        paint();
      }
    });
    const endPointer = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStartDist = 0;
      if (pointers.size === 0) dragging = false;
      else if (pointers.size === 1) {
        const only = [...pointers.values()][0];
        dragging = true;
        lastX = only.x; lastY = only.y;
      }
    };
    viewport.addEventListener("pointerup", endPointer);
    viewport.addEventListener("pointercancel", endPointer);
    viewport.addEventListener("wheel", (e) => {
      e.preventDefault();
      const p = pointerPos(e);
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      setZoom(zoom * factor, p.x, p.y);
    }, { passive: false });

    overlay.querySelector("#photo-crop-cancel").onclick = () => finish(null);
    overlay.querySelector("#photo-crop-use").onclick = () => {
      if (!nw || !nh) { finish(null); return; }
      try {
        const OUT = Math.max(48, Math.min(512, outPx | 0 || LIVE_PIC_OUT_PX));
        const canvas = document.createElement("canvas");
        canvas.width = OUT; canvas.height = OUT;
        const ctx = canvas.getContext("2d");
        const v = viewSize();
        const s = dispScale();
        // Image top-left in viewport coords:
        const imgLeft = v / 2 + ox - (nw * s) / 2;
        const imgTop = v / 2 + oy - (nh * s) / 2;
        // Map viewport crop (0..v) → source image pixels
        const sx = (0 - imgLeft) / s;
        const sy = (0 - imgTop) / s;
        const sw = v / s;
        const sh = v / s;
        ctx.fillStyle = "#111";
        ctx.fillRect(0, 0, OUT, OUT);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUT, OUT);
        let q = Math.min(PHOTO_JPEG_Q, LIVE_PIC_JPEG_Q);
        let data = canvas.toDataURL("image/jpeg", q);
        // Shrink pixels further if still over budget.
        let edge = OUT;
        while (data.length > maxBytes && edge > 48) {
          edge = Math.max(48, Math.round(edge * 0.85));
          const c2 = document.createElement("canvas");
          c2.width = edge; c2.height = edge;
          c2.getContext("2d").drawImage(canvas, 0, 0, edge, edge);
          canvas.width = edge; canvas.height = edge;
          canvas.getContext("2d").drawImage(c2, 0, 0);
          q = LIVE_PIC_JPEG_Q;
          data = canvas.toDataURL("image/jpeg", q);
          while (data.length > maxBytes && q > 0.35) {
            q -= 0.07;
            data = canvas.toDataURL("image/jpeg", q);
          }
        }
        if (data.length > maxBytes) {
          toast("Image too large after compress");
          return;
        }
        finish(data);
      } catch (err) {
        toast(err.message || "Couldn’t crop photo");
      }
    };
  });
}

// Render a flat Lucide line icon by name. Unknown values (emoji reactions,
// weekday letters, plain text used as a card's icon) pass through escaped —
// never raw HTML into innerHTML.
function ic(name, cls = "") {
  if (isDrawnIcon(name)) {
    const inner = strokesToSvgMarkup(parseDrawnIcon(name));
    if (inner) {
      return `<svg class="ico${cls ? " " + cls : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
    }
    // Truncated/corrupt drawing — never dump the base64 payload into the UI.
    name = "custom";
  }
  if (REMOVED_ICON_FALLBACK[name]) name = REMOVED_ICON_FALLBACK[name];
  const phosphorInner =
    (typeof PHOSPHOR_SPORTS_PACK === "object" && PHOSPHOR_SPORTS_PACK && PHOSPHOR_SPORTS_PACK[name])
    || (!(name in APP_ICONS)
      && typeof PHOSPHOR_OBJECTS_PACK === "object"
      && PHOSPHOR_OBJECTS_PACK
      && PHOSPHOR_OBJECTS_PACK[name]);
  if (phosphorInner) {
    return `<svg class="ico ico-fill${cls ? " " + cls : ""}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">${phosphorInner}</svg>`;
  }
  const inner = ICONS[name];
  if (!inner) return name == null ? "" : esc(String(name));
  return `<svg class="ico${cls ? " " + cls : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

// Paired background + text per hue (not just a background tint) so initials
// stay readable regardless of theme, the way the category palette pairs an
// accent with its own wash rather than relying on one fixed text color.
const AVATAR_HUES = [
  { bg: "#a9c8ef", fg: "#294c7d" },
  { bg: "#f0c9a9", fg: "#8a4a1e" },
  { bg: "#c9b6ee", fg: "#4a2e7d" },
  { bg: "#a9dcc0", fg: "#1e6a44" },
  { bg: "#f0b6c2", fg: "#8a2e42" },
  { bg: "#e2cdb3", fg: "#7a5a34" },
];
const hueFor = (uid) => AVATAR_HUES[[...String(uid || "?")].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_HUES.length];

/** Conn that owns this member id (active first, then any joined server). */
