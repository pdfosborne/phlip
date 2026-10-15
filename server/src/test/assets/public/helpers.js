/* -------------------------------- helpers -------------------------------- */

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const initials = (name) => (name || "?").split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();

// Lucide line icons (ISC licence) — inner SVG markup keyed by app-level name.
// Rendered as flat, single-stroke icons via ic(); stroke follows currentColor
// so they invert to white outlines in dark mode.
const ICONS = {
  // Radar sweep — "Broadcast" (guest microsite for one event).
  radar: `<path d="M19.07 4.93A10 10 0 0 0 6.99 3.34" /> <path d="M4 6h.01" /> <path d="M2.29 9.62A10 10 0 1 0 21.31 8.35" /> <path d="M16.24 7.76A6 6 0 1 0 8.23 16.67" /> <path d="M12 18h.01" /> <path d="M17.99 11.66A6 6 0 0 1 15.77 16.67" /> <circle cx="12" cy="12" r="2" /> <path d="m13.41 10.59 5.66-5.66" />`,
  // Connected nodes — LAN vs public reach on the server rail.
  network: `<rect x="16" y="16" width="6" height="6" rx="1" /> <rect x="2" y="16" width="6" height="6" rx="1" /> <rect x="9" y="2" width="6" height="6" rx="1" /> <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" /> <path d="M12 12V8" />`,
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
  conflict: `<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /> <path d="M12 9v4" /> <path d="M12 17h.01" />`,
  busy: `<circle cx="12" cy="12" r="10" /> <path d="m15 9-6 6" /> <path d="m9 9 6 6" />`,
  ban: `<circle cx="12" cy="12" r="10" /> <path d="m4.9 4.9 14.2 14.2" />`,
  hourglass: `<path d="M5 22h14" /> <path d="M5 2h14" /> <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" /> <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />`,
  repeat: `<path d="m17 2 4 4-4 4" /> <path d="M3 11v-1a4 4 0 0 1 4-4h14" /> <path d="m7 22-4-4 4-4" /> <path d="M21 13v1a4 4 0 0 1-4 4H3" />`,
  react: `<circle cx="12" cy="12" r="10" /> <path d="M8 14s1.5 2 4 2 4-2 4-2" /> <line x1="9" x2="9.01" y1="9" y2="9" /> <line x1="15" x2="15.01" y1="9" y2="9" />`,
  addperson: `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /> <circle cx="9" cy="7" r="4" /> <line x1="19" x2="19" y1="8" y2="14" /> <line x1="22" x2="16" y1="11" y2="11" />`,
  lock: `<rect width="18" height="11" x="3" y="11" rx="2" ry="2" /> <path d="M7 11V7a5 5 0 0 1 10 0v4" />`,
  shield: `<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />`,
  star: `<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />`,
  person: `<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /> <circle cx="12" cy="7" r="4" />`,
  edit: `<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /> <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />`,
  wrench: `<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />`,
  plus: `<path d="M5 12h14" /> <path d="M12 5v14" />`,
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
  locate: `<line x1="2" x2="5" y1="12" y2="12" /> <line x1="19" x2="22" y1="12" y2="12" /> <line x1="12" x2="12" y1="2" y2="5" /> <line x1="12" x2="12" y1="19" y2="22" /> <circle cx="12" cy="12" r="7" />`,
  focusband: `<rect x="3" y="4" width="18" height="16" rx="2" /> <line x1="2" x2="22" y1="12" y2="12" />`,
  ticket: `<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" /> <path d="M13 5v2" /> <path d="M13 17v2" /> <path d="M13 11v2" />`,
  message: `<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />`,
  bell: `<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /> <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />`,
  users: `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />`,
  flag: `<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528" />`,
  pin: `<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" /> <circle cx="12" cy="10" r="3" />`,
  more: `<circle cx="12" cy="12" r="1" /> <circle cx="12" cy="5" r="1" /> <circle cx="12" cy="19" r="1" />`,
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
  server: `<rect width="20" height="8" x="2" y="2" rx="2" ry="2" /> <rect width="20" height="8" x="2" y="14" rx="2" ry="2" /> <line x1="6" x2="6.01" y1="6" y2="6" /> <line x1="6" x2="6.01" y1="18" y2="18" />`,
};

