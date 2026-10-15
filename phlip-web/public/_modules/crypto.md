# crypto (crypto.js + crypto-lite.js)

## Purpose
Content encryption. `crypto.js` uses Web Crypto when available; `crypto-lite.js` is the deliberate insecure-context (LAN http) fallback pinned to Web Crypto test vectors.

## Public functions (global)
- See `crypto.js` / `AshCryptoLite` on `crypto-lite.js` — do not invent a second AES/GCM stack

## Internal
- `_lite()` in `crypto.js` resolves `AshCryptoLite`

## Load order
- Must load after: `crypto-lite.js` before `crypto.js` (already true in index.html)
- Must load before: net / personal / backup flows that encrypt

## State owned
- Identity localStorage key in `crypto.js` (see IDENTITY_LS_KEY there)

## Migration notes
- **Do not merge** these two files. Dual implementation is intentional for LAN http join without `crypto.subtle`.
- Keep `crypto-lite.js` outputs pinned to Web Crypto test vectors when changing it.
