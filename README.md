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

## Design

New UI follows [design-system/](design-system/README.md). Colours, sizes, radii, shadows, layers, and motion come from the tokens in `phlip-web/public/styles/00-foundation.css`, not from raw values in component CSS.

Before merging a UI change, run:

```bash
python tools/design_token_audit.py --baseline tools/design_token_baseline.json
```

The audit fails if any stylesheet gains raw values. Older specs that still mention tasks, card decks, or share microsites do not bring those features back.

## Build

See [BUILD.md](BUILD.md).

```bash
./gradlew :core:check :server:testDebugUnitTest :app:assembleDebug
```

Requires JDK 17–21 and Android SDK 34 (`local.properties` or `ANDROID_HOME`).
