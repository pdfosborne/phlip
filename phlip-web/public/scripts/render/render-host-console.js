/* render-host-console.js — host console controls + setup-guide modal.
 * Globals out: fillConsole*, openSetupGuideModal, consoleAddToggle, …
 * Load after: render-share.js; before: channel.js
 */

function consoleAddToggle(root, conn, label, key, onMsg, offMsg, { defaultOn = true } = {}) {
  const ss = serverSettings(conn);
  const on = defaultOn ? ss[key] !== false : !!ss[key];
  const tog = document.createElement("label");
  tog.className = "server-settings-row side-toggle console-row";
  tog.innerHTML = `<span>${label}</span><input type="checkbox" ${on ? "checked" : ""}>`;
  const inp = tog.querySelector("input");
  inp.onchange = () => {
    send({ type: "updateServerSettings", [key]: !!inp.checked });
    conn.serverSettings = { ...(conn.serverSettings || {}), [key]: !!inp.checked };
    toast(inp.checked ? onMsg : offMsg);
  };
  root.appendChild(tog);
}

/** Shared console dropdown row — appends into whichever section body is passed in. */
function consoleAddPermSelect(root, conn, label, key, options, value, toastFn) {
  const row = document.createElement("label");
  row.className = "server-settings-row side-toggle console-row";
  row.innerHTML = `<span>${label}</span>
    <select class="people-role-select" data-perm="${esc(key)}">
      ${options.map(o =>
        `<option value="${esc(o.value)}" ${o.value === value ? "selected" : ""}>${esc(o.label)}</option>`
      ).join("")}
    </select>`;
  const sel = row.querySelector("select");
  sel.onchange = () => {
    const v = sel.value;
    const patch = { [key]: v };
    // Keep legacy boolean in sync for older clients / presets.
    if (key === "createEvents") patch.allowUserCreateEvents = v === "everyone";
    if (key === "liveProfilePhotos") patch.allowProfilePics = v !== "off";
    send({ type: "updateServerSettings", ...patch });
    conn.serverSettings = { ...(conn.serverSettings || {}), ...patch };
    toast(toastFn(v));
  };
  root.appendChild(row);
}

function consoleAddHint(root, text) {
  const hint = document.createElement("div");
  hint.className = "side-role-hint";
  hint.textContent = text;
  root.appendChild(hint);
}

/** Console → Default role: who new people join as. */
function fillConsoleDefaultRole(root, conn) {
  if (!root || !conn || !canManageServer(conn)) return;
  const ss = serverSettings(conn);
  const roleChoices = defaultRoleChoices(conn);
  const curDefault = roleChoices.includes(ss.defaultRole) ? ss.defaultRole : ROLE_USER;
  consoleAddPermSelect(root, conn, "New people join as", "defaultRole",
    roleChoices.map(r => ({ value: r, label: roleLabel(r) })), curDefault,
    (v) => `New members start as ${roleLabel(v)}`);
  consoleAddHint(root, "Applied when you approve someone for the first time. Existing members are unchanged.");
}


/** Console → Profiles & media. */
function fillConsoleProfilesMedia(root, conn) {
  if (!root || !conn || !canManageServer(conn)) return;
  const ss = serverSettings(conn);
  consoleAddPermSelect(root, conn, "Live profile photos", "liveProfilePhotos",
    [
      { value: "off", label: "No live photos" },
      { value: "online", label: "Profile photos as online indicator" },
      { value: "always", label: "Always viewable profile photos" },
    ],
    ss.liveProfilePhotos,
    (v) => v === "off"
      ? "Live profile photos off"
      : v === "always"
        ? "Profile photos stored on the host"
        : "Profile photos shown while online (host memory only)");
  consoleAddHint(root,
    "No live photos · Online indicator keeps photos in host memory while online (not saved) · Always viewable stores photos on the host.");
  consoleAddToggle(root, conn, "Allow users to draw profile images, chat reactions, and event icons", "allowUserDraw",
    "Drawing on", "Drawing off");
}

