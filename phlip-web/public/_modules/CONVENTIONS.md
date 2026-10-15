# Script extraction conventions

Runtime classic scripts live under `public/scripts/<domain>/` (see [`SCRIPT-ORDER.md`](../../SCRIPT-ORDER.md)). Basenames are unchanged; `index.html` / `sw.js` use the full `scripts/<domain>/…` path. Boot entry files (`theme-boot.js`, `register-sw.js`, `sw.js`) stay at `public/` root.

## Responsibility banner

Every new classic script starts with a short banner:

```js
/* <name>.js — <one-line purpose>
 *
 * Globals in:  <dependencies / shared state read>
 * Globals out: <public function names this file defines>
 * Load after:  <files>
 * Load before: <files>
 *
 * Must not: <ES modules, bundlers, unrelated feature work>
 */
```

`Load after` / `Load before` may cite basenames (globals resolve at call time).

## Move-then-dedup

1. Copy/move code verbatim into the new file under the correct `scripts/<domain>/`
2. Wire `index.html` + `sw.js` `SHELL`/`CACHE` in the same commit
3. Smoke-check
4. Remove the original block (or leave a thin compatibility wrapper) in a follow-up if review needs a smaller diff
5. Deduplicate only after both call paths use the shared API

## Internal vs public

- Public: existing global function names preserved for callers
- Internal: prefer file-local `const` / prefixed helpers; do not invent a module system

## Docs

Add `public/_modules/<group>.md` after the group's smoke checklist passes. Link from [`../../README.md`](../../README.md).

Ownership of keys / `S` / globals: [`ownership.md`](ownership.md) (linked from the README). Do not paste full ownership tables into every group doc.

## Size ceiling

Prefer **300–700 lines** per file. Larger gesture/editor/orchestrator files are allowed when splitting would hurt cohesion (documented in `ownership.md`). Prefer named domain files over blind `*-partN.js` cuts; mechanical parts are acceptable only when top-level function boundaries are clear and every part passes `node --check`.

## Shared helpers (Phase 5+)

- Persistence: `storageGetJson` / `storageSetJson` / `storageGetText` / `storageSetText` / `storageRemove`, or hand `loadJSON` / `persistJSON`. Do not change key names or schemas while adopting helpers.
- Idempotent mounts: `onceFlag(root, key)` for one-time listeners on stable roots.
- Simple delegated click/change: `onDelegated` only when behavior matches existing capture/bubble semantics. Do not replace gesture listeners that need precise capture/passive options.
