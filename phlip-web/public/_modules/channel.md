# channel (Phase 2 + follow-up Part 2 / chat Part 3)

## Purpose
Channel admin UI, shell/view/agenda/deck/tickets, and event-group chat. Classic globals; no ES modules.

## Location
`public/scripts/channel/` (after `scripts/render/`, before `scripts/shell/panel.js` / hand).

## Files (load order after `render-*.js`)

### Panel / settings (Phase 2)

| File | Role |
|------|------|
| `channel-access.js` | `mountChannelAccessControls`, people list HTML |
| `channel-linked-feeds.js` | Linked agendas / chat mirrors modals |
| `channel-form-components.js` | Cal overlay, availability, chat-import fields |
| `channel-invites.js` | Group invite create/manage/share |
| `channel-panel-state.js` | `channelPanelState`, panel predicates, pointer freeze flags |
| `channel-panel.js` | Open/close/sync/`renderChannelPanel` |
| `channel-panel-calendar.js` | My calendar tab (mini month, confirmed agenda, personal event) |
| `channel-panel-actions.js` | Panel tap routing |
| `channel-panel-gestures.js` | Dismiss swipes |
| `channel-settings.js` | Settings form + create modal + type/location scope |
| `board-settings-sheet.js` | Pull-up board settings sheet (sidebar long-press) |
| `channel-moderation.js` | Reports/blocks/delete/admin log |

### View / board (Part 2; before `channel.js` facade)

