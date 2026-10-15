package com.phlip

import org.junit.Assert.assertEquals
import org.junit.Test

class JoinIntentPrefillTest {
    @Test
    fun publicOriginAndSlugAreDeliveredAtomically() {
        assertEquals(
            "phlip://join?url=https%3A%2F%2Fpublic.example&slug=current99",
            JoinIntentPrefill.combine("https://public.example", "current99"),
        )
    }

    @Test
    fun fullPersonalInviteIsNotWrappedAgain() {
        val invite = "https://public.example/j/current99"
        assertEquals(invite, JoinIntentPrefill.combine(invite, "current99"))
    }

    @Test
    fun existingDeepLinkKeepsItsUrlAndSlug() {
        val deep = "phlip://join?url=https%3A%2F%2Fpublic.example&slug=current99"
        assertEquals(deep, JoinIntentPrefill.combine(deep, "current99"))
    }

    @Test
    fun deepLinkKeepsCompletePersonalInviteUrl() {
        val deep =
            "phlip://join?url=https%3A%2F%2Fpublic.example%2Fj%2Fcurrent99&slug=current99"
        assertEquals(deep, JoinIntentPrefill.combine(deep, "current99"))
    }

    @Test
    fun slugOnlyIntentRemainsResolvable() {
        assertEquals(
            "phlip://join?slug=current99",
            JoinIntentPrefill.combine(null, "current99"),
        )
    }

    @Test
    fun lanLinkWithoutSlugIsUnchanged() {
        assertEquals(
            "http://192.168.1.20:3000",
            JoinIntentPrefill.combine("http://192.168.1.20:3000", null),
        )
    }
}