/** Console → Events. */
function fillConsoleEventsSettings(root, conn) {
  if (!root || !conn || !canManageServer(conn)) return;
  consoleAddToggle(root, conn, "Allow multiple places per event", "allowMultiLocations",
    "Events can use several places at once", "One place per event", { defaultOn: false });
  consoleAddHint(root, "Useful for clubs — e.g. a session that books Court 1 and Court 3 together.");
  consoleAddToggle(root, conn, "Require approval for new events by default", "eventsRequireApprovalDefault",
    "New events need approval unless a channel opts out", "New events no longer need approval by default",
    { defaultOn: false });
  consoleAddHint(root, "Applies to every event channel. Individual channels can also turn this on themselves.");

  // § pinned people — opt-in with an explicit agreement (reserved-time leakage).
  {
    const key = "allowPinnedPeople";
    const ss = serverSettings(conn);
    const on = !!ss[key];
    const tog = document.createElement("label");
    tog.className = "server-settings-row side-toggle console-row";
    tog.innerHTML = `<span>Allow pinned people channels</span><input type="checkbox" ${on ? "checked" : ""}>`;
    const inp = tog.querySelector("input");
    inp.onchange = async () => {
      if (inp.checked) {
        const ok = await ashConfirm(
          "Pinned people channels let this server show a member’s visible calendar to others who can see that board. "
          + "Where those others can’t open the home group, they still see a reserved time block (no title or details). "
          + "Best for small trusted groups such as families. Turn this on?",
          { ok: "Enable", cancel: "Cancel" },
        );
        if (!ok) {
          inp.checked = false;
          return;
        }
      }
      send({ type: "updateServerSettings", [key]: !!inp.checked });
      conn.serverSettings = { ...(conn.serverSettings || {}), [key]: !!inp.checked };
      toast(inp.checked
        ? "Pinned people channels enabled — use the sidebar to pin a member"
        : "Pinned people channels disabled");
      try { renderSidebar(); } catch {}
    };
    root.appendChild(tog);
  }
  consoleAddHint(root, "Creates read-only boards of one member’s visible plans. Viewers without access still see reserved times.");
}

/** Console → Access control. */
function fillConsoleAccessControl(root, conn) {
  if (!root || !conn || !canManageServer(conn)) return;
  const ss = serverSettings(conn);
  const ageRow = document.createElement("label");
  ageRow.className = "server-settings-row side-toggle console-row";
  const curAge = clampServerMinAge(ss.minAge);
  ageRow.innerHTML = `<span>Age rating (minimum)</span>
    <select class="people-role-select" id="console-min-age">
      <option value="18" ${curAge === 18 ? "selected" : ""}>18+</option>
      ${curAge !== 18 ? `<option value="${curAge}" selected>${curAge}+</option>` : ""}
    </select>`;
  ageRow.querySelector("select").onchange = (e) => {
    const minAge = clampServerMinAge(e.target.value);
    send({ type: "updateServerSettings", minAge });
    conn.serverSettings = { ...(conn.serverSettings || {}), minAge };
    toast(`Age rating set to ${minAge}+`);
  };
  root.appendChild(ageRow);
  consoleAddHint(root, "Joiners must confirm they meet this age before signing in. Minimum allowed is 18+.");
}

