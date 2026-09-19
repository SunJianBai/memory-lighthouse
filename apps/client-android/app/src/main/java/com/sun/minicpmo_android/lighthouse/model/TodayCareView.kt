package com.sun.minicpmo_android.lighthouse.model

import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

data class TodayCareItem(val id: String, val title: String, val scheduledAt: String, val status: String)

data class TodayCareView(
    val householdId: String,
    val recipientId: String,
    val localDate: String,
    val timezone: String,
    val generatedAt: String,
    val total: Int,
    val confirmed: Int,
    val needsReview: Int,
    val pending: Int,
    val expired: Int,
    val openTaskCount: Int,
    val items: List<TodayCareItem>,
) {
    companion object {
        fun fromJson(json: JSONObject): TodayCareView {
            val counts = json.getJSONObject("counts")
            val items = json.getJSONArray("items")
            return TodayCareView(
                householdId = json.getString("householdId"),
                recipientId = json.getString("recipientId"),
                localDate = json.getString("localDate"),
                timezone = json.getString("timezone"),
                generatedAt = json.getString("generatedAt"),
                total = counts.getInt("total"), confirmed = counts.getInt("confirmed"),
                needsReview = counts.getInt("needsReview"), pending = counts.getInt("pending"),
                expired = counts.getInt("expired"), openTaskCount = json.getInt("openTaskCount"),
                items = (0 until items.length()).map { index ->
                    val item = items.getJSONObject(index)
                    TodayCareItem(item.getString("id"), item.getString("title"), item.getString("scheduledAt"), item.getString("status"))
                },
            ).also { snapshot ->
                // Validate before rendering so malformed server data becomes a retryable load error.
                LocalDate.parse(snapshot.localDate)
                ZoneId.of(snapshot.timezone)
                Instant.parse(snapshot.generatedAt)
                snapshot.items.forEach { Instant.parse(it.scheduledAt) }
                require(listOf(snapshot.total, snapshot.confirmed, snapshot.needsReview, snapshot.pending, snapshot.expired, snapshot.openTaskCount).all { it >= 0 }) {
                    "照护统计无效，请刷新重试"
                }
            }
        }
    }
}
