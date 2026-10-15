# Navigation

How people move between servers, boards, views and events — and how they get back.

Owner decision, 2026-10-10: a server defines the overall group; boards are chat entry points. Tapping a board opens **All chat**, the feed of that board’s messages and events. Event tabs filter that same feed. **Timeline** is a secondary schedule page, opened from board pages, not a second home. Pinned location/person boards and the device calendar stay Timeline-only. “Channel” remains an implementation term. The server icon (or initials fallback) appears beside Back on narrow screens, with the server name in the accessible label. Board rows and pinned location/person entries use a 40 px touch rhythm. The 2026-09-19 conversation list (General + event rows, Chats / Events dock) is retired; see `archive/web/I-conversation-list/`.

## Structure

```
Server rail            Personal space · each server · + add        switch spaces
└─ Channel sidebar     server head (menu) · Memories ·            choose a board
                       Welcome · Boards · Pinned locations /
                       people · you
   └─ Main pane        All chat (board home), or Timeline (schedule page)
      ├─ Event tab     The same All chat feed, filtered to one event
      ├─ Board pages   People · Timeline · Tasks · Polls
      ├─ Event sheet   Chat · attendance · description             Timeline page
      │  └─ Quick menu · pickers
      ├─ Draft card    + FAB (from Timeline, or board create)
      ├─ Server info   About, roles, staff — from the server overlay  full page
      └─ Channel panel My calendar · People · Notifications        supporting pane
Settings               User / Host / Server settings: side overlay in the sidebar
                       Board settings: pull-up sheet (long-press a board header)
                       Channel settings: pull-up sheet (long-press Welcome or pinned)
                       Hosting setup: native Android screens
```

## Rules

- **PAT-navigation-1 — Four levels, one order.** Server (rail) → board (sidebar) → All chat or Timeline → event (tab in All chat, or sheet on Timeline). Supporting surfaces — the channel panel and side overlays — never add a level.
- **PAT-navigation-2 — Navigation is always one tap away.** On wide screens the rail and sidebar are always visible. On narrow screens they sit under the main sheet and come back through the menu button, a left→right swipe on the main sheet, or Back. The menu button is always visible in the main head; first-run coaching may point at the swipe but never replaces the button.
- **PAT-navigation-3 — Choosing a board lands on All chat.** Events appear in that feed as tabs and cards. Board pages open People, Timeline, Tasks, and Polls. Pinned location/person boards still open Timeline. On narrow screens the nav slides away.
- **PAT-navigation-4 — One switch point per concept.** Servers switch only in the rail, boards only in the sidebar. All chat vs Timeline is a board page, not a second home. List / Timeline / Cards stay in the board ⋮ while Timeline is open. The grid icon is My calendar, not Timeline.
- **PAT-navigation-5 — Always say where you are.** The main head shows the board name on All chat and Timeline, and `Welcome` for the lobby. An event tab keeps the board name and names the event in the feed. The server is on the menu button on narrow screens and as "Server · board" on wide ones. Long titles truncate before head actions are pushed off.
- **PAT-navigation-6 — Cross-server views don't hijack.** My calendar and Notifications span servers but never navigate away silently. My calendar is read-only, with one bridge — "Show in timeline" — that moves the current board's Timeline page to the chosen date.
- **PAT-navigation-7 — Personal space comes first.** It is always the first rail item and the default landing (`Nav.landDefault`).
- **PAT-navigation-8 — Deep links build the stack.** An event link opens its server, then its board's All chat (or Timeline if that page was showing) with that event filtered, so Back walks up through them (PLT-11, INT-6).
- **PAT-navigation-9 — Go through `Nav`.** Views change through `Nav.set` / `Nav.openChannel` / `Nav.openEventDetail`, never by writing `S.activeView` directly.
- **PAT-navigation-10 — Back from Timeline returns to All chat**, not the sidebar and not a conversation list. Closing the Timeline event sheet returns to the Timeline page. Clearing an event tab returns to the unfiltered All chat feed.

## Narrow and wide

| | Narrow (≤ 760 px) | Wide (≥ 761 px) |
|---|---|---|
| Rail and sidebar | Under the main sheet; revealed by the menu button, a swipe, or Back | Always visible |
| Main head | Menu button (showing the server) + board name (or General) | "Server · board" |
| Channel panel | Overlays from the right, 300 px; closes on outside tap, swipe or Back | Docks as a 300 px column; the main pane stays usable |
| Settings (side overlay) | Fills the sidebar, which is full screen while the nav is open | Fills the sidebar column |
| Event sheet | Full width below the focus gutter | The 620 px content column |

## Current implementation

`scripts/shell/nav.js` (`Nav`), `scripts/shell/panel.js` (`Panel`), the narrow shell in `styles/20-app-shell.css:517`, and swipes in `scripts/channel/channel-panel-gestures.js`. Sidebar boards live in `scripts/render/render-sidebar.js`. All chat is `scripts/channel/board-home.js` inside `renderChat`. Board landing and page switches live in `scripts/channel/channel-board-nav.js`. Timeline reuses `renderTimelineView`.

## Gaps

GAP-1 and GAP-2 (Android Back), GAP-20 (the rail is labelled "Groups"), GAP-34 (no URL state in browsers).
