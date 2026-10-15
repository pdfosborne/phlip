/* channel-chat-part4.js — split from channel-chat.js (Part 3 size ceiling).
 * Load after: channel-chat-part3.js; part of channel-chat cluster.
 */

function mountPanelEventFeed(host, ev, opts = {}) {
  if (!host || !ev) return;
  const owner = ownerConnFor(ev) || activeConn();
  const canChat = !owner || PersonalSpace.isPersonal(owner)
    || (typeof canMutateContent === "function" && canMutateContent(owner));
  let ch = (owner?.channels || []).find(c => c.id === ev.channelId)
    || (activeConn()?.channels || []).find(c => c.id === ev.channelId)
    || null;
  if (!ch && owner) {
    ch = (owner.channels || []).find(c => c.kind === "event") || null;
  }
  const title = eventDisplayTitle(ev) || "Event";
  const whenLabel = (typeof fmtDay === "function" && ev.when) ? fmtDay(ev.when) : "";
  const sourceLabel = typeof panelFeedEventSourceLabel === "function" ? panelFeedEventSourceLabel(ev) : "";
  const titleMeta = [
    esc(title),
    whenLabel ? `<span class="panel-event-feed-meta"> · ${esc(whenLabel)}</span>` : "",
    sourceLabel ? `<span class="panel-event-feed-source"> · ${esc(sourceLabel)}</span>` : "",
  ].join("");
  let activeTab = normalizeEdcTab(opts.tab || S._edcTab) || "chat";
  // Personal-only / locked: don't land on a writable chat composer.
  // Memories read-only chat always stays on Chat.
  const memoryReadonly = !!(opts.readOnly || S.memoryChatReadonly
    || (typeof isEventPastDay === "function" && isEventPastDay(ev)));
  const panelChatOk = typeof eventHasPanelChat !== "function" || eventHasPanelChat(ev);
  const chatUnlocked = typeof personalPanelChatUnlocked !== "function" || personalPanelChatUnlocked();
  if (activeTab === "chat" && (!panelChatOk || !chatUnlocked) && !memoryReadonly) {
    // Stay on chat tab to browse history when unlocked+personal-only; composer stays off.
    // When locked, callers should have redirected — still clamp if we get here.
    if (!chatUnlocked) activeTab = "description";
  }
  S._edcTab = activeTab;
  if (typeof channelPanelState !== "undefined") channelPanelState.tab = activeTab;

  const prior = host.querySelector(".panel-event-feed");
  const keepComposer = prior && prior.dataset.eventId === ev.id
    ? (() => {
      const el = prior.querySelector("#edc-input");
      return el ? {
        value: el.value,
        start: el.selectionStart,
        end: el.selectionEnd,
        focused: document.activeElement === el,
      } : null;
    })()
    : null;

  const chat = edcThreadFor(ev, owner, "chat");
  const acts = eventDetailActivityRows(ev);
  const threadFor = (tab) => {
    if (tab === "activity") {
      return acts.length
        ? acts.map(eventDetailActivityHTML).join("")
        : `<p class="edc-empty">No activity yet</p>`;
    }
    if (tab === "description") {
      return eventDescriptionPaneHTML(ev, owner);
    }
    return chat.length
      ? chat.map(m => eventDetailChatMsgHTML(m, ev, { canPin: canChat && !memoryReadonly })).join("")
      : `<p class="edc-empty">No messages yet</p>`;
  };

  host.innerHTML = "";
  host.style.cssText = "display:flex;flex-direction:column;flex:1;min-height:0";

  const feed = document.createElement("div");
  feed.className = "panel-event-feed event-detail-chat-sheet is-open";
  feed.dataset.eventId = ev.id;
  feed.dataset.tab = activeTab;
  if (ch?.id) feed.dataset.channelId = ch.id;
  if (owner?.id) feed.dataset.connId = owner.id;

  // Single-event filter: composer when the event has panel chat (linked/shared) and unlocked.
  // Memories / past events stay read-only.
  const showChatComposer = canChat && activeTab === "chat" && panelChatOk && chatUnlocked && !memoryReadonly;

  feed.innerHTML = `
    <div class="edc-msgs" id="edc-msgs">${threadFor(activeTab)}</div>
    <div class="panel-event-feed-title panel-event-feed-chip" role="status">
      <span class="panel-event-feed-name">${titleMeta}${memoryReadonly ? ` <span class="panel-event-feed-source">· Memory · read-only</span>` : ""}</span>
    </div>
    ${memoryReadonly && activeTab === "chat" && !showChatComposer ? `
    <div class="composer viewer-lock"><p class="empty-note">Memory · read-only</p></div>` : ""}
    ${showChatComposer ? `
    <div class="edc-comp" id="edc-comp">
      <div class="tag-suggest" id="edc-task-suggest" hidden></div>
      <form class="edc-compbar" id="edc-form">
        <span class="edc-ment" id="edc-ment">${esc(title)}</span>
        <input id="edc-input" type="text" placeholder="${!(typeof featureParked === "function" && featureParked("tasks")) && typeof boardTaskChannelForChat === "function" && boardTaskChannelForChat(ch, owner) ? "Message — use /t for tasks" : "Message…"}" maxlength="2000" autocomplete="off" aria-label="Message">
        <button type="submit" class="edc-send" hidden aria-label="Send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg></button>
      </form>
      <div class="edc-posting" id="edc-posting">seen by everyone on this event</div>
    </div>` : (memoryReadonly
      ? ""
      : (activeTab === "chat" && !panelChatOk
      ? `<div class="edc-comp" id="edc-comp"><p class="edc-posting">Chat isn’t available for personal-only events</p></div>`
      : (canChat || activeTab === "activity" || activeTab === "description"
        ? ""
        : `<div class="edc-comp" id="edc-comp"><p class="edc-posting">View-only — you can read but not post</p></div>`)))}`;
  host.appendChild(feed);

  const msgsEl = feed.querySelector("#edc-msgs");
  const input = feed.querySelector("#edc-input");

  const bindDescriptionActions = () => {
    if (activeTab !== "description" || !msgsEl) return;
    msgsEl.querySelector("#edc-desc-save")?.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!owner || !(typeof canEditEvent === "function" && canEditEvent(ev, owner))) return;
      const ta = msgsEl.querySelector("#edc-desc-input");
      const plain = (ta?.value || "").trim();
      const cipher = plain && owner.key ? await encrypt(plain, owner.key) : "";
      send({ type: "setEventDetails", eventId: ev.id, details: cipher }, owner.id);
      ev.details = cipher;
      ev._details = plain;
      toast(plain ? "Description saved" : "Description cleared");
    });
    if (typeof bindEventNotesSection === "function") {
      bindEventNotesSection(msgsEl, ev);
    }
  };

  const paintThread = () => {
    if (!msgsEl) return;
    feed.classList.toggle("tab-activity", activeTab === "activity");
    feed.classList.toggle("tab-description", activeTab === "description");
    feed.classList.toggle("tab-notes", false);
    feed.classList.toggle("mode-personal", false);
    feed.classList.toggle("mode-shared", false);
    if (activeTab === "activity") {
      const rows = eventDetailActivityRows(ev);
      msgsEl.innerHTML = rows.length
        ? rows.map(eventDetailActivityHTML).join("")
        : `<p class="edc-empty">No activity yet</p>`;
    } else if (activeTab === "description") {
      msgsEl.innerHTML = eventDescriptionPaneHTML(ev, owner);
      bindDescriptionActions();
    } else {
      const rows = edcThreadFor(ev, owner, "chat");
      msgsEl.innerHTML = rows.length
        ? rows.map(m => eventDetailChatMsgHTML(m, ev, { canPin: canChat })).join("")
        : `<p class="edc-empty">No messages yet</p>`;
      bindEventDetailChatPins(feed, ev, owner);
    }
    msgsEl.scrollTop = msgsEl.scrollHeight;
  };

  feed.dataset.tab = activeTab;
  paintThread();

  if (activeTab === "chat" && owner?.id && ch?.id) {
    const rawMsgs = owner.messages?.[ch.id] || [];
    try { markEventChatFilterSeen(owner, ch.id, ev.id, rawMsgs); } catch {}
    if (typeof refreshTicketPeopleRow === "function") {
      try { refreshTicketPeopleRow(ev.id); } catch {}
    }
  }

  const setTab = (next) => {
    const tab = normalizeEdcTab(next);
    if (!tab || tab === activeTab) return;
    if (typeof openChannelPanelMode === "function") {
      openChannelPanelMode("info", ch?.id || Panel.channelState()?.channelId || null, {
        tab,
        eventId: S.chatFilterEventId || ev.id,
      });
      return;
    }
    activeTab = tab;
    S._edcTab = tab;
    mountPanelEventFeed(host, ev, { tab });
  };

  const form = feed.querySelector("#edc-form");
  if (form && input) {
    input.addEventListener("input", () => {
      const v = input.value;
      if (/^\/(private|me)\b/i.test(v)) {
        input.value = v.replace(/^\/(private|me)\s*/i, "");
      } else if (/^\/chat\b/i.test(v)) {
        input.value = v.replace(/^\/chat\s*/i, "");
        setTab("chat");
      } else if (/^\/note\b/i.test(v)) {
        input.value = v.replace(/^\/note\s*/i, "");
        toast("Pin a chat message instead");
      }
    });

    const taskSuggest = feed.querySelector("#edc-task-suggest");
    const edcTaskCtx = () => ({
      conn: owner,
      chatChannel: ch,
      input,
      eventId: ev.id,
      encryptKey: owner?.key,
      extraPayload: { eventId: ev.id, mentionedEventIds: [ev.id] },
      afterPost: () => {
        paintThread();
        requestAnimationFrame(() => {
          input.focus();
          try { input.setSelectionRange(input.value.length, input.value.length); } catch {}
        });
      },
    });
    if (taskSuggest && input && typeof paintChatTaskSuggestions === "function") {
      input.addEventListener("input", () => paintChatTaskSuggestions(input, taskSuggest, edcTaskCtx()));
    }

    if (typeof bindComposerSendVisibility === "function") {
      bindComposerSendVisibility(form, input);
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (activeTab !== "chat") return;
      if (!panelChatOk || !chatUnlocked) return;
      let text = input.value.trim();
      if (!text || !owner) return;
      if (/^\/(private|me)\b/i.test(text)) {
        input.value = text.replace(/^\/(private|me)\s*/i, "").trim();
        return;
      }
      if (/^\/note\b/i.test(text)) {
        toast("Pin a chat message instead");
        input.value = text.replace(/^\/note\s*/i, "").trim();
        return;
      }
      if (!text) return;

      if (ch && typeof handleChatTaskComposerSubmit === "function") {
        const outcome = await handleChatTaskComposerSubmit({
          ...edcTaskCtx(),
          text: input.value,
        });
        if (outcome === "blocked") {
          if (taskSuggest && typeof paintChatTaskSuggestions === "function") {
            paintChatTaskSuggestions(input, taskSuggest, edcTaskCtx());
          }
          return;
        }
        if (outcome === "posted") {
          input.value = "";
          if (typeof syncComposerSendButton === "function") syncComposerSendButton(form, input);
          edcTaskCtx().afterPost();
          return;
        }
      }

      const noteId = typeof genLocalId === "function" ? genLocalId() : undefined;

      if (ch) {
        send({
          type: "sendMessage", channelId: ch.id, text: await encrypt(text, owner.key),
          eventId: ev.id, mentionedEventIds: [ev.id],
        }, owner.id);
      } else {
        send({ type: "eventNote", eventId: ev.id, noteId, text: await encrypt(text, owner.key) }, owner.id);
      }

      try { CardFeel.softConfirm(); } catch {}
      const sentText = text;
      input.value = "";
      if (typeof syncComposerSendButton === "function") syncComposerSendButton(form, input);

      if (msgsEl) {
        msgsEl.querySelector(".edc-empty")?.remove();
        msgsEl.insertAdjacentHTML("beforeend", eventDetailChatMsgHTML({
          name: owner.me?.name || "Me",
          userId: owner.me?.id,
          text: sentText,
          _text: sentText,
          ts: Date.now(),
        }, ev, { canPin: false }));
        msgsEl.scrollTop = msgsEl.scrollHeight;
      }
      requestAnimationFrame(() => {
        input.focus();
        try { input.setSelectionRange(input.value.length, input.value.length); } catch {}
      });
      setTimeout(() => input.focus(), 50);
    });
  }

  if (keepComposer && input) {
    input.value = keepComposer.value;
    if (keepComposer.focused) {
      input.focus();
      try {
        input.setSelectionRange(
          Math.min(keepComposer.start ?? input.value.length, input.value.length),
          Math.min(keepComposer.end ?? input.value.length, input.value.length),
        );
      } catch {}
    }
  }
  if (form && input && typeof syncComposerSendButton === "function") {
    syncComposerSendButton(form, input);
  }
}

