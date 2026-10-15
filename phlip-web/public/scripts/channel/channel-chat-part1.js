/* channel-chat-part1.js — split from channel-chat.js (Part 3 size ceiling).
 * Load after: (prior deps); part of channel-chat cluster.
 */

/* channel-chat.js — event-group chat, link sheet, panel feeds.
 * Formerly chat030.js. Event chat opens via openEventChatFiltered (panel).
 * Globals out: renderChat, openEventChatFiltered, …
 * Load after: channel.js facade (and channel-panel.js)
 */

/* Loaded after channel.js — replaces renderChat and adds link sheet helpers. */

function composerMentionedEventIds() {
  const ids = [];
  const seen = new Set();
  const add = (id) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  if (Array.isArray(S.mentionedEventIds)) {
    for (const id of S.mentionedEventIds) add(id);
  }
  add(S.taggedEventId);
  if (!S.chatFilterUntagged) add(S.autoTagEventId);
  if (S.chatFilterEventId) add(S.chatFilterEventId);
  if (S.replyToMessage?.eventId) add(S.replyToMessage.eventId);
  return ids;
}

/** Explicit attach via filter rail or manual #tag / chip (not passive auto-tag alone). */
function composerHasEventAttach() {
  return !!(S.chatFilterEventId
    || S.taggedEventId
    || (Array.isArray(S.mentionedEventIds) && S.mentionedEventIds.length));
}

/** Show chat Send only when the field has non-whitespace text. */
function composerSendHasText(input) {
  return !!(input && String(input.value || "").trim());
}

function composerSendButton(form) {
  if (!form) return null;
  return form.querySelector('button[type="submit"]')
    || (form.id && document.querySelector(`button.board-compose-send[form="${form.id}"]`));
}

function syncComposerSendButton(form, input, opts) {
  if (!form) return;
  const field = input || form.querySelector("input:not([type='hidden']), textarea");
  const btn = composerSendButton(form);
  if (!btn || !field) return;
  const locked = !!(opts && opts.locked);
  const has = composerSendHasText(field);
  const outside = btn.classList.contains("board-compose-send");
  btn.hidden = outside ? false : !has;
  btn.disabled = !has || locked;
}

function bindComposerSendVisibility(form, input, opts) {
  if (!form) return;
  const field = input || form.querySelector("input:not([type='hidden']), textarea");
  if (!field) return;
  form._composerSendLocked = !!(opts && opts.locked);
  const sync = () => syncComposerSendButton(form, field, { locked: form._composerSendLocked });
  if (!form._composerSendBound) {
    form._composerSendBound = true;
    field.addEventListener("input", sync);
    field.addEventListener("change", sync);
  }
  sync();
}

function clearComposerEventTags() {
  S.taggedEventId = null;
  S.mentionedEventIds = [];
  S.autoTagEventId = null;
  S.taggedMirrorChatKey = null;
}

/** Compact day for in-line chat event chips. Same day words as the event card. */
function chatEventChipWhen(when) {
  if (!when) return "";
  if (typeof conversationDateLabel === "function") return conversationDateLabel({ when });
  const day = typeof dayStart === "function" ? dayStart(when) : new Date(when).setHours(0, 0, 0, 0);
  const today = typeof dayStart === "function" ? dayStart(Date.now()) : new Date().setHours(0, 0, 0, 0);
  if (day === today) return "Today";
  const d = new Date(day);
  const dow = (typeof WEEKDAYS !== "undefined")
    ? WEEKDAYS[d.getDay()]
    : d.toLocaleDateString([], { weekday: "short" });
  const mon = d.toLocaleDateString([], { month: "short" }).replace(/\.$/, "");
  return `${dow} ${d.getDate()} ${mon}`;
}

/** Unfiltered-chat event ref: type icon + title + date. */
function chatEventChipHTML(ev, eid, titleFallback, { compactLabel = "" } = {}) {
  const title = esc(ev ? eventDisplayTitle(ev) : shown(titleFallback));
  const iconName = (ev && typeof eventIcon === "function") ? eventIcon(ev) : "ticket";
  let icoStyle = "";
  if (ev && typeof catStyleFor === "function") {
    try {
      const st = catStyleFor(ev);
      if (st?.accent) {
        icoStyle = ` style="--chip-accent:${st.accent};--chip-tint:${st.tint || st.accent}"`;
      }
    } catch {}
  }
  const ico = `<span class="chat-event-chip-ico"${icoStyle} aria-hidden="true">${ic(iconName)}</span>`;
  if (compactLabel) {
    return `<button type="button" class="chat-event-chip chat-event-chip-compact${ev ? "" : " inert"}" data-event="${esc(eid)}">${ico}<span class="chat-event-chip-title">${compactLabel}</span></button>`;
  }
  const when = ev?.when ? chatEventChipWhen(ev.when) : "";
  const whenHtml = when ? `<span class="chat-event-chip-when">${esc(when)}</span>` : "";
  return `<button type="button" class="chat-event-chip${ev ? "" : " inert"}" data-event="${esc(eid)}">${ico}<span class="chat-event-chip-title">${title}</span>${whenHtml}</button>`;
}

function chatReplyDescendantIds(messages, rootId) {
  if (!rootId) return [];
  const ids = [];
  const pending = [rootId];
  const seen = new Set([rootId]);
  while (pending.length) {
    const parentId = pending.pop();
    for (const m of messages || []) {
      if (!m?.id || seen.has(m.id) || m.replyToId !== parentId) continue;
      seen.add(m.id);
      ids.push(m.id);
      pending.push(m.id);
    }
  }
  return ids;
}

function chatMoveThreadRootId(messages, sourceId) {
  if (!sourceId) return "";
  const byId = new Map();
  for (const m of messages || []) {
    if (m?.id) byId.set(m.id, m);
  }
  let id = sourceId;
  const seen = new Set();
  while (id && !seen.has(id)) {
    seen.add(id);
    const m = byId.get(id);
    if (!m?.replyToId || !byId.has(m.replyToId)) return id;
    id = m.replyToId;
  }
  return sourceId;
}

function chatMessageIsEventAttached(m) {
  if (!m) return false;
  if (typeof messageMentionedEventIds === "function") return messageMentionedEventIds(m).length > 0;
  return !!m.eventId;
}

/** Question + every reply in that thread (untagged, plus the source). */
function chatMoveRelatedIds(messages, sourceId) {
  if (!sourceId) return [];
  const root = chatMoveThreadRootId(messages, sourceId);
  const ids = [root, ...chatReplyDescendantIds(messages, root)];
  const byId = new Map((messages || []).map((m) => [m.id, m]));
  return ids.filter((id) => {
    if (id === sourceId) return true;
    const m = byId.get(id);
    if (!m || m.activity || m._eventLinkMarker) return false;
    return !chatMessageIsEventAttached(m);
  }).slice(0, CHAT_MOVE_SELECT_MAX);
}

function attachChatMessagesToEvent(channelId, messageIds, eventId, conn) {
  if (!channelId || !eventId || typeof send !== "function") return;
  const owner = conn || (typeof activeConn === "function" ? activeConn() : null);
  const ids = [...new Set((messageIds || []).map((id) => String(id || "")).filter(Boolean))];
  for (const messageId of ids) {
    send({
      type: "tagMessageEvents",
      channelId,
      messageId,
      mentionedEventIds: [eventId],
      eventId,
    }, owner?.id);
  }
}

function attachChatThreadToEvent(channelId, rootMessageId, eventId, conn) {
  if (!channelId || !rootMessageId || !eventId) return;
  const owner = conn || (typeof activeConn === "function" ? activeConn() : null);
  const list = owner?.messages?.[channelId] || [];
  const ids = [rootMessageId];
  for (const id of chatReplyDescendantIds(list, rootMessageId)) {
    const m = list.find(x => x.id === id);
    if (!m) continue;
    const attached = typeof messageMentionedEventIds === "function"
      ? messageMentionedEventIds(m)
      : (m.eventId ? [m.eventId] : []);
    if (!attached.length || attached.includes(eventId)) ids.push(id);
  }
  attachChatMessagesToEvent(channelId, ids, eventId, owner);
}

const CHAT_MOVE_SELECT_WINDOW_MS = 6 * 3600e3;
const CHAT_MOVE_SELECT_MAX = 40;

