/* channel-chat-part3.js — split from channel-chat.js (Part 3 size ceiling).
 * Load after: channel-chat-part2.js; part of channel-chat cluster.
 */

function eventDetailNoteKind(n) {
  if (!n || n.activity) return null;
  if (n.noteKind === "personal") return "personal";
  if (n.noteKind === "shared" || n.pinned) return "shared";
  return "chat"; // freeform event note (legacy chat-via-notes)
}

function eventDetailChatMessages(ev, owner) {
  const ch = (owner?.channels || []).find(c => c.id === ev.channelId)
    || (owner?.channels || []).find(c => c.kind === "event")
    || null;
  const chId = ch?.id || ev.channelId;
  const raw = chId ? (owner.messages?.[chId] || []) : [];
  let scoped = typeof messagesInEventScope === "function"
    ? messagesInEventScope(raw, ev.id)
    : raw.filter(m => m.eventId === ev.id
      || (Array.isArray(m.mentionedEventIds) && m.mentionedEventIds.includes(ev.id)));
  // Archived Memories snapshot when live channel messages are gone.
  if (!scoped.length && Array.isArray(ev._chatMessages) && ev._chatMessages.length) {
    scoped = ev._chatMessages.map(m => ({ ...m }));
  }
  // Merge event notes into the thread (shared/pinned only; personal notes removed).
  for (const n of (ev.notes || [])) {
    if (n.activity) continue;
    const kind = eventDetailNoteKind(n);
    if (kind === "personal") continue;
    const dup = scoped.some(m =>
      (n.id && m.id === n.id)
      || (m.userId === n.userId && m.ts === n.ts));
    if (dup) {
      // Promote an existing channel row if it was pinned as a shared note.
      const hit = scoped.find(m =>
        (n.id && m.id === n.id) || (m.userId === n.userId && m.ts === n.ts));
      if (hit && kind === "shared") hit._noteKind = kind;
      continue;
    }
    scoped = scoped.concat([{
      id: n.id || `note-${n.ts}`,
      userId: n.userId,
      name: n.name,
      text: n.text,
      _text: n._text,
      ts: n.ts,
      eventId: ev.id,
      _fromEventNote: true,
      _noteKind: kind === "chat" ? null : kind,
      noteId: n.id,
    }]);
  }
  return scoped.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
}

