package app.phlip.server.hosting

import app.phlip.server.publichost.HostPublicGate
import app.phlip.server.publichost.cloudflare.CloudflarePrefs
import app.phlip.server.publichost.PublicHostingState
import app.phlip.server.publichost.PublicRouteManager
import app.phlip.server.ServerRegistry
import android.os.Handler
import android.os.Looper
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = HostTestApp::class)
class SharingGateTest {
    @Test fun failedPublicRemovalKeepsItsStateAndOtherServers() {
        val app = RuntimeEnvironment.getApplication()
        java.io.File(app.filesDir, "servers.json").delete()
        val registry = ServerRegistry(app)
        val selected = registry.add("Selected", "")
        val other = registry.add("Other", "")
        registry.setPublic(selected.id, true)
        registry.setReachMode(other.id, ServerRegistry.REACH_LOCAL)
        val state = PublicHostingState()
        val routes = PublicRouteManager(app, registry, mutableMapOf(), Handler(Looper.getMainLooper()),
            CloudflarePrefs(app), state, { true }, {}, {}, {}, {}, {}, { byteArrayOf() }, {}, {}, {}, {}, { true })
        assertFalse(routes.setPublic(selected.id, false, waitForRemoval = true))
        assertTrue(registry.get(selected.id)!!.isPublic)
        assertTrue(state.publicErrors[selected.id]!!.contains("Could not remove"))
        assertEquals(ServerRegistry.REACH_LOCAL, registry.get(other.id)!!.reachMode)
        assertFalse(registry.get(other.id)!!.isPublic)
    }

    @Test fun nearbyNeedsBothAcknowledgements() {
        val app = RuntimeEnvironment.getApplication()
        val prefs = HostPublicGate.hostPrefs(app)
        prefs.edit().clear().commit()
        assertFalse(HostPublicGate.canShareNearby(app))
        prefs.edit().putBoolean(HostPublicGate.KEY_HOST_RULES_ACK, true).commit()
        assertFalse(HostPublicGate.canShareNearby(app))
        prefs.edit().putBoolean(HostPublicGate.KEY_LOCAL_PREP_ACK, true).commit()
        assertTrue(HostPublicGate.canShareNearby(app))
        prefs.edit().putBoolean(HostPublicGate.KEY_HOST_RULES_ACK, false).commit()
        assertFalse(HostPublicGate.canShareNearby(app))
    }

    @Test fun publicReportsEveryMissingAcknowledgement() {
        val app = RuntimeEnvironment.getApplication()
        val prefs = HostPublicGate.hostPrefs(app)
        val cf = CloudflarePrefs(app)
        val keys = listOf(HostPublicGate.KEY_ALPHA_ACK, HostPublicGate.KEY_HOST_RULES_ACK,
            HostPublicGate.KEY_DEVICE_PREP_ACK,
            HostPublicGate.KEY_PATCH_WARN_DISMISSED)
        prefs.edit().clear().also { e -> keys.forEach { e.putBoolean(it, true) } }.commit()
        cf.operatorAcknowledged = true
        cf.dataDisclosureAcknowledged = true
        cf.publicRiskAcknowledged = true
        assertNull(HostPublicGate.missingAckReason(app, cf))
        // Nearby setup has its own gate; Public uses device preparation.
        prefs.edit().putBoolean(HostPublicGate.KEY_LOCAL_PREP_ACK, false).commit()
        assertNull(HostPublicGate.missingAckReason(app, cf))
        for (key in keys.take(3)) {
            prefs.edit().putBoolean(key, false).commit()
            assertNotNull("Missing $key must be actionable", HostPublicGate.missingAckReason(app, cf))
            assertFalse(HostPublicGate.canGoPublic(app, cf))
            prefs.edit().putBoolean(key, true).commit()
        }
        cf.dataDisclosureAcknowledged = false
        assertTrue(HostPublicGate.missingAckReason(app, cf)!!.contains("data disclosure"))
        cf.dataDisclosureAcknowledged = true
        assertNull(HostPublicGate.missingAckReason(app, cf))
    }
}
