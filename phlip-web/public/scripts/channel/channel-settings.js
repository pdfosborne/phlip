/* channel-settings.js — channel create form + type/location scope.
 * Globals out: openChannelTypesScopeModal, openChannelLocationsScopeModal,
 *   mountChannelSettingsForm, openChannelModal, openBoardModal, openChannelIconPicker,
 *   openBoardIconPicker
 * Load after: channel-form-components.js, channel-access.js, channel-linked-feeds.js
 */

/** Admin: pick a sidebar icon for an event/chat channel. */
function openChannelIconPicker(channelId) {
  const conn = activeConn();
  if (!conn || typeof canManageServer !== "function" || !canManageServer(conn)) return;
  const id = String(channelId || "");
  const ch = (conn.channels || []).find(c => c.id === id);
  if (!ch || (ch.kind !== "event" && ch.kind !== "chat")) return;
  if (typeof openCatIconPicker !== "function") {
    toast("Icon picker unavailable");
    return;
  }
  const fallback = ch.kind === "event"
    ? (ch.pinnedUserId != null ? "person" : ch.pinnedLocationLabel != null ? "pin" : "ticket")
    : "message";
  openCatIconPicker({
    currentIcon: String(ch.icon || "").trim() || fallback,
    title: "View icon",
    allowDraw: true,
    onPick: (name) => {
      const next = String(name || "").trim() || null;
      ch.icon = next;
      send({ type: "updateChannel", channelId: ch.id, icon: next || "" });
      try { if (typeof renderSidebar === "function") renderSidebar(true); } catch {}
    },
  });
}

/** Admin: pick a sidebar icon for a board (copied onto both children). */
function openBoardIconPicker(boardId) {
  const conn = activeConn();
  if (!conn || typeof canManageServer !== "function" || !canManageServer(conn)) return;
  const id = String(boardId || "");
  const board = (conn.boards || []).find(b => b && b.id === id);
  if (!board) return;
  if (board.sourceConnId) return;
  if (typeof openCatIconPicker !== "function") {
    toast("Icon picker unavailable");
    return;
  }
  openCatIconPicker({
    currentIcon: String(board.icon || "").trim() || "ticket",
    title: "Board icon",
    allowDraw: true,
    onPick: (name) => {
      const next = String(name || "").trim() || null;
      board.icon = next;
      send({ type: "updateBoard", boardId: board.id, icon: next || "" });
      if (typeof applyBoardVisibility === "function") applyBoardVisibility(conn, board);
      try { if (typeof renderSidebar === "function") renderSidebar(true); } catch {}
    },
  });
}

function openChannelTypesScopeModal({ enabledCategoryIds, enabledCardIds, onDone }) {
  const conn = activeConn();
  const cats = categoriesFor(conn);
  const types = typeof channelFilterableEventTypes === "function"
    ? channelFilterableEventTypes(conn)
    : (typeof eventTypeCards === "function" ? eventTypeCards(conn) : [])
        .filter(c => !c.custom && !c.somethingElse);
  const typeCatId = (t) => (typeof eventTypeCategoryId === "function"
    ? eventTypeCategoryId(t)
    : (t.cat || t.categoryId || "other"));
  const persistId = (t) => (typeof eventTypePersistId === "function"
    ? eventTypePersistId(t)
    : String(t.typeId || t.id || t.label || "").trim());
  const typeKeys = (t) => (typeof eventTypeChannelKeys === "function"
    ? eventTypeChannelKeys(t)
    : [t.typeId, t.id, t.label].map(v => String(v || "").trim()).filter(Boolean));
  const catSet = enabledCategoryIds == null ? new Set(cats.map(c => c.id)) : new Set(enabledCategoryIds);
  const typeSet = enabledCardIds == null
    ? new Set(types.flatMap(t => typeKeys(t).map(k => k.toLowerCase())))
    : new Set((Array.isArray(enabledCardIds) ? enabledCardIds : [])
        .map(id => String(id).trim().toLowerCase()).filter(Boolean));
  const typeIsOn = (t) => typeKeys(t).some(k => typeSet.has(k.toLowerCase()));
  const visibleCats = cats.filter(c => types.some(t => typeCatId(t) === c.id));

  const opened = AshModal.open({
    className: "ch-scope-modal",
    html: `
    <div class="modal-card">
      <h4>Event types in this channel</h4>
      <p class="cat-hint">Choose which categories and event cards people can use when planning here.</p>
      <div id="ch-type-scope-rows"></div>
      <div class="actions">
        <button type="button" class="cancel" id="ch-type-all">Select all</button>
        <div>
          <button type="button" class="cancel" id="ch-type-cancel">Cancel</button>
          <button type="button" class="save" id="ch-type-done">Done</button>
        </div>
      </div>
    </div>`,
    singleton: "return",
  });
  if (!opened) return;
  const { overlay, close } = opened;
  const rowsEl = overlay.querySelector("#ch-type-scope-rows");

  const render = () => {
    if (!types.length) {
      rowsEl.innerHTML = `<p class="empty-note">No event types yet.</p>`;
      return;
    }
    rowsEl.innerHTML = visibleCats.map(c => {
      const assigned = types.filter(t => typeCatId(t) === c.id);
      return `
        <div class="ch-scope-cat">
          <label class="ch-scope-cat-head">
            <input type="checkbox" data-cat="${esc(c.id)}" ${catSet.has(c.id) ? "checked" : ""}>
            <span class="ch-scope-cat-ico" style="background:${rampColors(paletteEntryForCategory(c) || c.color).tint};color:${rampColors(paletteEntryForCategory(c) || c.color).accent}">${ic(c.icon)}</span>
            <span>${esc(c.name)}</span>
          </label>
          <div class="ch-scope-types">
            ${assigned.map(t => `
              <label class="cat-card-chip">
                <input type="checkbox" data-type="${esc(persistId(t))}" ${typeIsOn(t) ? "checked" : ""}>
                <span class="cat-card-ico">${ic(t.icon)}</span>
                <span>${esc(t.label)}</span>
              </label>`).join("")}
          </div>
        </div>`;
    }).join("");

    rowsEl.querySelectorAll('input[data-cat]').forEach(inp => {
      inp.onchange = () => {
        if (inp.checked) catSet.add(inp.dataset.cat);
        else catSet.delete(inp.dataset.cat);
      };
    });
    rowsEl.querySelectorAll('input[data-type]').forEach(inp => {
      inp.onchange = () => {
        const needle = String(inp.dataset.type || "").trim().toLowerCase();
        const t = types.find(x => typeKeys(x).some(k => k.toLowerCase() === needle));
        const keys = t ? typeKeys(t).map(k => k.toLowerCase()) : (needle ? [needle] : []);
        if (inp.checked) keys.forEach(k => typeSet.add(k));
        else keys.forEach(k => typeSet.delete(k));
      };
    });
  };
  render();

  overlay.querySelector("#ch-type-cancel").onclick = close;
  overlay.querySelector("#ch-type-all").onclick = () => {
    cats.forEach(c => catSet.add(c.id));
    types.forEach(t => typeKeys(t).forEach(k => typeSet.add(k.toLowerCase())));
    render();
  };
  overlay.querySelector("#ch-type-done").onclick = () => {
    const allCat = cats.length > 0 && cats.every(c => catSet.has(c.id));
    const allType = types.length > 0 && types.every(t => typeIsOn(t));
    onDone?.(
      allCat ? null : cats.filter(c => catSet.has(c.id)).map(c => c.id),
      allType ? null : types.filter(t => typeIsOn(t)).map(t => persistId(t)).filter(Boolean),
    );
    close();
  };
}

