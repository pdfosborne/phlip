/* board-settings-sheet.js — pull-up board settings from sidebar long-press.
 * Globals out: openBoardSettingsSheet, closeBoardSettingsSheet,
 *   boardSettingsOrigin, openBoardSettingsOrigin, channelSettingsSheetHandleBack,
 *   boardWipeContent
 * Load after: channel-settings.js, channel-access.js; before: wireboot
 */

let _boardSettingsSheetClose = null;

function closeBoardSettingsSheet() {
  if (typeof _boardSettingsSheetClose === "function") {
    const fn = _boardSettingsSheetClose;
    _boardSettingsSheetClose = null;
    try { fn(); } catch {}
    return;
  }
  if (typeof AshModal !== "undefined" && AshModal.close) {
    AshModal.close("channel-settings-sheet");
  }
}

function boardSettingsSheetIconHTML(board, conn) {
  const customIcon = String(board?.icon || "").trim();
  const iconInner = customIcon && typeof ic === "function"
    ? ic(customIcon, "ico-inline")
    : (typeof ic === "function" ? ic("ticket", "ico-inline") : "");
  const canEdit = typeof canEditChannelSettingsForm === "function"
    ? canEditChannelSettingsForm(conn)
    : ((typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn))
      || (typeof canManageServer === "function" && canManageServer(conn)));
  const cls = "channel-settings-sheet-icon" + (canEdit ? " editable" : "");
  const title = canEdit ? ` title="Change icon" aria-label="Change icon"` : "";
  return `<button type="button" class="${cls}" id="ch-sheet-icon"${title} ${canEdit ? "" : "disabled"}>${iconInner}</button>`;
}

function bindBoardSettingsSheetDismiss(card, close) {
  const handle = card.querySelector(".channel-settings-sheet-handle");
  const head = card.querySelector(".channel-settings-sheet-head");
  const dragEls = [handle, head].filter(Boolean);
  if (!dragEls.length) return;

  let tracking = false;
  let sy = 0;
  let st = 0;
  let pointerId = null;
  let captureEl = null;

  const resetTransform = () => {
    card.style.transition = "";
    card.style.transform = "";
  };

  const commitDrag = (dy, dt) => {
    const travel = card.getBoundingClientRect().height || innerHeight;
    if (typeof AshGesture !== "undefined" && typeof AshGesture.shouldCommit === "function") {
      return AshGesture.shouldCommit({ distance: dy, travel, dt });
    }
    return dy > travel * 0.25;
  };

  const onDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest?.("button, a, input, textarea, select, label")) return;
    tracking = true;
    pointerId = e.pointerId;
    captureEl = e.currentTarget;
    sy = e.clientY;
    st = performance.now();
    card.style.transition = "none";
    try { captureEl.setPointerCapture(pointerId); } catch {}
  };

  const onMove = (e) => {
    if (!tracking || e.pointerId !== pointerId) return;
    const dy = Math.max(0, e.clientY - sy);
    card.style.transform = `translateY(${dy.toFixed(1)}px)`;
    e.preventDefault();
  };

  const onUp = (e) => {
    if (!tracking || (pointerId != null && e.pointerId !== pointerId)) return;
    tracking = false;
    try { captureEl?.releasePointerCapture(pointerId); } catch {}
    const dy = Math.max(0, e.clientY - sy);
    const dt = performance.now() - st;
    pointerId = null;
    captureEl = null;
    if (commitDrag(dy, dt)) {
      card.style.transition = "transform .22s ease-in";
      card.style.transform = "translateY(110%)";
      setTimeout(() => close(), 200);
      return;
    }
    card.style.transition = "transform .28s cubic-bezier(.2,.8,.2,1)";
    card.style.transform = "";
    setTimeout(resetTransform, 300);
  };

  dragEls.forEach((el) => {
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  });
}

