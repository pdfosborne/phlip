package app.phlip.server.hosting

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.phlip.server.ServerRegistry
import app.phlip.server.publichost.cloudflare.CloudflarePrefs
import app.phlip.core.security.SecureStore
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.util.UUID

/**
 * L4 REST tests — instrumented (connectedAndroidTest). Never packaged into the
 * published APK. Prioritises R-03 / R-06 (plaintext secret leaks).
 *
 * Run: `./gradlew :app:connectedDebugAndroidTest`
 */
@RunWith(AndroidJUnit4::class)
class RestAtRestInstrumentedTest {

    private val ctx get() = InstrumentationRegistry.getInstrumentation().targetContext

    private val canaryTunnel = "R03-CANARY-TUNNEL-${UUID.randomUUID()}"
    private val canaryApi = "R03-CANARY-CFAPI-${UUID.randomUUID()}"
    private val canaryEdge = "R03-CANARY-EDGE-${UUID.randomUUID()}"
    private val canaryGroup = "R03-CANARY-GROUP-${UUID.randomUUID()}"

    /** R-01 — SecureStore.seal / open round trip; distinct ciphertext (random IV). */
    @Test
    fun R01_secureStoreRoundTrip() {
        val store = SecureStore.hostAtRest(ctx)
        val plain = "round-trip-${UUID.randomUUID()}"
        val a = store.seal(plain)
        val b = store.seal(plain)
        assertTrue(a.startsWith(SecureStore.SEAL_PREFIX))
        assertTrue(b.startsWith(SecureStore.SEAL_PREFIX))
        assertNotEquals("same plaintext must not reuse IV/ciphertext", a, b)
        assertTrue(store.open(a) == plain)
        assertTrue(store.open(b) == plain)
    }

    /** R-02 — Tampered ciphertext → GCM auth failure, not silent garbage. */
    @Test
    fun R02_tamperedCiphertextFailsClosed() {
        val store = SecureStore.hostAtRest(ctx)
        val sealed = store.seal("tamper-me-${UUID.randomUUID()}")
        assertTrue(sealed.startsWith(SecureStore.SEAL_PREFIX))
        val raw = sealed.removePrefix(SecureStore.SEAL_PREFIX).toCharArray()
        // Flip a character in the middle of the base64 payload.
        val mid = raw.size / 2
        raw[mid] = if (raw[mid] == 'A') 'B' else 'A'
        val tampered = SecureStore.SEAL_PREFIX + String(raw)
        val opened = store.open(tampered, default = "FAIL-CLOSED")
        assertTrue(
            "tampered seal must fail closed (got ${opened.take(40)})",
            opened == "FAIL-CLOSED" || opened.isEmpty(),
        )
        assertFalse(opened.contains("tamper-me"))
    }

