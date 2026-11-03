package com.sun.minicpmo_android.lighthouse.ui

internal fun routineStatusLabel(status: String) = when (status) {
    "ACTIVE" -> "已启用"
    "PAUSED" -> "已暂停"
    "DELETED" -> "已删除"
    else -> "状态未知"
}

internal fun routineLifecycleActionLabel(status: String): String? = when (status) {
    "ACTIVE" -> "暂停"
    "PAUSED" -> "恢复"
    else -> null
}

internal fun occurrenceClosureLabel(status: String, reason: String?): String? =
    "日程已暂停".takeIf { status == "EXPIRED" && reason == "ROUTINE_PAUSED" }
