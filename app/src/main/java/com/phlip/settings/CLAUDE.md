# com.phlip.settings

## Purpose
Native Settings UI sections: Host, Cloudflare/public-hosting setup, Support/Legal/Contact, plus shared view builders.

## Key classes
- `ViewBuilders.kt` — dp/toast/tv/btn/margins helpers
- `SettingsTheme.kt` — shared color tokens
- `AboutSection.kt` — Support / Legal / Contact (+ Activity extensions)
- `HostSection.kt` — Host / networks / host-info (+ create/share helpers)
- `CloudflareSection.kt` — Cloudflare domain setup + public-hosting ack checklist

## Public surface used by other packages
- Section classes constructed by `SettingsActivity` only
- Internal `SettingsActivity.*Screen` extension functions for render bodies

## Dependencies
- Depends on: `com.phlip` (SettingsActivity host, PendingJoinMessages), `app.phlip.server`, `com.phlip.supporter`
- Depended on by: `SettingsActivity`

## State / lifecycle notes
- Sections read `SettingsActivity.hostService` / `prefs` / `refresh()`; Activity owns HostServiceConnector bind lifecycle

## Known duplication resolved here
- View helpers and palette centralized in `ViewBuilders` / `SettingsTheme`
- Large render blocks moved out of the SettingsActivity nav shell

## Tests
- Manual click-through of Host / Cloudflare / About screens after extractionsits
- `./gradlew testDebugUnitTest` must stay green (no dedicated section unit tests yet)
