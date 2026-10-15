# Audit

Where the shipped client stands against this spec on 2026-09-10: how much raw styling remains, every known gap with its fix, where the style guide and the code disagree, and the order to migrate in. Update this file whenever a change opens or closes a gap.

## Baseline

From `python3 tools/design_token_audit.py` (checked in as `tools/design_token_baseline.json`). Each number counts declarations that use a literal where a token belongs; `legacy` counts uses of deprecated aliases; `tokens` counts uses of the design-system tokens (adoption — higher is better). The ratchet (`--baseline`) fails if any drift count rises; refresh the baseline in the same commit whenever counts drop.

| Module | colour | font-size | weight | line-height | radius | spacing | duration | easing | z-index | shadow | legacy | tokens |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 00-foundation.css | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 9 | 18 |
| 10-forms.css | 0 | 19 | 7 | 4 | 7 | 30 | 0 | 0 | 0 | 0 | 29 | 0 |
| 20-app-shell.css | 35 | 108 | 68 | 31 | 68 | 273 | 8 | 7 | 6 | 22 | 265 | 75 |
| 21-demo.css | 0 | 2 | 3 | 0 | 1 | 3 | 0 | 0 | 1 | 1 | 3 | 5 |
| 30-main-events.css | 17 | 61 | 45 | 14 | 32 | 138 | 1 | 0 | 3 | 8 | 228 | 6 |
| 35-timeline-view.css | 18 | 42 | 25 | 8 | 29 | 85 | 21 | 19 | 5 | 15 | 0 | 156 |
| 36-create-draft.css | 4 | 22 | 20 | 4 | 21 | 56 | 2 | 2 | 6 | 5 | 0 | 95 |
| 40-cards-deck.css | 178 | 148 | 115 | 41 | 113 | 302 | 25 | 21 | 13 | 49 | 385 | 15 |
| 50-event-detail.css | 85 | 102 | 81 | 40 | 97 | 242 | 37 | 33 | 18 | 47 | 440 | 3 |
| 55-react-stage-layout.css | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 0 | 0 | 0 | 0 |
| 60-card-hand.css | 229 | 60 | 41 | 26 | 43 | 125 | 22 | 22 | 25 | 58 | 251 | 5 |
| 70-admin-settings.css | 45 | 163 | 111 | 45 | 120 | 426 | 4 | 4 | 7 | 29 | 442 | 8 |
| 80-open-pitch-share.css | 23 | 69 | 32 | 11 | 33 | 145 | 5 | 5 | 2 | 16 | 144 | 0 |
| 90-card-share-onboarding.css | 15 | 22 | 13 | 7 | 18 | 65 | 6 | 6 | 3 | 4 | 39 | 0 |
| react-art/cafe.css | 36 | 0 | 0 | 0 | 5 | 0 | 0 | 0 | 0 | 5 | 0 | 0 |
| react-art/tennis.css | 48 | 0 | 0 | 0 | 7 | 0 | 0 | 0 | 0 | 7 | 0 | 0 |
| **Total** | **733** | **819** | **561** | **232** | **594** | **1890** | **133** | **120** | **89** | **266** | **2235** | **386** |

Of those, **off the design-system scales** entirely: 222 font sizes, 321 font weights, 261 radii and 341 spacing values.

Reading the numbers:
- `35-timeline-view.css` and `36-create-draft.css` are closest to the spec: no legacy aliases, heavy use of the style-guide colour names.
- The card, detail and settings modules (`40`, `50`, `60`, `70`) hold most of the drift.
- Beyond the counts, the CSS has 180 distinct `box-shadow` values, and 49 `*-btn` classes with no shared button style.

## Gap register

Severity: **High** — fails WCAG 2.2 AA, or breaks navigation. **Medium** — inconsistent behaviour or partial accessibility. **Low** — polish and consistency. **Migration** — closed by P1 token adoption.

