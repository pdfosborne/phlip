/* channel-moderation.js — reports, blocks, delete channels, admin log, moderate panel.
 * Globals out: REPORT_REASONS, openReportModal, openBlockEventModal, …
 * Load after: channel-panel.js
 */
const REPORT_REASONS = [
  { id: "harassment", label: "Harassment or bullying" },
  { id: "hate",       label: "Hate speech" },
  { id: "sexual",     label: "Unwanted sexual content" },
  { id: "csam",       label: "Child sexual content" },
  { id: "violence",   label: "Violence or threats" },
  { id: "illegal",    label: "Illegal activity" },
  { id: "spam",       label: "Spam or scam" },
  { id: "other",      label: "Something else" },
];

let moderateShowAll = false;

function reportReasonLabel(id) {
  return (REPORT_REASONS.find(r => r.id === id) || {}).label || "Reported";
}

/** Reporting is only meaningful on a real remote server (not personal/local). */
function canReport(conn = activeConn()) {
  return !!conn && PersonalSpace.canReport(conn);
}

/** Personal mute/block list for this server (ids from welcome / blockUpdated). */
function blockedIds(conn = activeConn()) {
  return Array.isArray(conn?.blocked) ? conn.blocked : [];
}

function isBlocked(userId, conn = activeConn()) {
  return !!(userId && blockedIds(conn).includes(userId));
}

/** Drop reactions from members you've blocked (content hide). */
function reactionsVisible(map, conn = activeConn()) {
  if (!map || typeof map !== "object") return {};
  const out = {};
  for (const [uid, v] of Object.entries(map)) {
    if (isBlocked(uid, conn)) continue;
    out[uid] = v;
  }
  return out;
}

/** Block or unblock a member on the active (or given) remote server. */
function setMemberBlocked(userId, blocked, conn = activeConn()) {
  if (!userId || !canReport(conn)) {
    toast("Blocking isn’t available here.");
    return false;
  }
  if (userId === conn.me?.id) return false;
  const list = blockedIds(conn).slice();
  const i = list.indexOf(userId);
  if (blocked && i < 0) list.push(userId);
  else if (!blocked && i >= 0) list.splice(i, 1);
  else return false;
  conn.blocked = list;
  send({ type: "setBlock", userId, blocked: !!blocked }, conn.id);
  return true;
}

/** Open the reason picker and file a report against a target. */
function openReportModal({ targetType, targetId, channelId = null, targetLabel = "", connId = null }) {
  if (!targetId || !targetType) return;
  const conn = connId ? S.conns[connId] : activeConn();
  if (!canReport(conn)) { toast("Reporting isn't available here."); return; }
  const opened = AshModal.open({
    className: "report-modal",
    html: `
    <div class="modal-card report-card" role="dialog" aria-modal="true" aria-labelledby="report-title">
      <h4 id="report-title">Report ${esc(targetLabel || "this")}</h4>
      <p class="empty-note" style="margin:0 0 10px">This is sent privately to the host of this server to review. Please don't report just because you disagree.</p>
      <div class="report-reasons">
        ${REPORT_REASONS.map((r, i) => `
          <label class="report-reason">
            <input type="radio" name="report-reason" value="${r.id}" ${i === 0 ? "checked" : ""}>
            <span>${esc(r.label)}</span>
          </label>`).join("")}
      </div>
      <textarea id="report-note" class="report-note" maxlength="1000" rows="3" placeholder="Add any detail (optional)"></textarea>
      <div class="actions">
        <button type="button" class="cancel" id="report-cancel">Cancel</button>
        <button type="button" class="save danger" id="report-send">Send report</button>
      </div>
    </div>`,
    singleton: "return",
    closeOnEscape: true,
  });
  if (!opened) return;
  const { overlay, close } = opened;
  overlay.querySelector("#report-cancel").onclick = close;
  overlay.querySelector("#report-send").onclick = () => {
    const reason = (overlay.querySelector('input[name="report-reason"]:checked') || {}).value || "other";
    const note = (overlay.querySelector("#report-note").value || "").trim().slice(0, 1000);
    send({ type: "report", targetType, targetId, channelId, reason, note }, conn.id);
    close();
    toast("Report sent to the host.");
  };
}

