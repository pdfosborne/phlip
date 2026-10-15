# Ownership map (Phase 5 + atomic follow-up)

Concise map of persistence keys, `S` substate, and module boundaries. Runtime files live under `public/scripts/<domain>/` (basenames in tables below). Per-group APIs: [`channel.md`](channel.md), [`hand.md`](hand.md), [`render.md`](render.md).

## localStorage keys (device-only)

| Key | Owner | Notes |
|-----|-------|-------|
| `ash_custom_cards_v1` | `hand-storage.js` / deck editor | Personal custom event-type cards |
| `ash_personal_card_icons_v1` | `hand-cards.js` | Built-in card icon overrides |
| `ash_personal_removed_cards_v1` | `hand-storage.js` / deck editor | Hidden built-in labels |
| `ash_card_usage_v1` / `ash_cat_usage_v1` | `hand-storage.js` | Learned defaults (stats) |
| `ash_typed_backlog_v1` | `hand-typed-backlog.js` | One-off places/titles |
| `ash_locations_v1` | `hand-locations.js` | Saved places |
| `ash_day_ink_v1` | `hand-core.js` | Day numeral ink preset |
| `ash_personal_categories_v1` / `ash_personal_card_cats_v1` / `ash_personal_card_durs_v1` / `ash_personal_event_types_v1` | hand create / deck editor | Personal deck schema |
| `ash_supporter_v1` | `render-cosmetics.js` | Supporter cosmetics |
| `ash_event_card_styles_v3` | `event-card-styles.js` / `render-cosmetics.js` | Active event-card preset and device-local custom presets (current v3 format) |
| `ash_me_named` | `render-user-settings.js` | Display-name prompt flag |
| `phlip-demo-*` / IndexedDB `phlip-demo-v1` | `scripts/demo/*` | Local `/demo/` snapshots and namespaced prefs; never `ash_servers_v1` |
| `ash_memories_v1` / `ash_event_archive_v1` | `channel-memory.js` | Local memory photos / archive |
| `ash_plan_anchor_v1` | `board-from-chat.js` | Per-message "other date" pick for an ambiguous "next <weekday>". Dates themselves resolve from each message's send time |
| `ash_host_name_override_ack_v1` | `channel-shell.js` / host chrome | Host-name override ack |
| `ash_feel_prefs_v1` | `core.js` | Feel / sound prefs |
| `ash_servers_v1` | `net-part1.js` / `drive-conn.js` | Joined servers. Drive rows store folder ids + Google account, never a host URL/token |

Prefer `storageGetJson` / `storageSetJson` / `storageGetText` / `storageSetText` / `storageRemove`, or hand `loadJSON` / `persistJSON`. **Do not change key names or schemas in consolidation passes.**

## `S` substate (high signal)

| Field | Primary owners |
|-------|----------------|
| `S.conns` / `S.activeConnId` | `core.js`, rail `switchConn` |
| `S.activeView` / `S.activeEventChannelId` | nav / channel / render |
| `S.boardSurfaces` / `S.boardChatHome` / `S.conversationsReturn` | `channel-board-nav.js` |
| `S.boardSelect` | `board-select.js` — long-press selection `{ ids, anchorId, reacts, addOpen, query }`. Replaces the removed `S.boardConnect` (chain pick) and `S.boardAddPick` (rail add dots) |
| `S.boardEventNavOpen`, `S.boardEventStep` | `board-event-nav.js` — event jump list open; stepper state `{ eventId, returnAnchor, quietUntil }`. Cleared by jump-to-latest, ✕, scrolling to the bottom, Android back (returns to where you were), or leaving plain All chat |
| `S.boardFromChat` | `board-from-chat.js` — event draft from chat; `words[field].picks` is `[{ msgId, idx }]` in tap order, `primaryId` is the title's source message |
| `S.anchor` | hand timeline + channel agenda |
| `S.hand` | draft card (`mode: "createDraft"`) and old create helpers |
| `S.draft` / `S.draftsByConn` / `S.draftFollowups` | hand create + rail draft handoff |
| `channelPanelState` (module global) | `channel-panel-state.js` |
| `sideOverlayKind` / `sideOverlayBeforeClose` / `sideOverlayOnBack` | `render-side-overlay.js` |

