package com.phlip.hosting

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * REST-05 (manifest) and related static posture checks that can run on the JVM.
 * Backup policy lives on the installable proprietary APK — not in open-source
 * `:server`.
 */
class ManifestSecurityTest {

    @Test
    fun R05_allowBackupFalse() {
        val manifest = locateAppFile("src/main/AndroidManifest.xml")
            ?: error("app AndroidManifest.xml not found")
        val text = manifest.readText()
        assertTrue(
            "android:allowBackup must be false",
            text.contains("""android:allowBackup="false""""),
        )
        assertFalse(
            "android:allowBackup must not be true",
            text.contains("""android:allowBackup="true""""),
        )
    }

    @Test
    fun R05_dataExtractionRulesExcludeSecrets() {
        val rules = locateAppFile("src/main/res/xml/data_extraction_rules.xml")
            ?: error("data_extraction_rules.xml not found")
        val text = rules.readText()
        assertTrue(text.contains("ash_cloudflare_secure_v2.xml"))
        assertTrue(text.contains("ash_host_at_rest_v1.xml"))
        assertTrue(text.contains("ash_approved_networks_v1.xml"))
        assertTrue(text.contains("servers.json"))
    }

    @Test
    fun R05_fullBackupContentExcludeSecrets() {
        val manifest = locateAppFile("src/main/AndroidManifest.xml")
            ?: error("app AndroidManifest.xml not found")
        assertTrue(
            "android:fullBackupContent must point at backup_rules",
            manifest.readText().contains("""android:fullBackupContent="@xml/backup_rules""""),
        )
        val rules = locateAppFile("src/main/res/xml/backup_rules.xml")
            ?: error("backup_rules.xml not found")
        val text = rules.readText()
        assertTrue(text.contains("ash_cloudflare_secure_v2.xml"))
        assertTrue(text.contains("ash_host_at_rest_v1.xml"))
        assertTrue(text.contains("ash_approved_networks_v1.xml"))
        assertTrue(text.contains("servers.json"))
    }

    /** Gradle unit-test cwd is the `:app` module directory. */
    private fun locateAppFile(relUnderApp: String): File? =
        listOf(
            File(relUnderApp),
            File("app/$relUnderApp"),
            File("../app/$relUnderApp"),
        ).firstOrNull { it.isFile }
}