/** Approver flow (§ approvals) — block a pending event with a reason + optional alternative. */
function openBlockEventModal(ev, conn = activeConn()) {
  if (!ev?.id) return;
  const opened = AshModal.open({
    className: "block-event-modal",
    html: `
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="block-event-title">
      <h4 id="block-event-title">Block this event</h4>
      <p class="empty-note" style="margin:0 0 10px">The organiser will be told this was declined, along with your note.</p>
      <textarea id="block-event-note" class="report-note" maxlength="1000" rows="3" placeholder="Reason (shown to the organiser)"></textarea>
      <textarea id="block-event-alt" class="report-note" maxlength="1000" rows="2" placeholder="Alternative suggestion (optional)" style="margin-top:8px"></textarea>
      <div class="actions" style="margin-top:10px">
        <button type="button" class="cancel" id="block-event-cancel">Cancel</button>
        <button type="button" class="save danger" id="block-event-send">Block event</button>
      </div>
    </div>`,
    singleton: "return",
    closeOnEscape: true,
  });
  if (!opened) return;
  const { overlay, close } = opened;
  overlay.querySelector("#block-event-cancel").onclick = close;
  overlay.querySelector("#block-event-send").onclick = async () => {
    const note = (overlay.querySelector("#block-event-note").value || "").trim().slice(0, 1000);
    const altSuggestion = (overlay.querySelector("#block-event-alt").value || "").trim().slice(0, 1000);
    const result = await submitEventApproval(conn, {
      type: "blockEvent", eventId: ev.id, note, altSuggestion,
    });
    if (result.ok) {
      close();
      toast("Event blocked");
    } else {
      toast(result.error || "Could not block this event");
    }
  };
}

/** Management → Delete boards — multi-select board delete. */
function openDeleteBoardsModal(conn = activeConn()) {
  if (!conn || !canManageServer(conn)) {
    toast("Only admins can delete boards");
    return;
  }
  const boards = (typeof boardsOf === "function" ? boardsOf(conn) : (conn.boards || [])).filter(b => {
    if (!b || !b.id) return false;
    if (b.sourceConnId && b.sourceBoardId) return false;
    if (typeof PersonalSpace !== "undefined" && PersonalSpace.isRequiredBoard?.(b, conn)) return false;
    return true;
  }).slice().sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" })
  );
  const opened = AshModal.open({
    className: "delete-channels-modal",
    html: `
    <div class="modal-card">
      <h4>Delete boards</h4>
      <p class="modal-note">Tick boards to remove. Events, chat and tasks in those boards are wiped. This can’t be undone.</p>
      ${boards.length ? `
        <label class="check-row qm-select-all"><input type="checkbox" id="dc-select-all"> Select all (${boards.length})</label>
        <div class="member-grid quick-manage-list" id="dc-list">
          ${boards.map(b => `<label class="member-chip"><input type="checkbox" class="dc-ch-cb" value="${esc(b.id)}"> ${esc(b.name || "Board")}</label>`).join("")}
        </div>
        <div class="actions" style="margin-top:14px">
          <button type="button" class="cancel" id="dc-cancel">Cancel</button>
          <button type="button" class="danger" id="dc-delete">Delete selected</button>
        </div>` : `
        <p class="empty-note" style="margin:0">No boards on this server.</p>
        <div class="actions" style="margin-top:14px">
          <span></span>
          <button type="button" class="cancel" id="dc-cancel">Close</button>
        </div>`}
    </div>`,
    singleton: "return",
  });
  if (!opened) return;
  const { overlay, close } = opened;
  overlay.querySelector("#dc-cancel").onclick = close;

  const selectAll = overlay.querySelector("#dc-select-all");
  if (selectAll) {
    selectAll.onchange = () => overlay.querySelectorAll(".dc-ch-cb").forEach(el => { el.checked = selectAll.checked; });
    overlay.querySelectorAll(".dc-ch-cb").forEach(el => {
      el.onchange = () => {
        const all = overlay.querySelectorAll(".dc-ch-cb");
        selectAll.checked = all.length && [...all].every(x => x.checked);
      };
    });
  }

  overlay.querySelector("#dc-delete")?.addEventListener("click", async () => {
    const ids = [...overlay.querySelectorAll(".dc-ch-cb:checked")].map(el => el.value);
    if (!ids.length) { toast("Select at least one board"); return; }
    const names = boards.filter(b => ids.includes(b.id)).map(b => b.name || "Board").join(", ");
    if (!(await ashConfirm(
      `Delete ${ids.length} board${ids.length > 1 ? "s" : ""}?\n\n${names}\n\nEvents, chat and tasks in these boards will be wiped. This can’t be undone.`,
      { danger: true }
    ))) return;
    const typed = prompt(`Type DELETE to remove ${ids.length} board${ids.length > 1 ? "s" : ""}:`);
    if (String(typed || "").trim().toUpperCase() !== "DELETE") {
      toast("Cancelled");
      return;
    }
    for (const boardId of ids) send({ type: "deleteBoard", boardId });
    toast(ids.length === 1 ? "Deleting board…" : `Deleting ${ids.length} boards…`);
    close();
  });
}
/** Admin log — failsafe list of every event & message on this server with a
 *  per-row Delete, for when the normal event/chat UI won't load or doesn't
 *  expose a way to remove something. Host/admin only. */