function chatMoveSelectCandidates(messages, sourceId) {
  const source = (messages || []).find((m) => m?.id === sourceId);
  if (!source) return sourceId ? [sourceId] : [];
  const tree = new Set([sourceId, ...chatReplyDescendantIds(messages, sourceId)]);
  const related = new Set(typeof chatMoveRelatedIds === "function"
    ? chatMoveRelatedIds(messages, sourceId)
    : tree);
  const attached = (m) => (typeof messageMentionedEventIds === "function"
    ? messageMentionedEventIds(m).length
    : !!(m?.eventId));
  const ids = [];
  const seen = new Set();
  for (const m of messages || []) {
    if (!m?.id || seen.has(m.id) || m.activity || m._eventLinkMarker) continue;
    if (m._fromEventChannel || m._fromEventNote) continue;
    if (String(m.id).startsWith("note-")) continue;
    const inThread = tree.has(m.id) || related.has(m.id);
    if (attached(m) && !inThread) continue;
    const near = Math.abs((Number(m.ts) || 0) - (Number(source.ts) || 0)) <= CHAT_MOVE_SELECT_WINDOW_MS;
    if (!inThread && !near) continue;
    seen.add(m.id);
    ids.push(m.id);
  }
  const byId = new Map((messages || []).map((m) => [m.id, m]));
  ids.sort((a, b) => (Number(byId.get(a)?.ts) || 0) - (Number(byId.get(b)?.ts) || 0));
  if (!ids.includes(sourceId)) ids.unshift(sourceId);
  return ids.slice(0, CHAT_MOVE_SELECT_MAX);
}

function chatMoveSelectActive(ch) {
  const sel = typeof S !== "undefined" ? S.chatMoveSelect : null;
  return !!(sel && ch?.id && sel.channelId === ch.id);
}

function refreshChatAfterMoveSelect(ch) {
  const panel = document.getElementById("channel-panel-body");
  const view = (panel?.querySelector("#chat-scroll") && panel)
    || document.querySelector("#view");
  if (view && ch && typeof renderChat === "function") renderChat(view, ch, true);
  else if (typeof renderView === "function") renderView();
}

function beginChatMoveSelect(ch, msg, opts = {}) {
  if (!ch || !msg?.id) return;
  if (typeof closeChatMessageOptions === "function") closeChatMessageOptions(true);
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const list = conn?.messages?.[ch.id] || [];
  const candidateIds = chatMoveSelectCandidates(list, msg.id);
  const relatedIds = typeof chatMoveRelatedIds === "function"
    ? chatMoveRelatedIds(list, msg.id)
    : [msg.id, ...chatReplyDescendantIds(list, msg.id)];
  const related = new Set(relatedIds);
  const purpose = opts.purpose || "create";
  const includeRelated = purpose !== "attach" && relatedIds.length > 1;
  const selectedIds = includeRelated
    ? candidateIds.filter((id) => related.has(id))
    : candidateIds.filter((id) => id === msg.id);
  S.chatMoveSelect = {
    channelId: ch.id,
    connId: conn?.id || S.activeConnId || null,
    sourceMessageId: msg.id,
    candidateIds,
    relatedIds,
    includeRelated,
    purpose,
    attachEvents: opts.attachEvents || [],
    selectedIds: selectedIds.length ? selectedIds : [msg.id],
  };
  if (!S.chatFilterUntagged && typeof conversationsLandOnGeneralChat === "function") {
    conversationsLandOnGeneralChat();
    return;
  }
  refreshChatAfterMoveSelect(ch);
}

function toggleChatMoveSelect(messageId) {
  const sel = typeof S !== "undefined" ? S.chatMoveSelect : null;
  if (!sel || !messageId || !(sel.candidateIds || []).includes(messageId)) return;
  const next = new Set(sel.selectedIds || []);
  if (next.has(messageId)) {
    if (messageId === sel.sourceMessageId && next.size <= 1) return;
    next.delete(messageId);
  } else next.add(messageId);
  sel.selectedIds = [...next];
  const related = new Set(sel.relatedIds || []);
  sel.includeRelated = related.size > 1
    && [...related].every((id) => id === sel.sourceMessageId || next.has(id));
  const conn = (sel.connId && S.conns?.[sel.connId])
    || (typeof activeConn === "function" ? activeConn() : null);
  const ch = (conn?.channels || []).find((c) => c.id === sel.channelId);
  refreshChatAfterMoveSelect(ch || { id: sel.channelId });
}

function cancelChatMoveSelect() {
  const sel = typeof S !== "undefined" ? S.chatMoveSelect : null;
  const channelId = sel?.channelId;
  S.chatMoveSelect = null;
  const conn = (sel?.connId && S.conns?.[sel.connId])
    || (typeof activeConn === "function" ? activeConn() : null);
  const ch = (conn?.channels || []).find((c) => c.id === channelId);
  refreshChatAfterMoveSelect(ch || (channelId ? { id: channelId } : null));
}

function toggleChatMoveRelated() {
  const sel = typeof S !== "undefined" ? S.chatMoveSelect : null;
  if (!sel) return;
  const related = new Set(sel.relatedIds || []);
  const extras = (sel.selectedIds || []).filter((id) => !related.has(id));
  sel.includeRelated = !sel.includeRelated;
  if (sel.includeRelated) {
    sel.selectedIds = [...new Set([...(sel.relatedIds || []), ...extras, sel.sourceMessageId])];
  } else {
    const keep = extras.length ? extras : [];
    if (!keep.includes(sel.sourceMessageId)) keep.unshift(sel.sourceMessageId);
    sel.selectedIds = keep;
  }
  const conn = (sel.connId && S.conns?.[sel.connId])
    || (typeof activeConn === "function" ? activeConn() : null);
  const ch = (conn?.channels || []).find((c) => c.id === sel.channelId);
  refreshChatAfterMoveSelect(ch || { id: sel.channelId });
}

function confirmChatMoveSelect() {
  const sel = typeof S !== "undefined" ? S.chatMoveSelect : null;
  if (!sel?.sourceMessageId) {
    cancelChatMoveSelect();
    return;
  }
  const conn = (sel.connId && S.conns?.[sel.connId])
    || (typeof activeConn === "function" ? activeConn() : null);
  const ch = (conn?.channels || []).find((c) => c.id === sel.channelId) || { id: sel.channelId };
  const msg = (conn?.messages?.[sel.channelId] || []).find((m) => m.id === sel.sourceMessageId);
  const messageIds = (sel.selectedIds || []).length ? sel.selectedIds : [sel.sourceMessageId];
  const purpose = sel.purpose || "create";
  const sourceId = sel.sourceMessageId;
  S.chatMoveSelect = null;
  if (purpose === "attach") {
    refreshChatAfterMoveSelect(ch);
    requestAnimationFrame(() => {
      if (typeof openChatMessageOptions === "function") {
        openChatMessageOptions(ch, sourceId, conn, {
          view: "move",
          moveMessageIds: messageIds,
        });
      }
    });
    return;
  }
  if (msg && typeof openCreateDraftFromMessage === "function") {
    openCreateDraftFromMessage(msg, { messageIds, channelId: sel.channelId, connId: sel.connId });
  }
}

