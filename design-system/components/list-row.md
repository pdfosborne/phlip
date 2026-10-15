# List row

## Purpose

Rows in navigation and settings lists: sidebar boards and meta rows, settings rows, people rows and notification items. (Agenda rows are in [calendar.md](calendar.md); Timeline rows in [event-row.md](event-row.md).)

## Anatomy

A row contains:
- an optional leading icon (`--icon-md`, `--text-secondary`) or avatar
- a label (`--fs-body-sm`)
- an optional trailing item: a count (`--fs-caption`, tabular), a value, a chevron, a switch or a badge

Padding is `--space-8` `--space-10` in the sidebar and `--space-10` `--space-12` in settings. Radius `--radius-sm`. Min height 48 px on touch, 36 px on a fine pointer. Owner exception (2026-09-19): board headers and pinned location/person entries use 40 px on touch.

**Section label:** uppercase `--fs-caption`, 700, `--ls-caps`, `--text-secondary` at full opacity, in Atkinson (not monospace); padding `--space-14` `--space-10` `--space-4`.

**Section label:** uppercase `--fs-caption`, 700, `--ls-caps`, `--text-secondary` at full opacity, in Atkinson (not monospace); padding `--space-14` `--space-10` `--space-4`.

## States

| State | Treatment |
|---|---|
| Rest | Label `--text-secondary` |
| Hover (pointer skin) | `--surface-3` fill, label `--text-primary` |
| Pressed (touch) | `--surface-1` fill |
| Current | `--surface-3-strong` fill, label `--text-primary`, `aria-current="page"` |
| Unread | Label 700 `--text-primary`, with its count |
| Disabled | Opacity .4 |

## Variants

| Variant | Contents |
|---|---|
| Sidebar board | Board row (name, lock when private) · unread count / dot. Tap opens conversations. Long-press opens board settings. |
| Sidebar group | Legacy name for a board. Use board language in new copy. |
| Sidebar meta row | Memories, Notifications, Live, pinned locations and people |
| Settings row | Icon · label · value or chevron, with optional one-line helper text below |
| People row | Avatar · name · role tag · actions |
| Notification item | Icon · text · time. Unread: 700 text and a 6 px ink dot at the start — no tinted card |

## Rules

- **CMP-list-row-1 — The whole row is the target**, at least 48 px tall on touch (LAY-25).
- **CMP-list-row-2 — "Current" is a fill, not just a colour.** `--surface-3-strong` plus `aria-current`.
- **CMP-list-row-3 — Section labels are text.** Uppercase caption at full opacity in Atkinson — no monospace, no dimming (TYP-4, COL-8).
- **CMP-list-row-4 — Counts are quiet and aligned.** End-aligned, tabular, `--fs-caption` (CMP-feedback-5).
- **CMP-list-row-5 — Hidden gestures have a visible twin.** A long-press or right-click menu on a row (board settings on the board; channel settings on Welcome or pinned) is also reachable from a visible control (INT gesture table). Hold-to-reorder has Move up / Move down (INT-5).
- **CMP-list-row-6 — Unread isn't selected.** Unread notifications use weight and a dot, never the periwinkle tint that means "selected" (COL-2).
- **CMP-list-row-7 — Destructive rows go last** (PAT-settings-6).

## Current implementation

- `.side-item` (`styles/20-app-shell.css:2281`): padding 7/10, radius 8, 14.5 px `--sage`; hover `--bottle-2`; active `--surface-3-strong`.
- `.side-label` (`20-app-shell.css:2516`): 10.5 px monospace uppercase, .12em tracking, opacity .7.
- `.server-settings-row` (`20-app-shell.css:2140`): padding 10/12, 14.5 px.
- `.people-row` (`styles/70-admin-settings.css:2935`).
- `.notif-item` (`styles/30-main-events.css:1503`): unread uses a `--marigold` border and `--tint-accent` fill; time in 11 px monospace.
- Counts `.dot.dot-count` (12 px monospace); meta-row badges `.dot` (white on `--marigold`).

## Gaps

GAP-10 (10.5 px labels), GAP-12 (label opacity), GAP-18 (white on periwinkle-base badges), GAP-28 (monospace labels and counts), GAP-33 (rows under 48 px on touch).
