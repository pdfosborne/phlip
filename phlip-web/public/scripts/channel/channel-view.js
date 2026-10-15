/* channel-view.js — renderView dispatcher, notifications, server-info.
 * Globals out: renderView, renderNotifications, openPersonalNotificationsBoard, renderServerInfo, flushDeferredViewRender, viewIsPainted, navChromeSameConn
 * Load after: channel-shell.js; before: channel-console.js
 */

let _paintedNavKey = "";

function paintedNavKey(connId = typeof S !== "undefined" ? S.activeConnId : "", view = typeof S !== "undefined" ? S.activeView : null) {
  const projection = typeof S !== "undefined" ? S.activeProjection : null;
  return `${connId || ""}:${projection?.sourceConnId || ""}:${view?.kind || ""}:${view?.id || ""}`;
}

function markPaintedNav() {
  _paintedNavKey = paintedNavKey();
}

function viewIsPainted() {
  if (!_paintedNavKey) return true;
  return _paintedNavKey === paintedNavKey();
}

/** True when chrome (sidebar title + painted view title) belong to the same conn. */
function navChromeSameConn({ connId, connName, viewTitle, paintedConnId } = {}) {
  if (paintedConnId != null && String(paintedConnId) !== String(connId || "")) return false;
  const title = String(viewTitle || "");
  const name = String(connName || "");
  if (!title || !name) return true;
  if (title === name || title.startsWith(name + " · ")) return true;
  if (title.includes(" · ") && !title.startsWith(name)) return false;
  return true;
}

