package app.phlip.server.hosting

import android.app.Application
import app.phlip.server.applyListOrderByIds
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class ChannelOrderTest {

    private data class Ch(val id: String)

    @Test
    fun visibleIdsPermuteAmongTheirSlots() {
        val list = mutableListOf(Ch("A"), Ch("B"), Ch("C"))
        assertTrue(applyListOrderByIds(list, listOf("C", "A")) { it.id })
        assertEquals(listOf("C", "B", "A"), list.map { it.id })
    }

    @Test
    fun unknownIdsAreIgnored() {
        val list = mutableListOf(Ch("A"), Ch("B"), Ch("C"))
        assertTrue(applyListOrderByIds(list, listOf("C", "missing", "A")) { it.id })
        assertEquals(listOf("C", "B", "A"), list.map { it.id })
    }

    @Test
    fun alreadyOrderedIsNoop() {
        val list = mutableListOf(Ch("A"), Ch("B"), Ch("C"))
        assertFalse(applyListOrderByIds(list, listOf("A", "C")) { it.id })
        assertEquals(listOf("A", "B", "C"), list.map { it.id })
    }

    @Test
    fun singleIdIsNoop() {
        val list = mutableListOf(Ch("A"), Ch("B"))
        assertFalse(applyListOrderByIds(list, listOf("B")) { it.id })
        assertEquals(listOf("A", "B"), list.map { it.id })
    }
}
