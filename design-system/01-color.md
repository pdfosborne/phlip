# 01 · Colour

Every colour in the app traces back to a token in `phlip-web/public/styles/00-foundation.css`. The palette is light-only: a periwinkle brand over warm neutrals, with raised white surfaces on a cool off-white canvas.

## Tokens

### Surfaces

| Token | Value | Role | Use for | Not for |
|---|---|---|---|---|
| `--page-bg` | `#f8f9fa` | Canvas | Root page, Timeline feed, compact and declined rows | Cards, sheets |
| `--surface-2` | `#ffffff` | Raised | Cards, invite cards, sheets, menus, popovers, dialogs, sticky heads, main head | Page canvas |
| `--surface-1` | `#f4f3ee` | Warm inset | Hover and pressed fill on neutral controls, chat bubbles, compose field, inline forms | Page canvas, large areas |
| `--surface-3` | `#f8f9f9` | Chrome | Server rail, large secondary chrome | Content |
| `--surface-3-strong` | `#ebedef` | Control fill | Resting icon-button fill, selected sidebar row | Behind muted text |

### Borders

| Token | Value | Role | Use for |
|---|---|---|---|
| `--border` | `#e2e0d8` | Decorative hairline | Card and row outlines, dividers, separators |
| `--border-strong` | `#d3d1c7` | Decorative, firmer | Event-icon frames, pending-card outline, drag handles |
| `--border-control` | `#8c887e` | Control boundary (≥ 3:1) | Inputs, selects, textareas, checkboxes, the compose field |

### Text

| Token | Value | Use for |
|---|---|---|
| `--text-primary` | `#1c1c1a` | Titles, unread event names, primary content |
| `--text-secondary` | `#6b6a63` | Metadata, resting icons, attribution, tertiary actions |
| `--text-muted` | `#74716a` | De-emphasised text: declined titles, hints, placeholders, empty states |

### Brand — periwinkle

| Token | Value | Use for |
|---|---|---|
| `--periwinkle-base` | `#7371f7` | The brand hue as a shape: focus line, selection rings, dots, open-sheet outline |
| `--periwinkle-tint-soft` | 10 % of base | Selected fill, confirm-button rest, selected date |
| `--periwinkle-tint` | 22 % of base | Hover and pressed on periwinkle controls, avatar tints |
| `--periwinkle-tint-strong` | 40 % of base | The RSVP-confirm wash only |
| `--periwinkle-border` | `#5b52e0` | Outlines of periwinkle controls, active-tab underline, focus ring, fills that carry white text |
| `--periwinkle-text` | `#322a85` | Text and icons on white or periwinkle tints: active tab labels, Tier-1 times, selected dates, links in content |

### Semantic

| Token | Value | Meaning | Pair with |
|---|---|---|---|
| `--action-base` | `var(--text-primary)` (`#1c1c1a`) | Primary action buttons (black) | `--on-action` (`#ffffff`) |
| `--menu-button-base` | `#171246` | Navigation call to action | `--on-menu-button` (`#ffffff`) |
| `--notify-blue` | `#4f7cff` | New chat activity (dot only) | — |
| `--red-text` | `#7a2f2f` | Destructive labels and icons, error text | — |
| `--red-border` | `#c96b6b` | Destructive outlines, error field boundary | — |
| `--danger-wash` | `rgba(201,107,107,.12)` | Destructive button fill and hover | `--red-text` |
| `--success` | `#2f9e6b` | Online, LAN-live, going — as a shape | — |
| `--success-text` | `#1f7a52` | Green text | — |

### Overlays and focus

| Token | Value | Use for |
|---|---|---|
| `--scrim-modal` | `rgba(20,18,15,.45)` | Dialogs and modal bottom sheets |
| `--scrim-menu` | `rgba(28,28,26,.20)` | Quick menu and popovers on touch |
| `--scrim-clear` | `rgba(28,28,26,.01)` | The event sheet: catches outside taps without dimming |
| `--veil-create` | page-bg at 86 % | Behind the create draft card |
| `--focus-ring-color` | `var(--periwinkle-border)` | The 2 px focus outline |