const ADMIN_LOG_MESSAGE_CAP = 300;

function adminLogEventRowHTML(ev, conn) {
  const ch = (conn.channels || []).find(c => c.id === ev.channelId);
  const title = shownField(ev._title, ev.title) || "(untitled event)";
  const endedAt = eventEndedAtMs(ev);
  const isEnded = endedAt != null && endedAt < Date.now();
  const when = ev.when ? new Date(ev.when).toLocaleString() : "no time set";
  return `
    <div class="people-row admin-log-row">
      <div class="people-main" style="align-items:flex-start">
        <span class="people-avatar">${ic("calendar")}</span>
        <div class="people-meta">
          <div class="people-name">${esc(title)}${isEnded ? ` <em>(ended)</em>` : ""}</div>
          <div class="people-role">${ch ? "#" + esc(ch.name) : "channel removed"} · ${esc(when)}</div>
        </div>
      </div>
      <div class="people-actions">
        <button type="button" class="people-btn danger admin-log-del" data-al-kind="event" data-al-id="${esc(ev.id)}">Delete</button>
      </div>
    </div>`;
}

function adminLogMessageRowHTML(m, conn) {
  const ch = (conn.channels || []).find(c => c.id === m._alChannelId);
  const text = shownField(m._text, m.text) || "(no content)";
  const snippet = String(text).slice(0, 140);
  const when = m.ts ? new Date(m.ts).toLocaleString() : "";
  return `
    <div class="people-row admin-log-row">
      <div class="people-main" style="align-items:flex-start">
        <span class="people-avatar">${ic("message")}</span>
        <div class="people-meta">
          <div class="people-name">${esc(snippet)}</div>
          <div class="people-role">${ch ? "#" + esc(ch.name) : "channel removed"} · ${esc(m.name || "someone")} · ${esc(when)}</div>
        </div>
      </div>
      <div class="people-actions">
        <button type="button" class="people-btn danger admin-log-del" data-al-kind="message" data-al-id="${esc(m.id || "")}" data-al-channel="${esc(m._alChannelId)}">Delete</button>
      </div>
    </div>`;
}

function openAdminLogModal(conn = activeConn()) {
  if (!conn || !canManageServer(conn)) {
    toast("Only the host or admins can see the admin log");
    return;
  }

  const opened = AshModal.open({
    className: "admin-log-modal",
    html: `
    <div class="modal-card">
      <h4>Admin log</h4>
      <p class="modal-note">Every event and message currently on this server — a failsafe list for deleting things the normal screens won’t show or won’t let you remove. This can’t be undone.</p>
      <div class="people-list" id="al-events-list"></div>
      <div class="people-list" id="al-messages-list"></div>
      <div class="actions" style="margin-top:14px">
        <span></span>
        <button type="button" class="cancel" id="al-close">Close</button>
      </div>
    </div>`,
    singleton: "return",
  });
  if (!opened) return;
  const { overlay, close } = opened;
  overlay.querySelector("#al-close").onclick = close;

  const eventsList = overlay.querySelector("#al-events-list");
  const messagesList = overlay.querySelector("#al-messages-list");

  const renderLists = () => {
    const events = [...(conn.events || [])].sort((a, b) => {
      const aEnded = (eventEndedAtMs(a) ?? Infinity) < Date.now();
      const bEnded = (eventEndedAtMs(b) ?? Infinity) < Date.now();
      if (aEnded !== bEnded) return aEnded ? 1 : -1;
      return (a.when || 0) - (b.when || 0);
    });
    const allMessages = [];
    for (const [chId, list] of Object.entries(conn.messages || {})) {
      for (const m of (list || [])) allMessages.push({ ...m, _alChannelId: chId });
    }
    allMessages.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const shownMessages = allMessages.slice(0, ADMIN_LOG_MESSAGE_CAP);

    eventsList.innerHTML = `<div class="people-section-label">Events (${events.length})</div>` +
      (events.length
        ? events.map(ev => adminLogEventRowHTML(ev, conn)).join("")
        : `<p class="empty-note" style="padding:8px 0">No events on this server.</p>`);

    messagesList.innerHTML = `<div class="people-section-label">Messages (${shownMessages.length}${
      allMessages.length > shownMessages.length ? ` of ${allMessages.length}, newest first` : ""
    })</div>` +
      (shownMessages.length
        ? shownMessages.map(m => adminLogMessageRowHTML(m, conn)).join("")
        : `<p class="empty-note" style="padding:8px 0">No messages on this server.</p>`);

    overlay.querySelectorAll(".admin-log-del").forEach(btn => {
      btn.onclick = async () => {
        const kind = btn.dataset.alKind;
        const id = btn.dataset.alId;
        if (!(await ashConfirm(`Delete this ${kind}? This can’t be undone.`, { danger: true }))) return;
        if (kind === "event") {
          send({ type: "deleteEvent", eventId: id }, conn.id);
          conn.events = (conn.events || []).filter(e => e.id !== id);
        } else {
          const channelId = btn.dataset.alChannel;
          send({ type: "deleteMessage", channelId, messageId: id }, conn.id);
          if (conn.messages?.[channelId]) {
            conn.messages[channelId] = conn.messages[channelId].filter(x => x.id !== id);
          }
        }
        toast(kind === "event" ? "Event deleted" : "Message deleted");
        renderLists();
      };
    });
  };
  renderLists();
}

