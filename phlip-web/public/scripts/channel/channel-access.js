/* channel-access.js — shared channel access-control controller.
 * Globals out: channelAccessPeopleListHTML, mountChannelAccessControls
 * Load after: render.js; before: channel-panel.js / channel-settings.js
 */
function channelAccessPeopleListHTML(ch) {
  const people = typeof channelMemberList === "function" ? channelMemberList(ch) : [];
  const online = new Set(S.online || []);
  const conn = activeConn();
  if (!people.length) {
    return `<div class="channel-panel-people-can-see">
      <p class="empty-note">No one on the server matches this access yet.</p>
    </div>`;
  }
  const order = [ROLE_HOST, ROLE_ADMIN, ROLE_MODERATOR, ROLE_USER, ROLE_VIEWER];
  const groups = new Map(order.map(r => [r, []]));
  for (const u of people) {
    const role = typeof effectiveRole === "function" ? effectiveRole(u) : (u.role || ROLE_USER);
    const key = groups.has(role) ? role : ROLE_USER;
    groups.get(key).push(u);
  }
  const sections = order.map(role => {
    const list = groups.get(role) || [];
    if (!list.length) return "";
    const label = typeof roleLabel === "function" ? roleLabel(role) : role;
    const color = typeof roleDisplayColor === "function" ? roleDisplayColor(role, conn) : "#4A5262";
    const rows = list.map(u => {
      const on = online.has(u.id);
      return `<div class="people-row">
        <div class="people-row-head">
          <div class="people-main">
            <span class="people-avatar" style="${avatarStyle(u.id)}" title="${on ? "Online" : "Offline"}">${avatarFaceHtml(u.id, u.name || "?")}<span class="presence-dot ${on ? "on" : ""}" aria-hidden="true"></span></span>
            <div class="people-meta">
              <div class="people-name">${esc(u.name || "Someone")}</div>
            </div>
          </div>
        </div>
      </div>`;
    }).join("");
    return `<div class="people-role-group">
      <div class="people-role-group-label${[ROLE_HOST, ROLE_ADMIN, ROLE_MODERATOR].includes(role) ? " role-staff-badge" : ""}" style="--role-color:${esc(color)}">${esc(label)}</div>
      <div class="people-list channel-panel-people-can-see-list">${rows}</div>
    </div>`;
  }).filter(Boolean).join("");
  return `<div class="channel-panel-people-can-see">${sections}</div>`;
}

