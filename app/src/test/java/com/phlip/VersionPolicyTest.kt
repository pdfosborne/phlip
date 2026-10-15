package com.phlip

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VersionPolicyTest {
    @Test
    fun compareVersionsOrdersSemver() {
        assertTrue(VersionPolicy.compareVersions("1.0.0", "1.0.1") < 0)
        assertTrue(VersionPolicy.compareVersions("1.10.0", "1.2.0") > 0)
        assertEquals(0, VersionPolicy.compareVersions("1.0", "1.0.0"))
    }

    @Test
    fun compareVersionsHandlesPrefix() {
        assertTrue(VersionPolicy.compareVersions("v1.2", "1.3") < 0)
    }
}
