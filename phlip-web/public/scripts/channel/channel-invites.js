/* channel-invites.js — group invite create/manage/share.
 * Globals out: autoIncludeChannelList, openCreateGroupInviteModal, createGroupInviteRPC,
 *   groupInviteDeepLink, shareGroupInvite, openManageGroupInvitesModal
 * Load after: channel-linked-feeds.js
 */
function autoIncludeChannelList(conn = activeConn()) {
  const fromSnap = Array.isArray(conn?.autoIncludeChannels) ? conn.autoIncludeChannels : null;
  if (fromSnap?.length) return fromSnap;
  return (conn?.channels || board().channels || []).filter(c =>
    c.autoIncludeNewMembers && Array.isArray(c.allowedUserIds)
  ).map(c => ({ id: c.id, name: c.name, kind: c.kind }));
}

/**
 * §10: mint a 24h / 1-use invite. Shows auto-include groups before generating.
 * @param {{ channelIds?: string[] }} opts
 */
function openCreateGroupInviteModal(opts = {}) {
  const conn = activeConn();
  if (!conn) return;
  const invite = PersonalSpace.inviteButtonState(conn);
  if (invite.disabled) {
    toast(invite.reason);
    return;
  }
  if (!canInviteToGroup(conn)) {
    toast("You don't have permission to invite");
    return;
  }
  const preselect = new Set(opts.channelIds || []);
  const privateChans = (conn.channels || []).filter(c => Array.isArray(c.allowedUserIds));
  const autoInclude = autoIncludeChannelList(conn);
  const opened = AshModal.open({
    className: "create-invite-modal",
    html: `
    <div class="modal-card">
      <h4>Create invite link</h4>
      <p class="cat-hint">One use · expires in 24 hours. New people get an account; people already here just join the groups you pick.</p>
      <div class="field">
        <label>Add them to</label>
        <div class="member-grid" id="create-invite-channels">
          ${privateChans.length ? privateChans.map(c =>
            `<label class="member-chip"><input type="checkbox" value="${c.id}" ${preselect.has(c.id) ? "checked" : ""}> ${esc(c.name)}</label>`
          ).join("") : `<p class="cat-hint">No private groups yet — they'll still join the server.</p>`}
        </div>
      </div>
      ${autoInclude.length ? `
        <p class="cat-hint" style="margin-top:8px">
          Standing rule — also auto-adds these roles to:
          <strong>${autoInclude.map(c => esc(c.name)).join(", ")}</strong>
        </p>` : `<p class="cat-hint" style="margin-top:8px">No standing auto-include groups right now.</p>`}
      <div class="actions">
        <button type="button" class="cancel" id="create-invite-cancel">Cancel</button>
        <button type="button" class="save" id="create-invite-go">Generate link</button>
      </div>
    </div>`,
    singleton: "return",
  });
  if (!opened) return;
  const { overlay, close } = opened;
  overlay.querySelector("#create-invite-cancel").onclick = close;
  overlay.querySelector("#create-invite-go").onclick = async () => {
    const channelIds = [...overlay.querySelectorAll("#create-invite-channels input:checked")].map(el => el.value);
    const btn = overlay.querySelector("#create-invite-go");
    btn.disabled = true;
    try {
      const created = await createGroupInviteRPC(conn, { channelIds });
      close();
      await shareGroupInvite(conn, created);
    } catch (e) {
      btn.disabled = false;
      toast(e?.message || "Couldn't create invite");
    }
  };
}

function createGroupInviteRPC(conn, payload) {
  return new Promise((resolve, reject) => {
    S.groupInviteWaiters = S.groupInviteWaiters || {};
    const wkey = conn.id || "local";
    const timer = setTimeout(() => {
      delete S.groupInviteWaiters[wkey];
      reject(new Error("Timed out creating invite"));
    }, 8000);
    S.groupInviteWaiters[wkey] = (m) => {
      clearTimeout(timer);
      if (m?.type === "error") reject(new Error(m.error || "Couldn't create invite"));
      else resolve(m);
    };
    send({ type: "createInvite", channelIds: payload.channelIds || [], maxUses: 1 }, conn.id);
  });
}

function groupInviteDeepLink(conn, code) {
  const base = String(serverInviteBaseLink(conn) || "").replace(/\/+$/, "");
  if (!base || !code) return "";
  const name = String(conn?.name || conn?.hostName || "").trim();
  const parts = ["join"];
  if (name) parts.push(`s=${encodeURIComponent(name)}`);
  // Don't embed rotating c= when a personal invite URL is available.
  const personal = typeof personalInviteUrl === "function" ? personalInviteUrl(conn) : "";
  if (!personal) {
    const rot = serverShareInviteOnly(conn);
    if (rot) parts.push(`c=${encodeURIComponent(rot)}`);
  }
  parts.push(`t=${encodeURIComponent(code)}`);
  return `${base}/#${parts.join("&")}`;
}

async function shareGroupInvite(conn, created) {
  const code = created?.code;
  if (!code) { toast("No invite code returned"); return; }
  const link = groupInviteDeepLink(conn, code);
  const name = conn?.name || conn?.hostName || "server";
  const lines = [`Join my Phlip server "${name}"`];
  if (link) lines.push("", link);
  lines.push("", "This link works once and expires in 24 hours.");
  const chNames = (created.channelIds || [])
    .map(id => (conn.channels || []).find(c => c.id === id)?.name)
    .filter(Boolean);
  if (chNames.length) lines.push(`Groups: ${chNames.join(", ")}`);
  await sharePlainText(lines.join("\n"), {
    copiedToast: "Invite link copied",
    fallbackToast: link || code,
  });
}

function openManageGroupInvitesModal(conn = activeConn()) {
  if (!conn || !canInviteToGroup(conn)) return;
  const invites = (conn.groupInvites || []).filter(i => i.active || (!i.revoked && i.expiresAt > Date.now()));
  const rows = invites.length ? invites.map(inv => {
    const left = Math.max(0, inv.maxUses - inv.uses);
    const mins = Math.max(0, Math.round((inv.expiresAt - Date.now()) / 60_000));
    const ch = (inv.channelIds || [])
      .map(id => (conn.channels || []).find(c => c.id === id)?.name || id)
      .join(", ") || "Server only";
    return `<div class="server-settings-row" data-invite-id="${esc(inv.id)}">
      <span>${esc(ch)} · ${left} use${left === 1 ? "" : "s"} · ${mins}m left</span>
      <button type="button" class="danger invite-revoke-btn">Revoke</button>
    </div>`;
  }).join("") : `<p class="cat-hint">No active invite links.</p>`;
  const opened = AshModal.open({
    className: "manage-invites-modal",
    html: `
    <div class="modal-card">
      <h4>Invite links</h4>
      <p class="cat-hint">One-use links you or other inviters created. Revoking stops new redemptions.</p>
      <div id="manage-invites-list">${rows}</div>
      <div class="actions">
        <button type="button" class="cancel" id="manage-invites-close">Close</button>
        <button type="button" class="save" id="manage-invites-new">New link</button>
      </div>
    </div>`,
    singleton: "return",
  });
  if (!opened) return;
  const { overlay, close } = opened;
  overlay.querySelector("#manage-invites-close").onclick = close;
  overlay.querySelector("#manage-invites-new").onclick = () => { close(); openCreateGroupInviteModal(); };
  overlay.querySelectorAll(".invite-revoke-btn").forEach(btn => {
    btn.onclick = () => {
      const row = btn.closest("[data-invite-id]");
      const id = row?.getAttribute("data-invite-id");
      if (!id) return;
      send({ type: "revokeInvite", inviteId: id }, conn.id);
      row.remove();
      toast("Invite revoked");
    };
  });
}