function boardSettingsOrigin(board, event, conn = activeConn()) {
  if (board?.sourceConnId && board?.sourceBoardId) {
    const sourceConn = S.conns?.[board.sourceConnId] || null;
    const name = sourceConn && typeof connDisplayName === "function"
      ? connDisplayName(sourceConn)
      : (sourceConn?.name || "a server");
    return {
      connId: board.sourceConnId,
      boardId: board.sourceBoardId,
      channelId: "",
      name,
      available: !!sourceConn,
      offline: !sourceConn || sourceConn.status !== "online",
    };
  }
  const personal = typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn);
  if (!personal) return null;
  const feedId = event?.id;
  const link = (feedId && typeof directLinkedEventSourcesFor === "function")
    ? (directLinkedEventSourcesFor(conn.id, feedId) || []).find(l => l?.connId && l.connId !== conn.id)
    : null;
  const fromConn = link ? S.conns?.[link.connId] : null;
  if (!fromConn || (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(fromConn))) return null;
  const srcCh = (fromConn.channels || []).find(c => c.id === link.channelId);
  const name = typeof connDisplayName === "function" ? connDisplayName(fromConn) : (fromConn.name || "a server");
  return {
    connId: fromConn.id,
    boardId: srcCh?.boardId || "",
    channelId: link.channelId || "",
    name,
    available: true,
    offline: fromConn.status !== "online",
  };
}

function openBoardSettingsOrigin(origin) {
  if (!origin?.connId) return;
  const dest = S.conns?.[origin.connId];
  if (!dest) {
    try { toast("That server isn’t available"); } catch {}
    return;
  }
  let channelId = origin.channelId || "";
  if (!channelId && origin.boardId && typeof eventChannelForBoard === "function") {
    const srcBoard = (dest.boards || []).find(b => b.id === origin.boardId);
    channelId = eventChannelForBoard(srcBoard, dest)?.id || "";
  }
  if (channelId && typeof persistLastDest === "function") {
    persistLastDest(origin.connId, { kind: "channel", id: channelId });
  }
  if (origin.boardId && typeof persistOpenBoardId === "function") {
    persistOpenBoardId(origin.boardId, dest);
  }
  closeBoardSettingsSheet();
  if (typeof switchConn === "function") switchConn(origin.connId);
  if (channelId && typeof Nav?.openChannel === "function") Nav.openChannel(channelId);
  try { closeNav(); } catch {}
  if (typeof renderSidebar === "function") renderSidebar(true);
  if (typeof renderView === "function") renderView(false, { force: true });
}

function boardSettingsAccessSummary(board, event, conn = activeConn()) {
  const target = event || { ...board, kind: "event" };
  const meta = typeof boardViewAccessMeta === "function"
    ? boardViewAccessMeta(target, conn)
    : null;
  if (meta?.detail) return meta.detail;
  if (meta?.label) return meta.label;
  if (Array.isArray(target?.allowedUserIds) && !target.autoIncludeNewMembers) {
    return "Private — only people you add";
  }
  return "Everyone";
}

function openBoardSettingsAccessSubmenu(overlay, channelId, { canEdit = false } = {}) {
  const card = overlay?.querySelector?.(".channel-settings-sheet-card");
  const main = overlay?.querySelector?.("#ch-sheet-main");
  const sub = overlay?.querySelector?.("#ch-sheet-access-sub");
  const mount = overlay?.querySelector?.("#ch-sheet-access-mount");
  if (!card || !main || !sub || !mount) return;
  const ch = (typeof group === "function" ? group()?.channels : null)?.find(c => c.id === channelId)
    || (activeConn()?.channels || []).find(c => c.id === channelId);
  if (!ch || typeof mountChannelAccessControls !== "function") return;

  mount.innerHTML = "";
  mountChannelAccessControls(mount, {
    existing: ch,
    readOnly: !canEdit,
    showTitle: false,
    onSaved: () => {
      const fresh = (typeof group === "function" ? group()?.channels : null)?.find(c => c.id === ch.id) || ch;
      const summary = overlay.querySelector("#ch-sheet-access-summary");
      if (summary) summary.textContent = boardSettingsAccessSummary(null, fresh);
    },
  });

  card.classList.add("is-access-sub");
  main.hidden = true;
  sub.hidden = false;
  try { sub.querySelector("#ch-sheet-access-back")?.focus?.(); } catch {}
}

