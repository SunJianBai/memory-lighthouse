package com.sun.minicpmo_android.lighthouse.ui

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

internal fun occurrenceStatusLabel(value: String): String = when (value) {
    "DUE" -> "待提醒"
    "AWAITING_CONFIRMATION" -> "待本人确认"
    "NEEDS_FAMILY_REVIEW" -> "待家属核验"
    "CONFIRMED" -> "已确认"
    "EXPIRED" -> "已关闭"
    else -> "状态未知"
}

internal fun careEventSourceLabel(value: String): String = when (value) {
    "FAMILY" -> "家属"
    "RECIPIENT" -> "本人"
    "ROUTINE_SCHEDULER" -> "日程提醒"
    "COMPANION_DEVICE" -> "陪伴设备"
    else -> "来源待确认"
}

internal fun careEventTypeLabel(value: String): String = when (value) {
    "ROUTINE_CONFIRMED" -> "日程确认"
    "ROUTINE_NOT_CONFIRMED" -> "未完成核验"
    "ROUTINE_CONFIRMATION_MISSING" -> "待核验提醒"
    "RECIPIENT_REQUESTED_FAMILY_CONTACT" -> "联系家人请求"
    else -> "其他动态"
}

internal fun careEventSeverityLabel(value: String): String = when (value) {
    "INFO" -> "一般记录"
    "ATTENTION" -> "需关注"
    else -> "级别未知"
}

private fun careHistoryTimezoneError(timezone: String?): String? = when {
    timezone.isNullOrBlank() -> "时区未设置"
    runCatching { ZoneId.of(timezone) }.isFailure -> "时区无效"
    else -> null
}

internal fun careHistoryTimezoneLabel(timezone: String?): String =
    "长者${careHistoryTimezoneError(timezone) ?: "时区：$timezone"}"

internal fun formatCareHistoryTime(value: String, timezone: String?): String {
    val instant = runCatching { Instant.parse(value) }.getOrNull() ?: return "时间未知"
    careHistoryTimezoneError(timezone)?.let { return it }
    return CARE_HISTORY_FORMATTER.withZone(ZoneId.of(timezone)).format(instant)
}

private val CARE_HISTORY_FORMATTER = DateTimeFormatter.ofPattern("uuuu-MM-dd HH:mm", Locale.ROOT)