    /**
     * R-03 — After writing Cloudflare + group secrets, no plaintext canaries on disk.
     * Catches prefs written unencrypted, servers.json plaintext, stray debug dumps.
     */
    @Test
    fun R03_noPlaintextSecretsOnDisk() {
        val prefs = CloudflarePrefs(ctx)
        prefs.tunnelToken = canaryTunnel
        prefs.apiToken = canaryApi
        prefs.edgeSecret = canaryEdge

        val registry = ServerRegistry(ctx)
        registry.add("R03 Host", canaryGroup)

        // Also seal a data-style blob the way DrServer would.
        val atRest = SecureStore.hostAtRest(ctx)
        val dataFile = File(ctx.filesDir, "data_r03_canary.json")
        dataFile.writeText(atRest.seal("""{"hostName":"x","marker":"$canaryGroup"}"""))

        // SharedPreferences.apply() is async — give the flush a moment.
        Thread.sleep(250)

        val hits = mutableListOf<String>()
        val roots = listOfNotNull(
            ctx.filesDir,
            ctx.getDir("shared_prefs", 0).parentFile?.let { File(it, "shared_prefs") },
            File(ctx.applicationInfo.dataDir),
        ).distinct()

        for (root in roots) {
            if (!root.exists()) continue
            root.walkTopDown().forEach { f ->
                if (!f.isFile) return@forEach
                // Skip binary/keystore material we can't usefully grep as UTF-8 text
                // beyond a size cap — secrets of interest are short strings.
                if (f.length() > 2_000_000) return@forEach
                val text = try {
                    f.readText(Charsets.UTF_8)
                } catch (_: Exception) {
                    return@forEach
                }
                for (c in listOf(canaryTunnel, canaryApi, canaryEdge, canaryGroup)) {
                    if (text.contains(c)) {
                        hits += "${f.absolutePath} contains $c"
                    }
                }
            }
        }

        // SharedPreferences XML for SecureStore must hold ciphertext only.
        val securePrefs = File(ctx.applicationInfo.dataDir, "shared_prefs/ash_cloudflare_secure_v2.xml")
        if (securePrefs.exists()) {
            val xml = securePrefs.readText()
            assertFalse("tunnel canary in secure prefs XML", xml.contains(canaryTunnel))
            assertFalse("api canary in secure prefs XML", xml.contains(canaryApi))
            assertFalse("edge canary in secure prefs XML", xml.contains(canaryEdge))
        }

        val servers = File(ctx.filesDir, "servers.json")
        if (servers.exists()) {
            val body = servers.readText()
            assertFalse("group secret plaintext in servers.json", body.contains(canaryGroup))
            assertTrue(
                "servers.json passphrase should be sealed",
                !body.contains(canaryGroup) && (body.contains("ks:") || body.contains("passphrase")),
            )
        }

        if (hits.isNotEmpty()) {
            fail("plaintext secret canaries on disk:\n" + hits.joinToString("\n"))
        }
    }

    /** R-04 — data_*.json written via seal is not readable plaintext JSON. */
    @Test
    fun R04_dataFilesSealed() {
        val atRest = SecureStore.hostAtRest(ctx)
        val marker = "R04-PLAIN-EVENT-TITLE-${UUID.randomUUID()}"
        val f = File(ctx.filesDir, "data_r04_test.json")
        val sealed = atRest.seal("""{"events":[{"title":"$marker"}]}""")
        assertTrue(sealed.startsWith(SecureStore.SEAL_PREFIX))
        f.writeText(sealed)
        val onDisk = f.readText()
        assertFalse(onDisk.contains(marker))
        assertTrue(onDisk.startsWith(SecureStore.SEAL_PREFIX))
        assertTrue(atRest.open(onDisk).contains(marker))
    }

    /**
     * R-06 — Logcat scan after storing secrets + exercising registry/prefs.
     * A forgotten debug Log.d of a token is the most common real leak.
     */
    @Test
    fun R06_logcatNoSecrets() {
        // Clear buffer so we only see this test's window.
        try {
            Runtime.getRuntime().exec(arrayOf("logcat", "-c")).waitFor()
        } catch (_: Exception) {
        }

        val prefs = CloudflarePrefs(ctx)
        prefs.tunnelToken = canaryTunnel
        prefs.apiToken = canaryApi
        prefs.edgeSecret = canaryEdge
        // Touch getters (common accidental log site).
        prefs.tunnelToken
        prefs.apiToken
        prefs.edgeSecret
        prefs.hostSyncSecret

        val registry = ServerRegistry(ctx)
        registry.add("R06 Host", canaryGroup)
        registry.save()

        // Brief settle for async log writers.
        Thread.sleep(300)

        val dump = dumpLogcat()
        val leaks = listOf(canaryTunnel, canaryApi, canaryEdge, canaryGroup)
            .filter { dump.contains(it) }
        assertTrue(
            "secret canaries appeared in logcat: $leaks\n--- logcat tail ---\n${dump.takeLast(4000)}",
            leaks.isEmpty(),
        )
    }

    private fun dumpLogcat(): String {
        return try {
            val p = Runtime.getRuntime().exec(arrayOf("logcat", "-d", "-v", "brief"))
            BufferedReader(InputStreamReader(p.inputStream)).use { it.readText() }
        } catch (t: Exception) {
            fail("could not dump logcat: $t")
            ""
        }
    }
}