function closeBoardSettingsAccessSubmenu(overlay) {
  const card = overlay?.querySelector?.(".channel-settings-sheet-card");
  const main = overlay?.querySelector?.("#ch-sheet-main");
  const sub = overlay?.querySelector?.("#ch-sheet-access-sub");
  if (!card || !main || !sub) return;
  card.classList.remove("is-access-sub");
  sub.hidden = true;
  main.hidden = false;
}

/** Pop "Who can see this" before AshModal.closeTop. */
function channelSettingsSheetHandleBack() {
  const overlay = document.querySelector(".modal-backdrop.channel-settings-sheet");
  if (!overlay) return false;
  const modals = document.querySelectorAll(".modal-backdrop");
  if (modals.length && modals[modals.length - 1] !== overlay) return false;
  if (!overlay.querySelector(".channel-settings-sheet-card.is-access-sub")) return false;
  closeBoardSettingsAccessSubmenu(overlay);
  return true;
}

function syncBoardSettingsNudgeButtons(overlay, boardId) {
  const up = overlay?.querySelector?.("#ch-sheet-move-up");
  const down = overlay?.querySelector?.("#ch-sheet-move-down");
  if (!up || !down) return;
  const state = typeof sidebarChannelSectionState === "function"
    ? sidebarChannelSectionState(boardId) : null;
  const index = state ? state.index : -1;
  const count = state ? state.count : 0;
  up.disabled = index <= 0;
  down.disabled = index < 0 || index >= count - 1;
}

