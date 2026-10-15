# 07 · Accessibility

Target: **WCAG 2.2 level AA** on every surface, in every shell. Accessibility is part of "clarity is the brand" (PRI-7), not a retrofit. Where this module and another disagree, the stricter rule wins.

## Checklist

| WCAG 2.2 | What it means in Phlip | See |
|---|---|---|
| 1.1.1 Non-text content | Icon-only buttons have an `aria-label`; decorative icons are `aria-hidden` (as `ic()` renders them); an event's glyph is named by its row's label; reactions and drawn icons have text names. | TYP-23 |
| 1.3.1 Info and relationships | Titles are headings; feeds and menus are lists; form labels are bound to their inputs. | CMP-input |
| 1.4.1 Use of colour | Colour is never the only signal: unread = dot + bold; declined = × glyph + muted text; selected = tint + weight; error = message text. | COL-2, COL-12 |
| 1.4.3 Contrast | Text ≥ 4.5 : 1 (≥ 3 : 1 at ≥ 24 px, or ≥ 18.66 px bold) — only the permitted pairs in the matrix. | COL-5, COL-6 |
| 1.4.4 Resize text | Works at 200 % text through the Android system font size, browser zoom and iOS Dynamic Type. | LAY-26 |
| 1.4.10 Reflow | Works at 320 px wide without horizontal scrolling. | LAY-17 |
| 1.4.11 Non-text contrast | Icons, control boundaries and focus indicators ≥ 3 : 1. | COL-7, COL-10 |
| 1.4.12 Text spacing | Layouts tolerate larger line and letter spacing: no fixed heights on text. | LAY-26 |
| 1.4.13 Content on hover or focus | Hover or focus popovers can be dismissed with Escape, can be hovered, and stay until dismissed. | INT |
| 2.1.1 Keyboard | Every action works from a keyboard. | INT keyboard |
| 2.1.2 No keyboard trap | Dialogs keep focus inside, and Escape or Cancel always leaves. | INT, CMP-dialog |
| 2.1.4 Character key shortcuts | No single-key global shortcuts. | INT |
| 2.2.1 Timing adjustable | A snackbar with an action stays ≥ 6 s and pauses on hover or focus; nothing essential lives only in a timed message. | CMP-feedback |
| 2.2.2 Pause, stop, hide | Ambient loops settle within 5 s, stop when hidden and never run under reduced motion. | MOT-8 |
| 2.3.1 Three flashes | Nothing flashes. | — |
| 2.4.3 Focus order | DOM order matches visual order. Overlays take focus on open and return it to their trigger on close. | INT |
| 2.4.6 Headings and labels | Headings and labels describe their content. | CNT |
| 2.4.7 Focus visible | A 2 px `--focus-ring-color` outline, offset 2 px, on every focusable element. | INT |
| 2.4.11 Focus not obscured | The sticky head, focus tab, FAB and sheets never fully cover the focused element: scrollers set `scroll-padding` to the height of their fixed chrome. | A11Y-4 |
| 2.5.1 Pointer gestures | Every swipe, drag or path gesture has a single-tap alternative. | INT equivalents |
| 2.5.2 Pointer cancellation | Actions fire on release; moving more than 12 px cancels. A long-press opens a menu, never a destructive action. | INT |
| 2.5.3 Label in name | A control's accessible name contains its visible label. | — |
| 2.5.7 Dragging movements | Every drag (reorder, move, resize) has a button or menu alternative. | INT |
| 2.5.8 Target size | ≥ 24 × 24 px everywhere; Phlip uses 48 px on touch. | LAY-22 |
| 3.1.1 Language of page | `<html lang="en">`. | — |
| 3.2.1 / 3.2.2 On focus, on input | Focusing or editing a field never navigates or submits by itself. | — |
| 3.2.6 Consistent help | Help & Legal stays in the same places: the sidebar (above Leave) and the join dialog. | PAT-settings |
| 3.3.1 / 3.3.3 Errors | Inline messages say what went wrong and how to fix it. | CNT |
| 3.3.7 Redundant entry | A flow never asks twice for something already entered in it. | — |
| 3.3.8 Accessible authentication | Password fields allow paste and password managers (`autocomplete` set); no puzzles. | CMP-input |
| 4.1.2 Name, role, value | Custom widgets expose roles and states (table below). | A11Y-2 |
| 4.1.3 Status messages | Toasts and snackbars live in a `role="status"` region; errors that don't take focus use `role="alert"`. | CMP-feedback |

