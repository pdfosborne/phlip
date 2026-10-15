/* render-join-leave.js — leave / disconnect / remove server membership.
 * Load after: render-add-server.js; before: render-join.js facade
 */

async function confirmRemoveServer(connId) {
  const conn = S.conns[connId];
  if (!conn || PersonalSpace.isPersonal(conn)) return;
  if (typeof isDemoMode === "function" && isDemoMode()) {
    toast("Use Reset demo to restore the original fixture.");
    return;
  }
  const label = conn.name || conn.hostName || "this server";
  if (conn.me?.isHost || effectiveRole(conn.me) === ROLE_HOST) {
    toast("You’re the host — stop hosting on the phone instead of removing this server.");
    return;
  }
  const choice = await askLeaveServerChoice(label);
  if (!choice) return;
  await leaveRemoteServerMembership(conn, { deleteData: choice === "delete" });
  disconnectConn(conn);
  delete S.conns[connId];
  removeServerEntry(connId);
  if (S.activeConnId === connId) {
    const fallback = railConnIds().find(id => id !== connId) || (isServedOrigin() ? null : "personal");
    if (fallback) switchConn(fallback);
    else if (isServedOrigin()) openServedJoinGate({ name: loadBrowserMemberName() });
    else renderRail();
  } else renderRail();
  if (choice === "delete") toast("Left — your chat, sign-ups, and reactions were deleted on the host");
  else toast("Left this server");
}

/** Drop a live connection without scheduling reconnect (leave / remove). */
function disconnectConn(conn) {
  if (!conn || PersonalSpace.isPersonal(conn) || conn.demo) return;
  if (conn._reconnectTimer) {
    clearTimeout(conn._reconnectTimer);
    conn._reconnectTimer = null;
  }
  stopHeartbeat(conn);
  stopHttpTransport(conn);
  const ws = conn.ws;
  if (ws) {
    try {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.close();
    } catch {}
    conn.ws = null;
  }
  conn.token = null;
  conn.pass = null;
  conn.key = null;
  conn.joinIntent = null;
  conn.me = null;
  conn.status = "offline";
}

/**
 * Host removed this member (or membership record is gone). Drop the server from
 * the rail and leave a note on Personal → Notifications.
 */
function applyRemovedFromServer(conn, reason) {
  if (!conn || PersonalSpace.isPersonal(conn) || conn._removedHandled) return;
  conn._removedHandled = true;
  const connId = conn.id;
  const label = (conn.name || conn.hostName || "a server").trim() || "a server";
  const msg = String(reason || "Removed from this server").trim() || "Removed from this server";
  const lastName = conn.me?.name || conn._lastName || "";
  // Self-leave also ends with a kicked frame — don't frame that as a removal.
  const hostRemoved = !/^left this server$/i.test(msg);

  const personal = S.conns.personal;
  const served = isServedOrigin();
  if (personal && !served && hostRemoved) {
    personal.notifications = personal.notifications || [];
    personal.notifications.unshift({
      id: genLocalId(),
      kind: "removedFromServer",
      serverName: label,
      text: msg,
      ts: Date.now(),
      read: false,
    });
    if (personal.notifications.length > 80) personal.notifications.length = 80;
    try { savePersonal(); } catch {}
  }

  const wasActive = S.activeConnId === connId;
  disconnectConn(conn);
  delete S.conns[connId];
  removeServerEntry(connId);
  if (typeof syncShownBoardsToPersonal === "function") syncShownBoardsToPersonal();
  if (hostRemoved) toast(msg);

  if (served) {
    if (typeof promptServedRejoin === "function") {
      promptServedRejoin({ _lastName: lastName }, hostRemoved ? msg : undefined);
    }
    renderRail();
    return;
  }

  if (wasActive) {
    S.activeConnId = "personal";
    Nav.set(hostRemoved ? { kind: "notifications" } : (typeof defaultAgendaView === "function" ? defaultAgendaView() : { kind: "events" }));
    renderAll();
  } else {
    renderRail();
    renderSidebar();
    if (hostRemoved && S.activeConnId === "personal" && S.activeView?.kind === "notifications") renderView();
  }
}

/**
 * Leave confirms data cleanup on the host (chat, RSVPs, reactions, notes).
 * Events they created stay with an empty organiser. Returns "delete" | null.
 */
function askLeaveServerChoice(label) {
  return new Promise((resolve) => {
    const opened = AshModal.open({
      className: "leave-server-modal",
      html: `
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="leave-server-title">
        <h4 id="leave-server-title">Leave ${esc(label)}?</h4>
        <p class="leave-server-lead">You’ll be removed from People and need to join again to come back.</p>
        <p class="empty-note" style="margin:0 0 12px">Your chat, sign-ups, reactions, and notes are removed from this host. Events you created stay with an empty organiser. People who already saw content may still have a copy on their device.</p>
        <div class="actions">
          <button type="button" class="cancel" id="leave-cancel">Cancel</button>
          <button type="button" class="save danger" id="leave-delete">Leave &amp; delete my data</button>
        </div>
      </div>`,
      singleton: "return",
      closeOnBackdrop: false,
    });
    if (!opened) {
      resolve(null);
      return;
    }
    const { overlay, close } = opened;
    const done = (v) => { close(); resolve(v); };
    overlay.querySelector("#leave-cancel").onclick = () => done(null);
    overlay.querySelector("#leave-delete").onclick = () => done("delete");
    overlay.addEventListener("click", (e) => { if (e.target === overlay) done(null); });
  });
}

/** Tell the host to drop this member from People while the session is still valid. */
async function leaveRemoteServerMembership(conn, opts = {}) {
  if (!conn || PersonalSpace.isPersonal(conn) || conn.demo) return;
  if (typeof isDemoMode === "function" && isDemoMode()) return;
  const token = conn.token;
  const base = httpBaseFromConn(conn);
  const deleteData = !!opts.deleteData;
  const payload = { type: "leaveServer", deleteData };
  try {
    if (token && base) {
      await serverFetch(`${base}/ash-rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({ ...payload, token }),
        keepalive: true,
      });
    } else if (conn.status === "online") {
      send(payload, conn.id);
      await new Promise((r) => setTimeout(r, 200));
    }
  } catch {}
}

async function confirmLeaveServedServer() {
  if (!isServedOrigin()) return;
  const conn = activeConn();
  if (!conn || PersonalSpace.isPersonal(conn)) return;
  const label = conn.name || conn.hostName || "this server";
  if (conn.me?.isHost || effectiveRole(conn.me) === ROLE_HOST) {
    toast("You’re the host — stop hosting on the phone instead of leaving.");
    return;
  }
  const choice = await askLeaveServerChoice(label);
  if (!choice) return;
  await leaveServedServer(conn, { deleteData: choice === "delete" });
  if (choice === "delete") toast("Left — your data was deleted on the host");
}

async function leaveServedServer(conn, opts = {}) {
  if (!conn || PersonalSpace.isPersonal(conn)) return;
  const name = conn.me?.name || conn._lastName || loadBrowserMemberName() || "";
  if (name) saveBrowserMemberName(name);
  // Left membership — next join must re-agree.
  try { saveBrowserRulesAccepted(false); } catch {}
  const id = conn.id;
  await leaveRemoteServerMembership(conn, opts);
  disconnectConn(conn);
  delete S.conns[id];
  removeServerEntry(id);
  if (typeof syncShownBoardsToPersonal === "function") syncShownBoardsToPersonal();
  try { closeNav(); } catch {}
  S.activeConnId = "personal";
  Nav.set({ kind: "events" });
  openServedJoinGate({ name: loadBrowserMemberName() });
  renderRail();
}
