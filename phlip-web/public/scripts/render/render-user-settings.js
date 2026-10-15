/* render-user-settings.js — profile, display name, server options, factory reset,
 *   server icon editor.
 * Globals out: openUserSettings, openUserSettingsModal, openServerOptionsPanel,
 *   mountUserYouProfile, mountServerOptionsForm, mountUserSoundSettings,
 *   mountUserPersonalSpaceSettings, mountUserOtherSettings, openServerIconModal, …
 * Load after: render-backup.js; before: user-profile-overlay.js
 */

/* ------------------------------ user settings ----------------------------- */

/** Re-encode an oversized local photo down to the live-face budget. */
function shrinkDataUrlToBudget(dataUrl, maxBytes = LIVE_PIC_MAX_BYTES, outPx = LIVE_PIC_OUT_PX) {
  return new Promise((resolve) => {
    if (!dataUrl) return resolve("");
    if (dataUrl.length <= maxBytes) return resolve(dataUrl);
    const img = new Image();
    img.onload = () => {
      let edge = outPx;
      const paint = () => {
        const c = document.createElement("canvas");
        c.width = edge;
        c.height = edge;
        c.getContext("2d").drawImage(img, 0, 0, edge, edge);
        let q = LIVE_PIC_JPEG_Q;
        let data = c.toDataURL("image/jpeg", q);
        while (data.length > maxBytes && q > 0.35) {
          q -= 0.07;
          data = c.toDataURL("image/jpeg", q);
        }
        if (data.length <= maxBytes) return resolve(data);
        if (edge <= 48) return resolve("");
        edge = Math.max(48, Math.round(edge * 0.85));
        paint();
      };
      paint();
    };
    img.onerror = () => resolve("");
    img.src = dataUrl;
  });
}

async function syncMyProfile(conn = null) {
  const targets = conn ? [conn] : Object.values(S.conns || {});
  const me = loadMe();
  const served = isServedOrigin();
  for (const c of targets) {
    if (!c || PersonalSpace.isPersonal(c) || c.status !== "online") continue;
    const override = typeof getServerProfileOverride === "function"
      ? getServerProfileOverride(c.id) : null;
    const profileName = String(c.me?.name || "").trim() || me.name;
    const offlineRaw = normalizeOfflineAvatar(
      override?.offlineAvatar || me.offlineAvatar, me.id, profileName);
    // Servers with drawing off reject draw payloads — fall back to letters there.
    const offline = (offlineRaw.mode === "draw"
        && typeof canUserDraw === "function" && !canUserDraw(c))
      ? {
          mode: "letters",
          text: normalizeAvatarLetters("", profileName),
          color: offlineRaw.color || defaultOfflineAvatar(me.id, profileName).color,
        }
      : offlineRaw;
    let livePhoto = (override && Object.prototype.hasOwnProperty.call(override, "localPhoto"))
      ? (override.localPhoto || "")
      : (me.localPhoto || "");
    if (!served && livePhoto && livePhoto.length > LIVE_PIC_MAX_BYTES) {
      livePhoto = await shrinkDataUrlToBudget(livePhoto);
      if (livePhoto && override && Object.prototype.hasOwnProperty.call(override, "localPhoto")) {
        try { setServerProfileOverride(c.id, { localPhoto: livePhoto }); } catch {}
      } else if (livePhoto && livePhoto !== me.localPhoto) {
        saveMe({ localPhoto: livePhoto });
      }
    }
    try { sendTo(c, { type: "setOfflineAvatar", offlineAvatar: offline }); } catch {}
    // Camera photos: browser never publishes; app publishes by server mode.
    if (served) {
      if (c._lastLivePicSent) {
        c._lastLivePicSent = "";
        try { sendTo(c, { type: "setLivePic", data: "" }); } catch {}
      }
      continue;
    }
    const mode = (typeof serverSettings === "function"
      ? serverSettings(c).liveProfilePhotos
      : "off");
    const live = (mode === "online" && livePhoto) ? livePhoto : "";
    const persisted = (mode === "always" && livePhoto) ? livePhoto : "";

    if (mode !== "online") {
      if (c._lastLivePicSent) {
        c._lastLivePicSent = "";
        try { sendTo(c, { type: "setLivePic", data: "" }); } catch {}
      }
    } else if ((c._lastLivePicSent || "") !== live) {
      c._lastLivePicSent = live;
      try { sendTo(c, { type: "setLivePic", data: live }); } catch {}
    }

    if (mode !== "always") {
      if (c._lastProfilePicSent) {
        c._lastProfilePicSent = "";
        try { sendTo(c, { type: "setProfilePic", data: "" }); } catch {}
      }
    } else if ((c._lastProfilePicSent || "") !== persisted) {
      c._lastProfilePicSent = persisted;
      try { sendTo(c, { type: "setProfilePic", data: persisted }); } catch {}
    }
  }
}

/** 016 — wait for displayNameSet / nameTaken from a remote server. */
function requestSetDisplayName(conn, nextName) {
  return new Promise((resolve) => {
    if (!conn) {
      resolve({ type: "error", error: "No server.", code: "offline" });
      return;
    }
    S.displayNameWaiters = S.displayNameWaiters || {};
    const prev = S.displayNameWaiters[conn.id];
    if (typeof prev === "function") prev({ type: "error", error: "cancelled", code: "cancelled" });
    const timer = setTimeout(() => {
      if (S.displayNameWaiters?.[conn.id] === finish) {
        delete S.displayNameWaiters[conn.id];
        resolve({ type: "error", error: "Timed out renaming.", code: "timeout" });
      }
    }, 8000);
    const finish = (m) => {
      clearTimeout(timer);
      delete S.displayNameWaiters[conn.id];
      resolve(m || { type: "error", error: "Rename failed." });
    };
    S.displayNameWaiters[conn.id] = finish;
    try { sendTo(conn, { type: "setDisplayName", name: nextName }); } catch (e) {
      finish({ type: "error", error: e?.message || "Couldn't rename." });
    }
  });
}

