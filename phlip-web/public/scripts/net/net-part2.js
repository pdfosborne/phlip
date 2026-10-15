/* net-part2.js — split from net.js (Part 3 size ceiling).
 * Load after: net-part1.js; part of net cluster.
 */

let _shellPaintFrame = 0;
let _shellPaintView = false;
let _shellPaintSide = false;
function scheduleShellPaint(view, side) {
  if (view) _shellPaintView = true;
  if (side) _shellPaintSide = true;
  if (_shellPaintFrame) return;
  const raf = typeof requestAnimationFrame === "function"
    ? requestAnimationFrame
    : (fn) => setTimeout(fn, 16);
  _shellPaintFrame = raf(() => {
    _shellPaintFrame = 0;
    const doView = _shellPaintView;
    const doSide = _shellPaintSide;
    _shellPaintView = false;
    _shellPaintSide = false;
    if (doSide && typeof renderSidebar === "function") renderSidebar();
    if (doView && typeof renderView === "function") renderView();
  });
}

function optimisticApply(conn, m) {
  if (!conn?.me || !m) return;
  const findEv = (id) => conn.events.find(e => e.id === id);
  const paint = (eventId) => {
    refreshPendingFlags(conn);
    cacheConn(conn);
    const view = affectsActiveView(conn, eventId) && shouldRefreshEventUI(eventId);
    const side = conn.id === S.activeConnId || S.activeConnId === "personal";
    if (view || side) scheduleShellPaint(view, side);
  };
  const paintTasks = (channelId) => {
    cacheConn(conn);
    if (conn.id === S.activeConnId
        && S.activeView?.kind === "channel" && S.activeView.id === channelId
        && typeof renderTasks === "function") {
      renderTasks(document.querySelector("#view"), conn.channels.find(ch => ch.id === channelId));
    }
    if (conn.id === S.activeConnId || S.activeConnId === "personal") scheduleShellPaint(false, true);
  };

  switch (m.type) {
    case "createPoll":
    case "updatePoll":
    case "votePoll":
    case "closePoll":
      if (typeof applyPollCommand === "function") applyPollCommand(conn, m);
      break;
    case "createTask": {
      const channel = (conn.channels || []).find(ch => ch.id === m.channelId && ch.kind === "task");
      if (!channel || !m.id || !String(m.text || "").trim()) return;
      const list = conn.tasks || (conn.tasks = []);
      if (!list.some(task => task.id === m.id)) {
        const now = Date.now();
        const created = {
          id: m.id, channelId: channel.id,
          text: String(m.text).trim().slice(0, 500), completed: false,
          createdBy: conn.me.id, createdByName: conn.me.name,
          createdAt: now, updatedAt: now, revision: 0,
          _taskOptimistic: true,
        };
        if ("eventId" in m) {
          const eid = String(m.eventId || "").trim();
          if (eid) created.eventId = eid;
        }
        list.push(created);
      }
      paintTasks(channel.id);
      break;
    }
    case "updateTask": {
      const task = (conn.tasks || []).find(item => item.id === (m.taskId || m.id));
      const text = String(m.text || "").trim().slice(0, 500);
      if (!task || !text) return;
      task.text = text;
      task.updatedAt = Date.now();
      task._taskOptimistic = true;
      if ("eventId" in m) {
        const eid = String(m.eventId || "").trim();
        if (eid) task.eventId = eid;
        else delete task.eventId;
      }
      paintTasks(task.channelId);
      break;
    }
    case "setTaskCompleted": {
      const task = (conn.tasks || []).find(item => item.id === (m.taskId || m.id));
      if (!task) return;
      task.completed = !!m.completed;
      task.completedAt = task.completed ? Date.now() : null;
      task.updatedAt = Date.now();
      task._taskOptimistic = true;
      paintTasks(task.channelId);
      break;
    }
    case "deleteTask": {
      const id = m.taskId || m.id;
      const task = (conn.tasks || []).find(item => item.id === id);
      if (!task) return;
      conn.tasks = conn.tasks.filter(item => item.id !== id);
      paintTasks(task.channelId);
      break;
    }
    case "sendMessage": {
      if (!m.channelId || !m.text || !m.id) return;
      const list = (conn.messages ||= {})[m.channelId] ||= [];
      if (list.some(msg => msg.id === m.id)) return;
      const message = {
        id: m.id, channelId: m.channelId, userId: conn.me.id,
        name: conn.me.name, text: m.text, ts: Date.now(),
        eventId: m.eventId || null,
        mentionedEventIds: m.mentionedEventIds || null,
        mentionedUserIds: m.mentionedUserIds || null,
        replyToId: m.replyToId || null,
        conversationId: m.conversationId || null,
        taskId: m.taskId || null,
        syncStatus: "pending",
      };
      if (m.conversationId && typeof boardRememberChain === "function") {
        boardRememberChain(m.channelId, message.id, m.conversationId);
      }
      list.push(message);
      if (conn.key) decrypt(message.text, conn.key).then(t => {
        message._text = t;
        if (conn.id === S.activeConnId) renderView(true);
      });
      cacheConn(conn);
      if (conn.id === S.activeConnId) renderView(true);
      break;
    }
    case "createEvent": {
      const ch = conn.channels.find(c => c.id === m.channelId && c.kind === "event");
      if (!ch || !m.title || !m.when) return;
      const id = m.id || genLocalId();
      m.id = id;
      if (findEv(id)) { paint(id); return; }
      const chainOf = m.chainOf && conn.events.some(e => e.id === m.chainOf && e.channelId === ch.id)
        ? m.chainOf : null;
      const ev = {
        id, title: m.title, when: m.when, shortName: m.shortName || "",
        icon: (m.icon || "").trim() || null,
        where: m.where || "", details: m.details || "",
        sticker: m.sticker || "",
        stickerBy: m.sticker ? conn.me.id : null,
        stickerByName: m.sticker ? conn.me.name : null,
        subtitle: m.subtitle || "",
        createdBy: conn.me.id, createdByName: conn.me.name, createdAt: Date.now(),
        rsvps: { [conn.me.id]: "going" },
        channelId: ch.id,
        whenPrecision: m.whenPrecision || null, whenPeriod: m.whenPeriod || null,
        chainOf,
        chainStatus: chainOf ? "proposal" : null,
        duration: m.duration || null,
        typeId: m.typeId || null,
        cat: m.cat || null,
        locationLabelId: m.locationLabelId || null,
        routineId: m.routineId || null,
        routineStyle: m.routineStyle || null,
        eventCardStyle: m.eventCardStyle
          || (typeof eventCardPresetSnapshot === "function"
            ? eventCardPresetSnapshot(conn.me?.eventCardStyle || activeEventCardPreset())
            : null),
        confirmAttendance: !!m.confirmAttendance,
        signupGroups: Array.isArray(m.signupGroups) ? m.signupGroups : [],
        _pending: true,
      };
      if (conn.key) {
        Promise.all([
          decrypt(ev.title, conn.key).then(t => { ev._title = t; }),
          (ev.shortName ? decrypt(ev.shortName, conn.key) : Promise.resolve("")).then(t => { ev._shortName = t; }),
          ev.where ? decrypt(ev.where, conn.key).then(t => { ev._where = t; }) : null,
          ev.details ? decrypt(ev.details, conn.key).then(t => { ev._details = t; }) : null,
          ev.sticker ? decrypt(ev.sticker, conn.key).then(t => { ev._sticker = t; }) : null,
          ev.subtitle ? decrypt(ev.subtitle, conn.key).then(t => { ev._subtitle = t; }) : null,
        ].filter(Boolean)).then(() => paint(id));
      }
      conn.events.push(ev);
      if (ev.createdBy === conn.me.id && !ev.chainOf && S.pendingFocusNewEvent
          && (conn.id === S.activeConnId || S.activeConnId === "personal")) {
        S.anchor = dayStart(ev.when);
        S.viewingHistory = false;
        if (S.activeView?.kind === "eventDetail") {
          Nav.landDefault();
        }
      }
      paint(id);
      if (typeof boardOnEventCreated === "function") boardOnEventCreated(conn, ev);
      if (ev.createdBy === conn.me.id && !ev.chainOf) {
        try { CardFeel.eventCreatedOnce(ev); } catch {}
      }
      if (typeof isDrawnIcon === "function" && isDrawnIcon(ev.icon)
          && typeof upsertReactionCard === "function") {
        upsertReactionCard(conn, ev.icon, conn.me);
      }
      break;
    }
    case "setEventCardStyle": {
      const ev = conn.events.find(e => e.id === m.eventId);
      if (ev && m.eventCardStyle) ev.eventCardStyle = m.eventCardStyle;
      if (ev) paint(ev.id);
      break;
    }
    case "setUserEventCardStyle": {
      if (conn.me && m.eventCardStyle) conn.me.eventCardStyle = m.eventCardStyle;
      break;
    }
    case "rsvp": {
      const ev = findEv(m.eventId);
      const allowed = (typeof eventRsvpChoiceStatuses === "function" && ev)
        ? eventRsvpChoiceStatuses(ev)
        : ["going", "out"];
      if (!ev || !allowed.includes(m.status)) return;
      ev.rsvps[conn.me.id] = m.status;
      if (ev.addedBy) delete ev.addedBy[conn.me.id];
      if (m.status === "out" && Array.isArray(ev.signupGroups)) {
        ev.signupGroups.forEach((g) => {
          g.memberIds = (g.memberIds || []).filter((id) => id !== conn.me.id);
        });
      }
      ev._pending = true;
      // Flip stub classes before paint so the CSS spring can run (026).
      try {
        const row = document.querySelector(`#ticket-list .ticket[data-id="${CSS.escape(ev.id)}"]`);
        if (row && typeof applyTicketResponseClass === "function") {
          applyTicketResponseClass(row, m.status);
        }
      } catch {}
      paint(ev.id);
      break;
    }
    case "addPerson": {
      const ev = findEv(m.eventId);
      if (!ev || !m.userId) return;
      ev.rsvps[m.userId] = "going";
      (ev.addedBy ||= {})[m.userId] = conn.me.id;
      ev._pending = true;
      paint(ev.id);
      break;
    }
    case "removePerson": {
      const ev = findEv(m.eventId);
      if (!ev || !m.userId) return;
      if (typeof isBridgeGuestId === "function" && isBridgeGuestId(m.userId)) {
        const label = bridgeGuestLabel(m.userId);
        if (ev.bridgeGuests && label) {
          const key = Object.keys(ev.bridgeGuests).find(k => k.toLowerCase() === label.toLowerCase()) || label;
          delete ev.bridgeGuests[key];
        }
      } else {
        delete ev.rsvps[m.userId];
        if (ev.addedBy) delete ev.addedBy[m.userId];
        if (Array.isArray(ev.signupGroups)) {
          ev.signupGroups.forEach((g) => {
            g.memberIds = (g.memberIds || []).filter((id) => id !== m.userId);
          });
        }
      }
      ev._pending = true;
      paint(ev.id);
      break;
    }
    case "setMemberRsvp": {
      const ev = findEv(m.eventId);
      if (!ev || !m.userId || !["going", "signedUp", "out"].includes(m.status)) return;
      ev.rsvps[m.userId] = m.status;
      if (ev.addedBy) delete ev.addedBy[m.userId];
      if (m.status === "out" && Array.isArray(ev.signupGroups)) {
        ev.signupGroups.forEach((g) => {
          g.memberIds = (g.memberIds || []).filter((id) => id !== m.userId);
        });
      }
      ev._pending = true;
      paint(ev.id);
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
      ev._pending = true;
      paint(ev.id);
      break;
    }
    case "setEventSignupGroups": {
      const ev = findEv(m.eventId);
      if (!ev) return;
      ev.signupGroups = Array.isArray(m.signupGroups) ? m.signupGroups : [];
      ev._pending = true;
      paint(ev.id);
      break;
    }
    case "assignEventGroup": {
      const ev = findEv(m.eventId);
      if (!ev || !m.userId) return;
      const groups = Array.isArray(ev.signupGroups) ? ev.signupGroups : [];
      groups.forEach((g) => {
        g.memberIds = (g.memberIds || []).filter((id) => id !== m.userId);
      });
      const groupId = String(m.groupId || "").trim();
      if (groupId) {
        const group = groups.find((g) => g.id === groupId);
        if (group && !(group.memberIds || []).includes(m.userId)) {
          (group.memberIds ||= []).push(m.userId);
        }
      }
      ev.signupGroups = groups;
      ev._pending = true;
      paint(ev.id);
      break;
    }
    case "setEventTimePrecision": {
      const ev = findEv(m.eventId);
      if (!ev) return;
      const precision = ["day", "period", "unconfirmed"].includes(m.whenPrecision) ? m.whenPrecision : null;
      const period = precision === "period" && ["morning", "afternoon", "evening"].includes(m.whenPeriod) ? m.whenPeriod : null;
      if (m.when) ev.when = m.when;
      if (precision) { ev.whenPrecision = precision; ev.whenPeriod = period; }
      else if (m.when) { ev.whenPrecision = null; ev.whenPeriod = null; }
      ev._pending = true;
      paint(ev.id);
      break;
    }
    case "setEventWhere": {
      const ev = findEv(m.eventId);
      if (!ev) return;
      ev.where = m.where || "";
      ev._pending = true;
      if (m.locationLabelId != null) {
        ev.locationLabelId = String(m.locationLabelId).trim() || null;
      }
      if (conn.key) {
        (ev.where ? decrypt(ev.where, conn.key) : Promise.resolve("")).then(t => {
          ev._where = t || "";
          if (m.locationLabelId == null && typeof curatedLocationLabelId === "function") {
            ev.locationLabelId = curatedLocationLabelId(ev._where, conn) || null;
          }
          paint(ev.id);
        });
      } else {
        hydratePlainEvent(ev);
        if (m.locationLabelId == null && typeof curatedLocationLabelId === "function") {
          ev.locationLabelId = curatedLocationLabelId(ev._where || ev.where, conn) || null;
        }
        paint(ev.id);
      }
      break;
    }
    case "setEventDetails": {
      const ev = findEv(m.eventId);
      if (!ev) return;
      ev.details = m.details || "";
      ev._pending = true;
      if (conn.key) {
        (ev.details ? decrypt(ev.details, conn.key) : Promise.resolve("")).then(t => {
          ev._details = t || "";
          paint(ev.id);
        });
      } else {
        hydratePlainEvent(ev);
        paint(ev.id);
      }
      break;
    }
    case "setEventSticker": {
      const ev = findEv(m.eventId);
      if (!ev) return;
      ev.sticker = m.sticker || "";
      ev.stickerBy = ev.sticker ? conn.me.id : null;
      ev.stickerByName = ev.sticker ? conn.me.name : null;
      ev._pending = true;
      if (conn.key) {
        (ev.sticker ? decrypt(ev.sticker, conn.key) : Promise.resolve("")).then(t => {
          ev._sticker = t || "";
          paint(ev.id);
        });
      } else {
        hydratePlainEvent(ev);
        paint(ev.id);
      }
      break;
    }
    case "setEventSubtitle": {
      const ev = findEv(m.eventId);
      if (!ev) return;
      ev.subtitle = m.subtitle || "";
      ev._pending = true;
      if (conn.key) {
        (ev.subtitle ? decrypt(ev.subtitle, conn.key) : Promise.resolve("")).then(t => {
          ev._subtitle = t || "";
          paint(ev.id);
        });
      } else {
        hydratePlainEvent(ev);
        paint(ev.id);
      }
      break;
    }
    case "setEventDuration": {
      const ev = findEv(m.eventId);
      if (!ev) return;
      ev.duration = m.duration || null;
      ev._pending = true;
      paint(ev.id);
      break;
    }
    case "setEventIcon": {
      const ev = findEv(m.eventId);
      if (!ev) return;
      ev.icon = (m.icon || "").trim() || null;
      ev._pending = true;
      if (typeof isDrawnIcon === "function" && isDrawnIcon(ev.icon)
          && typeof upsertReactionCard === "function") {
        upsertReactionCard(conn, ev.icon, conn.me);
      }
      paint(ev.id);
      break;
    }
    case "setEventType": {
      const ev = findEv(m.eventId);
      if (!ev) return;
      ev.title = m.title || ev.title;
      if ("shortName" in m) { ev.shortName = m.shortName || ""; delete ev._shortName; }
      ev.typeId = (m.typeId || "").trim() || null;
      ev.icon = (m.icon || "").trim() || null;
      if (m.cat != null) ev.cat = (m.cat || "").trim() || null;
      ev._pending = true;
      if (typeof isDrawnIcon === "function" && isDrawnIcon(ev.icon)
          && typeof upsertReactionCard === "function") {
        upsertReactionCard(conn, ev.icon, conn.me);
      }
      if (conn.key) {
        decrypt(ev.title, conn.key).then(async t => {
          ev._title = t;
          if ("shortName" in m) ev._shortName = ev.shortName ? await decrypt(ev.shortName, conn.key) : "";
          paint(ev.id);
        });
      } else {
        hydratePlainEvent(ev);
        paint(ev.id);
      }
      break;
    }
    case "react": {
      const ev = findEv(m.eventId);
      if (!ev || (!m.emoji && !m.clearEmoji && !m.remove && !m.removeAll)) return;
      const stacks = { ...(ev.reactionStacks || {}) };
      const ensure = (uid) => {
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
      } else if (m.append || m.add) {
        const list = ensure(conn.me.id);
        if (list.length < 24) list.push(m.emoji);
        if (typeof isDrawnIcon === "function" && isDrawnIcon(m.emoji)) {
          if (typeof upsertReactionCard === "function") upsertReactionCard(conn, m.emoji, conn.me);
          else {
            const cards = conn.reactionCards ||= [];
            if (!cards.includes(m.emoji)) cards.push(m.emoji);
          }
        }
      } else if (m.count == null) {
        const list = ensure(conn.me.id);
        if (list.length === 1 && list[0] === m.emoji) delete stacks[conn.me.id];
        else stacks[conn.me.id] = [m.emoji];
      } else {
        stacks[conn.me.id] = Array(Math.min(24, Math.max(1, m.count || 1))).fill(m.emoji);
      }
      ev.reactionStacks = Object.keys(stacks).length ? stacks : null;
      if (typeof syncEventReactionSummary === "function") syncEventReactionSummary(ev);
      else {
        const map = {};
        for (const [uid, list] of Object.entries(stacks)) {
          if (!list?.length) continue;
          const last = list[list.length - 1];
          map[uid] = list.length > 1 ? rxEncode(last, list.length) : last;
        }
        ev.reactions = Object.keys(map).length ? map : null;
      }
      ev._pending = true;
      paint(ev.id);
      break;
    }
    case "eventNote": {
      const ev = findEv(m.eventId);
      if (!ev || !m.text) return;
      const notes = ev.notes ||= [];
      if (m.noteId && notes.some(n => n.id === m.noteId)) { paint(ev.id); return; }
      const linked = m.linkedEventId && m.linkedEventId !== ev.id ? findEv(m.linkedEventId) : null;
      const note = {
        id: m.noteId || genLocalId(),
        userId: conn.me.id, name: conn.me.name, text: m.text, ts: Date.now(),
        mentionedUserIds: m.mentionedUserIds || null,
        linkedEventId: linked?.id || null,
        linkedEventTitle: linked?.title || null,
        _pending: true,
      };
      if (conn.key) {
        decrypt(note.text, conn.key).then(t => {
          note._text = t;
          paint(ev.id);
        });
      }
      notes.push(note);
      if (notes.length > 50) notes.shift();
      ev._pending = true;
      paint(ev.id);
      break;
    }
  }
}