function eventDetailChatMsgHTML(m, ev, opts = {}) {
  const who = m.name || "?";
  const bodyRaw = typeof shownField === "function"
    ? shownField(m._text, m.text)
    : shown(m._text || m.text || "");
  const title = eventDisplayTitle(ev) || "";
  const kind = m._noteKind || null;
  const isShared = kind === "shared";
  const isPersonal = kind === "personal";
  const realChat = !!(m.id && !m.activity && !m._fromEventNote && !isShared && !isPersonal);
  const planOpts = { event: ev || null, now: Number(m.ts) || Date.now() };
  let body = realChat && typeof chatPlanPromoteHTML === "function"
    ? chatPlanPromoteHTML(bodyRaw, planOpts)
    : (typeof escLinkify === "function" ? escLinkify(bodyRaw) : esc(bodyRaw));
  if (!isPersonal && title && title.length >= 2) {
    try {
      const re = new RegExp(`\\b${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
      body = body.replace(re, (match, offset, str) => {
        const before = str.slice(0, offset);
        if (before.lastIndexOf("<") > before.lastIndexOf(">")) return match;
        return `<span class="edc-ment">${match}</span>`;
      });
    } catch { /* keep plain */ }
  }
  if (isPersonal && (m._text == null) && m.text) {
    body = `<em class="edc-locked">Can't open on this device</em>`;
  }
  const badge = isShared
    ? `<span class="edc-tag edc-tag-note">Pinned</span>`
    : isPersonal
      ? `<span class="edc-tag edc-tag-personal">${typeof ic === "function" ? ic("lock", "ico-inline") : ""} Only you</span>`
      : "";
  const cls = "edc-msg"
    + (isShared ? " is-note" : "")
    + (isPersonal ? " is-personal" : "");
  const planText = realChat ? bodyRaw : "";
  const planCls = realChat && typeof chatPlanCandidateClass === "function" ? chatPlanCandidateClass(planText, planOpts) : "";
  const canPin = !!(opts.canPin && !isShared && !isPersonal && !m._fromEventNote);
  const pin = canPin
    ? `<button type="button" class="edc-pin" data-msg-id="${esc(m.id || "")}" data-msg-ts="${esc(String(m.ts || ""))}" data-msg-user="${esc(m.userId || "")}" title="Pin" aria-label="Pin">${typeof ic === "function" ? ic("pin", "ico-inline") : "📌"}</button>`
    : "";
  const owner = opts.owner
    || (typeof timelineEventOwner === "function" ? timelineEventOwner(ev) : null)
    || (typeof ownerConnFor === "function" ? ownerConnFor(ev) : null)
    || (typeof activeConn === "function" ? activeConn() : null);
  const thread = (typeof eventDetailChatMessages === "function")
    ? eventDetailChatMessages(ev, owner)
    : [];
  const quote = realChat && typeof chatReplyQuoteHTML === "function"
    ? chatReplyQuoteHTML(m, thread)
    : "";
  const chips = realChat && typeof chatReactionChipsHTML === "function"
    ? chatReactionChipsHTML(m, {
      mine: owner?.me?.id || S.me?.id,
      interactive: typeof canMutateContent === "function" && canMutateContent(owner),
    })
    : "";
  return `<div class="${cls}${planCls}" data-msg-id="${esc(m.id || "")}" data-msg-ts="${esc(String(m.ts || ""))}" data-msg-user="${esc(m.userId || "")}" data-real-chat="${realChat ? "1" : "0"}"${m.taskId ? ` data-task-id="${esc(m.taskId)}"` : ""}">
    <span class="edc-av" style="${typeof avatarStyle === "function" ? avatarStyle(m.userId) : ""}">${typeof avatarFaceHtml === "function" ? avatarFaceHtml(m.userId, who) : esc((who.trim()[0] || "?").toUpperCase())}</span>
    <div class="edc-body">
      <div class="edc-meta"><span class="edc-who"${typeof roleNameStyle === "function" && roleNameStyle(m.userId) ? ` style="${roleNameStyle(m.userId)}"` : ""}>${esc(who)}</span>${badge}<span class="edc-when">${typeof fmtTime === "function" ? fmtTime(m.ts) : ""}</span>${pin}</div>
      ${quote}
      ${m.taskId && typeof chatTaskCardHTML === "function"
        ? chatTaskCardHTML(m, owner)
        : `<div class="edc-text">${body}</div>`}
      ${chips}
    </div>
  </div>`;
}

/** Split the merged event thread by tab: chat (+ pin badge); personal notes removed. */
function edcThreadFor(ev, owner, tab) {
  const all = eventDetailChatMessages(ev, owner);
  const t = normalizeEdcTab(tab) || tab;
  if (t === "description" || t === "notes") {
    return [];
  }
  // Chat shows ordinary messages and the pinned message (badge); not personal.
  return all.filter(m => m._noteKind !== "personal");
}

/** Refresh panel event feed when notes/messages change. */
function refreshEventDetailChatSheet(eventId) {
  if (typeof refreshPanelEventFeed === "function" && refreshPanelEventFeed(eventId)) {
    return;
  }
  // Unfiltered Description/Activity shell in the panel.
  const panelSt = Panel.channelState();
  if (!S.chatFilterEventId && Panel.channelOpen()
      && panelSt && isPanelFeedTab(panelSt.tab)
      && panelSt.tab !== "chat") {
    const host = document.getElementById("channel-panel-body");
    const ch = typeof activeChannelForPanelChat === "function"
      ? activeChannelForPanelChat()
      : null;
    if (host && ch && typeof mountPanelChannelFeed === "function") {
      const tab = normalizeEdcTab(panelSt.tab) || "description";
      mountPanelChannelFeed(host, ch, { tab });
      return;
    }
  }
}

/** Unread chat authors for an event (others only, after the chat-filter seen cursor). */
function eventChatUnreadAuthorIds(ev) {
  const ids = new Set();
  if (!ev?.id) return ids;
  const owner = (typeof ownerConnFor === "function" ? ownerConnFor(ev) : null) || activeConn();
  if (!owner?.id) return ids;
  const chId = ev.channelId
    || (owner.channels || []).find(c => c.kind === "event")?.id
    || null;
  if (!chId || typeof getEventChatSeenTs !== "function") return ids;
  const seenTs = getEventChatSeenTs(owner.id, chId, ev.id);
  if (!seenTs) return ids;
  const meId = (typeof myIdOf === "function" ? myIdOf(ev) : null) || owner.me?.id || S.me?.id;
  const chat = (typeof edcThreadFor === "function" ? edcThreadFor(ev, owner, "chat") : [])
    .filter(m => !m.activity && m._noteKind !== "shared");
  for (const m of chat || []) {
    if ((m.ts || 0) <= seenTs) continue;
    if (meId && m.userId === meId) continue;
    if (m.userId) ids.add(m.userId);
  }
  return ids;
}

/** Unread chat messages for an event (others only, after the chat-filter seen cursor). */
function eventDetailChatUnreadCount(ev, owner, chatMsgs) {
  if (!ev?.id || !owner?.id) return 0;
  const chId = ev.channelId
    || (owner.channels || []).find(c => c.kind === "event")?.id
    || null;
  if (!chId || typeof getEventChatSeenTs !== "function") return 0;
  const seenTs = getEventChatSeenTs(owner.id, chId, ev.id);
  if (!seenTs) return 0;
  const meId = (typeof myIdOf === "function" ? myIdOf(ev) : null) || owner.me?.id || S.me?.id;
  let n = 0;
  for (const m of chatMsgs || []) {
    if ((m.ts || 0) <= seenTs) continue;
    if (meId && m.userId === meId) continue;
    n++;
  }
  return n;
}

function eventDetailActivityRows(ev) {
  return (ev?.notes || [])
    .filter(n => typeof eventActivityText === "function" && eventActivityText(n))
    .slice()
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));
}

