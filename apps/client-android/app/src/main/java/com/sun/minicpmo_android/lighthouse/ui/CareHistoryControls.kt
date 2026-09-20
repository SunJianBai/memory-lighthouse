package com.sun.minicpmo_android.lighthouse.ui

import android.app.DatePickerDialog
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import com.sun.minicpmo_android.lighthouse.data.CareHistoryKind
import com.sun.minicpmo_android.lighthouse.model.CareHistoryFilter
import com.sun.minicpmo_android.lighthouse.model.CareHistoryRetry
import com.sun.minicpmo_android.lighthouse.model.CareHistoryState
import java.time.LocalDate
import java.time.ZoneId

@Composable
internal fun CareHistoryControls(
    kind: CareHistoryKind,
    history: CareHistoryState<*>,
    timezone: String,
    scopeKey: String,
    busy: Boolean,
    onQuery: (CareHistoryFilter?) -> Unit,
) {
    val focusManager = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val recent = remember(scopeKey) { CareHistoryFilter.recent(timezone) }
    var expanded by rememberSaveable(scopeKey) { mutableStateOf(false) }
    var start by rememberSaveable(scopeKey) { mutableStateOf(history.filter.startDate ?: recent.startDate.orEmpty()) }
    var end by rememberSaveable(scopeKey) { mutableStateOf(history.filter.endDate ?: recent.endDate.orEmpty()) }
    var status by rememberSaveable(scopeKey) { mutableStateOf(history.filter.status.orEmpty()) }
    var submitted by rememberSaveable(scopeKey) { mutableStateOf(false) }
    var menu by remember(scopeKey) { mutableStateOf(false) }
    val draft = CareHistoryFilter(start, end, status.takeIf(String::isNotEmpty))
    val validTimezone = runCatching { ZoneId.of(timezone) }.isSuccess
    val enabled = !busy && !history.loading && !history.accessDenied && validTimezone
    val validation = if (!validTimezone) "请先设置有效的长者时区" else if (submitted) draft.validationError() else null
    val reminder = kind == CareHistoryKind.OCCURRENCES
    Column(Modifier.fillMaxWidth().testTag("care-history-${kind.path}-controls"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(careHistoryTimezoneLabel(history.page?.timezone ?: timezone), style = MaterialTheme.typography.bodyLarge)
        Text(
            if (history.filter.startDate != null) "${history.filter.startDate} 至 ${history.filter.endDate}" else
                if (reminder) "近期提醒（前 24 小时至后 7 天）" else "最新动态",
            style = MaterialTheme.typography.bodyLarge,
        )
        history.filter.status?.let { Text("状态：${occurrenceStatusLabel(it)}", style = MaterialTheme.typography.bodyLarge) }
        history.page?.let { Text("已加载 ${it.items.size} 条", style = MaterialTheme.typography.bodyLarge) }
        OutlinedButton(
            onClick = { expanded = !expanded },
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).semantics { stateDescription = if (expanded) "已展开" else "已收起" },
        ) { Text(if (expanded) "收起查询" else "查询历史") }
        AnimatedVisibility(expanded) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                HistoryDateField(start, "开始日期", timezone, enabled) { start = it }
                HistoryDateField(end, "结束日期", timezone, enabled) { end = it }
                if (reminder) Box {
                    OutlinedButton(onClick = { menu = true }, enabled = enabled,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("history-status")) {
                        Text("状态：${if (status.isEmpty()) "全部" else occurrenceStatusLabel(status)}")
                    }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        listOf("", "DUE", "AWAITING_CONFIRMATION", "NEEDS_FAMILY_REVIEW", "CONFIRMED", "EXPIRED").forEach { value ->
                            DropdownMenuItem(text = { Text(if (value.isEmpty()) "全部" else occurrenceStatusLabel(value)) },
                                onClick = { status = value; menu = false }, modifier = Modifier.heightIn(min = 48.dp))
                        }
                    }
                }
                Text("起止日期均包含在内，每次最多查询 31 天。", style = MaterialTheme.typography.bodyLarge)
                validation?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
                Button(enabled = enabled, onClick = {
                    submitted = true
                    if (draft.validationError() == null) {
                        focusManager.clearFocus()
                        keyboard?.hide()
                        onQuery(draft)
                    }
                }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("查询") }
            }
        }
        if (history.filter != CareHistoryFilter()) {
            TextButton(enabled = enabled, onClick = {
                focusManager.clearFocus()
                keyboard?.hide()
                onQuery(CareHistoryFilter())
            },
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Text(if (reminder) "恢复近期" else "恢复最新")
            }
        }
    }
}

@Composable
internal fun CareHistoryFooter(history: CareHistoryState<*>, busy: Boolean, onRetry: () -> Unit, onMore: () -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (history.loading) {
            Text("正在加载记录…", style = MaterialTheme.typography.bodyLarge)
        } else if (history.error != null) {
            Text(history.error, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.error,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
            OutlinedButton(enabled = !busy && !history.appending,
                onClick = if (history.retry == CareHistoryRetry.MORE) onMore else onRetry,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Text(if (history.retry == CareHistoryRetry.MORE) "重试加载更多" else "重新查询")
            }
        } else if (history.page != null) {
            if (history.page.items.isEmpty()) Text("本次查询没有记录", style = MaterialTheme.typography.bodyLarge)
            if (history.page.nextCursor != null) {
                OutlinedButton(enabled = !busy && !history.appending, onClick = onMore,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Text(if (history.appending) "正在加载更多…" else "加载更多")
                }
            } else Text("本次查询已加载完", style = MaterialTheme.typography.bodyLarge)
        }
    }
}

@Composable
private fun HistoryDateField(value: String, label: String, timezone: String, enabled: Boolean, onChange: (String) -> Unit) {
    val context = LocalContext.current
    var dialog by remember { mutableStateOf<DatePickerDialog?>(null) }
    DisposableEffect(Unit) { onDispose { dialog?.dismiss() } }
    OutlinedTextField(value = value, onValueChange = { onChange(it.take(10)) }, enabled = enabled,
        label = { Text(label) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
        trailingIcon = {
            IconButton(enabled = enabled, onClick = {
                val initial = runCatching { LocalDate.parse(value) }.getOrNull()
                    ?.takeIf { it.year in 1900..9998 } ?: LocalDate.now(ZoneId.of(timezone))
                dialog?.dismiss()
                dialog = DatePickerDialog(context, { _, year, month, day ->
                    onChange(LocalDate.of(year, month + 1, day).toString())
                }, initial.year, initial.monthValue - 1, initial.dayOfMonth).also { it.show() }
            }, modifier = Modifier.size(48.dp)) { Icon(Icons.Rounded.CalendarMonth, contentDescription = "选择$label") }
        },
    )
}