/** Re-apply still-queued actions after welcome/sync wiped local optimistic state. */
function reapplyOutboxOptimistic(conn) {
  ensureOutbox(conn);
  for (const entry of conn.outbox || []) {
    if (entry?.payload) optimisticApply(conn, entry.payload);
  }
  refreshPendingFlags(conn);
}

function transportReady(conn) {
  if (!conn || PersonalSpace.isPersonal(conn)) return false;
  if (conn._transport === "http") return !!conn.token;
  if (conn.token && /^wss:/i.test(conn.url || "")) return !!conn.token;
  return !!(conn.ws && conn.ws.readyState === 1);
}

/** ~90s: still "reaching" after disconnect while retries run. */
const CONN_FEEL_REACHING_MS = 90_000;
/** Soft "Reaching host…" banner only after this long without outbox. */
const CONN_FEEL_REACHING_BANNER_MS = 8_000;
const CONN_FEEL_AGING_MS = 2 * 60_000;
const CONN_FEEL_STALE_MS = 30 * 60_000;

function markConnSynced(conn, at = Date.now()) {
  if (!conn || PersonalSpace.isPersonal(conn)) return;
  conn.lastSyncAt = at;
  conn._lastDisconnectAt = null;
  conn._outboxStuckSince = null;
  if (conn._readSource === "relay") conn._readSource = null;
}

