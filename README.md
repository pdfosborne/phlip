# Phlip

Self-hosted planning and chat. Personal space stays on the device. Shared servers run on a phone you control (LAN or your own Cloudflare domain).

This repository is the whole product: the web client, the Android host, the iOS join client, and the hosting libraries.

| Path | Role |
|------|------|
| `:core` | Crypto, sealed blobs, tunnel SPI |
| `:server` | Local host, sync, NanoHTTPD |
| `:tunnel` | Cloudflare Tunnel (`cloudflared`) |
| `:app` | Android shell and host settings |
| `phlip-web/public` | Shared web client (Android, iOS, and hosted browsers) |
| `phlip-ios` | Join-only WKWebView shell |

Licence: **Apache License 2.0**.

## What v1 includes

- **Personal space** saved on the device (`localStorage` / IndexedDB). No cloud drive and no markdown vault.
- **Self-hosting** on the Android device: LAN, hotspot, and a named Cloudflare Tunnel.
- **Server navigation**, **board chat** (messages and events), and **My calendar**.

Polls, tasks, card decks, guest share microsites, and in-app billing are not part of this tree.

## Build

See [BUILD.md](BUILD.md).

```bash
./gradlew :core:check :server:testDebugUnitTest :app:assembleDebug
```

Requires JDK 17–21 and Android SDK 34 (`local.properties` or `ANDROID_HOME`).
