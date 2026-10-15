# Avatar

## Purpose

Show who: people in chat, attendance, reactions and people lists. Avatars are always round. Servers use rounded-square rail buttons ([shell.md](shell.md)), so shape alone tells people from places.

## Anatomy

A round container (`--radius-round`) holding one of:

- a **live photo**, when the server's photo setting allows it (off / online only / always)
- an **offline avatar**: an icon on a colour, or a drawing the person made
- **initials**: one or two letters, 700, on a hue pair from `AVATAR_HUES`, picked by hashing the user id

Optional extras: a **presence dot** (8 px `--success`, 2 px ring in the surface colour, bottom-right) and a **reaction badge** (11 px, top-left, decorative).

## Sizes

| Size | Diameter | Initials | Use |
|---|---|---|---|
| Small | 28 px | `--fs-caption` (11 px) | Stacks on rows and in attendance, event-sheet chat |
| Medium | 36 px | `--fs-body-sm` (14 px) | Chat groups, people rows |
| Large | 56 px | `--fs-display` (22 px) | Profile previews |

## Rules

- **CMP-avatar-1 — Round for people, square for places.** Avatars are round; server icons are rounded squares (LAY-10).
- **CMP-avatar-2 — Initials are text.** Every hue pair must reach 4.5 : 1 between initials and background.
- **CMP-avatar-3 — Three sizes.** 28, 36 and 56 px only, with initials at roughly 40 % of the diameter.
- **CMP-avatar-4 — Stacks.** Faces overlap by 8 px (at 28 px) with a 2 px ring in the colour of the surface beneath. Show at most four, then "+*N*" (`--surface-3` fill, `--text-secondary`, `--fs-caption`, 700).
- **CMP-avatar-5 — Presence where it matters.** A presence dot appears only where live presence is useful (people lists, your own chip), and is never the only signal: people lists also say "Online".
- **CMP-avatar-6 — Named once.** A photo's `alt`, or the initials' `aria-label`, is the person's name — unless the name is printed right beside the avatar, in which case the avatar is `aria-hidden`.
- **CMP-avatar-7 — Privacy.** An avatar shows only what the server's photo setting allows. The component never uploads anything itself (PRI-2).

## Current implementation

- `.avatar` (`styles/30-main-events.css:330`): 36 px rounded square (radius 11), 14 px bold initials.
- `.avatar-sm` (`styles/50-event-detail.css:646`): 26 px, radius 8, −8 px overlap, 2 px ring; `.avatar-more` for "+*N*".
- Event-sheet chat `.edc-av` (`styles/35-timeline-view.css:1548`): 28 px round.
- `AVATAR_HUES` and `hueFor(uid)` (`scripts/helpers/helpers-part1.js`): six background/initials pairs. Three are below 4.5 : 1 — `#f0c9a9`/`#8a4a1e` 4.43, `#a9dcc0`/`#1e6a44` 4.28, `#e2cdb3`/`#7a5a34` 4.08.

## Gaps

GAP-25 (rounded-square avatars and the 26 px size), GAP-38 (three hue pairs below 4.5 : 1).
