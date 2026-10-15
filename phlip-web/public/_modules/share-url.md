# share-url

## Purpose
Single canonical `normalizeShareOrigin` for share bases (share card + microsite).

## Public functions (global)
- `normalizeShareOrigin(raw)` — returns `http(s)://host[:port]` origin or `""`

## Internal
- none

## Load order
- Must load after: (none hard)
- Must load before: `sharecard.js`, `microsite.js`

## State owned
- none

## Migration notes
- Merged duplicates from `sharecard.js` and `microsite.js`
- Kept sharecard's permissive scheme/ws handling (required by LAN/public dual-link call sites)
- Former microsite strict parse is subsumed for already-valid http(s) URLs
