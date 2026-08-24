package com.sun.minicpmo_android.lighthouse

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LatestAuthenticationPresentationTest {
    @Test
    fun onlyTheLatestAccountActionOwnsVisibleResults() {
        val presentations = LatestAuthenticationPresentation()
        val older = presentations.begin()
        val newer = presentations.begin()

        assertFalse(presentations.isCurrent(older))
        assertTrue(presentations.isCurrent(newer))
    }

    @Test
    fun anAccountBoundaryInvalidatesAnExistingSnapshot() {
        val presentations = LatestAuthenticationPresentation()
        val snapshot = presentations.snapshot()

        presentations.invalidate()

        assertFalse(presentations.isCurrent(snapshot))
    }
}
