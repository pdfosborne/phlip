/* helpers-part3.js — split from helpers.js (Part 3 size ceiling).
 * Load after: helpers-part2.js; part of helpers cluster.
 */

async function unlockEdgeGate(httpBase, inviteCode, inviteSlug = "") {
  const base = String(httpBase || "").replace(/\/+$/, "");
  const code = String(inviteCode || "").trim();
  const slug = typeof normInviteSlug === "function"
    ? normInviteSlug(inviteSlug || code)
    : String(inviteSlug || code || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  // LAN / cleartext — no edge gate.
  if (!base || !/^https:/i.test(base)) return { ok: true, skipped: true };
  // Public HTTPS without a personal slug cannot unlock — do not POST a rotating code.
  if (!slug || slug.length < 8) {
    if (code && code.length < 8) {
      return {
        ok: false,
        error: "Open a personal invite link from someone on this server.",
        needInviteLink: true,
      };
    }
    return { ok: true, skipped: true };
  }
  try {
    const body = { slug, inviteSlug: slug };
    const res = await serverFetch(`${base}/edge/gate`, {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8", "Accept": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      let token = "";
      try {
        const parsed = await res.json();
        token = String(parsed?.token || "").trim();
      } catch { /* malformed/cookie-only response is not enough for WebView */ }
      if (token) {
        rememberEdgeInvite(base, token);
        return { ok: true };
      }
      return {
        ok: false,
        error: "Couldn't confirm the Public invite token. Ask the host to refresh Public hosting.",
        needInviteLink: true,
      };
    }
    if (res.status === 401) {
      return {
        ok: false,
        error: "Couldn't unlock this Public server with that invite link.",
        needInviteLink: true,
      };
    }
    return {
      ok: false,
      error: `Public invite verification failed (${res.status || "server error"}).`,
      needInviteLink: true,
    };
  } catch {
    return {
      ok: false,
      error: "Couldn't reach the Public invite verifier. Check your connection and try again.",
      needInviteLink: true,
    };
  }
}

/** Candidate bases for GET /j/:slug metadata (each server's public/LAN origin). */
function personalInviteMetaBases() {
  const bases = [];
  const add = (raw) => {
    const b = String(raw || "").replace(/\/+$/, "");
    if (!b || !/^https?:/i.test(b)) return;
    // Apex is App Link only — not a join origin for metadata.
    if (/^https:\/\/(?:www\.)?phlipapp\.com$/i.test(b)) return;
    if (!bases.includes(b)) bases.push(b);
  };
  try {
    if (typeof location !== "undefined" && /^https?:/i.test(location.origin || "")) add(location.origin);
  } catch {}
  try {
    for (const c of Object.values(S?.conns || {})) {
      if (!c || (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(c))) continue;
      add(c.sharePublic || c.urlPublic || "");
      add(c.shareLan || c.urlLan || "");
      const u = String(c.url || "");
      if (/^wss:/i.test(u)) add(u.replace(/^wss:/i, "https:").replace(/\/+$/, ""));
      if (/^ws:/i.test(u)) add(u.replace(/^ws:/i, "http:").replace(/\/+$/, ""));
    }
  } catch {}
  try {
    if (typeof loadServers === "function") {
      for (const e of loadServers()) {
        add(e.sharePublic || e.urlPublic || "");
        add(e.shareLan || e.urlLan || "");
        const u = String(e.url || "");
        if (/^wss:/i.test(u)) add(u.replace(/^wss:/i, "https:").replace(/\/+$/, ""));
        if (/^ws:/i.test(u)) add(u.replace(/^ws:/i, "http:").replace(/\/+$/, ""));
        if (/^https?:/i.test(u)) add(httpBaseFromUrl(u) || u);
      }
    }
  } catch {}
  return bases;
}

/**
 * Resolve personal invite metadata from Worker GET /j/:slug.
 * Tries saved Public hosts first, then phlipapp.com.
 */
async function fetchPersonalInviteMeta(slug) {
  const s = typeof normInviteSlug === "function"
    ? normInviteSlug(slug)
    : String(slug || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!s || s.length < 8) return null;
  for (const base of personalInviteMetaBases()) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      let res;
      try {
        res = await serverFetch(`${base}/j/${encodeURIComponent(s)}`, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(t);
      }
      if (!res?.ok) continue;
      const data = await res.json().catch(() => null);
      if (!data || data.ok !== true) continue;
      return {
        ...data,
        slug: s,
        probedFrom: base,
        publicUrl: data.publicUrl || (data.publicHost ? `https://${data.publicHost}` : ""),
      };
    } catch {
      /* try next base */
    }
  }
  return null;
}

/** Public /ash-ok meta for the join agreement (before personal data). */
function publicInviteMetaConfirmed(httpBase, inviteSlug, parsed) {
  const needsInviteTier = /^https:/i.test(String(httpBase || "")) && !!inviteSlug;
  if (!needsInviteTier) return true;
  return !!(parsed && typeof parsed.name === "string" && parsed.name.trim());
}

async function fetchJoinMeta(httpBase, inviteCode = "", inviteSlug = "") {
  const base = String(httpBase || "").replace(/\/+$/, "");
  if (!base) throw new Error("No server URL");
  // Invite code optional — brand-new joins use personal inviteSlug + host approval.
  const unlocked = await unlockEdgeGate(base, inviteCode, inviteSlug);
  if (!unlocked.ok) {
    const err = new Error(unlocked.error || "Join code rejected");
    err.status = 401;
    throw err;
  }
  const probeUrl = `${base}/ash-ok`;
  let res = null;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      res = await serverFetch(probeUrl, { method: "GET", signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
    lastStatus = res?.status || 0;
    if (res?.ok) break;
    if (res?.status === 401 || res?.status === 403) {
      // Gate HTML or forbidden — try unlock again then retry once.
      if ((inviteCode || inviteSlug) && attempt === 0) {
        await unlockEdgeGate(base, inviteCode, inviteSlug);
        continue;
      }
      break;
    }
    if (res?.status !== 400 || attempt === 2) break;
    await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
  }
  if (!res?.ok) {
    const err = new Error(
      lastStatus === 401 || lastStatus === 403
        ? "Couldn't unlock this Public server yet — ask the host for their invite link."
        : `Server responded ${lastStatus || "?"} at ${base}`,
    );
    err.status = lastStatus;
    throw err;
  }
  const text = await res.text();
  let meta = { ok: true, name: "Phlip server", iconText: "", minAge: 18, serverPic: "" };
  let confirmedInviteMeta = publicInviteMetaConfirmed(base, inviteSlug, null);
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      confirmedInviteMeta = publicInviteMetaConfirmed(base, inviteSlug, parsed);
      meta = {
        ok: true,
        name: String(parsed.name || "Phlip server").trim() || "Phlip server",
        iconText: String(parsed.iconText || "").trim().slice(0, 4),
        minAge: clampServerMinAge(parsed.minAge),
        serverPic: typeof parsed.serverPic === "string" ? parsed.serverPic : "",
        joinTag: typeof parsed.joinTag === "string" ? normJoinTag(parsed.joinTag) : "",
      };
    }
  } catch {
    // Legacy plain "ok" / HTML gate mis-detect — still mark reachable only if JSON-ish.
    if (/^\s*</.test(text)) {
      const err = new Error("Public gate is on — open the host's personal invite link.");
      err.status = 401;
      throw err;
    }
  }
  // Public personal invites must be on the Worker invite tier here. The
  // anonymous health projection is intentionally only {"ok":true}; accepting
  // it as join metadata both hides the server name and lets the wizard proceed
  // to an /ash-join request that the edge will reject.
  if (!confirmedInviteMeta) {
    const err = new Error("Couldn't confirm this personal invite. Open the current link from the host again.");
    err.status = 401;
    throw err;
  }
  return meta;
}

