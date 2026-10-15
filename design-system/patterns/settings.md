# Settings

Where settings live, and how settings screens behave.

## Placement

| If the setting changes… | It lives in | Opened from |
|---|---|---|
| How I use Phlip on this device: profile, avatar, sound, backup, reset | **User settings** (full-screen overlay) | The account chip in the user panel at the foot of the sidebar |
| This server, for everyone: name, roles, permissions, event types, locations, retention | **Server settings** (nested pane on the server overlay; admins) | Settings on the server-head overlay |
| One group: visibility, who can post, linked agendas, icon | **Group settings** (pull-up sheet) | Long-press the group, or the channel panel's settings action |
| One event | **Edit** in the draft card | The event's quick menu or the sheet's ⋮ |
| What the Timeline shows: RSVP filters, board options | **View options** (popup) | The Timeline head's ⋮ |
| This server’s hosting: reach (Local / Direct / Public / On this device), Hosting setup, approved networks, backup, delete, start/stop on this phone | **Hosting this server** (side overlay) | The reach control in the sidebar head (dot · type · server icon) |
| Help, legal, contact | **Help & Legal** | The sidebar (above Leave), the server overlay, and the join dialog |

## Rules

- **PAT-settings-1 — Never in primary navigation.** Settings are not a rail item or a sidebar group. They open from the user panel (full-screen profile overlay), the server-head overlay or the object itself.
- **PAT-settings-2 — Say whose settings these are.** Every settings surface names its scope in its title: you, this server, this group or this event.
- **PAT-settings-3 — Settings live with their object.** Per-group and per-event settings sit on the group or event. Per-server hosting (type, Hosting setup, approved networks, backup, delete, start/stop) sits on that server’s hosting page. Create a server from the rail +.
- **PAT-settings-4 — Changes apply at once.** A setting saves as soon as it changes, confirmed inline. Only consequential changes — going Public, deleting data — ask first ([destructive-actions.md](destructive-actions.md)).
- **PAT-settings-5 — Explain in place.** Each row can carry one line of helper text under it. Explanations belong there, not in confirm dialogs.
- **PAT-settings-6 — Danger comes last.** Destructive settings (Leave server, Delete server, Full reset) sit at the end of their surface, after a divider, labelled in `--red-text`.
- **PAT-settings-7 — Help stays put.** Help & Legal is always in the sidebar above Leave and in the join dialog (WCAG 3.2.6).
- **PAT-settings-8 — Privacy settings state their effect.** Any setting that changes who can see what says so in one line (for example live profile photos).
- **PAT-settings-9 — Native and web are one app.** Native Android screens use the same tokens (PLT-7), the same row pattern ([list-row.md](../components/list-row.md)) and the same words.