function eventDetailActivityHTML(n) {
  const text = typeof eventActivityText === "function" ? eventActivityText(n) : "";
  const ico = typeof eventActivityIcon === "function"
    ? eventActivityIcon(n.activity)
    : "check";
  return `<div class="edc-act">
    <span class="edc-act-ico">${typeof ic === "function" ? ic(ico) : ""}</span>
    <div class="edc-act-body">
      <span class="edc-act-text">${esc(text)}</span>
      <time class="edc-act-when">${typeof fmtTime === "function" ? fmtTime(n.ts) : ""}</time>
    </div>
  </div>`;
}

function snapshotEventNotePins(ev) {
  return (ev.notes || []).map(n => ({
    id: n.id, ts: n.ts, userId: n.userId, pinned: !!n.pinned, noteKind: n.noteKind || null,
  }));
}

function restoreEventNotePins(ev, snap) {
  if (!ev || !Array.isArray(snap)) return;
  const keep = new Set(snap.map(s => s.id || `${s.userId}:${s.ts}`));
  ev.notes = (ev.notes || []).filter(n => keep.has(n.id || `${n.userId}:${n.ts}`));
  for (const n of ev.notes) {
    const s = snap.find(x => (n.id && x.id === n.id) || (x.userId === n.userId && x.ts === n.ts));
    if (!s) continue;
    n.pinned = s.pinned;
    n.noteKind = s.noteKind;
  }
}