// Hand-drawn icons are stored as "d:" + base64url(JSON array of stroke paths).
const DRAW_ICON_PREFIX = "d:";
const REMOVED_ICON_FALLBACK = {
  run: "sport", bike: "sport", swim: "sport", gym: "sport", dumbbell: "sport",
  tennis: "sport", football: "sport", basketball: "sport", volleyball: "sport",
  pingpong: "sport", cricket: "sport", skateboard: "sport", goal: "sport", medal: "sport", trophy: "sport",
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
  if (document.querySelector(".modal-backdrop.draw-icon-modal")) return;
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop draw-icon-modal";
  overlay.innerHTML = `
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
    </div>`;
  document.body.appendChild(overlay);

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

  const close = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) { close(); onCancel?.(); } };
  overlay.querySelector("#draw-icon-cancel").onclick = () => { close(); onCancel?.(); };
  overlay.querySelector("#draw-icon-clear").onclick = () => { strokes = []; liveStroke = null; paint(); };
  overlay.querySelector("#draw-icon-save").onclick = () => {
    const all = [...strokes, ...(liveStroke?.length >= 4 ? [liveStroke] : [])];
    const valid = all.filter(s => s.length >= 4);
    if (!valid.length) { toast("Draw something first"); return; }
    // Center and scale-to-fit only once, on submit — keeps sketching natural.
    const encoded = encodeDrawnIcon(normalizeDrawStrokes(valid));
    // Avoid the save click falling through onto the page (which would dismiss
    // pick-react before onSave paints the new drawing).
    suppressReactDismissUntil = performance.now() + 600;
    suppressTimelineGestures(600);
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
    if (document.querySelector(".modal-backdrop.photo-crop")) {
      if (revokeSrc) try { URL.revokeObjectURL(src); } catch {}
      resolve(null);
      return;
    }
    const overlay = document.createElement("div");
    overlay.className = "modal-backdrop photo-crop";
    overlay.innerHTML = `
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
      </div>`;
    document.body.appendChild(overlay);

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
      overlay.remove();
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

    overlay.onclick = (e) => { if (e.target === overlay) finish(null); };
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
function connForMember(uid) {
  if (!uid) return null;
  const active = activeConn();
  if (active) {
    if (active.me?.id === uid) return active;
    if ((active.members || []).some(u => u.id === uid)) return active;
  }
  for (const c of Object.values(S.conns || {})) {
    if (c === active) continue;
    if (c.me?.id === uid) return c;
    if ((c.members || []).some(u => u.id === uid)) return c;
  }
  return active || null;
}

function memberRecord(uid) {
  if (!uid) return null;
  const conn = connForMember(uid);
  if (!conn) return null;
  if (conn.me?.id === uid) return conn.me;
  return (conn.members || []).find(u => u.id === uid) || null;
}

/** Online on the server that owns this member — not merely the active rail tab. */
function memberIsOnline(uid) {
  if (!uid) return false;
  const conn = connForMember(uid);
  if (!conn) return false;
  if (conn.local) return conn.me?.id === uid;
  return (conn.online || []).includes(uid);
}

/** Parse offline avatar from member payload or local me. */
function memberOfflineAvatar(uid) {
  if (!uid) return null;
  // Our offline face is always the local device setting when this uid is us.
  if ([...Object.values(S.conns || {})].some(c => c.me?.id === uid)) {
    const local = loadMe().offlineAvatar;
    if (local) return normalizeOfflineAvatar(local, uid);
  }
  const m = memberRecord(uid);
  if (m?.offlineAvatar) return normalizeOfflineAvatar(m.offlineAvatar, uid);
  return null;
}

/**
 * Camera photo for avatars — app only, and only while that member is online.
 * Browser (host URL) always uses offline avatars — live photos stay app-exclusive.
 * - Own device: localPhoto (never host-stored).
 * - Others: livePic from presence (session-only on the host).
 * - Offline / browser → empty here so avatarFaceHtml uses the offline avatar.
 */
function memberProfilePic(uid) {
  if (!uid) return "";
  if (typeof isServedOrigin === "function" && isServedOrigin()) return "";
  if (!memberIsOnline(uid)) return "";
  if ([...Object.values(S.conns || {})].some(c => c.me?.id === uid)) {
    const local = loadMe().localPhoto;
    if (local) return local;
  }
  const m = memberRecord(uid);
  if (!m) return "";
  if (m.livePic) return m.livePic;
  // Legacy host JPEG only if they never set an offline avatar.
  if (!m.offlineAvatar && m.profilePic) return m.profilePic;
  return "";
}

const avatarStyle = (uid) => {
  const pic = memberProfilePic(uid);
  if (pic) {
    // Don't set color:transparent — reaction badges (.avatar-rx) live inside this
    // node and drawn reactions use currentColor (they'd vanish).
    return `background-image:url('${pic.replace(/'/g, "%27")}');background-size:cover;background-position:center`;
  }
  const off = memberOfflineAvatar(uid);
  if (off?.mode === "icon" && off.color) {
    return `background:${off.color};color:${contrastOn(off.color)}`;
  }
  if (off?.mode === "draw") {
    const color = off.color || hueFor(uid).bg;
    return `background:${color};color:${contrastOn(color)}`;
  }
  const h = hueFor(uid);
  return `background:${h.bg};color:${h.fg}`;
};

/** Inner markup for an avatar face (photo → empty; offline icon/draw → glyph; else initials). */
function avatarFaceHtml(uid, name) {
  if (memberProfilePic(uid)) return "";
  const off = memberOfflineAvatar(uid);
  if (off?.mode === "draw" && off.draw) return ic(off.draw, "avatar-face-ico");
  if (off?.mode === "icon") return ic("person", "avatar-face-ico");
  return esc(initials(name != null ? name : nameOf(uid)));
}

function contrastOn(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return "#294c7d";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#2a2a28" : "#f7f4ef";
}

const nameOf = (uid) => {
  if (!uid) return "someone";
  if (isBridgeGuestId(uid)) return bridgeGuestLabel(uid);
  const m = (S.members || []).find(u => u.id === uid);
  if (m?.name) return m.name;
  // Share-link guests (ids like g…) aren't members — names ride on the pitch.
  for (const conn of Object.values(S.conns)) {
    for (const s of (conn.openPitches || [])) {
      const n = s.guestNames?.[uid];
      if (n) return n;
    }
  }
  return "someone";
};

/** Broadcast / share-link guest RSVPs live on `ev.bridgeGuests` (label → status),
 *  not as real user ids — synthetic keys so avatarStack / nameOf still work. */
const BRIDGE_GUEST_PREFIX = "guest:";
function isBridgeGuestId(id) {
  return typeof id === "string" && id.startsWith(BRIDGE_GUEST_PREFIX);
}
function bridgeGuestId(label) {
  return BRIDGE_GUEST_PREFIX + String(label || "");
}
function bridgeGuestLabel(id) {
  return isBridgeGuestId(id) ? id.slice(BRIDGE_GUEST_PREFIX.length) : "";
}
function eventBridgeGuestIds(ev, status) {
  return Object.entries(ev?.bridgeGuests || {})
    .filter(([, st]) => st === status)
    .map(([label]) => bridgeGuestId(label));
}
/** Member + guest ids for one RSVP status (Going / Maybe / Can't). */
function eventRsvpIds(ev, status) {
  const members = Object.entries(ev?.rsvps || {})
    .filter(([, v]) => v === status)
    .map(([u]) => u);
  return [...members, ...eventBridgeGuestIds(ev, status)];
}
function eventRsvpCount(ev, status) {
  return eventRsvpIds(ev, status).length;
}

/* ── roles & permissions (mirrors DrServer.kt) ─────────────────────────── */
const ROLE_HOST = "host";
const ROLE_ADMIN = "admin";
const ROLE_MODERATOR = "moderator";
const ROLE_USER = "user";
const ROLE_VIEWER = "viewer";

function effectiveRole(user = S.me) {
  if (!user) return ROLE_USER;
  if (user.isHost || user.role === ROLE_HOST) return ROLE_HOST;
  const r = String(user.role || ROLE_USER).toLowerCase();
  return [ROLE_ADMIN, ROLE_MODERATOR, ROLE_USER, ROLE_VIEWER].includes(r) ? r : ROLE_USER;
}

function roleLabel(role) {
  return ({ host: "Host", admin: "Admin", moderator: "Moderator", user: "Member", viewer: "Viewer" })[role] || "Member";
}

/** Channel visibility floor: null = everyone (viewers included). */
function normalizeChannelMinRole(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (!v || v === "viewer" || v === "everyone") return null;
  if (v === "user" || v === "member") return ROLE_USER;
  if (v === "moderator" || v === "mod") return ROLE_MODERATOR;
  if (v === "admin") return ROLE_ADMIN;
  return null;
}

function channelMinRoleTitle(minRole) {
  const floor = normalizeChannelMinRole(minRole);
  if (floor === ROLE_ADMIN) return "Admins only";
  if (floor === ROLE_MODERATOR) return "Moderators and above";
  if (floor === ROLE_USER) return "Members and above";
  return "Everyone (including viewers)";
}

function channelMinRoleIcon(minRole) {
  const floor = normalizeChannelMinRole(minRole);
  if (floor === ROLE_ADMIN) return "shield";
  if (floor === ROLE_MODERATOR) return "wrench";
  if (floor === ROLE_USER) return "users";
  return "person";
}

/** Roles at or above a channel minRole floor (null/viewer = everyone). */
function rolesAtOrAboveMinRole(minRole) {
  const floor = normalizeChannelMinRole(minRole);
  const min = floor ? roleRank(floor) : 0;
  return [ROLE_VIEWER, ROLE_USER, ROLE_MODERATOR, ROLE_ADMIN, ROLE_HOST]
    .filter(r => roleRank(r) >= min);
}

/**
 * Compact role-floor mark for sidebars / auto-include:
 * everyone (viewers) → nothing; members → multi-person icon;
 * moderators → “Mods”; admins → “Admin”.
 */
function roleFloorMarkMeta(minRole) {
  const floor = normalizeChannelMinRole(minRole);
  if (!floor) return null; // everyone / viewers
  if (floor === ROLE_USER) {
    return { kind: "icon", icon: "users", label: "M+", title: channelMinRoleTitle(floor) };
  }
  if (floor === ROLE_MODERATOR) {
    return { kind: "text", text: "Mods", cls: "mods", title: channelMinRoleTitle(floor) };
  }
  if (floor === ROLE_ADMIN) {
    return { kind: "text", text: "Admin", cls: "admin", title: channelMinRoleTitle(floor) };
  }
  return null;
}

function roleFloorMarkHtml(minRole, { autoAdd = false } = {}) {
  const meta = roleFloorMarkMeta(minRole);
  if (!meta) return "";
  const title = autoAdd
    ? `Auto add these roles: ${rolesAtOrAboveMinRole(minRole).map(roleLabel).join(", ")}`
    : meta.title;
  if (meta.kind === "icon") {
    return `<span class="side-role-mark side-role-mark-icon" title="${esc(title)}">${ic(meta.icon, "ico-inline")}</span>`;
  }
  return `<span class="side-role-mark side-role-mark-text side-role-mark-${esc(meta.cls)}" title="${esc(title)}">${esc(meta.text)}</span>`;
}

function roleRank(role) {
  const r = String(role || ROLE_USER).toLowerCase();
  if (r === ROLE_VIEWER) return 0;
  if (r === ROLE_USER) return 1;
  if (r === ROLE_MODERATOR) return 2;
  if (r === ROLE_ADMIN) return 3;
  if (r === ROLE_HOST) return 4;
  return 1;
}

/** Members visible in a channel: allow-list ∩ roster, or role-floor filter when open. */
function channelMemberList(ch, conn = activeConn()) {
  const members = [...(conn?.members || S.members || [])];
  if (!ch) return [];
  const floor = normalizeChannelMinRole(ch.minRole) || ROLE_VIEWER;
  const floorRank = roleRank(floor);
  let list;
  if (Array.isArray(ch.allowedUserIds)) {
    const allowed = new Set(ch.allowedUserIds);
    list = members.filter(m => allowed.has(m.id));
  } else {
    list = members.filter(m => roleRank(effectiveRole(m)) >= floorRank);
  }
  const order = { host: 0, admin: 1, moderator: 2, user: 3, viewer: 4 };
  return list.sort((a, b) => {
    const ra = effectiveRole(a), rb = effectiveRole(b);
    if ((order[ra] ?? 9) !== (order[rb] ?? 9)) return (order[ra] ?? 9) - (order[rb] ?? 9);
    return (a.name || "").localeCompare(b.name || "");
  });
}

function serverSettings(conn = activeConn()) {
  const ss = conn?.serverSettings || {};
  return {
    allowUserCreateEvents: ss.allowUserCreateEvents !== false,
    createEvents: normalizeCreateEvents(ss.createEvents, ss.allowUserCreateEvents !== false),
    createEventTypes: normalizeMemberPerm(ss.createEventTypes, "moderator"),
    addLocations: normalizeMemberPerm(ss.addLocations, "moderator"),
    // Invite is admin-only for now (selector removed from Admin settings).
    inviteToGroup: "admin",
    allowProfilePics: ss.allowProfilePics !== false,
    allowUserDraw: ss.allowUserDraw !== false,
    cardTheme: ss.cardTheme || "classic",
    forceJoinCode: !!ss.forceJoinCode,
    defaultRole: ss.defaultRole || ROLE_USER,
    minAge: clampServerMinAge(ss.minAge),
    purgeEndedEvents: !!ss.purgeEndedEvents,
    chatRetentionDays: clampChatRetentionDays(ss.chatRetentionDays),
    allowFreeform: ss.allowFreeform !== false,
  };
}

/** §3 permission scopes: everyone (= members+) | moderator | admin. Viewers never. */
function normalizeMemberPerm(raw, fallback = "moderator") {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "user" || v === "member") return "everyone"; // members and above
  return (v === "everyone" || v === "moderator" || v === "admin") ? v : fallback;
}

