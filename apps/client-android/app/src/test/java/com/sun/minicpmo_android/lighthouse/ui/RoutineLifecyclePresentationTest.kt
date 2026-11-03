package com.sun.minicpmo_android.lighthouse.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RoutineLifecyclePresentationTest {
    @Test fun pausedIsNeutralAndUnknownStateDoesNotOfferResume() {
        assertEquals("已暂停", routineStatusLabel("PAUSED"))
        assertEquals("已启用", routineStatusLabel("ACTIVE"))
        assertEquals("状态未知", routineStatusLabel("NEW_STATE"))
        assertEquals("恢复", routineLifecycleActionLabel("PAUSED"))
        assertNull(routineLifecycleActionLabel("DELETED"))
        assertNull(routineLifecycleActionLabel("NEW_STATE"))
    }
    @Test fun pauseClosureIsNotCompletionAndMissingOrUnknownReasonIsNeutral() {
        assertEquals("日程已暂停", occurrenceClosureLabel("EXPIRED", "ROUTINE_PAUSED"))
        assertNull(occurrenceClosureLabel("EXPIRED", null))
        assertNull(occurrenceClosureLabel("EXPIRED", "UNKNOWN"))
        assertNull(occurrenceClosureLabel("CONFIRMED", "ROUTINE_PAUSED"))
    }
}
