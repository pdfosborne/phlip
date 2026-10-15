# Manual regression + smoke harness

Run the Node self-tests in `phlip-android/tools/`, `node tools/cleanup-selftest.cjs`, `python tools/verify_web_assets.py`, and the browser checks in `tools/verify_add_server.mjs`. Use this checklist for device and integration verification.

## Console smoke harness

Paste in DevTools before exercising flows (or after a hard reload):

```js
(() => {
  const errs = [];
  const wrap = (orig, kind) => function (...args) {
    try {
      if (kind === "error" || (kind === "warn" && /ReferenceError|is not defined/i.test(String(args[0])))) {
        errs.push({ kind, args: args.map(String), t: Date.now() });
      }
    } catch {}
    return orig.apply(this, args);
  };
  console.error = wrap(console.error.bind(console), "error");
  console.warn = wrap(console.warn.bind(console), "warn");
  window.addEventListener("error", (e) => errs.push({ kind: "window.error", args: [e.message, e.filename, e.lineno], t: Date.now() }));
  window.addEventListener("unhandledrejection", (e) => errs.push({ kind: "rejection", args: [String(e.reason)], t: Date.now() }));
  window.__phlipSmokeErrs = () => errs.slice();
  console.info("[phlip-smoke] capturing; call __phlipSmokeErrs() when done");
})();
```

Expect `__phlipSmokeErrs()` empty (or only known benign warnings) after each checklist section.

## Per-shell boot

| Shell | How | Expect |
|-------|-----|--------|
| Personal (app / local) | Open app WebView or local `index.html` | Boots, personal space usable; left-rail personal mark is a static `user-lock` glyph |
| Timeline Create FAB | Idle, scroll, open and close create | Static + button; opens the in-feed draft card; no face morph or tray |
| Multi-server | Connected remote server | Rail switch works |
| Served browser host | Host public/LAN URL | Join gate / served chrome |
| Local demo | `demo.phlipapp.com` or `/?demo=1` | Personal + seeded groups, no join, no `/ash-rpc`; Reset restores fixture |
| Share guest | `/?s=…` microsite | Guest share UI |

## Cross-cutting (every high-risk change)

- [ ] Empty-cache load (DevTools → Application → Clear storage, hard reload) — no `ReferenceError`
- [ ] Offline reload after SW install — shell boots from cache (SHELL paths under `scripts/<domain>/`; CACHE ≥ v263)
- [ ] Root only keeps `theme-boot.js` / `register-sw.js` / `sw.js` among runtime JS; no orphan flat `*.js` at `public/` root
- [ ] Light theme (dark mode is archived)
- [ ] Narrow (≤900px) and wide (≥901px) layouts
- [ ] Rapid open/close panel / modal; pointer cancel — no stuck overlay / listeners
- [ ] Android Back / Escape (`ashBack`): Timeline ⋮, month picker, event sheet (collapse then close), create draft, calendar panel, and side overlay each take one press; empty nav leaves the app; outside-tap on Timeline ⋮ does not fire Locate; ~500 ms sidebar group hold opens channel settings
- [ ] Gestures (`AshGesture`): hosting overlay LTR swipe from chrome or a button goes back; channel-settings drag-down from the head (not only the handle) dismisses at ~25% of height; event-sheet close button closes; handle tap toggles expand; sheet drag commits at ~25% or a flick
- [ ] Pressed / hover (`AshGesture` `.is-pressed`, INT-11 / INT-25): tap FAB, Up chevron, rail, sidebar row, timeline row, or Send shows a press fill/scale within ~100 ms; after lift, hover fills do not stick on touch
- [ ] Feedback (`AshFeedback`): copy-link still toasts; delete your own Welcome message → snackbar Undo restores; delete a solo Tennis event from the sheet ⋮ → Undo restores; Back/Escape with only a snackbar open commits and stays in the app; pin a chat note / Block someone / delete your note / remove a routine → snackbar Undo
- [ ] Channel settings Move up / Move down (INT-5): hold London based → Move down swaps with Open-invite; Move up puts it back; Reorder channels still opens drag mode
- [ ] Message copy (GAP-15): long-press Welcome chat text selects; chrome does not
- [ ] Create sound (GAP-30): FAB create an event plays the confirm on the new row
- [ ] Gestures (GAP-19): slow rail swipe (>700 ms) still cycles server; slow main-sheet LTR still opens nav
- [ ] Event sheet (GAP-6): tabs Chat / Attendance / Description; Close is focused on open; Back restores the focus tab
- [ ] Time block (INT-5): sheet **Edit time**; focused row ArrowUp/Down shifts a timed block by 15 minutes