/** Create-events scope; migrates legacy boolean allowUserCreateEvents. */
function normalizeCreateEvents(raw, allowUserFallback = true) {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "user" || v === "member") return "everyone";
  if (v === "everyone" || v === "moderator" || v === "admin") return v;
  return allowUserFallback ? "everyone" : "moderator";
}

function memberPermLabel(level) {
  const v = normalizeMemberPerm(level, "admin");
  if (v === "everyone") return "Members and above";
  if (v === "moderator") return "Moderators and above";
  return "Admin only";
}

function meetsMemberPerm(level, conn = activeConn()) {
  if (!conn || conn.local) return true;
  const r = effectiveRole(conn.me);
  if (r === ROLE_VIEWER) return false;
  const perm = normalizeMemberPerm(level, "admin");
  if (perm === "everyone") return r === ROLE_USER || canModerateEvents(conn);
  if (perm === "moderator") return canModerateEvents(conn);
  return canManageServer(conn);
}

function clampChatRetentionDays(raw) {
  const n = Number(raw);
  if (n === 1 || n === 7 || n === 30 || n === 90) return n;
  return 0;
}

function clampServerMinAge(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 18) return 18;
  if (n > 99) return 99;
  return Math.floor(n);
}

/** Public HTTPS edge Worker: cookies when allowed; X-Phlip-Invite when WebView blocks them. */
const EDGE_INVITE_BY_HOST = new Map(); // hostname → invite gate token