function demoteEventPinsExcept(ev, keep) {
  for (const x of (ev.notes || [])) {
    if (x.activity || x.noteKind === "personal") continue;
    if (!(x.pinned || x.noteKind === "shared")) continue;
    if (keep && ((keep.id && x.id === keep.id) || (keep.userId && x.userId === keep.userId && x.ts === keep.ts))) continue;
    x.noteKind = null;
    x.pinned = false;
  }
}

function bindEventDetailChatPins(sheet, ev, owner) {
  if (!sheet || !ev) return;
  const pinNote = async (msgId, msgTs, msgUser) => {
    if (typeof canMutateContent === "function" && !canMutateContent(owner)) return;
    const note = (ev.notes || []).find(n =>
      (msgId && n.id === msgId)
      || (msgUser && n.userId === msgUser && n.ts === Number(msgTs)));
    if (note?.id || note?.ts) {
      const snap = snapshotEventNotePins(ev);
      demoteEventPinsExcept(ev, note);
      note.pinned = true;
      note.noteKind = "shared";
      const payload = {
        type: "pinEventNote",
        eventId: ev.id,
        noteId: note.id || undefined,
        noteTs: note.ts || undefined,
        noteUserId: note.userId || undefined,
      };
      if (typeof ashUndoSnackbar === "function") {
        ashUndoSnackbar({
          message: "Pinned · Undo",
          hide: () => snap,
          restore: (s) => restoreEventNotePins(ev, s),
          commit: () => send(payload, owner?.id),
          refresh: () => refreshEventDetailChatSheet(ev.id),
        });
      } else {
        send(payload, owner?.id);
        toast("Pinned");
        refreshEventDetailChatSheet(ev.id);
      }
      return;
    }
    const chId = ev.channelId;
    const msg = (owner?.messages?.[chId] || []).find(m =>
      (msgId && m.id === msgId)
      || (msgUser && m.userId === msgUser && m.ts === Number(msgTs)));
    const plain = shown(msg?._text || msg?.text || "");
    if (!plain) {
      toast("Open the message to pin it");
      return;
    }
    const snap = snapshotEventNotePins(ev);
    const noteId = typeof genLocalId === "function" ? genLocalId() : undefined;
    demoteEventPinsExcept(ev, null);
    const added = {
      id: noteId, ts: Date.now(), userId: owner?.me?.id, pinned: true, noteKind: "shared",
      _text: plain, text: plain,
    };
    ev.notes = (ev.notes || []).concat([added]);
    const text = typeof encrypt === "function" && owner?.key ? await encrypt(plain, owner.key) : plain;
    const payload = {
      type: "eventNote",
      eventId: ev.id,
      noteId,
      noteKind: "shared",
      pinned: true,
      text,
    };
    if (typeof ashUndoSnackbar === "function") {
      ashUndoSnackbar({
        message: "Pinned · Undo",
        hide: () => snap,
        restore: (s) => restoreEventNotePins(ev, s),
        commit: () => send(payload, owner?.id),
        refresh: () => refreshEventDetailChatSheet(ev.id),
      });
    } else {
      send(payload, owner?.id);
      toast("Pinned");
    }
  };

  sheet.querySelectorAll(".edc-pin").forEach(btn => {
    btn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await pinNote(btn.dataset.msgId, btn.dataset.msgTs, btn.dataset.msgUser);
    };
  });

  sheet.querySelectorAll(".edc-msg:not(.is-note):not(.is-personal)").forEach(row => {
    if (row.dataset.pinBound) return;
    row.dataset.pinBound = "1";
    let timer = 0;
    const clear = () => { if (timer) { clearTimeout(timer); timer = 0; } };
    row.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      clear();
      timer = setTimeout(() => {
        timer = 0;
        pinNote(row.dataset.msgId, row.dataset.msgTs, row.dataset.msgUser);
      }, 480);
    });
    row.addEventListener("pointerup", clear);
    row.addEventListener("pointerleave", clear);
    row.addEventListener("pointercancel", clear);
  });
}

/** Events in scope for a channel's Description / Activity / chat collation
 *  (home channel + linked feeds, same as the agenda timeline). */
