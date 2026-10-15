# iOS join smoke checklist

Run on a Mac with Xcode (Linux cannot compile iOS).

## Build

```bash
cd phlip-ios
xcodegen generate   # brew install xcodegen
open Phlip.xcodeproj
```

Web assets come from `../phlip-web/public` (shared with Android). Build & run on simulator or device.

## Smoke — Host settings (no hosting)

1. Open the sidebar → **Host settings**.
2. Expect exact copy:
   > Hosting is not available on Apple devices. Android is required to host a server.
3. Confirm no create-server / Cloudflare controls appear.

## Smoke — Join a Public host

1. On an Android device (or existing host), create a Public server and copy the invite URL.
2. On iOS Phlip, use the join / invite flow and open that `https://` URL.
3. Expect: join gate works, WebSocket connects, events/chat load.
4. Kill and relaunch the app — identity should persist (Keychain via `getDeviceSecret`).

## Smoke — Personal space

1. Fresh install → personal space loads without a local HostService.
2. Create a local note/event if the UI allows without hosting.

## Out of scope for this pass

- LAN Bonjour discovery
- StoreKit / tips
- Linking KMP `:core` XCFramework into the Xcode target (Swift Keychain bridge covers identity secrets for MVP; wire XCFramework on Mac when packaging for release)
