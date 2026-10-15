package app.phlip.server.hosting

import app.phlip.server.PlaceEntry
import app.phlip.server.locationLabelIdHasPlace
import app.phlip.server.locationLabelIdsOverlap
import app.phlip.server.parseEventPlaces
import app.phlip.server.sanitizeLocationLabelId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LocationLabelIdTest {
    private val registry = listOf(
        PlaceEntry("Court 1", "leisure"),
        PlaceEntry("Court 3", "leisure"),
        PlaceEntry("Hall", "work"),
    )

    @Test
    fun parseSplitsJoinedPlaces() {
        assertEquals(listOf("Court 1", "Court 3"), parseEventPlaces("Court 1 · Court 3"))
        assertEquals(listOf("Hall"), parseEventPlaces("Hall"))
        assertEquals(emptyList<String>(), parseEventPlaces("  "))
    }

    @Test
    fun sanitizeKeepsEachRegistryHit() {
        assertEquals(
            "Court 1 · Court 3",
            sanitizeLocationLabelId("Court 1 · Court 3", registry),
        )
        assertEquals("Hall", sanitizeLocationLabelId("hall", registry))
        assertNull(sanitizeLocationLabelId("Court 1 · Court 3", emptyList()))
        assertEquals("Court 1", sanitizeLocationLabelId("Court 1 · Somewhere new", registry))
    }

    @Test
    fun pinMembershipSplitsTheTag() {
        assertTrue(locationLabelIdHasPlace("Court 1 · Court 3", "Court 1"))
        assertTrue(locationLabelIdHasPlace("Court 1 · Court 3", "court 3"))
        assertFalse(locationLabelIdHasPlace("Court 1 · Court 3", "Hall"))
        assertTrue(locationLabelIdsOverlap("Court 1", "Court 1 · Court 3"))
        assertFalse(locationLabelIdsOverlap("Hall", "Court 1 · Court 3"))
    }
}
