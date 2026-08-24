package com.sun.minicpmo_android.lighthouse.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ExplicitUserSessionOwnershipTest {
    @Test
    fun aNewLoginIntentPermanentlyPreventsAnOlderCommit() {
        val ownership = ExplicitUserSessionOwnership()
        val committed = mutableListOf<String>()
        val older = ownership.begin {}
        val newer = ownership.begin {}

        assertFalse(ownership.commitIfCurrent(older) { committed += "older" })
        assertTrue(ownership.commitIfCurrent(newer) { committed += "newer" })
        assertEquals(listOf("newer"), committed)
    }

    @Test
    fun invalidationClearsInsideTheBoundaryAndRejectsThePreviousTicket() {
        val ownership = ExplicitUserSessionOwnership()
        val ticket = ownership.begin {}
        var session = "session"

        val previous = ownership.invalidate {
            session.also { session = "" }
        }

        assertEquals("session", previous)
        assertEquals("", session)
        assertFalse(ownership.isCurrent(ticket))
    }

    @Test
    fun conditionalInvalidationCannotClearANewerGeneration() {
        val ownership = ExplicitUserSessionOwnership()
        val older = ownership.begin {}
        val newer = ownership.begin {}
        var cleared = false

        assertFalse(ownership.invalidateIfCurrent(older) { cleared = true })
        assertFalse(cleared)
        assertTrue(ownership.isCurrent(newer))
    }
}
