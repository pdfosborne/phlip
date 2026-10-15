# 06 · Interaction

How people act on Phlip — with fingers, pointers and keys — what happens when they go back or dismiss something, and how the app answers.

## Input model

- **INT-1 — Pointer events, fired on release.** Gestures use `pointerdown` / `pointermove` / `pointerup` with pointer capture; touch events are a documented fallback only where a WebView breaks pointer capture. Actions fire on `click` or release, never on `pointerdown`. Every gesture surface declares `touch-action` for the scroll directions it leaves to the browser.
- **INT-2 — One set of gesture constants.**

  | Constant | Value | Meaning |
  |---|---|---|
  | Tap slop | 12 px | Movement that cancels a tap or a long-press |
  | Axis lock | 12 px, dominant axis ≥ 1.2 × the other | When a drag commits to horizontal or vertical |
  | Long-press | 500 ms | Opens a context menu |
  | Double-tap | 320 ms | An accelerator only, never the only way |
  | Commit | ≥ 25 % of the travel, or a flick ≥ 0.5 px/ms over ≥ 24 px | Swipes and sheet drags; anything less springs back |
  | Outside-tap grace | 450 ms | Swallow the ghost click that follows a dismissing tap |

- **INT-3 — Reserved horizontal swipes.** Only four full-width horizontal gestures exist: on the narrow main sheet, left→right reveals the nav; on the nav, right→left closes it; on a side overlay, left→right goes back; on the channel panel, left→right closes it. Horizontal swipes inside a component (month picker, carousels, the hour dial) stay inside it.
- **INT-4 — Long-press opens menus only.** It never performs an action. Where an item can also be reordered, keep holding and move to start the drag; the menu closes as the drag begins.
- **INT-5 — Every drag has a non-drag path.** Reordering, moving and resizing also work from a menu or button ("Move up", "Edit time") and from the keyboard.

## Gesture equivalents

| Gesture | Result | Visible equivalent |
|---|---|---|
| Swipe left→right on the main sheet (narrow) | Reveal the nav | The menu/back button in the main head; Android Back |
| Swipe right→left on the nav | Close the nav | Tap the main sheet; Back |
| Long-press a Timeline row | Quick menu | Open the row, then the sheet's ⋮; right-click or Shift+F10 on the pointer skin |
| Drag the event sheet up or down | Expand or close | Tap the handle; the close button; Escape; Back |
| Drag the focus tab up | Peek, then open the sheet | Tap the focus tab |
| Long-press a board header in the sidebar | Board settings sheet | Move up / Move down / Reorder boards in that sheet |
| Long-press Events or Chat | Channel settings sheet | The settings action in the channel panel |
| Swipe vertically on the server rail | Next or previous server | Tap a server |
| Swipe the month picker | Next or previous month | The ‹ › buttons |
| Drag to reorder sidebar boards | Reorder | Move up / Move down in the board’s menu |
| Drag a time block | Move or resize | Edit it in its sheet |

## Back stack

- **INT-6 — One stack, four triggers.** Android Back (including predictive back), the iOS left-edge swipe, Escape and browser Back all close the topmost layer, one layer per press, in this order:
  1. Menu, popover or picker
  2. Dialog (acts as Cancel)
  3. Event sheet — collapse if expanded, then close
  4. Create draft — close it (drafts persist, so nothing is lost)
  5. Side overlay (settings) or channel panel
  6. Narrow shell: the main sheet slides away to reveal the nav
  7. Nothing left: leave the app (Android backgrounds it; a browser goes back normally)
- **INT-7 — Mechanism.** The web client exposes `window.ashBack()`, which returns `true` if it closed something. `MainActivity`'s `OnBackPressedCallback` calls it and only calls `moveTaskToBack` when it returns `false`. The client tells the shell whenever the stack becomes empty or non-empty, so predictive back can preview going home (PLT-4, PLT-5). iOS routes its edge swipe to the same call (PLT-13); served browsers push one history entry per open overlay (PLT-17).
- **INT-8 — Up is not Back.** The main head's menu/back button always goes up the hierarchy — reveal the nav on narrow screens, close the channel panel when it's open — regardless of history.

## Dismissal

- **INT-9 — Dismissal matrix.**

  | Surface | Touch skin | Pointer skin and keyboard |
  |---|---|---|
  | Menu, popover | Choose an item, tap outside, Back | Choose an item, click outside, Escape, Tab away |
  | Event sheet | Drag down, tap outside, close button, Back | Close button, click outside, Escape |
  | Modal bottom sheet | Drag down, tap the scrim, Cancel, Back | Click the scrim, Cancel, Escape |
  | Dialog | Cancel, tap the scrim (non-critical only), Back | Cancel, click the scrim (non-critical only), Escape |
  | Destructive or irreversible confirm | Its buttons; Back = Cancel; no scrim dismiss | Its buttons; Escape = Cancel; no click-outside |
  | Side overlay | Back arrow, swipe left→right, Back | Back arrow, Escape |
  | Channel panel | Close, swipe left→right, tap outside, Back | Close, Escape (docked on wide screens) |
  | Create draft | Close (✕), Back | Close (✕), Escape — its popovers close first |
  | Toast | Times out | Times out |
  | Snackbar | Times out, swipe away, its action | Times out (paused on hover or focus), its action, Escape |