function applyLocalDisplayName(conn, name) {
  const nm = String(name || "").trim().slice(0, 24);
  if (!conn?.me || !nm) return;
  conn.me.name = nm;
  if (Array.isArray(conn.members)) {
    conn.members = conn.members.map(u => (u && u.id === conn.me.id) ? { ...u, name: nm } : u);
  }
  try { persistConnSession(conn, { userName: nm }); } catch {}
}

/**
 * 016 — set display name on a server with collision ceremony. Returns final name or null.
 */
async function setServerDisplayNameWithCollision(conn, desiredName) {
  let tryName = String(desiredName || "").trim().slice(0, 24);
  if (!tryName) {
    toast("Pick a name so friends know who you are.");
    return null;
  }
  if (conn.status !== "online" || !conn.token) {
    toast("Connect to this server to change your name.");
    return null;
  }
  for (let i = 0; i < 4; i++) {
    if (tryName === (conn.me?.name || "")) return tryName;
    const res = await requestSetDisplayName(conn, tryName);
    if (res?.type === "displayNameSet" || res?.ok) {
      const name = res.name || tryName;
      applyLocalDisplayName(conn, name);
      return name;
    }
    if (res?.code === "nameTaken" || /already uses that name/i.test(res?.error || "")) {
      const next = typeof promptNameCollision === "function"
        ? await promptNameCollision(res.takenName || tryName)
        : null;
      if (!next) return null;
      tryName = next;
      continue;
    }
    toast(res?.error || "Couldn't rename on this server.");
    return null;
  }
  toast("Couldn't find a free name — try again.");
  return null;
}