function rememberEdgeInvite(httpBase, token) {
  const tok = String(token || "").trim();
  if (!tok) return;
  try {
    const host = new URL(String(httpBase || "").replace(/\/+$/, "")).hostname.toLowerCase();
    if (host) EDGE_INVITE_BY_HOST.set(host, tok);
  } catch { /* ignore */ }
}

function clearEdgeInvite(httpBaseOrUrl) {
  try {
    const host = new URL(String(httpBaseOrUrl || "").replace(/\/+$/, "")).hostname.toLowerCase();
    if (host) EDGE_INVITE_BY_HOST.delete(host);
  } catch { /* ignore */ }
}

function edgeInviteForUrl(url) {
  try {
    return EDGE_INVITE_BY_HOST.get(new URL(String(url)).hostname.toLowerCase()) || "";
  } catch {
    return "";
  }
}

function serverFetch(url, init = {}) {
  const opts = { cache: "no-store", mode: "cors", ...init };
  if (/^https:/i.test(String(url))) {
    if (!opts.credentials) opts.credentials = "include";
    const headers = new Headers(opts.headers || {});
    // Approved sessions: member bearer wins — do not keep sending invite gate.
    if (!headers.has("X-Ash-Token")) {
      const tok = edgeInviteForUrl(url);
      if (tok && !headers.has("X-Phlip-Invite")) headers.set("X-Phlip-Invite", tok);
    } else {
      headers.delete("X-Phlip-Invite");
    }
    opts.headers = headers;
  }
  return fetch(url, opts);
}

/**
 * Unlock the Cloudflare edge join-code gate before any origin proxy.
 * Uses the rotating invite from `XXXXXX@host`. No-op for LAN / missing Worker.
 */
