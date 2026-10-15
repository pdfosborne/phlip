/* host-settings-part3.js — split from host-settings.js (Part 3 size ceiling).
 * Load after: host-settings-part2.js; part of host-settings cluster.
 */

/**
 * One Hosting setup / hosting-guide acknowledgement card.
 * @param {object} opts
 * @param {string} opts.id
 * @param {boolean} opts.done
 * @param {string} opts.title
 * @param {string} [opts.summary]
 * @param {string} [opts.bodyText]
 * @param {string} [opts.acceptLabel]
 * @param {() => any} [opts.onAccept]
 * @param {boolean} [opts.requireAccept]
 * @param {HTMLElement[]} [opts.extra]
 * @param {HTMLElement} [opts.headerAction]
 * @param {boolean} [opts.compact]
 * @param {HTMLElement} opts.parent
 * @param {() => void} refresh
 */
function buildHostAckCard(opts, refresh) {
  const {
    id, done, title, summary, bodyText, acceptLabel, onAccept,
    requireAccept = true, extra = [], headerAction = null, compact = false,
    parent,
  } = opts;
  if (!parent) return;
  const box = document.createElement("div");
  const doneCompact = !!done && !compact;
  box.className = "host-ack-card"
    + (done ? " is-done" : "")
    + (compact || doneCompact ? " is-compact" : "")
    + (doneCompact ? " is-done-compact" : "");
  const head = document.createElement("div");
  head.className = "host-ack-head";
  const mark = document.createElement("span");
  mark.className = "host-ack-mark";
  mark.textContent = done ? "✓" : "○";
  mark.setAttribute("aria-hidden", "true");
  const titles = document.createElement("div");
  titles.className = "host-ack-titles";
  const h = document.createElement("div");
  h.className = "host-ack-title";
  h.textContent = title;
  titles.appendChild(h);
  if (summary && (!done || compact)) {
    const s = document.createElement("div");
    s.className = "muted host-ack-summary";
    s.textContent = summary;
    titles.appendChild(s);
  }
  head.appendChild(mark);
  head.appendChild(titles);

  const expanded = Object.prototype.hasOwnProperty.call(_hostSetupExpanded, id)
    ? !!_hostSetupExpanded[id] : (!compact && !done && requireAccept && !!bodyText);
  const showBody = expanded && bodyText;

  if (doneCompact && bodyText) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "server-settings-share-btn host-ack-inline-toggle";
    toggle.textContent = showBody ? "Hide info" : "Show info";
    toggle.id = `${id}-details`;
    toggle.setAttribute("aria-expanded", String(!!showBody));
    toggle.onclick = () => {
      _hostSetupExpanded[id] = !showBody;
      refresh();
    };
    head.appendChild(toggle);
  } else if (headerAction) {
    headerAction.classList.add("host-ack-header-action");
    head.appendChild(headerAction);
  }
  box.appendChild(head);

  if (showBody) {
    const p = document.createElement("p");
    p.className = "host-ack-body";
    p.textContent = bodyText;
    box.appendChild(p);
  }

  const actions = document.createElement("div");
  actions.className = "host-ack-actions";

  if (bodyText && !doneCompact) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "server-settings-share-btn";
    toggle.textContent = showBody ? "Hide info" : "Show info";
    toggle.id = `${id}-details`;
    toggle.setAttribute("aria-expanded", String(!!showBody));
    toggle.onclick = () => {
      _hostSetupExpanded[id] = !showBody;
      refresh();
    };
    actions.appendChild(toggle);
  }

  if (requireAccept && !done && onAccept) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "channel-panel-pill host-primary-btn";
    b.textContent = acceptLabel || "Accept";
    b.id = `${id}-accept`;
    b.onclick = () => {
      const res = onAccept();
      if (res?.ok === false) toast(res.error || "Failed");
      else {
        _hostSetupExpanded[id] = false;
        refresh();
      }
    };
    actions.appendChild(b);
  }

  for (const el of extra) actions.appendChild(el);
  if (actions.childNodes.length) box.appendChild(actions);
  parent.appendChild(box);
}