/** Settings → Auto-delete options: wipe ended events + chat retention. */
function fillConsoleAutoDelete(root, conn) {
  if (!root || !conn || !canManageServer(conn)) return;
  const ss = serverSettings(conn);

  const dangerInfo = document.createElement("div");
  dangerInfo.className = "side-role-hint console-danger-info";
  dangerInfo.textContent = "Irreversible deletion — wiped data cannot be restored.";
  root.appendChild(dangerInfo);

  {
    const row = document.createElement("label");
    row.className = "server-settings-row side-toggle console-row";
    row.innerHTML = `<span>Wipe ended events on this server</span>
      <input type="checkbox" ${ss.purgeEndedEvents ? "checked" : ""}>`;
    const inp = row.querySelector("input");
    inp.onchange = async () => {
      const on = !!inp.checked;
      if (on && !(await ashConfirm(
        "After each event ends (plus a short grace period), this server deletes that plan and related RSVPs, notes, Broadcasts, and notifications.\n\n" +
        "Members can keep Memories on their own devices.\n\nContinue?",
        { danger: true }
      ))) {
        inp.checked = false;
        return;
      }
      send({ type: "updateServerSettings", purgeEndedEvents: on });
      conn.serverSettings = { ...(conn.serverSettings || {}), purgeEndedEvents: on };
      toast(on ? "Ended events will be wiped on this server" : "Past events stay on this server");
    };
    root.appendChild(row);
  }
  {
    const curChatRet = clampChatRetentionDays(ss.chatRetentionDays);
    const row = document.createElement("label");
    row.className = "server-settings-row side-toggle console-row";
    row.innerHTML = `<span>Wipe chat older than</span>
      <select class="people-role-select">
        <option value="0" ${curChatRet === 0 ? "selected" : ""}>Keep forever</option>
        <option value="1" ${curChatRet === 1 ? "selected" : ""}>1 day</option>
        <option value="7" ${curChatRet === 7 ? "selected" : ""}>7 days</option>
        <option value="30" ${curChatRet === 30 ? "selected" : ""}>30 days</option>
        <option value="90" ${curChatRet === 90 ? "selected" : ""}>90 days</option>
      </select>`;
    const sel = row.querySelector("select");
    sel.onchange = async () => {
      const days = clampChatRetentionDays(sel.value);
      if (days > 0 && !(await ashConfirm(
        `Delete chat messages older than ${days} day${days === 1 ? "" : "s"} on this server?\n\nContinue?`,
        { danger: true }
      ))) {
        sel.value = String(curChatRet);
        return;
      }
      send({ type: "updateServerSettings", chatRetentionDays: days });
      conn.serverSettings = { ...(conn.serverSettings || {}), chatRetentionDays: days };
      toast(days > 0
        ? `Chat older than ${days} day${days === 1 ? "" : "s"} will be wiped on this server`
        : "Chat kept forever on this server");
    };
    root.appendChild(row);
  }
  const retNote = document.createElement("div");
  retNote.className = "side-role-hint";
  retNote.textContent = "Already-delivered copies on members’ devices are not recalled.";
  root.appendChild(retNote);
}

/**
 * Console → Demo users: host/admin bulk-create or purge synthetic members that
 * RSVP and chat like real people (server-gated by ss.demoUsersEnabled — an
 * app-developer kill switch, not a per-server toggle, so no UI to flip it here).
 */
function fillConsoleDemoUsers(root, conn) {
  if (!root || !conn || !canManageServer(conn)) return;
  const demoCount = (S.members || []).filter(m => m.isDemo).length;

  const hint = document.createElement("div");
  hint.className = "side-role-hint";
  hint.textContent = "Fake members that RSVP and chat like real people, with human-like delays — handy for previewing a server before real people join. New demo users always join as members.";
  root.appendChild(hint);

  const row = document.createElement("div");
  row.className = "server-settings-row console-row";
  row.innerHTML = `<span>Demo users</span>
    <span class="muted">${demoCount ? `${demoCount} on server` : "None yet"}</span>`;
  root.appendChild(row);

  const controls = document.createElement("div");
  controls.className = "console-demo-controls";
  controls.innerHTML = `
    <input type="number" class="console-demo-count" min="1" max="100" value="10" aria-label="Number of demo users to add">
    <button type="button" class="save console-demo-add">Add members</button>`;
  root.appendChild(controls);

  const countInput = controls.querySelector(".console-demo-count");
  controls.querySelector(".console-demo-add").onclick = () => {
    const count = Math.max(1, Math.min(100, parseInt(countInput.value, 10) || 10));
    send({ type: "createDemoUsers", count, role: ROLE_USER });
    toast(`Adding ${count} demo member${count === 1 ? "" : "s"}…`);
  };

  if (demoCount) {
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "server-settings-row console-row remove-server-link";
    removeBtn.textContent = "Remove all demo users";
    removeBtn.onclick = async () => {
      if (!(await ashConfirm(
        `Remove all ${demoCount} demo user${demoCount === 1 ? "" : "s"}? This deletes their RSVPs, reactions, notes, and chat messages on this server.`,
        { danger: true, ok: "Remove all" },
      ))) return;
      send({ type: "removeDemoUsers" });
      toast("Removing demo users…");
    };
    root.appendChild(removeBtn);
  }
}

