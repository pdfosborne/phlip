/* Panel — read-only facade over "what's open" (nav drawer, channel panel,
   side overlay). Deleting this file must leave the app fully working: every
   consumer falls back to its own inline classList / isChannelPanelOpen /
   channelPanelState check.

   Zero state relocation. channelPanelState (channel.js), sideHostMode
   (host-settings.js), and the nav-open / channel-panel-open /
   side-overlay-open DOM classes stay owned where they are; this module only
   answers questions about them.

   Grown incrementally alongside the call-site migration (see the plan for
   "Centralize view/panel state") rather than pre-declaring speculative
   mutators (Panel.setTab etc.) no caller uses yet. */
(() => {
  "use strict";

  function channelOpen() {
    return typeof isChannelPanelOpen === "function" && isChannelPanelOpen();
  }

  function sideOpen() {
    return typeof isSideOverlayOpen === "function" && isSideOverlayOpen();
  }

  function navOpen() {
    return !!document.getElementById("app")?.classList.contains("nav-open");
  }

  function channelState() {
    return (typeof channelPanelState !== "undefined" && channelPanelState) || null;
  }

  function hostMode() {
    return (typeof sideHostMode !== "undefined" && sideHostMode) || null;
  }

  function sideKind() {
    return (typeof sideOverlayKind !== "undefined" && sideOverlayKind) || null;
  }

  function anyOpen() {
    return channelOpen() || sideOpen() || navOpen();
  }

  window.Panel = { channelOpen, sideOpen, navOpen, channelState, hostMode, sideKind, anyOpen };
})();
