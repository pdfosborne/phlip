# Event card

## Purpose

The event as an object people recognise and share. It has one fixed template — hero, subtitle band, details — drawn in its creator's chosen style, used at several sizes and as the share image.

## Anatomy

Proportions come from `EVENT_CARD_LAYOUT` in `scripts/pitch/event-card-styles.js`. The card is portrait, about 2 : 3 (92 × 135 px base).

| Zone | Share of card height | Contents |
|---|---|---|
| Hero | 63 % | Event glyph (37 % of the hero's height) and title (16 %), 3 % gap |
| Subtitle band | 15 % | One line; the font is 60 % of the band, shrinking to 35 % before truncating |
| Details | 22 % | Time and place rows: icons 27 % and text 18.9 % of the zone's height, inset 11.5 % of the card width |

**Style keys** (per preset):
- Colours: `imageBg`, `imageFg`, `badgeBg`, `badgeText`, `subtitleBg`, `subtitleText`, `infoBg`, `detailText`, `border`.
- Fonts: `titleFont`, `badgeFont`, `detailsFont`, from Clean, Rounded, Editorial and Mono.
- Built-in presets: Simple, Garden, Night, Blush.

**Sizes:**
- The full card: share sheet and create flows.
- Scaled previews: `.tl-card-preview` at .70 in the event-sheet header and .42 in the focus tab.
- The share image: canvas, drawn to the same layout.

## Rules

- **CMP-event-card-1 — One template, one set of metrics.** DOM and canvas both use `eventCardLayoutMetrics()`, so the share image matches the app exactly.
- **CMP-event-card-2 — The card's style is the creator's.** Colours and fonts come from presets and are content (COL-14). Chrome around the card stays system-styled.
- **CMP-event-card-3 — Readable in every preset.** Every text/background pair is at least 4.5 : 1. The built-in presets pass; computed minimums are Simple 6.50, Garden 4.57, Night 7.73 and Blush 4.73. The style editor warns, and suggests a fix, when a custom colour fails.
- **CMP-event-card-4 — Text fits, then truncates.** Text shrinks to its minimum (canvas fitting steps down 0.5 px at a time), then truncates with an ellipsis. It never overflows its zone.
- **CMP-event-card-5 — Corners scale with the card.** Previews use `--radius-xs` or `--radius-sm`; full cards use `--radius-lg`.
- **CMP-event-card-6 — Text stays text.** In the app the card's words are real DOM text. A share image carries alt text with its title, date and place.

## Current implementation

- Layout, presets, fonts and storage (`ash_event_card_styles_v3`): `scripts/pitch/event-card-styles.js`.
- Card CSS through `--ec-*` custom properties in `styles/40-cards-deck.css`. Corner radii vary from 4 to 20 px across contexts.
- Share art: `scripts/share/sharecard-part*.js`. Previews: `.tl-card-preview` (`styles/35-timeline-view.css:1059`).

## Gaps

GAP-25 (radius and colour literals in the card CSS — `40-cards-deck.css` holds 178 raw colours, including preset themes).
