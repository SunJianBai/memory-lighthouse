package com.sun.minicpmo_android.lighthouse.model

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

enum class RoutineRepeat(val label: String, val mask: Int) {
    ONCE("仅一次", 127), DAILY("每天", 127), WEEKDAYS("周一至周五", 62), WEEKENDS("周末", 65), CUSTOM("自选星期", 127);
    companion object {
        fun from(schedule: RoutineScheduleView?): RoutineRepeat = when {
            schedule == null -> DAILY
            schedule.startDate == schedule.endDate -> ONCE
            schedule.weekdayMask == 127 -> DAILY
            schedule.weekdayMask == 62 -> WEEKDAYS
            schedule.weekdayMask == 65 -> WEEKENDS
            else -> CUSTOM
        }
    }
}

object RoutineScheduleRules {
    val weekdays = listOf(2 to "周一", 4 to "周二", 8 to "周三", 16 to "周四", 32 to "周五", 64 to "周六", 1 to "周日")
    fun today(timezone: String, now: Instant = Instant.now()): String = now.atZone(ZoneId.of(timezone)).toLocalDate().toString()
    private fun date(value: String): LocalDate? = runCatching { LocalDate.parse(value).takeIf { it.toString() == value && Regex("\\d{4}-\\d{2}-\\d{2}").matches(value) } }.getOrNull()
    fun error(timezone: String, minutes: Int?, mask: Int, start: String, end: String?, grace: Int?, notice: Int?): String? {
        val startDate = date(start) ?: return "请选择有效开始日期"
        val endDate = end?.let { date(it) ?: return "请选择有效结束日期" }
        if (endDate != null && endDate < startDate) return "结束日期不能早于开始日期"
        if (minutes == null || minutes !in 0..1439) return "请选择有效提醒时间"
        if (mask !in 1..127) return "请至少选择一个星期"
        if (grace == null || grace !in 0..1440) return "确认等待时间应在 0–1440 分钟之间"
        if (notice == null || notice !in 0..10080) return "家属待办延迟应在 0–10080 分钟之间"
        val zone = runCatching { ZoneId.of(timezone) }.getOrNull() ?: return "提醒时区无效"
        if (endDate != null) {
            val hasMatch = (0L..6L).map(startDate::plusDays).takeWhile { it <= endDate }.any { mask and (1 shl (it.dayOfWeek.value % 7)) != 0 }
            if (!hasMatch) return "日期范围内没有所选星期，请调整日期或重复周期"
            if (startDate == endDate && zone.rules.getValidOffsets(startDate.atTime(minutes / 60, minutes % 60)).isEmpty()) return "该日期的提醒时间因夏令时不存在，请选择其他时间"
        }
        return null
    }
    fun error(input: RoutineInput): String? = error(input.timezone, input.localTimeMinutes, input.weekdayMask, input.startDate, input.endDate, input.graceMinutes, input.familyNoticeMinutes)
    fun summary(timezone: String, minutes: Int, mask: Int, start: String, end: String?): String {
        val time = "%02d:%02d".format(minutes / 60, minutes % 60)
        if (start == end) return "仅一次 · $start $time（$timezone）"
        val repeat = when (mask) { 127 -> "每天"; 62 -> "周一至周五"; 65 -> "周末"; else -> weekdays.filter { mask and it.first != 0 }.joinToString("、") { it.second } }
        return "$repeat $time（$timezone） · ${start}起，${end?.let { "至$it" } ?: "持续重复"}"
    }
    fun summary(schedule: RoutineScheduleView): String = summary(schedule.timezone, schedule.localTimeMinutes, schedule.weekdayMask, schedule.startDate, schedule.endDate)
}