## Rules

- **A11Y-1 — AA is the floor.** A change that fails a row of the checklist doesn't merge. An existing failure is a gap in [audit.md](audit.md).
- **A11Y-2 — Roles for custom widgets.**

  | Widget | Semantics |
  |---|---|
  | Timeline row | A button (`tabindex="0"`) named "*Title*, *day* at *time*, *RSVP state*[, *n* unread]". Enter/Space opens the event sheet; the context-menu key or Shift+F10 opens the quick menu. |
  | Invite actions | Buttons "Going" and "Can't go", each including the event title in its name. |
  | Quick menu | `role="menu"` with `role="menuitem"` items; arrow keys move; Escape closes and returns focus to the row. |
  | Event sheet | `role="dialog"`, `aria-modal="true"` (the feed behind is inert while it's open), labelled by the event title. Focus goes to the title on open and back to the row on close. |
  | Sheet tabs, panel tabs | `role="tablist"` / `"tab"` (`aria-selected`, `aria-controls`) / `"tabpanel"`; arrow keys switch tabs. |
  | Dialog | `role="dialog"`, or `"alertdialog"` for confirms; `aria-modal="true"`; `aria-labelledby` the title; `aria-describedby` the message. |
  | Toast / snackbar | Inside a `role="status" aria-live="polite"` container; the Undo action is a real button. |
  | Month grid | A grid of day buttons named "Thursday 24 September, 2 events"; arrow keys move by day and week. |
  | Time wheel | `role="listbox"` with `role="option"` + `aria-selected`; arrow keys change the value. |
  | Server rail | A `nav` landmark named "Servers"; each button names the server and its status ("Friends · Synced just now"). |
  | Channel sidebar | A `nav` landmark named "Channels". |
  | + FAB | A button named "New event". |

- **A11Y-3 — Announce what matters.** RSVP saved, event created or deleted (with Undo), message failed, reconnecting and back online are announced politely; errors assertively. Nothing announces during scroll-driven focus changes.
- **A11Y-4 — Keep focus in view.** Scrollers under sticky or floating chrome set `scroll-padding-top` to the sticky head's height and `scroll-padding-bottom` to cover the focus tab and FAB, so a keyboard-focused row is never hidden.
- **A11Y-5 — Screen-reader users can't swipe or long-press reliably.** Every such action is also a visible control: the quick menu through the sheet's ⋮; the nav through the menu button; sheet expand and close through its controls ([06-interaction.md](06-interaction.md#gesture-equivalents)).
- **A11Y-6 — Hide only what's duplicated.** `aria-hidden` is for decorative or repeated content (icons beside labels, the focus-line rule). Never hide content a sighted user relies on.
- **A11Y-7 — Sensory channels are optional.** Sound and haptics are never the only signal ([06-interaction.md](06-interaction.md#sound-and-haptics)); motion follows reduced motion ([05-motion.md](05-motion.md)).

## Test procedure

Run on every release that touches UI, and on any new component:

1. **Keyboard only** (desktop demo, `/?demo=1`): Tab through rail → sidebar → head → feed → FAB; open a row with Enter; switch sheet tabs with arrow keys; open the quick menu with Shift+F10; back out with Escape. Focus is visible at every step and returns where it came from.
2. **TalkBack** on the Android app: explore the Timeline by touch; every row's name makes sense; RSVP from the sheet; toasts are announced.
3. **VoiceOver** on the iOS shell: the join flow and the Timeline.
4. **Largest font size** (Android Settings → Display → Font size): rows grow, nothing clips, nothing overlaps.
5. **Reduced motion on** (Android "Remove animations", iOS "Reduce Motion", desktop OS setting): RSVP, sheets and the FAB work with no movement.
6. **Contrast:** any new colour pair is checked against the [01-color matrix](01-color.md#contrast-matrix) before it merges.
7. **320 px wide:** no horizontal scrolling.
