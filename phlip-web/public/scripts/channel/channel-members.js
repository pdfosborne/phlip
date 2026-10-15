/* channel-members.js — members view + host set-member-name.
 * Globals out: renderMembersView, openHostSetMemberName
 * Load after: channel-console.js; before: channel-history.js
 */

function closePeopleMoreMenus(exceptMenu = null) {
  document.querySelectorAll(".people-more").forEach((wrap) => {
    const menu = wrap.querySelector(".people-more-menu");
    const btn = wrap.querySelector(".people-more-btn");
    if (!menu || menu === exceptMenu) return;
    menu.hidden = true;
    if (btn) btn.setAttribute("aria-expanded", "false");
  });
}

function peopleMoreMenuItem({ icon, label, hint = "", danger = false, onClick }) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "people-more-item" + (danger ? " danger" : "");
  item.innerHTML = `${typeof ic === "function" ? ic(icon) : ""}<span class="people-more-copy"><span>${esc(label)}</span>${hint ? `<small class="people-more-hint">${esc(hint)}</small>` : ""}</span>`;
  item.onclick = (e) => {
    e.stopPropagation();
    closePeopleMoreMenus();
    onClick?.();
  };
  return item;
}

/* ── Roles on a person: one list ──────────────────────────────────────────
   Admin / Moderator / Member / Viewer are tiers (a person has exactly one;
   picking another swaps it). Custom roles add on top. The server's default
   tier (Member, or Viewer if new people join as viewers) isn't a chip. */
function peopleDefaultTier(conn = activeConn()) {
  const d = typeof serverSettings === "function" ? serverSettings(conn).defaultRole : ROLE_USER;
  return d === ROLE_VIEWER ? ROLE_VIEWER : ROLE_USER;
}

function peopleRoleChipHTML(key, label, conn, removable) {
  const color = typeof roleDisplayColor === "function" ? roleDisplayColor(key, conn) : "#4A5262";
  const x = removable
    ? `<button type="button" class="people-role-chip-x" data-role-remove="${esc(key)}" aria-label="Remove ${esc(label)}">${typeof ic === "function" ? ic("x") : "×"}</button>`
    : "";
  return `<span class="people-role-pill${removable ? " is-removable" : ""}" style="--role-color:${esc(color)}">${esc(label)}${x}</span>`;
}

function peopleSetTier(u, tier, view) {
  send({ type: "setMemberRole", userId: u.id, role: tier });
  u.role = tier;
  toast(`${u.name || "They"} ${tier === peopleDefaultTier() ? "is back to" : "is now"} ${roleLabel(tier)}`);
  renderMembersView(view);
}

function peopleSetTags(u, next, view) {
  send({ type: "setMemberRoleTags", userId: u.id, roleTagIds: next });
  u.roleTagIds = next.length ? next : undefined;
  renderMembersView(view);
}

