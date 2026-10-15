# com.phlip

## Purpose
Android app shell: WebView client (`MainActivity`), JS bridge facade, LAN discovery, and shared HostService binding.

## Key classes
- `MainActivity.kt` — WebView lifecycle, SAF/permission launchers, HostService bind, thin wrappers (~780 lines; launchers + lifecycle stay here by design)
- `JsBridge.kt` — `window.AshNative` JavascriptInterface surface; **facade only** (~385 lines), bodies live in helper packages
- `NsdDiscovery.kt` — NSD browse for join + member LAN refresh
- `HostServiceConnector.kt` — shared HostService bind/unbind/start/stop
- `PendingJoinMessages.kt` / `JoinIntentPrefill.kt` — shared join dialog copy + atomic prefill combine
- `SettingsActivity.kt` — settings nav shell (sections live in `com.phlip.settings`)
- `VersionPolicy.kt` / `PlayUpdateHelper.kt` — remote version policy + Play flexible update
- `LegalDocs.kt` / `ContactDocs.kt` — static copy for the About screens

## MainActivity helper packages
Activity owns lifecycle and `registerForActivityResult` fields; helpers take a host:

- `com.phlip.webview` — `PhlipWebViewClient`, `PhlipWebChromeClient`, `WebViewUpdateCoalescer`
- `com.phlip.join` — `JoinIntentCapture`, `PendingPrefillDelivery`, `PendingJoinDialogHost`
- `com.phlip.hosting` — `HostStatusBuilder`, `HostingLifecycleBridge`
- `com.phlip.hotspot` — `HotspotLocationGate` (+ `HotspotJoinCoordinator` / `HotspotHostSession`)
- `com.phlip.network` — `ClientNetworkTrust`
- `com.phlip.ui` — `SystemBarsTheme`

## Where the bridge work actually lives
`JsBridge` keeps every `@JavascriptInterface` name/signature the web client calls and
delegates. Never grow a method body here — extend the owning helper instead.

- `com.phlip.bridge.HostingJsApi` — hosting lifecycle, server CRUD, invites, join approvals,
  setup consents, factory reset, native settings entry points, `hostStatus`
- `com.phlip.bridge.NetworkTrustJsApi` — share bases, LAN broadcast gate, client Wi‑Fi trust,
  host/client network approvals, `lanIp`
- `com.phlip.bridge.SupporterJsApi` — billing products/purchases/grants, cosmetic selections, UI theme
- `com.phlip.bridge.DeviceSecretStore` — keystore-sealed identity secrets (put/get/remove)
- `com.phlip.bridge.CalendarJsApi` — READ_CALENDAR, calendar list, scoped snapshot import
- `com.phlip.bridge.PersonalVaultBridge` — personal markdown vault (private filesDir or SAF tree)
- `com.phlip.bridge.DriveJsApi` — Google Sign-In access token for Drive REST (`drive.file`)
- `com.phlip.bridge.TimePickerJsApi` — system time picker (`pickTime` → `__ashOnTimePicked`)
- `com.phlip.hotspot.HotspotHostSession` — host-side Direct (Soft-AP) start/rotate/end/status,
  Wi‑Fi + Location settings, permission-gated joiner watch
- `com.phlip.hotspot.HotspotJoinCoordinator` — joiner-side watch/reconnect/leave/rediscover
  (`JsBridge` calls it directly where the method is already a one-liner)
- `com.phlip.media.ShareCardStore` — share/save/cache card images, clipboard read
- `com.phlip.backup.PersonalBackupBridge` / `ServerBackupBridge` — Tier 1 and host backup SAF flows

## Public surface used by other packages
- `SettingsActivity.SCREEN_*` / `EXTRA_*` — opened from bridge helpers / MainActivity
- `HostServiceConnector` — used by MainActivity and SettingsActivity
- `PendingJoinMessages.format` — unit-tested string helper
- `MainActivity` internals (`hostService`, `hotspotJoin`, `clientNetworks`, `clientIo`,
  SAF launchers, `push*ToWebView`, `identitySecrets`, `hostAckPrefs`) — the seam every
  bridge helper is constructed against

## Dependencies
- Depends on: `app.phlip.server` / `app.phlip.core` (hosting modules), `com.phlip.supporter`,
  `com.phlip.bridge`, `com.phlip.hotspot`, `com.phlip.hosting`, `com.phlip.media`,
  `com.phlip.backup`, `com.phlip.join`, `com.phlip.network`, `com.phlip.webview`,
  `com.phlip.ui`, `com.phlip.settings`
- Depended on by: bridge helpers and settings sections (all take `MainActivity` /
  `SettingsActivity` as their host), instrumented `DualPathWebViewTest`

## State / lifecycle notes
- HostService must be bound in `onStart` and unbound in `onStop` via `HostServiceConnector`
- `NsdDiscovery` is created in `MainActivity.onCreate` after `super.onCreate`
- `JsBridge` is registered as `AshNative` on the WebView — the registration line
  (`addJavascriptInterface(JsBridge(this), "AshNative")`) must not change
- SAF / permission launchers stay registered on `MainActivity` (registration must happen
  before `onStart`); helpers only stage pending state and drive them
- JS-thread rule: anything slow (disk, decode, LocalOnlyHotspot) runs off the JS thread —
  `clientIo` for IO, plain background for hotspot, `runOnUiThread` only for UI/Intents

## Known duplication resolved here
- `pendingJoinMessage` formerly duplicated in MainActivity and SettingsActivity
- HostService `ServiceConnection` / bind lifecycle formerly duplicated across both activities
- `AshBridge` inner class → `JsBridge.kt` facade; bodies extracted to helper packages above
- The five `accept*` consent writes collapsed into `HostingJsApi.ackHostPref`

## Tests / smoke
- Unit: `PendingJoinMessagesTest`, `JoinIntentPrefillTest`
- Device: `DualPathWebViewTest` (manual)
- After bridge/Activity splits: empty-cache WebView boot, deep-link join prefill, host status panel,
  one share-card + one backup path, Soft-AP start/stop if touching hotspot helpers
- `./gradlew :app:compileDebugKotlin` must stay green; keep `@JavascriptInterface` names unchanged
