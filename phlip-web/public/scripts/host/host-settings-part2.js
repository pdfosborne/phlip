/* host-settings-part2.js — split from host-settings.js (Part 3 size ceiling).
 * Globals out: buildHostedServerCard, openHostedServerSettings, fillHostedServerSettingsBody
 * Load after: host-settings-part1.js; part of host-settings cluster.
 */

let _hostedServerSettingsId = "";

function hostGuideBackToServer(serverId) {
  return () => {
    if (typeof openHostedServerSettings === "function") openHostedServerSettings(serverId);
  };
}

function buildHostedServerCard(s, setup, opts = {}) {
  const id = String(s.id || s.name || "");
  const page = !!opts.page;
  const expanded = page || !!_hostServerExpanded[id];
  const card = document.createElement("div");
  card.className = "host-server-card"
    + (expanded ? " is-expanded" : " is-collapsed")
    + (page ? " is-page" : "");

  const reach = String(s.reachMode || "").toLowerCase();
  const reachDirect = reach === "direct";
  const deviceOnly = reach === "device" && !(s.isPublic === true || s.isPublic === "true");
  const pending = Array.isArray(s.pending) ? s.pending : [];
  const modeEl = document.createElement("span");
  modeEl.className = "host-server-mode"
    + (s.isPublic ? " is-public" : "")
    + (reachDirect ? " is-direct" : "")
    + (deviceOnly ? " is-device" : "");
  // Public stays orthogonal; near-field badge is device / Direct / Local.
  modeEl.textContent = s.isPublic
    ? "Public"
    : (reachDirect ? "Direct" : (deviceOnly ? "On this device" : "Local"));

  if (!page) {
    const summary = document.createElement("button");
    summary.type = "button";
    summary.className = "host-server-summary";
    summary.setAttribute("aria-expanded", expanded ? "true" : "false");
    const titles = document.createElement("div");
    titles.className = "host-server-summary-text";
    const nameEl = document.createElement("span");
    nameEl.className = "host-server-card-title";
    nameEl.textContent = s.name || "Server";
    titles.appendChild(nameEl);
    titles.appendChild(modeEl);
    if (!expanded && pending.length) {
      const badge = document.createElement("span");
      badge.className = "host-server-pending-badge";
      badge.textContent = `${pending.length} waiting`;
      titles.appendChild(badge);
    }
    summary.appendChild(titles);
    const toggle = document.createElement("span");
    toggle.className = "host-server-toggle-label";
    toggle.textContent = expanded ? "Hide" : "Show";
    summary.appendChild(toggle);
    summary.onclick = () => {
      _hostServerExpanded[id] = !expanded;
      readHostStatus();
      refreshHostSettingsPanel();
    };
    card.appendChild(summary);
    if (!expanded) return card;
  } else if (!opts.advanced) {
    const modeHead = document.createElement("div");
    modeHead.className = "host-server-page-mode";
    modeHead.appendChild(modeEl);
    card.appendChild(modeHead);
  }

  const details = document.createElement("div");
  details.className = "host-server-details";

  if (deviceOnly && !opts.advanced) {
    const setupBtn = document.createElement("button");
    setupBtn.type = "button";
    setupBtn.className = "channel-panel-pill host-primary-btn";
    setupBtn.textContent = "Set up sharing";
    setupBtn.onclick = () => {
      if (typeof openHostingGuide !== "function") {
        toast("Hosting guide isn’t available here");
        return;
      }
      openHostingGuide(s.id, {
        onBack: hostGuideBackToServer(s.id),
      });
    };
    details.appendChild(setupBtn);
  }

  const url = String(s.isPublic
    ? (s.publicUrl || (s.namedHostname ? `https://${s.namedHostname}` : "") || s.lanUrl || "")
    : (s.lanUrl || "")).trim();
  if (url && !deviceOnly) {
    const urlRow = document.createElement("div");
    urlRow.className = "host-server-url-row";
    const urlEl = document.createElement("div");
    urlEl.className = "host-server-meta host-server-url";
    urlEl.textContent = url;
    urlRow.appendChild(urlEl);
    const actions = document.createElement("div");
    actions.className = "host-server-url-actions";
    const copyUrl = document.createElement("button");
    copyUrl.type = "button";
    copyUrl.className = "server-settings-share-btn host-copy-url";
    copyUrl.textContent = "Copy URL";
    copyUrl.onclick = (e) => {
      e.stopPropagation();
      try {
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(url).then(() => toast("URL copied")).catch(() => toast(url));
        } else if (window.AshNative?.shareText) {
          AshNative.shareText(url);
        } else toast(url);
      } catch { toast(url); }
    };
    actions.appendChild(copyUrl);
    // Local / Direct: QR — Direct opens tabbed join modal; Local keeps LAN QR.
    if (!(s.isPublic === true || s.isPublic === "true")) {
      const reachDirect = String(s.reachMode || "").toLowerCase() === "direct";
      const qrLan = document.createElement("button");
      qrLan.type = "button";
      qrLan.className = "server-settings-share-btn";
      qrLan.textContent = "QR";
      qrLan.onclick = (e) => {
        e.stopPropagation();
        if (reachDirect && typeof openDirectJoinQrModal === "function") {
          openDirectJoinQrModal({ host: s });
          return;
        }
        if (typeof mountInviteQr === "function" && typeof AshModal?.open === "function") {
          const opened = AshModal.open({
            className: "modal-backdrop personal-invite-qr",
            html: `<div class="modal-card"><h4>Join on the same Wi-Fi</h4><p class="cat-hint">${esc(url)}</p>
              <p class="muted" style="font-size:12px;margin:0 0 8px">Same Wi‑Fi. Open in a browser or Phlip.</p>
              <div id="host-lan-qr-host" style="display:flex;justify-content:center;margin:12px 0"></div>
              <div class="actions"><button type="button" class="cancel" id="host-lan-qr-close">Close</button></div></div>`,
          });
          const hostEl = opened?.root?.querySelector?.("#host-lan-qr-host")
            || document.getElementById("host-lan-qr-host");
          mountInviteQr(hostEl, url, { size: 5 });
          opened?.overlay?.querySelector?.("#host-lan-qr-close")?.addEventListener("click", () => opened.close?.());
        } else toast(url);
      };
      actions.appendChild(qrLan);
    }
    urlRow.appendChild(actions);
    details.appendChild(urlRow);
  }

  if (s.error) {
    const err = document.createElement("div");
    err.className = "host-server-error";
    const label = document.createElement("div");
    label.className = "host-server-error-label";
    label.textContent = s.isPublic ? "Internet connection failed" : "Sharing error";
    const detail = document.createElement("div");
    detail.className = "host-server-error-detail";
    detail.textContent = String(s.error);
    err.appendChild(label);
    err.appendChild(detail);
    details.appendChild(err);
  }

  const isPublicHost = s.isPublic === true || s.isPublic === "true";
  // Personal `/j/<slug>` invite is for Public only. Local uses the bare LAN URL above.
  if (isPublicHost) {
  const codeBlock = document.createElement("div");
  codeBlock.className = "host-join-block";
  const hostedConn = (typeof S !== "undefined" && S.conns)
    ? (S.conns[`srv-local-${s.id}`] || S.conns[s.id] || null)
    : null;
  let inviteUrl = String(
    s.inviteUrl ||
    hostedConn?.me?.inviteUrl ||
    hostedConn?.inviteUrl ||
    "",
  ).trim();
  // Prefer rebuilding from public origin + slug (drop bare/legacy local forms).
  {
    const slug = String(
      s.inviteSlug ||
      hostedConn?.me?.inviteSlug ||
      hostedConn?.inviteSlug ||
      "",
    ).trim();
    const rebuilt = (slug && typeof buildPersonalInviteUrl === "function")
      ? buildPersonalInviteUrl(slug, hostedConn || {
        id: `srv-local-${s.id}`,
        shareLan: s.lanUrl || (Array.isArray(s.lanUrls) ? s.lanUrls[0] : ""),
        sharePublic: s.publicUrl || "",
        hostPublic: true,
        url: s.url || "",
      })
      : "";
    if (rebuilt) inviteUrl = rebuilt;
  }
  const inviteHint = "Internet invite on this server’s own domain.";
  const inviteRow = document.createElement("div");
  inviteRow.className = "host-join-code";
  inviteRow.innerHTML = `<span class="host-join-code-val">${esc(inviteUrl || "Loading invite link…")}</span>`;
  codeBlock.appendChild(inviteRow);
  const hintEl = document.createElement("p");
  hintEl.className = "muted host-invite-hint";
  hintEl.style.margin = "6px 0 0";
  hintEl.style.fontSize = "12px";
  hintEl.textContent = inviteHint;
  codeBlock.appendChild(hintEl);

  const applyInviteUrl = (url) => {
    const u = String(url || "").trim();
    if (!u) return false;
    inviteUrl = u;
    inviteRow.innerHTML = `<span class="host-join-code-val">${esc(u)}</span>`;
    if (hostedConn) {
      hostedConn.inviteUrl = u;
      if (hostedConn.me) hostedConn.me.inviteUrl = u;
    }
    s.inviteUrl = u;
    return true;
  };

  /** Native HostService path — works even if the host WebSocket is still connecting. */
  const fetchInviteViaNative = (rotate = false) => {
    const res = hostCall(rotate ? "rotateHostInviteLink" : "hostInviteLink", s.id);
    const url = String(res?.url || "").trim();
    if (url) applyInviteUrl(url);
    return url;
  };

  const actions = document.createElement("div");
  actions.className = "host-server-actions";
  const copyInvite = document.createElement("button");
  copyInvite.type = "button";
  copyInvite.className = "server-settings-share-btn";
  copyInvite.textContent = "Copy";
  copyInvite.onclick = async () => {
    let url = inviteUrl || fetchInviteViaNative(false);
    if (!url && hostedConn && typeof ensurePersonalInviteUrl === "function") {
      try { url = await ensurePersonalInviteUrl(hostedConn); } catch {}
    }
    if (!url && hostedConn && typeof requestPersonalInviteLink === "function") {
      try {
        const m = await requestPersonalInviteLink(hostedConn, { rotate: false });
        url = String(m?.url || "").trim();
      } catch {}
    }
    if (!url) { toast("No invite link yet"); return; }
    applyInviteUrl(url);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        toast("Invite link copied");
      } else if (window.AshNative?.shareText) {
        AshNative.shareText(url);
      } else toast(url);
    } catch { toast(url); }
  };
  actions.appendChild(copyInvite);

  const qrInvite = document.createElement("button");
  qrInvite.type = "button";
  qrInvite.className = "server-settings-share-btn";
  qrInvite.textContent = "QR";
  qrInvite.onclick = async () => {
    let url = inviteUrl || fetchInviteViaNative(false);
    if (!url && hostedConn && typeof ensurePersonalInviteUrl === "function") {
      try { url = await ensurePersonalInviteUrl(hostedConn); } catch {}
    }
    if (!url) { toast("No invite link yet"); return; }
    applyInviteUrl(url);
    if (hostedConn && typeof sharePersonalInviteLink === "function") {
      try { await sharePersonalInviteLink(hostedConn); return; } catch {}
    }
    if (typeof mountInviteQr === "function" && typeof AshModal?.open === "function") {
      const opened = AshModal.open({
        className: "modal-backdrop personal-invite-qr",
        html: `<div class="modal-card"><h4>Invite QR</h4><p class="cat-hint">${esc(url)}</p>
          <div id="host-invite-qr-host" style="display:flex;justify-content:center;margin:12px 0"></div>
          <div class="actions"><button type="button" class="cancel" id="host-invite-qr-close">Close</button></div></div>`,
      });
      const hostEl = opened?.root?.querySelector?.("#host-invite-qr-host")
        || document.getElementById("host-invite-qr-host");
      mountInviteQr(hostEl, url, { size: 5 });
      opened?.root?.querySelector?.("#host-invite-qr-close")?.addEventListener("click", () => opened.close?.());
      return;
    }
    toast(url);
  };
  actions.appendChild(qrInvite);

  const rotateInvite = document.createElement("button");
  rotateInvite.type = "button";
  rotateInvite.className = "server-settings-share-btn";
  rotateInvite.textContent = "Rotate";
  rotateInvite.onclick = async () => {
    if (!(await ashConfirm("Rotate your personal invite link? The old link stops attributing new requests to you."))) return;
    try {
      let url = fetchInviteViaNative(true);
      if (!url && hostedConn && typeof requestPersonalInviteLink === "function") {
        const m = await requestPersonalInviteLink(hostedConn, { rotate: true });
        url = String(m?.url || "").trim();
        if (url) applyInviteUrl(url);
      }
      if (url) toast("Invite link rotated");
      else toast("Couldn't rotate invite link");
    } catch (e) {
      toast(e?.message || "Couldn't rotate invite link");
    }
  };
  actions.appendChild(rotateInvite);
  codeBlock.appendChild(actions);

  // Warm the link if missing — prefer native (no WS required).
  if (!inviteUrl) {
    const warmed = fetchInviteViaNative(false);
    if (!warmed && hostedConn && typeof ensurePersonalInviteUrl === "function") {
      ensurePersonalInviteUrl(hostedConn).then((url) => {
        if (url) applyInviteUrl(url);
      }).catch(() => {});
    }
  }
  details.appendChild(codeBlock);
  }

  if (!opts.advanced && !deviceOnly && typeof buildHostHotspotSection === "function") {
    details.appendChild(buildHostHotspotSection(s));
  }

  if (!opts.advanced) {
  const toggles = document.createElement("div");
  toggles.className = "host-server-toggles";

  const publicReady = !!setup.publicReady;
  const pub = document.createElement("label");
  pub.className = "server-settings-row side-toggle" + (publicReady || s.isPublic ? "" : " is-locked");
  const pubLabel = s.isPublic ? "Public · ON" : (publicReady ? "Public hosting" : "Public hosting (locked)");
  pub.innerHTML = `<span>${pubLabel}</span>
    <input type="checkbox" ${s.isPublic ? "checked" : ""} ${(!publicReady && !s.isPublic) ? "disabled" : ""}>`;
  if (!publicReady && !s.isPublic) {
    const hint = document.createElement("button");
    hint.type = "button";
    hint.className = "host-locked-hint";
    hint.textContent = setup.publicBlockReason || "Finish Hosting setup first";
    hint.onclick = () => {
      openHostSettingsPanel("hostSetup");
    };
    toggles.appendChild(pub);
    toggles.appendChild(hint);
  } else {
    pub.querySelector("input").onchange = async (e) => {
      const on = !!e.target.checked;
      if (on) {
        if (!setup.publicReady) {
          e.target.checked = false;
          toast(setup.publicBlockReason || "Finish Setup before going Public");
          openHostSettingsPanel("hostSetup");
          return;
        }
        if (!(await ashConfirm("Make this server Public? Friends can reach it from the internet via Cloudflare."))) {
          e.target.checked = false;
          return;
        }
      } else if (!(await ashConfirm("Turn off Public? Near-field stays Local or Direct as set below."))) {
        e.target.checked = true;
        return;
      }
      const res = hostCall("setPublicHosting", s.id, on);
      if (res?.ok === false) {
        e.target.checked = !on;
        toast(res.error || "Could not change Public");
      } else {
        toast(on ? "Public hosting on" : "Public off");
      }
      setTimeout(() => { readHostStatus(); refreshHostSettingsPanel(); }, 300);
    };
    toggles.appendChild(pub);
  }
  details.appendChild(toggles);
  }

  if (!page && typeof serverBackupNativeAvailable === "function" && serverBackupNativeAvailable()) {
    const bakLabel = document.createElement("div");
    bakLabel.className = "channel-panel-section-label";
    bakLabel.style.marginTop = "10px";
    bakLabel.textContent = "Backup";
    details.appendChild(bakLabel);
    const bakNote = document.createElement("p");
    bakNote.className = "side-role-hint host-settings-note";
    bakNote.textContent = "Passphrase-encrypted files you can restore on this phone if something goes wrong.";
    details.appendChild(bakNote);
    const bakRow = document.createElement("div");
    bakRow.className = "host-server-actions";
    const structBtn = document.createElement("button");
    structBtn.type = "button";
    structBtn.className = "server-settings-share-btn";
    structBtn.textContent = "Structure…";
    structBtn.onclick = (e) => {
      e.stopPropagation();
      openServerBackupExportFlow(s.id, "server-structure", s.name || "server");
    };
    const fullBtn = document.createElement("button");
    fullBtn.type = "button";
    fullBtn.className = "server-settings-share-btn";
    fullBtn.textContent = "Full…";
    fullBtn.onclick = (e) => {
      e.stopPropagation();
      openServerBackupExportFlow(s.id, "server-full", s.name || "server");
    };
    bakRow.appendChild(structBtn);
    bakRow.appendChild(fullBtn);
    details.appendChild(bakRow);
  }

  if (pending.length) {
    const ph = document.createElement("div");
    ph.className = "channel-panel-section-label";
    ph.style.marginTop = "6px";
    ph.textContent = "Waiting to join";
    details.appendChild(ph);
    for (const p of pending) {
      const row = document.createElement("div");
      row.className = "host-pending-row";
      const via = String(p.invitedByName || "").trim();
      row.innerHTML = `<span>${esc(p.name || "Someone")}${via
        ? `<span class="muted"> · Requested via ${esc(via)}'s link</span>`
        : ""}</span>`;
      const ok = document.createElement("button");
      ok.type = "button";
      ok.className = "people-btn";
      ok.textContent = "Approve";
      ok.onclick = () => {
        hostCall("approveJoin", s.id, p.id);
        setTimeout(() => { readHostStatus(); refreshHostSettingsPanel(); }, 200);
      };
      const no = document.createElement("button");
      no.type = "button";
      no.className = "people-btn danger";
      no.textContent = "Deny";
      no.onclick = () => {
        hostCall("denyJoin", s.id, p.id);
        setTimeout(() => { readHostStatus(); refreshHostSettingsPanel(); }, 200);
      };
      row.appendChild(ok);
      row.appendChild(no);
      details.appendChild(row);
    }
  }

  if (!page) {
  const danger = document.createElement("div");
  danger.className = "host-server-danger";
  const dangerLabel = document.createElement("div");
  dangerLabel.className = "channel-panel-section-label";
  dangerLabel.textContent = "Danger zone";
  const del = document.createElement("button");
  del.type = "button";
  del.className = "server-settings-row remove-server-link host-server-delete";
  del.textContent = "Delete server";
  del.onclick = async () => {
    if (!(await ashConfirm(`Delete “${s.name}”? This cannot be undone.`, { danger: true }))) return;
    const typed = prompt("Type DELETE to remove this server:");
    if (String(typed || "").trim().toUpperCase() !== "DELETE") {
      toast("Cancelled");
      return;
    }
    hostCall("deleteHostedServer", s.id);
    toast("Server deleted");
    setTimeout(() => {
      readHostStatus();
      if (page) {
        if (typeof closeSideOverlay === "function") closeSideOverlay();
        return;
      }
      refreshHostSettingsPanel();
    }, 300);
  };
  danger.appendChild(dangerLabel);
  danger.appendChild(del);
  details.appendChild(danger);
  }
  card.appendChild(details);
  return card;
}

function fillHostedServerSettingsBody(body) {
  if (!body) return;
  body.innerHTML = "";
  const status = (typeof readHostStatus === "function" && readHostStatus())
    || { setup: {}, servers: [], running: false };
  const setup = status.setup || {};
  const running = !!status.running;
  const s = (status.servers || []).find((x) => String(x.id) === String(_hostedServerSettingsId));
  if (!s) {
    const empty = document.createElement("p");
    empty.className = "channel-panel-empty";
    empty.textContent = running ? "That server isn’t hosted on this phone." : "Hosting is off on this phone.";
    body.appendChild(empty);
    if (!running) appendHostStartButton(body);
    return;
  }
  renderServerSharing(body, s, setup, running);
}

/**
 * Per-server hosting settings (reach control). Raw id or `srv-local-*`.
 * @param {string} serverId
 */
function openHostedServerSettings(serverId) {
  _hostedServerSettingsId = String(serverId || "").replace(/^srv-local-/, "");
  if (!_hostedServerSettingsId) {
    toast("No server to host");
    return;
  }
  const status = (typeof readHostStatus === "function" && readHostStatus()) || { servers: [] };
  const s = (status.servers || []).find((x) => String(x.id) === String(_hostedServerSettingsId));
  if (typeof openNav === "function") openNav();
  if (typeof closeChannelPanel === "function" && Panel.channelOpen()) closeChannelPanel();
  openSideOverlay({
    kind: "hostServer",
    title: (s && s.name) || "Hosting",
    bodyClass: ["server-settings-body", "host-settings-body"],
    mount: fillHostedServerSettingsBody,
  });
}

function fillHostedServerDataSettingsBody(body) {
  if (!body) return;
  body.innerHTML = "";
  const status = (typeof readHostStatus === "function" && readHostStatus()) || { servers: [] };
  const s = (status.servers || []).find((x) => String(x.id) === String(_hostedServerSettingsId));
  if (!s) {
    body.innerHTML = '<p class="channel-panel-empty">That server isn’t hosted on this phone.</p>';
    return;
  }
  const titleEl = document.getElementById("side-overlay-title");
  if (titleEl) titleEl.textContent = `Data · ${s.name || "Server"}`;
  const main = document.createElement("div");
  main.className = "ss-main host-settings-main";
  const backupLabel = document.createElement("div");
  backupLabel.className = "channel-panel-section-label";
  backupLabel.textContent = "Backup & restore";
  main.appendChild(backupLabel);
  const note = document.createElement("p");
  note.className = "side-role-hint host-settings-note";
  note.textContent = "Passphrase-encrypted files you can restore on this phone if something goes wrong.";
  main.appendChild(note);
  if (typeof serverBackupNativeAvailable === "function" && serverBackupNativeAvailable()) {
    const row = document.createElement("div");
    row.className = "host-server-actions";
    for (const [label, kind] of [["Structure…", "server-structure"], ["Full…", "server-full"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "server-settings-share-btn";
      button.textContent = label;
      button.onclick = () => openServerBackupExportFlow(s.id, kind, s.name || "server");
      row.appendChild(button);
    }
    main.appendChild(row);
  }
  body.appendChild(main);
}

function openHostedServerDataSettings(serverId) {
  _hostedServerSettingsId = String(serverId || "").replace(/^srv-local-/, "");
  if (!_hostedServerSettingsId) { toast("No server selected"); return; }
  if (typeof openNav === "function") openNav();
  if (typeof closeChannelPanel === "function" && Panel.channelOpen()) closeChannelPanel();
  openSideOverlay({
    kind: "hostServerData",
    title: "Server data",
    bodyClass: ["server-settings-body", "host-settings-body"],
    mount: fillHostedServerDataSettingsBody,
  });
}

/** Which setup cards have their full text expanded (re-show). */
const _hostSetupExpanded = Object.create(null);
/** Cloudflare · Public cards stay collapsed until the user taps Show. */
let _hostSetupPublicShown = false;