## Global function boundaries

| Concern | Entry globals | Cluster |
|---------|---------------|---------|
| Shell paint | `renderAll`, `renderRail`, `renderSidebar` | `render-*` |
| Demo boot | `isDemoMode`, `DemoBoot.start`, `DemoStore`, `DemoFixture` | `scripts/demo/` |
| Personal rail icon | `ic("user-lock")` on the personal rail button | `render-rail.js` |
| Overlay | `openSideOverlay`, `closeSideOverlay`, `sideOverlayGoBack`, `refreshSideOverlay` | `render-side-overlay.js` |
| Back / Escape | `ashBack` / `window.ashBack` | `shell/ash-back.js` |
| Gesture constants | `AshGesture` (`TAP_SLOP`, `HOLD_MS`, `axisLocked`, `shouldCommit`, `PRESSED_SEL`, …) | `boot/ash-gesture.js` |
| Toast / snackbar | `AshFeedback` (`toast`, `snackbar`, `commitSnackbar`, `hasSnackbar`); global `toast()` | `boot/ash-feedback.js` |
| Channel panel | `renderChannelPanel`, `openChannelPanelMode` | `channel-panel*.js` |
| Access | `mountChannelAccessControls` | `channel-access.js` |
| View / tickets | `renderView`, `renderFoot`, `renderTasks`, … | `channel-shell` / `channel-tasks` / `channel-view` / ticket / agenda / deck modules |
| Chat | `renderChat`, `openEventChatFiltered`, `collatedChatMessages` | `channel-chat-part*.js` |
| Create | `startFlatTypePick` → `openCreateDraft`, `commitCreateDraft`, `planParse` | `hand-create-draft.js`, `hand-plan-parse.js`, `hand-create-*.js` |
| Net / handlers | connection + message dispatch | `net-part*.js`, `handlers-clone.js`, `handlers-dispatch.js` |
| Join / leave | `openJoinModal`, `openAddServerMenu`, `leaveRemoteServerMembership`, … | `render-join-*.js`, `render-add-server.js` |
| Drive | `createDriveServer`, `joinDriveFolder`, `driveStartSync`, `makeDriveConn` | `scripts/drive/` |
| Hosting | `openHostSettingsPanel`, `openHostedServerSettings`, `openHostingGuide`, `buildHostAckCard` | `host-settings-*.js`, `hosting-guide.js` |
| Deck editor | `openPlacesManager`, `openDrawingsManager`, icon picker | `render-deck-icons.js`, `render-deck-editor-body.js` |
| Share card | Share export | `sharecard-part*.js` |

Thin facades (`channel.js`, `hand.js`, `hand-create.js`, `sharecard.js`, `channel-chat.js`, `net.js`, `helpers.js`, `handlers.js`, `host-settings.js`, `hotspot-join.js`, `render.js`) remain for load-order stability until call-site audits allow deletion.

## File size ceiling

Target **300–700 lines** where practical. Documented exceptions (cohesion or unsafe mid-function split):

| File | ~Lines | Why |
|------|-------:|-----|
| `channel-ticket-cards.js` | 765 | Ticket HTML builders |
| `handlers-dispatch.js` | 1673 | Cohesive `handle()` switch |
| `render-join-modal.js` | 1281 | Single `openJoinModal` flow |
| `render-deck-editor-body.js` | 1651 | Cohesive deck editor UI |
| `backup.js`, `core.js`, `personal.js`, `wireboot.js`, `microsite.js`, `event-pass.js`, … | — | Outside follow-up Part 3 backlog; revisit later |
| `channel-event-panel.js` | ~1850 | Event facts, place editor, and the non-board event picker |

Part 3 also used mechanical `*-partN.js` splits for `pitch`, `sharecard`, `channel-chat`, `net`, `helpers`, `host-settings`, `hotspot-join` (named domain renames preferred in a later pass). Join / deck / handlers use named modules (`render-join-*`, `render-deck-*`, `handlers-clone` / `handlers-dispatch`).
