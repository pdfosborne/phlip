# Input

## Purpose

Let people type, pick and toggle values: text fields, text areas, selects, date and time fields, checkboxes, radios, switches, code fields and the composer.

## Anatomy

- **Label** above the field: `--fs-meta`, 700, `--text-secondary`, sentence case.
- **Field:**
  - `--surface-2`, 1 px `--border-control`, `--radius-sm`.
  - Padding `--space-12` `--space-14`.
  - Min height 48 px on touch and 40 px on a fine pointer.
  - Text `--fs-input` (16 px) on touch.
- **Helper text** below: `--fs-caption`, `--text-secondary`.
- **Error text** below: `--fs-meta`, `--red-text`, with an icon.
- **Counter** where there's a limit: `--fs-caption`, tabular.

## Types

| Type | Spec |
|---|---|
| Text, text area | The field above; text areas grow with content up to a max height, then scroll |
| Select | A native `<select>` styled as a field |
| Date | A native `type="date"` input styled as a field |
| Time | A field-styled button that opens the in-app time picker — never a native time input |
| Time picker | A modal bottom sheet with Cancel / Save. Dial on browsers and the pointer skin; wheel in the Android app; the choice is in User settings. 5-minute steps (the draft card uses a 15-minute grid). |
| Checkbox, radio | Native controls with `accent-color: var(--periwinkle-border)`; the whole label row is the target |
| Switch | A checkbox with `role="switch"` when it's drawn as a switch |
| Code | Monospace, letter-spaced — join codes and URLs only (TYP-4) |
| Composer | A pill field with a send button ([patterns/chat.md](../patterns/chat.md)) |
| Draft-card field | 2 px frame with the "needs fill" state ([patterns/create-edit.md](../patterns/create-edit.md)) |

## States

| State | Treatment |
|---|---|
| Rest | `--border-control` boundary |
| Hover (pointer skin) | Boundary `--text-secondary` |
| Focus | Boundary `--periwinkle-border` + a 3 px `--periwinkle-tint-soft` ring |
| Filled | As rest |
| Error | Boundary `--red-border`, message below, `aria-invalid="true"` |
| Disabled | Opacity .4, not focusable |
| Read-only | No boundary, `--surface-1` fill, selectable text |

## Rules

- **CMP-input-1 — Every field has a visible label.** A placeholder is an example, never the label (CNT-14).
- **CMP-input-2 — Visible boundaries.** Fields use `--border-control` (≥ 3 : 1, COL-10) and `--radius-sm`.
- **CMP-input-3 — Touch sizing.** 16 px text (TYP-8) and a 48 px minimum height on touch.
- **CMP-input-4 — One focus treatment for text.** `--periwinkle-border` plus the 3 px tint ring (the draft card's treatment). Other controls use the global focus outline. The ring must never be clipped.
- **CMP-input-5 — Errors at the right moment.** Validate on blur or submit, not on every keystroke. Say how to fix it, link it with `aria-describedby`, and keep what was typed.
- **CMP-input-6 — Help the keyboard.** Every field sets `autocomplete` (name, username, current-password, new-password …), `inputmode` and `enterkeyhint` (done, send, next). Password fields accept paste and password managers.
- **CMP-input-7 — In-app pickers.** Time is always picked with the in-app picker (dial or wheel), never a native time input.
- **CMP-input-8 — Keep what's typed.** Field values, focus and selection survive re-renders and reconnects (PRI-16).

## Current implementation

- `.field` (`styles/10-forms.css:7`): label in 11 px monospace uppercase with .12em tracking; input on `--bottle` with a `--moss` border, radius 10, padding 12/14.
- Join-code inputs: 16 px monospace. `.join-error`: 13 px `--ember`.
- Draft-card fields `.cd-field` (`styles/36-create-draft.css:178`): 2 px `--border`, radius 10, "needs fill" and focused states.
- Composer `.tl-sheet-compose input`: 13 px pill.
- Time pickers: `pickDialTime` / `pickWheelTime` in `scripts/boot/feel.js` (wheel rows 44 px); labels via `formatTimeFieldLabel` (24-hour).
- Checkboxes: `accent-color: var(--marigold)`.

## Gaps

GAP-14 (inputs under 16 px), GAP-17 (field boundaries at 1.32 : 1), GAP-21 (24-hour picker labels), GAP-28 (monospace uppercase labels).
