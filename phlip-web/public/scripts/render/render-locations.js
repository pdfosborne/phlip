/* render-locations.js — locations registry + pinned location/person pickers.
 * Globals out: openLocationsRegistry, openPinLocationPicker, openPinPersonPicker,
 *   openPinnedChannelSheet, …
 * Load after: render-roles.js; before: render-plan-modal.js
 */

/* ---------------------------- locations registry ---------------------------- */
/* Shared schema editor for places (§8 draft: venues today as labels; resources
   later). Server settings edits the server-wide registry; channel settings opens
   the same surface with per-group enable toggles (enabledLocations). Personal
   space edits this device's saved list. */

/**
 * @param {{ forChannel?: boolean, enabledLocations?: string[]|null, onChannelDone?: (locs: string[]|null) => void }} [opts]
 * forChannel: show enable checkboxes and call onChannelDone with the channel filter
 *   (null = all places on the registry). Registry CRUD still saves server/personal list.
 */
/** § pinned location channels — spin up a read-only aggregation channel for one place. */
function createPinnedLocationChannel(label) {
  const conn = activeConn();
  if (!conn || !canManageServer(conn)) return;
  if ((conn.channels || []).some(c => c.kind === "event" && c.pinnedLocationLabel === label)) {
    toast(`"${label}" already has a pinned channel`);
    return;
  }
  send({
    type: "createChannel",
    name: label.slice(0, 32),
    kind: "event",
    pinnedLocationLabel: label,
    enabledLocations: [label],
    rolePerms: defaultEventChannelViewPerms(conn),
    allowedUserIds: null,
    autoIncludeNewMembers: false,
  });
  toast(`Pinned channel created for "${label}"`);
}