function mountPeopleRoleChips(roleEl, { u, view, blockedSuffix }) {
  const conn = activeConn();
  const isMe = u.id === conn?.me?.id;
  const tier = effectiveRole(u);
  const def = peopleDefaultTier(conn);
  const tiers = !isMe ? assignableRolesFor(u) : [];
  const canTag = !isMe && canAssignMemberRoleTags(u);
  const custom = customRolesOf(conn);
  const mine = new Set(Array.isArray(u.roleTagIds) ? u.roleTagIds : []);
  const chips = [];
  if (tier !== def) {
    chips.push(peopleRoleChipHTML(tier, roleLabel(tier), conn, tiers.includes(def) && tier !== ROLE_HOST));
  }
  for (const r of custom) {
    if (mine.has(r.id)) chips.push(peopleRoleChipHTML(r.id, r.name || "Role", conn, canTag));
  }
  const editable = tiers.length > 0 || (canTag && custom.length > 0);
  roleEl.classList.add("people-role-chips");
  roleEl.innerHTML = (chips.length ? chips.join("") : `<span class="people-role-plain">${esc(roleLabel(tier))}</span>`)
    + (blockedSuffix ? `<span class="people-role-extra">${esc(blockedSuffix)}</span>` : "");
  roleEl.querySelectorAll("[data-role-remove]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const key = btn.dataset.roleRemove;
      if (key === tier) peopleSetTier(u, def, view);
      else peopleSetTags(u, [...mine].filter((id) => id !== key), view);
    };
  });
  if (!editable) return;
  const wrap = document.createElement("div");
  wrap.className = "people-more people-role-add";
  const add = document.createElement("button");
  add.type = "button";
  add.className = "people-role-add-btn";
  add.setAttribute("aria-haspopup", "menu");
  add.setAttribute("aria-expanded", "false");
  add.setAttribute("aria-label", `Roles for ${u.name || "member"}`);
  add.innerHTML = `${typeof ic === "function" ? ic("plus") : "+"}<span>Role</span>`;
  const menu = document.createElement("div");
  menu.className = "people-more-menu people-role-menu";
  menu.hidden = true;
  menu.setAttribute("role", "menu");
  const item = (key, label, on, onPick) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "people-more-item people-role-item" + (on ? " is-on" : "");
    b.setAttribute("role", "menuitemcheckbox");
    b.setAttribute("aria-checked", on ? "true" : "false");
    const color = typeof roleDisplayColor === "function" ? roleDisplayColor(key, conn) : "#4A5262";
    b.innerHTML = `<span class="people-role-dot" style="--role-color:${esc(color)}"></span><span class="people-more-copy"><span>${esc(label)}</span></span>${on && typeof ic === "function" ? ic("check") : ""}`;
    b.onclick = (e) => { e.stopPropagation(); closePeopleMoreMenus(); onPick(); };
    menu.appendChild(b);
  };
  tiers.forEach((t) => item(t, roleLabel(t), t === tier, () => { if (t !== tier) peopleSetTier(u, t, view); }));
  if (tiers.length && canTag && custom.length) {
    const sep = document.createElement("div");
    sep.className = "people-role-sep";
    menu.appendChild(sep);
  }
  if (canTag) {
    custom.forEach((r) => item(r.id, r.name || "Role", mine.has(r.id), () => {
      const next = mine.has(r.id) ? [...mine].filter((id) => id !== r.id) : [...mine, r.id];
      peopleSetTags(u, next, view);
    }));
  }
  add.onclick = (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    closePeopleMoreMenus();
    if (open) {
      menu.hidden = false;
      add.setAttribute("aria-expanded", "true");
    }
  };
  wrap.appendChild(add);
  wrap.appendChild(menu);
  roleEl.appendChild(wrap);
}