function openChatMessageLinkSheet(ch, messageId, events, msgEl = null) {
  if (!ch) return;
  const conn = activeConn();
  const msg = messageId
    ? (conn?.messages?.[ch.id] || []).find(m => m.id === messageId)
    : null;
  if (!msg && !msgEl) return;
  const meId = conn?.me?.id || S.me?.id;
  const userId = msg?.userId || msgEl?.dataset?.noteUser || "";
  const realChat = !!(msg && messageId);
  const fromNote = !realChat && !!(msgEl?.dataset?.fromNote === "1" || msgEl?.dataset?.event);
  const canDelete = !!(realChat || fromNote)
    && (userId === meId || (typeof canModerateEvents === "function" && canModerateEvents()));
  const canReportMsg = !!(realChat && messageId && userId && userId !== meId
    && typeof canReport === "function" && canReport());
  const current = msg && typeof messageMentionedEventIds === "function"
    ? messageMentionedEventIds(msg)
    : (msg?.eventId ? [msg.eventId] : []);
  const relatedIds = realChat && messageId && typeof chatMoveRelatedIds === "function"
    ? chatMoveRelatedIds(conn?.messages?.[ch.id] || [], messageId)
    : (realChat && messageId ? [messageId] : []);
  const relatedExtra = relatedIds.filter((id) => id !== messageId);
  const attachHint = relatedExtra.length
    ? `Moves this message out of All chat. Turn on Move related messages to take the rest of the thread with it.`
    : "Moves this message out of All chat into that conversation.";
  const sheetTitle = "Move to event";
  const relatedToggle = relatedExtra.length
    ? `<label class="chat-link-related">
        <input type="checkbox" id="chat-link-related" checked>
        <span>Move related messages <em>(${relatedExtra.length + 1})</em></span>
      </label>`
    : "";
  const rows = realChat
    ? (events || []).slice(0, 24).map(ev => {
      const on = current.includes(ev.id);
      return `<button type="button" class="chat-link-pick${on ? " on" : ""}" data-id="${esc(ev.id)}">
        ${ic("ticket", "ico-inline event-outline-icon")} ${esc(eventDisplayTitle(ev))}
        <span>${esc(fmtDay(ev.when))}</span>
      </button>`;
    }).join("")
    : "";
  const opened = AshModal.open({
    className: "chat-link-sheet",
    html: `
    <div class="modal-card chat-link-modal">
      <div class="user-settings-top"><h4>${realChat ? esc(sheetTitle) : "Message actions"}</h4></div>
      <div class="user-settings-body">
        ${realChat ? `
        <p class="feel-strength-hint">${esc(attachHint)}</p>
        ${relatedToggle}
        <div class="chat-link-list">${rows || `<p class="empty-note">No upcoming events</p>`}</div>` : ""}
        <div class="chat-link-actions">
          ${canReportMsg ? `<button type="button" class="people-btn" id="chat-link-report">${ic("flag", "ico-inline")} Report</button>` : ""}
          ${!realChat && canDelete ? `<button type="button" class="people-btn danger" id="chat-link-delete">${ic("trash", "ico-inline")} Delete</button>` : ""}
        </div>
        <div class="actions">
          <button type="button" class="cancel" id="chat-link-cancel">Cancel</button>
          ${realChat && current.length ? `<button type="button" class="people-btn" id="chat-link-clear">Unlink</button>` : ""}
        </div>
      </div>
    </div>`,
    singleton: false,
  });
  if (!opened) return;
  const { overlay, close } = opened;
  overlay.querySelector("#chat-link-cancel").onclick = close;
  overlay.querySelector("#chat-link-clear")?.addEventListener("click", () => {
    send({ type: "tagMessageEvents", channelId: ch.id, messageId, clear: true });
    close();
  });
  overlay.querySelector("#chat-link-report")?.addEventListener("click", () => {
    close();
    openReportModal({
      targetType: "message",
      targetId: messageId,
      channelId: ch.id,
      targetLabel: "this message",
    });
  });
  overlay.querySelector("#chat-link-delete")?.addEventListener("click", () => {
    close();
    if (fromNote || (!messageId && msgEl?.dataset?.event)) {
      const payload = {
        type: "deleteEventNote",
        eventId: msgEl?.dataset?.event,
        noteId: msgEl?.dataset?.noteId || undefined,
        noteTs: Number(msgEl?.dataset?.noteTs) || undefined,
        noteUserId: msgEl?.dataset?.noteUser || undefined,
      };
      if (!payload.noteId) delete payload.noteId;
      if (!payload.noteTs) delete payload.noteTs;
      if (!payload.noteUserId) delete payload.noteUserId;
      const eventId = payload.eventId;
      const hit = typeof resolveEventForPanelFeed === "function"
        ? resolveEventForPanelFeed(eventId) : null;
      snackbarOwnMessageDeleted({
        hide: () => hideLocalEventNote(hit && hit.ev, payload),
        restore: restoreLocalEventNote,
        commit: () => send(payload),
        refresh: () => refreshAfterOwnMessageDelete(ch.id, eventId),
      });
      return;
    }
    if (messageId) {
      snackbarOwnMessageDeleted({
        hide: () => hideLocalChatMessage(conn, ch.id, messageId),
        restore: restoreLocalChatMessage,
        commit: () => send({ type: "deleteMessage", channelId: ch.id, messageId }),
        refresh: () => refreshAfterOwnMessageDelete(ch.id),
      });
    }
  });
  overlay.querySelectorAll(".chat-link-pick").forEach(btn => {
    btn.onclick = () => {
      const includeRelated = !!overlay.querySelector("#chat-link-related")?.checked;
      const ids = includeRelated && relatedIds.length ? relatedIds : (messageId ? [messageId] : []);
      if (ids.length && typeof attachChatMessagesToEvent === "function") {
        attachChatMessagesToEvent(ch.id, ids, btn.dataset.id, conn);
      } else if (typeof attachChatThreadToEvent === "function") {
        attachChatThreadToEvent(ch.id, messageId, btn.dataset.id, conn);
      } else {
        send({
          type: "tagMessageEvents",
          channelId: ch.id,
          messageId,
          mentionedEventIds: [btn.dataset.id],
          eventId: btn.dataset.id,
        });
      }
      close();
    };
  });
}

const CHAT_REACT_EMOJIS = ["❤️", "🔥", "😂", "👍", "🎉", "👀"];

function canDeleteChatMessage(m, conn = activeConn()) {
  if (!m || m.activity) return false;
  const meId = conn?.me?.id || S.me?.id;
  if (m.userId === meId) return true;
  if (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn)) return false;
  if (typeof canManageServer === "function" && canManageServer(conn)) return true;
  if (typeof effectiveRole === "function" && effectiveRole(conn?.me) === ROLE_MODERATOR) {
    const ch = (conn?.channels || []).find(c => c.id === m.channelId);
    if (ch && typeof channelVisibleTo === "function") return channelVisibleTo(ch, conn.me, conn);
    return false;
  }
  return false;
}

function hideLocalChatMessage(conn, channelId, messageId) {
  const list = conn && conn.messages && conn.messages[channelId];
  if (!list) return null;
  const index = list.findIndex(m => m.id === messageId);
  if (index < 0) return null;
  const msg = list[index];
  list.splice(index, 1);
  return { conn, channelId, index, msg };
}

function restoreLocalChatMessage(snap) {
  if (!snap || !snap.msg || !snap.conn) return;
  const list = (snap.conn.messages ||= {})[snap.channelId] ||= [];
  const i = Math.min(Math.max(0, snap.index), list.length);
  list.splice(i, 0, snap.msg);
}

function hideLocalEventNote(ev, payload) {
  if (!ev || !payload) return null;
  const notes = Array.isArray(ev.notes) ? ev.notes : [];
  const index = notes.findIndex(n => {
    if (payload.noteId && n.id) return n.id === payload.noteId;
    return n.userId === payload.noteUserId && n.ts === payload.noteTs && !n.activity;
  });
  if (index < 0) return null;
  const note = notes[index];
  const next = notes.slice();
  next.splice(index, 1);
  ev.notes = next.length ? next : null;
  return { ev, index, note };
}

function restoreLocalEventNote(snap) {
  if (!snap || !snap.ev || !snap.note) return;
  const notes = Array.isArray(snap.ev.notes) ? snap.ev.notes.slice() : [];
  const i = Math.min(Math.max(0, snap.index), notes.length);
  notes.splice(i, 0, snap.note);
  snap.ev.notes = notes;
}

function ashUndoSnackbar({ message, hide, restore, commit, refresh }) {
  const snap = typeof hide === "function" ? hide() : true;
  if (typeof refresh === "function") refresh();
  const fb = typeof AshFeedback !== "undefined" ? AshFeedback : null;
  if (!fb || typeof fb.snackbar !== "function") {
    if (typeof commit === "function") commit();
    return;
  }
  fb.snackbar({
    message: String(message || "Undo"),
    action: "Undo",
    onUndo() {
      if (typeof restore === "function") restore(snap);
      if (typeof refresh === "function") refresh();
    },
    onCommit() {
      if (typeof commit === "function") commit();
    },
  });
}

function refreshAfterOwnMessageDelete(channelId, eventId) {
  if (eventId && typeof refreshEventDetailChatSheet === "function") {
    refreshEventDetailChatSheet(eventId);
  }
  if (channelId && typeof refreshActiveChatIncrementally === "function"
      && refreshActiveChatIncrementally(channelId)) {
    return;
  }
  if (typeof renderView === "function") renderView(true);
}

function snackbarOwnMessageDeleted({ hide, restore, commit, refresh }) {
  const snap = typeof hide === "function" ? hide() : null;
  if (snap && typeof refresh === "function") refresh();
  const fb = typeof AshFeedback !== "undefined" ? AshFeedback : null;
  if (!snap || !fb || typeof fb.snackbar !== "function") {
    if (typeof commit === "function") commit();
    return;
  }
  fb.snackbar({
    message: "Message deleted · Undo",
    action: "Undo",
    onUndo() {
      if (typeof restore === "function") restore(snap);
      if (typeof refresh === "function") refresh();
    },
    onCommit() {
      if (typeof commit === "function") commit();
    },
  });
}