function channelEventsForPanelChat(ch) {
  const conn = activeConn();
  if (!conn) return [];
  let events = [];
  if (!ch) {
    if (PersonalSpace.isPersonal(conn)
        && typeof isAllEventsMetaBoard === "function" && isAllEventsMetaBoard()
        && typeof collectPersonalMetaEvents === "function") {
      events = collectPersonalMetaEvents();
    } else {
      events = (conn.events || []).slice();
    }
  } else if (typeof isPersonalMetaEventsLinkTarget === "function"
      && isPersonalMetaEventsLinkTarget(conn.id, ch.id)
      && typeof collectPersonalMetaEvents === "function") {
    events = collectPersonalMetaEvents();
  } else if (typeof collectChannelViewEvents === "function"
      && (ch.kind === "event" || (!ch.kind && PersonalSpace.isPersonal(conn)))) {
    events = collectChannelViewEvents(ch, conn);
  } else if (ch.kind === "event") {
    events = (conn.events || []).filter(e => e.channelId === ch.id);
  } else if (ch.kind === "chat"
      && typeof PersonalSpace !== "undefined" && !PersonalSpace.isPersonal(conn)) {
    const linked = typeof agendasLinkedToChat === "function"
      ? agendasLinkedToChat(ch, conn)
      : [];
    const linkedIds = new Set(linked
      .filter(a => typeof channelVisibleTo !== "function" || channelVisibleTo(a, conn.me, conn))
      .map(a => a.id));
    events = (conn.events || []).filter(e => linkedIds.has(e.channelId));
  } else {
    events = (conn.events || []).slice();
  }
  return typeof mergeAvailabilityChatEvents === "function"
    ? mergeAvailabilityChatEvents(events, ch, conn)
    : events;
}

/** Personal panel: "Server · agenda/group" for collated rows. */
function panelFeedShowEventSource() {
  const conn = activeConn();
  return PersonalSpace.isPersonal(conn);
}

/**
 * Source parts for a feed/event row.
 * opts.forceChannel — hosted chat Events tab: always include the event-group name
 * (personal keeps server · channel; hosted is channel-only).
 */
function panelFeedEventSourceParts(ev, opts = {}) {
  if (!ev) return null;
  const personal = panelFeedShowEventSource();
  if (!personal && !opts.forceChannel) return null;
  const owner = (typeof ownerConnFor === "function" ? ownerConnFor(ev) : null) || activeConn();
  const connId = ev._connId || owner?.id || "personal";
  let channelName = ev._linkedChannelName || "";
  if (!channelName && ev.channelId) {
    const ch = (owner?.channels || []).find(c => c.id === ev.channelId)
      || (typeof sourceChannelsFor === "function"
        ? sourceChannelsFor(owner).find(c => c.id === ev.channelId)
        : null);
    channelName = ch?.name || "";
  }
  if (!channelName) channelName = "Events";
  if (!personal) {
    return { serverName: null, channelName, offline: !!ev._offline, connId };
  }
  const serverName = connId === "personal" || PersonalSpace.isPersonal(owner)
    ? "Personal"
    : (ev._serverName
      || (typeof connDisplayName === "function" ? connDisplayName(owner) : null)
      || owner?.name || owner?.hostName || "Server");
  return { serverName, channelName, offline: !!ev._offline, connId };
}

function panelFeedEventSourceLabel(ev, opts = {}) {
  const parts = panelFeedEventSourceParts(ev, opts);
  if (!parts) return "";
  const offline = parts.offline ? " · offline" : "";
  if (!parts.serverName) return `${parts.channelName}${offline}`;
  return `${parts.serverName} · ${parts.channelName}${offline}`;
}

function panelFeedEventSourceHTML(ev, { asDiv = false, forceChannel = false } = {}) {
  const label = panelFeedEventSourceLabel(ev, { forceChannel });
  if (!label) return "";
  const tag = asDiv ? "div" : "span";
  const icon = forceChannel && typeof ic === "function"
    ? `${ic("ticket", "ico-inline event-outline-icon")} `
    : "";
  return `<${tag} class="edc-event-source">${icon}${esc(label)}</${tag}>`;
}

