/* render-add-server.js — rail + create-first menu (PAT-servers-1).
 * Globals out: openAddServerMenu, ensureHostingRunning, HOST_SERVER_PRESETS
 * Load after: render-join-modal.js; before: render-join-leave.js
 */

const HOST_SERVER_PRESETS = [
  { id: "scratch", title: "Start from scratch", blurb: "Open permissions, no auto-include — you shape it." },
  { id: "friend", title: "Friend group", blurb: "A shared hub for friends to suggest plans, with extra private boards for smaller groups." },
  { id: "family", title: "Family", blurb: "One shared family board, plus the option to follow individual family members' plans in their own boards." },
  { id: "circles", title: "Separate circles", blurb: "Separate Work, Home and Friends boards, each with its own people and access, rather than one shared group board." },
  { id: "club", title: "Club or organisation", blurb: "Member boards, staff-only planning and fixtures. New joiners start as viewers." },
  { id: "business", title: "Business", blurb: "You post the classes and events — customers RSVP." },
];

// Illustrative screenshots of the starter board layout, without creating a server.
const HOST_PRESET_PREVIEW_BOARDS = {
  scratch: [["Group", "private"], ["Direct", "private"], ["Events", "private"], ["Section", "private"], ["Private plans", "private"]],
  friend: [["The crew"], ["Events"], ["London based", "private"], ["Uni mates", "private"], ["Home mates", "private"]],
  family: [["Family"]],
  circles: [["Work", "private"], ["Home", "private"], ["Friends", "private"]],
  club: [["Members"], ["Committee", "staff"], ["Admin", "admin"], ["Fixtures"], ["Open-invite"], ["Socials", "private"]],
  business: [["Classes"], ["Open sessions"]],
};

function hostPresetPreviewHtml(preset) {
  const boards = HOST_PRESET_PREVIEW_BOARDS[preset.id] || HOST_PRESET_PREVIEW_BOARDS.scratch;
  return `<figure class="server-template-preview" aria-label="Example ${esc(preset.title)} server layout">
    <figcaption>Example preview</figcaption>
    <div class="server-template-screen" aria-hidden="true">
      <div class="server-template-rail"><span>${ic("person", "ico-inline")}</span><span class="is-selected">${ic("server", "ico-inline")}</span><span>+</span></div>
      <div class="server-template-sidebar">
        <div class="server-template-name">${esc(preset.title)}</div>
        <div class="server-template-device">Device only <span>Set up sharing ›</span></div>
        <div class="server-template-welcome"># <span>Welcome</span></div>
        <div class="server-template-section">Boards <span>+</span></div>
        ${boards.map(([name, access], index) => `<div class="server-template-board${index === 0 ? " is-expanded" : ""}">
          <div class="server-template-board-name"><span>${index === 0 ? "⌄" : "›"}</span>${esc(name)}${access ? `<span class="server-template-access ${access}">${ic(access === "private" ? "lock" : "shield", "ico-inline")}</span>` : ""}</div>
          ${index === 0 ? `<div class="server-template-channel">${ic("ticket", "ico-inline")} Events</div><div class="server-template-channel">${ic("message-circle", "ico-inline")} Chat</div>` : ""}
        </div>`).join("")}
        ${preset.id === "family" ? `<div class="server-template-follow">+ Follow a family member’s plans</div>` : ""}
      </div>
    </div>
    <span class="sr-only">Boards: ${esc(boards.map(([name]) => name).join(", "))}. Each board contains Events and Chat.</span>
  </figure>`;
}

async function ensureHostingRunning() {
  const status = typeof readHostStatus === "function" ? readHostStatus() : null;
  if (status?.running) return true;
  if (typeof hostCall !== "function") {
    toast("Create a server in the Phlip app");
    return false;
  }
  const res = hostCall("startHosting");
  if (res?.ok === false) {
    toast(res.error || "Could not start hosting");
    return false;
  }
  const start = Date.now();
  while (Date.now() - start < 5000) {
    await new Promise((r) => setTimeout(r, 200));
    const next = readHostStatus();
    if (next?.running) return true;
  }
  toast("Hosting did not start in time");
  return false;
}

function waitForHostedConn(rawId) {
  const id = String(rawId || "").startsWith("srv-local-")
    ? String(rawId)
    : `srv-local-${rawId}`;
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (S.conns[id]) return resolve(S.conns[id]);
      if (Date.now() - start > 8000) return resolve(null);
      setTimeout(tick, 150);
    };
    tick();
  });
}

function addServerShouldOpenJoin() {
  if (typeof isDemoMode === "function" && isDemoMode()) return true;
  if (typeof isServedOrigin === "function" && isServedOrigin()) return true;
  if (document.documentElement.dataset.servedHost === "1") return true;
  if (typeof hostingAvailable === "function" && !hostingAvailable()) return true;
  return false;
}

/**
 * @param {{ startAt?: "menu"|"name", preset?: string }} [opts]
 */
