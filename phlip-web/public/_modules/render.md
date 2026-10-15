# render (Phase 4 modules)

## Purpose
App shell render (rail/sidebar/overlay), share/join, cosmetics, settings/backup, and deck/roles/locations/plan editors. Classic globals; no ES modules. Entire cluster loads **before** `channel-*.js`.

## Location
`public/scripts/render/` (after `scripts/shell/served.js`, before `scripts/channel/`).

## Files (load order after `served.js`, before `channel-access.js`)

| File | Role |
|------|------|
| `render-core.js` | `renderAll()` orchestration |
| `render-rail.js` | `switchConn`, rail chrome, logos, reachability, `syncDocumentTitle` |
| `render-side-overlay.js` | Overlay lifecycle + `openServerSharePanel` / `sideOverlayGoBack` |
| `render-share.js` | Invite URLs, share sheet, `formatShareCode` / `composeJoinCode` |
| `render-host-console.js` | Console toggles + setup-guide modal |
| `render-help.js` | Served Legal/Help/docs/powered-by |
| `render-sidebar.js` | Sidebar render, pointer freeze, `openSideDestination` |
| `render-sidebar-reorder.js` | Long-press → channel settings sheet; reorder mode drag; `nudgeSidebarChannel` (Move up / down) |
| `render-cosmetics.js` | Theme/Style/Cards modal |
| `render-backup.js` | Personal backup export/restore flows |
| `render-user-settings.js` | Profile fields, server options, factory reset, server icon |
| `user-profile-overlay.js` | Full-screen Discord-style profile overlay from the account chip |
| `render-join-parse.js` | Invite URL/code parse, host recall, bootstrap helpers |
| `render-join-modal.js` | `openJoinModal` + `ashJoinFromUrl` (size exception ~1281) |
| `render-add-server.js` | Rail + create-first menu (`openAddServerMenu`) |
| `render-join-leave.js` | Leave / disconnect / remove membership |
| `render-deck-icons.js` | Category icon picker |
| `render-deck-editor-body.js` | Place and drawing managers |
| `render-roles.js` | Role colors + roles editor |
| `render-locations.js` | Locations registry + pin pickers |

## Dependencies
- Must load after: `served.js`, `modal.js`, `nav.js`, helpers used by editors
- Must load before: all `channel-*.js` (panel uses share; console uses host-console fills)
- `renderView` / `renderFoot` / console panel mount live in `channel-view.js` / `channel-shell.js` / `channel-console.js` (follow-up Part 2)

## Notes
- `switchConn` stays with rail (draft handoff + forced refreshes).
- Server-icon editor is in user-settings (not plan-modal), per plan §15.
- Join-code **format**/`compose*` live in share; **parse** sections live in join.