function joinAgreementRulesHtml(meta) {
  const age = clampServerMinAge(meta?.minAge);
  return `
    <ul class="join-accept-list">
      <li>You confirm you are <strong>at least ${age} years old</strong> (this server’s age rating).</li>
      <li>This group’s data lives on the <strong>host’s phone</strong> — not on a Phlip company server.</li>
      <li>The host sees your <strong>display name</strong>, can <strong>Approve or Deny</strong> you, and can remove you later.</li>
      <li>You create your own <strong>password for this server</strong>. Keep it private; the host never receives it in plain text.</li>
      <li>This server’s <strong>icon</strong> will be saved on your device so you can recognise it in your list.</li>
      <li>Only join people and servers you trust. If you leave or are removed, your access ends.</li>
    </ul>`;
}

function joinAgreementHeaderHtml(meta) {
  const name = esc(meta?.name || "Phlip server");
  const age = clampServerMinAge(meta?.minAge);
  const pic = meta?.serverPic || "";
  const glyph = esc((meta?.iconText || "").trim() || (meta?.name || "P").trim().slice(0, 4).toUpperCase() || "P");
  const face = pic
    ? `<img class="join-agree-pic" src="${esc(pic)}" alt="">`
    : `<span class="join-agree-glyph">${glyph}</span>`;
  return `
    <div class="join-agree-server">
      <div class="join-agree-face">${face}</div>
      <div class="join-agree-copy">
        <div class="join-agree-name">${name}</div>
        <div class="join-agree-age">Age rating: ${age}+</div>
      </div>
    </div>`;
}

/** Roles a host/admin may pick as the default for newly approved members.
 *  Spec §3: Member / Viewer. Host may still seed Admin as default. */
function defaultRoleChoices(conn = activeConn()) {
  const roles = [ROLE_USER, ROLE_VIEWER];
  if (effectiveRole(conn?.me) === ROLE_HOST) roles.unshift(ROLE_ADMIN);
  return roles;
}

function canManageServer(conn = activeConn()) {
  if (!conn || PersonalSpace.isPersonal(conn)) return true;
  const r = effectiveRole(conn.me);
  return r === ROLE_HOST || r === ROLE_ADMIN;
}

function canModerateEvents(conn = activeConn()) {
  if (!conn || PersonalSpace.isPersonal(conn)) return true;
  const r = effectiveRole(conn.me);
  return r === ROLE_HOST || r === ROLE_ADMIN || r === ROLE_MODERATOR;
}

/** Approval-role gate for pending events (§ approvals) — mirrors ServerAuthorization.canApproveEvents. */
function canApproveEvents(channel, conn = activeConn()) {
  if (!channel) return false;
  if (canManageServer(conn)) return true;
  if (typeof channelVisibleTo === "function" && !channelVisibleTo(channel, conn?.me, conn)) return false;
  if (effectiveRole(conn?.me) === ROLE_MODERATOR) return true;
  return channel.kind === "event" && effectiveChannelFlags(conn?.me, channel, conn).canApprove;
}

/** Sidebar Console meta — organisers only, not on personal space. */
function canSeeConsoleMeta(conn = activeConn()) {
  return !!conn && !PersonalSpace.isPersonal(conn) && canManageServer(conn);
}

/** Sidebar Moderate meta — host/admin/mod on a real server (not personal). */
function canSeeModerateMeta(conn = activeConn()) {
  return !!conn && !PersonalSpace.isPersonal(conn) && canModerateEvents(conn);
}

function canCreateEvents(conn = activeConn(), channelOrId = null) {
  const projected = typeof activeProjectionContext === "function" ? activeProjectionContext() : null;
  if (projected?.offline || projected?.unavailable) return false;
  if (!conn) return true;
  const ch = resolveEventChannel(conn, channelOrId);
  // § pinned location / people channels are a read-only aggregation view — events are
  if (typeof isDeviceCalendarChannel === "function" && isDeviceCalendarChannel(ch, conn)) return false;
  // created in a normal event channel and surface here, never created directly.
  if (ch?.pinnedLocationLabel != null || ch?.pinnedUserId != null) return false;
  if (typeof PersonalSpace !== "undefined" && PersonalSpace.isHiddenChannel(ch, conn)) return false;
  if (PersonalSpace.isPersonal(conn)) return true;
  if (ch) return canChannelPerm(conn.me, ch, "create", conn);
  // No scoped channel — fall back to server template (types / deck chrome).
  return meetsMemberPerm(serverSettings(conn).createEvents, conn);
}

function canRsvpInChannel(conn = activeConn(), channelOrId = null) {
  const projected = typeof activeProjectionContext === "function" ? activeProjectionContext() : null;
  if (projected?.offline || projected?.unavailable) return false;
  if (!conn || PersonalSpace.isPersonal(conn)) return true;
  const ch = resolveEventChannel(conn, channelOrId);
  if (ch) return canChannelPerm(conn.me, ch, "view", conn);
  return canMutateContent(conn);
}


/** Serialize matrix DOM (`.role-perm-matrix` or `.role-view-pills`) into a rolePerms object.
 *  @param {Element} root
 *  @param {{ viewOnly?: boolean }} [opts]
 */