function markConnDisconnected(conn, at = Date.now()) {
  if (!conn || PersonalSpace.isPersonal(conn)) return;
  if (!conn._lastDisconnectAt) conn._lastDisconnectAt = at;
  conn._sliceRequestedForSession = false;
}

function formatSyncAge(lastSyncAt, now = Date.now()) {
  const t = Number(lastSyncAt) || 0;
  if (!t) return "Not synced yet";
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (sec < 45) return "Synced just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `Synced ${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `Synced ${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `Synced ${days}d ago`;
}

/** @returns {"fresh"|"aging"|"stale"|"unknown"} */
function syncAgeTone(lastSyncAt, now = Date.now()) {
  const t = Number(lastSyncAt) || 0;
  if (!t) return "unknown";
  const age = now - t;
  if (age < CONN_FEEL_AGING_MS) return "fresh";
  if (age < CONN_FEEL_STALE_MS) return "aging";
  return "stale";
}

/**
 * Three-state connectivity feel (not binary offline).
 * @returns {{ state: "connected"|"reaching"|"unreachable", lastSyncAt: number, pendingOutbox: number, label: string, tone: string, viaRelay?: boolean, relayIncomplete?: boolean }}
 */
function connFeelState(conn, now = Date.now()) {
  if (!conn || PersonalSpace.isPersonal(conn)) {
    return { state: "connected", lastSyncAt: 0, pendingOutbox: 0, label: "", tone: "fresh" };
  }
  ensureOutbox(conn);
  const pendingOutbox = (conn.outbox || []).length;
  const displayStatus = (typeof hostedBridgeDisplayStatus === "function")
    ? hostedBridgeDisplayStatus(conn)
    : conn.status;
  const lastSyncAt = Number(conn.lastSyncAt) || 0;
  const tone = syncAgeTone(lastSyncAt, now);
  const viaRelay = conn._readSource === "relay";
  const relayIncomplete = !!conn._relayIncomplete;
  const ageLabel = lastSyncAt ? formatSyncAge(lastSyncAt, now) : "Waiting for host";
  const relayPrefix = viaRelay
    ? (relayIncomplete ? "Relay incomplete" : "Viewing relay")
    : "";

  if (displayStatus === "online" && (transportReady(conn) || conn.me) && !viaRelay) {
    return {
      state: "connected",
      lastSyncAt,
      pendingOutbox,
      label: formatSyncAge(lastSyncAt || now, now),
      tone: lastSyncAt ? tone : "fresh",
    };
  }

  const disconnectAt = Number(conn._lastDisconnectAt) || 0;
  const sinceDisconnect = disconnectAt ? (now - disconnectAt) : 0;
  const probing = !!(conn._reconnectTimer || conn._flushingOutbox
    || displayStatus === "connecting" || displayStatus === "waiting");
  const withinReachWindow = disconnectAt
    ? (sinceDisconnect < CONN_FEEL_REACHING_MS
      || (pendingOutbox > 0 && sinceDisconnect < CONN_FEEL_REACHING_MS * 2))
    : false;

  if (!viaRelay && (probing || withinReachWindow || displayStatus === "connecting" || displayStatus === "waiting")) {
    return {
      state: "reaching",
      lastSyncAt,
      pendingOutbox,
      label: pendingOutbox > 0
        ? `Syncing ${pendingOutbox} change${pendingOutbox === 1 ? "" : "s"}…`
        : "Syncing…",
      tone,
    };
  }

  return {
    state: "unreachable",
    lastSyncAt,
    pendingOutbox,
    viaRelay,
    relayIncomplete,
    label: relayPrefix
      ? (lastSyncAt ? `${relayPrefix} · ${ageLabel}` : relayPrefix)
      : ageLabel,
    tone: lastSyncAt ? tone : "stale",
  };
}

