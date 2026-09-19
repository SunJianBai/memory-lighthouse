package com.sun.minicpmo_android.lighthouse.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.sun.minicpmo_android.lighthouse.model.TodayCareView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
internal fun TodayCareCard(
    householdId: String,
    recipientId: String,
    userId: String,
    load: suspend (String, String) -> TodayCareView,
    onOpenCare: () -> Unit,
) {
    // Each selection owns its state. Cancellation also prevents A→B→A responses leaking.
    key(householdId, recipientId, userId) {
        var data by remember { mutableStateOf<TodayCareView?>(null) }
        var error by remember { mutableStateOf<String?>(null) }
        var loading by remember { mutableStateOf(true) }
        var refresh by remember { mutableIntStateOf(0) }
        val lifecycleOwner = LocalLifecycleOwner.current
        LaunchedEffect(lifecycleOwner, refresh) {
            lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
                while (currentCoroutineContext().isActive) {
                    loading = true
                    error = null
                    try {
                        val result = load(householdId, recipientId)
                        currentCoroutineContext().ensureActive()
                        require(result.householdId == householdId && result.recipientId == recipientId) { "照护信息不匹配，请刷新重试" }
                        data = result
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (failure: Exception) {
                        currentCoroutineContext().ensureActive()
                        data = null
                        error = failure.message ?: "今日照护加载失败，请重试"
                    } finally {
                        currentCoroutineContext().ensureActive()
                        loading = false
                    }
                    delay(60_000)
                }
            }
        }
        OutlinedCard(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("今日照护", modifier = Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.titleLarge)
                    TextButton(onClick = { refresh++ }, enabled = !loading, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text(if (loading) "刷新中…" else "刷新")
                    }
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                if (loading && data == null) Text("正在加载今日照护…")
                data?.let { today ->
                    val timeFormat = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.of(today.timezone))
                    Text("${today.localDate} · ${today.timezone}", style = MaterialTheme.typography.bodyMedium)
                    Text("更新于 ${timeFormat.format(Instant.parse(today.generatedAt))}", style = MaterialTheme.typography.bodySmall)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        TodayMetric("今日提醒", today.total, Modifier.weight(1f))
                        TodayMetric("已确认", today.confirmed, Modifier.weight(1f))
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        TodayMetric("待核验", today.needsReview, Modifier.weight(1f))
                        TodayMetric("未处理待办", today.openTaskCount, Modifier.weight(1f))
                    }
                    if (today.total == 0) Text("今日暂无提醒记录，可在照护页面添加日程。")
                    else if (today.items.isEmpty()) Text("今日没有待确认或待核验的提醒。")
                    today.items.forEach { item ->
                        HorizontalDivider()
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(item.title, fontWeight = FontWeight.SemiBold)
                            val status = when {
                                item.status == "NEEDS_FAMILY_REVIEW" -> "待核验"
                                item.status == "DUE" && Instant.parse(item.scheduledAt) > Instant.parse(today.generatedAt) -> "待提醒"
                                else -> "待确认"
                            }
                            Text("${timeFormat.format(Instant.parse(item.scheduledAt))} · $status", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    Text("待处理 ${today.pending + today.needsReview} 项 · 已结束未确认 ${today.expired} 项", style = MaterialTheme.typography.bodyMedium)
                    OutlinedButton(onClick = onOpenCare, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                        Text("查看日程与待办")
                    }
                }
            }
        }
    }
}

@Composable
private fun TodayMetric(label: String, value: Int, modifier: Modifier) {
    Surface(modifier, color = MaterialTheme.colorScheme.surfaceContainer, shape = MaterialTheme.shapes.medium) {
        Column(Modifier.padding(12.dp)) {
            Text(label, style = MaterialTheme.typography.bodyMedium)
            Text(value.toString(), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        }
    }
}