function readRolePermsFromMatrix(root, opts = {}) {
  const viewOnly = !!opts.viewOnly;
  const staffInp = root?.querySelector?.(".role-staff-pill input:checked");
  const staffFloor = staffInp
    ? (staffInp.getAttribute("data-staff-channel")
      || staffInp.closest("[data-staff-channel]")?.getAttribute("data-staff-channel"))
    : null;
  if (viewOnly && (staffFloor === ROLE_ADMIN || staffFloor === ROLE_MODERATOR)) {
    return typeof staffChannelRolePerms === "function"
      ? staffChannelRolePerms(staffFloor, activeConn())
      : null;
  }

  const map = {};
  const table = root?.querySelector?.(".role-perm-matrix");
  const pills = root?.querySelector?.(".role-view-pills");
  if (!table && !pills) return null;

  const readRow = (el) => {
    const key = el.getAttribute("data-role-key");
    if (!key) return;
    const flags = emptyRolePermFlags();
    if (viewOnly) {
      flags.view = !!el.querySelector(`input[data-flag="view"]`)?.checked;
    } else {
      CHANNEL_PERM_FLAGS.forEach((f) => {
        flags[f] = !!el.querySelector(`input[data-flag="${f}"]`)?.checked;
      });
    }
    map[key] = flags;
  };

  if (table) {
    table.querySelectorAll("tbody tr[data-role-key]").forEach(readRow);
  } else if (pills) {
    pills.querySelectorAll(".role-view-pill[data-role-key]").forEach(readRow);
  }

  for (const fixed of (typeof CHANNEL_VIEW_FIXED_KEYS !== "undefined" && viewOnly
    ? CHANNEL_VIEW_FIXED_KEYS
    : CHANNEL_MATRIX_FIXED_KEYS)) {
    if (!map[fixed]) map[fixed] = emptyRolePermFlags();
  }
  if (viewOnly) {
    map[ROLE_ADMIN] = { ...emptyRolePermFlags(), view: true };
  }
  return viewOnly ? viewOnlyRolePerms(map) : map;
}

/**
 * Staff-only channel: admin-only, or moderators+admins. Null = not staff-gated.
 */
function channelStaffMarkMeta(ch, conn = activeConn()) {
  const staff = typeof channelStaffFloor === "function" ? channelStaffFloor(ch, conn) : null;
  if (staff !== ROLE_MODERATOR && staff !== ROLE_ADMIN) return null;
  const color = typeof roleDisplayColor === "function"
    ? roleDisplayColor(staff, conn)
    : (staff === ROLE_ADMIN
      ? (typeof ROLE_ADMIN_COLOR !== "undefined" ? ROLE_ADMIN_COLOR : "#FF4646")
      : (typeof ROLE_MODERATOR_COLOR !== "undefined" ? ROLE_MODERATOR_COLOR : "#3E7BDB"));
  return {
    floor: staff,
    color,
    label: staff === ROLE_ADMIN ? "Admins only" : "Moderators and admins",
  };
}

function boardViewAccessPrivateLabel(ids, conn) {
  const names = [];
  const seen = new Set();
  for (const raw of ids || []) {
    const id = String(raw || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    let n = "";
    if (conn) {
      if (conn.me?.id === id) n = String(conn.me?.name || "").trim();
      else {
        const m = (conn.members || []).find(u => u.id === id);
        if (m?.name) n = String(m.name).trim();
      }
    }
    if (!n && typeof memberRecord === "function") n = String(memberRecord(id)?.name || "").trim();
    if (!n && typeof nameOf === "function") n = String(nameOf(id) || "").trim();
    if (n && n !== "someone") names.push(n);
  }
  if (!names.length) return "Viewable by people you add";
  if (names.length === 1) return `Viewable by ${names[0]}`;
  if (names.length === 2) return `Viewable by ${names[0]}, ${names[1]}`;
  return `Viewable by ${names[0]}, ${names[1]}, and ${names.length - 2} more`;
}

/**
 * Compact board access for the sidebar header line.
 * Personal conn → Just you (no icon). Hosted open-to-everyone → null.
 */
function boardViewAccessMeta(ch, conn = activeConn()) {
  if (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn)) {
    return { kind: "personal", icon: null, label: "Just you", detail: "Just you — stored on this device." };
  }
  if (!ch) return null;
  const vis = typeof visibilitySourceForChannel === "function"
    ? visibilitySourceForChannel(ch, conn)
    : ch;
  if (Array.isArray(vis?.allowedUserIds) && !vis.autoIncludeNewMembers) {
    const detail = boardViewAccessPrivateLabel(vis.allowedUserIds, conn);
    const n = new Set((vis.allowedUserIds || []).map(String).filter(Boolean)).size;
    return { kind: "private", icon: "lock", label: n ? `${n} ${n === 1 ? "person" : "people"}` : "Private", detail };
  }
  const staff = typeof channelStaffMarkMeta === "function"
    ? channelStaffMarkMeta(ch, conn)
    : null;
  if (staff) {
    const admins = staff.floor === ROLE_ADMIN;
    return {
      kind: "staff",
      icon: "shield",
      label: admins ? "Admins" : "Moderators+",
      detail: staff.label || (admins ? "Admins only" : "Moderators and admins"),
      color: staff.color,
    };
  }
  const hasPerms = ch.rolePerms && typeof ch.rolePerms === "object"
    && Object.keys(ch.rolePerms).length;
  if (!hasPerms) {
    const min = typeof normalizeChannelMinRole === "function"
      ? normalizeChannelMinRole(ch.minRole)
      : null;
    if (min === ROLE_USER) {
      return { kind: "roles", icon: "shield-user", label: "Members", detail: "Viewable by members" };
    }
    return null;
  }
  const marks = typeof channelViewRoleMarks === "function"
    ? channelViewRoleMarks(ch, conn)
    : [];
  if (!marks.length || marks.some(m => m.open)) return null;
  const names = marks.map(m => m.label).filter(Boolean);
  if (!names.length) return null;
  // Short label: the lowest role that can see it (Members covers any custom
  // role), else the custom roles it's for ("Committee, Drivers +1").
  const custom = typeof customRolesOf === "function" ? customRolesOf(conn) : [];
  const keys = marks.map(m => m.key);
  const customMarks = marks.filter(m => custom.some(r => r.id === m.key));
  const customNames = customMarks.map(m => m.label).filter(Boolean);
  let label;
  let color = "";
  if (keys.includes(ROLE_USER)) label = "Members";
  else if (customNames.length) {
    label = customNames.length > 2 ? `${customNames.slice(0, 2).join(", ")} +${customNames.length - 2}` : customNames.join(", ");
    const first = customMarks.find(m => m.label);
    color = (first && typeof roleDisplayColor === "function")
      ? roleDisplayColor(first.key, conn)
      : (first?.color || "");
  } else if (keys.includes(ROLE_MODERATOR)) {
    label = "Moderators+";
    color = typeof roleDisplayColor === "function" ? roleDisplayColor(ROLE_MODERATOR, conn) : "";
  } else label = names.slice(0, 2).join(", ");
  return {
    kind: "roles",
    icon: "shield-user",
    label,
    detail: `Viewable by ${names.join(", ")}`,
    ...(color ? { color } : {}),
  };
}

function channelStaffFloor(ch, conn = activeConn()) {
  if (!ch) return null;
  const hasPerms = ch.rolePerms && typeof ch.rolePerms === "object"
    && Object.keys(ch.rolePerms).length;
  if (!hasPerms) {
    const min = typeof normalizeChannelMinRole === "function"
      ? normalizeChannelMinRole(ch.minRole)
      : null;
    return (min === ROLE_ADMIN || min === ROLE_MODERATOR) ? min : null;
  }
  const seed = ch.kind ? ch : { ...ch, kind: "chat" };
  const perms = typeof ensureChannelRolePerms === "function"
    ? (ensureChannelRolePerms(seed, conn) || ch.rolePerms)
    : ch.rolePerms;
  if (perms[ROLE_USER]?.view || perms[ROLE_VIEWER]?.view) return null;
  const custom = typeof customRolesOf === "function" ? customRolesOf(conn) : [];
  if (custom.some(r => perms[r.id]?.view)) return null;
  if (perms[ROLE_MODERATOR]?.view) return ROLE_MODERATOR;
  // Empty map (no member/viewer/mod/custom view) is admin-only: host/admin
  // still see it via manage bypass. Moderator-only is the row above.
  return ROLE_ADMIN;
}

