/* channel-chat-part2.js — split from channel-chat.js (Part 3 size ceiling).
 * Load after: channel-chat-part1.js; part of channel-chat cluster.
 */

/** People the composer may @ in this channel (visible here, not blocked). */
function chatMentionableMembers(ch, conn = activeConn()) {
  const list = typeof channelMemberList === "function"
    ? channelMemberList(ch, conn)
    : [...(conn?.members || (typeof S !== "undefined" && S.members) || [])];
  return list.filter(u => u?.id && !(typeof isBlocked === "function" && isBlocked(u.id)));
}

function applyChatFeedFilter(view, ch, pick, eventId) {
  if (typeof closeConversationFeedPicker === "function") closeConversationFeedPicker();
  if (pick === "untagged" || pick === "all" || (!eventId && pick !== "event")) {
    S.conversationsThread = null;
    S.chatFilterEventId = null;
    S.chatFilterUntagged = true;
    S.memoryChatReadonly = false;
    S.mentionedEventIds = [];
    S.taggedEventId = null;
    S.autoTagEventId = null;
  } else if (eventId) {
    S.conversationsThread = { eventId, tab: "chat" };
    S.chatFilterUntagged = false;
    S.chatFilterEventId = eventId;
    S.memoryChatReadonly = false;
    S.mentionedEventIds = [eventId];
    S.taggedEventId = eventId;
    S.autoTagEventId = null;
  }
  renderChat(view, ch);
}

