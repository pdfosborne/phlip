# drive

Google Drive friend-group servers: one-writer member markdown logs, merge-on-read, `drive.file` only.

## Purpose
A Drive conn is a local-apply transport (`conn.drive && conn.local`) that is **not** Personal space. Mutations run through `localApply`, then append one markdown line to `members/{meSlug}-YYYY-MM.md`. Polling lists that folder, parses every month file, and replays into `events` / `messages`.

Same Wi-Fi and phone hotspot are not product options. Self-hosted clubs still use Cloudflare **Internet**. Native LAN/hotspot stacks stay in `phlip-hosting` for the tunnel origin.

## Location
`public/scripts/drive/` after `personal-space.js`, before demo scripts.

## Files (load order)

| File | Role |
|------|------|
| `drive-config.js` | Phlip Web OAuth client ID / optional Picker key (`DRIVE_CONFIG`, or `window.DRIVE_CLIENT_ID`). Users Sign in with Google; they never paste a client ID. |
| `drive-auth.js` | Browser GIS token client; Android `AshNative.driveSignIn(clientId)` |
| `drive-api.js` | Drive REST (`text/plain`, folder create, revision-safe `files.update` with 412 retry) |
| `drive-md.js` | Member line serialize/parse, `board.md`, merge-on-read replay |
| `drive-sync.js` | Poll, append after `sendTo` → `localApply`, hydrate `_title` / plaintext |
| `drive-conn.js` | `makeDriveConn` / persist `ash_servers_v1` (folder ids, no host URL/token) |
| `drive-ui.js` | Create folders + `FORMAT.md` / `board.md`; join via Picker or pasted folder link |

## Config
Phlip registers one Google Cloud Web OAuth client (`drive.file`). Users Sign in with Google at create/join; folders stay in that account’s Drive. Enable **Google Drive API** and, for the folder picker, **Google Picker API**. Authorized JavaScript origins must include the app’s origins. Android `AshNative.driveSignIn` uses the same Web client ID for `requestOfflineAccess` (same Cloud project as the app’s Android OAuth client). Optional local overlay (gitignored, not loaded by `index.html`): `window.DRIVE_CLIENT_ID` / `window.DRIVE_PICKER_KEY`. Leftover `localStorage` `ash_drive_client_id` is a local override only. If this build has no client ID, create/join toast that Drive isn’t available.

## Folders (v1, one board)
```
{Server name}/          host-owned, not shared
  FORMAT.md
  {Board name}/         shared with members as Editor; writersCanShare false
    FORMAT.md
    board.md            name, colour, stable channel ids, member map
    members/
      {meSlug}-YYYY-MM.md   append-only; this user is the only writer
```

Plaintext. Google can read it. MIME `text/plain` so Drive does not convert to Docs.

## Public functions
- `createDriveServer(name)` / `joinDriveFolder()` / `shareDriveFolder(conn)` — create also from Set up sharing when the owner picks Google Drive
- `driveEnsureAuth()` / `driveStartSync(conn)` / `driveEnqueueMutation(conn, m)`
- `makeDriveConn` / `restoreDriveConn` / `persistDriveConn` / `isDriveConn`

## Demo
`/?demo=1` toast-blocks create and join. No live Google.

## Native
`com.phlip.bridge.DriveJsApi.driveSignIn` → `AshNative.driveSignIn`. Do not delete LAN/NSD/hotspot Kotlin; web refuses `setReachMode("local"|"direct")`.