function openBoardSettingsSheet(boardId) {
  const conn = activeConn();
  if (!conn) return;
  const id = String(boardId || "");
  const board = (conn.boards || []).find(b => b.id === id);
  if (!board) return;
  const event = typeof eventChannelForBoard === "function" ? eventChannelForBoard(board, conn) : null;
  const personal = typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn);
  const sourceBoard = !!(board.sourceConnId && board.sourceBoardId);
  const required = typeof PersonalSpace !== "undefined" && PersonalSpace.isRequiredBoard?.(board, conn);
  const canEdit = !sourceBoard && (personal || (typeof canManageServer === "function" && canManageServer(conn)));
  const boardState = typeof sidebarChannelSectionState === "function"
    ? sidebarChannelSectionState(board.id) : null;
  const canNudge = !!(boardState && boardState.count >= 2);
  const canReorder = !sourceBoard && canEdit && (canNudge
    || (conn.boards || []).filter(b => b && !b.sourceConnId).length >= 2);
  const showAccess = !personal && !sourceBoard;
  const shownInPersonal = !personal && typeof isBoardShownInPersonal === "function"
    && isBoardShownInPersonal(conn.id, board.id);
  const allowShowInPersonal = !personal && (typeof boardAllowsShowInPersonal === "function"
    ? boardAllowsShowInPersonal(board) : board.allowShowInPersonal !== false);
  const origin = boardSettingsOrigin(board, event, conn);
  const accessSummary = showAccess ? boardSettingsAccessSummary(board, event, conn) : "";

  if (typeof cancelArmedSideNavTap === "function") cancelArmedSideNavTap();
  if (typeof suppressSideNavTaps === "function") suppressSideNavTaps(500);
  closeBoardSettingsSheet();

  let removeAccessEsc = null;
  const opened = typeof AshModal !== "undefined" && AshModal.open
    ? AshModal.open({
      className: "channel-settings-sheet",
      html: `
        <div class="channel-settings-sheet-card" role="dialog" aria-modal="true" aria-labelledby="ch-sheet-title">
          <div class="channel-settings-sheet-handle" aria-hidden="true"></div>
          <div class="channel-settings-sheet-head">
            ${boardSettingsSheetIconHTML(board, conn)}
            <h4 id="ch-sheet-title" class="channel-settings-sheet-title">${esc(board.name || "Board")}</h4>
          </div>
          <div class="channel-settings-sheet-body">
            <div id="ch-sheet-main">
              <div class="channel-settings-sheet-actions">
                ${showAccess ? `<button type="button" class="ch-manage-btn channel-settings-sheet-access-btn" id="ch-sheet-access-open">
                  <span class="channel-settings-sheet-access-btn-main">${typeof ic === "function" ? ic("users", "ico-inline") : ""} Who can see this</span>
                  <span class="channel-settings-sheet-access-summary" id="ch-sheet-access-summary">${esc(accessSummary)}</span>
                </button>` : ""}
                ${origin ? `<button type="button" class="ch-manage-btn channel-settings-sheet-access-btn" id="ch-sheet-open-origin"${origin.available ? "" : " disabled"}>
                  <span class="channel-settings-sheet-access-btn-main">${typeof ic === "function" ? ic("arrow-down-right", "ico-inline") : ""} From ${esc(origin.name)}</span>
                  <span class="channel-settings-sheet-access-summary">${origin.available ? "Open this board on that server" : "Server unavailable"}</span>
                </button>` : ""}
                ${canNudge ? `<button type="button" class="ch-manage-btn" id="ch-sheet-move-up">${typeof ic === "function" ? ic("chevron-up", "ico-inline") : ""} Move up</button>
                <button type="button" class="ch-manage-btn" id="ch-sheet-move-down">${typeof ic === "function" ? ic("chevron-down", "ico-inline") : ""} Move down</button>` : ""}
                ${canReorder ? `<button type="button" class="ch-manage-btn" id="ch-sheet-reorder">${typeof ic === "function" ? ic("move-vertical", "ico-inline") : ""} Reorder boards</button>` : ""}
              </div>
              <div class="channel-settings-sheet-section">
                <form id="board-form">
                  ${canEdit ? `<div class="field"><label for="ch-name">Name</label>
                    <input id="ch-name" maxlength="32" value="${esc(board.name || "")}" ${required ? "disabled" : ""} required>
                  </div>` : ""}
                  ${required ? `<p class="ch-scope-summary">Required — My calendar saves here. This board can’t be deleted or renamed.</p>` : ""}
                  ${sourceBoard ? `<p class="ch-scope-summary">Live Events, Chat and Tasks stay on that server.</p>` : ""}
                  ${personal && !sourceBoard ? `<p class="ch-scope-summary">Just you — stored on this device.</p>` : ""}
                  ${!personal ? `${canEdit ? `<div class="field">
                    <label class="check-row">
                      <input type="checkbox" id="ch-allow-show-in-personal" ${allowShowInPersonal ? "checked" : ""}>
                      Allow Show in Personal
                    </label>
                    <p class="ch-scope-summary" style="margin-top:6px">If you allow this, members can open this board from Personal. That is their device — they can screenshot, export, or keep what they can see.</p>
                  </div>` : ""}
                  <div class="field" id="ch-show-in-personal-field"${allowShowInPersonal ? "" : " hidden"}>
                    <label class="check-row">
                      <input type="checkbox" id="ch-show-in-personal" ${shownInPersonal ? "checked" : ""} ${allowShowInPersonal ? "" : "disabled"}>
                      Show in Personal
                    </label>
                    <p class="ch-scope-summary" style="margin-top:6px">Opens this board’s Events, Chat and Tasks from Personal, without leaving that space.</p>
                  </div>
                  ${!allowShowInPersonal && !canEdit ? `<p class="ch-scope-summary" id="ch-show-in-personal-blocked">The host has turned this off for this board.</p>` : ""}` : ""}
                  <div class="actions">
                    ${sourceBoard ? `<button type="button" class="danger" id="ch-hide-from-personal">Hide from Personal</button><span></span>` : ""}
                    ${canEdit && !sourceBoard ? `<button type="button" class="danger" id="ch-wipe-board">Wipe board</button>` : ""}
                    ${!required && canEdit && !sourceBoard ? `<button type="button" class="danger" id="ch-delete-board">Delete board</button><span></span>` : (!sourceBoard ? `<span></span>` : "")}
                  </div>
                </form>
              </div>
            </div>
            <div id="ch-sheet-access-sub" class="channel-settings-sheet-sub" hidden>
              <div class="channel-settings-sheet-sub-head">
                <button type="button" class="channel-settings-sheet-back" id="ch-sheet-access-back" aria-label="Back">${typeof ic === "function" ? ic("back") : "←"}</button>
                <h5 class="channel-settings-sheet-sub-title">Who can see this</h5>
              </div>
              <div id="ch-sheet-access-mount" class="channel-settings-sheet-sub-body"></div>
            </div>
          </div>
        </div>`,
      singleton: "replace",
      graceMs: 450,
      closeOnEscape: true,
      closeOnBackdrop: true,
      onClose: () => {
        try { removeAccessEsc?.(); } catch {}
        removeAccessEsc = null;
        _boardSettingsSheetClose = null;
      },
    })
    : null;
  if (!opened) return;
  const { overlay, close } = opened;
  _boardSettingsSheetClose = close;

  const card = overlay.querySelector(".channel-settings-sheet-card");
  if (card) bindBoardSettingsSheetDismiss(card, close);
  if (sourceBoard) {
    const iconBtn = overlay.querySelector("#ch-sheet-icon");
    if (iconBtn) {
      iconBtn.disabled = true;
      iconBtn.classList.remove("editable");
      iconBtn.removeAttribute("title");
      iconBtn.removeAttribute("aria-label");
    }
  }

  const onKey = (e) => {
    if (e.key !== "Escape") return;
    if (!overlay.isConnected) return;
    if (!overlay.querySelector(".channel-settings-sheet-card.is-access-sub")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    closeBoardSettingsAccessSubmenu(overlay);
  };
  document.addEventListener("keydown", onKey, true);
  removeAccessEsc = () => document.removeEventListener("keydown", onKey, true);

  const persistName = () => {
    if (!canEdit || required || sourceBoard) return;
    const name = overlay.querySelector("#ch-name")?.value.trim();
    if (!name) return;
    board.name = name;
    if (typeof applyBoardVisibility === "function") applyBoardVisibility(conn, board);
    send({ type: "updateBoard", boardId: board.id, name });
    const title = overlay.querySelector("#ch-sheet-title");
    if (title) title.textContent = name;
    if (typeof renderSidebar === "function") renderSidebar(true);
  };
  let nameTimer = null;
  overlay.querySelector("#ch-name")?.addEventListener("input", () => {
    clearTimeout(nameTimer);
    nameTimer = setTimeout(persistName, 450);
  });
  overlay.querySelector("#ch-name")?.addEventListener("blur", persistName);

  overlay.querySelector("#ch-sheet-icon")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (sourceBoard) return;
    if (typeof openBoardIconPicker === "function") openBoardIconPicker(board.id);
  });

  overlay.querySelector("#ch-sheet-access-open")?.addEventListener("click", () => {
    if (event) openBoardSettingsAccessSubmenu(overlay, event.id, { canEdit });
  });
  overlay.querySelector("#ch-sheet-open-origin")?.addEventListener("click", () => {
    openBoardSettingsOrigin(origin);
  });
  overlay.querySelector("#ch-sheet-access-back")?.addEventListener("click", () => {
    closeBoardSettingsAccessSubmenu(overlay);
  });
  overlay.querySelector("#ch-sheet-move-up")?.addEventListener("click", () => {
    if (typeof nudgeSidebarChannel === "function") nudgeSidebarChannel(board.id, -1);
    syncBoardSettingsNudgeButtons(overlay, board.id);
  });
  overlay.querySelector("#ch-sheet-move-down")?.addEventListener("click", () => {
    if (typeof nudgeSidebarChannel === "function") nudgeSidebarChannel(board.id, 1);
    syncBoardSettingsNudgeButtons(overlay, board.id);
  });
  syncBoardSettingsNudgeButtons(overlay, board.id);
  overlay.querySelector("#ch-sheet-reorder")?.addEventListener("click", () => {
    close();
    if (typeof enterSidebarChannelReorderMode === "function") {
      enterSidebarChannelReorderMode("board", board.id);
    }
  });
  overlay.querySelector("#ch-allow-show-in-personal")?.addEventListener("change", (e) => {
    const on = !!e.target.checked;
    board.allowShowInPersonal = on;
    send({ type: "updateBoard", boardId: board.id, allowShowInPersonal: on });
    if (!on && typeof setBoardShownInPersonal === "function") {
      setBoardShownInPersonal(conn.id, board.id, false);
    }
    if (typeof syncShownBoardsToPersonal === "function") syncShownBoardsToPersonal();
    const memberBox = overlay.querySelector("#ch-show-in-personal");
    if (memberBox) {
      if (!on) memberBox.checked = false;
      memberBox.disabled = !on;
    }
    if (typeof renderSidebar === "function") renderSidebar(true);
    const field = overlay.querySelector("#ch-show-in-personal-field");
    if (field) field.hidden = !on;
  });
  overlay.querySelector("#ch-show-in-personal")?.addEventListener("change", (e) => {
    const on = !!e.target.checked;
    const ok = typeof setBoardShownInPersonal === "function"
      && setBoardShownInPersonal(conn.id, board.id, on);
    if (on && !ok) {
      e.target.checked = false;
      toast("Couldn’t add this board to Personal");
      return;
    }
    toast(on ? "Showing in Personal" : "Hidden from Personal");
    if (typeof renderSidebar === "function") renderSidebar(true);
  });
  overlay.querySelector("#ch-hide-from-personal")?.addEventListener("click", () => {
    if (typeof setBoardShownInPersonal === "function") {
      setBoardShownInPersonal(board.sourceConnId, board.sourceBoardId, false);
    }
    close();
    if (typeof renderSidebar === "function") renderSidebar(true);
  });
  overlay.querySelector("#ch-wipe-board")?.addEventListener("click", async () => {
    const label = board.name ? `‘${board.name}’` : "this board";
    const n = boardWipeCounts(board, conn);
    if (!n.messages && !n.events) {
      if (typeof toast === "function") toast("Nothing to wipe");
      return;
    }
    const what = [n.messages ? `${n.messages} message${n.messages === 1 ? "" : "s"}` : "", n.events ? `${n.events} event${n.events === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
    if (await ashConfirm(`Wipe ${label}? ${what} will be deleted for everyone. The board and its members stay. This can't be undone.`, { danger: true, ok: "Wipe" })) {
      boardWipeContent(board, conn);
      close();
    }
  });
  overlay.querySelector("#ch-delete-board")?.addEventListener("click", async () => {
    const label = board.name ? `‘${board.name}’` : "this board";
    if (await ashConfirm(`Delete ${label}? Events and chat in this board will be removed. This can't be undone.`, { danger: true })) {
      send({ type: "deleteBoard", boardId: board.id });
      close();
    }
  });
}