/** Soft-refresh an open panel event feed; returns true if it was open. */
function refreshPanelEventFeed(eventId) {
  const feed = panelEventFeedHost();
  if (!feed || (eventId && feed.dataset.eventId !== eventId)) return false;
  const id = eventId || feed.dataset.eventId;
  const hit = resolveEventForPanelFeed(id);
  if (!hit) return false;
  const { ev } = hit;
  const host = document.getElementById("channel-panel-body");
  if (!host) return false;
  const fromPanel = (() => {
    const st = Panel.channelState();
    return st ? (normalizeEdcTab(st.tab) || null) : null;
  })();
  const tab = fromPanel
    || (isEdcListTab(S._edcTab) ? (normalizeEdcTab(S._edcTab) || S._edcTab) : "chat");
  mountPanelEventFeed(host, ev, { tab });
  return true;
}

/* ---- moved from channel.js facade ---- */
/* chat view */

// Chat messages for a channel, plus notes from every event channel that mirrors
// into it (linkedChatChannelId). Mirrored server rows are preferred; raw notes
// fill gaps (e.g. linked after the fact, or personal space before mirror).
// Event channels also fold in messages/notes from linked event feeds (same
// scope as the agenda timeline via collectChannelViewEvents).
function collatedChatMessages(ch) {
  const conn = activeConn();
  if (!conn || !ch) return [];
  const out = [];
  const seen = new Set();
  const add = (msg) => {
    if (!msg) return;
    const key = msg.id
      || `${msg.eventId || ""}|${msg.userId}|${msg.ts}|${msg.activity || msg.text || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(msg);
  };
  const pulledChannels = new Set();
  const pullChannelMessages = (owner, channelId, opts = {}) => {
    if (!owner || !channelId) return;
    const key = typeof linkedFeedKey === "function"
      ? linkedFeedKey(owner.id, channelId)
      : `${owner.id}|${channelId}`;
    if (pulledChannels.has(key)) return;
    pulledChannels.add(key);
    const live = owner.messages?.[channelId];
    const cached = (!live || !live.length) && typeof loadCache === "function"
      ? (loadCache(owner.id)?.messages?.[channelId] || [])
      : [];
    const list = (live && live.length) ? live : cached;
    for (const m of list) {
      if (isBlocked(m.userId, owner)) continue;
      add(opts.stamp ? { ...m, ...opts.stamp } : m);
    }
  };

  pullChannelMessages(conn, ch.id);

  // Personal chat: device-local mirrors of remote chat channels.
  if (PersonalSpace.isPersonal(conn) && ch.kind === "chat"
      && typeof directLinkedChatMirrorsFor === "function") {
    for (const link of directLinkedChatMirrorsFor(ch.id)) {
      const owner = S.conns?.[link.connId];
      if (!owner || PersonalSpace.isPersonal(owner)) continue;
      pullChannelMessages(owner, link.channelId, {
        stamp: {
          channelId: ch.id,
          _fromMirroredChat: true,
          _mirrorConnId: link.connId,
          _mirrorChannelId: link.channelId,
        },
      });
    }
  }

  for (const ech of (conn.channels || []).filter(c => c.kind === "event" && c.linkedChatChannelId === ch.id)) {
    // Agenda chat stream — also surface here when this chat is the agenda mirror.
    for (const m of (conn.messages?.[ech.id] || [])) {
      if (isBlocked(m.userId, conn)) continue;
      const dup = out.some(x =>
        x.userId === m.userId && x.ts === m.ts
        && (x.text || x._text || "") === (m.text || m._text || ""));
      if (dup) continue;
      add({ ...m, channelId: ch.id, _fromEventChannel: true });
    }
    pulledChannels.add(typeof linkedFeedKey === "function"
      ? linkedFeedKey(conn.id, ech.id)
      : `${conn.id}|${ech.id}`);
    // Linked boards (Personal # Home / # Friends): the source board's chat,
    // event channel, and notes, so the mirror shows the same stream.
    const linkedSources = typeof expandedLinkedEventSourcesFor === "function"
      ? expandedLinkedEventSourcesFor(conn.id, ech.id)
      : [];
    for (const src of linkedSources) {
      const owner = S.conns?.[src.connId];
      if (!owner || !src.channelId) continue;
      const channels = typeof sourceChannelsFor === "function"
        ? sourceChannelsFor(owner)
        : (owner.channels || []);
      const srcEventCh = channels.find(c => c.id === src.channelId) || null;
      pullChannelMessages(owner, src.channelId, {
        stamp: { channelId: ch.id, _fromLinkedFeed: true },
      });
      const pairedChatId = srcEventCh?.kind === "event" ? srcEventCh.linkedChatChannelId : "";
      if (pairedChatId) {
        pullChannelMessages(owner, pairedChatId, {
          stamp: { channelId: ch.id, _fromLinkedFeed: true },
        });
      }
      const srcEvents = (typeof sourceEventsFor === "function" ? sourceEventsFor(owner) : (owner.events || []))
        .filter(ev => ev && ev.channelId === src.channelId);
      for (const ev of srcEvents) {
        for (const n of (ev.notes || [])) {
          if (n.activity || n.noteKind === "personal") continue;
          if (isBlocked(n.userId, owner)) continue;
          const dup = out.some(m =>
            m.eventId === ev.id && m.userId === n.userId && m.ts === n.ts
            && (m.text || m._text || "") === (n.text || n._text || ""));
          if (dup) continue;
          add({
            id: n.id || `note-${ev.id}-${n.ts}-${n.userId}`,
            noteId: n.id || null,
            channelId: ch.id,
            userId: n.userId,
            name: n.name,
            text: n.text,
            _text: n._text,
            ts: n.ts,
            eventId: ev.id,
            eventTitle: ev.title,
            _eventTitle: ev._title,
            activity: null,
            status: n.status || null,
            targetUserId: n.targetUserId || null,
            targetName: n.targetName || null,
            oldWhen: n.oldWhen ?? null,
            newWhen: n.newWhen ?? null,
            oldWhenPrecision: n.oldWhenPrecision || null,
            newWhenPrecision: n.newWhenPrecision || null,
            oldWhenPeriod: n.oldWhenPeriod || null,
            newWhenPeriod: n.newWhenPeriod || null,
            _fromEventNote: true,
            _fromLinkedFeed: true,
          });
        }
      }
    }
    for (const ev of (conn.events || []).filter(e => e.channelId === ech.id)) {
      for (const n of (ev.notes || [])) {
        // Log posts (RSVP / add / time) stay on the event unless the host
        // opted into mirroring them with Include log posts.
        if (n.activity && !ech.mirrorActivity) continue;
        if (isBlocked(n.userId, conn)) continue;
        const dup = out.some(m =>
          m.eventId === ev.id && m.userId === n.userId && m.ts === n.ts
          && (m.activity || "") === (n.activity || ""));
        if (dup) continue;
        add({
          id: `note-${ev.id}-${n.ts}-${n.userId}${n.activity ? "-" + n.activity : ""}`,
          noteId: n.id || null,
          channelId: ch.id,
          userId: n.userId,
          name: n.name,
          text: n.text,
          _text: n._text,
          ts: n.ts,
          eventId: ev.id,
          eventTitle: ev.title,
          _eventTitle: ev._title,
          activity: n.activity || null,
          status: n.status || null,
          targetUserId: n.targetUserId || null,
          targetName: n.targetName || null,
          oldWhen: n.oldWhen ?? null,
          newWhen: n.newWhen ?? null,
          oldWhenPrecision: n.oldWhenPrecision || null,
          newWhenPrecision: n.newWhenPrecision || null,
          oldWhenPeriod: n.oldWhenPeriod || null,
          newWhenPeriod: n.newWhenPeriod || null,
          _fromEventNote: true,
        });
      }
    }
  }

  // Linked feeds on event channels (personal agendas + server groups).
  const useView = typeof collectChannelViewEvents === "function"
    && (ch.kind === "event" || (!ch.kind && PersonalSpace.isPersonal(conn)));
  if (useView) {
    const viewEvents = collectChannelViewEvents(ch, conn);
    for (const ev of viewEvents) {
      const owner = (typeof ownerConnFor === "function" ? ownerConnFor(ev) : null) || conn;
      const srcChId = ev.channelId;
      if (!owner || !srcChId) continue;
      const isHome = owner.id === conn.id && srcChId === ch.id;
      pullChannelMessages(owner, srcChId, isHome ? {} : {
        stamp: { _fromLinkedFeed: true },
      });
      for (const n of (ev.notes || [])) {
        if (n.activity || n.noteKind === "personal") continue;
        if (isBlocked(n.userId, owner)) continue;
        const dup = out.some(m =>
          m.eventId === ev.id && m.userId === n.userId && m.ts === n.ts
          && (m.text || m._text || "") === (n.text || n._text || ""));
        if (dup) continue;
        add({
          id: n.id || `note-${ev.id}-${n.ts}-${n.userId}`,
          noteId: n.id || null,
          channelId: ch.id,
          userId: n.userId,
          name: n.name,
          text: n.text,
          _text: n._text,
          ts: n.ts,
          eventId: ev.id,
          eventTitle: ev.title,
          _eventTitle: ev._title,
          activity: null,
          status: n.status || null,
          targetUserId: n.targetUserId || null,
          targetName: n.targetName || null,
          oldWhen: n.oldWhen ?? null,
          newWhen: n.newWhen ?? null,
          oldWhenPrecision: n.oldWhenPrecision || null,
          newWhenPrecision: n.newWhenPrecision || null,
          oldWhenPeriod: n.oldWhenPeriod || null,
          newWhenPeriod: n.newWhenPeriod || null,
          _fromEventNote: true,
          _fromLinkedFeed: !isHome,
        });
      }
    }
  }

  return out.filter(m => !isBlocked(m.userId, conn)).sort((a, b) => a.ts - b.ts);
}


async function requestOlderMessages(conn, channelId) {
  if (!conn || !channelId || PersonalSpace.isPersonal(conn)) return false;
  const paging = (conn._messagePaging ||= {})[channelId] ||= {};
  if (paging.loading) return false;
  const list = (conn.messages?.[channelId] || []).slice()
    .sort((a, b) => (a.ts || 0) - (b.ts || 0) || String(a.id || "").localeCompare(String(b.id || "")));
  const first = list[0];
  if (!first || conn.status !== "online") return false;
  paging.loading = true;
  paging.perfStarted = typeof AshPerf !== "undefined" ? AshPerf.begin("chat.page") : 0;
  const result = sendTo(conn, {
    type: "getMessagePage",
    requestId: genLocalId(),
    channelId,
    beforeTs: Number(first.ts) || 0,
    beforeId: String(first.id || ""),
  });
  if (result === "failed") {
    paging.loading = false;
    return false;
  }
  return true;
}

function applyMessageHistoryPage(conn, page) {
  const channelId = page?.channelId;
  if (!conn || !channelId || !Array.isArray(page.items)) return;
  const paging = (conn._messagePaging ||= {})[channelId] ||= {};
  paging.loading = false;
  if (typeof AshPerf !== "undefined" && paging.perfStarted) AshPerf.end("chat.page", paging.perfStarted, 250);
  const current = conn.messages?.[channelId] || [];
  const byId = new Map(current.filter(row => row?.id).map(row => [row.id, row]));
  for (const row of page.items) if (row?.id) byId.set(row.id, row);
  (conn.messages ||= {})[channelId] = [...byId.values()]
    .sort((a, b) => (a.ts || 0) - (b.ts || 0) || String(a.id || "").localeCompare(String(b.id || "")));
  conn._messagePaging[channelId] = {
    hasMore: !!page.hasMore,
    beforeTs: Number(page.beforeTs) || 0,
    beforeId: String(page.beforeId || ""),
  };
  Promise.all(page.items.map(row => decMsg(row, conn.key))).then(() => {
    cacheConn(conn);
    const scroll = document.querySelector("#chat-scroll");
    const beforeHeight = scroll?.scrollHeight || 0;
    if (conn.id === S.activeConnId && S.activeView?.kind === "channel" && S.activeView.id === channelId) {
      renderView(true);
      requestAnimationFrame(() => {
        const next = document.querySelector("#chat-scroll");
        if (next && beforeHeight) next.scrollTop += Math.max(0, next.scrollHeight - beforeHeight);
      });
    }
  });
}
