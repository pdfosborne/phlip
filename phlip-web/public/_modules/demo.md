# Demo mode

Local-browser interactive demo: same SPA, no host, no `/ash-rpc` / WebSocket.

## Public functions (global)

- `isDemoMode()` — `theme-boot.js` (also skips `data-served-host`)
- `DemoMode` — namespaced `localStorage` (`phlip-demo-*`) while the demo is active
- `DemoStore` — Dexie `phlip-demo-v1` snapshots (`me`, `nav`, `conns`, `fixtureVersion`)
- `DemoFixture.build()` — Personal + Friends / Home / Tennis / Reading, dates relative to now; also `links` for feed maps
- `DemoFixture.VERSION` — bump to replace stored snapshots (same as Reset)
- `DemoBoot.start()` / `DemoBoot.resetDemo()` — boot + Reset card above the sidebar account chip; demo server names keep a `· Demo` tag

## Load order

`theme-boot.js` → `storage.js` → `demo-mode.js` → Dexie → `demo-store.js` → … → `demo-fixture.js` → `demo-boot.js` → `wireboot.js`

## Seeded spaces (`fixtureVersion` 3)

| Space | Event groups | Chats | Pins | Links |
|-------|--------------|-------|------|-------|
| Personal | My plans, Home, Tennis, All friends | — | Home, Study | Home → family all home; Tennis → club social; All friends → Friends plans + Reading meetings |
| Friends | plans, weekends, inner circle (private) | matching chats (inner private) | Pub, Friend's Place | same-server agenda↔chat |
| Home | all home + meals / outings / chores | one family chat | Mum, Dad (people) | children indent under all home; all home merges them |
| Tennis club | Team A, Team B, social, committee (private) | matching team / social / committee chats | Indoor courts, Park courts | agenda↔chat per team |
| Reading group | meetings | discussion, picks, off-topic | — | — |

Private allow-lists include You. Ada is off Friends inner circle; Nia is off Tennis committee.

Cross-server consolidation is not stored on channel objects. Fresh fixture / Reset / version mismatch calls `setLinkedEventSources` into demo-prefixed `ash_linked_event_feeds_v1`. Matching-version reloads keep whatever links the user changed.

## State owned

| Store | Keys |
|-------|------|
| IndexedDB `phlip-demo-v1` | conn snapshots, `me`, nav, `fixtureVersion` |
| `localStorage` `phlip-demo-*` | first-paint / device prefs, linked feeds / chat mirrors |
| SW cache `phlip-demo-shell-vN` | static shell on `demo.phlipapp.com` |

Never writes unprefixed `ash_personal_v1`, `ash_servers_v1`, or `ash_me` on `phlipapp.com`.
