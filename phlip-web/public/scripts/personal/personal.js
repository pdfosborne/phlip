/* --------------------------- personal space ------------------------------- */
/* The personal conn is a pseudo-connection: nothing ever touches a socket.
   localApply() plays the same role DrServer.kt does for a real server —
   validate the incoming action, then hand a byte-shape-identical "broadcast"
   to handle() so the exact same code path (state mutation, cache, re-render,
   draft followups) runs whether the event lives on a phone across the room or
   only ever on this one. */

function genLocalId() {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}

function replacePlaceLabel(raw, from, to) {
  if (typeof parseEventPlaces !== "function" || typeof formatEventPlaces !== "function") return null;
  const source = String(from || "").trim().toLowerCase();
  const dest = String(to || "").trim();
  if (!source || !dest) return null;
  const parts = parseEventPlaces(raw);
  if (!parts.some(p => p.toLowerCase() === source)) return null;
  return formatEventPlaces(parts.map(p => p.toLowerCase() === source ? dest : p));
}

/** Point local bookings and a location pin at the name that was kept. */
function applyLocalPlaceRename(conn, from, to) {
  const source = String(from || "").trim();
  const dest = String(to || "").trim();
  if (!conn || !source || !dest) return;
  for (const ev of conn.events || []) {
    const idNext = replacePlaceLabel(ev.locationLabelId || "", source, dest);
    if (idNext != null) ev.locationLabelId = idNext || null;
    const wherePlain = String(ev._where || (conn.local && ev.where && !String(ev.where).startsWith("e2e:") ? ev.where : "") || "");
    const whereNext = replacePlaceLabel(wherePlain, source, dest);
    if (whereNext != null) {
      ev._where = whereNext;
      if (!ev.where || ev.where === wherePlain) ev.where = whereNext;
    }
  }
  for (const ch of conn.channels || []) {
    if (!ch.pinnedLocationLabel || ch.pinnedLocationLabel.toLowerCase() !== source.toLowerCase()) continue;
    const taken = (conn.channels || []).some(c =>
      c.id !== ch.id && c.pinnedLocationLabel
      && String(c.pinnedLocationLabel).toLowerCase() === dest.toLowerCase());
    if (taken) continue;
    const old = ch.pinnedLocationLabel;
    ch.pinnedLocationLabel = dest;
    ch.enabledLocations = [dest];
    if (String(ch.name || "").toLowerCase() === String(old || "").toLowerCase()) ch.name = dest.slice(0, 32);
  }
}

