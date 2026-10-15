package app.phlip.core.security

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SealedBlobFormatTest {
    @Test
    fun prefix_roundTrip() {
        val raw = byteArrayOf(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0xAA.toByte(), 0xBB.toByte())
        val encoded = SealedBlobFormat.encode(raw)
        assertTrue(SealedBlobFormat.isSealed(encoded))
        assertTrue(encoded.startsWith(SealedBlobFormat.PREFIX))
        val decoded = SealedBlobFormat.decodePayload(encoded)
        assertNotNull(decoded)
        assertEquals(raw.toList(), decoded.toList())
    }

    @Test
    fun plaintext_isNotSealed() {
        assertFalse(SealedBlobFormat.isSealed("hello"))
        assertNull(SealedBlobFormat.decodePayload("hello"))
    }
}