function staffChannelRolePerms(floor, conn = activeConn()) {
  const off = () => ({ ...emptyRolePermFlags() });
  const on = () => ({ ...emptyRolePermFlags(), view: true });
  const map = typeof viewOnlyRolePerms === "function" ? viewOnlyRolePerms({}) : {};
  for (const k of Object.keys(map)) map[k] = off();
  map[ROLE_ADMIN] = on();
  map[ROLE_MODERATOR] = floor === ROLE_MODERATOR ? on() : off();
  map[ROLE_USER] = off();
  map[ROLE_VIEWER] = off();
  if (typeof customRolesOf === "function") {
    for (const r of customRolesOf(conn)) map[r.id] = off();
  }
  return map;
}

function staffChannelHint(floor) {
  return floor === ROLE_ADMIN ? "Only the host and admins can see this board."
    : floor === ROLE_MODERATOR ? "Only the host, admins and moderators can see this board." : "";
}

function staffChannelPillsHtml(ch, conn = activeConn()) {
  const floor = typeof channelStaffFloor === "function" ? channelStaffFloor(ch, conn) : null;
  const items = [
    { key: ROLE_MODERATOR, label: "Staff only", title: "Moderators and admins only" },
    { key: ROLE_ADMIN, label: "Admins only", title: "Admins only" },
  ];
  const pills = items.map(({ key, label, title }) => {
    const on = floor === key;
    const color = roleDisplayColor(key, conn);
    return `<label class="role-view-pill role-staff-pill role-staff-badge${on ? " is-on" : ""}" data-staff-channel="${esc(key)}" style="--role-color:${esc(color)}" title="${esc(title)}">
      <input type="checkbox" data-staff-channel="${esc(key)}" ${on ? "checked" : ""} aria-label="${esc(title)}">
      <span class="role-view-pill-label">${esc(label)}</span>
    </label>`;
  }).join("");
  return `<div class="role-staff-pills" role="group" aria-label="Staff-only presets">${pills}</div>
    <p class="ch-scope-summary role-staff-hint" ${floor ? "" : "hidden"} aria-live="polite">${staffChannelHint(floor)}</p>`;
}

function paintChannelViewPermControls(root) {
  if (!root) return;
  root.querySelectorAll(".role-view-pill").forEach((pill) => {
    const on = !!pill.querySelector("input")?.checked;
    pill.classList.toggle("is-on", on);
  });
  const staffOn = !!root.querySelector(".role-staff-pill input:checked");
  const floor = root.querySelector(".role-staff-pill input:checked")?.getAttribute("data-staff-channel");
  const hint = root.querySelector(".role-staff-hint");
  if (hint) {
    hint.textContent = staffChannelHint(floor);
    hint.hidden = !staffOn;
  }
  root.querySelector(".role-view-pills-wrap")?.classList.toggle("is-staff-channel", staffOn);
  root.querySelector(".role-perm-matrix-wrap")?.classList.toggle("is-staff-channel", staffOn);
}

/** Exclusive Admin / Moderator channel pills + regular role tags. */
function wireChannelViewPermControls(root, { onChange } = {}) {
  if (!root) return;
  let confirming = false;

  const staffFloorOf = (inp) => inp?.getAttribute("data-staff-channel")
    || inp?.closest("[data-staff-channel]")?.getAttribute("data-staff-channel")
    || null;

  const confirmOpenStaffChannel = (floor) => {
    const staff = floor === ROLE_ADMIN ? "admins" : "moderators and admins";
    if (typeof ashConfirm !== "function") return Promise.resolve(true);
    return ashConfirm(
      `This board is only visible to ${staff}. Opening it lets members and viewers see its chat and events. Continue?`,
      { ok: "Open to members and viewers", cancel: "Keep staff-only", danger: true },
    );
  };

  const applyAndNotify = () => {
    paintChannelViewPermControls(root);
    if (typeof onChange === "function") onChange();
  };

  root.querySelectorAll(".role-staff-pill input").forEach((inp) => {
    inp.onchange = async () => {
      if (confirming) {
        inp.checked = !inp.checked;
        paintChannelViewPermControls(root);
        return;
      }
      if (inp.checked) {
        root.querySelectorAll(".role-staff-pill input").forEach((other) => {
          if (other !== inp) other.checked = false;
        });
        root.querySelectorAll(
          ".role-view-pill:not(.role-staff-pill) input[data-flag='view'], .role-perm-matrix input[data-flag='view']"
        ).forEach((i) => { i.checked = false; });
        applyAndNotify();
        return;
      }
      if (root.querySelector(".role-staff-pill input:checked")) {
        applyAndNotify();
        return;
      }
      confirming = true;
      const ok = await confirmOpenStaffChannel(staffFloorOf(inp));
      confirming = false;
      if (!ok) {
        inp.checked = true;
        paintChannelViewPermControls(root);
        return;
      }
      const member = root.querySelector(
        '.role-view-pill[data-role-key="user"] input, tr[data-role-key="user"] input[data-flag="view"]'
      );
      const viewer = root.querySelector(
        '.role-view-pill[data-role-key="viewer"] input, tr[data-role-key="viewer"] input[data-flag="view"]'
      );
      if (member) member.checked = true;
      if (viewer) viewer.checked = true;
      applyAndNotify();
    };
  });
  root.querySelectorAll(
    ".role-view-pill:not(.role-staff-pill) input, .role-perm-matrix input"
  ).forEach((inp) => {
    inp.onchange = async () => {
      if (confirming) {
        inp.checked = !inp.checked;
        paintChannelViewPermControls(root);
        return;
      }
      const staffOn = root.querySelector(".role-staff-pill input:checked");
      if (inp.checked && staffOn) {
        confirming = true;
        const ok = await confirmOpenStaffChannel(staffFloorOf(staffOn));
        confirming = false;
        if (!ok) {
          inp.checked = false;
          paintChannelViewPermControls(root);
          return;
        }
        root.querySelectorAll(".role-staff-pill input").forEach((s) => { s.checked = false; });
      }
      applyAndNotify();
    };
  });
  paintChannelViewPermControls(root);
}