function chatReplyPreview(text, max = 80) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length <= max) return t;
  return `${t.slice(0, max).trimEnd()}…`;
}

function chatMessagePlaintext(msg) {
  const text = typeof shownField === "function"
    ? shownField(msg?._text, msg?.text)
    : shown(msg?._text);
  if (!text || text === "…") return "";
  if (typeof LOCK !== "undefined" && text === LOCK) return "";
  return String(text);
}

function chatReplyToIdForChannel(channelId, conn = activeConn()) {
  const r = S.replyToMessage;
  if (!r?.id || r.channelId !== channelId) return null;
  const list = conn?.messages?.[channelId] || [];
  return list.some(x => x.id === r.id) ? r.id : null;
}

function chatReplyQuoteHTML(m, messages) {
  if (!m?.replyToId) return "";
  const parent = (messages || []).find(x => x.id === m.replyToId);
  const name = parent?.name || "Original message";
  const preview = chatReplyPreview(chatMessagePlaintext(parent));
  return `<div class="msg-reply-quote"><span class="msg-reply-who">${esc(name)}</span>${preview ? `<span class="msg-reply-text">${esc(preview)}</span>` : ""}</div>`;
}

function chatReactionChipsHTML(m, { mine, interactive } = {}) {
  if (!m?.reactions || typeof m.reactions !== "object" || !Object.keys(m.reactions).length) return "";
  if (typeof rxChipHTML !== "function") return "";
  const chips = rxChipHTML(m.reactions, { mine, interactive: !!interactive, className: "msg-rx-btn" });
  return chips ? `<div class="msg-rx">${chips}</div>` : "";
}

function paintTimelineSheetReplyChip() {
  const form = document.getElementById("tl-sheet-compose");
  if (!form) return;
  form.querySelector(".composer-reply-chip")?.remove();
  const r = S.replyToMessage;
  if (!r?.id) return;
  const dest = r.eventTitle || "";
  const lead = dest
    ? `Replying in <b>${esc(dest)}</b>`
    : `Replying to <b>${esc(r.name || "message")}</b>`;
  const chip = document.createElement("div");
  chip.className = "composer-tag-chip composer-reply-chip";
  chip.innerHTML = `${typeof ic === "function" ? ic("reply", "ico-inline") : ""} ${lead}
    ${r.preview ? `<span class="composer-reply-preview">${esc(r.preview)}</span>` : ""}
    <button type="button" id="tl-sheet-reply-clear" aria-label="Cancel reply">✕</button>`;
  form.insertBefore(chip, form.firstChild);
  chip.querySelector("#tl-sheet-reply-clear")?.addEventListener("click", (e) => {
    e.preventDefault();
    S.replyToMessage = null;
    chip.remove();
  });
}

function chatReplyEventMeta(msg) {
  const eventId = (typeof messageMentionedEventIds === "function"
    ? messageMentionedEventIds(msg)[0]
    : msg?.eventId) || "";
  if (!eventId) return { eventId: "", eventTitle: "" };
  let ev = null;
  if (typeof timelineFindEvent === "function") {
    try { ev = timelineFindEvent(eventId) || null; } catch { ev = null; }
  }
  if (!ev && typeof activeConn === "function") {
    ev = (activeConn()?.events || []).find((e) => e && e.id === eventId) || null;
  }
  const eventTitle = (ev && typeof eventDisplayTitle === "function" && eventDisplayTitle(ev))
    || ev?._title || ev?.title || "";
  return { eventId, eventTitle };
}

function setChatReplyTarget(ch, msg) {
  if (!ch || !msg?.id) {
    S.replyToMessage = null;
  } else {
    const dest = chatReplyEventMeta(msg);
    S.replyToMessage = {
      id: msg.id,
      name: msg.name || "",
      preview: chatReplyPreview(chatMessagePlaintext(msg) || shown(msg._text)),
      channelId: ch.id,
      eventId: dest.eventId || "",
      eventTitle: dest.eventTitle || "",
    };
    if (dest.eventId && !(typeof S !== "undefined" && S.boardChatHome)) {
      S.mentionedEventIds = [dest.eventId];
      S.taggedEventId = dest.eventId;
      const current = typeof S !== "undefined" ? S.conversationsThread?.eventId : "";
      if (current !== dest.eventId && typeof openConversationsEvent === "function") {
        openConversationsEvent(dest.eventId);
        return;
      }
    }
  }
  if (msg?.id && typeof S !== "undefined" && S.boardChatHome && typeof boardBeginContinue === "function") {
    boardBeginContinue(msg.id, { keepReply: true, focus: true });
    return;
  }
  const sheetOpen = document.getElementById("tl-sheet-host")?.classList.contains("open")
    && document.getElementById("tl-sheet-input");
  if (sheetOpen) {
    paintTimelineSheetReplyChip();
    try { document.getElementById("tl-sheet-input")?.focus(); } catch {}
    return;
  }
  const panel = document.getElementById("channel-panel-body");
  const view = (panel?.querySelector("#chat-scroll") && panel)
    || document.querySelector("#view");
  if (view && ch && typeof rerenderChatPreservingComposer === "function") {
    rerenderChatPreservingComposer(view, ch);
  }
}

function sendChatReaction(channelId, messageId, emoji, connId) {
  if (!channelId || !messageId || !emoji) return;
  send({ type: "reactMessage", channelId, messageId, emoji }, connId);
  try { CardFeel.reactionSent(); } catch {}
}

async function copyChatMessageText(msg) {
  const text = chatMessagePlaintext(msg);
  if (!text) {
    toast("Can't copy this message");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  } catch {
    toast("Couldn't copy");
  }
}

let _chatMsgOptions = null;

function chatOptionsHostForEl(el) {
  return el?.closest?.("#tl-sheet-host")
    || el?.closest?.("#channel-panel-body")
    || el?.closest?.("#view")
    || document.getElementById("tl-sheet-host")
    || document.getElementById("channel-panel-body")
    || document.getElementById("view");
}

function findArmedChatMessageEl(messageId) {
  const id = String(messageId || "");
  if (!id) return null;
  const roots = [
    document.getElementById("tl-sheet-host"),
    document.getElementById("channel-panel-body"),
    document.getElementById("view"),
  ].filter(Boolean);
  const seen = new Set();
  for (const root of roots) {
    if (seen.has(root)) continue;
    seen.add(root);
    const nodes = root.querySelectorAll(".msg[data-real-chat='1'], .edc-msg[data-real-chat='1']");
    for (const node of nodes) {
      if (node.dataset.msgId === id) return node;
    }
  }
  return null;
}

function chatMsgOptionsItem({ icon, label, danger = false, onClick }) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "people-more-item" + (danger ? " danger" : "");
  item.setAttribute("role", "menuitem");
  item.tabIndex = -1;
  item.innerHTML = `${typeof ic === "function" ? ic(icon) : ""}<span class="people-more-copy"><span>${esc(label)}</span></span>`;
  item.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick?.();
  });
  return item;
}

function chatMsgSheetRow({ icon, label, note = "", danger = false, chevron = false, split = false, onClick }) {
  const item = chatMsgOptionsItem({ icon, label, danger, onClick });
  item.classList.add("chat-msg-sheet-row");
  if (split) item.classList.add("is-split");
  if (note) item.classList.add("is-noted");
  item.tabIndex = 0;
  if (note) {
    const copy = item.querySelector(".people-more-copy");
    const hint = document.createElement("span");
    hint.className = "chat-msg-sheet-note";
    hint.textContent = note;
    copy?.appendChild(hint);
  }
  if (chevron && typeof ic === "function") {
    const chev = document.createElement("span");
    chev.className = "chat-msg-sheet-chev";
    chev.setAttribute("aria-hidden", "true");
    chev.innerHTML = ic("chevron-right", "ico-inline");
    item.appendChild(chev);
  }
  const hit = document.createElement("span");
  hit.className = "chat-msg-sheet-hit";
  hit.setAttribute("aria-hidden", "true");
  item.appendChild(hit);
  return item;
}

function finishChatMsgOptionsCleanup(state) {
  if (!state || state.cleaned) return;
  state.cleaned = true;
  try { state.observer?.disconnect(); } catch {}
  state.msgEl?.classList.remove("is-msg-armed");
  const host = state.host;
  if (host) {
    host._chatMsgToolbarOpen = false;
    host._chatInteractionActive = false;
    const pending = host._pendingChatRefresh;
    host._pendingChatRefresh = null;
    if (host.id === "tl-sheet-host") {
      if (pending && typeof timelinePatchOpenSheet === "function") timelinePatchOpenSheet();
    } else if (pending && typeof refreshActiveChatIncrementally === "function") {
      refreshActiveChatIncrementally(pending);
    }
  }
}

