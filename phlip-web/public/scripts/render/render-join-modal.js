/* render-join-modal.js — openJoinModal + ashJoinFromUrl entry.
 * Load after: render-join-parse.js; before: render-join-leave.js
 */

function openJoinModal(prefill = "", opts = {}) {
  const onBack = typeof opts?.onBack === "function" ? opts.onBack : null;
  if (typeof isDemoMode === "function" && isDemoMode()) {
    toast("This demo stays in your browser — joining a live server isn’t available here.");
    return;
  }
  let pre = normalizeJoinPrefill(prefill);
  // §10: already on this server + group-invite token → edge-only redeem, no re-join.
  {
    const tok = (pre.sections.token || (String(pre.sections.invite || "").length >= 12 ? pre.sections.invite : "")).trim();
    if (tok) {
      const hit = findOnlineConnForGroupInvite(pre, tok);
      if (hit) {
        send({ type: "redeemInvite", code: tok }, hit.id);
        toast("Adding you to the invited groups…");
        return;
      }
    }
  }
  // --- served vs app: step machine + remembered browser name ---
  const served = isServedOrigin();
  let rememberedBrowserName = "";
  if (served) {
    try {
      rememberedBrowserName = sessionStorage.getItem("ash_rejoin_name") || "";
      if (!rememberedBrowserName) rememberedBrowserName = loadBrowserMemberName() || "";
    } catch {}
  }
  const sec = pre.sections;
  const onLocalHostPage = served && location.protocol === "http:";
  const isRejoin = !!(pre.rejoinUrl);
  const inviteSlugPrefill = normInviteSlug(sec.inviteSlug || "");
  // The served Public SPA is returning-member sign-in only. New-member terms
  // are collected by the Worker's /j/<slug> page before welcome handoff.
  // Never let stale/prefilled invite context turn the root SPA into a join flow.
  const hasPersonalInviteContext = !served && !!inviteSlugPrefill;
  const publicBrowserReturn = !onLocalHostPage && served;
  const codeOptional = (isRejoin && !served) || publicBrowserReturn;
  let joinStep = "url";
  if (onLocalHostPage) joinStep = "signup";
  else if (codeOptional) joinStep = "login";
  else if (served) joinStep = "agree";
  else joinStep = "url";
  let agreed = publicBrowserReturn;
  /** Local Sign up: credentials validated → agree → startJoin (not back to login). */
  let localSignupPending = false;
  /** After deny/timeout, return to signup vs login. */
  let waitReturnStep = onLocalHostPage ? "signup" : "login";
  let joinMeta = null;
  let pendingNearby = null;
  let stashedInviteSlug = inviteSlugPrefill;
  let bootstrapMeta = null;
  /** @type {"resolving"|"public"|"local_required"|"direct_required"|""} */
  let bootstrapState = "";
  let bootstrapBase = !served && sec.host
    ? (httpsBaseFromHost(sec.host) || httpBaseFromUrl(sec.host) || "")
    : "";

  // --- modal DOM (served omits remote URL field; adds Help & Legal) ---
  const opened = AshModal.open({
    className: "modal-backdrop",
    html: `
    <div class="modal-card">
      <h4 id="join-modal-title"></h4>
      <div class="join-code-hint join-modal-lead" id="join-modal-lead"></div>
      <form id="join-form" novalidate>
        <div class="field join-code-field" id="join-code-step" ${codeOptional || served ? "hidden" : ""}>
          <div class="join-code-sections" id="join-code-sections">
            ${served ? "" : `
            <div class="join-code-remote">
              <label class="join-field-label" for="j-host">Invite link / Server URL</label>
              <input id="j-host" maxlength="253" inputmode="url" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="https://your-server…/j/… or http://192.168…:3000" aria-label="Invite link or Server URL" value="${esc(sec.host ? (/^https?:\/\//i.test(sec.host) ? sec.host : httpsBaseFromHost(sec.host)) : (inviteSlugPrefill ? "" : ""))}">
            </div>`}
            <!-- Legacy rotating code kept hidden for paste-compat; not required. -->
            <input id="j-invite" type="hidden" value="${esc(sec.invite || "")}">
          </div>
          <button type="button" class="linkish" id="j-change-target" hidden style="margin:8px 0 0;background:none;border:none;padding:0;color:var(--muted, #888);text-decoration:underline;cursor:pointer;font:inherit">Change invite</button>
        </div>
        <div id="join-agree-step" hidden>
          <div id="join-agree-header"></div>
          <div class="join-accept" id="join-accept">
            <div class="join-accept-title">Server rules</div>
            <div id="join-agree-rules"></div>
            <label class="check-row join-accept-check">
              <input type="checkbox" id="j-accept">
              <span id="j-accept-label">I meet the age requirement and agree to join this server</span>
            </label>
          </div>
        </div>
        <div id="join-login-fields" hidden>
          <div class="field"><label for="j-name">Your name</label><input id="j-name" maxlength="24" autocomplete="username" value=""></div>
          <div class="field"><label for="j-pass">Your password</label><input id="j-pass" type="password" placeholder="Your password for this server" autocomplete="current-password" value=""></div>
        </div>
        <div id="join-wait-panel" class="join-wait-panel" hidden>
          <p class="join-wait-title">Please wait for the host to accept your request</p>
          <p class="join-wait-sub muted">You’ll enter automatically once they approve.</p>
        </div>
        <p class="join-wait muted" id="j-wait" hidden></p>
        <div class="join-error" id="j-error"></div>
        <div class="actions">
          <button type="button" class="cancel" id="j-cancel">${served ? (onLocalHostPage ? "Need help?" : "Need invite from host") : "Cancel"}</button>
          <button type="submit" class="save" id="j-submit">Continue</button>
        </div>
        <div class="join-alt-links" id="join-alt-links" hidden>
          <button type="button" class="linkish" id="j-to-signin" hidden>Already joined? Sign in here</button>
          <button type="button" class="linkish" id="j-to-signup" hidden>New here? Sign up</button>
        </div>
        ${served ? `<div class="join-info-links" id="join-info-links"></div>
        <div class="join-powered-by">${poweredByPhlipHTML()}</div>` : ""}
      </form>
    </div>`,
    singleton: false,
    closeOnBackdrop: false,
  });
  if (!opened) return;
  const { overlay, close: ashClose } = opened;

  // --- served: Help & Legal under the form ---
  if (served) {
    const infoLinks = overlay.querySelector("#join-info-links");
    if (infoLinks) appendServedInfoLinks(infoLinks, { compact: true });
  }

  // --- join form wiring (step transitions use `served`) ---
  const errEl = overlay.querySelector("#j-error");
  const waitEl = overlay.querySelector("#j-wait");
  const waitPanel = overlay.querySelector("#join-wait-panel");
  const inviteMain = overlay.querySelector("#j-invite");
  const inviteRejoin = null;
  const hostEl = overlay.querySelector("#j-host");
  const passEl = overlay.querySelector("#j-pass");
  const nameEl = overlay.querySelector("#j-name");
  const codeStep = overlay.querySelector("#join-code-step");
  const agreeStep = overlay.querySelector("#join-agree-step");
  const loginFields = overlay.querySelector("#join-login-fields");
  const discoverSection = overlay.querySelector("#discover-section");
  const titleEl = overlay.querySelector("#join-modal-title");
  const leadEl = overlay.querySelector("#join-modal-lead");
  const submitBtn = overlay.querySelector("#j-submit");
  const altLinks = overlay.querySelector("#join-alt-links");
  const toSigninBtn = overlay.querySelector("#j-to-signin");
  const toSignupBtn = overlay.querySelector("#j-to-signup");
  const cancelBtn = overlay.querySelector("#j-cancel");
  const changeBtn = overlay.querySelector("#j-change-target");
  const acceptCheck = overlay.querySelector("#j-accept");
  const acceptLabel = overlay.querySelector("#j-accept-label");
  const agreeHeader = overlay.querySelector("#join-agree-header");
  const agreeRules = overlay.querySelector("#join-agree-rules");
  let pendingConn = null;

  const hotspotJoinEntry = overlay.querySelector("#hotspot-join-entry");
  if (hotspotJoinEntry) hotspotJoinEntry.hidden = true;

  const readInvite = () => normJoinAlpha(inviteMain?.value || "");

  const servedHost = () => (served ? location.hostname : "");
  const hostDisplay = (host) => {
    const h = String(host || "").trim();
    if (!h) return "";
    return httpsBaseFromHost(h) || h.replace(/\/+$/, "");
  };
  const hostOnlyOf = (raw) => {
    const s = String(raw || "").trim();
    if (/^https?:\/\//i.test(s)) {
      try {
        const u = new URL(s);
        return (u.host || "").toLowerCase();
      } catch { /* fall through */ }
    }
    return s.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  };

  const readSections = () => ({
    tag: "",
    invite: readInvite(),
    host: served ? servedHost() : hostOnlyOf(hostEl?.value || ""),
    inviteSlug: stashedInviteSlug || extractInviteSlug(hostEl?.value || "") || "",
  });

  const fillSections = (parts) => {
    if (parts.invite && inviteMain) inviteMain.value = normJoinAlpha(parts.invite);
    if (!served && hostEl && parts.host) hostEl.value = hostDisplay(parts.host);
    if (parts.inviteSlug) stashedInviteSlug = normInviteSlug(parts.inviteSlug);
    else if (parts.host || parts.invite) {
      const slug = extractInviteSlug(hostEl?.value || "") || extractInviteSlug(parts.invite || "");
      if (slug) stashedInviteSlug = slug;
    }
  };

  const applyPaste = (raw) => {
    const text = String(raw || "").trim();
    if (!text) return;
    fillSections(parseJoinCodeSections(text));
  };

  const withLanPrefer = (target) => {
    if (!target?.base || /^http:\/\//i.test(String(target.base))) return target;
    const near = nearbyForJoinTag(target.sid);
    if (!near?.url) return target;
    return {
      ...target,
      base: httpBaseFromUrl(near.url) || near.url,
      sid: near.sid || target.sid,
      name: near.name || target.name,
    };
  };

  const resolveJoinTarget = () => {
    const groupTok = (sec.token || "").trim();
    const rot = (sec.rot || "").trim();
    const slug = stashedInviteSlug || normInviteSlug(sec.inviteSlug || "") || "";
    if (pendingNearby) {
      return {
        base: httpBaseFromUrl(pendingNearby.url) || pendingNearby.url,
        invite: groupTok || pendingNearby.code || readInvite() || "",
        token: groupTok,
        rot: rot || "",
        name: pendingNearby.name || "",
        sid: pendingNearby.sid || "",
        inviteSlug: slug,
      };
    }
    if (served) {
      const inv = groupTok || readInvite();
      return { base: location.origin, invite: inv, token: groupTok, rot, name: "", sid: "", inviteSlug: slug };
    }
    if (pre.rejoinUrl) {
      const inv = groupTok || readInvite();
      return { base: httpBaseFromUrl(pre.rejoinUrl), invite: inv, token: groupTok, rot, name: "", sid: "", inviteSlug: slug };
    }
    const codeRaw = composeJoinCode(readSections());
    const packed = unpackInviteCode(codeRaw);
    if (packed?.base && packed.invite) {
      return withLanPrefer({
        base: packed.base,
        invite: groupTok || packed.invite,
        token: groupTok || packed.token || "",
        rot: rot || packed.rot || "",
        name: packed.name || "",
        sid: packed.sid || "",
        inviteSlug: slug,
      });
    }
    const invite = groupTok || packed?.invite || readInvite();
    const hostOnly = hostOnlyOf(readSections().host);
    if (hostOnly) {
      const base = httpsBaseFromHost(hostOnly);
      if (base) return withLanPrefer({ base, invite: invite || "", token: groupTok, rot, name: "", sid: packed?.sid || "", inviteSlug: slug });
    }
    if (hostEl?.value) {
      const raw = String(hostEl.value).trim();
      if (/^https?:\/\//i.test(raw) || /\/j\//i.test(raw) || /[?&#]slug=/i.test(raw)) {
        const parts = parseJoinCodeSections(raw);
        if (parts.inviteSlug) stashedInviteSlug = parts.inviteSlug;
        const base = parts.host
          ? (httpsBaseFromHost(parts.host) || httpBaseFromUrl(parts.host))
          : (httpsBaseFromHost(raw) || httpBaseFromUrl(raw));
        // Personal /j/<slug> alone is not a server — need discovery or a real host URL.
        if (base && !/phlipapp\.com$/i.test(String(parts.host || new URL(raw.startsWith("http") ? raw : `https://${raw}`).hostname || ""))) {
          return withLanPrefer({
            base,
            invite: parts.token || parts.invite || invite || "",
            token: parts.token || groupTok || "",
            rot: parts.rot || rot || "",
            name: parts.name || "",
            sid: parts.tag || packed?.sid || "",
            inviteSlug: parts.inviteSlug || stashedInviteSlug || slug,
          });
        }
      }
    }
    if (bootstrapBase) {
      return withLanPrefer({
        base: bootstrapBase,
        invite: groupTok || readInvite() || "",
        token: groupTok,
        rot,
        name: bootstrapMeta?.hostDisplayName || "",
        sid: bootstrapMeta?.joinTag || "",
        inviteSlug: slug,
      });
    }
    return null;
  };

  const populateAgree = (meta) => {
    joinMeta = meta;
    if (agreeHeader) agreeHeader.innerHTML = joinAgreementHeaderHtml(meta);
    if (agreeRules) agreeRules.innerHTML = joinAgreementRulesHtml(meta);
    const age = clampServerMinAge(meta.minAge);
    if (acceptLabel) {
      acceptLabel.textContent = `I am at least ${age} years old and agree to these server rules`;
    }
    if (acceptCheck) acceptCheck.checked = false;
    agreed = false;
  };

  const setJoinStep = (next) => {
    // Public SPA is behind the Worker's returning-member barrier. Agreement is
    // exclusively a /j/<slug> concern and must never appear after login failure.
    if (served && !onLocalHostPage && next === "agree") next = "login";
    joinStep = next;
    errEl.textContent = "";
    if (waitPanel) waitPanel.hidden = next !== "waiting";
    if (waitEl && next === "waiting") {
      waitEl.hidden = false;
      if (!waitEl.textContent) waitEl.textContent = "Waiting for the host to let you in…";
    } else if (waitEl && next !== "waiting") {
      waitEl.hidden = true;
      waitEl.textContent = "";
    }
    const showCode = next === "url";
    const showAgree = next === "agree";
    const showCreds = next === "login" || next === "signup";
    const showWaiting = next === "waiting";
    if (codeStep) codeStep.hidden = codeOptional || served ? true : !showCode;
    if (agreeStep) agreeStep.hidden = !showAgree;
    if (loginFields) loginFields.hidden = !showCreds;
    if (discoverSection) {
      discoverSection.hidden = !(next === "url" && !served && !isRejoin);
    }
    if (changeBtn) {
      changeBtn.hidden = !(next === "agree" || next === "login" || next === "signup")
        || codeOptional || served || !!pendingNearby;
    }
    if (altLinks) altLinks.hidden = !(onLocalHostPage && (next === "signup" || next === "login"));
    if (toSigninBtn) toSigninBtn.hidden = !(onLocalHostPage && next === "signup");
    if (toSignupBtn) toSignupBtn.hidden = !(onLocalHostPage && next === "login");
    if (submitBtn) submitBtn.hidden = showWaiting;
    if (cancelBtn) {
      if (showWaiting) cancelBtn.textContent = "Back";
      else if (onLocalHostPage && (next === "agree" || next === "login")) cancelBtn.textContent = "Back";
      else if (onLocalHostPage) cancelBtn.textContent = "Need help?";
      else if (served) cancelBtn.textContent = "Need invite from host";
      else if (onBack && next === "url") cancelBtn.textContent = "Back";
      else cancelBtn.textContent = "Cancel";
    }
    if (titleEl) {
      titleEl.textContent = ({
        url: "Join a server",
        agree: "Agree to join",
        signup: "Join / Sign up",
        login: "Sign in",
        waiting: "Waiting for host",
      })[next] || "Join";
    }
    if (leadEl) {
      if (bootstrapState === "resolving") {
        leadEl.textContent = "Looking up that invite link…";
      } else if (bootstrapState === "local_required" || bootstrapState === "direct_required") {
        leadEl.textContent = PERSONAL_INVITE_OFFLINE_COPY;
      } else if (onLocalHostPage && next === "signup") {
        leadEl.textContent = "Choose a name and password. Already a member? We’ll sign you in.";
      } else if (onLocalHostPage && next === "login") {
        leadEl.textContent = "Sign in with the name and password you used before.";
      } else if (onLocalHostPage && next === "agree") {
        leadEl.textContent = "Confirm the age rating and server rules, then we’ll ask the host to approve you.";
      } else if (served && !onLocalHostPage && next === "login" && !hasPersonalInviteContext) {
        leadEl.textContent = "Sign in with the name and password you used for this server.";
      } else if (next === "waiting") {
        leadEl.textContent = "";
      } else {
        leadEl.innerHTML = ({
          url: "Paste the <strong>invite link</strong> from a self-hosted server.",
          agree: "Confirm you meet the age rating and accept the rules. Your name and password come next.",
          login: "Enter your name and password for this server. New names wait for host approval.",
          signup: "Choose a name and password for this server.",
          waiting: "",
        })[next] || "";
      }
    }
    if (submitBtn && !showWaiting) {
      if (next === "signup" && onLocalHostPage) submitBtn.textContent = "Continue";
      else if (next === "login" && onLocalHostPage) submitBtn.textContent = "Sign in";
      else if (next === "login") submitBtn.textContent = (isRejoin || codeOptional ? "Sign in" : "Join");
      else if (next === "agree" && onLocalHostPage && localSignupPending) submitBtn.textContent = "I agree — send request";
      else if (next === "agree") submitBtn.textContent = "I agree — continue";
      else submitBtn.textContent = "Continue";
    }
    if (next === "login" || next === "signup") {
      if (nameEl && !nameEl.value) {
        nameEl.value = pre.name || rememberedBrowserName || (!served ? (loadMe().name || "") : "") || "";
      }
      (nameEl?.value ? passEl : nameEl)?.focus();
    } else if (next === "agree") {
      acceptCheck?.focus();
    } else if (next === "waiting") {
      cancelBtn?.focus();
    } else {
      hostEl?.focus();
    }
  };

  /** Transient status under the form (connecting / loading) — not the dedicated waiting step. */
  const showJoinProgress = (msg) => {
    if (!waitEl) return;
    waitEl.hidden = !msg;
    waitEl.textContent = msg || "";
  };

  const failJoinToStep = (msg, step = waitReturnStep) => {
    pendingConn = null;
    showJoinProgress("");
    setJoinStep(step);
    if (msg) errEl.textContent = msg;
  };

  const goToAgree = async (baseHint) => {
    errEl.textContent = "";
    showJoinProgress("Loading server info…");
    try {
      const target = resolveJoinTarget();
      const base = baseHint || bootstrapBase || target?.base;
      if (!base) throw new Error("Couldn’t resolve the server address.");
      const invite = target?.invite || readInvite() || "";
      const slug = stashedInviteSlug || target?.inviteSlug || "";
      const meta = await fetchJoinMeta(base, invite, slug);
      const safeInviteName = String(
        bootstrapMeta?.hostDisplayName || target?.name || "",
      ).trim();
      if (safeInviteName && (!meta.name || meta.name === "Phlip server")) {
        meta.name = safeInviteName;
      }
      populateAgree(meta);
      showJoinProgress("");
      bootstrapState = "public";
      setJoinStep("agree");
      return true;
    } catch (e) {
      showJoinProgress("");
      const why = e?.name === "AbortError" ? "timed out" : (e?.message || "unreachable");
      if (stashedInviteSlug && (e?.status === 401 || /unreachable|timed out|Couldn't reach/i.test(why))) {
        bootstrapState = "local_required";
        setJoinStep("url");
        errEl.textContent = e?.status === 401 ? why : PERSONAL_INVITE_OFFLINE_COPY;
      } else {
        errEl.textContent = `Couldn’t reach the server (${why}). Check the invite link or that Public/hosting is on.`;
      }
      return false;
    }
  };

  const runPersonalInviteBootstrap = async () => {
    const slug = stashedInviteSlug || inviteSlugPrefill;
    if (!slug || served || isRejoin) return false;
    const hasHost = !!(sec.host || hostEl?.value && !/\/j\//i.test(hostEl.value) && extractInviteSlug(hostEl.value) !== normInviteSlug(hostEl.value));
    // Atomic app deep links already provide the exact Public origin and slug.
    // Validate that pair directly instead of dropping back to invite discovery.
    if (hasHost && bootstrapBase && !/phlipapp\.com\/j\//i.test(String(sec.host))) {
      bootstrapState = "resolving";
      if (hostEl) hostEl.value = bootstrapBase;
      showJoinProgress("Checking invite…");
      errEl.textContent = "";
      const admitted = await goToAgree(bootstrapBase);
      showJoinProgress("");
      return admitted;
    }
    bootstrapState = "resolving";
    setJoinStep("url");
    showJoinProgress("Looking up invite…");
    errEl.textContent = "";
    try {
      window.AshNative?.startDiscovery?.();
    } catch {}
    const result = await resolvePersonalInviteBootstrap(slug);
    showJoinProgress("");
    bootstrapState = result.state || "local_required";
    stashedInviteSlug = result.slug || slug;
    if (result.state === "public" && result.base) {
      bootstrapBase = result.base;
      bootstrapMeta = {
        ...(result.meta || {}),
        hostDisplayName: result.hostDisplayName || result.meta?.hostDisplayName || "",
        joinTag: result.joinTag || result.meta?.joinTag || "",
      };
      if (hostEl) hostEl.value = result.base;
      if (result.joinTag) fillSections({ tag: result.joinTag, inviteSlug: stashedInviteSlug });
      return goToAgree(result.base);
    }
    setJoinStep("url");
    errEl.textContent = result.message || PERSONAL_INVITE_OFFLINE_COPY;
    if (result.state === "direct_required") {
      const hot = overlay.querySelector("#hotspot-join-entry");
      if (hot) hot.hidden = false;
    }
    return false;
  };

  changeBtn?.addEventListener("click", () => {
    pendingNearby = null;
    agreed = false;
    joinMeta = null;
    setJoinStep(served ? "agree" : "url");
  });

  const showRejoinCode = () => {
    // A served login failure must not bounce back to Agree. New-member terms
    // were already collected by the valid personal invite flow.
    pendingNearby = null;
    // If this modal still has a resolved personal invite, keep its target and
    // the error on the credentials step. A transient lost edge token must not
    // discard the valid link and restart the wizard.
    if (!served && stashedInviteSlug && bootstrapBase) return;
    setJoinStep(served ? "login" : "url");
  };

  if (hostEl) {
    hostEl.addEventListener("input", () => {
      hostEl.value = String(hostEl.value || "").replace(/\s+/g, "").slice(0, 253);
      const slug = extractInviteSlug(hostEl.value);
      if (slug) stashedInviteSlug = slug;
    });
    hostEl.addEventListener("blur", () => {
      const raw = String(hostEl.value || "").trim();
      const slug = extractInviteSlug(raw);
      if (slug) stashedInviteSlug = slug;
      const h = hostOnlyOf(raw);
      if (h && !/^https?:\/\//i.test(raw) && !/\/j\//i.test(raw)) {
        hostEl.value = hostDisplay(h);
      }
    });
  }
  overlay.querySelector("#join-code-sections")?.addEventListener("paste", (e) => {
    const t = e.clipboardData?.getData("text") || "";
    if (t && (t.includes("-") || t.includes("+") || t.includes("@") || /^https?:/i.test(t) || /\/j\//i.test(t) || /join\s*code/i.test(t) || /slug=/i.test(t))) {
      e.preventDefault();
      applyPaste(t);
    }
  });

  const onStatus = (e) => {
    if (!pendingConn || e.detail.connId !== pendingConn.id) return;
    if (e.detail.status === "waiting") {
      setJoinStep("waiting");
      showJoinProgress("Waiting for the host to let you in…");
    } else if (e.detail.status === "denied") {
      failJoinToStep("The host didn't let you in this time.");
    } else if (e.detail.status === "error") {
      failJoinToStep(e.detail.error || "Couldn't connect.");
    }
  };
  const onWelcome = (e) => {
    if (!pendingConn || e.detail.connId !== pendingConn.id) return;
    if (joinMeta) {
      if (joinMeta.name) pendingConn.name = joinMeta.name;
      if (joinMeta.iconText) pendingConn.iconText = joinMeta.iconText;
      if (joinMeta.serverPic) {
        pendingConn.serverPic = joinMeta.serverPic;
        try { if (typeof persistServerIcon === "function") persistServerIcon(pendingConn); } catch {}
      }
      pendingConn.serverSettings = {
        ...(pendingConn.serverSettings || {}),
        minAge: clampServerMinAge(joinMeta.minAge),
      };
    }
    persistConnSession(pendingConn);
    cleanup();
    ashClose();
    if (S.activeConnId !== pendingConn.id) switchConn(pendingConn.id);
    else renderAll();
  };
  const cleanup = () => {
    document.removeEventListener("ash:conn-status", onStatus);
    document.removeEventListener("ash:welcome", onWelcome);
    onDiscoveredChange = null;
    window.AshNative?.stopDiscovery?.();
  };
  const closeModal = () => {
    cleanup();
    if (pendingConn && pendingConn.status !== "online") {
      try { pendingConn.ws?.close(); } catch {}
      delete S.conns[pendingConn.id];
    }
    ashClose();
    renderRail();
  };
  if (served) {
    cancelBtn.onclick = () => {
      if (joinStep === "waiting") {
        if (pendingConn && pendingConn.status !== "online") {
          try { pendingConn.ws?.close(); } catch {}
          delete S.conns[pendingConn.id];
        }
        pendingConn = null;
        localSignupPending = false;
        showJoinProgress("");
        setJoinStep(waitReturnStep);
        toast("Join request cancelled — you can try again");
        return;
      }
      if (onLocalHostPage && joinStep === "agree") {
        localSignupPending = false;
        agreed = false;
        setJoinStep("signup");
        return;
      }
      if (onLocalHostPage && joinStep === "login") {
        setJoinStep("signup");
        return;
      }
      errEl.textContent = onLocalHostPage
        ? "Ask the host if you need help joining this local server."
        : "Ask the host for their personal invite link to join.";
    };
  } else {
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
    cancelBtn.onclick = () => {
      if (onBack && joinStep === "url") {
        closeModal();
        onBack();
        return;
      }
      closeModal();
    };
  }
  if (toSigninBtn) {
    toSigninBtn.onclick = () => {
      localSignupPending = false;
      agreed = false;
      setJoinStep("login");
    };
  }
  if (toSignupBtn) {
    toSignupBtn.onclick = () => {
      localSignupPending = false;
      agreed = false;
      setJoinStep("signup");
    };
  }
  document.addEventListener("ash:conn-status", onStatus);
  document.addEventListener("ash:welcome", onWelcome);

  const startJoin = async (base, yourName, invite, pass, serverName = "", joinTag = "", joinOpts = {}) => {
    errEl.textContent = "";
    const httpBase = httpBaseFromUrl(base);
    let hostHint = "";
    try { hostHint = new URL(httpBase).hostname || ""; } catch {}
    showJoinProgress(hostHint ? `Connecting to ${hostHint}…` : "Connecting…");
    // Prefer group token for host admission; rotating code unlocks the Public edge (legacy).
    const admitInvite = joinOpts.token || invite || "";
    const edgeInvite = joinOpts.rot || invite || "";
    const inviteSlug = normInviteSlug(joinOpts.inviteSlug || stashedInviteSlug || "");
    const signInOnly = served && !onLocalHostPage && /^https:/i.test(httpBase);
    const joinEndpoint = signInOnly ? "/ash-login" : "/ash-join";
    try {
      const url = normalizeServerUrl(base);
      if (!url) { failJoinToStep("That invite doesn't point at a server."); return; }

      // Always admit over HTTP + poll /ash-join-wait. Waiting only on WebSocket
      // misses Approve when the socket drops (LAN) or Cloudflare drops WSS.
      const useHttpJoin = true;
      // Public edge Worker: unlock via personal inviteSlug (or legacy rotating code).
      if ((edgeInvite || inviteSlug) && /^https:/i.test(httpBase)) {
        showJoinProgress(hostHint ? `Unlocking ${hostHint}…` : "Unlocking Public gate…");
        const unlocked = await unlockEdgeGate(httpBase, edgeInvite, inviteSlug);
        if (!unlocked.ok) {
          // Fall back: maybe the group token itself was synced / is the only code.
          if (admitInvite && admitInvite !== edgeInvite) {
            const unlocked2 = await unlockEdgeGate(httpBase, admitInvite, inviteSlug);
            if (!unlocked2.ok) {
              failJoinToStep(
                unlocked2.error || unlocked.error || "Couldn't unlock Public gate.",
                !served && inviteSlug ? "url" : waitReturnStep,
              );
              return;
            }
          } else {
            failJoinToStep(
              unlocked.error || "Couldn't unlock Public gate.",
              !served && inviteSlug ? "url" : waitReturnStep,
            );
            return;
          }
        }
      }
      const probeUrl = `${httpBase}/ash-ok`;
      let probeMeta = null;
      try {
        showJoinProgress(hostHint ? `Checking ${hostHint}…` : "Checking server…");
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
          lastStatus = res.status;
          if (res.ok) {
            try {
              probeMeta = await res.json();
            } catch {
              try { probeMeta = JSON.parse(await res.text()); } catch {}
            }
            break;
          }
          if (res.status === 401 || res.status === 403) {
            if ((edgeInvite || inviteSlug) && attempt === 0) {
              await unlockEdgeGate(httpBase, edgeInvite, inviteSlug);
              continue;
            }
            failJoinToStep(inviteSlug
              ? PERSONAL_INVITE_OFFLINE_COPY
              : "Couldn't unlock this Public server — ask the host for their invite link.");
            return;
          }
          if (res.status !== 400 || attempt === 2) break;
          await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
        }
        if (!res?.ok) {
          failJoinToStep(`Server responded ${lastStatus || "?"} at ${httpBase}. Ask the host to toggle Public off/on.`);
          return;
        }
      } catch (probeErr) {
        const why = probeErr?.name === "AbortError" ? "timed out" : "unreachable";
        const lan = /^http:\/\//i.test(httpBase);
        failJoinToStep(lan
          ? `Couldn't reach ${httpBase} (${why}). Same Wi‑Fi as the host? Confirm they're still hosting.`
          : `Couldn't reach ${httpBase} (${why}). Confirm Public is on and open the host's invite link.`);
        return;
      }

      const probeJoinTag = normJoinTag(probeMeta?.joinTag || joinTag || joinOpts.sid || "");
      if (probeMeta?.name && !serverName) serverName = String(probeMeta.name).trim();
      const id = await serverConnIdFrom(probeJoinTag, url);
      // Expired/kicked sessions leave a token-less or error conn — allow rejoin.
      const existing = S.conns[id];
      if (existing && !PersonalSpace.isPersonal(existing) && existing.token && existing.status === "online") {
        // §10: already a member — redeem group edges instead of re-joining.
        if (admitInvite && String(admitInvite).replace(/[^A-Za-z0-9]/g, "").length >= 12) {
          showJoinProgress("");
          send({ type: "redeemInvite", code: admitInvite }, id);
          toast("Adding you to the invited groups…");
          closeModal();
          return;
        }
        failJoinToStep("You're already on that server.");
        return;
      }
      let conn = S.conns[id];
      if (!conn || PersonalSpace.isPersonal(conn)) {
        conn = makeConn({ id, url, name: serverName || "", pass: null, joinTag: probeJoinTag || joinTag || "" });
        S.conns[id] = conn;
      } else {
        // Fresh join after kick/expiry — drop the dead session first.
        stopHttpTransport(conn);
        try { conn.ws?.close(); } catch {}
        conn.ws = null;
        conn.token = "";
        conn.me = null;
        conn.url = url;
        if (serverName) conn.name = serverName;
        if (probeJoinTag || joinTag) conn.joinTag = probeJoinTag || normJoinTag(joinTag);
      }
      conn._joinHttpBase = httpBase;
      syncConnDualUrls(conn, { joinTag: probeJoinTag || joinTag, joinBase: httpBase });
      // Member passwords unlock the group E2E secret after welcome — don't treat
      // the typed password as the shared group passphrase.
      conn.pass = null;
      conn._pendingPassword = pass;
      conn._joinHost = hostHint || httpBase;
      if (inviteSlug) {
        conn._joinInviteSlug = inviteSlug;
        conn.inviteSlug = inviteSlug;
      }
      if (joinTag || probeJoinTag) conn.joinTag = normJoinTag(probeJoinTag || joinTag).slice(0, 4);
      pendingConn = conn;

      showJoinProgress("Preparing sign-in…");
      const fp = await fingerprintFor(fingerprintServerKey(conn), yourName);
      let idFields = {};
      try { idFields = await identityJoinFields(); } catch {}
      let authVerifier = "";
      // Prefer cached salt. Otherwise fetch — host returns the real salt for
      // known passworded members even without a join code (invite still helps
      // for brand-new / incomplete accounts).
      let loginSalt = loadCachedPwdSalt(httpBase, yourName);
      const publicHttps = /^https:/i.test(httpBase);
      try {
        const localHttp = /^http:/i.test(httpBase);
        // Public salts are deliberately refreshed for every credential attempt:
        // a cached blind/old salt would turn valid credentials into a misleading
        // "Wrong name or password" response.
        if (publicHttps || invite || !loginSalt || localHttp || idFields.identityId) {
          const q = new URLSearchParams();
          q.set("name", yourName);
          if (invite) q.set("invite", invite);
          if (inviteSlug) q.set("inviteSlug", inviteSlug);
          if (idFields.identityId) q.set("identityId", idFields.identityId);
          const saltRes = await serverFetch(`${httpBase}/ash-auth-salt?${q}`, {
            method: "GET",
          });
          if (saltRes.status === 403) {
            // Local: keep going with a cached salt if we have one (LAN rate limits
            // are soft; don't block a known returning member).
            if (!(localHttp && loginSalt)) {
              const errBody = await saltRes.json().catch(() => ({}));
              failJoinToStep(errBody.error || "Too many attempts. Wait a minute and try again.");
              return;
            }
          } else {
            const saltMsg = await saltRes.json().catch(() => ({}));
            if (saltMsg.type === "authSalt" && saltMsg.salt) {
              if (publicHttps || invite || !loginSalt || localHttp || idFields.identityId) loginSalt = saltMsg.salt;
            } else if (publicHttps) {
              failJoinToStep("The server could not verify sign-in securely. Check that Public hosting is online.");
              return;
            }
          }
        }
        if (loginSalt) {
          conn._loginSalt = loginSalt;
          authVerifier = (await deriveAuthBundle(pass, loginSalt)).verifier;
        }
      } catch (e) {
        console.warn("auth salt fetch failed", e);
        if (publicHttps) {
          failJoinToStep("Couldn't reach the server's secure sign-in service. Check Public hosting and try again.");
          return;
        }
      }
      if (publicHttps && (!loginSalt || !authVerifier)) {
        failJoinToStep("The server could not prepare secure sign-in. Please try again.");
        return;
      }

      // Public HTTPS: approve over HTTP (Cloudflare WSS often drops before Approve).
      // After welcome, open WebSocket with the token for live traffic.
      if (useHttpJoin) {
        showJoinProgress("Requesting access…");
        let joinName = yourName;
        // nameTaken → collision ceremony, then retry join once or twice.
        for (let attempt = 0; attempt < 4; attempt++) {
        const joinPayload = {
          invite: admitInvite || "",
          name: joinName,
          fingerprint: fp,
          authVerifier,
          ...(inviteSlug ? { inviteSlug } : {}),
          ...(idFields.identityId ? {
            identityId: idFields.identityId,
            identityPub: idFields.identityPub || "",
          } : {}),
        };
        const postJoin = async (asForm) => {
          if (asForm) {
            const body = new URLSearchParams();
            body.set("invite", joinPayload.invite || "");
            body.set("name", joinPayload.name || "");
            body.set("fingerprint", joinPayload.fingerprint || "");
            body.set("authVerifier", joinPayload.authVerifier || "");
            if (joinPayload.inviteSlug) body.set("inviteSlug", joinPayload.inviteSlug);
            if (joinPayload.identityId) {
              body.set("identityId", joinPayload.identityId);
              body.set("identityPub", joinPayload.identityPub || "");
            }
            return serverFetch(`${httpBase}${joinEndpoint}`, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
              body: body.toString(),
            });
          }
          return serverFetch(`${httpBase}${joinEndpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json;charset=UTF-8" },
            body: JSON.stringify(joinPayload),
          });
        };
        // Prefer form-urlencoded: NanoHTTPD behind Cloudflare often mishandles
        // raw JSON POST bodies ("Bad JSON"). Fall back to JSON once if needed.
        let joinRes = await postJoin(true);
        let joinMsg = null;
        try { joinMsg = await joinRes.json(); } catch {}
        // If form POST somehow fails to parse, fall back to JSON once.
        const badBody = !joinMsg || (joinMsg.type === "error" && /json|read the join request|request body/i.test(joinMsg.error || ""));
        if (badBody && joinRes.status >= 400) {
          joinRes = await postJoin(false);
          joinMsg = null;
          try { joinMsg = await joinRes.json(); } catch {}
        }
        if (joinMsg && joinMsg.type === "error" && (joinMsg.code === "nameTaken" || /already uses that name/i.test(joinMsg.error || ""))) {
          showJoinProgress("");
          const taken = joinMsg.takenName || joinName;
          const next = typeof promptNameCollision === "function"
            ? await promptNameCollision(taken)
            : null;
          if (!next) {
            delete S.conns[id];
            failJoinToStep(joinMsg.error || "That name is taken.");
            return;
          }
          joinName = next;
          yourName = next;
          try {
            const nameEl = document.getElementById("j-name");
            if (nameEl) nameEl.value = next;
          } catch {}
          showJoinProgress("Requesting access…");
          continue;
        }
        if (!joinMsg || joinMsg.type === "error") {
          const msg = (joinMsg && joinMsg.error) || `Join failed (${joinRes.status}).`;
          delete S.conns[id];
          // Incomplete accounts need a current invite link + password — stay on login
          // (do not bounce to Agree; that created an agree↔login loop).
          if (/isn't fully set up/i.test(msg)) {
            failJoinToStep(
              "This account isn't fully set up yet. Open a current personal invite link from someone in the group, then choose your password.",
            );
            return;
          }
          failJoinToStep(msg);
          if (/Host requires the current join code|isn't recognized|join code|invite link|needInviteLink/i.test(msg)) showRejoinCode();
          return;
        }
        if (signInOnly && joinMsg.type === "waiting") {
          delete S.conns[id];
          failJoinToStep("Wrong name or password.");
          return;
        }
        if (joinMsg.setupNonce) conn._setupNonce = joinMsg.setupNonce;
        if (joinMsg.type === "welcome") {
          handle(conn, joinMsg);
          // Start transport before password setup — setPassword must reach the host.
          connect(conn);
          if (conn._welcomeAuth) await conn._welcomeAuth;
          return;
        }
        if (joinMsg.type !== "waiting" || !joinMsg.requestId) {
          delete S.conns[id];
          failJoinToStep("Unexpected response from server.");
          return;
        }
        conn.status = "waiting";
        setJoinStep("waiting");
        showJoinProgress("Waiting for the host to let you in…");
        document.dispatchEvent(new CustomEvent("ash:conn-status", {
          detail: { connId: conn.id, status: "waiting" },
        }));
        const requestId = joinMsg.requestId;
        const deadline = Date.now() + 5 * 60_000;
        while (pendingConn === conn && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 800));
          if (pendingConn !== conn) return;
          // Already admitted (e.g. parallel WS welcome) — stop polling.
          if (conn.status === "online" && conn.token) return;
          let pollMsg = null;
          try {
            const pollRes = await serverFetch(`${httpBase}/ash-join-wait?id=${encodeURIComponent(requestId)}`, {
              method: "GET",
            });
            pollMsg = await pollRes.json();
          } catch {
            continue;
          }
          if (!pollMsg) continue;
          if (pollMsg.type === "waiting") continue;
          if (pollMsg.type === "denied") {
            delete S.conns[id];
            failJoinToStep("The host didn't let you in this time.");
            return;
          }
          if (pollMsg.type === "welcome") {
            handle(conn, pollMsg);
            connect(conn);
            if (conn._welcomeAuth) await conn._welcomeAuth;
            return;
          }
          if (pollMsg.type === "error") {
            // Welcome may already have landed via another path; don't delete a live session.
            if (conn.status === "online" && conn.token) return;
            delete S.conns[id];
            failJoinToStep(pollMsg.error || "Join request expired.");
            return;
          }
        }
        if (pendingConn === conn) {
          if (conn.status === "online" && conn.token) return;
          delete S.conns[id];
          failJoinToStep("Timed out waiting for host approval. Ask them to Approve again, then retry.");
        }
        return;
        } // end nameTaken retry loop
        delete S.conns[id];
        failJoinToStep("Couldn't find a free name — try again.");
        return;
      }

      showJoinProgress(hostHint ? `Connecting to ${hostHint}…` : "Connecting…");
      conn.joinIntent = {
        name: yourName,
        invite: invite || "",
        inviteSlug: inviteSlug || "",
        fingerprint: fp,
        authVerifier,
        identityId: idFields.identityId || "",
        identityPub: idFields.identityPub || "",
      };
      connect(conn);
      if (!conn.ws) {
        delete S.conns[id];
        failJoinToStep("Couldn't connect.");
        return;
      }
      const joinWatch = setTimeout(() => {
        if (pendingConn !== conn) return;
        if (conn.status === "waiting" || conn.status === "online") return;
        try { conn.ws?.close(); } catch {}
        delete S.conns[id];
        failJoinToStep("Connection timed out. Toggle Public off/on on the host phone and try again.");
      }, 20000);
      const clearWatch = () => clearTimeout(joinWatch);
      document.addEventListener("ash:conn-status", clearWatch, { once: true });
      document.addEventListener("ash:welcome", clearWatch, { once: true });
    } catch (err) {
      console.warn("startJoin failed", err);
      failJoinToStep((err && err.message) ? `Couldn't start join — ${err.message}` : "Couldn't start join — try again.");
    }
  };


  const renderDiscovered = (rawList) => {
    const list = (rawList || []).filter(d => !discoveredAlreadyJoined(d));
    const section = overlay.querySelector("#discover-section");
    const box = overlay.querySelector("#discover-list");
    if (!section || !box) return;
    if (joinStep !== "url" || served || isRejoin) {
      section.hidden = true;
      return;
    }
    section.hidden = !list.length;
    box.innerHTML = list.map((d, i) => `
      <button type="button" class="discover-item" data-i="${i}">
        <span class="discover-name">${esc(d.name || "Server")}</span>
        <span class="discover-sub">Tap to review rules & join</span>
      </button>`).join("");
    box.querySelectorAll(".discover-item").forEach(btn => {
      btn.onclick = async () => {
        const d = list[Number(btn.dataset.i)];
        const known = findKnownMemberConnByTag(d.sid);
        if (known?.token) {
          closeModal();
          if (d.url) {
            const httpBase = httpBaseFromUrl(d.url) || "";
            syncConnDualUrls(known, { shareLan: httpBase, joinTag: d.sid || known.joinTag || "" });
            persistConnSession(known, dualUrlPersistFields(known));
          }
          switchConn(known.id);
          connect(known);
          toast(`Reconnecting to ${known.name || known.hostName || "server"}…`);
          return;
        }
        pendingNearby = { url: d.url, code: d.code || "", name: d.name || "", sid: d.sid || "" };
        fillSections({ tag: d.sid || "", invite: d.code || "" });
        await goToAgree(httpBaseFromUrl(d.url) || d.url);
      };
    });
  };
  onDiscoveredChange = renderDiscovered;
  if (!served && !isRejoin) {
    renderDiscovered([]);
  }

  const readLoginFields = () => {
    const yourName = nameEl?.value.trim() || "";
    const pass = passEl?.value || "";
    if (!yourName) {
      errEl.textContent = "Pick a name so the host knows who you are.";
      nameEl?.focus();
      return null;
    }
    if (!pass) {
      errEl.textContent = "Choose a password for your account on this server.";
      passEl?.focus();
      return null;
    }
    return { yourName, pass };
  };

  const runStartJoinWithCredentials = async (yourName, pass) => {
    const target = resolveJoinTarget();
    if (!target?.base) {
      errEl.textContent = onLocalHostPage
        ? "Couldn’t reach this server. Check you’re on the same Wi‑Fi."
        : "Missing server address — go back and paste the invite link.";
      if (!onLocalHostPage) setJoinStep(served ? "agree" : "url");
      return;
    }
    const invite = target.invite || readInvite() || "";
    if (target.base && !served && hostOnlyOf(target.base)) {
      try { rememberPublicHost(hostOnlyOf(target.base)); } catch {}
    }
    await startJoin(
      target.base,
      yourName,
      invite || "",
      pass,
      (joinMeta && joinMeta.name) || target.name || "",
      target.sid || "",
      {
        token: target.token || "",
        rot: target.rot || "",
        inviteSlug: target.inviteSlug || stashedInviteSlug || "",
      },
    );
  };

  /** Local signup: if name already has a password on this server, sign in instead of agree→wait. */
  const tryKnownMemberSignIn = async (yourName, pass) => {
    const httpBase = httpBaseFromUrl(location.origin);
    if (!httpBase) return false;
    showJoinProgress("Checking…");
    try {
      const q = new URLSearchParams();
      q.set("name", yourName);
      const saltRes = await serverFetch(`${httpBase}/ash-auth-salt?${q}`, { method: "GET" });
      if (saltRes.status === 403) {
        showJoinProgress("");
        errEl.textContent = "Too many attempts. Wait a minute and try again.";
        return true; // handled — don't continue to agree
      }
      const saltMsg = await saltRes.json().catch(() => ({}));
      if (!(saltMsg.type === "authSalt" && saltMsg.salt)) {
        showJoinProgress("");
        return false; // new name → signup agree path
      }
      // Known passworded member — join like Sign in (welcome if password matches).
      localSignupPending = false;
      waitReturnStep = "signup";
      await runStartJoinWithCredentials(yourName, pass);
      return true;
    } catch (e) {
      console.warn("known-member check failed", e);
      showJoinProgress("");
      return false;
    }
  };

  overlay.querySelector("#join-form").onsubmit = async (e) => {
    e.preventDefault();
    if (joinStep === "waiting") return;
    if (joinStep === "url") {
      if (hostEl?.value) applyPaste(hostEl.value);
      const target = resolveJoinTarget();
      if (!target?.base) {
        const slugOnly = stashedInviteSlug || extractInviteSlug(hostEl?.value || "");
        if (slugOnly) {
          stashedInviteSlug = normInviteSlug(slugOnly);
          await runPersonalInviteBootstrap();
          return;
        }
        errEl.textContent = "Paste the invite link or Server URL from the host.";
        hostEl?.focus();
        return;
      }
      bootstrapBase = target.base;
      await goToAgree(target.base);
      return;
    }

    if (joinStep === "agree") {
      if (!acceptCheck?.checked) {
        errEl.textContent = "Confirm you meet the age requirement and agree to the rules.";
        acceptCheck?.focus();
        return;
      }
      agreed = true;
      // Local Sign up: after Agree, send the join request (credentials already entered).
      if (onLocalHostPage && localSignupPending) {
        const creds = readLoginFields();
        if (!creds) {
          localSignupPending = false;
          setJoinStep("signup");
          return;
        }
        localSignupPending = false;
        waitReturnStep = "signup";
        await runStartJoinWithCredentials(creds.yourName, creds.pass);
        return;
      }
      // Public / app: Agree then collect credentials.
      setJoinStep("login");
      return;
    }

    // signup step (Local Soft-AP default)
    if (joinStep === "signup") {
      const creds = readLoginFields();
      if (!creds) return;
      // Returning member who typed on Sign up → sign in immediately.
      if (await tryKnownMemberSignIn(creds.yourName, creds.pass)) return;
      localSignupPending = true;
      agreed = false;
      waitReturnStep = "signup";
      await goToAgree(location.origin);
      return;
    }

    // login step
    const creds = readLoginFields();
    if (!creds) return;

    // Local Sign in: no agreement gate.
    if (onLocalHostPage) {
      localSignupPending = false;
      waitReturnStep = "login";
      await runStartJoinWithCredentials(creds.yourName, creds.pass);
      return;
    }

    if (!agreed && !codeOptional) {
      errEl.textContent = "Please review and agree to the server rules first.";
      setJoinStep("agree");
      return;
    }
    waitReturnStep = "login";
    await runStartJoinWithCredentials(creds.yourName, creds.pass);
  };

  setJoinStep(joinStep);
  // Personal /j/<slug> deep link: resolve public → LAN → Direct with clear copy.
  if (inviteSlugPrefill && !served && !isRejoin && !sec.host) {
    queueMicrotask(() => { runPersonalInviteBootstrap(); });
  } else if (joinStep === "agree") {
    goToAgree(location.origin);
  }
}


/** Native / shared URL → open Add a server with Server URL filled. */
window.ashJoinFromUrl = (raw) => {
  try {
    if (isServedOrigin()) return;
    if (typeof shareIdFromPath === "function" && shareIdFromPath()) return;
  } catch {}
  const text = String(raw || "").trim();
  if (!text) return;
  if (window.Onboarding?.queueInvite?.(text)) return;
  if (typeof textLooksLikeEventPass === "function" && textLooksLikeEventPass(text)) {
    if (typeof openPassReceiveFlow === "function") openPassReceiveFlow(text);
    return;
  }
  // Soft‑AP LAN / phlip://join?url=… — returning Direct members reconnect without join modal.
  const tryContinue = typeof continueDirectFromJoinUrl === "function"
    ? continueDirectFromJoinUrl(text)
    : null;
  if (tryContinue && typeof tryContinue.then === "function") {
    tryContinue.then((done) => {
      if (done) return;
      document.querySelector(".modal-backdrop")?.remove();
      openJoinModal(text);
    }).catch(() => {
      document.querySelector(".modal-backdrop")?.remove();
      openJoinModal(text);
    });
    return;
  }
  // Close an open join modal so prefill isn't ignored.
  document.querySelector(".modal-backdrop")?.remove();
  openJoinModal(text);
};
