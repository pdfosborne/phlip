/* render-roles.js — role colors + roles editor mount.
 * Globals out: openRolesEditorModal, mountRolesEditor, ensureRoleColor, …
 * Load after: render-deck-editor.js; before: render-locations.js
 */

function nextRoleColor(conn = activeConn()) {
  const used = new Set(
    customRolesOf(conn).map(r => String(r.color || "").toLowerCase()).filter(Boolean)
  );
  if (typeof ROLE_ADMIN_COLOR === "string") used.add(ROLE_ADMIN_COLOR.toLowerCase());
  if (typeof ROLE_MODERATOR_COLOR === "string") used.add(ROLE_MODERATOR_COLOR.toLowerCase());
  const palette = typeof CATEGORY_PALETTE !== "undefined" ? CATEGORY_PALETTE : [];
  for (const p of palette) {
    const accent = String(p.accent || "").toLowerCase();
    if (accent && !used.has(accent)) return p.accent;
  }
  for (const p of palette) {
    const accent = String(p.accent || "");
    if (accent && !(typeof isStaffReservedColor === "function" && isStaffReservedColor(accent))) {
      return p.accent;
    }
  }
  return "#4A5262";
}

function ensureRoleColor(role, conn = activeConn(), index = 0) {
  if (role.color && /^#[0-9a-fA-F]{6}$/.test(role.color)
      && !(typeof isStaffReservedColor === "function" && isStaffReservedColor(role.color))) {
    return role.color;
  }
  const palette = typeof CATEGORY_PALETTE !== "undefined" ? CATEGORY_PALETTE : [];
  let accent = palette[index % Math.max(palette.length, 1)]?.accent || nextRoleColor(conn);
  if (typeof isStaffReservedColor === "function" && isStaffReservedColor(accent)) {
    accent = nextRoleColor(conn);
  }
  role.color = accent;
  return accent;
}

function openRolesEditorModal() {
  const conn = activeConn();
  if (!canManageServer(conn)) return;
  openSideOverlay({
    kind: "roles",
    title: "Roles",
    bodyClass: ["side-overlay-roles", "roles-side-body"],
    mount: (body) => mountRolesEditor(body, conn),
  });
}

