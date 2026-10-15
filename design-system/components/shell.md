# Shell

## Purpose

The frame around every view: server rail, channel sidebar, main head, side overlay and channel panel. Its behaviour on narrow and wide screens is in [patterns/navigation.md](../patterns/navigation.md).

## Anatomy

**Server rail**
- `--rail-width` (64 px; 56 px at ≤ 760), `--surface-3`, padding `--space-10` 0, `--space-8` between buttons.
- Server buttons: 44 px (48 px hit), resting `--radius-lg` and tightening to `--radius-md` on hover or when active.
- Button contents: initials (`--fs-body`, 700, `--text-secondary`) or the server picture.
- Order: Personal space first, then servers, then + (dashed outline), then utilities (user, host) at the foot.
- Each server button carries a status dot (COL-13) and a small reach badge (LAN, Direct or Public).

**Channel sidebar**
- `--sidebar-width` (236 px), `--surface-2`, 1 px `--border` on its right edge.
- Head: padding 16 / 16 / 12 with a bottom border; the server name (`--fs-title`, 700) and chevron open the server menu.
- A scrolling list of section labels and rows ([list-row.md](list-row.md)).
- User panel: a floating card at the foot (`--surface-2`, 1 px `--border`, `--radius-lg`, `--shadow-pop`, safe-area margin) holding your chip and the sound toggle.

**Main head**
- Min height 54 px, `--surface-2`, 1 px `--border` bottom; padding 8 / 2 / 8 / 16 (6 px on the left when narrow).
- Menu/back button: narrow screens only, 36 px (48 px hit), showing the server's icon.
- Title: `--fs-body`, 700 — "board · kind" on narrow, "Server · board · kind" on wide.
- Head actions at the end: 36 px icon buttons, `--space-2` apart.

**Side overlay** (settings inside the sidebar)
- Head: back arrow · title (`--fs-title`, 700, `--ls-heading`) · actions.
- Body scrolls with `--pad-sheet` padding. It fills the sidebar at `--z-float`.

**Channel panel**
- `--nav-stack-width` (300 px).
- Head: min height 48 px with a title (`--fs-title`, 700) and icon tabs (My calendar · People · Notifications).
- Body, plus a bottom tab row (Memories).
- Narrow: overlays from the right with `--shadow-panel` at `--z-panel`.
- Wide: docks as a column beside the main pane.

## Rules

- **CMP-shell-1 — The frame holds still.** Navigating re-renders the main pane; the rail, sidebar and heads don't flash or jump.
- **CMP-shell-2 — Shape tells places from people.** Servers are rounded squares; people are round avatars (CMP-avatar-1).
- **CMP-shell-3 — Active is more than colour.** The active server takes `--periwinkle-border` with white initials (5.63 : 1), or a 2 px `--periwinkle-base` ring around its picture. The current group takes the list-row current state. Both set `aria-current`.
- **CMP-shell-4 — The head says where you are** (PAT-navigation-5), and on narrow screens always shows the menu button (PAT-navigation-2).
- **CMP-shell-5 — At most three head actions.** More go behind a ⋮.
- **CMP-shell-6 — Every edge element respects the safe areas** (LAY-19).
- **CMP-shell-7 — Landmarks.** The rail is a `nav` named "Servers"; the sidebar is a `nav` named "Channels"; the main pane is `main`; the channel panel is a named `aside`.

## Current implementation

- `styles/20-app-shell.css`:
  - rail `:10` and rail buttons `:24` (44 px, radius 14 → 10; active uses a `--marigold` fill with `--on-accent` text)
  - sidebar `:246`, side overlay `:267`, channel panel `:454`
  - narrow shell `:517`
  - sidebar head `:1399`, user panel `:1488` (radius 14, `rgba(20,28,24,.16)` shadow)
- Main head: `styles/30-main-events.css:15` (title 15.5 px; head icon buttons 36 px, radius 8).
- Rail markup: `index.html:31`, `<nav class="rail" aria-label="Groups">`.

## Gaps

GAP-13 (36 px buttons without grown hit areas), GAP-16 (the docked panel animates `width`), GAP-18 (white on periwinkle-base), GAP-20 (the rail is labelled "Groups"), GAP-26 (the demo bar covers the head on phones).
