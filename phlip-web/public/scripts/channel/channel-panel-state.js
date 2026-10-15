/* channel-panel-state.js — channel panel state + lookup predicates.
 * Globals out: channelPanelState, isChannelPanelOpen, activeChannelForPanel, …
 * Load after: render.js; before: channel-panel.js
 */
let suppressNavDismissUntil = 0;
let suppressChannelPanelDismissUntil = 0;
let channelPanelState = { channelId: null, mode: "info", tab: "calendar", peopleSub: "server" };
/** Bumped on open/close so a deferred slide-in rAF can't revive a closed panel. */
let _channelPanelOpenToken = 0;

function isChannelPanelOpen() {
  return !!document.getElementById("app")?.classList.contains("channel-panel-open");
}

function activeChannelForPanel() {
  const g = group();
  if (!g || !S.activeView) return null;
  if (S.activeView.kind === "channel") {
    return g.channels.find(c => c.id === S.activeView.id) || null;
  }
  // All-events board: scoped by activeEventChannelId when set.
  // (Create-target / chat scope only — Settings is hidden on this meta board.)
  if (S.activeView.kind === "events") {
    const eventChannels = (g.channels || []).filter(c =>
      c.kind === "event"
      && !(typeof PersonalSpace !== "undefined" && PersonalSpace.isHiddenChannel(c, activeConn())));
    if (S.activeEventChannelId) {
      const scoped = eventChannels.find(c => c.id === S.activeEventChannelId);
      if (scoped) return scoped;
    }
    if (eventChannels.length === 1) return eventChannels[0];
    // Prefer last panel channel, then first event group.
    if (channelPanelState?.channelId) {
      const kept = eventChannels.find(c => c.id === channelPanelState.channelId);
      if (kept) return kept;
    }
    return eventChannels[0] || null;
  }
  if (S.activeView.kind === "eventDetail") {
    const ev = g.events.find(e => e.id === S.activeView.id);
    if (ev?.channelId) {
      const scoped = g.channels.find(c => c.id === ev.channelId);
      if (scoped) return scoped;
    }
    // Personal / linked events may omit channelId — still show the chat opener.
    return (g.channels || []).find(c => c.kind === "event") || null;
  }
  return null;
}

/** Sidebar "All events" aggregate — not a real channel (no channel Settings). */
function isAllEventsMetaBoard() {
  return S.activeView?.kind === "events";
}

/** True for #chat channels (not event groups). */
function isChatKindChannel(ch) {
  return !!(ch && ch.kind === "chat");
}

/** Full channel settings form (name, access, filters…) — not just device consent. */
function canEditChannelSettingsForm(conn = activeConn()) {
  if (!conn) return false;
  if (PersonalSpace.isPersonal(conn)) return true;
  return typeof canManageServer === "function" && canManageServer(conn);
}

function activeChannelForPanelChat() {
  const id = channelPanelState.channelId || activeChannelForPanel()?.id || null;
  if (!id) return null;
  return (group()?.channels || []).find(c => c.id === id) || null;
}

/** Former ⋮ overflow items — native SettingsActivity when in the app. */

const _channelPanelPtrIds = new Set();
let _channelPanelRenderQueued = false;
let _channelPanelFrozenKey = null;

function channelPanelRenderKey() {
  return `${channelPanelState.mode}|${channelPanelState.tab || "chat"}|${channelPanelState.channelId || ""}|${S.activeConnId || ""}`;
}