| ID | Rules | Current state | Severity | Fix |
|---|---|---|---|---|
| GAP-1 | INT-6, INT-7, PLT-4 | **Closed (2026-09-11).** `window.ashBack()` pops one INT-6 layer per press; Android Back evaluates it and `moveTaskToBack` only when it returns false. Predictive back (GAP-2 / PLT-5) is still open. | High | — |
| GAP-2 | PLT-5 | No predictive-back opt-in (`enableOnBackInvokedCallback` absent; targetSdk 34) | Medium | Opt in; enable the callback only while the web stack is non-empty |
| GAP-3 | CMP-dialog-5, CMP-dialog-6, CMP-dialog-10, INT-22 | `AshModal` has no focus trap or focus restore; Escape only with `closeOnEscape`; the app behind isn't inert (`scripts/shell/modal.js`) | High | Focus management and Escape by default in `AshModal` |
| GAP-4 | CMP-dialog-4, CMP-dialog-5, CMP-dialog-6, CMP-button-3 | **Closed (2026-09-11).** `ashConfirm` uses Escape, ignores scrim on danger, focuses Cancel, default label "Confirm", `aria-labelledby` on the message. | High | — |
| GAP-5 | CMP-menu-5, CMP-menu-6, A11Y-2 | Quick menu: no Escape, arrow keys or focus move and restore; items lack `role="menuitem"`; positioned with a fixed 360 px clamp (`scripts/channel/channel-timeline-view.js:2115`) | Medium | Menu keyboard model and anchored positioning |
| GAP-6 | CMP-sheet-3, A11Y-2 | **Closed (2026-09-12).** Event sheet close/Escape/Back and 25% drag already existed. Tabs are `tablist`/`tab`/`tabpanel` with arrow keys; open moves focus to Close; close restores the opener; the focus-tab chat mark is no longer a nested button. | Medium | — |
| GAP-7 | CMP-feedback, INT-13, ELV-10 | **Closed (2026-09-12).** Live-region toast plus a one-action snackbar in `scripts/boot/ash-feedback.js`; `--z-toast` 300. | High | — |
| GAP-8 | PRI-8, PAT-destructive-1 | **Closed (2026-09-12).** Switch-to-Undo sites that still existed use snackbars: own message, solo event, note, routine, pin, block. Keep-confirm / type-to-confirm / explain-and-confirm stay on `ashConfirm`. | Medium | — |
| GAP-9 | INT-25 | **Closed (2026-09-12).** Live `:hover` rules in `public/styles/*.css` sit in `@media (hover: hover) and (pointer: fine)`. Walk controls (rows, FAB, Up, rail, Send) use `:active` / `.is-pressed` (INT-11). Remaining `:active` gaps in settings/admin are separate. | Medium | — |
| GAP-10 | TYP-7 | Text under 11 px: 10 px ×70, 9 px ×39, 8 px ×14, plus 9.5 / 10.5 px — compact-row time, focus-tab meta, sidebar labels, the mini-month, draft-card chips and note | High | Raise to `--fs-caption`; keep 9 px only for badges |
| GAP-11 | TYP-2 | Font weights 500–900 declared although only 400 and 700 ship (321 off-scale weight declarations) | Low | Map to `--fw-regular` / `--fw-bold` |
| GAP-12 | COL-8 | Content text muted by opacity: declined rows (.62), the RSVP × (.65), sidebar section labels (.7) | High | Full-opacity `--text-muted` / `--text-secondary` |
| GAP-13 | LAY-22 | Touch targets under 48 px: month-day hit 28, calendar arrows 28, mini-month days and nav 25, RSVP × 30, row accessory 34, sheet-header buttons 34, draft close 28, dialog close 34, sidebar "+" 28 | Medium | Grow hit areas with `::before` |
| GAP-14 | TYP-8, CMP-input-3 | Inputs under 16 px on touch: composer 13, draft title 14, draft time 13 | Medium | `--fs-input` on coarse pointers |
| GAP-15 | INT-29 | **Closed (2026-09-12).** `.msg-body` and `.msg-reply-text` are `user-select: text`; row chrome stays none. | Medium | — |
| GAP-16 | MOT-4 | Layout-property animation: the event sheet's `height` / `top`, the docked channel panel's `width`, the date-context `max-width` | Low | Transform-based motion |
| GAP-17 | COL-10 | Field boundaries use decorative borders (1.32 : 1): `.field` inputs, draft-card fields | Medium | `--border-control` |
| GAP-18 | COL-9 | White text on `--periwinkle-base` (3.86 : 1): the active rail button's initials, sidebar meta-row badges | Medium | `--periwinkle-border` fills, or ink badges |
| GAP-19 | INT-2 | **Closed (2026-09-12).** Nav/main-sheet/rail/panel dismiss use `AshGesture.shouldCommit` and `axisLocked`; the 700 ms / 900 ms duration caps are gone. | Low | — |
| GAP-20 | CNT-6, A11Y-2 | Terms: the rail is `aria-label="Groups"`; "Channel" survives in a few strings; "Hosting" labels events; invite buttons say "Accept / Decline"; both "Can't go" and "Can’t go" appear | Medium | Glossary pass |
| GAP-21 | CNT-7 | Picker labels are 24-hour (`formatTimeFieldLabel`, "19:00"); the feed shows "7:30pm" | Low | One formatter |
| GAP-22 | PLT-7 | Native palette: `SettingsTheme` (`#F5A93B`, `#FFFCF7`, `#14120F`, `#6B675E`, `#D4CFC4`, `#EAE8E1`, `#C0392B`, `#1B8A5A`) and `themes.xml` `colorPrimary` | Low | Map onto token values |
| GAP-23 | PLT-12 | iOS WebView background is `.systemBackground` (`phlip-ios/Phlip/Sources/PhlipWebView.swift:29`) | Low | `--page-bg` and a light interface style |
| GAP-24 | README precedence | The style guide and shipped CSS differ ([table below](#style-guide-vs-code)) | Low | Resolved in the spec; the code follows during P1 |
| GAP-25 | COL-1, COL-16, LAY-1, ELV-1, MOT-1 | Raw values and legacy aliases throughout the CSS ([baseline](#baseline)); rounded-square avatars; card radii 4–20 px | Migration | P1 |
| GAP-26 | PLT-19, ELV-12 | The demo bar wraps to two lines on phones and covers the main head; it sits at z 210, above dialogs; it uses an undefined `--text` (`styles/21-demo.css`) | Low | Reserve the real height; `--z-sticky` |
| GAP-27 | COL-12, PAT-chat-1 | The main head's unread chat uses a literal `#3E8BD8` icon and count badge (`styles/30-main-events.css:221`) | Low | The notify-blue dot |
| GAP-28 | TYP-4 | Monospace uppercase labels and counts: `.field label`, `.side-label`, `.dot-count`, `.notif-when` | Low | Atkinson caption styles |
| GAP-29 | MOT-1 (RSVP confirm) | Only the RSVP wash runs, cut at 260 ms by a re-render; the transition and celebration stages are missing (`channel-timeline-view.js:927`) | Low | Build stages 3–4 |
| GAP-30 | MOT-5, INT-17 | **Partial (2026-09-12).** `CardFeel.eventCreatedOnce` plays the confirm sound on the first paint of an event we created. Settle motion is still unwired. | Low | Wire settle motion |
| GAP-31 | CMP-dialog-8 | Dialogs appear and vanish without motion | Low | Enter and exit in `AshModal` |
| GAP-32 | MOT-8 | Ambient loops never settle: the live dot (1.4 s, infinite), the rail's reaching pulse, create coaching pulses, the card holo finish | Medium | Settle within 5 s; pause when hidden |
| GAP-33 | LAY-25 | Rows under 48 px on touch: sidebar items (about 36 px), quick-menu items (40 px) | Low | `--row-min` on coarse pointers |
| GAP-34 | PLT-17 | In browsers, overlays push no history and views aren't URL-addressable beyond `?event=` | Low | History entries per overlay |
| GAP-35 | INT-27 | Right-click on rows isn't wired (`contextmenu` is handled in two places) | Low | Open the quick menu |
| GAP-36 | A11Y-4 | The Timeline scroller has no `scroll-padding` for the sticky head, focus tab and FAB | Medium | Set scroll padding |
| GAP-37 | CMP-event-row-4 | A row's name is only "title, time" — no RSVP state or unread count; no context-menu key | Low | Richer `aria-label`; Shift+F10 |
| GAP-38 | CMP-avatar-2, COL-5 | Three of the six avatar hue pairs are below 4.5 : 1 (4.43, 4.28, 4.08) (`scripts/helpers/helpers-part1.js`) | High | Darken those initials colours |

## Style guide vs code

Where `style-guide-8-color-review.html` and the shipped CSS disagree, and which one the spec follows (GAP-24).

| Item | Style guide 8 | Shipped CSS | Spec |
|---|---|---|---|
| Compact-row title | 15 px, `--text-secondary` | 14 px, `--text-primary` | Shipped |
| Compact-row time | 11 px | 10 px | 11 px (TYP-7) |
| Invite-card title | 16 px, 700 | 15 px, 400 | Shipped |
| Invite icon frame · Yes circle | 44 px · 40 px | 46 px · 42 px | Shipped |
| Sheet corner radius | 14 px | 18 px (event sheet), 16 px (modal sheets) | 16 px (LAY-6) |
| Long-press quick menu | Centred, 200 px | Anchored under the row, 232 px | Shipped (CMP-menu-3) |
| Accepted-event dot | `--periwinkle-border` | `--periwinkle-base` in the month picker; `--periwinkle-border` in the mini-month | `--periwinkle-border` (CMP-calendar-1) |
| Radius values | 2 / 8 / 10 / 12 / 14 / 16 / 50 % | About 20 values | The LAY-6 scale |
| Spacing | 4–16 px, plus 3 / 5 / 11 | The same, plus others | The even scale (LAY-1) |
| `--text-muted` | `#7d7a71` | `#74716a` | `#74716a` (AA) |
| `--red-border` | "Currently unused" | Defined, barely used | Reserved for destructive outlines (COL-11) |
| `--action-base` | Amber `#F2A93B`, for buttons that require action | Token only | Black (`var(--text-primary)`) for every primary action button — owner decision, 2026-09-10 |
| `--menu-button-base` | Defined | Token only | Menu CTA buttons (CMP-button) |
| Warm borders against cool surfaces | Open question | Unchanged | Still open; not a rule |

## Migration order

- **P0 — accessibility first.** Each item can ship on its own: GAP-1, GAP-3, GAP-4, GAP-6, GAP-7, GAP-10, GAP-12, GAP-14, GAP-17, GAP-18, GAP-36, GAP-38.
- **P1 — token adoption, one stylesheet per change.** Order: `35-timeline-view` → `20-app-shell` → `36-create-draft` → `50-event-detail` → `30-main-events` → `10-forms` → `70-admin-settings` → `40-cards-deck` / `60-card-hand` → `80-open-pitch-share` / `90-card-share-onboarding` → `react-art`.

  Each change:
  1. Replaces literals and legacy aliases with tokens, normalising values to the scales.
  2. Runs the audit (counts must drop) and refreshes the baseline.
  3. Takes a before/after computed-style snapshot of the demo and checks every difference against this spec.
  4. Is tried on the acceptance devices.

  Along the way, add shared button classes (CMP-button), a toast and snackbar module (CMP-feedback) and hover gating (GAP-9).
- **P2 — behaviour.** Undo snackbars and the confirm reclassification (GAP-8), gesture constants (GAP-19), browser history (GAP-34), right-click (GAP-35), the signature motions (GAP-29, GAP-30, GAP-31), ambient settling (GAP-32), row names (GAP-37), and the terminology and format passes (GAP-20, GAP-21, GAP-28).
- **P3 — native shells.** Predictive back (GAP-2), the Android settings palette (GAP-22), the iOS background (GAP-23).

## Verification record

- **2026-09-12 — pressed / hover.** Walk controls (timeline row, sidebar row, FAB, Up chevron, rail, composer Send) take `:active` / `.is-pressed` over `--dur-press`. Live `:hover` in `public/styles` is behind `(hover: hover) and (pointer: fine)` (GAP-9 / INT-11 / INT-25).
- **2026-09-12 — Move up / Move down.** Channel settings sheet nudges a group within its sidebar section (INT-5 / I-6). Reorder channels remains the drag mode.
- **2026-09-12 — leftover interaction slices.** Message copy (GAP-15); create sound (GAP-30); rail/main/panel `shouldCommit` (GAP-19); event-sheet tabs and focus (GAP-6); time-block Edit time + arrow nudge (INT-5); remaining Switch-to-Undo snackbars (GAP-8).
- **Contrast figures** in [01-color.md](01-color.md), [event-card.md](components/event-card.md) and [avatar.md](components/avatar.md) are computed from the colour values with the WCAG 2.x relative-luminance formula.

## 2026-09-15 · Device-review decisions and implementation

Owner accepted review findings 1–3 and 5–10. Finding 4 is deferred: keep the compact creation/input layout so it fits above the keyboard. Server = overall group; board = subgroup; Events / Chat / Tasks = views (channel remains internal). This resolves the earlier glossary/navigation disagreement.

Implemented: actionable empty and filtered states; event-named chat composer; 48 px expanded board-view targets with a later owner-approved 40 px compact rhythm for collapsed boards and pinned entries; direct event opening in List view; navy setup progression and black enable-sharing action; glossary/filter wording; Atkinson sidebar/menu captions and shared 12-hour clocks; green online / periwinkle connecting / red offline dots with a visible sidebar status; server image or initials beside Back.

Known gaps remain scoped: GAP-10/13/20/21/28 are only partially addressed across the wider app. GAP-14 is deferred for this review. Native settings were not changed. The existing token baseline already understates drift at HEAD; this change reduces raw values versus HEAD and introduces no increased drift category. Do not interpret the pre-existing ratchet failure as a passing global audit.

Final verification: seven targeted self-tests and Android debug assembly pass. The build was installed on the USB OnePlus 5. Stale keyboard inset handling was also corrected in `MainActivity` and the timeline bridge; create/cancel followed by event opening now leaves the sheet and composer within the viewport without changing compact form geometry. Device evidence and validation details are in the [review record](reviews/2026-09-15/review.md).

## 2026-09-23 · Floating board layout approved; migration pending

The [layout spec sheet](floating-board-layout.md) and README record the later owner decision. They supersede older shell/navigation exclusions of bottom tabs within the revised board surface. The [mockup](mockups/floating-panels.html) is the interaction reference, not evidence of a production rollout.

Outstanding: map FLT measurements to production tokens; migrate shell, board dropdown, effective access controls, conversation grouping and return-location state; reconcile older component descriptions; verify real data, permissions, responsive layout and accessibility on devices. No production CSS audit, build or device installation is claimed by this documentation update.
