# 00 · Principles

What Phlip optimises for, and the budgets every feature is held to. The other modules turn these into concrete rules.

## Product principles

From the owner's product principles in `CONTEXT.md`. They settle trade-offs before any visual rule does.

- **PRI-1 — Events first.** The event is the core object. All chat is how a board shows its events; Timeline is the schedule page. Surfaces, emphasis and shortcuts favour planning, deciding and turning up.
- **PRI-2 — Private by construction.** Group data lives on a friend's phone, not a company server. The UI never implies otherwise (no "cloud", no public-feed mechanics) and makes exposure visible when it happens: Public hosting, Broadcast live dots.
- **PRI-3 — One client everywhere.** The same web client runs in the Android app, the iOS shell, host-served browsers, the demo and guest microsites. A feature is designed once, for every shell ([08-platforms.md](08-platforms.md)).
- **PRI-4 — Safe and easy to join.** Joining, approving and signing in stay short and legible. Consent screens are explicit and never use dark patterns.

## Design principles

- **PRI-5 — One mental model, two input skins.** Names, structure, icons and state are identical everywhere. Mechanics follow the input: *touch* (coarse pointer: Android, iOS, phone browsers) or *pointer* (fine pointer with hover: desktop browsers). Detect the input with media features, never the user agent.
- **PRI-6 — Design for the 500th time.** Feedback that fires on every plan must still feel good at the fiftieth repetition. Prefer a quiet, well-timed response to spectacle; one reward beats many small ones.
- **PRI-7 — Clarity is the brand.** Atkinson Hyperlegible, AA contrast, one meaning per colour, sentence-case labels. Warmth comes from colour, shape, motion and the numerals system, not decoration.
- **PRI-8 — Undo, don't interrogate.** Recoverable actions happen immediately and offer Undo. Confirmation dialogs are for actions that are irreversible, touch other people's data, or would take real effort to redo ([patterns/destructive-actions.md](patterns/destructive-actions.md)).
- **PRI-9 — The system owns the edges and Back; the keyboard owns the desktop.** Android Back, the iOS edge swipe, Escape and browser Back all walk the same in-app stack ([06-interaction.md](06-interaction.md#back-stack)).
- **PRI-10 — Never hide the only path.** Every gesture, long-press, hover reveal and drag has a visible, single-pointer, keyboard-reachable equivalent.
- **PRI-11 — Preserve context.** Use the lightest surface that works — inline, then a menu, then a sheet or side panel — before a modal. Creation happens in the feed, not in a dialog ([patterns/surfaces.md](patterns/surfaces.md)).
- **PRI-12 — Motion explains; it doesn't decorate.** Every transition shows where something came from or where it went. Ambient animation is rare, quiet and stops when unseen.
- **PRI-13 — Depth marks "current"; colour marks meaning.** The focused Timeline row lifts. Periwinkle means selected or confirmed, notify-blue means unread chat, and black marks the primary action.
- **PRI-14 — Emphasis belongs to the decision.** An undecided invite gets the loud treatment (large card, Tier-1 time). Once decided, its row goes quiet.
- **PRI-15 — Honest state.** Optimistic updates must reconcile or visibly roll back. Never fake an interaction that isn't wired; fall back to an honest message instead.
- **PRI-16 — Never rebuild under the finger.** Live updates that arrive during a pointer or scroll interaction wait until it ends, and must not re-render the element being touched (the Timeline's `timelineRefreshPending` queue).

## Performance budgets

"Natural and fluid" is a budget. A regression against these numbers is a bug (Responsiveness program in `CONTEXT.md`).

| Budget | Target |
|---|---|
| Visible response to any input | < 100 ms; event-handler work ≤ 50 ms |
| Animation or gesture frame | 16 ms per frame, ≤ 10 ms of script, style and layout work |
| Main-thread task while a gesture is active | ≤ 50 ms; P95 gesture work < 2 ms |
| UI transitions | 120–280 ms ([05-motion.md](05-motion.md)) |
| Signature sequences (RSVP confirm, create landing) | finished within 1.5 s; the state change is committed at the tap, not at the end of the animation |
| Network actions | optimistic state immediately, or an inline spinner from 100 ms; skeleton after 1 s; cancel or retry after 10 s |
| Acceptance devices | a three-year-old mid-range Android phone and an iPhone 12 |

## Review heuristics

Use these when reviewing a design or a pull request:

- **Nielsen's heuristics**, especially visibility of system status (sync dots, the reconnect banner), user control and freedom (Undo, Back), consistency (same component, same place), error prevention, and recognition over recall.
- **Fitts's law.** Frequent actions are big and near the thumb: the + FAB sits bottom-right; RSVP Yes is the largest target on an invite.
- **Hick's law.** Keep choices short: quick menus hold at most seven items, grouped; prefer progressive disclosure to walls of options.
- **Jakob's law.** Honour the conventions people bring: a Discord-style server rail and channel list, Android Back, the iOS edge swipe, Escape to close.
- **The 50-times test** (`feature-planning/aug-2026/phlip-feel-plan.md`). Repeat the interaction fifty times; anything irritating by the tenth is wrong, however good it felt once.
