# Sheet

## Purpose

Detail and focused tasks that rise from the bottom edge without leaving the current context.

| Sheet | What it holds | Kind |
|---|---|---|
| **Event sheet** | The only event detail surface — there is no event page. Header (card preview, title, meta, ⋮), then tabs Chat / *N* going / Description. | Contextual: the chosen row stays visible above it |
| **Focus tab** | A 72 px peek of the event on the Timeline's focus line | Peek that opens the event sheet |
| **Modal bottom sheet** | Pickers and settings: time picker (dial or wheel), channel settings, description editor | Modal: scrim behind it |
| **Server overlay** | Invite / Notifications / Settings on top; People, Info, Help, Leave in the list; Settings is a nested admin pane | Modal sheet from the server head |
| **Account profile overlay** | Your profile home, Edit (You + this server), and Sound / Personal / Style / Other | Full-viewport modal sheet |

## Anatomy

Container (`--surface-2`; 1 px `--border` on the top and sides; top corners `--radius-lg`; `--shadow-sheet`) → handle (40 × 5 px, `--radius-pill`, `--border-strong`, 8 px from the top, hit area grown to about 36 × 144 px with `::before`) → header → optional tabs → scrolling panel (bottom padding includes `--safe-bottom`) → optional pinned composer.

Widths: the event sheet is `min(100%, --content-max)`; modal sheets are `min(100%, 480px)`, centred on wide screens.

## Event sheet states

| State | Geometry | Motion |
|---|---|---|
| Closed | Below the screen | — |
| Peek | The focus tab's height, following the finger | Tracks 1:1 |
| Open | Top edge at the main head + focus gutter (228 px; 222 px at ≤ 520) | `--dur-panel`, `--ease-enter` |
| Expanded | Full height, square corners | `--dur-panel`, `--ease-enter` |

While it's open, rows behind it are inert and dimmed to .34 except the focused row, which stays lifted with `--ring-selected`; the sheet shares that periwinkle ring.

## Rules

- **CMP-sheet-1 — One sheet at a time.** Opening another event replaces the content; sheets never stack. A modal picker may open over the event sheet (`--z-modal-sheet`).
- **CMP-sheet-2 — Keep the row in view.** The event sheet stops below the focus gutter so the chosen row stays visible above it.
- **CMP-sheet-3 — Every gesture has a control.** The handle is a button (tap toggles open and expanded; Enter/Space works too). On the pointer skin, and for screen readers, the header has a close button. Escape and Android Back close the sheet (collapsing first if it's expanded).
- **CMP-sheet-4 — Drag vs scroll.** Content scrolls first. The sheet moves from its handle or header (top 36 px), or from the content once it has reached its scroll limit. Commits follow INT-2: at least 25 % of the travel or a flick, otherwise it springs back.
- **CMP-sheet-5 — Tabs.** Chat (default) · Attendance, labelled with the live count ("6 going") · Description. Labels `--fs-meta`; the active tab is 700, `--periwinkle-text`, with a 2 px `--periwinkle-border` underline ([selection.md](selection.md)).
- **CMP-sheet-6 — Keyboard-aware.** The composer stays above the software keyboard; opening a sheet never raises the keyboard unless the person asked to write.
- **CMP-sheet-7 — Modal sheets.** Close on scrim tap, a downward drag, Cancel, Escape and Back. Actions sit in the header: Cancel (text, start) and Save (end, `--periwinkle-text`, 700), or a Primary button in a footer for longer forms.
- **CMP-sheet-8 — Transform-only motion.** Opening, closing and expanding animate `transform`, never `height` or `top`.
- **CMP-sheet-9 — The focus tab mirrors the focus line.** It shows the focused event: card preview at .42 scale, title `--fs-small`, meta `--fs-caption`, a 36 px chat button with the unread dot. As focus moves its content swaps along the Y axis (MOT-5). It hides while a sheet is open and while an event is being created. A tap opens the sheet on Chat; dragging up opens a peek that follows the finger.

## Accessibility

The event sheet is `role="dialog"` with `aria-modal="true"` (the feed behind is inert), labelled by the event title. Focus moves to the title on open and returns to the row on close. Tabs use tab roles. The handle is a button named "Expand" or "Collapse".

## Current implementation

- Event sheet `.tl-event-sheet` — `styles/35-timeline-view.css:1335`: top radius 18, `0 0 0 2px` periwinkle ring plus `0 -14px 34px` shadow, transitions on `transform`, `height`, `top` and `border-radius`.
- Drag logic — `scripts/channel/channel-timeline-view.js:1880–1990`: 8 px to start, 36 px to expand or close.
- Focus tab — `35-timeline-view.css:1073` and `channel-timeline-view.js:2291`: tap opens; an 8 px lift starts a peek; releasing above 28 px opens the sheet.
- Modal sheets — `.ask-time-sheet` (`70-admin-settings.css:60`); channel settings (`70-admin-settings.css:120`, `scripts/channel/channel-settings-sheet.js`: dismiss at 80 px or 0.55 px/ms); server overlay (Invite / Notifications / Settings + list, `scripts/render/sidebar-menus.js`); account profile overlay (full viewport, `scripts/render/user-profile-overlay.js`); description editor `.tl-desc-editor` (`35-timeline-view.css:1698`).
- The event sheet is already `role="dialog"` `aria-modal="true"`, labelled by the event title (`channel-timeline-view.js:1719`). The focus tab nests a `role="button"` chat control inside its own button (`channel-timeline-view.js:2664`).

## Gaps

GAP-6 (no Escape or close control, focus isn't moved or restored, tabs lack tab roles, nested button in the focus tab), GAP-10 (10 px focus-tab meta), GAP-13 (34 px header buttons), GAP-16 (height/top animation), GAP-19 (thresholds).