/** Channel settings → same locations registry as server settings, with per-group enable toggles. */
function openChannelLocationsScopeModal({ enabledLocations, onDone }) {
  openLocationsRegistry({
    forChannel: true,
    enabledLocations: enabledLocations ?? null,
    onChannelDone: onDone,
  });
}

function mountChannelSettingsForm(container, {
  existing = null,
  isNew = false,
  preferredKind = "chat",
  omitAccess = false,
  isBoard = false,
  onCancel = () => {},
  onSaved = () => {},
  onDeleted = () => {},
} = {}) {
  const defaultKind = preferredKind === "event" ? "event" : "chat";
  const personal = PersonalSpace.isPersonal(activeConn());
  const boardChild = !isNew && !!existing?.boardId;
  const restrictInitially = personal
    ? false
    : (isNew ? true : (Array.isArray((isBoard ? existing : (typeof visibilitySourceForChannel === "function" ? visibilitySourceForChannel(existing) : existing))?.allowedUserIds)
      && !(isBoard ? existing : existing)?.autoIncludeNewMembers));
  const meId = activeConn()?.me?.id;
  const staffIds = new Set(
    (S.members || []).filter(m => isAlwaysChannelViewer(m)).map(m => m.id)
  );
  if (meId) staffIds.add(meId);
  const allowedSet = new Set(
    isNew && meId ? [meId] : (existing?.allowedUserIds || [])
  );
  for (const id of staffIds) allowedSet.add(id);
  let enabledCardIds = existing?.kind === "event" ? (existing.enabledCardIds ?? null) : null;
  let enabledCategoryIds = existing?.kind === "event" ? (existing.enabledCategoryIds ?? null) : null;
  let enabledLocations = existing?.kind === "event" ? (existing.enabledLocations ?? null) : null;
  // Events board settings edit the meta Events feed — not a deletable channel.
  const metaEventsSettings = personal && S.activeView?.kind === "events" && !isNew;
  const requiredPersonal = personal && !isNew
    && typeof PersonalSpace !== "undefined"
    && PersonalSpace.isRequiredChannel(existing, activeConn());
  const protectedPersonal = personal && !isNew
    && typeof PersonalSpace !== "undefined"
    && PersonalSpace.isProtectedChannel(existing, activeConn());
  const linkedAgendas = (!personal && !isNew && existing?.kind === "chat" && typeof agendasLinkedToChat === "function")
    ? agendasLinkedToChat(existing, activeConn()) : [];
  const followsAgendas = linkedAgendas.length > 0;
  const showMatrixInitially = !personal && !omitAccess && !followsAgendas && (
    isBoard
    || (!isNew && existing?.kind === "event")
    || (isNew && defaultKind === "event")
    || ((!isNew && existing?.kind === "chat") && !restrictInitially)
    || (isNew && defaultKind === "chat" && !restrictInitially)
  );
  const showAccessInitially = !personal && !omitAccess && !followsAgendas && (
    isBoard
    || (!isNew && existing?.kind === "chat")
    || (isNew && defaultKind === "chat")
  );
  const matrixSeed = existing?.kind === "event" || existing?.kind === "chat"
    ? existing
    : { kind: defaultKind === "event" ? "event" : "chat", minRole: null, rolePerms: null };

  const personChipsHTML = personal ? "" : (S.members || []).map(m => {
    const isStaffChip = staffIds.has(m.id);
    const on = isStaffChip || allowedSet.has(m.id);
    const role = effectiveRole(m);
    const lockNote = role === ROLE_HOST ? " · host"
      : role === ROLE_ADMIN ? " · admin"
      : role === ROLE_MODERATOR ? " · mod"
      : "";
    return `<label class="ch-person-chip${on ? " is-on" : ""}${isStaffChip ? " is-locked" : ""}"${isStaffChip ? ' title="Host and admins always see every view"' : ""}>
      <input type="checkbox" value="${esc(m.id)}" ${on ? "checked" : ""} ${isStaffChip ? "disabled" : ""}>
      <span class="ch-person-avatar" style="${avatarStyle(m.id)}">${avatarFaceHtml(m.id, m.name || "?")}</span>
      <span class="ch-person-name">${esc(m.name || "Someone")}${isStaffChip ? lockNote : ""}</span>
    </label>`;
  }).join("");

  container.innerHTML = `
    <form id="channel-form">
      ${boardChild ? `
      <p class="ch-scope-summary" style="margin:0 0 10px">${existing.kind === "event" ? "Events" : "Chat"} in this board. Name and who can see this live on the board.</p>
      <input type="hidden" id="ch-name" value="${esc(existing.name || "")}">` : `
      <div class="field"><label for="ch-name">Name</label><input id="ch-name" maxlength="32" value="${isNew ? "" : esc(isBoard ? (existing?.name || "") : existing.name)}" required${requiredPersonal ? " disabled" : ""} placeholder="${isBoard || (isNew && !preferredKind)
        ? "e.g. Weekend plans, Work, Home"
        : (personal
        ? (defaultKind === "event" ? "e.g. Home, Work, Social" : "e.g. Notes")
        : (defaultKind === "event" ? "e.g. Fixtures, Socials" : "e.g. Committee"))}"></div>
      ${requiredPersonal ? `<p class="ch-scope-summary">Required — My calendar saves here. This board can’t be deleted or renamed.</p>` : ""}`}
      ${isNew && !isBoard ? `
      <div class="field">
        <label>Type</label>
        <div class="kind-pick">
          <label class="kind-opt"><input type="radio" name="ch-kind" value="chat" ${defaultKind === "chat" ? "checked" : ""}> 💬 Chat</label>
          <label class="kind-opt"><input type="radio" name="ch-kind" value="event" ${defaultKind === "event" ? "checked" : ""}> ${ic("ticket", "ico-inline event-outline-icon")} Events</label>
        </div>
      </div>` : (isNew && isBoard ? `<input type="hidden" name="ch-kind" value="event">` : "")}
      ${omitAccess || personal ? (personal && !omitAccess ? `
      <div class="field" id="ch-access-field" hidden>
        <label>Who can see this</label>
        <p class="ch-scope-summary" style="margin:0">Just you — stored on this device.</p>
      </div>` : "") : followsAgendas ? `
      <div class="field" id="ch-follows-agendas-field">
        <label>Who can see this</label>
        <p class="ch-scope-summary" style="margin:0">${esc(typeof chatFollowsAgendasSummaryText === "function" ? chatFollowsAgendasSummaryText(existing, activeConn()) : `Follows linked agendas: ${linkedAgendas.map(a => a.name || "Agenda").join(", ")}`)}</p>
      </div>` : `
      <div class="field" id="ch-role-matrix-field" style="display:${showMatrixInitially ? "block" : "none"}">
        <label>Who can see this</label>
        <p class="ch-scope-summary" style="margin:0 0 8px">Choose which roles can see this view, or make it an Admin / Moderator view. Action permissions are set in Roles. The host always sees every view.</p>
        <div id="ch-role-matrix-mount">${rolePermMatrixHtml(matrixSeed, activeConn(), { mode: "viewOnly" })}</div>
      </div>
      <div class="field" id="ch-access-field" style="display:${showAccessInitially ? "block" : "none"}">
        <label class="check-row">
          <input type="checkbox" id="ch-restrict" ${restrictInitially ? "checked" : ""}>
          Private — only people you add
        </label>
        <p class="ch-scope-summary" id="ch-privacy-hint" style="margin:6px 0 0"></p>
        <div id="ch-private-block" style="display:${restrictInitially ? "block" : "none"}">
          <div class="ch-person-grid" id="ch-members">${personChipsHTML}</div>
          <div class="ch-inline-confirm" id="ch-people-confirm" hidden>
            <p class="ch-inline-confirm-msg" id="ch-people-confirm-msg">Confirm who can see this?</p>
            <div class="ch-inline-confirm-actions">
              <button type="button" class="cancel" id="ch-people-undo">Undo</button>
              <button type="button" class="save" id="ch-people-apply">Confirm</button>
            </div>
          </div>
          <div class="ch-inline-confirm" id="ch-everyone-confirm" hidden>
            <p class="ch-inline-confirm-msg">Add everyone currently on this server? They’ll be able to see this view.</p>
            <div class="ch-inline-confirm-actions">
              <button type="button" class="cancel" id="ch-everyone-cancel">Cancel</button>
              <button type="button" class="save" id="ch-everyone-apply">Confirm</button>
            </div>
          </div>
          <div class="ch-scope-actions" id="ch-pop-actions" style="margin-top:8px">
            <button type="button" class="ch-manage-btn" id="ch-add-everyone">Add everyone on the server</button>
          </div>
        </div>
      </div>` }
      ${!isNew && existing?.kind === "event" && existing?.pinnedLocationLabel != null ? `
      <div class="field" id="ch-pinned-loc-field">
        <label class="ch-pinned-loc-badge">${ic("ticket", "ico-inline")} Pinned to location: ${esc(existing.pinnedLocationLabel)}</label>
        <p class="ch-scope-summary" style="margin:6px 0 0">Read-only aggregation — shows every booking of this place. Events are created in their own channel and appear here automatically.</p>
      </div>` : ""}
      ${!isNew && existing?.kind === "event" && existing?.pinnedUserId != null ? `
      <div class="field" id="ch-pinned-person-field">
        <label class="ch-pinned-loc-badge">${ic("person", "ico-inline")} Pinned to person: ${esc(
          ((activeConn()?.members || []).find(m => m.id === existing.pinnedUserId)?.name)
          || existing.name
          || "Member"
        )}</label>
        <p class="ch-scope-summary" style="margin:6px 0 0">Read-only aggregation — shows every plan this member can see. Where you can’t open the home group, you still see a reserved time.</p>
      </div>` : ""}
      ${!isBoard ? `<div class="field" id="ch-scope-field" style="display:${
        ((!isNew && existing.kind === "event") || (isNew && defaultKind === "event"))
          && existing?.pinnedLocationLabel == null
          && existing?.pinnedUserId == null
          ? "block" : "none"
      }">
        <label>${personal ? "Filters" : "Planning options"}</label>
        <div class="ch-scope-actions">
          <button type="button" class="ch-manage-btn" id="ch-manage-types">${personal && existing?.name
            ? `Filter event types for ‘${esc(existing.name)}’`
            : "Manage event types"}</button>
          <button type="button" class="ch-manage-btn" id="ch-manage-locs">${personal && existing?.name
            ? `Filter locations for ‘${esc(existing.name)}’`
            : "Manage locations"}</button>
        </div>
        <p class="ch-scope-summary" id="ch-scope-summary"></p>
      </div>` : ""}
      <div class="field" id="ch-feed-field" style="display:${
        !isNew && existing.kind === "event"
          && existing?.pinnedLocationLabel == null
          && existing?.pinnedUserId == null
          ? "block" : "none"
      }">
        <label>${personal ? "Linked agendas" : "Linked event groups"}</label>
        <div class="ch-scope-actions">
          <button type="button" class="ch-manage-btn" id="ch-manage-feeds">${personal ? "Choose agendas…" : "Choose groups…"}</button>
        </div>
        <p class="ch-scope-summary" id="ch-feed-summary"></p>
        <p class="ch-scope-summary" style="margin-top:4px" id="ch-feed-hint">${personal
          ? "Pull events from agendas on servers you’ve joined into this one."
          : "On this device — pull events from other event groups on servers you’re on (not from Personal)."}</p>
      </div>
      ${!isNew && existing?.kind === "event" && boardChild
        && existing?.pinnedLocationLabel == null
        && existing?.pinnedUserId == null ? `
      <div class="field" id="ch-avail-field">
        <label class="check-row">
          <input type="checkbox" id="ch-allow-availability" ${existing.allowAvailability ? "checked" : ""}>
          Availability
        </label>
        <p class="ch-scope-summary" style="margin-top:6px">Members can post when they’re free, without making a full event.</p>
      </div>` : ""}
      ${!isNew && existing?.kind === "chat" && !boardChild ? chatImportEventsFieldHTML(existing, personal) : ""}
      ${!isNew && existing?.kind === "chat" && boardChild ? `
      <div class="field" id="ch-board-mirror-field">
        <label class="check-row">
          <input type="checkbox" id="ch-board-mirror-activity" ${
            ((typeof eventChannelForBoard === "function" && eventChannelForBoard(existing.boardId)?.mirrorActivity)
              || false) ? "checked" : ""
          }>
          Include log posts
        </label>
        <p class="ch-scope-summary" style="margin-top:6px">RSVP, add-person, and time-change entries. Off by default to keep chat quieter.</p>
      </div>` : ""}
      ${!personal && !isBoard && !boardChild && (isNew || existing?.kind === "chat")
        ? channelWelcomeFieldHTML(existing, { personal, isNew, hidden: isNew && defaultKind === "event" })
        : ""}
      <div class="actions">
        ${!isNew && !metaEventsSettings && !protectedPersonal && !boardChild
          ? `<button type="button" class="danger" id="ch-delete">${personal && existing?.name
            ? `Delete ‘${esc(existing.name)}’`
            : "Delete view"}</button><span></span>`
          : `<span></span>`}${isNew ? `
        <div>
          <button type="button" class="cancel" id="ch-cancel">Cancel</button>
          <button type="submit" class="save">Create</button>
        </div>` : ""}
      </div>
    </form>`;

  const root = container;
  const newBoardAccess = isNew && isBoard && !personal && !omitAccess;
  if (newBoardAccess) {
    const matrix = root.querySelector("#ch-role-matrix-field");
    const access = root.querySelector("#ch-access-field");
    matrix.querySelector(".ch-scope-summary")?.remove();
    root.querySelector("#ch-role-matrix-mount").innerHTML = rolePermMatrixHtml(matrixSeed, activeConn(), { mode: "viewOnly", pills: true });
    access.querySelector(".check-row")?.remove();
    root.querySelector("#ch-privacy-hint")?.remove();
    root.querySelector("#ch-everyone-confirm")?.remove();
    root.querySelector("#ch-pop-actions")?.remove();
    const tabs = document.createElement("div");
    tabs.className = "field";
    tabs.innerHTML = `<label>Who can see this</label>
      <div class="ch-access-mode" role="group" aria-label="Choose how board access is controlled">
        <label class="ch-access-mode-option"><input type="radio" name="board-access-mode" id="ch-by-role" ${restrictInitially ? "" : "checked"}><span>By role</span></label>
        <label class="ch-access-mode-option"><input type="radio" name="board-access-mode" id="ch-restrict" ${restrictInitially ? "checked" : ""}><span>Specific people</span></label>
        <label class="ch-access-mode-option"><input type="radio" name="board-access-mode" id="ch-staff"><span>Staff</span></label>
      </div>`;
    matrix.querySelector("label")?.remove();
    matrix.before(tabs);
  }
  root.querySelector("#ch-cancel")?.addEventListener("click", onCancel);
  if (!isNew && existing?.kind === "chat") {
    wireChatImportEventsField(root, existing, personal);
  }
  const mirrorCb = root.querySelector("#ch-board-mirror-activity");
  if (mirrorCb && existing?.boardId) {
    mirrorCb.onchange = () => {
      const event = typeof eventChannelForBoard === "function"
        ? eventChannelForBoard(existing.boardId) : null;
      if (!event) return;
      event.mirrorActivity = !!mirrorCb.checked;
      send({
        type: "updateChannel",
        channelId: event.id,
        name: event.name,
        mirrorActivity: !!mirrorCb.checked,
        linkedChatChannelId: event.linkedChatChannelId || null,
      });
      toast(mirrorCb.checked ? "Log posts on" : "Log posts off");
    };
  }
  const availCb = root.querySelector("#ch-allow-availability");
  if (availCb && existing?.kind === "event") {
    availCb.onchange = () => {
      existing.allowAvailability = !!availCb.checked;
      persistExisting({ close: false });
    };
  }

  const privacyHint = root.querySelector("#ch-privacy-hint");
  const privateBlock = root.querySelector("#ch-private-block");
  const matrixField = root.querySelector("#ch-role-matrix-field");

  const syncPrivacyHint = () => {
    if (!privacyHint) return;
    const kind = isNew
      ? (root.querySelector('input[name="ch-kind"]:checked')?.value || defaultKind)
      : existing.kind;
    const restricted = !!root.querySelector("#ch-restrict")?.checked;
    const noun = kind === "event" ? (personal ? "agenda" : "board") : "chat";
    privacyHint.textContent = restricted
      ? `Only the people you tick can see this ${noun}. Host, admin, and moderators are always included.`
      : `Turn on to limit this ${noun} to specific people instead of roles.`;
  };

  const syncAccessUI = () => {
    if (personal) return;
    const restrictEl = root.querySelector("#ch-restrict");
    const restricted = !!restrictEl?.checked;
    if (privateBlock) privateBlock.style.display = restricted ? "block" : "none";
    if (newBoardAccess) {
      root.classList.toggle("access-tab-staff", !!root.querySelector("#ch-staff")?.checked);
      root.classList.toggle("access-tab-roles", !!root.querySelector("#ch-by-role")?.checked);
      if (matrixField) matrixField.style.display = restricted ? "none" : "block";
      return;
    }
    const kind = isNew
      ? (root.querySelector('input[name="ch-kind"]:checked')?.value || defaultKind)
      : existing.kind;
    if (matrixField) {
      matrixField.style.display = (kind === "event" || !restricted) ? "block" : "none";
    }
    syncPrivacyHint();
  };
  if (!personal && !omitAccess) {
    syncAccessUI();
  }

  const paintScopeSummary = () => {
    const el = root.querySelector("#ch-scope-summary");
    if (!el) return;
    const allTypes = typeof channelFilterableEventTypes === "function"
      ? channelFilterableEventTypes(activeConn())
      : assignableEventCards();
    const allCats = categoriesFor(activeConn());
    const allLocs = locationsFor(activeConn());
    const typeN = enabledCardIds == null ? allTypes.length : enabledCardIds.length;
    const catN = enabledCategoryIds == null ? allCats.length : enabledCategoryIds.length;
    const locN = enabledLocations == null ? allLocs.length : enabledLocations.length;
    const typesLabel = enabledCardIds == null && enabledCategoryIds == null
      ? "All categories & types"
      : `${catN} categor${catN === 1 ? "y" : "ies"} · ${typeN} type${typeN === 1 ? "" : "s"}`;
    const locsLabel = enabledLocations == null
      ? (allLocs.length ? "All locations" : "No locations yet")
      : `${locN} location${locN === 1 ? "" : "s"}`;
    el.textContent = `${typesLabel} · ${locsLabel}`;
  };
  paintScopeSummary();

  const showEventFields = (isEvent) => {
    const scope = root.querySelector("#ch-scope-field");
    if (scope) scope.style.display = isEvent ? "block" : "none";
    const feedField = root.querySelector("#ch-feed-field");
    if (feedField) feedField.style.display = (!isNew && isEvent) ? "block" : "none";
    const welcomeField = root.querySelector("#ch-welcome-field");
    if (welcomeField) welcomeField.style.display = isEvent ? "none" : "block";
    const accessField = root.querySelector("#ch-access-field");
    if (!personal && accessField) accessField.style.display = isEvent ? "none" : "block";
    if (isNew && !personal && !isEvent) {
      const restrict = root.querySelector("#ch-restrict");
      if (restrict) restrict.checked = true;
      if (staffIds.size) {
        root.querySelectorAll("#ch-members input").forEach(inp => {
          const locked = staffIds.has(inp.value);
          inp.checked = locked || inp.value === meId;
          const chip = inp.closest(".ch-person-chip");
          chip?.classList.toggle("is-on", inp.checked);
          if (locked) chip?.classList.add("is-locked");
        });
      }
    }
    syncAccessUI();
    syncPrivacyHint();
  };
  if (!isNew && existing.kind === "event") {
    const feedSummary = root.querySelector("#ch-feed-summary");
    // From the Events board on personal, linked feeds configure the meta Events
    // list (includes Plans) — not the scoped calendar’s own self-exclude list.
    const metaEventsFeed = personal && S.activeView?.kind === "events";
    const feedConnId = activeConn().id;
    const feedChannelId = metaEventsFeed ? PERSONAL_META_EVENTS_ID : existing.id;
    const feedTitle = metaEventsFeed ? "Events" : existing.name;
    const feedFieldLabel = root.querySelector("#ch-feed-field > label");
    if (feedFieldLabel && metaEventsFeed) feedFieldLabel.textContent = personal ? "Linked agendas" : "Linked event groups";
    const feedHint = root.querySelector("#ch-feed-hint");
    if (feedHint && metaEventsFeed) {
      feedHint.textContent = "Choose personal agendas for Events (e.g. Plans). Anything those agendas link to is included automatically.";
    }
    const paintFeedSummary = () => {
      if (feedSummary) feedSummary.textContent = linkedFeedsSummaryText(feedConnId, feedChannelId);
    };
    paintFeedSummary();
    root.querySelector("#ch-manage-feeds")?.addEventListener("click", () => {
      openLinkedEventFeedsModal(feedConnId, feedChannelId, feedTitle, paintFeedSummary);
    });
  }
  if (isNew && !isBoard) {
    root.querySelectorAll('input[name="ch-kind"]').forEach(r => {
      r.onchange = () => showEventFields(root.querySelector('input[name="ch-kind"]:checked').value === "event");
    });
    showEventFields(defaultKind === "event");
  }
  let committedPeople = new Set(personal ? [] : [...allowedSet]);
  for (const id of staffIds) committedPeople.add(id);
  const peopleConfirmEl = root.querySelector("#ch-people-confirm");
  const everyoneConfirmEl = root.querySelector("#ch-everyone-confirm");
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
    // Include disabled staff checkboxes — query :checked can skip disabled in some browsers.
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
    if (personal || !root.querySelector("#ch-restrict")?.checked) return false;
    return !setsEqual(new Set(selectedPeopleIds()), committedPeople);
  };
  const hideInlineConfirms = () => {
    if (peopleConfirmEl) peopleConfirmEl.hidden = true;
    if (everyoneConfirmEl) everyoneConfirmEl.hidden = true;
  };
  const syncPeopleConfirm = () => {
    if (!peopleConfirmEl) return;
    if (everyoneConfirmEl) everyoneConfirmEl.hidden = true;
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

  const currentKind = () => (isBoard ? "chat" : (isNew
    ? (root.querySelector('input[name="ch-kind"]:checked')?.value || defaultKind)
    : existing.kind));

  const readAccessPayload = ({ useFormPeople = false } = {}) => {
    if (personal) {
      return { allowedUserIds: null, autoIncludeNewMembers: false, minRole: "viewer", privateMode: false };
    }
    if (currentKind() === "event") {
      return { allowedUserIds: null, autoIncludeNewMembers: false, minRole: "viewer", privateMode: false };
    }
    if (omitAccess || followsAgendas) {
      // Preserve private lists; migrate legacy auto-include → open role floor.
      if (Array.isArray(existing?.allowedUserIds) && !existing?.autoIncludeNewMembers) {
        return {
          allowedUserIds: existing.allowedUserIds,
          autoIncludeNewMembers: false,
          minRole: "viewer",
          privateMode: true,
        };
      }
      return {
        allowedUserIds: null,
        autoIncludeNewMembers: false,
        minRole: "viewer",
        privateMode: false,
      };
    }
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

  const readMatrixPayload = () => {
    if (personal || followsAgendas) return null;
    const kind = currentKind();
    if (kind !== "event" && kind !== "chat") return null;
    const mount = root.querySelector("#ch-role-matrix-mount");
    if (!mount) return null;
    return readRolePermsFromMatrix(mount, { viewOnly: true });
  };

  const wireMatrixControls = () => {
    const mount = root.querySelector("#ch-role-matrix-mount");
    if (!mount) return;
    if (typeof wireChannelViewPermControls === "function") {
      wireChannelViewPermControls(mount, {
        onChange: () => { if (!isNew) persistExisting({ close: false }); },
      });
      return;
    }
    mount.querySelectorAll(".role-perm-matrix input[type=checkbox]").forEach((inp) => {
      inp.onchange = () => {
        if (!isNew) persistExisting({ close: false });
      };
    });
  };
  wireMatrixControls();

  const persistExisting = ({ useFormPeople = false, close = false } = {}) => {
    if (isNew || !existing?.id) return false;
    const name = requiredPersonal
      ? (typeof PersonalSpace !== "undefined" ? PersonalSpace.MY_PLANS_NAME : "My plans")
      : (boardChild
        ? (existing.name || (typeof boardTitle === "function" ? boardTitle(existing) : "") || "Board")
        : root.querySelector("#ch-name")?.value.trim());
    if (!name) {
      toast("Name is required");
      return false;
    }
    const kind = existing.kind;
    const access = readAccessPayload({ useFormPeople });
    if (kind !== "event" && Array.isArray(access.allowedUserIds) && !access.allowedUserIds.length) {
      toast("Add at least yourself to this group");
      return false;
    }
    let linkedChatChannelId = null;
    let mirrorActivity = false;
    let cards = null, cats = null, locs = null;
    const rolePerms = readMatrixPayload();
    if (kind === "event") {
      cards = enabledCardIds;
      cats = enabledCategoryIds;
      locs = enabledLocations;
      // Chat-import links are edited from the chat channel Settings.
      linkedChatChannelId = existing.linkedChatChannelId || null;
      mirrorActivity = !!(linkedChatChannelId && existing.mirrorActivity);
    }
    existing.name = name;
    existing.minRole = null;
    if (kind === "event") {
      existing.allowedUserIds = null;
      existing.autoIncludeNewMembers = false;
      if (rolePerms) existing.rolePerms = rolePerms;
      existing.enabledCardIds = cards;
      existing.enabledCategoryIds = cats;
      existing.enabledLocations = locs;
      existing.linkedChatChannelId = linkedChatChannelId;
      existing.mirrorActivity = mirrorActivity;
      const availCb = root.querySelector("#ch-allow-availability");
      if (availCb) existing.allowAvailability = !!availCb.checked;
    } else {
      const linkedNow = typeof agendasLinkedToChat === "function"
        ? agendasLinkedToChat(existing, activeConn()) : [];
      if (!linkedNow.length) {
        existing.allowedUserIds = access.allowedUserIds;
        existing.autoIncludeNewMembers = access.autoIncludeNewMembers;
        if (!access.privateMode && rolePerms) existing.rolePerms = rolePerms;
      }
      const welcomeCb = root.querySelector("#ch-welcome-channel");
      if (welcomeCb) {
        existing.welcomeChannel = !!welcomeCb.checked;
        if (existing.welcomeChannel) {
          for (const c of (activeConn()?.channels || [])) {
            if (c.id !== existing.id && c.kind === "chat") c.welcomeChannel = false;
          }
        }
      }
    }
    const staff = rolePerms && typeof channelStaffFloor === "function"
      ? channelStaffFloor({ kind, rolePerms }, activeConn())
      : null;
    if (!access.privateMode) {
      existing.minRole = staff || null;
    }
    const payload = {
      type: "updateChannel", channelId: existing.id, name,
      minRole: access.privateMode ? existing.minRole : (staff || null),
      enabledCardIds: cards, enabledCategoryIds: cats, enabledLocations: locs,
      linkedChatChannelId, mirrorActivity,
    };
    if (kind === "event") {
      payload.rolePerms = rolePerms;
      payload.allowedUserIds = null;
      payload.autoIncludeNewMembers = false;
      if (existing.pinnedLocationLabel == null && existing.pinnedUserId == null) {
        payload.allowAvailability = !!existing.allowAvailability;
      }
    } else {
      const linkedNow = typeof agendasLinkedToChat === "function"
        ? agendasLinkedToChat(existing, activeConn()) : [];
      if (linkedNow.length) {
        payload.allowedUserIds = existing.allowedUserIds ?? null;
        payload.autoIncludeNewMembers = !!existing.autoIncludeNewMembers;
        if (existing.rolePerms) payload.rolePerms = existing.rolePerms;
      } else {
        payload.allowedUserIds = access.allowedUserIds;
        payload.autoIncludeNewMembers = access.autoIncludeNewMembers;
        if (!access.privateMode && rolePerms) {
          payload.rolePerms = rolePerms;
        } else if (existing.rolePerms) {
          payload.rolePerms = existing.rolePerms;
        }
      }
      payload.welcomeChannel = !!existing.welcomeChannel;
    }
    send(payload);
    if (close) onSaved();
    return true;
  };

  if (!personal && (isNew || existing?.kind === "chat")) {
    wireChannelWelcome(root, existing, persistExisting);
  }

  const autoPersistAccess = () => {
    if (isNew) return;
    // Always use committed people — pending person ticks need their own Confirm.
    persistExisting({ useFormPeople: false, close: false });
  };

  const nameEl = root.querySelector("#ch-name");
  let namePersistTimer = null;
  nameEl?.addEventListener("input", () => {
    if (isNew) return;
    clearTimeout(namePersistTimer);
    namePersistTimer = setTimeout(autoPersistAccess, 450);
  });
  nameEl?.addEventListener("blur", () => {
    if (isNew) return;
    clearTimeout(namePersistTimer);
    autoPersistAccess();
  });
  if (personal && !isNew) {
    nameEl?.addEventListener("input", () => {
      const n = (nameEl.value || "").trim() || existing?.name || "";
      const del = root.querySelector("#ch-delete");
      if (del && n) del.textContent = `Delete ‘${n}’`;
      const typesBtn = root.querySelector("#ch-manage-types");
      const locsBtn = root.querySelector("#ch-manage-locs");
      if (typesBtn && n) typesBtn.textContent = `Filter event types for ‘${n}’`;
      if (locsBtn && n) locsBtn.textContent = `Filter locations for ‘${n}’`;
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
  }

  if (newBoardAccess) {
    root.querySelector("#ch-by-role").onchange = () => {
      root.querySelectorAll(".role-staff-pill input").forEach(inp => { inp.checked = false; });
      paintChannelViewPermControls(root);
      syncAccessUI();
    };
    root.querySelector("#ch-staff").onchange = () => {
      syncAccessUI();
      // Seed the new board with Staff only; the user can choose Admins only.
      const staff = root.querySelector('.role-staff-pill input[data-staff-channel="moderator"]');
      if (!root.querySelector(".role-staff-pill input:checked")) {
        staff.checked = true;
        staff.onchange();
      }
    };
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
  // Locked staff chips: swallow clicks so they can’t be toggled.
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
    if (!isNew) {
      if (persistExisting({ useFormPeople: true, close: false })) {
        toast("Who can see this updated");
      }
    }
  });

  root.querySelector("#ch-add-everyone")?.addEventListener("click", () => {
    if (peopleConfirmEl) peopleConfirmEl.hidden = true;
    if (everyoneConfirmEl) everyoneConfirmEl.hidden = false;
  });
  root.querySelector("#ch-everyone-cancel")?.addEventListener("click", () => {
    if (everyoneConfirmEl) everyoneConfirmEl.hidden = true;
    syncPeopleConfirm();
  });
  root.querySelector("#ch-everyone-apply")?.addEventListener("click", () => {
    const allIds = (S.members || []).map(m => m.id);
    if (meId && !allIds.includes(meId)) allIds.unshift(meId);
    paintPeopleSelection(allIds);
    committedPeople = new Set(selectedPeopleIds());
    hideInlineConfirms();
    if (!isNew) {
      if (persistExisting({ useFormPeople: true, close: false })) {
        toast("Everyone on the server added");
      }
    } else {
      toast("Everyone on the server selected");
    }
  });

  root.querySelector("#ch-manage-types")?.addEventListener("click", () => {
    openChannelTypesScopeModal({
      enabledCategoryIds,
      enabledCardIds,
      onDone: (cats, cards) => {
        enabledCategoryIds = cats;
        enabledCardIds = cards;
        paintScopeSummary();
        if (!isNew && existing?.kind === "event") {
          persistExisting({ useFormPeople: false, close: false });
        }
      },
    });
  });
  root.querySelector("#ch-manage-locs")?.addEventListener("click", () => {
    openChannelLocationsScopeModal({
      enabledLocations,
      onDone: (locs) => {
        enabledLocations = locs;
        paintScopeSummary();
        if (!isNew && existing?.kind === "event") {
          persistExisting({ useFormPeople: false, close: false });
        }
      },
    });
  });

  const delBtn = root.querySelector("#ch-delete");
  if (delBtn) delBtn.onclick = async () => {
    const label = existing?.name
      ? (personal ? `‘${existing.name}’` : `${existing.kind === "event" ? "" : "#"}${existing.name}`)
      : "this";
    if (await ashConfirm(`Delete ${label}? This can't be undone.`, { danger: true })) {
      send({ type: "deleteChannel", channelId: existing.id });
      onDeleted();
    }
  };

  root.querySelector("#channel-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!isNew) return; // Edits apply per-control; Create still uses this submit.
    const name = root.querySelector("#ch-name").value.trim();
    if (!name) return;
    if (!personal && everyoneConfirmEl && !everyoneConfirmEl.hidden) {
      toast("Confirm adding everyone first");
      everyoneConfirmEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }
    if (!personal && peopleDirty()) {
      syncPeopleConfirm();
      toast("Confirm who can see this first");
      peopleConfirmEl?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }
    const kind = currentKind();
    const access = readAccessPayload({ useFormPeople: true });
    if (kind !== "event" && Array.isArray(access.allowedUserIds) && !access.allowedUserIds.length) {
      toast("Add at least yourself to this group");
      return;
    }
    const rolePerms = readMatrixPayload();
    if (isBoard) {
      const conn = activeConn();
      if (typeof S !== "undefined" && conn?.id) {
        S.pendingBoardLand = { connId: conn.id, name };
      }
      send({
        type: "createBoard",
        name,
        shownKind: "event",
        allowedUserIds: access.privateMode ? access.allowedUserIds : null,
        autoIncludeNewMembers: !!access.autoIncludeNewMembers,
        rolePerms: rolePerms || (typeof defaultEventChannelViewPerms === "function"
          ? defaultEventChannelViewPerms(activeConn()) : null),
      });
      onSaved();
      return;
    }
    let linkedChatChannelId = null;
    let mirrorActivity = false;
    let cards = null, cats = null, locs = null;
    if (kind === "event") {
      cards = enabledCardIds;
      cats = enabledCategoryIds;
      locs = enabledLocations;
    }
    const payload = {
      type: "createChannel", name, kind,
      enabledCardIds: cards, enabledCategoryIds: cats, enabledLocations: locs,
      linkedChatChannelId, mirrorActivity,
    };
    if (kind === "event") {
      payload.rolePerms = rolePerms || defaultEventChannelViewPerms(activeConn());
      payload.allowedUserIds = null;
      payload.autoIncludeNewMembers = false;
    } else {
      payload.allowedUserIds = access.allowedUserIds;
      payload.autoIncludeNewMembers = access.autoIncludeNewMembers;
      if (!access.privateMode) {
        payload.rolePerms = rolePerms || defaultEventChannelViewPerms(activeConn());
      } else {
        // Private chats still get a seeded matrix (everyone view) for later role toggles.
        payload.rolePerms = existing?.rolePerms || defaultEventChannelViewPerms(activeConn());
      }
      payload.welcomeChannel = !!root.querySelector("#ch-welcome-channel")?.checked;
    }
    send(payload);
    onSaved();
  });
}

function openBoardModal() {
  const opened = AshModal.open({
    className: "channel-create-modal",
    html: `<div class="modal-card"><h4>New board</h4><div id="channel-create-mount"></div></div>`,
    singleton: "replace",
    graceMs: 500,
  });
  if (!opened) return;
  const { overlay, close: closeModal } = opened;
  try {
    mountChannelSettingsForm(overlay.querySelector("#channel-create-mount"), {
      existing: null,
      isNew: true,
      isBoard: true,
      preferredKind: "event",
      onCancel: closeModal,
      onSaved: closeModal,
      onDeleted: closeModal,
    });
  } catch (err) {
    console.error(err);
    closeModal();
    toast(err?.message || "Couldn’t open board editor");
  }
}

function openChannelModal(existing, preferredKind) {
  // Create-only — existing channels have no settings sheet.
  if (existing?.id) return;
  const opened = AshModal.open({
    className: "channel-create-modal",
    html: `<div class="modal-card"><h4>New channel</h4><div id="channel-create-mount"></div></div>`,
    singleton: "replace",
    graceMs: 500,
  });
  if (!opened) return;
  const { overlay, close: closeModal } = opened;
  try {
    mountChannelSettingsForm(overlay.querySelector("#channel-create-mount"), {
      existing: null,
      isNew: true,
      preferredKind,
      onCancel: closeModal,
      onSaved: closeModal,
      onDeleted: closeModal,
    });
  } catch (err) {
    console.error(err);
    closeModal();
    toast(err?.message || "Couldn’t open channel editor");
  }
}