/** Overflow ⋮ control: set name / history / block / report / remove. */
function mountPeopleMoreMenu(social, { u, view, canKick, canSetName }) {
  const wrap = document.createElement("div");
  wrap.className = "people-more";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "people-icon-btn people-more-btn";
  btn.title = "More actions";
  btn.setAttribute("aria-label", `More actions for ${u.name || "member"}`);
  btn.setAttribute("aria-haspopup", "menu");
  btn.setAttribute("aria-expanded", "false");
  btn.innerHTML = ic("more");
  const menu = document.createElement("div");
  menu.className = "people-more-menu";
  menu.hidden = true;
  menu.setAttribute("role", "menu");

  btn.onclick = (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    closePeopleMoreMenus();
    if (open) {
      menu.hidden = false;
      btn.setAttribute("aria-expanded", "true");
    }
  };

  if (canSetName) {
    menu.appendChild(peopleMoreMenuItem({
      icon: "pencil",
      label: "Set name",
      onClick: () => openHostSetMemberName(u, view),
    }));
  }

  menu.appendChild(peopleMoreMenuItem({
    icon: "history",
    label: "Shared history",
    onClick: () => {
      Nav.set({ kind: "sharedHistory", userId: u.id });
      renderSidebar();
      renderView();
    },
  }));

  if (canReport()) {
    const blocked = isBlocked(u.id);
    menu.appendChild(peopleMoreMenuItem({
      icon: "ban",
      label: blocked ? "Unblock" : "Block",
      hint: blocked ? "" : "Hides their chat and notes. They stay on the server — use Report if you need the host to act.",
      onClick: () => {
        const name = u.name || "this member";
        if (!blocked) {
          if (setMemberBlocked(u.id, true)) {
            if (typeof ashUndoSnackbar === "function") {
              ashUndoSnackbar({
                message: `Blocked ${name} · Undo`,
                hide: () => true,
                restore: () => setMemberBlocked(u.id, false),
                commit: null,
                refresh: () => renderMembersView(view),
              });
            } else {
              toast(`Blocked ${name}`);
              renderMembersView(view);
            }
          }
        } else if (setMemberBlocked(u.id, false)) {
          toast(`Unblocked ${name}`);
          renderMembersView(view);
        }
      },
    }));
  }

  if (canReport() && !u.isHost) {
    menu.appendChild(peopleMoreMenuItem({
      icon: "flag",
      label: "Report",
      onClick: () => openReportModal({
        targetType: "user", targetId: u.id, targetLabel: u.name || "member",
      }),
    }));
  }

  if (canKick) {
    menu.appendChild(peopleMoreMenuItem({
      icon: "userX",
      label: "Remove member",
      danger: true,
      onClick: async () => {
        const name = u.name || "this member";
        if (!(await ashConfirm(
          `Remove ${name} from this server?\n\n` +
          "Their chat, sign-ups, reactions, and notes are deleted on this host. Events they created keep an empty organiser. Already-delivered copies on devices are not recalled.",
          { danger: true }
        ))) return;
        const typed = prompt(`Type REMOVE to confirm removing ${name}:`);
        if (String(typed || "").trim().toUpperCase() !== "REMOVE") {
          toast("Cancelled");
          return;
        }
        send({ type: "removeMember", userId: u.id });
        toast(`Removed ${name}`);
      },
    }));
  }

  wrap.appendChild(btn);
  wrap.appendChild(menu);
  social.appendChild(wrap);
}

