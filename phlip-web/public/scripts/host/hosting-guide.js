/* Sharing setup. Native status owns readiness; navigation never enables sharing. */
const _hostGuide = { serverId: "", pick: null, step: 0, then: null, onBack: null, busy: false, error: "", close: null, signature: "", cloudflareConfigured: null };
const HOST_SHARE_LABELS = { device: "Device only", local: "Device only", direct: "Device only", public: "Internet" };

function hostGuideDraft(clear = false) {
  try {
    const key = `phlip.sharingSetup.${_hostGuide.serverId}`;
    if (clear) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify({ pick: _hostGuide.pick, step: Math.min(_hostGuide.step, 2) }));
  } catch {}
}
function hostSharingReady(s, pick) { return s?.sharingReady?.[pick] === true; }
function hostGuideChecksDone(pick, setup) {
  return pick === "public" ? setup.publicReady === true : setup.localReady === true;
}
function hostSharingLabel(s) {
  if (s?.isPublic) return "Internet";
  return "Device only";
}
function hostSharingMessage(s, setup, pick) {
  if (hostSharingReady(s, pick)) return `${HOST_SHARE_LABELS[pick]} sharing is ready`;
  if (pick !== "direct" && setup.networkSuspended) return setup.networkOffline ? "Connect this phone to a network" : "Approve this network to continue";
  if (pick === "public" && s.error) return String(s.error);
  if (pick === "direct") return s.hotspotRadioNote || "Start the phone hotspot to invite people";
  return "Waiting for the connection to become available";
}
function hostGuideExit(abandon = false) {
  if (_hostGuide.busy) return;
  if (abandon) hostGuideDraft(true);
  const back = _hostGuide.onBack;
  _hostGuide.onBack = null;
  _hostGuide.close?.();
  if (typeof back === "function") back();
}
function hostingGuideHandleBack() {
  const overlay = document.querySelector(".hosting-guide-modal");
  if (!overlay || [...document.querySelectorAll(".modal-backdrop")].at(-1) !== overlay) return false;
  if (_hostGuide.busy) return true;
  if (_hostGuide.step > 1) hostGuideSetStep(_hostGuide.step - 1);
  else hostGuideExit();
  return true;
}
function hostGuideSetStep(step) {
  _hostGuide.step = step;
  _hostGuide.error = "";
  hostGuideDraft();
  refreshHostingGuide(true);
  document.getElementById("hosting-guide-body")?.scrollTo(0, 0);
}
function openHostingGuide(serverId, opts = {}) {
  if (_hostGuide.busy) return;
  _hostGuide.close?.();
  const id = String(serverId || "").replace(/^srv-local-/, "");
  if (!id) return toast("No server selected");
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(`phlip.sharingSetup.${id}`)); } catch {}
  const valid = draft?.pick === "public";
  Object.assign(_hostGuide, { serverId: id, pick: "public",
    step: valid && Number.isInteger(draft.step) ? Math.max(1, Math.min(2, draft.step)) : 1,
    error: "", signature: "", busy: false, cloudflareConfigured: null, then: opts.then || null,
    onBack: opts.onBack || (opts.fromHost ? () => openHostedServerSettings(id) : null) });
  const opened = AshModal.open({ className: "hosting-guide-modal", trapFocus: true, restoreFocus: true,
    closeOnBackdrop: false, initialFocus: "#hosting-guide-title",
    html: `<section class="sharing-flow" role="dialog" aria-modal="true" aria-labelledby="hosting-guide-title">
      <header class="sharing-flow-head"><button type="button" id="hosting-guide-back" aria-label="Back">←</button><div><h2 id="hosting-guide-title" tabindex="-1">Set up sharing</h2><span id="hosting-guide-server"></span></div><button type="button" id="hosting-guide-close" aria-label="Close">×</button></header>
      <main id="hosting-guide-body" class="host-guide-main"></main><footer id="hosting-guide-footer"></footer></section>`,
    onClose: () => { _hostGuide.close = null; } });
  if (!opened) return;
  _hostGuide.close = opened.close;
  opened.overlay.querySelector("#hosting-guide-back").onclick = hostingGuideHandleBack;
  opened.overlay.querySelector("#hosting-guide-close").onclick = () => hostGuideExit();
  refreshHostingGuide(true);
}
function shareGuideButton(parent, label, action, primary = false) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = primary ? "channel-panel-pill host-primary-btn sharing-menu-cta" : "server-settings-share-btn";
  b.textContent = label;
  if (label) b.id = `sharing-action-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  b.onclick = action;
  b.disabled = _hostGuide.busy;
  parent.appendChild(b);
  return b;
}
function shareGuideText(parent, text, tag = "p") {
  const el = document.createElement(tag);
  el.textContent = text;
  parent.appendChild(el);
  return el;
}
function maybeAdvanceAfterCloudflare(setup) {
  const configured = setup?.cloudflareConfigured === true;
  const was = _hostGuide.cloudflareConfigured;
  _hostGuide.cloudflareConfigured = configured;
  return was === false && configured && _hostGuide.step === 1 && _hostGuide.pick === "public";
}
function refreshHostingGuide(force = false) {
  const body = document.getElementById("hosting-guide-body");
  if (!body) return;
  const status = readHostStatus();
  if (!status) return;
  if (maybeAdvanceAfterCloudflare(status.setup)) {
    hostGuideSetStep(2);
    return;
  }
  const s = status.servers?.find(s => String(s.id) === _hostGuide.serverId);
  const signature = JSON.stringify([s, status.setup, _hostGuide.step, _hostGuide.pick, _hostGuide.error, _hostGuide.busy]);
  if (!force && signature === _hostGuide.signature) return;
  _hostGuide.signature = signature;
  const scroll = body.scrollTop;
  const focusId = document.activeElement?.closest?.(".sharing-flow") ? document.activeElement.id : "";
  fillHostingGuideBody(body, status, s);
  body.scrollTop = scroll;
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
}
function fillHostingGuideBody(body, status, s) {
  body.replaceChildren();
  const footer = document.getElementById("hosting-guide-footer");
  footer.replaceChildren();
  if (!s) { shareGuideText(body, "This server is unavailable. Start hosting on this phone, then reopen sharing."); return; }
  document.getElementById("hosting-guide-server").textContent = s.name || "Server";
  const { step, pick } = _hostGuide;
  const setup = status.setup || {};
  const steps = ["Setup", "Review", "Invite"];
  const stepIdx = Math.max(0, Math.min(steps.length - 1, (step || 1) - 1));
  shareGuideText(footer, `${stepIdx + 1} of ${steps.length} · ${steps[stepIdx]}`, "small");
  if (_hostGuide.error) { const e = shareGuideText(body, _hostGuide.error); e.className = "host-server-error"; e.setAttribute("role", "alert"); }
  if (step <= 1) {
    shareGuideText(body, `Set up ${HOST_SHARE_LABELS.public}`, "h3");
    if (setup.cloudflareConfigured) {
      const domainName = setup.cloudflareDomain || "Connected domain";
      shareGuideText(body, "Use the domain already connected to this phone.");
      const domain = shareGuideButton(body, "", () => { if (!setup.networkSuspended) hostGuideSetStep(2); });
      domain.className = "host-guide-choice is-selected";
      domain.id = "sharing-domain-connected";
      domain.setAttribute("aria-pressed", "true");
      const name = document.createElement("strong");
      name.textContent = domainName;
      const detail = document.createElement("span");
      detail.textContent = "Already connected. People reach this phone through this address.";
      domain.append(name, detail);
      shareGuideButton(body, "Use a different domain", () => hostCall("openCloudflareSetup")).classList.add("sharing-text-link");
    } else {
      shareGuideText(body, "Cloudflare connects people on the Internet to the server on your phone, using your own web address without router setup.");
      shareGuideText(body, "Your phone still hosts the server. Your board visibility, roles and membership rules still apply.");
      shareGuideButton(body, "Connect a domain", () => hostCall("openCloudflareSetup"), true).classList.add("sharing-domain-button");
    }
    if (setup.networkSuspended) appendHostNetworkPausedBanner(body, { ...setup, networkPauseTitle: "Approve this network", networkPauseText: "Choose whether to allow sharing on the current network.", networkAlwaysTrust: "Remember this network" });
    if (setup.networkOffline) shareGuideButton(body, "Open Wi-Fi settings", () => hostCall("openWifiSettings"));
    shareGuideText(body, "Network approval applies to hosting on this phone. Remembering a network also applies to your other servers.");
    const next = shareGuideButton(footer, "Continue", () => hostGuideSetStep(2), true);
    next.disabled = !!setup.networkSuspended || !setup.cloudflareConfigured;
  } else if (step === 2) {
    shareGuideText(body, "Review Internet sharing", "h3");
    shareGuideText(body, "Keep this phone powered and connected while people need access. Group data is hosted on this phone.");
    hostGuidePaintChecks(body, "public", setup, status.consent || {}, () => refreshHostingGuide(true));
    const b = shareGuideButton(footer, _hostGuide.busy ? "Enabling…" : "Enable Internet sharing", () => hostGuideEnable(s), true);
    b.classList.replace("sharing-menu-cta", "sharing-commit");
    b.disabled = _hostGuide.busy || !hostGuideChecksDone(pick, setup);
  } else {
    const ready = hostSharingReady(s, pick);
    shareGuideText(body, ready ? "Ready to invite people" : "Connecting", "h3");
    shareGuideText(body, hostSharingMessage(s, setup, pick));
    if (setup.networkSuspended) appendHostNetworkPausedBanner(body, setup);
    if (ready) {
      hostGuideDraft(true);
      shareGuideButton(footer, "Invite people", () => {
        const then = _hostGuide.then;
        _hostGuide.onBack = null;
        hostGuideExit();
        if (then) then(); else hostSharingInvite(s);
      }, true);
    } else shareGuideButton(footer, "Retry connection", () => hostGuideEnable(s), true);
    shareGuideButton(body, "Review setup", () => hostGuideSetStep(1));
  }
}
async function hostGuideEnable(s) {
  if (_hostGuide.busy) return;
  const setup = readHostStatus()?.setup || {};
  if (!hostGuideChecksDone(_hostGuide.pick, setup)) { hostGuideSetStep(2); return; }
  _hostGuide.busy = true;
  _hostGuide.error = "";
  refreshHostingGuide(true);
  await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  try {
    const pick = _hostGuide.pick;
    if (pick !== "public") {
      _hostGuide.error = "Use Internet sharing.";
      return;
    }
    const res = hostCall("setPublicHosting", s.id, true);
    if (res?.ok === false) _hostGuide.error = res.error || "Could not enable sharing. Try again.";
    else { _hostGuide.step = 3; hostGuideDraft(); }
  } finally { _hostGuide.busy = false; refreshHostingGuide(true); }
}
function hostSharingInvite(s) {
  const conn = S.conns[`srv-local-${s.id}`] || S.conns[s.id];
  if (conn && typeof sharePersonalInviteLink === "function") sharePersonalInviteLink(conn);
  else toast("Open this server from the sidebar, then invite people.");
}