function fillHostSetupBody(body) {
  const status = readHostStatus() || { setup: {}, consent: {} };
  const setup = status.setup || {};
  const consent = status.consent || {};
  body.classList.add("server-settings-body", "host-settings-body");
  body.innerHTML = "";
  const main = document.createElement("div");
  main.className = "ss-main host-settings-main";
  body.appendChild(main);

  const administration = document.createElement("section");
  body.insertBefore(administration, main);
  shareGuideText(administration, "These controls apply to every server hosted on this phone.");
  appendApprovedNetworksButton(administration);
  if (status.running) appendHostStopButton(administration); else appendHostStartButton(administration);
  const details = document.createElement("details");
  details.className = "sharing-advanced";
  shareGuideText(details, "Host requirements and diagnostics", "summary");
  body.appendChild(details);
  details.appendChild(main);

  const intro = document.createElement("p");
  intro.className = "side-role-hint host-setup-intro";
  intro.textContent = "Saved acknowledgements and device checks. Set up sharing from the server you want people to join.";
  main.appendChild(intro);

  const addSection = (label) => {
    const h = document.createElement("div");
    h.className = "channel-panel-section-label host-setup-section";
    h.textContent = label;
    main.appendChild(h);
    return h;
  };

  const refresh = () => {
    readHostStatus();
    refreshHostSettingsPanel();
  };

  const addCheck = (opts) => buildHostAckCard({ ...opts, parent: opts.parent || main }, refresh);

  // ── App & device ──────────────────────────────────────────────
  addSection("App & device");

  const fmtVer = (v) => {
    const s = String(v == null ? "" : v).trim();
    if (!s) return "—";
    return /^v/i.test(s) ? s : `v${s}`;
  };
  const ver = setup.appVersion || "—";
  const current = fmtVer(ver);
  const checked = setup.latestVersion ? fmtVer(setup.latestVersion) : "—";
  let updateSummary = `Current ${current} - Checked ${checked}`;
  if (setup.belowMinSafe) {
    updateSummary = `Current ${current} - Min safe ${fmtVer(setup.minSafeVersion)} — update before Public`;
  } else if (setup.updateAvailable) {
    updateSummary = `Current ${current} - Checked ${checked} — update available`;
  }
  const checkBtn = document.createElement("button");
  checkBtn.type = "button";
  checkBtn.className = "host-check-updates-btn";
  checkBtn.textContent = "Check";
  checkBtn.title = "Check for updates";
  checkBtn.setAttribute("aria-label", "Check for updates");
  checkBtn.onclick = () => {
    try {
      AshNative.checkHostUpdates();
      setTimeout(refresh, 1200);
    } catch {
      toast("Update check needs the Phlip app");
    }
  };
  addCheck({
    id: "updates",
    done: !setup.belowMinSafe && !setup.updateAvailable && !!setup.latestVersion,
    title: consent.updateTitle || "Update Phlip",
    summary: updateSummary,
    requireAccept: false,
    compact: true,
    headerAction: checkBtn,
  });

  const bucket = String(setup.patchBucket || "AMBER").toUpperCase();
  const patchLabel = setup.patchLabel || "unknown";
  let patchSummary = `Security patch: ${patchLabel}`;
  let patchDone = true;
  let patchRequire = false;
  if (bucket === "GREEN") {
    patchSummary = `Recent security patch (${patchLabel})`;
  } else if (bucket === "AMBER") {
    patchSummary = `Patch getting old (${patchLabel})`;
  } else {
    // RED
    patchDone = !!setup.patchAckSatisfied;
    patchRequire = true;
    patchSummary = patchDone
      ? `Old patch acknowledged (${patchLabel})`
      : `Old security patch (${patchLabel}) — acknowledgment required`;
  }
  addCheck({
    id: "patch",
    done: patchDone,
    title: consent.patchTitle || "Device security updates",
    summary: patchSummary,
    bodyText: consent.patchBody || "",
    acceptLabel: consent.patchAccept,
    onAccept: () => hostCall("acceptPatchWarning"),
    requireAccept: patchRequire,
  });

  // ── Before you host locally ───────────────────────────────────
  addSection("Before you host locally");
  addCheck({
    id: "alpha",
    done: !!setup.alphaAckAccepted,
    title: consent.alphaTitle || "Alpha software",
    summary: setup.alphaAckAccepted
      ? "Acknowledged — early software; updates may break things or lose data"
      : "Required before friends can join",
    bodyText: consent.alphaBody,
    acceptLabel: consent.alphaAccept,
    onAccept: () => hostCall("acceptAlphaAck"),
  });
  addCheck({
    id: "rules",
    done: !!setup.rulesAccepted,
    title: consent.hostRulesTitle || "Server rules for hosts",
    summary: setup.rulesAccepted ? "Accepted — required before friends can join" : "Required before friends can join",
    bodyText: consent.hostRulesBody,
    acceptLabel: consent.hostRulesAccept,
    onAccept: () => hostCall("acceptHostRules"),
  });
  addCheck({
    id: "localPrep",
    done: !!setup.localPrepAccepted,
    title: consent.localPrepTitle || "Safer hosting for Local",
    summary: setup.localPrepAccepted
      ? "Acknowledged — same Wi‑Fi only"
      : "Required before friends can join",
    bodyText: consent.localPrepBody,
    acceptLabel: consent.localPrepAccept,
    onAccept: () => hostCall("acceptLocalPrep"),
  });

  // ── Cloudflare · Public (collapsed by default) ────────────────
  const publicHead = document.createElement("div");
  publicHead.className = "host-setup-section-row";
  const publicLabel = document.createElement("div");
  publicLabel.className = "channel-panel-section-label host-setup-section";
  publicLabel.textContent = "Cloudflare · Public";
  const publicToggle = document.createElement("button");
  publicToggle.type = "button";
  publicToggle.className = "server-settings-share-btn host-setup-section-toggle";
  publicToggle.textContent = _hostSetupPublicShown ? "Hide" : "Show";
  publicToggle.setAttribute("aria-expanded", _hostSetupPublicShown ? "true" : "false");
  publicToggle.onclick = () => {
    _hostSetupPublicShown = !_hostSetupPublicShown;
    refresh();
  };
  publicHead.appendChild(publicLabel);
  publicHead.appendChild(publicToggle);
  main.appendChild(publicHead);

  const publicWrap = document.createElement("div");
  publicWrap.className = "host-setup-public-wrap";
  publicWrap.hidden = !_hostSetupPublicShown;
  main.appendChild(publicWrap);

  if (!_hostSetupPublicShown) {
    const hint = document.createElement("p");
    hint.className = "muted host-setup-public-hint";
    const publicBits = [
      setup.devicePrepAccepted,
      setup.operatorAck,
      setup.dataAck,
      setup.publicRiskAck,
      setup.cloudflareConfigured,
    ].filter(Boolean).length;
    hint.textContent = publicBits
      ? `Public setup hidden · ${publicBits}/5 done — tap Show to review`
      : "Public setup hidden — tap Show when you’re ready for Cloudflare / Public";
    main.appendChild(hint);
  }

  addCheck({
    id: "prep",
    done: !!setup.devicePrepAccepted,
    title: consent.devicePrepTitle || "Safer hosting for Public",
    summary: setup.devicePrepAccepted
      ? "Acknowledged — guest Wi‑Fi + dedicated phone recommended"
      : "Required before Public hosting",
    bodyText: consent.devicePrepBody,
    acceptLabel: consent.devicePrepAccept,
    onAccept: () => hostCall("acceptDevicePrep"),
    parent: publicWrap,
  });
  addCheck({
    id: "operator",
    done: !!setup.operatorAck,
    title: consent.operatorTitle || "You are the operator",
    summary: setup.operatorAck ? "Accepted" : "Required before Public",
    bodyText: consent.operatorBody,
    acceptLabel: consent.operatorAccept,
    onAccept: () => hostCall("acceptOperatorAck"),
    parent: publicWrap,
  });
  addCheck({
    id: "data",
    done: !!setup.dataAck,
    title: consent.dataTitle || "Cloudflare data disclosure",
    summary: setup.dataAck ? "Accepted" : "Required before Public",
    bodyText: consent.dataBody,
    acceptLabel: consent.dataAccept,
    onAccept: () => hostCall("acceptDataAck"),
    parent: publicWrap,
  });
  addCheck({
    id: "risk",
    done: !!setup.publicRiskAck,
    title: consent.publicRiskTitle || "Public risk",
    summary: setup.publicRiskAck ? "Accepted" : "Required before Public",
    bodyText: consent.publicRiskBody,
    acceptLabel: consent.publicRiskAccept,
    onAccept: () => hostCall("acceptPublicRiskAck"),
    parent: publicWrap,
  });

  const cfConfigured = !!setup.cloudflareConfigured;
  const cfBtn = document.createElement("button");
  cfBtn.type = "button";
  cfBtn.className = "channel-panel-pill host-primary-btn";
  cfBtn.textContent = cfConfigured ? "Edit domain & API token…" : "Configure domain & API token…";
  cfBtn.onclick = () => {
    try { AshNative.openCloudflareSetup(); }
    catch {
      try { AshNative.openAppSettings("hostSetup"); } catch { toast("Open Hosting setup in the Phlip app"); }
    }
  };
  const hstsBtn = document.createElement("button");
  hstsBtn.type = "button";
  hstsBtn.className = "channel-panel-pill";
  hstsBtn.textContent = "Open HTTPS hardening guide…";
  hstsBtn.onclick = () => {
    try {
      if (typeof AshNative.openCloudflareSecurityGuide === "function") {
        AshNative.openCloudflareSecurityGuide();
      } else {
        AshNative.openCloudflareSetup();
      }
    } catch {
      toast("Open Settings → Hosting setup → Cloudflare → HTTPS hardening guide");
    }
  };
  addCheck({
    id: "cloudflare",
    done: cfConfigured,
    title: "Cloudflare domain & API",
    summary: cfConfigured
      ? `Configured for ${setup.cloudflareDomain || "your domain"}`
      : "Set domain + API token so Public can publish DNS and tunnel",
    bodyText: cfConfigured
      ? "Public hosting is connected to Cloudflare. You can update the domain or API token at any time. Enable HSTS in Cloudflare for stronger HTTPS protection; the guide below gives the exact settings."
      : "Connect a Cloudflare domain and an API token with DNS + Workers permissions. After Cloudflare shows the domain as Active, use the HTTPS hardening guide below to enable HSTS.",
    requireAccept: false,
    extra: [cfBtn, hstsBtn],
    parent: publicWrap,
  });

  if (_hostSetupPublicShown) {
    if (setup.publicReady) {
      const ready = document.createElement("p");
      ready.className = "host-setup-ready";
      ready.textContent = "All set — you can turn a server Public from that server’s hosting page.";
      publicWrap.appendChild(ready);
    } else if (setup.publicBlockReason) {
      const block = document.createElement("p");
      block.className = "host-server-error";
      block.textContent = setup.publicBlockReason;
      publicWrap.appendChild(block);
    }
  }

  // ── Misc ──────────────────────────────────────────────────────
  addSection("Security");
  const log = document.createElement("label");
  log.className = "server-settings-row side-toggle";
  log.innerHTML = `<span>Security reject log</span>
    <input type="checkbox" ${setup.securityLogEnabled ? "checked" : ""}>`;
  log.querySelector("input").onchange = (e) => {
    hostCall("setSecurityRejectLog", !!e.target.checked);
    toast(e.target.checked ? "Reject log on" : "Reject log off");
  };
  main.appendChild(log);
}
