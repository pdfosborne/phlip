package app.phlip.server.hosting

import org.junit.Assert.fail
import org.junit.Test

/**
 * Intentionally red markers for known security gaps.
 *
 * Excluded from the default unit-test feedback loop (see app/build.gradle).
 * Run explicitly so the gap stays visible:
 *   ./gradlew :server:testDebugUnitTest -PincludeOpenGaps --tests app.phlip.server.hosting.OpenSecurityGapsTest
 *
 * Release gate: AUTHZ/EDGE/REST failures block; LIMIT-12 is exempt until R4 ships.
 */
class OpenSecurityGapsTest {

    /**
     * L-12 — Device-wide ceiling across N public servers.
     * Currently expected to FAIL (R4 gap). Do not @Ignore — ignored tests disappear.
     */
    @Test
    fun L12_deviceWideCeiling_documentsR4Gap() {
        fail(
            "LIMIT-12 OPEN (R4): no device-wide guest/RPC ceiling across concurrent " +
                "public servers. Exempt from release gate until the ceiling ships; " +
                "remove this fail when implemented.",
        )
    }
}
