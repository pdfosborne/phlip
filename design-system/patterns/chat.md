# Chat

Chat exists to coordinate events (PRI-1). It is quick, legible and never gets in the way of the plan.

## Where chat lives

| Place | What | Current code |
|---|---|---|
| All chat | Board home: messages and event cards in one feed; the composer event selection focuses it | `scripts/channel/board-feed.js` inside `renderChat` |
| Timeline sheet → Chat | The schedule page's event thread | `scripts/channel/channel-timeline-view.js` (`.edc-msg` rows) |
| Welcome | Server lobby, classic bubbles, not a board home | `scripts/channel/channel-chat*.js` (`.msg` rows) |

The conversation list (General + event rows) is archived. See `patterns/navigation.md`.

## Anatomy

**Message row.** Avatar (round; 28 px in the event sheet, 36 px in chat groups) · meta line (name in 700 `--text-primary`, time in `--text-secondary`, `--fs-caption`) · text (`--fs-small`, `--lh-body`, `--text-primary`, selectable). Consecutive messages from one person group under a single avatar and meta line.

**Composer.** A pill field (`--surface-1`, `--border-control`, `--radius-pill`, 16 px text on touch) with an ink send button (36 px round, `--icon-md`), pinned above the keyboard. The placeholder reads "Message *board*…".

**All chat composer.** Newly opened boards have no destination. Explicit selection or Continue sets an inline pill retained after sending. The pill is a compact label, about 28 px high, with a centred black × to remove it. Its label is not clickable; cancel then type # to choose another event. Event pills use a coloured dot and short name; untagged continuation uses ↩ and a short first-message preview (sender fallback). The pill stays beside the growing textarea within 40% of the editable area. Labels shorten at word boundaries, then grapheme boundaries, to fit without an ellipsis; the full destination remains accessible. With no pill, the placeholder is “Message… · # to tag”; with a pill it is “Message…”. Backspace at caret zero without a selection removes the destination. + opens Create event / Tag an event (tagging disabled if there are no available events). When an event is selected, + is hidden and the pill takes its space at the start of the field; removing the event restores +. There is no separate # button. A leading # is consumed and changes + into a # selection indicator with a short fade/rotation. It is not duplicated in the message field. Tapping #, Escape, or boundary Backspace exits selection and restores +. Reduced-motion preferences disable the animation. Send keeps its 48 dp touch target. Swiping up on Send enters the same # selection mode without inserting any message text, even with an empty draft. Normal taps still send; drags never send. Existing draft text and destination remain until an event is selected.

**Destination picker.** + → Tag an event and a typed # at the start or after whitespace open the same picker. Events use a colour dot before the full title and right-aligned dates, sorted soonest first. Search matches full and short names. The picker lists events only, with no separate clearing action. The pill’s × or boundary Backspace removes the destination pill and restores All chat while preserving draft text. For a leading #, the control represents the trigger and text typed at the caret filters events; selection removes that query and stores event identity as metadata. Mid-message # queries retain their existing text behaviour. Dismissal restores the leading # when there is query text, preserving literal hashtags; an empty selection mode simply closes. Arrow keys navigate options; Enter selects only an explicit highlight and cannot send while the picker is open. Escape restores input focus. IME composition is respected; other chat surfaces keep their existing hashtag behaviour.

**Short names.** Event creation/editing offers an optional Short name beneath the title, limited to 14 user-perceived characters. Blank uses the first two title words, shortened at word/grapheme boundaries. Compact event tabs share this formatter, while cards, details and picker results retain full titles. Width fitting can shorten a pill further on small screens or with enlarged text. Custom names survive title changes; automatic names follow the title. The optional `shortName` is encrypted like `title`, with `_shortName` as its decrypted client cache. Creation and the existing event-type update carry it; omission preserves it and an empty string clears it. Older records need no migration. Shared custom names require an updated host; older hosts continue using automatic names.


**Routing and continuation.** One explicit destination controls routing, replacing legacy continuation state. Event selection filters the feed and pins the compact shared event card; removing the pill restores All chat. An eligible untagged message's long-press menu offers Continue conversation, which stays in All chat and sets its conversation ID without an event. Untagged messages have no rails or endpoint controls. Event rails retain a continuation action only on the most recent message in each conversation; no rail extends into the composer. Draft, caret and destination survive rerenders and event-detail navigation. Unavailable destinations require clearing or replacement before sending. Immediate send failures restore the draft; queued/optimistic sends retain the existing retry behaviour. Destination names are never inserted into message bodies or repeated in bubbles.

**Event context.** Selecting an event includes only its tagged messages and untagged messages sent at or after its creation time. Earlier untagged messages stay in All chat for manual allocation. Explicit event tags remain visible regardless of message age. If the creation time is unavailable, untagged context is omitted rather than guessed.

**Selected-event stub.** In the filtered chat only, the event's shared card is moved to the beginning of the feed and pinned while messages scroll. Its compact version has just title/Going (or RSVP) and date/location rows. The title retains its details chevron and action. There is no separate event header or duplicate in-feed card. Removing the pill restores the full cards, including organiser and tasks, in unfiltered All chat. Archive remains in the board dropdown.

## Rules

- **PAT-chat-1 — Unread is notify-blue.** A dot on the row accessory and the focus-tab chat button, plus the event title in bold (COL-12, TYP-10). The number in the bubble is the total message count: hidden at 0, collapsing to "…" at three digits. The main head's chat button uses the same dot.
- **PAT-chat-2 — Optimistic send.** A message appears at once in a sending state. A failed message stays in place with Retry. Offline sends queue and go out on reconnect.
- **PAT-chat-3 — Message actions in one menu.** Long-press (or right-click) a message: Create event · Copy text · Pin on the event · Delete. Create event opens the existing draft card with a parsed title/date/time/place; the user always confirms. Messages that look like plans (a date, or a planning phrase plus time/place) get a quiet calendar mark. Deleting your own message offers Undo; moderators deleting someone else's message confirm first ([destructive-actions.md](destructive-actions.md)).
- **PAT-chat-4 — Text is copyable** (INT-29).
- **PAT-chat-5 — Coordination only.** No photo or file uploads in chat.
- **PAT-chat-6 — Mentions.** @person notifies them; an event mention links to its event, and tapping it opens the event sheet.
- **PAT-chat-7 — Don't yank the reader.** New messages keep the view pinned to the bottom only if it was already at the bottom; otherwise a "New messages" pill appears. The draft in the composer, its focus and selection survive re-renders (PRI-16).
- **PAT-chat-8 — Blocking hides.** Messages from people you've blocked are hidden, and their mentions don't notify you.
- **PAT-chat-9 — Say when history is deleted.** If the server deletes old chat (the retention setting), the top of the thread says so in one line ("Messages older than 7 days are deleted on this server").
- **PAT-chat-10 — Enter sends.** Enter sends; the send button is always there for touch (INT-24).

## Gaps

GAP-10 (10 px meta in the event sheet), GAP-14 (13 px composer), GAP-15 (chat text can't be selected), GAP-27 (the main head's separate unread blue).