- **INT-10 — Dismissing taps don't click through.** A tap outside that dismisses something must not also activate what is underneath (`makeOutsideDismissHandler` and `DISMISS_SUPPRESS_MS` in `scripts/late/wireboot.js`).

## Feedback

- **INT-11 — Every control answers within 100 ms.** On touch that means a pressed state (the tap highlight is off, PLT-8); on the pointer skin a hover state as well. No control is silent.
- **INT-12 — Optimistic by default.** Fast, reversible writes — RSVP, chat send, reactions, create — show their new state immediately and reconcile when the host answers. If the write fails, roll back visibly and offer Retry (PRI-15).
- **INT-13 — Use the lightest rung of the feedback ladder.**

  | Rung | When | Example |
  |---|---|---|
  | State change | The result is visible where the person acted | The RSVP row updates; the message appears |
  | Inline status | Something is pending or out of sync | Pending-sync mark, "Sending…", the reconnect banner |
  | Toast | A background or off-screen result needs one line and no action | "Link copied", "Routine saved" |
  | Snackbar | A recoverable action just happened | "Event deleted · Undo", "Can’t go · Undo" |
  | Inline confirm strip | A list change needs apply or undo in place | People-picker changes (`ui-confirm.js`) |
  | Dialog | Irreversible, or other people's data | Leave & delete my data; remove a member |

- **INT-14 — Waiting.** Nothing under 100 ms. From 100 ms an inline spinner, or the control shown busy. After 1 s a skeleton of the real layout. After 10 s say what's happening and offer Cancel or Retry.
- **INT-15 — Errors sit with their cause.** A field, row or composer error shows next to it in `--red-text` and says how to fix it. Background failures use a toast. Never `window.alert`.
- **INT-16 — Live updates wait for the finger** (PRI-16). Data that arrives mid-gesture or mid-scroll queues until the interaction ends; nothing under a pointer moves or re-renders.

## Sound and haptics

| Tier | Moments | Channels |
|---|---|---|
| 1 | An event is created | Motion + sound (+ haptic where available) |
| 2 | RSVP set, chat sent, create becomes ready (the "armed" tick), reaction sent | Motion + a light sound |
| 3 | Timeline focus detents, sheet moves, picking up a card | Motion; the focus detent may click (the "scroll" channel) |
| None | Navigation, scrolling without a focus change, opening detail, typing, toggles | — |

- **INT-17 — Tiers decide.** If everything has a sound, nothing does.
- **INT-18 — Sound.**
  - Tonal and dry, under 150 ms.
  - Played on the same frame as the visual change, never from an animation-end callback, and preloaded.
  - Respects the global mute, the strength setting (default .55) and each channel toggle (flick, scroll, confirm).
  - Pitch varies by at most ±1 semitone.
  - Never the only signal.
  - Defaults stay as shipped.
- **INT-19 — Haptics** (off today).
  - Only through Android `performHapticFeedback` constants via the bridge, or native `UIFeedbackGenerator` on iOS.
  - Only for Tier 1–2 moments, on the same frame as the visual.
  - Never during a continuous gesture.
  - Always respects the system setting.

## Keyboard

- **INT-20 — Everything works from a keyboard.** This covers the pointer skin and hardware keyboards on tablets.
  - Tab order follows the visual order.
  - Rows, cards and custom controls are focusable.
  - Enter and Space activate.
  - Arrow keys move within composite widgets: menus, tabs, grids, wheels, listboxes.
- **INT-21 — Escape closes the topmost layer.** One layer per press, following the back stack (INT-6).
- **INT-22 — Focus follows overlays.** It moves into a menu, sheet or dialog when it opens, stays inside modal ones, and returns to whatever opened it on close. Focus is always visible and never hidden behind chrome (A11Y-4).
- **INT-23 — No single-key global shortcuts** (WCAG 2.1.4). Shift+F10 or the context-menu key opens the quick menu for the focused row.
- **INT-24 — Enter submits single-line fields** (composer, prompts). Shift+Enter adds a line where multi-line input exists.

## Pointer skin

- **INT-25 — Hover only where hover exists.** Hover styles live inside `@media (hover: hover) and (pointer: fine)`, so touch screens never show stuck hover states.
- **INT-26 — Hover never holds the only path.** Anything revealed on hover also appears in a visible ⋮, or on focus.
- **INT-27 — Right-click opens the quick menu** for a row — the same list as long-press and ⋮. The browser's own menu stays on text, links and inputs.
- **INT-28 — Cursors.** `pointer` on clickable things, `grab` / `grabbing` on handles and draggable items, `text` on text inputs, default elsewhere.

## Text selection

- **INT-29 — Content is copyable; chrome isn't.** Chat messages, descriptions, addresses, URLs and codes can be selected and copied. App chrome — rail, rows, buttons, handles — can't, so long-press and drag gestures never start a text selection.
