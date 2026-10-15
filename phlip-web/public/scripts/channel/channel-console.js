/* channel-console.js — host settings overlays open/mount/render.
 * Globals out: openConsoleSectionOverlay, renderConsoleView, …
 * Load after: channel-view.js; before: channel-members.js
 */

function sharedHistoryEvents(otherUserId) {
  const meId = S.me?.id;
  if (!meId || !otherUserId) return [];
  const involved = (ev, uid) => {
    if (!uid) return false;
    if (ev.createdBy === uid) return true;
    if (ev.rsvps && ev.rsvps[uid]) return true;
    if (ev.addedBy && ev.addedBy[uid]) return true;
    if ((ev.notes || []).some(n => n.userId === uid || (n.mentionedUserIds || []).includes(uid))) return true;
    return false;
  };
  return (board().events || [])
    .filter(e => !e.chainOf && involved(e, meId) && involved(e, otherUserId))
    .sort((a, b) => (b.when || 0) - (a.when || 0));
}

/* ── Abuse reporting ─────────────────────────────────────────────────────────
   Members and broadcast guests can report content or people; the report goes to
   the host and any admins/moderators, who action it from the Reports inbox using
   the existing remove-member / delete-event tools. Nothing here is shown to
   ordinary members. */


/** §9 Admin Console — per-section overlays (admins only). */
const CONSOLE_SECTION_OVERLAYS = {
  "default-role": { title: "Default role", fill: fillConsoleDefaultRole },
  "profiles-media": { title: "Profiles & media", fill: fillConsoleProfilesMedia },
  "event-options": { title: "Event options", fill: fillConsoleEventsSettings },
  "access-control": { title: "Access control", fill: fillConsoleAccessControl },
  "demo-users": { title: "Demo users", fill: fillConsoleDemoUsers },
  "auto-delete": { title: "Auto-delete options", fill: fillConsoleAutoDelete },
};

function isConsoleSectionKind(kind) {
  return !!CONSOLE_SECTION_OVERLAYS[kind];
}

function openConsoleSectionOverlay(key) {
  const spec = CONSOLE_SECTION_OVERLAYS[key];
  const conn = activeConn();
  if (!spec || !canSeeConsoleMeta(conn)) return;
  if (key === "demo-users" && !serverSettings(conn).demoUsersEnabled) return;
  const fill = spec.fill;
  if (typeof fill !== "function") return;
  openSideOverlay({
    kind: key,
    title: spec.title,
    bodyClass: ["side-overlay-console", "console-side-body"],
    mount: (body) => {
      body.innerHTML = `<div class="console-sections" id="console-sections"></div>`;
      fill(body.querySelector("#console-sections"), conn);
    },
  });
}

/** Legacy main-board Admin → open Default role overlay and restore agenda. */
function renderConsoleView(_view) {
  const conn = activeConn();
  if (!canSeeConsoleMeta(conn)) {
    Nav.landDefault(conn);
    renderSidebar();
    renderView();
    return;
  }
  openConsoleSectionOverlay("default-role");
  Nav.landDefault(conn);
  if (S.activeView?.kind === "console" || S.activeView?.kind === "moderate" || S.activeView?.kind === "reports") {
    Nav.set({ kind: "events" });
    try { landOnTodayWeekView(); } catch {}
  }
  renderSidebar();
  renderView();
}