/** Accent color for a matrix / people-list role key (fixed or custom). */
function roleDisplayColor(key, conn = activeConn()) {
  const k = String(key || "");
  if (k === ROLE_HOST) return "#E8B84A";
  if (k === ROLE_ADMIN) return typeof ROLE_ADMIN_COLOR !== "undefined" ? ROLE_ADMIN_COLOR : "#FF4646";
  if (k === ROLE_MODERATOR) return typeof ROLE_MODERATOR_COLOR !== "undefined" ? ROLE_MODERATOR_COLOR : "#3E7BDB";
  if (k === ROLE_USER) return "#2A9D8F";
  if (k === ROLE_VIEWER) return "#8B93A0";
  const custom = typeof customRolesOf === "function"
    ? customRolesOf(conn).find(r => r.id === k)
    : null;
  if (custom) {
    if (typeof ensureRoleColor === "function") {
      try { return ensureRoleColor(custom, conn) || custom.color || "#4A5262"; } catch {}
    }
    if (custom.color && /^#[0-9a-fA-F]{6}$/.test(custom.color)
        && !(typeof isStaffReservedColor === "function" && isStaffReservedColor(custom.color))) {
      return custom.color;
    }
  }
  return "#4A5262";
}

/* ── A person's colour = their top role ──────────────────────────────────
   Host > Admin > Moderator > their first custom role (Roles editor order).
   Member and Viewer stay plain. Used for names in chat and for faces
   without a photo, so the two always match. Personal space keeps its
   own colours (no roles there). */
function memberRoleConn(uid) {
  const conn = typeof connForMember === "function" ? connForMember(uid) : (typeof activeConn === "function" ? activeConn() : null);
  if (!conn || (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn))) return null;
  return conn;
}

function memberTopRoleKey(user, conn) {
  if (!user || !conn) return null;
  const r = effectiveRole(user);
  if (r === ROLE_HOST || r === ROLE_ADMIN || r === ROLE_MODERATOR) return r;
  const tags = new Set(Array.isArray(user.roleTagIds) ? user.roleTagIds : []);
  if (!tags.size) return null;
  const top = customRolesOf(conn).find((t) => tags.has(t.id));
  return top ? top.id : null;
}

/** The colour of someone's top role, or "" (Member / Viewer / unknown). */
function memberRoleColor(uid) {
  const conn = memberRoleConn(uid);
  if (!conn) return "";
  const user = typeof memberRecord === "function" ? memberRecord(uid) : null;
  const key = memberTopRoleKey(user, conn);
  return key ? roleDisplayColor(key, conn) : "";
}

/** Inline style for a name: the role colour, shaded toward the text colour so
 *  it stays readable in light and dark mode. "" = plain. */
function roleNameStyle(uid) {
  const c = uid ? memberRoleColor(uid) : "";
  return c ? `color:color-mix(in srgb, ${c} 72%, var(--text-primary))` : "";
}

/** Inline style for a face without a photo on a server: a soft tint of the
 *  role colour with darker initials; neutral for Member / Viewer. "" off a
 *  server (personal space keeps its own colours). */
function memberAvatarRoleStyle(uid) {
  if (!uid || !memberRoleConn(uid)) return "";
  const c = memberRoleColor(uid);
  return c
    ? `background:color-mix(in srgb, ${c} 22%, var(--page-bg));color:color-mix(in srgb, ${c} 78%, var(--text-primary))`
    : "background:color-mix(in srgb, var(--text-primary) 9%, var(--page-bg));color:var(--text-secondary)";
}

/**
 * Roles that can see a channel (Member / Viewer / custom tags), for compact UI.
 * Open-to-everyone boards get an outline “All” (viewer) mark.
 * Custom tags still show when only some of them can see.
 */
function channelViewRoleMarks(ch, conn = activeConn()) {
  if (!ch) return [];
  const kind = ch.kind || "chat";
  if (kind !== "event" && kind !== "chat") return [];
  const linkedAgendas = typeof agendasLinkedToChat === "function"
    ? agendasLinkedToChat(ch, conn) : [];
  let mirroredChatPerms = false;
  if (kind === "chat" && linkedAgendas.length) {
    if (typeof chatMirrorsPrivateOnly === "function" && chatMirrorsPrivateOnly(ch, conn)) {
      return [];
    }
    const merged = typeof mergeAgendaViewRolePerms === "function"
      ? mergeAgendaViewRolePerms(linkedAgendas, conn)
      : {};
    ch = { kind: "chat", rolePerms: merged };
    mirroredChatPerms = true;
  }
  const staff = typeof channelStaffFloor === "function" ? channelStaffFloor(ch, conn) : null;
  if (staff === ROLE_MODERATOR || staff === ROLE_ADMIN) {
    return [{
      key: staff,
      label: staff === ROLE_ADMIN ? "Admins only" : "Moderators and admins",
      abbrev: "",
      color: roleDisplayColor(staff, conn),
      lock: true,
    }];
  }
  const hasPerms = ch.rolePerms && typeof ch.rolePerms === "object"
    && Object.keys(ch.rolePerms).length;
  if (!hasPerms) {
    const min = typeof normalizeChannelMinRole === "function"
      ? normalizeChannelMinRole(ch.minRole)
      : null;
    if (min) return [];
    const color = roleDisplayColor(ROLE_VIEWER, conn);
    return [{ key: ROLE_VIEWER, label: "Open to everyone", abbrev: "All", color, open: true }];
  }
  const perms = mirroredChatPerms
    ? (ch.rolePerms || {})
    : (typeof ensureChannelRolePerms === "function"
      ? (ensureChannelRolePerms(ch, conn) || ch.rolePerms)
      : ch.rolePerms);
  const custom = typeof customRolesOf === "function" ? customRolesOf(conn) : [];
  const customOn = custom.filter(r => perms[r.id]?.view);
  const viewerOpen = !!perms[ROLE_VIEWER]?.view;

  const out = [];
  const pushMark = (key, label, extra = {}) => {
    const raw = String(extra.abbrev || label || "?").trim().replace(/\s+/g, "");
    out.push({
      key,
      label,
      abbrev: raw.slice(0, extra.abbrev ? extra.abbrev.length : 3) || "?",
      color: extra.color || roleDisplayColor(key, conn),
      open: !!extra.open,
    });
  };

  if (viewerOpen) {
    pushMark(ROLE_VIEWER, "Open to everyone", { abbrev: "All", open: true });
    return out;
  }

  // Custom tags first so they win the compact chip limit over Member.
  for (const r of customOn) pushMark(r.id, r.name || r.id);
  const fixedKeys = CHANNEL_MATRIX_FIXED_KEYS.filter(k => k !== ROLE_MODERATOR);
  for (const key of fixedKeys) {
    if (!perms[key]?.view) continue;
    pushMark(key, matrixRowLabel(key, conn));
  }
  return out;
}


/** Direct linked event feeds or chat mirrors for a channel. */
function channelLinkedSourcesFor(ch, conn = activeConn()) {
  if (!ch || !conn) return [];
  const personal = typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn);
  if (ch.kind === "chat") {
    if (personal && typeof directLinkedChatMirrorsFor === "function") {
      return directLinkedChatMirrorsFor(ch.id) || [];
    }
    if (typeof eventChannelsImportingInto === "function") {
      return (eventChannelsImportingInto(ch.id, conn) || []).map(c => ({
        connId: conn.id, channelId: c.id,
      }));
    }
    return [];
  }
  if (typeof directLinkedEventSourcesFor === "function") {
    return directLinkedEventSourcesFor(conn.id || "personal", ch.id) || [];
  }
  return [];
}


