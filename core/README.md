# :core (KMP)

Dual-platform Phases A–B. Parent overview and consume/publish docs:
[README.md](../README.md), [PUBLISH.md](../PUBLISH.md).

| Source set | Role |
|---|---|
| `commonMain` | `TunnelController` / public-access models, `DeviceKeyStore` expect, `SealedBlobFormat` |
| `androidMain` | Keystore `actual`, `SecureStore` façade, assets SPI, ServiceLoader providers |
| `iosMain` | `DeviceKeyStore` stub (`NotImplementedError`) |

## Checks

```bash
./gradlew :core:checkCommonMainPortable
./gradlew :core:testDebugUnitTest
# Mac (or CI):
./gradlew :core:check -Pphlip.enableIos=true
```

iOS targets are off on Windows (Kotlin/Native Ivy vs `FAIL_ON_PROJECT_REPOS`). Enable with
`-Pphlip.enableIos=true` on a Mac.
