# Building Phlip

Public hosting uses **Cloudflare Tunnel** (bundled `libcloudflared.so` for arm64).

## Requirements

1. JDK 17–21 (avoid JDK 26)
2. Android SDK 34
3. Physical **arm64** device for public tunnels
4. Cloudflare account + domain + API token (required for any public server)

## Build

From the repository root:

```bash
./gradlew :core:check :server:testDebugUnitTest :app:assembleDebug
```

On Windows PowerShell:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat :app:assembleDebug
```

`:app` depends on `:core`, `:server`, and `:tunnel` as Gradle projects. The web client is packaged from `phlip-web/` into app assets (`assets/public/...`).

## Bundled cloudflared

| Item | Value |
|---|---|
| Binary | `tunnel/src/main/jniLibs/<abi>/libcloudflared.so` |
| Upstream tag | **cloudflared 2026.7.2** |
| ABIs | Release: `arm64-v8a`, `armeabi-v7a`. Debug also: `x86_64` |

## Public hosting

Trial / `*.trycloudflare.com` Quick Tunnels are not supported. Public requires your own Cloudflare domain.

1. Add a domain to a Cloudflare account.
2. Create a custom API token with Tunnel, Workers, Workers KV, DNS, and Workers Routes edit permissions.
3. In Settings, set up the Cloudflare domain and paste the domain and API token.
4. Set a server to Public. Phlip publishes DNS, the origin hostname, and the join-code Worker route.

## iOS

`phlip-ios` is a join-only WKWebView shell. It does not link `:server` or `:tunnel`. See `phlip-ios/README.md`.