/** Whether this channel pulls from others (in) or others pull from it (out). */
function channelSidebarLinkDirs(ch, conn = activeConn()) {
  const dirs = { in: false, out: false };
  if (!ch || !conn) return dirs;
  const sources = typeof channelLinkedSourcesFor === "function"
    ? channelLinkedSourcesFor(ch, conn)
    : [];
  if (sources.length) dirs.in = true;
  if (ch.kind === "event" && ch.linkedChatChannelId) dirs.out = true;

  const connId = conn.id || "";
  const chId = ch.id;
  const scan = (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn)
    && typeof S !== "undefined" && S.conns)
    ? Object.values(S.conns)
    : [conn];
  for (const c of scan) {
    if (!c) continue;
    const otherConnId = c.id || "";
    for (const other of c.channels || []) {
      if (!other?.id) continue;
      if (other.id === chId && otherConnId === connId) continue;
      if (typeof directLinkedEventSourcesFor !== "function") continue;
      const otherSources = directLinkedEventSourcesFor(otherConnId || "personal", other.id) || [];
      if (otherSources.some(s => s && s.connId === connId && s.channelId === chId)) {
        dirs.out = true;
        break;
      }
    }
    if (dirs.out) break;
  }
  return dirs;
}

function channelSidebarLinkKinds(ch, conn = activeConn()) {
  const dirs = typeof channelSidebarLinkDirs === "function"
    ? channelSidebarLinkDirs(ch, conn)
    : { in: false, out: false };
  const kinds = [];
  if (dirs.in) kinds.push("in");
  if (dirs.out) kinds.push("out");
  return kinds;
}


/** Linked sources grouped by server: { name, count, channels[], connId, conn }. */
function channelLinkedServerGroups(ch, conn = activeConn()) {
  const groups = new Map();
  for (const l of channelLinkedSourcesFor(ch, conn)) {
    if (!l?.connId) continue;
    const c = (typeof S !== "undefined" && S.conns?.[l.connId]) || null;
    if (!c) continue;
    const chMeta = (typeof sourceChannelsFor === "function" ? sourceChannelsFor(c) : (c.channels || []))
      .find(x => x.id === l.channelId);
    const chName = chMeta?.name || (ch.kind === "chat" ? "Chat" : "Events");
    const personalSrc = typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(c);
    const name = typeof connDisplayName === "function" ? connDisplayName(c) : (c.name || c.hostName || "Server");
    const cur = groups.get(l.connId) || {
      name, count: 0, channels: [], fromPersonal: personalSrc, connId: l.connId, conn: c,
    };
    cur.count += 1;
    cur.channels.push(chName);
    groups.set(l.connId, cur);
  }
  return [...groups.values()];
}

function linkedChannelAbbrev(name) {
  const raw = String(name || "").trim();
  const first = (raw.split(/\s+/).filter(Boolean)[0] || raw).replace(/[^A-Za-z0-9]/g, "");
  return first.slice(0, 6) || "?";
}

const LINKED_SERVER_TAG_COLORS_KEY = "ash_linked_server_tag_colors_v1";
let linkedServerTagColorsCache = null;

function linkedServerTagPalette() {
  const list = (typeof CATEGORY_PALETTE !== "undefined" ? CATEGORY_PALETTE : [])
    .map(p => p.accent)
    .filter(c => /^#[0-9a-fA-F]{6}$/.test(c || ""));
  return list.length
    ? list
    : ["#d98c2b", "#2E6B3D", "#4B3BB5", "#993C1D", "#9B2C5E", "#3e8fb0", "#a3764a"];
}

function loadLinkedServerTagColors() {
  if (linkedServerTagColorsCache) return linkedServerTagColorsCache;
  try {
    const raw = JSON.parse(localStorage.getItem(LINKED_SERVER_TAG_COLORS_KEY) || "{}");
    linkedServerTagColorsCache = raw && typeof raw === "object" ? raw : {};
  } catch {
    linkedServerTagColorsCache = {};
  }
  return linkedServerTagColorsCache;
}

/** Random palette color per server, stable after first pick; skips colors already used. */
function linkedServerTagColor(connId) {
  const id = String(connId || "").trim();
  if (!id) return "";
  const map = loadLinkedServerTagColors();
  const existing = map[id];
  if (existing && /^#[0-9a-fA-F]{6}$/.test(existing)) return existing;
  const palette = linkedServerTagPalette();
  const used = new Set(Object.values(map).map(c => String(c).toLowerCase()));
  const unused = palette.filter(c => !used.has(c.toLowerCase()));
  const pool = unused.length ? unused : palette;
  const color = pool[Math.floor(Math.random() * pool.length)] || "#4A5262";
  map[id] = color;
  linkedServerTagColorsCache = map;
  try { localStorage.setItem(LINKED_SERVER_TAG_COLORS_KEY, JSON.stringify(map)); } catch {}
  return color;
}

/** Compact text marks: server icon + first-word channel labels (≤6 letters, dot-separated), or icon + count if tight. */
function channelLinkedServerMarksHtml(ch, conn = activeConn(), opts = {}) {
  if (!ch || !conn) return "";
  const groups = channelLinkedServerGroups(ch, conn);
  if (!groups.length) return "";
  const max = Math.max(1, Number(opts.max) || 2);
  const shown = groups.slice(0, max);
  const hidden = groups.slice(max);
  const title = groups.map(g =>
    g.count > 1 ? `${g.name} (${g.count}: ${g.channels.join(", ")})` : `${g.name} · ${g.channels[0] || ""}`
  ).join(", ");
  const chips = shown.map(g => {
    const abbrevs = g.channels.map(linkedChannelAbbrev).join("·");
    const tip = g.count > 1 ? `${g.name}: ${g.channels.join(", ")}` : `${g.name} · ${g.channels[0] || ""}`;
    const color = typeof linkedServerTagColor === "function" ? linkedServerTagColor(g.connId) : "";
    const style = color ? ` style="--role-color:${esc(color)}"` : "";
    const sameServer = g.connId === conn.id
      || (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn) && g.fromPersonal);
    const ico = (!sameServer && g.conn && typeof connIconHTML === "function")
      ? `<span class="side-link-ico" aria-hidden="true">${connIconHTML(g.conn)}</span>`
      : "";
    return `<span class="side-link-mark${sameServer ? " is-local" : ""}" data-count="${g.count}"${style} title="${esc(tip)}" aria-label="${esc(tip)}">` +
      ico +
      `<span class="side-link-list">${esc(abbrevs)}</span>` +
      `<span class="side-link-n">${g.count}</span>` +
    `</span>`;
  }).join("");
  const more = hidden.length
    ? `<span class="side-link-more" title="${esc(hidden.map(g => g.name).join(", "))}" aria-label="${hidden.length} more linked servers">…</span>`
    : "";
  if (typeof scheduleFitChannelLinkedMarks === "function") scheduleFitChannelLinkedMarks();
  return `<span class="channel-link-marks" title="${esc(title)}" aria-label="Linked: ${esc(title)}">${chips}${more}</span>`;
}

function fitChannelLinkedMarks(wrap) {
  if (!wrap?.querySelectorAll) return;
  const marks = [...wrap.querySelectorAll(":scope > .side-link-mark")];
  marks.forEach(m => m.classList.remove("is-compact"));
  const budget = wrap.clientWidth;
  if (!budget) return;
  const overflows = () => wrap.scrollWidth > budget + 1;
  if (!overflows()) return;
  const ranked = marks
    .map(m => ({ m, n: Number(m.dataset.count) || 0 }))
    .sort((a, b) => b.n - a.n);
  for (const { m } of ranked) {
    m.classList.add("is-compact");
    if (!overflows()) return;
  }
}

function scheduleFitChannelLinkedMarks() {
  if (scheduleFitChannelLinkedMarks._p) return;
  scheduleFitChannelLinkedMarks._p = requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scheduleFitChannelLinkedMarks._p = 0;
      document.querySelectorAll(".channel-link-marks").forEach(fitChannelLinkedMarks);
    });
  });
}