/** Server options: display name, per-server profile pics, leave (joined non-personal servers). */
function mountServerOptionsForm(root, conn = null) {
  const c = conn || (typeof activeConn === "function" ? activeConn() : null);
  if (!root || !c || PersonalSpace.isPersonal(c) || !c.me) {
    if (root) root.innerHTML = `<p class="feel-strength-hint">Open a joined server for per-server profile options.</p>`;
    return null;
  }
  const me = loadMe();
  const served = isServedOrigin();
  const serverLabel = c.name || c.hostName || "this server";
  const current = String(c.me.name || "").trim();
  const hostSet = !!c.me.nameHostSet;
  const selfWanted = String(c.me.nameSelf || "").trim();
  const isHost = !!(c.me?.isHost
    || (typeof effectiveRole === "function" && effectiveRole(c.me) === ROLE_HOST));
  const hasOverride = !!getServerProfileOverride(c.id);
  let draftPhoto = served ? "" : effectiveServerLocalPhoto(c.id);
  let draftOffline = effectiveServerOfflineAvatar(c.id);
  const liveMode = typeof serverSettings === "function"
    ? serverSettings(c).liveProfilePhotos
    : "off";
  const photoHeading = liveMode === "always"
    ? `Profile photo <em>stored on this server</em>`
    : liveMode === "online"
      ? `Online photo <em>host memory while online — not saved</em>`
      : `Online photo <em>not used on this server</em>`;
  const leaveBlock = isHost
    ? `<p class="feel-strength-hint server-display-leave-hint">You’re the host — delete this server from its hosting page (reach line in the sidebar) instead of leaving.</p>`
    : `<div class="server-display-leave">
        <button type="button" class="people-btn danger leave-server-link" id="server-options-leave">
          ${ic("logout", "ico-inline")} Leave server
        </button>
      </div>`;
  root.innerHTML = `
      <div class="field">
        <label for="server-options-name">Your name in ${esc(serverLabel)}${hostSet ? ` <span class="people-host-set-badge">Host-set</span>` : ""}</label>
        <input id="server-options-name" maxlength="24" autocomplete="nickname"
          value="${esc(current)}" placeholder="Your name">
        ${hostSet
          ? `<p class="feel-strength-hint">The host set this name${selfWanted && selfWanted !== current ? ` (you had chosen “${esc(selfWanted)}”)` : ""}. Changing it clears the host override for you here.</p>`
          : ""}
      </div>
      ${served ? "" : `<div class="user-settings-section server-options-profile">
        <h5>${photoHeading}</h5>
        <div class="user-avatar-row">
          <button type="button" class="user-avatar-preview" id="so-online-preview" aria-label="Choose photo"></button>
          <div class="user-avatar-actions">
            <button type="button" class="people-btn" id="so-online-clear">Remove</button>
          </div>
        </div>
      </div>`}
      <div class="user-settings-section server-options-profile">
        <h5>${served ? "Avatar" : "Offline avatar"}</h5>
        <div class="user-avatar-row">
          <div class="user-avatar-preview" id="so-offline-preview" aria-hidden="true"></div>
          <div class="user-avatar-actions user-offline-letter-actions">
            <div class="field user-offline-letters-field">
              <label for="so-offline-letters">Letters</label>
              <input id="so-offline-letters" maxlength="2" autocomplete="off" spellcheck="false"
                value="${esc(draftOffline.mode === "draw" ? "" : (draftOffline.text || ""))}"
                placeholder="${esc(initials(current || me.name || "?") || "AA")}" aria-label="Offline avatar letters">
            </div>
            <button type="button" class="people-btn" id="so-offline-draw"${typeof canUserDraw === "function" && !canUserDraw(c) ? " hidden" : ""}>Draw</button>
          </div>
        </div>
        <div class="support-chip-row user-color-row" id="so-offline-colors"></div>
      </div>
      <div class="server-options-profile-actions">
        <button type="button" class="people-btn" id="so-use-defaults"${hasOverride ? "" : " hidden"}>Use User settings</button>
      </div>
      ${leaveBlock}`;
  const overlay = root;
  const inp = overlay.querySelector("#server-options-name");

  const paintOnline = () => {
    const el = overlay.querySelector("#so-online-preview");
    if (!el) return;
    el.className = "user-avatar-preview" + (draftPhoto ? " has-photo" : " is-empty");
    if (draftPhoto) {
      el.style.cssText = `background-image:url('${draftPhoto.replace(/'/g, "%27")}');background-size:cover;background-position:center;color:transparent`;
      el.innerHTML = "";
      el.title = "Adjust photo";
      el.setAttribute("aria-label", "Adjust photo");
    } else {
      el.style.cssText = "";
      el.innerHTML = ic("person", "avatar-face-ico");
      el.title = "Choose photo";
      el.setAttribute("aria-label", "Choose photo");
    }
  };

  const paintOffline = () => {
    const el = overlay.querySelector("#so-offline-preview");
    if (!el) return;
    el.className = "user-avatar-preview";
    const color = draftOffline.color || hueFor(me.id).bg;
    el.style.cssText = `background:${color};color:${contrastOn(color)}`;
    if (draftOffline.mode === "draw" && draftOffline.draw) {
      el.innerHTML = ic(draftOffline.draw, "avatar-face-ico");
    } else {
      el.innerHTML = `<span class="avatar-letters">${esc(draftOffline.text || "?")}</span>`;
    }
    overlay.querySelectorAll("#so-offline-colors .support-chip").forEach(chip => {
      chip.classList.toggle("on", chip.dataset.color === color);
    });
    const lettersInp = overlay.querySelector("#so-offline-letters");
    if (lettersInp && draftOffline.mode !== "draw" && lettersInp.value !== draftOffline.text) {
      lettersInp.value = draftOffline.text || "";
    }
  };

  const colorRow = overlay.querySelector("#so-offline-colors");
  for (const h of AVATAR_HUES) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "support-chip user-color-chip";
    chip.dataset.color = h.bg;
    chip.title = h.bg;
    chip.innerHTML = `<span class="user-color-swatch" style="background:${h.bg}"></span>`;
    chip.onclick = () => {
      // Colour applies to letters and drawings — never wipe a sketch.
      draftOffline = { ...draftOffline, color: h.bg };
      if (draftOffline.mode !== "draw") draftOffline.mode = "letters";
      paintOffline();
    };
    colorRow.appendChild(chip);
  }

  const openOnlineCrop = async (src) => {
    try {
      const data = src
        ? await openPhotoCropModal({ src, maxBytes: LIVE_PIC_MAX_BYTES, outPx: LIVE_PIC_OUT_PX })
        : await pickAndCropProfileImage(LIVE_PIC_MAX_BYTES);
      if (!data) return;
      draftPhoto = data;
      paintOnline();
    } catch (err) { toast(err.message || "Couldn’t read photo"); }
  };

  overlay.querySelector("#so-online-preview")?.addEventListener("click", () => {
    if (draftPhoto) openOnlineCrop(draftPhoto);
    else openOnlineCrop(null);
  });
  overlay.querySelector("#so-online-clear")?.addEventListener("click", () => {
    draftPhoto = "";
    paintOnline();
  });
  overlay.querySelector("#so-offline-draw")?.addEventListener("click", () => {
    if (typeof canUserDraw === "function" && !canUserDraw(c)) {
      toast("Drawing is turned off on this server");
      return;
    }
    openDrawIconModal({
      initialIcon: draftOffline.mode === "draw" ? draftOffline.draw : null,
      onSave: (encoded) => {
        soLettersFollowName = false;
        draftOffline = {
          mode: "draw",
          draw: encoded,
          color: draftOffline.color || hueFor(me.id).bg,
        };
        paintOffline();
      },
    });
  });
  let soLettersFollowName = typeof isPlaceholderAvatarLetters === "function"
    ? isPlaceholderAvatarLetters(draftOffline.text, current || me.name || "?")
      || draftOffline.text === normalizeAvatarLetters("", current || me.name || "?")
    : draftOffline.text === normalizeAvatarLetters("", current || me.name || "?");
  if (draftOffline.mode === "draw") soLettersFollowName = false;
  const soLettersInp = overlay.querySelector("#so-offline-letters");
  soLettersInp?.addEventListener("input", () => {
    soLettersFollowName = false;
    draftOffline = {
      mode: "letters",
      text: normalizeAvatarLetters(soLettersInp.value, inp?.value || current || me.name),
      color: draftOffline.color || hueFor(me.id).bg,
    };
    paintOffline();
  });
  inp?.addEventListener("input", () => {
    if (!soLettersFollowName || draftOffline.mode === "draw") return;
    draftOffline = {
      mode: "letters",
      text: normalizeAvatarLetters("", inp.value || me.name || "?"),
      color: draftOffline.color || hueFor(me.id).bg,
    };
    paintOffline();
  });

  paintOnline();
  paintOffline();

  const persistDraft = async () => {
    const next = String(inp?.value || "").trim().slice(0, 24);
    if (!next) {
      toast("Pick a name so friends know who you are.");
      return false;
    }
    const name = await setServerDisplayNameWithCollision(c, next);
    if (!name) return false;
    const defPhoto = me.localPhoto || "";
    const defOffline = normalizeOfflineAvatar(me.offlineAvatar, me.id, me.name);
    draftOffline = normalizeOfflineAvatar(draftOffline, me.id, name);
    const offlineChanged = JSON.stringify(draftOffline) !== JSON.stringify(defOffline);
    const photoChanged = !served && (draftPhoto || "") !== defPhoto;
    if (offlineChanged || photoChanged || getServerProfileOverride(c.id)) {
      const patch = { offlineAvatar: draftOffline };
      if (!served) patch.localPhoto = draftPhoto || "";
      setServerProfileOverride(c.id, patch);
    }
    c._lastLivePicSent = undefined;
    c._lastProfilePicSent = undefined;
    try { await syncMyProfile(c); } catch {}
    try { renderSidebar(true); } catch {}
    try { renderView(); } catch {}
    try { renderFoot(); } catch {}
    return true;
  };

  sideOverlayBeforeClose = () => persistDraft();

  overlay.querySelector("#so-use-defaults").onclick = async () => {
    clearServerProfileOverride(c.id);
    draftPhoto = served ? "" : (me.localPhoto || "");
    draftOffline = normalizeOfflineAvatar(me.offlineAvatar, me.id, me.name);
    soLettersFollowName = typeof isPlaceholderAvatarLetters === "function"
      ? isPlaceholderAvatarLetters(draftOffline.text, me.name || "?")
        || draftOffline.text === normalizeAvatarLetters("", me.name || "?")
      : draftOffline.text === normalizeAvatarLetters("", me.name || "?");
    paintOnline();
    paintOffline();
    overlay.querySelector("#so-use-defaults").hidden = true;
    c._lastLivePicSent = undefined;
    c._lastProfilePicSent = undefined;
    try { await syncMyProfile(c); } catch {}
    try { renderSidebar(true); } catch {}
    toast("Using User settings for this server");
  };

  const leaveBtn = overlay.querySelector("#server-options-leave");
  if (leaveBtn) {
    leaveBtn.onclick = async () => {
      const ok = await persistDraft();
      if (ok === false) return;
      if (typeof closeUserProfileOverlay === "function") closeUserProfileOverlay();
      else if (typeof closeSideOverlay === "function") closeSideOverlay();
      if (typeof isServedOrigin === "function" && isServedOrigin()) {
        await confirmLeaveServedServer();
      } else {
        await confirmRemoveServer(c.id);
      }
    };
  }
  inp?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
  });
  return persistDraft;
}

