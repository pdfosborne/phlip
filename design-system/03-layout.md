# 03 · Layout

Spacing, radius, grids, breakpoints and the physical rules that keep Phlip usable on a phone held in one hand and on a desktop with a mouse.

## Spacing

| Token | px | Typical use |
|---|---|---|
| `--space-0` | 0 | Reset |
| `--space-2` | 2 | Hairline nudges, badge padding, gap between head icon buttons |
| `--space-4` | 4 | Icon to 11–12 px text, chip inner gap |
| `--space-6` | 6 | Tight rows: icon to 13–15 px text, compact button padding |
| `--space-8` | 8 | Related items: default toolbar and list gap |
| `--space-10` | 10 | Timeline rhythm (between rows and day groups), menu item padding |
| `--space-12` | 12 | Card padding, page gutter, sheet section gaps |
| `--space-14` | 14 | List rhythm (sidebar, settings), field spacing |
| `--space-16` | 16 | Sheet and panel padding, FAB offset from the edge |
| `--space-20` | 20 | Section breaks inside a surface |
| `--space-24` | 24 | Dialog padding, breaks between groups |
| `--space-32` · `--space-40` · `--space-48` | 32 · 40 · 48 | Empty states, onboarding |

Semantic spacing: `--gutter` 12 px (10 px at ≤ 520 px) is the horizontal page padding · `--pad-card` 12 · `--pad-sheet` 16 · `--pad-dialog` 24 · `--gap-feed` 10 (Timeline rows and day groups).

- **LAY-1 — On the scale.** Every padding, margin and gap comes from the scale: every even step to 16, then 20, 24, 32, 40, 48. Use the semantic token where one exists.
- **LAY-2 — Retired values.** Odd values and 18/22 map to a neighbour: 3→2 or 4, 5→4 or 6, 7→6 or 8, 9→8 or 10, 11→10 or 12, 13→12 or 14, 15→14 or 16, 18→16 or 20, 22→20 or 24. Choose by role from the table above. If neither neighbour looks right, change the spec, not the number. A 1 px hairline is a border, not spacing.
- **LAY-3 — Proximity.** Space inside a group is smaller than space between groups: related items ≤ 8, sibling rows 10–14, sections ≥ 20.
- **LAY-4 — Computed offsets use tokens.** Alignment offsets (for example the compact row's time column starting where the invite card's icon starts, `--tl-invite-icon-start`) are `calc()` of tokens, not magic numbers.
- **LAY-5 — Bleeds use the gutter.** Negative margins only pull a surface out to the screen edge, written as `calc(-1 * var(--gutter))`.

## Radius

| Token | px | Use |
|---|---|---|
| `--radius-gem` | 2 | Gem and diamond marks |
| `--radius-xs` | 4 | Date labels, code spans, small tags |
| `--radius-sm` | 8 | Event-icon frames, icon buttons, inputs, menu items, month-day cells, small buttons |
| `--radius-md` | 12 | Cards, invite cards, Timeline rows, menus, popovers, the calendar dropdown, toasts |
| `--radius-lg` | 16 | Dialogs, the create card, top corners of sheets and the focus tab, resting server-rail buttons |
| `--radius-pill` | 999 px | Chips, pill tabs, the compose field, handles, count badges |
| `--radius-round` | 50 % | Avatars, dots, the RSVP circle, the FAB, the send button |

`--radius` (8 px) is the older name for `--radius-sm` and stays as an alias.

- **LAY-6 — On the scale.** Radii come from the table. Retired values map: 6/7/9/10/11 → 8 for controls or 12 for containers; 14 → 12 or 16; 18/20 → 16; 3/5 → 4; 99 px → 999 px.
- **LAY-7 — Nested radius.** Inner radius = outer radius − padding, never below `--radius-xs`. A 12 px menu with 4 px padding holds 8 px items.
- **LAY-8 — Continuous runs.** A multi-day bar rounds only its true start and end; a week-row wrap stays square, so it reads as "continues" rather than as a second event.
- **LAY-9 — Sheets round their top.** Sheets and the focus tab round only their top corners (`--radius-lg`) and go square when expanded to full height.
- **LAY-10 — Server icons morph.** A server-rail button rests at `--radius-lg` and tightens to `--radius-md` on hover and when active. Avatars are always round.

## Grid and alignment

