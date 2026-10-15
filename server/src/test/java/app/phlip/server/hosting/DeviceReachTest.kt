package app.phlip.server.hosting

import app.phlip.core.assets.AssetManagerClientAssetSource
import app.phlip.server.DrServer
import app.phlip.server.ServerRegistry
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.Socket
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Device-only reach: loopback bind + registry defaults.
 *
 * Also run on a machine with JDK: `./gradlew :server:test`.
 * Still manual on device: create on an unapproved Wi‑Fi (owner can use it,
 * nearby phones cannot); hosting guide → Local, then join from a second phone.
 * HostService.setReachMode from device is refused without host rules / Local
 * prep, and a successful leave-device rebinds off loopback. Gate suspend must
 * leave device-only servers listening.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = HostTestApp::class)
class DeviceReachTest {

    private var server: DrServer? = null

    @After
    fun tearDown() {
        try { server?.stop() } catch (_: Exception) {}
        server = null
    }

    @Test
    fun deviceOnly_acceptsLoopback() {
        val app = RuntimeEnvironment.getApplication()
        val dataFile = File(app.cacheDir, "device-reach-${UUID.randomUUID()}.json")
        val srv = DrServer(
            port = 0,
            clientAssets = AssetManagerClientAssetSource(app.assets),
            dataFile = dataFile,
            serverPassphrase = "test-group-secret",
            atRest = null,
            bindHost = "127.0.0.1",
        )
        server = srv
        srv.start(0)
        val port = srv.listeningPort
        val http = OkHttpClient.Builder()
            .connectTimeout(2, TimeUnit.SECONDS)
            .readTimeout(2, TimeUnit.SECONDS)
            .retryOnConnectionFailure(false)
            .build()
        http.newCall(Request.Builder().url("http://127.0.0.1:$port/ash-ok").build()).execute().use { res ->
            assertEquals(200, res.code)
        }
        val lan = firstNonLoopbackIpv4()
        if (lan != null) {
            Socket().use { sock ->
                try {
                    sock.connect(InetSocketAddress(lan, port), 400)
                    assertFalse("device-only bind should refuse LAN $lan", sock.isConnected && !sock.isClosed)
                } catch (_: Exception) {
                    // Connection refused / timeout is the expected bind isolation.
                }
            }
        }
    }

    @Test
    fun registry_missingReachMode_loadsAsLocal() {
        val app = RuntimeEnvironment.getApplication()
        val file = File(app.filesDir, "servers.json")
        val arr = JSONArray().put(
            JSONObject()
                .put("id", "abc123")
                .put("name", "Legacy")
                .put("port", 3000)
                .put("dataFile", "data_abc123.json")
                .put("passphrase", "")
                .put("isPublic", false)
                .put("joinTag", "AB12"),
        )
        file.writeText(arr.toString())
        val registry = ServerRegistry(app)
        val hs = registry.get("abc123")
        assertEquals(ServerRegistry.REACH_LOCAL, hs?.reachMode)
        assertFalse(hs?.isDeviceOnly() == true)
    }

    @Test
    fun registry_add_defaultsToDevice() {
        val app = RuntimeEnvironment.getApplication()
        File(app.filesDir, "servers.json").delete()
        val registry = ServerRegistry(app)
        // Android Keystore sealing is not available in this JVM test.
        val hs = registry.add("New one", "")
        assertEquals(ServerRegistry.REACH_DEVICE, hs.reachMode)
        assertTrue(hs.isDeviceOnly())
        assertEquals("127.0.0.1", hs.bindHost())
        assertFalse(hs.isPublic)
        val restored = ServerRegistry(app).get(hs.id)!!
        assertTrue(restored.isDeviceOnly())
        assertFalse(restored.isPublic)
    }

    @Test
    fun registry_setReachMode_deviceToLocal() {
        val app = RuntimeEnvironment.getApplication()
        File(app.filesDir, "servers.json").delete()
        val registry = ServerRegistry(app)
        val hs = registry.add("New one", "secret")
        assertTrue(registry.setReachMode(hs.id, ServerRegistry.REACH_LOCAL))
        assertEquals(ServerRegistry.REACH_LOCAL, registry.get(hs.id)?.reachMode)
        assertFalse(registry.get(hs.id)?.isDeviceOnly() == true)
    }

    private fun firstNonLoopbackIpv4(): String? =
        NetworkInterface.getNetworkInterfaces()?.toList()
            ?.flatMap { it.inetAddresses.toList() }
            ?.filter { !it.isLoopbackAddress && it is java.net.Inet4Address }
            ?.mapNotNull { it.hostAddress }
            ?.firstOrNull()
}