function openModerateSideOverlay() {
  if (!canSeeModerateMeta()) return;
  openSideOverlay({
    kind: "moderate",
    title: "Moderate",
    bodyClass: ["side-overlay-moderate", "moderate-side-body"],
    mount: (body) => mountModeratePanel(body),
  });
}

function reportTargetSummary(rep) {
  switch (rep.targetType) {
    case "user": {
      const u = (S.members || []).find(x => x.id === rep.targetId);
      return u ? `member “${u.name}”` : "a member";
    }
    case "event": return "an event";
    case "message": {
      const ch = rep.channelId
        && ((activeConn()?.channels || board()?.channels || []).find(c => c.id === rep.channelId));
      return ch ? `a message in #${ch.name}` : "a chat message";
    }
    case "broadcast": return "a broadcast link";
    default: return "content";
  }
}

/** The host/admin/moderator Moderate inbox — reports, newest first, with quick actions. */
function mountModeratePanel(host) {
  if (!host || !canSeeModerateMeta()) return;
  const all = [...(S.reports || [])].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const open = all.filter(r => r.status === "open");
  const showAll = !!moderateShowAll;
  const rows = showAll ? all : open;
  const canLog = typeof canManageServer === "function" && canManageServer();
  host.innerHTML = `
    ${canLog ? `<button type="button" class="server-settings-row console-row" id="moderate-admin-log">
      <span>${ic("history", "ico-inline")} Admin log</span>
      <span class="muted">All events & messages · failsafe</span>
    </button>` : ""}
    <div class="report-filter">
      <button type="button" class="people-btn${showAll ? "" : " on"}" data-f="open">Open (${open.length})</button>
      <button type="button" class="people-btn${showAll ? " on" : ""}" data-f="all">All (${all.length})</button>
    </div>
    <p class="empty-note report-intro">Members and guests can flag content or people. Review each and act with the member / event tools. Removing content stops it being served — people who already saw it may still have a copy.</p>
    <div class="people-list" id="reports-list"></div>`;
  host.querySelector("#moderate-admin-log")?.addEventListener("click", () => {
    if (typeof openAdminLogModal === "function") openAdminLogModal(activeConn());
  });
  host.querySelector('[data-f="open"]').onclick = () => {
    moderateShowAll = false;
    mountModeratePanel(host);
  };
  host.querySelector('[data-f="all"]').onclick = () => {
    moderateShowAll = true;
    mountModeratePanel(host);
  };

  const list = host.querySelector("#reports-list");
  if (!rows.length) {
    list.innerHTML = `<p class="empty-note" style="padding:24px 8px;text-align:center">${showAll ? "No reports yet." : "No open reports."}</p>`;
    return;
  }
  for (const rep of rows) {
    const connId = rep._connId || activeConn()?.id;
    const when = rep.createdAt ? new Date(rep.createdAt).toLocaleString() : "";
    const row = document.createElement("div");
    row.className = "people-row report-row" + (rep.status !== "open" ? " report-done" : "");
    row.innerHTML = `
      <div class="people-main" style="align-items:flex-start">
        <span class="people-avatar report-flag">${ic("flag")}</span>
        <div class="people-meta">
          <div class="people-name">${esc(reportReasonLabel(rep.reason))}
            ${rep.status !== "open" ? `<em>(${esc(rep.status)}${rep.handledByName ? " by " + esc(rep.handledByName) : ""})</em>` : ""}
          </div>
          <div class="people-role">About ${esc(reportTargetSummary(rep))} · from ${esc(rep.reporterName || "someone")}${rep.isGuest ? " (guest)" : ""}</div>
          ${rep.note ? `<div class="report-note-text">“${esc(rep.note)}”</div>` : ""}
          <div class="report-when">${esc(when)}</div>
        </div>
      </div>
      <div class="people-actions report-actions"></div>`;
    const actions = row.querySelector(".report-actions");

    if (rep.targetType === "event") {
      const openBtn = document.createElement("button");
      openBtn.type = "button"; openBtn.className = "people-btn";
      openBtn.textContent = "View event";
      openBtn.onclick = () => {
        if (connId) S.activeConnId = connId;
        closeSideOverlay();
        closeNav();
        Nav.openEventDetail(rep.targetId);
        renderSidebar(); renderView();
      };
      actions.appendChild(openBtn);
    } else if (rep.targetType === "message") {
      if (rep.channelId) {
        const openBtn = document.createElement("button");
        openBtn.type = "button"; openBtn.className = "people-btn";
        openBtn.textContent = "View chat";
        openBtn.onclick = () => {
          if (connId) S.activeConnId = connId;
          closeSideOverlay();
          closeNav();
          Nav.openChannel(rep.channelId);
          renderSidebar(); renderView();
        };
        actions.appendChild(openBtn);
      }
      if (canModerateEvents(connId ? S.conns[connId] : activeConn()) && rep.channelId && rep.targetId) {
        const del = document.createElement("button");
        del.type = "button"; del.className = "people-btn danger";
        del.textContent = "Delete message";
        del.onclick = async () => {
          if (!(await ashConfirm("Delete this message?", { danger: true }))) return;
          send({ type: "deleteMessage", channelId: rep.channelId, messageId: rep.targetId }, connId);
          if (rep.status === "open") {
            send({ type: "resolveReport", id: rep.id, action: "resolved" }, connId);
          }
          toast("Message deleted");
        };
        actions.appendChild(del);
      }
    } else if (rep.targetType === "user") {
      const target = (S.members || []).find(u => u.id === rep.targetId);
      if (target && !target.isHost && canManageMember(target)) {
        const rm = document.createElement("button");
        rm.type = "button"; rm.className = "people-btn danger";
        rm.textContent = "Remove member";
        rm.onclick = async () => {
          if (!(await ashConfirm(`Remove ${target.name} from this server?`, { danger: true }))) return;
          send({ type: "removeMember", userId: target.id }, connId);
          toast(`Removed ${target.name}`);
        };
        actions.appendChild(rm);
      }
    }

    if (rep.status === "open") {
      const done = document.createElement("button");
      done.type = "button"; done.className = "people-btn";
      done.textContent = "Mark done";
      done.onclick = () => send({ type: "resolveReport", id: rep.id, action: "resolved" }, connId);
      const dismiss = document.createElement("button");
      dismiss.type = "button"; dismiss.className = "people-btn";
      dismiss.textContent = "Dismiss";
      dismiss.onclick = () => send({ type: "resolveReport", id: rep.id, action: "dismissed" }, connId);
      actions.appendChild(done);
      actions.appendChild(dismiss);
    } else {
      const reopen = document.createElement("button");
      reopen.type = "button"; reopen.className = "people-btn";
      reopen.textContent = "Reopen";
      reopen.onclick = () => send({ type: "resolveReport", id: rep.id, action: "open" }, connId);
      actions.appendChild(reopen);
    }
    list.appendChild(row);
  }
}

function renderReportsView(_view) {
  if (!canSeeModerateMeta()) {
    Nav.landDefault();
    renderSidebar();
    renderView();
    return;
  }
  openModerateSideOverlay();
  Nav.landDefault();
  if (S.activeView?.kind === "console" || S.activeView?.kind === "moderate" || S.activeView?.kind === "reports") {
    Nav.set({ kind: "events" });
    try { landOnTodayWeekView(); } catch {}
  }
  renderSidebar();
  renderView();
}