function renderChat(view, ch, keepScroll) {
  const perfStarted = typeof AshPerf !== "undefined" ? AshPerf.begin("renderChat") : 0;
  const g = typeof group === "function" ? group() : null;
  const conn = activeConn();
  try { markChannelRead(conn, ch.id); } catch {}
  const mentionableMembers = chatMentionableMembers(ch, conn);
  const mentionableUserIds = new Set(mentionableMembers.map(u => u.id));
  S.mentionedUserIds = (S.mentionedUserIds || []).filter(id => mentionableUserIds.has(id));
  if (S.replyToMessage && S.replyToMessage.channelId !== ch.id) S.replyToMessage = null;
  // Same event set as the agenda timeline (home + linked feeds).
  const viewEvents = (typeof channelEventsForPanelChat === "function"
    ? channelEventsForPanelChat(ch)
    : (conn?.events || []).filter(e => !ch || ch.kind !== "event" || e.channelId === ch.id))
    .slice()
    .sort((a, b) => (a.when || 0) - (b.when || 0));
  const allEvents = viewEvents;
  // Composer tags stay on home-channel events (writable on this conn); past → Memories.
  const homeEvents = allEvents.filter(e =>
    e.channelId === ch.id && (!e._connId || e._connId === conn?.id) && !e._linked
    && (typeof isMainViewEvent !== "function" || isMainViewEvent(e)));
  let taggableEvents = (homeEvents.length ? homeEvents : allEvents.filter(e =>
    !e._linked && (typeof isMainViewEvent !== "function" || isMainViewEvent(e))));

  const requireMirrorAttach = typeof personalChatRequiresMirrorAttach === "function"
    && personalChatRequiresMirrorAttach(ch);
  const autoRouteMirror = typeof personalChatAutoRoutesMirror === "function"
    && personalChatAutoRoutesMirror(ch);
  const useMirrorTargets = requireMirrorAttach || autoRouteMirror;
  const mirrorBundle = (useMirrorTargets && typeof taggableMirrorTargetsForPersonalChat === "function")
    ? taggableMirrorTargetsForPersonalChat(ch.id)
    : { chats: [], events: [] };
  const mirrorEvents = mirrorBundle.events || [];
  const mirrorEventById = new Map(mirrorEvents.map(e => [e.id, e]));
  if (useMirrorTargets) {
    taggableEvents = [...mirrorEvents];
  }

  if (S.taggedMirrorChatKey && typeof mirroredChatTagTargets === "function") {
    const ok = mirroredChatTagTargets(ch.id).some(t => t.key === S.taggedMirrorChatKey);
    if (!ok) S.taggedMirrorChatKey = null;
  }

  const isWelcome = typeof isWelcomeLobby === "function" && isWelcomeLobby(ch);
  if (!isWelcome && S.conversationsThread?.eventId) {
    S.chatFilterEventId = S.conversationsThread.eventId;
    S.chatFilterUntagged = false;
  }
  if (S.chatFilterEventId) {
    let fe = allEvents.find(e => e.id === S.chatFilterEventId)
      || mirrorEventById.get(S.chatFilterEventId)
      || null;
    if (!fe && S.memoryChatReadonly && typeof resolveEventForPanelFeed === "function") {
      try { fe = resolveEventForPanelFeed(S.chatFilterEventId)?.ev || null; } catch {}
    }
    const pastBlocked = fe && typeof isEventPastDay === "function" && isEventPastDay(fe)
      && !S.memoryChatReadonly && !S.conversationsThread?.eventId;
    const doneHere = !!(fe && S.boardChatHome && typeof boardEventCompleted === "function" && boardEventCompleted(fe)
      && !S.memoryChatReadonly && !S.conversationsThread?.eventId);
    if (!fe || pastBlocked || doneHere) {
      S.chatFilterEventId = null;
      if (pastBlocked) S.memoryChatReadonly = false;
      if (doneHere) {
        S.boardArchive = true;
        S.boardArchiveEventId = fe.id;
      }
    }
  }
  S.mentionedEventIds = (S.mentionedEventIds || []).filter(id => {
    if (mirrorEventById.has(id)) return true;
    if (useMirrorTargets) return false;
    const e = allEvents.find(x => x.id === id);
    return e && (typeof isMainViewEvent !== "function" || isMainViewEvent(e) || (S.memoryChatReadonly && id === S.chatFilterEventId))
      && !(S.boardChatHome && typeof boardEventCompleted === "function" && boardEventCompleted(e));
  });
  if (S.taggedEventId) {
    if (mirrorEventById.has(S.taggedEventId)) {
      /* keep remote mirror tag */
    } else if (useMirrorTargets) {
      S.taggedEventId = null;
    } else {
      const te = allEvents.find(e => e.id === S.taggedEventId);
      if (!te || (typeof isMainViewEvent === "function" && !isMainViewEvent(te) && !(S.memoryChatReadonly && te.id === S.chatFilterEventId))
        || (S.boardChatHome && typeof boardEventCompleted === "function" && boardEventCompleted(te))) {
        S.taggedEventId = null;
      }
    }
  }
  if (S.autoTagEventId) {
    if (mirrorEventById.has(S.autoTagEventId)) {
      /* keep */
    } else if (useMirrorTargets) {
      S.autoTagEventId = null;
    } else {
      const ae = allEvents.find(e => e.id === S.autoTagEventId);
      if (!ae || (typeof isMainViewEvent === "function" && !isMainViewEvent(ae))
        || (S.boardChatHome && typeof boardEventCompleted === "function" && boardEventCompleted(ae))) S.autoTagEventId = null;
    }
  }

  const filterEv = isWelcome ? null : (allEvents.find(e => e.id === S.chatFilterEventId)
    || mirrorEventById.get(S.chatFilterEventId)
    || null);
  if (filterEv) S.chatFilterUntagged = false;
  const mentionIds = composerMentionedEventIds();
  const mentionEvents = mentionIds
    .map(id => allEvents.find(e => e.id === id) || mirrorEventById.get(id))
    .filter(Boolean);
  const taggedMirrorTarget = (S.taggedMirrorChatKey && typeof mirroredChatTagTargets === "function")
    ? mirroredChatTagTargets(ch.id).find(t => t.key === S.taggedMirrorChatKey) || null
    : null;
  const mentionedNames = (S.mentionedUserIds || []).map(id => nameOf(id));
  const prevTop = keepScroll ? view.querySelector("#chat-scroll")?.scrollTop : null;
  const priorComposer = keepScroll ? (() => {
    const el = view.querySelector("#composer-input");
    return el ? {
      value: el.value,
      start: el.selectionStart,
      end: el.selectionEnd,
      focused: document.activeElement === el,
    } : null;
  })() : null;

  const inPanel = (() => {
    if (view?.dataset?.panelChat === "1") return true;
    if (view?.closest?.("#channel-panel, .channel-panel, [data-panel-chat='1']")) return true;
    if (view?.id === "panel-chat-pane" || view?.classList?.contains?.("panel-chat-pane")) return true;
    try {
      const body = document.getElementById("channel-panel-body");
      if (body && view && (body === view || body.contains(view))) return true;
    } catch {}
    return false;
  })();
  const eventThreadOn = !inPanel && !isWelcome && !!S.conversationsThread?.eventId;
  const isFeedFilters = !inPanel && !eventThreadOn && ch.kind === "chat" && !isWelcome;
  const convChatHeader = !inPanel && !isWelcome && ch.kind === "chat";
  const convExplicitScope = !inPanel && ch.kind === "chat" && !isWelcome;
  if (convChatHeader && typeof S !== "undefined") S.boardChatHome = true;
  const boardFeed = !!(typeof S !== "undefined" && S.boardChatHome && !eventThreadOn && !inPanel && !isWelcome && ch.kind === "chat");
  if (boardFeed) boardDestinationEnter(ch.id);
  if (isFeedFilters && !filterEv && !boardFeed) S.chatFilterUntagged = true;
  if (boardFeed && !filterEv) S.chatFilterUntagged = false;
  const untaggedOn = !isWelcome && !filterEv && !!S.chatFilterUntagged;
  if (!untaggedOn && typeof S !== "undefined" && S.chatMoveSelect) S.chatMoveSelect = null;

  const rawMsgs = collatedChatMessages(ch);
  let msgs = rawMsgs;
  if (filterEv) {
    if (convExplicitScope && typeof messageMentionedEventIds === "function") {
      msgs = rawMsgs.filter(m => messageMentionedEventIds(m).includes(filterEv.id));
    } else if (typeof messagesInEventScope === "function") {
      msgs = messagesInEventScope(rawMsgs, filterEv.id);
    }
  } else if (untaggedOn) {
    msgs = (typeof conversationGeneralFeedItems === "function")
      ? conversationGeneralFeedItems(rawMsgs, [...allEvents, ...mirrorEvents])
      : (typeof messagesNotAttachedToEvent === "function"
        ? messagesNotAttachedToEvent(rawMsgs)
        : rawMsgs);
  } else if (typeof assignChatRunningScopes === "function") {
    assignChatRunningScopes(msgs, new Map([...allEvents, ...mirrorEvents].map(e => [e.id, e])));
  }

  const threadTab = eventThreadOn && typeof conversationThreadTab === "function"
    ? conversationThreadTab()
    : (eventThreadOn ? (S.conversationsThread.tab || "chat") : "chat");
  const hideChatBody = eventThreadOn && threadTab !== "chat";

  // Right-sidebar Chat: offer every event as a filter, even with no messages yet.
  let railEvents = typeof chatRailEvents === "function"
    ? chatRailEvents(rawMsgs, allEvents, inPanel ? 48 : 12, { includeAll: inPanel || ch.kind === "chat" })
    : (inPanel ? allEvents.slice().sort((a, b) => (a.when || 0) - (b.when || 0)).slice(0, 48) : []);
  if (filterEv && !railEvents.some(ev => ev.id === filterEv.id)) {
    railEvents = [filterEv, ...railEvents];
  }
  const pickerEvents = convChatHeader && typeof conversationFeedPickerEvents === "function"
    ? conversationFeedPickerEvents(railEvents)
    : [];
  if (conn?.id && ch?.id && (convChatHeader || !eventThreadOn)) {
    for (const ev of railEvents) {
      try { seedEventChatFilterSeen(conn, ch.id, ev.id, rawMsgs); } catch {}
    }
    if (filterEv) {
      try { markEventChatFilterSeen(conn, ch.id, filterEv.id, rawMsgs); } catch {}
      if (inPanel && typeof refreshTicketPeopleRow === "function") {
        try { refreshTicketPeopleRow(filterEv.id); } catch {}
      }
    } else if (isFeedFilters) {
      const gid = typeof CHAT_GENERAL_SEEN_ID !== "undefined" ? CHAT_GENERAL_SEEN_ID : "__general__";
      try { seedEventChatFilterSeen(conn, ch.id, gid, rawMsgs); } catch {}
      try { markEventChatFilterSeen(conn, ch.id, gid, rawMsgs); } catch {}
    }
  }
  const onPersonal = PersonalSpace.isPersonal(conn);
  const notesMode = ch.kind !== "task"
    && typeof conversationBoardIsPersonalOnly === "function"
    && conversationBoardIsPersonalOnly(ch, conn);
  const personalPanel = inPanel && onPersonal;
  // Personal collated panel chat is browse-only until filtered to a chat-capable event.
  // Shared panel chat requires an event attachment; no events → locked.
  const hasEvents = allEvents.length > 0;
  const personalFilteredOk = !!(filterEv
    && (typeof personalPanelChatUnlocked !== "function" || personalPanelChatUnlocked())
    && (typeof eventHasPanelChat !== "function" || eventHasPanelChat(filterEv)));
  const memoryReadonly = !!(S.memoryChatReadonly && filterEv);
  const personalReadonly = (personalPanel && !personalFilteredOk) || memoryReadonly;
  const blockChatNoEvents = inPanel && !onPersonal && !hasEvents;
  const requireEventAttach = inPanel && !onPersonal && hasEvents && !memoryReadonly;
  const hasEventAttach = composerHasEventAttach();
  const hasMirrorAttach = !requireMirrorAttach
    || (typeof composerHasMirrorAttach === "function" && composerHasMirrorAttach(ch.id));
  const composerLocked = personalReadonly
    || blockChatNoEvents
    || (requireEventAttach && !hasEventAttach);
  const sendLocked = composerLocked || (requireMirrorAttach && !hasMirrorAttach);
  if (boardFeed && typeof boardEnsureOpenComposer === "function") boardEnsureOpenComposer();
  const fieldExtend = boardFeed && typeof boardExtendTarget === "function" ? boardExtendTarget() : null;
  const shellSignature = JSON.stringify({
    channel: ch.id,
    kind: ch.kind,
    filter: filterEv?.id || (untaggedOn ? "__untagged__" : ""),
    thread: eventThreadOn ? (S.conversationsThread.eventId || "") : "",
    threadTab: eventThreadOn ? threadTab : "",
    threadRsvp: eventThreadOn && filterEv && typeof timelineMyRsvp === "function"
      ? (timelineMyRsvp(filterEv) || "") : "",
    threadGoing: eventThreadOn && filterEv && typeof timelineGoingIds === "function"
      ? timelineGoingIds(filterEv).length : 0,
    threadDismissed: eventThreadOn && filterEv && typeof conversationRsvpDismissed === "function"
      ? (conversationRsvpDismissed(filterEv.id) ? 1 : 0) : 0,
    viewN: allEvents.length,
    inPanel: inPanel ? 1 : 0,
    notesMode: notesMode ? 1 : 0,
    personalPanel: personalPanel ? 1 : 0,
    personalReadonly: personalReadonly ? 1 : 0,
    memoryReadonly: memoryReadonly ? 1 : 0,
    blockChatNoEvents: blockChatNoEvents ? 1 : 0,
    requireMirrorAttach: requireMirrorAttach ? 1 : 0,
    hasMirrorAttach: hasMirrorAttach ? 1 : 0,
    sendLocked: sendLocked ? 1 : 0,
    taggedMirrorChatKey: S.taggedMirrorChatKey || "",
    polls: (filterEv && typeof eventPollsSignature === "function") ? eventPollsSignature(filterEv.id) : "",
    taskBanner: (!inPanel && ch.kind === "chat" && typeof boardTaskChannelForChat === "function"
      && boardTaskChannelForChat(ch, conn))
      ? (() => {
          const list = typeof boardTasksForChat === "function" ? boardTasksForChat(ch, conn) : [];
          const done = list.filter(t => t.completed === true || t.done === true).length;
          const open = list.length - done;
          return open > 0 ? `${done}/${list.length}` : "0";
        })()
      : "",
    mirrorTargets: taggableEvents.filter(e => e._mirrorChat || e._mirrorChannelId).map(e => e.id),
    rail: railEvents.map(ev => {
      const n = typeof explicitEventMentionCount === "function"
        ? explicitEventMentionCount(rawMsgs, ev.id) : 0;
      const unread = n > 0 && typeof eventChatFilterHasUnread === "function"
        ? eventChatFilterHasUnread(rawMsgs, ev.id, conn, ch.id) : false;
      return [ev.id, ev._title, ev.when, n, unread ? 1 : 0,
        inPanel && typeof panelFeedEventSourceLabel === "function" ? panelFeedEventSourceLabel(ev) : ""];
    }),
    feedPicker: pickerEvents.map(ev => [ev.id, ev._title || ev.title || "", ev.when || 0]),
    railBelow: convChatHeader ? 0 : 1,
    requireEventAttach,
    hasEventAttach,
    mentions: mentionIds,
    users: S.mentionedUserIds || [],
    replyTo: S.replyToMessage?.id || "",
    replyEvent: S.replyToMessage?.eventId || "",
    moveSelect: (typeof chatMoveSelectActive === "function" && chatMoveSelectActive(ch))
      ? `${S.chatMoveSelect.sourceMessageId}:${S.chatMoveSelect.includeRelated ? 1 : 0}:${(S.chatMoveSelect.selectedIds || []).join(",")}`
      : "",
    nudge: (!boardFeed && untaggedOn && S.eventChatNudge?.eventId && !S.eventChatNudgeDismissed?.[S.eventChatNudge.eventId])
      ? S.eventChatNudge.eventId : "",
    boardHome: boardFeed ? 1 : 0,
    continuing: S.boardContinuing || "",
    anchor: S.boardContinueAnchor || "",
    composing: (S.boardContinuing && !S.boardContinueSeparate) ? 1 : 0,
    fieldExtend: fieldExtend ? `${fieldExtend.messageId}:${fieldExtend.eventId || ""}:${fieldExtend.reachesField ? 1 : 0}` : "",
    separate: (typeof S !== "undefined" && S.boardContinueSeparate) ? 1 : 0,
    composerOpen: (boardFeed && typeof S !== "undefined" && S.boardComposerOpen) ? 1 : 0,
    connect: S.boardConnect ? `${S.boardConnect.mode || ""}:${S.boardConnect.chainId || ""}:${(S.boardConnect.selected || []).join(",")}` : "",
    composeEvent: S.boardComposeEventId || "",
    continueSend: (boardFeed && typeof boardDestinationTarget === "function" && boardDestinationTarget())
      ? (boardDestinationTarget().eventId || "") : "",
    archive: (typeof S !== "undefined" && S.boardArchive) ? 1 : 0,
    archiveEvent: (typeof S !== "undefined" && S.boardArchiveEventId) || "",
    sendContinue: (typeof S !== "undefined" && S.boardSendContinue) ? 1 : 0,
    fromChat: S.boardFromChat ? "1" : "",
    disconnect: S.boardDisconnectPreview || "",
    writable: canMutateContent(),
    mirrors: (() => {
      if (ch.kind !== "chat") return [];
      if (PersonalSpace.isPersonal(conn) && typeof directLinkedChatMirrorsFor === "function") {
        return directLinkedChatMirrorsFor(ch.id).map(l => [l.connId, l.channelId]);
      }
      if (typeof eventChannelsImportingInto === "function") {
        return eventChannelsImportingInto(ch.id).map(c => [c.id, c.name || ""]);
      }
      return [];
    })(),
  });
  const reuseShell = view._chatShellSignature === shellSignature && !!view.querySelector("#chat-scroll");
  const composerEl = view.querySelector("#composer-input");
  const composerHot = !!(composerEl && (document.activeElement === composerEl || (typeof S !== "undefined" && S._chatJustSent)));
  const wasNearBottom = reuseShell && (composerHot || (() => {
    const oldScroll = view.querySelector("#chat-scroll");
    if (!oldScroll) return false;
    return oldScroll.scrollHeight - oldScroll.scrollTop - oldScroll.clientHeight < 64;
  })());

  const mirrorReplyHint = taggedMirrorTarget
    ? `Replying on ${taggedMirrorTarget.serverName} · ${taggedMirrorTarget.chatName}`
    : (mentionEvents.find(e => e._mirrorChannelId)
      ? (() => {
          const ev = mentionEvents.find(e => e._mirrorChannelId);
          const server = ev._serverName || "Server";
          const chat = (typeof sourceChannelsFor === "function"
            ? sourceChannelsFor(S.conns?.[ev._connId])
            : (S.conns?.[ev._connId]?.channels || []))
            .find(c => c.id === ev._mirrorChannelId);
          return `Replying on ${server} · ${chat?.name || "Chat"}`;
        })()
      : "");

  const moveSelectOn = untaggedOn && typeof chatMoveSelectActive === "function" && chatMoveSelectActive(ch);
  const moveSelected = new Set((S.chatMoveSelect?.selectedIds || []).map(String));
  const moveCandidates = new Set((S.chatMoveSelect?.candidateIds || []).map(String));
  const nudge = (!boardFeed && !moveSelectOn && untaggedOn && S.eventChatNudge?.eventId
    && !(S.eventChatNudgeDismissed && S.eventChatNudgeDismissed[S.eventChatNudge.eventId]))
    ? S.eventChatNudge
    : null;
  const replyDest = S.replyToMessage?.eventTitle || "";
  const replyName = esc(S.replyToMessage?.name || "message");
  const replyBar = boardFeed && S.replyToMessage?.id
    ? `<div class="composer-reply-bar"><p class="composer-reply-label">Replying to <b>${replyName}</b></p><button type="button" class="composer-reply-cancel" id="composer-reply-clear">Cancel reply</button></div>`
    : "";
  const replyChip = !boardFeed && S.replyToMessage?.id
    ? `<div class="composer-tag-chip composer-reply-chip">${ic("reply", "ico-inline")} ${replyDest
      ? `Replying in <b>${esc(replyDest)}</b>`
      : `Replying to <b>${replyName}</b>`}
        ${S.replyToMessage.preview ? `<span class="composer-reply-preview">${esc(S.replyToMessage.preview)}</span>` : ""}
        <button type="button" id="composer-reply-clear" aria-label="Cancel reply">✕</button></div>`
    : "";

  const continueEv = boardFeed && typeof boardContinuationEvent === "function" ? boardContinuationEvent() : null;
  const continueChip = "";
  const mentionChip = !continueEv && !filterEv && mentionEvents.length
    ? `<div class="composer-tag-chip composer-event-chips">${mentionEvents.map(ev =>
        `<b>#${esc(eventDisplayTitle(ev))}</b>${ev._serverName ? ` <span class="composer-event-chip-src">${esc(ev._serverName)}</span>` : ""}
        <button type="button" class="composer-event-chip-clear" data-id="${esc(ev.id)}" aria-label="Remove">✕</button>`
      ).join(" · ")}</div>`
    : "";
  const composerPlaceholder = boardFeed
    ? "Message…"
    : (notesMode
      ? "Add a note…"
      : (inPanel
        ? (requireEventAttach && !hasEventAttach && !filterEv ? "Attach an event to message…" : "Message…")
        : (isFeedFilters
          ? (!(typeof featureParked === "function" && featureParked("tasks")) && typeof boardTaskChannelForChat === "function" && boardTaskChannelForChat(ch, conn)
            ? "Message — use /t for tasks"
            : "Write a message…")
          : (eventThreadOn && filterEv
            ? `Message about ${shown(filterEv._title) || "this event"}`
            : (requireMirrorAttach && !hasMirrorAttach
              ? "Pick a chat above or #event…"
              : (!(typeof featureParked === "function" && featureParked("tasks")) && typeof boardTaskChannelForChat === "function" && boardTaskChannelForChat(ch, conn)
                ? "Message — use /t for tasks, #event or @person"
                : "Message — try #event or @person"))))));
  const filterCompose = !!(boardFeed && filterEv && !S.boardContinueSeparate && !S.replyToMessage && !S.boardFromChat);
  const destinationPicker = boardFeed && typeof boardDestinationPickerHostHTML === "function" ? boardDestinationPickerHostHTML() : "";
  const sendControl = boardFeed && typeof boardSendButtonHTML === "function"
    ? boardSendButtonHTML(sendLocked)
    : (boardFeed ? `<button type="submit" class="board-compose-send" form="composer-form" aria-label="Send"${sendLocked ? " disabled" : ""}>${typeof ic === "function" ? ic("arrow-right") : ""}</button>` : "");
  const formMods = [
    replyBar ? "has-reply" : "",
  ].filter(Boolean).join(" ");
  const runEvent = (fieldExtend && fieldExtend.event) || (filterCompose ? filterEv : null);
  const composerHTML = !canMutateContent()
    ? `<div class="composer viewer-lock"><p class="empty-note">View-only — you can read this channel but not post.</p></div>`
    : memoryReadonly
      ? `<div class="composer viewer-lock"><p class="empty-note">Memory · read-only</p></div>`
    : personalReadonly
      ? `<div class="composer viewer-lock"><p class="empty-note">Read-only — open a shared event to chat</p></div>`
      : blockChatNoEvents
      ? `<div class="composer viewer-lock"><p class="empty-note">Add an event to start chatting</p></div>`
      : (boardFeed && typeof boardArchiveOn === "function" && boardArchiveOn())
      ? `<div class="composer is-board is-archive">${typeof boardArchiveRailHTML === "function" ? boardArchiveRailHTML() : ""}</div>`
      : (boardFeed && typeof S !== "undefined" && S.boardConnect)
      ? `<div class="composer is-board is-idle">
      ${typeof boardHomeComposerExtra === "function" ? boardHomeComposerExtra() : ""}
    </div>`
      : `<div class="composer${boardFeed ? " is-board" : ""}${fieldExtend ? " is-chain" : ""}${typeof S !== "undefined" && S.boardContinueSeparate ? " is-separate" : ""}${fieldExtend && fieldExtend.reachesField ? " is-reach" : ""}${runEvent ? " is-event" : ""}">
      ${boardFeed ? `<span class="board-start-rail" aria-hidden="true"></span>` : ""}
      ${typeof boardHomeComposerExtra === "function" ? boardHomeComposerExtra() : ""}
      ${continueChip}${mentionChip}
      ${mentionedNames.length ? `<div class="composer-tag-chip">👤 Mentioning <b>${esc(mentionedNames.join(", "))}</b>
        <button type="button" id="composer-mention-clear" aria-label="Remove mentions">✕</button></div>` : ""}
      ${replyChip}
      ${mirrorReplyHint && !filterEv && !isFeedFilters ? `<p class="composer-posting-to">${esc(mirrorReplyHint)}</p>` : ""}
      <div class="composer-wrap">
        <div class="tag-suggest" id="tag-suggest" hidden></div>
        <div class="board-compose-card">
          ${boardFeed
            ? `<div class="board-compose-panel">
            ${destinationPicker}
            <div class="board-compose-panel-body">
              <form id="composer-form"${formMods ? ` class="${formMods}"` : ""}>
              ${replyBar}<div class="composer-field-row">${typeof boardComposeCreateHTML === "function" ? boardComposeCreateHTML() : `<button type="button" class="board-compose-add" id="board-compose-add" aria-label="Create event">+</button>`}<div class="board-composer-editable"><span id="board-destination-slot" hidden></span><textarea id="composer-input" rows="1" enterkeyhint="send" placeholder="${composerPlaceholder}" maxlength="2000" autocomplete="off"${composerLocked ? " disabled" : ""}></textarea></div></div>
              </form>
              ${sendControl}
            </div>
          </div>`
            : `<form id="composer-form"${formMods ? ` class="${formMods}"` : ""}>
          ${replyBar}<input id="composer-input" placeholder="${composerPlaceholder}" maxlength="2000" autocomplete="off"${composerLocked ? " disabled" : ""}>
          <button type="submit" hidden${sendLocked ? " disabled" : ""}>Send</button>
          </form>`}
        </div>
      </div>
    </div>`;

  const composerDock = moveSelectOn
    ? `<div class="chat-move-bar" role="toolbar" aria-label="Select messages to move">
        ${(S.chatMoveSelect?.relatedIds || []).length > 1
          ? `<button type="button" class="chat-move-related${S.chatMoveSelect.includeRelated ? " on" : ""}" data-chat-move-related aria-pressed="${S.chatMoveSelect.includeRelated ? "true" : "false"}">Move related messages</button>`
          : ""}
        <div class="chat-move-bar-row">
          <button type="button" class="chat-move-cancel" data-chat-move-cancel>Cancel</button>
          <span class="chat-move-count">${moveSelected.size} selected</span>
          <button type="button" class="chat-move-confirm" data-chat-move-confirm>${S.chatMoveSelect?.purpose === "attach" ? "Move" : "Continue"}</button>
        </div>
      </div>`
    : `${nudge ? `<div class="chat-event-nudge">
        <button type="button" class="chat-event-nudge-open" data-conv-open="${esc(nudge.eventId)}">Discussing ${esc(nudge.title || "this event")}? Open event chat.</button>
        <button type="button" class="chat-event-nudge-dismiss" data-event-nudge-dismiss="${esc(nudge.eventId)}" aria-label="Dismiss">✕</button>
      </div>` : ""}${composerHTML}`;

  const filterChipHTML = (filterEv && inPanel) ? (() => {
    const title = shown(filterEv._title) || "Event";
    const whenLabel = (typeof fmtDay === "function" && filterEv.when) ? fmtDay(filterEv.when) : "";
    const sourceLabel = typeof panelFeedEventSourceLabel === "function" ? panelFeedEventSourceLabel(filterEv) : "";
    const titleMeta = [
      `<span class="chat-panel-filter-title">${esc(title)}</span>`,
      whenLabel ? `<span class="panel-event-feed-meta"> · ${esc(whenLabel)}</span>` : "",
      sourceLabel ? `<span class="panel-event-feed-source"> · ${esc(sourceLabel)}</span>` : "",
    ].join("");
    return `<div class="panel-event-feed-title panel-event-feed-chip chat-panel-filter-chip" role="status">
      <button type="button" class="panel-event-feed-name chat-panel-filter-open" id="chat-panel-filter-open" data-event="${esc(filterEv.id)}" title="Open ${esc(title)}" aria-label="Open ${esc(title)}">${titleMeta}</button>
    </div>`;
  })() : "";

  const feedScopeHTML = (convChatHeader && eventThreadOn && filterEv && typeof conversationFeedScopeHTML === "function")
    ? conversationFeedScopeHTML({ filterEv })
    : "";

  const mirrorBarHTML = (!inPanel && typeof chatMirroredEventsBarHTML === "function")
    ? chatMirroredEventsBarHTML(ch, { selectedKey: S.taggedMirrorChatKey || null })
    : "";

  let boardDraft = null;
  let boardFocusComposer = false;
  if (boardFeed) {
    const liveComposer = view.querySelector("#composer-input");
    if (liveComposer) {
      boardDraft = liveComposer.value;
      boardFocusComposer = document.activeElement === liveComposer
        || (typeof boardComposerFocusWanted === "function" && boardComposerFocusWanted());
      if (typeof boardClearComposerFocusWanted === "function") boardClearComposerFocusWanted();
      if (typeof boardChatMemory === "function") boardChatMemory().draft = liveComposer.value;
    } else if (typeof boardChatMemory === "function" && boardChatMemory().saved) {
      boardDraft = boardChatMemory().draft || "";
    }
  }

  if (!reuseShell) view.innerHTML = `
    ${ch.kind === "event" && !inPanel ? `<div class="chat-event-toolbar">
      <button type="button" class="people-btn" id="chat-back-agenda">‹ Agenda</button>
      <span class="chat-event-toolbar-label">#${esc(ch.name)}</span>
    </div>` : ""}
    ${feedScopeHTML}
    ${filterEv && !inPanel && !eventThreadOn && !isFeedFilters ? `<div class="chat-filter-bar">
      <span>Showing mentions and replies for <b>${esc(shown(filterEv._title))}</b></span>
      <button type="button" id="chat-filter-clear">All chat</button>
    </div>` : ""}
    ${!inPanel && !eventThreadOn && !boardFeed && ch.kind === "chat" && typeof chatTasksBannerHTML === "function"
      ? chatTasksBannerHTML(ch, conn) : ""}
    ${filterEv && typeof eventPollsBlockHTML === "function" ? eventPollsBlockHTML(filterEv) : ""}
    <div class="chat-scroll" id="chat-scroll"></div>
    ${(() => {
      if (convChatHeader) return "";
      const showEventRail = !eventThreadOn && !!(railEvents.length && !(filterEv && inPanel));
      if (!showEventRail) return "";
      const eventCards = railEvents.map(ev => {
        const on = S.chatFilterEventId === ev.id;
        const n = typeof explicitEventMentionCount === "function"
          ? explicitEventMentionCount(rawMsgs, ev.id) : 0;
        const src = inPanel && typeof panelFeedEventSourceLabel === "function"
          ? panelFeedEventSourceLabel(ev) : "";
        const dayCompact = (() => {
          if (ev.when == null) return "";
          try {
            return new Date(ev.when).toLocaleDateString("en-GB", {
              weekday: "short", day: "numeric", month: "short",
            }).replace(",", "").replace("Sept", "Sep");
          } catch {
            return typeof fmtDay === "function" ? fmtDay(ev.when) : "";
          }
        })();
        const badge = n > 0
          ? (() => {
            const unread = typeof eventChatFilterHasUnread === "function"
              && eventChatFilterHasUnread(rawMsgs, ev.id, conn, ch.id);
            const label = `${n} message${n === 1 ? "" : "s"}${unread ? " · unread" : ""}`;
            return `<span class="crc-chat-badge${unread ? " is-unread" : " is-read"}" title="${esc(label)}" aria-label="${esc(label)}">${ic("message", "ico-inline")}<em>${n > 99 ? "99+" : n}</em></span>`;
          })()
          : "";
        return `<div class="chat-rail-item${on ? " on" : ""}" role="presentation">
          <button type="button" class="chat-rail-card${on ? " on" : ""}" role="option" data-event="${esc(ev.id)}" aria-selected="${on ? "true" : "false"}">
            <span class="crc-event-icon" aria-hidden="true">${ic("ticket", "ico-inline")}</span>
            <span class="crc-text">
              <span class="crc-title">${esc(eventDisplayTitle(ev))}</span>
              <span class="crc-meta">${esc(dayCompact)}${src ? ` · ${esc(src)}` : ""}</span>
            </span>
            ${badge}
          </button>
          <button type="button" class="chat-rail-details" data-event-details="${esc(ev.id)}" aria-label="Open ${esc(eventDisplayTitle(ev))}" title="Open event">${ic("square-arrow-out-up-right", "ico-inline")}</button>
        </div>`;
      }).join("");
      return `<div class="chat-card-rail" id="chat-card-rail" role="listbox" aria-label="Choose a conversation">
      ${eventCards}
    </div>`;
    })()}
    ${filterChipHTML}
    ${mirrorBarHTML}
    ${hideChatBody && filterEv && typeof conversationEventPanelHTML === "function"
      ? conversationEventPanelHTML(filterEv) : ""}
    ${composerDock}`;
  view.classList.toggle("conv-event-thread", !!eventThreadOn);
  view.classList.toggle("conv-event-nonchat", !!hideChatBody);
  if (convChatHeader) {
    const boardName = typeof boardTitle === "function" ? boardTitle(ch, conn) : (ch.name || "");
    if (boardName && typeof showPlainTitle === "function") showPlainTitle(boardName);
    const subEl = document.getElementById("view-sub");
    if (subEl) subEl.textContent = "";
  } else if (!inPanel && !eventThreadOn && ch.kind === "chat" && typeof showPlainTitle === "function") {
    const board = typeof boardForChannel === "function" ? boardForChannel(ch, conn) : null;
    if (board?.name) {
      const name = filterEv
        ? ((typeof eventDisplayTitle === "function" && eventDisplayTitle(filterEv)) || "Event")
        : (typeof conversationBoardChatLabel === "function" ? conversationBoardChatLabel() : "All chat");
      showPlainTitle(`${board.name} > ${name}`, { raw: true });
    }
  }
  if (!reuseShell) {
    view.style.cssText = "display:flex;flex-direction:column;flex:1;min-height:0";
    view._chatShellSignature = shellSignature;
  } else {
    if (boardFeed) view.querySelector(".chat-tasks-banner")?.remove();
    // Leave the live composer in place. Replacing it here drops the submit
    // handler and the unsent draft; a signature change rebuilds the shell.
    const existingMirror = view.querySelector(".chat-mirror-bar");
    if (mirrorBarHTML) {
      const tmp = document.createElement("div");
      tmp.innerHTML = mirrorBarHTML;
      const next = tmp.firstElementChild;
      if (existingMirror && next) {
        if (existingMirror.outerHTML !== next.outerHTML) existingMirror.replaceWith(next);
      } else if (!existingMirror && next) {
        const comp = view.querySelector(".composer");
        if (comp) comp.before(next);
        else view.appendChild(next);
      }
    } else if (existingMirror) {
      existingMirror.remove();
    }
    if (hideChatBody && filterEv && typeof conversationEventPanelHTML === "function") {
      const existingPanel = view.querySelector("#conv-event-panel");
      const tmp = document.createElement("div");
      tmp.innerHTML = conversationEventPanelHTML(filterEv);
      const next = tmp.firstElementChild;
      if (next) {
        if (existingPanel) {
          if (existingPanel.innerHTML !== next.innerHTML) existingPanel.replaceWith(next);
        } else {
          const comp = view.querySelector(".composer");
          if (comp) comp.before(next);
          else view.appendChild(next);
        }
      }
    }
  }

  const scroll = view.querySelector("#chat-scroll");
  if (!scroll) {
    if (typeof AshPerf !== "undefined") AshPerf.end("renderChat", perfStarted, 100);
    return;
  }
  if (boardFeed && typeof boardHomeRows === "function") {
    const homeRows = boardHomeRows({ messages: rawMsgs, allEvents, conn, ch, filterEv });
    const html = homeRows.length
      ? homeRows.join("")
      : `<p class="empty-note">${filterEv
        ? `Nothing about <b>${esc(shown(filterEv._title))}</b> yet.`
        : (typeof boardArchiveOn === "function" && boardArchiveOn()
          ? `Nothing in the archive yet.`
          : `Nothing in All chat yet.`)}</p>`;
    if (reuseShell && homeRows.length && typeof reconcileChatRows === "function") {
      reconcileChatRows(scroll, homeRows, wasNearBottom || !keepScroll || !!S._chatJustSent);
    } else scroll.innerHTML = html;
  } else if (!msgs.length) {
    scroll.innerHTML = notesMode && canMutateContent() && !personalReadonly
      ? `<p class="empty-note">Jot things down for yourself</p>`
      : personalReadonly
      ? `<p class="edc-empty">Read-only — open a shared event to chat</p>`
      : blockChatNoEvents
      ? `<p class="edc-empty">Add an event to start chatting</p>`
      : canMutateContent()
      ? `<p class="empty-note">${filterEv
        ? `Nothing about <b>${esc(shown(filterEv._title))}</b> yet.`
        : (untaggedOn
          ? `Nothing in All chat yet.`
        : (ch.kind === "chat" && railEvents.length && !isFeedFilters
          ? `Choose an event to start its conversation.`
        : (requireEventAttach && !hasEventAttach
          ? `Nothing here yet. Attach a message to an event to send.`
          : `Nothing here yet. <b>Say something</b> — it stays on ${esc(S.hostName)}, nowhere else.`)))}</p>`
      : `<p class="empty-note">Nothing here yet.</p>`;
  } else {
    let lastMsg = null, lastDay = "";
    const rows = [];
    for (const m of msgs) {
      const day = new Date(m.ts).toDateString();
      if (day !== lastDay) {
        rows.push(`<div class="day-rule" data-chat-key="day:${esc(day)}">${typeof fmtDayRule === "function" && !S.conversationsThread?.eventId ? fmtDayRule(m.ts) : fmtDay(m.ts)}</div>`);
        lastDay = day; lastMsg = null;
      }
      const eventIds = typeof messageMentionedEventIds === "function"
        ? messageMentionedEventIds(m) : (m.eventId ? [m.eventId] : []);
      const activity = typeof eventActivityText === "function" ? eventActivityText(m) : null;
      if (m._eventLinkMarker) {
        const primaryId = m.eventId || (typeof messageMentionedEventIds === "function" ? messageMentionedEventIds(m)[0] : "");
        const ev = primaryId ? (allEvents.find(e => e.id === primaryId) || mirrorEventById.get(primaryId)) : null;
        const card = typeof conversationEventMoveMarkerHTML === "function"
          ? conversationEventMoveMarkerHTML(ev, primaryId, m._eventTitle, {
            leftoverCount: m._relatedLeftoverCount || 0,
            movedMessages: m._movedMessages || (typeof conversationMovedMessagesForEvent === "function"
              ? conversationMovedMessagesForEvent(rawMsgs, primaryId)
              : []),
            conn,
          })
          : "";
        if (card) {
          rows.push(card);
          lastMsg = null;
        }
        continue;
      }
      if (activity) {
        const primaryId = eventIds[0] || m.eventId;
        const ev = primaryId ? allEvents.find(e => e.id === primaryId) : null;
        const eventExists = !!ev || !!(primaryId && g?.events?.some(e => e.id === primaryId));
        const src = inPanel && ev && typeof panelFeedEventSourceLabel === "function"
          ? panelFeedEventSourceLabel(ev) : "";
        const personalPanel = inPanel && typeof panelFeedShowEventSource === "function" && panelFeedShowEventSource();
        const linkLabel = personalPanel && src
          ? `${esc(shown(m._eventTitle || ev?._title))} · ${esc(src)}`
          : esc(shown(m._eventTitle || ev?._title));
        rows.push(`
          <div class="event-log-entry chat-log-entry head-gap" data-chat-key="activity:${esc(m.id || `${m.ts}:${activity}`)}">
            <span class="event-log-icon">${ic(eventActivityIcon(m.activity))}</span>
            <div>
              ${primaryId ? `<div class="chat-event-link${eventExists ? "" : " inert"}" data-event="${esc(primaryId)}">${ic("ticket", "ico-inline event-outline-icon")} ${linkLabel}</div>` : ""}
              <span>${esc(activity)}</span><time>${fmtTime(m.ts)}</time>
            </div>
          </div>`);
        lastMsg = null;
        continue;
      }
      const grouped = typeof chatMessagesGroupTogether === "function"
        ? chatMessagesGroupTogether(lastMsg, m)
        : false;
      const who = m.name || m.userId || "?";
      const meId = conn?.me?.id || S.me?.id;
      const realChat = !!(m.id && (conn?.messages?.[ch.id] || []).some(x => x.id === m.id));
      const bodyText = typeof shownField === "function" ? shownField(m._text, m.text) : shown(m._text);
      const planOpts = { event: eventThreadOn ? filterEv : null, now: Number(m.ts) || Date.now() };
      const planCls = realChat && typeof chatPlanCandidateClass === "function" ? chatPlanCandidateClass(bodyText, planOpts) : "";
      const bodyHTML = realChat && typeof chatPlanPromoteHTML === "function"
        ? chatPlanPromoteHTML(bodyText, planOpts)
        : (typeof escLinkify === "function" ? escLinkify(bodyText) : esc(bodyText));
      const fromEventNote = !!(m._fromEventNote || (m.eventId && String(m.id || "").startsWith("note-")));
      const personalPanel = inPanel && typeof panelFeedShowEventSource === "function" && panelFeedShowEventSource();
      const canDeleteMsg = !m.activity && (realChat
        ? (typeof canDeleteChatMessage === "function" ? canDeleteChatMessage(m, conn) : m.userId === meId)
        : (fromEventNote && (m.userId === meId || canModerateEvents())));
      const canReportMsg = realChat && typeof canReport === "function" && canReport() && m.userId && m.userId !== meId;
      const pickable = !!(moveSelectOn && m.id && moveCandidates.has(String(m.id)));
      const picked = pickable && moveSelected.has(String(m.id));
      const originHints = (untaggedOn && eventIds.length && typeof conversationEventOriginHintHTML === "function")
        ? eventIds.map((eid) => {
          const ev = allEvents.find(e => e.id === eid) || mirrorEventById.get(eid);
          return conversationEventOriginHintHTML(ev, eid, m._eventTitle);
        }).join("")
        : "";
      const eventPills = originHints ? "" : eventIds
        .filter(eid => !filterEv || eid !== filterEv.id)
        .map(eid => {
        const ev = allEvents.find(e => e.id === eid) || mirrorEventById.get(eid);
        if (requireMirrorAttach) {
          const title = esc(ev ? eventDisplayTitle(ev) : shown(m._eventTitle));
          return `<button type="button" class="chat-event-chip${ev ? "" : " inert"}" data-event="${esc(eid)}"><span class="hash" aria-hidden="true">#</span><span class="chat-event-chip-title">${title}</span></button>`;
        }
        if (personalPanel) {
          const title = esc(ev ? eventDisplayTitle(ev) : shown(m._eventTitle));
          const src = ev && typeof panelFeedEventSourceLabel === "function"
            ? panelFeedEventSourceLabel(ev) : "";
          const compact = src ? `${title} · ${esc(src)}` : title;
          return chatEventChipHTML(ev, eid, m._eventTitle, { compactLabel: compact });
        }
        return chatEventChipHTML(ev, eid, m._eventTitle);
      }).join("");
      const linkedBy = (!filterEv && !personalPanel && m.linkedByUserName)
        ? `<span class="chat-linked-by">linked by ${esc(m.linkedByUserName)}</span>` : "";
      const eventChips = eventPills
        ? `<span class="chat-event-chips${personalPanel ? " is-compact" : ""}">${eventPills}${linkedBy}</span>`
        : "";
        rows.push(`
        <div class="msg${grouped ? "" : " head-gap"}${planCls}${pickable ? " is-move-pick" : ""}${picked ? " is-move-on" : ""}" data-chat-key="message:${esc(m.id || `${m.ts}:${m.userId || ""}`)}" data-msg-id="${esc(m.id || "")}" data-real-chat="${realChat ? "1" : "0"}" data-can-delete="${canDeleteMsg ? "1" : "0"}" data-can-report="${canReportMsg ? "1" : "0"}" data-event="${esc(m.eventId || "")}" data-note-id="${esc(m.noteId || "")}" data-note-ts="${esc(String(m.ts || ""))}" data-note-user="${esc(m.userId || "")}" data-from-note="${fromEventNote && !realChat ? "1" : "0"}"${pickable ? ` data-move-id="${esc(m.id)}"` : ""}>
          ${pickable
            ? `<button type="button" class="chat-move-check${picked ? " on" : ""}" data-move-id="${esc(m.id)}" aria-pressed="${picked ? "true" : "false"}" aria-label="${picked ? "Deselect message" : "Select message"}">${picked ? "✓" : ""}</button>`
            : `<div class="avatar${grouped ? " spacer" : ""}" style="${avatarStyle(m.userId)}">${avatarFaceHtml(m.userId, who)}</div>`}
          <div class="msg-main">
            ${grouped ? "" : `<div class="msg-meta"><span class="who"${typeof roleNameStyle === "function" && roleNameStyle(m.userId) ? ` style="${roleNameStyle(m.userId)}"` : ""}>${esc(who)}</span><span class="when">${fmtTime(m.ts)}</span>${!personalPanel && eventChips ? eventChips : ""}</div>`}
            ${personalPanel && eventChips ? eventChips : ""}
            ${!personalPanel && grouped && eventChips ? `<div class="chat-event-chips">${eventPills}${linkedBy}</div>` : ""}
            ${m.mentionedUserIds?.length ? `<div class="chat-mention-pill">👤 ${esc(m.mentionedUserIds.map(nameOf).join(", "))}</div>` : ""}
            ${realChat && typeof chatReplyQuoteHTML === "function" ? chatReplyQuoteHTML(m, conn?.messages?.[ch.id]) : ""}
            <div class="msg-body-row">
              ${m.taskId && typeof chatTaskCardHTML === "function"
                ? chatTaskCardHTML(m, conn)
                : `<div class="msg-body">${bodyHTML}</div>`}
            </div>
            ${originHints}
            ${realChat && typeof chatReactionChipsHTML === "function" ? chatReactionChipsHTML(m, {
              mine: meId,
              interactive: typeof canMutateContent === "function" && canMutateContent(),
            }) : ""}
          </div>
        </div>`);
      lastMsg = m;
    }
    // One DOM write prevents a layout/repaint cycle for every history row.
    if (reuseShell) reconcileChatRows(scroll, rows, wasNearBottom || !keepScroll || (typeof S !== "undefined" && S._chatJustSent));
    else scroll.innerHTML = rows.join("");
  }
  view.querySelectorAll("[data-move-expand]").forEach((btn) => {
    btn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const eventId = btn.dataset.moveExpand;
      const root = btn.closest("[data-move-event]");
      if (eventId && typeof toggleChatMoveMarkerExpanded === "function") {
        toggleChatMoveMarkerExpanded(eventId, root);
      }
    };
  });
  view.querySelectorAll("[data-move-related]").forEach((btn) => {
    btn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const eventId = btn.dataset.moveRelated;
      if (!eventId || typeof attachChatMessagesToEvent !== "function") return;
      const leftovers = typeof conversationMoveRelatedLeftovers === "function"
        ? conversationMoveRelatedLeftovers(rawMsgs, eventId)
        : [];
      if (leftovers.length) attachChatMessagesToEvent(ch.id, leftovers, eventId, conn);
    };
  });
  view.querySelectorAll("[data-conv-open]").forEach(btn => {
    btn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const id = btn.dataset.convOpen;
      if (typeof closeConversationFeedPicker === "function") closeConversationFeedPicker();
      if (id && typeof openConversationsEvent === "function") openConversationsEvent(id);
    };
  });
  const moveCancel = view.querySelector("[data-chat-move-cancel]");
  if (moveCancel) {
    moveCancel.onclick = (event) => {
      event.preventDefault();
      if (typeof cancelChatMoveSelect === "function") cancelChatMoveSelect();
    };
  }
  const moveRelated = view.querySelector("[data-chat-move-related]");
  if (moveRelated) {
    moveRelated.onclick = (event) => {
      event.preventDefault();
      if (typeof toggleChatMoveRelated === "function") toggleChatMoveRelated();
    };
  }
  const moveConfirm = view.querySelector("[data-chat-move-confirm]");
  if (moveConfirm) {
    moveConfirm.onclick = (event) => {
      event.preventDefault();
      if (typeof confirmChatMoveSelect === "function") confirmChatMoveSelect();
    };
  }
  const nudgeDismiss = view.querySelector("[data-event-nudge-dismiss]");
  if (nudgeDismiss) {
    nudgeDismiss.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const id = event.currentTarget.dataset.eventNudgeDismiss;
      if (typeof S === "undefined" || !id) return;
      S.eventChatNudgeDismissed = { ...(S.eventChatNudgeDismissed || {}), [id]: true };
      if (S.eventChatNudge?.eventId === id) S.eventChatNudge = null;
      if (typeof renderChat === "function") renderChat(view, ch, true);
    };
  }
  if (scroll._moveSelectClick) {
    scroll.removeEventListener("click", scroll._moveSelectClick);
    scroll._moveSelectClick = null;
  }
  if (moveSelectOn) {
    scroll._moveSelectClick = (event) => {
      const hit = event.target.closest("[data-move-id]");
      if (!hit || !scroll.contains(hit)) return;
      event.preventDefault();
      event.stopPropagation();
      if (typeof toggleChatMoveSelect === "function") toggleChatMoveSelect(hit.dataset.moveId);
    };
    scroll.addEventListener("click", scroll._moveSelectClick);
  }
  if (eventThreadOn && !view.dataset.convThreadSwipeWired) {
    view.dataset.convThreadSwipeWired = "1";
    const backToConversations = () => {
      if (typeof S === "undefined" || !S.conversationsThread?.eventId) return false;
      return typeof conversationsHandleBack === "function" && conversationsHandleBack();
    };
    if (typeof attachSwipeBack === "function") {
      attachSwipeBack(view, () => { backToConversations(); });
    }
    if (typeof attachModeSwipe === "function") {
      attachModeSwipe(view, { openNavOnRight: true, openChannelPanelOnLeft: true });
    }
  }
  if (reuseShell) {
    if (boardFeed) boardDestinationWire(view);
    if ((!keepScroll || (typeof S !== "undefined" && S._chatJustSent)) && typeof pinChatScrollToLatest === "function") {
      pinChatScrollToLatest(view);
    }
    if (boardFeed && typeof syncComposerSendButton === "function") {
      const kept = view.querySelector("#composer-input");
      const keptForm = view.querySelector("#composer-form");
      if (kept && keptForm) syncComposerSendButton(keptForm, kept, { locked: !!keptForm._composerSendLocked });
    }
    if (boardFeed && typeof boardFloatComposer === "function") {
      boardFloatComposer(view);
      requestAnimationFrame(() => boardFloatComposer(view));
    }
    if (typeof AshPerf !== "undefined") AshPerf.end("renderChat", perfStarted, 100);
    return;
  }
  if (prevTop != null) scroll.scrollTop = prevTop;
  else scroll.scrollTop = scroll.scrollHeight;
  attachModeSwipe(scroll, { openNavOnRight: true, navOnly: true });
  attachDoubleTapBack(scroll, () => {
    if (typeof conversationsHandleBack === "function" && conversationsHandleBack()) return;
    Nav.landDefault();
    renderView();
  });
  const eventPanel = view.querySelector("#conv-event-panel");
  if (eventPanel) {
    if (typeof attachSwipeBack === "function") {
      attachSwipeBack(eventPanel, () => {
        if (typeof S === "undefined" || !S.conversationsThread?.eventId) return;
        if (typeof conversationsHandleBack === "function") conversationsHandleBack();
      });
    }
    attachDoubleTapBack(eventPanel, () => {
      if (typeof conversationsHandleBack === "function" && conversationsHandleBack()) return;
      Nav.landDefault();
      renderView();
    });
  }
  let interactionIdleTimer = 0;
  const setChatInteraction = () => {
    view._chatInteractionActive = true;
    clearTimeout(interactionIdleTimer);
    interactionIdleTimer = setTimeout(() => {
      view._chatInteractionActive = false;
      const pending = view._pendingChatRefresh;
      view._pendingChatRefresh = null;
      if (pending) refreshActiveChatIncrementally(pending);
    }, 100);
  };
  scroll.addEventListener("pointerdown", setChatInteraction, { passive: true });
  scroll.addEventListener("scroll", setChatInteraction, { passive: true });
  scroll.addEventListener("scroll", () => {
    if (scroll.scrollTop > 160 || scroll._historyLoading) return;
    const owner = activeConn();
    if (!owner?._messagePaging?.[ch.id]?.hasMore || typeof requestOlderMessages !== "function") return;
    scroll._historyLoading = true;
    requestOlderMessages(owner, ch.id).finally(() => { scroll._historyLoading = false; });
  }, { passive: true });
  scroll.addEventListener("pointerup", setChatInteraction, { passive: true });
  scroll.addEventListener("pointercancel", setChatInteraction, { passive: true });

  if (!view.dataset.convEventChromeWired) {
    view.dataset.convEventChromeWired = "1";
    view.addEventListener("click", (e) => {
      const thread = typeof S !== "undefined" ? S.conversationsThread : null;
      if (!thread?.eventId) return;
      const currentChat = () => {
        const g = typeof group === "function" ? group() : null;
        return (g?.channels || []).find(c => c.id === S.activeView?.id) || null;
      };
      const tabBtn = e.target.closest("[data-conv-tab]");
      if (tabBtn && view.contains(tabBtn)) {
        const tab = tabBtn.dataset.convTab;
        if (tab !== "chat" && tab !== "attendance" && tab !== "description") return;
        S.conversationsThread = { eventId: thread.eventId, tab };
        const chNow = currentChat();
        if (chNow && typeof renderChat === "function") renderChat(view, chNow);
        return;
      }
      const rsvpBtn = e.target.closest("[data-conv-rsvp]");
      if (rsvpBtn && view.contains(rsvpBtn) && rsvpBtn.dataset.convRsvp) {
        const status = rsvpBtn.dataset.convRsvp;
        if (status !== "going" && status !== "signedUp" && status !== "out") return;
        if (typeof setConversationRsvpDismissed === "function") {
          setConversationRsvpDismissed(thread.eventId, false);
        }
        if (typeof setEventRsvp === "function") setEventRsvp(thread.eventId, status);
        const chNow = currentChat();
        if (chNow && typeof renderChat === "function") renderChat(view, chNow);
        return;
      }
      const editBtn = e.target.closest("[data-conv-desc-edit]");
      if (editBtn && view.contains(editBtn)) {
        const ev = (typeof conversationFindEvent === "function"
          ? conversationFindEvent(thread.eventId)
          : (typeof group === "function" ? group()?.events : [])
            ?.find(item => item.id === thread.eventId));
        if (ev && typeof timelineOpenDescriptionEditor === "function") {
          timelineOpenDescriptionEditor(ev);
        }
        return;
      }
      const detailBtn = e.target.closest("[data-conv-detail]");
      if (detailBtn && view.contains(detailBtn)) {
        const ev = (typeof conversationFindEvent === "function"
          ? conversationFindEvent(thread.eventId)
          : (typeof group === "function" ? group()?.events : [])
            ?.find(item => item.id === thread.eventId));
        if (ev && typeof conversationRunDetailAction === "function") {
          void conversationRunDetailAction(ev, detailBtn.dataset.convDetail);
        }
        return;
      }
      const moreBtn = e.target.closest("[data-conv-event-menu]");
      if (moreBtn && view.contains(moreBtn)) {
        const ev = (typeof group === "function" ? group()?.events : [])
          ?.find(item => item.id === thread.eventId);
        if (ev && typeof conversationOpenEventMenu === "function") {
          conversationOpenEventMenu(ev, moreBtn);
        }
      }
    });
    view.addEventListener("paste", (e) => {
      if (e.target.closest("input, textarea, [contenteditable]")) return;
      const thread = typeof S !== "undefined" ? S.conversationsThread : null;
      if (!thread?.eventId || thread.tab !== "description") return;
      const panel = view.querySelector("#conv-event-panel");
      if (!panel || !view.contains(panel)) return;
      const ev = (typeof conversationFindEvent === "function"
        ? conversationFindEvent(thread.eventId)
        : (typeof group === "function" ? group()?.events : [])
          ?.find(item => item.id === thread.eventId));
      if (!ev || (typeof canEditEvent === "function" && !canEditEvent(ev))) return;
      const text = e.clipboardData?.getData("text") || "";
      if (typeof parseMapLink !== "function" || !parseMapLink(text)) return;
      e.preventDefault();
      if (typeof applyEventMapUrl === "function") {
        applyEventMapUrl(ev, text).then((ok) => {
          if (ok && typeof conversationRefreshEventPanel === "function") conversationRefreshEventPanel(ev);
        });
      }
    });
  }

  view.querySelector("#chat-back-agenda")?.addEventListener("click", () => {
    if (typeof clearChatStreamFilters === "function") clearChatStreamFilters();
    else {
      S.chatFilterEventId = null;
      S.chatFilterUntagged = false;
      S.memoryChatReadonly = false;
    }
    if (view.closest?.("#channel-panel")) {
      try { closeChannelPanel(); } catch {}
      return;
    }
    Nav.openChannel(ch.id);
    renderView();
  });
  view.querySelectorAll(".chat-rail-card, .chat-feed-chip").forEach(btn => {
    btn.onclick = () => {
      const inPanel = !!view.closest?.("#channel-panel");
      if (btn.dataset.chatFilter === "all") {
        if (inPanel) return;
        if (typeof clearChatStreamFilters === "function") clearChatStreamFilters();
        else {
          S.chatFilterEventId = null;
          S.chatFilterUntagged = false;
          S.memoryChatReadonly = false;
        }
        S.mentionedEventIds = [];
        S.taggedEventId = null;
        S.autoTagEventId = null;
        renderChat(view, ch);
        return;
      }
      if (btn.dataset.chatFilter === "untagged") {
        if (inPanel) return;
        S.chatFilterEventId = null;
        S.chatFilterUntagged = true;
        S.memoryChatReadonly = false;
        S.mentionedEventIds = [];
        S.taggedEventId = null;
        S.autoTagEventId = null;
        renderChat(view, ch);
        return;
      }
      const id = btn.dataset.event;
      if (inPanel) {
        if (S.chatFilterEventId === id) {
          clearPanelEventChatFilter();
          try { renderChannelPanel(true); } catch {}
        } else if (typeof openEventChatFiltered === "function") {
          openEventChatFiltered(ch.id, id, { tab: S._edcTab || "chat" });
        } else {
          S.chatFilterEventId = id;
          try { renderChannelPanel(true); } catch {}
          try { focusTimelineOnPanelEvent(id); } catch {}
        }
        return;
      }
      S.chatFilterUntagged = false;
      S.chatFilterEventId = id;
      S.memoryChatReadonly = false;
      S.mentionedEventIds = id ? [id] : [];
      S.taggedEventId = id;
      S.autoTagEventId = null;
      renderChat(view, ch);
    };
  });
  const railOptions = [...view.querySelectorAll(".chat-rail-card, .chat-feed-chip")];
  railOptions.forEach((btn, index) => {
    btn.addEventListener("keydown", event => {
      let next = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % railOptions.length;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + railOptions.length) % railOptions.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = railOptions.length - 1;
      if (next == null) return;
      event.preventDefault();
      railOptions[next]?.focus();
    });
  });
  view.querySelectorAll("[data-event-details]").forEach(btn => {
    btn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const id = btn.dataset.eventDetails;
      if (id && typeof openEventConversation === "function") openEventConversation(id, "description");
    };
  });
  view.querySelector("#chat-filter-clear")?.addEventListener("click", () => {
    const cleared = S.chatFilterEventId;
    if (typeof clearChatStreamFilters === "function") clearChatStreamFilters();
    else {
      S.chatFilterEventId = null;
      S.chatFilterUntagged = false;
      S.memoryChatReadonly = false;
    }
    S.mentionedEventIds = (S.mentionedEventIds || []).filter(id => id !== cleared);
    if (S.taggedEventId === cleared) S.taggedEventId = null;
    if (view.closest?.("#channel-panel")) {
      try { renderChannelPanel(true); } catch { renderChat(view, ch); }
      return;
    }
    renderChat(view, ch);
  });
  view.querySelectorAll(".chat-mirror-chip").forEach(btn => {
    btn.onclick = () => {
      const channelId = btn.dataset.channel;
      const connId = btn.dataset.conn;
      const mirrorKey = btn.dataset.mirrorKey;
      if (!channelId) return;
      // Personal mirrored chats: select reply destination (do not navigate away).
      if (connId && requireMirrorAttach) {
        const key = mirrorKey
          || (typeof linkedFeedKey === "function" ? linkedFeedKey(connId, channelId) : `${connId}|${channelId}`);
        S.taggedMirrorChatKey = S.taggedMirrorChatKey === key ? null : key;
        if (S.taggedMirrorChatKey) {
          S.mentionedEventIds = (S.mentionedEventIds || []).filter(id => {
            const ev = mirrorEventById.get(id);
            return ev && linkedFeedKey(ev._connId, ev._mirrorChannelId) === S.taggedMirrorChatKey;
          });
          if (S.taggedEventId && !(S.mentionedEventIds || []).includes(S.taggedEventId)) {
            S.taggedEventId = (S.mentionedEventIds || [])[0] || null;
          }
        }
        S.autoTagEventId = null;
        rerenderChatPreservingComposer(view, ch);
        view.querySelector("#composer-input")?.focus();
        return;
      }
      S.chatFilterEventId = null;
      S.memoryChatReadonly = false;
      if (connId && connId !== S.activeConnId && typeof switchConn === "function") {
        switchConn(connId);
      }
      if (typeof Nav?.openChannel === "function") Nav.openChannel(channelId);
      else if (typeof Nav?.set === "function") Nav.set({ kind: "channel", id: channelId });
      try { renderView(); } catch {}
    };
  });
  view.querySelector("#chat-panel-filter-clear")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearPanelEventChatFilter();
    try { renderChannelPanel(true); } catch { renderChat(view, ch); }
  });
  view.querySelector("#chat-panel-filter-open")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const eventId = e.currentTarget?.dataset?.event || filterEv?.id;
    if (!eventId) return;
    if (filterEv?._availability && typeof openAvailabilitySheet === "function") {
      if (view.closest?.("#channel-panel")) {
        try { closeChannelPanel(); } catch {}
      }
      openAvailabilitySheet(eventId);
      return;
    }
    if (view.closest?.("#channel-panel")) {
      try { closeChannelPanel(); } catch {}
    }
    if (typeof openEventDetail === "function") openEventDetail(eventId);
    else if (typeof Nav !== "undefined" && Nav.openEventDetail) {
      Nav.openEventDetail(eventId);
      try { renderView(); } catch {}
    }
  });

  let messageLinkTimer = null;
  let messageLinkTarget = null;
  const clearMessageLinkTimer = () => {
    if (messageLinkTimer) clearTimeout(messageLinkTimer);
    messageLinkTimer = null;
    messageLinkTarget = null;
  };
  let replySwipeBlock = 0;
  scroll.addEventListener("click", async (e) => {
    if (performance.now() < replySwipeBlock) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (typeof boardHandleStreamClick === "function" && boardHandleStreamClick(e)) return;
    if (typeof handleChatPlanPromoteClick === "function" && handleChatPlanPromoteClick(e, { ch, ownerConn: conn })) return;
    const rxBtn = e.target.closest(".msg .rx");
    if (rxBtn && scroll.contains(rxBtn)) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof canMutateContent === "function" && !canMutateContent()) return;
      const msgEl = rxBtn.closest(".msg");
      const messageId = msgEl?.dataset?.msgId;
      const em = rxBtn.dataset.em;
      if (messageId && em && typeof sendChatReaction === "function") {
        sendChatReaction(ch.id, messageId, em);
      }
      return;
    }
    const eventLink = e.target.closest(".chat-event-link:not(.inert), .chat-event-chip:not(.inert)");
    if (eventLink && scroll.contains(eventLink)) {
      e.preventDefault();
      e.stopPropagation();
      const eventId = eventLink.dataset.event;
      if (!eventId) return;
      // Event reference → filter this chat (not the event detail card).
      if (typeof openEventChatFiltered === "function") {
        openEventChatFiltered(ch.id, eventId, { tab: "chat" });
      } else {
        S.chatFilterEventId = eventId;
        S.mentionedEventIds = [eventId];
        if (view.closest?.("#channel-panel")) {
          try { renderChannelPanel(true); } catch { renderChat(view, ch); }
        } else {
          renderChat(view, ch);
        }
      }
      return;
    }
  });
  scroll.addEventListener("selectstart", (e) => {
    // selectstart can target a text node, which has no closest().
    const el = e.target?.nodeType === 1 ? e.target : e.target?.parentElement;
    if (el?.closest(".msg")) e.preventDefault();
  });
  const openHeldChatMessage = (msgEl) => {
    try { window.getSelection()?.removeAllRanges(); } catch {}
    if (!msgEl) return;
    if (typeof chatMoveSelectActive === "function" && chatMoveSelectActive(ch)) return;
    // Board All chat: long-press selects (then act), instead of the options sheet.
    if (msgEl.dataset.realChat === "1" && typeof S !== "undefined" && S.boardChatHome
        && msgEl.closest("#chat-scroll") && typeof boardSelectBegin === "function"
        && boardSelectBegin(msgEl.dataset.msgId || "")) {
      return;
    }
    if (msgEl.dataset.realChat === "1" && typeof openChatMessageOptions === "function") {
      openChatMessageOptions(ch, msgEl.dataset.msgId);
      return;
    }
    openChatMessageLinkSheet(ch, msgEl.dataset.msgId || "", taggableEvents.filter(ev => !ev._mirrorChat), msgEl);
  };
  scroll.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".msg-event-tag, .msg-ev-lead, .chat-event-chip, .chat-event-link, .rx, .msg-reply-quote, .chat-msg-toolbar, .chat-task-complete, .chat-task-retry, .chat-move-check, .chat-event-move, [data-conv-open], [data-move-related], [data-move-expand], [data-board-topic], [data-board-open], [data-board-hide], [data-board-details], [data-board-show], [data-board-gap], [data-board-continue], [data-board-event-tasks], .board-event-task-complete")) return;
    const msg = e.target.closest(".msg");
    if (!msg || !scroll.contains(msg) || (e.button && e.button !== 0)) return;
    const canOpen = msg.dataset.realChat === "1"
      || msg.dataset.canDelete === "1"
      || msg.dataset.canReport === "1";
    if (!canOpen) return;
    window._chatMsgPointerDown = true;
    clearMessageLinkTimer();
    messageLinkTarget = msg;
    messageLinkTimer = setTimeout(() => {
      if (messageLinkTarget) openHeldChatMessage(messageLinkTarget);
      clearMessageLinkTimer();
    }, 480);
  });
  scroll.addEventListener("pointerup", () => { window._chatMsgPointerDown = false; });
  scroll.addEventListener("pointerup", clearMessageLinkTimer);
  scroll.addEventListener("pointercancel", () => { window._chatMsgPointerDown = false; });
  scroll.addEventListener("pointercancel", clearMessageLinkTimer);
  scroll.addEventListener("pointermove", (e) => {
    if (Math.hypot(e.movementX || 0, e.movementY || 0) > 8) clearMessageLinkTimer();
  });
  scroll.addEventListener("contextmenu", (e) => {
    if (e.target.closest(".chat-event-chip, .chat-event-link, .chat-msg-toolbar, .chat-task-complete, .chat-task-retry, .chat-move-check, .chat-event-move, [data-conv-open], [data-move-related], [data-move-expand], [data-board-topic], [data-board-open], [data-board-hide], [data-board-details], [data-board-continue], [data-board-event-tasks], .board-event-task-complete")) return;
    const msg = e.target.closest(".msg");
    if (!msg || !scroll.contains(msg)) return;
    const canOpen = msg.dataset.realChat === "1"
      || msg.dataset.canDelete === "1"
      || msg.dataset.canReport === "1";
    if (!canOpen) return;
    e.preventDefault();
    clearMessageLinkTimer();
    openHeldChatMessage(msg);
  });
  scroll.addEventListener("pointerdown", (e) => {
    if (scroll._replySwipe || (e.button && e.button !== 0)) return;
    if (typeof S !== "undefined" && (S.boardFromChat || S.chatMoveSelect || S.boardSelect)) return;
    if (typeof canMutateContent === "function" && !canMutateContent()) return;
    const msg = e.target.closest?.(".msg[data-msg-id]");
    if (!msg || !scroll.contains(msg) || msg.dataset.realChat !== "1") return;
    if (e.target.closest("button, a, input, textarea, .board-rail, .board-rsvp, .rx, .chat-move-check")) return;
    const messageId = msg.dataset.msgId || "";
    if (!messageId) return;
    const state = {
      msg,
      messageId,
      sx: e.clientX,
      sy: e.clientY,
      locked: false,
      armed: false,
      pointerId: e.pointerId,
    };
    scroll._replySwipe = state;
    const trigger = 64;
    const boardHome = typeof S !== "undefined" && !!S.boardChatHome && !!msg.closest("#chat-scroll")
      && !(typeof boardOnEventPage === "function" && boardOnEventPage());
    const tagged = msg.classList.contains("has-event");
    // With an event in focus, left-to-right on a message from elsewhere tags
    // it into that event (board-select.js boardSwipeTag).
    const focusId = boardHome && typeof S !== "undefined" ? (S.boardEventStep?.eventId || "") : "";
    const swipeTagged = tagged && !(focusId && msg.dataset.event !== focusId);
    state.dir = 0; // -1 reply (right-to-left), +1 tag (left-to-right)
    const shift = (x, progress, armed) => {
      const px = (state.dir > 0 ? x : -x) + "px";
      const avatar = msg.querySelector(":scope > .avatar, :scope > .msg-ev-lead");
      const main = msg.querySelector(".msg-main");
      if (avatar) avatar.style.transform = `translateX(${px})`;
      if (main) main.style.transform = `translateX(${px})`;
      let cue = msg.querySelector(".msg-reply-cue");
      if (!cue) {
        cue = document.createElement("span");
        cue.className = "msg-reply-cue";
        cue.setAttribute("aria-hidden", "true");
        cue.innerHTML = typeof ic === "function" ? ic(state.dir > 0 ? "tag" : "reply") : "";
        cue.classList.toggle("is-left", state.dir > 0);
        msg.appendChild(cue);
      }
      cue.style.opacity = String(progress);
      cue.style.transform = `translateY(-50%) scale(${(0.55 + 0.45 * progress).toFixed(3)})`;
      cue.classList.toggle("is-armed", !!armed);
    };
    let closed = false;
    const finish = (commit) => {
      if (closed) return;
      closed = true;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onUp, true);
      if (scroll._replySwipe === state) scroll._replySwipe = null;
      if (!state.locked) return;
      replySwipeBlock = performance.now() + 450;
      clearMessageLinkTimer();
      msg.classList.remove("is-reply-dragging");
      msg.classList.add("is-reply-settling");
      shift(0, 0, false);
      setTimeout(() => {
        msg.classList.remove("is-reply-settling");
        msg.querySelector(":scope > .avatar, :scope > .msg-ev-lead")?.style.removeProperty("transform");
        msg.querySelector(".msg-main")?.style.removeProperty("transform");
        msg.querySelector(".msg-reply-cue")?.remove();
      }, 240);
      if (!commit) return;
      if (state.dir > 0) {
        // Tag: into the focused event, or the tag state (pick more, drag onto an event).
        if (typeof boardSwipeTag === "function") setTimeout(() => boardSwipeTag(messageId), 160);
        return;
      }
      if (boardHome && tagged && typeof boardBeginContinue === "function") {
        // Reply inside the message's event (the "Continue" action).
        setTimeout(() => boardBeginContinue(messageId, { focus: true }), 160);
        return;
      }
      const found = (typeof activeConn === "function" ? activeConn() : conn)?.messages?.[ch.id]
        ?.find((item) => item && item.id === messageId);
      if (found && typeof setChatReplyTarget === "function") {
        setTimeout(() => setChatReplyTarget(ch, found), 160);
      }
    };
    const onMove = (ev) => {
      if (ev.pointerId !== state.pointerId || scroll._replySwipe !== state) return;
      const dx = ev.clientX - state.sx;
      const dy = ev.clientY - state.sy;
      if (!state.locked) {
        if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) { finish(false); return; }
        const kind = typeof boardClassifyChatSwipe === "function"
          ? boardClassifyChatSwipe({ startX: state.sx, dx, dy, tagged: swipeTagged, boardHome })
          : (dx < -12 && Math.abs(dx) > Math.abs(dy) * 1.2 ? "reply" : (dx > 12 && dx > Math.abs(dy) ? "nav" : null));
        if (kind === "nav") { finish(false); return; }
        if (!kind) return;
        state.dir = kind === "tag" ? 1 : -1;
        state.locked = true;
        clearMessageLinkTimer();
        msg.classList.add("is-reply-dragging");
        try { msg.setPointerCapture(ev.pointerId); } catch {}
      }
      ev.preventDefault();
      const raw = Math.max(0, state.dir > 0 ? dx : -dx);
      const extra = Math.max(0, raw - trigger);
      const shown = Math.min(trigger + extra * 0.3, trigger + 24);
      const armed = raw >= trigger;
      if (armed && !state.armed) {
        try { CardFeel.softConfirm(); } catch {}
      }
      state.armed = armed;
      state.shown = shown;
      shift(shown, Math.min(1, shown / trigger), armed);
    };
    const onUp = (ev) => {
      if (ev.pointerId !== state.pointerId) return;
      finish(!!state.locked && state.armed);
    };
    document.addEventListener("pointermove", onMove, { passive: false });
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onUp, true);
  });

  if (!canMutateContent() || personalReadonly || blockChatNoEvents) {
    if (typeof AshPerf !== "undefined") AshPerf.end("renderChat", perfStarted, 100);
    return;
  }

  view.querySelectorAll(".composer-event-chip-clear").forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      S.mentionedEventIds = (S.mentionedEventIds || []).filter(x => x !== id);
      if (S.taggedEventId === id) S.taggedEventId = null;
      if (S.autoTagEventId === id) S.autoTagEventId = null;
      rerenderChatPreservingComposer(view, ch);
    };
  });
  view.querySelector("#composer-mention-clear")?.addEventListener("click", () => {
    S.mentionedUserIds = [];
    rerenderChatPreservingComposer(view, ch);
  });
  view.querySelector("#composer-reply-clear")?.addEventListener("click", (e) => {
    if (typeof S !== "undefined" && S.boardChatHome && typeof boardCancelReply === "function") {
      e.preventDefault();
      boardCancelReply();
      return;
    }
    S.replyToMessage = null;
    rerenderChatPreservingComposer(view, ch);
  });

  const suggestBox = view.querySelector("#tag-suggest");
  const input = view.querySelector("#composer-input");
  if (!suggestBox || !input) {
    if (typeof boardWireComposer === "function") boardWireComposer(view);
    if (typeof AshPerf !== "undefined") AshPerf.end("renderChat", perfStarted, 100);
    return;
  }
  const eventHaystack = (e) => {
    const server = e._serverName ? `${e._serverName} ` : "";
    const d = e.when ? new Date(e.when) : null;
    const whenBits = d
      ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${fmtDay(e.when)}`
      : "";
    return `${server}${shown(e._title)} ${whenBits}`.toLowerCase();
  };
  const chatTaskComposerCtx = () => {
    const eventIds = typeof composerMentionedEventIds === "function" ? composerMentionedEventIds() : [];
    const extraPayload = {};
    if (eventIds.length) {
      extraPayload.mentionedEventIds = eventIds;
      extraPayload.eventId = eventIds[0];
    }
    const mentionUsers = (S.mentionedUserIds || []).filter(id => mentionableUserIds.has(id));
    if (mentionUsers.length) extraPayload.mentionedUserIds = mentionUsers;
    const replyToId = typeof chatReplyToIdForChannel === "function"
      ? chatReplyToIdForChannel(ch.id, conn)
      : null;
    if (replyToId) extraPayload.replyToId = replyToId;
    return {
      conn, chatChannel: ch, input,
      eventId: eventIds[0] || S.chatFilterEventId || null,
      extraPayload,
      afterPost: () => {
        if (typeof finishChatComposerSend === "function") {
          finishChatComposerSend(view, ch);
          return;
        }
        clearComposerEventTags();
        S.mentionedUserIds = [];
        S.replyToMessage = null;
        if (S.chatFilterEventId) S.mentionedEventIds = [S.chatFilterEventId];
        renderChat(view, ch);
        view.querySelector("#composer-input")?.focus();
      },
    };
  };
  const updateSuggestions = () => {
    if (boardFeed && boardDestinationQuery(input)) { suggestBox.hidden = true; return; }
    const val = input.value;
    if (typeof paintChatTaskSuggestions === "function"
        && paintChatTaskSuggestions(input, suggestBox, chatTaskComposerCtx())) return;
    const hashIdx = val.lastIndexOf("#");
    const atIdx = val.lastIndexOf("@");
    const trigIdx = Math.max(hashIdx, atIdx);
    if (trigIdx === -1) {
      suggestBox.hidden = true;
      return;
    }
    const isMention = trigIdx === atIdx;
    const words = val.slice(trigIdx + 1).toLowerCase().trim().split(/\s+/).filter(Boolean);
    const matches = (isMention
      ? mentionableMembers.filter(u => words.every(w => String(u.name || "").toLowerCase().includes(w)))
      : (S.boardChatHome ? [] : taggableEvents.filter(e => words.every(w => eventHaystack(e).includes(w))))
    ).slice(0, 6);
    if (!matches.length) { suggestBox.hidden = true; return; }
    suggestBox.hidden = false;
    suggestBox.innerHTML = matches.map(x => {
      if (isMention) {
        return `<button type="button" class="tag-suggest-item" data-id="${x.id}">👤 <b>${esc(x.name)}</b></button>`;
      }
      const label = x._serverName
        ? `${shown(x._title)} · ${x._serverName}`
        : shown(x._title);
      const when = x.when ? esc(fmtDay(x.when)) : "";
      return `<button type="button" class="tag-suggest-item" data-id="${esc(x.id)}"><b>#${esc(label)}</b>${when ? `<span>${when}</span>` : ""}</button>`;
    }).join("");
    suggestBox.onclick = (e) => {
      const btn = e.target.closest(".tag-suggest-item");
      if (!btn) return;
        const prefix = val.slice(0, trigIdx).replace(/\s+$/, "");
        let inserted = "";
        if (isMention) {
          if (!S.mentionedUserIds.includes(btn.dataset.id)) S.mentionedUserIds.push(btn.dataset.id);
          inserted = `@${nameOf(btn.dataset.id)}`;
        } else {
          const id = btn.dataset.id;
          if (!(S.mentionedEventIds || []).includes(id)) {
            S.mentionedEventIds = [...(S.mentionedEventIds || []), id];
          }
          S.taggedEventId = id;
          S.autoTagEventId = null;
          const ev = mirrorEventById.get(id) || taggableEvents.find(x => x.id === id);
          if (ev?._connId && ev._mirrorChannelId) {
            S.taggedMirrorChatKey = linkedFeedKey(ev._connId, ev._mirrorChannelId);
          }
          inserted = `#${shown(ev?._title || id)}`;
        }
        rerenderChatPreservingComposer(view, ch);
        const freshInput = view.querySelector("#composer-input");
        freshInput.value = [prefix, inserted].filter(Boolean).join(" ") + (inserted ? " " : (prefix ? " " : ""));
        freshInput.focus();
        freshInput.setSelectionRange(freshInput.value.length, freshInput.value.length);
    };
  };
  input.addEventListener("input", updateSuggestions);

  const composerForm = view.querySelector("#composer-form");
  if (composerForm) composerForm.onsubmit = async (e) => {
    e.preventDefault();
    const continueLast = typeof boardSendContinueActive === "function" && boardSendContinueActive();
    const liveInput = view.querySelector("#composer-input") || input;
    const rawDraft = liveInput?.value || "";
    const draftStart = liveInput?.selectionStart;
    const draftEnd = liveInput?.selectionEnd;
    const text = rawDraft.trim();
    if (!text) return;
    const boardRoute = boardFeed ? boardDestinationRoute() : null;
    if (boardFeed && !boardRoute) return;
    if (personalReadonly) {
      toast("Open an event to chat");
      return;
    }
    if (blockChatNoEvents) {
      toast("Add an event to start chatting");
      return;
    }
    if (requireEventAttach && !composerHasEventAttach()) {
      toast("Attach to an event to send");
      return;
    }
    if (requireMirrorAttach && typeof composerHasMirrorAttach === "function"
        && !composerHasMirrorAttach(ch.id)) {
      toast("Pick a mirrored chat or #tag an event");
      return;
    }

    if (typeof handleChatTaskComposerSubmit === "function") {
      const outcome = await handleChatTaskComposerSubmit({
        ...chatTaskComposerCtx(),
        text: (view.querySelector("#composer-input") || liveInput)?.value || text,
      });
      if (outcome === "blocked") {
        updateSuggestions();
        return;
      }
      if (outcome === "posted") {
        if (typeof finishChatComposerSend === "function") finishChatComposerSend(view, ch);
        else chatTaskComposerCtx().afterPost();
        return;
      }
    }

    markChatJustSent();
    clearLiveChatComposer(view);

    try {
      if ((requireMirrorAttach || autoRouteMirror) && typeof resolvePersonalChatSendRoute === "function") {
        const route = resolvePersonalChatSendRoute(ch, {
          mirrorChatKey: S.taggedMirrorChatKey,
          eventIds: composerMentionedEventIds(),
        });
        if (route?.error) {
          toast(route.error);
          const restore = view.querySelector("#composer-input");
          if (restore) restore.value = text;
          return;
        }
        if (route) {
          const payload = {
            type: "sendMessage",
            channelId: route.channelId,
            text: await encrypt(text, route.key),
          };
          if (route.eventIds?.length) {
            payload.mentionedEventIds = route.eventIds;
            payload.eventId = route.eventIds[0];
          }
          const mentionUsers = (S.mentionedUserIds || []).filter(id => mentionableUserIds.has(id));
          if (mentionUsers.length) payload.mentionedUserIds = mentionUsers;
          const destConn = (route.connId && S.conns?.[route.connId]) || conn;
          const replyToId = typeof chatReplyToIdForChannel === "function"
            ? chatReplyToIdForChannel(route.channelId, destConn)
            : null;
          if (replyToId) payload.replyToId = replyToId;
          send(payload, route.connId);
          try { CardFeel.softConfirm(); } catch {}
          finishChatComposerSend(view, ch);
          return;
        }
      }

      const eventIds = composerMentionedEventIds();
      const payload = { type: "sendMessage", channelId: ch.id, text: await encrypt(text) };
      if (eventIds.length) {
        payload.mentionedEventIds = eventIds;
        payload.eventId = eventIds[0];
      }
      const mentionUsers = (S.mentionedUserIds || []).filter(id => mentionableUserIds.has(id));
      if (mentionUsers.length) payload.mentionedUserIds = mentionUsers;
      const replyToId = typeof chatReplyToIdForChannel === "function"
        ? chatReplyToIdForChannel(ch.id, conn)
        : null;
      if (replyToId) payload.replyToId = replyToId;
      if (boardFeed && typeof boardOutgoingTag === "function") {
        const scope = boardRoute || boardOutgoingTag({ continueLast });
        payload.conversationId = scope.conversationId;
        if (scope.mentionedEventIds && scope.mentionedEventIds.length) {
          payload.mentionedEventIds = scope.mentionedEventIds;
          payload.eventId = scope.mentionedEventIds[0];
        } else {
          delete payload.mentionedEventIds;
          delete payload.eventId;
        }
      }
      if (send(payload) === "failed") throw new Error("Message send failed");
      try { CardFeel.softConfirm(); } catch {}
      finishChatComposerSend(view, ch);
    } catch {
      const restore = view.querySelector("#composer-input");
      if (restore && !restore.value) {
        restore.value = rawDraft;
        restore.setSelectionRange(draftStart ?? rawDraft.length, draftEnd ?? rawDraft.length);
        restore.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (boardFeed) boardChatMemory().draft = restore?.value || rawDraft;
      toast("Message could not be sent. Your draft is still here.");
    }
  };
  if (priorComposer && !hideChatBody && !(typeof S !== "undefined" && S._chatJustSent)) {
    const fresh = view.querySelector("#composer-input");
    if (fresh) {
      fresh.value = priorComposer.value;
      if (priorComposer.focused) {
        try { fresh.focus(boardFeed ? { preventScroll: true } : undefined); }
        catch { try { fresh.focus(); } catch {} }
        fresh.setSelectionRange(
          Math.min(priorComposer.start ?? fresh.value.length, fresh.value.length),
          Math.min(priorComposer.end ?? fresh.value.length, fresh.value.length),
        );
      }
    }
  }
  if (composerForm && typeof bindComposerSendVisibility === "function") {
    bindComposerSendVisibility(composerForm, view.querySelector("#composer-input"), { locked: sendLocked });
  }
  if (boardFeed && boardDraft != null) {
    const kept = view.querySelector("#composer-input");
    if (kept) kept.value = boardDraft;
    const keptForm = view.querySelector("#composer-form");
    if (kept && keptForm && typeof syncComposerSendButton === "function") {
      syncComposerSendButton(keptForm, kept, { locked: !!keptForm._composerSendLocked });
    }
    if (boardFocusComposer && kept) {
      try { kept.focus(); } catch {}
    }
  }
  if (typeof boardWireComposer === "function") boardWireComposer(view);
  if (typeof AshPerf !== "undefined") AshPerf.end("renderChat", perfStarted, 100);
}

/** 030 — event-detail chat is the lower region of the single detail surface. */
