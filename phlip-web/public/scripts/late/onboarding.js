/* Optional first-run help. The example never enters event, RSVP or alarm storage. */
(() => {
  "use strict";
  const KEY = "phlip_onboarding_v2";
  const listeners = Object.create(null);
  let pendingInvite = "", retireTimer = null, syncing = false;
  const bus = window.OnboardingBus = {
    on(type, fn) { (listeners[type] ||= new Set()).add(fn); return () => bus.off(type, fn); },
    off(type, fn) { listeners[type]?.delete(fn); },
    emit(type, detail) { for (const fn of listeners[type] || []) { try { fn(detail || {}); } catch (e) { console.warn("onboarding", e); } } },
  };
  function enabled() {
    return !(typeof isServedOrigin === "function" && isServedOrigin())
      && !(typeof isDemoMode === "function" && isDemoMode());
  }
  function read() { try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); return s?.version === 2 && s.done && typeof s.done === "object" ? s : null; } catch { return null; } }
  function write(state) { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }
  function fresh() { return { version: 2, done: {}, collapsed: false, dismissed: false, sample: true }; }
  function personal() { return typeof S !== "undefined" && S.activeConnId === "personal"; }
  function title() { const name = String(loadMe()?.name || "").trim(); return name && name !== "Me" ? name + "’s first event" : "Your first event"; }
  function unlockChrome() {
    const d = document.documentElement.dataset;
    delete d.obFtue; d.obStage = "all";
    for (const key of ["Chat", "Memories", "Cal", "RsvpFilter", "Decks", "Join", "HostSettings", "TimelineChrome"]) d["obShow" + key] = "1";
  }
  function hasInvite() {
    if (pendingInvite || (typeof S !== "undefined" && S.pendingInviteLink)) return true;
    const url = new URL(location.href), hash = new URLSearchParams(url.hash.slice(1));
    return url.pathname.includes("/j/") || ["slug", "event", "invite"].some(k => url.searchParams.has(k)) || ["c", "t", "slug"].some(k => hash.has(k));
  }
  function prepare(name) {
    // Persist identity before the animation, so process death cannot lose the name.
    if (name) saveMe({ name });
    if (enabled() && !read()) { const state = fresh(); state.sample = !hasInvite(); write(state); }
    localStorage.setItem("ash_me_named", "1");
    unlockChrome();
    try { renderAll(); } catch {}
    sync();
  }
  function complete(task) {
    const state = read();
    if (!enabled() || !state || state.done[task]) return;
    state.done[task] = true;
    if (task === "plan") state.sample = false;
    write(state); sync();
  }
  function reconcile(state) {
    const conn = typeof S !== "undefined" ? S.conns?.personal : null;
    if (conn?.events?.some(e => !e.deleted && e.createdBy === conn.me?.id && !e.passImportedAt)) { state.done.plan = true; state.sample = false; }
    const joined = typeof S !== "undefined" && Object.values(S.conns || {}).some(c => c.id !== "personal" && c.me?.id && (c.token || c.me.isHost));
    const hosted = typeof readHostStatus === "function" && readHostStatus()?.servers?.length > 0;
    if (joined || hosted) state.done.group = true;
  }
  function button(parent, text, action, className = "") {
    const b = document.createElement("button"); b.type = "button"; b.textContent = text; b.className = className;
    b.onclick = e => { e.preventDefault(); e.stopPropagation(); action(); }; parent.appendChild(b); return b;
  }
  function makePlan() {
    if (typeof createDraftPending === "function" && createDraftPending()) { closeNav(); return; }
    if (!personal()) switchConn("personal");
    S.activeEventChannelId = personalMyPlansId();
    Nav.set({ kind: "channel", id: personalMyPlansId() }); closeNav(); renderAll();
    openCreateDraft({ title: read()?.sample ? title() : "" }); sync();
  }
  function groupChoice() {
    const opened = AshModal.open({ className: "onboarding-group-modal", trapFocus: true, restoreFocus: true,
      html: '<section class="ob-group-choice" role="dialog" aria-modal="true" aria-labelledby="ob-group-title"><h2 id="ob-group-title">Join or create a group</h2><p>You can do both, whenever you like.</p><div id="ob-group-actions"></div></section>' });
    if (!opened) return;
    const actions = opened.overlay.querySelector("#ob-group-actions");
    button(actions, "Join a group", () => { opened.close(); closeNav(); openJoinModal(); });
    if (typeof hostingAvailable === "function" && hostingAvailable()) button(actions, "Create a group from templates", () => { opened.close(); closeNav(); openAddServerMenu(); });
    button(actions, "Not now", () => opened.close(), "ob-text-button");
  }
  function paintChecklist(conn) {
    let el = document.getElementById("ob-checklist");
    const state = read();
    if (!enabled() || !state || state.dismissed || conn?.id !== "personal") { el?.remove(); return; }
    const panel = document.getElementById("side-user-panel");
    if (!panel) return;
    if (!el) { el = document.createElement("section"); el.id = "ob-checklist"; panel.before(el); }
    const count = ["plan", "group", "profile"].filter(k => state.done[k]).length;
    const signature = JSON.stringify([state.done, state.collapsed]);
    if (el.dataset.signature === signature) return;
    el.dataset.signature = signature; el.replaceChildren();
    const toggle = button(el, count === 3 ? "All set ✓" : "Getting started · " + count + "/3", () => {
      const next = read(); next.collapsed = !next.collapsed; write(next); sync();
    }, "ob-checklist-toggle");
    toggle.setAttribute("aria-expanded", String(!state.collapsed)); toggle.setAttribute("aria-controls", "ob-checklist-items");
    const list = document.createElement("div"); list.id = "ob-checklist-items"; list.hidden = state.collapsed; el.appendChild(list);
    for (const [key, label, action] of [["plan", "Make your first plan", makePlan], ["group", "Join or create a group", groupChoice], ["profile", "Make it yours", () => { closeNav(); openUserProfileOverlay({ pane: "edit" }); }]]) {
      const row = button(list, (state.done[key] ? "✓ " : "○ ") + label, action, "ob-checklist-task");
      row.disabled = !!state.done[key]; row.setAttribute("aria-label", label + (state.done[key] ? ", completed" : ""));
    }
    button(list, "Dismiss checklist", dismiss, "ob-text-button");
    if (count === 3 && !state.finishedAt && !state.reviewing) {
      state.finishedAt = Date.now(); write(state); retireTimer = setTimeout(dismiss, 5000);
    }
  }
  function dismiss() {
    clearTimeout(retireTimer);
    const state = read(); if (!state) return;
    state.dismissed = true; write(state); sync();
  }
  function reopen() {
    clearTimeout(retireTimer);
    const state = read() || { ...fresh(), sample: false };
    state.dismissed = false; state.collapsed = false;
    // Completed checklists stay open for review until explicitly dismissed.
    if (state.finishedAt) { state.finishedAt = null; state.reviewing = true; }
    write(state);
    closeUserProfileOverlay(); if (!personal()) switchConn("personal");
    S.activeEventChannelId = personalMyPlansId();
    Nav.set({ kind: "channel", id: personalMyPlansId() }); renderAll(); openNav(); sync();
  }
  function paintSample() {
    const state = read();
    let el = document.getElementById("ob-first-event");
    const head = document.querySelector(".timeline-view-mode .tl-sticky-head");
    const channelId = S.activeView?.kind === "channel" ? S.activeView.id : S.activeEventChannelId;
    if (!enabled() || !state?.sample || !personal() || (channelId && channelId !== personalMyPlansId()) || !head || hasInvite() || (typeof createDraftPending === "function" && createDraftPending())) { el?.remove(); return; }
    if (!el) {
      el = document.createElement("article"); el.id = "ob-first-event"; el.className = "ob-first-event";
      const meta = document.createElement("small"); meta.textContent = "Only you · Example draft"; el.appendChild(meta);
      const heading = document.createElement("h3"); heading.id = "ob-example-title"; el.appendChild(heading);
      const copy = document.createElement("p"); copy.textContent = "Make this your first plan."; el.appendChild(copy);
      const actions = document.createElement("div"); el.appendChild(actions);
      button(actions, "Make it mine", makePlan, "ob-primary");
      button(actions, "Remove example", () => { const next = read(); next.sample = false; write(next); sync(); }, "ob-text-button");
      head.after(el);
    }
    el.querySelector("h3").textContent = title();
  }
  function sync() {
    if (syncing || !enabled()) return;
    syncing = true;
    try {
      const state = read();
      if (state) { reconcile(state); if (state.finishedAt && !state.reviewing && Date.now() - state.finishedAt > 5000) state.dismissed = true; write(state); }
      paintSample(); paintChecklist(typeof activeConn === "function" ? activeConn() : null);
    } finally { syncing = false; }
  }
  function queueInvite(raw) {
    if (!enabled()) return false;
    if (localStorage.getItem("ash_me_named") && !document.getElementById("splash")) return false;
    pendingInvite = raw;
    const state = read(); if (state) { state.sample = false; write(state); }
    return true;
  }
  function finishWelcome() {
    sync();
    if (pendingInvite) { const raw = pendingInvite; pendingInvite = ""; window.ashJoinFromUrl(raw); }
  }
  async function showWelcomeSplash() {
    if (!enabled() || localStorage.getItem("ash_me_named")) return { skipped: true };
    const result = await (window.Splash?.mount?.() || Promise.resolve({ skipped: true }));
    prepare(String(result?.name || "").trim()); return result;
  }
  bus.on("view:rendered", sync); bus.on("sidebar:open", sync);
  bus.on("profile:saved", () => complete("profile"));
  document.addEventListener("ash:welcome", sync);
  window.Onboarding = { showWelcomeSplash, prepare, finishWelcome, hasInvite, queueInvite, complete, sync,
    paintChecklist, reopen, dismiss, makePlan, groupChoice, maybeStart: sync,
    syncDragAttachHint: sync, dismissDragAttachHint() {} };
  unlockChrome();
})();