/** Seed lastSyncAt from offline cache when restoring a membership. */
function applyCachedFeel(conn, cached) {
  if (!conn || !cached) return;
  const t = Number(cached.lastSyncAt || cached.ts) || 0;
  if (t > 0 && !conn.lastSyncAt) conn.lastSyncAt = t;
}

/** True when this membership is on a Public (HTTPS edge) path — relay candidate. */
function connMayUseRelay(conn) {
  if (!conn || PersonalSpace.isPersonal(conn) || isShareGuest()) return false;
  if (typeof isHostedBridgeConn === "function" && isHostedBridgeConn(conn)) return false;
  const base = (typeof httpBaseFromConn === "function" ? httpBaseFromConn(conn) : "")
    || String(conn.sharePublic || conn.urlPublic || "").replace(/\/+$/, "");
  if (!/^https:/i.test(base)) return false;
  try {
    const host = new URL(base).hostname;
    if (!host || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
    if (/\.local$/i.test(host) || host === "localhost") return false;
  } catch {
    return false;
  }
  return !!(conn.token && (conn.key || conn.pass));
}

/**
 * Soft-apply a decrypted relay welcome without marking the transport online.
 * Preserves token, me, outbox; merges open-channel snapshot fields.
 */
async function applyRelayWelcome(conn, snap, meta = {}) {
  if (!conn || !snap || snap.type !== "welcome") return false;
  const seq = Number(meta.seq) || 0;
  const prevSeq = Number(conn._relaySeq) || 0;
  if (seq > 0 && prevSeq > 0 && seq < prevSeq) {
    conn._relayIncomplete = true;
    return false;
  }
  if (seq > 0 && prevSeq > 0 && seq > prevSeq + 1) {
    conn._relayIncomplete = true;
  } else {
    conn._relayIncomplete = false;
  }
  if (seq > 0) conn._relaySeq = seq;

  // Keep identity — relay stub user is empty.
  if (snap.hostName) {
    conn.hostName = snap.hostName;
    conn.name = snap.hostName;
  }
  if (snap.iconText != null) conn.iconText = String(snap.iconText);
  if (snap.serverPic != null && snap.serverPic !== "") conn.serverPic = snap.serverPic;
  else if (snap.serverPic === null || snap.serverPic === "") { /* keep */ }
  conn.channels = snap.channels || conn.channels || [];
  if (Array.isArray(snap.boards)) conn.boards = snap.boards;
  else if (!Array.isArray(conn.boards)) conn.boards = [];
  if (typeof ensureConnBoards === "function") ensureConnBoards(conn);
  conn.events = snap.events || [];
  conn.routines = Array.isArray(snap.routines) ? snap.routines : (conn.routines || []);
  conn.availabilities = Array.isArray(snap.availabilities) ? snap.availabilities : [];
  conn.timeBlocks = Array.isArray(snap.timeBlocks) ? snap.timeBlocks : [];
  conn.categories = snap.categories || conn.categories || [];
  conn.cardCats = (snap.cardCats && typeof snap.cardCats === "object") ? snap.cardCats : (conn.cardCats || {});
  conn.cardDurations = (snap.cardDurations && typeof snap.cardDurations === "object")
    ? snap.cardDurations : (conn.cardDurations || {});
  conn.removedCards = Array.isArray(snap.removedCards) ? snap.removedCards : (conn.removedCards || []);
  conn.locations = Array.isArray(snap.locations) ? snap.locations : (conn.locations || []);
  conn.eventTypes = Array.isArray(snap.eventTypes) ? snap.eventTypes : (conn.eventTypes || []);
  conn.customRoles = Array.isArray(snap.customRoles) ? snap.customRoles : (conn.customRoles || []);
  if (snap.eventRolePerms && typeof snap.eventRolePerms === "object") {
    conn.eventRolePerms = snap.eventRolePerms;
  }
  conn.messages = snap.messages || {};
  if (Array.isArray(snap.members) && snap.members.length) {
    conn.members = typeof normalizeConnMembers === "function"
      ? normalizeConnMembers(conn, snap.members)
      : snap.members;
  }
  if (snap.serverSettings) conn.serverSettings = snap.serverSettings;
  if (snap.e2eSalt) conn.e2eSalt = snap.e2eSalt;
  if (!conn.key && conn.pass && conn.e2eSalt && typeof deriveKey === "function") {
    conn.key = await deriveKey(conn.pass, conn.e2eSalt);
  }
  conn._readSource = "relay";
  const updatedAt = Number(meta.updatedAt) || Date.now();
  conn.lastSyncAt = updatedAt;
  if (typeof decryptAll === "function") await decryptAll(conn);
  if (typeof reapplyOutboxOptimistic === "function") reapplyOutboxOptimistic(conn);
  cacheConn(conn);
  return true;
}

/** Fetch Worker relay when Public host is unreachable. Debounced per conn. */
async function tryFetchRelayCache(conn) {
  if (!connMayUseRelay(conn)) return false;
  const feel = connFeelState(conn);
  if (feel.state === "connected") return false;
  const now = Date.now();
  if (conn._relayFetchAt && (now - conn._relayFetchAt) < 12_000) return false;
  if (conn._relayFetching) return false;
  conn._relayFetching = true;
  conn._relayFetchAt = now;
  try {
    const base = httpBaseFromConn(conn);
    const res = await serverFetch(`${base}/edge/relay`, {
      method: "GET",
      headers: { "X-Ash-Token": conn.token || "" },
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => ({}));
    if (data.type !== "relay" || typeof data.sealed !== "string") return false;
    if (!conn.key && conn.pass && conn.e2eSalt) {
      conn.key = await deriveKey(conn.pass, conn.e2eSalt);
    }
    if (!conn.key) return false;
    const plain = await decrypt(data.sealed, conn.key);
    if (!plain) {
      try { toast("Couldn't open relay cache — check your password."); } catch {}
      return false;
    }
    let snap;
    try { snap = JSON.parse(plain); } catch { return false; }
    const ok = await applyRelayWelcome(conn, snap, {
      seq: data.seq,
      updatedAt: data.updatedAt,
    });
    if (ok) {
      renderConnStatus();
      if (conn.id === S.activeConnId || S.activeConnId === "personal") {
        try { renderView(); } catch {}
        try { renderSidebar(); } catch {}
        try { renderRail(); } catch {}
      }
    }
    return ok;
  } catch {
    return false;
  } finally {
    conn._relayFetching = false;
  }
}

async function flushOutbox(conn) {
  if (!conn || PersonalSpace.isPersonal(conn) || conn._flushingOutbox) return;
  ensureOutbox(conn);
  if (!(conn.outbox || []).length) return;
  if (conn.status !== "online" || !conn.token || !transportReady(conn)) return;
  conn._flushingOutbox = true;
  renderConnStatus();
  try {
    while (conn.outbox.length) {
      if (conn.status !== "online" || !transportReady(conn)) break;
      const entry = conn.outbox[0];
      const ok = await deliverOutboxEntry(conn, entry);
      if (!ok) {
        if (!conn._outboxStuckSince) conn._outboxStuckSince = Date.now();
        break;
      }
      conn.outbox.shift();
      conn._outboxStuckSince = null;
      saveOutbox(conn);
      refreshPendingFlags(conn);
      markConnSynced(conn);
    }
    if (!(conn.outbox || []).length) markConnSynced(conn);
  } finally {
    conn._flushingOutbox = false;
    renderConnStatus();
    cacheConn(conn);
    if (conn.id === S.activeConnId || S.activeConnId === "personal") {
      renderView();
      renderSidebar();
    }
  }
}

/** Send one outbox payload; returns true if the host accepted delivery. */
async function deliverOutboxEntry(conn, entry) {
  const m = entry?.payload;
  if (!m) return true;
  try {
    if (conn._transport === "http" || (conn.token && /^wss:/i.test(conn.url || ""))) {
      return await httpRpcDeliver(conn, m);
    }
    if (conn.ws && conn.ws.readyState === 1) {
      conn.ws.send(JSON.stringify(m));
      return true;
    }
  } catch {}
  return false;
}

/**
 * Approve or block a pending event — waits for server RPC confirmation before
 * updating UI. msg: { type: "approveEvent"|"blockEvent", eventId, note?, altSuggestion? }
 */
async function submitEventApproval(conn, msg) {
  if (!conn || !msg?.eventId) return { ok: false, error: "Event not found" };
  const eventId = msg.eventId;
  const ev = conn.events?.find(e => e.id === eventId);
  if (!ev) return { ok: false, error: "Event not found" };

  ev._approvalSubmitting = true;
  if (affectsActiveView(conn, eventId)) {
    if (typeof renderView === "function") renderView();
  }

  const failMsg = msg.type === "blockEvent" ? "Could not block this event" : "Could not approve this event";
  try {
    if (conn.local || PersonalSpace.isPersonal(conn)) {
      localApply(conn, msg);
    } else {
      if (!conn.token) return { ok: false, error: "Not connected" };
      const base = httpBaseFromConn(conn);
      const res = await serverFetch(`${base}/ash-rpc`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "X-Ash-Token": conn.token || "",
        },
        body: JSON.stringify({ ...msg, token: conn.token }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403 || data.type === "kicked") {
        applyRemovedFromServer(conn, data.error || "Removed from this server");
        return { ok: false, error: data.error || "Removed from this server" };
      }
      if (data.type === "error" && /waiting for the host to approve/i.test(data.error || "")) {
        return { ok: false, error: data.error || failMsg };
      }
      if (!res.ok || data.type === "error") {
        return { ok: false, error: data.error || failMsg };
      }
      const msgs = Array.isArray(data.messages) ? data.messages : [];
      for (const m of msgs) {
        if (m && m.type === "pong") continue;
        handle(conn, m);
        if (conn._removedHandled || !S.conns[conn.id]) {
          return { ok: false, error: "Removed from this server" };
        }
      }
    }

    const updated = conn.events?.find(e => e.id === eventId);
    if (!updated) return { ok: false, error: "Event not found" };
    if (msg.type === "approveEvent") {
      if (updated.approvalStatus === "pending") return { ok: false, error: failMsg };
    } else if (msg.type === "blockEvent") {
      if (updated.approvalStatus !== "blocked") return { ok: false, error: failMsg };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: failMsg };
  } finally {
    const cur = conn.events?.find(e => e.id === eventId);
    if (cur) cur._approvalSubmitting = false;
    if (affectsActiveView(conn, eventId)) {
      if (typeof renderView === "function") renderView();
    }
  }
}

/** Like httpRpc but returns success/failure and does not queue on failure. */
async function httpRpcDeliver(conn, m) {
  if (!conn.token) return false;
  const base = httpBaseFromConn(conn);
  try {
    const res = await serverFetch(`${base}/ash-rpc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Ash-Token": conn.token || "",
      },
      body: JSON.stringify({ ...m, token: conn.token }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 || data.type === "kicked") {
      applyRemovedFromServer(conn, data.error || "Removed from this server");
      return false;
    }
    // Edge still on invite tier briefly after Approve — treat as soft failure (retry).
    if (data.type === "error" && /waiting for the host to approve/i.test(data.error || "")) {
      return false;
    }
    if (!res.ok || data.type === "error") return false;
    const msgs = Array.isArray(data.messages) ? data.messages : [];
    for (const msg of msgs) {
      if (msg && msg.type === "pong") continue;
      handle(conn, msg);
      if (conn._removedHandled || !S.conns[conn.id]) return false;
    }
    return true;
  } catch {
    return false;
  }
}
