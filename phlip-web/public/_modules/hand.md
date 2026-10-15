# hand (Phase 3 + follow-up Parts 1 / 3)

## Purpose
Card definitions, current in-feed create/edit flows, date helpers, routines, and planning preferences. The card tray is archived (`archive/web/E23-card-hand-open-pitch/`). Classic globals; no ES modules.

## Location
`public/scripts/hand/` (loaded after `scripts/share/event-ics.js`, before `scripts/late/splash.js`).

## Files (load order after `event-ics.js`, before `splash.js`)

### Data / timeline (Phase 3)

| File | Role |
|------|------|
| `hand-storage.js` | `loadJSON`, custom cards, usage counts / learned defaults |
| `hand-categories.js` | Categories, palette, server-vs-personal event types |
| `hand-cards.js` | `EVENT_CARDS`, accent/tab/badge HTML, icon overrides |
| `hand-typed-backlog.js` | Typed place/title history per server |
| `hand-locations.js` | Saved places, location cards |
| `hand-availability.js` | Open-availability rows / composer |
| `hand-agenda-week.js` | Date helpers kept from the archived Month / Week / Day views (week start, day labels, weekend check, create-day seed, date divider) |

### Create flow (Part 3)

| File | Role |
|------|------|
| `hand-create-entry.js` | `startFlatTypePick` (FAB → draft card) + event-type lists |
| `hand-create-swipe-model.js` | Draft-card shared helpers (dirty slots, post readiness, FTUE filters, icon commit, day rebase) |
| `hand-create-time.js` | Clock NLP + 15-minute start/end grid |
| `hand-plan-parse.js` | Deterministic chat/paste parser → draft fields; Paste control; plan-candidate mark |
| `hand-create-draft.js` | In-feed draft card |

The old create / edit flow (swipe sheet, building card, confirm, edit and repeat panel, Plan Something) is archived (`archive/web/B-old-create/`).

### Shared event helpers

| File | Role |
|------|------|
| `hand-core.js` | Onboard emit, day ink, duration helpers (`DAY_MS`, …) |
| `hand-reactions.js` | Reaction catalog, stacks, emoji encode and chips |
| `hand-share.js` | Share targets, people list, `activeEventChannel`, icon / label checks |
| `hand-apply.js` | Event field helpers (details, icon, category) |

The focus band, day grid, week steer, insert gaps and multi-select are archived with the Month / Week / Day views (`archive/web/A-month-week-day/`).

## Dependencies
- Must load after: `render-*.js`, channel modules, card theme helpers used by create UI
- Must load before: `splash.js`, `onboarding.js`, `wireboot.js`
- Shared: `storage.js` (owns JSON persistence; hand aliases it), `core.js` (`S`)

## Notes
- Create modules may call `dayStart` / `ashOnboardEmit` at runtime; those symbols load later in the same deferred batch (call-time resolution).
- Empty facade scripts, tray rendering, borrowing controls and saved tray ordering were removed in the final-product cleanup.