| File | Role |
|------|------|
| `channel-shell.js` | Footer, nav shell, header titles, mode tabs |
| `channel-tasks.js` | Tasks checklist, inline drafts, optimistic retry state, and progress reward batching |
| `channel-chat-tasks.js` | Chat `!` task shortcut, task cards, and board Chat n/N banner |
| `channel-view.js` | `renderView` dispatcher, notifications, server-info |
| `channel-console.js` | Shared-history lookup, admin console |
| `channel-members.js` | Members view |
| `channel-history.js` | Shared-history / history view |
| `channel-agenda.js` | Today anchor, period label, board-head taps, edge swipes (Month / Week / Day zoom is archived) |
| `channel-memory.js` | Memories store + event archive persistence |
| `channel-deck.js` | Event chat-note helpers |
| `channel-open-pitch.js` | Organiser / invite predicates (the Open Pitch panel is archived) |
| `channel-events-board.js` | Events board entry: scopes the channel, then renders the Timeline (Agenda / pinned) |
| `channel-ticket-cards.js` | Ticket/event card HTML (~765; ceiling exception) |
| `channel-timeline-view.js` | Rolling Timeline feed, picker, focus tab, event sheet, static Create FAB |
| `channel-timeline-cards.js` | Cards layout: Simple-face carousel in the agenda feed slot |
| `channel-chains.js` | Chain helpers / strip wiring |
| `channel-suggestions.js` | Event shared-notes binding for the event chat sheet (the detail popup's suggestions UI is archived) |

No separate `channel-core.js` — shared leftovers were not large enough to justify a file.

### Chat (Part 3 size split)

| File | Role |
|------|------|
| `channel-chat-part1.js` … `channel-chat-part4.js` | Chat panel implementation parts |
| `channel-board-nav.js` | Board landing: All chat redirect, back, Timeline / Polls surface switch |
| `channel-event-panel.js` | Event facts, place editor, sign-ups / details (All chat filter and Timeline sheet) |
| `board-model.js` | Board events and messages: lookup, hidden state, live lists, archive by age (`boardArchiveDays` / `boardSetArchiveDays`, `boardMessageArchived`: older than the age and not on a live event), titles, icons, RSVP state (`boardEventRsvpState`), short labels |
| `board-card.js` | The event card in All chat (a message from its creator) and its RSVP control (unanswered: ✓ / ✕ via `boardEventNavAnswer`; answered: quiet status opening the menu); long-press sheet `boardOpenEventCardSheet` (Hide / Show chat, Open event) |
| `board-feed.js` | All chat rows: message HTML, `#label`s (`boardEventTagHTML`, tap opens the event page), date labels, chains as a tree (`boardChainRows`: `chain-next` rail, `chain-prev.head-gap` straight branch, `chain-end` last branch (rail stops there)), board navigation, archive rail |
| `board-pages.js` | Board menu: All chat, People, Archive, Settings (the board sheet; Timeline, Tasks, Polls parked — `PHLIP_PARKED` in `helpers-part1.js`) |
| `board-continue.js` | Continue / reply into an event, `#` picker targets, outgoing tags, per-board link and chain memory |
| `board-composer.js` | The message box: keyboard / IME, float and dock, jump to latest, Enter to send, send button |
| `board-from-chat.js` | Event draft from chat: title word picker, plan parsing across messages, draft bar, create / update; also the only way to create on a board ("+" opens it empty; muted with no chat — `PHLIP_PARKED.manualCreate`), with a Confirm attendance switch |
| `board-home.js` | Wiring: chat memory and scroll anchor, filtered-event header, `boardWireComposer` (after every render), stream clicks |
| `board-select.js` | Long-press selection: contextual header bar, reaction strip, action block (New event preview / Add to / Move / Remove), swipe classification; `boardWriteMessagesToEvent` |
| `board-drag.js` | Tag state: drag the picked messages onto an event (drop zones, auto-scroll, Undo) |
| `board-event-nav.js` | Event bar under the header ("N events to answer" / "Next: … · day" / "No events yet" + New event; +), event list (by RSVP state; a row focuses and tags; › opens the event page), the event bar above the composer ("# Event ›" opens the event page · ↑ n/N ↓ when more than one stop · ✕ = `boardEventFocusExit`) — it is the message box's event tag; focus hides other events and fades general chat to half; `boardEventNavTagFor` (list pick and #label tag the box), seen cursors |
| `board-destination.js` | The `#` tag in the message box: picker, chip (replies; an event tag shows as the event bar instead), routing; `#` hidden until the board has an event |

## Public functions (selected)
- `mountChannelAccessControls(root, cfg)` — channel access/privacy controls
- `openChannelSettingsSheet(channelId)` / `openChannelActivityPopup(channelId)` — pull-up settings + activity
- `openChannelPanel` / `closeChannelPanel` / `renderChannelPanel`
- `mountChannelSettingsForm` / `openChannelModal`
- `renderView` / `renderFoot` — shell/view cluster
- `renderConversations` / `conversationsLandOnGeneralChat` / `conversationsHandleBack` — All chat landing
- `boardHomeRows` / `boardOpenPage` — All chat feed and board pages
- `renderTasks` — task-channel checklist renderer
- `timelineCloseCalendar` / `timelineSheetIsExpanded` — Back/Escape helpers for `ashBack`
- `renderChat` / `openEventChatFiltered` — in `channel-chat*.js`

## Load order
- Must load after: `render-*.js` (and earlier core helpers)
- Must load before: `panel.js`, hand modules, `wireboot.js`
- Chat parts load **after** the Part 2 cluster + `channel.js` facade
- `channel-board-nav.js` loads after `channel-chat.js`, then `channel-event-panel.js`, `board-model.js`, `board-card.js`, `board-feed.js`, `board-pages.js`, `board-continue.js`, `board-composer.js`, `board-from-chat.js`, `board-home.js`, `board-select.js`, `board-drag.js`, `board-event-nav.js`, `board-destination.js` (checked by `phlip-android/tools/board-script-order-selftest.js`)
- `channel-chat-tasks.js` loads after `channel-tasks.js` and before timeline / chat parts

## State owned
- `channelPanelState`, suppress dismiss timers
- Moderation: `moderateShowAll`
- Memories / archive keys: `channel-memory.js` (`ash_memories_v1`, `ash_event_archive_v1`)
- Tasks: per-channel drafts in `S.taskDrafts`; animation and pending mutation state in `TaskChannelUI`
- Chat `!` tasks: `channel-chat-tasks.js` globals (`parseChatTaskDraft`, `commitChatTaskMessage`, `chatTaskCardHTML`)
- Board surface: `S.boardSurfaces`, `S.boardChatHome`, `S.conversationsReturn` (`channel-board-nav.js`, `board-home.js`)
- Selection: `S.boardSelect` (`board-select.js`)
- Event bar: `S.boardEventNavOpen` (jump list open), `S.boardEventStep` `{ eventId, returnAnchor, quietUntil }` (`board-event-nav.js`). Pans only — never filters. A tag in the message box (`boardDestinationState.value`) shows that event's stepper (`source: "tag"`) and never switches the feed to a focused view; only `S.chatFilterEventId` narrows the feed. After a jump, focusing the message box pre-sets the tag once (`boardEventNavPrefillTag`). While a stepper shows (after a jump, a tag or a #label), `boardEventFocusPaint` writes one `<style id="board-step-focus-style">` rule keyed on `data-event`: other events' messages and cards are hidden (the stepper's eye, `S.boardEventShowOthers` = that event id, shows them faded to 0.45), general chat fades to 0.75; the reader's place is held (`boardEventFocusAnchor`). Rows are never changed after render.
- **No event colours** (removed 13 Oct 2026, `feature-planning/chat_cleanup_plan.md`): no script emits `--run` / `--ev` and no rule reads them (`chat-event-color-selftest.js` guards this). Colour roles (14 Oct 2026): periwinkle (`--accent`) means focus only (focused #labels/rails/icon tiles/list row, the event bar name, filtered header, landing flash); primary actions are black (`--text-primary` fill: ✓ to answer, New event); everything else is grey. The old per-board assignment is archived in `feature-planning/archived/event-colour-assignment.md`. Icons: `boardEventIconHTML` (type icon; nothing for the generic pin or an unknown name).

## All chat interaction model (Oct 2026)
- **Message style: events lead (Oct 13):** in All chat an event message's left column is the event's icon (`.msg-ev-lead`, calendar fallback; tap = `boardBeginContinue`, which tags the message box without the keyboard) and the sender's face is a chip on the name line (`.msg-who-face`); the event card leads the same way (`data-board-lead-event`). General chat keeps the face. Consecutive same-event messages form a chain (`boardChainRows`, render-time `chain-next`/`chain-prev`): later messages hide the icon and a connected rail runs down the column to the last one's name line; only the first carries the "#Event" label (`boardEventTagHTML`, tap = focus). No reply buttons on messages (the quick-continue arrows are gone; the icon replaces them). The event page keeps faces. "Hide chat" / "Show chat" sit on the card's place row. Untagged chat stays plain.
- **Draft from chat** (`board-from-chat.js`): a field is set by tapping words in the chat (tap the field first). Typing is an active fallback for the title and location only (`BOARD_FROM_TYPABLE`): while one is being set it shows a keyboard button ("Type", `boardTypeItFromChat`) that opens a text box with the keyboard; nothing else raises it. Date and time come from tapped words, the parse, or "Edit draft". Typed text is `S.boardFromChat.typed[field]` (typed beats tapped words, which beat the parse; "" = cleared) and `S.boardFromChat.typing` is the open box. The title has ✕ to start it from scratch (empties it and waits for tapped words); the field being set has ✕ too. Tapped date or time words that can't be read are underlined. Date and time also have a picker (`BOARD_FROM_PICKABLE`: the create card's month calendar / hour grid, stored as "2026-10-17" / "7:30pm"). A typed place gets "Did you mean" known places only for very close matches (`boardFromChatPlaceMatches`); nothing is ever blocked.
- **Keyboard only on purpose:** the event icon, the `#` picker (and choosing from it) and the event list set things up without raising the keyboard, so you can browse first; tapping the message box brings it up (with the `#` picker open, the search goes at the start). Swipe reply and Reply still open the keyboard (`boardBeginContinue(id, { focus: true })`); `boardDestinationSet` keeps the keyboard only if it was already up or `options.focus` asks.
- **Event chat** (filtered, or replying into an event): the header becomes the event (back to All chat · title + when · RSVP); no chips/bars in the feed.
- **Long-press** selects (highlight only). Taps add/remove. Header: ✕ · count · Reply (1) · Copy · ⋮ (1, opens the message sheet). Reaction strip for a single selection. The action block replaces the composer: untagged → "+ New event" preview (from `planParseMessages`) and "Add to event"; all in one event → Move to… / Remove from event; mixed → note "Moves N from …". Writes only the selected lines, with Undo. No quick "Add to" unless an event is in focus (jump, tag or #label): then the block leads with "Add to #Focused" (`boardSelectFocusEvent`). The click that ends the starting press never toggles (it can land on another line once the block moves the chat); the reaction strip is placed after the block and follows its message while scrolling. No native text selection in the chat.
- **Swipes:** right-to-left replies (in the message's event when tagged). Left-to-right (`boardSwipeTag`): with an event in focus, the message goes straight into it (Undo); otherwise it starts the **tag state** (`S.boardSelect.tagging`): no reactions, tap more messages to pick them, each stretch of an event in view (its card and the messages after it) is one dashed drop zone named "#Event" (`boardDropZones`, a layer in `#view`), and pressing a picked message (hold ~180ms, or drag with a mouse) drags all of them onto an event (`board-drag.js` → `boardWriteMessagesToEvent`, Undo); the block also offers "Choose event…" and "New event". Swipes starting within `NAV_EDGE_PX` (24px) of the left edge, or left-to-right on another event's message without focus, open the nav drawer.
- **Dates in chat** resolve from the message's send time (`planParse(text, m.ts)`); a group of messages parses with later time/place overriding earlier.
- **Scroll** is restored by message anchor (`boardScrollAnchor` / `boardRestoreScrollAnchor`), defaulting to the latest message, never the top.

## Migration notes
- Extracted from monolithic `channel.js` (Phase 2 + follow-up Part 2)
- `chat030.js` deleted; content is `channel-chat*.js`
- Board settings + access live in `board-settings-sheet.js` (sidebar long-press); People tab is server roster only
- All chat is the board home. The conversation list is archived in `archive/web/I-conversation-list/`
- **Create-channel modal** still embeds access UI in `channel-settings.js`
- Do not re-extract `openEventChatFiltered` into view/open-pitch files — it lives in chat
