/* board-pages.js — Board pages: People, Timeline, Tasks, Polls, and the options menu that opens them.
 * Timeline, Tasks and Polls are parked for now (PHLIP_PARKED in helpers-part1.js).
 *
 * Globals in:  shared board/chat state (S, Nav, activeConn)
 * Globals out: boardOpenPage, paintBoardOptions, conversationsPeopleHTML, closeBoardOptions,
 *   syncFloatBoardMemberCountNow
 * Load after:  board-feed.js
 * Load before: board-home.js
 *
 * Must not: ES modules, bundlers, unrelated feature work
 */

function conversationsPeopleHTML(ch) {
  if (typeof channelAccessPeopleListHTML === "function") return channelAccessPeopleListHTML(ch);
  const people = typeof channelMemberList === "function" ? channelMemberList(ch) : [];
  if (!people.length) {
    return `<p class="empty-note">No one on this board yet.</p>`;
  }
  const online = new Set((typeof S !== "undefined" && S.online) || []);
  return `<div class="people-list">${people.map((u) => {
    const on = online.has(u.id);
    const name = esc(u.name || "Someone");
    const face = typeof avatarFaceHtml === "function" ? avatarFaceHtml(u.id, u.name || "?") : "";
    const style = typeof avatarStyle === "function" ? avatarStyle(u.id) : "";
    return `<div class="people-row">
      <div class="people-row-head">
        <div class="people-main">
          <span class="people-avatar" style="${style}" title="${on ? "Online" : "Offline"}">${face}<span class="presence-dot ${on ? "on" : ""}" aria-hidden="true"></span></span>
          <div class="people-meta"><div class="people-name">${name}</div></div>
        </div>
      </div>
    </div>`;
  }).join("")}</div>`;
}

function conversationsCanInvitePeople(conn) {
  return !!(typeof canInviteToGroup === "function" && canInviteToGroup(conn));
}

function conversationsCanSetPeopleAccess(conn) {
  if (!conn) return false;
  try {
    if (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn)) return false;
  } catch {}
  return typeof canManageServer === "function" && canManageServer(conn);
}

function boardOptionsIsOpen() {
  const panel = document.getElementById("board-options");
  return !!(panel && !panel.hidden);
}

function closeBoardOptions({ restoreFocus = false } = {}) {
  const panel = document.getElementById("board-options");
  const trigger = document.getElementById("board-title-btn");
  if (panel) panel.hidden = true;
  if (trigger) trigger.setAttribute("aria-expanded", "false");
  document.body.classList.remove("board-options-open");
  if (restoreFocus && trigger?.classList.contains("is-trigger")) {
    try { trigger.focus(); } catch {}
  }
}

function boardOptionsCanEdit(conn) {
  if (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal?.(conn)) return false;
  return typeof canManageServer === "function" && !!canManageServer(conn);
}

function syncFloatBoardMemberCount(eventCh, conn) {
  const sub = document.getElementById("view-sub");
  if (!sub || !eventCh) return;
  // Visible members of the board; a guest can see fewer member fields than
  // the host, so never let the lookup blank the line — fall back to everyone.
  let n = 0;
  try { n = typeof channelMemberList === "function" ? channelMemberList(eventCh, conn).length : 0; } catch { n = 0; }
  if (!n) n = (conn?.members || (typeof S !== "undefined" ? S.members : null) || []).length;
  sub.textContent = !n ? "" : n === 1 ? "1 member" : `${n} members`;
}

/** Re-reads the count after the member list changes (joins, presence). */
function syncFloatBoardMemberCountNow(conn) {
  if (typeof document === "undefined" || !document.body.classList.contains("float-board")) return;
  // The active connection, not the sender: a projected board's members
  // arrive on its source server while the view runs on another connection.
  const active = typeof activeConn === "function" ? activeConn() : conn;
  const eventCh = typeof conversationActiveEventChannel === "function" ? conversationActiveEventChannel() : null;
  if (eventCh) syncFloatBoardMemberCount(eventCh, active);
}

function syncFloatBoardHeader(eventCh, conn) {
  const title = document.getElementById("view-title");
  const name = typeof boardTitle === "function" ? boardTitle(eventCh, conn) : "";
  if (title && name) {
    title.hidden = false;
    title.textContent = typeof headerTitle === "function" ? headerTitle(name) : name;
  }
  syncFloatBoardMemberCount(eventCh, conn);
}

