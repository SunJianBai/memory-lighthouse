package com.sun.minicpmo_android.lighthouse

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ActionBusyTrackerTest {
    @Test
    fun obsoleteRequestDoesNotKeepTheLatestCompletedActionBusy() {
        val tracker = ActionBusyTracker()
        var firstOwnsResult = true
        val first = tracker.begin { firstOwnsResult }
        assertTrue(tracker.isBusy())

        firstOwnsResult = false
        val second = tracker.begin { true }
        assertTrue(tracker.isBusy())

        tracker.end(second)
        assertFalse(tracker.isBusy())

        tracker.end(first)
        assertFalse(tracker.isBusy())
    }

    @Test
    fun independentActionKeepsTheScreenBusyAfterLatestWorkspaceFinishes() {
        val tracker = ActionBusyTracker()
        val independent = tracker.begin { true }
        val workspace = tracker.begin { true }

        tracker.end(workspace)
        assertTrue(tracker.isBusy())

        tracker.end(independent)
        assertFalse(tracker.isBusy())
    }
}