function channelWideActivityRows(ch) {
  const rows = [];
  for (const ev of channelEventsForPanelChat(ch)) {
    if (typeof isMainViewEvent === "function" && !isMainViewEvent(ev)) continue;
    for (const n of eventDetailActivityRows(ev)) {
      rows.push({ n, ev });
    }
  }
  rows.sort((a, b) => (a.n.ts || 0) - (b.n.ts || 0));
  return rows;
}

/** Channel-wide Description tab: events with a short description preview. */
function channelWideDescriptionRows(ch) {
  return channelEventsForPanelChat(ch)
    .filter(e => typeof isMainViewEvent !== "function" || isMainViewEvent(e))
    .slice()
    .sort((a, b) => (a.when || 0) - (b.when || 0));
}

function channelWideDescriptionRowHTML(ev) {
  const title = eventDisplayTitle(ev) || "Event";
  const when = (typeof fmtDay === "function" && ev.when) ? fmtDay(ev.when) : "";
  const details = String(shown(ev._details || "") || "").trim();
  const preview = details
    ? `<div class="edc-desc-preview">${esc(details)}</div>`
    : `<div class="edc-desc-preview is-empty">No description</div>`;
  const source = panelFeedEventSourceHTML(ev, { asDiv: true });
  return `<button type="button" class="edc-channel-row edc-desc-row" data-event="${esc(ev.id)}" data-edc-open-tab="description">
    <span class="edc-desc-row-head">
      <span class="edc-desc-row-title">${esc(title)}</span>
      ${when ? `<span class="edc-desc-row-when">${esc(when)}</span>` : ""}
    </span>
    ${source}
    ${preview}
  </button>`;
}

function channelWideActivityRowHTML(row) {
  const { n, ev } = row;
  const title = eventDisplayTitle(ev) || "Event";
  const act = eventDetailActivityHTML(n);
  const source = panelFeedEventSourceHTML(ev);
  return `<div class="edc-channel-row" data-event="${esc(ev.id)}">
    <button type="button" class="edc-event-chip-link" data-event="${esc(ev.id)}" data-edc-open-tab="activity">${esc(title)}</button>
    ${source}
    ${act}
  </div>`;
}

function chatPanelSkipPinnedAgenda(ch) {
  return !!(ch && (ch.pinnedLocationLabel != null || ch.pinnedUserId != null));
}

/** Event boards for the chat-channel Events panel tab. */
function chatPanelEventChannels(ch, conn = activeConn()) {
  if (!ch || ch.kind !== "chat" || !conn) return [];
  if (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn)) return [];
  const visibleToMe = (a) => typeof channelVisibleTo !== "function" || channelVisibleTo(a, conn.me, conn);
  const linked = typeof agendasLinkedToChat === "function"
    ? agendasLinkedToChat(ch, conn).filter(a => !chatPanelSkipPinnedAgenda(a) && visibleToMe(a))
    : [];
  if (linked.length) return linked;
  const members = typeof channelMemberList === "function" ? channelMemberList(ch, conn) : [];
  if (!members.length) return [];
  return (conn.channels || []).filter(c =>
    c.kind === "event"
    && !chatPanelSkipPinnedAgenda(c)
    && members.every(m => typeof channelVisibleTo !== "function" || channelVisibleTo(c, m, conn))
  );
}

function chatPanelEventRows(ch) {
  const conn = activeConn();
  if (!conn) return [];
  const ids = new Set(chatPanelEventChannels(ch, conn).map(c => c.id));
  if (!ids.size) return [];
  return (conn.events || [])
    .filter(e => ids.has(e.channelId) && (typeof isMainViewEvent !== "function" || isMainViewEvent(e)))
    .slice()
    .sort((a, b) => (a.when || 0) - (b.when || 0));
}

