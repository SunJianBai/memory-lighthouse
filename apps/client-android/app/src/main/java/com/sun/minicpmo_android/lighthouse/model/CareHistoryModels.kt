package com.sun.minicpmo_android.lighthouse.model

import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit

data class CareHistoryFilter(
    val startDate: String? = null,
    val endDate: String? = null,
    val status: String? = null,
) {
    fun validationError(): String? {
        if (startDate == null && endDate == null) return null
        val start = parseDate(startDate) ?: return "请填写有效的开始和结束日期"
        val end = parseDate(endDate) ?: return "请填写有效的开始和结束日期"
        if (end < start) return "结束日期不能早于开始日期"
        if (ChronoUnit.DAYS.between(start, end) >= 31) return "每次最多查询 31 天，请缩小日期范围"
        return null
    }

    companion object {
        private fun parseDate(value: String?): LocalDate? = runCatching {
            require(value != null && Regex("\\d{4}-\\d{2}-\\d{2}").matches(value))
            LocalDate.parse(value).also { require(it.year in 1900..9998) }
        }.getOrNull()

        fun recent(timezone: String): CareHistoryFilter = runCatching {
            val today = LocalDate.now(ZoneId.of(timezone))
            CareHistoryFilter(today.minusDays(6).toString(), today.toString())
        }.getOrDefault(CareHistoryFilter("", ""))
    }
}

data class CareHistoryPage<T>(
    val items: List<T>,
    val nextCursor: String?,
    val timezone: String,
    val from: String?,
    val to: String?,
)

enum class CareHistoryRetry { REFRESH, MORE }

data class CareHistoryState<T>(
    val filter: CareHistoryFilter = CareHistoryFilter(),
    val page: CareHistoryPage<T>? = null,
    val loading: Boolean = false,
    val appending: Boolean = false,
    val error: String? = null,
    val retry: CareHistoryRetry = CareHistoryRetry.REFRESH,
    val accessDenied: Boolean = false,
)