function closeChatMessageOptions(immediate) {
  const state = _chatMsgOptions;
  if (!state) return;
  const closeModal = state.closeModal;
  const overlay = state.overlay;
  if (!immediate && overlay?.isConnected && !overlay.classList.contains("is-closing")) {
    overlay.classList.add("is-closing");
    setTimeout(() => {
      try { closeModal?.(); } catch {}
    }, 200);
    return;
  }
  try { closeModal?.(); } catch {}
}

function chatMsgSheetHandleBack() {
  const state = _chatMsgOptions;
  if (!state) return false;
  if (state.view === "chains") {
    if (typeof boardLeaveChainSheet === "function") boardLeaveChainSheet(state);
    else paintChatMsgSheetHome(state);
    return true;
  }
  if (state.view === "move" || state.view === "organise") {
    paintChatMsgSheetHome(state);
    return true;
  }
  closeChatMessageOptions();
  return true;
}

function openChatDrawnReaction(state) {
  if (!state) return;
  const { ch, messageId, conn } = state;
  closeChatMessageOptions(true);
  if (typeof canUserDraw === "function" && !canUserDraw()) {
    try { toast("Drawing is turned off on this server"); } catch {}
    return;
  }
  if (typeof openDrawIconModal !== "function") return;
  openDrawIconModal({
    initialIcon: state.drawnOn ? state.myEmoji : null,
    onSave: (encoded) => sendChatReaction(ch.id, messageId, encoded, conn?.id),
  });
}

function paintChatMsgSheetHome(state) {
  const body = state?.body;
  if (!body) return;
  state.view = "home";
  const { ch, msg, messageId, conn } = state;
  body.replaceChildren();

  if (state.canReact) {
    const row = document.createElement("div");
    row.className = "chat-msg-sheet-reacts";
    row.setAttribute("role", "toolbar");
    row.setAttribute("aria-label", "Quick reactions");
    for (const em of CHAT_REACT_EMOJIS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chat-msg-react" + (state.myEmoji === em ? " on" : "");
      btn.dataset.em = em;
      btn.setAttribute("aria-label", em);
      if (state.myEmoji === em) btn.setAttribute("aria-pressed", "true");
      btn.textContent = em;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        sendChatReaction(ch.id, messageId, em, conn?.id);
        closeChatMessageOptions();
      });
      row.appendChild(btn);
    }
    if (state.canDrawReact && !(typeof S !== "undefined" && S.boardChatHome)) {
      const drawBtn = document.createElement("button");
      drawBtn.type = "button";
      drawBtn.className = "chat-msg-react chat-msg-react-draw";
      drawBtn.setAttribute("aria-label", "Draw");
      drawBtn.innerHTML = typeof ic === "function" ? ic("edit") : "";
      drawBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openChatDrawnReaction(state);
      });
      row.appendChild(drawBtn);
    }
    body.appendChild(row);
  }

  const boardHome = typeof S !== "undefined" && S.boardChatHome;
  const actions = document.createElement("div");
  actions.className = "chat-msg-sheet-actions";
  const add = (opts) => actions.appendChild(chatMsgSheetRow(opts));
  const addReply = () => {
    if (!state.canReply) return;
    add({
      icon: "reply",
      label: "Reply",
      onClick: () => {
        closeChatMessageOptions(true);
        setChatReplyTarget(ch, msg);
        const input = document.getElementById("tl-sheet-input")
          || document.querySelector("#composer-input");
        try { input?.focus(); } catch {}
      },
    });
  };
  const addCopy = () => {
    if (!state.canCopy) return;
    add({
      icon: "clipboard-copy",
      label: boardHome ? "Copy" : "Copy text",
      onClick: async () => {
        await copyChatMessageText(msg);
        closeChatMessageOptions();
      },
    });
  };
  const addUpdates = () => {
    for (const action of state.updateActions || []) {
      add({
        icon: action.icon || "calendar",
        label: action.label,
        onClick: () => {
          closeChatMessageOptions(true);
          if (typeof applyPlanUpdateToEvent === "function") {
            void applyPlanUpdateToEvent(state.contextEv, action.field, action.parsed, conn);
          }
        },
      });
    }
  };
  const addReport = () => {
    if (!state.canReportMsg) return;
    add({
      icon: "flag",
      label: "Report",
      onClick: () => {
        closeChatMessageOptions(true);
        openReportModal({
          targetType: "message",
          targetId: messageId,
          channelId: ch.id,
          targetLabel: "this message",
        });
      },
    });
  };
  const addDelete = () => {
    if (!state.canDelete) return;
    add({
      icon: "trash",
      label: boardHome ? "Delete message" : "Delete",
      danger: true,
      split: boardHome,
      onClick: () => {
        closeChatMessageOptions(true);
        snackbarOwnMessageDeleted({
          hide: () => hideLocalChatMessage(conn, ch.id, messageId),
          restore: restoreLocalChatMessage,
          commit: () => send({ type: "deleteMessage", channelId: ch.id, messageId }, conn?.id),
          refresh: () => refreshAfterOwnMessageDelete(ch.id),
        });
      },
    });
  };
  const addTurnIntoTask = () => {
    if (!state.canTurnIntoTask) return;
    add({
      icon: "check",
      label: "Turn into task",
      onClick: () => {
        closeChatMessageOptions(true);
        const text = (typeof chatMessagePlaintext === "function" ? chatMessagePlaintext(msg) : "")
          .trim()
          .slice(0, 500);
        if (!text || typeof commitChatTaskMessage !== "function") return;
        void commitChatTaskMessage({
          conn,
          chatChannel: ch,
          eventId: state.contextEv?.id || null,
          text,
          existingTask: null,
        });
      },
    });
  };
  if (boardHome) {
    addReply();
    addCopy();
    if (state.canDrawReact) {
      add({
        icon: "brush",
        label: "Draw",
        onClick: () => openChatDrawnReaction(state),
      });
    }
    addTurnIntoTask();
    addUpdates();
    addReport();
    addDelete();
  } else {
    addReply();
    addUpdates();
    if (state.canCreateFromMsg) {
      add({
        icon: "calendar",
        label: "Make this an event",
        onClick: () => {
          closeChatMessageOptions(true);
          if (typeof beginChatMoveSelect === "function") beginChatMoveSelect(ch, msg);
          else if (typeof openCreateDraftFromMessage === "function") openCreateDraftFromMessage(msg);
        },
      });
    }
    addTurnIntoTask();
    if (state.canAttach) {
      add({
        icon: "ticket",
        label: "Move to event",
        chevron: true,
        onClick: () => {
          state.moveMessageIds = null;
          paintChatMsgSheetMove(state);
        },
      });
    }
    addCopy();
    addReport();
    addDelete();
  }
  if (actions.childElementCount) body.appendChild(actions);
}

function chatMoveEventMetaLine(ev) {
  const date = typeof conversationEventListDate === "function"
    ? conversationEventListDate(ev)
    : (ev?.when && typeof fmtDay === "function" ? fmtDay(ev.when) : (ev?.when ? "" : "No date yet"));
  const time = ev?.when && typeof timelineTimeLabel === "function"
    ? timelineTimeLabel(ev, false)
    : "";
  return [date, time].filter(Boolean).join(" · ");
}

function chatMoveEventButton(ev, { on = false, onClick } = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "chat-msg-move-event" + (on ? " on" : "");
  if (ev?.id) btn.dataset.id = ev.id;
  const iconName = typeof eventIcon === "function" ? eventIcon(ev) : "calendar";
  let icoStyle = "";
  if (ev && typeof catStyleFor === "function") {
    try {
      const st = catStyleFor(ev);
      if (st?.accent) {
        icoStyle = `--chip-accent:${st.accent};--chip-tint:${st.tint || st.accent}`;
      }
    } catch {}
  }
  const title = typeof eventDisplayTitle === "function" ? eventDisplayTitle(ev) : "";
  const meta = chatMoveEventMetaLine(ev);
  btn.innerHTML = `<span class="chat-msg-move-event-ico"${icoStyle ? ` style="${icoStyle}"` : ""} aria-hidden="true">${typeof ic === "function" ? ic(iconName) : ""}</span>
    <span class="chat-msg-move-event-copy">
      <span class="chat-msg-move-event-title">${esc(title)}</span>
      <span class="chat-msg-move-event-meta">${esc(meta)}</span>
    </span>`;
  if (onClick) {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick(e);
    });
  }
  return btn;
}

