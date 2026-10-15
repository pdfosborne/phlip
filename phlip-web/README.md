# Phlip web client (shared)

Canonical UI for **Android** and **iOS** — vanilla JS/CSS/HTML under [`public/`](public/).

Both native shells package this folder:

| App | How |
|-----|-----|
| Android (`:app`) | `assets.srcDirs` → `phlip-web` so files land as `assets/public/...` |
| iOS | Xcode resources → `../phlip-web/public` as folder `public` |

Edit files here only. No sync script.

## Client modes

One SPA; shell mode is origin / path based. See [`public/scripts/shell/served.js`](public/scripts/shell/served.js) for host-served chrome (flag, join gate).

| Mode | Detection | Personal | Multi-server | Persist membership | Join gate |
|------|-----------|----------|--------------|--------------------|-----------|
| **App WebView** | `appassets.androidplatform.net` or `file:` | yes | yes | tokens in `ash_servers_v1` | no |
| **Local demo** | `demo.phlipapp.com`, `/demo/`, or `?demo=1` (`data-demo-mode`) | yes | seeded local groups | IndexedDB `phlip-demo-v1` | no |
| **Served browser** | host Public/LAN URL (`data-served-host`) | no | no (this host only) | username only | yes |
| **Share guest** | `/s/…` (`microsite.js`) | n/a | n/a | share claim store | share join |
| **Join-only native** | `AshNative` + `!hostingAvailable()` (iOS) | yes (still app) | yes | yes | no |

`theme-boot.js` sets `data-served-host` or `data-demo-mode` before paint; `isServedOrigin()` / `isDemoMode()` are the runtime APIs. Demo never talks to `/ash-rpc` or WebSocket — see [`public/_modules/demo.md`](public/_modules/demo.md) and [`demo-host/README.md`](demo-host/README.md).

## Shell layout (width)

Phone vs laptop is **viewport width**, not User-Agent (`isNarrowShell()` / `style.css`):

| Width | Nav | Channel details |
|-------|-----|-----------------|
| **≤900px** | Full-screen rail + sidebar under a sliding main sheet (`#app.nav-open` translates `.main`) | Overlay (blocks main) |
| **≥901px** | Rail + sidebar always visible | Docked column beside main (main stays interactive) |

## Stylesheets

The canonical stylesheet is split into ordered domain modules under `public/styles/`.
`public/style.css` is the **import manifest only** — do not add rules there.

| File | Domain |
|------|--------|
| `styles/00-foundation.css` | CSS tokens (`:root`), light-only theme, global resets |
| `styles/10-forms.css` | Form fields and join flow |
| `styles/20-app-shell.css` | Rail, sidebar, channel panel, settings/help overlays |
| `styles/21-demo.css` | Local `/demo/` chrome bar |
| `styles/30-main-events.css` | Main view, event chat, notifications, events timeline |
| `styles/35-timeline-view.css` | Rolling Timeline mode, month picker, focus tab, event sheet |
| `styles/36-create-draft.css` | In-feed create draft card |
| `styles/37-task-channel.css` | Board Tasks checklist |
| `styles/38-conversations.css` | All chat, event tabs, and board pages |
| `styles/40-cards-deck.css` | Trading cards, deck mechanics, card variants, swipe-create |
| `styles/50-event-detail.css` | Event detail, chains, RSVP, popups, agenda timeline |
| `styles/60-card-hand.css` | Card hand/tray, play-cards, responsive breakpoints |
| `styles/70-admin-settings.css` | Channel admin, settings modals, moderation surfaces |
| `styles/80-open-pitch-share.css` | Open Pitch, pack themes, share/guest microsite, event pass |
| `styles/90-card-share-onboarding.css` | Card share sheet, FTUE, tutorial panel, coaching hints |

All chat is the board home. Timeline is the schedule page, opened from board pages. Month, Week, and Day remain archived.

**Authoring rules:**
- Edit component files in `styles/` only.
- Follow [`../design-system/`](../design-system/README.md) and use its tokens (defined in `styles/00-foundation.css`) instead of raw colours, sizes, radii, shadows, layers or timings. Before merging, run `python3 tools/design_token_audit.py --baseline tools/design_token_baseline.json` from the repo root; it fails if raw values grow.
- Preserve import order: cascade-sensitive rules depend on it.
- When adding a module or bumping its content version, update `style.css?v=…` in `index.html` **and** the `CACHE` version in `sw.js`; also add new files to the `SHELL` array in `sw.js` (needed for offline precaching).
- The test fixture at `phlip-hosting/server/src/test/assets/public/styles/` is a minimal stub — keep it a stub, do not copy the full component files there.

## JS module map

Classic `<script defer>` files under [`public/scripts/<domain>/`](public/scripts/) (no bundler). Boot entry (`theme-boot.js`, `register-sw.js`, `sw.js`) stays at `public/` root. Load order inventory: [`SCRIPT-ORDER.md`](SCRIPT-ORDER.md). Smoke checklist: [`SMOKE-CHECKLIST.md`](SMOKE-CHECKLIST.md). Extraction conventions: [`public/_modules/CONVENTIONS.md`](public/_modules/CONVENTIONS.md). Adding a script: [`MAINTENANCE.md`](MAINTENANCE.md).

**Ownership (keys / `S` / globals):** [`public/_modules/ownership.md`](public/_modules/ownership.md).

Per-group notes:

| Group | Doc | Scripts folder |
|-------|-----|----------------|
| channel | [`public/_modules/channel.md`](public/_modules/channel.md) | `scripts/channel/` |
| drive | [`public/_modules/drive.md`](public/_modules/drive.md) | `scripts/drive/` |
| hand | [`public/_modules/hand.md`](public/_modules/hand.md) | `scripts/hand/` |
| render | [`public/_modules/render.md`](public/_modules/render.md) | `scripts/render/` |
| ownership | [`public/_modules/ownership.md`](public/_modules/ownership.md) | — |
| storage | [`public/_modules/storage.md`](public/_modules/storage.md) | `scripts/boot/storage.js` |
| dom-events | [`public/_modules/dom-events.md`](public/_modules/dom-events.md) | `scripts/boot/dom-events.js` |
| ui-confirm | [`public/_modules/ui-confirm.md`](public/_modules/ui-confirm.md) | `scripts/boot/ui-confirm.js` |
| share-url | [`public/_modules/share-url.md`](public/_modules/share-url.md) | `scripts/share/share-url.js` |
| crypto pair | [`public/_modules/crypto.md`](public/_modules/crypto.md) | `scripts/boot/crypto*.js` |
| personal-space | [`public/_modules/personal-space.md`](public/_modules/personal-space.md) | `scripts/personal/` |
| demo | [`public/_modules/demo.md`](public/_modules/demo.md) | `scripts/demo/` |

When adding a JS file: follow [`MAINTENANCE.md`](MAINTENANCE.md) (`index.html` + `sw.js` `SHELL`/`CACHE` + docs + smoke).

**Current cleanup status:** see [`../CLEANUP.md`](../CLEANUP.md). Earlier extraction and feature plans are historical. Runtime code lives under `public/scripts/<domain>/`; empty facade scripts are removed.