function renderView(keepScroll, opts) {
  // Drawer / info panel cover the board — skip heavy view rebuilds so taps on
  // sidebar controls aren't starved by timeline re-renders underneath.
  // switchConn passes { force: true } so the destination paints immediately.
  const force = !!(opts && opts.force);
  if (!force && (Panel.navOpen() || Panel.channelOpen())) {
    _viewRenderPending = true;
    _viewRenderKeepScroll = keepScroll;
    // Panel Chat / Memories still need live updates while the agenda is deferred.
    try { syncChannelPanel(); } catch {}
    return;
  }
  _viewRenderPending = false;
  if (typeof clampPersonalSocialMetaView === "function") clampPersonalSocialMetaView();
  if (typeof clampHiddenPersonalChannelView === "function") clampHiddenPersonalChannelView();
  if (typeof clampAllEventsMetaView === "function") clampAllEventsMetaView();
  const g = group();
  const view = $("#view");
  if (!g || !S.activeView) {
    view.innerHTML = "";
    markPaintedNav();
    if (typeof syncBoardHeadChrome === "function") syncBoardHeadChrome();
    return;
  }
  markPaintedNav();
  view.classList.toggle("timeline-view-mode", false);
  view.classList.toggle("tl-layout-list", false);
  view.classList.toggle("event-detail-layout", false);
  const chForFlags = S.activeView.kind === "channel"
    ? g.channels.find(c => c.id === S.activeView.id)
    : null;
  const onConversations = !!(chForFlags && typeof isBoardConversationsView === "function"
    && isBoardConversationsView(chForFlags));
  const onPolls = !!(chForFlags && typeof isBoardPollsView === "function"
    && isBoardPollsView(chForFlags));
  const onEventsBoard = S.activeView.kind === "events"
    || (S.activeView.kind === "channel" && chForFlags?.kind === "event");
  const onRollingTimeline = onEventsBoard && !onConversations && !onPolls;
  document.body.classList.toggle("events-timeline-only", onEventsBoard);
  document.body.classList.toggle("timeline-view-active", onRollingTimeline);
  view.classList.toggle("conversations-view-mode", onConversations);
  view.classList.toggle("polls-view-mode", onPolls);
  if (!onRollingTimeline && !onConversations && typeof closeTimelineSheet === "function") {
    closeTimelineSheet();
  }
  const onTaskChannel = S.activeView.kind === "channel"
    && g.channels.find(c => c.id === S.activeView.id)?.kind === "task";
  if (!onTaskChannel && typeof TaskChannelUI !== "undefined"
      && typeof TaskChannelUI.closeComposer === "function") {
    try { TaskChannelUI.closeComposer(); } catch {}
  }

  if (S.activeView.kind === "notifications") {
    showPlainTitle("Notifications");
    $("#view-sub").textContent = "";
    renderNotifications(view);
  } else if (S.activeView.kind === "memories") {
    showPlainTitle("Memories");
    $("#view-sub").textContent = "";
    if (typeof renderHistory === "function") renderHistory(view, g, null);
    else view.innerHTML = "";
  } else if (S.activeView.kind === "members") {
    if (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(activeConn())) {
      Nav.landDefault();
      renderView();
      return;
    }
    showPlainTitle("People");
    $("#view-sub").textContent = canManageServer()
      ? "Roles, join requests, and members"
      : "Everyone on this server";
    renderMembersView(view);
  } else if (S.activeView.kind === "serverInfo") {
    if (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(activeConn())) {
      Nav.landDefault();
      renderView();
      return;
    }
    showPlainTitle("Server info");
    $("#view-sub").textContent = "";
    renderServerInfo(view);
  } else if (S.activeView.kind === "console") {
    showPlainTitle("Default role");
    $("#view-sub").textContent = "Organiser tools for this server";
    renderConsoleView(view);
  } else if (S.activeView.kind === "moderate" || S.activeView.kind === "reports") {
    showPlainTitle("Moderate");
    $("#view-sub").textContent = "";
    renderReportsView(view);
  } else if (S.activeView.kind === "sharedHistory") {
    const other = S.members.find(u => u.id === S.activeView.userId);
    showPlainTitle(other ? `With ${other.name}` : "Shared history");
    $("#view-sub").textContent = "Events you’re both part of";
    renderSharedHistory(view, S.activeView.userId);
  } else if (S.activeView.kind === "live") {
    showPlainTitle("Live");
    $("#view-sub").textContent = "Guest pages broadcasting now";
    renderLiveChannel(view);
  } else if (S.activeView.kind === "events") {
    showEventsModeTabs();
    $("#view-sub").textContent = "";
    renderEvents(view, g);
  } else {
    const ch = g.channels.find(c => c.id === S.activeView.id);
    if (!ch) {
      Nav.landDefault();
      return renderView();
    }
    const conn = typeof activeConn === "function" ? activeConn() : null;
    if (conn && !(typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn))
      && typeof channelVisibleTo === "function"
      && !channelVisibleTo(ch, conn.me, conn)) {
      Nav.landDefault();
      return renderView();
    }
    if (ch.kind === "event") {
      // Event-group chat lives in the event pull-up — main view stays on the agenda
      // unless this board uses the conversations list.
      if (S.activeView?.surface === "chat") {
        delete S.activeView.surface;
        delete S.activeView.chatFrom;
      }
      const title = typeof channelHeadTitle === "function" ? channelHeadTitle(ch) : `# ${ch.name}`;
      if (typeof isBoardPollsView === "function" && isBoardPollsView(ch)
          && typeof renderPolls === "function") {
        showPlainTitle(title);
        $("#view-sub").textContent = "";
        renderPolls(view, ch);
      } else if (typeof isBoardConversationsView === "function" && isBoardConversationsView(ch)
          && typeof renderConversations === "function") {
        showPlainTitle(title);
        $("#view-sub").textContent = "";
        renderConversations(view, ch, g);
      } else {
        showEventsModeTabs(title);
        $("#view-sub").textContent = "";
        renderEvents(view, g, ch);
      }
    } else if (ch.kind === "task") {
      showPlainTitle(typeof channelHeadTitle === "function" ? channelHeadTitle(ch) : `# ${ch.name}`);
      $("#view-sub").textContent = "";
      if (typeof renderTasks === "function") renderTasks(view, ch);
      else view.innerHTML = `<p class="empty-note">Tasks are not part of this app.</p>`;
    } else {
      const isWelcome = typeof isWelcomeLobby === "function" && isWelcomeLobby(ch);
      const convChat = !isWelcome && ch.kind === "chat"
        && typeof conversationActiveEventChannel === "function"
        && !!conversationActiveEventChannel();
      if (convChat) {
        if (typeof S !== "undefined") S.boardChatHome = true;
        const eventCh = conversationActiveEventChannel();
        const title = typeof channelHeadTitle === "function"
          ? channelHeadTitle(eventCh)
          : (eventCh?.name || ch.name);
        showPlainTitle(title);
        $("#view-sub").textContent = "";
      } else {
        const board = typeof boardForChannel === "function" ? boardForChannel(ch, conn) : null;
        const threadId = typeof S !== "undefined" ? S.conversationsThread?.eventId : null;
        const filterId = (!threadId && typeof S !== "undefined") ? S.chatFilterEventId : null;
        const namedId = threadId || filterId;
        let chatName = typeof conversationBoardChatLabel === "function"
          ? conversationBoardChatLabel()
          : "All chat";
        if (namedId) {
          const ev = (conn?.events || g.events || []).find(e => e.id === namedId);
          chatName = ev
            ? ((typeof eventDisplayTitle === "function" && eventDisplayTitle(ev))
              || ev._title || ev.title || "Chat")
            : "Chat";
        }
        const chatTitle = board?.name
          ? `${board.name} > ${chatName}`
          : (typeof channelHeadTitle === "function" ? channelHeadTitle(ch) : `# ${ch.name}`);
        showPlainTitle(chatTitle, { raw: !!board?.name });
        $("#view-sub").textContent = "";
      }
      if (typeof S !== "undefined" && S.boardPeoplePage && typeof boardRenderPeoplePage === "function") {
        boardRenderPeoplePage(view);
      } else {
        renderChat(view, ch, keepScroll);
      }
    }
  }
  syncChannelPanel();
  if (typeof syncBoardHeadChrome === "function") syncBoardHeadChrome();
}

