# Classic script load order

Deferred scripts in [`public/index.html`](public/index.html) execute in document order. Paths live under `public/scripts/<domain>/` (basenames unchanged). Preserve producer-before-consumer when inserting files. Bump `sw.js` `CACHE` and keep `SHELL` in sync with every new runtime script.

**Root (not under `scripts/`):** `theme-boot.js` (head), `register-sw.js`, `sw.js`, `index.html`, `style.css`, manifest/logos.

## Domains (`public/scripts/`)

| Folder | Contents |
|--------|----------|
| `boot/` | crypto-lite, legal-docs, core, ash-gesture, storage, dom-events, ui-confirm, perf, feel, ash-feedback, crypto |
| `demo/` | demo-mode, demo-store, demo-fixture, demo-boot (local `/demo/` SPA) |
| `drive/` | drive-config, drive-auth, drive-api, drive-md, drive-sync, drive-conn, drive-ui |
| `net/` | net-part*, pathselect |
| `handlers/` | handlers-clone, handlers-dispatch |
| `personal/` | personal, personal-space, backup |
| `helpers/` | helpers-part* |
| `shell/` | modal, nav, chatScope, shares-live, served, panel, ash-back (loaded just before wireboot) |
| `render/` | render-* (see `_modules/render.md`) |
| `channel/` | channel-* (see `_modules/channel.md`) |
| `host/` | host-settings-*, hotspot-join-*, hosting-guide |
| `pitch/` | pitch-*, card-themes, card-back |
| `share/` | share-url, sharecard-*, qr-lite, event-pass, event-ics |
| `hand/` | hand-* (see `_modules/hand.md`) |
| `late/` | splash, onboarding, wireboot, supporter, microsite |

Exact filenames and order: always match [`public/index.html`](public/index.html) and `sw.js` `SHELL` (versioned by `SHELL_VER`).

## Shared utilities

Insert early in `scripts/boot/` (after `core.js`, before first consumer):

- `storage.js` — safe localStorage wrappers
- vendored `dexie-4.4.5.min.js` then `demo-mode.js` / `local-sync-store.js` / `demo-store.js` — demo namespaces storage first; Android/browser remote persistence stays on `phlip-local-sync-v1`
- `dom-events.js` — delegated event helpers
- `ui-confirm.js` — inline confirm pattern
- `scripts/share/share-url.js` — `normalizeShareOrigin` (before sharecard / microsite)

## Authoring rule

When adding a script, follow [`MAINTENANCE.md`](MAINTENANCE.md):

1. Add `<script defer src="scripts/<domain>/…">` in the correct slot in `index.html`
2. Add `./scripts/<domain>/…` to `sw.js` `SHELL`
3. Bump `sw.js` `CACHE` (e.g. `phlip-shell-vNNN`)
4. Document in `public/_modules/` and link from the README module map
5. Update ownership map if new keys / `S` fields / public globals are introduced
6. Extend [`SMOKE-CHECKLIST.md`](SMOKE-CHECKLIST.md) when the change is high-risk

Empty compatibility facades are not shipped. Run `python tools/verify_web_assets.py` from the repository root to check script and offline-asset membership.