function mountChannelAccessControls(container, {
  existing = null,
  onSaved = () => {},
  readOnly = false,
  showTitle = true,
} = {}) {
  if (!container || !existing) return;
  const personal = PersonalSpace.isPersonal(activeConn());
  if (personal) {
    container.innerHTML = `<p class="empty-note">Just you — stored on this device.</p>`;
    return;
  }
  const linkedAgendas = existing.kind === "chat" && typeof agendasLinkedToChat === "function"
    ? agendasLinkedToChat(existing, activeConn()) : [];
  if (linkedAgendas.length) {
    const summary = typeof chatFollowsAgendasSummaryText === "function"
      ? chatFollowsAgendasSummaryText(existing, activeConn())
      : `Follows linked agendas: ${linkedAgendas.map(a => a.name || "Agenda").join(", ")}`;
    container.innerHTML = `
      <p class="ch-scope-summary" style="margin:0 0 10px">${esc(summary)}</p>
      ${channelAccessPeopleListHTML(existing)}
      ${readOnly || !canManageServer()
        ? `<p class="empty-note">Only the host or an admin can change who can see this.</p>`
        : `<p class="empty-note">Unlink all agendas in channel settings to edit chat access.</p>`}`;
    return;
  }
  if (readOnly || !canManageServer()) {
    const privateCh = Array.isArray(existing.allowedUserIds) && !existing.autoIncludeNewMembers;
    const accessLabel = privateCh
      ? "Private — manual add only"
      : (existing.rolePerms && Object.keys(existing.rolePerms).length
        ? "By role"
        : channelMinRoleTitle(existing.minRole));
    container.innerHTML = `
      <div class="channel-panel-meta">
        <div class="channel-panel-meta-row"><span>${esc(accessLabel || "Everyone")}</span></div>
      </div>
      ${channelAccessPeopleListHTML(existing)}
      <p class="empty-note">Only the host or an admin can change who can see this.</p>`;
    return;
  }

  const meId = activeConn()?.me?.id;
  const staffIds = new Set(
    (S.members || []).filter(m => isAlwaysChannelViewer(m)).map(m => m.id)
  );
  if (meId) staffIds.add(meId);
  const allowedSet = new Set(existing?.allowedUserIds || []);
  for (const id of staffIds) allowedSet.add(id);
  // Legacy auto-include lists act as role-floor (open); only manual lists are private.
  const restrictInitially = Array.isArray(existing?.allowedUserIds) && !existing?.autoIncludeNewMembers;

  const personChipsHTML = (S.members || []).map(m => {
    const isStaffChip = staffIds.has(m.id);
    const on = isStaffChip || allowedSet.has(m.id);
    const role = effectiveRole(m);
    const lockNote = role === ROLE_HOST ? " · host"
      : role === ROLE_ADMIN ? " · admin"
      : role === ROLE_MODERATOR ? " · mod"
      : "";
    return `<label class="ch-person-chip${on ? " is-on" : ""}${isStaffChip ? " is-locked" : ""}"${isStaffChip ? ' title="Host and admins always see every channel"' : ""}>
      <input type="checkbox" value="${esc(m.id)}" ${on ? "checked" : ""} ${isStaffChip ? "disabled" : ""}>
      <span class="ch-person-avatar" style="${avatarStyle(m.id)}">${avatarFaceHtml(m.id, m.name || "?")}</span>
      <span class="ch-person-name">${esc(m.name || "Someone")}${isStaffChip ? lockNote : ""}</span>
    </label>`;
  }).join("");

  const staffInitially = !restrictInitially && !!channelStaffFloor(existing, activeConn());
  container.innerHTML = `
    <div class="field channel-access-field" id="ch-access-field">
      <div class="ch-access-mode" role="group" aria-label="Choose how board access is controlled">
      <label class="ch-access-mode-option">
        <input type="radio" name="board-access-mode" id="ch-by-role" ${restrictInitially || staffInitially ? "" : "checked"}>
        <span>By role</span>
      </label>
      <label class="ch-access-mode-option">
        <input type="radio" name="board-access-mode" id="ch-restrict" ${restrictInitially ? "checked" : ""}>
        <span>Specific people</span>
      </label>
      <label class="ch-access-mode-option">
        <input type="radio" name="board-access-mode" id="ch-staff" ${staffInitially ? "checked" : ""}>
        <span>Staff</span>
      </label>
      </div>
      <div class="field" id="ch-access-role-matrix-field" style="display:${restrictInitially ? "none" : "block"}">
        <div id="ch-access-role-matrix-mount">${rolePermMatrixHtml(existing, activeConn(), { mode: "viewOnly", pills: true })}</div>
      </div>
      <div id="ch-private-block" style="display:${restrictInitially ? "block" : "none"}">
        <div class="ch-person-grid" id="ch-members">${personChipsHTML}</div>
        <div class="ch-inline-confirm" id="ch-people-confirm" hidden>
          <p class="ch-inline-confirm-msg" id="ch-people-confirm-msg">Confirm who can see this?</p>
          <div class="ch-inline-confirm-actions">
            <button type="button" class="cancel" id="ch-people-undo">Undo</button>
            <button type="button" class="save" id="ch-people-apply">Confirm</button>
          </div>
        </div>

      </div>
    </div>
    <h5>People with access</h5>
    <div id="ch-access-people-list">${channelAccessPeopleListHTML(existing)}</div>`;

  const root = container;
  const privateBlock = root.querySelector("#ch-private-block");
  const matrixField = root.querySelector("#ch-access-role-matrix-field");
  const peopleListMount = root.querySelector("#ch-access-people-list");
  const refreshAccessPeopleList = () => {
    if (peopleListMount) peopleListMount.innerHTML = channelAccessPeopleListHTML(existing);
  };

  const syncRoleViewPills = () => {
    if (typeof paintChannelViewPermControls === "function") {
      paintChannelViewPermControls(root);
    } else {
      root.querySelectorAll(".role-view-pill").forEach((pill) => {
        const on = !!pill.querySelector('input[data-flag="view"]')?.checked;
        pill.classList.toggle("is-on", on);
      });
    }
  };

  const syncAccessUI = () => {
    const restrictEl = root.querySelector("#ch-restrict");
    const restricted = !!restrictEl?.checked;
    root.classList.toggle("access-tab-staff", !!root.querySelector("#ch-staff")?.checked);
    root.classList.toggle("access-tab-roles", !!root.querySelector("#ch-by-role")?.checked);
    if (privateBlock) privateBlock.style.display = restricted ? "block" : "none";
    if (matrixField) matrixField.style.display = restricted ? "none" : "block";
  };
  syncAccessUI();
  syncRoleViewPills();

  let committedPeople = new Set([...allowedSet]);
  for (const id of staffIds) committedPeople.add(id);
  const peopleConfirmEl = root.querySelector("#ch-people-confirm");
  const peopleConfirmMsg = root.querySelector("#ch-people-confirm-msg");

  const setsEqual = (a, b) => {
    if (a.size !== b.size) return false;
    for (const id of a) if (!b.has(id)) return false;
    return true;
  };
  const withStaff = (ids) => {
    const out = [...ids];
    for (const id of staffIds) {
      if (id && !out.includes(id)) out.unshift(id);
    }
    return out;
  };
  const selectedPeopleIds = () => {
    const ids = [...root.querySelectorAll("#ch-members input:checked")].map(el => el.value);
    return withStaff(ids);
  };
  const paintPeopleSelection = (ids) => {
    const set = new Set(withStaff(ids));
    root.querySelectorAll("#ch-members input").forEach((inp) => {
      const locked = staffIds.has(inp.value);
      inp.checked = locked || set.has(inp.value);
      const chip = inp.closest(".ch-person-chip");
      chip?.classList.toggle("is-on", inp.checked);
      if (locked) chip?.classList.add("is-locked");
    });
  };
  const peopleDirty = () => {
    if (!root.querySelector("#ch-restrict")?.checked) return false;
    return !setsEqual(new Set(selectedPeopleIds()), committedPeople);
  };
  const hideInlineConfirms = () => {
    if (peopleConfirmEl) peopleConfirmEl.hidden = true;
  };
  const syncPeopleConfirm = () => {
    if (!peopleConfirmEl) return;
    if (!peopleDirty()) {
      peopleConfirmEl.hidden = true;
      return;
    }
    const next = new Set(selectedPeopleIds());
    let added = 0;
    let removed = 0;
    for (const id of next) if (!committedPeople.has(id)) added += 1;
    for (const id of committedPeople) if (!next.has(id)) removed += 1;
    const bits = [];
    if (added) bits.push(`add ${added}`);
    if (removed) bits.push(`remove ${removed}`);
    if (peopleConfirmMsg) {
      peopleConfirmMsg.textContent = bits.length
        ? `Confirm these changes (${bits.join(", ")})?`
        : "Confirm who can see this?";
    }
    peopleConfirmEl.hidden = false;
  };

  const readAccessPayload = ({ useFormPeople = false } = {}) => {
    const restrict = !!root.querySelector("#ch-restrict")?.checked;
    if (restrict) {
      const ids = useFormPeople ? selectedPeopleIds() : [...committedPeople];
      return {
        allowedUserIds: ids.length ? ids : (meId ? [meId] : []),
        autoIncludeNewMembers: false,
        minRole: "viewer",
        privateMode: true,
      };
    }
    return { allowedUserIds: null, autoIncludeNewMembers: false, minRole: "viewer", privateMode: false };
  };

  const persistAccess = ({ useFormPeople = false } = {}) => {
    const access = readAccessPayload({ useFormPeople });
    if (Array.isArray(access.allowedUserIds) && !access.allowedUserIds.length) {
      toast("Add at least yourself to this group");
      return false;
    }
    existing.allowedUserIds = access.allowedUserIds;
    existing.autoIncludeNewMembers = access.autoIncludeNewMembers;
    existing.minRole = null;
    // The board owns visibility; keep the audience preview in sync before the
    // server acknowledgement mirrors these changes onto its child channels.
    const payload = {
      type: "updateChannel",
      channelId: existing.id,
      name: existing.name,
      allowedUserIds: access.allowedUserIds,
      autoIncludeNewMembers: access.autoIncludeNewMembers,
    };
    if (existing.kind === "event") {
      payload.enabledCardIds = existing.enabledCardIds ?? null;
      payload.enabledCategoryIds = existing.enabledCategoryIds ?? null;
      payload.enabledLocations = existing.enabledLocations ?? null;
      payload.linkedChatChannelId = existing.linkedChatChannelId || null;
      payload.mirrorActivity = !!existing.mirrorActivity;
    }
    // Private = manual people only — leave role visibility as-is (matrix hidden).
    if (!access.privateMode) {
      const rolePerms = readRolePermsFromMatrix(root.querySelector("#ch-access-role-matrix-mount"), { viewOnly: true });
      if (rolePerms) {
        payload.rolePerms = rolePerms;
        existing.rolePerms = rolePerms;
        const staff = typeof channelStaffFloor === "function"
          ? channelStaffFloor({ ...existing, rolePerms }, activeConn())
          : null;
        payload.minRole = staff || null;
        existing.minRole = staff || null;
      }
    } else if (existing.rolePerms) {
      payload.rolePerms = existing.rolePerms;
    }
    const board = typeof boardForChannel === "function" ? boardForChannel(existing, activeConn()) : null;
    if (board) {
      board.allowedUserIds = existing.allowedUserIds;
      board.autoIncludeNewMembers = existing.autoIncludeNewMembers;
      board.rolePerms = existing.rolePerms;
    }
    send(payload);
    onSaved();
    refreshAccessPeopleList();
    try { if (typeof renderSidebar === "function") renderSidebar(); } catch {}
    return true;
  };

  const autoPersistAccess = () => {
    // A role/preset choice commits the tab's access mode; tab browsing alone
    // must not widen a private or staff-only board's audience.
    if (root.querySelector("#ch-staff")?.checked
        && !root.querySelector(".role-staff-pill input:checked")) {
      root.querySelector("#ch-by-role").checked = true;
      syncAccessUI();
    }
    persistAccess({ useFormPeople: false });
  };

  const matrixMount = root.querySelector("#ch-access-role-matrix-mount");
  if (typeof wireChannelViewPermControls === "function") {
    wireChannelViewPermControls(matrixMount, { onChange: autoPersistAccess });
  } else {
    matrixMount?.querySelectorAll(
      ".role-perm-matrix input[type=checkbox], .role-view-pill input[type=checkbox]"
    ).forEach((inp) => {
      inp.onchange = () => {
        syncRoleViewPills();
        autoPersistAccess();
      };
    });
  }

  const restrictToggle = root.querySelector("#ch-restrict");
  if (restrictToggle) {
    restrictToggle.onchange = () => {
      syncAccessUI();
      hideInlineConfirms();
      if (restrictToggle.checked) {
        committedPeople = new Set(selectedPeopleIds());
      }
      autoPersistAccess();
    };
    const byRole = root.querySelector("#ch-by-role");
    if (byRole) byRole.onchange = () => { syncAccessUI(); hideInlineConfirms(); };
    const staffTab = root.querySelector("#ch-staff");
    if (staffTab) staffTab.onchange = () => { syncAccessUI(); hideInlineConfirms(); };
  }

  root.querySelector("#ch-members")?.addEventListener("change", (e) => {
    const inp = e.target.closest("input[type=checkbox]");
    if (!inp) return;
    if (staffIds.has(inp.value)) {
      inp.checked = true;
      inp.closest(".ch-person-chip")?.classList.add("is-on", "is-locked");
      return;
    }
    inp.closest(".ch-person-chip")?.classList.toggle("is-on", inp.checked);
    syncPeopleConfirm();
  });
  root.querySelector("#ch-members")?.addEventListener("click", (e) => {
    const chip = e.target.closest(".ch-person-chip.is-locked");
    if (!chip) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  root.querySelector("#ch-people-undo")?.addEventListener("click", () => {
    paintPeopleSelection([...committedPeople]);
    hideInlineConfirms();
  });
  root.querySelector("#ch-people-apply")?.addEventListener("click", () => {
    const ids = selectedPeopleIds();
    if (!ids.length) {
      toast("Add at least yourself to this group");
      return;
    }
    committedPeople = new Set(ids);
    hideInlineConfirms();
    if (persistAccess({ useFormPeople: true })) {
      toast("Who can see this updated");
    }
  });

}
