/* channel-form-components.js — availability persist, welcome, chat-import field helpers.
 * Globals out: persistChannelAllowAvailability, channelWelcomeFieldHTML, wireChannelWelcome, …
 * Load after: channel-access.js / channel-linked-feeds.js
 */

/** Persist allowAvailability from the timeline settings popup. */
function persistChannelAllowAvailability(channel, on) {
  if (!channel?.id || channel.kind !== "event") return false;
  if (channel.pinnedLocationLabel != null || channel.pinnedUserId != null) return false;
  channel.allowAvailability = !!on;
  send({
    type: "updateChannel",
    channelId: channel.id,
    name: channel.name || "",
    allowAvailability: !!on,
    enabledCardIds: channel.enabledCardIds || null,
    enabledCategoryIds: channel.enabledCategoryIds || null,
    enabledLocations: channel.enabledLocations || null,
    linkedChatChannelId: channel.linkedChatChannelId || null,
    mirrorActivity: !!channel.mirrorActivity,
    rolePerms: channel.rolePerms || null,
    allowedUserIds: null,
    autoIncludeNewMembers: false,
  });
  toast(on ? "Open availability marks on" : "Open availability marks off");
  return true;
}

/** Hosted chat only — one channel posts a join note when a new member is approved. */
function channelWelcomeFieldHTML(existing, { personal = false, isNew = false, hidden = false } = {}) {
  if (personal) return "";
  if (!isNew && existing?.kind !== "chat") return "";
  const on = !!existing?.welcomeChannel;
  return `<div class="field" id="ch-welcome-field"${hidden ? ' style="display:none"' : ""}>
      <label>Welcome</label>
      <label class="check-row">
        <input type="checkbox" id="ch-welcome-channel" ${on ? "checked" : ""}>
        Make this a welcome channel
      </label>
      <p class="ch-scope-summary" style="margin-top:6px">When someone is approved to join this server, a note is posted here. Only one chat can be the welcome channel.</p>
    </div>`;
}

function wireChannelWelcome(root, existing, persistExisting) {
  const cb = root?.querySelector?.("#ch-welcome-channel");
  if (!cb) return;
  cb.onchange = () => {
    const on = !!cb.checked;
    if (existing) existing.welcomeChannel = on;
    if (on) {
      const skipId = existing?.id;
      for (const c of (typeof activeConn === "function" ? activeConn()?.channels : null) || []) {
        if (c.kind === "chat" && c.id !== skipId) c.welcomeChannel = false;
      }
    }
    if (typeof persistExisting === "function") persistExisting({ close: false });
    if (existing?.id) toast(on ? "Welcome channel on" : "Welcome channel off");
  };
}

/** Event channels that mirror their chat into the given chat channel. */
function eventChannelsImportingInto(chatId, conn = activeConn()) {
  const id = String(chatId || "").trim();
  if (!id || !conn) return [];
  return (conn.channels || []).filter(c => c.kind === "event" && c.linkedChatChannelId === id);
}

/**
 * Set or clear an event channel’s chat-import link (storage stays on the event).
 * @param {object} eventCh
 * @param {string|null} chatIdOrNull
 * @param {boolean} [mirrorActivity]
 */
function setEventChatImport(eventCh, chatIdOrNull, mirrorActivity = false) {
  if (!eventCh?.id || eventCh.kind !== "event") return false;
  const conn = activeConn();
  if (!conn) return false;
  const chatId = chatIdOrNull
    && (conn.channels || []).some(c => c.id === chatIdOrNull && c.kind === "chat")
    ? chatIdOrNull
    : null;
  const mirror = !!(chatId && mirrorActivity);
  eventCh.linkedChatChannelId = chatId;
  eventCh.mirrorActivity = mirror;
  send({
    type: "updateChannel",
    channelId: eventCh.id,
    name: eventCh.name,
    linkedChatChannelId: chatId,
    mirrorActivity: mirror,
    enabledCardIds: eventCh.enabledCardIds ?? null,
    enabledCategoryIds: eventCh.enabledCategoryIds ?? null,
    enabledLocations: eventCh.enabledLocations ?? null,
  });
  return true;
}