function localApply(conn, m) {
  if (typeof isDeviceCalendarChannel === "function" && (
      isDeviceCalendarChannel(m.channelId, conn) || isDeviceCalendarChannel(m.id, conn)
      || conn.events?.some(e => e.calendarImported && (e.id === m.id || e.id === m.eventId)))) return;
  const findEv = (id) => conn.events.find(e => e.id === id);
  const findChatTarget = (id) => {
    const ev = findEv(id);
    if (ev) return ev;
    const avail = (conn.availabilities || []).find(a => a.id === id);
    return (avail && typeof availabilityAsChatEvent === "function")
      ? availabilityAsChatEvent(avail, conn)
      : null;
  };
  const addActivity = (ev, activity) => {
    const note = {
      userId: conn.me.id, name: conn.me.name, text: "", ts: Date.now(),
      ...activity,
    };
    handle(conn, { type: "eventNoteAdded", eventId: ev.id, note });
    if (ev.notes && ev.notes.length > 50) ev.notes.shift();
  };
  const refresh = () => {
    if (conn.id !== S.activeConnId) return;
    renderSidebar();
    renderView();
  };

  switch (m.type) {
    case "createChannel": {
      if (conn.channels.length >= 32) return;
      const kind = m.kind === "event" ? "event" : "chat";
      let name = String(m.name || "").trim().slice(0, 32);
      if (!name) return;
      if (kind === "chat") name = name.replace(/\s+/g, " ").trim();
      let pinned = null;
      if (kind === "event" && m.pinnedLocationLabel != null && String(m.pinnedLocationLabel).trim()) {
        const want = String(m.pinnedLocationLabel).trim();
        const locs = typeof locationsFor === "function"
          ? locationsFor(conn)
          : (typeof LOCATIONS !== "undefined" ? LOCATIONS : []);
        const hit = (locs || []).find(l => String(l.label || "").toLowerCase() === want.toLowerCase());
        const imported = !hit && typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn)
          && typeof shownBoardPlaceLabel === "function"
          ? shownBoardPlaceLabel(want)
          : "";
        if (!hit && !imported) return;
        const pinLabel = hit ? hit.label : imported;
        if ((conn.channels || []).some(c =>
          c.kind === "event" && c.pinnedLocationLabel != null
          && String(c.pinnedLocationLabel).toLowerCase() === pinLabel.toLowerCase())) {
          return;
        }
        pinned = pinLabel;
      }
      const welcomeChannel = kind === "chat" && !!m.welcomeChannel;
      const board = m.boardId && (conn.boards || []).find(b => b.id === m.boardId);
      if (!pinned && !welcomeChannel) {
        if (!board) return;
        const exists = (conn.channels || []).some(c =>
          c.boardId === board.id && c.kind === kind && !(typeof isPinnedChannel === "function" && isPinnedChannel(c)));
        if (exists) return;
      } else if (board) {
        return;
      }
      const linked = kind === "event" && board
        ? (typeof chatChannelForBoard === "function" ? chatChannelForBoard(board, conn)?.id : null)
        : (kind === "event" && m.linkedChatChannelId
          && conn.channels.some(c => c.id === m.linkedChatChannelId && c.kind === "chat")
          ? m.linkedChatChannelId : null);
      conn.channels.push({
        id: genLocalId(), name: board?.name || name, kind,
        allowedUserIds: null,
        autoIncludeNewMembers: false,
        minRole: "viewer",
        enabledCardIds: kind === "event" ? (m.enabledCardIds || null) : null,
        enabledCategoryIds: kind === "event" ? (m.enabledCategoryIds || null) : null,
        enabledLocations: kind === "event"
          ? (pinned ? [pinned] : (m.enabledLocations || null))
          : null,
        pinnedLocationLabel: pinned,
        allowAvailability: !!(kind === "event" && !pinned && m.allowAvailability),
        linkedChatChannelId: linked,
        mirrorActivity: !!(kind === "event" && linked && m.mirrorActivity),
        boardId: board?.id || null,
        welcomeChannel,
      });
      if (board && typeof applyBoardVisibility === "function") applyBoardVisibility(conn, board);
      savePersonal(conn);
      refresh();
      if (kind === "chat") {
        try { window.Onboarding?.noteAction?.("chat-channel"); } catch {}
      }
      break;
    }

    case "createBoard": {
      if (!Array.isArray(conn.boards)) conn.boards = [];
      const isSource = !!(m.sourceConnId && m.sourceBoardId);
      const localCount = conn.boards.filter(b => !b.sourceConnId).length;
      if (!isSource && localCount >= 16) return;
      if (conn.channels.length + 3 > 32) return;
      const name = String(m.name || "").trim().slice(0, 32);
      if (!name) return;
      const board = {
        id: (isSource && m.id) ? String(m.id) : genLocalId(),
        name,
        icon: String(m.icon || "").trim() || null,
        shownKind: typeof normalizeBoardShownKind === "function"
          ? normalizeBoardShownKind(m.shownKind)
          : (m.shownKind === "chat" || m.shownKind === "task" ? m.shownKind : "event"),
        allowedUserIds: null,
        autoIncludeNewMembers: false,
      };
      if (isSource) {
        board.sourceConnId = String(m.sourceConnId);
        board.sourceBoardId = String(m.sourceBoardId);
      }
      conn.boards.push(board);
      const chat = {
        id: genLocalId(), name, kind: "chat", boardId: board.id,
        allowedUserIds: null, autoIncludeNewMembers: false, minRole: "viewer",
      };
      const event = {
        id: genLocalId(), name, kind: "event", boardId: board.id,
        allowedUserIds: null, autoIncludeNewMembers: false, minRole: "viewer",
        linkedChatChannelId: chat.id,
        mirrorActivity: !!m.mirrorActivity,
        allowAvailability: !!m.allowAvailability,
        enabledCardIds: m.enabledCardIds || null,
        enabledCategoryIds: m.enabledCategoryIds || null,
        enabledLocations: m.enabledLocations || null,
      };
      const task = {
        id: genLocalId(), name, kind: "task", boardId: board.id,
        allowedUserIds: null, autoIncludeNewMembers: false, minRole: "viewer",
      };
      conn.channels.push(event, chat, task);
      if (typeof applyBoardVisibility === "function") applyBoardVisibility(conn, board);
      savePersonal(conn);
      if (typeof S !== "undefined") {
        S.pendingBoardLand = { connId: conn.id, boardId: board.id, shownKind: board.shownKind };
      }
      refresh();
      break;
    }

    case "updateBoard": {
      const board = (conn.boards || []).find(b => b.id === m.boardId);
      if (!board) return;
      const required = typeof PersonalSpace !== "undefined" && PersonalSpace.isRequiredBoard?.(board, conn);
      const raw = String(m.name || "").trim().slice(0, 32);
      if (required) board.name = PersonalSpace.MY_PLANS_NAME;
      else if (board.sourceConnId) { /* name/icon follow the hosted board */ }
      else if (raw) board.name = raw;
      if ("icon" in m && !board.sourceConnId) board.icon = String(m.icon || "").trim() || null;
      if ("hiddenKinds" in m) {
        if (typeof applyBoardHiddenKinds === "function") applyBoardHiddenKinds(board, m.hiddenKinds);
        else board.hiddenKinds = Array.isArray(m.hiddenKinds) ? m.hiddenKinds.slice() : [];
      }
      if ("shownKind" in m) {
        const next = typeof normalizeBoardShownKind === "function"
          ? normalizeBoardShownKind(m.shownKind)
          : (m.shownKind === "chat" || m.shownKind === "task" ? m.shownKind : "event");
        if (typeof boardKindVisible !== "function" || boardKindVisible(board, next)) {
          board.shownKind = next;
        } else if (typeof clampBoardShownKind === "function") {
          clampBoardShownKind(board);
        } else {
          board.shownKind = next;
        }
      }
      if ("allowShowInPersonal" in m) board.allowShowInPersonal = m.allowShowInPersonal !== false;
      board.allowedUserIds = null;
      board.autoIncludeNewMembers = false;
      if (typeof applyBoardVisibility === "function") applyBoardVisibility(conn, board);
      const event = typeof eventChannelForBoard === "function" ? eventChannelForBoard(board, conn) : null;
      if (event && "mirrorActivity" in m) event.mirrorActivity = !!m.mirrorActivity;
      if (event && "allowAvailability" in m) event.allowAvailability = !!m.allowAvailability;
      savePersonal(conn);
      refresh();
      break;
    }

    case "deleteBoard": {
      const idx = (conn.boards || []).findIndex(b => b.id === m.boardId);
      if (idx < 0) return;
      const board = conn.boards[idx];
      if (typeof PersonalSpace !== "undefined" && PersonalSpace.isRequiredBoard?.(board, conn)) return;
      const childIds = (conn.channels || []).filter(c => c.boardId === board.id).map(c => c.id);
      const childIdSet = new Set(childIds);
      const ev = typeof eventChannelForBoard === "function" ? eventChannelForBoard(board, conn) : null;
      const chat = typeof chatChannelForBoard === "function" ? chatChannelForBoard(board, conn) : null;
      if (board.sourceConnId && board.sourceBoardId && typeof setBoardShownInPersonal === "function") {
        const pins = typeof loadShownBoards === "function" ? loadShownBoards() : [];
        const key = typeof shownBoardKey === "function"
          ? shownBoardKey(board.sourceConnId, board.sourceBoardId)
          : `${board.sourceConnId}:${board.sourceBoardId}`;
        const next = pins.filter(p =>
          (typeof shownBoardKey === "function" ? shownBoardKey(p.connId, p.boardId) : `${p.connId}:${p.boardId}`) !== key
        );
        if (next.length !== pins.length && typeof saveShownBoards === "function") {
          shownBoardsCache = next;
          saveShownBoards();
        }
        if (ev) setLinkedEventSources("personal", ev.id, []);
        if (chat) setLinkedChatMirrors(chat.id, []);
      }
      conn.boards.splice(idx, 1);
      conn.tasks = (conn.tasks || []).filter(t => !childIdSet.has(t.channelId));
      for (const cid of childIds) {
        const cidx = conn.channels.findIndex(c => c.id === cid);
        if (cidx < 0) continue;
        const ch = conn.channels.splice(cidx, 1)[0];
        if (ch.kind === "event") {
          conn.events = conn.events.filter(e => e.channelId !== ch.id);
          conn.availabilities = (conn.availabilities || []).filter(a => a.channelId !== ch.id);
          conn.timeBlocks = (conn.timeBlocks || []).filter(b => b.channelId !== ch.id);
        } else {
          delete conn.messages[ch.id];
        }
        if (S.activeView?.kind === "channel" && S.activeView.id === ch.id) Nav.set({ kind: "events" });
      }
      savePersonal(conn);
      refresh();
      break;
    }

    case "reorderBoards": {
      const ids = Array.isArray(m.boardIds) ? m.boardIds : [];
      if (typeof applyChannelOrder === "function") applyChannelOrder(conn.boards, ids);
      savePersonal(conn);
      refresh();
      break;
    }

    case "updateLocations": {
      if (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn)) return;
      if (typeof canManageServer === "function" && !canManageServer(conn)) return;
      const rows = Array.isArray(m.locations) ? m.locations : [];
      const next = [];
      const seen = new Set();
      for (const row of rows) {
        const label = String(row && row.label != null ? row.label : row || "").trim().slice(0, 60);
        if (!label) continue;
        const key = label.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const mapRaw = String(row?.mapUrl || "").trim();
        const mapUrl = /^https?:\/\//i.test(mapRaw) || /^geo:/i.test(mapRaw) ? mapRaw.slice(0, 500) : "";
        const categoryId = String(row?.categoryId || "other").trim().slice(0, 40) || "other";
        next.push({ label, categoryId, ...(mapUrl ? { mapUrl } : {}) });
      }
      conn.locations = next;
      for (const pair of (Array.isArray(m.renames) ? m.renames : [])) {
        applyLocalPlaceRename(conn, pair && pair.from, pair && pair.to);
      }
      refresh();
      break;
    }

    case "updateChannel": {
      const ch = conn.channels.find(c => c.id === m.channelId);
      if (!ch) return;
      if (typeof PersonalSpace !== "undefined" && PersonalSpace.isAcceptedChannel(ch, conn)) return;
      const required = typeof PersonalSpace !== "undefined" && PersonalSpace.isRequiredChannel(ch, conn);
      const raw = String(m.name || "").trim().slice(0, 32);
      if (required) ch.name = PersonalSpace.MY_PLANS_NAME;
      else if (raw) {
        ch.name = raw;
        const board = (conn.boards || []).find(b => b.id === ch.boardId);
        if (board && !PersonalSpace?.isRequiredBoard?.(board, conn)) {
          board.name = raw;
          if (typeof applyBoardVisibility === "function") applyBoardVisibility(conn, board);
        }
      }
      // Personal space is only this device — never store allow-lists or role floors.
      ch.allowedUserIds = null;
      ch.autoIncludeNewMembers = false;
      ch.minRole = "viewer";
      if (ch.kind === "event" && "enabledCardIds" in m) ch.enabledCardIds = m.enabledCardIds || null;
      if (ch.kind === "event" && "enabledCategoryIds" in m) ch.enabledCategoryIds = m.enabledCategoryIds || null;
      if (ch.kind === "event" && ch.pinnedLocationLabel != null && m.pinnedLocationLabel != null) {
        const next = String(m.pinnedLocationLabel || "").trim().slice(0, 60);
        const listed = (typeof locationsFor === "function" ? locationsFor(conn) : [])
          .find(l => String(l.label || "").toLowerCase() === next.toLowerCase());
        const imported = !listed && typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn)
          && typeof shownBoardPlaceLabel === "function"
          ? shownBoardPlaceLabel(next)
          : "";
        const label = listed?.label || imported;
        const taken = label && (conn.channels || []).some(c =>
          c.id !== ch.id && c.pinnedLocationLabel
          && String(c.pinnedLocationLabel).toLowerCase() === label.toLowerCase());
        if (label && !taken) {
          const old = ch.pinnedLocationLabel;
          ch.pinnedLocationLabel = label;
          if (String(ch.name || "").toLowerCase() === String(old || "").toLowerCase()) ch.name = label.slice(0, 32);
        }
      }
      if (ch.kind === "event" && ch.pinnedLocationLabel != null) {
        // Pinned boards stay locked to their place — ignore location filter edits.
        ch.enabledLocations = [ch.pinnedLocationLabel];
      } else if (ch.kind === "event" && "enabledLocations" in m) {
        ch.enabledLocations = m.enabledLocations || null;
      }
      if (ch.kind === "event" && "linkedChatChannelId" in m) {
        ch.linkedChatChannelId = m.linkedChatChannelId
          && conn.channels.some(c => c.id === m.linkedChatChannelId && c.kind === "chat")
          ? m.linkedChatChannelId : null;
      }
      if (ch.kind === "event" && "mirrorActivity" in m) {
        ch.mirrorActivity = !!(ch.linkedChatChannelId && m.mirrorActivity);
      } else if (ch.kind === "event" && !ch.linkedChatChannelId) {
        ch.mirrorActivity = false;
      }
      if (ch.kind === "event" && "allowAvailability" in m) {
        ch.allowAvailability = ch.pinnedLocationLabel == null
          && ch.pinnedUserId == null
          && !!m.allowAvailability;
      }
      if ("icon" in m) {
        const raw = String(m.icon || "").trim();
        ch.icon = raw || null;
      }
      savePersonal(conn);
      refresh();
      break;
    }

    case "reorderChannels": {
      const ids = Array.isArray(m.channelIds) ? m.channelIds : [];
      if (typeof applyChannelOrder !== "function") return;
      applyChannelOrder(conn.channels, ids);
      savePersonal(conn);
      refresh();
      break;
    }

    case "deleteChannel": {
      const idx = conn.channels.findIndex(c => c.id === m.channelId);
      if (idx < 0) return;
      if (typeof PersonalSpace !== "undefined" && PersonalSpace.isProtectedChannel(conn.channels[idx], conn)) return;
      if (conn.channels[idx].boardId) return;
      const ch = conn.channels.splice(idx, 1)[0];
      if (ch.kind === "event") {
        conn.events = conn.events.filter(e => e.channelId !== ch.id);
        conn.availabilities = (conn.availabilities || []).filter(a => a.channelId !== ch.id);
        conn.timeBlocks = (conn.timeBlocks || []).filter(b => b.channelId !== ch.id);
      } else if (ch.kind === "chat") {
        delete conn.messages[ch.id];
        for (const other of conn.channels) {
          if (other.linkedChatChannelId === ch.id) {
            other.linkedChatChannelId = null;
            other.mirrorActivity = false;
          }
        }
      } else if (ch.kind === "task") {
        conn.tasks = (conn.tasks || []).filter(t => t.channelId !== ch.id);
      }
      if (S.activeView?.kind === "channel" && S.activeView.id === ch.id) Nav.set({ kind: "events" });
      savePersonal(conn);
      refresh();
      break;
    }

    case "createTask": {
      const ch = conn.channels.find(c => c.id === m.channelId && c.kind === "task");
      if (!ch || !ch.boardId || !boardById(ch.boardId, conn)) return;
      const text = String(m.text || "").trim().slice(0, 500);
      if (!text) return;
      if (!Array.isArray(conn.tasks)) conn.tasks = [];
      const id = String(m.id || genLocalId());
      if (!id) return;
      const optimistic = conn.tasks.find(t => t.id === id);
      if (optimistic?.revision || (optimistic && optimistic.channelId !== ch.id)) return;
      const now = Date.now();
      const created = {
        id, channelId: ch.id, text, completed: false,
        createdBy: conn.me.id, createdByName: conn.me.name,
        createdAt: now, updatedAt: now, revision: 1,
      };
      if ("eventId" in m) {
        const eid = String(m.eventId || "").trim();
        if (eid) created.eventId = eid;
      }
      handle(conn, {
        type: "taskCreated",
        task: created,
      });
      savePersonal(conn);
      break;
    }

    case "updateTask": {
      const taskId = String(m.taskId || m.id || "");
      const task = (conn.tasks || []).find(t => t.id === taskId);
      const ch = task && conn.channels.find(c => c.id === task.channelId && c.kind === "task");
      if (!task || !ch || !ch.boardId || !boardById(ch.boardId, conn)) return;
      if (m.channelId && m.channelId !== ch.id) return;
      const text = String(m.text || "").trim().slice(0, 500);
      if (!text) return;
      const updated = {
        ...task,
        text,
        updatedAt: Date.now(),
        revision: Math.max(0, Number(task.revision) || 0) + 1,
      };
      if ("eventId" in m) {
        const eid = String(m.eventId || "").trim();
        if (eid) updated.eventId = eid;
        else delete updated.eventId;
      }
      handle(conn, { type: "taskUpdated", task: updated });
      savePersonal(conn);
      break;
    }

    case "setTaskCompleted": {
      const taskId = String(m.taskId || m.id || "");
      const task = (conn.tasks || []).find(t => t.id === taskId);
      const ch = task && conn.channels.find(c => c.id === task.channelId && c.kind === "task");
      if (!task || !ch || !ch.boardId || !boardById(ch.boardId, conn)) return;
      if (m.channelId && m.channelId !== ch.id) return;
      const completed = !!m.completed;
      const now = Date.now();
      const updated = {
        ...task,
        completed,
        completedAt: completed ? now : null,
        updatedAt: now,
        revision: Math.max(0, Number(task.revision) || 0) + 1,
      };
      handle(conn, { type: "taskUpdated", task: updated });
      savePersonal(conn);
      break;
    }

    case "deleteTask": {
      const taskId = String(m.taskId || m.id || "");
      const task = (conn.tasks || []).find(t => t.id === taskId);
      const ch = task && conn.channels.find(c => c.id === task.channelId && c.kind === "task");
      if (!task || !ch || !ch.boardId || !boardById(ch.boardId, conn)) return;
      if (m.channelId && m.channelId !== ch.id) return;
      conn.tasks = conn.tasks.filter(t => t.id !== task.id);
      handle(conn, { type: "taskDeleted", taskId: task.id, channelId: ch.id, actionId: m.actionId || "" });
      savePersonal(conn);
      break;
    }

    case "createPoll":
    case "updatePoll":
    case "votePoll":
    case "closePoll":
      if (typeof applyPollCommand === "function") applyPollCommand(conn, m);
      else savePersonal(conn);
      break;

    case "sendMessage": {
      const ch = conn.channels.find(c => c.id === m.channelId);
      if (!ch || !m.text) return;
      const taggedIds = [];
      if (Array.isArray(m.mentionedEventIds)) {
        for (const id of m.mentionedEventIds) if (id) taggedIds.push(id);
      }
      if (m.eventId && !taggedIds.includes(m.eventId)) taggedIds.unshift(m.eventId);
      const mentionable = typeof chatMentionableMembers === "function"
        ? new Set(chatMentionableMembers(ch, conn).map(u => u.id))
        : null;
      const mentionedUserIds = Array.isArray(m.mentionedUserIds)
        ? m.mentionedUserIds.filter(id => id && (!mentionable || mentionable.has(id)))
        : null;
      const tagged = taggedIds.map(id => findChatTarget(id)).filter(Boolean);
      const primary = tagged[0] || null;
      const destList = conn.messages[ch.id] || [];
      const replyToId = m.replyToId && destList.some(x => x.id === m.replyToId) ? m.replyToId : null;
      const requestedTaskId = String(m.taskId || "").trim();
      let taskId = null;
      if (requestedTaskId) {
        const taskCh = ch.boardId && (conn.channels || []).find(c =>
          c.boardId === ch.boardId && c.kind === "task");
        const task = taskCh && (conn.tasks || []).find(t =>
          t.id === requestedTaskId && t.channelId === taskCh.id);
        if (task) taskId = task.id;
      }
      const msg = {
        id: m.id || genLocalId(), channelId: ch.id, userId: conn.me.id, name: conn.me.name,
        text: m.text, ts: Date.now(),
        mentionedUserIds: mentionedUserIds?.length ? mentionedUserIds : null,
        mentionedEventIds: taggedIds.length ? taggedIds : null,
        eventId: primary?.id || null,
        eventTitle: primary?._title || primary?.title || null,
        replyToId,
        taskId,
        conversationId: m.conversationId || null,
      };
      if (typeof hydratePlainMessage === "function") hydratePlainMessage(msg);
      handle(conn, { type: "message", message: msg });
      if (primary && !primary._availability) {
        const note = { userId: conn.me.id, name: conn.me.name, text: m.text, ts: msg.ts };
        handle(conn, { type: "eventNoteAdded", eventId: primary.id, note });
        if (primary.notes && primary.notes.length > 50) primary.notes.shift();
      }
      // Agenda → linked chat mirror (same as server).
      if (ch.kind === "event" && ch.linkedChatChannelId) {
        const linked = conn.channels.find(c => c.id === ch.linkedChatChannelId && c.kind === "chat");
        if (linked) {
          const mirrorReply = msg.replyToId
            && (conn.messages[linked.id] || []).some(x => x.id === msg.replyToId)
            ? msg.replyToId : null;
          const mirror = {
            ...msg,
            id: genLocalId(),
            channelId: linked.id,
            replyToId: mirrorReply,
            reactions: null,
          };
          handle(conn, { type: "message", message: mirror });
        }
      }
      savePersonal(conn);
      break;
    }

    case "tagMessageEvents": {
      const ch = conn.channels.find(c => c.id === m.channelId);
      if (!ch || !m.messageId) return;
      const list = conn.messages[ch.id] || [];
      const msg = list.find(x => x.id === m.messageId);
      if (!msg) return;
      if (m.clear) {
        msg.eventId = null;
        msg.eventTitle = null;
        msg.mentionedEventIds = null;
        msg.linkedByUserId = null;
        msg.linkedByUserName = null;
      } else {
        const ids = Array.isArray(m.mentionedEventIds) ? m.mentionedEventIds.filter(Boolean) : [];
        if (m.eventId && !ids.includes(m.eventId)) ids.unshift(m.eventId);
        const primary = ids[0] ? findChatTarget(ids[0]) : null;
        msg.mentionedEventIds = ids.length ? ids : null;
        msg.eventId = primary?.id || ids[0] || null;
        msg.eventTitle = primary?._title || primary?.title || null;
        msg.linkedByUserId = conn.me.id;
        msg.linkedByUserName = conn.me.name;
      }
      if (m.conversationId) msg.conversationId = m.conversationId;
      handle(conn, { type: "messageUpdated", message: msg });
      savePersonal(conn);
      break;
    }

    case "editMessage": {
      const ch = conn.channels.find(c => c.id === m.channelId);
      if (!ch || !m.messageId || !m.text) return;
      const list = conn.messages[ch.id] || [];
      const msg = list.find(x => x.id === m.messageId);
      if (!msg || msg.activity || msg.userId !== conn.me.id) return;
      msg.text = m.text;
      delete msg._text;
      msg.editedAt = Date.now();
      if (typeof hydratePlainMessage === "function") hydratePlainMessage(msg);
      handle(conn, { type: "messageUpdated", message: msg });
      savePersonal(conn);
      break;
    }

    case "reactMessage": {
      const ch = conn.channels.find(c => c.id === m.channelId);
      if (!ch || !m.messageId || !m.emoji) return;
      const allowed = (typeof CHAT_REACT_EMOJIS !== "undefined")
        ? CHAT_REACT_EMOJIS
        : ["❤️", "🔥", "😂", "👍", "🎉", "👀"];
      const drawn = typeof isDrawnIcon === "function" && isDrawnIcon(m.emoji);
      if (drawn) {
        if (typeof canUserDraw === "function" && !canUserDraw(conn)) return;
      } else if (!allowed.includes(m.emoji)) {
        return;
      }
      const list = conn.messages[ch.id] || [];
      const msg = list.find(x => x.id === m.messageId);
      if (!msg || msg.activity) return;
      const map = { ...(msg.reactions || {}) };
      const uid = conn.me.id;
      if (map[uid] === m.emoji) delete map[uid];
      else map[uid] = m.emoji;
      msg.reactions = Object.keys(map).length ? map : null;
      if (drawn && map[uid] === m.emoji && typeof upsertReactionCard === "function") {
        upsertReactionCard(conn, m.emoji, conn.me);
      }
      handle(conn, {
        type: "messageUpdated",
        message: msg,
        reactionCards: conn.reactionCards || [],
      });
      savePersonal(conn);
      break;
    }

    case "deleteReactionCard": {
      const card = String(m.card || m.emoji || "").trim();
      if (!card || (typeof isDrawnIcon === "function" && !isDrawnIcon(card))) return;
      if (typeof stripDrawnPayloadFromConn === "function") stripDrawnPayloadFromConn(conn, card);
      savePersonal(conn);
      refresh();
      break;
    }

    case "deleteMessage": {
      const ch = conn.channels.find(c => c.id === m.channelId);
      if (!ch || !m.messageId) return;
      const list = conn.messages[ch.id] || [];
      const target = list.find(x => x.id === m.messageId);
      if (!target) return;
      const own = target.userId === conn.me.id;
      const mod = !(typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn))
        && typeof canModerateEvents === "function" && canModerateEvents(conn);
      if (!own && !mod) return;
      handle(conn, { type: "messageDeleted", channelId: ch.id, messageId: m.messageId });
      if (target.eventId) {
        handle(conn, {
          type: "eventNoteDeleted",
          eventId: target.eventId,
          noteUserId: target.userId,
          noteTs: target.ts,
        });
      }
      savePersonal(conn);
      break;
    }

    case "deleteEventNote": {
      const ev = findEv(m.eventId);
      if (!ev || !ev.notes) return;
      const note = m.noteId
        ? ev.notes.find(n => n.id === m.noteId && !n.activity)
        : ev.notes.find(n => !n.activity && n.userId === m.noteUserId && n.ts === m.noteTs);
      if (!note) return;
      if (note.userId !== conn.me.id && !canModerateEvents(conn)) return;
      handle(conn, {
        type: "eventNoteDeleted",
        eventId: ev.id,
        noteId: note.id || null,
        noteUserId: note.userId,
        noteTs: note.ts,
      });
      if (note.linkedEventId) {
        const linked = findEv(note.linkedEventId);
        if (linked?.notes) {
          const backId = note.id ? note.id + "-b" : null;
          const back = linked.notes.find(bn =>
            !bn.activity && bn.userId === note.userId && bn.ts === note.ts
            && bn.linkedEventId === ev.id
            && (!backId || !bn.id || bn.id === backId));
          if (back) {
            handle(conn, {
              type: "eventNoteDeleted",
              eventId: linked.id,
              noteId: back.id || null,
              noteUserId: back.userId,
              noteTs: back.ts,
            });
          }
        }
      }
      const ech = conn.channels.find(c => c.id === ev.channelId);
      const linkedChat = ech?.linkedChatChannelId
        && conn.channels.find(c => c.id === ech.linkedChatChannelId && c.kind === "chat");
      if (linkedChat) {
        const msgs = conn.messages[linkedChat.id] || [];
        for (const msg of msgs.filter(x =>
          x.eventId === ev.id && x.userId === note.userId && x.ts === note.ts)) {
          handle(conn, { type: "messageDeleted", channelId: linkedChat.id, messageId: msg.id });
        }
      }
      savePersonal(conn);
      break;
    }

    case "createEvent": {
      const ch = conn.channels.find(c => c.id === m.channelId && c.kind === "event");
      if (!ch || !m.title || !m.when) return;
      // Pinned location / people channels are read-only aggregation boards.
      if (ch.pinnedLocationLabel != null || ch.pinnedUserId != null) return;
      if (typeof PersonalSpace !== "undefined" && PersonalSpace.isHiddenChannel(ch, conn)) return;
      const chainOf = m.chainOf && conn.events.some(e => e.id === m.chainOf && e.channelId === ch.id) ? m.chainOf : null;
      const external = !!m.createdByExternal;
      const creatorName = (m.createdByName || conn.me.name || "").trim() || conn.me.name;
      const labelId = String(m.locationLabelId || "").trim() || null;
      const ev = {
        id: m.id || genLocalId(), title: m.title, when: m.when, shortName: m.shortName || "",
        icon: (m.icon || "").trim() || null,
        where: m.where || "", details: m.details || "",
        sticker: m.sticker || "",
        stickerBy: m.sticker ? (external ? null : conn.me.id) : null,
        stickerByName: m.sticker ? (external ? creatorName : conn.me.name) : null,
        subtitle: m.subtitle || "",
        createdBy: external ? (`pass:${String(m.id || "").slice(0, 8)}` || "pass:import") : conn.me.id,
        createdByName: creatorName,
        createdAt: Date.now(),
        rsvps: { [conn.me.id]: "going" },
        addedBy: external ? { [conn.me.id]: conn.me.id } : undefined,
        channelId: ch.id,
        whenPrecision: m.whenPrecision || null, whenPeriod: m.whenPeriod || null,
        chainOf,
        chainStatus: chainOf ? "proposal" : null,
        duration: m.duration || null,
        typeId: m.typeId || null,
        cat: m.cat || null,
        borrowSourceConnId: m.borrowSourceConnId || null,
        locationLabelId: labelId,
        passRevision: m.passRevision != null ? (m.passRevision | 0) : undefined,
        passCreatorName: m.passCreatorName || (external ? creatorName : undefined),
        passImportedAt: m.passImportedAt || (external ? Date.now() : undefined),
        routineId: m.routineId || null,
        routineStyle: m.routineStyle || null,
        eventCardStyle: m.eventCardStyle
          || (typeof eventCardPresetSnapshot === "function"
            ? eventCardPresetSnapshot(activeEventCardPreset())
            : null),
        confirmAttendance: !!m.confirmAttendance,
        signupGroups: Array.isArray(m.signupGroups) ? m.signupGroups : [],
      };
      handle(conn, { type: "eventCreated", event: ev });
      // Personal has no e2e key — set `_` caches before persist so restart keeps titles/stickers.
      hydratePlainEvent(ev);
      if (typeof isDrawnIcon === "function" && isDrawnIcon(ev.icon)
          && typeof upsertReactionCard === "function") {
        upsertReactionCard(conn, ev.icon, conn.me);
      }
      if (!external) window.Onboarding?.complete?.("plan");
      if (typeof clearOverlappingAvailabilities === "function") {
        clearOverlappingAvailabilities(conn, ev);
      }
      savePersonal(conn);
      break;
    }

    case "setEventCardStyle": {
      const ev = conn.events.find(e => e.id === m.eventId);
      if (!ev || ev.createdBy !== conn.me?.id || !m.eventCardStyle) return;
      ev.eventCardStyle = typeof eventCardPresetSnapshot === "function"
        ? eventCardPresetSnapshot(m.eventCardStyle)
        : m.eventCardStyle;
      savePersonal(conn);
      refresh();
      break;
    }

    case "rsvp": {
      const ev = findEv(m.eventId);
      const allowed = (typeof eventRsvpChoiceStatuses === "function" && ev)
        ? eventRsvpChoiceStatuses(ev)
        : ["going", "out"];
      if (!ev || !allowed.includes(m.status)) return;
      const previous = ev.rsvps[conn.me.id];
      if (ev.addedBy) delete ev.addedBy[conn.me.id];
      if (m.status === "out" && Array.isArray(ev.signupGroups)) {
        ev.signupGroups.forEach((g) => {
          g.memberIds = (g.memberIds || []).filter((id) => id !== conn.me.id);
        });
      }
      handle(conn, { type: "rsvpUpdated", eventId: ev.id, userId: conn.me.id, status: m.status });
      if (previous !== m.status) addActivity(ev, { activity: "rsvp", status: m.status });
      savePersonal(conn);
      break;
    }

    // Adding someone else isn't meaningful in a single-user local store — only
    // a self-add (via the same "add person" card path RSVP uses) is honored.
    case "addPerson": {
      const ev = findEv(m.eventId);
      if (!ev || m.userId !== conn.me.id) return;
      handle(conn, { type: "rsvpUpdated", eventId: ev.id, userId: conn.me.id, status: "going" });
      savePersonal(conn);
      break;
    }

    case "removePerson": {
      const ev = findEv(m.eventId);
      if (!ev || !m.userId) return;
      if (Array.isArray(ev.signupGroups)) {
        ev.signupGroups.forEach((g) => {
          g.memberIds = (g.memberIds || []).filter((id) => id !== m.userId);
        });
      }
      handle(conn, { type: "rsvpUpdated", eventId: ev.id, userId: m.userId, removed: true });
      savePersonal(conn);
      break;
    }

    case "setMemberRsvp": {
      const ev = findEv(m.eventId);
      if (!ev || !m.userId || !["going", "signedUp", "out"].includes(m.status)) return;
      if (m.userId === conn.me.id) return;
      const previous = ev.rsvps[m.userId];
      if (ev.addedBy) delete ev.addedBy[m.userId];
      if (m.status === "out" && Array.isArray(ev.signupGroups)) {
        ev.signupGroups.forEach((g) => {
          g.memberIds = (g.memberIds || []).filter((id) => id !== m.userId);
        });
      }
      handle(conn, { type: "rsvpUpdated", eventId: ev.id, userId: m.userId, status: m.status });
      if (previous !== m.status) addActivity(ev, { activity: "rsvp", status: m.status });
      savePersonal(conn);
      break;
    }

    case "setEventConfirmAttendance": {
      const ev = findEv(m.eventId);
      if (!ev) return;
      if (typeof applyConfirmAttendanceRsvps === "function") {
        applyConfirmAttendanceRsvps(ev, !!m.confirmAttendance);
      } else {
        ev.confirmAttendance = !!m.confirmAttendance;
      }
      handle(conn, {
        type: "eventConfirmAttendanceUpdated",
        eventId: ev.id,
        confirmAttendance: !!ev.confirmAttendance,
        rsvps: { ...(ev.rsvps || {}) },
      });
      savePersonal(conn);
      break;
    }

    case "setEventSignupGroups": {
      const ev = findEv(m.eventId);
      if (!ev) return;
      handle(conn, {
        type: "eventSignupGroupsUpdated",
        eventId: ev.id,
        signupGroups: Array.isArray(m.signupGroups) ? m.signupGroups : [],
      });
      savePersonal(conn);
      break;
    }

    case "assignEventGroup": {
      const ev = findEv(m.eventId);
      if (!ev || !m.userId) return;
      const groups = Array.isArray(ev.signupGroups) ? ev.signupGroups.map((g) => ({
        ...g,
        memberIds: [...(g.memberIds || [])].filter((id) => id !== m.userId),
      })) : [];
      const groupId = String(m.groupId || "").trim();
      if (groupId) {
        const group = groups.find((g) => g.id === groupId);
        if (group && !(group.memberIds || []).includes(m.userId)) {
          (group.memberIds ||= []).push(m.userId);
        }
      }
      handle(conn, { type: "eventSignupGroupsUpdated", eventId: ev.id, signupGroups: groups });
      savePersonal(conn);
      break;
    }

    case "setEventTimePrecision": {
      const ev = findEv(m.eventId);
      if (!ev) return;
      const oldWhen = ev.when;
      const oldWhenPrecision = ev.whenPrecision;
      const oldWhenPeriod = ev.whenPeriod;
      const precision = ["day", "period", "unconfirmed"].includes(m.whenPrecision) ? m.whenPrecision : null;
      const period = precision === "period" && ["morning", "afternoon", "evening"].includes(m.whenPeriod) ? m.whenPeriod : null;
      const newWhen = m.when || null;
      let finalWhen = ev.when, finalPrecision = ev.whenPrecision, finalPeriod = ev.whenPeriod;
      if (newWhen) finalWhen = newWhen;
      if (precision) { finalPrecision = precision; finalPeriod = period; }
      else if (newWhen) { finalPrecision = null; finalPeriod = null; }
      handle(conn, { type: "eventTimeUpdated", eventId: ev.id, when: finalWhen, whenPrecision: finalPrecision, whenPeriod: finalPeriod });
      if (oldWhen !== finalWhen || oldWhenPrecision !== finalPrecision || oldWhenPeriod !== finalPeriod) {
        addActivity(ev, {
          activity: "time",
          oldWhen, newWhen: finalWhen,
          oldWhenPrecision, newWhenPrecision: finalPrecision,
          oldWhenPeriod, newWhenPeriod: finalPeriod,
        });
        // 021 — one-hop dependency warn for linked follow-ons.
        if (!ev.chainOf && oldWhen !== finalWhen) {
          for (const child of conn.events) {
            if (child.chainOf !== ev.id) continue;
            if ((child.chainStatus || "proposal") !== "linked") continue;
            child.chainDepWarnWhen = finalWhen;
            handle(conn, {
              type: "eventChainUpdated",
              eventId: child.id,
              chainOf: child.chainOf,
              chainMode: child.chainMode || null,
              chainStatus: child.chainStatus || null,
              chainDepWarnWhen: child.chainDepWarnWhen,
            });
          }
        }
        if (ev.chainOf && ev.chainDepWarnWhen) {
          ev.chainDepWarnWhen = null;
          handle(conn, {
            type: "eventChainUpdated",
            eventId: ev.id,
            chainOf: ev.chainOf,
            chainMode: ev.chainMode || null,
            chainStatus: ev.chainStatus || null,
            chainDepWarnWhen: null,
          });
        }
      }
      if (typeof clearOverlappingAvailabilities === "function") {
        clearOverlappingAvailabilities(conn, ev);
      }
      savePersonal(conn);
      break;
    }

    case "setChainMode": {
      const ev = findEv(m.eventId);
      if (!ev || ev.chainOf) return;
      const mode = m.mode === "choice" ? "choice" : (m.mode === "sequence" ? "sequence" : null);
      if (!mode) return;
      ev.chainMode = mode;
      handle(conn, {
        type: "eventChainUpdated",
        eventId: ev.id,
        chainOf: null,
        chainMode: mode,
        chainStatus: null,
        chainDepWarnWhen: null,
      });
      savePersonal(conn);
      break;
    }

    case "promoteChainEvent": {
      const ev = findEv(m.eventId);
      if (!ev?.chainOf) return;
      ev.chainStatus = "linked";
      ev.chainDepWarnWhen = null;
      const primary = findEv(ev.chainOf);
      if (primary?.chainMode === "choice") {
        const losers = conn.events.filter(
          e => e.chainOf === ev.chainOf && e.id !== ev.id && (e.chainStatus || "proposal") === "proposal"
        );
        for (const loser of losers) {
          handle(conn, { type: "eventDeleted", eventId: loser.id });
        }
      }
      handle(conn, {
        type: "eventChainUpdated",
        eventId: ev.id,
        chainOf: ev.chainOf,
        chainMode: null,
        chainStatus: "linked",
        chainDepWarnWhen: null,
      });
      savePersonal(conn);
      break;
    }

    // Detach a chain link into a full agenda event.
    // e.g. Event → A-B-C, realize A ⇒ Event · EventA → B-C
    // Sequence: only *subsequent* siblings (after this link) reparent under it.
    // Choice: other siblings are removed.
    case "realizeChainEvent": {
      const ev = findEv(m.eventId);
      if (!ev?.chainOf) return;
      const primaryId = ev.chainOf;
      const primary = findEv(primaryId);
      if (!primary) return;
      const mode = primary.chainMode === "choice" ? "choice" : "sequence";
      const ordered = conn.events
        .filter(e => e.chainOf === primaryId)
        .sort((a, b) => (a.when || 0) - (b.when || 0) || String(a.id).localeCompare(String(b.id)));
      const idx = ordered.findIndex(e => e.id === ev.id);
      if (idx < 0) return;
      const prior = ordered.slice(0, idx);
      const subsequent = ordered.slice(idx + 1);
      const siblings = ordered.filter(e => e.id !== ev.id);

      // Start when the previous step ends (prior link, else primary).
      const anchor = prior.length ? prior[prior.length - 1] : primary;
      let nextWhen = null;
      try {
        if (typeof eventEndWhen === "function") nextWhen = eventEndWhen(anchor, conn);
      } catch {}
      if (nextWhen == null && anchor.when != null) {
        nextWhen = Number(anchor.when) + (2 * 3600e3);
      }
      if (nextWhen == null) nextWhen = Date.now();

      ev.when = nextWhen;
      ev.whenPrecision = null;
      ev.whenPeriod = null;
      ev.chainOf = null;
      ev.chainStatus = null;
      ev.chainDepWarnWhen = null;
      // Inherit sequence mode when follow-ons move under this new primary.
      const newMode = (mode === "sequence" && subsequent.length) ? "sequence" : null;
      ev.chainMode = newMode;

      handle(conn, {
        type: "eventTimeUpdated",
        eventId: ev.id,
        when: nextWhen,
        whenPrecision: null,
        whenPeriod: null,
      });
      handle(conn, {
        type: "eventChainUpdated",
        eventId: ev.id,
        chainOf: null,
        chainMode: newMode,
        chainStatus: null,
        chainDepWarnWhen: null,
      });

      // Anyone who 👍'd the chain link is auto-signed going on the real event.
      const thumbIds = Object.entries(ev.reactions || {})
        .filter(([, v]) => (typeof rxParts === "function" ? rxParts(v).emoji : v) === "👍")
        .map(([uid]) => uid);
      if (thumbIds.length) {
        for (const uid of thumbIds) {
          if (ev.addedBy) delete ev.addedBy[uid];
          handle(conn, { type: "rsvpUpdated", eventId: ev.id, userId: uid, status: "going" });
        }
      }

      if (mode === "choice") {
        for (const loser of siblings) {
          handle(conn, { type: "eventDeleted", eventId: loser.id });
        }
        if (primary.chainMode) {
          primary.chainMode = null;
          handle(conn, {
            type: "eventChainUpdated",
            eventId: primary.id,
            chainOf: null,
            chainMode: null,
            chainStatus: null,
            chainDepWarnWhen: null,
          });
        }
      } else {
        // Event → A-B-C, realize A ⇒ EventA → B-C (prior stays on primary).
        const gap = (typeof CHAIN_GAP_MS === "number" && CHAIN_GAP_MS > 0)
          ? CHAIN_GAP_MS
          : (2 * 3600e3);
        let cursor = nextWhen;
        for (const sib of subsequent) {
          cursor += gap;
          sib.chainOf = ev.id;
          sib.when = cursor;
          handle(conn, {
            type: "eventTimeUpdated",
            eventId: sib.id,
            when: cursor,
            whenPrecision: sib.whenPrecision || null,
            whenPeriod: sib.whenPeriod || null,
          });
          handle(conn, {
            type: "eventChainUpdated",
            eventId: sib.id,
            chainOf: ev.id,
            chainMode: null,
            chainStatus: sib.chainStatus || "proposal",
            chainDepWarnWhen: sib.chainDepWarnWhen || null,
          });
        }
        // Primary keeps earlier links; clear mode if the strip is now empty.
        if (!prior.length && primary.chainMode) {
          primary.chainMode = null;
          handle(conn, {
            type: "eventChainUpdated",
            eventId: primary.id,
            chainOf: null,
            chainMode: null,
            chainStatus: null,
            chainDepWarnWhen: null,
          });
        }
      }
      savePersonal(conn);
      break;
    }

    case "clearChainDepWarn": {
      const ev = findEv(m.eventId);
      if (!ev || !ev.chainDepWarnWhen) return;
      ev.chainDepWarnWhen = null;
      handle(conn, {
        type: "eventChainUpdated",
        eventId: ev.id,
        chainOf: ev.chainOf || null,
        chainMode: ev.chainMode || null,
        chainStatus: ev.chainStatus || null,
        chainDepWarnWhen: null,
      });
      savePersonal(conn);
      break;
    }

    case "setEventWhere": {
      const ev = findEv(m.eventId);
      if (!ev) return;
      const old = ev.where || "";
      const next = m.where || "";
      handle(conn, { type: "eventWhereUpdated", eventId: ev.id, where: next });
      ev._where = next;
      // Keep plaintext locationLabelId in sync so pinned boards stay accurate.
      const sent = String(m.locationLabelId || "").trim();
      ev.locationLabelId = sent
        || (typeof curatedLocationLabelId === "function"
          ? curatedLocationLabelId(next, conn)
          : "")
        || null;
      if (old !== next) addActivity(ev, { activity: "where" });
      savePersonal(conn);
      break;
    }

    case "setEventDetails": {
      const ev = findEv(m.eventId);
      if (!ev) return;
      const old = ev.details || "";
      const next = m.details || "";
      // eventDetailsUpdated decrypts into _details — don't overwrite with ciphertext.
      handle(conn, { type: "eventDetailsUpdated", eventId: ev.id, details: next });
      if (old !== next) addActivity(ev, { activity: "details" });
      savePersonal(conn);
      break;
    }

    case "setEventSticker": {
      const ev = findEv(m.eventId);
      if (!ev) return;
      const old = ev.sticker || "";
      const next = m.sticker || "";
      const by = next ? conn.me.id : null;
      const byName = next ? conn.me.name : null;
      handle(conn, {
        type: "eventStickerUpdated",
        eventId: ev.id,
        sticker: next,
        stickerBy: by,
        stickerByName: byName,
      });
      ev._sticker = next;
      if (old !== next) addActivity(ev, { activity: "sticker" });
      savePersonal(conn);
      break;
    }

    case "setEventSubtitle": {
      const ev = findEv(m.eventId);
      if (!ev) return;
      const old = ev.subtitle || "";
      const next = m.subtitle || "";
      handle(conn, { type: "eventSubtitleUpdated", eventId: ev.id, subtitle: next });
      ev._subtitle = next;
      if (old !== next) addActivity(ev, { activity: "subtitle" });
      savePersonal(conn);
      break;
    }

    case "setEventDuration": {
      const ev = findEv(m.eventId);
      if (!ev) return;
      const old = ev.duration || null;
      const next = m.duration || null;
      handle(conn, { type: "eventDurationUpdated", eventId: ev.id, duration: next });
      if (old !== next) addActivity(ev, { activity: "duration", oldValue: old, newValue: next });
      if (typeof clearOverlappingAvailabilities === "function") {
        clearOverlappingAvailabilities(conn, ev);
      }
      savePersonal(conn);
      break;
    }

    case "setEventIcon": {
      const ev = findEv(m.eventId);
      if (!ev) return;
      const old = ev.icon || "";
      const next = m.icon || "";
      if (typeof isDrawnIcon === "function" && isDrawnIcon(next)
          && typeof upsertReactionCard === "function") {
        upsertReactionCard(conn, next, conn.me);
      }
      handle(conn, { type: "eventIconUpdated", eventId: ev.id, icon: next });
      if (old !== next) addActivity(ev, { activity: "icon", oldValue: old || null, newValue: next || null });
      savePersonal(conn);
      break;
    }

    case "setEventType": {
      const ev = findEv(m.eventId);
      if (!ev) return;
      const oldTitle = ev.title || "";
      const nextTitle = m.title || "";
      const nextTypeId = (m.typeId || "").trim() || null;
      const nextIcon = (m.icon || "").trim() || null;
      const nextCat = m.cat != null ? ((m.cat || "").trim() || null) : ev.cat;
      if (typeof isDrawnIcon === "function" && isDrawnIcon(nextIcon)
          && typeof upsertReactionCard === "function") {
        upsertReactionCard(conn, nextIcon, conn.me);
      }
      handle(conn, {
        type: "eventTypeUpdated",
        ...("shortName" in m ? { shortName: m.shortName || "" } : {}),
        eventId: ev.id,
        title: nextTitle,
        typeId: nextTypeId,
        icon: nextIcon,
        cat: nextCat,
      });
      ev._title = nextTitle;
      if ("shortName" in m) ev._shortName = m.shortName || "";
      if (oldTitle !== nextTitle) addActivity(ev, { activity: "type" });
      savePersonal(conn);
      break;
    }

    case "setEventCategory": {
      if (!canManageServer(conn)) return;
      const label = (m.label || "").trim().slice(0, 40);
      const categoryId = (m.categoryId || "").trim().slice(0, 24);
      if (!label || !categoryId) return;
      if (!conn.cardCats) conn.cardCats = {};
      conn.cardCats[label] = categoryId;
      const personal = loadJSON("ash_personal_card_cats_v1", null) || {};
      personal[label] = categoryId;
      localStorage.setItem("ash_personal_card_cats_v1", JSON.stringify(personal));
      handle(conn, { type: "cardCatsUpdated", cardCats: { ...conn.cardCats } });
      savePersonal(conn);
      break;
    }

    case "react": {
      const ev = findEv(m.eventId);
      if (!ev) return;
      const stacks = { ...(ev.reactionStacks || {}) };
      const ensureList = (uid) => {
        if (!Array.isArray(stacks[uid])) stacks[uid] = [];
        return stacks[uid];
      };
      if (m.clearEmoji) {
        for (const [uid, list] of Object.entries(stacks)) {
          const next = (list || []).filter(em => em !== m.clearEmoji);
          if (next.length) stacks[uid] = next;
          else delete stacks[uid];
        }
      } else if (m.removeAll || m.remove) {
        delete stacks[m.userId || conn.me.id];
      } else if (!m.emoji) {
        return;
      } else if (m.append || m.add) {
        const list = ensureList(conn.me.id);
        if (list.length < 24) list.push(m.emoji);
        if (typeof isDrawnIcon === "function" && isDrawnIcon(m.emoji)) {
          if (typeof upsertReactionCard === "function") upsertReactionCard(conn, m.emoji, conn.me);
          else {
            const cards = conn.reactionCards ||= [];
            if (!cards.includes(m.emoji)) cards.push(m.emoji);
          }
        }
      } else {
        const list = ensureList(conn.me.id);
        if (m.count == null) {
          if (list.length === 1 && list[0] === m.emoji) delete stacks[conn.me.id];
          else stacks[conn.me.id] = [m.emoji];
        } else {
          stacks[conn.me.id] = Array(Math.min(24, Math.max(1, m.count || 1))).fill(m.emoji);
        }
        if (typeof isDrawnIcon === "function" && isDrawnIcon(m.emoji)) {
          if (typeof upsertReactionCard === "function") upsertReactionCard(conn, m.emoji, conn.me);
          else {
            const cards = conn.reactionCards ||= [];
            if (!cards.includes(m.emoji)) cards.push(m.emoji);
          }
        }
      }
      const reactions = {};
      for (const [uid, list] of Object.entries(stacks)) {
        if (!list?.length) continue;
        const last = list[list.length - 1];
        reactions[uid] = list.length > 1 ? `${last}|${list.length}` : last;
      }
      handle(conn, {
        type: "reactionUpdated",
        eventId: ev.id,
        reactions,
        reactionStacks: stacks,
        reactionCards: conn.reactionCards || [],
      });
      savePersonal(conn);
      break;
    }

    case "eventNote": {
      const ev = findEv(m.eventId);
      if (!ev || !m.text) return;
      // Personal (device-sealed) notes are removed from the product.
      if (m.noteKind === "personal") return;
      const kind = m.noteKind === "shared" ? m.noteKind : null;
      const linked = m.linkedEventId && m.linkedEventId !== ev.id
        ? findEv(m.linkedEventId) : null;
      const note = {
        id: m.noteId || genLocalId(),
        userId: conn.me.id, name: conn.me.name, text: m.text, ts: Date.now(),
        mentionedUserIds: m.mentionedUserIds || null,
        linkedEventId: linked?.id || null,
        linkedEventTitle: linked?.title || null,
        noteKind: kind,
        pinned: !!(m.pinned || kind === "shared"),
      };
      if (note.pinned && ev.notes) {
        for (const x of ev.notes) {
          if (x.activity || x.noteKind === "personal") continue;
          if (!(x.pinned || x.noteKind === "shared")) continue;
          if (note.id && x.id === note.id) continue;
          x.noteKind = null;
          x.pinned = false;
        }
      }
      handle(conn, { type: "eventNoteAdded", eventId: ev.id, note });
      if (ev.notes && ev.notes.length > 50) ev.notes.shift();
      // Cross-link reciprocal note on the linked event.
      if (linked) {
        const back = {
          id: note.id ? note.id + "-b" : genLocalId(),
          userId: conn.me.id, name: conn.me.name, text: m.text, ts: note.ts,
          linkedEventId: ev.id, linkedEventTitle: ev.title,
        };
        handle(conn, { type: "eventNoteAdded", eventId: linked.id, note: back });
        if (linked.notes && linked.notes.length > 50) linked.notes.shift();
      }
      // Mirror into the linked chat channel (same as the hosted server).
      const ech = conn.channels.find(c => c.id === ev.channelId);
      const linkedChat = ech?.linkedChatChannelId
        && conn.channels.find(c => c.id === ech.linkedChatChannelId && c.kind === "chat");
      if (linkedChat) {
        const mirrored = {
          id: genLocalId(), channelId: linkedChat.id, userId: conn.me.id, name: conn.me.name,
          text: m.text, ts: note.ts, eventId: ev.id, eventTitle: ev.title,
          mentionedUserIds: m.mentionedUserIds || null,
        };
        handle(conn, { type: "message", message: mirrored });
      }
      savePersonal(conn);
      break;
    }

    case "pinEventNote": {
      const ev = findEv(m.eventId);
      if (!ev?.notes) return;
      const noteId = m.noteId || null;
      const noteTs = m.noteTs || null;
      const noteUserId = m.noteUserId || null;
      const n = ev.notes.find(x => {
        if (x.activity || x.noteKind === "personal") return false;
        if (noteId && x.id) return x.id === noteId;
        return noteUserId && noteTs && x.userId === noteUserId && x.ts === noteTs;
      });
      if (!n) return;
      for (const x of ev.notes) {
        if (x.activity || x.noteKind === "personal") continue;
        if (!(x.pinned || x.noteKind === "shared")) continue;
        if (n.id && x.id === n.id) continue;
        x.noteKind = null;
        x.pinned = false;
      }
      n.noteKind = "shared";
      n.pinned = true;
      handle(conn, { type: "eventNoteUpdated", eventId: ev.id, note: { ...n } });
      savePersonal(conn);
      break;
    }

    case "publishPersonalNote": {
      // Personal notes UI removed — ignore publish attempts.
      break;
    }

    case "deleteEvent": {
      const ev = findEv(m.eventId);
      if (!ev) return;
      const chainIds = conn.events.filter(e => e.chainOf === ev.id).map(e => e.id);
      for (const id of [...chainIds, ev.id]) handle(conn, { type: "eventDeleted", eventId: id });
      savePersonal(conn);
      break;
    }

    case "approveEvent": {
      const ev = findEv(m.eventId);
      if (!ev || ev.approvalStatus !== "pending") return;
      handle(conn, { type: "eventApprovalUpdated", eventId: ev.id, approvalStatus: null });
      savePersonal(conn);
      break;
    }

    case "blockEvent": {
      const ev = findEv(m.eventId);
      if (!ev || ev.approvalStatus !== "pending") return;
      const note = String(m.note || "").trim().slice(0, 1000);
      const altSuggestion = String(m.altSuggestion || "").trim().slice(0, 1000);
      handle(conn, {
        type: "eventApprovalUpdated",
        eventId: ev.id,
        approvalStatus: "blocked",
        approvalNote: note || null,
        approvalAltSuggestion: altSuggestion || null,
      });
      savePersonal(conn);
      break;
    }

    case "deleteEventsBulk": {
      const ch = conn.channels.find(c => c.id === m.channelId);
      if (!ch) return;
      const ids = new Set(m.eventIds || []);
      if (!ids.size) return;
      conn.events = conn.events.filter(e => !(ids.has(e.id) && e.channelId === ch.id));
      if (S.activeView?.kind === "eventDetail" && ids.has(S.activeView.id)) Nav.set({ kind: "events" });
      savePersonal(conn);
      handle(conn, { type: "eventsDeleted", channelId: ch.id, eventIds: [...ids] });
      break;
    }

    case "createAvailability": {
      const ch = conn.channels.find(c => c.id === m.channelId && c.kind === "event");
      if (!ch || !ch.allowAvailability) return;
      if (ch.pinnedLocationLabel != null || ch.pinnedUserId != null) return;
      const whenMs = Number(m.when) || 0;
      const duration = Math.min(Number(m.duration) || 0, 24 * 60 * 60 * 1000);
      if (whenMs <= 0 || duration <= 0) return;
      if (!conn.availabilities) conn.availabilities = [];
      const id = m.id || genLocalId();
      if (conn.availabilities.some(a => a.id === id)) return;
      // Don't create if an event already fills this window.
      const probe = { when: whenMs, duration, channelId: ch.id };
      if ((conn.events || []).some(ev =>
        ev.channelId === ch.id && availabilityOverlapsEvent(probe, ev))) return;
      const avail = {
        id, channelId: ch.id,
        userId: conn.me.id, userName: conn.me.name,
        when: whenMs, duration,
        where: m.where || "", details: m.details || "",
        signals: [], createdAt: Date.now(),
      };
      if (typeof hydratePlainAvailability === "function") hydratePlainAvailability(avail);
      handle(conn, { type: "availabilityCreated", availability: avail });
      savePersonal(conn);
      refresh();
      break;
    }

    case "updateAvailability": {
      const avail = (conn.availabilities || []).find(a => a.id === m.availabilityId);
      if (!avail || avail.userId !== conn.me.id) return;
      if (m.when != null) {
        const whenMs = Number(m.when) || 0;
        if (whenMs <= 0) return;
        avail.when = whenMs;
      }
      if (m.duration != null) {
        const duration = Math.min(Number(m.duration) || 0, 24 * 60 * 60 * 1000);
        if (duration <= 0) return;
        avail.duration = duration;
      }
      if ("where" in m) {
        avail.where = m.where || "";
        avail._where = m.where || "";
      }
      if ("details" in m) {
        avail.details = m.details || "";
        avail._details = m.details || "";
      }
      if ((conn.events || []).some(ev =>
        ev.channelId === avail.channelId && availabilityOverlapsEvent(avail, ev))) {
        conn.availabilities = conn.availabilities.filter(a => a.id !== avail.id);
        handle(conn, { type: "availabilityDeleted", availabilityId: avail.id, channelId: avail.channelId });
      } else {
        avail.signals = (avail.signals || []).filter(s => {
          if (s.startWhen == null) return true;
          return s.startWhen >= avail.when && s.startWhen < avail.when + avail.duration;
        });
        handle(conn, { type: "availabilityUpdated", availability: avail });
      }
      savePersonal(conn);
      refresh();
      break;
    }

    case "deleteAvailability": {
      const avail = (conn.availabilities || []).find(a => a.id === m.availabilityId);
      if (!avail || avail.userId !== conn.me.id) return;
      conn.availabilities = conn.availabilities.filter(a => a.id !== avail.id);
      handle(conn, { type: "availabilityDeleted", availabilityId: avail.id, channelId: avail.channelId });
      savePersonal(conn);
      refresh();
      break;
    }

    case "signalAvailability": {
      const avail = (conn.availabilities || []).find(a => a.id === m.availabilityId);
      if (!avail || avail.userId === conn.me.id) return;
      if (!avail.signals) avail.signals = [];
      if (m.remove) {
        avail.signals = avail.signals.filter(s => s.userId !== conn.me.id);
      } else {
        let startWhen = null;
        if (m.startWhen != null && m.startWhen !== "") {
          const sw = Number(m.startWhen) || 0;
          if (sw > 0) {
            if (sw < avail.when || sw >= avail.when + avail.duration) return;
            startWhen = sw;
          }
        }
        avail.signals = avail.signals.filter(s => s.userId !== conn.me.id);
        avail.signals.push({
          userId: conn.me.id, name: conn.me.name,
          startWhen, ts: Date.now(),
        });
      }
      handle(conn, {
        type: "availabilitySignal",
        availabilityId: avail.id,
        channelId: avail.channelId,
        signals: avail.signals,
      });
      savePersonal(conn);
      refresh();
      break;
    }

    case "createTimeBlock": {
      const ch = conn.channels.find(c => c.id === m.channelId && c.kind === "event");
      if (!ch || ch.pinnedLocationLabel != null || ch.pinnedUserId != null) return;
      const title = String(m.title || "").trim();
      if (!title) return;
      let startDay = dayStart(Number(m.startDay) || 0);
      let endDay = dayStart(Number(m.endDay) || startDay);
      if (!startDay) return;
      if (!endDay || endDay < startDay) endDay = startDay;
      const startPeriod = typeof normalizeTimeBlockPeriod === "function"
        ? normalizeTimeBlockPeriod(m.startPeriod) : (m.startPeriod || null);
      const endPeriod = endDay > startDay
        ? (typeof normalizeTimeBlockPeriod === "function"
          ? normalizeTimeBlockPeriod(m.endPeriod) : (m.endPeriod || null))
        : null;
      const startMinutes = typeof normalizeTimeBlockMinutes === "function"
        ? (normalizeTimeBlockMinutes(m.startMinutes)
          ?? (typeof periodToStartMinutes === "function" ? periodToStartMinutes(startPeriod) : 0))
        : (Number.isFinite(Number(m.startMinutes)) ? Number(m.startMinutes) : 0);
      const endMinutes = typeof normalizeTimeBlockMinutes === "function"
        ? (normalizeTimeBlockMinutes(m.endMinutes)
          ?? (typeof periodToEndMinutes === "function"
            ? periodToEndMinutes(endDay > startDay ? endPeriod : startPeriod)
            : 23 * 60 + 59))
        : (Number.isFinite(Number(m.endMinutes)) ? Number(m.endMinutes) : 23 * 60 + 59);
      if (endDay === startDay && endMinutes <= startMinutes) return;
      if (!conn.timeBlocks) conn.timeBlocks = [];
      const id = m.id || genLocalId();
      if (conn.timeBlocks.some(b => b.id === id)) return;
      const block = {
        id, channelId: ch.id,
        createdBy: conn.me.id, createdByName: conn.me.name,
        title, where: m.where || "", details: m.details || "",
        startDay, endDay, startPeriod, endPeriod, startMinutes, endMinutes,
        signups: [{ userId: conn.me.id, name: conn.me.name, ts: Date.now() }],
        createdAt: Date.now(),
      };
      if (typeof hydratePlainTimeBlock === "function") hydratePlainTimeBlock(block);
      handle(conn, { type: "timeBlockCreated", timeBlock: block });
      savePersonal(conn);
      refresh();
      break;
    }

    case "updateTimeBlock": {
      const block = (conn.timeBlocks || []).find(b => b.id === m.timeBlockId);
      if (!block || block.createdBy !== conn.me.id) return;
      if (m.title != null) {
        const title = String(m.title || "").trim();
        if (!title) return;
        block.title = title;
        block._title = title;
      }
      if ("where" in m) {
        block.where = m.where || "";
        block._where = m.where || "";
      }
      if ("details" in m) {
        block.details = m.details || "";
        block._details = m.details || "";
      }
      if (m.startDay != null || m.endDay != null || "startPeriod" in m || "endPeriod" in m
          || "startMinutes" in m || "endMinutes" in m) {
        let startDay = dayStart(Number(m.startDay != null ? m.startDay : block.startDay) || 0);
        let endDay = dayStart(Number(m.endDay != null ? m.endDay : block.endDay) || startDay);
        if (!startDay) return;
        if (!endDay || endDay < startDay) endDay = startDay;
        let nextStartPeriod = block.startPeriod;
        if ("startPeriod" in m) {
          nextStartPeriod = typeof normalizeTimeBlockPeriod === "function"
            ? normalizeTimeBlockPeriod(m.startPeriod) : (m.startPeriod || null);
        }
        const nextEndPeriod = endDay > startDay
          ? (("endPeriod" in m)
            ? (typeof normalizeTimeBlockPeriod === "function"
              ? normalizeTimeBlockPeriod(m.endPeriod) : (m.endPeriod || null))
            : block.endPeriod)
          : null;
        let nextStartMinutes = block.startMinutes;
        if ("startMinutes" in m) {
          nextStartMinutes = typeof normalizeTimeBlockMinutes === "function"
            ? (normalizeTimeBlockMinutes(m.startMinutes) ?? 0) : Number(m.startMinutes) || 0;
        } else if (nextStartMinutes == null) {
          nextStartMinutes = typeof periodToStartMinutes === "function"
            ? periodToStartMinutes(nextStartPeriod) : 0;
        }
        let nextEndMinutes = block.endMinutes;
        if ("endMinutes" in m) {
          nextEndMinutes = typeof normalizeTimeBlockMinutes === "function"
            ? (normalizeTimeBlockMinutes(m.endMinutes) ?? (23 * 60 + 59))
            : Number(m.endMinutes);
        } else if (nextEndMinutes == null) {
          nextEndMinutes = typeof periodToEndMinutes === "function"
            ? periodToEndMinutes(endDay > startDay ? nextEndPeriod : nextStartPeriod)
            : 23 * 60 + 59;
        }
        if (endDay === startDay && nextEndMinutes <= nextStartMinutes) return;
        block.startDay = startDay;
        block.endDay = endDay;
        block.startPeriod = nextStartPeriod;
        block.endPeriod = nextEndPeriod;
        block.startMinutes = nextStartMinutes;
        block.endMinutes = nextEndMinutes;
      }
      handle(conn, { type: "timeBlockUpdated", timeBlock: block });
      savePersonal(conn);
      refresh();
      break;
    }

    case "deleteTimeBlock": {
      const block = (conn.timeBlocks || []).find(b => b.id === m.timeBlockId);
      if (!block || block.createdBy !== conn.me.id) return;
      conn.timeBlocks = conn.timeBlocks.filter(b => b.id !== block.id);
      handle(conn, { type: "timeBlockDeleted", timeBlockId: block.id, channelId: block.channelId });
      savePersonal(conn);
      refresh();
      break;
    }

    case "signupTimeBlock": {
      const block = (conn.timeBlocks || []).find(b => b.id === m.timeBlockId);
      if (!block) return;
      if (!Array.isArray(block.signups)) block.signups = [];
      if (m.remove) {
        block.signups = block.signups.filter(s => s.userId !== conn.me.id);
      } else {
        block.signups = block.signups.filter(s => s.userId !== conn.me.id);
        block.signups.push({
          userId: conn.me.id, name: conn.me.name, ts: Date.now(),
        });
      }
      handle(conn, {
        type: "timeBlockSignup",
        timeBlockId: block.id,
        channelId: block.channelId,
        signups: block.signups,
      });
      savePersonal(conn);
      refresh();
      break;
    }

    case "markNotificationsRead": {
      const ids = m.ids ? new Set(m.ids) : null;
      let changed = false;
      for (const n of conn.notifications) if ((!ids || ids.has(n.id)) && !n.read) { n.read = true; changed = true; }
      if (changed) savePersonal(conn);
      break;
    }

    default:
      break;
  }
}

