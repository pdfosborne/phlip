# RSVP

Answering an invite is the most frequent decision in Phlip, so it gets the most care: one tap, instant, forgiving.

## States and presentation

| State | Timeline presentation | Right-hand accessory | Title |
|---|---|---|---|
| **Invited** | Invite card (min 132 px): 46 px icon frame, title, "by *name*" (11 px), time in Tier 1 + place, a "Check conflicts" link; a 42 px Going circle and a quiet Can't go mark | — | `--fs-body`, 400, `--text-primary` |
| **Going / Maybe** | Compact row (min 48 px): time · icon frame · title · accessory | Chat, with message count and unread dot | `--fs-body-sm`, 400, `--text-primary`; 700 while unread |
| **Organising** | Compact row | People icon with going count, plus the unread dot when there's new chat | As Going |
| **Can't go** | Declined row on the canvas: time · × · title, no metadata | — | `--text-muted` |

## Rules

- **PAT-rsvp-1 — Emphasis belongs to the decision** (PRI-14). Only invited events get the large card and the Tier-1 time; answered events go quiet.
- **PAT-rsvp-2 — One tap answers.** The circle commits Going and the × commits Can't go, both optimistically (INT-12).
- **PAT-rsvp-3 — Forgiving, never interrogating.** Every RSVP change shows a snackbar with Undo for 6 s ("Going · Undo", "Can’t go · Undo"). It can be changed later from the quick menu's Change RSVP. No confirmation dialogs.
- **PAT-rsvp-4 — Reward going, not declining.** Going plays the RSVP-confirm sequence ([05-motion.md](../05-motion.md#rsvp-confirm--invite-card--going)). Can't go collapses quietly into the declined row (`--dur-base` fade).
- **PAT-rsvp-5 — Declined stays reachable.** Declined rows stay in the feed so the choice can be changed, but they aren't auto-focused on the focus line.
- **PAT-rsvp-6 — Check conflicts without leaving.** "Check conflicts" opens My calendar at the event's date in conflict mode: a proportional day view with the proposed event outlined in periwinkle (not the confirmed treatment). A personal event can be added there, and the view updates at once. Nothing navigates away from the group.
- **PAT-rsvp-7 — Attendance shows the live count.** The sheet's second tab reads "*N* going". Its list groups Going, Maybe, Can't go and Invited.
- **PAT-rsvp-8 — Maybe where offered.** Maybe appears in Change RSVP wherever the event allows it, and can be hidden with the view options.
- **PAT-rsvp-9 — Same words everywhere.** Buttons use the state names — Going, Maybe, Can’t go (CNT glossary). "Accept" and "Decline" are for requests.

## Current implementation

- Invite card, compact and declined rows: `styles/35-timeline-view.css:573–930`.
- Resolve on tap: `scripts/channel/channel-timeline-view.js:915–935` (adds `is-resolving`, sends, re-renders after 260 ms).
- Change RSVP submenu (Going / Can’t go): `channel-timeline-view.js:2160`.
- Conflict mode: `scripts/channel/channel-panel-calendar.js` (`conflict-*` classes).

## Gaps

GAP-12 (declined text muted by opacity), GAP-13 (30 px × mark), GAP-20 (Accept/Decline labels), GAP-29 (the confirm sequence is cut short).