async function unlockEdgeGate(httpBase, inviteCode) {
  const base = String(httpBase || "").replace(/\/+$/, "");
  const code = String(inviteCode || "").trim();
  if (!base || !code || !/^https:/i.test(base)) return { ok: true, skipped: true };
  try {
    const res = await serverFetch(`${base}/edge/gate`, {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8", "Accept": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (res.ok) {
      try {
        const body = await res.json();
        if (body && body.token) rememberEdgeInvite(base, body.token);
      } catch { /* cookie-only older Worker */ }
      return { ok: true };
    }
    if (res.status === 401) {
      return { ok: false, error: "Wrong or expired join code for this Public server." };
    }
    // 404/502 = Worker not provisioned yet — fall through to direct tunnel.
    return { ok: true, skipped: true };
  } catch {
    return { ok: true, skipped: true };
  }
}

/** Public /ash-ok meta for the join agreement (before personal data). */
async function fetchJoinMeta(httpBase, inviteCode = "") {
  const base = String(httpBase || "").replace(/\/+$/, "");
  if (!base) throw new Error("No server URL");
  const unlocked = await unlockEdgeGate(base, inviteCode);
  if (!unlocked.ok) {
    const err = new Error(unlocked.error || "Join code rejected");
    err.status = 401;
    throw err;
  }
  const probeUrl = `${base}/ash-ok`;
  let res = null;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      res = await serverFetch(probeUrl, { method: "GET", signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
    lastStatus = res?.status || 0;
    if (res?.ok) break;
    if (res?.status === 401 || res?.status === 403) {
      // Gate HTML or forbidden — try unlock again then retry once.
      if (inviteCode && attempt === 0) {
        await unlockEdgeGate(base, inviteCode);
        continue;
      }
      break;
    }
    if (res?.status !== 400 || attempt === 2) break;
    await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
  }
  if (!res?.ok) {
    const err = new Error(
      lastStatus === 401 || lastStatus === 403
        ? "Enter the current join code from the host (Public gate)."
        : `Server responded ${lastStatus || "?"} at ${base}`,
    );
    err.status = lastStatus;
    throw err;
  }
  const text = await res.text();
  let meta = { ok: true, name: "Phlip server", iconText: "", minAge: 18, serverPic: "" };
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      meta = {
        ok: true,
        name: String(parsed.name || "Phlip server").trim() || "Phlip server",
        iconText: String(parsed.iconText || "").trim().slice(0, 4),
        minAge: clampServerMinAge(parsed.minAge),
        serverPic: typeof parsed.serverPic === "string" ? parsed.serverPic : "",
      };
    }
  } catch {
    // Legacy plain "ok" / HTML gate mis-detect — still mark reachable only if JSON-ish.
    if (/^\s*</.test(text)) {
      const err = new Error("Public gate is on — enter the current join code from the host.");
      err.status = 401;
      throw err;
    }
  }
  return meta;
}

function joinAgreementRulesHtml(meta) {
  const age = clampServerMinAge(meta?.minAge);
  return `
    <ul class="join-accept-list">
      <li>You confirm you are <strong>at least ${age} years old</strong> (this server’s age rating).</li>
      <li>This group’s data lives on the <strong>host’s phone</strong> — not on a Phlip company server.</li>
      <li>The host sees your <strong>display name</strong>, can <strong>Approve or Deny</strong> you, and can remove you later.</li>
      <li>You create your own <strong>password for this server</strong>. Keep it private; the host never receives it in plain text.</li>
      <li>This server’s <strong>icon</strong> will be saved on your device so you can recognise it in your list.</li>
      <li>Only join people and servers you trust. If you leave or are removed, your access ends.</li>
    </ul>`;
}

function joinAgreementHeaderHtml(meta) {
  const name = esc(meta?.name || "Phlip server");
  const age = clampServerMinAge(meta?.minAge);
  const pic = meta?.serverPic || "";
  const glyph = esc((meta?.iconText || "").trim() || (meta?.name || "P").trim().slice(0, 2).toUpperCase() || "P");
  const face = pic
    ? `<img class="join-agree-pic" src="${esc(pic)}" alt="">`
    : `<span class="join-agree-glyph">${glyph}</span>`;
  return `
    <div class="join-agree-server">
      <div class="join-agree-face">${face}</div>
      <div class="join-agree-copy">
        <div class="join-agree-name">${name}</div>
        <div class="join-agree-age">Age rating: ${age}+</div>
      </div>
    </div>`;
}

/** Roles a host/admin may pick as the default for newly approved members.
 *  Spec §3: Member / Viewer. Host may still seed Admin as default. */
function defaultRoleChoices(conn = activeConn()) {
  const roles = [ROLE_USER, ROLE_VIEWER];
  if (effectiveRole(conn?.me) === ROLE_HOST) roles.unshift(ROLE_ADMIN);
  return roles;
}

function canManageServer(conn = activeConn()) {
  if (!conn || conn.local) return true;
  const r = effectiveRole(conn.me);
  return r === ROLE_HOST || r === ROLE_ADMIN;
}

function canModerateEvents(conn = activeConn()) {
  if (!conn || conn.local) return true;
  const r = effectiveRole(conn.me);
  return r === ROLE_HOST || r === ROLE_ADMIN || r === ROLE_MODERATOR;
}

/** Sidebar Console meta — organisers only, not on personal space. */
function canSeeConsoleMeta(conn = activeConn()) {
  return !!conn && !conn.local && conn.id !== "personal" && canManageServer(conn);
}

/** Sidebar Moderate meta — host/admin/mod on a real server (not personal). */
function canSeeModerateMeta(conn = activeConn()) {
  return !!conn && !conn.local && conn.id !== "personal" && canModerateEvents(conn);
}

