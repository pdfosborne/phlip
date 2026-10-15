# 05 · Motion

Motion explains where things come from and where they go (PRI-12). It is quick, interruptible, and quiet enough to enjoy for the 500th time (PRI-6).

## Tokens

| Token | Value | Use |
|---|---|---|
| `--dur-press` | 80 ms | Press feedback (scale on `:active`) |
| `--dur-fast` | 120 ms | Hover and colour changes; exits of small things (menus, toasts) |
| `--dur-base` | 180 ms | The default: fades, dims, menus and popovers arriving, the focus lift, the calendar dropdown |
| `--dur-panel` | 220 ms (180 ms on a fine pointer) | Sheets, side panels, the narrow nav sheet |
| `--dur-emphasis` | 280 ms (220 ms on a fine pointer) | The focus-tab reveal, larger containers, the date-context reveal |
| `--dur-reward` | 440 ms | The RSVP wash and other reward moments |
| `--dur-morph` | 520 ms | FAB ⇄ Phlippy, card → row |

| Token | Curve | Use |
|---|---|---|
| `--ease-standard` | `cubic-bezier(.2,.8,.2,1)` | Movement within the screen; spring-back after a cancelled drag |
| `--ease-enter` | `cubic-bezier(.16,1,.3,1)` | Arriving and revealing: sheets rising, the tab revealing, the wash flooding, morphs |
| `--ease-exit` | `cubic-bezier(.3,0,.8,.15)` | Leaving: sheets closing, menus and dialogs dismissing |
| `--ease-spring` | `cubic-bezier(.34,1.2,.5,1)` | Settling with a small overshoot (about 4 %): a card landing |
| `--ease-fade` | `ease` | Opacity and colour only |
| `--ease-linear` | `linear` | Progress, loops, anything tracking a finger |

## Rules

- **MOT-1 — Tokens only.** Every transition and animation uses the duration and easing tokens. Only the signature sequences below may set their own timings, and only here.
- **MOT-2 — Leave faster than you arrive.** An exit uses the next shorter duration and `--ease-exit`: a sheet arrives in 220 ms and leaves in 180 ms; a menu arrives in 180 ms and leaves in 120 ms.
- **MOT-3 — Faster on the desktop.** On a fine pointer `--dur-panel` is 180 ms and `--dur-emphasis` 220 ms; the token layer handles it.
- **MOT-4 — Compositor properties only.** Animate `transform`, `opacity` and `clip-path`. Never animate `width`, `height`, `top`, `left`, `margin` or `max-width` on anything that runs often. Set `will-change` only for the length of a gesture.
- **MOT-5 — Choose the pattern by relationship.**

  | Pattern | When | In Phlip |
  |---|---|---|
  | Container transform | An element opens into its detail, or collapses back | Row → event sheet (the row stays lifted and ringed while the sheet rises); invite card → compact row after an RSVP; draft card → its new row on create |
  | Shared axis (Y) | Content in the same container steps through a sequence | The focus tab's content swap: out over `--dur-fast`, moving 8 px and fading; in over `--dur-panel` from the opposite side |
  | Fade-through | Unrelated content replaces content | Switching sheet tabs; switching servers or groups (`--dur-fast`, or instant) |
  | Fade + slide | Something appears in place | Menus and the calendar dropdown (6 px), toasts (12 px), dialogs (8 px) |

- **MOT-6 — Gestures track the finger.** No transition while dragging (`.is-dragging`). On release, animate from where the finger let go: commit with `--dur-panel` and `--ease-enter`, cancel with `--dur-panel` and `--ease-standard`. A new touch stops a running animation where it is.
- **MOT-7 — Nothing moves without a cause.** Motion follows an input or a change the person can connect to it. Background refreshes don't animate layout.
- **MOT-8 — Ambient motion is rare and settles.** Allowed only for Phlippy's idle face on the FAB, Broadcast live dots and the rail's "reaching" pulse. Each settles to a static state within 5 s of appearing, pauses while off-screen or while the document is hidden, and never runs under reduced motion.
- **MOT-9 — Short staggers.** At most 45 ms between items and at most 5 items; beyond that everything arrives together.
- **MOT-10 — Duration follows distance.** A small move (≤ 24 px) uses `--dur-fast` or `--dur-base`; whole-screen travel uses `--dur-panel`. Don't slow a small thing down to make it look smooth.
- **MOT-11 — Reduced motion keeps meaning, drops movement.** Under `prefers-reduced-motion` (Android "Remove animations", iOS "Reduce Motion") every `--dur-*` token collapses to 1 ms. Movement becomes an instant change or an opacity fade of at most 100 ms; no morphs, overshoot, parallax, sweeps or particles. Every state change still happens. The global kill switch in `00-foundation.css` stays as a safety net.

## Signature sequences

### RSVP confirm — invite card → going

The feed's one reward moment, from the style-guide prototype.

