# Phlip iOS (join-only)

WKWebView shell around the **shared** web client at [`../phlip-web/public`](../phlip-web/public).

**Does not** link `app.phlip:server` or `app.phlip:tunnel`. Hosting is Android-only;
Host settings shows: *Hosting is not available on Apple devices. Android is required to host a server.*

## Requirements

- macOS + Xcode 15+
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`)

## Setup

```bash
cd phlip-ios
xcodegen generate
open Phlip.xcodeproj
```

`project.yml` resources `../phlip-web/public` directly — edit the shared tree; no sync step.

## Bridge

`AshNative` is injected at document start (`AshNativeBridge.swift`):

| API | Behaviour |
|-----|-----------|
| `hostingAvailable()` | always `false` |
| `put/get/removeDeviceSecret` | Keychain (`DeviceSecretsStore`) |
| `shareText` / `shareImage` / `saveImage` | system share / Photos |
| `openCalendarIcs` | temp `.ics` → share sheet (Calendar) |
| billing | stub — StoreKit later |

## Shared UI updates

Edit files under [`phlip-web/public/`](../phlip-web/public/) only. Android and iOS both pick them up on the next build.
