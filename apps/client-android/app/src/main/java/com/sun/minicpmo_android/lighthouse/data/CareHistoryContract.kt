package com.sun.minicpmo_android.lighthouse.data

import com.sun.minicpmo_android.lighthouse.model.CareHistoryFilter
import com.sun.minicpmo_android.lighthouse.model.CareHistoryPage
import org.json.JSONObject
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.time.ZoneId

internal enum class CareHistoryKind(val path: String) { OCCURRENCES("occurrences"), EVENTS("events") }

internal object CareHistoryContract {
    private val statuses = setOf("DUE", "AWAITING_CONFIRMATION", "NEEDS_FAMILY_REVIEW", "CONFIRMED", "EXPIRED")

    fun path(householdId: String, recipientId: String, kind: CareHistoryKind,
        filter: CareHistoryFilter, cursor: String? = null): String {
        require(filter.validationError() == null) { filter.validationError().orEmpty() }
        require(filter.status == null || kind == CareHistoryKind.OCCURRENCES && filter.status in statuses) { "提醒状态无效" }
        require(cursor == null || cursor.isNotBlank() && cursor.length <= 4096) { "记录分页已失效，请重新查询" }
        val query = mutableListOf("limit=30")
        filter.startDate?.let { query += "startDate=${encode(it)}" }
        filter.endDate?.let { query += "endDate=${encode(it)}" }
        filter.status?.let { query += "status=${encode(it)}" }
        cursor?.let { query += "cursor=${encode(it)}" }
        val endpoint = "households/$householdId/care-recipients/$recipientId/${kind.path}/history"
        return "$endpoint?${query.joinToString("&")}"
    }

    fun <T> parse(json: JSONObject, householdId: String, recipientId: String, parseItem: (JSONObject) -> T): CareHistoryPage<T> {
        val items = json.getJSONArray("items")
        require(items.length() <= 30) { "记录响应无效，请刷新重试" }
        val timezone = json.getString("timezone")
        ZoneId.of(timezone)
        val cursor = nullableString(json, "nextCursor")
        require(cursor == null || cursor.isNotBlank() && cursor.length <= 4096) { "记录分页无效，请刷新重试" }
        val from = nullableString(json, "from")
        val to = nullableString(json, "to")
        require((from == null) == (to == null))
        from?.let(Instant::parse)
        to?.let(Instant::parse)
        return CareHistoryPage(
            items = (0 until items.length()).map { index ->
                val item = items.getJSONObject(index)
                require(item.getString("householdId") == householdId && item.getString("recipientId") == recipientId) {
                    "记录范围已变更，请刷新重试"
                }
                parseItem(item)
            },
            nextCursor = cursor, timezone = timezone, from = from, to = to,
        )
    }

    private fun nullableString(json: JSONObject, key: String): String? {
        require(json.has(key)) { "记录响应缺少 $key" }
        return if (json.isNull(key)) null else (json.get(key) as? String ?: error("记录响应无效"))
    }

    private fun encode(value: String) = URLEncoder.encode(value, StandardCharsets.UTF_8.toString())
}
