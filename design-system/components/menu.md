# Menu

## Purpose

A short list of actions for one object or one view, opened on demand.

| Menu | Opens from |
|---|---|
| Event quick menu | Long-press a Timeline row; the event sheet's ⋮; right-click or Shift+F10 on the pointer skin |
| View options | The Timeline head ⋮ (RSVP filters, board options) |
| Channel settings | Long-press a group in the sidebar (opens a sheet — see [sheet.md](sheet.md)) |

The sidebar **server head** is not an anchored menu. It opens a Discord-style modal bottom sheet: Invite, Notifications and Settings on top, then a list (People, Info, Help, Leave) — see [sheet.md](sheet.md). The **account chip** opens the full-viewport profile overlay.

## Anatomy

Container (`--surface-2`, 1 px `--border`, `--radius-md`, padding `--space-4`, `--shadow-pop`, width `min(232px, 100vw − 24px)`) → items → optional section labels (`--fs-caption`, uppercase, `--ls-caps`, `--text-secondary`) → dividers (1 px `--border`, `--space-4` vertical margin).

An item is an icon (`--icon-md`, `--text-secondary`) and a label (`--fs-small`, `--text-primary`) with `--space-10` between them, padded `--space-8` `--space-10`, `--radius-sm` (12 − 4 = 8, LAY-7), at least 48 px tall on touch and 40 px on a fine pointer.

## The event quick menu

One action list, the same order at every entry point (long-press and ⋮ show identical menus):

1. **Going** · **Can't go** — for an unanswered invite; **Change RSVP** once answered (replaces the menu in place with the choices, the current one marked)
2. **Share image**
3. **Share**
4. **Edit** — when permitted
5. **Save as routine** / **Remove routine**
6. — divider —
7. **Report**
8. **Delete** — when permitted; `--red-text` label and icon; follows [destructive-actions](../patterns/destructive-actions.md)

## Rules

- **CMP-menu-1 — One list per object.** Every entry point for an object shows the same actions in the same order.
- **CMP-menu-2 — Short and grouped.** At most seven actions (Hick's law), grouped with dividers, destructive last after a divider. Actions you aren't permitted to take are hidden, not shown disabled.
- **CMP-menu-3 — Anchored.** A menu opens next to its trigger — below and end-aligned, flipping above when there's no room — and stays 12 px from every screen edge.
- **CMP-menu-4 — Scrim by skin.** Touch: `--scrim-menu` behind the menu. Pointer: no scrim; a click outside closes it.
- **CMP-menu-5 — Dismissal.** Choosing an item, tapping or clicking outside, Escape, Android Back and (pointer) tabbing away all close the menu.
- **CMP-menu-6 — Keyboard.** Opening puts focus on the first item. Arrow keys move (wrapping), Home and End jump, Enter or Space chooses, Escape closes and returns focus to the trigger.
- **CMP-menu-7 — One level deep.** A submenu replaces the list in place (the Change RSVP pattern) with the current choice marked. No flyouts.
- **CMP-menu-8 — Choices show state.** In option menus (view options) a selected item shows a leading check and `aria-checked`.
- **CMP-menu-9 — Motion.** Enter: fade and a 6 px slide from the trigger side, `--dur-base`, `--ease-enter`. Exit: `--dur-fast`, `--ease-exit`.
- **CMP-menu-10 — Long-press only opens menus.** It never performs an action by itself.

## Accessibility

The trigger has `aria-haspopup="menu"` and `aria-expanded`. The container is `role="menu"`; items are `role="menuitem"` (`menuitemcheckbox` for toggles).

## Current implementation

- `.tl-quick-menu` — `styles/35-timeline-view.css:1791`: 232 px wide, radius 12, padding 5, items min 40 px tall, 10 px gap, 13 px, destructive in `--red-text`. Backdrop `.tl-quick-backdrop` at `rgba(28,28,26,.20)`, z 110/111.
- Opened by a 520 ms long-press with 12 px slop (`scripts/channel/channel-timeline-view.js:984`) and by the sheet's ⋮. Labels and icons: `channel-timeline-view.js:2085`. Positioned under the row, right-aligned, with a fixed 360 px clamp.
- `.timeline-settings-popup` — `35-timeline-view.css:214`.

## Gaps

GAP-5 (no Escape, arrow keys, `menuitem` roles or focus handling), GAP-13 (items 40 px on touch), GAP-19 (long-press timing), GAP-20 ("Accept/Decline" labels), GAP-35 (no right-click).