- **LAY-11 — One content column.** Reading and planning content sits in a column of at most `--content-max` (620 px), centred in the main pane: the Timeline feed, the event sheet, the focus tab (620 − 2 × 12 = 596 px) and the create card (452 px).
- **LAY-12 — Timeline rows share columns.** Compact and declined rows use `[time 46] [icon 32] [title 1fr] [accessory auto]`. Invite cards use `[icon 46] [copy 1fr] [action 42]`. The compact row's time column starts where the invite card's icon starts, so icons line up down the feed whatever each event's state.
- **LAY-13 — Alignment.** Text is left-aligned. A column of numbers aligns consistently: Timeline times centre in their column; My calendar times right-align against the dot rail.
- **LAY-14 — Toolbars.** Head icon buttons sit in 36 px boxes with `--space-2` between them and `--space-8` between groups.

## Breakpoints

| Name | Width | What changes |
|---|---|---|
| small | ≤ 390 px | Tighter form paddings |
| compact | ≤ 520 px | `--gutter` 10; tighter invite grid; focus-tab and FAB insets shrink |
| narrow | ≤ 760 px | The rail and sidebar sit under a sliding main sheet; the channel panel overlays; the main head shows the menu/back button; rail 56 px |
| wide | ≥ 761 px | Rail and sidebar always visible; the channel panel docks as a 300 px column; the focus tab and FAB centre on the content column |

- **LAY-15 — Width decides layout.** Layout switches on viewport width only (`isNarrowShell()` mirrors ≤ 760 px). Media queries use only these widths — the one place they are written as numbers, because custom properties can't be used in `@media`.
- **LAY-16 — Input decides affordances.** Hover styles and hit-area growth switch on `(hover: hover) and (pointer: fine)` or `(pointer: coarse)`, independent of width. A tablet is wide and touch; a small desktop window is narrow and pointer.
- **LAY-17 — Reflow.** Everything works at 320 px wide without horizontal scrolling.

## Shell geometry

| Element | Size |
|---|---|
| Server rail | 64 px (56 px at ≤ 760) — `--rail-width` |
| Channel sidebar | 236 px — `--sidebar-width` |
| Channel panel | 300 px, rail + sidebar — `--nav-stack-width` |
| Main head | min 54 px |
| Content column | 620 px — `--content-max` |
| Timeline focus line | 35 % of the viewport height |
| Event sheet top | main head + focus gutter (228 px; 222 px at ≤ 520) |
| + FAB | 52 px, 16 px from the right and bottom plus safe area; 88 px up while the focus tab shows |
| Focus tab | min 72 px tall, 12 px side insets (8 px at ≤ 520) |

## Safe areas, viewport and keyboard

- **LAY-18 — Visual-viewport height.** Full-height layouts use `--app-height`, which `theme-boot.js` syncs from `visualViewport`. Never use `100vh`.
- **LAY-19 — Edges add insets.** Fixed or sticky elements at a screen edge add the matching `--safe-*` inset (FAB bottom = 16 px + `--safe-bottom`; panel top and bottom use the safe insets; sheet panels pad their bottom with `--safe-bottom`).
- **LAY-20 — Keyboard.** `html.ime-open` zeroes `--safe-bottom`; composers stay pinned above the keyboard; the create card recentres. The viewport meta (`interactive-widget=overlays-content`) means the keyboard overlays content, so never pad for it twice.
- **LAY-21 — Panes scroll, the page doesn't.** The body is fixed. Each pane scrolls itself with `overscroll-behavior: contain`.

## Touch targets and text scaling

- **LAY-22 — Hit areas.** At least `--hit-min` (48 px) on a coarse pointer and `--hit-min-fine` (24 px) on a fine pointer. A control may look smaller (icon buttons are 32–36 px): grow the hit area with a transparent `::before`, as `.tl-sheet-handle::before` does, rather than growing the visual.
- **LAY-23 — Spacing between targets.** Adjacent targets are at least 8 px apart, or their hit areas don't overlap.
- **LAY-24 — Thumb zone.** On phones, primary actions live in the bottom half: the + FAB bottom-right, composers at the bottom, sheet actions low. Rare or destructive actions stay away from where a thumb rests.
- **LAY-25 — Row height.** Rows are at least `--row-min` (48 px) on touch: Timeline rows, list rows, menu items. On a fine pointer, list rows and menu items may tighten to 36–40 px.
- **LAY-26 — Survive 200 % text.** The Android WebView follows the system font size (the app doesn't pin `textZoom`). Anything holding text uses `min-height`, not `height`, so rows grow instead of clipping; truncation (TYP-15) keeps them usable.
