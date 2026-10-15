/* helpers-part4.js — split from helpers.js (Part 3 size ceiling).
 * Load after: helpers-part3.js; part of helpers cluster.
 */

function clampPersonalSocialMetaView() {
  const conn = activeConn();
  if (!conn || !PersonalSpace.isPersonal(conn)) return false;
  if (showSocialMetaChannels(conn)) return false;
  const kind = S.activeView?.kind;
  if (!["events", "live"].includes(kind)) return false;
  const channels = conn.channels || [];
  const first = channels.find(c =>
    c.kind === "event"
    && !(typeof PersonalSpace !== "undefined" && PersonalSpace.isHiddenChannel(c, conn)))
    || channels.find(c => !(typeof PersonalSpace !== "undefined" && PersonalSpace.isHiddenChannel(c, conn)))
    || channels[0];
  if (first) {
    Nav.openChannel(first.id);
    if (first.kind === "event") S.activeEventChannelId = first.id;
  } else {
    Nav.set({ kind: "events" });
  }
  return true;
}

/** Drawn profile faces, chat reactions, and event icons (server can disable for members). */
function canUserDraw(conn = activeConn()) {
  if (!conn || PersonalSpace.isPersonal(conn)) return true;
  return serverSettings(conn).allowUserDraw !== false;
}

function canMutateContent(conn = activeConn()) {
  const projected = typeof activeProjectionContext === "function" ? activeProjectionContext() : null;
  if (projected?.offline || projected?.unavailable) return false;
  if (!conn || PersonalSpace.isPersonal(conn)) return true;
  return effectiveRole(conn.me) !== ROLE_VIEWER;
}

function canEditEvent(ev, conn = ownerConnFor(ev) || activeConn()) {
  if (!ev) return false;
  if (ev.calendarImported || ev.originKind === "device") return false;
  const projected = typeof activeProjectionContext === "function" ? activeProjectionContext() : null;
  if (projected?.offline || projected?.unavailable) return false;
  if (!conn || PersonalSpace.isPersonal(conn)) return true;
  if (canManageServer(conn)) return true;
  const ch = (conn.channels || []).find(c => c.id === ev.channelId);
  if (ch && typeof channelVisibleTo === "function" && !channelVisibleTo(ch, conn.me, conn)) return false;
  if (effectiveRole(conn.me) === ROLE_MODERATOR) return true;
  if (ch && ch.kind === "event") {
    if (ev.createdBy === myIdOf(ev) && canChannelPerm(conn.me, ch, "create", conn)) return true;
    return false;
  }
  return canMutateContent(conn) && ev.createdBy === myIdOf(ev);
}

function eventConfirmAttendance(ev) {
  return !!(ev && ev.confirmAttendance);
}

function eventPositiveRsvpStatus(ev) {
  return eventConfirmAttendance(ev) ? "signedUp" : "going";
}

function eventRsvpChoiceStatuses(ev) {
  return [eventPositiveRsvpStatus(ev), "out"];
}

function eventRsvpStatusLabel(status, ev) {
  if (status === "signedUp") return "Signed up";
  if (status === "going") return eventConfirmAttendance(ev) ? "Confirmed" : "Going";
  if (status === "out") return eventConfirmAttendance(ev) ? "Declined" : "Can't";
  return "";
}

function eventRsvpYesActionLabel(ev) {
  return eventConfirmAttendance(ev) ? "Sign up" : "Going";
}

function eventRsvpNoActionLabel() {
  return "Can't";
}

function eventRsvpAcceptMenuLabel(ev) {
  return eventConfirmAttendance(ev) ? "Sign up" : "Accept";
}

function eventRsvpChoiceLabel(status, ev) {
  if (status === "signedUp") return eventRsvpYesActionLabel(ev);
  if (status === "going") return eventConfirmAttendance(ev) ? "Confirmed" : eventRsvpYesActionLabel(ev);
  if (status === "out") return eventRsvpNoActionLabel(ev);
  return eventRsvpStatusLabel(status, ev);
}

function eventSignupGroups(ev) {
  return Array.isArray(ev?.signupGroups) ? ev.signupGroups : [];
}

function applyConfirmAttendanceRsvps(ev, next) {
  if (!ev) return;
  const enable = !!next;
  ev.confirmAttendance = enable;
  const organiser = String(ev.createdBy || "");
  const rsvps = ev.rsvps || (ev.rsvps = {});
  for (const id of Object.keys(rsvps)) {
    const status = rsvps[id];
    if (!enable && status === "signedUp") rsvps[id] = "going";
    else if (enable && status === "going" && id !== organiser) rsvps[id] = "signedUp";
  }
}

function signupAttendanceTab(ev) {
  try {
    if (!ev?.id || typeof S === "undefined") return "people";
    if (S.signupAttendanceEventId === ev.id && S.signupAttendanceTab === "groups") return "groups";
    return "people";
  } catch {
    return "people";
  }
}

function setSignupAttendanceTab(ev, tab) {
  try {
    if (typeof S === "undefined" || !ev?.id) return;
    S.signupAttendanceEventId = ev.id;
    S.signupAttendanceTab = tab === "groups" ? "groups" : "people";
  } catch {}
}

function signupGroupEditorOpen(ev) {
  try {
    return !!(ev && typeof S !== "undefined" && S.signupGroupEditorEventId === ev.id);
  } catch {
    return false;
  }
}

function setSignupGroupEditor(ev, on) {
  try {
    if (typeof S === "undefined") return;
    S.signupGroupEditorEventId = on && ev?.id ? ev.id : "";
  } catch {}
}

function eventGroupIdForUser(ev, userId) {
  if (!ev || !userId) return "";
  const uid = String(userId);
  for (const g of eventSignupGroups(ev)) {
    if ((g.memberIds || []).some(id => String(id) === uid)) return g.id || "";
  }
  return "";
}


function eventSignupEligibleIds(ev) {
  const ids = [];
  for (const [id, status] of Object.entries(ev?.rsvps || {})) {
    if (status === "going" || status === "signedUp") ids.push(id);
  }
  return ids;
}

function nextSignupGroupName(ev) {
  const used = new Set(eventSignupGroups(ev).map((g) => String(g.name || "").trim().toLowerCase()));
  let n = 1;
  while (used.has(`group ${n}`)) n += 1;
  return `Group ${n}`;
}

