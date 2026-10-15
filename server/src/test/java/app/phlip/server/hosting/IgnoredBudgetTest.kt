package app.phlip.server.hosting

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * CI rule: ignored hosting-security stubs must not grow silently.
 * Raise [MAX_IGNORED] only when adding a deliberate new L3/L4 stub with a comment.
 */
class IgnoredBudgetTest {

    companion object {
        /**
         * ClientLayerStubsTest 6 + RestAndLifecycleStubsTest 13 (incl. H01–H04 hotspot) = 19.
         */
        const val MAX_IGNORED = 19
    }

    @Test
    fun ignoredHostingStubsWithinBudget() {
        val sources = listOf(
            locate("src/test/java/app/phlip/server/hosting/LayerStubsTest.kt"),
            locate("../server/src/test/java/app/phlip/server/hosting/LayerStubsTest.kt"),
        ).mapNotNull { it }
        assertTrue("LayerStubsTest.kt not found", sources.isNotEmpty())
        val text = sources.first().readText()
        // Count @Ignore annotations that precede @Test in the stubs file.
        val ignored = Regex("@Ignore\\([^)]*\\)\\s*\\n\\s*@Test").findAll(text).count()
        assertTrue(
            "Ignored hosting stubs=$ignored exceeds budget $MAX_IGNORED. " +
                "Implement or justify raising IgnoredBudgetTest.MAX_IGNORED.",
            ignored <= MAX_IGNORED,
        )
        // Also ensure we didn't accidentally @Ignore real suites.
        for (cls in listOf("AuthzGuestTest", "AuthzMemberTest", "EdgeGateTest", "XssCorpusTest")) {
            val f = locate("src/test/java/app/phlip/server/hosting/$cls.kt")
                ?: locate("../server/src/test/java/app/phlip/server/hosting/$cls.kt")
                ?: continue
            assertTrue(
                "$cls must not be blanket-@Ignore'd",
                !f.readText().contains("@Ignore\nclass") &&
                    !Regex("@Ignore[^\\n]*\\nclass $cls").containsMatchIn(f.readText()),
            )
        }
    }

    private fun locate(rel: String): File? = File(rel).takeIf { it.isFile }
}