function chatImportEventsFieldHTML(chatCh, personal) {
  if (personal) {
    const summary = typeof linkedChatMirrorsSummaryText === "function"
      ? linkedChatMirrorsSummaryText(chatCh.id)
      : "None — only this chat’s messages";
    return `<div class="field" id="ch-import-events-field">
      <label>Mirror chat from other servers</label>
      <div class="ch-scope-actions">
        <button type="button" class="ch-manage-btn" id="ch-manage-chat-mirrors">Choose chats…</button>
      </div>
      <p class="ch-scope-summary" id="ch-import-events-summary">${esc(summary)}</p>
      <p class="ch-scope-summary" style="margin-top:6px">Pull messages from chats on servers you’ve joined into this personal chat. Stored on this device only.</p>
    </div>`;
  }
  const events = (board().channels || []).filter(c =>
    c.kind === "event"
    && !(typeof PersonalSpace !== "undefined" && PersonalSpace.isHiddenChannel(c, board())));
  if (!events.length) {
    return `<div class="field" id="ch-import-events-field">
      <label>Mirror event channel chat into this chat</label>
      <p class="ch-scope-summary" id="ch-import-events-summary">No event chats mirrored</p>
      <p class="ch-scope-summary" style="margin-top:6px">Create an event group first, then mirror its chat here.</p>
    </div>`;
  }
  const linked = events.filter(c => c.linkedChatChannelId === chatCh.id);
  const anyMirror = linked.some(c => c.mirrorActivity);
  const rows = events.map(c => {
    const on = c.linkedChatChannelId === chatCh.id;
    return `<label class="check-row ch-import-event-row">
      <input type="checkbox" class="ch-import-event" value="${esc(c.id)}" ${on ? "checked" : ""}>
      ${esc(c.name || "Event group")}
    </label>`;
  }).join("");
  const summary = linked.length
    ? `${linked.length} event chat${linked.length === 1 ? "" : "s"} mirrored`
    : "No event chats mirrored";
  return `<div class="field" id="ch-import-events-field">
    <label>Mirror event channel chat into this chat</label>
    <div class="ch-import-events-list" id="ch-import-events-list">${rows}</div>
    <p class="ch-scope-summary" id="ch-import-events-summary">${esc(summary)}</p>
    <label class="check-row" id="ch-import-mirror-activity-row" style="margin-top:10px;opacity:${linked.length ? "1" : "0.55"}">
      <input type="checkbox" id="ch-import-mirror-activity" ${anyMirror ? "checked" : ""} ${linked.length ? "" : "disabled"}>
      Include log posts
    </label>
    <p class="ch-scope-summary" style="margin-top:6px">RSVP, add-person, and time-change entries. Off by default to keep chat quieter.</p>
  </div>`;
}

function wireChatImportEventsField(root, chatCh, personal) {
  const field = root.querySelector("#ch-import-events-field");
  if (!field || !chatCh?.id) return;

  if (personal) {
    const summary = root.querySelector("#ch-import-events-summary");
    const paintSummary = () => {
      if (summary && typeof linkedChatMirrorsSummaryText === "function") {
        summary.textContent = linkedChatMirrorsSummaryText(chatCh.id);
      }
    };
    root.querySelector("#ch-manage-chat-mirrors")?.addEventListener("click", () => {
      openLinkedChatMirrorsModal(chatCh.id, chatCh.name, paintSummary);
    });
    paintSummary();
    return;
  }

  const list = root.querySelector("#ch-import-events-list");
  const summary = root.querySelector("#ch-import-events-summary");
  const mirrorRow = root.querySelector("#ch-import-mirror-activity-row");
  const mirrorCb = root.querySelector("#ch-import-mirror-activity");
  const conn = () => activeConn();

  const paintSummary = () => {
    const linked = eventChannelsImportingInto(chatCh.id, conn());
    if (summary) {
      summary.textContent = linked.length
        ? `${linked.length} event chat${linked.length === 1 ? "" : "s"} mirrored`
        : "No event chats mirrored";
    }
    if (mirrorCb) {
      mirrorCb.disabled = !linked.length;
      if (!linked.length) mirrorCb.checked = false;
      else if (!mirrorCb.checked) mirrorCb.checked = linked.some(c => c.mirrorActivity);
    }
    if (mirrorRow) mirrorRow.style.opacity = linked.length ? "1" : "0.55";
  };

  list?.addEventListener("change", (e) => {
    const inp = e.target.closest("input.ch-import-event");
    if (!inp) return;
    const ech = (conn()?.channels || []).find(c => c.id === inp.value && c.kind === "event");
    if (!ech) return;
    const include = !!mirrorCb?.checked;
    if (inp.checked) setEventChatImport(ech, chatCh.id, include);
    else setEventChatImport(ech, null, false);
    paintSummary();
    try { if (typeof renderView === "function") renderView(); } catch {}
  });

  mirrorCb?.addEventListener("change", () => {
    const include = !!mirrorCb.checked;
    for (const ech of eventChannelsImportingInto(chatCh.id, conn())) {
      setEventChatImport(ech, chatCh.id, include);
    }
    paintSummary();
    try { if (typeof renderView === "function") renderView(); } catch {}
  });

  paintSummary();
}

