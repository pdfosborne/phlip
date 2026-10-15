# 09 · Content

The words in the interface: how Phlip sounds, what it calls things, and how it writes times, dates and messages.

## Voice

- **CNT-1 — Plain, warm, brief.** Write like a friend who's good at organising: short sentences, everyday words.
- **CNT-2 — No jargon.** Never show code terms such as "conn", "slice", "payload", "token" or "channel". Hosting and networking words appear only on hosting screens, and are explained there.
- **CNT-3 — British spelling.** Organiser, colour, cancelled, centre — matching the existing copy.
- **CNT-4 — Sentence case, calm punctuation.** Sentence case everywhere (TYP-11). No exclamation marks in routine UI; no emoji in UI copy.
- **CNT-5 — "You".** Speak to the person as "you". Use "we" only in legal and support text.
- **CNT-6 — One name per thing.** Use the glossary; never introduce a synonym.

## Glossary

| Say | Means | Don't say |
|---|---|---|
| **Server** | A private space someone hosts on their phone for their friends ("Join a server", "Leave server", "Server settings") | Community, workspace, or "group" for the whole server |
| **Host** | The person or phone running a server (this server’s hosting page, "Stop hosting") | "Host" for an event |
| **Organiser** | The person running an event (the host gem) | "Host" or "hosting" for events |
| **Board** | A subgroup within a server, with its own members or purpose | Event group, chat group |
| **Events · Chat · Tasks** | Views within a board; code calls these channels | Channel in user-facing copy |
| **Personal space** | Your own space on this device; not a server | |
| **My plans** | Your personal board | |
| **Event** | Something happening at a time, usually somewhere | "Plan" as an object, meetup |
| **Invited** | An event waiting for your answer | |
| **Going · Maybe · Can’t go** | RSVP answers. Buttons and the states they set use the same words. | Accept or Decline for an event, Not going, Yes/No |
| **Accept · Decline** | Answers to requests only: join requests, pending event approvals | For event invites |
| **My calendar** | Everything you're going to, across servers | |
| **Broadcast** | A guest page for one event, live until it ends | Share |
| **Share** | Send an event's image or pass through the system share sheet | Broadcast |
| **Memories** | Past events | History |
| **Routine** | A reusable event template | Template |
| **Time block** | Time you're busy without an event | |
| **I'm available** | A mark showing when you're free | |
| **Device only · Internet · Drive** | How a server can be reached: only this phone (nobody else can join yet); over the internet; or through a shared Google Drive folder | Tunnel, LAN, Same Wi-Fi, Phone hotspot |

## Formats

| What | Format | Example |
|---|---|---|
| Time | 12-hour, lowercase, no space, no ":00" | 7:30pm · 2pm |
| Time range | Both ends in full, joined by an en dash with no spaces | 2pm–3pm |
| End only | "until" + time | until 9:45am |
| Full date | Weekday, day, month | Thu 24 September |
| Short date | Weekday, day | Fri 11 |
| Relative day | Today · Tomorrow | |
| Count | Numeral + word | 4 going · 12 messages |

- **CNT-7 — One formatter per format.** Build times and dates with shared helpers, never by hand. Time pickers show the same format as the feed (GAP-21). Weeks start on Monday.

## Microcopy patterns

- **CNT-8 — Buttons are verbs.** Add an object when it helps: "Save", "Add personal event", "Show in timeline", "Delete event". A destructive button names its action, never "OK".
- **CNT-9 — Confirm dialogs.** The title asks the question about the specific thing ("Delete “Film night”?"). The body says what happens and whether it can be undone. The buttons name the choices ("Delete" / "Cancel").
- **CNT-10 — Toasts.** Past tense, what happened, six words or fewer: "Link copied", "Routine saved".
- **CNT-11 — Snackbars.** What happened, plus one verb: "Event deleted · Undo".
- **CNT-12 — Errors.** What happened and what to do, without blame or codes in the main line: "Couldn’t send — check your connection and try again."
- **CNT-13 — Empty states.** One line saying what will appear here, plus the one action that starts it: "No plans yet · New event".
- **CNT-14 — Placeholders are examples, not labels.** "e.g. Film night". Every field also has a visible label.
- **CNT-15 — Numbers.** Use numerals, and get singular and plural right: "1 going", "4 going", "1 message".
- **CNT-16 — Names.** Show people's display names as they set them; show "You" for yourself in lists.
- **CNT-17 — Typographic punctuation.** Use ’ – — “ ” in UI strings, never straight quotes or double hyphens.
