package com.sun.minicpmo_android.lighthouse

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LatestActivationPresentationTest {
    @Test
    fun aNewPresentationPermanentlyInvalidatesTheOldTicket() {
        val presentations = LatestActivationPresentation()
        val old = presentations.begin()
        val current = presentations.begin()

        assertFalse(presentations.isCurrent(old))
        assertTrue(presentations.isCurrent(current))
    }

    @Test
    fun lifecycleInvalidationAlsoInvalidatesSnapshots() {
        val presentations = LatestActivationPresentation()
        val snapshot = presentations.snapshot()

        presentations.invalidate()

        assertFalse(presentations.isCurrent(snapshot))
    }
}