## Rolling Timeline view

- [ ] List / Cards / Timeline (⋮): desktop wide default is List (no empty days, no focus line); phone default is Timeline; Cards is an explicit stored choice (never auto); ⋮ switches and sticks; List click shows the pull-up tab (not the sheet); empty click or Back hides the tab; tab tap/drag still opens the sheet; Cards shows one Simple face with ‹ ›, swipe inside the deck, tap → sheet, long-press menu; Back closes the sheet then stays in Cards; narrow LTR outside the deck still opens nav, LTR on the deck changes card
- [ ] Timeline is the rolling feed; no Month/Week/Day tabs appear, and Timeline returns to its scroll/focus after passive rerenders
- [ ] Timeline empty, single-channel, meta, linked, filtered, sealed, chained, and far-future feeds
- [ ] Accept/Decline cards transition immediately; Going/hosted/declined compact rows remain accurate
- [ ] Month picker opens, chevron toggles closed, fades the feed (tap feed to dismiss), date taps keep the picker open and unfade that day's events, swipes months without going before this month, and past dates stay disabled
- [ ] Clicking a Timeline event opens the bottom sheet, scrolls the row into view above it, and fades the rest of the feed; scrolling raises the nearest event and peeks the pull-up tab; sheet Chat is event-only with a composer (no Open chat / back to channel chat); Attendance and Description use live event data
- [ ] Header calendar button opens My calendar on every server; Chat / Description / Memories / Notifications tabs are hidden; no channel-global chat in the panel
- [ ] My calendar is the default right-panel tab; mini month + confirmed agenda; Show in timeline jumps the rolling feed; Add personal event lands on My plans without closing the panel
- [ ] Personal sidebar has no All events row; Notifications and Memories are meta items that open the main board; Memories is also a meta item on shared servers
- [ ] Timeline ⋮ has no Create / Show / Enable availability rows
- [ ] Idle Timeline shows the static + FAB and no card-hand tray; FAB click opens the in-feed draft card.
- [ ] FAB is hidden when the user cannot create events; permission-filtered image/share/edit/routine/report/delete actions work on narrow and wide layouts
- [ ] Light-only first paint persists after a stale dark preference; rail exposes no theme toggle

## All chat

