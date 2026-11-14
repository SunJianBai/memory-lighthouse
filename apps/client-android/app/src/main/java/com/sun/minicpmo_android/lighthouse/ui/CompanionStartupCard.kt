package com.sun.minicpmo_android.lighthouse.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.sun.minicpmo_android.lighthouse.model.DeviceReadinessView
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
internal fun CompanionStartupCard(
    deviceId: String?,
    bindingId: String?,
    permissions: CompanionPermissionReadiness,
    load: suspend () -> DeviceReadinessView,
    onRecheckPermissions: () -> Unit,
    onRequestPermissions: () -> Unit,
    onOpenSettings: () -> Unit,
    onRefresh: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val currentLoad by rememberUpdatedState(load)
    val check = remember(deviceId, bindingId) { CompanionStartupCheck(deviceId.orEmpty(), bindingId.orEmpty(), scope) { currentLoad() } }
    val state by check.state.collectAsState()
    var expanded by rememberSaveable(deviceId, bindingId) { mutableStateOf(false) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(check, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_PAUSE || event == Lifecycle.Event.ON_STOP) check.invalidate()
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer); check.invalidate() }
    }
    ArchiveSection(Modifier.fillMaxWidth().testTag("companion-startup-check")) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            TextButton(onClick = { expanded = !expanded }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Text(if (expanded) "收起启动检查" else "启动检查", style = MaterialTheme.typography.titleMedium)
            }
            if (!expanded) {
                Text(if (permissions.fullyReady) "查看家庭授权、本机权限与模型配置。" else "本机权限尚未全部允许，展开查看。", style = MaterialTheme.typography.bodyMedium)
                return@Column
            }
            Text("此 Android 设备 · 检查不会开启摄像头或麦克风", style = MaterialTheme.typography.bodyMedium)
            if (deviceId == null || bindingId == null) {
                Text("设备信息尚未加载，请刷新后重试。")
                OutlinedButton(onClick = onRefresh, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("刷新设备信息") }
            } else {
                OutlinedButton(
                    onClick = { onRecheckPermissions(); check.check() },
                    enabled = state.phase != StartupCheckPhase.CHECKING,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                ) { Text(if (state.phase == StartupCheckPhase.CHECKING) "正在检查…" else "检查启动条件") }
            }
            CheckItem("设备身份与服务端", if (state.report != null) "本次访问成功，设备绑定有效" else if (state.phase == StartupCheckPhase.ERROR) "本次检查失败" else "未检查")
            CheckItem("语音陪伴授权", state.report?.audio?.summary ?: "未检查")
            CheckItem("视频陪伴授权", state.report?.audioVideo?.summary ?: "未检查")
            CheckItem("本机麦克风", if (permissions.microphoneGranted) "权限已允许，采集未检查" else "未允许，请授权或在系统设置中开启")
            CheckItem("本机摄像头", if (permissions.cameraGranted) "权限已允许，采集未检查" else "未允许，请授权或在系统设置中开启")
            CheckItem("应用通知", if (permissions.notificationGranted) "已允许，通知送达未检查" else "未允许，可能错过来电通知；不影响本次权限检查")
            CheckItem("模型配置", state.report?.let { if (it.modelConfigured) "配置已提供，连接未检查" else "配置不可用，请联系管理员" } ?: "未检查")
            Text(
                when (state.phase) {
                    StartupCheckPhase.CHECKING -> "正在检查…"
                    StartupCheckPhase.EXPIRED -> "结果已失效，请重新检查。"
                    StartupCheckPhase.DONE -> "检查时间：" + DateTimeFormatter.ofPattern("MM-dd HH:mm:ss").withZone(ZoneId.systemDefault()).format(Instant.parse(state.report!!.checkedAt))
                    else -> "尚无有效的服务端检查结果。"
                },
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
            if (!permissions.fullyReady) {
                OutlinedButton(onClick = onRequestPermissions, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("设置本机权限") }
                TextButton(onClick = onOpenSettings, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("打开系统设置") }
            }
            Text("检查仅供参考；实际采集和模型连接以开始陪伴后的结果为准。", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun CheckItem(title: String, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, style = MaterialTheme.typography.labelLarge)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}
