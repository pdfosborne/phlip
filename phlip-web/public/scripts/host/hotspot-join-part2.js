/* hotspot-join-part2.js — split from hotspot-join.js (Part 3 size ceiling).
 * Load after: hotspot-join-part1.js; part of hotspot-join cluster.
 */

function directJoinPayloadFromHost(src = null) {
  let s = src && typeof src === "object" ? { ...src } : {};
  const wantId = String(s.id || s.serverId || "").replace(/^srv-local-/, "");
  try {
    const st = typeof readHostStatus === "function" ? readHostStatus() : null;
    const servers = Array.isArray(st?.servers) ? st.servers : [];
    const hit = wantId
      ? servers.find((x) => String(x.id) === wantId)
      : servers.find((x) => String(x.reachMode || "").toLowerCase() === "direct" && x.hotspotActive)
        || servers.find((x) => x.hotspotActive)
        || servers.find((x) => String(x.reachMode || "").toLowerCase() === "direct");
    if (hit) s = { ...hit, ...s, id: hit.id || s.id };
  } catch {}
  const sess = (typeof _hotspotSession !== "undefined" && _hotspotSession?.active)
    ? _hotspotSession
    : null;
  // Prefer live session when it matches this server.
  const sessMatch = sess && (!wantId || String(sess.serverId || "") === wantId);
  const joinUrl = String(
    (sessMatch && sess.lanUrl) || s.hotspotLanUrl || s.lanUrl
      || (Array.isArray(s.lanUrls) ? s.lanUrls[0] : "") || "",
  ).trim();
  const wifiUri = String((sessMatch && sess.qrUri) || s.hotspotQrUri || "").trim();
  const ssid = String((sessMatch && sess.ssid) || s.hotspotSsid || "").trim();
  const password = String((sessMatch && sess.password) || s.hotspotPassword || "").trim();
  const serverId = String(s.id || (sessMatch && sess.serverId) || "").trim();
  const name = String(s.name || (sessMatch && sess.serverName) || "server").trim();
  const hotspotActive = !!(s.hotspotActive || (sessMatch && sess.active));
  const radioLive = s.hotspotRadioLive !== false && (hotspotActive || !!wifiUri);
  return {
    serverId,
    name,
    joinUrl,
    wifiUri,
    ssid,
    password,
    radioLive,
    hotspotActive,
    reachDirect: String(s.reachMode || "").toLowerCase() === "direct"
      || hotspotActive
      || !!wifiUri,
  };
}

function directJoinPayloadFromConn(conn) {
  if (!conn) return directJoinPayloadFromHost(null);
  const rawId = String(conn.id || "").replace(/^srv-local-/, "");
  return directJoinPayloadFromHost({
    id: rawId,
    name: conn.name || conn.hostName || "",
    reachMode: conn.reachMode || (conn.hotspotPreferred || conn.hotspotActive ? "direct" : ""),
    hotspotActive: conn.hotspotActive,
    hotspotSsid: conn.hotspotSsid,
    hotspotPassword: conn.hotspotPassword,
    hotspotLanUrl: conn.shareLan || "",
    lanUrl: conn.shareLan || "",
    hotspotQrUri: "",
  });
}

/**
 * Tabbed Direct join QR modal — Wi‑Fi + Server URL.
 * Used from host card, Soft‑AP “Join QRs”, and sidebar Invite when Direct.
 */
