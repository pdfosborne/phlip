# Adding a classic script (maintenance checklist)

Use this whenever you add or split a runtime JS file under `public/scripts/<domain>/`.

1. **Place the file** under the matching domain folder (`scripts/hand/`, `scripts/channel/`, `scripts/boot/`, …) with a responsibility banner (`Globals in/out`, `Load after/before`) — see [`CONVENTIONS.md`](public/_modules/CONVENTIONS.md).
2. **`index.html`** — insert `<script defer src="scripts/<domain>/….js">` in producer-before-consumer order ([`SCRIPT-ORDER.md`](SCRIPT-ORDER.md)). Keep `theme-boot.js`, `register-sw.js`, and `sw.js` at `public/` root.
3. **`sw.js`** — add `./scripts/<domain>/…` to `SHELL` and bump `CACHE` (e.g. `phlip-shell-vNNN`) in the same change.
4. **Docs** — update or add `public/_modules/<group>.md`; link from [`README.md`](README.md) module map; refresh [`ownership.md`](public/_modules/ownership.md) if you add keys or `S` fields.
5. **Smoke** — empty-cache load + relevant rows in [`SMOKE-CHECKLIST.md`](SMOKE-CHECKLIST.md); paste the console harness first.
6. **Search** — no references to removed script names; no duplicate access-control implementations; do not retain empty facade scripts.

Do **not** introduce ES modules, TypeScript, or a bundler for the shared web client.

After removals, run `python tools/verify_web_assets.py`, the three `tools/find_dead_*.py` scanners, and `node tools/cleanup-selftest.cjs`. Scanners are review aids: their production-only corpus excludes archives and tests; inspect dynamic references before deleting.
