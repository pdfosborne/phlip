# USB device interface review

Reviewed 15 September 2026 on ONEPLUS A5000, 1080 × 1920, density 420 (WebView width 411 CSS px). Used MCP JavaScript/Playwright against the running USB WebView plus direct ADB screenshots and Android accessibility hierarchy. This is a focused walkthrough, not a complete accessibility certification.

## Priorities

### 1. Empty events screen gives no next step — High

**Observed:** Open-invite → Events remains blank below Sept. Go to today did not add an explanation. The create control exists, but there is no message distinguishing no events from loading or a failure.

**Why it matters:** A new member cannot tell whether the space is empty or broken.

**Suggested fix:** Show “No events yet” with a visible “New event” action; explain a filtered-empty or failed state separately.

**Rules / known gaps:** CNT-13; PAT-states-1, 6

[Screen evidence](C:/Users/phili/Documents/ASH-SM/ASH/design-system/reviews/2026-09-15/device-review-empty-native.png)

### 2. Event chat appears addressed to the whole group — High

**Observed:** Inside Social party’s event sheet, the composer says “Message #Socials…”. The sheet contains the event conversation.

**Why it matters:** People may misunderstand who receives a message or whether they are writing to the group chat.

**Suggested fix:** Use “Message about Social party…” or “Message event attendees”, matching the actual audience.

**Rules / known gaps:** PRI-7; CNT-1, 6; source: channel-timeline-view.js:1793

[Screen evidence](C:/Users/phili/Documents/ASH-SM/ASH/design-system/reviews/2026-09-15/device-review-sheet.png)

### 3. Navigation targets are substantially below 48 px — Medium

**Observed:** Measured CSS heights: board headers 29.6 px, Events/Chat/Tasks rows 35 px, add buttons 32 px. Their ::before pseudo-elements provide no expanded hit area. Android accessibility bounds likewise show undersized targets.

**Why it matters:** Closely spaced controls are easy to miss or confuse on touch.

**Suggested fix:** Use 48 px non-overlapping touch targets, including expanded headers and plus controls.

**Rules / known gaps:** LAY-22, 23, 25; GAP-13, 33

[Screen evidence](C:/Users/phili/Documents/ASH-SM/ASH/design-system/reviews/2026-09-15/device-review.png)

### 4. Creation and chat inputs are too small and lack visible labels — Medium

**Observed:** Computed input sizes: event title 14 px, time/location 13 px, event chat composer 13 px. The draft uses Title / TBD / Location placeholders, without persistent visible field labels. Accessible names do exist.

**Why it matters:** Entered text replaces the only visible field cue. TBD does not teach natural-language time entry.

**Suggested fix:** Use 16 px touch inputs; add labels and examples such as “e.g. 7pm tomorrow”. Explain which fields enable Create.

**Rules / known gaps:** TYP-8; CMP-input-3; CNT-14; GAP-14

[Screen evidence](C:/Users/phili/Documents/ASH-SM/ASH/design-system/reviews/2026-09-15/device-review-create-native.png)

### 5. Tap on an event first selects a preview — Medium

**Observed:** Tapping Social party revealed a bottom focus preview. A second tap on that preview opened the event sheet. The row accessible name is only “Social party, 3pm”.

**Why it matters:** Opening details has a hidden extra step, and the row name omits date and RSVP state.

**Suggested fix:** Follow CMP-event-row-3 by opening the sheet on the first tap, or explicitly revise/document the preview interaction and give it an Open event label.

**Rules / known gaps:** CMP-event-row-3, 4; GAP-37 covers the row name

[Screen evidence](C:/Users/phili/Documents/ASH-SM/ASH/design-system/reviews/2026-09-15/device-review-detail-native.png)

### 6. Hosting Continue uses an inconsistent blue button — Medium

**Observed:** After selecting Same Wi-Fi, enabled Continue computes to rgb(234,244,252) fill with rgb(62,124,177) text. No setup was submitted.

**Why it matters:** The same kind of primary progression gets a different visual treatment from the shared button system.

**Suggested fix:** Use the navy Menu CTA for progression into setup, following the component’s explicit example. Reserve black for the final primary commit.

**Rules / known gaps:** CMP-button-2; screenshot shows the initial disabled state; enabled colours measured separately

[Screen evidence](C:/Users/phili/Documents/ASH-SM/ASH/design-system/reviews/2026-09-15/device-review-hosting.png)

### 7. Terminology changes between surfaces, and the spec conflicts — Medium

**Observed:** The UI uses BOARDS / New board; an accessible label says “Pin a location to a new channel”; event view options contain Hosting and Show no. The content glossary rejects board/channel and uses Organiser and Can’t go. However patterns/navigation.md explicitly prescribes Boards → Events/Chat.

**Why it matters:** New users must infer whether boards, groups and channels mean different things.

**Suggested fix:** Resolve the board-vs-group model in the spec first. Then align visible labels, accessible names and event filter labels throughout.

**Rules / known gaps:** CNT-2, 6; GAP-20; patterns/navigation.md conflicts with 09-content.md