function chatPanelEventRowHTML(ev) {
  const title = eventDisplayTitle(ev) || "Event";
  const day = (typeof fmtDay === "function" && ev.when) ? fmtDay(ev.when) : "";
  const clock = (typeof fmtTime === "function" && ev.when
    && ev.whenPrecision !== "day" && ev.whenPrecision !== "period"
    && ev.whenPrecision !== "unconfirmed")
    ? fmtTime(ev.when)
    : "";
  const whenLine = [day, clock].filter(Boolean).join(" · ");
  // Chat Events tab can mirror several event groups — always show which one.
  const source = panelFeedEventSourceHTML(ev, { asDiv: true, forceChannel: true });
  const stub = typeof ticketBlockHTML === "function"
    ? ticketBlockHTML(ev, ev.when)
    : "";
  return `<button type="button" class="panel-event-card-row" data-event="${esc(ev.id)}">
    <span class="panel-event-card-stub" aria-hidden="true">${stub}</span>
    <span class="panel-event-card-body">
      <span class="panel-event-card-title">${esc(title)}</span>
      ${whenLine ? `<span class="panel-event-card-when">${esc(whenLine)}</span>` : ""}
      ${source}
    </span>
  </button>`;
}

function mountPanelChatEvents(host, ch) {
  if (!host || !ch) return;
  host.innerHTML = "";
  host.style.cssText = "display:flex;flex-direction:column;flex:1;min-height:0";
  host.classList.add("channel-panel-body-event-feed");

  const feed = document.createElement("div");
  feed.className = "panel-channel-feed panel-event-feed event-detail-chat-sheet is-open";
  feed.dataset.tab = "events";
  feed.dataset.channelId = ch.id;
  const mirrorHTML = typeof chatHostedMirroringBarHTML === "function"
    ? chatHostedMirroringBarHTML(ch)
    : "";
  feed.innerHTML = `<div class="panel-chat-pane panel-chat-pane-list" id="panel-chat-pane" data-panel-chat="1"></div>${mirrorHTML}`;
  host.appendChild(feed);

  const pane = feed.querySelector("#panel-chat-pane");
  if (!pane) return;
  pane.style.cssText = "flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:8px 10px 12px";
  const rows = chatPanelEventRows(ch);
  pane.innerHTML = rows.length
    ? rows.map(chatPanelEventRowHTML).join("")
    : `<p class="edc-empty">No events yet</p>`;
  pane.querySelectorAll(".panel-event-card-row").forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.event;
      if (!id) return;
      const fromEl = btn.querySelector(".panel-event-card-stub") || btn;
      if (typeof openEventDetailOverChat === "function") {
        openEventDetailOverChat(id, fromEl);
      } else if (typeof openEventDetail === "function") {
        openEventDetail(id, fromEl);
      } else {
        Nav.openEventDetail(id);
        if (typeof renderView === "function") renderView();
      }
    };
  });
  feed.querySelectorAll(".chat-mirror-chip[data-channel]").forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const channelId = btn.dataset.channel;
      if (!channelId) return;
      S.chatFilterEventId = null;
      S.memoryChatReadonly = false;
      if (typeof Nav?.openChannel === "function") Nav.openChannel(channelId);
      else if (typeof Nav?.set === "function") Nav.set({ kind: "channel", id: channelId });
      try { if (typeof renderView === "function") renderView(); } catch {}
    };
  });
}

/**
 * Unfiltered channel feed for panel Chat / Description / Activity tabs.
 * Top-level panel tabs own navigation — no nested edc subtabs.
 */
