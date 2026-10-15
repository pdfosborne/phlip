# Button

## Purpose

Trigger an action. A button says what it does and makes it obvious which action on the surface is the main one.

## Anatomy

Container (fill or outline) · label (sentence-case verb) · optional leading icon (`--icon-md`) · optional trailing badge. Icon buttons carry only an icon plus an accessible name. The + FAB is a round black Primary button whose plus morphs into Phlippy when idle.

## Variants

Pick the variant by intent, never by taste.

| Variant | Fill | Label | Border | Intent | Examples |
|---|---|---|---|---|---|
| **Primary** (black) | `--action-base` | `--on-action` | — | The one main action on a surface, including a step the person must take for something to move on | + FAB, Send, Save, Create, Approve join requests, finish setup, required update |
| **Menu CTA** (navy) | `--menu-button-base` | `--on-menu-button` | — | Go deeper from a menu or panel | Open server settings, Manage places, Continue in setup |
| **Confirm** (periwinkle) | `--periwinkle-tint-soft` | `--periwinkle-text` | 1.5 px `--periwinkle-border` | A positive commitment made inline | RSVP Yes circle, Save in My calendar's personal-event form, selected toggles |
| **Secondary** | `--surface-3-strong` (or `--surface-2` + `--border`) | `--text-primary` | — | An alternative beside a primary | Today, view options, the secondary action in a dialog |
| **Text** | none | `--text-secondary` | — | Low emphasis: cancel, dismiss | Cancel, Not now |
| **Link** | none | `--text-secondary` (tertiary) or `--periwinkle-text` (in content) | underline | Inline navigation | Check conflicts, Show in timeline |
| **Destructive** | `--danger-wash` | `--red-text` | 1.5 px `--red-border` | The final confirm of a destructive action, inside a dialog | Delete, Leave & delete my data |

In menus and lists a destructive action is a text item in `--red-text` ([menu.md](menu.md)), not a filled button.

## Sizes

| Size | Visual height | Padding (x) | Label | Use |
|---|---|---|---|---|
| Large | 48 px | `--space-20` | `--fs-body`, 700 | Primary actions in sheets and dialogs on touch, onboarding |
| Medium | 40 px | `--space-16` | `--fs-body-sm`, 700 | Default |
| Small | 32 px | `--space-12` | `--fs-small`, 700 | Inline and toolbar actions |
| Icon | 32–36 px square | — | `--icon-md` or `--icon-lg` | Head actions, row accessories, close |
| FAB | 52 px round | — | `--icon-xl` plus | The Timeline's + |

Rectangular buttons use `--radius-sm`; pill buttons `--radius-pill`; circular buttons (FAB, RSVP, Send) `--radius-round`. Whatever the visual size, the hit area is at least `--hit-min` on touch (LAY-22).

## States

| State | Treatment |
|---|---|
| Hover (pointer skin only) | Text, Secondary: `--surface-1` fill. Confirm: `--periwinkle-tint`. Primary and Menu CTA: 8 % white mixed into the fill. |
| Pressed | `scale(.96)` — `.93` for circular controls — over `--dur-press`, plus the hover fill. On touch the pressed state replaces hover (the tap highlight is off, PLT-8). |
| Focus-visible | 2 px `--focus-ring-color` outline, offset 2 px |
| Selected (toggle) | Confirm styling and `aria-pressed="true"` |
| Disabled | Opacity .4, no pointer events, `aria-disabled="true"`. Prefer a hint that says why over silently disabling. |
| Loading | The label stays and the width doesn't change; a spinner replaces the icon; `aria-busy="true"`; repeat taps are ignored. |

## Rules

- **CMP-button-1 — One loud button.** At most one Primary button per surface (screen region, sheet, dialog, card). On the Timeline the + FAB is that button.
- **CMP-button-2 — Intent picks the variant.** Black is the primary action; navy only leads deeper and never commits data; periwinkle confirms inline and never destroys.
- **CMP-button-3 — Verbs, not "OK".** Labels are sentence-case verbs ("Save", "Add personal event", "Delete event"). A consequential or destructive action is always named: never "OK" or "Yes".
- **CMP-button-4 — Order.** In dialogs and sheet footers, actions sit at the end: the text button first, the primary last. In a destructive confirm the Destructive button sits last, but focus starts on Cancel.
- **CMP-button-5 — Icon buttons.** 32–36 px visual, transparent at rest (or `--surface-3-strong` in a toolbar), `--radius-sm`, icon `--icon-lg` or `--icon-md`, hit area grown with `::before` on touch. Always `aria-label` and `title`.
- **CMP-button-6 — The FAB.** 52 px, black (`--action-base`), white plus, `--shadow-fab`, bottom-right in the thumb zone, one per screen, Timeline only, named "New event". Hidden while a sheet is open or an event is being created. Phlippy's idle morph is described in [05-motion.md](../05-motion.md).
- **CMP-button-7 — Activate on release.** Buttons fire on `click`, never on `pointerdown`. An action in flight blocks repeat taps unless it is optimistic.
- **CMP-button-8 — Real buttons.** Use `<button type="button">` for actions and `<a href>` for navigation. The visible label is part of the accessible name.

## Do / Don't

- **Do** give each surface one clear primary, and make Cancel a text button.
- **Do** name the action the button performs.
- **Don't** put two Primary buttons side by side.
- **Don't** ship an icon-only button without a name, or disable a button without saying why.

## Current implementation

- + FAB `.tl-create-fab` — `styles/35-timeline-view.css:948`: 52 px black round.
- Send `.tl-sheet-compose button` — `35-timeline-view.css:1605`: 36 px black round.
- Description editor `.tl-desc-save` / `.tl-desc-cancel` — `35-timeline-view.css:1755`: black primary plus text cancel.
- These black buttons fill with `--text-primary` today; P1 moves them to `--action-base` (the same black).
- RSVP Yes `.tl-rsvp-yes` — `35-timeline-view.css:728`: 42 px Confirm circle.
- Dialog buttons `.modal-card .save` — `50-event-detail.css:4193`: tinted through legacy `--ui-tint` / `--ui-accent`; destructive `.save.danger` — `70-admin-settings.css:3474`, using `--ember`.
- `.danger` text button — `70-admin-settings.css:2351`, a literal `#c0392b`.
- There is no shared button class: 49 distinct `*-btn` classes each restyle buttons. Menu CTA exists as a token only.

## Gaps

GAP-4 (the "OK" default and focus on the destructive button), GAP-9 (hover not gated), GAP-13 (icon buttons under 48 px on touch), GAP-25 (legacy aliases and literals).