function presetLabel(id) {
  switch (String(id || "").toLowerCase()) {
    case "club": return "Club";
    case "circles": return "Circles";
    case "friend": return "Friend group";
    case "family": return "Family";
    case "business": return "Business";
    case "scratch": return "From scratch";
    default: return "";
  }
}


/** §6 Setup guide — re-runnable preset with a plain-language diff before apply. */
function openSetupGuideModal(conn = activeConn()) {
  if (!conn || !canManageServer(conn)) {
    toast("Only admins can run the Setup guide");
    return;
  }
  const ss = serverSettings(conn);
  const current = String(ss.setupPreset || "friend").toLowerCase();
  const packs = {
    friend: {
      title: "Friend group",
      blurb: "A shared hub for friends to suggest plans, with extra private boards for smaller groups.",
      types: ["Dinner", "Drinks", "Film night", "Games", "Trip", "Birthday"],
      chats: ["Welcome", "The crew (members)"],
      events: ["Events", "London based", "Uni mates", "Home mates"],
      role: "Member",
      eventsWho: "Members and above",
      freeform: true,
      auto: true,
      offerAuto: true,
    },
    family: {
      title: "Family",
      blurb: "One shared family board, plus the option to follow individual family members' plans in their own boards.",
      types: ["Meal", "Outing", "Chore"],
      chats: ["Welcome"],
      events: ["Family"],
      role: "Member",
      eventsWho: "Members and above",
      freeform: true,
      auto: true,
      offerAuto: true,
    },
    circles: {
      title: "Separate circles",
      blurb: "Separate Work, Home and Friends boards, each with its own people and access, rather than one shared group board.",
      types: ["Meetup", "Dinner", "Trip"],
      chats: ["Welcome", "Work", "Home"],
      events: ["Work", "Home", "Friends"],
      role: "Member",
      eventsWho: "Members and above",
      freeform: true,
      auto: false,
      offerAuto: false,
    },
    club: {
      title: "Club or organisation",
      blurb: "Structured sessions. New joiners are viewers.",
      types: ["Meetup", "Class", "Coffee morning", "Talk"],
      chats: ["Welcome", "Members", "Committee", "Admin"],
      events: ["Fixtures", "Open-invite", "Socials"],
      role: "Viewer",
      eventsWho: "Moderators and above",
      freeform: false,
      auto: false,
      offerAuto: true,
    },
    business: {
      title: "Business",
      blurb: "You post the classes and events — customers RSVP.",
      types: ["Class", "Event"],
      chats: ["Welcome"],
      events: ["Classes", "Open sessions"],
      role: "Viewer",
      eventsWho: "Admin only",
      freeform: false,
      auto: true,
      offerAuto: true,
    },
    scratch: {
      title: "Start from scratch",
      blurb: "Open permissions, no auto-include — you shape groups and types.",
      types: ["Dinner", "Drinks", "Film night", "Games", "Party", "Sport"],
      chats: ["Welcome", "Group chat", "Direct"],
      events: ["Events", "Section", "Private plans"],
      role: "Member",
      eventsWho: "Members and above",
      freeform: true,
      auto: false,
      offerAuto: true,
    },
  };
  const opened = AshModal.open({
    className: "setup-guide-modal",
    html: `
    <div class="modal-card">
      <h4>Setup guide</h4>
      <p class="cat-hint">Pick how this server should feel. Presets write starting values — everything stays editable afterwards.</p>
      <div class="kind-pick" id="setup-preset-pick" style="flex-direction:column;gap:8px">
        ${Object.entries(packs).map(([id, p]) => `
          <label class="kind-opt" style="align-items:flex-start">
            <input type="radio" name="setup-preset" value="${id}" ${id === current ? "checked" : ""}>
            <span><strong>${esc(p.title)}</strong><br><span class="muted">${esc(p.blurb)}</span></span>
          </label>`).join("")}
      </div>
      <div class="field" id="setup-activity-field" style="display:${(current === "club" || current === "business") ? "block" : "none"};margin-top:10px">
        <label for="setup-activity">${current === "business" ? "What do you host?" : "Activity"}</label>
        <input id="setup-activity" maxlength="40" placeholder="${current === "business" ? "e.g. Pottery classes" : "e.g. Tennis"}" value="${esc(ss.setupActivity || "")}">
      </div>
      <div class="cat-hint" id="setup-diff" style="margin-top:12px"></div>
      <label class="check-row" style="margin-top:10px">
        <input type="checkbox" id="setup-replace-types" checked>
        Replace starter event types (keeps types still used by events)
      </label>
      <div class="actions" style="margin-top:12px">
        <button type="button" class="cancel" id="setup-cancel">Cancel</button>
        <button type="button" class="save" id="setup-apply">Apply preset</button>
      </div>
    </div>`,
    singleton: "return",
  });
  if (!opened) return;
  const { overlay, close } = opened;
  overlay.querySelector("#setup-cancel").onclick = close;

  const paintDiff = () => {
    const id = overlay.querySelector('input[name="setup-preset"]:checked')?.value || "friend";
    const p = packs[id];
    const actField = overlay.querySelector("#setup-activity-field");
    const needsActivity = id === "club" || id === "business";
    if (actField) actField.style.display = needsActivity ? "block" : "none";
    const actLabel = overlay.querySelector('label[for="setup-activity"]');
    const actInput = overlay.querySelector("#setup-activity");
    if (actLabel) actLabel.textContent = id === "business" ? "What do you host?" : "Activity";
    if (actInput) actInput.placeholder = id === "business" ? "e.g. Pottery classes" : "e.g. Tennis";
    const curRole = ss.defaultRole === "viewer" ? "Viewer" : "Member";
    const curEvents = memberPermLabel(ss.createEvents);
    const curFree = ss.allowFreeform !== false;
    const curAuto = (ss.offerAutoInclude !== false) &&
      (conn.channels || []).some(c => c.kind === "event" && c.autoIncludeNewMembers);
    const lines = [];
    if (presetLabel(ss.setupPreset) !== p.title) lines.push(`Preset: ${presetLabel(ss.setupPreset) || "none"} → ${p.title}`);
    if (curRole !== p.role) lines.push(`New joiners: ${curRole} → ${p.role}`);
    if (curEvents !== p.eventsWho) lines.push(`Create events: ${curEvents} → ${p.eventsWho}`);
    if (curFree !== p.freeform) lines.push(`“Other” freeform: ${curFree ? "on" : "off"} → ${p.freeform ? "on" : "off"}`);
    if (!!curAuto !== p.auto) lines.push(`Standing auto-include on example boards: ${curAuto ? "on" : "off"} → ${p.auto ? "on" : "off"}`);
    lines.push(`Chats (lobby · sub-group · direct): ${p.chats.join(" · ")}`);
    lines.push(`Event boards: ${p.events.join(" · ")}`);
    lines.push(`Starter types: ${p.types.join(" · ")}`);
    if (id === "circles") lines.push("Standing auto-include option hidden when creating groups.");
    if (id === "club") lines.push("Invent types: moderators · add places: admin. Name a court/pitch sport (e.g. Tennis) for numbered venues and multi-location bookings.");
    if (id === "family") lines.push("Turns on pinned-people boards — follow one person's plans once there's more than one of you.");
    if (id === "business") lines.push("Only admins post classes and events; members RSVP.");
    overlay.querySelector("#setup-diff").innerHTML = lines.map(l => `• ${esc(l)}`).join("<br>");
  };
  overlay.querySelectorAll('input[name="setup-preset"]').forEach(r => {
    r.onchange = paintDiff;
  });
  paintDiff();

  overlay.querySelector("#setup-apply").onclick = () => {
    const preset = overlay.querySelector('input[name="setup-preset"]:checked')?.value || "friend";
    const activity = overlay.querySelector("#setup-activity")?.value.trim() || "";
    const replaceTypes = !!overlay.querySelector("#setup-replace-types")?.checked;
    send({
      type: "applySetupPreset",
      preset,
      activity: (preset === "club" || preset === "business") ? activity : "",
      replaceTypes,
      replaceLocations: true,
    }, conn.id);
    toast(`Applying ${packs[preset]?.title || preset}…`);
    close();
  };
}
