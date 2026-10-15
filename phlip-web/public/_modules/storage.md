# storage

## Purpose
Safe localStorage wrappers so feature scripts do not crash on quota, private mode, or malformed JSON.

## Public functions (global)
- `storageGetJson(key, fallback)` — parse JSON or return fallback
- `storageSetJson(key, value)` — stringify; returns boolean success
- `storageGetText(key, fallback?)` — raw string get
- `storageSetText(key, value)` — raw string set; returns boolean
- `storageRemove(key)` — remove; returns boolean

## Internal
- none

## Load order
- Must load after: `core.js`
- Must load before: scripts that adopt these helpers (e.g. `hand-storage.js` / `hand-drafts.js`)

## State owned
- None of its own keys; callers own key constants

## Migration notes
- Extracted as Phase 1 shared utility (webclient refactor)
- Hand modules prefer `loadJSON` / `persistJSON` (wrappers over these helpers)
- Render/channel JSON writes prefer `storageSetJson` / `storageGetJson` directly