/* notifications: "you were added to X" / "you were @-mentioned in #Y" */
function renderNotifications(view, opts = {}) {
  if (opts.panel) view.dataset.panelMode = "1";
  const panel = view.dataset.panelMode === "1" || !!opts.panel;
  view.style.cssText = "display:flex;flex-direction:column;flex:1;min-height:0";
  // Merged across every conn when personal is active (see the S.notifications
  // accessor) — each entry always carries _connId, even for a single conn.
  const list = S.notifications.slice().sort((a, b) => b.ts - a.ts);

  const lineFor = (n) => {
    const conn = S.conns[n._connId] || activeConn();
    if (n.kind === "removedFromServer") {
      const name = n.serverName || "a server";
      return {
        icon: "trash",
        text: `You were removed from <b>${esc(name)}</b>`,
      };
    }
    if (n.kind === "addedToEvent") {
      const ev = (conn.events || []).find(e => e.id === n.eventId);
      return { icon: "ticket", text: `${esc(n.fromUserName)} added you to ${ev ? esc(eventDisplayTitle(ev)) : "an event"}` };
    }
    if (n.kind === "eventPendingApproval") {
      const ev = (conn.events || []).find(e => e.id === n.eventId);
      return { icon: "clock", text: `${esc(n.fromUserName)} wants to create ${ev ? esc(eventDisplayTitle(ev)) : "an event"} — needs your approval` };
    }
    if (n.kind === "eventBlocked") {
      const ev = (conn.events || []).find(e => e.id === n.eventId);
      const reason = n.approvalNote ? ` — ${esc(n.approvalNote)}` : "";
      return { icon: "flag", text: `${esc(n.fromUserName)} declined ${ev ? esc(eventDisplayTitle(ev)) : "your event"}${reason}` };
    }
    if (n.eventId && !n.channelId) {
      const ev = (conn.events || []).find(e => e.id === n.eventId);
      return { icon: "message", text: `${esc(n.fromUserName)} mentioned you on ${ev ? esc(eventDisplayTitle(ev)) : "an event"}` };
    }
    const ch = (conn.channels || []).find(c => c.id === n.channelId);
    return { icon: "message", text: `${esc(n.fromUserName)} mentioned you in #${esc(ch?.name ?? "a channel")}` };
  };

  view.innerHTML = `
    <div class="events-scroll no-tray"><div class="events-wrap">
      ${panel ? "" : `<div class="board-head"><h4>Notifications</h4></div>`}
      <div id="notif-list"></div>
    </div></div>`;

  const notifScroll = view.querySelector(".events-scroll");
  if (notifScroll && !panel) {
    attachSwipeBack(notifScroll, () => openNav());
    attachModeSwipe(notifScroll, { openNavOnRight: true, navOnly: true });
  }

  const notifList = $("#notif-list");
  if (!list.length) {
    notifList.innerHTML = `<p class="empty-note">Nothing here yet — you'll hear about it when someone adds you to an event or @-mentions you.</p>`;
  } else {
    notifList.innerHTML = list.map(n => {
      const { icon, text } = lineFor(n);
      return `<article class="notif-item${n.read ? "" : " unread"}" data-id="${n.id}">
        <span class="notif-icon">${ic(icon)}</span>
        <div class="notif-body">
          <div class="notif-text">${text}</div>
          <div class="notif-when">${esc(fmtDay(n.ts))} · ${esc(fmtTime(n.ts))}</div>
        </div>
      </article>`;
    }).join("");
    notifList.querySelectorAll(".notif-item").forEach(el => {
      el.onclick = () => {
        const n = list.find(x => x.id === el.dataset.id);
        if (!n) return;
        if (n.kind === "removedFromServer") {
          // Server is already gone — stay on personal notifications.
          return;
        }
        // A notification from a background conn needs that conn switched to
        // (and its right group picked) before the view can navigate to it.
        const switching = n._connId && n._connId !== S.activeConnId;
        if (switching) S.activeConnId = n._connId;
        if ((n.kind === "addedToEvent" || n.kind === "eventPendingApproval" || n.kind === "eventBlocked") && n.eventId)
          Nav.openEventDetail(n.eventId);
        else if (n.eventId && !n.channelId) Nav.openEventDetail(n.eventId);
        else if (n.channelId) Nav.openChannel(n.channelId);
        if (switching) renderAll(); else { renderSidebar(); renderView(); }
      };
    });
  }

  // Opening the list is "seeing" it — mark whatever was unread as read, both
  // locally (badge updates immediately) and on each owning conn (persists),
  // batched per conn since the merged list can span several servers at once.
  const unread = list.filter(n => !n.read);
  if (unread.length) {
    const byConn = {};
    for (const n of unread) (byConn[n._connId] ||= []).push(n.id);
    for (const [connId, ids] of Object.entries(byConn)) {
      const conn = S.conns[connId];
      if (!conn) continue;
      for (const n of conn.notifications) if (ids.includes(n.id)) n.read = true;
      if (PersonalSpace.isPersonal(conn)) savePersonal();
      send({ type: "markNotificationsRead", ids }, connId);
    }
    if (panel) syncChannelPanelNotifBadge();
    else renderSidebar();
  }
}