function paintChatMsgSheetMove(state) {
  const body = state?.body;
  if (!body) return;
  state.view = "move";
  const { ch, messageId, conn, attachEvents, msg } = state;
  const list = conn?.messages?.[ch.id] || [];
  const relatedIds = typeof chatMoveRelatedIds === "function"
    ? chatMoveRelatedIds(list, messageId)
    : [messageId];
  const relatedExtra = relatedIds.filter((id) => id !== messageId);
  const current = typeof messageMentionedEventIds === "function"
    ? messageMentionedEventIds(state.msg)
    : (state.msg?.eventId ? [state.msg.eventId] : []);
  const batchIds = Array.isArray(state.moveMessageIds) && state.moveMessageIds.length
    ? state.moveMessageIds
    : null;
  const events = (attachEvents || []).slice(0, 24);
  body.replaceChildren();

  const head = document.createElement("div");
  head.className = "channel-settings-sheet-sub-head";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "channel-settings-sheet-back";
  back.setAttribute("aria-label", "Back");
  back.innerHTML = typeof ic === "function" ? ic("back") : "←";
  back.addEventListener("click", (e) => {
    e.preventDefault();
    paintChatMsgSheetHome(state);
  });
  const title = document.createElement("h5");
  title.className = "channel-settings-sheet-sub-title";
  title.textContent = "Move to event";
  head.append(back, title);
  body.appendChild(head);

  let includeRelated = !batchIds && relatedExtra.length > 0;
  if (batchIds) {
    const count = document.createElement("p");
    count.className = "chat-msg-move-count";
    count.textContent = `${batchIds.length} message${batchIds.length === 1 ? "" : "s"} selected`;
    body.appendChild(count);
  } else {
    const actions = document.createElement("div");
    actions.className = "chat-msg-sheet-actions";
    actions.appendChild(chatMsgSheetRow({
      icon: "square-check",
      label: "Multi-select",
      chevron: true,
      onClick: () => {
        closeChatMessageOptions(true);
        if (typeof beginChatMoveSelect === "function") {
          beginChatMoveSelect(ch, msg, { purpose: "attach", attachEvents });
        }
      },
    }));
    if (relatedExtra.length) {
      const relatedRow = chatMsgSheetRow({
        icon: "messages-square",
        label: `Move related messages (${relatedExtra.length + 1})`,
        onClick: () => {
          includeRelated = !includeRelated;
          relatedRow.classList.toggle("is-on", includeRelated);
          relatedRow.setAttribute("aria-pressed", includeRelated ? "true" : "false");
        },
      });
      relatedRow.classList.add("is-on");
      relatedRow.setAttribute("aria-pressed", "true");
      actions.appendChild(relatedRow);
    }
    body.appendChild(actions);
  }

  const listEl = document.createElement("div");
  listEl.className = "chat-msg-move-list";
  if (!events.length) {
    const empty = document.createElement("p");
    empty.className = "empty-note";
    empty.textContent = "No upcoming events";
    listEl.appendChild(empty);
  } else {
    for (const ev of events) {
      listEl.appendChild(chatMoveEventButton(ev, {
        on: current.includes(ev.id),
        onClick: () => {
          const ids = batchIds
            || (includeRelated && relatedIds.length ? relatedIds : [messageId]);
          if (typeof attachChatMessagesToEvent === "function") {
            attachChatMessagesToEvent(ch.id, ids, ev.id, conn);
          }
          closeChatMessageOptions();
        },
      }));
    }
  }
  body.appendChild(listEl);
}

function openChatMessageOptions(ch, messageId, ownerConn, opts = {}) {
  if (!ch || !messageId) return;
  if (!opts.view && _chatMsgOptions?.messageId === messageId && _chatMsgOptions.overlay?.isConnected
      && !_chatMsgOptions.overlay.classList.contains("is-closing")) {
    closeChatMessageOptions();
    return;
  }
  closeChatMessageOptions(true);
  const conn = ownerConn || activeConn();
  const msg = (conn?.messages?.[ch.id] || []).find(m => m.id === messageId);
  if (!msg || msg.activity) return;
  const msgEl = findArmedChatMessageEl(messageId);
  const meId = conn?.me?.id || S.me?.id;
  const writable = typeof canMutateContent === "function" && canMutateContent(conn);
  const canReply = writable;
  const canReact = writable;
  const canCopy = !!chatMessagePlaintext(msg);
  const canReportMsg = !!(msg.userId && msg.userId !== meId
    && typeof canReport === "function" && canReport());
  const canDelete = canDeleteChatMessage(msg, conn);
  const myEmoji = msg.reactions?.[meId] || "";
  const canDrawReact = canReact && (typeof canUserDraw !== "function" || canUserDraw());
  const drawnOn = !!(myEmoji && typeof isDrawnIcon === "function" && isDrawnIcon(myEmoji));
  const plaintext = typeof chatMessagePlaintext === "function" ? chatMessagePlaintext(msg) : "";
  const contextEv = typeof chatMessageEventContext === "function"
    ? chatMessageEventContext({ msgEl, ownerConn: conn, ch })
    : null;
  const inEventScope = !!contextEv;
  const canCreateFromMsg = !inEventScope
    && typeof canCreateEvents === "function" && canCreateEvents()
    && !!plaintext;
  const canTurnIntoTask = !!(writable
    && plaintext
    && !msg.taskId
    && typeof boardTaskChannelForChat === "function"
    && boardTaskChannelForChat(ch, conn));
  let attachEvents = [];
  if (!inEventScope && writable) {
    attachEvents = (typeof conversationFeedPickerEvents === "function")
      ? conversationFeedPickerEvents()
      : (conn?.events || []).filter(ev => ev && !ev.chainOf);
  }
  const canAttach = !inEventScope && writable && attachEvents.length > 0;
  const canUpdateThisEvent = !!(inEventScope && plaintext
    && typeof canEditEvent === "function" && canEditEvent(contextEv, conn));
  const updateActions = (canUpdateThisEvent && typeof planUpdateActionsForEvent === "function")
    ? planUpdateActionsForEvent(plaintext, contextEv)
    : [];
  const boardHome = typeof S !== "undefined" && S.boardChatHome;
  if (!canReact && !canReply && !canCopy && !canReportMsg && !canDelete
      && !canCreateFromMsg && !canTurnIntoTask && !canAttach && !updateActions.length && !boardHome) return;

  const host = chatOptionsHostForEl(msgEl);
  const state = {
    messageId, ch, msg, msgEl, conn, meId, myEmoji,
    canReply, canReact, canDrawReact, drawnOn, canCopy, canReportMsg, canDelete,
    canCreateFromMsg, canTurnIntoTask, canAttach, attachEvents, updateActions, contextEv,
    view: "home", overlay: null, card: null, body: null, closeModal: null,
    host, observer: null, moveMessageIds: opts.moveMessageIds || null,
  };

  const opened = typeof AshModal !== "undefined" && AshModal.open
    ? AshModal.open({
      className: "channel-settings-sheet chat-msg-sheet",
      html: `<div class="channel-settings-sheet-card chat-msg-sheet-card" tabindex="-1" role="dialog" aria-modal="true" aria-label="Message actions">
        <div class="channel-settings-sheet-handle" aria-hidden="true"></div>
        <div class="chat-msg-sheet-body"></div>
      </div>`,
      singleton: "replace",
      graceMs: 280,
      closeOnEscape: false,
      closeOnBackdrop: true,
      trapFocus: true,
      initialFocus: ".chat-msg-sheet-card",
      onClose: () => {
        if (_chatMsgOptions === state) _chatMsgOptions = null;
        finishChatMsgOptionsCleanup(state);
      },
    })
    : null;
  if (!opened) return;
  const { overlay, close } = opened;
  overlay.addEventListener("selectstart", (e) => e.preventDefault());
  if (window._chatMsgPointerDown) {
    overlay.classList.add("is-opening-press");
    const releaseOpeningPress = () => {
      overlay.classList.remove("is-opening-press");
      window.removeEventListener("pointerup", releaseOpeningPress, true);
      window.removeEventListener("pointercancel", releaseOpeningPress, true);
    };
    window.addEventListener("pointerup", releaseOpeningPress, true);
    window.addEventListener("pointercancel", releaseOpeningPress, true);
  }
  const card = overlay.querySelector(".chat-msg-sheet-card");
  const body = overlay.querySelector(".chat-msg-sheet-body");
  let closed = false;
  const closeModal = () => {
    if (closed) return;
    closed = true;
    close();
  };
  state.overlay = overlay;
  state.card = card;
  state.body = body;
  state.closeModal = closeModal;
  _chatMsgOptions = state;

  msgEl?.classList.add("is-msg-armed");
  if (host) {
    host._chatMsgToolbarOpen = true;
    host._chatInteractionActive = true;
  }
  if (msgEl) {
    const observer = new MutationObserver(() => {
      if (!msgEl.isConnected) closeChatMessageOptions(true);
    });
    try { observer.observe(msgEl.parentNode || msgEl, { childList: true }); } catch {}
    state.observer = observer;
  }

  if (opts.view === "chains" && typeof boardPaintChainSheet === "function") boardPaintChainSheet(state);
  else if (opts.view === "move" && canAttach) paintChatMsgSheetMove(state);
  else paintChatMsgSheetHome(state);
  if (card && typeof bindBoardSettingsSheetDismiss === "function") {
    bindBoardSettingsSheetDismiss(card, () => closeChatMessageOptions(true));
  }
}