/**
 * HTML for an editable permission matrix.
 * @param {object|null} ch — channel (viewOnly) or null for server matrix
 * @param {object} [conn]
 * @param {{ mode?: "server"|"viewOnly", pills?: boolean }} [opts]
 */
function rolePermMatrixHtml(ch, conn = activeConn(), opts = {}) {
  const mode = opts.mode === "viewOnly" ? "viewOnly" : "server";
  const flagList = mode === "viewOnly" ? ["view"] : CHANNEL_PERM_FLAGS;
  const perms = mode === "viewOnly"
    ? (ensureChannelRolePerms(ch || { kind: "event" }, conn) || defaultEventChannelViewPerms(conn))
    : ensureServerEventRolePerms(conn);
  const custom = customRolesOf(conn);
  const fixedKeys = mode === "viewOnly"
    ? (typeof CHANNEL_VIEW_FIXED_KEYS !== "undefined"
      ? CHANNEL_VIEW_FIXED_KEYS
      : [ROLE_USER, ROLE_VIEWER])
    : CHANNEL_MATRIX_FIXED_KEYS;
  const rows = [
    ...fixedKeys.map(key => ({ key, label: matrixRowLabel(key, conn), fixed: true })),
    ...custom.map((r, i) => {
      const color = typeof ensureRoleColor === "function"
        ? ensureRoleColor(r, conn, i)
        : (r.color || null);
      return { key: r.id, label: r.name, fixed: false, color };
    }),
  ];

  if (mode === "viewOnly" && opts.pills) {
    const staffHtml = typeof staffChannelPillsHtml === "function"
      ? staffChannelPillsHtml(ch, conn)
      : "";
    const staffOn = typeof channelStaffFloor === "function" && !!channelStaffFloor(ch, conn);
    const pills = rows.map(({ key, label }) => {
      const flags = perms[key] || emptyRolePermFlags();
      const on = !!flags.view;
      const color = roleDisplayColor(key, conn);
      return `<label class="role-view-pill${[ROLE_HOST, ROLE_ADMIN, ROLE_MODERATOR].includes(key) ? " role-staff-badge" : ""}${on ? " is-on" : ""}" data-role-key="${esc(key)}" style="--role-color:${esc(color)}">
        <input type="checkbox" data-flag="view" ${on ? "checked" : ""} aria-label="${esc(label)} view">
        <span class="role-view-pill-label">${esc(label)}</span>
      </label>`;
    }).join("");
    return `<div class="role-view-pills-wrap${staffOn ? " is-staff-channel" : ""}" data-matrix-mode="viewOnly">
      ${staffHtml}
      <div class="role-view-pills" role="group" aria-label="Roles that can see this">${pills}</div>
    </div>`;
  }

  const head = flagList.map(f =>
    `<th title="${esc(CHANNEL_PERM_FLAG_LABELS[f])}">${esc(mode === "viewOnly" ? CHANNEL_PERM_FLAG_LABELS[f] : CHANNEL_PERM_FLAG_LABELS[f].slice(0, 1))}</th>`
  ).join("");
  const body = rows.map(({ key, label, color }) => {
    const flags = perms[key] || emptyRolePermFlags();
    const cells = flagList.map(f =>
      `<td><input type="checkbox" data-flag="${f}" ${flags[f] ? "checked" : ""} aria-label="${esc(label)} ${esc(CHANNEL_PERM_FLAG_LABELS[f])}"></td>`
    ).join("");
    const swatchColor = color || (mode === "viewOnly" ? roleDisplayColor(key, conn) : "");
    const swatch = swatchColor ? `<span class="role-tag-swatch" style="background:${esc(swatchColor)}"></span>` : "";
    return `<tr data-role-key="${esc(key)}"><th scope="row">${swatch}${esc(label)}</th>${cells}</tr>`;
  }).join("");
  const noCustomNote = mode === "viewOnly" || custom.length ? "" : `<p class="ch-scope-summary">Create custom role tags in Roles.</p>`;
  const legend = mode === "viewOnly"
    ? ""
    : `<p class="ch-scope-summary role-perm-legend">${CHANNEL_PERM_FLAGS.map(f =>
      `${CHANNEL_PERM_FLAG_LABELS[f].slice(0, 1)}=${CHANNEL_PERM_FLAG_LABELS[f]}`
    ).join(" · ")}</p>`;
  const staffHtml = mode === "viewOnly" && typeof staffChannelPillsHtml === "function"
    ? staffChannelPillsHtml(ch, conn)
    : "";
  const staffOn = mode === "viewOnly" && typeof channelStaffFloor === "function"
    && !!channelStaffFloor(ch, conn);
  return `<div class="role-perm-matrix-wrap${staffOn ? " is-staff-channel" : ""}" data-matrix-mode="${mode}">
    ${staffHtml}
    <table class="role-perm-matrix">
      <thead><tr><th scope="col">Role</th>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>
    ${legend}
    ${noCustomNote}
  </div>`;
}

function roleHasEventPermFlag(conn, flag) {
  if (!conn || PersonalSpace.isPersonal(conn)) return true;
  if (typeof canManageServer === "function" && canManageServer(conn)) return true;
  const r = effectiveRole(conn.me);
  if (r === ROLE_MODERATOR) return true;
  const perms = typeof ensureServerEventRolePerms === "function"
    ? ensureServerEventRolePerms(conn)
    : (conn.eventRolePerms || {});
  const primaryKey = r === ROLE_VIEWER ? ROLE_VIEWER : ROLE_USER;
  if (flag === "addLocations") {
    if (perms[primaryKey]?.create || perms[primaryKey]?.addLocations) return true;
  }
  if (perms[primaryKey]?.[flag]) return true;
  for (const id of (conn.me?.roleTagIds || [])) {
    if (flag === "addLocations" && (perms[id]?.create || perms[id]?.addLocations)) return true;
    if (perms[id]?.[flag]) return true;
  }
  return false;
}

