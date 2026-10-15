# Dialog

## Purpose

Interrupt for a short, self-contained decision: confirm an irreversible action, enter one value, read something that must be acknowledged. A dialog is the last resort (PRI-11) — prefer Undo, inline editing, a menu or a sheet ([patterns/surfaces.md](../patterns/surfaces.md)).

## Anatomy

`--scrim-modal` backdrop → card (`--surface-2`, 1 px `--border`, `--radius-lg`, `--pad-dialog`, `--shadow-modal`) → title (`--fs-title`, 700) → message (`--fs-small`, `--text-secondary`) → at most one field or a small block of content → actions row at the end (Text button, then the primary). Informational dialogs may add a close button (34 px round, top-right).

| Type | Built with | Role | Max width |
|---|---|---|---|
| Confirm | `ashConfirm(message, { ok, cancel, danger })` | `alertdialog` | 340 px |
| Prompt | `askText()` / `ashPrompt()` | `dialog` | 360 px |
| Content dialog (share card, report, pass) | `AshModal.open()` + `.modal-card` | `dialog` | 420 px |

## Rules

- **CMP-dialog-1 — Only when the interruption is the point.** Never create events in a dialog (that's the draft card) and never browse details in one (that's the event sheet).
- **CMP-dialog-2 — Build on `AshModal`.** Every overlay goes through `AshModal.open()` (a body-level `.modal-backdrop` with singleton rules), never a hand-rolled shell.
- **CMP-dialog-3 — One at a time.** A confirm may stack over a content dialog (`--z-modal` + 20). Nothing else stacks.
- **CMP-dialog-4 — Say the consequence.** The title asks the real question ("Delete “Film night”?"), the message says what happens and whether it can be undone, and the buttons name the actions ("Delete" / "Cancel").
- **CMP-dialog-5 — Focus.** On open, focus the least destructive action in a confirm (Cancel), the field in a prompt, or the title in a content dialog. Tab stays inside the dialog. On close, focus returns to whatever opened it.
- **CMP-dialog-6 — Dismissal.** Escape always cancels, and Android Back acts as Escape. A scrim tap cancels non-critical dialogs. A destructive or irreversible confirm ignores scrim taps.
- **CMP-dialog-7 — Size.** Full width up to its max width; `max-height: 88vh` with the content scrolling inside; the backdrop keeps at least 20 px (plus safe areas) around the card.
- **CMP-dialog-8 — Motion.** The scrim fades in (`--dur-base`, `--ease-fade`); the card rises 8 px and fades in (`--dur-base`, `--ease-enter`); the exit uses `--dur-fast` and `--ease-exit`. Reduced motion: opacity only.
- **CMP-dialog-9 — Keyboard on touch.** A prompt focuses its field and keeps the card above the software keyboard.
- **CMP-dialog-10 — Background is inert.** While a dialog is open, the app behind it can't be focused or read (`inert` on `#app`).

## Accessibility

`role="dialog"`, or `"alertdialog"` for a confirm; `aria-modal="true"`; `aria-labelledby` pointing at the title and `aria-describedby` at the message.

## Do / Don't

- **Do** replace "Are you sure?" with Undo whenever the action can be undone ([patterns/destructive-actions.md](../patterns/destructive-actions.md)).
- **Don't** stack dialogs, put a form of several fields in a dialog, or let a scrim tap dismiss a destructive confirm.

## Current implementation

- `.modal-backdrop` — `styles/70-admin-settings.css:7`: z 200, backdrop `rgba(20,18,15,.45)`, padding `max(20px, safe area)`.
- `.modal-card` — `70-admin-settings.css:21`: radius 16, padding 22, max width 420, max height 88vh, `0 20px 50px rgba(0,0,0,.3)`.
- `.ash-confirm-card` (340 px, message 15 px bold), `.ask-text-card` (360 px) and `.modal-card-close` (34 px round, `50-event-detail.css:2119`).
- `AshModal` — `scripts/shell/modal.js`: singleton handling, backdrop dismiss with `graceMs`, Escape only when `closeOnEscape` is passed. Optional `trapFocus`, `restoreFocus`, and `initialFocus` (sidebar server/account sheets opt in; other callers stay as they were).
- `ashConfirm` — `scripts/helpers/helpers-part4.js:454`: `role="alertdialog"`, OK labelled "OK" by default, focus on OK, no Escape, backdrop dismiss even when `danger`.

## Gaps

GAP-3, GAP-4, GAP-8, GAP-31.