/* ------------------------------- collation -------------------------------- */
/* The personal timeline folds in every remote event from joined servers
   (plus local personal events), from whichever conns are currently loaded —
   live if connected this session, else the last cached snapshot, so collation
   still renders offline. Unanswered and declined stay visible with faded
   ticket styles; Upcoming still prefers going/maybe. */

// A conn's own events if it's ever received a welcome this session (even if now
// offline — the in-memory copy is still the freshest we have), else the last
// cached snapshot from a previous session.
function sourceEventsFor(conn) {
  if (conn.me) return conn.events || [];
  return loadCache(conn.id)?.events || [];
}
function sourceMeFor(conn) {
  if (conn.me) return conn.me;
  return loadCache(conn.id)?.me || null;
}

// The personal timeline: this device's own events, plus remote events only from
// channels you’ve linked under Channel settings → Linked event channels.
// (No automatic pull from every joined server.)
function collatedEvents() {
  const personal = S.conns.personal;
  if (!personal?.me?.id) return [];
  const seen = new Set();
  const out = [];
  const add = (ev) => {
    if (!ev?.id || seen.has(ev.id)) return;
    seen.add(ev.id);
    out.push(ev);
  };
  for (const e of personal.events || []) {
    add({ ...e, _connId: "personal", _myId: personal.me.id, originKind: e.calendarImported ? "device" : (e.originKind || "personal") });
  }
  for (const ch of (personal.channels || []).filter(c => c.kind === "event")) {
    if (typeof PersonalSpace !== "undefined" && PersonalSpace.isHiddenChannel(ch, personal)) continue;
    for (const ev of collectChannelViewEvents(ch, personal)) add(ev);
  }
  return out;
}