/** Open event-scoped chat. Live events use the Timeline pull-up; there is no
 *  channel-global thread to go back to. Description / memory feeds stay in-panel. */
function openEventChatFiltered(channelId, eventId, opts = {}) {
  let chId = channelId || null;
  if (!chId && eventId) {
    const hit = resolveEventForPanelFeed(eventId);
    chId = hit?.ev?.channelId
      || (hit?.owner?.channels || []).find(c => c.kind === "event")?.id
      || null;
  }

  let sub = normalizeEdcTab(opts.tab) || "chat";
  const onTimelineFeed = !!(eventId && typeof timelineEventsById !== "undefined"
    && timelineEventsById && timelineEventsById.get(eventId));
  if (sub === "chat" && eventId && typeof openEventConversation === "function") {
    const live = !opts.readOnly && !opts.fromMemories;
    if (live || (opts.fromMemories && onTimelineFeed)) {
      openEventConversation(eventId, "chat");
      return;
    }
  }

  const conn = activeConn();
  const personal = PersonalSpace.isPersonal(conn);
  const chatLocked = personal
    && typeof personalPanelChatUnlocked === "function"
    && !personalPanelChatUnlocked();
  // Personal without linked chat: still allow Description (notes). Chat stays locked.
  if (chatLocked && sub === "chat") {
    if (eventId) {
      sub = "description";
    } else {
      S.chatFilterEventId = null;
      S.mentionedEventIds = [];
      S.taggedEventId = null;
      S.autoTagEventId = null;
      S.memoryChatReadonly = false;
      try {
        if (typeof openPersonalNotificationsBoard === "function") {
          openPersonalNotificationsBoard();
        } else {
          renderView();
        }
      } catch {
        try { renderView(); } catch {}
      }
      return;
    }
  }

  const hitForPast = eventId && typeof resolveEventForPanelFeed === "function"
    ? resolveEventForPanelFeed(eventId) : null;
  const openingPast = !!(hitForPast?.ev && typeof isEventPastDay === "function"
    && isEventPastDay(hitForPast.ev));
  // Memories / explicit read-only: past events stay filterable with composer locked.
  S.memoryChatReadonly = !!(opts.readOnly || openingPast && opts.fromMemories);

  // Personal-only events: no writable chat — open Description instead of Chat.
  // Past memory chat is read-only but still lands on Chat.
  if (personal && eventId && sub === "chat" && !S.memoryChatReadonly) {
    const hit = hitForPast;
    if (hit?.ev && typeof eventHasPanelChat === "function" && !eventHasPanelChat(hit.ev)) {
      sub = "description";
    }
  }

  S.chatFilterEventId = eventId || null;
  S.mentionedEventIds = eventId ? [eventId] : [];
  S.taggedEventId = eventId || null;
  S.autoTagEventId = null;
  S._edcTab = sub;
  if (S.activeView?.surface === "chat") {
    delete S.activeView.surface;
    delete S.activeView.chatFrom;
  }
  try {
    // Pass eventId so openChannelPanelMode keeps the filter; description/activity via wantTab.
    openChannelPanelMode("info", chId, {
      tab: sub === "chat" ? "chat" : sub,
      eventId: eventId || null,
    });
  } catch {
    try { renderView(); } catch {}
  }
  if (eventId) {
    // After panel open layout settles, park the timeline on this event.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try { focusTimelineOnPanelEvent(eventId); } catch {}
      });
    });
  }
}

/** Map legacy "notes" tab id → "description"; return null if unknown. */
function normalizeEdcTab(tab) {
  if (tab === "notes") return "description";
  if (tab === "chat" || tab === "description" || tab === "activity") return tab;
  return null;
}

function isEdcListTab(tab) {
  const t = normalizeEdcTab(tab) || tab;
  return t === "description" || t === "activity";
}

/** Panel tabs that host Chat / Description / Activity feeds. */
function isPanelFeedTab(tab) {
  return !!normalizeEdcTab(tab);
}

function clearPanelEventChatFilter() {
  S.chatFilterEventId = null;
  S.mentionedEventIds = [];
  S.taggedEventId = null;
  S.autoTagEventId = null;
  S.memoryChatReadonly = false;
}

/**
 * When the right panel filters Chat/Description to an event, park the timeline
 * focus band on that ticket (works while the panel stays open).
 */
function focusTimelineOnPanelEvent(eventId) {
  if (!eventId) return;
  const hit = typeof resolveEventForPanelFeed === "function"
    ? resolveEventForPanelFeed(eventId)
    : null;
  let ev = hit?.ev || null;
  if (!ev) {
    const g = typeof group === "function" ? group() : null;
    ev = (g?.events || []).find(e => e.id === eventId) || null;
  }
  if (!ev) return;

  if (ev._availability) {
    if (ev.when && typeof dayStart === "function") {
      S.anchor = dayStart(ev.when);
      S.viewingHistory = false;
    }
    const view = document.getElementById("view");
    const findAvail = () => document.querySelector(
      `#ticket-list [data-avail-id="${CSS.escape(eventId)}"], .avail-row[data-avail-id="${CSS.escape(eventId)}"]`,
    );
    let el = findAvail();
    if (!el && typeof renderEvents === "function" && S.activeView?.kind !== "eventDetail") {
      try {
        const g = typeof group === "function" ? group() : null;
        const kind = S.activeView?.kind;
        const channel = kind === "channel"
          ? (g?.channels || []).find(c => c.id === S.activeView.id)
          : null;
        if (g && view && typeof showEventsModeTabs === "function"
            && (kind === "events" || channel?.kind === "event")) {
          showEventsModeTabs();
        }
        if (g && view) renderEvents(view, g, channel?.kind === "event" ? channel : undefined);
        el = findAvail();
      } catch {}
    }
    if (el && typeof el.scrollIntoView === "function") {
      try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch {}
    }
    return;
  }

  const key = `ev:${eventId}`;
  if (ev.when && typeof dayStart === "function") {
    S.anchor = dayStart(ev.when);
    S.viewingHistory = false;
  }

  const g = typeof group === "function" ? group() : null;
  const view = document.getElementById("view");
  if (!g || !view) return;

  const kind = S.activeView?.kind;
  const channel = kind === "channel"
    ? (g.channels || []).find(c => c.id === S.activeView.id)
    : null;
  const onAgenda = kind === "events" || kind === "eventDetail"
    || (channel && channel.kind === "event");
  if (!onAgenda) return;

  const findTicket = () => document.querySelector(
    `#ticket-list [data-focus-key="${CSS.escape(key)}"]`,
  );

  let el = findTicket();
  if (!el && typeof renderEvents === "function" && kind !== "eventDetail") {
    try {
      if (typeof showEventsModeTabs === "function"
          && (kind === "events" || channel?.kind === "event")) {
        showEventsModeTabs();
      }
      renderEvents(view, g, channel?.kind === "event" ? channel : undefined);
      el = findTicket();
    } catch (err) {
      console.warn(err);
    }
  }

  if (!el) return;

  const sc = view.querySelector(".events-scroll");
  if (typeof setFocus === "function") {
    setFocus(key, el);
  } else {
    document.querySelectorAll("#ticket-list .focused").forEach(e => e.classList.remove("focused"));
    el.classList.add("focused");
  }
  if (sc && typeof bandY === "function") {
    sc.scrollBy({
      top: (el.getBoundingClientRect().top + el.offsetHeight / 2) - bandY(),
    });
  }
  try { if (typeof updateWeekIndicator === "function") {
    updateWeekIndicator(el.dataset.when ? Number(el.dataset.when) : null);
  } } catch {}
}