/** Mount the full Roles editor (sidebar Roles settings layer). */
function mountRolesEditor(host, conn) {
  if (!host || !conn) return;
  let expandedId = null;
  /** @type {Map<string, object>} pending permission flags keyed by lowercase role name */
  const pendingRolePerms = new Map();
  host.classList.add("roles-editor-panel");
  host.innerHTML = `<div class="roles-editor" data-roles-list></div>`;

  const headActions = host.closest(".server-menu-overlay")
    ? document.getElementById("server-menu-actions")
    : document.getElementById("side-overlay-actions");
  if (headActions) {
    headActions.hidden = false;
    headActions.innerHTML = `
      <button type="button" class="side-overlay-action" id="roles-add-item" title="Add role" aria-label="Add role">${typeof ic === "function" ? ic("plus") : "+"}</button>`;
  }

  const listEl = host.querySelector("[data-roles-list]");
  const members = () => [...(conn.members || [])].sort((a, b) =>
    (a.name || "").localeCompare(b.name || ""));
  const editorPermFlags = () => (typeof ROLE_CONFIG_PERM_FLAGS !== "undefined"
    ? ROLE_CONFIG_PERM_FLAGS
    : ROLE_EDITOR_PERM_FLAGS);

  const persistRolePerms = () => {
    const payload = typeof stripEventRolePermsForWrite === "function"
      ? stripEventRolePermsForWrite(conn.eventRolePerms)
      : conn.eventRolePerms;
    send({ type: "updateEventRolePerms", rolePerms: payload });
    if (typeof syncInventServerSettings === "function") syncInventServerSettings(conn);
  };

  const countBase = (role) => members().filter(m => effectiveRole(m) === role).length;
  const countCustom = (id) => members().filter(m => (m.roleTagIds || []).includes(id)).length;

  const applyPendingRolePerms = () => {
    if (!pendingRolePerms.size) return;
    let changed = false;
    ensureServerEventRolePerms(conn);
    for (const role of customRolesOf(conn)) {
      const key = String(role.name || "").trim().toLowerCase();
      if (!key || !pendingRolePerms.has(key)) continue;
      const flags = pendingRolePerms.get(key);
      pendingRolePerms.delete(key);
      conn.eventRolePerms[role.id] = typeof normalizeRolePermFlags === "function"
        ? normalizeRolePermFlags(flags, role.id, conn)
        : { ...emptyRolePermFlags(), ...flags };
      changed = true;
    }
    if (changed) persistRolePerms();
  };

  const paletteHtml = (role) => {
    const palette = (typeof CATEGORY_PALETTE !== "undefined" ? CATEGORY_PALETTE : [])
      .filter(p => !(typeof isStaffReservedColor === "function" && isStaffReservedColor(p.accent)));
    const cur = String(role.color || "").toLowerCase();
    return `<div class="cat-color-grid roles-color-grid">
      ${palette.map(p => {
        const on = cur === String(p.accent).toLowerCase();
        const chipBg = p.lightSurface;
        const chipFg = p.lightIcon;
        return `<button type="button" class="cat-color-choice${on ? " on" : ""}" data-color="${esc(p.accent)}"
          style="background:${chipBg};box-shadow:inset 0 0 0 2px ${chipFg}" title="${esc(p.id)}"></button>`;
      }).join("")}
    </div>`;
  };

  const rolePermsHtml = (roleKey) => {
    const perms = ensureServerEventRolePerms(conn);
    const flags = perms[roleKey] || emptyRolePermFlags();
    return `<div class="roles-role-perms">
      ${editorPermFlags().map(f => `
        <label class="roles-add-perm">
          <input type="checkbox" data-flag="${esc(f)}" ${flags[f] ? "checked" : ""}>
          <span>${esc(CHANNEL_PERM_FLAG_LABELS[f] || f)}</span>
        </label>`).join("")}
    </div>`;
  };

  const wirePermToggles = (row, roleKey) => {
    row.querySelectorAll(".roles-role-perms input[data-flag]").forEach((inp) => {
      inp.onchange = () => {
        const flag = inp.getAttribute("data-flag");
        if (!flag) return;
        ensureServerEventRolePerms(conn);
        const cur = conn.eventRolePerms[roleKey] || emptyRolePermFlags();
        conn.eventRolePerms[roleKey] = typeof normalizeRolePermFlags === "function"
          ? normalizeRolePermFlags({ ...cur, [flag]: !!inp.checked }, roleKey, conn)
          : { ...emptyRolePermFlags(), ...cur, [flag]: !!inp.checked };
        persistRolePerms();
      };
    });
  };

  const toggleExpand = (id) => {
    expandedId = expandedId === id ? null : id;
    paint();
  };

  const appendRow = ({ id, title, kind, count, swatch, bodyHtml, afterMount }) => {
    const open = expandedId === id;
    const row = document.createElement("div");
    row.className = "roles-editor-row" + (open ? " is-open" : "");
    row.dataset.roleKey = id;
    row.innerHTML = `
      <div class="roles-editor-head">
        ${swatch || ""}
        <span class="roles-standard-name">${esc(title)}</span>
        <span class="roles-kind-label">${esc(kind)}</span>
        <em class="roles-count">${count}</em>
        <button type="button" class="roles-chevron" aria-expanded="${open}" title="${open ? "Collapse" : "Expand"}">${ic(open ? "chevronUp" : "chevronDown")}</button>
      </div>
      <div class="roles-editor-body"${open ? "" : " hidden"}>${open ? bodyHtml : ""}</div>`;
    row.querySelector(".roles-editor-head").onclick = (e) => {
      if (e.target.closest(".roles-color-btn, .roles-name-input")) return;
      toggleExpand(id);
    };
    if (open && afterMount) afterMount(row);
    listEl.appendChild(row);
  };

  const paint = () => {
    if (!host.isConnected) return;
    applyPendingRolePerms();
    listEl.innerHTML = "";

    appendRow({
      id: ROLE_ADMIN,
      title: "Admin",
      kind: "System",
      count: countBase(ROLE_ADMIN),
      bodyHtml: `<p class="roles-summary">Sees all channels. Manages the server. Can edit and delete anyone’s content.</p>`,
    });
    appendRow({
      id: ROLE_MODERATOR,
      title: "Moderator",
      kind: "System",
      count: countBase(ROLE_MODERATOR),
      bodyHtml: `<p class="roles-summary">Can edit and delete others’ content and approve events in channels they can see. Visibility is set per channel by the host or an admin — moderators do not see every channel automatically.</p>`,
    });
    appendRow({
      id: ROLE_USER,
      title: "Member",
      kind: "System",
      count: countBase(ROLE_USER),
      bodyHtml: `<label class="roles-body-label">Permissions</label>${rolePermsHtml(ROLE_USER)}`,
      afterMount: (row) => wirePermToggles(row, ROLE_USER),
    });
    appendRow({
      id: ROLE_VIEWER,
      title: "Viewer",
      kind: "System",
      count: countBase(ROLE_VIEWER),
      bodyHtml: `<label class="roles-body-label">Permissions</label>${rolePermsHtml(ROLE_VIEWER)}`,
      afterMount: (row) => wirePermToggles(row, ROLE_VIEWER),
    });

    const roles = customRolesOf(conn);
    roles.forEach((role, index) => {
      ensureRoleColor(role, conn, index);
      const open = expandedId === role.id;
      const swatch = `<button type="button" class="roles-color-btn" title="Change colour" style="background:${esc(role.color)}"></button>`;
      const body = `
        <label class="roles-body-label">Name</label>
        <input class="roles-name-input" maxlength="32" value="${esc(role.name)}" aria-label="Role name">
        <label class="roles-body-label">Colour</label>
        ${paletteHtml(role)}
        <label class="roles-body-label">Permissions</label>
        ${rolePermsHtml(role.id)}
        <label class="roles-body-label">Assign people</label>
        <div class="roles-assign-people" data-assign></div>
        <div class="roles-custom-actions">
          <button type="button" class="people-btn" data-act="dup">${ic("copy", "ico-inline")} Duplicate</button>
          <button type="button" class="people-btn danger" data-act="del">${ic("trash", "ico-inline")} Delete role</button>
        </div>`;
      appendRow({
        id: role.id,
        title: role.name,
        kind: "Custom",
        count: countCustom(role.id),
        swatch,
        bodyHtml: body,
        afterMount: (row) => {
          wirePermToggles(row, role.id);
          const nameInp = row.querySelector(".roles-name-input");
          const commitName = () => {
            const name = nameInp.value.trim();
            if (!name || name === role.name) {
              nameInp.value = role.name;
              return;
            }
            if (customRolesOf(conn).some(r => r.id !== role.id && r.name.toLowerCase() === name.toLowerCase())) {
              toast("Another role already uses that name");
              nameInp.value = role.name;
              return;
            }
            send({ type: "updateCustomRole", roleId: role.id, name });
            role.name = name;
            toast(`Renamed to ${name}`);
            paint();
          };
          nameInp.onchange = nameInp.onblur = commitName;
          row.querySelector(".roles-color-btn")?.addEventListener("click", (e) => {
            e.stopPropagation();
            expandedId = role.id;
            paint();
          });
          row.querySelectorAll(".cat-color-choice").forEach((btn) => {
            btn.onclick = () => {
              const color = btn.getAttribute("data-color");
              if (!color || color === role.color) return;
              if (typeof isStaffReservedColor === "function" && isStaffReservedColor(color)) return;
              send({ type: "updateCustomRole", roleId: role.id, color });
              role.color = color;
              paint();
              toast(`Colour updated for ${role.name}`);
            };
          });
          const assignEl = row.querySelector("[data-assign]");
          if (assignEl) {
            const selected = new Set(members().filter(m => (m.roleTagIds || []).includes(role.id)).map(m => m.id));
            members().filter(m => effectiveRole(m) !== ROLE_HOST).forEach((m) => {
              const lab = document.createElement("label");
              lab.className = "roles-add-perm";
              lab.innerHTML = `<input type="checkbox" value="${esc(m.id)}" ${selected.has(m.id) ? "checked" : ""}><span>${esc(m.name || "Someone")}</span>`;
              lab.querySelector("input").onchange = () => {
                const on = lab.querySelector("input").checked;
                const tags = new Set(m.roleTagIds || []);
                if (on) tags.add(role.id);
                else tags.delete(role.id);
                const next = [...tags];
                send({ type: "setMemberRoleTags", userId: m.id, roleTagIds: next });
                m.roleTagIds = next;
                toast(`Updated ${m.name || "member"}`);
              };
              assignEl.appendChild(lab);
            });
          }
          row.querySelector("[data-act=dup]")?.addEventListener("click", () => {
            const base = String(role.name || "Role").trim() || "Role";
            let name = `${base} copy`;
            let n = 2;
            const names = new Set(customRolesOf(conn).map(r => r.name.toLowerCase()));
            while (names.has(name.toLowerCase())) {
              name = `${base} copy ${n++}`;
            }
            const flags = ensureServerEventRolePerms(conn)[role.id] || emptyRolePermFlags();
            pendingRolePerms.set(name.toLowerCase(), { ...flags });
            send({
              type: "createCustomRole",
              name,
              color: role.color || nextRoleColor(conn),
              copyRoleId: role.id,
              rolePerms: typeof stripRolePermFlagsForWrite === "function"
                ? stripRolePermFlagsForWrite(flags) : flags,
            });
            toast(`Duplicating ${role.name}…`);
            setTimeout(() => { if (host.isConnected) paint(); }, 400);
          });
          row.querySelector("[data-act=del]")?.addEventListener("click", async () => {
            if (!(await ashConfirm(
              `Delete role “${role.name}”? It’s removed from members and channel visibility. Each person’s base role stays.`,
              { danger: true, ok: "Delete" },
            ))) return;
            send({ type: "deleteCustomRole", roleId: role.id });
            conn.customRoles = (conn.customRoles || []).filter(r => r.id !== role.id);
            if (conn.eventRolePerms && typeof conn.eventRolePerms === "object") {
              delete conn.eventRolePerms[role.id];
            }
            for (const ch of conn.channels || []) {
              if (ch?.rolePerms && typeof ch.rolePerms === "object") delete ch.rolePerms[role.id];
            }
            for (const m of conn.members || []) {
              if (Array.isArray(m.roleTagIds)) {
                m.roleTagIds = m.roleTagIds.filter(id => id !== role.id);
                if (!m.roleTagIds.length) m.roleTagIds = undefined;
              }
            }
            if (expandedId === role.id) expandedId = null;
            paint();
            toast(`Deleted ${role.name}`);
          });
        },
      });
    });
  };

  const flagsFromPreset = (preset, copyId) => {
    const perms = ensureServerEventRolePerms(conn);
    if (preset === "copy" && copyId && perms[copyId]) return { ...emptyRolePermFlags(), ...perms[copyId] };
    if (preset === "viewer") return { ...emptyRolePermFlags(), ...(perms[ROLE_VIEWER] || { view: true }) };
    if (preset === "none") return emptyRolePermFlags();
    return { ...emptyRolePermFlags(), ...(perms[ROLE_USER] || defaultMemberRolePermFlags()) };
  };

  const openAddRolePopup = () => {
    let preset = "member";
    let copyId = customRolesOf(conn)[0]?.id || "";
    let flags = flagsFromPreset(preset, copyId);
    let color = nextRoleColor(conn);
    const copyOptions = customRolesOf(conn).map(r =>
      `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("");
    const permChecks = () => editorPermFlags().map(f => `
      <label class="roles-add-perm">
        <input type="checkbox" data-flag="${esc(f)}" ${flags[f] ? "checked" : ""}>
        <span>${esc(CHANNEL_PERM_FLAG_LABELS[f] || f)}</span>
      </label>`).join("");
    const peopleChecks = members().filter(m => effectiveRole(m) !== ROLE_HOST).map(m =>
      `<label class="roles-add-perm"><input type="checkbox" data-assign="${esc(m.id)}"><span>${esc(m.name || "Someone")}</span></label>`
    ).join("");
    const opened = AshModal.open({
      className: "roles-add-modal",
      html: `
      <div class="modal-card roles-add-card" role="dialog" aria-modal="true" aria-label="Add role">
        <h4>Add role</h4>
        <label class="deck-detail-field">
          <span>Name</span>
          <input type="text" id="roles-add-name" maxlength="32" placeholder="Role name" autocomplete="off">
        </label>
        <label class="roles-body-label">Colour</label>
        <div id="roles-add-colors"></div>
        <label class="deck-detail-field">
          <span>Starting permissions</span>
          <select id="roles-add-preset">
            <option value="member" selected>Member</option>
            <option value="viewer">Viewer</option>
            <option value="none">None</option>
            ${copyOptions ? `<option value="copy">Copy another role</option>` : ""}
          </select>
        </label>
        <div id="roles-add-copy-wrap" hidden>
          <label class="deck-detail-field">
            <span>Copy from</span>
            <select id="roles-add-copy">${copyOptions}</select>
          </label>
        </div>
        <div class="roles-add-perms-label">Permissions</div>
        <div class="roles-add-perms" id="roles-add-perms">${permChecks()}</div>
        ${peopleChecks ? `<div class="roles-add-perms-label">Assign people</div><div class="roles-add-perms" id="roles-add-people">${peopleChecks}</div>` : ""}
        <div class="actions">
          <span></span>
          <div>
            <button type="button" class="cancel" id="roles-add-cancel">Cancel</button>
            <button type="button" class="save" id="roles-add-ok">Create</button>
          </div>
        </div>
      </div>`,
      singleton: "replace",
    });
    if (!opened) return;
    const { overlay: addOv, close } = opened;
    const nameEl = addOv.querySelector("#roles-add-name");
    const colorsHost = addOv.querySelector("#roles-add-colors");
    const dummy = { color };
    const paintColors = () => {
      dummy.color = color;
      if (!colorsHost) return;
      colorsHost.innerHTML = paletteHtml(dummy);
      colorsHost.querySelectorAll(".cat-color-choice").forEach((btn) => {
        btn.onclick = () => {
          color = btn.getAttribute("data-color") || color;
          paintColors();
        };
      });
    };
    paintColors();

    const readFlagsFromDom = () => {
      const next = emptyRolePermFlags();
      editorPermFlags().forEach((f) => {
        next[f] = !!addOv.querySelector(`#roles-add-perms input[data-flag="${f}"]`)?.checked;
      });
      return next;
    };
    const refreshPerms = () => {
      flags = flagsFromPreset(preset, copyId);
      const box = addOv.querySelector("#roles-add-perms");
      if (box) box.innerHTML = permChecks();
    };
    addOv.querySelector("#roles-add-preset").onchange = (e) => {
      preset = e.target.value;
      const wrap = addOv.querySelector("#roles-add-copy-wrap");
      if (wrap) wrap.hidden = preset !== "copy";
      refreshPerms();
    };
    addOv.querySelector("#roles-add-copy")?.addEventListener("change", (e) => {
      copyId = e.target.value;
      refreshPerms();
    });
    addOv.querySelector("#roles-add-cancel").onclick = () => close();
    addOv.querySelector("#roles-add-ok").onclick = () => {
      const name = String(nameEl.value || "").trim();
      if (!name) { toast("Enter a role name"); return; }
      if (customRolesOf(conn).some(r => r.name.toLowerCase() === name.toLowerCase())) {
        toast("That role name already exists");
        return;
      }
      flags = readFlagsFromDom();
      const assignUserIds = [...addOv.querySelectorAll("#roles-add-people input[data-assign]:checked")]
        .map(i => i.getAttribute("data-assign")).filter(Boolean);
      pendingRolePerms.set(name.toLowerCase(), { ...flags });
      const payload = {
        type: "createCustomRole",
        name,
        color,
        preset: preset === "copy" ? "member" : preset,
        rolePerms: typeof stripRolePermFlagsForWrite === "function"
          ? stripRolePermFlagsForWrite(flags) : flags,
      };
      if (preset === "copy" && copyId) payload.copyRoleId = copyId;
      if (assignUserIds.length) payload.assignUserIds = assignUserIds;
      send(payload);
      close();
      toast(`Adding ${name}…`);
      setTimeout(() => { if (host.isConnected) paint(); }, 400);
    };
    setTimeout(() => nameEl?.focus(), 30);
  };

  customRolesOf(conn).forEach((role, i) => {
    const before = role.color;
    ensureRoleColor(role, conn, i);
    if (role.color && role.color !== before) {
      send({ type: "updateCustomRole", roleId: role.id, color: role.color });
    }
  });
  paint();

  document.getElementById("roles-add-item")?.addEventListener("click", () => openAddRolePopup());
  host.addEventListener("roles-refresh", () => { if (host.isConnected) paint(); });
}
