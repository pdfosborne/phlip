package app.phlip.server.hosting

import android.app.Application
import app.phlip.core.security.SecureStore
import app.phlip.server.AppState
import app.phlip.server.ServerPersistence
import app.phlip.server.ServerRuntime
import app.phlip.server.ServerStateMigrations
import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File
import java.security.SecureRandom

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class ServerRuntimeLoadTest {

    private val gson = Gson()

    @Test
    fun freshLoadBootstrapsAndSaves() {
        val dir = tempDir()
        val dataFile = File(dir, "data_fresh.json")
        var state = AppState()
        var bootstrapped = false
        var sealedDiag = false
        val runtime = runtime(dataFile, atRest = null, get = { state }, set = { state = it })

        val loaded = runtime.load(
            defaultState = { AppState() },
            ensureSaltBlindKey = { false },
            newInviteCode = { "ABCDEF" },
            newSalt = { "salt" },
            bootstrapState = {
                bootstrapped = true
                it.setupPreset = "friend"
            },
            onSealedUnreadable = { sealedDiag = true },
        )

        assertTrue(bootstrapped)
        assertFalse(sealedDiag)
        assertEquals("ABCDEF", loaded.inviteCode)
        assertEquals("salt", loaded.e2eSalt)
        assertEquals("friend", loaded.setupPreset)
        assertTrue(dataFile.exists())
        assertTrue(dataFile.readText().contains("ABCDEF"))
    }

    @Test
    fun sealedUnreadableLeavesFileUntouchedAndDoesNotSave() {
        val dir = tempDir()
        val dataFile = File(dir, "data_sealed.json")
        val sealedBlob = "ks:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        dataFile.writeText(sealedBlob)
        val before = dataFile.readText()

        val ctx = RuntimeEnvironment.getApplication()
        val atRest = SecureStore.hostAtRest(ctx)
        var state = AppState()
        var sealedDiag = false
        val runtime = ServerRuntime(
            persistence = ServerPersistence(dataFile, gson, atRest),
            migrations = ServerStateMigrations({ "id" }),
            rng = SecureRandom(),
            stateProvider = { state },
            stateUpdater = { state = it },
        )

        val loaded = runtime.load(
            defaultState = { AppState() },
            ensureSaltBlindKey = { false },
            newInviteCode = { "XXXXXX" },
            newSalt = { "newsalt" },
            bootstrapState = { error("bootstrap must not run for sealed-unreadable") },
            onSealedUnreadable = { sealedDiag = true },
        )

        assertTrue(sealedDiag)
        assertEquals("", loaded.inviteCode) // fresh default AppState
        assertEquals(before, dataFile.readText())
        assertTrue(SecureStore.isSealedBlob(dataFile.readText()))
    }

    @Test
    fun plaintextLegacyReloadMigratesWithoutBootstrap() {
        val dir = tempDir()
        val dataFile = File(dir, "data_plain.json")
        val prior = AppState().apply {
            inviteCode = "LEGACYCODETOOLONG"
            inviteExpiry = System.currentTimeMillis() + 60_000
            e2eSalt = "kept-salt"
            setupPreset = "club"
        }
        dataFile.writeText(gson.toJson(prior))

        var state = AppState()
        var bootstrapped = false
        val runtime = runtime(dataFile, atRest = null, get = { state }, set = { state = it })

        val loaded = runtime.load(
            defaultState = { AppState() },
            ensureSaltBlindKey = { false },
            newInviteCode = { "SHORT1" },
            newSalt = { "unused" },
            bootstrapState = { bootstrapped = true },
        )

        assertFalse(bootstrapped)
        assertEquals("SHORT1", loaded.inviteCode) // long invite migrated
        assertEquals("kept-salt", loaded.e2eSalt)
        assertEquals("club", loaded.setupPreset)
        assertTrue(dataFile.exists())
    }

    @Test
    fun legacyStateWithoutRemovedCollectionsStillLoads() {
        val dir = tempDir()
        val dataFile = File(dir, "data_without_routines.json")
        val legacy = gson.toJsonTree(AppState()).asJsonObject
        legacy.remove("routines")
        legacy.addProperty("inviteCode", "SHORT1")
        legacy.addProperty("inviteExpiry", System.currentTimeMillis() + 60_000)
        legacy.addProperty("e2eSalt", "kept-salt")
        dataFile.writeText(gson.toJson(legacy))

        var state = AppState()
        val loaded = runtime(dataFile, atRest = null, get = { state }, set = { state = it }).load(
            defaultState = { AppState() },
            ensureSaltBlindKey = { false },
            newInviteCode = { "UNUSED" },
            newSalt = { "unused" },
            bootstrapState = { error("legacy state must not bootstrap") },
        )

        assertEquals("SHORT1", loaded.inviteCode)
        assertEquals("kept-salt", loaded.e2eSalt)
    }

    private fun runtime(
        dataFile: File,
        atRest: SecureStore?,
        get: () -> AppState,
        set: (AppState) -> Unit,
    ) = ServerRuntime(
        persistence = ServerPersistence(dataFile, gson, atRest),
        migrations = ServerStateMigrations({ "id" }),
        rng = SecureRandom(),
        stateProvider = get,
        stateUpdater = set,
    )

    private fun tempDir(): File =
        File(RuntimeEnvironment.getApplication().cacheDir, "runtime-load-${System.nanoTime()}")
            .also { assertTrue(it.mkdirs() || it.isDirectory) }
}
