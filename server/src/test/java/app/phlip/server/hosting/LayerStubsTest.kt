package app.phlip.server.hosting

import org.junit.Ignore
import org.junit.Test

/**
 * Remaining L3 / L4 stubs that still need Playwright or fuller device lifecycle.
 * Dual-path C01–C04 live in [phlip-hosting/e2e/dual-path.spec.ts] (Playwright).
 * R-01…R-04 / R-06 live in androidTest ([RestAtRestInstrumentedTest]).
 * XSS corpus X-03…X-08 lives in [XssCorpusTest] (JVM JSON-boundary).
 *
 * [IgnoredBudgetTest] fails the build if this file grows without raising the budget.
 */
class ClientLayerStubsTest {
    /** Covered by Playwright: phlip-hosting/e2e/dual-path.spec.ts C01 */
    @Ignore("L3 CLIENT — run: cd phlip-hosting/e2e && npm test")
    @Test fun C01_dualUrlProbePrefersLan() = Unit

    @Ignore("L3 CLIENT — run: cd phlip-hosting/e2e && npm test")
    @Test fun C02_lanUnreachableFallsBack() = Unit

    @Ignore("L3 CLIENT — run: cd phlip-hosting/e2e && npm test")
    @Test fun C03_foreignLanRejected() = Unit

    @Ignore("L3 CLIENT — run: cd phlip-hosting/e2e && npm test")
    @Test fun C04_lanOnlySpecificFailure() = Unit

    @Ignore("L3 CLIENT")
    @Test fun C05_corruptFragmentKey() = Unit

    @Ignore("L3 XSS — DOM execution / CSP violation observer (Playwright); JSON-boundary covered in XssCorpusTest")
    @Test fun X02_inlineScriptCspViolation() = Unit
}

class RestAndLifecycleStubsTest {
    @Ignore("L4 HOTSPOT — LocalOnlyHotspot on device (Pixel + Samsung OEM checklist)")
    @Test fun H01_localOnlyHotspotStartStop() = Unit

    @Ignore("L4 HOTSPOT — joiner bindProcessToNetwork reaches DrServer; manual Settings first join")
    @Test fun H02_hotspotNetworkBindingReachability() = Unit

    @Ignore("L4 HOTSPOT — SSID watch auto-opens join modal + background notification")
    @Test fun H03_hotspotJoinHandoff() = Unit

    @Ignore("L4 HOTSPOT — unauthenticated Wi-Fi joiner cannot reach DrServer without app auth")
    @Test fun H04_hotspotProximityNotAuthBypass() = Unit

    @Ignore("L4 REST — Keystore wipe / unlock-change fail-closed (device-specific)")
    @Test fun R07_keystoreDeletedFailsClosed() = Unit

    @Ignore("L4 LIFE — PackageReplacedReceiver")
    @Test fun F01_packageReplacedRestoresHosting() = Unit

    @Ignore("L4 LIFE — approved-networks suspended restore")
    @Test fun F02_restoreSuspendedPendingApproval() = Unit

    @Ignore("L4 LIFE — VersionPolicy fail-open with live endpoint mock")
    @Test fun F03_versionEndpointUnreachableFailOpen() = Unit

    @Ignore("L4 LIFE — HostPublicGate + VersionPolicy minSafe")
    @Test fun F04_belowMinSafeRefusesPublic() = Unit

    @Ignore("L4 LIFE — Play flexible update deferred while isLiveBusy")
    @Test fun F05_updateDeferredWhileLiveBusy() = Unit

    @Ignore("L4 LIFE — tunnel rotate")
    @Test fun F06_tunnelRotate() = Unit

    @Ignore("L4 LIFE — OS-level port closed on stop")
    @Test fun F07_stopFreesPort() = Unit

    @Ignore("LINK K-01/K-02 — needs full guest broadcast session request log / proxy capture")
    @Test fun K01_K02_fragmentKeysNeverTransmitted() = Unit
}
