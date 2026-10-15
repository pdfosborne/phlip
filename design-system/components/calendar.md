# Calendar

## Purpose

Read and move through dates. Two calendars, two jobs:

| Calendar | Job | Where |
|---|---|---|
| **Month picker** | Date navigation for the current group's Timeline | Dropdown under the Timeline head (the month toggle) |
| **My calendar** | "What am I signed up to?" across every server: mini-month, agenda, conflict mode | Channel panel, first tab |

## Anatomy

**Month grid.**
- 7 columns (`repeat(7, minmax(0, 1fr))`) under a weekday header (`--fs-caption`, `--text-secondary`).
- Day cells: `--radius-sm`; the number is `--fs-meta`, tabular.
- On touch the whole cell is the target (48 px), even when the drawn cell is 32–38 px.

**Marks.**

| Mark | Spec | Meaning |
|---|---|---|
| Accepted dot | 4–5 px `--periwinkle-border` | At least one event you're going to — independent of the selected date |
| Other-events dot | 4 px `--text-muted` | Events you haven't accepted |
| Multi-day bar (compact) | 4 px `--periwinkle-border` | An event spanning days |
| Multi-day bar (expanded) | 22 px `--periwinkle-border`, white label (`--fs-caption`) | The same, with its title |

**Day states.**

| State | Treatment |
|---|---|
| Today | Inset 1.5 px `--border-strong` ring, 700 |
| Selected | `--periwinkle-tint-soft` fill, `--periwinkle-text`, 700 |
| Outside the month | `--text-muted` at .45 (inactive) |
| Past, in the month picker | Disabled |
| Hover (pointer skin) | `--surface-1` |

**Month head.** Month name (`--fs-small`, 700) with ‹ › icon buttons (48 px hit).

**Agenda (My calendar).** Rows on a grid of `[time 62, right-aligned] [rail 14] [content 1fr]`, min height 48 px.
- The rail is a 1 px `--border` line with a 7 px dot: `--border-strong` normally, `--periwinkle-border` for the current group.
- Content line 1: "*Title* · until *end*". The title (`--fs-small`, 700) truncates first.
- Content line 2: the source group (`--fs-caption`, `--text-muted`).
- Rows from the current group use `--periwinkle-text`.

**Conflict mode.** "Check conflicts" turns the agenda into a proportional day view. The proposed event sits in its real slot, outlined in periwinkle rather than filled, under a banner. A personal event can be added in place and the view updates at once.

## Rules

- **CMP-calendar-1 — One meaning for the purple dot.** A `--periwinkle-border` dot means at least one accepted event that day, in both calendars, whatever date is selected.
- **CMP-calendar-2 — Selected and today are different signals.** Selected is a fill; today is a ring. They combine when both apply.
- **CMP-calendar-3 — Cells never overflow.** Grid cells set `min-width: 0` so unbroken labels can't widen a column (TYP-16).
- **CMP-calendar-4 — Continuous bars.** A multi-day bar rounds only its true start and end; a week-row wrap stays square. Bars bridge the cell padding (−1 px margins) so adjacent segments join without seams (LAY-8).
- **CMP-calendar-5 — Swipe or tap to change month.** Swiping the grid horizontally changes month (inside the component, INT-3); the ‹ › buttons are always present.
- **CMP-calendar-6 — The month picker looks forward.** Past days are disabled there (history lives in Memories). Choosing a day moves the Timeline to it; choosing an empty future day offers to create there.
- **CMP-calendar-7 — My calendar is read-only.** It lists confirmed plans and never navigates away silently; "Show in timeline" is its one bridge back to the current group (PAT-navigation-6). "Add personal event" opens an inline form (title, start, end, note) that saves to My plans without leaving.
- **CMP-calendar-8 — Compact and expanded.** The month picker's chevron toggles between dots (compact) and event names in the cells (expanded; `--fs-caption`, truncated).
- **CMP-calendar-9 — Keyboard.** Days sit in a grid: arrow keys move by day or week, Page Up / Page Down by month, Enter chooses (A11Y-2).

## Current implementation

- Month picker: `.tl-calendar-shell` (`styles/35-timeline-view.css:234–366`). Cells 38 px, hit 28 px, weekdays 10 px `--text-muted`; the event dot is 4 px `--periwinkle-base`; opens with a 180 ms fade and 6 px slide.
- Mini-month: `.sidebar-mini-*` (`styles/20-app-shell.css:2757–2860`). Days 25 px at 10.5 px, weekdays 9 px, nav buttons 25 px; the current-group dot is `--periwinkle-border`.
- Agenda: `.sidebar-agenda` (`20-app-shell.css:2881`). Conflict mode: `scripts/channel/channel-panel-calendar.js` (`conflict-*`).

## Gaps

GAP-10 (9–10.5 px text), GAP-13 (25–28 px targets), GAP-24 (the month picker's dot is `--periwinkle-base`; the style guide and mini-month use `--periwinkle-border`).
