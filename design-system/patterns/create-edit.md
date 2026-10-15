# Create and edit

Creating an event should feel like jotting a note on the day it's for.

## Flow

1. **Start.** Tap the + FAB (creates on the focused day) or an empty day in the feed or month picker (creates on that day).
2. **Stay in place.** The feed stays where it is under a light veil (`--veil-create`), a dashed slot marks where the event will land, and the draft card floats near the top (`--z-create`). The FAB and focus tab hide.
3. **Fill the card.**
   - Head: the day as a date button, plus a close ✕.
   - Icon field: inferred from the title; tap to pick or draw.
   - Title field: comes first, in bold.
   - Time field: type naturally ("7pm tomorrow"), with a suggest button.
   - Place field: known-place chips appear as you type.
   - Footer: a short note and the Create button.
4. **Create.** Create sends the event optimistically. The card settles into its new row ([05-motion.md](../05-motion.md#create-commit)), the row takes the focus lift, and the Tier-1 sound plays.
5. **Leave.** ✕, Escape or Back closes the card. What was typed is kept as a draft and can be resumed.

## Rules

Owner decision, 2026-09-15: retain the current compact draft's input sizes and placeholder layout so the complete card fits above the software keyboard. The general input-size and persistent-label requirements are deferred for this form; do not enlarge it as part of the device-review fixes.

- **PAT-create-1 — In the feed, on its day.** Events are created in the Timeline, on the day they belong to — never in a dialog (PAT-surfaces-2).
- **PAT-create-2 — Title first.** The title field has focus when the card opens. The icon is inferred from the title and can be changed. Nothing else is needed to start.
- **PAT-create-3 — Show the interpretation.** Typed times keep the minutes entered, and the card shows what it understood. The chevron time grid still snaps to 15-minute start/end. When unsure, show the best guess for the person to correct; never silently drop what they typed.
- **PAT-create-4 — Smart defaults.** The date is the focused or tapped day; the duration is the event type's default; place suggestions come from the server's locations and recent places.
- **PAT-create-5 — Visible requirements.** A required field that is still empty shows the "needs fill" state (dashed `--border-strong` on `--surface-1`). The focused field gets a 2 px `--periwinkle-border` plus a 3 px `--periwinkle-tint-soft` ring. Create is the only Primary button (CMP-button-1).
- **PAT-create-6 — Keyboard-aware.** On touch the card recentres above the software keyboard, and the focused field is never covered.
- **PAT-create-7 — Leaving is safe.** Escape and Back close the topmost popover first, then the card (INT-6). Typed input is kept as a draft, so there is no "Discard?" dialog.
- **PAT-create-8 — Only where allowed.** The FAB appears only where you can create. Where creation is impossible — pinned location or people boards, missing permission — the board says so in one line instead of showing a dead button.
- **PAT-create-9 — Edit is the same card.** Editing an existing event reopens the draft card with the "Editing" pill and Save in place of Create.
- **PAT-create-10 — Sound marks readiness and commit.** A soft "armed" tick plays when the card first becomes postable, and the confirm sound plays on create (INT-17).

## Current implementation

- Draft card: `scripts/hand/hand-create-draft.js` (`openCreateDraft`, `body.tl-creating`; Escape closes popovers first, then the card).
- Time parsing and the 15-minute grid: `hand-create-time.js`. Suggestions: `hand-create-suggest.js`.
- Styles: `styles/36-create-draft.css` — card up to 452 px, radius 16, padding 12; fields radius 10, min height 42–46 px; place chips 27 px tall at 10 px; the "Editing" pill `.cd-editing-pill`.
- The FAB wiring: `scripts/channel/channel-timeline-view.js:2381`.

## Gaps

GAP-10 (10 px chips and note, 9.5 px placeholder), GAP-13 (28 px close), GAP-14 (14 px and 13 px inputs), GAP-17 (field boundary on `--border`), GAP-30 (no settle motion or sound on create).
