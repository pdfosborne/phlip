# 08 · Platforms

One mental model (PRI-5), two input skins, five shells. Names, structure, icons and state are the same everywhere; only the mechanics change.

## Input skins

| | Touch skin | Pointer skin |
|---|---|---|
| Detect | `(pointer: coarse)`, no hover | `(hover: hover) and (pointer: fine)` |
| Where | Android app, iOS shell, phone and tablet browsers | Desktop browsers: host-served pages, the demo |
| Hit areas | ≥ 48 px | ≥ 24 px; rows may tighten to 36–40 px |
| Hover | None — no hover styles | Hover fills, `title` tooltips, hover-revealed secondary actions (always also in a visible ⋮) |
| Context actions | Long-press → quick menu | Right-click, the context-menu key or Shift+F10 → quick menu |
| Dismissal | Swipe, Back, tap outside | Escape, click outside, close button |
| Panel motion | `--dur-panel` 220 ms | 180 ms (MOT-3) |
| Text inputs | 16 px | May use 13–14 px |

- **PLT-1 — Skins follow media features.** Switch on media queries (in CSS) and `matchMedia` listeners (in JS), never the user agent. A device can change skin at runtime — a tablet gains a mouse — so never check once and cache the answer.
- **PLT-2 — Width and skin are independent.** Layout follows viewport width (LAY-15); affordances follow the input (LAY-16).

## Android app (`phlip-android`, WebView)

- **PLT-3 — System bars.** Light: a white status bar with dark icons and a light navigation bar. The app is not edge-to-edge today (targetSdk 34, `setDecorFitsSystemWindows(true)`). Moving to targetSdk 35 enforces edge-to-edge; the web client's `--safe-*` insets already handle it, but test the rail, FAB, focus tab and sheets under both gesture and three-button navigation.
- **PLT-4 — Back asks the web client first.** The `OnBackPressedCallback` calls `window.ashBack()`, which closes the topmost layer of the in-app stack ([06-interaction.md](06-interaction.md#back-stack)) and reports whether it did. Only an empty stack backgrounds the app.
- **PLT-5 — Predictive back.** Opt in with `android:enableOnBackInvokedCallback="true"`, and keep the callback enabled only while the web stack is non-empty (the client tells the shell through the bridge), so the system back-to-home preview plays whenever Back would leave the app.
- **PLT-6 — The edges belong to Android.** In-app swipes never compete with the system back zone. The narrow shell's left-to-right swipe and Back both reveal the nav, so the two can never disagree.
- **PLT-7 — Native screens use the tokens.** `SettingsActivity` and its sections read their colours from token values:

  | `SettingsTheme` today | Token |
  |---|---|
  | `INK #14120F` | `--text-primary #1c1c1a` |
  | `MUTED #6B675E` | `--text-secondary #6b6a63` |
  | `ACCENT #F5A93B` | `--action-base`, black `#1c1c1a` (text on it: `--on-action`, white) |
  | `SURFACE #FFFCF7` | `--surface-2 #ffffff` (screen background `--page-bg`) |
  | `BORDER #D4CFC4` | `--border-strong #d3d1c7` |
  | `CHIP #EAE8E1` | `--surface-3-strong #ebedef` |
  | `DANGER #C0392B` | `--red-text #7a2f2f` |
  | `PUBLIC_LIVE #1B8A5A` | `--success-text #1f7a52` |

  `themes.xml` `colorPrimary` follows `--action-base`. Native screens should use Atkinson Hyperlegible (bundled under `res/font`) so they read as the same app.
- **PLT-8 — Tap highlight is off.** The WebView tap highlight and `colorControlHighlight` are transparent, so every control must draw its own pressed state ([06-interaction.md](06-interaction.md#feedback)).
- **PLT-9 — Font scale is honoured.** The WebView follows the system font size; never pin `textZoom` (LAY-26).
- **PLT-10 — Haptics go through the platform.** Only `performHapticFeedback` constants via the bridge, so the system haptics setting and OEM tuning apply ([06-interaction.md](06-interaction.md#sound-and-haptics)).
- **PLT-11 — Deep links seed the stack.** App Links, join intents and future event notifications open their target inside the web client and build the in-app stack under it (server → channel → event sheet), so Back walks up through the app instead of out of it.

## iOS join-only shell (`phlip-ios`, WKWebView)

- **PLT-12 — Background matches the page.** The WebView background is `--page-bg` and the shell sets `overrideUserInterfaceStyle = .light`. `.systemBackground` renders black behind the page in dark mode before first paint.
- **PLT-13 — The left edge means back.** Route the iOS edge swipe into the same in-app stack (a native edge-pan that calls `ashBack()`). It must never navigate the WebView away from the app.
- **PLT-14 — Safe areas.** `viewport-fit=cover` plus `env(safe-area-inset-*)` through the `--safe-*` tokens.
- **PLT-15 — No hosting UI.** When `hostingAvailable()` is false, hosting controls are hidden, not disabled.

## Host-served browser pages and the demo

- **PLT-16 — Pointer skin, fully keyboard-operable.** Right-click on rows opens the quick menu; Escape closes everything.
- **PLT-17 — Browser Back closes overlays.** Opening a sheet or dialog pushes a history entry and closing it pops that entry, so Back closes the overlay instead of leaving the page. Reloading returns to the same server and channel.
- **PLT-18 — Real links stay links.** Help, legal and invite URLs are `<a href>` so open-in-new-tab works.
- **PLT-19 — Demo chrome never covers the app.** The demo bar reserves its real height (it wraps to two lines on phones) and sits at `--z-sticky`, below every overlay.

## Share-guest microsite

- **PLT-20 — Same system, less chrome.** Guest pages use the same tokens and components (event card, RSVP controls) without the rail, sidebar or panels.