function syncBoardTitleTrigger(canOpen) {
  const trigger = document.getElementById("board-title-btn");
  const chev = document.getElementById("board-title-chev");
  if (trigger) {
    trigger.classList.toggle("is-trigger", !!canOpen);
    if (canOpen) {
      trigger.setAttribute("role", "button");
      trigger.tabIndex = 0;
      trigger.setAttribute("aria-haspopup", "dialog");
      if (!boardOptionsIsOpen()) trigger.setAttribute("aria-expanded", "false");
    } else {
      trigger.removeAttribute("role");
      trigger.removeAttribute("tabindex");
      trigger.setAttribute("aria-expanded", "false");
    }
  }
  if (chev) {
    chev.hidden = !canOpen;
    if (canOpen && typeof ic === "function" && !chev.querySelector(".ico")) {
      chev.innerHTML = ic("chevron-down");
    }
  }
  if (!canOpen && boardOptionsIsOpen()) closeBoardOptions({ restoreFocus: false });
}

function paintBoardOptions() {
  const panel = document.getElementById("board-options");
  const eventCh = typeof conversationActiveEventChannel === "function"
    ? conversationActiveEventChannel()
    : null;
  const conn = typeof activeConn === "function" ? activeConn() : null;
  if (!panel || !eventCh) return;
  const people = typeof channelMemberList === "function" ? channelMemberList(eventCh, conn) : [];
  const page = typeof boardPageKind === "function" ? boardPageKind() : "";
  const events = typeof channelEventsForPanelChat === "function"
    ? channelEventsForPanelChat(eventCh)
    : (conn?.events || []);
  const upcoming = typeof boardLiveEvents === "function"
    ? boardLiveEvents(events)
    : (typeof boardUpcomingEvents === "function" ? boardUpcomingEvents(events) : []);
  const countLabel = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const pageBtn = (kind, icon, label, info) => {
    const archived = typeof boardArchiveOn === "function" && boardArchiveOn();
    const on = kind === "archive" ? archived && page === "chat" : page === kind && !(kind === "chat" && archived);
    const mark = typeof ic === "function" ? ic(icon) : "";
    const meta = info ? `<span class="board-page-meta">${esc(info)}</span>` : "";
    return `<button type="button" data-board-page="${kind}"${on ? ` aria-current="page"` : ""}>${mark}<span class="board-page-label">${esc(label)}</span>${meta}</button>`;
  };
  const hideOn = typeof boardHideDeclined === "function" ? boardHideDeclined() : true;
  panel.innerHTML = `
    <nav class="board-page-links" aria-label="Board pages">
      ${pageBtn("chat", "message-circle", "All chat")}
      ${pageBtn("people", "users", "People", countLabel(people.length, "member", "members"))}
      ${(typeof featureParked === "function" && featureParked("timeline")) ? "" : pageBtn("timeline", "calendar-days", "Timeline", upcoming.length ? countLabel(upcoming.length, "upcoming", "upcoming") : "None upcoming")}
      ${(typeof featureParked === "function" && featureParked("archive")) ? "" : pageBtn("archive", "archive", "Archive")}
      <button type="button" data-board-settings>${typeof ic === "function" ? ic("settings") : ""}<span class="board-page-label">Settings</span></button>
    </nav>
    <label class="board-opt-line">
      <span>Hide chat for events I’m not going to</span>
      <input type="checkbox" role="switch" data-board-hide-declined${hideOn ? " checked" : ""} aria-label="Hide chat for events I’m not going to">
    </label>
`;
}

function boardOptionsOpenSettings() {
  const eventCh = conversationActiveEventChannel();
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const board = typeof boardForChannel === "function" ? boardForChannel(eventCh, conn) : null;
  closeBoardOptions({ restoreFocus: false });
  if (board && typeof openBoardSettingsSheet === "function") openBoardSettingsSheet(board.id);
}

function openBoardOptions() {
  const panel = document.getElementById("board-options");
  const trigger = document.getElementById("board-title-btn");
  if (!panel || !trigger?.classList.contains("is-trigger")) return;
  paintBoardOptions();
  panel.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  document.body.classList.add("board-options-open");
  try {
    panel.tabIndex = -1;
    panel.focus();
  } catch {}
}

function toggleBoardOptions() {
  if (boardOptionsIsOpen()) closeBoardOptions({ restoreFocus: true });
  else openBoardOptions();
}

