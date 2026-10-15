# Event row

## Purpose

One event in the rolling Timeline, presented according to where you stand on it ([patterns/rsvp.md](../patterns/rsvp.md)).

## Anatomy

**Invite card** — `.tl-event-unanswered`, for events waiting for your answer.

- Container: `--surface-2`, 1 px `--border-strong`, `--radius-md`, padding `--pad-card`, min height 132 px (126 px at ≤ 520), `--space-12` above and below.
- Grid: `[icon 46] [copy 1fr] [action 42]`, column gap `--space-12`.
- Icon frame: 46 px, 1.5 px `--border-strong`, `--radius-sm`, glyph `--icon-lg`; spans the first three rows.
- Title: `--fs-body`, 400, `--text-primary`, one line.
- "by *name*": `--fs-caption`, `--text-secondary`.
- Meta line: `--fs-meta`, `--text-secondary`, `--space-12` above. It holds the time in Tier 1 and the place with an `--icon-xs` pin.
- "Check conflicts": a Link (`--fs-caption`, underlined).
- Going: a 42 px Confirm circle with a 16 px check.
- Can't go: a quiet × mark, top-right, `--text-muted` at full opacity, with a 48 px hit area.

**Compact row** — `.tl-event-compact`, for Going, Maybe and organising.

- Grid: `[time 46] [icon 32] [title 1fr] [accessory auto]`, min height `--row-min`, on `--page-bg`.
- Time: `--fs-caption`, tabular, centred in its column.
- Icon frame: 32 px, 1.5 px `--border-strong`, `--radius-sm`.
- Title: `--fs-body-sm`, 400, `--text-primary`; 700 while unread.
- Accessory: a 34 px visual button with a 48 px hit area and `--surface-1` hover. It shows either the chat icon (`--icon-lg`) with its count (`--fs-badge`) and unread dot, or — when you're the organiser — the people icon with the going count.

**Declined row** — `.tl-event-declined`, for Can't go.

- The compact grid with a × glyph where the icon frame goes.
- Time and title in `--text-muted` at full opacity; no accessory, no metadata.

**Chain strip** — `.tl-chain`: linked events under a row, `--fs-caption`, `--text-muted`, `--icon-xs` glyphs.

**Date separator** — `.tl-date-separator`.

- Day label (`--fs-meta`, 700, uppercase, `--ls-caps`) plus a 1 px `--border` rule.
- On the focused day the label takes `--periwinkle-tint-soft` and `--periwinkle-text`, a week or month context label reveals, and the rule turns `--periwinkle-base`.

## States

| State | Treatment |
|---|---|
| Focused | Lift: `translateY(-3px)` + `--shadow-lift`; invite, compact and declined rows add `--ring-selected`; a compact row gains a `--surface-2` fill |
| Unread | Bold title + the notify-blue dot, ringed in the colour of the surface beneath it |
| Pending sync | `pending-sync` mark until the host confirms (INT-12) |
| Needs approval | Faded, with a dashed outline and a "Pending approval" label |
| Blocked | A "Blocked" label |
| Sheet open | Every other row dims to .34 and becomes inert |
| Pressed | `--surface-1` fill under the pointer (touch) |

## Rules

- **CMP-event-row-1 — One row per event.** Its RSVP state picks the presentation.
- **CMP-event-row-2 — Columns line up across states** (LAY-12): icons and titles align down the feed whatever each event's state.
- **CMP-event-row-3 — Tap opens, long-press offers.** A tap anywhere on the row opens the event sheet on Chat; the accessory opens Chat directly; a long-press opens the quick menu.
- **CMP-event-row-4 — One named button.** The row is a single focusable button named "*Title*, *day* at *time*, *RSVP state*[, *n* unread]". Going, Can't go and the accessory are separate tab stops inside it.
- **CMP-event-row-5 — Counts.** The chat bubble shows the total message count: hidden at 0, collapsing to "…" at three digits. An organiser's row shows the going count. Counts are tabular.
- **CMP-event-row-6 — Declined keeps its text solid.** Full-opacity `--text-muted` and the × glyph carry the state (COL-8).
- **CMP-event-row-7 — Tier 1 only on the invite card.** Compact and declined rows use Tier-2 times (TYP-14).
- **CMP-event-row-8 — Big targets, no overlap.** Rows are at least 48 px; inner controls get 48 px hit areas that don't overlap each other (LAY-22, LAY-23).
- **CMP-event-row-9 — The lift is the only "current" signal** (ELV-3).

## Current implementation

- Styles: `styles/35-timeline-view.css:472–946`.
- Markup: `scripts/channel/channel-timeline-view.js:752`. The row is an `<article>` with `tabindex="0"`, `role="button"` and `aria-label="title, time"`, plus state classes `is-unread`, `pending-sync`, `needs-approval` and `is-blocked`.
- Invite actions: `aria-label="Decline"` / `"Accept"` (`channel-timeline-view.js:782`).

## Gaps

GAP-10 (10 px compact time), GAP-12 (declined text at .62 opacity, × at .65), GAP-13 (34 px accessory, 30 px ×), GAP-20 (Accept/Decline labels), GAP-24 (style-guide differences), GAP-37 (the row's name omits RSVP state and unread count).
