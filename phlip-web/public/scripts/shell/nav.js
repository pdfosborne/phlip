/* Nav — the one place that decides what the main board (`S.activeView`)
   shows. Deleting this file must leave the app fully working: every
   consumer falls back to its own inline `S.activeView = {...}` assignment.

   Deliberately a thin pass-through, not a validator. renderView()'s
   existing clamp sequence (clampPersonalSocialMetaView() ->
   clampAllEventsMetaView() -> legacy notifications panel redirect,
   all in channel-view.js) is already the single place that knows
   what's currently valid, using live post-sync state (activeConn(),
   group()) that a setter can't always see correctly mid-mutation (e.g.
   inside a WS handler before group() reflects a just-created channel).
   Nav.set() doesn't duplicate that logic — an invalid view set through
   Nav gets clamped on the next render exactly as it does today.

   Grown incrementally alongside the call-site migration (see the plan for
   "Centralize view/panel state") rather than pre-declaring speculative
   methods no caller uses yet. */
(() => {
  "use strict";

  /** The one setter every `S.activeView = {...}` call site should route
   *  through. */
  function set(view) {
    if (typeof boardDestinationNavigate === "function") boardDestinationNavigate(view);
    if (!view?._keepProjection && typeof clearActiveProjection === "function") {
      clearActiveProjection();
    }
    S.activeView = view || null;
    return S.activeView;
  }

  /** Replaces the repeated `typeof defaultAgendaView === "function" ?
   *  defaultAgendaView(conn) : { kind: "events" }` fallback idiom. */
  function landDefault(conn) {
    return set(typeof defaultAgendaView === "function"
      ? defaultAgendaView(conn)
      : { kind: "events" });
  }

  /** Opens an event in the Timeline's event sheet (the full-card detail
   *  popup is archived: archive/web/E1-event-detail-popup). */
  function openEventDetail(id) {
    if (typeof openEventConversation === "function" && openEventConversation(id)) return S.activeView;
    return landDefault();
  }

  function openChannel(id) {
    return set({ kind: "channel", id });
  }

  function openProjectedChannel({ sourceConnId, sourceBoardId, sourceChannelId }) {
    if (!sourceConnId || !sourceBoardId || !sourceChannelId) return null;
    if (typeof boardDestinationNavigate === "function") boardDestinationNavigate({ kind: "channel", id: sourceChannelId });
    S.activeProjection = { sourceConnId, sourceBoardId, sourceChannelId };
    S.activeView = { kind: "channel", id: sourceChannelId };
    return S.activeView;
  }

  function kind() {
    return S.activeView?.kind || null;
  }

  function is(k) {
    return S.activeView?.kind === k;
  }

  window.Nav = { set, landDefault, openEventDetail, openChannel, openProjectedChannel, kind, is };
})();
