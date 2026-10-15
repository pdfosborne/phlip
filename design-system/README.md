# Phlip design system

The single source of truth for how Phlip looks, moves and behaves. It applies to every surface built from the shared web client (`phlip-web/public/`) — the Android app WebView, the iOS join-only shell, host-served browser pages, the interactive demo and share-guest microsites — and to the native Android screens (`SettingsActivity`) that sit beside them.

When code and this spec disagree, the spec is right and the difference is a bug, tracked in [audit.md](audit.md) until it is fixed.

## Precedence

1. **This spec** (`design-system/`). For the revised board layout, [Floating board layout spec sheet](floating-board-layout.md) is the latest owner-approved decision and supersedes conflicting older shell, navigation, row and surface descriptions within its scope.
2. **[Floating panels mockup](mockups/floating-panels.html)** is the interaction reference for the revised board layout. It uses sample data and is not production implementation. **`feature-planning/style-templates/style-guide-8-color-review.html`** — the visual companion (swatches, live demos, the RSVP-confirm prototype). Where it differs from this spec, this spec wins.
3. **`feature-planning/app-design-research.md`** — rationale and sources behind the interaction rules.

Where no later owner decision exists, the style guide and shipped CSS are reconciled against the existing module specs. The approved floating-board layout takes precedence over shipped CSS for its scope; differences remain migration work. Each discrepancy is listed in [audit.md](audit.md#style-guide-vs-code).

## How to use it

- **Tokens first.** Every colour, size, space, radius, shadow, layer, duration and easing named here is a CSS custom property in `phlip-web/public/styles/00-foundation.css`. Component CSS uses `var(--token)`; a raw value is drift. New tokens are added there and nowhere else.
- **Reuse before inventing.** Build from [components/](components/) and [patterns/](patterns/). A new component gets a spec file before it gets code.
- **Cite rules.** Commits and reviews reference rule IDs ("follows INT-9", "fixes GAP-4").
- **Check drift.** Before merging a UI change run
  `python3 tools/design_token_audit.py --baseline tools/design_token_baseline.json`.
  It fails if any stylesheet gains raw values. When a change lowers the counts, refresh the baseline in the same commit with `--json tools/design_token_baseline.json`.

Wording: **must / must not** are requirements; **should** is the default unless a documented reason says otherwise; **may** is optional.

## Modules

| File | Covers |
|---|---|
| [00-principles.md](00-principles.md) | Product and design principles, performance budgets, review heuristics |
| [01-color.md](01-color.md) | Colour tokens, roles, contrast matrix, legacy aliases, user-chosen colours |
| [02-typography.md](02-typography.md) | Typeface, type scale, numerals, text rules, iconography |
| [03-layout.md](03-layout.md) | Spacing, radius, grids, breakpoints, shell geometry, safe areas, touch targets |
| [04-elevation.md](04-elevation.md) | Surfaces, shadows, scrims, z-index layers |
| [05-motion.md](05-motion.md) | Durations, easing, choreography, signature sequences, reduced motion |
| [06-interaction.md](06-interaction.md) | Gestures, back stack, dismissal, feedback, sound and haptics, keyboard, hover |
| [07-accessibility.md](07-accessibility.md) | WCAG 2.2 AA checklist mapped to Phlip, screen readers, test procedure |
| [08-platforms.md](08-platforms.md) | Touch and pointer skins; Android, iOS, browser and native screens |
| [09-content.md](09-content.md) | Voice, glossary, formats, microcopy |
| [components/](components/) | One file per component |
| [patterns/](patterns/) | Flows that combine components |
| [audit.md](audit.md) | Current drift, gap register, migration order |

**Components:** [avatar](components/avatar.md) · [button](components/button.md) · [calendar](components/calendar.md) · [dialog](components/dialog.md) · [event-card](components/event-card.md) · [event-row](components/event-row.md) · [feedback](components/feedback.md) · [input](components/input.md) · [list-row](components/list-row.md) · [menu](components/menu.md) · [selection](components/selection.md) · [sheet](components/sheet.md) · [shell](components/shell.md)

**Patterns:** [navigation](patterns/navigation.md) · [surfaces](patterns/surfaces.md) · [rsvp](patterns/rsvp.md) · [create-edit](patterns/create-edit.md) · [chat](patterns/chat.md) · [destructive-actions](patterns/destructive-actions.md) · [settings](patterns/settings.md) · [states](patterns/states.md) · [servers](patterns/servers.md)

Every component file uses the same sections: Purpose · Anatomy · Tokens · Sizes · States · Behaviour · Accessibility · Do / Don't · Current implementation · Gaps.

## Rule IDs

| Prefix | Module |
|---|---|
| `PRI` | 00-principles |
| `COL` | 01-color |
| `TYP` | 02-typography |
| `LAY` | 03-layout |
| `ELV` | 04-elevation |
| `MOT` | 05-motion |
| `INT` | 06-interaction |
| `A11Y` | 07-accessibility |
| `PLT` | 08-platforms |
| `CNT` | 09-content |
| `CMP-<name>` | components/*name*.md (e.g. `CMP-button-3`) |
| `PAT-<name>` | patterns/*name*.md (e.g. `PAT-rsvp-2`) |
| `GAP` | the gap register in audit.md |

IDs are permanent. A new rule takes the next free number; a withdrawn rule stays in place marked **Retired**, so an ID never changes meaning.

## Changing the system

1. Change the spec first: the relevant module, plus audit.md if the change opens or closes a gap.
2. Add or adjust tokens in `00-foundation.css`.
3. Change the code.
4. Run the audit; refresh the baseline if counts dropped.
5. Bump the CSS cache: the changed module's `?v=` in `style.css`, `style.css?v=` in `index.html`, and `SHELL_VER` in `sw.js`.

## Scope

- Light theme only. The dormant `:root[data-theme="dark"]` block in `00-foundation.css` is not part of the system.
- Server and board hierarchy remains. The approved board surface now uses floating top-bar blocks, Chats / Events / Tasks bottom navigation, a separate create FAB, and a top-anchored board dropdown. See [the layout spec sheet](floating-board-layout.md). A command palette remains out of scope.
- The mockup includes an exploratory dark-mode toggle; this does not change the light-theme production scope.
- This update records approved design and mockup behaviour, not a completed production rollout.

## Owner decisions · 15 September 2026

A server defines the overall group; boards are its subgroups; Events, Chat and Tasks are views in each board. “Channel” is an implementation term. The updated glossary and navigation decision govern older descriptions that use “event group” or “chat group”. The compact draft form is retained to preserve its fit above the software keyboard; see patterns/create-edit.md. On touch, collapsed board headers and pinned location/person entries use a compact 40 px rhythm; expanded Events / Chat / Tasks rows remain 48 px.

## Owner decisions · 23 September 2026

The [floating board layout spec sheet](floating-board-layout.md) defines the revised layout and its acceptance checks. The [interactive HTML mockup](mockups/floating-panels.html) demonstrates it.

- Use three floating top blocks: server/back, centred board title with member-count chevron, and My calendar. The centre block expands downward to board options.
- Use bare outline icons within content. Top navigation blocks and the black create FAB remain intentional button surfaces. The active bottom tab has a periwinkle fill.
- Show a single event date/time per event conversation; do not add a last-message timestamp. General may show message time because it has no event date.
- Default Chats sorting is **Unread, then event date**. Show Unread and Plans section labels with whitespace, without horizontal rules. Hide empty sections.
- Keep the last-opened conversation outline as a return-location cue, independent of unread state. Move a newly read event into Plans when returning from it.
- Board options begin with people and right-aligned Edit access. Fit six 32 px member rows in a fixed 192 px scroll region. Follow with equal-width Sort and Filter dropdowns, then More board settings.
- Edit access selects server roles for role-based boards, or individual server members for private boards; it does not change users' server roles.
- Do not include Invite / share link, Pinned locations or repeated board-title headings in this dropdown.

Rule prefix **FLT** belongs to the layout spec sheet. Its rules are scoped overrides; existing accessibility, token, platform and interaction requirements continue to apply unless explicitly superseded.