function eventOriginKind(ev, conn) {
  if (!ev) return "unknown";
  if (ev.calendarImported || ev.originKind === "device") return "device";
  if (ev.originKind === "server" || ev._linked) return "server";
  if (ev._connId && ev._connId !== "personal") return "server";
  const owner = conn || (typeof ownerConnFor === "function" ? ownerConnFor(ev) : null);
  if (owner && typeof PersonalSpace !== "undefined" && !PersonalSpace.isPersonal(owner)) return "server";
  return "personal";
}

function eventEditabilityLabel(ev, conn) {
  const kind = eventOriginKind(ev, conn);
  if (kind === "device") return "Device calendar · Read-only";
  const owner = conn || (typeof ownerConnFor === "function" ? ownerConnFor(ev) : null)
    || (typeof activeConn === "function" ? activeConn() : null);
  const canEdit = typeof canEditEvent === "function" ? canEditEvent(ev, owner) : false;
  if (kind === "personal") return canEdit ? "My plans · You can edit this" : "Personal · Read-only";
  const name = String(ev._serverName || owner?.name || owner?.hostName || "this server").trim() || "this server";
  return canEdit ? `Edits go to ${name}` : `${name} · Read-only`;
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
  if (!target || !conn || PersonalSpace.isPersonal(conn)) return false;
  const tr = effectiveRole(target);
  if (tr === ROLE_HOST || target.isHost) return false;
  const ar = effectiveRole(conn.me);
  if (ar === ROLE_HOST) return true;
  if (ar === ROLE_ADMIN) return tr === ROLE_MODERATOR || tr === ROLE_USER || tr === ROLE_VIEWER;
  return false;
}

/** Custom role tags (not ladder roles). Mirrors ServerAuthorization.canAssignMemberRoleTags. */
function canAssignMemberRoleTags(target, conn = activeConn()) {
  if (canManageMember(target, conn)) return true;
  if (!target || !conn || PersonalSpace.isPersonal(conn)) return false;
  const tr = effectiveRole(target);
  if (tr === ROLE_HOST || target.isHost) return false;
  return effectiveRole(conn.me) === ROLE_MODERATOR && (tr === ROLE_USER || tr === ROLE_VIEWER);
}

/**
 * Permute [channels] so [orderedIds] appear in that order among their current
 * slots. Unknown ids are ignored; other channels stay put. Mirrors
 * applyListOrderByIds on the host.
 */
