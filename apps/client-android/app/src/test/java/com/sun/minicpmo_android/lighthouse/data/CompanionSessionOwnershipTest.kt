package com.sun.minicpmo_android.lighthouse.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CompanionSessionOwnershipTest {
    @Test
    fun startCanActivateAndClearItsExactSession() {
        val ownership = CompanionSessionOwnership()

        val start = ownership.beginStart()

        assertTrue(ownership.activate(start, "session-a"))
        assertEquals("session-a", ownership.snapshot().sessionId)
        assertTrue(ownership.clearSession("session-a"))
        assertFalse(ownership.hasActiveSession())
    }

    @Test
    fun aStaleTicketCannotClearItsSuccessor() {
        val ownership = CompanionSessionOwnership()
        val sessionA = ownership.beginStart()
        assertTrue(ownership.activate(sessionA, "session-a"))
        assertTrue(ownership.clearSession("session-a"))
        val sessionB = ownership.beginStart()
        assertTrue(ownership.activate(sessionB, "session-b"))

        assertFalse(ownership.clearIfCurrent(sessionA))

        assertEquals("session-b", ownership.snapshot().sessionId)
    }

    @Test
    fun nullToSessionAndBackToNullStillAdvancesGeneration() {
        val ownership = CompanionSessionOwnership()
        val idleBefore = ownership.snapshot()
        val start = ownership.beginStart()
        assertTrue(ownership.activate(start, "session-a"))
        assertTrue(ownership.clearSession("session-a"))
        val idleAfter = ownership.snapshot()

        assertNull(idleBefore.sessionId)
        assertNull(idleAfter.sessionId)
        assertNotEquals(idleBefore.generation, idleAfter.generation)
        assertFalse(ownership.isCurrent(idleBefore))
    }

    @Test
    fun invalidationPreventsAnInFlightStartFromActivating() {
        val ownership = CompanionSessionOwnership()
        val start = ownership.beginStart()

        ownership.invalidate()

        assertFalse(ownership.activate(start, "session-a"))
        assertFalse(ownership.cancelStart(start))
        assertFalse(ownership.hasActiveSession())
    }

    @Test
    fun clearingAnOldSessionIdDoesNotClearTheCurrentOne() {
        val ownership = CompanionSessionOwnership()
        val sessionA = ownership.beginStart()
        assertTrue(ownership.activate(sessionA, "session-a"))
        assertTrue(ownership.clearSession("session-a"))
        val sessionB = ownership.beginStart()
        assertTrue(ownership.activate(sessionB, "session-b"))

        assertFalse(ownership.clearSession("session-a"))

        assertEquals("session-b", ownership.snapshot().sessionId)
    }
}