function openDirectJoinQrModal(opts = {}) {
  if (typeof AshModal?.open !== "function") {
    toast("QR viewer unavailable");
    return false;
  }
  const p = opts.joinUrl || opts.wifiUri
    ? opts
    : (opts.conn ? directJoinPayloadFromConn(opts.conn) : directJoinPayloadFromHost(opts.host || opts));
  const wifiUri = String(p.wifiUri || "").trim();
  const joinUrl = String(p.joinUrl || "").trim();
  const ssid = String(p.ssid || "").trim();
  const password = String(p.password || "").trim();
  const name = String(p.name || "server").trim();
  if (!wifiUri && !joinUrl) {
    toast("Start Direct link first");
    return false;
  }
  let tab = wifiUri ? (opts.tab || "wifi") : "server";
  if (tab === "wifi" && !wifiUri) tab = "server";

  const phlipJoin = joinUrl ? `phlip://join?url=${encodeURIComponent(joinUrl)}` : "";
  const shareText = [
    `Join ${name} on Phlip (Direct)`,
    ssid && password ? `1. Wi‑Fi "${ssid}" · ${password}` : "1. Join the host’s Direct Wi‑Fi",
    joinUrl ? `2. Open ${joinUrl}` : "",
    phlipJoin ? `   Or ${phlipJoin}` : "",
  ].filter(Boolean).join("\n");

  const wifiTabBtn = wifiUri
    ? `<button type="button" class="cosmetics-tab${tab === "wifi" ? " on" : ""}" role="tab" aria-selected="${tab === "wifi" ? "true" : "false"}" data-direct-join-tab="wifi">Wi‑Fi</button>`
    : "";
  const opened = AshModal.open({
    className: "modal-backdrop personal-invite-qr direct-join-qr",
    html: `
      <div class="modal-card direct-join-qr-modal">
        <h4>Direct join</h4>
        <div class="cosmetics-tabs" role="tablist" aria-label="Direct join">
          ${wifiTabBtn}
          <button type="button" class="cosmetics-tab${tab === "server" || !wifiUri ? " on" : ""}" role="tab" aria-selected="${tab === "server" || !wifiUri ? "true" : "false"}" data-direct-join-tab="server">Server</button>
        </div>
        <div class="cosmetics-pane direct-join-pane" id="direct-join-pane-wifi" data-pane="wifi" ${tab === "wifi" && wifiUri ? "" : "hidden"}>
          <p class="muted direct-join-hint">Scan to join this phone’s Wi‑Fi.</p>
          <div id="direct-join-wifi-qr" class="event-pass-qr-host direct-join-qr-host"></div>
          ${password ? `<div class="hotspot-cred-block direct-join-cred"><div class="hotspot-cred-row"><span class="muted">Password</span><code id="direct-join-pass">${esc(password)}</code></div></div>
            <button type="button" class="server-settings-share-btn" id="direct-join-copy-pass">Copy password</button>` : ""}
          ${!wifiUri ? `<p class="muted">Start Direct link for a Wi‑Fi QR.</p>` : ""}
        </div>
        <div class="cosmetics-pane direct-join-pane" id="direct-join-pane-server" data-pane="server" ${tab === "server" || !wifiUri ? "" : "hidden"}>
          <p class="muted direct-join-hint">After Wi‑Fi, scan or open the server URL.</p>
          <p class="cat-hint" id="direct-join-url-label">${esc(joinUrl || "No server URL yet")}</p>
          <div id="direct-join-server-qr" class="event-pass-qr-host direct-join-qr-host"></div>
          <div class="actions direct-join-actions">
            <button type="button" class="save" id="direct-join-copy-url" ${joinUrl ? "" : "disabled"}>Copy URL</button>
            <button type="button" class="save" id="direct-join-share" ${joinUrl ? "" : "disabled"}>Share</button>
          </div>
        </div>
        <div class="actions">
          <button type="button" class="cancel" id="direct-join-close">Close</button>
        </div>
      </div>`,
    singleton: "return",
  });
  if (!opened) return false;
  const { overlay, close } = opened;
  const root = overlay?.querySelector?.(".modal-card") || overlay;

  const syncTabs = () => {
    root.querySelectorAll("[data-direct-join-tab]").forEach((btn) => {
      const on = btn.dataset.directJoinTab === tab;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    root.querySelectorAll(".direct-join-pane").forEach((pane) => {
      pane.hidden = pane.dataset.pane !== tab;
    });
  };
  root.querySelectorAll("[data-direct-join-tab]").forEach((btn) => {
    btn.onclick = () => {
      const next = btn.dataset.directJoinTab;
      if (next === "wifi" && !wifiUri) {
        toast("Start Direct link for a Wi‑Fi QR");
        return;
      }
      tab = next;
      syncTabs();
    };
  });
  syncTabs();

  if (wifiUri && typeof mountInviteQr === "function") {
    mountInviteQr(root.querySelector("#direct-join-wifi-qr"), wifiUri, { size: 4 });
  }
  if (joinUrl && typeof mountInviteQr === "function") {
    mountInviteQr(root.querySelector("#direct-join-server-qr"), joinUrl, { size: 4 });
  }

  root.querySelector("#direct-join-close").onclick = close;
  root.querySelector("#direct-join-copy-pass")?.addEventListener("click", async () => {
    if (!password) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(password);
        toast("Password copied");
      } else toast(password);
    } catch { toast(password); }
  });
  root.querySelector("#direct-join-copy-url")?.addEventListener("click", async () => {
    if (!joinUrl) return;
    if (typeof sharePlainText === "function") {
      await sharePlainText(joinUrl, { copiedToast: "URL copied", fallbackToast: joinUrl });
    } else {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(joinUrl);
          toast("URL copied");
        } else toast(joinUrl);
      } catch { toast(joinUrl); }
    }
  });
  root.querySelector("#direct-join-share")?.addEventListener("click", async () => {
    if (typeof sharePlainText === "function") {
      await sharePlainText(shareText, { copiedToast: "Join steps copied", fallbackToast: joinUrl });
    } else if (AshNative?.shareText) {
      AshNative.shareText(shareText);
    } else toast(shareText);
  });
  return true;
}

