package app.phlip.server.hosting

import app.phlip.core.assets.AssetManagerClientAssetSource
import app.phlip.server.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = HostTestApp::class)
class NewServerPresetTest {
    @Test
    fun freshPresetsHaveOnlyTheirOwnBoardsAndSurviveReload() {
        val app = RuntimeEnvironment.getApplication()
        val expected = mapOf(
            "friend" to setOf("The crew", "Events", "London based", "Uni mates", "Home mates"),
            "family" to setOf("Family"),
            "circles" to setOf("Work", "Home", "Friends"),
            "club" to setOf("Members", "Committee", "Admin", "Fixtures", "Open-invite", "Socials"),
            "business" to setOf("Classes", "Open sessions"),
            "scratch" to setOf("Group", "Direct", "Events", "Section", "Private plans"),
        )
        for ((preset, names) in expected) {
            val file = File(app.cacheDir, "preset-${UUID.randomUUID()}.json")
            val server = DrServer(0, AssetManagerClientAssetSource(app.assets), file,
                initialPreset = preset, initialActivity = if (preset == "club") "Tennis" else null)
            server.mintHostUser("Host")
            server.applySetupPreset(preset, if (preset == "club") "Tennis" else null)
            fun checkSnapshot(json: String) {
                val state = JSONObject(json)
                val boards = state.getJSONArray("boards")
                assertEquals(preset, names, (0 until boards.length()).map { boards.getJSONObject(it).getString("name") }.toSet())
                val channels = state.getJSONArray("channels")
                for (i in 0 until boards.length()) {
                    val board = boards.getJSONObject(i)
                    val kinds = (0 until channels.length()).map { channels.getJSONObject(it) }
                        .filter { it.optString("boardId") == board.getString("id") }.map { it.getString("kind") }.sorted()
                    assertEquals(listOf("chat", "event"), kinds)
                }
                assertEquals(preset, state.getString("setupPreset"))
                assertEquals(if (preset in listOf("club", "business")) "viewer" else "user", state.getString("defaultRole"))
            }
            checkSnapshot(server.snapshotAppStateJson())
            val reloaded = DrServer(0, AssetManagerClientAssetSource(app.assets), file)
            checkSnapshot(reloaded.snapshotAppStateJson())
        }
    }
}
