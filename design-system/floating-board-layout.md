# Floating board layout — spec sheet

Approved 23 September 2026. Status: design approved; demonstrated in a standalone mockup; production migration pending.

Reference: [interactive mockup](mockups/floating-panels.html). Entry point: [design-system README](README.md).

## Scope and precedence

**FLT-1.** This sheet supersedes conflicting older descriptions of the board header and board dropdown in components/shell.md and components/event-row.md. Unrelated surfaces retain their existing specs. The mobile-sized mockup does not define a complete desktop sidebar redesign. All chat is the board home (`patterns/navigation.md`, 2026-10-10). FLT-10 through the Chats / Events / Tasks dock in FLT-16 describe the retired conversation list and are historical.

**FLT-2.** Production must use shared design tokens. Measurements below are target values, not permission to introduce raw CSS values into component styles. Map existing tokens or add semantic tokens in 00-foundation.css. Mockup CSS is illustrative; it is not a replacement production stylesheet. Existing accessibility and safe-area requirements remain mandatory.

## Frame and visual language

**FLT-3.** Use consistent 10 px gaps between floating regions, 14 px panel corners, neutral hairline boundaries and restrained shadows. Main content scrolls between top and bottom controls. Keep controls clear of system safe areas and the software keyboard.

**FLT-4.** Content icons are outline-only, approximately 24 px with consistent 1.75 px strokes. Use current text colour, no grey icon tiles, enclosing icon borders or decorative icon halos. Keep alignment space around icons. This does not remove the floating surfaces of navigation buttons or the create FAB. Preserve accessible keyboard focus indicators.

**FLT-5.** Content uses the established sans-serif family; metadata uses the established mono family. Mockup targets: 15 px board title, 14 px conversation title, 13 px preview/member names, 11–12 px dates, counts and role labels. Truncate long titles and previews independently; date and unread count must remain readable. Validate contrast against the existing accessibility spec.

## Top navigation

**FLT-6.** Three floating blocks share a row: left server/back control, flexible centre title, right My calendar control. Side blocks are equal width (74 px in the reference); blocks are 48 px high with 10 px gaps. Preserve the server image/initials alongside the back affordance.

**FLT-7.** Centre both board title and member-count line. Put the small chevron immediately beside the member count, not beside the title. Opening the block rotates the chevron upward and expands board options downward below the header. A second tap, outside tap or Escape closes it. Restore focus to the trigger on dismissal. Communicate expanded state and the controlled panel to assistive technology.

## Board dropdown

**FLT-8.** Contents, in order:

1. People who can see this, including count; Edit access aligned right.
2. Member list: fixed 192 px viewport, six 32 px rows visible, overflow scroll for additional people. These compact rows are informational; do not use their height to justify undersized interactive targets.
3. Sorting & filters: labelled Sort conversations and Filter conversations dropdowns. Controls have matching widths (185 px reference) and align on the right; adapt at narrow widths without clipping labels.
4. More board settings, opening further options.

Do not repeat the board name or a Board options subtitle. Do not include Invite / share link or Pinned locations here. Keep the outer dropdown scrollable when screen height requires it. The mockup retains a close button; removing its separate row was suggested but has not been approved.

**FLT-9.** Edit access controls board visibility, not server-role assignment. For role-based visibility, choose which server roles grant access; effective viewers are the union of members of those roles. For a private board, choose individual server members. Saving updates the visible people list and count; cancelling does not commit changes. Owner access remains available. Production must enforce existing permission checks and server-side authorization; the mockup only demonstrates local state.

## Conversations and ordering

Historical, 2026-10-10. FLT-10 through FLT-15, and the Chats / Events / Tasks dock in FLT-16, describe the retired conversation list. A board lands on All chat. The create button below and My calendar (FLT-17) still apply. The list mockup is not the production home.

**FLT-10.** General remains a separate Board chat row above event conversations. Each event row contains an outline icon, title and event date/time on its first line, then a preview and optional unread-count pill. Do not add message timestamps to event rows. General may use a message timestamp because it has no event date. Undated ideas use No date.

**FLT-11.** Default sorting is labelled **Unread, then event date**:

- Unread event conversations first, newest unread activity first.
- Read upcoming events next, nearest event first.
- Read undated ideas after upcoming events.
- Read past events last, most recent event first.
- Unread activity on an old or undated event promotes it to Unread.
- Use a stable secondary key when timestamps tie, avoiding arbitrary reshuffling.

Use actual event and activity timestamps in production; the mockup uses sample dates and a fixed reference day. Date grouping must follow the app's existing timezone rules.

**FLT-12.** In the default mode, use **Unread** and **Plans** headings, separated by whitespace only. No horizontal lines, new container backgrounds or extra timestamps. Hide a heading when its group is empty. A list with no results shows an appropriate empty/filtered state. General stays separate from these event groups.

**FLT-13.** Reading a conversation clears its unread state. Present its new position in Plans on return, not through a jump beneath the user's finger while entering it. Preserve the outline on that last-opened event so its new position is easy to find. Restoring scroll must leave the return-location cue usable.

**FLT-14.** The last-opened outline is intentional context, independent of unread state. Retain the thin periwinkle outline and subtle halo on the conversation panel, including the current accent icon/date treatment. A blue count pill signifies unread messages. The suggestion to neutralise the focused icon/date was not accepted and is not part of this revision. Keyboard focus remains distinct and accessible.

**FLT-15.** Sorting alternatives demonstrated are Event date and Title A–Z. Those show one Plans list rather than promising unread-first grouping. Filter options are All conversations, Unread, Scheduled and Ideas. Filters apply to event conversations and combine with the selected sort; General stays in its separate position. A filter must not silently reset sorting.

## Bottom navigation and calendar

**FLT-16.** The Chats, Events and Tasks bottom dock is historical (see the banner above). The separate rounded black create button, with a white plus, still applies. Its purpose must be exposed through an accessible name.

**FLT-17.** The right top block opens My calendar as a right-side overlay with a scrim. Preserve its calendar grid, agenda and month/week choice. The main-view calendar button must remain available; the drawer heading explains its contents without duplicating a decorative calendar icon. Calendar data/integration policy remains governed by its existing module.

## Acceptance checks

- Top blocks stay balanced; centre text is centred and its chevron accompanies member count.
- Dropdown opens below the top bar; keyboard and outside dismissal restore focus appropriately.
- Six people fit without scrolling; a seventh can be reached through the member scroll region.
- Role-based and private access edits update effective viewers without editing server roles; Cancel preserves saved access.
- Sort and Filter controls align and remain legible on narrow devices.
- Two unread events sort by unread activity. Reading one moves it to Plans on return and preserves its location outline.
- Reading all events removes the Unread heading. Upcoming, undated and past items follow the stated order.
- Alternative sorting and each filter produce correctly labelled groups and useful empty states.
- Event rows show one date/time only; long titles truncate before obscuring date or count.
- Active bottom tab has a fill; create is black with a white plus; content icons have no enclosing tile.
- Check keyboard navigation, accessible names, contrast, reduced motion, safe areas and large text on target devices.

## Implementation status and limits

The HTML demonstrates the approved geometry and core local interactions. It is not wired to real messages, server membership or permissions. Dark mode is exploratory, and runtime sample-state changes are not persisted. Production rollout, token mapping, live-data edge cases and device accessibility verification remain outstanding. Record migration progress in [audit.md](audit.md).
