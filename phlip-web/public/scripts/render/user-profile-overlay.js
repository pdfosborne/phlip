/* user-profile-overlay.js — pull-up profile sheet from the account chip.
 * Globals out: openUserProfileOverlay, closeUserProfileOverlay, userProfileOverlayHandleBack
 * Load after: render-user-settings.js, render-cosmetics.js; before: channel-members.js
 */

let _userProfileClose = null;
let _userProfilePane = "home";
let _userProfileFlush = null;
let _userProfileTrigger = null;

function closeUserProfileOverlay() {
  if (typeof _userProfileFlush === "function") {
    try { _userProfileFlush(); } catch {}
    _userProfileFlush = null;
  }
  if (typeof _userProfileClose === "function") {
    const fn = _userProfileClose;
    _userProfileClose = null;
    try { fn(); } catch {}
    return;
  }
  if (typeof AshModal !== "undefined" && AshModal.close) {
    AshModal.close("user-profile-overlay");
  }
}

function userProfileOverlayHandleBack() {
  const overlay = document.querySelector(".user-profile-overlay");
  if (!overlay) return false;
  const modals = document.querySelectorAll(".modal-backdrop");
  if (modals.length && modals[modals.length - 1] !== overlay) return false;
  if (_userProfilePane !== "home") {
    showUserProfilePane("home");
    return true;
  }
  closeUserProfileOverlay();
  return true;
}

function setUserProfileTriggerExpanded(expanded) {
  let el = _userProfileTrigger;
  if (!el || !el.isConnected) el = document.getElementById("side-user-menu-btn");
  if (el) el.setAttribute("aria-expanded", expanded ? "true" : "false");
}

function userProfileIco(name) {
  return typeof ic === "function" ? ic(name, "ico-inline") : "";
}

function userProfileHasServerOverride(conn) {
  if (!conn || (typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn)) || !conn.me) return false;
  if (typeof getServerProfileOverride === "function" && getServerProfileOverride(conn.id)) return true;
  if (conn.me.nameHostSet) return true;
  const me = typeof loadMe === "function" ? (loadMe() || {}) : {};
  const defName = String(me.name || "").trim();
  const srvName = String(conn.me.name || "").trim();
  return Boolean(defName && srvName && defName !== srvName);
}

function userProfileHomeHTML() {
  const conn = typeof activeConn === "function" ? activeConn() : null;
  const me = typeof loadMe === "function" ? (loadMe() || {}) : {};
  const name = typeof sidebarUserEffectiveName === "function"
    ? sidebarUserEffectiveName(conn)
    : (String(me.name || conn?.me?.name || "").trim() || "You");
  const personal = typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn);
  const serverName = conn?.name || conn?.hostName || "Phlip";
  const overridden = userProfileHasServerOverride(conn);
  const server = personal
    ? "Default profile · Personal space"
    : (overridden ? `Custom profile on ${serverName}` : `Default profile · ${serverName}`);
  const avatar = typeof sidebarUserAvatarHTML === "function"
    ? sidebarUserAvatarHTML(conn)
    : "";
  const row = (key, icon, label) => {
    const ico = typeof ic === "function" ? ic(icon, "ico-inline") : "";
    return `<button type="button" class="ch-manage-btn sidebar-menu-row" data-profile-pane="${esc(key)}">
      <span class="sidebar-menu-row-main">${ico}<span class="sidebar-menu-row-label">${esc(label)}</span></span>
    </button>`;
  };
  return `
    <div class="user-profile-home is-compact">
      <div class="user-profile-home-id">
        <div class="user-profile-home-avatar">${avatar}</div>
        <div class="user-profile-home-copy">
          <h3 class="user-profile-home-name">${esc(name)}</h3>
          <p class="user-profile-home-server">${esc(server)}</p>
          <button type="button" class="people-btn save user-profile-edit-btn" id="user-profile-edit">
            Edit profile
          </button>
        </div>
      </div>
      <div class="channel-settings-sheet-actions sidebar-menu-actions">
        ${row("personal", "house", "Personal settings")}
        ${row("sound", "volume-2", "Sound")}
      </div>
    </div>`;
}