/** Resolve an event (+ owner conn) for the panel event feed. */
function resolveEventForPanelFeed(eventId) {
  const id = eventId || S.chatFilterEventId;
  if (!id) return null;
  const tryConn = (conn) => {
    if (!conn) return null;
    let ev = (conn.events || []).find(e => e.id === id);
    if (!ev) {
      const avail = (conn.availabilities || []).find(a => a.id === id);
      if (avail && typeof availabilityAsChatEvent === "function") {
        ev = availabilityAsChatEvent(avail, conn);
      }
    }
    if (!ev && typeof archivedEventsFor === "function") {
      try { ev = archivedEventsFor(conn).find(e => e.id === id); } catch {}
    }
    return ev ? { ev, owner: conn } : null;
  };
  const active = activeConn();
  const fromActive = tryConn(active);
  if (fromActive) {
    const owner = (typeof ownerConnFor === "function" ? ownerConnFor(fromActive.ev) : null) || fromActive.owner;
    return { ev: fromActive.ev, owner };
  }
  for (const conn of Object.values(S.conns || {})) {
    const hit = tryConn(conn);
    if (hit) return hit;
  }
  return null;
}

/** Event for panel Chat | Notes | Activity — only when an explicit filter is set. */
function resolveEventForPanelChat(ch) {
  if (!S.chatFilterEventId) return null;
  const hit = resolveEventForPanelFeed(S.chatFilterEventId);
  if (!hit) return null;
  if (ch && hit.ev.channelId && hit.ev.channelId !== ch.id && ch.kind !== "event") return null;
  return hit;
}

function panelEventFeedHost() {
  if (!Panel.channelOpen()) return null;
  const st = Panel.channelState();
  if (!st || !isPanelFeedTab(st.tab)) return null;
  if (!S.chatFilterEventId) return null;
  return document.querySelector("#channel-panel-body .panel-event-feed");
}

function rerenderChatPreservingComposer(view, ch) {
  if (typeof S !== "undefined" && S._chatJustSent) return;
  const input = view.querySelector("#composer-input");
  const active = document.activeElement === input;
  const snapshot = input ? {
    value: input.value,
    selectionStart: input.selectionStart,
    selectionEnd: input.selectionEnd,
    active,
  } : null;
  renderChat(view, ch, true);
  const freshInput = view.querySelector("#composer-input");
  if (!snapshot || !freshInput) return;
  freshInput.value = snapshot.value;
  if (snapshot.active) {
    freshInput.focus();
    const start = Math.min(snapshot.selectionStart ?? snapshot.value.length, freshInput.value.length);
    const end = Math.min(snapshot.selectionEnd ?? snapshot.value.length, freshInput.value.length);
    freshInput.setSelectionRange(start, end);
  }
}

function markChatJustSent() {
  if (typeof S === "undefined") return;
  S._chatJustSent = true;
  clearTimeout(S._chatJustSentTimer);
  S._chatJustSentTimer = setTimeout(() => {
    S._chatJustSent = false;
    S._chatJustSentTimer = 0;
  }, 1500);
}

function clearLiveChatComposer(view) {
  const live = view && view.querySelector && view.querySelector("#composer-input");
  if (!live) return null;
  live.value = "";
  try { live.setSelectionRange(0, 0); } catch {}
  const suggest = view.querySelector && view.querySelector("#tag-suggest");
  if (suggest) suggest.hidden = true;
  return live;
}

function pinChatScrollToLatest(view) {
  const scroll = view && view.querySelector && view.querySelector("#chat-scroll");
  if (!scroll) return;
  const pin = () => { scroll.scrollTop = scroll.scrollHeight; };
  pin();
  requestAnimationFrame(() => {
    pin();
    requestAnimationFrame(pin);
  });
  clearTimeout(scroll._pinLatestTimer);
  scroll._pinLatestTimer = setTimeout(pin, 280);
}

function finishChatComposerSend(view, ch) {
  markChatJustSent();
  clearLiveChatComposer(view);
  if (typeof clearComposerEventTags === "function") clearComposerEventTags();
  if (typeof S !== "undefined") {
    S.mentionedUserIds = [];
    S.replyToMessage = null;
    if (S.chatFilterEventId) S.mentionedEventIds = [S.chatFilterEventId];
  }
  if (typeof boardReleaseContinuationAfterSend === "function") boardReleaseContinuationAfterSend();
  if (typeof renderChat === "function") renderChat(view, ch);
  const fresh = clearLiveChatComposer(view);
  if (fresh) {
    try { fresh.focus(); } catch {}
  }
  if (typeof S !== "undefined") S.boardSuppressComposerLock = false;
  pinChatScrollToLatest(view);
}

function reconcileChatRows(scroll, rows, followLatest) {
  const template = document.createElement("template");
  template.innerHTML = rows.join("");
  const existing = new Map(
    [...scroll.children].filter(el => el.dataset.chatKey).map(el => [el.dataset.chatKey, el]),
  );
  const next = document.createDocumentFragment();
  for (const incoming of [...template.content.children]) {
    const key = incoming.dataset.chatKey;
    const current = key ? existing.get(key) : null;
    // Keep identity for unchanged rows (selection, accessibility focus, and paint
    // caches survive); replace only rows whose rendered content actually changed.
    next.appendChild(current && current.outerHTML === incoming.outerHTML ? current : incoming);
  }
  scroll.replaceChildren(next);
  if (followLatest) scroll.scrollTop = scroll.scrollHeight;
}

function panelChatHost() {
  if (!Panel.channelOpen()) return null;
  const st = Panel.channelState();
  if (!st || st.tab !== "chat") return null;
  return document.getElementById("channel-panel-body");
}

function refreshActiveChatIncrementally(channelId) {
  const conn = activeConn();
  const ch = (conn?.channels || []).find(item => item.id === channelId);
  if (!ch) return false;

  const panelBody = panelChatHost();
  if (panelBody && Panel.channelState()?.channelId === channelId) {
    // Filtered Description/Activity still use the event feed; Chat keeps channel styling.
    if (S.chatFilterEventId) {
      const feedTab = (typeof normalizeEdcTab === "function" && normalizeEdcTab(S._edcTab)) || S._edcTab || "chat";
      if (feedTab !== "chat") {
        if (typeof refreshPanelEventFeed === "function" && refreshPanelEventFeed(S.chatFilterEventId)) {
          return true;
        }
        if (typeof clearPanelEventChatFilter === "function") clearPanelEventChatFilter();
      }
    }
    const edcTab = (typeof isEdcListTab === "function" && isEdcListTab(S._edcTab))
      ? ((typeof normalizeEdcTab === "function" && normalizeEdcTab(S._edcTab)) || S._edcTab)
      : "chat";
    if (edcTab !== "chat" && typeof mountPanelChannelFeed === "function") {
      mountPanelChannelFeed(panelBody, ch, { tab: edcTab });
      return true;
    }
    if (panelBody._chatInteractionActive || panelBody._chatMsgToolbarOpen) {
      panelBody._pendingChatRefresh = channelId;
      if (!panelBody._chatRefreshTimer) {
        panelBody._chatRefreshTimer = setTimeout(() => {
          panelBody._chatRefreshTimer = 0;
          const pending = panelBody._pendingChatRefresh;
          panelBody._pendingChatRefresh = null;
          if (pending) refreshActiveChatIncrementally(pending);
        }, 90);
      }
      return true;
    }
    const chatHost = panelBody.querySelector("#panel-chat-pane") || panelBody;
    if (!panelBody.querySelector("#panel-chat-pane") && typeof mountPanelChannelFeed === "function") {
      mountPanelChannelFeed(panelBody, ch, { tab: "chat" });
      return true;
    }
    renderChat(chatHost, ch, true);
    return true;
  }

  const active = S.activeView;
  const isChat = active?.kind === "channel" && active.id === channelId
    && (ch?.kind !== "event" || active.surface === "chat");
  const view = $("#view");
  if (!isChat || !view) return false;
  if (view._chatInteractionActive || view._chatMsgToolbarOpen) {
    view._pendingChatRefresh = channelId;
    if (!view._chatRefreshTimer) {
      view._chatRefreshTimer = setTimeout(() => {
        view._chatRefreshTimer = 0;
        const pending = view._pendingChatRefresh;
        view._pendingChatRefresh = null;
        if (pending) refreshActiveChatIncrementally(pending);
      }, 90);
    }
    return true;
  }
  renderChat(view, ch, true);
  return true;
}