function openServerOptionsPanel(conn = null) {
  const c = conn || (typeof activeConn === "function" ? activeConn() : null);
  if (!c || PersonalSpace.isPersonal(c) || !c.me) {
    toast("Open a joined server for options.");
    return;
  }
  if (typeof openUserProfileOverlay === "function") {
    openUserProfileOverlay({ pane: "edit" });
    return;
  }
}

function mountUserYouProfile(root, { onSaved } = {}) {
  if (!root) return;
  const me = loadMe();
  const served = isServedOrigin();
  const namePrefill = String(me.name || "").trim();
  const initialOffline = normalizeOfflineAvatar(me.offlineAvatar, me.id, namePrefill || me.name);
  const canDrawHere = typeof canUserDraw !== "function" || canUserDraw();
  const active = typeof activeConn === "function" ? activeConn() : null;
  const activeLiveMode = (active && typeof serverSettings === "function")
    ? serverSettings(active).liveProfilePhotos
    : "off";
  const photoHeading = activeLiveMode === "always"
    ? `Profile photo <em>stored on the host</em>`
    : activeLiveMode === "online"
      ? `Online photo <em>host memory while online — not saved</em>`
      : `Online photo <em>on this phone only</em>`;
  root.innerHTML = `
        <div class="user-settings-section">
          <h5>Profile name</h5>
          <div class="field">
            <input id="user-settings-name" maxlength="24" autocomplete="nickname" value="${esc(namePrefill)}" placeholder="Your name">
          </div>
        </div>
        ${served ? "" : `<div class="user-settings-section">
          <h5>${photoHeading}</h5>
          <div class="user-avatar-row">
            <div class="user-avatar-preview" id="user-online-preview" aria-hidden="true"></div>
            <div class="user-avatar-actions">
              <button type="button" class="people-btn" id="user-online-pick">Choose photo</button>
              <button type="button" class="people-btn" id="user-online-adjust" hidden>Adjust</button>
              <button type="button" class="people-btn" id="user-online-clear">Remove</button>
            </div>
          </div>
        </div>`}
        <div class="user-settings-section">
          <h5>${served ? "Avatar" : "Offline avatar <em>shown when away</em>"}</h5>
          <p class="feel-strength-hint">Two letters — defaults from your name. Change them anytime.${canDrawHere ? " Or draw a face when drawing is allowed." : ""}</p>
          <div class="user-avatar-row">
            <div class="user-avatar-preview" id="user-offline-preview" aria-hidden="true"></div>
            <div class="user-avatar-actions user-offline-letter-actions">
              <div class="field user-offline-letters-field">
                <label for="user-offline-letters">Letters</label>
                <input id="user-offline-letters" maxlength="2" autocomplete="off" spellcheck="false"
                  value="${esc(initialOffline.mode === "draw" ? "" : (initialOffline.text || ""))}"
                  placeholder="${esc(initials(namePrefill || me.name || "?") || "AA")}" aria-label="Offline avatar letters">
              </div>
              <button type="button" class="people-btn" id="user-offline-from-name">Use name</button>
              <button type="button" class="people-btn" id="user-offline-draw"${canDrawHere ? "" : " hidden"}>Draw</button>
            </div>
          </div>
          <div class="support-chip-row user-color-row" id="user-offline-colors"></div>
        </div>
        <div class="actions">
          <button type="button" class="save" id="user-settings-save">Save</button>
        </div>`;
  const overlay = root;

  let draftName = namePrefill || "";
  let draftPhoto = served ? "" : (me.localPhoto || "");
  let draftOffline = initialOffline;
  let lettersFollowName = draftOffline.mode === "draw" ? false
    : (typeof isPlaceholderAvatarLetters === "function"
      ? isPlaceholderAvatarLetters(draftOffline.text, namePrefill || me.name || "?")
        || draftOffline.text === normalizeAvatarLetters("", namePrefill || me.name || "?")
      : draftOffline.text === normalizeAvatarLetters("", namePrefill || me.name || "?"));

  const nameInp = overlay.querySelector("#user-settings-name");
  const saveAndClose = async () => {
    const name = String(draftName || "").trim().slice(0, 24) || "Me";
    if (lettersFollowName && draftOffline.mode !== "draw") {
      draftOffline = {
        ...draftOffline,
        mode: "letters",
        text: normalizeAvatarLetters("", name),
      };
    } else {
      draftOffline = normalizeOfflineAvatar(draftOffline, me.id, name);
    }
    const onboardingProfileChanged = name !== namePrefill
      || draftPhoto !== (me.localPhoto || "")
      || JSON.stringify(draftOffline) !== JSON.stringify(initialOffline);
    saveMe({
      name,
      ...(served ? {} : { localPhoto: draftPhoto || "" }),
      offlineAvatar: draftOffline,
    });
    if (onboardingProfileChanged) window.OnboardingBus?.emit?.("profile:saved");
    if (typeof storageSetText === "function") storageSetText("ash_me_named", "1");
    else try { localStorage.setItem("ash_me_named", "1"); } catch {}
    // Mirror profile name onto local host membership so footers / labels update immediately.
    for (const c of Object.values(S.conns || {})) {
      if (!c || PersonalSpace.isPersonal(c) || !c.me) continue;
      const hostish = !!(c.me.isHost
        || (typeof effectiveRole === "function" && effectiveRole(c.me) === ROLE_HOST));
      if (!hostish) continue;
      c.me.name = name;
      if (Array.isArray(c.members)) {
        c.members = c.members.map(u => (u && u.id === c.me.id) ? { ...u, name } : u);
      }
    }
    for (const c of Object.values(S.conns || {})) {
      if (!c || PersonalSpace.isPersonal(c)) continue;
      c._lastLivePicSent = undefined;
      c._lastProfilePicSent = undefined;
    }
    syncMyProfile();
    try { renderView(); } catch {}
    try { renderSidebar(true); } catch {}
    try { renderRail(); } catch {}
    try { renderFoot(); } catch {}
    toast("Profile saved");
    if (typeof onSaved === "function") onSaved();
  };
  overlay.querySelector("#user-settings-save").onclick = saveAndClose;

  const paintOnline = () => {
    const el = overlay.querySelector("#user-online-preview");
    const adjustBtn = overlay.querySelector("#user-online-adjust");
    if (!el) return;
    el.className = "user-avatar-preview" + (draftPhoto ? " has-photo" : " is-empty");
    if (draftPhoto) {
      el.style.cssText = `background-image:url('${draftPhoto.replace(/'/g, "%27")}');background-size:cover;background-position:center;color:transparent`;
      el.innerHTML = "";
      el.title = "Tap to adjust zoom";
    } else {
      el.style.cssText = "";
      el.innerHTML = ic("person", "avatar-face-ico");
      el.title = "";
    }
    if (adjustBtn) adjustBtn.hidden = !draftPhoto;
  };

  const paintOffline = () => {
    const el = overlay.querySelector("#user-offline-preview");
    if (!el) return;
    el.className = "user-avatar-preview";
    const color = draftOffline.color || hueFor(me.id).bg;
    el.style.cssText = `background:${color};color:${contrastOn(color)}`;
    if (draftOffline.mode === "draw" && draftOffline.draw) {
      el.innerHTML = ic(draftOffline.draw, "avatar-face-ico");
    } else {
      el.innerHTML = `<span class="avatar-letters">${esc(draftOffline.text || "?")}</span>`;
    }
    overlay.querySelectorAll("#user-offline-colors .support-chip").forEach(chip => {
      chip.classList.toggle("on", chip.dataset.color === color);
    });
    const lettersInp = overlay.querySelector("#user-offline-letters");
    if (lettersInp && draftOffline.mode !== "draw" && lettersInp.value !== draftOffline.text) {
      lettersInp.value = draftOffline.text || "";
    }
  };

  const colorRow = overlay.querySelector("#user-offline-colors");
  for (const h of AVATAR_HUES) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "support-chip user-color-chip";
    chip.dataset.color = h.bg;
    chip.title = h.bg;
    chip.innerHTML = `<span class="user-color-swatch" style="background:${h.bg}"></span>`;
    chip.onclick = () => {
      // Colour applies to letters and drawings — never wipe a sketch.
      draftOffline = { ...draftOffline, color: h.bg };
      if (draftOffline.mode !== "draw") draftOffline.mode = "letters";
      paintOffline();
    };
    colorRow.appendChild(chip);
  }

  const openOnlineCrop = async (src) => {
    try {
      const data = src
        ? await openPhotoCropModal({ src, maxBytes: LIVE_PIC_MAX_BYTES, outPx: LIVE_PIC_OUT_PX })
        : await pickAndCropProfileImage(LIVE_PIC_MAX_BYTES);
      if (!data) return;
      draftPhoto = data;
      paintOnline();
    } catch (err) { toast(err.message || "Couldn’t read photo"); }
  };

  overlay.querySelector("#user-online-pick")?.addEventListener("click", () => openOnlineCrop(null));
  overlay.querySelector("#user-online-adjust")?.addEventListener("click", () => {
    if (draftPhoto) openOnlineCrop(draftPhoto);
  });
  overlay.querySelector("#user-online-preview")?.addEventListener("click", () => {
    if (draftPhoto) openOnlineCrop(draftPhoto);
    else openOnlineCrop(null);
  });
  overlay.querySelector("#user-online-clear")?.addEventListener("click", () => {
    draftPhoto = "";
    paintOnline();
  });
  const lettersInp = overlay.querySelector("#user-offline-letters");
  lettersInp?.addEventListener("input", () => {
    lettersFollowName = false;
    draftOffline = {
      mode: "letters",
      text: normalizeAvatarLetters(lettersInp.value, draftName || me.name),
      color: draftOffline.color || hueFor(me.id).bg,
    };
    paintOffline();
  });
  overlay.querySelector("#user-offline-from-name")?.addEventListener("click", () => {
    lettersFollowName = true;
    draftOffline = {
      mode: "letters",
      text: normalizeAvatarLetters("", draftName || me.name || "?"),
      color: draftOffline.color || hueFor(me.id).bg,
    };
    paintOffline();
  });
  overlay.querySelector("#user-offline-draw")?.addEventListener("click", () => {
    if (typeof canUserDraw === "function" && !canUserDraw()) {
      toast("Drawing is turned off on this server");
      return;
    }
    openDrawIconModal({
      initialIcon: draftOffline.mode === "draw" ? draftOffline.draw : null,
      onSave: (encoded) => {
        lettersFollowName = false;
        draftOffline = {
          mode: "draw",
          draw: encoded,
          color: draftOffline.color || hueFor(me.id).bg,
        };
        paintOffline();
      },
    });
  });
  if (nameInp) {
    nameInp.oninput = () => {
      draftName = nameInp.value;
      if (!lettersFollowName || draftOffline.mode === "draw") return;
      draftOffline = {
        mode: "letters",
        text: normalizeAvatarLetters("", draftName || "?"),
        color: draftOffline.color || hueFor(me.id).bg,
      };
      paintOffline();
    };
  }

  if (!served) paintOnline();
  paintOffline();
}

