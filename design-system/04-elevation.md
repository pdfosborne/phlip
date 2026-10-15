# 04 · Elevation and layers

How surfaces stack: which things sit on the canvas, which float above it, and the z-order that keeps overlays predictable.

## Surface ladder

| Level | What | Surface | Edge |
|---|---|---|---|
| 0 Canvas | Page, Timeline feed | `--page-bg` | — |
| 1 Raised | Cards, invite cards, sticky heads, panels | `--surface-2` | 1 px `--border`, no shadow |
| 2 Lifted | The focused Timeline row | `--surface-2` | `--shadow-lift` + `translateY(-3px)`; plus `--ring-selected` on compact, declined and invite rows |
| 3 Floating | + FAB, focus tab | ink / `--surface-2` | `--shadow-fab` / `--shadow-tab` |
| 4 Panel | Channel panel, narrow nav sheet | `--surface-2` | `--shadow-panel` |
| 5 Sheet | Event sheet, modal bottom sheets | `--surface-2` | `--shadow-sheet`; the event sheet adds `--ring-selected` |
| 6 Popover | Quick menu, calendar dropdown, view-options popup | `--surface-2` | `--shadow-pop` + 1 px `--border` |
| 7 Modal | Dialogs | `--surface-2` | `--shadow-modal` over `--scrim-modal` |
| 8 Toast | Toasts and snackbars | ink | `--shadow-pop` |

## Shadow tokens

| Token | Value | Use |
|---|---|---|
| `--shadow-xs` | `0 1px 2px rgba(28,28,26,.06)` | A chip or segment sitting on a same-colour surface |
| `--shadow-lift` | `0 10px 20px -6px rgba(28,28,26,.16), 0 2px 6px rgba(28,28,26,.06)` | The focused Timeline row |
| `--shadow-pop` | `0 12px 32px rgba(28,28,26,.16)` | Menus, popovers, dropdowns, toasts |
| `--shadow-fab` | `0 8px 22px rgba(28,28,26,.22)` | The + FAB |
| `--shadow-tab` | `0 -6px 22px rgba(28,28,26,.12)` | The focus tab |
| `--shadow-sheet` | `0 -14px 34px rgba(28,28,26,.18)` | Bottom sheets |
| `--shadow-panel` | `-3px 0 12px rgba(28,28,26,.16)` | Side panels |
| `--shadow-modal` | `0 20px 50px rgba(28,28,26,.30)` | Dialogs |
| `--ring-selected` | `0 0 0 2px var(--periwinkle-base)` | The selected row and the sheet that belongs to it |

## Rules

- **ELV-1 — Depth comes from the ladder.** Don't invent shadows. An element gets one shadow token, plus `--ring-selected` where this spec says so.
- **ELV-2 — Flat at rest.** Cards and rows at rest have a border and no shadow. A shadow always means "above the plane": lifted, floating or overlaid.
- **ELV-3 — The lift is the focus signal.** On the Timeline the focused row lifts (`translateY(-3px)` + `--shadow-lift`, with `--ring-selected` on compact, declined and invite rows). There are no chevrons and no colour change. Nothing between the row and the feed may clip the shadow with `overflow: hidden`.
- **ELV-4 — Ink-tinted shadows.** Shadows use `rgba(28,28,26,a)` (the ink colour), never pure black, so they sit in the warm palette.
- **ELV-5 — Shadows point away from the anchor.** Things rising from the bottom edge cast upward (negative y); side panels cast sideways; everything else casts down.
- **ELV-6 — Scrim by surface.**

  | Surface | Scrim |
  |---|---|
  | Dialog, modal bottom sheet | `--scrim-modal` |
  | Quick menu, popover on touch | `--scrim-menu` |
  | Event sheet | `--scrim-clear` — catches outside taps; the feed dims its non-focused rows to .34 instead of darkening |
  | Create draft card | `--veil-create` |
  | Popover on a fine pointer | none |

- **ELV-7 — No blur.** `backdrop-filter` is expensive in a WebView and isn't part of the system.

## Z-index layers

| Token | Value | Holds today |
|---|---|---|
| `--z-sticky` | 10 | Timeline sticky head (6), narrow `.main` sheet (10) |
| `--z-dock` | 20 | Channel panel at rest (22) |
| `--z-float` | 40 | Side overlay (40), focus tab (43), + FAB (44) |
| `--z-create` | 50 | Create veil (46), draft card (50), draft layer (52), main head while creating (54) |
| `--z-drag` | 80 | Pick-pile and dragged cards (80) |
| `--z-panel` | 90 | Open channel panel (90) |
| `--z-sheet` | 100 | Event sheet host (94) |
| `--z-menu` | 110 | Quick-menu backdrop (110) and menu (111) |
| `--z-modal` | 200 | `.modal-backdrop` (200), confirm dialogs (220) |
| `--z-modal-sheet` | 250 | Channel-settings sheet (250), time picker (260) |
| `--z-toast` | 300 | Toast (200 today) |
| `--z-coach` | 400 | Onboarding spotlight and bubbles |

- **ELV-8 — Layers are tokens.** Stacking between components uses `--z-*` tokens only. Raw values 0–9 are allowed inside a component's own stacking context (a badge over its icon, a row over its separator).
- **ELV-9 — Offsets stay inside their band.** Documented offsets are written as `calc(var(--z-…) + n)`: focus tab `--z-float` + 3, FAB `--z-float` + 4, quick menu `--z-menu` + 1 over its backdrop, confirm dialog `--z-modal` + 20 over another dialog, a picker `--z-modal-sheet` + 10 over a sheet. A new layer needs a spec change.
- **ELV-10 — Feedback is on top.** Toasts sit above every layer except onboarding coach marks, so feedback raised from inside a dialog is visible.
- **ELV-11 — Overlays live at body level.** Modals and menus are appended to `<body>` (as `AshModal.open` does) so a transformed ancestor such as the narrow `.main` sheet can't trap them in its stacking context.
- **ELV-12 — Chrome stays below overlays.** App chrome such as the demo bar belongs at `--z-sticky`, never above dialogs.