function canCreateEvents(conn = activeConn()) {
  if (!conn || conn.local) return true;
  return meetsMemberPerm(serverSettings(conn).createEvents, conn);
}

function canCreateEventTypes(conn = activeConn()) {
  if (!conn || conn.local) return true;
  return meetsMemberPerm(serverSettings(conn).createEventTypes, conn);
}

function canAddLocations(conn = activeConn()) {
  if (!conn || conn.local) return true;
  return meetsMemberPerm(serverSettings(conn).addLocations, conn);
}

function canInviteToGroup(conn = activeConn()) {
  if (!conn || conn.local) return true;
  // Hard-fixed: only admins / host may invite into groups for now.
  return canManageServer(conn);
}

/** Drawn profile faces + drawn reactions (server can disable for members). */
function canUserDraw(conn = activeConn()) {
  if (!conn || conn.local) return true;
  return serverSettings(conn).allowUserDraw !== false;
}

function canMutateContent(conn = activeConn()) {
  if (!conn || conn.local) return true;
  return effectiveRole(conn.me) !== ROLE_VIEWER;
}

function canEditEvent(ev, conn = ownerConnFor(ev) || activeConn()) {
  if (!ev) return false;
  if (!conn || conn.local) return true;
  if (canModerateEvents(conn)) return true;
  return canMutateContent(conn) && ev.createdBy === myIdOf(ev);
}

/** Shared event sticker — on the event itself (creator/mod), visible to everyone. */
function eventHasSharedSticker(ev) {
  if (!ev) return false;
  if (typeof ev._sticker === "string" && ev._sticker.trim()) return true;
  if (typeof ev.sticker === "string" && ev.sticker && !ev.sticker.startsWith("e2e:")) {
    return !!ev.sticker.trim();
  }
  return false;
}

// Personal stickers: device-only notes when the event has no shared sticker.
const LOCAL_STICKERS_KEY = "ash_local_stickers_v1";

function loadLocalStickers() {
  try { return JSON.parse(localStorage.getItem(LOCAL_STICKERS_KEY)) || {}; }
  catch { return {}; }
}

function getLocalSticker(eventId) {
  if (!eventId) return "";
  const text = loadLocalStickers()[eventId];
  return typeof text === "string" ? text.trim() : "";
}

function setLocalSticker(eventId, sticker) {
  if (!eventId) return;
  const all = loadLocalStickers();
  const plain = (sticker || "").trim().slice(0, 80);
  if (plain) all[eventId] = plain;
  else delete all[eventId];
  try { localStorage.setItem(LOCAL_STICKERS_KEY, JSON.stringify(all)); }
  catch { /* quota */ }
}

function clearLocalSticker(eventId) {
  setLocalSticker(eventId, "");
}

function canManageMember(target, conn = activeConn()) {
  if (!target || !conn || conn.local) return false;
  const tr = effectiveRole(target);
  if (tr === ROLE_HOST || target.isHost) return false;
  const ar = effectiveRole(conn.me);
  if (ar === ROLE_HOST) return true;
  if (ar === ROLE_ADMIN) return tr === ROLE_MODERATOR || tr === ROLE_USER || tr === ROLE_VIEWER;
  return false;
}

function assignableRolesFor(target, conn = activeConn()) {
  if (!canManageMember(target, conn)) return [];
  const ar = effectiveRole(conn.me);
  if (ar === ROLE_HOST) return [ROLE_ADMIN, ROLE_MODERATOR, ROLE_USER, ROLE_VIEWER];
  return [ROLE_MODERATOR, ROLE_USER, ROLE_VIEWER];
}

function avatarStack(ids, max = 6, reactions = null) {
  if (!ids.length) return "";
  const visible = ids.slice(0, max), extra = ids.length - visible.length;
  return `<div class="avatar-stack">${
    visible.map(uid => {
      const rx = reactions ? rxParts(reactions[uid]) : null;
      const badge = rx?.emoji
        ? `<span class="avatar-rx" aria-hidden="true">${rxDisplay(rx.emoji)}${rx.count > 1 ? `<span class="avatar-rx-n">×${rx.count}</span>` : ""}</span>`
        : "";
      const title = rx?.emoji
        ? `${nameOf(uid)} · ${rx.emoji}${rx.count > 1 ? ` ×${rx.count}` : ""}`
        : nameOf(uid);
      return `<span class="avatar-sm" data-uid="${esc(uid)}" style="${avatarStyle(uid)}" title="${esc(title)}">${avatarFaceHtml(uid)}${badge}</span>`;
    }).join("")
  }${extra > 0 ? `<span class="avatar-sm avatar-more">+${extra}</span>` : ""}</div>`;
}

/** Display name for the event organiser (member lookup + createdByName fallback). */
function eventOrganiserName(ev) {
  const id = String(ev?.createdBy || "").trim();
  if (!id) return "";
  const conn = (typeof ownerConnFor === "function" ? ownerConnFor(ev) : null) || activeConn();
  const local = (conn?.members || []).find(u => u.id === id);
  if (local?.name) return local.name;
  const n = nameOf(id);
  if (n && n !== "someone") return n;
  const fallback = String(ev?.createdByName || "").trim();
  return fallback || "";
}

/** True when the organiser was cleared after leave/kick (empty chip). */
function eventOrganiserEmpty(ev) {
  return !String(ev?.createdBy || "").trim();
}