function mountUserSoundSettings(root) {
  if (!root) return;
  root.innerHTML = `
        <div class="user-settings-section">
          <h5>Feedback <em>sound</em></h5>
          <label class="feel-strength-row">
            <span class="feel-strength-label">Sound</span>
            <input type="range" id="feel-sound-strength" min="0" max="100" step="5" aria-label="Sound strength">
            <span class="feel-strength-val" id="feel-sound-val">55%</span>
          </label>
          <div class="feel-type-table" role="group" aria-label="Sound by action">
            <div class="feel-type-row">
              <span class="feel-type-label">Card flicks</span>
              <label class="feel-type-check"><input type="checkbox" data-feel-key="soundFlick" aria-label="Sound for card flicks"></label>
            </div>
            <div class="feel-type-row">
              <span class="feel-type-label">Scrolling</span>
              <label class="feel-type-check"><input type="checkbox" data-feel-key="soundScroll" aria-label="Sound for scrolling"></label>
            </div>
            <div class="feel-type-row">
              <span class="feel-type-label">Confirmation</span>
              <label class="feel-type-check"><input type="checkbox" data-feel-key="soundConfirm" aria-label="Sound for confirmation"></label>
            </div>
          </div>
          <p class="feel-strength-hint">0% is off.</p>
        </div>`;
  const prefs = S.feelPrefs || loadFeelPrefs();
  const soundRange = root.querySelector("#feel-sound-strength");
  const soundVal = root.querySelector("#feel-sound-val");
  const syncFeelLabel = (el, pct) => { if (el) el.textContent = pct <= 0 ? "Off" : `${pct}%`; };
  const feelKeyChannel = {
    soundFlick: "flick",
    soundScroll: "scroll",
    soundConfirm: "confirm",
  };
  if (soundRange) {
    soundRange.value = String(Math.round(clamp01(prefs.soundStrength, 0.55) * 100));
    syncFeelLabel(soundVal, Number(soundRange.value));
    const onSound = () => {
      const pct = Number(soundRange.value) | 0;
      prefs.soundStrength = pct / 100;
      S.feelPrefs = prefs;
      saveFeelPrefs();
      syncFeelLabel(soundVal, pct);
      if (pct > 0) {
        prefs.muteSound = false;
        try { CardFeel.previewSound("scroll"); } catch {}
      }
    };
    soundRange.oninput = onSound;
    soundRange.onchange = onSound;
  }
  root.querySelectorAll("[data-feel-key]").forEach(inp => {
    const key = inp.dataset.feelKey;
    if (!key) return;
    inp.checked = prefs[key] !== false;
    inp.onchange = () => {
      prefs[key] = !!inp.checked;
      S.feelPrefs = prefs;
      saveFeelPrefs();
      if (!inp.checked) return;
      const ch = feelKeyChannel[key] || "scroll";
      prefs.muteSound = false;
      try { CardFeel.previewSound(ch); } catch {}
      saveFeelPrefs();
    };
  });
}

