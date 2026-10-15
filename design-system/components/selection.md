# Selection controls

## Purpose

Controls that choose what's shown or which option is on: tabs, icon tabs, pills, chips, filters and segmented controls.

## Variants

| Control | Use | Spec |
|---|---|---|
| **Underline tabs** | Switch panels inside a surface (event sheet: Chat · *N* going · Description) | Equal widths, min height 48 px on touch; label `--fs-meta`; rest `--text-secondary`; active 700 `--periwinkle-text` with a 2 px `--periwinkle-border` underline; 1 px `--border` baseline |
| **Icon tabs** | Switch the channel panel (My calendar · People · Notifications) | 36 px visual, 48 px hit; resting icon `--text-secondary`; selected: `--periwinkle-tint-soft` fill, `--periwinkle-border` outline, `--periwinkle-text` icon |
| **Pill buttons** | Paired actions in panels | `--radius-pill`, `--surface-3` fill, 1 px `--border`, `--fs-small`, 700 |
| **Chips** | Suggestions and quick picks (known places, members) | 32 px visual (48 px hit on touch), `--radius-pill`, `--surface-1` fill, 1 px `--border`, `--fs-meta`, 700; selected uses the Confirm treatment |
| **Filters** | View options such as RSVP filters | Menu items with a leading check (CMP-menu-8) |
| **Segmented control** | Mutually exclusive views (the hidden Timeline / Month / Week / Day switch) | `--surface-1` track; selected segment `--surface-2` + `--shadow-xs` + `--periwinkle-text` |

## Rules

- **CMP-selection-1 — Selected is periwinkle, plus a shape.** A selected control uses `--periwinkle-tint-soft` and/or a `--periwinkle-border` outline with a `--periwinkle-text` label, and always adds a non-colour cue: 700 weight, an outline, an underline or a check.
- **CMP-selection-2 — One model per control.** Tabs switch panels, one at a time. Chips toggle or insert. Filters check.
- **CMP-selection-3 — Short labels.** Tab labels are short nouns; the attendance tab carries its live count.
- **CMP-selection-4 — Keyboard and roles.**
  - Tabs: `tablist` / `tab`; arrow keys move between them.
  - Segmented controls: `radiogroup` / `radio`.
  - Chips: `aria-pressed`; Space toggles.
- **CMP-selection-5 — Targets.** 48 px on touch. A scrolling row of chips keeps `--space-8` gaps rather than shrinking the chips.

## Current implementation

- Sheet tabs: `styles/35-timeline-view.css:1492` (42 px, 12 px, no tab roles).
- Channel-panel tabs: `styles/20-app-shell.css:606` — pills with a `--moss` border; selected uses `--marigold-dim` text on `--tint-accent`; icon tabs are 36 px with `role="tab"` and `aria-selected`.
- Pills: `.channel-panel-pill` (`20-app-shell.css:989`).
- Place chips: `.cd-location-chip` (`styles/36-create-draft.css:379`, 27 px, 10 px, radius 8).
- Member chips: `.member-chip` (`styles/70-admin-settings.css`).
- View switch: `.emode-tab` (`styles/30-main-events.css:257`, hidden while the Timeline is the only view).
- RSVP filters: `.btn-rsvp-filter` (`30-main-events.css:1772`).

## Gaps

GAP-6 (the sheet tabs lack tab roles), GAP-10 (10 px chips), GAP-13 (27–42 px targets), GAP-25 (legacy aliases in selected states).
