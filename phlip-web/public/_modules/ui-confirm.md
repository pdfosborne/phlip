# ui-confirm

## Purpose
Inline confirm strip helpers (show/hide/message/bind apply·undo). Does not replace AshModal.

## Public functions (global)
- `inlineConfirmHide(el)`
- `inlineConfirmShow(el, messageEl, message)`
- `inlineConfirmBind(root, opts)` — opts: applySelector, undoSelector, onApply, onUndo

## Internal
- none

## Load order
- Must load after: `dom-events.js`
- Must load before: channel access UI when it adopts the helper

## State owned
- none (DOM `hidden` only)

## Migration notes
- Phase 1 utility mirroring channel people-confirm pattern; callers migrate gradually
