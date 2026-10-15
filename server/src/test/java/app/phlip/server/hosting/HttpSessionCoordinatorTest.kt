package app.phlip.server.hosting

import android.app.Application
import app.phlip.server.HttpClient
import app.phlip.server.HttpSessionCoordinator
import app.phlip.server.PendingEntry
import app.phlip.server.ServerSessionRegistry
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class HttpSessionCoordinatorTest {

    @Test
    fun touchCreatesOnceAndNotifies() {
        val registry = ServerSessionRegistry()
        var opened = 0
        var changed = 0
        val sessions = HttpSessionCoordinator(
            sessionRegistry = registry,
            onHttpSessionOpened = { opened++ },
            onHttpSessionsChanged = { changed++ },
            closeWebSocketsForToken = {},
        )
        val a = sessions.touchHttpClient("tok")
        val b = sessions.touchHttpClient("tok")
        assertTrue(a === b)
        assertEquals(1, opened)
        assertEquals(1, changed)
        assertTrue(registry.httpClients.containsKey("tok"))
    }

    @Test
    fun enqueueAndDrain() {
        val registry = ServerSessionRegistry()
        val sessions = HttpSessionCoordinator(registry, {}, {}, {})
        sessions.touchHttpClient("tok")
        sessions.enqueueHttp("tok", """{"type":"ping"}""")
        sessions.enqueueHttp("missing", """{"type":"x"}""")
        val drained = sessions.drainHttp(registry.httpClients["tok"]!!)
        assertEquals(1, drained.length())
        assertEquals("ping", drained.getJSONObject(0).optString("type"))
    }

    @Test
    fun releaseNotifiesAndPruneIdleRemovesStale() {
        val registry = ServerSessionRegistry()
        var changed = 0
        val sessions = HttpSessionCoordinator(registry, {}, { changed++ }, {})
        sessions.touchHttpClient("fresh")
        changed = 0
        sessions.releaseHttpSession("fresh")
        assertEquals(1, changed)
        assertFalse(registry.httpClients.containsKey("fresh"))

        registry.httpClients["old"] = HttpClient(lastSeen = System.currentTimeMillis() - 120_000)
        assertTrue(sessions.pruneIdleHttpClients())
        assertFalse(registry.httpClients.containsKey("old"))
    }

    @Test
    fun pendingAndWelcomeTtlCleanup() {
        val registry = ServerSessionRegistry()
        val sessions = HttpSessionCoordinator(registry, {}, {}, {})
        val now = System.currentTimeMillis()
        registry.pending["alive"] = PendingEntry(null, "A", now - 60_000, "n")
        registry.pending["stale"] = PendingEntry(null, "B", now - 11 * 60_000, "n")
        sessions.pruneStalePending(now)
        assertTrue(registry.pending.containsKey("alive"))
        assertFalse(registry.pending.containsKey("stale"))

        registry.readyWelcome["w"] = JSONObject().put("type", "welcome")
        registry.readyWelcomeAt["w"] = now - 11 * 60_000
        registry.deniedIds["d"] = now - 11 * 60_000
        sessions.pruneReadyWelcome(now)
        assertFalse(registry.readyWelcome.containsKey("w"))
        assertFalse(registry.deniedIds.containsKey("d"))
    }
}