function openAddServerMenu(opts = {}) {
  if (addServerShouldOpenJoin()) {
    if (typeof openJoinModal === "function") openJoinModal();
    return;
  }
  const startPreset = String(opts.preset || "").trim();
  let step = opts.startAt === "name" ? "name" : "menu";
  let presetId = startPreset || "scratch";

  const opened = AshModal.open({
    className: "modal-backdrop add-server-modal",
    closeOnEscape: true,
    singleton: "replace",
    html: `<div class="modal-card add-server-card" role="dialog" aria-modal="true" aria-labelledby="add-server-title">
      <h4 id="add-server-title"></h4>
      <p class="join-code-hint join-modal-lead" id="add-server-lead"></p>
      <div id="add-server-body"></div>
      <div class="add-server-footer">
        <button type="button" class="cancel" id="add-server-close">Close</button>
        <button type="button" class="add-server-join-link" id="add-server-join">Join a server</button>
      </div>
    </div>`,
  });
  if (!opened) return;
  const { overlay, close } = opened;

  const titleEl = overlay.querySelector("#add-server-title");
  const leadEl = overlay.querySelector("#add-server-lead");
  const body = overlay.querySelector("#add-server-body");

  const goJoin = () => {
    close();
    if (typeof openJoinModal === "function") {
      openJoinModal("", { onBack: () => openAddServerMenu() });
    }
  };
  overlay.querySelector("#add-server-join").onclick = goJoin;
  overlay.querySelector("#add-server-close").onclick = close;

  const paintMenu = () => {
    step = "menu";
    titleEl.textContent = "Create a server";
    leadEl.textContent = "It starts on this phone only. You can enable self-hosted Internet sharing later.";
    const templates = HOST_SERVER_PRESETS.filter((p) => p.id !== "scratch");
    body.innerHTML = `
      <button type="button" class="add-server-choice" data-preset="scratch">
        <strong>Start from scratch</strong>
        <span class="muted">${esc(HOST_SERVER_PRESETS[0].blurb)}</span>
      </button>
      <div class="side-label add-server-section"><span>Start from a template</span></div>
      ${templates.map((p) => `
        <button type="button" class="add-server-choice" data-preset="${esc(p.id)}">
          <strong>${esc(p.title)}</strong>
          <span class="muted">${esc(p.blurb)}</span>
        </button>`).join("")}
      <button type="button" class="add-server-choice" data-preset="backup">
        <strong>From a backup file</strong>
        <span class="muted">Restore a server backup onto this phone.</span>
      </button>`;
    body.querySelectorAll("[data-preset]").forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.preset;
        if (id === "backup") {
          runBackupRestore();
          return;
        }
        presetId = id;
        paintName();
      };
    });
  };

  const runBackupRestore = async () => {
    close();
    if (!(await ensureHostingRunning())) return;
    const st = (typeof readHostStatus === "function" && readHostStatus()) || {};
    if (typeof openServerBackupRestoreFlow === "function") {
      openServerBackupRestoreFlow(st.servers || []);
    } else toast("Backup restore isn’t available here");
  };

  const paintName = () => {
    step = "name";
    const preset = HOST_SERVER_PRESETS.find((p) => p.id === presetId) || HOST_SERVER_PRESETS[0];
    titleEl.textContent = "Name your server";
    leadEl.textContent = preset.title === "Start from scratch"
      ? "You can change permissions later in Settings."
      : preset.title;
    const st = (typeof readHostStatus === "function" && readHostStatus()) || {};
    const setup = st.setup || {};
    const consent = st.consent || {};
    const needAlpha = !setup.alphaAckAccepted;
    body.innerHTML = `
      <div class="field">
        <label for="add-server-name">Server name</label>
        <input id="add-server-name" maxlength="40" placeholder="e.g. Family" autocomplete="off">
      </div>
      ${hostPresetPreviewHtml(preset)}
      ${needAlpha ? `
      <label class="check-row join-accept-check" id="add-server-alpha-row">
        <input type="checkbox" id="add-server-alpha">
        <span>${esc(consent.alphaTitle || "Alpha software")} — early software; updates may break things or lose data</span>
      </label>
      <button type="button" class="linkish" id="add-server-alpha-info">Show info</button>
      <p class="host-ack-body" id="add-server-alpha-body" hidden>${esc(consent.alphaBody || "")}</p>
      ` : ""}
      <div class="actions">
        <button type="button" class="cancel" id="add-server-back">Back</button>
        <button type="button" class="save" id="add-server-create" ${needAlpha ? "disabled" : ""}>Create</button>
      </div>`;
    const nameEl = body.querySelector("#add-server-name");
    nameEl.addEventListener("input", () => {
      const preview = body.querySelector(".server-template-name");
      if (preview) preview.textContent = nameEl.value.trim() || preset.title;
    });
    const createBtn = body.querySelector("#add-server-create");
    const alpha = body.querySelector("#add-server-alpha");
    const syncCreate = () => {
      if (!needAlpha) {
        createBtn.disabled = false;
        return;
      }
      createBtn.disabled = !alpha?.checked;
    };
    if (alpha) alpha.onchange = async () => {
      if (alpha.checked && typeof hostCall === "function") {
        const res = hostCall("acceptAlphaAck");
        if (res?.ok === false) {
          alpha.checked = false;
          toast(res.error || "Could not accept");
        }
      }
      syncCreate();
    };
    body.querySelector("#add-server-alpha-info")?.addEventListener("click", () => {
      const p = body.querySelector("#add-server-alpha-body");
      if (!p) return;
      p.hidden = !p.hidden;
    });
    body.querySelector("#add-server-back").onclick = paintMenu;
    createBtn.onclick = async () => {
      const name = String(nameEl.value || "").trim();
      if (!name) { toast("Enter a server name"); return; }
      if (needAlpha && !alpha?.checked) {
        toast("Acknowledge the alpha risks first");
        return;
      }
      createBtn.disabled = true;
      if (!(await ensureHostingRunning())) {
        createBtn.disabled = false;
        return;
      }
      const hostName = (typeof loadMe === "function" && String(loadMe()?.name || "").trim()) || "Host";
      const res = hostCall("createServer", name, presetId, "", hostName);
      if (res?.ok === false) {
        toast(res.error || "Could not create");
        createBtn.disabled = false;
        return;
      }
      close();
      const conn = await waitForHostedConn(res?.id);
      if (conn && typeof switchConn === "function") switchConn(conn.id);
      toast("Server created · Device only");
    };
    nameEl?.focus({ preventScroll: true });
  };

  if (step === "name") paintName();
  else paintMenu();
}
