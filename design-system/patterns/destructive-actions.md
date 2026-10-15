# Destructive actions

Undo, don't interrogate (PRI-8). Confirm only when a mistake would hurt someone else or can't be put back.

## Rubric

| If the action… | Then |
|---|---|
| Can be reversed in one step by the person who took it, affects only their own data, and is cheap to redo | Do it now and show a snackbar with **Undo** for 6 s |
| Removes or changes other people's data or access, deletes something permanently, or would take real effort to redo | **Confirm first**: a danger dialog that names what is lost and who is affected |
| Wipes a large amount of data (delete a hosted server, full reset) | Confirm and **type to confirm** (type DELETE to enable the button) |
| Switches a mode with side effects (go Public, start a Direct link, wipe events after they end) | **Explain and confirm**; danger styling only if data is lost |
| Is really a choice between two paths | Offer the **choice** in a menu, sheet or inline control, not an OK/Cancel dialog |

## Rules

- **PAT-destructive-1 — Undo loses nothing for 6 s.** Hide the item locally, show the snackbar, and send the command when the snackbar closes. Where the host has an inverse command (RSVP), send at once and send the inverse on Undo. Navigating away commits.
- **PAT-destructive-2 — Undo restores exactly.** The snackbar names the thing and the action ("Message deleted · Undo"). Undo puts the item back where it was, with focus where it was.
- **PAT-destructive-3 — One pending undo at a time.** A new destructive action commits the previous one.
- **PAT-destructive-4 — Confirm dialogs follow [dialog.md](../components/dialog.md).** A specific question for a title, what is lost in the body, a named destructive button ("Delete", "Remove") and Cancel. Focus starts on Cancel, a scrim tap does nothing, and Escape cancels.
- **PAT-destructive-5 — Deleting an event depends on who's involved.** If anyone else has answered or chatted, confirm. If it's only you, delete and offer Undo.
- **PAT-destructive-6 — Never chain confirms.** No "Are you really sure?". Type-to-confirm replaces a second dialog.
- **PAT-destructive-7 — Keep destruction out of easy reach.** A destructive action is never the default button, never triggered by a long-press alone, and never placed where a thumb rests.

## Today's confirms, classified

All 74 `ashConfirm` call sites (GAP-8), grouped by what they should become. Paths are under `phlip-web/public/scripts/`.

### Switch to Undo — done (2026-09-12)

| Where | Action |
|---|---|
| `channel/channel-chat-part1.js`; `channel/channel-chat-part4.js` | Delete your own message — snackbar Undo |
| `channel/channel-suggestions.js` | Delete your note — snackbar Undo |
| `channel/channel-timeline-view.js`; `render/render-deck-editor-body.js` | Remove or delete a routine — snackbar Undo |
| `channel/channel-chat-part3.js`; `channel/channel-chat-part4.js` | Pin a message (replacing the previous pin) — snackbar Undo |
| `channel/channel-members.js`; `channel/channel-history.js` | Block someone — snackbar Undo; helper text on the Block item |
| `channel/channel-timeline-view.js` | Solo event delete — snackbar Undo (confirm if anyone else is involved) |

Vanished Switch-to-Undo sites (no `ashConfirm` left to convert): remove a time option, remove all your reactions, make a linked event real.

### Keep — danger confirm — 33

| Where | Action |
|---|---|
| `channel/channel-timeline-view.js:2282` | Delete an event — **solo: snackbar Undo (2026-09-12)**; confirm if anyone else RSVP'd or wrote a note (PAT-destructive-5) |
| `channel/channel-multiselect.js:99`, `:286` | Delete several events |
| `channel/channel-moderation.js:308`, `:427`, `:553`, `:569` | Delete groups; delete a reported item; delete someone's message; remove a member |
| `channel/channel-members.js:112` | Remove a member |
| `hand/hand-reactions.js:411`, `:433` | Remove other people's reactions (moderation) |
| `pitch/pitch-part4.js:815` | Remove someone from an event |
| `render/render-roles.js:261` | Delete a role |
| `channel/channel-settings.js:812` | Delete a group |
| `channel/channel-chains.js:272` | Remove an event from a chain |
| `render/render-deck-editor-body.js:964`, `:1241`, `:1425`, `:1440`, `:1451`, `:1544`; `render/render-locations.js:337` | Delete a category, card, reaction card, import, often-typed entry or place |
| `render/render-host-console.js:243` | Remove demo users |
| `late/wireboot.js:30`; `shell/shares-live.js:118`, `:210`; `share/sharecard-part3.js:758` | Stop broadcasting (guests lose the page) |
| `pitch/pitch-part2.js:455` | Call off an Open Pitch |
| `host/host-settings-part1.js:343` | Stop hosting |
| `channel/channel-console.js:179` | Delete chat older than *n* days |
| `helpers/helpers-part3.js:502` | Open a staff-only group to members |
| `personal/backup.js:710`, `:737` | Replace data from a backup |
| `demo/demo-boot.js:101` | Reset the demo |

### Keep — type to confirm — 2

| Where | Action |
|---|---|
| `host/host-settings-part2.js:415` | Delete a hosted server |
| `render/render-user-settings.js:970` | Full reset |

### Keep — explain and confirm — 19

| Where | Action |
|---|---|
| `host/host-settings-part2.js:259` | Rotate your invite link |
| `host/host-settings-part2.js:321`, `:325` | Turn Public on or off |
| `host/hotspot-join-part2.js:216`, `:238`, `:281`, `:310`, `:330` | Direct-link modes |
| `channel/channel-console.js:149` | Wipe events after they end (data is lost: danger styling) |
| `render/render-host-console.js:134` | Turn on pinned people |
| `hand/hand-commit.js:589` | Make someone the organiser |
| `hand/hand-commit.js:1067`; `channel/channel-suggestions.js:509`, `:570`, `:578`; `late/wireboot.js:44` | Lock in a time (clears other people's suggestions) |
| `share/event-pass.js:566` | Post to a group that *n* people will see |
| `render/render-deck-editor-body.js:846` | Merge categories |
| `channel/channel-members.js:410` | One-time notice about overriding a display name |

### Replace with a choice or inline suggestion — 4

| Where | Today | Instead |
|---|---|---|
| `hand/hand-apply.js:133` | "How do these follow-ons relate?" | A two-option menu |
| `helpers/helpers-part4.js:571` | "Someone here is already *name*. Add an initial?" | An inline choice under the name field |
| `hand/hand-typed-backlog.js:448` | "Add “*x*” as a place/card?" | An inline suggestion chip |
| `share/event-pass.js:381` | "This share is long for QR… Show anyway?" | An inline note with "Show anyway" |