/* ── Wipe board: delete all its content, keep the board ─────────────────
   Every chat message and event in the board's channels, deleted one by one
   with the same messages moderation uses (there is no bulk server call). */

function boardWipeChannels(board, conn) {
  return (conn?.channels || []).filter((c) => c && String(c.boardId || "") === String(board?.id || ""));
}

function boardWipeCounts(board, conn) {
  const ids = new Set(boardWipeChannels(board, conn).map((c) => String(c.id)));
  let messages = 0;
  ids.forEach((id) => { messages += (conn?.messages?.[id] || []).filter((m) => m && !m.activity).length; });
  const events = (conn?.events || []).filter((ev) => ev && ids.has(String(ev.channelId || ""))).length;
  return { messages, events };
}

function boardWipeContent(board, conn) {
  if (!board || !conn || typeof send !== "function") return;
  const ids = new Set(boardWipeChannels(board, conn).map((c) => String(c.id)));
  let failed = 0;
  ids.forEach((channelId) => {
    for (const m of (conn.messages?.[channelId] || []).slice()) {
      if (!m || m.activity || !m.id) continue;
      if (send({ type: "deleteMessage", channelId, messageId: m.id }, conn.id) === "failed") failed++;
    }
    if (conn.messages?.[channelId]) conn.messages[channelId] = conn.messages[channelId].filter((m) => m && m.activity && !m.eventId);
  });
  const events = (conn.events || []).filter((ev) => ev && ids.has(String(ev.channelId || "")));
  for (const ev of events) {
    if (send({ type: "deleteEvent", eventId: ev.id }, conn.id) === "failed") failed++;
  }
  const gone = new Set(events.map((ev) => ev.id));
  conn.events = (conn.events || []).filter((ev) => !gone.has(ev.id));
  if (typeof toast === "function") toast(failed ? "Board wiped (some items couldn’t be deleted)" : "Board wiped");
  if (typeof renderView === "function") renderView(true);
}
