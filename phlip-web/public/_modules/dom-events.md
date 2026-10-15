# dom-events

## Purpose
Root-scoped delegated event binding and idempotent mount flags for panels that re-render often.

## Public functions (global)
- `onceFlag(root, key)` — returns true the first time for that key on root
- `onDelegated(root, type, selector, handler, options?)` — delegated listener; returns unbind

## Internal
- none

## Load order
- Must load after: `storage.js`
- Must load before: remounting UI that adopts delegation

## State owned
- Per-root `__phlipBound` flag bag (non-persisted)

## Migration notes
- Phase 1 utility; migrate simple click/change wiring gradually — not gesture/capture listeners that need precise options
- Phase 5: `onceFlag` adopted for rail/sidebar host-foot, channel panel taps/dismiss, hand reorder dismiss