/** Host chip: avatar only — name stays in the title tooltip. Empty when purged. */
function eventHostSummaryHTML(ev) {
  if (eventOrganiserEmpty(ev)) {
    return `<div class="event-host-summary event-host-empty" title="Organiser left this server">
      <span class="avatar-sm avatar-empty" aria-label="Former organiser"></span>
    </div>`;
  }
  // Pass imports: unverified display name — label only, no member avatar link.
  if (ev.passCreatorName || String(ev.createdBy || "").startsWith("pass:")) {
    const name = ev.passCreatorName || eventOrganiserName(ev) || "Someone";
    const edited = ev._passEditedByMe ? " · edited by you" : "";
    const added = (() => {
      const me = activeConn()?.me;
      if (!me || !ev.addedBy?.[me.id]) return "";
      const conn = ownerConnFor(ev);
      if (conn && !conn.local && conn.id !== "personal") return ` · added by ${esc(me.name || "you")}`;
      return "";
    })();
    return `<div class="event-host-summary event-pass-attribution" title="Shared by ${esc(name)} (unverified)">Shared by ${esc(name)}${added}${edited}</div>`;
  }
  const id = ev.createdBy;
  const name = eventOrganiserName(ev) || "Organiser";
  return `<div class="event-host-summary" title="Hosted by ${esc(name)}">${avatarStack([id], 1, ev.reactions || {})}</div>`;
}

// Faces on an event summary: people going (members + broadcast guests), plus
// anyone who reacted but isn't marked going yet — so their emoji still has a
// person to sit on. Host is shown separately via eventHostSummaryHTML.
function ticketSummaryPeople(ev) {
  const conn = ownerConnFor(ev) || activeConn();
  const hostId = String(ev?.createdBy || "").trim() || null;
  // Keep RSVP faces (they're still on the plan); hide reaction-only faces from blocked members.
  const going = eventRsvpIds(ev, "going").filter(uid => uid !== hostId);
  const ids = [...going];
  const seen = new Set(going);
  if (hostId) seen.add(hostId);
  for (const [uid, v] of Object.entries(reactionsVisible(ev.reactions, conn))) {
    if (!rxParts(v).emoji || seen.has(uid)) continue;
    seen.add(uid);
    ids.push(uid);
  }
  return ids;
}

/** Host (named) + registered faces for timeline tickets / meta cards. */
function eventPeopleSummaryHTML(ev, max = 6) {
  const host = eventHostSummaryHTML(ev);
  const peopleIds = ticketSummaryPeople(ev);
  const faces = peopleIds.length ? avatarStack(peopleIds, max, ev.reactions || {}) : "";
  if (!host && !faces) return "";
  return `<div class="event-people-summary">${host}${faces ? `<div class="event-going-summary" title="Registered">${faces}</div>` : ""}</div>`;
}

/** Compact “added by” chip for chain-link tickets / detail rows. */
function chainAddedByHTML(ev) {
  if (eventOrganiserEmpty(ev)) {
    return `<span class="chain-added-by chain-added-by-empty" title="Organiser left this server"><span class="avatar-sm avatar-empty" aria-hidden="true"></span><span class="chain-added-by-name">Former organiser</span></span>`;
  }
  const id = ev?.createdBy;
  const name = eventOrganiserName(ev) || "someone";
  const face = id ? avatarStack([id], 1) : "";
  return `<span class="chain-added-by" title="Added by ${esc(name)}">${face}<span class="chain-added-by-name">${esc(name)}</span></span>`;
}

const RSVP_VIEW_KEY = "ash_rsvp_view_v1";
function loadRsvpViewMode() {
  try {
    return localStorage.getItem(RSVP_VIEW_KEY) === "list" ? "list" : "faces";
  } catch {
    return "faces";
  }
}
function saveRsvpViewMode(mode) {
  try { localStorage.setItem(RSVP_VIEW_KEY, mode === "list" ? "list" : "faces"); } catch {}
}

function eventRsvpPersonName(uid, ev) {
  if (!uid) return "someone";
  if (typeof isBridgeGuestId === "function" && isBridgeGuestId(uid)) {
    return bridgeGuestLabel(uid) || "Guest";
  }
  const conn = (typeof ownerConnFor === "function" ? ownerConnFor(ev) : null) || activeConn();
  const local = (conn?.members || []).find(u => u.id === uid);
  if (local?.name) return local.name;
  const n = nameOf(uid);
  return (n && n !== "someone") ? n : "someone";
}

function eventRsvpListHTML(ids, ev, reactions, { canRemove = false } = {}) {
  if (!ids.length) return "";
  return `<ul class="event-rsvp-list">${ids.map(uid => {
    const name = eventRsvpPersonName(uid, ev);
    const addedById = ev.addedBy?.[uid];
    const addedBy = addedById && addedById !== uid ? eventRsvpPersonName(addedById, ev) : "";
    const removeBtn = canRemove
      ? `<button type="button" class="event-rsvp-remove" data-uid="${esc(uid)}" title="Remove from event" aria-label="Remove ${esc(name)} from event">${typeof ic === "function" ? ic("trash") : "×"}</button>`
      : "";
    return `<li class="event-rsvp-person" data-uid="${esc(uid)}">
      ${avatarStack([uid], 1, reactions)}
      <span class="event-rsvp-person-meta">
        <span class="event-rsvp-person-name">${esc(name)}</span>
        ${addedBy ? `<span class="event-rsvp-person-added">added by ${esc(addedBy)}</span>` : ""}
      </span>
      ${removeBtn}
    </li>`;
  }).join("")}</ul>`;
}

