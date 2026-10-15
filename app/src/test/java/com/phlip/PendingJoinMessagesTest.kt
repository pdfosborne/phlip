package com.phlip

import org.junit.Assert.assertEquals
import org.junit.Test

class PendingJoinMessagesTest {
    @Test
    fun withoutInviter() {
        assertEquals(
            "Alex wants to join “Camp”.\n\nApprove to let them in.",
            PendingJoinMessages.format("Camp", "Alex", null),
        )
    }

    @Test
    fun withInviter() {
        assertEquals(
            "Alex wants to join “Camp”.\nRequested via Sam.\n\nApprove to let them in.",
            PendingJoinMessages.format("Camp", "Alex", "Sam"),
        )
    }

    @Test
    fun blankInviterIsTreatedAsAbsent() {
        assertEquals(
            "Alex wants to join “Camp”.\n\nApprove to let them in.",
            PendingJoinMessages.format("Camp", "Alex", "  "),
        )
    }
}
