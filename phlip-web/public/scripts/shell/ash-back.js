/* ash-back.js — one overlay layer per Back / Escape (INT-6, INT-21).
 *
 * Globals in:  closeTimelineSettingsPopup, timelineCloseQuickMenu,
 *   closeCreateDraftPopovers, timelineCloseCalendar, userProfileOverlayHandleBack,
 *   serverMenuOverlayHandleBack, channelSettingsSheetHandleBack, taskComposerHandleBack,
 *   AshModal.closeTop,
 *   timelineSheetIsExpanded, timelineSetSheetExpanded, closeTimelineSheet,
 *   eventsLayoutMode, timelineFocusedEventId, timelineSetFocus,
 *   closeCreateDraft, Panel, sideOverlayGoBack, closeSideOverlay, closeChannelPanel,
 *   isNarrowShell, openNav, AshFeedback, conversationsHandleBack,
 *   conversationFeedPickerIsOpen, closeConversationFeedPicker
 * Globals out: ashBack (also window.ashBack)
 * Load after:  modal.js, panel.js, channel-timeline-view.js,
 *   channel-timeline-settings.js, hand-create-draft.js, render-side-overlay.js,
 *   channel-board-nav.js
 * Load before: wireboot.js
 *
 * Must not: ES modules, history.pushState, native predictive-back notify
 */

function ashFeedbackCommitSnackbar() {
  if (typeof AshFeedback !== "undefined" && typeof AshFeedback.commitSnackbar === "function") {
    return !!AshFeedback.commitSnackbar();
  }
  return false;
}

function ashFeedbackHasSnackbar() {
  return typeof AshFeedback !== "undefined"
    && typeof AshFeedback.hasSnackbar === "function"
    && !!AshFeedback.hasSnackbar();
}

function ashBackCloseTopLayer() {
  if (typeof document === "undefined") return false;
  if (typeof boardSelectActive === "function" && boardSelectActive()) {
    boardSelectClear();
    return true;
  }
  if (typeof boardEventNavBack === "function" && boardEventNavBack()) return true;
  if (typeof boardDestinationState !== "undefined" && boardDestinationState.picker) {
    // Closing the picker never raises the keyboard.
    boardDestinationDismiss(false);
    return true;
  }
  if (typeof hostingGuideHandleBack === "function" && hostingGuideHandleBack()) return true;

  if (typeof boardOptionsIsOpen === "function" && boardOptionsIsOpen()
      && typeof closeBoardOptions === "function") {
    closeBoardOptions({ restoreFocus: true });
    return true;
  }

  if (typeof conversationFeedPickerIsOpen === "function" && conversationFeedPickerIsOpen()
      && typeof closeConversationFeedPicker === "function") {
    closeConversationFeedPicker();
    return true;
  }

  if (document.body?.classList?.contains("timeline-settings-open")
      && typeof closeTimelineSettingsPopup === "function") {
    closeTimelineSettingsPopup();
    return true;
  }

  const quickMenu = document.getElementById("tl-quick-menu");
  if (quickMenu && !quickMenu.hidden && typeof timelineCloseQuickMenu === "function") {
    timelineCloseQuickMenu();
    return true;
  }

  const popover = document.getElementById("cd-popover");
  if (popover && popover.classList.contains("open")
      && typeof closeCreateDraftPopovers === "function") {
    closeCreateDraftPopovers();
    return true;
  }

  if (typeof timelineCloseCalendar === "function" && timelineCloseCalendar()) {
    return true;
  }

  if (typeof userProfileOverlayHandleBack === "function"
      && userProfileOverlayHandleBack()) {
    return true;
  }

  if (typeof serverMenuOverlayHandleBack === "function"
      && serverMenuOverlayHandleBack()) {
    return true;
  }

  if (typeof channelSettingsSheetHandleBack === "function"
      && channelSettingsSheetHandleBack()) {
    return true;
  }

  if (typeof taskComposerHandleBack === "function" && taskComposerHandleBack()) {
    return true;
  }

  if (typeof chatMsgSheetHandleBack === "function" && chatMsgSheetHandleBack()) {
    return true;
  }

  if (typeof AshModal !== "undefined" && typeof AshModal.closeTop === "function"
      && AshModal.closeTop()) {
    return true;
  }

  const sheetHost = document.getElementById("tl-sheet-host");
  if (sheetHost && sheetHost.classList.contains("open")) {
    if (typeof timelineSheetIsExpanded === "function" && timelineSheetIsExpanded()
        && typeof timelineSetSheetExpanded === "function") {
      timelineSetSheetExpanded(false);
      return true;
    }
    if (typeof closeTimelineSheet === "function") {
      closeTimelineSheet();
      return true;
    }
  }

  if (document.body?.classList?.contains("tl-creating")
      && typeof closeCreateDraft === "function") {
    closeCreateDraft(true);
    return true;
  }

  if (typeof Panel !== "undefined" && Panel) {
    if (typeof Panel.sideOpen === "function" && Panel.sideOpen()) {
      if (typeof sideOverlayGoBack === "function") sideOverlayGoBack();
      else if (typeof closeSideOverlay === "function") closeSideOverlay();
      return true;
    }
    if (typeof Panel.channelOpen === "function" && Panel.channelOpen()
        && typeof closeChannelPanel === "function") {
      closeChannelPanel();
      return true;
    }
  }

  if (typeof eventsLayoutMode === "function" && eventsLayoutMode() === "list"
      && typeof timelineFocusedEventId !== "undefined" && timelineFocusedEventId
      && typeof timelineSetFocus === "function") {
    timelineSetFocus(null, { instant: true });
    return true;
  }

  // Archive is a view of All chat: Back returns to All chat.
  if (typeof boardArchiveOn === "function" && boardArchiveOn() && typeof boardShowAllChat === "function") {
    boardShowAllChat();
    return true;
  }

  return false;
}

function ashBackOpenNavIfNeeded() {
  if (typeof isNarrowShell === "function" && isNarrowShell()
      && typeof Panel !== "undefined" && Panel
      && typeof Panel.navOpen === "function" && !Panel.navOpen()
      && typeof openNav === "function") {
    openNav();
    return true;
  }
  return false;
}

function ashBack() {
  if (ashBackCloseTopLayer()) {
    ashFeedbackCommitSnackbar();
    return true;
  }
  if (ashFeedbackHasSnackbar()) {
    ashFeedbackCommitSnackbar();
    return true;
  }
  if (typeof conversationsHandleBack === "function" && conversationsHandleBack()) return true;
  if (ashBackOpenNavIfNeeded()) return true;
  return false;
}

window.ashBack = ashBack;

document.addEventListener("keydown", function ashBackOnEscape(e) {
  if (e.key !== "Escape") return;
  if (!ashBack()) return;
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);