function mountUserPersonalSpaceSettings(root, { close } = {}) {
  if (!root) return;
  const served = isServedOrigin();
  root.innerHTML = `
        <div class="user-settings-section" id="user-personal-files">
          <h5>Personal space</h5>
          <p class="feel-strength-hint">Personal space stays private on this device in local storage.</p>
        </div>
        ${served ? "" : `<div class="user-settings-section" id="user-backup-section">
          <h5>Backup <em>personal space</em></h5>
          <p class="feel-strength-hint">Passphrase-encrypts your plans and device key. If you forget the passphrase, the file cannot be opened — there is no recovery.</p>
          ${typeof shouldShowPersonalBackupReminder === "function" && shouldShowPersonalBackupReminder()
            ? `<p class="backup-reminder" id="user-backup-reminder">You’ve made several plans — export a backup so a lost phone isn’t lost history. <button type="button" class="backup-reminder-dismiss" id="user-backup-reminder-dismiss">Dismiss</button></p>`
            : ""}
          <div class="user-backup-actions">
            <button type="button" class="people-btn" id="user-backup-export">Export…</button>
            <button type="button" class="people-btn" id="user-backup-restore">Restore…</button>
          </div>
        </div>
        <div class="user-settings-section">
          <h5>Getting started</h5>
          <button type="button" class="people-btn" id="user-reopen-onboarding">Show onboarding checklist</button>
        </div>
        <div class="user-settings-section user-settings-danger">
          <h5>Reset</h5>
          <p class="feel-strength-hint">Factory reset this phone’s Phlip data. Leaves every joined server and deletes your data there, closes and wipes every server hosted on this phone, and clears local plans, contacts, and settings. Cannot be undone.</p>
          <button type="button" class="people-btn danger" id="user-factory-reset">Erase everything</button>
        </div>`}`;
  root.querySelector("#user-backup-reminder-dismiss")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { dismissPersonalBackupReminder(); } catch {}
    root.querySelector("#user-backup-reminder")?.remove();
  });
  root.querySelector("#user-reopen-onboarding")?.addEventListener("click", () => window.Onboarding?.reopen?.());
  root.querySelector("#user-backup-export")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openPersonalBackupExportFlow({ onDone: () => {
      root.querySelector("#user-backup-reminder")?.remove();
    } });
  });
  root.querySelector("#user-backup-restore")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openPersonalBackupRestoreFlow({ onDone: () => { try { close?.(); } catch {} } });
  });
  root.querySelector("#user-factory-reset")?.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await runFactoryReset();
    } catch (err) {
      toast(String(err?.message || err || "Reset failed").slice(0, 120));
    }
  });
}