- [ ] Tapping a board row opens **All chat** (the board’s general chat). There is no conversation list and no Chats / Events / People / Tasks dock. An empty board says **Nothing in All chat yet.**
- [ ] Event tabs sit on All chat. Choosing an event filters that same feed. **All chat** clears the filter. Back from an event tab returns to the unfiltered feed, not the sidebar.
- [ ] Board pages (header menu) are **All chat**, **People**, **Timeline**, **Tasks**, and **Polls**. Timeline is the schedule page. Back from Timeline returns to All chat. People lists who can see this board (not server-wide People / role admin). Tasks opens the board’s Tasks channel when one exists. The grid icon still opens My calendar.
- [ ] Create card (Oct 2026): head is the date button (calendar icon · date ⌄), then ⋯ and ✕. ⋯ opens a menu with **Confirm attendance** (tick when on). The card is now Edit event (and Duplicate) only — creating on a board is quick create. The title is one field; the short name used in chat is worked out from it. **Create** sits at the right. A **Templates** drawer hangs under the card (same width as the card, recessed surface) (it names the best match as you type, e.g. "Pub quiz night 90%" or "1 suggestion"); tapping it drops the template list down from behind the card; **Use** fills the draft. No bottom suggestions sheet
- [ ] Opening an event filter can swap the body to **Sign-ups** or **Details** (going count on Sign-ups). Details has Add to calendar + Share card at the top (card preview lives in the share sheet), compact when/place/host rows with duration and **Map only when a map URL is attached** (paste/Add map; no search-from-name), markdown `Label: value` fields inline, collapsed How this started, then View as text / Duplicate / Cancel event. Header Back returns to All chat
- [ ] Create Location paste of a Google Maps URL fills the place name and attaches Map. Coffee morning demo has a map link; Park playdate does not
- [ ] Every `scripts/channel/board-*.js` is in `index.html` and SW `SHELL` in the same order (`node phlip-android/tools/board-script-order-selftest.js`)
- [ ] All chat keeps messages in chronological order, with event cards in the stream. Attached chat messages keep their text with a quiet tappable row under each one (`event icon + event name`). There is no breadcrumb `{board} > General` and no conversation list to return to. Back from All chat returns toward the sidebar, not a list
- [ ] Welcome chat has classic message bubbles and no All chat event tabs
- [ ] Pinned location/person boards still open Timeline (no Agenda toggle)
- [ ] Long-press a board still opens board settings; no Tasks row and no Show in this board; Name only if the user can edit boards
- [ ] `hand-plan-parse.js` is in `index.html` and SW `SHELL` (CACHE ≥ v556)
- [ ] Promotable General messages highlight parsed date/time/place tokens (no calendar icon), including morning/afternoon/evening. Tap a token, confirm, then Create event opens with the full parse. Non-plan chatter is not highlighted
- [ ] (Superseded on board All chat by selection mode — see the Oct 2026 items above.) Long-press a **General** message → **Create event** opens the draft card with parsed title/date/time/place; Create posts, Cancel discards; nothing auto-creates. After create, the source message (and its untagged replies) also appear in the event conversation; General keeps the message text with an event hint
- [ ] Long-press a General message → **Attach to event** (or **Move to event** if already attached) opens the event picker and brings untagged replies along
- [ ] Long-press a message in an **event conversation** (or event-sheet Chat) hides Create / Attach / Move. If the user can edit the event and the text parses a different date, time, or place, More shows **Update date to …** / **Update time to …** / **Update location to …**; tap applies immediately (`setEventTimePrecision` / `setEventWhere`) with a toast. Clock times, morning/afternoon/evening, and time-only lines (no date) still offer a time update. Highlighted tokens ask to confirm, then apply. Copy / Report / Delete stay. Viewers see no update rows
- [ ] Event-sheet Chat highlights differing date/time/place tokens (no calendar icon); tap asks to confirm, then updates that field. Long-press More is unchanged. Tokens that already match the event are not highlighted
- [ ] Create card ⋯ has no **Draft from text** (removed; quick create reads plans straight from chat)
- [ ] Viewer / create-restricted server: no token highlights and no Create event item on General; no update-this-event rows in an event thread
- [ ] Oct 2026 chat model: SHELL_VER `20261014fix2`. Automated: `node phlip-web/tools/smoke/board-chat-smoke.mjs` passes (needs Playwright once: from `phlip-web/`, `npm i --no-save playwright && npx playwright install chromium`). It covers the event bar and list, jump + stepper + Back, `#label` focus (other events hidden, the eye shows them), tagging without filtering, tag prefill, one-tap RSVP, event-led rows with connected chains and no reply buttons, the event icon and `#` not raising the keyboard, the swipe tag state and dragging picked messages onto an event, quick tag into a focused event, leaving a focus (the stepper ✕, re-tapping the event icon), a list pick tagging the message box, opening the event page from the list › and the stepper name, the card's ✓ / ✕ and quiet status, the bar's wording and empty state, tagging limited to this board's events, lead tiles (icon > date > time), the quick fixes (/t parked, Show chat top right, draft date/time fixed, member count), links, creating via quick create (+ muted with no chat, Confirm attendance), roles (colours, People chips, sidebar labels), long-press Edit / Delete / Draw, no "…" messages, archive by age, plan dates expiring, the tree rail (one connected line), #label opening the event page, quick create's date / time pickers and place suggestions, time ranges read from their start, long-press without a quick "Add to", clearing draft-from-chat fields and typing only after "Type", the event card, "Add to #Event", the create card, the parked features (no Timeline / Tasks / Polls in the board menu, no pinned boards in the sidebar) and the event page tabs
- [ ] Board chat selftests pass: `chat-feed-rows`, `chat-event-nav`, `chat-event-color` (no event colours), `chat-select`, `board-destination`, `board-script-order` (`node phlip-android/tools/<name>-selftest.js`)
- [ ] A message sent on Sun 27 Sep saying "Saturday" drafts **Sat 3 Oct** (not the next Saturday from today). "next Sunday" offers a one-tap **or <the Sunday after>**
- [ ] Removing a # tag with text typed, cancelling a reply, and opening/closing the calendar panel keep the scroll position (never jump to the oldest message). **Jump to latest** appears once a screen above the newest message
- [ ] Tapping **+** in the composer shows Create event / Tag an event without raising the keyboard; one Back closes it
- [ ] All chat messages stand on their own (same-sender stacking only). Every event message has a "#name" label on its name line; tapping it focuses that event where you are (others fade, stepper shows, no scroll; tap again to let go). An event card reads as a message from its creator ("Sam · time · added an event") with the event as a clear boxed block inside it (● title ›, when · where, RSVP; neutral border, dashed when hidden) and no divider; the creator's next message within 5 min stacks under it. "Hide in All chat" is in the card's RSVP menu; a hidden card keeps "Show chat". RSVP "Going" looks the same for every event; the stepper is neutral with a coloured dot. On an event page (Chat / Sign-ups / Details) only that page's own header shows
- [ ] Long-press selects with a highlight (no checkboxes). Header shows ✕ / count / reply / copy / ⋮; reactions show for one message and close on the next tap. Untagged → **+ New event** preview + **Add to event** list (same-day events first); in one event → **Move to… / Remove from event**; mixed → "Moves N from …". Add/move/remove show Undo. Back or ✕ clears
- [ ] **New event** from a selection opens the draft with nearby untagged messages pickable; in word mode the title follows tap order across messages; tapping a word in another message re-seeds from it
- [ ] Swipe right-to-left on a tagged message replies in its event; on an untagged message, a plain reply. Left-to-right on an untagged message opens selection with the event list. A swipe from the left edge (or on a tagged message) still opens the drawer
- [ ] Board All chat has no day dividers: each message header carries its own date ("4:12pm" today, "Yesterday 4:12pm", "Sun 4:12pm" this week, "27 Sep 4:12pm", "27 Sep 2025" another year). A conversation over midnight stays one block. The event page keeps its date dividers
- [ ] All chat always shows an event bar under the header, in plain words (calendar icon, no caps): "N events to answer" (bold) when RSVPs wait for you, otherwise "Next: event · day" ("Now: event · time" while one is under way; "N events, no dates yet" if none are dated); with no events at all it says "No events yet" with a black "New event" button. "+" at the right creates an event. Tapping the bar lists upcoming then undated events; tap a row → the chat pans to that event (no filter), focuses it and tags the message box (keyboard down); each row's icon is a tile and its › opens the event page. The event bar above the composer ("# Event › · ↑ n/N ↓ · ✕"; ↑ n/N ↓ hidden when the event has one message or card) walks its blocks; its name opens the event page; ✕ leaves the focus and the tag; jump-to-latest or scrolling to the bottom ends a list jump; Back returns to where you were and removes the jump's tag. No bar on the event page, in the tag filter, Archive, selection or event draft
- [ ] Focus and tag are one: tagging the message box to an event (# picker, swipe reply, long-press Reply, event icon, #label, list row) shows the event bar above the box, and the bar is the tag — no chip in the box while it shows (a reply without an event still shows its "↩ Reply" chip). All chat stays whole: no event header, no filter. ✕ on the bar removes both and keeps the draft; tapping the focused event's icon or #label again does the same. Back after a list jump returns to where you were and removes its tag; Back with only a tag does nothing extra
- [ ] While an event is in focus, other events' messages and cards are hidden (no eye to show them) and general chat fades to half; the focus event stays full and what you were reading doesn't move. No fade while selecting or drafting; it clears with the focus
- [ ] No event colours in All chat: every event message has a plain grey "#Event name" label on its name line (no label = general chat); event cards, bar, list, stepper and tag chip carry no event colour (type icons in the event list are grey). Periwinkle means focus only: the focused event's #labels, card title, bar name and list row, the stepper name, the tag chip, the filtered-event header, the landing flash and selection. "added an event" is bold grey; "N new" is plain bold text, not a bubble; "NOW" is plain text
- [ ] Events lead: an event message's left column is the event's icon (a calendar when it has none) and the sender is a small face chip on the name line; an event card leads the same way ("Sam · added an event"). General chat keeps the big face, so it stands out. Consecutive messages about one event (any senders; a card and the replies after it) form a chain: only the first shows the icon and #label, and a connected rail runs down the column to the last message's name line. Anything in between ends the chain. No reply buttons on messages. Tapping an event icon tags the message box with that event (stepper shown, no keyboard); tapping the #label focuses the event. In focus the event's icon and rail are periwinkle. Labels and the stepper use the short name (e.g. "#Christmas")
- [ ] Tag state: swipe left-to-right on general chat → it's picked (no reactions), each event in view gets one dashed zone covering its card and the messages after it (named "#Event"), the block says "Drag … onto an event, or tap more" with Cancel (ends the tag state, like the bar's ✕), Choose event… / New event. Tap more messages to pick them; press a picked one briefly (mouse: just drag) and all picked lift off ("+N more"); drop on an event's messages or card → added, tag state ends, Undo. A quick swipe on a picked message still scrolls
- [ ] Event in focus (jump, tag or #label): swipe left-to-right on a general (or other event's) message → straight into the focused event with Undo; long-press leads with "Add to #Focused". Without focus, long-press has no quick "Add to" (New event / Add to event only)
- [ ] Long-press: no text gets highlighted; the reaction strip sits just above the message (below near the top) and follows it while scrolling; the finger lifting never picks another line
- [ ] The whole event box opens the event page except RSVP and "Show chat"; the card title shows the type icon (grey). The stepper never covers a message (the chat makes room) and hides jump-to-latest; ↓ past the event's last stop goes to the latest messages and closes a jump
- [ ] Colour roles: purple only means focus (focused event bar name, #labels, rails, icon tiles, list row); primary actions are black (✓ to answer, New event, the long-press "New event" block, a drop zone you're over); everything else is grey — no purple for the current board page, drop zones or the Archive rail. "added an event" and "Hide chat" are regular weight. › only means "open the event page"; ⌄ only opens a list or menu; ✕ closes, leaves or answers "can't go". "#" in the message box appears once the board has an event
- [ ] RSVP on the card: unanswered → black ✓ and outlined ✕ (one tap, "Going to … · Change" notice), same as the list; answered → quiet "✓ Going" / "Can't go" text that opens the menu to change it; nothing when you can't answer. Titles wrap to two lines and have no ›; the whole box opens the event page. Event cards: title + RSVP · date and time · place — RSVP is the only button. Long-press a card (not its RSVP or icon) → a sheet with Hide chat (Show chat when hidden) and Open event; letting go doesn't open the event. A hidden event's card keeps "Show chat". List rows by state: needs RSVP → name / date and time / ✓ ✕; going → name + date / latest message; can't go → faded. Plan dates in chat ("tomorrow", "Sunday") are underlined only while the day is still ahead (read from when the message was sent)
- [ ] Archive by age: chat older than the board's archive age (set in the Archive view's header — "Older than 2 weeks ⌄": 1 week / 2 weeks (default) / 1 month / Never; per board, on this device) moves to Archive unless its event is still to come; All chat then starts with an "Older chat is in Archive" link. Past events whose day is older than the age get an Archive rail chip; with Never nothing moves
- [ ] The message box button is a normal-weight "#" that starts tagging (it turns into ✕ while picking); there is no "+" menu and the placeholder is just "Message…"
- [ ] Long-press an untagged message with no date/time/place right after event chat: the block leads with "Add to #Event" (nearest tagged message above, else below, within 6 messages / 90 min), then "New event", then "Another event…"
- [ ] `node phlip-android/tools/chat-event-color-selftest.js` passes
- [ ] `node phlip-android/tools/plan-parse-anchor-selftest.js`, `chat-select-selftest.js` and `chat-event-nav-selftest.js` pass

## Drive servers (Wi-Fi reach dropped)

- [ ] Add-server is template then name then **Create**. New server is **Device only**. No Drive vs self-hosted step in create. `hostingAvailable()` gates create; other shells open Join
- [ ] Set up sharing connection step: **Google Drive** (Sign in with Google) or **Self-hosted** (Cloudflare Internet). Keep device only. Missing app client ID toasts that Drive isn’t available in this build
- [ ] Join has invite URL + **Join a Drive folder**. No Nearby servers / Join host's Wi-Fi first
- [ ] Join a Drive folder: Google Sign-In, then picker/paste
- [ ] Hosting guide self-hosted path is Internet only after that pick; `setReachMode("local"|"direct")` from web is refused
- [ ] Personal still works with no Google account
- [ ] Demo (`/?demo=1`): Drive create/join toast-blocked; no live Google
- [ ] Drive create (Sign in with Google from Set up sharing): event + General message from browser A appear in browser B after Picker join; B reply appears on A after poll
- [ ] Conflict: both append; 412 retry does not drop a line
- [ ] Cloudflare Internet create + invite still works on Android; existing device-only hosted servers still open
- [ ] `scripts/drive/*.js` in `index.html` and SW `SHELL` (CACHE ≥ v620)

## Phase 1 utilities

- [ ] Corrupt/missing JSON in localStorage still yields defaults
- [ ] Storage write denial (private mode) does not throw through UI
- [ ] Remounting panels does not double-bind delegated clicks

## Phase 2 channel modules

After any channel extraction: empty-cache load, open/close channel panel, private people apply/undo, create channel modal, event chat / deck chat, linked feeds, report/block once if touching moderation.

- [ ] No `ReferenceError` for `mountChannelAccessControls` / `renderChannelPanel` / `renderChat` / `openDeckChatModal`
- [ ] `channel-chat.js` loaded (not `chat030.js`)
- [ ] Offline SW precache includes all `channel-*.js`
- [ ] Boards are single sidebar rows (no Events / Chat / Tasks children); tap opens All chat; long-press still opens board settings; Tasks is a board page. Entry rows are 44–48px, separator-free, tight under **Boards** and before **Pinned locations**. They show a hash (origin arrow on the glyph when shown-in-personal or inbound), lock + Private when private, accepted event count, a marigold RSVP pill when invites need a reply, and a chat unread dot. Origin/link live in long-press board settings.
- [ ] Welcome chat has no General/event conversation switcher; it is the unscoped all-server lobby
- [ ] New board create still lands on All chat
- [ ] Tasks empty state shows an empty bar, “No tasks yet”, a bottom New task FAB, and a collapsed/hidden Completed section
- [ ] FAB opens a keyboard-docked composer; Enter saves and keeps the composer open; Done / Back / tap-outside dismisses without auto-saving; leftover draft is still there on reopen; an inline row edit survives navigating away and back
- [ ] Completing updates the count/check/strike immediately, flies the row down into collapsed Completed without opening it, batches rapid checks against one fixed hold, and fills without a glint; reopen/add rebase without reward
- [ ] Failed task create/edit/complete restores prior state and shows Retry; offline changes reconcile after reconnect
- [ ] Reduced motion skips the fly-down and fill interpolation
- [ ] Board Chat / event chat: `! ` creates a task card, `!query` search pick posts the existing task (no duplicate), Send with matches is a no-op, completing the card checks the same board task, Chat banner `n/N tasks completed` opens Tasks, and `!` is normal text when the board has no Tasks child

## Phase 3 hand modules

After any hand extraction: empty-cache load, then exercise create + timeline paths below.

- [ ] No `ReferenceError` for `EVENT_CARDS` / `weekStartMon` / `startFlatTypePick`
- [ ] All `hand-*.js` present in `index.html` + SW `SHELL` (CACHE ≥ v254)
- [ ] Personal + remote contextual hands; category accents
- [ ] Create: + FAB opens the in-feed draft card; title, time, place; post and cancel
- [ ] Draft save/resume/expiry; corrupt draft recovery
- [ ] Edit date/time/type/place/repeat (no duplicate event)
- [ ] Hand reorder + interrupted pointer cancel
- [ ] Week steer begin/move/commit/cancel; focus restored; no lingering RAF
- [ ] Day grid overlap, drag/move, insert-gap, scroll/resize
- [ ] Borrowed cards, typed promote, calendar busy overlay, availability lifecycle

## Phase 4 render modules

After any render extraction: empty-cache load across personal / multi-server / served shells.

- [ ] No `ReferenceError` for `renderAll` / `renderSidebar` / `renderRail` / `openSideOverlay` / `openJoinModal`
- [ ] All `render-*.js` in `index.html` + SW `SHELL` (CACHE ≥ v255); cluster before `channel-*.js`
- [ ] Rail cycle + server switch with in-progress draft
- [ ] Sidebar freeze on pointer-down; destinations; narrow full-screen nav under sliding main (LTR anywhere opens, swipe left on sidebar closes)
- [ ] Share panel / invite copy; join modal (LAN + public + personal invite)
- [ ] Account chip → full-screen profile overlay; server head shows the server name and a right chevron (same as You) and opens the Discord overlay (Invite / Notifications / Settings on top; People, Info, Settings, Help, Leave in the sheet; Settings nested pane for admins, with Leave at the bottom for non-host members; no Leave row on the channel list; Info opens the Server info full page, not the channel panel); Escape/Back pops pane then overlay; cosmetics preview commit/cancel; backup export-restore
- [ ] Server/account bottom sheets: Escape/Back close and restore focus; arrows move rows; Help & Legal is a served sidebar row; Leave is only in server settings
- [ ] Deck/roles/locations editors
- [ ] Served: join gate, legal/help, leave membership

## Phase 5 consolidation

- [ ] Corrupt JSON / denied storage still yields defaults (no UI throw)
- [ ] Remount sidebar/panel does not double-bind dismiss/tap listeners (`onceFlag`)
- [ ] Ownership map present: `public/_modules/ownership.md` linked from README
- [ ] New scripts follow `MAINTENANCE.md` (index + SW + docs + smoke)

## Event-card presets

- [ ] Fresh/corrupt storage selects Light; legacy Paper/Sage/Night migrate to Light/Light/Dark
- [ ] Light, Dark, Transparent and a saved custom preset match in share PNG and routine hand/editor faces
- [ ] Invalid contrast disables preset save; rename/update/delete persist across reload and deleting active returns to Light
- [ ] Share-selected image, local memory image and icon fallback use the same face geometry
- [ ] Default / no custom photo uses pictured face with the Figma blob art background
- [ ] FORM SIMPLE (white card, giant title) is only used when explicitly requested
- [ ] Cover photo uses pictured face (full-bleed art + inset text box) with Light / Dark / Transparent treatments
- [ ] Stub, building and full are the same face scaled (chat rail, share PNG); the pull-up tab / sheet header thumbnail is the full 220×308 face scaled down as a tiny hint, not readable type squeezed into a mini card
- [ ] Empty location remains visible as an editable “Add place” option during create, but stays omitted from read-only/routine faces
- [ ] Event sheet ⋮ Change art / Remove art stores a device-local photo and switches Simple ↔ Pictured
- [ ] Timeline list rows stay rows; they are not this card face
- [ ] Opening an event from notifications, Memories, chat, moderation or Live shows its Timeline sheet (the full-card detail popup is archived)

## Follow-up Part 1 (`hand.js` orchestration)

After hand-core…hand-apply extractions (CACHE ≥ v257 / current shell):

- [ ] Empty-cache load — no `ReferenceError` for day ink
- [ ] All remaining `hand-*.js` in `index.html` + SW `SHELL`; thin `hand.js` facade only
- [ ] The card tray is archived: no tray on any view; RSVP works from the Timeline quick menu and sheet; existing reactions still show as chips

## Follow-up Part 2 (`channel.js` view/board)

After channel-shell…suggestions extractions:

- [ ] Empty-cache load — no `ReferenceError` for `renderView` / `renderFoot` / members / agenda / deck / tickets
- [ ] Chat still from `channel-chat*.js` only (`collatedChatMessages` / `openDeckChatModal` not duplicated in view/open-pitch)
- [ ] Members view; events board scroll; ticket cards; chains
- [ ] Memories / archive persistence still works (`channel-memory.js`)
- [ ] Offline SW precache includes all new `channel-*.js`

## Follow-up Part 3 (oversized backlog)

After hand-create named split + pitch/sharecard/chat/net/helpers/host/hotspot parts + join/deck/handlers named splits (CACHE ≥ v262):

- [ ] Create flow: + FAB → in-feed draft card → post (the old category → type → date sheet is archived)
- [ ] Share-card export; event chat + deck chat (Open Pitch is archived)
- [ ] Join modal (`render-join-parse/modal/leave`); leave/remove server; deck editor + icon picker
- [ ] Net connect + `handle()` dispatch (`handlers-clone` / `handlers-dispatch`); host-settings + hotspot-join
- [ ] No `ReferenceError` from missing shell scripts; `node --check` clean on all new scripts

## Local browser demo (`demo.phlipapp.com` or `/?demo=1`)

- [ ] Empty-cache load does not open the join gate; `html[data-demo-mode]` is set; `data-served-host` is not
- [ ] Rail shows Personal + Friends, Home, Tennis club, Reading group; no Join / host / contacts buttons
- [ ] Friends: plans / weekends / inner circle; inner locked (Ada absent); Pub and Friend's Place under Pinned locations
- [ ] Home: all home merges meals / outings / chores (those three indented); one family chat; Pinned people Mum and Dad
- [ ] Tennis: Team A / Team B / social with matching chats; committee locked (Nia absent); Indoor / Park court pins
- [ ] Reading: one meetings board; discussion, picks, and off-topic chats
- [ ] Personal: My plans plus Home (1:1 family), Tennis (1:1 social), All friends (Friends plans + Reading); Home and Study pins
- [ ] RSVP, create event, and chat persist across refresh (IndexedDB `phlip-demo-v1`); Network panel has no `/ash-rpc` or WebSocket
- [ ] **Reset demo** restores the fixture (relative dates, original RSVPs, original links)
- [ ] `node --check` clean on `scripts/demo/*.js` and `demo-host/src/worker.js`
- [ ] Tree rail: an event's messages hang off one connected line from its icon — each later speaker's line gets a straight branch from the rail into their face chip (no overlapping strokes; the rail is a solid ink grey, not the outline grey), a speaker's stacked lines get no branch, the rail stops at the last branch; in focus the whole tree turns purple. A message's #label opens the event page (the icon focuses)
- [ ] Quick create: tapping Date or Time shows a calendar / clock button that opens the create card's month calendar or hour grid (:00 / :15 / :30 / :45 then the hour); the field being set takes the whole row. Typing a place offers "Did you mean" known places only when very close (same apart from capitals or punctuation, the start of the name, or a typo or two); any text can still be created. Time ranges ("7pm–8pm") read from their start
- [ ] Event list: heading "Upcoming", then "Tap icon to show in chat"; the row (icon tile + name) focuses the event in chat, the › button (same tile style as the icon) opens its page; ✓ / ✕ match the event card's
- [ ] Event cards are compact (about 300px) and raised (soft shadow): title across the top (wraps), date and time and place below, RSVP at the bottom right — ✓ / ✕ while unanswered, then the quiet "✓ Going"; no empty place line. An unanswered card has a solid dark outline (not dashed, not purple)
- [ ] Dates are UK style everywhere in chat ("Sun 18 Oct · 8pm", three-letter months), whatever the phone's locale
- [ ] Board menu switches are the app's own black switch (no system blue); selected messages and the draft's source message are tinted grey, not purple
- [ ] The event bar under the header is slim (32px); the + and the bar keep full-size tap areas
- [ ] Quick create floats clear of the chat (outline and shadow), its fields are white, an empty field is dashed, there's no "Edit draft"; "or Sun 25 Oct" stays a link. A place close to a known one is only suggested — Create always works with what was written (the create card no longer blocks either)
- [ ] Long-press: the action panel floats above the chat; a message without a plan offers "New event · Add a date" (never its text as the name); the reaction strip sits above the message (below only when there's no room) so the messages below stay free to tap into the selection
- [ ] Tagging only offers this board's events: the # picker, long-press "Add to" and drag zones never list another board's events, even when that board's events post into this chat
- [ ] Empty board: the bar's black "New event" pill shows whole (not clipped by the header)
- [ ] Creating is quick create: the bar's "+" (and "New event" on an empty bar) opens quick create empty — fill it by tapping words, Type or the pickers; the manual form never opens to create. Quick create has a "Confirm attendance" switch left of Create, carried into the event. With no chat yet, "+" / "New event" are muted and a tap says "Send a message first — events are made from chat"
- [ ] Roles: a person's name in chat and their face without a photo take their top role's colour (Host gold, Admin red, Moderator blue, then their first custom role in the Roles list); Members and Viewers stay plain (grey face). Personal space keeps its own colours
- [ ] People: each person has one row of role chips (the server's default role isn't a chip) with × to remove and "+ Role" for one menu — Admin / Moderator / Member / Viewer swap with each other, custom roles add. No "Base role" dropdown or "Additional roles" checkboxes
- [ ] Sidebar board labels are short: nothing when everyone can see it, "Members" (Member can see; any custom role is covered), "Moderators+", "Admins", the custom roles it's for ("Committee, Drivers +1"), or "🔒 N people" when private. The full "Viewable by …" list stays in the board's settings
- [ ] Long-press a message: the top bar is ✕ · count · Reply · Copy · Edit (your own single message) · Delete (messages you can delete) — no ⋮. Edit opens a text box; saving updates the message for everyone with an "edited" mark. Delete has Undo. The reaction strip ends with a brush to draw a reaction
- [ ] No "…" messages: a message with no text is skipped (and logged as [phlip-textless] in the phone log); an event made from chat doesn't also post its own extra message
- [ ] Long-press anywhere (chat, sidebar, menus) never selects text or opens the link callout; text boxes still select
- [ ] An event's date / time sits in small text under its icon tile (the tile stays its normal size); a linked place shows only its name (before the first comma)
- [ ] Lead tiles: icon > date > time. Two events in view with the same icon each show their date under it ("18 Oct"); on the same day, the time too ("8pm"); a unique icon shows alone. The rail starts under the taller tile
- [ ] Header: "n members" shows on a guest's phone as well as the host's, and updates when someone joins
- [ ] A hidden event's card: "Show chat" is an underlined action at the top right; the RSVP status stays at the bottom right, never overlapping
- [ ] Quick create: date and time each take a full row and never move when tapped; "or <other day>" sits inside the date field on the right
- [ ] Tasks parked: "/t" and "/task" send as plain text and the message box no longer says "use /t for tasks"
- [ ] Links: any web address in a message (https://… or www.…) is underlined and opens in the browser (a map link opens Maps); tapping it never opens the event or selects the message
- [ ] Event place given as a map link: the card shows the place's name, underlined, opening the map. A short maps.app.goo.gl link shows "Map location" for a moment, then the name; on the creator's phone the name is saved as the location (the link moves to the event's Map)
- [ ] While an event is in focus, chat scrolls out of sight under a band behind the focus bar — nothing peeks round it
- [ ] Archive: "← All chat", the board menu's All chat and Back all leave it (it used to trap you)
- [ ] Board menu: All chat, People, Archive, Settings, then "Hide chat for events I'm not going to". Settings opens the board sheet; hosts see "Wipe board" there — after a confirm with counts, every chat message and event on the board is deleted for everyone, the board and members stay
- [ ] Quick tag (unchanged): swipe right on a message → tag state; tap more; hold a picked one and drag onto an event zone → added, Undo. Long-press → tap more messages to add them. The drop-zone labels never draw over the bottom panel