function buildHostHotspotSection(s) {
  const block = document.createElement("div");
  block.className = "host-hotspot-block";
  const reachDirect = String(s.reachMode || "").toLowerCase() === "direct";
  const active = !!s.hotspotActive;

  if (!reachDirect) {
    const modeHint = document.createElement("p");
    modeHint.className = "muted host-hotspot-hint";
    modeHint.textContent = "Use Direct when shared Wi‑Fi can’t support Phlip.";
    block.appendChild(modeHint);
    const modeRow = document.createElement("div");
    modeRow.className = "host-server-actions host-reach-mode-row";
    const toDirect = document.createElement("button");
    toDirect.type = "button";
    toDirect.className = "server-settings-share-btn host-hotspot-start";
    toDirect.textContent = "Use Direct instead of Local";
    toDirect.onclick = async () => {
      if (!(await ashConfirm(
        "Switch this server to Direct? Nearby phones join via a temporary Wi‑Fi from this phone. Public hosting (if on) is unchanged.",
      ))) return;
      const res = (typeof hostCall === "function" ? hostCall : hotspotApi)("setReachMode", s.id, "direct");
      if (res?.ok === false) {
        toast(res.error || "Could not switch to Direct");
        return;
      }
      toast("Direct locked — start Direct link when ready");
      setTimeout(() => { readHostStatus?.(); refreshHostSettingsPanel?.(); }, 200);
    };
    modeRow.appendChild(toDirect);
    block.appendChild(modeRow);
    return block;
  }

  const makeToLocalBtn = () => {
    const toLocal = document.createElement("button");
    toLocal.type = "button";
    toLocal.className = "server-settings-share-btn";
    toLocal.textContent = "Switch back to Local";
    toLocal.onclick = async () => {
      if (!(await ashConfirm(
        "Switch back to Local? Any live Direct link for this server will end.",
        { danger: true },
      ))) return;
      const res = (typeof hostCall === "function" ? hostCall : hotspotApi)("setReachMode", s.id, "local");
      if (res?.ok === false) {
        toast(res.error || "Could not switch to Local");
        return;
      }
      toast("Local restored");
      setTimeout(() => { readHostStatus?.(); refreshHostSettingsPanel?.(); }, 200);
    };
    return toLocal;
  };

  if (active) {
    const radioLive = s.hotspotRadioLive !== false;
    const radioNote = String(s.hotspotRadioNote || "").trim();
    // Full-width status row at top — no Switch to Local while Direct link is up.
    const live = document.createElement("div");
    live.className = "host-hotspot-live host-hotspot-live-row";
    live.innerHTML = `<span class="host-hotspot-badge">${radioLive ? "Direct link live" : "Direct link paused"}</span>${
      radioLive ? "" : `<p class="muted host-hotspot-hint">${esc(radioNote || "Start Direct link again when needed.")}</p>`
    }`;
    block.appendChild(live);

    const shareRow = document.createElement("div");
    shareRow.className = "host-server-actions";
    const joinQrBtn = document.createElement("button");
    joinQrBtn.type = "button";
    joinQrBtn.className = "server-settings-share-btn host-hotspot-start";
    joinQrBtn.textContent = "Join QRs";
    joinQrBtn.onclick = (e) => {
      e.stopPropagation();
      openDirectJoinQrModal({ host: s });
    };
    shareRow.appendChild(joinQrBtn);

    const newNetBtn = document.createElement("button");
    newNetBtn.type = "button";
    newNetBtn.className = "server-settings-share-btn";
    newNetBtn.textContent = "New Wi‑Fi name";
    newNetBtn.onclick = async () => {
      if (!(await ashConfirm(
        "Create a new Direct Wi‑Fi name? Friends must join the new network.",
        { danger: true },
      ))) return;
      newNetBtn.disabled = true;
      toast("Starting new network…");
      try {
        const res = hotspotApi("rotateHotspotSession", s.id);
        if (res?.ok) {
          toast(res.ssid ? `New network: ${res.ssid}` : "New network ready");
          readHostStatus?.();
          refreshHostSettingsPanel?.();
        } else if (res?.needsLocation) {
          toast(res.error || "Turn on Location, then try again");
          hotspotApi("openLocationSettings");
        } else {
          toast(res?.error || "Could not rotate network");
        }
      } finally {
        newNetBtn.disabled = false;
      }
    };
    shareRow.appendChild(newNetBtn);

    const endBtn = document.createElement("button");
    endBtn.type = "button";
    endBtn.className = "server-settings-share-btn danger";
    endBtn.textContent = "End Direct link";
    endBtn.onclick = async () => {
      if (!(await ashConfirm(
        "End Direct link? Server stays Direct until you switch back to Local.",
        { danger: true },
      ))) return;
      hotspotApi("endHotspotSession");
      toast("Direct link ended — still Direct");
      setTimeout(() => { readHostStatus?.(); refreshHostSettingsPanel?.(); }, 200);
    };
    shareRow.appendChild(endBtn);
    block.appendChild(shareRow);
  } else {
    // Direct locked, link off: Switch to Local + Start on one row.
    const modeRow = document.createElement("div");
    modeRow.className = "host-server-actions host-reach-mode-row host-direct-idle-actions";
    modeRow.appendChild(makeToLocalBtn());
    const startBtn = document.createElement("button");
    startBtn.type = "button";
    startBtn.className = "server-settings-share-btn host-hotspot-start";
    startBtn.textContent = "Start Direct link";
    startBtn.onclick = async () => {
      if (!(await ashConfirm("Start a Direct link (temporary Wi‑Fi) for nearby joiners? Uses extra battery while active."))) return;
      startBtn.disabled = true;
      toast("Starting Direct link…");
      try {
        const res = hotspotApi("startHotspotSession", s.id);
        if (res?.ok) {
          toast(res.ssid ? `Direct link · ${res.ssid}` : "Direct link started");
          readHostStatus?.();
          refreshHostSettingsPanel?.();
        } else if (res?.needsLocation) {
          toast(res.error || "Turn on Location, then try again");
          hotspotApi("openLocationSettings");
        } else {
          toast(res?.error || "Could not start Direct link");
        }
      } finally {
        startBtn.disabled = false;
      }
    };
    modeRow.appendChild(startBtn);
    block.appendChild(modeRow);
  }
  return block;
}