function applyChannelOrder(channels, orderedIds) {
  if (!Array.isArray(channels) || !Array.isArray(orderedIds)) return false;
  const wanted = [];
  const seen = new Set();
  for (const raw of orderedIds) {
    const id = String(raw || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    wanted.push(id);
  }
  if (wanted.length < 2) return false;
  const indexById = new Map();
  for (let i = 0; i < channels.length; i++) {
    const id = channels[i]?.id;
    if (id && !indexById.has(id)) indexById.set(id, i);
  }
  const known = wanted.filter(id => indexById.has(id));
  if (known.length < 2) return false;
  const slots = known.map(id => indexById.get(id)).sort((a, b) => a - b);
  const ordered = known.map(id => channels[indexById.get(id)]);
  let changed = false;
  for (let i = 0; i < slots.length; i++) {
    if (channels[slots[i]] !== ordered[i]) { changed = true; break; }
  }
  if (!changed) return false;
  for (let i = 0; i < slots.length; i++) channels[slots[i]] = ordered[i];
  return true;
}

function assignableRolesFor(target, conn = activeConn()) {
  if (!canManageMember(target, conn)) return [];
  const ar = effectiveRole(conn.me);
  if (ar === ROLE_HOST) return [ROLE_ADMIN, ROLE_MODERATOR, ROLE_USER, ROLE_VIEWER];
  return [ROLE_MODERATOR, ROLE_USER, ROLE_VIEWER];
}

function avatarStack(ids, max = 6, reactions = null, chatters = null, unreadChatters = null, opts = {}) {
  if (!ids.length) return "";
  const chatUnreadOnly = !!opts.chatUnreadOnly;
  const visible = ids.slice(0, max), extra = ids.length - visible.length;
  const hasChat = (uid) => {
    if (!chatters) return false;
    if (typeof chatters.has === "function") return chatters.has(uid);
    return !!(chatters[uid] || chatters[String(uid)]);
  };
  const hasUnread = (uid) => {
    if (!unreadChatters) return false;
    if (typeof unreadChatters.has === "function") return unreadChatters.has(uid);
    return !!(unreadChatters[uid] || unreadChatters[String(uid)]);
  };
  return `<div class="avatar-stack">${
    visible.map(uid => {
      const rx = reactions ? rxParts(reactions[uid]) : null;
      const badge = rx?.emoji
        ? `<span class="avatar-rx" aria-hidden="true">${rxDisplay(rx.emoji)}${rx.count > 1 ? `<span class="avatar-rx-n">×${rx.count}</span>` : ""}</span>`
        : "";
      const unread = hasUnread(uid);
      const showChat = chatUnreadOnly ? unread : hasChat(uid);
      const chatBadge = showChat
        ? `<span class="avatar-chat${!chatUnreadOnly && unread ? " is-unread" : ""}" aria-hidden="true" title="${chatUnreadOnly || unread ? "Unread message" : "Sent a message"}">${typeof ic === "function" ? ic("message") : ""}</span>`
        : "";
      const title = [
        nameOf(uid),
        rx?.emoji ? `${rx.emoji}${rx.count > 1 ? ` ×${rx.count}` : ""}` : "",
        showChat ? (chatUnreadOnly || unread ? "unread message" : "messaged") : "",
      ].filter(Boolean).join(" · ");
      return `<span class="avatar-sm" data-uid="${esc(uid)}" style="${avatarStyle(uid)}" title="${esc(title)}">${avatarFaceHtml(uid)}${badge}${chatBadge}</span>`;
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
function eventHostSummaryHTML(ev, chatters = null, unreadChatters = null) {
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
      if (conn && !PersonalSpace.isPersonal(conn)) return ` · added by ${esc(me.name || "you")}`;
      return "";
    })();
    return `<div class="event-host-summary event-pass-attribution" title="Shared by ${esc(name)} (unverified)">Shared by ${esc(name)}${added}${edited}</div>`;
  }
  const id = ev.createdBy;
  const name = eventOrganiserName(ev) || "Organiser";
  return `<div class="event-host-summary" title="Hosted by ${esc(name)}">${avatarStack([id], 1, (typeof eventReactionsMap === "function" ? eventReactionsMap(ev) : ev.reactions) || {}, chatters, unreadChatters)}</div>`;
}

/** Host avatar as the event-card gem (top-left of the detail hero). */
function eventCardHostGemHTML(ev) {
  if (!ev) return "";
  if (ev.passCreatorName || String(ev.createdBy || "").startsWith("pass:")) return "";
  const conn = (typeof ownerConnFor === "function" ? ownerConnFor(ev) : null)
    || (typeof activeConn === "function" ? activeConn() : null);
  const canChange = !!(ev.id
    && typeof canModerateEvents === "function"
    && canModerateEvents(conn)
    && conn
    && !(typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal?.(conn)));
  const empty = eventOrganiserEmpty(ev);
  const changeAttr = canChange
    ? ` role="button" tabindex="0" data-change-host="${esc(ev.id)}"`
    : "";
  if (empty) {
    const tip = canChange ? "Change host" : "Former organiser";
    return `<span class="ticket-stub-gem ticket-host-gem is-empty${canChange ? " is-tappable" : ""}"${changeAttr} title="${esc(tip)}" aria-label="${esc(tip)}"></span>`;
  }
  const id = String(ev.createdBy || "").trim();
  if (!id) return "";
  const name = eventOrganiserName(ev) || "Organiser";
  const face = typeof avatarFaceHtml === "function" ? avatarFaceHtml(id, name) : "";
  const style = typeof avatarStyle === "function" ? avatarStyle(id) : "";
  const tip = canChange ? `Change host (now ${name})` : `Hosted by ${name}`;
  // Face styles live on the gem itself (not a nested .avatar-sm) so profile
  // photos and initials size correctly inside the circle.
  return `<span class="ticket-stub-gem ticket-host-gem${canChange ? " is-tappable" : ""}" data-uid="${esc(id)}"${changeAttr} style="${style}" title="${esc(tip)}" aria-label="${esc(tip)}">${face}</span>`;
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
  for (const [uid, v] of Object.entries(reactionsVisible(
    (typeof eventReactionsMap === "function" ? eventReactionsMap(ev) : ev.reactions), conn))) {
    if (!rxParts(v).emoji || seen.has(uid)) continue;
    seen.add(uid);
    ids.push(uid);
  }
  return ids;
}

/** Plain host face for timeline rows — same avatar stack as attendees (no chip). */
function eventHostFaceHTML(ev, chatters = null, unreadChatters = null, rxMap = null, stackOpts = {}) {
  if (eventOrganiserEmpty(ev)) {
    return `<span class="event-host-face event-host-empty" title="Organiser left this server"><span class="avatar-sm avatar-empty" aria-label="Former organiser"></span></span>`;
  }
  if (ev.passCreatorName || String(ev.createdBy || "").startsWith("pass:")) {
    const name = ev.passCreatorName || eventOrganiserName(ev) || "Someone";
    return `<span class="event-host-face event-pass-attribution" title="Shared by ${esc(name)} (unverified)">Shared by ${esc(name)}</span>`;
  }
  const id = ev.createdBy;
  const name = eventOrganiserName(ev) || "Organiser";
  const map = rxMap
    || (typeof eventReactionsMap === "function" ? eventReactionsMap(ev) : ev.reactions)
    || {};
  return `<span class="event-host-face" title="Hosted by ${esc(name)}">${avatarStack([id], 1, map, chatters, unreadChatters, stackOpts)}</span>`;
}

/** Host (named) + registered faces for timeline tickets / meta cards.
 *  includeHost: show organiser chip. hostAfterAttendees: host follows going faces. */
function eventPeopleSummaryHTML(ev, max = 6, opts = {}) {
  const includeHost = opts.includeHost !== false;
  const hostAfter = !!opts.hostAfterAttendees;
  const chatters = typeof eventChatAuthorIds === "function" ? eventChatAuthorIds(ev) : null;
  const unreadChatters = typeof eventChatUnreadAuthorIds === "function" ? eventChatUnreadAuthorIds(ev) : null;
  const rxMap = opts.recentReactionOnly && typeof eventReactionsMapRecent === "function"
    ? eventReactionsMapRecent(ev)
    : ((typeof eventReactionsMap === "function" ? eventReactionsMap(ev) : ev.reactions) || {});
  const stackOpts = opts.chatUnreadOnly ? { chatUnreadOnly: true } : {};
  const host = includeHost
    ? (hostAfter ? eventHostFaceHTML(ev, chatters, unreadChatters, rxMap, stackOpts) : eventHostSummaryHTML(ev, chatters, unreadChatters))
    : "";
  const peopleIds = ticketSummaryPeople(ev);
  const faces = peopleIds.length ? avatarStack(peopleIds, max, rxMap, chatters, unreadChatters, stackOpts) : "";
  const going = faces ? `<div class="event-going-summary" title="Registered">${faces}</div>` : "";
  const sep = going && host && hostAfter
    ? `<span class="event-people-sep" aria-hidden="true">•</span>`
    : "";
  if (!host && !going) return "";
  return hostAfter
    ? `<div class="event-people-summary">${going}${sep}${host}</div>`
    : `<div class="event-people-summary">${host}${going}</div>`;
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

function eventRsvpListHTML(ids, ev, reactions, {
  canRemove = false, chatters = null, unreadChatters = null, chatUnreadOnly = false,
  confirmIds = null, canAssign = false,
} = {}) {
  if (!ids.length) return "";
  const stackOpts = chatUnreadOnly ? { chatUnreadOnly: true } : {};
  const confirmSet = confirmIds instanceof Set ? confirmIds : null;
  const groups = canAssign ? eventSignupGroups(ev) : [];
  return `<ul class="event-rsvp-list">${ids.map(uid => {
    const name = eventRsvpPersonName(uid, ev);
    const addedById = ev.addedBy?.[uid];
    const addedBy = addedById && addedById !== uid ? eventRsvpPersonName(addedById, ev) : "";
    const removeBtn = canRemove
      ? `<button type="button" class="event-rsvp-remove" data-uid="${esc(uid)}" title="Remove from event" aria-label="Remove ${esc(name)} from event">${typeof ic === "function" ? ic("trash") : "×"}</button>`
      : "";
    const confirmBtn = confirmSet && confirmSet.has(uid)
      ? `<button type="button" class="event-rsvp-confirm" data-confirm-rsvp="${esc(uid)}">Confirm</button>`
      : "";
    const assigned = eventGroupIdForUser(ev, uid);
    const assign = canAssign && groups.length
      ? `<select class="event-group-pick" data-assign-group="${esc(uid)}" aria-label="Group for ${esc(name)}">
          <option value="">Unassigned</option>
          ${groups.map(g => `<option value="${esc(g.id)}"${String(g.id) === String(assigned) ? " selected" : ""}>${esc(g.name || "Group")}</option>`).join("")}
        </select>`
      : "";
    return `<li class="event-rsvp-person" data-uid="${esc(uid)}">
      ${avatarStack([uid], 1, reactions, chatters, unreadChatters, stackOpts)}
      <span class="event-rsvp-person-meta">
        <span class="event-rsvp-person-name">${esc(name)}</span>
        ${addedBy ? `<span class="event-rsvp-person-added">added by ${esc(addedBy)}</span>` : ""}
      </span>
      ${assign}${confirmBtn}${removeBtn}
    </li>`;
  }).join("")}</ul>`;
}

function eventSignupGroupBlocks(ev) {
  const signup = eventSignupGroups(ev);
  const eligible = new Set(eventSignupEligibleIds(ev));
  const assigned = new Set();
  const named = signup.map((g) => {
    const ids = (g.memberIds || []).filter((id) => eligible.has(id));
    ids.forEach((id) => assigned.add(id));
    return { id: g.id, label: g.name || "Group", ids };
  });
  const unassigned = [...eligible].filter((id) => !assigned.has(id));
  return { named, unassigned };
}

function eventSignupExportTitle(ev) {
  return (typeof eventDisplayTitle === "function" && eventDisplayTitle(ev))
    || ev?._title || ev?.title || "Event";
}

function eventSignupExportWhen(ev) {
  if (typeof whenLabel === "function") return whenLabel(ev);
  if (typeof timelineTimeLabel === "function") return timelineTimeLabel(ev, true);
  if (ev?.when) {
    try { return new Date(ev.when).toLocaleString(); } catch {}
  }
  return "";
}

function eventSignupGroupsShareText(ev) {
  const { named, unassigned } = eventSignupGroupBlocks(ev);
  const lines = [eventSignupExportTitle(ev)];
  const when = eventSignupExportWhen(ev);
  if (when) lines.push(when);
  lines.push("");
  const emit = (label, ids) => {
    lines.push(label);
    if (!ids.length) lines.push("  (none)");
    else ids.forEach((id) => lines.push("  • " + eventRsvpPersonName(id, ev)));
    lines.push("");
  };
  named.forEach((g) => emit(g.label, g.ids));
  if (unassigned.length) emit("Unassigned", unassigned);
  return lines.join("\n").trim();
}

function renderSignupGroupsPng(ev) {
  const { named, unassigned } = eventSignupGroupBlocks(ev);
  const sections = named.map((g) => ({
    label: g.label,
    names: g.ids.map((id) => eventRsvpPersonName(id, ev)),
  }));
  if (unassigned.length) {
    sections.push({
      label: "Unassigned",
      names: unassigned.map((id) => eventRsvpPersonName(id, ev)),
    });
  }
  const title = eventSignupExportTitle(ev);
  const when = eventSignupExportWhen(ev);
  const W = 1080;
  const pad = 56;
  const cardPad = 28;
  const nameH = 40;
  let height = pad + 58 + (when ? 36 : 0) + 20;
  sections.forEach((s) => {
    height += cardPad + 40 + Math.max(1, s.names.length) * nameH + cardPad + 20;
  });
  height += 48;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = Math.max(640, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#F6F3EC";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let y = pad;
  ctx.fillStyle = "#1C1916";
  ctx.font = "700 48px Atkinson Hyperlegible, system-ui, sans-serif";
  ctx.textBaseline = "top";
  if (typeof wrapCanvasText === "function") {
    const n = wrapCanvasText(ctx, title, pad, y, W - pad * 2, 54, 3) || 1;
    y += n * 54 + 8;
  } else {
    ctx.fillText(title, pad, y);
    y += 58;
  }
  if (when) {
    ctx.fillStyle = "#6B645C";
    ctx.font = "500 28px Atkinson Hyperlegible, system-ui, sans-serif";
    ctx.fillText(when, pad, y);
    y += 44;
  } else {
    y += 12;
  }
  sections.forEach((s) => {
    const bodyH = Math.max(1, s.names.length) * nameH;
    const cardH = cardPad + 40 + bodyH + cardPad;
    ctx.fillStyle = "#FFFcf7";
    if (typeof cardShareRoundRect === "function") {
      cardShareRoundRect(ctx, pad, y, W - pad * 2, cardH, 24);
      ctx.fill();
    } else {
      ctx.fillRect(pad, y, W - pad * 2, cardH);
    }
    ctx.fillStyle = "#5B6EE8";
    ctx.font = "700 28px Atkinson Hyperlegible, system-ui, sans-serif";
    ctx.fillText(s.label, pad + cardPad, y + cardPad);
    ctx.fillStyle = "#1C1916";
    ctx.font = "500 26px Atkinson Hyperlegible, system-ui, sans-serif";
    if (!s.names.length) {
      ctx.fillStyle = "#8A837A";
      ctx.fillText("None yet", pad + cardPad, y + cardPad + 44);
    } else {
      s.names.forEach((name, i) => {
        ctx.fillText("•  " + name, pad + cardPad, y + cardPad + 44 + i * nameH);
      });
    }
    y += cardH + 20;
  });
  ctx.fillStyle = "#8A837A";
  ctx.font = "600 20px Atkinson Hyperlegible, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("Phlip", W - pad, canvas.height - 40);
  ctx.textAlign = "left";
  return canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
}

async function shareSignupGroupsText(ev) {
  const text = eventSignupGroupsShareText(ev);
  if (!text) {
    try { toast("No groups to export"); } catch {}
    return;
  }
  if (typeof sharePlainText === "function") {
    await sharePlainText(text, { copiedToast: "Groups copied" });
    return;
  }
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (e) {
      if (e?.name === "AbortError") return;
    }
  }
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); toast("Groups copied"); return; } catch {}
  }
  try { toast("Couldn't share that"); } catch {}
}

async function shareSignupGroupsImage(ev) {
  const png = renderSignupGroupsPng(ev);
  const caption = eventSignupGroupsShareText(ev);
  if (window.AshNative?.shareImage) {
    window.AshNative.shareImage(png, caption);
    return;
  }
  if (navigator.share) {
    try {
      const blob = await (await fetch(`data:image/png;base64,${png}`)).blob();
      const file = new File([blob], "groups.png", { type: "image/png" });
      const shareData = { text: caption, files: [file] };
      await navigator.share(!navigator.canShare || navigator.canShare(shareData) ? shareData : { text: caption });
      return;
    } catch (e) {
      if (e?.name === "AbortError") return;
    }
  }
  try {
    const a = document.createElement("a");
    a.href = `data:image/png;base64,${png}`;
    a.download = "groups.png";
    a.click();
    toast("Groups image saved");
  } catch {
    await shareSignupGroupsText(ev);
  }
}

function openSignupGroupExport(ev) {
  if (!ev || !eventSignupGroups(ev).length) {
    try { toast("Create groups first"); } catch {}
    return;
  }
  if (typeof AshModal === "undefined" || typeof AshModal.open !== "function") {
    void shareSignupGroupsText(ev);
    return;
  }
  const opened = AshModal.open({
    className: "ash-confirm-modal",
    attrs: { role: "dialog", "aria-modal": "true", "aria-labelledby": "signup-export-msg" },
    html: `
      <div class="modal-card ash-confirm-card">
        <p class="ash-confirm-msg" id="signup-export-msg">Export groups</p>
        <div class="actions">
          <span></span>
          <div>
            <button type="button" class="cancel" data-signup-export-as="text">Text</button>
            <button type="button" class="save" data-signup-export-as="image">Image</button>
          </div>
        </div>
      </div>`,
    singleton: "replace",
    closeOnEscape: true,
    closeOnBackdrop: true,
  });
  if (!opened) {
    void shareSignupGroupsText(ev);
    return;
  }
  const { overlay, close } = opened;
  overlay.querySelectorAll("[data-signup-export-as]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.dataset.signupExportAs;
      close();
      if (kind === "image") void shareSignupGroupsImage(ev);
      else void shareSignupGroupsText(ev);
    });
  });
}

/** Named attendance list. Confirm-attendance: Awaiting confirmation / Confirmed / collapsed Declined. */
function eventRsvpPeopleHTML(ev, {
  going, maybe, out, signedUp, reactions, canRemove = false, recentReactionOnly = false,
} = {}) {
  const confirm = eventConfirmAttendance(ev);
  const canManage = typeof canEditEvent === "function" && canEditEvent(ev);
  const rxMap = recentReactionOnly && typeof eventReactionsMapRecent === "function"
    ? eventReactionsMapRecent(ev)
    : (reactions || (typeof eventReactionsMap === "function" ? eventReactionsMap(ev) : ev.reactions) || {});
  const chatters = typeof eventChatAuthorIds === "function" ? eventChatAuthorIds(ev) : null;
  const unreadChatters = typeof eventChatUnreadAuthorIds === "function" ? eventChatUnreadAuthorIds(ev) : null;
  const pendingIds = confirm ? (signedUp || []) : [];
  const goingIds = going || [];
  const outIds = out || [];
  const confirmIds = canManage && confirm ? new Set(pendingIds) : null;
  const signup = eventSignupGroups(ev);
  const editing = canManage && signupGroupEditorOpen(ev);
  const view = (editing || (signup.length && signupAttendanceTab(ev) === "groups")) ? "groups" : "people";
  const canAssign = editing && signup.length > 0;
  const listOpts = { canRemove, chatters, unreadChatters, chatUnreadOnly: true };
  const section = (label, ids, extra = {}) => {
    if (!ids.length && !extra.keepEmpty) return "";
    const menu = extra.groupId && extra.canEditGroup
      ? `<button type="button" class="event-signup-group-menu" data-signup-group-menu="${esc(extra.groupId)}" aria-label="Group actions" aria-haspopup="menu">${typeof ic === "function" ? ic("more") : "⋮"}</button>`
      : "";
    const head = `<div class="event-rsvp-group-head"><b>${esc(label)} · ${ids.length}</b>${menu}</div>`;
    return `<section class="event-rsvp-group is-list">${head}${ids.length
      ? eventRsvpListHTML(ids, ev, rxMap, { ...listOpts, ...extra })
      : `<p class="tl-sheet-empty">No one yet.</p>`}</section>`;
  };
  let body = "";
  if (view === "groups") {
    const { named, unassigned } = eventSignupGroupBlocks(ev);
    const blocks = editing
      ? [...named.map((g) => ({ ...g, keepEmpty: true, canEditGroup: true })), { label: "Unassigned", ids: unassigned }]
      : [...named, { label: "Unassigned", ids: unassigned }].filter((g) => g.ids.length);
    body = blocks.length
      ? `<div class="event-signup-buckets">${blocks.map((g) => section(g.label, g.ids, {
          canRemove: false, canAssign, confirmIds: null, keepEmpty: !!g.keepEmpty,
          groupId: g.id, canEditGroup: !!g.canEditGroup,
        })).join("")}</div>`
      : `<p class="tl-sheet-empty">Add a group, then assign people.</p>`;
  } else {
    const declinedLabel = confirm ? "Declined" : "Can't";
    const pending = confirm ? section("Awaiting confirmation", pendingIds, { confirmIds }) : "";
    const accepted = section(confirm ? "Confirmed" : "Going", goingIds, { confirmIds: null });
    const declined = outIds.length
      ? `<details class="event-rsvp-declined">
          <summary>${esc(declinedLabel)} · ${outIds.length}</summary>
          ${eventRsvpListHTML(outIds, ev, rxMap, { ...listOpts, confirmIds: null, canAssign: false })}
        </details>`
      : "";
    body = pending + accepted + declined;
  }
  const switcher = signup.length
    ? `<div class="event-signup-switch" role="tablist" aria-label="Sign-ups view">
        <button type="button" role="tab" data-signup-tab="people" aria-selected="${view === "people" ? "true" : "false"}"${view === "people" ? ` class="on"` : ""}>People</button>
        <button type="button" role="tab" data-signup-tab="groups" aria-selected="${view === "groups" ? "true" : "false"}"${view === "groups" ? ` class="on"` : ""}>Groups</button>
      </div>`
    : "";
  let manage = "";
  if (canManage && editing) {
    manage = `<button type="button" class="event-signup-add-group" data-signup-group-add>Add group</button>
        <button type="button" class="event-signup-done" data-signup-group-done>Done</button>`;
  } else if (canManage && view === "groups" && signup.length) {
    manage = `<button type="button" class="event-signup-add-group" data-signup-group-open>Edit groups</button>`;
  } else if (canManage && !signup.length) {
    manage = `<button type="button" class="event-signup-add-group" data-signup-group-open>Create groups</button>`;
  }
  const overflow = signup.length
    ? `<button type="button" class="event-signup-more" data-signup-overflow aria-label="More" aria-haspopup="menu">${typeof ic === "function" ? ic("more") : "⋮"}</button>`
    : "";
  const actions = (manage || overflow)
    ? `<div class="event-signup-actions">${manage}${overflow}</div>`
    : "";
  const tools = (switcher || actions)
    ? `<div class="event-signup-tools">${switcher}${actions}</div>`
    : "";
  if (!pendingIds.length && !goingIds.length && !outIds.length && !tools && view !== "groups") return "";
  const empty = view === "people" && !pendingIds.length && !goingIds.length && !outIds.length
    ? `<p class="tl-sheet-empty">No one has signed up yet.</p>`
    : "";
  return `<div class="event-rsvp-people${editing ? " is-group-editor" : ""}${view === "groups" ? " is-groups" : ""}" data-mode="list" data-event-id="${esc(ev?.id || "")}">${tools}${body || empty}</div>`;
}

function closeSignupOverflowMenu() {
  const menu = document.getElementById("tl-quick-menu");
  const backdrop = document.getElementById("tl-quick-backdrop");
  if (menu) {
    menu.hidden = true;
    delete menu.dataset.eventId;
    delete menu.dataset.signupGroupId;
  }
  if (backdrop) backdrop.hidden = true;
}

function ensureSignupQuickMenu() {
  if (typeof conversationEnsureQuickMenu === "function") conversationEnsureQuickMenu();
  else if (typeof timelineWireQuickBackdrop === "function") {
    try { timelineWireQuickBackdrop(); } catch {}
  }
  return {
    menu: document.getElementById("tl-quick-menu"),
    backdrop: document.getElementById("tl-quick-backdrop"),
  };
}

function placeSignupQuickMenu(menu, backdrop, anchor) {
  if (anchor) {
    const rect = anchor.getBoundingClientRect();
    menu.style.top = `${Math.min(innerHeight - 200, Math.max(12, rect.bottom + 6))}px`;
    menu.style.right = `${Math.max(12, innerWidth - rect.right)}px`;
  }
  backdrop.hidden = false;
  menu.hidden = false;
}

function openSignupOverflowMenu(ev, anchor) {
  if (!ev) return;
  const { menu, backdrop } = ensureSignupQuickMenu();
  if (!menu || !backdrop) {
    openSignupGroupExport(ev);
    return;
  }
  menu.innerHTML = `<button type="button" data-signup-group-export>Export</button>`;
  menu.dataset.eventId = ev.id || "";
  delete menu.dataset.signupGroupId;
  placeSignupQuickMenu(menu, backdrop, anchor);
}

function openSignupGroupMenu(ev, groupId, anchor) {
  if (!ev || !groupId) return;
  const { menu, backdrop } = ensureSignupQuickMenu();
  if (!menu || !backdrop) return;
  const pencil = typeof ic === "function" ? ic("pencil", "ico-inline") : "";
  const trash = typeof ic === "function" ? ic("trash", "ico-inline") : "";
  menu.innerHTML = `<button type="button" data-signup-group-rename="${esc(groupId)}">${pencil}<span>Rename</span></button>
    <button type="button" class="danger" data-signup-group-del="${esc(groupId)}">${trash}<span>Delete</span></button>`;
  menu.dataset.eventId = ev.id || "";
  menu.dataset.signupGroupId = groupId;
  placeSignupQuickMenu(menu, backdrop, anchor);
}

function attendanceEventFromAction(el) {
  return findAttendanceEvent(
    el?.closest("[data-event-id]")?.dataset.eventId
    || document.getElementById("tl-quick-menu")?.dataset.eventId
    || document.querySelector(".event-rsvp-people")?.dataset.eventId
  );
}

function findAttendanceEvent(eventId) {
  if (!eventId) return null;
  if (typeof ownerConnOf === "function") {
    const owner = ownerConnOf(eventId);
    const hit = (owner?.events || []).find(e => e.id === eventId);
    if (hit) return hit;
  }
  const conn = typeof activeConn === "function" ? activeConn() : null;
  return (conn?.events || []).find(e => e.id === eventId)
    || (typeof group === "function" ? (group()?.events || []).find(e => e.id === eventId) : null)
    || null;
}

function sendSignupGroups(ev) {
  if (!ev?.id) return;
  const owner = (typeof ownerConnFor === "function" ? ownerConnFor(ev) : null)
    || (typeof activeConn === "function" ? activeConn() : null);
  const groups = eventSignupGroups(ev).map(g => ({
    id: g.id,
    name: g.name || "Group",
    memberIds: [...(g.memberIds || [])],
  }));
  send({ type: "setEventSignupGroups", eventId: ev.id, signupGroups: groups }, owner?.id);
}


function refreshEventAttendanceUI(ev) {
  if (!ev) return;
  try {
    if (typeof conversationRefreshEventPanel === "function") {
      const panel = document.getElementById("conv-event-panel");
      const threadId = typeof S !== "undefined" ? S.conversationsThread?.eventId : "";
      if (panel && (!threadId || threadId === ev.id)) conversationRefreshEventPanel(ev);
    }
  } catch {}
  try {
    if (typeof timelinePatchOpenSheet === "function"
        && typeof timelineSheetEventId !== "undefined"
        && timelineSheetEventId === ev.id) {
      timelinePatchOpenSheet();
    }
  } catch {}
}

function bindEventAttendanceActions() {
  if (typeof onceFlag === "function" && !onceFlag(document, "eventAttendanceActions")) return;
  if (document._eventAttendanceBound) return;
  document._eventAttendanceBound = true;
  document.addEventListener("click", (e) => {
    const tabBtn = e.target.closest("[data-signup-tab]");
    if (tabBtn) {
      const ev = findAttendanceEvent(tabBtn.closest("[data-event-id]")?.dataset.eventId);
      if (!ev) return;
      e.preventDefault();
      const tab = tabBtn.dataset.signupTab === "groups" ? "groups" : "people";
      setSignupAttendanceTab(ev, tab);
      if (tab === "people") setSignupGroupEditor(ev, false);
      if (typeof refreshEventAttendanceUI === "function") refreshEventAttendanceUI(ev);
      else if (typeof renderView === "function") renderView();
      return;
    }
    const overflow = e.target.closest("[data-signup-overflow]");
    if (overflow) {
      const ev = attendanceEventFromAction(overflow);
      if (!ev) return;
      e.preventDefault();
      openSignupOverflowMenu(ev, overflow);
      return;
    }
    const groupMenu = e.target.closest("[data-signup-group-menu]");
    if (groupMenu) {
      const ev = attendanceEventFromAction(groupMenu);
      if (!ev) return;
      e.preventDefault();
      openSignupGroupMenu(ev, groupMenu.dataset.signupGroupMenu, groupMenu);
      return;
    }
    const done = e.target.closest("[data-signup-group-done]");
    if (done) {
      const ev = findAttendanceEvent(done.closest("[data-event-id]")?.dataset.eventId);
      if (!ev) return;
      e.preventDefault();
      setSignupGroupEditor(ev, false);
      setSignupAttendanceTab(ev, "groups");
      if (typeof refreshEventAttendanceUI === "function") refreshEventAttendanceUI(ev);
      else if (typeof renderView === "function") renderView();
      return;
    }
    const open = e.target.closest("[data-signup-group-open]");
    if (open) {
      const ev = findAttendanceEvent(open.closest("[data-event-id]")?.dataset.eventId);
      if (!ev || typeof canEditEvent !== "function" || !canEditEvent(ev)) return;
      e.preventDefault();
      setSignupAttendanceTab(ev, "groups");
      setSignupGroupEditor(ev, true);
      if (!eventSignupGroups(ev).length) {
        const id = typeof genLocalId === "function" ? genLocalId() : `g${Date.now()}`;
        ev.signupGroups = [{ id, name: nextSignupGroupName(ev), memberIds: [] }];
        sendSignupGroups(ev);
      }
      if (typeof refreshEventAttendanceUI === "function") refreshEventAttendanceUI(ev);
      else if (typeof renderView === "function") renderView();
      return;
    }
    const add = e.target.closest("[data-signup-group-add]");
    if (add) {
      const root = add.closest("[data-event-id]");
      const ev = findAttendanceEvent(root?.dataset.eventId);
      if (!ev || typeof canEditEvent !== "function" || !canEditEvent(ev)) return;
      e.preventDefault();
      const id = typeof genLocalId === "function" ? genLocalId() : `g${Date.now()}`;
      setSignupAttendanceTab(ev, "groups");
      setSignupGroupEditor(ev, true);
      ev.signupGroups = [...eventSignupGroups(ev), { id, name: nextSignupGroupName(ev), memberIds: [] }];
      sendSignupGroups(ev);
      if (typeof refreshEventAttendanceUI === "function") refreshEventAttendanceUI(ev);
      else if (typeof renderView === "function") renderView();
      return;
    }
    const del = e.target.closest("[data-signup-group-del]");
    if (del) {
      const ev = attendanceEventFromAction(del);
      if (!ev || typeof canEditEvent !== "function" || !canEditEvent(ev)) return;
      e.preventDefault();
      closeSignupOverflowMenu();
      ev.signupGroups = eventSignupGroups(ev).filter(g => g.id !== del.dataset.signupGroupDel);
      sendSignupGroups(ev);
      if (typeof refreshEventAttendanceUI === "function") refreshEventAttendanceUI(ev);
      else if (typeof renderView === "function") renderView();
      return;
    }
    const rename = e.target.closest("[data-signup-group-rename]");
    if (rename) {
      const ev = attendanceEventFromAction(rename);
      if (!ev || typeof canEditEvent !== "function" || !canEditEvent(ev)) return;
      e.preventDefault();
      const group = eventSignupGroups(ev).find(g => g.id === rename.dataset.signupGroupRename);
      if (!group) return;
      closeSignupOverflowMenu();
      void (async () => {
        const next = typeof ashPrompt === "function"
          ? await ashPrompt("Group name", { value: group.name || "", maxlength: 40, ok: "Save" })
          : (typeof prompt === "function" ? prompt("Group name", group.name || "") : null);
        if (next == null) return;
        const name = String(next).trim().slice(0, 40);
        if (!name) return;
        group.name = name;
        sendSignupGroups(ev);
        if (typeof refreshEventAttendanceUI === "function") refreshEventAttendanceUI(ev);
        else if (typeof renderView === "function") renderView();
      })();
      return;
    }
    const exportBtn = e.target.closest("[data-signup-group-export]");
    if (exportBtn) {
      const ev = attendanceEventFromAction(exportBtn);
      if (!ev) return;
      e.preventDefault();
      closeSignupOverflowMenu();
      openSignupGroupExport(ev);
      return;
    }
    const confirmBtn = e.target.closest("[data-confirm-rsvp]");
    if (confirmBtn) {
      const ev = findAttendanceEvent(confirmBtn.closest("[data-event-id]")?.dataset.eventId);
      const uid = confirmBtn.dataset.confirmRsvp;
      if (!ev || !uid || typeof setMemberRsvp !== "function") return;
      e.preventDefault();
      setMemberRsvp(ev.id, uid, "going");
      return;
    }
  });
  document.addEventListener("change", (e) => {
    const pick = e.target.closest("[data-assign-group]");
    if (!pick) return;
    const ev = findAttendanceEvent(pick.closest("[data-event-id]")?.dataset.eventId);
    const uid = pick.dataset.assignGroup;
    if (!ev || !uid || typeof canEditEvent !== "function" || !canEditEvent(ev)) return;
    const groupId = String(pick.value || "").trim();
    const owner = (typeof ownerConnFor === "function" ? ownerConnFor(ev) : null)
      || (typeof activeConn === "function" ? activeConn() : null);
    eventSignupGroups(ev).forEach((g) => {
      g.memberIds = (g.memberIds || []).filter(id => id !== uid);
    });
    if (groupId) {
      const group = eventSignupGroups(ev).find(g => g.id === groupId);
      if (group && !(group.memberIds || []).includes(uid)) {
        (group.memberIds ||= []).push(uid);
      }
    }
    send({ type: "assignEventGroup", eventId: ev.id, userId: uid, groupId }, owner?.id);
    if (typeof refreshEventAttendanceUI === "function") refreshEventAttendanceUI(ev);
  });
}

try { bindEventAttendanceActions(); } catch {}

// Back-compat alias: render code still calls group() to get the on-screen
// board ({channels, events}). Servers no longer have a group layer.
const group = board;

// True when the main timeline board is showing (collated Events or a single
// event channel) — used to decide whether to refresh/focus after createEvent.
function viewingEventsBoard() {
  if (S.activeView?.kind === "events") return true;
  if (S.activeView?.kind !== "channel") return false;
  const ch = group()?.channels.find(c => c.id === S.activeView.id);
  return ch?.kind === "event";
}

/** People / shared-history screens that actually display the roster. */
function viewingRosterView() {
  const kind = S.activeView?.kind;
  return kind === "members" || kind === "sharedHistory";
}

// Live event pushes (create / RSVP / react / edit) must refresh both the
// Events board and any open event-channel timeline — not only kind==="events".
function shouldRefreshEventUI(eventId) {
  const kind = S.activeView?.kind;
  if (viewingEventsBoard() || viewingEvent(eventId) || kind === "live") return true;
  if (eventId && S.conversationsThread?.eventId === eventId) return true;
  if (eventId && typeof timelineSheetEventId !== "undefined" && timelineSheetEventId === eventId) return true;
  return false;
}

/** Whether a share-state change should re-render the current view. */
function shouldRefreshShareUI(conn, kind, refId) {
  if (S.activeView?.kind === "live") return true;
  if (S.activeConnId === "personal" && viewingEventsBoard()) return true;
  if (conn && conn.id !== S.activeConnId && S.activeConnId !== "personal") return false;
  if (kind === "event" && refId) return shouldRefreshEventUI(refId);
  return viewingEventsBoard();
}

/**
 * In-app confirm dialog matching modal-card styling (replaces window.confirm /
 * native Android AlertDialog). Resolves true for Confirm, false for Cancel.
 * @param {string} message
 * @param {{ ok?: string, cancel?: string, danger?: boolean }} [opts]
 * @returns {Promise<boolean>}
 */
function ashConfirm(message, opts = {}) {
  const okLabel = opts.ok || "Confirm";
  const cancelLabel = opts.cancel || "Cancel";
  const danger = !!opts.danger;
  return new Promise((resolve) => {
    let settled = false;
    const opened = AshModal.open({
      className: "ash-confirm-modal",
      attrs: {
        role: "alertdialog",
        "aria-modal": "true",
        "aria-labelledby": "ash-confirm-msg",
      },
      html: `
      <div class="modal-card ash-confirm-card">
        <p class="ash-confirm-msg" id="ash-confirm-msg">${esc(message)}</p>
        <div class="actions">
          <span></span>
          <div>
            <button type="button" class="cancel" id="ash-confirm-cancel">${esc(cancelLabel)}</button>
            <button type="button" class="save${danger ? " danger" : ""}" id="ash-confirm-ok">${esc(okLabel)}</button>
          </div>
        </div>
      </div>`,
      singleton: "replace",
      closeOnEscape: true,
      closeOnBackdrop: !danger,
      onClose: () => {
        if (settled) return;
        settled = true;
        resolve(false);
      },
    });
    if (!opened) { resolve(false); return; }
    const { overlay, close } = opened;
    const done = (v) => {
      if (settled) return;
      settled = true;
      close();
      resolve(v);
    };
    overlay.querySelector("#ash-confirm-cancel").onclick = () => done(false);
    overlay.querySelector("#ash-confirm-ok").onclick = () => done(true);
    requestAnimationFrame(() => overlay.querySelector("#ash-confirm-cancel")?.focus());
  });
}

/**
 * In-app prompt dialog (text input). Resolves the trimmed string, or null on cancel.
 * @param {string} message
 * @param {{ ok?: string, cancel?: string, placeholder?: string, value?: string, maxlength?: number }} [opts]
 * @returns {Promise<string|null>}
 */
function ashPrompt(message, opts = {}) {
  const okLabel = opts.ok || "OK";
  const cancelLabel = opts.cancel || "Cancel";
  const maxlength = Math.max(1, Number(opts.maxlength) || 24);
  const inputType = opts.password || opts.type === "password" ? "password" : "text";
  const autocomplete = opts.password || opts.type === "password" ? "new-password" : "off";
  return new Promise((resolve) => {
    let settled = false;
    const opened = AshModal.open({
      className: "ash-prompt-modal",
      attrs: { role: "dialog", "aria-modal": "true" },
      html: `
      <div class="modal-card ash-confirm-card">
        <p class="ash-confirm-msg">${esc(message)}</p>
        <div class="field">
          <input id="ash-prompt-input" type="${inputType}" maxlength="${maxlength}"
            placeholder="${esc(opts.placeholder || "")}" value="${esc(opts.value || "")}" autocomplete="${autocomplete}">
        </div>
        <div class="actions">
          <span></span>
          <div>
            <button type="button" class="cancel" id="ash-prompt-cancel">${esc(cancelLabel)}</button>
            <button type="button" class="save" id="ash-prompt-ok">${esc(okLabel)}</button>
          </div>
        </div>
      </div>`,
      singleton: "replace",
      onClose: () => {
        if (settled) return;
        settled = true;
        resolve(null);
      },
    });
    if (!opened) { resolve(null); return; }
    const { overlay, close } = opened;
    const inp = overlay.querySelector("#ash-prompt-input");
    const done = (v) => {
      if (settled) return;
      settled = true;
      close();
      resolve(v);
    };
    overlay.querySelector("#ash-prompt-cancel").onclick = () => done(null);
    overlay.querySelector("#ash-prompt-ok").onclick = () => {
      const raw = String(inp?.value || "");
      done(inputType === "password" ? (raw || null) : (raw.trim() || null));
    };
    inp?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const raw = String(inp.value || "");
        done(inputType === "password" ? (raw || null) : (raw.trim() || null));
      }
    });
    requestAnimationFrame(() => {
      inp?.focus();
      if (inputType !== "password") inp?.select?.();
    });
  });
}

/**
 * 016 collision ceremony — suggest surname initial, then free rename.
 * @param {string} takenName
 * @returns {Promise<string|null>} next name to try, or null if cancelled
 */
async function promptNameCollision(takenName) {
  const base = String(takenName || "").trim().slice(0, 24);
  if (!base) return null;
  const addInitial = await ashConfirm(
    `Someone here is already ${base}. Add an initial?`,
    { ok: "Add initial", cancel: "Choose another" },
  );
  if (addInitial) {
    const letter = await ashPrompt(`Add one letter after ${base}`, {
      placeholder: "M",
      maxlength: 1,
      ok: "Try again",
    });
    if (!letter) return null;
    const init = String(letter).trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
    if (!init) return null;
    return `${base} ${init}`.slice(0, 24);
  }
  const free = await ashPrompt("Choose a different name", {
    placeholder: base,
    maxlength: 24,
    ok: "Use this name",
  });
  return free ? String(free).trim().slice(0, 24) : null;
}
