# 02 · Typography and icons

One typeface, used two ways: plain and legible for reading, structured and emphasised for numbers. Icons come from one family, drawn one way.

## Typeface

- **TYP-1 — Atkinson Hyperlegible.** Bundled locally (`fonts/AtkinsonHyperlegible-{Regular,Bold}.woff2`, `font-display: swap`) and set through `--sans`. It was chosen because it was engineered from vision-science research for legibility — clarity is the brand story. Colour, shape and the numerals system carry the warmth.
- **TYP-2 — Two weights only.** Only 400 and 700 ship, so use `--fw-regular` and `--fw-bold`. Any other weight is a lie: 500 renders as 400, and 550–900 render as 700.
- **TYP-3 — No italics.** Atkinson ships no italic face, so the browser would fake an oblique. Emphasise with weight or colour.
- **TYP-4 — Monospace is for machine text.** `--mono` is only for codes, URLs, IDs and values a person may copy (server URL, invite codes). Never for labels, counts, badges or section headings.
- **TYP-5 — Card fonts are content.** Event-card presets may use the preset stacks in `pitch/event-card-styles.js` (Clean, Rounded, Editorial, Mono). Those fonts are not bundled and resolve to system fonts. UI chrome never uses them.

## Type scale

| Token | Size | Line height | Weight | Default colour | Use |
|---|---|---|---|---|---|
| `--fs-badge` | 9 px | `--lh-none` | 700 | inherits | A number inside an icon or chip: chat count, going count, tab badge |
| `--fs-caption` | 11 px | `--lh-tight` | 400 | `--text-secondary` | Attribution ("by Ada"), "Check conflicts", time rail, source group, uppercase group labels |
| `--fs-meta` | 12 px | `--lh-tight` | 400; 700 for labels | `--text-secondary` | Metadata, date separators, sheet tabs, chips, form labels, menu section labels |
| `--fs-small` | 13 px | `--lh-snug` | 400 | `--text-primary` | Menu items, toasts, chat messages, sheet descriptions |
| `--fs-body-sm` | 14 px | `--lh-snug` | 400 | `--text-primary` | Compact row titles, dense lists, sidebar items |
| `--fs-body` | 15 px | `--lh-body` | 400 | `--text-primary` | App default (`body`), invite titles, primary list text |
| `--fs-title` | 16 px | `--lh-tight` | 700 | `--text-primary` | Sheet, dialog, panel and side-overlay titles |
| `--fs-heading` | 18 px | `--lh-tight` | 700 | `--text-primary` | Panel headings (My calendar), empty-state titles |
| `--fs-display` | 22 px | `--lh-tight` | 700 | `--text-primary` | Onboarding and splash headlines |
| `--fs-hero` | 28 px | `--lh-tight` | 700 | `--text-primary` | Splash and marketing only |
| `--fs-input` | 16 px | `--lh-snug` | 400 | `--text-primary` | Every text input and textarea on touch |

Line heights: `--lh-none` 1 (badges, glyph-aligned numerals) · `--lh-tight` 1.2 (single-line labels and titles) · `--lh-snug` 1.35 (wrapped UI text) · `--lh-body` 1.45 (body, chat) · `--lh-reading` 1.5 (descriptions, legal text).

- **TYP-6 — On the scale.** Sizes come from the table. No half pixels (12.5, 13.5, 14.5 …): round to the nearest step.
- **TYP-7 — 11 px floor.** Text is never smaller than 11 px. 9 px is allowed only for a number inside a badge that repeats information shown elsewhere (the going count also appears on the sheet's "6 going" tab).
- **TYP-8 — 16 px inputs on touch.** WebKit zooms the page when a focused input is under 16 px, and thumbs need the size. On a fine pointer an input may use `--fs-small` or `--fs-body-sm`.

## Hierarchy

- **TYP-9 — Weight and colour before size.** Primary: 700, `--text-primary` (titles, unread events). Secondary: 400, `--text-secondary` (metadata). Tertiary: 11 px `--text-secondary` (attribution). A tertiary link is identical plus an underline — the underline alone marks it tappable.
- **TYP-10 — Unread is bold.** A row title turns 700 while its event has unread chat, always paired with the notify-blue dot.
- **TYP-11 — Case.** Sentence case for all UI text: buttons, titles, menu items, tabs. Uppercase only for group labels of 12 px or less (sidebar section labels, date-separator days) with `--ls-caps`. Never uppercase body text or buttons.
- **TYP-12 — Letter spacing.** `--ls-caps` for uppercase labels, `--ls-numeric` for Tier-1 numerals, `--ls-heading` for bold titles of 16 px and up. Everything else is 0.

## Numerals

- **TYP-13 — Tabular figures everywhere.** Every time, date, count and duration uses `font-variant-numeric: tabular-nums`, so digits align and don't jitter as they change.
- **TYP-14 — Two tiers.** Tier 1 — 700, `--periwinkle-text`, `--ls-numeric` — is only for the time on an undecided invite: the number being decided around. Tier 2 — the surrounding text's size and colour — is everywhere else. Once an event is accepted or declined its time reverts to Tier 2.

## Text behaviour

- **TYP-15 — Truncate titles, never facts.** Single-line titles truncate with an ellipsis. Times, dates and counts never truncate. In "Title · until 9:45pm" the title gives way first so the end time stays visible.
- **TYP-16 — Truncating grid and flex children need `min-width: 0`.** Otherwise unbroken text forces the column wider than its share (the style guide's week-boundary bug).
- **TYP-17 — Clamp long text.** Descriptions in compact contexts clamp to 3 lines with a way to see the rest; the sheet's Description tab shows everything.
- **TYP-18 — Links are underlined.** Inline links use `text-underline-offset: 2px`, coloured `--periwinkle-text` in content or `--text-secondary` for tertiary actions. Colour alone never marks a link.
- **TYP-19 — Readable measure.** Long-form text sits in the 620 px content column (about 70–80 characters at 15 px); it never spans a wide desktop window.

## Icons

- **TYP-20 — One family.** Lucide 0.525.0 through `ic(name)` (`helpers/icons-lucide-pack.js`, generated by `tools/gen-lucide-icon-pack.mjs`): 24-unit viewBox, stroke 2, round caps and joins, `currentColor`, `aria-hidden="true"`. Don't hand-draw a glyph Lucide already has, and don't mix families.
- **TYP-21 — Five sizes.** `--icon-xs` 12 (inline with 11–12 px meta) · `--icon-sm` 14 (compact rows, chips) · `--icon-md` 16 (menus, buttons, tabs) · `--icon-lg` 20 (row accessories, head buttons) · `--icon-xl` 24 (menu button, FAB plus). The stroke stays 2 at every size.
- **TYP-22 — Icons follow text colour.** Resting `--text-secondary`, selected `--periwinkle-text`, destructive `--red-text`, white on dark fills.
- **TYP-23 — Never icon-only meaning.** An icon sits next to a label, or an icon-only button carries `aria-label` and `title`.
- **TYP-24 — Icon-to-text gap.** `--space-4` next to 11–12 px text, `--space-6` next to 13–15 px text, `--space-10` in menu items.
- **TYP-25 — Event glyphs are content.** An event's icon is whatever its creator chose — a Lucide name, an emoji or a drawn `d:` stroke set — rendered by `ic()` inside an event frame (32 px on compact rows, 46 px on invite cards; `--radius-sm`, 1.5 px `--border-strong`). Emoji belong to user content (event glyphs, reactions) only; UI chrome uses Lucide.