## Rules

- **COL-1 — Tokens only.** Component CSS uses `var(--token)` for every colour. Literal colours are allowed only in `00-foundation.css`, in user-content data (event-card presets, avatar hue pairs, event-type colours) and in illustration assets (`styles/react-art/`, card backs).
- **COL-2 — One meaning per colour.** Periwinkle = selected, confirmed, focused, brand. Notify-blue = new chat activity and nothing else; the same dot appears on Chat and Hosted accessories. Black (`--action-base`) = the primary action. Navy = navigation call to action. Red = destructive or error. Green = online, LAN-live, going. Never borrow a semantic colour for decoration.
- **COL-3 — Raised on canvas.** Raised things are white `--surface-2`; the canvas is `--page-bg`. Elevation stays visible because the two differ.
- **COL-4 — Surface-1 is an inset.** Use it for hover fills, chat bubbles, the compose field and inline forms; never as a page background.
- **COL-5 — Permitted pairs only.** Text and icons use the pairs marked in the [contrast matrix](#contrast-matrix): at least 4.5 : 1 for text, 3 : 1 for icons, control boundaries and focus indicators.
- **COL-6 — Muted text stays off insets.** `--text-muted` is allowed on `--page-bg`, `--surface-2` and `--surface-3` only. On `--surface-1` or `--surface-3-strong` step up to `--text-secondary`.
- **COL-7 — Shape colours are not text colours.** `--periwinkle-base`, `--notify-blue`, `--red-border` and `--success` are for fills, outlines, dots and rings. Their text partners are `--periwinkle-text`, `--red-text` and `--success-text`.
- **COL-8 — Never mute content with opacity.** Content text keeps its token at full opacity. Opacity is reserved for inactive states: disabled controls (.4), rows behind an open event sheet (.34, non-interactive while it is open), days outside the current month (.45, not selectable).
- **COL-9 — Fills carry their own text colour.** `--action-base` (black) takes `--on-action` (white); `--menu-button-base` takes white; `--periwinkle-border` takes white. White text on `--periwinkle-base` (3.86 : 1) is forbidden.
- **COL-10 — Fields.** A form field's boundary is `--border-control` at rest; focus adds the 2 px `--focus-ring-color` ring; an error swaps the boundary to `--red-border` and shows a `--red-text` message.
- **COL-11 — Destructive.** Menu and row labels use `--red-text` (icon included). The final confirm button uses a `--danger-wash` fill, a `--red-border` outline and a `--red-text` label. The label always says what happens; red is never the only cue.
- **COL-12 — Unread.** Unread chat is a `--notify-blue` dot plus a bold title. No other blue signals unread.
- **COL-13 — Connection status.** Rail and live dots: `--success` online or LAN-live, `--periwinkle-base` connecting or public-live, `--red-border` offline or error. Each dot has a text equivalent (tooltip or label).
- **COL-14 — User-chosen colours.** Event-card presets, event-type colours and avatar hues are content. Their editors must keep text at least 4.5 : 1 against its own background (3 : 1 for text ≥ 24 px, or ≥ 18.66 px bold), warn when a choice fails, and pick dark or light text automatically when only a background is chosen. Built-in presets must pass. UI chrome never takes on user colours.
- **COL-15 — Light only.** `<meta name="theme-color">` is `#ffffff`; Android system bars follow [08-platforms.md](08-platforms.md). The dormant dark-theme block is not part of the system.
- **COL-16 — Legacy aliases are deprecated.** New code must not use the aliases below; migration replaces them ([audit.md](audit.md)).

## Contrast matrix

WCAG 2.x contrast ratios, computed from the token values. ✓ = permitted for the stated use; ✗ = forbidden.

| Foreground | Use | on `surface-2` | on `page-bg` | on `surface-1` | on `surface-3-strong` |
|---|---|---|---|---|---|
| `--text-primary` | text | 17.07 ✓ | 16.19 ✓ | 15.36 ✓ | 14.54 ✓ |
| `--text-secondary` | text | 5.43 ✓ | 5.15 ✓ | 4.89 ✓ | 4.63 ✓ |
| `--text-muted` | text | 4.87 ✓ | 4.62 ✓ | 4.38 ✗ | 4.15 ✗ |
| `--periwinkle-text` | text | 11.63 ✓ | 11.03 ✓ | 10.47 ✓ | 9.91 ✓ |
| `--red-text` | text | 9.23 ✓ | 8.76 ✓ | 8.31 ✓ | 7.86 ✓ |
| `--success-text` | text | 5.30 ✓ | 5.03 ✓ | 4.77 ✓ | 4.51 ✓ |
| `--periwinkle-border` | shape | 5.63 ✓ | 5.34 ✓ | 5.07 ✓ | 4.80 ✓ |
| `--periwinkle-base` | shape | 3.86 ✓ | 3.67 ✓ | 3.48 ✓ | 3.29 ✓ |
| `--notify-blue` | shape | 3.71 ✓ | 3.52 ✓ | 3.34 ✓ | 3.16 ✓ |
| `--red-border` | shape | 3.62 ✓ | 3.44 ✓ | 3.26 ✓ | 3.09 ✓ |
| `--border-control` | shape | 3.54 ✓ | 3.35 ✓ | 3.18 ✓ | 3.01 ✓ |
| `--success` | shape | 3.37 ✓ | 3.20 ✓ | 3.04 ✓ | 2.87 ✗ |
| `--border` | decorative | 1.32 | 1.25 | 1.19 | 1.13 |
| `--border-strong` | decorative | 1.53 | 1.45 | 1.38 | 1.30 |

Fills with text:

| Fill | Text | Ratio |
|---|---|---|
| `--action-base` (black) | `--on-action` | 17.07 ✓ |
| `--menu-button-base` | `--on-menu-button` | 17.34 ✓ |
| `--periwinkle-border` | `#ffffff` | 5.63 ✓ |
| `--periwinkle-base` | `#ffffff` | 3.86 ✗ |
| `--periwinkle-tint-soft` over white | `--periwinkle-text` | 10.39 ✓ |
| `--periwinkle-tint` over white | `--periwinkle-text` | 9.00 ✓ |

Decorative borders never identify a control on their own: a field uses `--border-control`, a card is identified by its content and layout.

## Legacy aliases

| Deprecated | Use instead | Note |
|---|---|---|
| `--surface`, `--bottle`, `--card-bg`, `--ticket-field-raised` | `--surface-2` | |
| `--surfaceRaised`, `--ticket-field` | `--surface-1` | |
| `--bottle-2` | `--surface-3` | |
| `--ink` | `--page-bg` | |
| `--onSurface`, `--chalk`, `--day-ink`, `--day-ink-weekend` | `--text-primary` | |
| `--sage`, `--muted` (undeclared; falls back to `--sage`) | `--text-secondary` | |
| `--moss` | `--border`, or `--border-control` on a field | |
| `--accent`, `--marigold`, `--highlight` | `--periwinkle-base` | |
| `--accentMuted`, `--marigold-dim`, `--highlight-dim`, `--ui-accent`, `--ui-accent-dim` | `--periwinkle-border` (shapes) or `--periwinkle-text` (text) | |
| `--tint-accent`, `--highlight-tint`, `--ui-tint` | `--periwinkle-tint-soft` | |
| `--ember` | `--red-text` (text, icons) or `--red-border` (outlines) | Visible change: `#c0392b` → `#7a2f2f` |
| `--accent-hi` | — | Retire |
| `--on-accent` | `#ffffff`, on `--periwinkle-border` fills only | |

Illustration palettes are not UI tokens and stay as they are: `--card-navy`, `--card-gold` and `--card-gold-ink` (welcome card back), the react-stage art, pack themes, avatar hue pairs and event-card presets.
