# Feedback

Components that say what happened or what's happening: toast, snackbar, inline confirm strip, banners, badges and dots, loading and empty states. Which one to use is decided by the feedback ladder (INT-13).

## Toast

One line about a background or off-screen result, with no action.

- **Anatomy:** a card in ink (`--text-primary`) with `--page-bg` text (16.19 : 1), `--fs-small`, 700, padding `--space-10` `--space-16`, `--radius-md`, `--shadow-pop`, at most `min(90vw, 360px)` wide.
- **Placement:** bottom centre, above the safe area and above the focus tab and FAB when they show; `--z-toast`.
- **Timing:** 3 s for up to six words, up to 5 s for longer text.
- **Motion:** rises 12 px and fades in over `--dur-base`; leaves over `--dur-fast`.
- **Accessibility:** rendered inside a persistent `role="status" aria-live="polite"` region; never focusable.

## Snackbar

A toast with one action — the Undo of [destructive-actions.md](../patterns/destructive-actions.md).

- The action is a text button at the end in `#ffffff`, 700, reachable by keyboard.
- Stays 6 s and pauses while hovered or focused. Swipe or Escape dismisses it (commit).
- One at a time: a new snackbar commits and replaces the previous one.

## Inline confirm strip

For list edits that need apply or undo in place (the people picker). Built with `inlineConfirmShow` / `inlineConfirmHide` / `inlineConfirmBind` from `scripts/boot/ui-confirm.js`.

## Banners

- **Reconnect banner** (`.reconnect`): a full-width strip under the main head, `--fs-small`, 700, centred, `role="status"`. It appears after 8 s of reaching (PAT-states-2) and has soft and syncing variants.
- **Demo bar**: see PLT-19.

## Badges and dots

| Element | Spec | Meaning |
|---|---|---|
| Unread dot | 7 px round `--notify-blue` with a 2 px ring in the surface colour | New chat activity — nothing else |
| Count in an icon | `--fs-badge`, 700, tabular, no background | Message count, going count |
| Count in a list or tab | `--fs-caption`, 700, tabular, `--text-secondary` — never monospace | Invites waiting, items in a group |
| Attention badge | `--radius-pill`, ink fill (`--text-primary`), white `--fs-badge` text | Notifications or requests waiting for you |
| Status dot (rail) | 8–10 px round: `--success` online, `--periwinkle-base` connecting, `--red-border` offline | Connection (COL-13) |
| Live dot | 8 px round: `--success` for LAN, `--periwinkle-base` for public; the pulse settles within 5 s (MOT-8) | A Broadcast is live |
| Pending mark | A small clock or "Sending…" in `--text-secondary` | Waiting for the host (INT-12) |

## Loading and empty

- **Spinner:** 16 px ring in `--text-secondary`, turning linearly. Under reduced motion it shows static text ("Loading…") instead.
- **Skeleton:** blocks in `--surface-3-strong` with `--radius-sm`, shaped like the final layout, without shimmer.
- **Empty state:** one line of `--fs-small` `--text-muted`, centred on the canvas, plus one Text or Secondary button (CNT-13).

## Rules

- **CMP-feedback-1 — Lightest rung first** (INT-13). A toast never carries an action; an action means a snackbar.
- **CMP-feedback-2 — Always announced.** Toasts and snackbars live in a polite live region (A11Y-3); errors that don't take focus use `role="alert"`.
- **CMP-feedback-3 — Never over the thumb.** Feedback appears above the FAB and focus tab and never covers the composer.
- **CMP-feedback-4 — Dots are small and exact.** The unread dot means unread chat only; status dots always have a text equivalent (tooltip or label).
- **CMP-feedback-5 — Counts are text, not decoration.** Tabular numerals, Atkinson not monospace, and at least 4.5 : 1 against their fill.

## Current implementation

- Toast and snackbar: `AshFeedback` in `scripts/boot/ash-feedback.js` (live region, 3 s / 5 s toast, 6 s snackbar with Undo). `.toast` in `styles/30-main-events.css` at `--z-toast` (300). Global `toast()` remains for existing callers.
- Reconnect banner: `30-main-events.css:282`. Live dot: `styles/50-event-detail.css` (`live-pulse`, 1.4 s, infinite).
- Unread dot: `35-timeline-view.css:897`. Panel-tab badge: `20-app-shell.css:657` (`--ember` fill, white 9 px).
- Sidebar counts: `.side-item .dot.dot-count` (12 px monospace); the `.dot` badges on sidebar meta rows use white on `--marigold`.
- Empty notes: `.empty-note`, `.tl-sheet-empty`.

## Gaps

GAP-18 (white text on periwinkle-base badges), GAP-28 (monospace counts), GAP-32 (the live pulse never settles).