function canCreateEventTypes(conn = activeConn()) {
  return roleHasEventPermFlag(conn, "createEventTypes");
}

function canAddLocations(conn = activeConn()) {
  return roleHasEventPermFlag(conn, "create") || roleHasEventPermFlag(conn, "addLocations");
}

/** Clubs may attach several places to one event (Event options). */
function allowMultiLocations(conn = activeConn()) {
  return !!serverSettings(conn).allowMultiLocations;
}

/** Split a stored `where` string into place labels (multi-loc uses " · "). */
function parseEventPlaces(where) {
  const raw = String(where == null ? "" : where).trim();
  if (!raw) return [];
  if (raw.includes(" · ")) {
    return raw.split(/\s*·\s*/).map(s => s.trim()).filter(Boolean);
  }
  return [raw];
}

/** Join place labels for storage / display. */
function formatEventPlaces(places) {
  const list = (Array.isArray(places) ? places : [])
    .map(p => String(p || "").trim())
    .filter(Boolean);
  // De-dupe case-insensitively, keep first casing.
  const out = [];
  const seen = new Set();
  for (const p of list) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out.join(" · ");
}

/** Toggle a place in/out of a multi-location `where` string. */
function toggleEventPlace(where, place) {
  const label = String(place || "").trim();
  if (!label) return String(where || "").trim();
  const cur = parseEventPlaces(where);
  const key = label.toLowerCase();
  const next = cur.some(p => p.toLowerCase() === key)
    ? cur.filter(p => p.toLowerCase() !== key)
    : [...cur, label];
  return formatEventPlaces(next);
}

/** True when `place` is already in the event's where (exact or multi list). */
function eventWhereHasPlace(where, place) {
  const label = String(place || "").trim();
  if (!label) return false;
  const key = label.toLowerCase();
  return parseEventPlaces(where).some(p => p.toLowerCase() === key);
}

/**
 * Plaintext `locationLabelId` for pinned boards: registry hits from a `where`
 * string (multi-place joins with " · "). Canonical registry casing; empty if none.
 */
function curatedLocationLabelId(where, conn = null) {
  const places = typeof parseEventPlaces === "function" ? parseEventPlaces(where) : [];
  if (!places.length || typeof locationsFor !== "function") return "";
  const locs = locationsFor(conn);
  if (!Array.isArray(locs) || !locs.length) return "";
  const hits = [];
  for (const p of places) {
    const key = String(p || "").trim().toLowerCase();
    if (!key) continue;
    const hit = locs.find(l => String(l.label || "").toLowerCase() === key);
    if (hit) hits.push(hit.label);
  }
  return typeof formatEventPlaces === "function" ? formatEventPlaces(hits) : hits.join(" · ");
}

/** True once the user has at least one non-personal (shared) connection. */
function hasJoinedAnyServer() {
  return Object.values(S.conns || {}).some(c => c && !PersonalSpace.isPersonal(c));
}

/** Personal event conversations also serve as private notes, without a server. */
function personalPanelChatUnlocked() {
  return true;
}

/**
 * Whether an event may use a panel chat composer.
 * Personal-only events support notes too. Callers enforce owner permissions.
 */
function eventHasPanelChat(ev) {
  return !!ev;
}

/**
 * Social meta rows (Live).
 * On a shared server always; on personal space only after the first join (004).
 */
function showSocialMetaChannels(conn = activeConn()) {
  if (!conn) return false;
  if (!PersonalSpace.isPersonal(conn)) return true;
  return hasJoinedAnyServer();
}

/** Event groups (agendas) on a conn. */
function eventGroupChannels(conn = activeConn()) {
  if (!conn) return [];
  return (conn.channels || []).filter(c =>
    c.kind === "event"
    && !(typeof isPinnedChannel === "function" && isPinnedChannel(c))
    && !(typeof PersonalSpace !== "undefined" && PersonalSpace.isHiddenChannel(c, conn)));
}

/** Landing view for a conn's agenda — a concrete event channel. */
function defaultAgendaView(conn = activeConn()) {
  const groups = eventGroupChannels(conn);
  if (!groups.length) return { kind: "events" };
  if (groups.length === 1) return { kind: "channel", id: groups[0].id };
  const pch = typeof PersonalSpace !== "undefined" && PersonalSpace.MY_PLANS_ID;
  const prefer = (pch && groups.find(c => c.id === pch))
    || groups.find(c => c.id === S.activeEventChannelId)
    || groups[0];
  return { kind: "channel", id: prefer.id };
}

/** If the Events board is open but isn't a valid destination for this conn
 *  (Personal with ≤1 agenda, or any real server — the meta board is gone
 *  there), land on a concrete agenda instead (or leave, if none exists). */
function clampAllEventsMetaView() {
  const conn = activeConn();
  if (!conn || S.activeView?.kind !== "events") return false;
  const next = typeof defaultAgendaView === "function" ? defaultAgendaView(conn) : null;
  if (!next || next.kind === "events") return false;
  Nav.set(next);
  if (next.kind === "channel") S.activeEventChannelId = next.id;
  return true;
}

/** Hidden personal boards (Accepted) are not a navigable destination. */
function clampHiddenPersonalChannelView() {
  const conn = activeConn();
  if (!conn || S.activeView?.kind !== "channel") return false;
  const ch = (conn.channels || []).find(c => c.id === S.activeView.id);
  if (!ch || typeof PersonalSpace === "undefined" || !PersonalSpace.isHiddenChannel(ch, conn)) return false;
  const next = typeof defaultAgendaView === "function" ? defaultAgendaView(conn) : { kind: "events" };
  Nav.set(next);
  if (next.kind === "channel") S.activeEventChannelId = next.id;
  return true;
}

/**
 * True when this native shell can run an on-device host (Android).
 * Explicit false from iOS AshNative → join-only. Absent bridge (Safari / served web) → false.
 */
function hostingAvailable() {
  try {
    if (window.AshNative && typeof AshNative.hostingAvailable === "function") {
      return !!AshNative.hostingAvailable();
    }
  } catch { /* ignore */ }
  return false;
}

/** iOS (or other) native shell that ships AshNative but cannot host. */
function isJoinOnlyNativeShell() {
  try {
    return !!(window.AshNative
      && typeof AshNative.hostingAvailable === "function"
      && !AshNative.hostingAvailable());
  } catch { return false; }
}


function canInviteToGroup(conn = activeConn()) {
  // Personal space is single-user — invite belongs on shared servers (003).
  if (!conn || PersonalSpace.isPersonal(conn)) return false;
  // Hard-fixed: only admins / host may invite into groups for now.
  return canManageServer(conn);
}

/** If personal space still has a social meta view open before first join, land on an event group. */