| Stage | Duration | What happens |
|---|---|---|
| 1 Anticipation | `--dur-press` | The Yes circle presses to `scale(.93)` (native `:active`) |
| 2 Reward | `--dur-reward`, `--ease-enter` | A flat periwinkle wash floods the card from the Yes button's measured centre (an expanding `clip-path` circle); the check draws on (stroke-dashoffset, 220 ms after a 40 ms delay); the soft confirm sound plays on the same frame |
| 3 Transition | `--dur-morph` | The card shrinks into the compact row's icon frame while the time label grows into its column and pushes the icon across through ordinary flex layout. The shrinking box carries the wash colour; the icon appears only once the box has settled. |
| 4 Celebration | 480 ms, overlapping the end of stage 3 | One white glint sweeps across the settled icon as the periwinkle fades to neutral. No confetti. |

- The RSVP is sent at the tap; the animation never delays it. The whole sequence finishes within 1.5 s.
- Reduced motion: no stages; the compact row replaces the card with a fade of at most 100 ms.
- Lessons from the prototype: a radial gradient can't fill the card evenly, so reveal a flat colour with `clip-path`; hide the wash the instant the shrink starts; never reveal the icon mid-shrink; animate the row's own left padding into the shrink so the two layouts agree at hand-off.
- Shipped today: stage 2 runs for 260 ms, then the Timeline re-renders into the compact row (`scripts/channel/channel-timeline-view.js:927`). GAP-29.

### Create commit

- The draft card settles into its new row (container transform, `--dur-morph`, `--ease-enter`); the new row then takes the focus lift, and the soft confirm plays when the row appears.
- Any card-throw interaction (the hand, Open Pitch) follows the feel plan's arc: flight ~440 ms, impact ~70 ms with at most 22 % squash and the click on the impact frame, settle ~300 ms with ~4 % overshoot (`--ease-spring`), row content filling in with ≤ 45 ms stagger. If the target is off-screen, scroll to it during the flight so the landing is seen.
- Shipped today: the draft commit re-renders without a settle. GAP-30.

### Task completion — collect → reward

The Tasks signature confirms each task immediately, then rewards a batch without making rapid completion feel noisy.

| Stage | Duration | What happens |
|---|---|---|
| 1 Acknowledge | instant | The checkbox, strike-through and completed state update on input. |
| 2 Collect | 440 ms | A flyer clone of the row translates down into the collapsed Completed header (`--dur-reward`, `--ease-exit`), fading and clipping as it scopes in. The source row keeps its height (`visibility: hidden`; MOT-4) so neighbours do not jump. Its earned share appears as a pale segment at the bar's leading edge. Content text remains full-opacity on a readable muted token (COL-8). |
| 3 Anticipation | ~2 s from the batch's first completion | The pale segment holds. Later completions join the same batch without restarting the anticipation clock. |
| 4 Reward | 520 ms | The committed fill advances across the collected segment in one eased fill. Completions received during this fill are acknowledged immediately but queued for the next batch. |

- After the fly-down, move each row into the collapsed Completed section without opening it. If a pointer, keyboard edit or rapid completion burst is still active, defer that compaction until the interaction settles so neighbouring controls stay put.
- Adding a task or reopening a completed task updates the bar without anticipation or reward.
- A failed completion rolls the checkbox, row and bar back to their last committed state and exposes **Retry**.
- Reduced motion makes every task and bar state change immediate: skip the flyer, hold and fill interpolation.

### FAB ⇄ Phlippy

- After 8 s without interaction the FAB's plus bars morph into Phlippy's face (`--dur-morph`, `--ease-enter`; the corners go from round to `--radius-lg`). Any interaction morphs it back.
- Phlippy never covers content and never delays a tap on the FAB. Reduced motion keeps the plus.

### Timeline focus

- The row nearest the focus line (35 % of the viewport) lifts over `--dur-base`.
- The focused day's date separator reveals its context label (week or month): opacity plus an 8 px slide, `--dur-emphasis`.
- The focus tab rises (`--dur-emphasis`, `--ease-enter`) and swaps its content along the Y axis.

### Surfaces

| Surface | Enter | Exit |
|---|---|---|
| Event sheet | `--dur-panel`, `--ease-enter` | `--dur-base`, `--ease-exit` |
| Modal bottom sheet | `--dur-panel`, `--ease-enter` | `--dur-base`, `--ease-exit`; spring back over `--dur-emphasis`, `--ease-standard` |
| Channel panel (slides on narrow, docks on wide) | `--dur-panel`, `--ease-standard` | `--dur-base`, `--ease-exit` |
| Narrow nav sheet | `--dur-panel`, `--ease-standard`, tracking the finger | the same |
| Menu, popover, calendar dropdown | `--dur-base`, `--ease-enter` | `--dur-fast`, `--ease-exit` |
| Dialog | `--dur-base`, `--ease-enter` | `--dur-fast`, `--ease-exit` |
| Toast, snackbar | `--dur-base`, `--ease-enter` | `--dur-fast`, `--ease-exit` |