function mountPanelChannelFeed(host, ch, opts = {}) {
  if (!host || !ch) return;
  const wantTab = normalizeEdcTab(opts.tab || S._edcTab) || "chat";
  let activeTab = wantTab;
  S._edcTab = activeTab;
  if (typeof channelPanelState !== "undefined") channelPanelState.tab = activeTab;

  host.innerHTML = "";
  host.style.cssText = "display:flex;flex-direction:column;flex:1;min-height:0";
  host.classList.add("channel-panel-body-event-feed");

  const feed = document.createElement("div");
  feed.className = "panel-channel-feed panel-event-feed event-detail-chat-sheet is-open";
  feed.dataset.tab = activeTab;
  feed.dataset.channelId = ch.id;

  feed.innerHTML = `<div class="panel-chat-pane" id="panel-chat-pane" data-panel-chat="1"></div>`;
  host.appendChild(feed);

  const pane = feed.querySelector("#panel-chat-pane");
  if (pane) pane.dataset.panelChat = "1";

  const bindEventChips = () => {
    pane?.querySelectorAll(".edc-event-chip-link, .edc-desc-row").forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.dataset.event;
        const tab = normalizeEdcTab(btn.dataset.edcOpenTab) || activeTab;
        if (id && typeof openEventChatFiltered === "function") {
          openEventChatFiltered(ch.id, id, { tab });
        }
      };
    });
  };

  const paintPane = () => {
    if (!pane) return;
    pane._chatShellSignature = null;
    feed.dataset.tab = activeTab;
    feed.classList.toggle("tab-activity", activeTab === "activity");
    feed.classList.toggle("tab-description", activeTab === "description");
    if (activeTab === "chat") {
      pane.className = "panel-chat-pane panel-chat-pane-chat";
      pane.style.cssText = "display:flex;flex-direction:column;flex:1;min-height:0";
      if (typeof renderChat === "function") renderChat(pane, ch, true);
      else pane.innerHTML = `<p class="edc-empty">Chat unavailable</p>`;
      return;
    }
    pane.className = "panel-chat-pane panel-chat-pane-list";
    pane.style.cssText = "flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:8px 10px 12px";
    if (activeTab === "description") {
      const rows = channelWideDescriptionRows(ch);
      pane.innerHTML = rows.length
        ? rows.map(channelWideDescriptionRowHTML).join("")
        : `<p class="edc-empty">No events yet</p>`;
      bindEventChips();
    } else {
      const rows = channelWideActivityRows(ch);
      pane.innerHTML = rows.length
        ? rows.map(channelWideActivityRowHTML).join("")
        : `<p class="edc-empty">No activity yet</p>`;
      bindEventChips();
    }
  };

  paintPane();
}

/**
 * Mount event-scoped feed into the right channel panel.
 * Panel tabs: Chat | Description | Activity (no nested edc strip).
 */
function eventDescriptionPaneHTML(ev, owner) {
  const canEdit = typeof canEditEvent === "function" && canEditEvent(ev, owner);
  const detailsText = shown(ev._details || "") || "";
  const source = typeof panelFeedEventSourceHTML === "function"
    ? panelFeedEventSourceHTML(ev, { asDiv: true })
    : "";
  const personal = typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(owner);
  const sub = personal
    ? "Notes for this event on this device"
    : "Visible to everyone on this event";

  return canEdit
    ? `<section class="edc-desc-section" id="edc-desc-section">
        <h6 class="edc-desc-title">${personal ? "Notes" : "Description"}</h6>
        ${source}
        <p class="edc-desc-sub">${esc(sub)}</p>
        <textarea id="edc-desc-input" class="edc-desc-input" maxlength="2000" rows="4" placeholder="${personal ? "Add a note for this event…" : "Add details for this event…"}">${esc(detailsText)}</textarea>
        <button type="button" class="edc-desc-save" id="edc-desc-save">${personal ? "Save note" : "Save description"}</button>
      </section>`
    : `<section class="edc-desc-section" id="edc-desc-section">
        <h6 class="edc-desc-title">${personal ? "Notes" : "Description"}</h6>
        ${source}
        ${detailsText
          ? `<div class="edc-desc-body">${esc(detailsText)}</div>`
          : `<p class="edc-empty">${personal ? "No notes yet" : "No description yet"}</p>`}
      </section>`;
}
