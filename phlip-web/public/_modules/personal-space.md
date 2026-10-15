# personal-space

## Purpose
Canonical predicates for “is this connection Personal space?” — query/config only; mutation lives in `personal.js`.

## Public functions (global)
- `PersonalSpace.isPersonal(conn)` — canonical test
- Other `PersonalSpace.*` helpers as defined in `personal-space.js`
- `PersonalSpace.store` re-exports personal persistence load/save

## Internal
- IIFE-local helpers in `personal-space.js`

## Load order
- Must load after: `personal.js`
- Must load before: `onboarding.js`, `core.js` callers that already use PersonalSpace

## State owned
- none of its own; reads conn shape / re-exports personal store

## Migration notes
- `onboarding.js` already wraps `PersonalSpace.isPersonal` — keep as thin alias
- `core.js` already calls PersonalSpace — no duplicate `isPersonal` to delete
- Do not rename `personal.js` in this pass (engine vs identity naming stays)