function persistUserDayHours(root) {
  const startEl = root.querySelector("#user-dh-start");
  const endEl = root.querySelector("#user-dh-end");
  if (!startEl || !endEl || typeof saveDayHours !== "function") return;
  let start = Number(startEl.value), end = Number(endEl.value);
  if (start > end) [start, end] = [end, start];
  saveDayHours(start, end);
}

function mountUserOtherSettings(root) {
  if (!root) return;
  root.innerHTML = `
        <div class="user-settings-section">
          <h5>Day hours</h5>
          <p class="feel-strength-hint">Hours shown in Day view on every server. Events outside this window still appear under Anytime.</p>
          <div class="row user-day-hours-row">
            <div class="field"><label for="user-dh-start">From</label><select id="user-dh-start"></select></div>
            <div class="field"><label for="user-dh-end">To</label><select id="user-dh-end"></select></div>
          </div>
          <button type="button" class="people-btn" id="user-dh-all-day">All day</button>
        </div>`;
  const dhStart = root.querySelector("#user-dh-start");
  const dhEnd = root.querySelector("#user-dh-end");
  if (dhStart && dhEnd && typeof dayHoursWindow === "function") {
    const hourLabel = (h) => (typeof fmtHour === "function" ? fmtHour(h) : String(h));
    const opts = Array.from({ length: 24 }, (_, h) =>
      `<option value="${h}">${hourLabel(h)}</option>`).join("");
    dhStart.innerHTML = opts;
    dhEnd.innerHTML = opts;
    const cur = dayHoursWindow();
    dhStart.value = String(cur.start);
    dhEnd.value = String(cur.end);
    const onHours = () => persistUserDayHours(root);
    dhStart.onchange = onHours;
    dhEnd.onchange = onHours;
    root.querySelector("#user-dh-all-day")?.addEventListener("click", () => {
      dhStart.value = "0";
      dhEnd.value = "23";
      persistUserDayHours(root);
    });
  }
}

function openUserSettings() {
  if (typeof openUserProfileOverlay === "function") {
    openUserProfileOverlay({ pane: "edit" });
  }
}

function openUserSettingsModal() {
  openUserSettings();
}

async function confirmFactoryReset() {
  const ok = await ashConfirm(
    "Full reset erases this phone’s Phlip data.\n\n"
      + "• Leave every joined server and delete your chat, sign-ups, reactions, and notes there\n"
      + "• Close and wipe every server hosted on this phone\n"
      + "• Clear local plans, contacts, cards, and settings\n\n"
      + "This cannot be undone. Export a personal backup first if you need it.",
    { danger: true, ok: "Erase everything" },
  );
  if (!ok) return false;
  const typed = typeof ashPrompt === "function"
    ? await ashPrompt("Type DELETE to confirm full reset:", { ok: "Erase", maxlength: 16, placeholder: "DELETE" })
    : prompt("Type DELETE to confirm full reset:");
  if (String(typed || "").trim().toUpperCase() !== "DELETE") {
    toast("Cancelled");
    return false;
  }
  return true;
}

