# Choosing a surface

Pick the lightest surface that does the job (PRI-11). Each step down this table costs the person more context.

| Need | Surface | In Phlip |
|---|---|---|
| Change one small thing where it is | Inline | Toggle a filter, edit a field in place, the inline confirm strip |
| Pick an action for one object | Quick menu or popover | Event actions, view options, the month picker |
| See or discuss one event | Event sheet | Chat, attendance, description |
| Create or edit an event | Draft card in the feed | + FAB, tapping an empty day |
| Keep information beside the board | Channel panel | My calendar, People, Notifications |
| Read this server’s about, roles, and staff | Full page | Server info, from the server-head overlay |
| Change settings for me or this server | Side overlay in the sidebar | User settings; this server’s hosting page |
| Change settings for one group | Modal bottom sheet | Channel settings (long-press a group) |
| Pick a value | Modal bottom sheet (picker) | Time dial or wheel |
| Confirm something irreversible, or enter one value | Dialog | Leave & delete my data, a rename prompt |
| A long multi-step task | A dedicated flow or native screen | Join, create a server, hosting guide, host setup, Cloudflare setup |

## Rules

- **PAT-surfaces-1 — Lightest first.** Use the first row of the table that fits. Moving down a row needs a reason.
- **PAT-surfaces-2 — Create in the feed.** Events are created in the draft card, never in a dialog.
- **PAT-surfaces-3 — Detail lives in the event sheet.** There is no separate event page.
- **PAT-surfaces-4 — Stack at most three.** One sheet, one menu and one dialog at a time, in that z-order (a menu over a sheet, a dialog over both). A picker may open over a sheet; only a confirm opens over a dialog.
- **PAT-surfaces-5 — Reference surfaces are non-modal.** Anything people consult while working elsewhere (the channel panel) must not block the board on wide screens.
- **PAT-surfaces-6 — Every overlay is on the back stack** (INT-6) and dismissible the ways INT-9 lists.
- **PAT-surfaces-7 — Big means flow, not modal.** An overlay that would need most of a wide screen becomes a flow or screen instead.
