package com.sun.minicpmo_android.lighthouse.ui

import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.TimeZone

class CareHistoryPresentationTest {
    @Test fun knownAndUnknownLabelsKeepTheirBusinessMeaning() {
        assertEquals(listOf("待提醒", "待本人确认", "待家属核验", "已确认", "已关闭"), listOf("DUE", "AWAITING_CONFIRMATION", "NEEDS_FAMILY_REVIEW", "CONFIRMED", "EXPIRED").map(::occurrenceStatusLabel))
        assertEquals(listOf("家属", "本人", "日程提醒", "陪伴设备"), listOf("FAMILY", "RECIPIENT", "ROUTINE_SCHEDULER", "COMPANION_DEVICE").map(::careEventSourceLabel))
        assertEquals(listOf("日程确认", "未完成核验", "待核验提醒", "联系家人请求"), listOf("ROUTINE_CONFIRMED", "ROUTINE_NOT_CONFIRMED", "ROUTINE_CONFIRMATION_MISSING", "RECIPIENT_REQUESTED_FAMILY_CONTACT").map(::careEventTypeLabel))
        assertEquals("一般记录", careEventSeverityLabel("INFO"))
        assertEquals("需关注", careEventSeverityLabel("ATTENTION"))
        assertEquals("状态未知", occurrenceStatusLabel("FUTURE_STATE"))
        assertEquals("来源待确认", careEventSourceLabel("USER"))
        assertEquals("其他动态", careEventTypeLabel("FAMILY_REQUESTED"))
        assertEquals("级别未知", careEventSeverityLabel("FUTURE_LEVEL"))
    }

    @Test fun explicitZoneControlsMidnightAndYearAcrossDeviceZones() {
        val original = TimeZone.getDefault()
        try {
            listOf("Pacific/Honolulu", "Asia/Tokyo").forEach {
                TimeZone.setDefault(TimeZone.getTimeZone(it))
                assertEquals("2027-01-01 00:30", formatCareHistoryTime("2026-12-31T16:30:00Z", "Asia/Shanghai"))
                assertEquals("2026-12-31 08:30", formatCareHistoryTime("2026-12-31T16:30:00Z", "America/Los_Angeles"))
            }
        } finally { TimeZone.setDefault(original) }
    }

    @Test fun daylightSavingTransitionsUseZoneRules() {
        assertEquals("2026-03-08 01:59", formatCareHistoryTime("2026-03-08T09:59:00Z", "America/Los_Angeles"))
        assertEquals("2026-03-08 03:00", formatCareHistoryTime("2026-03-08T10:00:00Z", "America/Los_Angeles"))
        assertEquals("2026-11-01 01:30", formatCareHistoryTime("2026-11-01T08:30:00Z", "America/Los_Angeles"))
        assertEquals("2026-11-01 01:30", formatCareHistoryTime("2026-11-01T09:30:00Z", "America/Los_Angeles"))
    }

    @Test fun invalidValuesDoNotCrashOrUseDeviceTimezone() {
        listOf("", "invalid", "2026-12-31T16:30:00", "2026-02-30T00:00:00Z").forEach {
            assertEquals("时间未知", formatCareHistoryTime(it, "Asia/Shanghai"))
        }
        assertEquals("时区未设置", formatCareHistoryTime("2026-12-31T16:30:00Z", null))
        assertEquals("时区无效", formatCareHistoryTime("2026-12-31T16:30:00Z", "invalid/zone"))
        assertEquals("长者时区：Asia/Shanghai", careHistoryTimezoneLabel("Asia/Shanghai"))
        assertEquals("长者时区未设置", careHistoryTimezoneLabel(""))
        assertEquals("长者时区无效", careHistoryTimezoneLabel("invalid/zone"))
    }
}