/** Leave remotes with deleteData, native wipe hosted+prefs, clear WebView storage, reload. */
async function runFactoryReset() {
  if (isServedOrigin()) {
    toast("Full reset is only available in the app");
    return;
  }
  if (!(await confirmFactoryReset())) return;

  toast("Resetting…");
  const conns = Object.values(S.conns || {}).filter(c => c && c.id && !PersonalSpace.isPersonal(c));
  for (const c of conns) {
    const hostish = !!(c.me?.isHost
      || (typeof effectiveRole === "function" && effectiveRole(c.me) === ROLE_HOST));
    try {
      if (!hostish) await leaveRemoteServerMembership(c, { deleteData: true });
    } catch {}
    try { disconnectConn(c); } catch {}
    try { removeServerEntry(c.id); } catch {}
    try { delete S.conns[c.id]; } catch {}
  }
  // Drop any leftover rail entries not in S.conns.
  try {
    for (const entry of (typeof loadServers === "function" ? loadServers() : [])) {
      if (!entry?.id || PersonalSpace.isPersonal(entry)) continue;
      try { removeServerEntry(entry.id); } catch {}
    }
  } catch {}

  try {
    if (window.AshNative?.factoryReset) {
      const raw = AshNative.factoryReset();
      const res = typeof raw === "string" ? JSON.parse(raw || "{}") : (raw || {});
      if (res && res.ok === false && res.error) {
        toast(String(res.error).slice(0, 120));
      }
    } else if (window.AshNative?.removeDeviceSecret) {
      try { AshNative.removeDeviceSecret("identity_p256_jwk"); } catch {}
    }
  } catch (err) {
    toast(String(err?.message || err || "Host wipe failed").slice(0, 120));
  }

  try { localStorage.clear(); } catch {}
  try { sessionStorage.clear(); } catch {}
  try {
    if (window.AshNative?.removeDeviceSecret) AshNative.removeDeviceSecret("identity_p256_jwk");
  } catch {}

  location.reload();
}

function openServerIconModal() {
  const conn = activeConn();
  if (!canManageServer(conn)) return;
  const opened = AshModal.open({
    className: "modal-backdrop",
    html: `
    <div class="modal-card">
      <h4>Server icon</h4>
      <div id="icon-mount"></div>
    </div>`,
    singleton: false,
  });
  if (!opened) return;
  const { overlay, close } = opened;
  mountServerIconControls(overlay.querySelector("#icon-mount"), conn, { close });
}

/** Letters, emoji, or a photo for the server mark. `close` is used by the modal. */
function mountServerIconControls(host, conn, { close } = {}) {
  if (!host || !conn || !canManageServer(conn)) return;
  const current = normalizeIconText(conn.iconText) || connIconText(conn);
  host.innerHTML = `
      <p class="empty-note" style="margin:0 0 12px">Letters/emoji or a photo — shown in the server list and the top bar.</p>
      <form id="icon-form">
        <div class="field icon-edit-row">
          <div class="icon-preview" id="icon-preview">${conn.serverPic
            ? `<img class="rail-pic" src="${esc(conn.serverPic)}" alt="">`
            : `<span class="rail-label">${esc(current)}</span>`}</div>
          <div class="field" style="flex:1;margin:0">
            <label for="icon-text">Icon text</label>
            <input id="icon-text" maxlength="4" value="${esc(normalizeIconText(conn.iconText))}" placeholder="${esc(serverIconShorthand(conn.name || conn.hostName || "?"))}" autocomplete="off">
          </div>
        </div>
        <div class="actions">
          <button type="button" class="cancel" id="icon-photo">Photo</button>
          <button type="button" class="cancel" id="icon-adjust" ${conn.serverPic ? "" : "hidden"}>Adjust</button>
          <button type="button" class="cancel" id="icon-reset">Use initials</button>
          <div>
            ${close ? `<button type="button" class="cancel" id="icon-cancel">Cancel</button>` : ""}
            <button type="submit" class="save">Save</button>
          </div>
        </div>
      </form>`;
  const input = host.querySelector("#icon-text");
  const preview = host.querySelector("#icon-preview");
  const paint = () => {
    if (conn.serverPic) {
      preview.innerHTML = `<img class="rail-pic" src="${esc(conn.serverPic)}" alt="">`;
      return;
    }
    const t = normalizeIconText(input.value) || serverIconShorthand(conn.name || conn.hostName || "?");
    preview.innerHTML = `<span class="rail-label">${esc(t)}</span>`;
  };
  input.addEventListener("input", paint);
  host.querySelector("#icon-cancel")?.addEventListener("click", () => { if (close) close(); });
  host.querySelector("#icon-photo").onclick = async () => {
    try {
      const data = await pickAndCropProfileImage(SERVER_PIC_MAX_BYTES, SERVER_PIC_OUT_PX);
      if (!data) return;
      conn.serverPic = data;
      send({ type: "setServerPic", data });
      persistServerIcon(conn);
      host.querySelector("#icon-adjust").hidden = false;
      paint(); renderRail(); renderSidebar();
      toast("Server photo updated");
    } catch (err) { toast(err.message || "Upload failed"); }
  };
  host.querySelector("#icon-adjust").onclick = async () => {
    if (!conn.serverPic) return;
    try {
      const data = await openPhotoCropModal({
        src: conn.serverPic,
        maxBytes: SERVER_PIC_MAX_BYTES,
        outPx: SERVER_PIC_OUT_PX,
      });
      if (!data) return;
      conn.serverPic = data;
      send({ type: "setServerPic", data });
      persistServerIcon(conn);
      paint(); renderRail(); renderSidebar();
      toast("Server photo updated");
    } catch (err) { toast(err.message || "Couldn’t crop photo"); }
  };
  host.querySelector("#icon-reset").onclick = () => {
    conn.iconText = "";
    conn.serverPic = "";
    send({ type: "setServerIcon", iconText: "" });
    send({ type: "setServerPic", data: "" });
    persistServerIcon(conn);
    renderRail(); renderSidebar();
    if (close) close();
    else {
      input.value = "";
      paint();
      toast("Using initials");
    }
  };
  host.querySelector("#icon-form").onsubmit = (e) => {
    e.preventDefault();
    const textVal = normalizeIconText(input.value);
    conn.iconText = textVal;
    send({ type: "setServerIcon", iconText: textVal });
    persistServerIcon(conn);
    renderRail(); renderSidebar();
    if (close) close();
    else toast("Server icon updated");
  };
  if (close) {
    input.focus();
    input.select();
  }
}