/** § pinned location channels — sidebar "+" picker: pick a place to pin a channel to. */
function openPinLocationPicker() {
  const conn = activeConn();
  if (!conn || !canManageServer(conn)) return;

  const registry = locationsFor(conn);
  const pinnedLabels = new Set(
    (conn.channels || [])
      .filter(c => c.kind === "event" && c.pinnedLocationLabel != null)
      .map(c => String(c.pinnedLocationLabel).toLowerCase())
  );
  const available = registry
    .map(l => String(l.label || "").trim())
    .filter(Boolean)
    .filter(label => !pinnedLabels.has(label.toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  const opened = AshModal.open({
    className: "locations-modal pin-location-modal",
    html: `
    <div class="modal-card">
      <h4>Pin a location</h4>
      <p class="cat-hint">Give a place its own channel — a read-only feed of every booking there.</p>
      <div id="pin-loc-rows"></div>
      <div class="actions">
        <div></div>
        <div><button type="button" class="cancel" id="pin-loc-cancel">Cancel</button></div>
      </div>
    </div>`,
    singleton: "return",
  });
  if (!opened) return;
  const { overlay, close } = opened;
  const rowsEl = overlay.querySelector("#pin-loc-rows");

  if (!available.length) {
    rowsEl.innerHTML = `<p class="cat-hint" style="margin:8px 0 4px">${registry.length
      ? "Every place already has a pinned channel."
      : "No places yet — add some in Places first."}</p>`;
  } else {
    rowsEl.innerHTML = available.map(label => `
          <button type="button" class="loc-row pin-loc-row" data-label="${esc(label)}" aria-label="Pin a channel to ${esc(label)}">
            <span class="loc-row-ico">${ic("map-pin")}</span>
            <span class="loc-row-copy pin-loc-name">${esc(label)}</span>
            <span class="pin-loc-go">${ic("ticket")}</span>
          </button>`).join("");
    rowsEl.querySelectorAll(".pin-loc-row").forEach((btn) => {
      btn.onclick = () => {
        const label = btn.dataset.label;
        close();
        if (label) createPinnedLocationChannel(label);
      };
    });
  }

  overlay.querySelector("#pin-loc-cancel").onclick = close;
}

/** § pinned people channels — spin up a read-only board for one member's visible calendar. */
function createPinnedPersonChannel(userId) {
  const conn = activeConn();
  if (!conn || PersonalSpace.isPersonal(conn) || !canManageServer(conn)) return;
  if (!serverSettings(conn).allowPinnedPeople) {
    toast("Turn on pinned people in Event options first");
    return;
  }
  const member = (conn.members || []).find(m => m.id === userId);
  if (!member) {
    toast("That member isn’t on this server");
    return;
  }
  if ((conn.channels || []).some(c => c.kind === "event" && c.pinnedUserId === userId)) {
    toast(`${member.name || "That member"} already has a pinned channel`);
    return;
  }
  const name = String(member.name || "Member").trim().slice(0, 32) || "Member";
  send({
    type: "createChannel",
    name,
    kind: "event",
    pinnedUserId: userId,
    rolePerms: defaultEventChannelViewPerms(conn),
    allowedUserIds: null,
    autoIncludeNewMembers: false,
  });
  toast(`Pinned channel created for ${name}`);
}

/** § pinned people channels — sidebar "+" picker: pick a member to pin. */
function openPinPersonPicker() {
  const conn = activeConn();
  if (!conn || PersonalSpace.isPersonal(conn) || !canManageServer(conn)) return;
  if (!serverSettings(conn).allowPinnedPeople) {
    toast("Turn on pinned people in Event options first");
    return;
  }

  const pinnedIds = new Set(
    (conn.channels || [])
      .filter(c => c.kind === "event" && c.pinnedUserId != null)
      .map(c => c.pinnedUserId)
  );
  const members = (conn.members || [])
    .filter(m => m && m.id && !pinnedIds.has(m.id))
    .slice()
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

  const opened = AshModal.open({
    className: "locations-modal pin-person-modal",
    html: `
    <div class="modal-card">
      <h4>Pin a person</h4>
      <p class="cat-hint">Give a member their own channel — a read-only feed of every plan they can see. Others without access still see reserved times.</p>
      <div id="pin-person-rows"></div>
      <div class="actions">
        <div></div>
        <div><button type="button" class="cancel" id="pin-person-cancel">Cancel</button></div>
      </div>
    </div>`,
    singleton: "return",
  });
  if (!opened) return;
  const { overlay, close } = opened;
  const rowsEl = overlay.querySelector("#pin-person-rows");

  if (!members.length) {
    const total = (conn.members || []).length;
    rowsEl.innerHTML = `<p class="cat-hint" style="margin:8px 0 4px">${total
      ? "Every member already has a pinned channel."
      : "No members yet."}</p>`;
  } else {
    rowsEl.innerHTML = members.map(m => {
      const label = String(m.name || "Member").trim() || "Member";
      const face = typeof avatarFaceHtml === "function"
        ? avatarFaceHtml(m.id, label)
        : esc(label.slice(0, 1));
      const style = typeof avatarStyle === "function" ? avatarStyle(m.id) : "";
      return `
        <button type="button" class="loc-row pin-person-row" data-uid="${esc(m.id)}" aria-label="Pin a channel for ${esc(label)}">
          <span class="loc-row-ico pin-person-ava" style="${style}">${face}</span>
          <span class="loc-row-copy pin-loc-name">${esc(label)}</span>
          <span class="pin-loc-go">${ic("person")}</span>
        </button>`;
    }).join("");
    rowsEl.querySelectorAll(".pin-person-row").forEach((btn) => {
      btn.onclick = () => {
        const uid = btn.dataset.uid;
        close();
        if (uid) createPinnedPersonChannel(uid);
      };
    });
  }

  overlay.querySelector("#pin-person-cancel").onclick = close;
}

function openLocationsRegistry(opts = {}) {
  const conn = activeConn();
  const forChannel = !!opts.forChannel;
  const canEdit = canManageServer(conn);
  const canAdd = canEdit || canAddLocations(conn);
  // Full registry: managers or members who can add places. Channel scope is separate.
  if (!forChannel && !canEdit && !canAdd) return;

  const registry = locationsFor(conn);
  const allowed = opts.enabledLocations == null
    ? null
    : new Set(opts.enabledLocations.map(l => String(l).toLowerCase()));
  const preserveCategoryId = (label, existing) => {
    const raw = String(existing || "").trim();
    if (raw) {
      return typeof remapPlaceCategoryId === "function" ? remapPlaceCategoryId(raw) : raw;
    }
    if (typeof inferLocationCategoryId === "function") return inferLocationCategoryId(label) || "other";
    return "other";
  };
  const draft = registry.map(l => ({
    label: l.label,
    orig: l.label,
    categoryId: preserveCategoryId(l.label, l.categoryId),
    enabled: !forChannel || allowed == null || allowed.has(String(l.label).toLowerCase()),
  }));

  const title = forChannel ? "Locations in this group" : "Locations";
  const hint = forChannel
    ? (PersonalSpace.isPersonal(conn)
      ? "Places on this device. Tick which ones people can pick when planning here."
      : "Server places. Tick which ones apply in this group — unticked stay on the registry for other groups.")
    : (PersonalSpace.isPersonal(conn)
      ? "Places offered when planning on this device. Agendas can narrow the list."
      : "Places offered when planning on this server. Each event group can narrow which apply.");

  const opened = AshModal.open({
    className: "locations-modal",
    html: `
    <div class="modal-card">
      <h4>${esc(title)}</h4>
      <p class="cat-hint">${esc(hint)}</p>
      <div id="loc-rows"></div>
      <div class="cat-add-row"><button type="button" class="cat-add" id="loc-add" ${canAdd ? "" : "hidden"}>+ Add location</button></div>
      <div class="actions">
        <button type="button" class="cancel" id="loc-all" ${forChannel ? "" : "hidden"}>Select all</button>
        <div>
          <button type="button" class="cancel" id="loc-cancel">Cancel</button>
          <button type="button" class="save" id="loc-save">${canEdit || forChannel ? "Save" : "Done"}</button>
        </div>
      </div>
    </div>`,
    singleton: "return",
  });
  if (!opened) return;
  const { overlay, close } = opened;
  const rowsEl = overlay.querySelector("#loc-rows");

  const renderRows = () => {
    if (!draft.length) {
      rowsEl.innerHTML = `<p class="cat-hint" style="margin:8px 0 4px">${canAdd
        ? "No places yet — add cafés, parks, courts, or usual meet spots."
        : "No places on the registry yet."}</p>`;
      return;
    }
    const rows = draft
      .map((l, i) => ({ l, i }))
      .sort((a, b) => String(a.l.label || "").localeCompare(String(b.l.label || ""), undefined, { sensitivity: "base" }));
    rowsEl.innerHTML = rows.map(({ l, i }) => `
          <div class="loc-row${forChannel && !l.enabled ? " loc-row-off" : ""}" data-i="${i}">
            ${forChannel ? `<input type="checkbox" class="loc-row-enable" data-i="${i}" ${l.enabled ? "checked" : ""} title="Offer in this group" aria-label="Offer ${esc(l.label || "place")} in this group">` : ""}
            <span class="loc-row-ico">${ic("map-pin")}</span>
            <div class="loc-row-copy">
              <input class="loc-name" data-i="${i}" maxlength="60" value="${esc(l.label)}" placeholder="Place name" ${canEdit ? "" : "readonly"}>
            </div>
            ${canEdit && !forChannel ? `<button type="button" class="cat-pin" data-i="${i}" ${l.orig ? "" : "disabled"} title="${l.orig ? "Create a pinned events channel for this place" : "Save this place first"}" aria-label="Create pinned channel for ${esc(l.label || "place")}">${ic("ticket")}</button>` : ""}
            ${canEdit ? `<button type="button" class="cat-del" data-i="${i}" aria-label="Delete ${esc(l.label || "place")}">✕</button>` : ""}
          </div>`).join("");

    rowsEl.querySelectorAll(".loc-name").forEach(inp => {
      if (inp.readOnly) return;
      inp.oninput = () => { draft[Number(inp.dataset.i)].label = inp.value; };
    });
    rowsEl.querySelectorAll(".loc-row-enable").forEach(cb => {
      cb.onchange = () => {
        const i = Number(cb.dataset.i);
        draft[i].enabled = cb.checked;
        rowsEl.querySelector(`.loc-row[data-i="${i}"]`)?.classList.toggle("loc-row-off", !cb.checked);
      };
    });
    rowsEl.querySelectorAll(".cat-del").forEach(btn =>
      btn.onclick = async () => {
        const i = Number(btn.dataset.i);
        const label = (draft[i]?.label || "").trim() || "this place";
        if (!(await ashConfirm(`Remove "${label}" from the registry?`, { danger: true }))) return;
        draft.splice(i, 1);
        renderRows();
      });
    rowsEl.querySelectorAll(".cat-pin").forEach(btn =>
      btn.onclick = () => {
        const label = draft[Number(btn.dataset.i)]?.orig;
        if (label) createPinnedLocationChannel(label);
      });
  };
  renderRows();

  overlay.querySelector("#loc-add").onclick = () => {
    if (!canAdd) return;
    if (draft.length >= 50) { toast("That's plenty of places."); return; }
    draft.push({ label: "", orig: "", categoryId: "other", enabled: true });
    renderRows();
    rowsEl.querySelector(`.loc-row[data-i="${draft.length - 1}"] .loc-name`)?.focus();
  };

  overlay.querySelector("#loc-all")?.addEventListener("click", () => {
    draft.forEach(l => { l.enabled = true; });
    renderRows();
  });

  overlay.querySelector("#loc-cancel").onclick = close;
  overlay.querySelector("#loc-save").onclick = () => {
    const cleanRows = [];
    const seen = new Set();
    for (const row of draft) {
      const label = (row.label || "").trim().slice(0, 60);
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      cleanRows.push({
        label,
        orig: row.orig,
        categoryId: preserveCategoryId(label, row.categoryId),
        enabled: row.enabled !== false,
      });
    }
    const cleanPayload = cleanRows.map(r => ({ label: r.label, categoryId: r.categoryId }));

    if (canEdit || (canAdd && cleanRows.some(r => !r.orig))) {
      if (PersonalSpace.isPersonal(conn)) {
        const prevByOrig = new Map(
          draft.map(row => [row.orig, LOCATIONS.find(l => l.label === row.orig)]).filter(([, l]) => l)
        );
        const prevByKey = new Map(LOCATIONS.map(l => [String(l.label || "").toLowerCase(), l]));
        const next = [];
        const used = new Set();
        for (const row of cleanRows) {
          const key = row.label.toLowerCase();
          if (used.has(key)) continue;
          used.add(key);
          const prev = (row.orig && prevByOrig.get(row.orig)) || prevByKey.get(key);
          next.push(prev
            ? { ...prev, label: row.label, categoryId: row.categoryId }
            : { label: row.label, categoryId: row.categoryId, uses: {} });
        }
        // Members who may only add: keep existing rows they couldn't edit out of draft.
        if (!canEdit) {
          const kept = new Set(next.map(l => l.label.toLowerCase()));
          for (const l of LOCATIONS) {
            const key = String(l.label || "").toLowerCase();
            if (!kept.has(key)) next.push(l);
          }
        }
        LOCATIONS = next;
        storageSetJson("ash_locations_v1", LOCATIONS);
        renderAll();
      } else if (canEdit) {
        send({ type: "updateLocations", locations: cleanPayload });
      } else {
        // Add-only path: append new labels the member is allowed to introduce.
        for (const row of cleanRows) {
          if (row.orig) continue;
          send({ type: "addLocation", location: row.label, categoryId: row.categoryId });
        }
      }
    }

    if (forChannel && typeof opts.onChannelDone === "function") {
      if (!cleanRows.length) opts.onChannelDone(null);
      else {
        const allOn = cleanRows.every(r => r.enabled);
        opts.onChannelDone(allOn ? null : cleanRows.filter(r => r.enabled).map(r => r.label));
      }
    }
    close();
  };
}

/** Long-press a pinned location/person row — remove the aggregation channel. */
function openPinnedChannelSheet(channelId) {
  const conn = typeof activeConn === "function" ? activeConn() : null;
  if (!conn || typeof canManageServer !== "function" || !canManageServer(conn)) return;
  const ch = (conn.channels || []).find((c) => c.id === channelId);
  if (!ch || (ch.pinnedLocationLabel == null && ch.pinnedUserId == null)) return;

  const isPlace = ch.pinnedLocationLabel != null;
  const title = ch.name || ch.pinnedLocationLabel || "Pinned";
  const state = typeof sidebarChannelSectionState === "function"
    ? sidebarChannelSectionState(channelId)
    : null;
  const canMove = !!(state && state.count >= 2);
  const ico = (name) => (typeof ic === "function" ? ic(name, "ico-inline") : "");

  if (typeof cancelArmedSideNavTap === "function") cancelArmedSideNavTap();
  if (typeof suppressSideNavTaps === "function") suppressSideNavTaps(500);

  const opened = typeof AshModal !== "undefined" && AshModal.open
    ? AshModal.open({
      className: "channel-settings-sheet sidebar-menu-sheet",
      html: `
        <div class="channel-settings-sheet-card" role="dialog" aria-modal="true" aria-labelledby="pin-sheet-title">
          <div class="channel-settings-sheet-handle" aria-hidden="true"></div>
          <div class="channel-settings-sheet-head">
            <h4 id="pin-sheet-title" class="channel-settings-sheet-title" tabindex="-1">${esc(title)}</h4>
          </div>
          <div class="channel-settings-sheet-body">
            <div class="channel-settings-sheet-actions sidebar-menu-actions">
              ${canMove ? `<button type="button" class="ch-manage-btn sidebar-menu-row" data-pin-act="up">
                <span class="sidebar-menu-row-main">${ico("chevron-up")}<span class="sidebar-menu-row-label">Move up</span></span>
              </button>
              <button type="button" class="ch-manage-btn sidebar-menu-row" data-pin-act="down">
                <span class="sidebar-menu-row-main">${ico("chevron-down")}<span class="sidebar-menu-row-label">Move down</span></span>
              </button>` : ""}
              <button type="button" class="ch-manage-btn sidebar-menu-row sidebar-menu-row-danger" data-pin-act="remove">
                <span class="sidebar-menu-row-main">${ico("trash")}<span class="sidebar-menu-row-label">Remove pin</span></span>
              </button>
            </div>
          </div>
        </div>`,
      singleton: "replace",
      graceMs: 450,
      closeOnEscape: true,
      closeOnBackdrop: true,
      trapFocus: true,
      restoreFocus: true,
      initialFocus: "#pin-sheet-title",
    })
    : null;
  if (!opened) return;
  const { overlay, close } = opened;
  const card = overlay.querySelector(".channel-settings-sheet-card");
  if (card && typeof bindBoardSettingsSheetDismiss === "function") {
    bindBoardSettingsSheetDismiss(card, close);
  } else if (card && typeof bindChannelSettingsSheetDismiss === "function") {
    bindChannelSettingsSheetDismiss(overlay, card, close);
  }
  overlay.querySelectorAll("[data-pin-act]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const act = btn.dataset.pinAct;
      if (act === "up" || act === "down") {
        close();
        if (typeof nudgeSidebarChannel === "function") {
          nudgeSidebarChannel(channelId, act === "up" ? -1 : 1);
        }
        return;
      }
      if (act !== "remove") return;
      const place = isPlace
        ? `Remove this pinned location? Events at this place stay on their boards.`
        : `Remove this pinned person? Their events stay on their boards.`;
      const ok = typeof ashConfirm === "function"
        ? await ashConfirm(place, { danger: true, ok: "Remove" })
        : true;
      if (!ok) return;
      if (typeof send === "function") send({ type: "deleteChannel", channelId });
    });
  });
}