function showUserProfilePane(pane, opts = {}) {
  const overlay = document.querySelector(".user-profile-overlay");
  if (!overlay) return;
  const body = overlay.querySelector("#user-profile-body");
  const title = overlay.querySelector("#user-profile-title");
  const back = overlay.querySelector("#user-profile-back");
  if (!body) return;

  if (typeof _userProfileFlush === "function") {
    try { _userProfileFlush(); } catch {}
    _userProfileFlush = null;
  }

  _userProfilePane = pane || "home";

  const isHome = _userProfilePane === "home";
  if (back) back.hidden = isHome;
  body.innerHTML = "";

  if (_userProfilePane === "home") {
    if (title) title.textContent = "You";
    body.innerHTML = userProfileHomeHTML();
    body.querySelector("#user-profile-edit")?.addEventListener("click", () => {
      showUserProfilePane("edit");
    });
    body.querySelectorAll("[data-profile-pane]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        showUserProfilePane(btn.dataset.profilePane);
      });
    });
    return;
  }

  if (_userProfilePane === "edit") {
    if (title) title.textContent = "Edit profile";
    const conn = typeof activeConn === "function" ? activeConn() : null;
    const personal = typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn);
    const serverName = conn?.name || conn?.hostName || "this server";
    const startOverridden = Boolean(opts.serverOverride || userProfileHasServerOverride(conn));
    body.innerHTML = `
      <section class="user-profile-edit-block">
        <h5 class="user-profile-edit-label">Default profile</h5>
        <div id="user-profile-you-mount"></div>
      </section>
      ${personal || !conn?.me ? "" : `
      <section class="user-profile-edit-block">
        <label class="server-settings-row side-toggle console-row" for="user-profile-server-override">
          <span>Override profile for ${esc(serverName)}</span>
          <input type="checkbox" id="user-profile-server-override"${startOverridden ? " checked" : ""}>
        </label>
        <div id="user-profile-server-mount"${startOverridden ? "" : " hidden"}></div>
      </section>`}`;
    const you = body.querySelector("#user-profile-you-mount");
    if (you && typeof mountUserYouProfile === "function") {
      mountUserYouProfile(you, {
        onSaved: () => { try { showUserProfilePane("home"); } catch {} },
      });
    }
    const toggle = body.querySelector("#user-profile-server-override");
    const server = body.querySelector("#user-profile-server-mount");
    const syncOverrideMount = async (on) => {
      if (!server || !conn) return;
      if (typeof _userProfileFlush === "function") {
        if (on) {
          try { await _userProfileFlush(); } catch {}
        }
        _userProfileFlush = null;
      }
      server.hidden = !on;
      if (!on) {
        server.innerHTML = "";
        if (typeof clearServerProfileOverride === "function") clearServerProfileOverride(conn.id);
        const me = typeof loadMe === "function" ? (loadMe() || {}) : {};
        const defName = String(me.name || "").trim();
        if (defName && !conn.me?.nameHostSet) {
          if (conn.status === "online" && conn.token && typeof setServerDisplayNameWithCollision === "function") {
            try { await setServerDisplayNameWithCollision(conn, defName); } catch {}
          } else if (typeof applyLocalDisplayName === "function") {
            applyLocalDisplayName(conn, defName);
          }
        }
        conn._lastLivePicSent = undefined;
        conn._lastProfilePicSent = undefined;
        try { if (typeof syncMyProfile === "function") await syncMyProfile(conn); } catch {}
        try { renderSidebar(true); } catch {}
        try { renderView(); } catch {}
        return;
      }
      if (typeof mountServerOptionsForm === "function") {
        _userProfileFlush = mountServerOptionsForm(server, conn) || null;
      }
    };
    if (startOverridden && server && typeof mountServerOptionsForm === "function") {
      _userProfileFlush = mountServerOptionsForm(server, conn) || null;
    }
    toggle?.addEventListener("change", () => {
      void syncOverrideMount(!!toggle.checked);
    });
    return;
  }

  if (_userProfilePane === "sound") {
    if (title) title.textContent = "Sound";
    if (typeof mountUserSoundSettings === "function") mountUserSoundSettings(body);
    return;
  }
  if (_userProfilePane === "personal") {
    if (title) title.textContent = "Personal space";
    if (typeof mountUserPersonalSpaceSettings === "function") {
      mountUserPersonalSpaceSettings(body, { close: closeUserProfileOverlay });
    }
  }
}

function openUserProfileOverlay(opts = {}) {
  if (typeof cancelArmedSideNavTap === "function") cancelArmedSideNavTap();
  if (typeof suppressSideNavTaps === "function") suppressSideNavTaps(500);
  if (typeof closeSidebarMenuSheet === "function") closeSidebarMenuSheet();
  closeUserProfileOverlay();

  const trigger = document.getElementById("side-user-menu-btn");
  _userProfileTrigger = trigger;
  const ico = userProfileIco;
  const opened = typeof AshModal !== "undefined" && AshModal.open
    ? AshModal.open({
      className: "user-profile-overlay",
      html: `
        <div class="channel-settings-sheet-card user-profile-overlay-card" role="dialog" aria-modal="true" aria-labelledby="user-profile-title">
          <div class="channel-settings-sheet-handle" aria-hidden="true"></div>
          <div class="channel-settings-sheet-head user-profile-overlay-head">
            <button type="button" class="user-profile-back" id="user-profile-back" hidden aria-label="Back">${ico("chevron-left")}</button>
            <h4 id="user-profile-title" class="channel-settings-sheet-title" tabindex="-1">You</h4>
            <button type="button" class="user-profile-close" id="user-profile-close" aria-label="Close">${ico("x")}</button>
          </div>
          <div class="user-profile-overlay-body" id="user-profile-body"></div>
        </div>`,
      singleton: "replace",
      graceMs: 450,
      closeOnEscape: false,
      closeOnBackdrop: true,
      trapFocus: true,
      restoreFocus: true,
      initialFocus: "#user-profile-title",
      onClose: () => {
        if (typeof _userProfileFlush === "function") {
          try { _userProfileFlush(); } catch {}
        }
        _userProfileFlush = null;
        _userProfileClose = null;
        _userProfilePane = "home";
        setUserProfileTriggerExpanded(false);
        _userProfileTrigger = null;
      },
    })
    : null;
  if (!opened) return;

  const { overlay, close } = opened;
  _userProfileClose = close;
  setUserProfileTriggerExpanded(true);
  const card = overlay.querySelector(".user-profile-overlay-card");
  if (card && typeof bindChannelSettingsSheetDismiss === "function") {
    bindChannelSettingsSheetDismiss(overlay, card, close);
  }
  overlay.querySelector("#user-profile-close")?.addEventListener("click", (e) => {
    e.preventDefault();
    closeUserProfileOverlay();
  });
  overlay.querySelector("#user-profile-back")?.addEventListener("click", (e) => {
    e.preventDefault();
    showUserProfilePane("home");
  });
  overlay.querySelector("#user-profile-title")?.addEventListener("click", () => {
    if (_userProfilePane !== "home") showUserProfilePane("home");
  });
  showUserProfilePane(opts.pane || "home", opts);
}