/** Faces or named list of Going / Maybe / Can't for event detail. */
function eventRsvpPeopleHTML(ev, { going, maybe, out, reactions, canRemove = false } = {}) {
  const groups = [
    { label: "Going", ids: going || [] },
    { label: "Maybe", ids: maybe || [] },
    { label: "Can't make it", ids: out || [] },
  ].filter(g => g.ids.length);
  if (!groups.length) return "";
  const mode = loadRsvpViewMode();
  const body = groups.map(g => mode === "list"
    ? `<div class="event-rsvp-group is-list"><b>${g.label}</b>${eventRsvpListHTML(g.ids, ev, reactions, { canRemove })}</div>`
    : `<div class="event-rsvp-group"><b>${g.label}</b>${avatarStack(g.ids, 20, reactions || {})}${addedByLine(g.ids, ev)}</div>`
  ).join("");
  return `<div class="event-rsvp-people" data-mode="${mode}">
    <div class="event-rsvp-view-toggle" role="group" aria-label="Response layout">
      <button type="button" class="event-rsvp-view-btn${mode === "faces" ? " on" : ""}" data-rsvp-view="faces">Faces</button>
      <button type="button" class="event-rsvp-view-btn${mode === "list" ? " on" : ""}" data-rsvp-view="list">List</button>
    </div>
    ${body}
  </div>`;
}

// "Added by X" annotations for whichever of these ids were dragged on by
// someone else, rather than RSVPing themselves.
function addedByLine(ids, ev) {
  const lines = ids
    .filter(id => ev.addedBy?.[id] && ev.addedBy[id] !== id)
    .map(id => `${esc(nameOf(id))} added by ${esc(nameOf(ev.addedBy[id]))}`);
  return lines.length ? `<div class="added-by-list">${lines.join(" · ")}</div>` : "";
}
// Back-compat alias: render code still calls group() to get the on-screen
// board ({channels, events, openPitches}). Servers no longer have a group layer.
const group = board;

// True when the main timeline board is showing (collated Events or a single
// event channel) — used to decide whether to refresh/focus after createEvent.
function viewingEventsBoard() {
  if (S.activeView?.kind === "events") return true;
  if (S.activeView?.kind !== "channel") return false;
  const ch = group()?.channels.find(c => c.id === S.activeView.id);
  return ch?.kind === "event";
}

function viewingOpenPitch() {
  return S.activeView?.kind === "openPitch";
}

// Live event pushes (create / RSVP / react / edit) must refresh both the
// Events board and any open event-channel timeline — not only kind==="events".
function shouldRefreshEventUI(eventId) {
  const kind = S.activeView?.kind;
  return viewingEventsBoard() || viewingEvent(eventId)
    || kind === "deck" || kind === "hosting" || kind === "invited" || kind === "live";
}

function shouldRefreshPitchUI() {
  return viewingOpenPitch() || S.activeView?.kind === "live";
}

/** Whether a share-state change should re-render the current view. */
function shouldRefreshShareUI(conn, kind, refId) {
  if (S.activeView?.kind === "live") return true;
  if (S.activeConnId === "personal" && (viewingEventsBoard() || S.activeView?.kind === "openPitch"
      || S.activeView?.kind === "deck" || S.activeView?.kind === "hosting"
      || S.activeView?.kind === "invited")) return true;
  if (conn && conn.id !== S.activeConnId && S.activeConnId !== "personal") return false;
  if (kind === "event" && refId) return shouldRefreshEventUI(refId);
  if (kind === "pitch") return shouldRefreshPitchUI();
  return viewingEventsBoard() || viewingOpenPitch()
    || S.activeView?.kind === "deck" || S.activeView?.kind === "hosting"
    || S.activeView?.kind === "invited";
}

/**
 * In-app confirm dialog matching modal-card styling (replaces window.confirm /
 * native Android AlertDialog). Resolves true for OK, false for Cancel.
 * @param {string} message
 * @param {{ ok?: string, cancel?: string, danger?: boolean }} [opts]
 * @returns {Promise<boolean>}
 */
function ashConfirm(message, opts = {}) {
  const okLabel = opts.ok || "OK";
  const cancelLabel = opts.cancel || "Cancel";
  const danger = !!opts.danger;
  return new Promise((resolve) => {
    const existing = document.querySelector(".modal-backdrop.ash-confirm-modal");
    if (existing) existing.remove();
    const ov = document.createElement("div");
    ov.className = "modal-backdrop ash-confirm-modal";
    ov.setAttribute("role", "alertdialog");
    ov.setAttribute("aria-modal", "true");
    ov.innerHTML = `
      <div class="modal-card ash-confirm-card">
        <p class="ash-confirm-msg">${esc(message)}</p>
        <div class="actions">
          <span></span>
          <div>
            <button type="button" class="cancel" id="ash-confirm-cancel">${esc(cancelLabel)}</button>
            <button type="button" class="save${danger ? " danger" : ""}" id="ash-confirm-ok">${esc(okLabel)}</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const done = (v) => {
      ov.remove();
      resolve(v);
    };
    ov.onclick = (e) => { if (e.target === ov) done(false); };
    ov.querySelector("#ash-confirm-cancel").onclick = () => done(false);
    ov.querySelector("#ash-confirm-ok").onclick = () => done(true);
    // Focus primary so Enter works without opening the soft keyboard on a text field.
    requestAnimationFrame(() => ov.querySelector("#ash-confirm-ok")?.focus());
  });
}