function renderMembersView(view, opts = {}) {
  if (opts.panel) view.dataset.panelMode = "1";
  const panel = view.dataset.panelMode === "1" || !!opts.panel;
  view.style.cssText = "display:flex;flex-direction:column;flex:1;min-height:0";
  const online = new Set(S.online || []);
  const meId = S.me?.id;
  const members = [...(S.members || [])].sort((a, b) => {
    const ra = effectiveRole(a), rb = effectiveRole(b);
    const order = { host: 0, admin: 1, moderator: 2, user: 3, viewer: 4 };
    if ((order[ra] ?? 9) !== (order[rb] ?? 9)) return (order[ra] ?? 9) - (order[rb] ?? 9);
    return (a.name || "").localeCompare(b.name || "");
  });

  // Channel context: who's in the active event/chat channel.
  let channelPeople = null;
  if (S.activeEventChannelId || S.activeView?.priorChannelId) {
    /* optional — keep server-wide list as primary */
  }
  const ch = S.activeView?.channelFilterId
    ? (board().channels || []).find(c => c.id === S.activeView.channelFilterId)
    : null;
  if (ch?.allowedUserIds) {
    channelPeople = new Set(ch.allowedUserIds);
  }

  view.innerHTML = `
    <div class="events-scroll no-tray"><div class="events-wrap">
      ${panel ? "" : `<div class="board-head"><h4>People</h4>
        <p class="empty-note" style="margin:4px 0 0">Roles control who can manage the server, edit events, or only view.</p>
      </div>`}
      <div class="people-name-activity" id="people-name-activity" hidden></div>
      <div class="people-list" id="people-pending" hidden></div>
      <div class="people-list" id="people-list"></div>
    </div></div>`;

  const activityBox = view.querySelector("#people-name-activity");
  const activity = [...(activeConn()?.serverActivity || [])]
    .filter(e => e && e.kind === "nameChange")
    .slice(-10)
    .reverse();
  if (activityBox && activity.length) {
    activityBox.hidden = false;
    activityBox.innerHTML = `
      <div class="people-section-label">Recent name changes</div>
      <ul class="people-name-activity-list">
        ${activity.map(e => {
          const who = e.hostSet
            ? `${esc(e.actorName || "Host")} set ${esc(e.targetName || "someone")}’s name`
            : `${esc(e.targetName || e.actorName || "Someone")} renamed`;
          const detail = e.from && e.to && e.from !== e.to
            ? ` · ${esc(e.from)} → ${esc(e.to)}`
            : (e.to ? ` · ${esc(e.to)}` : "");
          return `<li>${who}${detail}</li>`;
        }).join("")}
      </ul>`;
  }

  // Moderators use the Moderate meta channel for reports — not buried in People.
  const pendingBox = view.querySelector("#people-pending");
  if (canManageServer() && pendingBox) {
    const pending = [...(activeConn()?.pendingReqs || [])];
    if (pending.length) {
      pendingBox.hidden = false;
      const head = document.createElement("div");
      head.className = "people-section-label";
      head.textContent = pending.length === 1 ? "Waiting to join" : `${pending.length} waiting to join`;
      pendingBox.appendChild(head);
      for (const req of pending) {
        if (!req?.id) continue;
        const row = document.createElement("div");
        row.className = "people-row people-pending-row";
        row.innerHTML = `
          <div class="people-row-head">
            <div class="people-main">
              <span class="people-avatar" style="${avatarStyle(req.id)}">${avatarFaceHtml(req.id, req.name || "?")}</span>
              <div class="people-meta">
                <div class="people-name">${esc(req.name || "Someone")}</div>
                <div class="people-role">${req.invitedByName
                  ? `Requested via ${esc(req.invitedByName)}'s link`
                  : "Join request"}</div>
              </div>
            </div>
            <div class="people-actions people-actions-social"></div>
          </div>`;
        const actions = row.querySelector(".people-actions-social");
        const approve = document.createElement("button");
        approve.type = "button";
        approve.className = "people-btn";
        approve.textContent = "Approve";
        approve.onclick = () => {
          send({ type: "approveJoin", requestId: req.id });
          toast(`Approved ${req.name || "them"}`);
          const conn = activeConn();
          if (conn) conn.pendingReqs = (conn.pendingReqs || []).filter(r => r.id !== req.id);
          renderSidebar();
          renderMembersView(view);
        };
        const deny = document.createElement("button");
        deny.type = "button";
        deny.className = "people-btn danger";
        deny.textContent = "Deny";
        deny.onclick = () => {
          send({ type: "denyJoin", requestId: req.id });
          toast(`Denied ${req.name || "them"}`);
          const conn = activeConn();
          if (conn) conn.pendingReqs = (conn.pendingReqs || []).filter(r => r.id !== req.id);
          renderSidebar();
          renderMembersView(view);
        };
        actions.appendChild(approve);
        actions.appendChild(deny);
        pendingBox.appendChild(row);
      }
    }
  }

  const list = view.querySelector("#people-list");
  for (const u of members) {
    if (channelPeople && !channelPeople.has(u.id) && !u.isHost) continue;
    const role = effectiveRole(u);
    const isMe = u.id === meId;
    const on = online.has(u.id);
    const row = document.createElement("div");
    row.className = "people-row";
    const hostSetBadge = u.nameHostSet
      ? ` <span class="people-host-set-badge" title="Name set by the host">Host-set</span>`
      : "";
    const demoBadge = u.isDemo
      ? ` <span class="people-demo-badge" title="Synthetic demo member">Demo</span>`
      : "";
    row.innerHTML = `
      <div class="people-row-head">
        <div class="people-main">
          <span class="people-avatar" style="${avatarStyle(u.id)}" title="${on ? "Online" : "Offline"}">${avatarFaceHtml(u.id, u.name)}<span class="presence-dot ${on ? "on" : ""}" aria-hidden="true"></span></span>
          <div class="people-meta">
            <div class="people-name">${esc(u.name)}${hostSetBadge}${demoBadge}
            </div>
            <div class="people-role"></div>
          </div>
        </div>
        <div class="people-actions people-actions-social"></div>
      </div>
      <div class="people-actions people-actions-admin" hidden></div>`;
    const social = row.querySelector(".people-actions-social");
    const admin = row.querySelector(".people-actions-admin");
    const roleEl = row.querySelector(".people-role");
    const blockedSuffix = !isMe && isBlocked(u.id) ? " · Blocked" : "";

    // One list of roles per person: chips for each role they have (the
    // server's default role isn't a chip), and "+ Role" to add or swap.
    mountPeopleRoleChips(roleEl, { u, view, row, blockedSuffix });

    if (isMe) {
      const picBtn = document.createElement("button");
      picBtn.type = "button";
      picBtn.className = "people-btn";
      picBtn.textContent = "Edit profile";
      picBtn.onclick = () => openUserSettingsModal();
      social.appendChild(picBtn);
    }

    if (!isMe) {

      const canKick = canManageMember(u);
      const canSetName = canManageServer() && canManageMember(u);
      mountPeopleMoreMenu(social, { u, view, canKick, canSetName });
    }

    if (!isMe && (canManageMember(u) || canAssignMemberRoleTags(u)) && typeof roleAccessSummary === "function") {
      const sum = document.createElement("p");
      sum.className = "people-access-summary";
      sum.textContent = roleAccessSummary(u);
      admin.appendChild(sum);
    }

    if (admin && admin.childNodes.length) admin.hidden = false;

    list.appendChild(row);
  }

  if (!view.dataset.peopleMoreBound) {
    view.dataset.peopleMoreBound = "1";
    view.addEventListener("click", () => closePeopleMoreMenus());
  }

  const scroll = view.querySelector(".events-scroll");
  if (scroll && !panel) attachModeSwipe(scroll, { openNavOnRight: true, navOnly: true });
}


const HOST_NAME_OVERRIDE_ACK_KEY = "ash_host_name_override_ack_v1";

/** 016 Slice 2 — host/admin sets a member's display name on this server. */
async function openHostSetMemberName(member, view) {
  const conn = activeConn();
  if (!conn || PersonalSpace.isPersonal(conn) || !member?.id) return;
  if (!canManageServer(conn) || !canManageMember(member, conn)) {
    toast("Only the host or an admin can set member names.");
    return;
  }
  let acknowledged = false;
  try { acknowledged = localStorage.getItem(HOST_NAME_OVERRIDE_ACK_KEY) === "1"; } catch {}
  if (!acknowledged) {
    if (!(await ashConfirm(
      "You’re setting how this person appears on your server. That name only applies here — it doesn’t follow them to other servers. Everyone can see name changes in People.",
    ))) return;
    try { localStorage.setItem(HOST_NAME_OVERRIDE_ACK_KEY, "1"); } catch {}
  }
  const typed = prompt(`Name for ${member.name || "this member"} on this server:`, member.name || "");
  const name = String(typed || "").trim().slice(0, 24);
  if (!name) return;
  if (!S.memberDisplayNameWaiters) S.memberDisplayNameWaiters = {};
  const res = await new Promise((resolve) => {
    const t = setTimeout(() => {
      delete S.memberDisplayNameWaiters[conn.id];
      resolve({ type: "error", error: "Timed out" });
    }, 8000);
    S.memberDisplayNameWaiters[conn.id] = (msg) => {
      clearTimeout(t);
      resolve(msg);
    };
    send({ type: "setMemberDisplayName", userId: member.id, name }, conn.id);
  });
  if (res?.type === "memberDisplayNameSet" || res?.ok) {
    toast(`Set name to “${name}”`);
    if (view) renderMembersView(view);
    return;
  }
  if (res?.code === "nameTaken") {
    toast("Someone here already uses that name.");
    return;
  }
  toast(res?.error || "Couldn't set that name.");
}


