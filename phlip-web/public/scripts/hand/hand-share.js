/* hand-share.js — share targets, people list, active event channel, icon/label checks.
 * Globals out: shareTargets, peopleCards, activeEventChannel, isImportedEventCardLabel, isUnsetEventIcon
 * The tray's share / chain / move cards are archived (archive/web/E23-card-hand-open-pitch).
 * Load after: hand-reactions.js; before: hand-focus.js
 */

// Servers you could post an event to right now: connected, and exposing at least
// one event channel you can see (channel visibility is already filtered server-side).
function shareTargets() {
  return Object.values(S.conns).filter(c =>
    !PersonalSpace.isPersonal(c) && c.status === "online" && (c.channels || []).some(ch => ch.kind === "event"));
}


// One card per member of whichever conn the target belongs to — flicking one
// at an event marks them Going and records "added by" whoever played it. A
// personal-only event has no one else to add (single-user local store).
function peopleCards(conn) {
  return conn.members.map(u =>
    ({ icon: u.id === conn.me.id ? "addperson" : "person", label: u.name, personId: u.id, kind: "people" }));
}

// The event channel the board is currently scoped to (create target / filters).
function activeEventChannel() {
  const g = group();
  if (!g || !S.activeEventChannelId) return null;
  return g.channels.find(c => c.id === S.activeEventChannelId) || null;
}

// Pass-imported labels end with " (imported)" — kept for matching existing
// events, but never offered as a create-hand type (user already chose at import).
function isImportedEventCardLabel(label) {
  return /\(imported\)\s*$/i.test(String(label || "").trim());
}

/** True when an event's stored icon is unset / freeform placeholder. */
function isUnsetEventIcon(icon) {
  const i = String(icon || "").trim().toLowerCase();
  return !i || i === "custom" || i === "pin";
}

/**
 * Types offered when creating an event (not Card manager inventory).
 * Excludes freeform Other (`custom` / `somethingElse`) and imported labels.
 */

/**
 * When a freeform title becomes a permanent card, bind same-title events on
 * this server to that card (icon / typeId / category). Does not overwrite a
 * different known typeId.
 */



// Render a day's tickets under a week strip. Every day gets a slim spine
// (which day) in the left margin; cards stay flush with category+time rails
// (what kind). Adding a second event never relocates the date.
// opts.ghosts — optional phone-calendar busy rows (022), non-interactive.
// opts.avails — § Open availability shaded free-time rows.



