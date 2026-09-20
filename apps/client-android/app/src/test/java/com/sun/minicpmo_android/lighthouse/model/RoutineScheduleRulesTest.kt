package com.sun.minicpmo_android.lighthouse.model

import java.time.Instant
import org.junit.Assert.*
import org.junit.Test

class RoutineScheduleRulesTest {
    private val input = RoutineInput("ACTIVITY", title = "散步", instructions = "院内散步", confirmationQuestion = "完成了吗？", timezone = "Asia/Shanghai", localTimeMinutes = 540, weekdayMask = 62, startDate = "2026-09-21", endDate = "2026-09-27", graceMinutes = 5, familyNoticeMinutes = 15)
    @Test fun defaultsUseRecipientDateInsteadOfPhoneDate() {
        assertEquals("2026-09-20", RoutineScheduleRules.today("America/Los_Angeles", Instant.parse("2026-09-21T00:30:00Z")))
        assertEquals("2026-09-21", RoutineScheduleRules.today("Asia/Shanghai", Instant.parse("2026-09-21T00:30:00Z")))
    }
    @Test fun rejectsInvalidAndNonFiringRanges() {
        for (bad in listOf(input.copy(startDate = "2026-02-30"), input.copy(endDate = "2026-09-20"), input.copy(weekdayMask = 0), input.copy(weekdayMask = 65, endDate = "2026-09-22"), input.copy(timezone = "invalid"), input.copy(familyNoticeMinutes = -1))) {
            assertNotNull(RoutineScheduleRules.error(bad))
        }
        assertNull(RoutineScheduleRules.error(input))
    }
    @Test fun aSingleDateSelectsExactlyThatDateAndRejectsDstGap() {
        assertNull(RoutineScheduleRules.error(input.copy(startDate = "2026-09-26", endDate = "2026-09-26", weekdayMask = 127)))
        assertTrue(RoutineScheduleRules.error(input.copy(startDate = "2026-03-08", endDate = "2026-03-08", weekdayMask = 127, timezone = "America/New_York", localTimeMinutes = 150))!!.contains("夏令时"))
    }
    @Test fun summaryExplainsBoundsAndOneTimeWithoutCallingWeekdaysHolidays() {
        assertEquals("周一至周五 09:00（Asia/Shanghai） · 2026-09-21起，至2026-09-27", RoutineScheduleRules.summary("Asia/Shanghai", 540, 62, "2026-09-21", "2026-09-27"))
        assertEquals("仅一次 · 2026-09-26 09:00（Asia/Shanghai）", RoutineScheduleRules.summary("Asia/Shanghai", 540, 127, "2026-09-26", "2026-09-26"))
        assertTrue(RoutineScheduleRules.summary("Asia/Shanghai", 540, 65, "2026-09-21", null).contains("持续重复"))
    }
}