(function wireBoardOptions() {
  const panel = document.getElementById("board-options");
  const trigger = document.getElementById("board-title-btn");
  let swallowClick = false;
  document.addEventListener("pointerdown", (e) => {
    if (!boardOptionsIsOpen()) return;
    if (e.target.closest?.("#board-options, #board-title-btn")) return;
    closeBoardOptions({ restoreFocus: true });
    swallowClick = true;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  document.addEventListener("click", (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  if (trigger && !trigger.dataset.boardWired) {
    trigger.dataset.boardWired = "1";
    trigger.addEventListener("click", (e) => {
      if (!trigger.classList.contains("is-trigger")) return;
      e.preventDefault();
      toggleBoardOptions();
    });
    trigger.addEventListener("keydown", (e) => {
      if (!trigger.classList.contains("is-trigger")) return;
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      toggleBoardOptions();
    });
  }
  if (panel && !panel.dataset.boardWired) {
    panel.dataset.boardWired = "1";
    panel.addEventListener("click", (e) => {
      if (e.target.closest("[data-board-settings]")) {
        e.preventDefault();
        boardOptionsOpenSettings();
        return;
      }
      const page = e.target.closest("[data-board-page]");
      if (page && typeof boardOpenPage === "function") {
        e.preventDefault();
        boardOpenPage(page.dataset.boardPage);
      }
    });
    panel.addEventListener("change", (e) => {
      const hide = e.target.closest("[data-board-hide-declined]");
      if (hide && typeof boardSetHideDeclined === "function") {
        boardSetHideDeclined(hide.checked);
        if (typeof renderView === "function") renderView(true);
        return;
      }
    });
  }
})();

function boardRenderPeoplePage(view) {
  const root = view || document.getElementById("view");
  const eventCh = typeof conversationActiveEventChannel === "function" ? conversationActiveEventChannel() : null;
  const conn = typeof activeConn === "function" ? activeConn() : null;
  if (!root) return;
  const canInvite = typeof conversationsCanInvitePeople === "function" && conversationsCanInvitePeople(conn);
  const canPerms = typeof conversationsCanSetPeopleAccess === "function" && conversationsCanSetPeopleAccess(conn);
  const accessOpen = !!(typeof S !== "undefined" && S.boardPeopleAccess && canPerms);
  root.classList.add("board-people-mode");
  root.style.cssText = "display:flex;flex-direction:column;flex:1;min-height:0";
  root.innerHTML = `
    <div class="board-people-page">
      <div class="poll-head conv-page-head">
        <h2 class="poll-title">People</h2>
        <div class="conv-people-actions">
          ${canInvite ? `<button type="button" class="conv-people-action" data-board-people-invite>Invite</button>` : ""}
          ${canPerms ? `<button type="button" class="conv-people-action${accessOpen ? " on" : ""}" data-board-people-perms aria-pressed="${accessOpen ? "true" : "false"}">Permissions</button>` : ""}
        </div>
      </div>
      <div id="board-people-body"></div>
    </div>`;
  const body = root.querySelector("#board-people-body");
  if (accessOpen && eventCh && typeof mountChannelAccessControls === "function") {
    body.innerHTML = `<div id="board-people-access"></div>`;
    mountChannelAccessControls(body.querySelector("#board-people-access"), {
      existing: eventCh,
      readOnly: typeof boardOptionsCanEdit === "function" ? !boardOptionsCanEdit(conn) : false,
      onSaved: () => boardRenderPeoplePage(root),
    });
  } else if (body) {
    body.innerHTML = eventCh && typeof conversationsPeopleHTML === "function"
      ? conversationsPeopleHTML(eventCh)
      : `<p class="empty-note">No one on this board yet.</p>`;
  }
  if (!root.dataset.boardPeopleWired) {
    root.dataset.boardPeopleWired = "1";
    root.addEventListener("click", (e) => {
      if (typeof S === "undefined" || !S.boardPeoplePage) return;
      if (e.target.closest("[data-board-people-invite]")) {
        const current = typeof activeConn === "function" ? activeConn() : null;
        if (typeof sharePersonalInviteLink === "function") sharePersonalInviteLink(current);
        return;
      }
      if (e.target.closest("[data-board-people-perms]")) {
        S.boardPeopleAccess = !S.boardPeopleAccess;
        boardRenderPeoplePage(root);
      }
    });
  }
}

function boardOpenPage(kind) {
  if (kind === "tasks" || kind === "polls" || (kind === "timeline" && typeof featureParked === "function" && featureParked("timeline"))) {
    kind = "chat";
  }
  const from = boardPageKind();
  if (typeof S !== "undefined" && kind !== "people") {
    S.boardPeoplePage = false;
    S.boardPeopleAccess = false;
  }
  boardSaveChatMemory();
  if (typeof S !== "undefined") S.boardComposerOpen = false;
  if (typeof boardClearContinueScan === "function") boardClearContinueScan();
  if (typeof closeBoardOptions === "function") closeBoardOptions({ restoreFocus: false });
  if (kind === "chat") {
    if (from !== "chat") boardReturnToChat();
    if (typeof boardShowAllChat === "function") boardShowAllChat();
    return;
  }
  if (kind === "archive") {
    if (from !== "chat" || S.conversationsThread?.eventId) boardReturnToChat();
    boardSelectArchive();
    return;
  }
  if (kind === "people") {
    if (typeof S !== "undefined") S.boardPeoplePage = true;
    if (typeof conversationChatSurfaceOn === "function" && !conversationChatSurfaceOn()
        && typeof conversationsLandOnGeneralChat === "function") {
      conversationsLandOnGeneralChat();
      return;
    }
    if (typeof renderView === "function") renderView(false, { force: true });
    return;
  }
  if (kind === "timeline") {
    if (typeof setBoardConversationsSurface === "function") setBoardConversationsSurface("agenda");
  }
}