[Screen evidence](C:/Users/phili/Documents/ASH-SM/ASH/design-system/reviews/2026-09-15/device-review.png)

### 8. Mixed fonts, off-scale sizes and time formats remain — Low

**Observed:** Sidebar section labels compute to 10.5 px ui-monospace; sidebar rows to 14.5 px. Timeline says 3pm, the event thumbnail says 15:00 – 16:00, and chat timestamps say 15:32. Server menu also uses CUSTOMIZATION and Help & Legal.

**Why it matters:** These details make adjacent surfaces feel inconsistent and smaller text harder to read.

**Suggested fix:** Use Atkinson caption tokens at ≥11 px, on-scale row sizes, shared 12-hour formatting, British spelling and sentence case. Uppercase small group labels are allowed by TYP-11; uppercase alone is not the defect.

**Rules / known gaps:** TYP-4, 6, 7; CNT-3, 4, 7; GAP-10, 21, 28

[Screen evidence](C:/Users/phili/Documents/ASH-SM/ASH/design-system/reviews/2026-09-15/device-review-sheet.png)

### 9. Connection and unread dots look alike — Medium

**Observed:** Blue dots appear on server rail buttons and beside unread Chat. Rail button titles describe “Synced … ago”, but that explanation is not visible on touch.

**Why it matters:** A new user may read a connection indicator as an unread notification.

**Suggested fix:** Use the specified connection-state colours, and expose an accessible, touch-visible status explanation.

**Rules / known gaps:** COL-12, 13; PRI-7

[Screen evidence](C:/Users/phili/Documents/ASH-SM/ASH/design-system/reviews/2026-09-15/device-review.png)

### 10. Server context disappears inside the group — Low

**Observed:** The main heading reads “Socials · Events” beside a generic back arrow, with no Tennis server identity shown.

**Why it matters:** Similarly named groups in multiple servers become difficult to distinguish.

**Suggested fix:** Show server identity in the narrow navigation control as specified, or add a compact server label.

**Rules / known gaps:** PAT-navigation-5

[Screen evidence](C:/Users/phili/Documents/ASH-SM/ASH/design-system/reviews/2026-09-15/device-review-sheet.png)

## What worked

The main palette, Atkinson body text, selected periwinkle states and black create/send controls are recognisable. The actual creation card fits above the keyboard. Same Wi-Fi, hotspot and internet setup choices have helpful explanations. Event details and chat are reachable.

## Limits and corrections

Direct device captures overrode distorted WebView screenshots: no creation-card overflow or squashed-sheet finding is retained. Initial unreliable taps were not established as an app defect. No messages, events or server setup were submitted; the temporary debugging port was removed. Sidebar navigation was restored. Inspecting chat may affect local read state.

Covered: server sidebar, empty and populated event timelines, event preview and sheet/chat, blank event creation with keyboard, server/account/personal settings and sharing setup. Native SettingsActivity, first-run onboarding, full joining, RSVP commits, TalkBack, large text and reduced motion were not tested. The sharing screen inspected was in MainActivity’s web client.

The existing audit is a baseline, not proof of this build. Findings cite it only where observations match. The board/group terminology needs a design decision because modules in the current spec disagree.

## Implementation and final verification

The owner approved findings 1–3 and 5–10, and these are implemented. Finding 4 remains deferred to preserve the compact form above the keyboard. The agreed model is server = overall group, board = subgroup, and Events / Chat / Tasks = views. The narrow header now includes the server image or initials.

The final debug build assembled successfully and was installed on the USB OnePlus 5 with app data preserved. Seven targeted self-tests pass: interface review, timeline view, sidebar navigation, sharing flow, event card style, personal projection/chat, and connection paths. Device inspection confirmed the sidebar target rules, an actionable empty state, direct row opening, an event-named composer, shared 12-hour clocks, server context, and navy setup progression.

The create/cancel then open-event sequence exposed a stale cached keyboard inset. Live native zero insets now override cached values; the final device check confirms the event sheet and composer remain within the viewport after cancellation. The compact form geometry is unchanged. See the [final device capture](after-event-sheet.png). No messages, events, or sharing setup were submitted.

The global token ratchet still reports pre-existing drift at HEAD. Changed CSS introduces no increased drift category; the saved token delta records the comparison. Wider-app audit gaps remain scoped in `audit.md`.

### Sidebar hierarchy follow-up

Board-level unread chat now appears before the accepted-event count, keeping event counts aligned at the right edge whether unread chat is present or absent. An initial first-board top alignment was removed after it left unused target space below a single-line title; Members and every following board now use the same visual interval. Verified on the USB device in the [board-spacing capture](members-spacing-fixed.png).

The owner subsequently chose a denser 40 px rhythm for collapsed board headers and pinned location/person entries. Expanded Events / Chat / Tasks rows remain at 48 px. The device captures confirm the compact [collapsed list](compact-sidebar-spacing.png) and unchanged [expanded board spacing](compact-sidebar-expanded.png).

On the Personal server, My plans now presents “Just me” as secondary board information and no longer shows “Required” beside the board title. The ownership line remains visible when the board is collapsed. Verified in the [My plans ownership capture](my-plans-just-me.png).

