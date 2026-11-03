package com.sun.minicpmo_android.lighthouse.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.sun.minicpmo_android.lighthouse.model.RoutineScheduleRules
import com.sun.minicpmo_android.lighthouse.model.RoutineView

@Composable
internal fun RoutineLifecycleDialog(
    routine: RoutineView,
    busy: Boolean,
    error: String?,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
    onEdit: () -> Unit,
) {
    val pause = routine.status == "ACTIVE"
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(if (pause) "暂停这个日程？" else "恢复这个日程？") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(routine.title)
                routine.schedules.firstOrNull()?.let { Text(RoutineScheduleRules.summary(it)) }
                Text(if (pause) "暂停后，尚未确认的提醒将关闭。待家属核验记录和已有待办会保留。" else "只安排恢复后的提醒，不补发暂停期间的提醒。")
                Text("正在运行的陪伴会话将在收到日程更新后停止，需要重新开始；已经播放的内容无法撤回。", style = MaterialTheme.typography.bodySmall)
                error?.let {
                    Text(it, color = MaterialTheme.colorScheme.error)
                    if (!pause) TextButton(onClick = onEdit, enabled = !busy, modifier = Modifier.heightIn(min = 48.dp)) { Text("编辑日程") }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onConfirm, enabled = !busy, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(if (busy) "处理中…" else if (pause) "暂停日程" else "恢复日程")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy, modifier = Modifier.heightIn(min = 48.dp)) { Text("取消") } },
    )
}