/** Switch to personal and open the Notifications main board. */
function openPersonalNotificationsBoard() {
  if (S.activeConnId !== "personal") S.activeConnId = "personal";
  Nav.set({ kind: "notifications" });
  try { closeNav(); } catch {}
  try {
    if (typeof closeChannelPanel === "function" && Panel.channelOpen()) closeChannelPanel();
  } catch {}
  renderSidebar();
  renderView();
}

/**
 * Shared-server "Server info" page — description, role ladder, admins/moderators.
 */
function renderServerInfo(view, conn = activeConn()) {
  view.style.cssText = "display:flex;flex-direction:column;flex:1;min-height:0";
  const members = conn?.members || [];
  const canEdit = canManageServer(conn);
  const rawDesc = String(serverSettings(conn).description || "");
  const desc = rawDesc.trim();

  const roleRows = [
    { key: "admin", label: "Admin" },
    { key: "moderator", label: "Moderator" },
    { key: "user", label: "Member" },
    { key: "viewer", label: "Viewer" },
  ].map(r => ({ ...r, count: members.filter(m => effectiveRole(m) === r.key).length }));
  const customRoleRows = customRolesOf(conn).map(r => ({
    key: r.id,
    label: r.name || "Role",
    count: members.filter(m => Array.isArray(m.roleTagIds) && m.roleTagIds.includes(r.id)).length,
  }));

  const staffRank = (m) => (m?.isHost ? 0 : effectiveRole(m) === "admin" ? 1 : 2);
  const staff = members
    .filter(m => m?.isHost || effectiveRole(m) === "admin" || effectiveRole(m) === "moderator")
    .sort((a, b) => staffRank(a) - staffRank(b) || (a.name || "").localeCompare(b.name || ""));

  const aboutHtml = canEdit
    ? `<textarea id="server-info-about" class="report-note" maxlength="500" rows="3" placeholder="What's this server for?">${esc(rawDesc)}</textarea>
        <div class="actions" style="margin:8px 0 0"><span></span><button type="button" class="save" id="server-info-about-save">Save</button></div>`
    : `<p class="empty-note" style="margin:0">${desc ? esc(desc) : "No description yet."}</p>`;

  view.innerHTML = `
    <div class="events-scroll no-tray"><div class="events-wrap">
      <div class="board-head"><h4>Server info</h4></div>
      <div class="server-info-section">
        <div class="people-section-label">About</div>
        ${aboutHtml}
      </div>
      <div class="server-info-section">
        <div class="people-section-label">Roles</div>
        <div class="people-list">
          ${roleRows.concat(customRoleRows).map(r => `
            <div class="people-row">
              <div class="people-row-head">
                <div class="people-main"><span class="people-name">${esc(r.label)}</span></div>
                <div class="people-role">${r.count}</div>
              </div>
            </div>`).join("")}
        </div>
      </div>
      <div class="server-info-section">
        <div class="people-section-label">Admins &amp; moderators</div>
        <div class="people-list" id="server-info-staff">
          ${staff.length ? staff.map(m => `
            <div class="people-row">
              <div class="people-row-head">
                <div class="people-main">
                  <span class="people-avatar" style="${avatarStyle(m.id)}">${avatarFaceHtml(m.id, m.name || "?")}</span>
                  <div class="people-meta">
                    <div class="people-name">${esc(m.name || "Someone")}</div>
                    <div class="people-role">${m.isHost ? "Host" : (effectiveRole(m) === "admin" ? "Admin" : "Moderator")}</div>
                  </div>
                </div>
              </div>
            </div>`).join("") : `<p class="empty-note">No staff yet.</p>`}
        </div>
      </div>
    </div></div>`;

  if (canEdit) {
    view.querySelector("#server-info-about-save")?.addEventListener("click", () => {
      const next = (view.querySelector("#server-info-about")?.value || "").trim().slice(0, 500);
      send({ type: "updateServerSettings", description: next });
      conn.serverSettings = { ...(conn.serverSettings || {}), description: next };
      toast("Server description updated");
    });
  }
}

/** Events both people are part of (created, RSVP'd, or noted). */
