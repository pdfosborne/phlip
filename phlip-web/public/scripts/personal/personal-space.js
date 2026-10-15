/* PersonalSpace — the single place that knows what "personal" means.
   Deleting this file must leave the app fully working (every consumer falls
   back to its own inline conn.local / conn.id === "personal" check).

   Personal space is a local-only pseudo-connection (see personal.js for the
   mutation engine; net.js's makePersonalConn()/sendTo() for how it's wired
   up). It is NOT a server: no network, no host, no membership — that is a
   deliberate product/privacy guarantee, not an oversight, and this module
   must never weaken it.

   This file exists so the rest of the app asks a question ("is this conn
   Personal space?", "can it invite?", "why is that button disabled?")
   instead of inlining `conn.local` / `conn.id === "personal"` checks
   throughout otherwise general server-handling code. It is a pure
   query/config layer over state that already exists elsewhere:
     - never opens a WebSocket or calls fetch
     - never calls localApply() directly (net.js's sendTo() dispatch fork —
       `if (conn.local) { localApply(conn, m); return "sent"; }` — stays the
       one visible, explicit boundary; hiding it here would only obscure it)
     - never duplicates personal.js's storage shape, only re-exports it

   Grown incrementally alongside the call-site migration (see
   feature-planning plan for "Formalize Personal space as its own module")
   rather than pre-declaring speculative methods no caller uses yet. */
(() => {
  "use strict";

  /** The one canonical test for "is this conn Personal space". Every other
   *  check in this file, and every call site migrated to use this module,
   *  should route through here rather than re-testing conn.local directly. */
  function isPersonal(conn) {
    if (!conn) return false;
    if (conn.demo && conn.id !== "personal") return false;
    if (conn.drive) return false;
    return !!(conn.local === true || conn.id === "personal");
  }

  const MY_PLANS_ID = "pch";
  const MY_PLANS_NAME = "My plans";
  const MY_PLANS_BOARD_ID = "pch-board";
  const MY_PLANS_CHAT_ID = "pch-chat";
  const MY_ACCEPTED_ID = "pacc";
  const MY_ACCEPTED_NAME = "Accepted";

  function channelIdOf(ch) {
    if (!ch) return null;
    return typeof ch === "string" ? ch : ch.id;
  }

  /** The required personal agenda My calendar saves to. Cannot be deleted. */
  function isRequiredChannel(ch, c = conn()) {
    if (!ch) return false;
    if (!isPersonal(c)) return false;
    const id = channelIdOf(ch);
    if (id === MY_PLANS_ID || id === MY_PLANS_CHAT_ID) return true;
    if (typeof ch === "object" && ch.boardId === MY_PLANS_BOARD_ID) return true;
    return false;
  }

  function isRequiredBoard(board, c = conn()) {
    if (!board || !isPersonal(c)) return false;
    const id = typeof board === "string" ? board : board.id;
    return id === MY_PLANS_BOARD_ID;
  }

  function isSourceBoard(board) {
    return !!(board && board.sourceConnId && board.sourceBoardId);
  }

  /** Hidden personal board of everything this user has accepted. Read-only. */
  function isAcceptedChannel(ch, c = conn()) {
    if (!ch) return false;
    return isPersonal(c) && channelIdOf(ch) === MY_ACCEPTED_ID;
  }

  function isHiddenChannel(ch, c = conn()) {
    if (!ch) return false;
    if (isAcceptedChannel(ch, c)) return true;
    return !!(isPersonal(c) && typeof ch === "object" && ch.hidden === true);
  }

  function isProtectedChannel(ch, c = conn()) {
    return isRequiredChannel(ch, c) || isAcceptedChannel(ch, c);
  }

  /** Convenience accessor for the personal conn itself. */
  function conn() {
    return (typeof S !== "undefined" && S.conns && S.conns.personal) || null;
  }

  /** Personal space is single-user — invites belong on shared servers only
   *  (spec §10 / pitchplan 003: "Just you — stored on this device"). */
  function canInvite(c) {
    if (typeof isDemoMode === "function" && isDemoMode()) return false;
    return !isPersonal(c);
  }

  /** Reporting is only meaningful on a real remote server. */
  function canReport(c) {
    return !isPersonal(c);
  }

  /** { visible, disabled, reason } for the "create invite link" affordance —
   *  centralizes the toast copy so it isn't re-typed at each call site. */
  function inviteButtonState(c) {
    if (typeof isDemoMode === "function" && isDemoMode()) {
      return { visible: true, disabled: true, reason: "Demo is local — invites stay on this browser" };
    }
    if (isPersonal(c)) {
      return { visible: true, disabled: true, reason: "Just you — stored on this device" };
    }
    return { visible: true, disabled: false, reason: null };
  }

  /** Thin re-export of personal.js's storage functions so callers don't need
   *  to reach past this module into personal.js's internals. No logic here. */
  const store = {
    load: (...args) => loadPersonalStore(...args),
    save: (...args) => savePersonal(...args),
  };

  window.PersonalSpace = {
    isPersonal, conn, canInvite, canReport, inviteButtonState, store,
    MY_PLANS_ID, MY_PLANS_NAME, MY_PLANS_BOARD_ID, MY_PLANS_CHAT_ID,
    MY_ACCEPTED_ID, MY_ACCEPTED_NAME,
    isRequiredChannel, isRequiredBoard, isSourceBoard, isAcceptedChannel, isHiddenChannel, isProtectedChannel,
  };
})();
