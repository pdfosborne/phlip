/* handlers-dispatch.js — handle() message dispatch.
 * Size exception: single cohesive handle() switch. See ownership.md.
 * Load after: handlers-clone.js; before: handlers.js facade
 */

/** Return the one message object owned by conn and merge server truth into it. */
function reconcileAuthoritativeChatMessage(conn, incoming) {
  if (!conn || !incoming?.id || !incoming.channelId) return null;
  const list = (conn.messages ||= {})[incoming.channelId] ||= [];
  const existing = list.find(item => item.id === incoming.id);
  if (existing) {
    // The optimistic object may already hold plaintext. Keep it when the
    // authoritative ciphertext is identical so reconciliation cannot flash ….
    const sameCiphertext = existing.text === incoming.text;
    Object.assign(existing, incoming, { syncStatus: "synced" });
    if (!sameCiphertext) {
      delete existing._text;
      delete existing._eventTitle;
    }
    return existing;
  }
  const stored = { ...incoming, syncStatus: "synced" };
  list.push(stored);
  return stored;
}

/** Return the poll object owned by conn and merge authoritative revisions. */
function reconcileAuthoritativePoll(conn, incoming) {
  if (!conn || !incoming?.id || !incoming.boardId) return null;
  const list = conn.polls ||= [];
  const existing = list.find(item => item.id === incoming.id);
  if (existing) {
    const oldRevision = Number(existing.revision) || 0;
    const nextRevision = Number(incoming.revision) || 0;
    const oldUpdated = Number(existing.updatedAt) || 0;
    const nextUpdated = Number(incoming.updatedAt) || 0;
    if (nextRevision < oldRevision
        || (nextRevision === oldRevision && nextUpdated < oldUpdated)) return existing;
    const question = existing._question;
    const labels = new Map((existing.options || []).map(opt => [opt.id, opt._label]));
    Object.assign(existing, incoming);
    if (question !== undefined) existing._question = question;
    for (const opt of existing.options || []) {
      if (opt && opt._label === undefined && labels.has(opt.id)) opt._label = labels.get(opt.id);
    }
    delete existing._pollOptimistic;
    return existing;
  }
  const stored = { ...incoming };
  list.push(stored);
  return stored;
}

/** Return the task object owned by conn and merge authoritative revisions. */
function reconcileAuthoritativeTask(conn, incoming) {
  if (!conn || !incoming?.id || !incoming.channelId) return null;
  const list = conn.tasks ||= [];
  const existing = list.find(item => item.id === incoming.id);
  if (existing) {
    const oldRevision = Number(existing.revision) || 0;
    const nextRevision = Number(incoming.revision) || 0;
    const oldUpdated = Number(existing.updatedAt) || 0;
    const nextUpdated = Number(incoming.updatedAt) || 0;
    if (nextRevision < oldRevision
        || (nextRevision === oldRevision && nextUpdated < oldUpdated)) return existing;
    Object.assign(existing, incoming);
    return existing;
  }
  const stored = { ...incoming };
  list.push(stored);
  return stored;
}

/** Presence / live-photo / roster: patch faces. Remount only People screens. */
function paintPresenceChrome(conn, opts) {
  const roster = typeof viewingRosterView === "function"
    ? viewingRosterView()
    : (S.activeView?.kind === "members" || S.activeView?.kind === "sharedHistory");
  const wantSidebar = !!(opts && opts.sidebar);
  if (conn.id === S.activeConnId) {
    if (typeof renderFoot === "function") renderFoot();
    if (typeof refreshLiveFacesInDom === "function") refreshLiveFacesInDom();
    if (roster && typeof renderView === "function") renderView();
    try { if (typeof refreshChannelPanelMetaTabs === "function") refreshChannelPanelMetaTabs(); } catch {}
  } else if (S.activeConnId === "personal") {
    if (wantSidebar && typeof renderSidebar === "function") renderSidebar();
    if (typeof refreshLiveFacesInDom === "function") refreshLiveFacesInDom();
    if (roster && typeof renderView === "function") renderView();
  }
}

function handle(conn, m) {
  switch (m.type) {
    case "syncSlices": {
      (async () => {
        const cache = await LocalSyncStore?.applySyncResponse?.(conn, m);
        if (!cache) {
          conn._sliceRequestedForSession = false;
          sendTo(conn, { type: "syncRequest", protocol: 0, principalId: conn.me?.id || "" });
          return;
        }
        const authoritative = {
          ...cache,
          type: "sync",
          user: cache.user || cache.me || conn.me,
          online: Array.isArray(cache.online) ? cache.online : (conn.online || []),
        };
        delete authoritative.me;
        handle(conn, authoritative);
      })();
      break;
    }

    case "messagePage": {
      if (typeof applyMessageHistoryPage === "function") applyMessageHistoryPage(conn, m);
      break;
    }

    case "welcome":
      conn.me = m.user;
      if (m.user?.name) conn._lastName = m.user.name;
      if (m.user?.inviteSlug) conn.inviteSlug = String(m.user.inviteSlug);
      if (m.user?.inviteUrl && !/phlipapp\.com\/j\//i.test(String(m.user.inviteUrl))) {
        conn.inviteUrl = String(m.user.inviteUrl);
      } else if (conn.inviteSlug && typeof buildPersonalInviteUrl === "function") {
        conn.inviteUrl = buildPersonalInviteUrl(conn.inviteSlug, conn);
      }
      conn.hostName = m.hostName;
      if (m.iconText != null) conn.iconText = normalizeIconText(String(m.iconText));
      else if (!conn.iconText) conn.iconText = "";
      if (m.serverPic != null && m.serverPic !== "") conn.serverPic = m.serverPic;
      else if (m.serverPic === null || m.serverPic === "") conn.serverPic = "";
      // Server display name comes from the host — don't keep the joiner's own
      // name that startJoin temporarily put in conn.name.
      if (m.hostName) conn.name = m.hostName;
      conn.channels = m.channels || [];
      conn.boards = Array.isArray(m.boards) ? m.boards : [];
      if (typeof ensureConnBoards === "function") ensureConnBoards(conn);
      if (typeof syncShownBoardsToPersonal === "function") syncShownBoardsToPersonal();
      conn.events = m.events || [];
      conn.tasks = Array.isArray(m.tasks) ? m.tasks : [];
      conn.polls = Array.isArray(m.polls) ? m.polls : (conn.polls || []);
      conn.routines = Array.isArray(m.routines) ? normalizeRoutineCatalog(m.routines) : (conn.routines || []);
      conn.availabilities = Array.isArray(m.availabilities) ? m.availabilities : [];
      conn.timeBlocks = Array.isArray(m.timeBlocks) ? m.timeBlocks : [];
      conn.shares = Array.isArray(m.shares) ? m.shares.filter(s => s && s.active !== false) : [];
      conn.categories = m.categories || conn.categories || [];
      conn.cardCats = (m.cardCats && typeof m.cardCats === "object") ? m.cardCats : (conn.cardCats || {});
      conn.cardDurations = (m.cardDurations && typeof m.cardDurations === "object") ? m.cardDurations : (conn.cardDurations || {});
      conn.removedCards = Array.isArray(m.removedCards) ? m.removedCards : (conn.removedCards || []);
      conn.locations = Array.isArray(m.locations) ? m.locations : (conn.locations || []);
      conn.eventTypes = Array.isArray(m.eventTypes) ? m.eventTypes : (conn.eventTypes || []);
      conn.reactionCards = Array.isArray(m.reactionCards) ? m.reactionCards : (conn.reactionCards || []);
      if (typeof applyReactionCardsCatalog === "function") {
        applyReactionCardsCatalog(conn, conn.reactionCards);
      }
      if (typeof relinkEventsForConnCards === "function") {
        try { relinkEventsForConnCards(conn); } catch {}
      }
      conn.customRoles = Array.isArray(m.customRoles) ? m.customRoles : (conn.customRoles || []);
      if (m.eventRolePerms && typeof m.eventRolePerms === "object") {
        conn.eventRolePerms = m.eventRolePerms;
      }
      try {
        document.querySelectorAll(".roles-editor-panel").forEach(el =>
          el.dispatchEvent(new CustomEvent("roles-refresh")));
      } catch {}
      conn.messages = m.messages || {};
      conn.members = normalizeConnMembers(conn, m.members);
      conn.online = Array.isArray(m.online) ? m.online : (conn.me?.id ? [conn.me.id] : []);
      conn.pendingReqs = m.pending || [];
      conn.invite = m.invite || null;
      applyInviteShareFields(conn);
      applyShareReachFields(conn, m);
      if (m.joinTag) conn.joinTag = normJoinTag(m.joinTag);
      syncConnDualUrls(conn, { joinTag: m.joinTag, joinBase: conn._joinHttpBase || "" });
      // Host bridges must keep srv-local-* so ashSyncServers stays idempotent.
      if (m.joinTag && !String(conn.id || "").startsWith("srv-local-")) {
        const tagId = `srv-tag-${normJoinTag(m.joinTag).toLowerCase()}`;
        if (tagId !== conn.id && typeof remigrateConnId === "function") {
          remigrateConnId(conn, tagId);
        }
      }
      conn.groupInvites = Array.isArray(m.groupInvites) ? m.groupInvites : [];
      conn.autoIncludeChannels = Array.isArray(m.autoIncludeChannels) ? m.autoIncludeChannels : [];
      conn.notifications = m.notifications || [];
      // Abuse reports — only populated for host/admin/moderator (server-gated).
      conn.reports = Array.isArray(m.reports) ? m.reports : [];
      // Personal block list — never anyone else's; client hides their content locally.
      conn.blocked = Array.isArray(m.blocked) ? m.blocked : [];
      conn.serverActivity = Array.isArray(m.serverActivity) ? m.serverActivity : [];
      conn.serverSettings = m.serverSettings || { allowUserCreateEvents: true, liveProfilePhotos: "off", allowProfilePics: false, cardTheme: "classic" };
      if (conn.id === S.activeConnId) applyCardTheme(conn.serverSettings.cardTheme);
      conn.status = "online";
      conn._readSource = null;
      conn._relayIncomplete = false;
      if (m.token) conn.token = m.token;
      conn.joinIntent = null;
      try { if (typeof markConnSynced === "function") markConnSynced(conn); } catch {}
      // Drop invite-gate token so polls use member bearer, not X-Phlip-Invite.
      try { clearEdgeInvite(conn.url || ""); } catch {}
      try { seedChannelReadCursors(conn); } catch {}
      try { seedEventSeenCursors(conn); } catch {}
      try {
        sessionStorage.removeItem("ash_rejoin_name");
        sessionStorage.removeItem("ash_rejoin_pass");
      } catch {}
      // Persist session so the app client stays joined across close/reopen.
      // Save icon immediately so the rail still shows it when the host is offline.
      if (m.e2eSalt) conn.e2eSalt = m.e2eSalt;
      if (typeof applyHotspotSessionFields === "function") applyHotspotSessionFields(conn, m);
      if (typeof rememberDirectSessionOnWelcome === "function") {
        rememberDirectSessionOnWelcome(conn);
      } else if (_hotspotFirstJoin && typeof persistConnHotspotCreds === "function") {
        persistConnHotspotCreds(conn, _hotspotFirstJoin.ssid, _hotspotFirstJoin.password);
        _hotspotFirstJoin = null;
      }
      try { persistServerIcon(conn); } catch {}
      // Hosts keep empty authVerifier by design (device passphrase / bridge) — never
      // treat that as member setPassword. Only force setup when welcome includes
      // one-time group-key material (new join / incomplete remint).
      const hostish = !!(m.user?.isHost
        || m.user?.role === ROLE_HOST
        || (typeof effectiveRole === "function" && effectiveRole(m.user) === ROLE_HOST)
        || (typeof isHostedBridgeConn === "function" && isHostedBridgeConn(conn)));
      const canFinishPwSetup = !!(m.groupKeyOnce && (m.setupNonce || conn._setupNonce));
      const needsPwSetup = !!m.needsPassword && !hostish && !conn.pass && canFinishPwSetup;
      persistConnSession(conn, {
        name: conn.name || m.hostName,
        userName: m.user?.name || "",
        iconText: conn.iconText || "",
        serverPic: conn.serverPic || "",
        ...dualUrlPersistFields(conn),
        // Don't mark rules accepted until password setup succeeds — otherwise a
        // failed setPassword skips Agree straight into a broken Login loop.
        deferRulesAccepted: needsPwSetup,
      });
      if (/^http:/i.test(conn._joinHttpBase || conn.shareLan || conn.urlLan || "") && window.AshNative?.approveNetworkOnce) {
        try { window.AshNative.approveNetworkOnce(); } catch {}
      }
      const admitWelcomeUi = () => {
        document.dispatchEvent(new CustomEvent("ash:welcome", { detail: { connId: conn.id } }));
        renderConnStatus();
        try { syncMyCardBack(); } catch {}
        try { syncMyProfile(conn); } catch {}
        try {
          conn._lastEventCardStyleSent = "";
          if (typeof syncMyEventCardStyle === "function") syncMyEventCardStyle(conn);
        } catch {}
        try { if (typeof saveBrowserRulesAccepted === "function") saveBrowserRulesAccepted(true); } catch {}
      };
      // Password setup must finish before admitting UI (browser /j/slug had been skipping this).
      if (!needsPwSetup) admitWelcomeUi();
      conn._welcomeAuth = (async () => {
        try {
          let pendingPw = conn._pendingPassword;
          if (needsPwSetup) {
            if (!pendingPw && typeof ashPrompt === "function") {
              pendingPw = await ashPrompt("Choose a password for your account on this server.", {
                password: true,
                placeholder: "Password",
                maxlength: 128,
                ok: "Save password",
              });
              if (pendingPw) conn._pendingPassword = pendingPw;
            }
            if (!pendingPw) {
              throw new Error("Choose a password to finish joining this server.");
            }
            await completePasswordSetup(conn, pendingPw, m);
            conn._passwordReady = true;
            admitWelcomeUi();
          } else if (pendingPw && m.wrappedGroupKey) {
            await unlockWrappedGroupKey(conn, pendingPw, { ...m, _pwdSalt: m.pwdSalt || conn._loginSalt });
            conn._pendingPassword = null;
          } else if (conn.pass && m.e2eSalt) {
            // Host bridge or stay-joined reconnect (group secret already on conn).
            conn.e2eSalt = m.e2eSalt;
            conn.key = await deriveKey(conn.pass, m.e2eSalt);
            persistConnSession(conn);
          }
          const cacheSalt = m.pwdSalt || conn._loginSalt;
          const cacheName = m.user?.name || conn.me?.name || "";
          if (cacheSalt && cacheName) saveCachedPwdSalt(conn.url || location.href, cacheName, cacheSalt);
          await decryptAll(conn);
          if (typeof applyRoutineCatalogToMatchingEvents === "function") {
            applyRoutineCatalogToMatchingEvents(conn);
          }
          // Replay offline actions onto the fresh snapshot, then flush to host.
          reapplyOutboxOptimistic(conn);
          cacheConn(conn);
          flushOutbox(conn);
          requestSliceSync(conn);
        } catch (err) {
          console.warn("welcome decrypt failed", err);
          toast(err?.message || "Couldn't unlock this server — check your password.");
          if (needsPwSetup) {
            conn._passwordReady = false;
            conn.token = null;
            conn.status = "offline";
            try { if (typeof setServedGate === "function") setServedGate(true); } catch {}
            throw err;
          }
        }
        if (conn.id === S.activeConnId) {
          if (!S.activeView) {
            Nav.landDefault(conn);
          }
          renderAll();
        } else if (S.activeConnId === "personal") {
          renderView(); renderSidebar(); renderRail();
        }
        consumePendingEventId(conn);
        renderConnStatus();
      })();
      break;

    case "passwordSet":
      toast("Password saved — you're in.");
      break;

    case "displayNameSet": {
      const nm = String(m.name || "").trim();
      if (nm && conn.me) {
        conn.me.name = nm;
        if (m.nameHostSet != null) conn.me.nameHostSet = !!m.nameHostSet;
        if (m.nameSelf != null) conn.me.nameSelf = m.nameSelf || null;
        if (Array.isArray(conn.members)) {
          conn.members = conn.members.map(u => (u && u.id === conn.me.id)
            ? { ...u, name: nm, nameHostSet: !!conn.me.nameHostSet, nameSelf: conn.me.nameSelf }
            : u);
        }
        try {
          persistConnSession(conn, { userName: nm });
        } catch {}
      }
      {
        const w = S.displayNameWaiters?.[conn.id];
        if (w) { w(m); delete S.displayNameWaiters[conn.id]; }
      }
      if (m.hostSetBy) toast(`Host set your name to “${nm}”`);
      else if (m.clearedHostSet) toast("Name updated — host override cleared");
      if (conn.id === S.activeConnId) {
        try { renderFoot(); } catch {}
        try { renderSidebar(true); } catch {}
        if (S.activeView?.kind === "members" || S.activeView?.kind === "serverInfo") try { renderView(); } catch {}
        try { if (typeof refreshChannelPanelMetaTabs === "function") refreshChannelPanelMetaTabs(); } catch {}
      }
      break;
    }

    case "codeRequestTriggered": {
      const w = S.codeRequestWaiters?.[conn.id];
      if (w) { w({ ...m, type: "codeRequestTriggered", ok: true }); delete S.codeRequestWaiters[conn.id]; }
      break;
    }

    case "eventRolePerms": {
      if (m.eventRolePerms && typeof m.eventRolePerms === "object") {
        conn.eventRolePerms = m.eventRolePerms;
      }
      try {
        document.querySelectorAll(".roles-editor-panel").forEach(el =>
          el.dispatchEvent(new CustomEvent("roles-refresh")));
      } catch {}
      break;
    }

    case "memberDisplayNameSet": {
      const uid = String(m.userId || "");
      const nm = String(m.name || "").trim();
      if (uid && nm && Array.isArray(conn.members)) {
        conn.members = conn.members.map(u => (u && u.id === uid)
          ? { ...u, name: nm, nameHostSet: m.nameHostSet !== false }
          : u);
        if (conn.me?.id === uid) {
          conn.me.name = nm;
          conn.me.nameHostSet = m.nameHostSet !== false;
        }
      }
      {
        const w = S.memberDisplayNameWaiters?.[conn.id];
        if (w) { w(m); delete S.memberDisplayNameWaiters[conn.id]; }
      }
      if (conn.id === S.activeConnId && (S.activeView?.kind === "members" || S.activeView?.kind === "serverInfo")) {
        try { renderView(); } catch {}
      }
      try { if (typeof refreshChannelPanelMetaTabs === "function") refreshChannelPanelMetaTabs(); } catch {}
      break;
    }

    case "serverActivityUpdated": {
      conn.serverActivity = Array.isArray(m.serverActivity) ? m.serverActivity : [];
      if (conn.id === S.activeConnId && S.activeView?.kind === "members") {
        try { renderView(); } catch {}
      }
      try { if (typeof refreshChannelPanelMetaTabs === "function") refreshChannelPanelMetaTabs(); } catch {}
      break;
    }

    case "waiting":
      conn.status = "waiting";
      if (m.setupNonce) conn._setupNonce = m.setupNonce;
      if (m.requestId) conn._joinRequestId = m.requestId;
      document.dispatchEvent(new CustomEvent("ash:conn-status", { detail: { connId: conn.id, status: "waiting" } }));
      break;

    case "denied":
      conn.status = "denied";
      conn.token = null;
      document.dispatchEvent(new CustomEvent("ash:conn-status", { detail: { connId: conn.id, status: "denied" } }));
      break;

    case "error":
      // Don't wipe the session token on transient errors — that caused a
      // reconnect death spiral (open → no token → close → repeat).
      {
        const dn = S.displayNameWaiters?.[conn.id];
        if (dn && (m.code === "nameTaken" || m.code === "nameEmpty"
          || /already uses that name|Pick a name/i.test(m.error || ""))) {
          dn(m);
          delete S.displayNameWaiters[conn.id];
          break;
        }
        const mdn = S.memberDisplayNameWaiters?.[conn.id];
        if (mdn && (m.code === "nameTaken" || m.code === "nameEmpty" || m.code === "forbidden"
          || /already uses that name|Pick a name|can't rename/i.test(m.error || ""))) {
          mdn(m);
          delete S.memberDisplayNameWaiters[conn.id];
          break;
        }
        const cr = S.codeRequestWaiters?.[conn.id];
        if (cr) {
          cr({ ...m, ok: false });
          delete S.codeRequestWaiters[conn.id];
          break;
        }
        const il = S.inviteLinkWaiters?.[conn.id];
        if (il) {
          il(m);
          delete S.inviteLinkWaiters[conn.id];
          break;
        }
      }
      conn.status = "error";
      {
        const w = S.groupInviteWaiters?.[conn.id];
        if (w) { w(m); delete S.groupInviteWaiters[conn.id]; }
      }
      document.dispatchEvent(new CustomEvent("ash:conn-status", { detail: { connId: conn.id, status: "error", error: m.error } }));
      break;

    case "pending": { // host/admin: join queue changed
      const prevIds = new Set((conn.pendingReqs || []).map(r => r?.id).filter(Boolean));
      const next = Array.isArray(m.requests) ? m.requests : [];
      conn.pendingReqs = next;
      if (canManageServer(conn)) {
        const added = next.filter(r => r?.id && !prevIds.has(r.id));
        if (added.length === 1 && added[0].name) {
          const via = String(added[0].invitedByName || "").trim();
          toast(via
            ? `${added[0].name} wants to join (via ${via}'s link)`
            : `${added[0].name} wants to join`);
        } else if (added.length > 1) toast(`${added.length} people want to join`);
      }
      if (conn.id === S.activeConnId) {
        renderSidebar();
        if (S.activeView?.kind === "members" || S.activeView?.kind === "sharedHistory") renderView();
        try { if (typeof refreshChannelPanelMetaTabs === "function") refreshChannelPanelMetaTabs(); } catch {}
      }
      break;
    }

    case "invite":    // legacy rotating code — keep field, ignore live share UX updates
      conn.invite = { code: m.code, expiry: m.expiry };
      applyInviteShareFields(conn);
      break;

    case "inviteLink": {
      const slug = String(m.slug || "").trim();
      const url = String(m.url || "").trim();
      if (slug) {
        conn.inviteSlug = slug;
        if (conn.me) conn.me.inviteSlug = slug;
      }
      if (url && !/phlipapp\.com\/j\//i.test(url)) {
        conn.inviteUrl = url;
        if (conn.me) conn.me.inviteUrl = url;
      } else if (slug && typeof buildPersonalInviteUrl === "function") {
        conn.inviteUrl = buildPersonalInviteUrl(slug, conn);
        if (conn.me) conn.me.inviteUrl = conn.inviteUrl;
      }
      const w = S.inviteLinkWaiters?.[conn.id];
      if (w) { w(m); delete S.inviteLinkWaiters[conn.id]; }
      if (conn.id === S.activeConnId) {
        try {
          if (typeof refreshSideOverlay === "function") refreshSideOverlay();
          if (typeof refreshHostSettingsPanel === "function") refreshHostSettingsPanel();
        } catch {}
      }
      break;
    }

    case "groupInviteCreated": {
      const w = S.groupInviteWaiters?.[conn.id];
      if (w) { w(m); delete S.groupInviteWaiters[conn.id]; }
      if (Array.isArray(m.autoInclude)) conn.autoIncludeChannels = m.autoInclude;
      break;
    }

    case "groupInvites":
      conn.groupInvites = Array.isArray(m.invites) ? m.invites : [];
      if (Array.isArray(m.autoInclude)) conn.autoIncludeChannels = m.autoInclude;
      break;

    case "groupInviteRevoked":
      if (m.inviteId && Array.isArray(conn.groupInvites)) {
        conn.groupInvites = conn.groupInvites.filter(i => i.id !== m.inviteId);
      }
      break;

    case "setupPresetApplied": {
      if (m.serverSettings) conn.serverSettings = m.serverSettings;
      if (Array.isArray(m.eventTypes)) conn.eventTypes = m.eventTypes;
      if (Array.isArray(m.locations)) conn.locations = m.locations;
      if (Array.isArray(m.reactionCards)) {
        if (typeof applyReactionCardsCatalog === "function") applyReactionCardsCatalog(conn, m.reactionCards);
        else conn.reactionCards = m.reactionCards;
      }
      if (typeof relinkEventsForConnCards === "function") {
        try { relinkEventsForConnCards(conn); } catch {}
      }
      const label = typeof presetLabel === "function" ? presetLabel(m.preset) : (m.preset || "preset");
      toast(`Setup: ${label} applied`);
      if (conn.id === S.activeConnId) {
        renderSidebar();
        renderView();
      }
      break;
    }

    case "shareReach": // host/admin: Local/Public share bases from the hosting phone
      applyShareReachFields(conn, m);
      if (typeof persistConnSession === "function") {
        persistConnSession(conn, typeof dualUrlPersistFields === "function" ? dualUrlPersistFields(conn) : {});
      }
      if (typeof reevaluateConnPath === "function") reevaluateConnPath(conn);
      break;

    case "hotspotSession": // Direct Soft-AP creds for Rejoin / Leave on member devices
      if (typeof applyHotspotSessionFields === "function") applyHotspotSessionFields(conn, m);
      break;

    case "presence": {
      const prevLive = new Map();
      for (const u of (conn.members || [])) {
        if (u?.id && u.livePic) prevLive.set(u.id, u.livePic);
      }
      conn.online = Array.isArray(m.online) ? m.online : [];
      const onlineSet = new Set(conn.online);
      // Slim presence omits JPEG bodies — keep prior live faces while still online.
      conn.members = normalizeConnMembers(conn, m.members).map((u) => {
        if (!onlineSet.has(u.id)) {
          if (!u.livePic) return u;
          const { livePic, ...rest } = u;
          return rest;
        }
        if (u.livePic) return u;
        const kept = prevLive.get(u.id);
        return kept ? { ...u, livePic: kept } : u;
      });
      if (conn.me && conn.members.length) {
        const self = conn.members.find(u => u.id === conn.me.id);
        if (self) {
          Object.assign(conn.me, self);
          if (!onlineSet.has(conn.me.id) || !self.livePic) delete conn.me.livePic;
          else if (self.livePic) conn.me.livePic = self.livePic;
        }
      }
      paintPresenceChrome(conn, { sidebar: true });
      break;
    }

    case "livePic": {
      // App-only face update (browser ignores via memberProfilePic).
      if (typeof isServedOrigin === "function" && isServedOrigin()) break;
      const uid = String(m.userId || "");
      if (!uid) break;
      const pic = (m.livePic && typeof m.livePic === "string") ? m.livePic : "";
      conn.members = (conn.members || []).map((u) => {
        if (u.id !== uid) return u;
        if (!pic) {
          if (!u.livePic) return u;
          const { livePic, ...rest } = u;
          return rest;
        }
        return { ...u, livePic: pic };
      });
      if (conn.me?.id === uid) {
        if (pic) conn.me.livePic = pic;
        else delete conn.me.livePic;
      }
      paintPresenceChrome(conn, { sidebar: false });
      break;
    }

    case "members": {
      const prevLive = new Map();
      for (const u of (conn.members || [])) {
        if (u?.id && u.livePic) prevLive.set(u.id, u.livePic);
      }
      const onlineSet = new Set(conn.online || []);
      conn.members = normalizeConnMembers(conn, m.members).map((u) => {
        if (!onlineSet.has(u.id)) {
          if (!u.livePic) return u;
          const { livePic, ...rest } = u;
          return rest;
        }
        if (u.livePic) return u;
        const kept = prevLive.get(u.id);
        return kept ? { ...u, livePic: kept } : u;
      });
      if (conn.me && conn.members.length) {
        const self = conn.members.find(u => u.id === conn.me.id);
        if (self) {
          Object.assign(conn.me, self);
          if (!onlineSet.has(conn.me.id) || !self.livePic) delete conn.me.livePic;
          else if (self.livePic) conn.me.livePic = self.livePic;
        }
      }
      paintPresenceChrome(conn, { sidebar: true });
      if (typeof syncFloatBoardMemberCountNow === "function") syncFloatBoardMemberCountNow(conn);
      break;
    }

    case "serverSettings":
      conn.serverSettings = m.serverSettings || conn.serverSettings || { allowUserCreateEvents: true, liveProfilePhotos: "off", allowProfilePics: false, cardTheme: "classic" };
      if (conn.id === S.activeConnId) {
        applyCardTheme(conn.serverSettings.cardTheme);
        renderAll();
        try {
          document.querySelectorAll(".roles-editor-panel").forEach(el =>
            el.dispatchEvent(new CustomEvent("roles-refresh")));
        } catch {}
      }
      try { if (typeof syncMyProfile === "function") syncMyProfile(conn); } catch {}
      break;

    case "memberRemoved":
      if (m.userId && conn.me?.id === m.userId) {
        applyRemovedFromServer(conn, "Removed from this server");
        break;
      }
      conn.members = (conn.members || []).filter(u => u.id !== m.userId);
      // Host purged their footprint — sync will refresh events/messages; until
      // then, clear local organiser / RSVP / reaction markers for this id.
      if (m.purged && m.userId) {
        applyLocalMemberPurge(conn, m.userId);
      }
      if (conn.id === S.activeConnId) {
        if (S.activeView?.kind === "members" || S.activeView?.kind === "sharedHistory"
            || S.activeView?.kind === "serverInfo"
            || S.activeView?.kind === "events" || S.activeView?.kind === "eventDetail"
            || S.activeView?.kind === "console") {
          renderView();
        }
        renderSidebar();
        try { if (typeof refreshChannelPanelMetaTabs === "function") refreshChannelPanelMetaTabs(); } catch {}
      }
      break;

    // ── Demo users (admin settings) ─────────────────────────────────────────
    case "demoUsersCreated":
      toast(m.count ? `Added ${m.count} demo user${m.count === 1 ? "" : "s"}` : "No room for more demo users");
      try {
        if (typeof sideOverlayKind !== "undefined" && sideOverlayKind === "demo-users"
            && typeof refreshSideOverlay === "function") refreshSideOverlay();
      } catch {}
      break;

    case "demoUsersRemoved": {
      const removedIds = Array.isArray(m.userIds) ? m.userIds : [];
      if (!removedIds.length) break;
      const removedSet = new Set(removedIds);
      conn.members = (conn.members || []).filter(u => !removedSet.has(u.id));
      for (const userId of removedIds) applyLocalMemberPurge(conn, userId);
      if (conn.id === S.activeConnId) {
        if (S.activeView?.kind === "members" || S.activeView?.kind === "sharedHistory"
            || S.activeView?.kind === "serverInfo"
            || S.activeView?.kind === "events" || S.activeView?.kind === "eventDetail"
            || S.activeView?.kind === "console") {
          renderView();
        }
        renderSidebar();
        try {
          if (typeof sideOverlayKind !== "undefined" && sideOverlayKind === "demo-users"
              && typeof refreshSideOverlay === "function") refreshSideOverlay();
        } catch {}
      }
      toast(`Removed ${removedIds.length} demo user${removedIds.length === 1 ? "" : "s"}`);
      break;
    }

    // ── Abuse reports (host/admin/moderator inbox) ──────────────────────────
    case "reportAdded": {
      if (!m.report) break;
      conn.reports = conn.reports || [];
      if (!conn.reports.some(r => r.id === m.report.id)) conn.reports.push(m.report);
      if (conn.id === S.activeConnId || S.activeConnId === "personal") {
        toast(`New report: ${reportReasonLabel(m.report.reason)}`);
        renderConnStatus();
        if (S.activeView?.kind === "reports" || S.activeView?.kind === "moderate") renderView();
        try {
          if (typeof sideOverlayKind !== "undefined" && sideOverlayKind === "moderate"
              && typeof refreshSideOverlay === "function") refreshSideOverlay();
          else renderSidebar();
        } catch { try { renderSidebar(); } catch {} }
      }
      break;
    }
    case "reportUpdated": {
      if (!m.report) break;
      conn.reports = (conn.reports || []).map(r => r.id === m.report.id ? m.report : r);
      if ((conn.id === S.activeConnId || S.activeConnId === "personal")
          && (S.activeView?.kind === "reports" || S.activeView?.kind === "moderate")) renderView();
      renderConnStatus();
      try {
        if (typeof sideOverlayKind !== "undefined" && sideOverlayKind === "moderate"
            && typeof refreshSideOverlay === "function") refreshSideOverlay();
        else if (conn.id === S.activeConnId) renderSidebar();
      } catch {}
      break;
    }
    case "reportAck":
      toast("Thanks — sent to the host to review.");
      break;

    case "blockUpdated": {
      conn.blocked = Array.isArray(m.blocked) ? m.blocked : [];
      if (conn.id === S.activeConnId) renderView();
      break;
    }

    case "kicked":
      applyRemovedFromServer(conn, m.error || "Removed from this server");
      break;

    // Full permission-filtered resync after a host channel-admin action
    // (create/update/delete channel, bulk-delete) — simpler than patching who
    // can see what after a permissions change.
    case "sync": {
      conn.channels = m.channels || [];
      conn.boards = Array.isArray(m.boards) ? m.boards : [];
      if (typeof ensureConnBoards === "function") ensureConnBoards(conn);
      if (typeof syncShownBoardsToPersonal === "function") syncShownBoardsToPersonal();
      conn.events = m.events || [];
      conn.availabilities = Array.isArray(m.availabilities) ? m.availabilities : [];
      conn.timeBlocks = Array.isArray(m.timeBlocks) ? m.timeBlocks : [];
      conn.categories = m.categories || conn.categories || [];
      conn.cardCats = (m.cardCats && typeof m.cardCats === "object") ? m.cardCats : (conn.cardCats || {});
      conn.cardDurations = (m.cardDurations && typeof m.cardDurations === "object") ? m.cardDurations : (conn.cardDurations || {});
      conn.removedCards = Array.isArray(m.removedCards) ? m.removedCards : (conn.removedCards || []);
      conn.locations = Array.isArray(m.locations) ? m.locations : (conn.locations || []);
      conn.eventTypes = Array.isArray(m.eventTypes) ? m.eventTypes : (conn.eventTypes || []);
      conn.reactionCards = Array.isArray(m.reactionCards) ? m.reactionCards : (conn.reactionCards || []);
      if (typeof applyReactionCardsCatalog === "function") {
        applyReactionCardsCatalog(conn, conn.reactionCards);
      }
      if (typeof relinkEventsForConnCards === "function") {
        try { relinkEventsForConnCards(conn); } catch {}
      }
      conn.customRoles = Array.isArray(m.customRoles) ? m.customRoles : (conn.customRoles || []);
      if (m.eventRolePerms && typeof m.eventRolePerms === "object") {
        conn.eventRolePerms = m.eventRolePerms;
      }
      try {
        document.querySelectorAll(".roles-editor-panel").forEach(el =>
          el.dispatchEvent(new CustomEvent("roles-refresh")));
      } catch {}
      conn.messages = m.messages || {};
      if (m.user) {
        conn.me = m.user;
        if (m.user.inviteSlug) conn.inviteSlug = String(m.user.inviteSlug);
        if (m.user.inviteUrl && !/phlipapp\.com\/j\//i.test(String(m.user.inviteUrl))) {
          conn.inviteUrl = String(m.user.inviteUrl);
        } else if (conn.inviteSlug && typeof buildPersonalInviteUrl === "function") {
          conn.inviteUrl = buildPersonalInviteUrl(conn.inviteSlug, conn);
        }
      }
      conn.members = normalizeConnMembers(conn, m.members);
      conn.online = Array.isArray(m.online) ? m.online : (conn.me?.id ? [conn.me.id] : []);
      conn.pendingReqs = m.pending || [];
      conn.invite = m.invite || null;
      applyInviteShareFields(conn);
      applyShareReachFields(conn, m);
      conn.groupInvites = Array.isArray(m.groupInvites) ? m.groupInvites : [];
      conn.autoIncludeChannels = Array.isArray(m.autoIncludeChannels) ? m.autoIncludeChannels : [];
      conn.notifications = m.notifications || [];
      conn.reports = Array.isArray(m.reports) ? m.reports : (conn.reports || []);
      conn.blocked = Array.isArray(m.blocked) ? m.blocked : (conn.blocked || []);
      try { seedChannelReadCursors(conn); } catch {}
      try { seedEventSeenCursors(conn); } catch {}
      if (m.serverSettings) {
        conn.serverSettings = m.serverSettings;
        if (conn.id === S.activeConnId) applyCardTheme(conn.serverSettings.cardTheme);
      }
      if (m.iconText != null) conn.iconText = normalizeIconText(String(m.iconText));
      if ("serverPic" in m) {
        conn.serverPic = (typeof m.serverPic === "string" && m.serverPic) ? m.serverPic : "";
      }
      if (m.hostName) conn.hostName = m.hostName;
      if (m.inviteRedeemed) toast("You're in — groups updated");
      if (conn.id === S.activeConnId) {
        if (S.activeView?.kind === "channel" && !conn.channels.find(c => c.id === S.activeView.id)) Nav.landDefault(conn);
        if (S.activeView?.kind === "eventDetail" && !conn.events.find(e => e.id === S.activeView.id)) Nav.landDefault(conn);
        if (m.inviteRedeemed) {
          renderSidebar();
          renderView();
        }
      }
      (async () => {
        await decryptAll(conn);
        if (typeof applyRoutineCatalogToMatchingEvents === "function") {
          applyRoutineCatalogToMatchingEvents(conn);
        }
        reapplyOutboxOptimistic(conn);
        cacheConn(conn);
        persistServerIcon(conn);
        document.querySelector("#deck-rows")?.dispatchEvent(
          new CustomEvent("routines-refresh", { detail: { connId: conn.id } }));
        if (conn.id === S.activeConnId) renderAll();
        else if (S.activeConnId === "personal") { renderView(); renderSidebar(); renderRail(); }
        flushOutbox(conn);
        requestSliceSync(conn);
      })();
      break;
    }

    case "serverMeta": {
      if (m.iconText != null) conn.iconText = normalizeIconText(String(m.iconText));
      if (m.hostName) conn.hostName = m.hostName;
      if ("serverPic" in m) {
        conn.serverPic = (typeof m.serverPic === "string" && m.serverPic) ? m.serverPic : "";
      }
      persistServerIcon(conn);
      renderRail();
      if (conn.id === S.activeConnId) { renderNavIcon(); renderSidebar(); }
      break;
    }

    case "eventsDeleted": {
      conn.events = conn.events.filter(e => !m.eventIds.includes(e.id));
      if (conn.id === S.activeConnId && S.activeView?.kind === "eventDetail" && m.eventIds.includes(S.activeView.id)) {
        Nav.landDefault(conn);
      }
      try { cacheConn(conn); } catch {}
      if (affectsActiveView(conn, m.eventIds[0]) || S.viewingHistory) { renderView(); renderSidebar(); }
      break;
    }

    case "messageAck": {
      const message = Object.values(conn.messages || {}).flat().find(item => item.id === m.id);
      if (message) {
        message.syncStatus = m.accepted ? "synced" : "failed";
        if (!m.accepted) message.syncError = m.error || "Message rejected";
        cacheConn(conn);
        if (conn.id === S.activeConnId) renderView(true);
      }
      break;
    }

    case "message": {
      const storedMessage = reconcileAuthoritativeChatMessage(conn, m.message);
      if (!storedMessage) break;
      if (typeof hydratePlainMessage === "function") hydratePlainMessage(storedMessage);
      const viewing = conn.id === S.activeConnId
        && S.activeView?.kind === "channel"
        && S.activeView.id === m.message.channelId;
      const panelChat = conn.id === S.activeConnId
        && Panel.channelOpen()
        && Panel.channelState()?.tab === "chat"
        && Panel.channelState()?.channelId === m.message.channelId;
      if (viewing || panelChat) {
        try { markChannelRead(conn, m.message.channelId); } catch {}
      }
      // Decrypt the canonical stored object—not the transient wire payload.
      decMsg(storedMessage, conn.key).then(() => {
        try { cacheConn(conn); } catch {}
        if (viewing && !(typeof refreshActiveChatIncrementally === "function"
            && refreshActiveChatIncrementally(m.message.channelId))) renderView(true);
        else if (panelChat && typeof refreshActiveChatIncrementally === "function") {
          refreshActiveChatIncrementally(m.message.channelId);
        }
        if (m.message?.eventId && typeof refreshEventDetailChatSheet === "function") {
          refreshEventDetailChatSheet(m.message.eventId);
        }
        if (conn.id === S.activeConnId || S.activeConnId === "personal") {
          renderSidebar();
          try { syncChannelInfoBtn(); } catch {}
        }
      });
      break;
    }

    case "messageUpdated": {
      const msg = m.message;
      if (!msg?.id || !msg.channelId) break;
      const list = conn.messages[msg.channelId] || [];
      const i = list.findIndex(x => x.id === msg.id);
      let stored = msg;
      if (i >= 0) {
        // Edited text (editMessage) must be decrypted again, not kept stale.
        const textChanged = msg.text !== undefined && msg.text !== list[i].text;
        stored = list[i] = { ...list[i], ...msg };
        if (textChanged) delete stored._text;
      } else (conn.messages[msg.channelId] ||= []).push(msg);
      if (typeof applyReactionCardsIfPresent === "function") applyReactionCardsIfPresent(conn, m);
      try { cacheConn(conn); } catch {}
      decMsg(stored, conn.key).then(() => {
        if (conn.id === S.activeConnId && S.activeView?.kind === "channel"
            && S.activeView.id === msg.channelId
            && !(typeof refreshActiveChatIncrementally === "function"
              && refreshActiveChatIncrementally(msg.channelId))) renderView(true);
      });
      break;
    }

    case "messageDeleted": {
      const chId = m.channelId;
      const msgId = m.messageId;
      if (!chId || !msgId) break;
      const list = conn.messages[chId];
      if (list) conn.messages[chId] = list.filter(x => x.id !== msgId);
      try { cacheConn(conn); } catch {}
      if (conn.id === S.activeConnId && S.activeView?.kind === "channel" && S.activeView.id === chId) {
        if (!(typeof refreshActiveChatIncrementally === "function" && refreshActiveChatIncrementally(chId))) renderView(true);
      }
      break;
    }

    case "chatPurged": {
      const before = Number(m.beforeTs) || 0;
      if (!before) break;
      let changed = false;
      for (const chId of Object.keys(conn.messages || {})) {
        const list = conn.messages[chId] || [];
        const next = list.filter(x => (x.ts || 0) >= before);
        if (next.length !== list.length) {
          conn.messages[chId] = next;
          changed = true;
        }
        if (!next.length) delete conn.messages[chId];
      }
      if (Array.isArray(conn.notifications)) {
        const nBefore = conn.notifications.length;
        conn.notifications = conn.notifications.filter(n =>
          !(n.kind === "mentioned" && n.messageId && (n.ts || 0) < before));
        if (conn.notifications.length !== nBefore) changed = true;
      }
      if (changed) {
        try { cacheConn(conn); } catch {}
        if (conn.id === S.activeConnId && S.activeView?.kind === "channel") {
          const chId = S.activeView.id;
          if (!(typeof refreshActiveChatIncrementally === "function" && refreshActiveChatIncrementally(chId))) renderView(true);
        }
      }
      break;
    }

    case "taskCreated":
    case "taskUpdated": {
      const wasOptimistic = !!(conn.tasks || []).find(item => item.id === m.task?.id)?._taskOptimistic;
      const task = reconcileAuthoritativeTask(conn, m.task);
      if (!task) break;
      const acknowledged = !!window.TaskChannelUI?.ack?.(conn, task.id, m.actionId || "");
      try { cacheConn(conn); } catch {}
      const viewing = conn.id === S.activeConnId
        && S.activeView?.kind === "channel"
        && S.activeView.id === task.channelId;
      const personal = typeof PersonalSpace !== "undefined" && PersonalSpace.isPersonal(conn);
      (async () => {
        if (conn.key && typeof decTask === "function") await decTask(task, conn.key);
        else if (typeof hydratePlainTask === "function") hydratePlainTask(task);
        // Personal and acknowledged mutations already own their row choreography.
        if (viewing && !personal && !wasOptimistic && !acknowledged) renderView();
        if (conn.id === S.activeConnId || S.activeConnId === "personal") renderSidebar();
        document.dispatchEvent(new CustomEvent("tasks-refresh", {
          detail: { connId: conn.id, channelId: task.channelId, taskId: task.id },
        }));
      })();
      break;
    }

    case "taskMutationFailed": {
      const taskId = String(m.taskId || m.id || "");
      if (!taskId) break;
      window.TaskChannelUI?.fail?.(conn, taskId, m.error || "Couldn’t save", m.actionId || "");
      break;
    }

    case "pollCreated":
    case "pollUpdated": {
      window.PollsUI?.ack?.(m.actionId || "");
      const poll = reconcileAuthoritativePoll(conn, m.poll);
      if (!poll) break;
      try { cacheConn(conn); } catch {}
      (async () => {
        if (conn.key && typeof decPoll === "function") await decPoll(poll, conn.key);
        else if (typeof hydratePlainPoll === "function") hydratePlainPoll(poll);
        if (typeof paintPolls === "function") paintPolls(conn);
      })();
      break;
    }

    case "pollMutationFailed": {
      window.PollsUI?.fail?.(conn, m);
      break;
    }

    case "taskDeleted": {
      const taskId = String(m.taskId || "");
      if (!taskId) break;
      const removed = (conn.tasks || []).find(task => task.id === taskId);
      conn.tasks = (conn.tasks || []).filter(task => task.id !== taskId);
      window.TaskChannelUI?.ack?.(conn, taskId, m.actionId || "");
      try { cacheConn(conn); } catch {}
      const channelId = removed?.channelId || m.channelId || "";
      if (conn.id === S.activeConnId
          && S.activeView?.kind === "channel" && S.activeView.id === channelId) {
        renderView();
      }
      if (conn.id === S.activeConnId || S.activeConnId === "personal") renderSidebar();
      document.dispatchEvent(new CustomEvent("tasks-refresh", {
        detail: { connId: conn.id, channelId, taskId },
      }));
      break;
    }

    case "eventCreated": {
      const existing = conn.events.find(e => e.id === m.event.id);
      if (existing) {
        // Merge server copy over an optimistic offline create (same client id).
        const pending = existing._pending;
        Object.assign(existing, m.event);
        if (pending && (conn.outbox || []).some(e => outboxEventId(e) === m.event.id)) {
          existing._pending = true;
        } else {
          existing._pending = false;
        }
        m.event = existing;
      } else {
        conn.events.push(m.event);
        if (m.event.createdBy === conn.me?.id && !m.event.chainOf) {
          try { CardFeel.eventCreatedOnce(m.event); } catch {}
        }
      }
      if (typeof boardOnEventCreated === "function") boardOnEventCreated(conn, m.event);
      // Centre the timeline on the event we just posted (not on chain follow-ons
      // that ride along afterwards).
      if (m.event.createdBy === conn.me?.id && !m.event.chainOf
          && S.pendingFocusNewEvent
          && (conn.id === S.activeConnId || S.activeConnId === "personal")) {
        S.pendingFocusNewEvent = true;
        // Make sure the viewed period includes the new event (week/month/day).
        S.anchor = dayStart(m.event.when);
        S.viewingHistory = false;
        if (S.activeView?.kind === "eventDetail") {
          Nav.landDefault();
        }
      }
      const paint = () => {
        cacheConn(conn);
        if (affectsActiveView(conn, m.event.id) && shouldRefreshEventUI(m.event.id)) renderView();
        if (conn.id === S.activeConnId || S.activeConnId === "personal") renderSidebar();
      };
      // Paint immediately so the new ticket exists for focus settle / peer
      // devices — don't wait on decrypt (title shows as … briefly, then refreshes).
      if (affectsActiveView(conn, m.event.id) && shouldRefreshEventUI(m.event.id)) paint();
      decEvent(m.event, conn.key).then(paint);
      if (S.pendingPassImport && S.pendingPassImport.id === m.event.id) {
        const p = S.pendingPassImport;
        S.pendingPassImport = null;
        m.event.passRevision = p.passRevision;
        m.event.passCreatorName = p.passCreatorName;
        if (p.passCreatorName) m.event.createdByName = p.passCreatorName;
        toast("Added from pass");
      }
      if (typeof applyReactionCardsIfPresent === "function") applyReactionCardsIfPresent(conn, m);
      break;
    }
    case "eventCardStyleUpdated": {
      const ev = conn.events.find(e => e.id === m.eventId);
      if (!ev || !m.eventCardStyle) break;
      ev.eventCardStyle = m.eventCardStyle;
      try { if (typeof purgeCardImageCache === "function") purgeCardImageCache(); } catch {}
      cacheConn(conn);
      if (affectsActiveView(conn, m.eventId) && shouldRefreshEventUI(m.eventId)) {
        renderView();
      }
      break;
    }

    case "edgeKvStats": {
      if (m.kv && typeof m.kv === "object") {
        S.edgeKv = { ...m.kv, at: Date.now() };
        // Patch the meter only — full renderView re-pushes the share and burns KV.
        const el = document.getElementById("edge-kv-meter");
        if (el && typeof edgeKvMeterHTML === "function") {
          const tmp = document.createElement("div");
          tmp.innerHTML = edgeKvMeterHTML();
          const next = tmp.firstElementChild;
          if (next) el.replaceWith(next);
        }
      }
      break;
    }

    case "edgeShareError": {
      const err = (m.error || "").trim();
      if (err) toast(err);
      break;
    }

    case "rsvpUpdated": {
      const ev = conn.events.find(e => e.id === m.eventId);
      if (ev) {
        if (m.removed || m.status == null || m.status === "") {
          delete ev.rsvps[m.userId];
          if (ev.addedBy) delete ev.addedBy[m.userId];
          if (Array.isArray(ev.signupGroups)) {
            ev.signupGroups.forEach((g) => {
              g.memberIds = (g.memberIds || []).filter((id) => id !== m.userId);
            });
          }
        } else {
          ev.rsvps[m.userId] = m.status;
          if (m.addedBy) (ev.addedBy ||= {})[m.userId] = m.addedBy;
          else if (ev.addedBy) delete ev.addedBy[m.userId];
          if (m.status === "out" && Array.isArray(ev.signupGroups)) {
            ev.signupGroups.forEach((g) => {
              g.memberIds = (g.memberIds || []).filter((id) => id !== m.userId);
            });
          }
        }
        // Spring stub when this device's RSVP settles (026).
        try {
          const me = conn.me?.id;
          if (me && m.userId === me) {
            const row = document.querySelector(`#ticket-list .ticket[data-id="${CSS.escape(ev.id)}"]`);
            if (row && typeof applyTicketResponseClass === "function") {
              const status = (m.removed || m.status == null || m.status === "") ? null : m.status;
              applyTicketResponseClass(row, status);
            }
          }
        } catch {}
      }
      cacheConn(conn);
      if (ev && typeof refreshEventAttendanceUI === "function") refreshEventAttendanceUI(ev);
      if (affectsActiveView(conn, m.eventId) && shouldRefreshEventUI(m.eventId)) renderView();
      break;
    }

    case "eventConfirmAttendanceUpdated": {
      const ev = conn.events.find(e => e.id === m.eventId);
      if (ev) {
        ev.confirmAttendance = !!m.confirmAttendance;
        if (m.rsvps && typeof m.rsvps === "object" && !Array.isArray(m.rsvps)) {
          ev.rsvps = { ...m.rsvps };
        } else if (typeof applyConfirmAttendanceRsvps === "function") {
          applyConfirmAttendanceRsvps(ev, !!m.confirmAttendance);
        }
      }
      cacheConn(conn);
      if (ev && typeof refreshEventAttendanceUI === "function") refreshEventAttendanceUI(ev);
      if (affectsActiveView(conn, m.eventId) && shouldRefreshEventUI(m.eventId)) renderView();
      break;
    }

    case "eventSignupGroupsUpdated": {
      const ev = conn.events.find(e => e.id === m.eventId);
      if (ev) ev.signupGroups = Array.isArray(m.signupGroups) ? m.signupGroups : [];
      cacheConn(conn);
      if (ev && typeof refreshEventAttendanceUI === "function") refreshEventAttendanceUI(ev);
      if (affectsActiveView(conn, m.eventId) && shouldRefreshEventUI(m.eventId)) renderView();
      break;
    }

    // Broadcast / WhatsApp guest RSVP (label map on the event — not a member id).
    case "bridgeRsvpUpdated": {
      const ev = conn.events.find(e => e.id === m.eventId);
      if (ev && m.guest) {
        if (m.removed || m.status == null || m.status === "") {
          if (ev.bridgeGuests) {
            delete ev.bridgeGuests[m.guest];
            if (!Object.keys(ev.bridgeGuests).length) ev.bridgeGuests = {};
          }
        } else {
          ev.bridgeGuests = { ...(ev.bridgeGuests || {}), [m.guest]: m.status };
        }
        if (m.hostPlusN != null) ev.bridgeHostPlusN = m.hostPlusN | 0;
      }
      cacheConn(conn);
      if (affectsActiveView(conn, m.eventId) && shouldRefreshEventUI(m.eventId)) renderView();
      break;
    }

    case "bridgeHostPlusN": {
      const ev = conn.events.find(e => e.id === m.eventId);
      if (ev && m.hostPlusN != null) ev.bridgeHostPlusN = m.hostPlusN | 0;
      cacheConn(conn);
      if (affectsActiveView(conn, m.eventId) && shouldRefreshEventUI(m.eventId)) renderView();
      break;
    }

    case "eventTimeUpdated": {
      const ev = conn.events.find(e => e.id === m.eventId);
      if (ev) { ev.when = m.when ?? ev.when; ev.whenPrecision = m.whenPrecision; ev.whenPeriod = m.whenPeriod; }
      cacheConn(conn);
      if (affectsActiveView(conn, m.eventId) && shouldRefreshEventUI(m.eventId)) renderView();
      break;
    }

    case "eventSuggestionsUpdated": {
      const ev = conn.events.find(e => e.id === m.eventId);
      if (ev) {
        ev.suggestions = Array.isArray(m.suggestions) ? m.suggestions : [];
        if (!ev.suggestions.length) ev.suggestions = null;
      }
      cacheConn(conn);
      if (!(affectsActiveView(conn, m.eventId) && shouldRefreshEventUI(m.eventId))) break;
      renderView();
      break;
    }

    case "eventChainUpdated": {
      const ev = conn.events.find(e => e.id === m.eventId);
      if (ev) {
        if ("chainMode" in m) ev.chainMode = m.chainMode || null;
        if ("chainStatus" in m) ev.chainStatus = m.chainStatus || null;
        if ("chainDepWarnWhen" in m) {
          ev.chainDepWarnWhen = m.chainDepWarnWhen == null ? null : Number(m.chainDepWarnWhen);
        }
        // Allow clearing chainOf (realize / detach) — previously only set when non-null.
        if ("chainOf" in m) ev.chainOf = m.chainOf || null;
      }
      cacheConn(conn);
      if (affectsActiveView(conn, m.eventId) && shouldRefreshEventUI(m.eventId)) {
        renderView();
      }
      break;
    }

    case "eventWhereUpdated": {
      const ev = conn.events.find(e => e.id === m.eventId);
      if (ev) ev.where = m.where || "";
      if (ev && m.locationLabelId != null) {
        ev.locationLabelId = String(m.locationLabelId).trim() || null;
      }
      cacheConn(conn);
      (async () => {
        if (ev) ev._where = ev.where ? await decrypt(ev.where, conn.key) : "";
        if (ev && m.locationLabelId == null && typeof curatedLocationLabelId === "function") {
          ev.locationLabelId = curatedLocationLabelId(ev._where, conn) || null;
        }
        if (affectsActiveView(conn, m.eventId) && shouldRefreshEventUI(m.eventId)) {
          renderView();
        }
      })();
      break;
    }

    case "eventDetailsUpdated": {
      const ev = conn.events.find(e => e.id === m.eventId);
      if (ev) ev.details = m.details || "";
      cacheConn(conn);
      (async () => {
        if (ev) ev._details = ev.details ? await decrypt(ev.details, conn.key) : "";
        if (typeof refreshPanelEventFeed === "function") {
          try { refreshPanelEventFeed(m.eventId); } catch {}
        }
        if (affectsActiveView(conn, m.eventId) && shouldRefreshEventUI(m.eventId)) {
          renderView();
        }
      })();
      break;
    }

    case "eventSubtitleUpdated": {
      const ev = conn.events.find(e => e.id === m.eventId);
      if (ev) ev.subtitle = m.subtitle || "";
      cacheConn(conn);
      (async () => {
        if (ev) ev._subtitle = ev.subtitle ? await decrypt(ev.subtitle, conn.key) : "";
        if (affectsActiveView(conn, m.eventId) && shouldRefreshEventUI(m.eventId)) {
          renderView();
        }
      })();
      break;
    }

    case "eventStickerUpdated": {
      const ev = conn.events.find(e => e.id === m.eventId);
      if (ev) {
        ev.sticker = m.sticker || "";
        ev.stickerBy = m.stickerBy || null;
        ev.stickerByName = m.stickerByName || null;
      }
      // Shared sticker supersedes any personal device note for this event.
      if (m.eventId && m.sticker && typeof clearLocalSticker === "function") {
        clearLocalSticker(m.eventId);
      }
      cacheConn(conn);
      (async () => {
        if (ev) ev._sticker = ev.sticker ? await decrypt(ev.sticker, conn.key) : "";
        if (affectsActiveView(conn, m.eventId) && shouldRefreshEventUI(m.eventId)) {
          renderView();
        }
      })();
      break;
    }

    case "eventDurationUpdated": {
      const ev = conn.events.find(e => e.id === m.eventId);
      if (ev) ev.duration = m.duration || null;
      cacheConn(conn);
      if (affectsActiveView(conn, m.eventId) && shouldRefreshEventUI(m.eventId)) {
        renderView();
      }
      break;
    }

    case "eventApprovalUpdated": {
      const ev = conn.events.find(e => e.id === m.eventId);
      if (ev) {
        if (m.approvalStatus == null) {
          delete ev.approvalStatus;
          delete ev.approvalNote;
          delete ev.approvalAltSuggestion;
        } else {
          ev.approvalStatus = m.approvalStatus;
          ev.approvalNote = m.approvalNote ?? null;
          ev.approvalAltSuggestion = m.approvalAltSuggestion ?? null;
        }
        // Patch the visible ticket immediately — same pattern as rsvpUpdated (026).
        try {
          const row = document.querySelector(`#ticket-list .ticket[data-id="${CSS.escape(ev.id)}"]`);
          if (row && typeof applyTicketResponseClass === "function") {
            const me = typeof myIdOf === "function" ? myIdOf(ev) : conn.me?.id;
            applyTicketResponseClass(row, ev.rsvps?.[me]);
            row.classList.toggle("ticket-needs-approval", ev.approvalStatus === "pending");
            row.classList.toggle("unanswered", ev.approvalStatus !== "pending"
              && !ev.rsvps?.[me] && typeof isEventOrganiser === "function" && !isEventOrganiser(ev));
          }
        } catch {}
      }
      cacheConn(conn);
      const onScreen = ev && (
        affectsActiveView(conn, m.eventId)
        || shouldRefreshEventUI(m.eventId)
        || (S.activeConnId === "personal" && typeof collatedEvents === "function"
          && collatedEvents().some(e => e.id === m.eventId))
      );
      if (onScreen) {
        renderView();
      }
      if (conn.id === S.activeConnId || S.activeConnId === "personal") renderSidebar();
      break;
    }

    case "eventIconUpdated": {
      const ev = conn.events.find(e => e.id === m.eventId);
      if (ev) ev.icon = m.icon || null;
      if (typeof applyReactionCardsIfPresent === "function") applyReactionCardsIfPresent(conn, m);
      cacheConn(conn);
      if (affectsActiveView(conn, m.eventId) && shouldRefreshEventUI(m.eventId)) {
        renderView();
      }
      break;
    }

    case "eventTypeUpdated": {
      const ev = conn.events.find(e => e.id === m.eventId);
      if (ev) {
        if (m.title != null) ev.title = m.title;
        if ("shortName" in m) { ev.shortName = m.shortName || ""; delete ev._shortName; }
        if ("typeId" in m) ev.typeId = m.typeId || null;
        if ("icon" in m) ev.icon = m.icon || null;
        if ("cat" in m) ev.cat = m.cat || null;
      }
      if (typeof applyReactionCardsIfPresent === "function") applyReactionCardsIfPresent(conn, m);
      cacheConn(conn);
      (async () => {
        if (ev && m.title) ev._title = await decrypt(ev.title, conn.key);
        if (ev && "shortName" in m) ev._shortName = ev.shortName ? await decrypt(ev.shortName, conn.key) : "";
        if (affectsActiveView(conn, m.eventId) && shouldRefreshEventUI(m.eventId)) {
          renderView();
        }
      })();
      break;
    }

    case "cardCatsUpdated": {
      if (m.cardCats && typeof m.cardCats === "object") {
        conn.cardCats = { ...(conn.cardCats || {}), ...m.cardCats };
        cacheConn(conn);
        if (conn.id === S.activeConnId || S.activeConnId === "personal") renderView();
      }
      break;
    }

    case "notification": {
      conn.notifications.push(m.notification);
      renderSidebar();
      if (conn.id === S.activeConnId || S.activeConnId === "personal") {
        if (S.activeView?.kind === "notifications") renderView();
        try { if (typeof refreshChannelPanelMetaTabs === "function") refreshChannelPanelMetaTabs(); } catch {}
      }
      break;
    }

    case "eventDeleted": {
      conn.events = conn.events.filter(e => e.id !== m.eventId);
      if (viewingEvent(m.eventId)) Nav.landDefault();
      // Deleting a chain link while on the primary detail should refresh in place.
      else if (S.activeView?.kind === "eventDetail") {
        const still = conn.events.find(e => e.id === S.activeView.id)
          || (S.activeConnId === "personal" && (board()?.events || []).find(e => e.id === S.activeView.id));
        if (!still) Nav.landDefault();
      }
      cacheConn(conn);
      if (affectsActiveView(conn, m.eventId) || S.activeView?.kind === "eventDetail" || S.viewingHistory) { renderView(); renderSidebar(); }
      break;
    }

    case "availabilityCreated": {
      if (!m.availability?.id) break;
      if (!conn.availabilities) conn.availabilities = [];
      const i = conn.availabilities.findIndex(a => a.id === m.availability.id);
      if (i >= 0) conn.availabilities[i] = m.availability;
      else conn.availabilities.push(m.availability);
      const avail = conn.availabilities.find(a => a.id === m.availability.id);
      cacheConn(conn);
      (async () => {
        if (avail && conn.key && typeof decAvailability === "function") {
          await decAvailability(avail, conn.key);
        } else if (avail && typeof hydratePlainAvailability === "function") {
          hydratePlainAvailability(avail);
        }
        if (conn.id === S.activeConnId) { renderView(); renderSidebar(); }
      })();
      break;
    }

    case "availabilityUpdated": {
      if (!m.availability?.id || !conn.availabilities) break;
      const i = conn.availabilities.findIndex(a => a.id === m.availability.id);
      if (i >= 0) conn.availabilities[i] = m.availability;
      else conn.availabilities.push(m.availability);
      const avail = conn.availabilities.find(a => a.id === m.availability.id);
      cacheConn(conn);
      (async () => {
        if (avail && conn.key && typeof decAvailability === "function") {
          await decAvailability(avail, conn.key);
        } else if (avail && typeof hydratePlainAvailability === "function") {
          hydratePlainAvailability(avail);
        }
        if (conn.id === S.activeConnId) { renderView(); renderSidebar(); }
      })();
      break;
    }

    case "availabilityDeleted": {
      if (!m.availabilityId || !conn.availabilities) break;
      conn.availabilities = conn.availabilities.filter(a => a.id !== m.availabilityId);
      cacheConn(conn);
      if (conn.id === S.activeConnId) { renderView(); renderSidebar(); }
      break;
    }

    case "availabilitySignal": {
      if (!m.availabilityId || !conn.availabilities) break;
      const avail = conn.availabilities.find(a => a.id === m.availabilityId);
      if (avail) avail.signals = Array.isArray(m.signals) ? m.signals : [];
      cacheConn(conn);
      if (conn.id === S.activeConnId) { renderView(); renderSidebar(); }
      break;
    }

    case "timeBlockCreated": {
      if (!m.timeBlock?.id) break;
      if (!conn.timeBlocks) conn.timeBlocks = [];
      const i = conn.timeBlocks.findIndex(b => b.id === m.timeBlock.id);
      if (i >= 0) conn.timeBlocks[i] = m.timeBlock;
      else conn.timeBlocks.push(m.timeBlock);
      const block = conn.timeBlocks.find(b => b.id === m.timeBlock.id);
      cacheConn(conn);
      (async () => {
        if (block && conn.key && typeof decTimeBlock === "function") {
          await decTimeBlock(block, conn.key);
        } else if (block && typeof hydratePlainTimeBlock === "function") {
          hydratePlainTimeBlock(block);
        }
        if (conn.id === S.activeConnId) { renderView(); renderSidebar(); }
      })();
      break;
    }

    case "timeBlockUpdated": {
      if (!m.timeBlock?.id || !conn.timeBlocks) break;
      const i = conn.timeBlocks.findIndex(b => b.id === m.timeBlock.id);
      if (i >= 0) conn.timeBlocks[i] = m.timeBlock;
      else conn.timeBlocks.push(m.timeBlock);
      const block = conn.timeBlocks.find(b => b.id === m.timeBlock.id);
      cacheConn(conn);
      (async () => {
        if (block && conn.key && typeof decTimeBlock === "function") {
          await decTimeBlock(block, conn.key);
        } else if (block && typeof hydratePlainTimeBlock === "function") {
          hydratePlainTimeBlock(block);
        }
        if (conn.id === S.activeConnId) { renderView(); renderSidebar(); }
      })();
      break;
    }

    case "timeBlockDeleted": {
      if (!m.timeBlockId || !conn.timeBlocks) break;
      conn.timeBlocks = conn.timeBlocks.filter(b => b.id !== m.timeBlockId);
      cacheConn(conn);
      if (conn.id === S.activeConnId) { renderView(); renderSidebar(); }
      break;
    }

    case "timeBlockSignup": {
      if (!m.timeBlockId || !conn.timeBlocks) break;
      const block = conn.timeBlocks.find(b => b.id === m.timeBlockId);
      if (block) block.signups = Array.isArray(m.signups) ? m.signups : [];
      cacheConn(conn);
      if (conn.id === S.activeConnId) { renderView(); renderSidebar(); }
      break;
    }

    case "reactionUpdated": {
      const ev = conn.events.find(e => e.id === m.eventId);
      if (ev) {
        if (m.reactionStacks) ev.reactionStacks = m.reactionStacks;
        ev.reactions = m.reactions;
        if (typeof syncEventReactionSummary === "function" && m.reactionStacks) {
          syncEventReactionSummary(ev);
        }
      }
      if (Array.isArray(m.reactionCards)) {
        if (typeof applyReactionCardsCatalog === "function") applyReactionCardsCatalog(conn, m.reactionCards);
        else conn.reactionCards = m.reactionCards;
      }
      cacheConn(conn);
      if (affectsActiveView(conn, m.eventId) && shouldRefreshEventUI(m.eventId)) {
        renderView();
      }
      break;
    }


    case "eventNoteAdded": {
      const ev = conn.events.find(e => e.id === m.eventId);
      if (!ev) break;
      const notes = ev.notes ||= [];
      if (m.note?.id && notes.some(n => n.id === m.note.id)) {
        // Idempotent replay of an offline-queued note.
        break;
      }
      notes.push(m.note);
      (async () => {
        if (typeof decEventNoteText === "function") {
          await decEventNoteText(m.note, conn.key, conn.me?.id);
        } else {
          m.note._text = await decrypt(m.note.text, conn.key);
        }
        if (m.note.linkedEventTitle)
          m.note._linkedEventTitle = await decrypt(m.note.linkedEventTitle, conn.key);
        cacheConn(conn);
        // 014 — detail open ⇒ already seen; otherwise refresh so the row dot paints.
        const detailOpen = typeof viewingEvent === "function" && viewingEvent(m.eventId);
        if (detailOpen && typeof markEventSeen === "function") {
          try { markEventSeen(conn, ev); } catch {}
        }
        const paint = affectsActiveView(conn, m.eventId) && shouldRefreshEventUI(m.eventId);
        const ech = conn.channels.find(c => c.id === ev.channelId);
        const chatOpen = conn.id === S.activeConnId && S.activeView?.kind === "channel"
          && ech?.linkedChatChannelId && S.activeView.id === ech.linkedChatChannelId;
        const meId = conn.me?.id;
        const marksUnread = typeof noteMarksEventUnread === "function"
          ? noteMarksEventUnread(m.note, meId)
          : !!(m.note && !m.note.activity && m.note.noteKind !== "personal");
        // Prefer refreshing the open panel event feed over a full remount
        // so the composer stays up after sending a note.
        const panelFeedOpen = typeof panelEventFeedHost === "function" && !!panelEventFeedHost()
          && S.chatFilterEventId === m.eventId;
        if (panelFeedOpen && typeof refreshPanelEventFeed === "function") {
          refreshPanelEventFeed(m.eventId);
        } else if (typeof refreshEventDetailChatSheet === "function"
            && document.querySelector(`.event-detail-chat-sheet[data-event-id="${CSS.escape(m.eventId)}"]`)) {
          refreshEventDetailChatSheet(m.eventId);
        } else {
          if (paint || chatOpen) {
            renderView(chatOpen);
          } else if (marksUnread && !detailOpen && affectsActiveView(conn, m.eventId)) {
            renderView();
          }
          if (typeof refreshEventDetailChatSheet === "function") {
            refreshEventDetailChatSheet(m.eventId);
          }
        }
      })();
      break;
    }

    case "eventNoteUpdated": {
      const ev = conn.events.find(e => e.id === m.eventId);
      if (!ev || !m.note) break;
      const notes = ev.notes ||= [];
      const idx = notes.findIndex(n =>
        (m.note.id && n.id === m.note.id)
        || (n.userId === m.note.userId && n.ts === m.note.ts && !n.activity));
      if (idx >= 0) notes[idx] = { ...notes[idx], ...m.note };
      else notes.push(m.note);
      (async () => {
        const note = idx >= 0 ? notes[idx] : m.note;
        if (typeof decEventNoteText === "function") {
          await decEventNoteText(note, conn.key, conn.me?.id);
        } else {
          note._text = await decrypt(note.text, conn.key);
        }
        cacheConn(conn);
        if (typeof refreshEventDetailChatSheet === "function") {
          try { refreshEventDetailChatSheet(m.eventId); } catch {}
        }
        if (affectsActiveView(conn, m.eventId) && shouldRefreshEventUI(m.eventId)) renderView();
      })();
      break;
    }

    case "eventNoteDeleted": {
      const ev = conn.events.find(e => e.id === m.eventId);
      if (!ev || !ev.notes) break;
      const before = ev.notes.length;
      ev.notes = ev.notes.filter(n => {
        if (m.noteId && n.id) return n.id !== m.noteId;
        if (m.noteUserId != null && m.noteTs != null) {
          return !(n.userId === m.noteUserId && n.ts === m.noteTs && !n.activity);
        }
        return true;
      });
      if (!ev.notes.length) ev.notes = null;
      if ((ev.notes?.length || 0) === before) break;
      try { cacheConn(conn); } catch {}
      const paint = affectsActiveView(conn, m.eventId) && shouldRefreshEventUI(m.eventId);
      const ech = conn.channels.find(c => c.id === ev.channelId);
      const chatOpen = conn.id === S.activeConnId && S.activeView?.kind === "channel"
        && ech?.linkedChatChannelId && S.activeView.id === ech.linkedChatChannelId;
      if (paint || chatOpen) renderView(chatOpen);
      if (typeof refreshEventDetailChatSheet === "function") {
        refreshEventDetailChatSheet(m.eventId);
      }
      break;
    }

  }
}
