package com.sun.minicpmo_android.ui

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.view.WindowManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.automirrored.rounded.VolumeUp
import androidx.compose.material.icons.rounded.CameraAlt
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Cameraswitch
import androidx.compose.material.icons.rounded.ChatBubbleOutline
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.GraphicEq
import androidx.compose.material.icons.rounded.Hearing
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.MicOff
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material.icons.rounded.Videocam
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.sun.minicpmo_android.MainViewModel
import com.sun.minicpmo_android.camera.NativeCameraPreview
import com.sun.minicpmo_android.model.AppUiState
import com.sun.minicpmo_android.model.ConversationMessage
import com.sun.minicpmo_android.model.MessageRole
import com.sun.minicpmo_android.model.RealtimeMode
import com.sun.minicpmo_android.model.SessionPhase
import com.sun.minicpmo_android.model.SessionSettings
import com.sun.minicpmo_android.ui.theme.MonitorDanger
import com.sun.minicpmo_android.ui.theme.MonitorInk
import com.sun.minicpmo_android.ui.theme.MonitorMuted
import com.sun.minicpmo_android.ui.theme.MonitorOutline
import com.sun.minicpmo_android.ui.theme.MonitorPaper
import com.sun.minicpmo_android.ui.theme.MonitorSignal
import com.sun.minicpmo_android.ui.theme.MonitorSurface
import com.sun.minicpmo_android.ui.theme.MonitorSurfaceRaised
import java.util.Locale
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.sin

@Composable
fun MiniCpmRoute(
    viewModel: MainViewModel,
    onExit: (() -> Unit)? = null,
    allowedModes: Set<RealtimeMode> = RealtimeMode.entries.toSet(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val snackbarHostState = remember { SnackbarHostState() }
    val coroutineScope = rememberCoroutineScope()
    var cameraPermissionGranted by remember {
        mutableStateOf(context.hasPermission(Manifest.permission.CAMERA))
    }
    var pendingDuplexStart by remember { mutableStateOf(false) }
    var exitConfirmationVisible by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(allowedModes, state.selectedMode) {
        if (state.selectedMode !in allowedModes) {
            preferredMode(allowedModes)?.let(viewModel::selectMode)
        }
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { results ->
        cameraPermissionGranted = context.hasPermission(Manifest.permission.CAMERA)
        val micGranted = context.hasPermission(Manifest.permission.RECORD_AUDIO)
        val cameraReady = state.selectedMode != RealtimeMode.VIDEO || cameraPermissionGranted
        if (pendingDuplexStart && micGranted && cameraReady) {
            viewModel.startDuplex()
        } else if (pendingDuplexStart) {
            val missing = if (!micGranted) "麦克风" else "摄像头"
            pendingDuplexStart = false
            coroutineScope.launch {
                snackbarHostState.showSnackbar("需要${missing}权限才能开始实时会话")
            }
        }
        pendingDuplexStart = false
    }

    fun requestDuplexStart() {
        val permissions = buildList {
            if (!context.hasPermission(Manifest.permission.RECORD_AUDIO)) {
                add(Manifest.permission.RECORD_AUDIO)
            }
            if (
                state.selectedMode == RealtimeMode.VIDEO &&
                !context.hasPermission(Manifest.permission.CAMERA)
            ) {
                add(Manifest.permission.CAMERA)
            }
        }
        if (permissions.isEmpty()) {
            viewModel.startDuplex()
        } else {
            pendingDuplexStart = true
            permissionLauncher.launch(permissions.toTypedArray())
        }
    }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) viewModel.onAppBackgrounded()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    DisposableEffect(state.hasActiveSession) {
        val activity = context as? Activity
        if (state.hasActiveSession) {
            activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
        onDispose {
            activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    fun requestExit() {
        if (state.hasActiveSession) {
            exitConfirmationVisible = true
        } else {
            onExit?.invoke()
        }
    }

    BackHandler(enabled = onExit != null) {
        requestExit()
    }
    BackHandler(enabled = onExit == null && state.hasActiveSession) {
        viewModel.stopSession()
    }

    MiniCpmApp(
        state = state,
        cameraPermissionGranted = cameraPermissionGranted,
        snackbarHostState = snackbarHostState,
        onSelectMode = viewModel::selectMode,
        onComposerChange = viewModel::updateComposer,
        onSendChat = viewModel::sendChat,
        onStartDuplex = ::requestDuplexStart,
        onStop = { viewModel.stopSession() },
        onTogglePause = viewModel::togglePause,
        onToggleMic = viewModel::toggleMic,
        onToggleForceListen = viewModel::toggleForceListen,
        onFrame = viewModel::onVideoFrame,
        onCameraError = viewModel::onCameraError,
        onOpenSettings = { viewModel.setSettingsVisible(true) },
        onDismissSettings = { viewModel.setSettingsVisible(false) },
        onSaveSettings = { draft ->
            viewModel.updateSettings(draft)
            viewModel.saveSettings()
        },
        onClear = viewModel::clearConversation,
        onExit = if (onExit != null) ::requestExit else null,
        allowedModes = allowedModes,
    )

    if (exitConfirmationVisible) {
        AlertDialog(
            onDismissRequest = { exitConfirmationVisible = false },
            title = { Text("结束陪伴对话并返回？") },
            text = { Text("当前实时陪伴会话将结束，返回后可以重新开始。") },
            confirmButton = {
                Button(
                    onClick = {
                        exitConfirmationVisible = false
                        viewModel.stopSession()
                        onExit?.invoke()
                    },
                ) {
                    Text("结束并返回")
                }
            },
            dismissButton = {
                TextButton(onClick = { exitConfirmationVisible = false }) {
                    Text("继续陪伴")
                }
            },
        )
    }
}

@Composable
private fun MiniCpmApp(
    state: AppUiState,
    cameraPermissionGranted: Boolean,
    snackbarHostState: SnackbarHostState,
    onSelectMode: (RealtimeMode) -> Unit,
    onComposerChange: (String) -> Unit,
    onSendChat: () -> Unit,
    onStartDuplex: () -> Unit,
    onStop: () -> Unit,
    onTogglePause: () -> Unit,
    onToggleMic: () -> Unit,
    onToggleForceListen: () -> Unit,
    onFrame: (String) -> Unit,
    onCameraError: (String) -> Unit,
    onOpenSettings: () -> Unit,
    onDismissSettings: () -> Unit,
    onSaveSettings: (SessionSettings) -> String?,
    onClear: () -> Unit,
    onExit: (() -> Unit)?,
    allowedModes: Set<RealtimeMode>,
) {
    var clearConfirmationVisible by rememberSaveable { mutableStateOf(false) }
    val clearEnabled = state.messages.isNotEmpty() && !state.hasActiveSession

    Scaffold(
        containerColor = MonitorInk,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        modifier = Modifier.fillMaxSize(),
    ) { padding ->
        BoxWithConstraints(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .windowInsetsPadding(WindowInsets.safeDrawing),
            contentAlignment = Alignment.TopCenter,
        ) {
            val horizontalPadding = if (maxWidth >= 720.dp) 32.dp else 16.dp
            val contentMaxWidth = maxWidth.coerceAtMost(760.dp)
            Column(
                modifier = Modifier
                    .fillMaxHeight()
                    .fillMaxWidth()
                    .padding(horizontal = horizontalPadding),
            ) {
                AppTopBar(
                    state = state,
                    embeddedInLighthouse = onExit != null,
                    onOpenSettings = onOpenSettings,
                    settingsEnabled = !state.hasActiveSession,
                    clearEnabled = clearEnabled,
                    onClear = { clearConfirmationVisible = true },
                    onExit = onExit,
                )
                ModeSelector(
                    selected = state.selectedMode,
                    enabled = !state.hasActiveSession,
                    modes = allowedModes,
                    onSelect = onSelectMode,
                )
                Spacer(Modifier.height(12.dp))
                AnimatedContent(
                    targetState = state.selectedMode,
                    label = "mode-content",
                    modifier = Modifier
                        .width(contentMaxWidth)
                        .weight(1f)
                        .align(Alignment.CenterHorizontally),
                ) { mode ->
                    when (mode) {
                        RealtimeMode.CHAT -> ChatScreen(
                            state = state,
                            onComposerChange = onComposerChange,
                            onSend = onSendChat,
                        )

                        RealtimeMode.AUDIO -> AudioDuplexScreen(
                            state = state,
                            onStart = onStartDuplex,
                            onStop = onStop,
                            onTogglePause = onTogglePause,
                            onToggleMic = onToggleMic,
                            onToggleForceListen = onToggleForceListen,
                        )

                        RealtimeMode.VIDEO -> VideoDuplexScreen(
                            state = state,
                            cameraPermissionGranted = cameraPermissionGranted,
                            onStart = onStartDuplex,
                            onStop = onStop,
                            onTogglePause = onTogglePause,
                            onToggleMic = onToggleMic,
                            onToggleForceListen = onToggleForceListen,
                            onFrame = onFrame,
                            onCameraError = onCameraError,
                        )
                    }
                }
            }
        }
    }

    if (state.settingsVisible) {
        SettingsSheet(
            initial = state.settings,
            onDismiss = onDismissSettings,
            onSave = onSaveSettings,
        )
    }

    if (clearConfirmationVisible) {
        AlertDialog(
            onDismissRequest = { clearConfirmationVisible = false },
            title = { Text("清空全部对话？") },
            text = { Text("当前显示的对话内容将被清空，此操作无法撤销。") },
            confirmButton = {
                Button(
                    onClick = {
                        clearConfirmationVisible = false
                        onClear()
                    },
                ) {
                    Text("确认清空")
                }
            },
            dismissButton = {
                TextButton(onClick = { clearConfirmationVisible = false }) {
                    Text("取消")
                }
            },
        )
    }
}

@Composable
private fun AppTopBar(
    state: AppUiState,
    embeddedInLighthouse: Boolean,
    onOpenSettings: () -> Unit,
    settingsEnabled: Boolean,
    clearEnabled: Boolean,
    onClear: () -> Unit,
    onExit: (() -> Unit)?,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 72.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onExit != null) {
            IconButton(
                onClick = onExit,
                modifier = Modifier.size(48.dp),
            ) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "返回陪伴主页")
            }
        }
        Surface(
            shape = CircleShape,
            color = Color.Transparent,
            border = androidx.compose.foundation.BorderStroke(1.dp, MonitorSignal.copy(alpha = 0.65f)),
            modifier = Modifier.size(38.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Text(
                    text = "o",
                    color = MonitorSignal,
                    fontSize = 24.sp,
                    fontStyle = FontStyle.Italic,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = if (embeddedInLighthouse) "守忆灯塔" else "MiniCPM-o",
                style = MaterialTheme.typography.titleMedium,
                color = MonitorPaper,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                ServiceDot(state.serviceAvailable)
                Spacer(Modifier.width(6.dp))
                Text(
                    text = if (embeddedInLighthouse) {
                        "MiniCPM-o · ${state.statusText}"
                    } else {
                        state.statusText
                    },
                    style = MaterialTheme.typography.labelMedium,
                    color = statusColor(state.phase),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.semantics {
                        liveRegion = LiveRegionMode.Polite
                    },
                )
            }
        }
        IconButton(
            onClick = onClear,
            enabled = clearEnabled,
            modifier = Modifier.size(48.dp),
        ) {
            Icon(Icons.Rounded.DeleteOutline, contentDescription = "清空对话")
        }
        IconButton(
            onClick = onOpenSettings,
            enabled = settingsEnabled,
            modifier = Modifier.size(48.dp),
        ) {
            Icon(Icons.Rounded.Settings, contentDescription = "打开设置")
        }
    }
}

@Composable
private fun ServiceDot(available: Boolean?) {
    val color by animateColorAsState(
        targetValue = when (available) {
            true -> MonitorSignal
            false -> MonitorDanger
            null -> MonitorMuted
        },
        label = "service-dot",
    )
    Box(
        Modifier
            .size(7.dp)
            .background(color, CircleShape)
            .semantics {
                contentDescription = when (available) {
                    true -> "服务在线"
                    false -> "服务不可用"
                    null -> "正在检查服务"
                }
            },
    )
}

@Composable
private fun ModeSelector(
    selected: RealtimeMode,
    enabled: Boolean,
    modes: Set<RealtimeMode> = RealtimeMode.entries.toSet(),
    onSelect: (RealtimeMode) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MonitorSurface, RoundedCornerShape(18.dp))
            .border(1.dp, MonitorOutline.copy(alpha = 0.7f), RoundedCornerShape(18.dp))
            .padding(4.dp)
            .selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        MODE_DISPLAY_ORDER.filter { it in modes }.forEach { mode ->
            val active = mode == selected
            val icon = when (mode) {
                RealtimeMode.CHAT -> Icons.Rounded.ChatBubbleOutline
                RealtimeMode.AUDIO -> Icons.Rounded.GraphicEq
                RealtimeMode.VIDEO -> Icons.Rounded.Videocam
            }
            Row(
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 48.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(if (active) MonitorSignal else Color.Transparent)
                    .selectable(
                        selected = active,
                        enabled = enabled,
                        role = Role.Tab,
                        onClick = { if (!active) onSelect(mode) },
                    ),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center,
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = if (active) MonitorInk else MonitorMuted,
                    modifier = Modifier.size(20.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = mode.label,
                    style = MaterialTheme.typography.labelLarge,
                    color = if (active) MonitorInk else MonitorMuted,
                )
            }
        }
    }
}

@Composable
private fun ChatScreen(
    state: AppUiState,
    onComposerChange: (String) -> Unit,
    onSend: () -> Unit,
) {
    val listState = rememberLazyListState()
    val lastMessage = state.messages.lastOrNull()
    LaunchedEffect(state.messages.size, lastMessage?.text) {
        if (state.messages.isNotEmpty()) listState.animateScrollToItem(state.messages.lastIndex)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .imePadding(),
    ) {
        if (state.messages.isEmpty()) {
            EmptyChatHero(
                modifier = Modifier.weight(1f),
                onSuggestion = onComposerChange,
            )
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f),
                contentPadding = PaddingValues(vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                items(state.messages, key = { it.id }) { message ->
                    MessageBubble(message)
                }
            }
        }
        ChatComposer(
            text = state.composerText,
            ttsEnabled = state.settings.chatTtsEnabled,
            enabled = state.canSendChat,
            onTextChange = onComposerChange,
            onSend = onSend,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun EmptyChatHero(
    onSuggestion: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        SignalOrb(level = 0.18f, active = false, modifier = Modifier.size(132.dp))
        Spacer(Modifier.height(24.dp))
        Text(
            text = "看见、听见，也懂你",
            style = MaterialTheme.typography.displaySmall,
            color = MonitorPaper,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(10.dp))
        Text(
            text = "连接 MiniCPM-o 4.5 Realtime API\n开始自然的多模态实时对话",
            style = MaterialTheme.typography.bodyMedium,
            color = MonitorMuted,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(24.dp))
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            listOf("介绍一下你自己", "给我一个今日灵感", "解释多模态模型").forEach { text ->
                AssistChip(
                    onClick = { onSuggestion(text) },
                    label = { Text(text) },
                    colors = AssistChipDefaults.assistChipColors(
                        containerColor = MonitorSurface,
                        labelColor = MonitorPaper,
                    ),
                    border = AssistChipDefaults.assistChipBorder(
                        enabled = true,
                        borderColor = MonitorOutline,
                    ),
                )
            }
        }
    }
}

@Composable
private fun MessageBubble(message: ConversationMessage) {
    val isUser = message.role == MessageRole.USER
    val isSystem = message.role == MessageRole.SYSTEM
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
    ) {
        Surface(
            color = when {
                isUser -> MonitorSignal
                isSystem -> MonitorDanger.copy(alpha = 0.12f)
                else -> MonitorSurfaceRaised
            },
            shape = RoundedCornerShape(
                topStart = 20.dp,
                topEnd = 20.dp,
                bottomStart = if (isUser) 20.dp else 6.dp,
                bottomEnd = if (isUser) 6.dp else 20.dp,
            ),
            border = if (isSystem) {
                androidx.compose.foundation.BorderStroke(1.dp, MonitorDanger.copy(alpha = 0.35f))
            } else {
                null
            },
            modifier = Modifier.fillMaxWidth(if (isSystem) 1f else 0.88f),
        ) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 13.dp)) {
                if (isSystem) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            Icons.Rounded.ErrorOutline,
                            contentDescription = null,
                            tint = MonitorDanger,
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            "系统提示",
                            style = MaterialTheme.typography.labelMedium,
                            color = MonitorDanger,
                        )
                    }
                    Spacer(Modifier.height(6.dp))
                }
                Text(
                    text = message.text,
                    style = MaterialTheme.typography.bodyLarge,
                    color = if (isUser) MonitorInk else MonitorPaper,
                )
                if (message.streaming) {
                    Spacer(Modifier.height(8.dp))
                    StreamingIndicator()
                }
            }
        }
    }
}

@Composable
private fun StreamingIndicator() {
    val transition = rememberInfiniteTransition(label = "streaming")
    val phase by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(900), RepeatMode.Restart),
        label = "streaming-phase",
    )
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        repeat(3) { index ->
            Box(
                Modifier
                    .size(5.dp)
                    .background(
                        MonitorSignal.copy(alpha = 0.25f + 0.75f * ((phase + index / 3f) % 1f)),
                        CircleShape,
                    ),
            )
        }
    }
}

@Composable
private fun ChatComposer(
    text: String,
    ttsEnabled: Boolean,
    enabled: Boolean,
    onTextChange: (String) -> Unit,
    onSend: () -> Unit,
) {
    Surface(
        color = MonitorSurface,
        shape = RoundedCornerShape(24.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, MonitorOutline),
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 8.dp),
    ) {
        Row(
            modifier = Modifier.padding(start = 14.dp, top = 6.dp, end = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (ttsEnabled) {
                Icon(
                    Icons.AutoMirrored.Rounded.VolumeUp,
                    contentDescription = "语音回复已开启",
                    tint = MonitorMuted,
                    modifier = Modifier.size(20.dp),
                )
                Spacer(Modifier.width(8.dp))
            }
            androidx.compose.foundation.text.BasicTextField(
                value = text,
                onValueChange = onTextChange,
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = MonitorPaper),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { if (enabled) onSend() }),
                maxLines = 4,
                decorationBox = { inner ->
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 10.dp),
                    ) {
                        if (text.isEmpty()) {
                            Text("发送消息…", color = MonitorMuted)
                        }
                        inner()
                    }
                },
                modifier = Modifier.weight(1f),
            )
            FilledIconButton(
                onClick = onSend,
                enabled = enabled,
                colors = IconButtonDefaults.filledIconButtonColors(
                    containerColor = MonitorSignal,
                    contentColor = MonitorInk,
                    disabledContainerColor = MonitorOutline,
                    disabledContentColor = MonitorMuted,
                ),
                modifier = Modifier.size(48.dp),
            ) {
                Icon(Icons.AutoMirrored.Rounded.Send, contentDescription = "发送消息")
            }
        }
    }
}

@Composable
private fun AudioDuplexScreen(
    state: AppUiState,
    onStart: () -> Unit,
    onStop: () -> Unit,
    onTogglePause: () -> Unit,
    onToggleMic: () -> Unit,
    onToggleForceListen: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        StatusPill(state)
        Spacer(Modifier.weight(0.45f))
        SignalOrb(
            level = state.audioLevel,
            active = state.phase == SessionPhase.LIVE,
            modifier = Modifier.size(220.dp),
        )
        Spacer(Modifier.height(28.dp))
        Text(
            text = when (state.phase) {
                SessionPhase.LIVE -> if (state.statusText.contains("回答")) "正在回应" else "正在聆听"
                SessionPhase.PAUSED -> "会话暂停"
                SessionPhase.CONNECTING, SessionPhase.QUEUED, SessionPhase.PREPARING -> "正在建立实时链路"
                else -> "随时可以开始"
            },
            style = MaterialTheme.typography.headlineMedium,
            color = MonitorPaper,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = "16 kHz 实时上行 · 24 kHz 流式语音",
            style = MaterialTheme.typography.labelMedium,
            color = MonitorMuted,
        )
        Spacer(Modifier.height(20.dp))
        TranscriptPreview(state.messages)
        Spacer(Modifier.weight(0.55f))
        DuplexControls(
            state = state,
            onStart = onStart,
            onStop = onStop,
            onTogglePause = onTogglePause,
            onToggleMic = onToggleMic,
            onToggleForceListen = onToggleForceListen,
        )
    }
}

@Composable
private fun SignalOrb(level: Float, active: Boolean, modifier: Modifier = Modifier) {
    val transition = rememberInfiniteTransition(label = "signal-orb")
    val breathing by transition.animateFloat(
        initialValue = 0.92f,
        targetValue = 1.06f,
        animationSpec = infiniteRepeatable(tween(1_600), RepeatMode.Reverse),
        label = "orb-breathing",
    )
    val strength = if (active) (0.25f + level * 0.75f) * breathing else 0.16f

    Canvas(modifier = modifier.semantics { contentDescription = "实时声音波形" }) {
        val center = Offset(size.width / 2f, size.height / 2f)
        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(
                    MonitorSignal.copy(alpha = 0.5f * strength),
                    MonitorSignal.copy(alpha = 0.08f),
                    Color.Transparent,
                ),
                center = center,
                radius = size.minDimension / 2f,
            ),
            radius = size.minDimension / 2f,
        )
        repeat(3) { ring ->
            drawCircle(
                color = MonitorSignal.copy(alpha = 0.18f - ring * 0.04f),
                radius = size.minDimension * (0.25f + ring * 0.09f) * (1f + level * 0.08f),
                style = Stroke(width = 1.4.dp.toPx()),
            )
        }
        val barCount = 21
        val maxHeight = size.height * 0.28f
        val barWidth = size.width * 0.012f
        repeat(barCount) { index ->
            val normalized = index / (barCount - 1f)
            val wave = 0.22f + 0.78f * kotlin.math.abs(sin((normalized * 2.5f + strength) * PI)).toFloat()
            val height = maxHeight * wave * (0.45f + strength)
            val x = size.width * (0.25f + normalized * 0.5f)
            drawLine(
                color = MonitorSignal,
                start = Offset(x, center.y - height / 2f),
                end = Offset(x, center.y + height / 2f),
                strokeWidth = barWidth,
                cap = StrokeCap.Round,
            )
        }
    }
}

@Composable
private fun TranscriptPreview(messages: List<ConversationMessage>) {
    val last = messages.lastOrNull { it.role != MessageRole.SYSTEM } ?: return
    Surface(
        color = MonitorSurface.copy(alpha = 0.82f),
        shape = RoundedCornerShape(18.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, MonitorOutline),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(
                text = if (last.role == MessageRole.USER) "你" else "MINICPM-O",
                style = MaterialTheme.typography.labelMedium,
                color = if (last.role == MessageRole.USER) MonitorMuted else MonitorSignal,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = last.text,
                style = MaterialTheme.typography.bodyLarge,
                color = MonitorPaper,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun VideoDuplexScreen(
    state: AppUiState,
    cameraPermissionGranted: Boolean,
    onStart: () -> Unit,
    onStop: () -> Unit,
    onTogglePause: () -> Unit,
    onToggleMic: () -> Unit,
    onToggleForceListen: () -> Unit,
    onFrame: (String) -> Unit,
    onCameraError: (String) -> Unit,
) {
    var lensFacing by rememberSaveable { mutableIntStateOf(CameraSelector.LENS_FACING_FRONT) }

    Column(Modifier.fillMaxSize()) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .clip(RoundedCornerShape(28.dp))
                .background(MonitorSurface)
                .border(1.dp, MonitorOutline, RoundedCornerShape(28.dp)),
        ) {
            if (cameraPermissionGranted) {
                NativeCameraPreview(
                    lensFacing = lensFacing,
                    onFrame = onFrame,
                    onError = onCameraError,
                    modifier = Modifier.fillMaxSize(),
                )
            } else {
                Column(
                    modifier = Modifier.align(Alignment.Center),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Icon(
                        Icons.Rounded.CameraAlt,
                        contentDescription = null,
                        tint = MonitorSignal,
                        modifier = Modifier.size(48.dp),
                    )
                    Spacer(Modifier.height(12.dp))
                    Text("开始时将申请摄像头权限", color = MonitorMuted)
                }
            }

            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            listOf(
                                MonitorInk.copy(alpha = 0.68f),
                                Color.Transparent,
                                MonitorInk.copy(alpha = 0.88f),
                            ),
                        ),
                    ),
            )
            StatusPill(
                state = state,
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(16.dp),
            )
            IconButton(
                onClick = {
                    lensFacing = if (lensFacing == CameraSelector.LENS_FACING_FRONT) {
                        CameraSelector.LENS_FACING_BACK
                    } else {
                        CameraSelector.LENS_FACING_FRONT
                    }
                },
                enabled = cameraPermissionGranted,
                colors = IconButtonDefaults.iconButtonColors(
                    containerColor = MonitorInk.copy(alpha = 0.66f),
                    contentColor = MonitorPaper,
                ),
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(12.dp)
                    .size(48.dp)
                    .border(1.dp, MonitorOutline, RoundedCornerShape(16.dp)),
            ) {
                Icon(Icons.Rounded.Cameraswitch, contentDescription = "切换摄像头")
            }
            Column(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(16.dp),
            ) {
                TranscriptPreview(state.messages)
            }
        }
        Spacer(Modifier.height(12.dp))
        DuplexControls(
            state = state,
            onStart = onStart,
            onStop = onStop,
            onTogglePause = onTogglePause,
            onToggleMic = onToggleMic,
            onToggleForceListen = onToggleForceListen,
        )
    }
}

@Composable
private fun StatusPill(state: AppUiState, modifier: Modifier = Modifier) {
    Surface(
        color = MonitorInk.copy(alpha = 0.76f),
        shape = CircleShape,
        border = androidx.compose.foundation.BorderStroke(1.dp, statusColor(state.phase).copy(alpha = 0.55f)),
        modifier = modifier.semantics { liveRegion = LiveRegionMode.Polite },
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 13.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(7.dp)
                    .background(statusColor(state.phase), CircleShape),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = state.statusText.uppercase(Locale.getDefault()),
                style = MaterialTheme.typography.labelMedium,
                color = statusColor(state.phase),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DuplexControls(
    state: AppUiState,
    onStart: () -> Unit,
    onStop: () -> Unit,
    onTogglePause: () -> Unit,
    onToggleMic: () -> Unit,
    onToggleForceListen: () -> Unit,
) {
    Surface(
        color = MonitorSurface,
        shape = RoundedCornerShape(24.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, MonitorOutline),
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 8.dp),
    ) {
        Column(Modifier.padding(12.dp)) {
            if (!state.hasActiveSession) {
                Button(
                    onClick = onStart,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 54.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MonitorSignal,
                        contentColor = MonitorInk,
                    ),
                    shape = RoundedCornerShape(16.dp),
                ) {
                    Icon(Icons.Rounded.PlayArrow, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("开始${state.selectedMode.label}会话")
                }
            } else {
                FlowRow(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    RoundControl(
                        icon = if (state.micEnabled) Icons.Rounded.Mic else Icons.Rounded.MicOff,
                        label = if (state.micEnabled) "静音" else "取消静音",
                        active = !state.micEnabled,
                        onClick = onToggleMic,
                    )
                    RoundControl(
                        icon = if (state.phase == SessionPhase.PAUSED) Icons.Rounded.PlayArrow else Icons.Rounded.Pause,
                        label = if (state.phase == SessionPhase.PAUSED) "继续" else "暂停",
                        active = state.phase == SessionPhase.PAUSED,
                        enabled = state.phase in setOf(SessionPhase.LIVE, SessionPhase.PAUSED),
                        onClick = onTogglePause,
                    )
                    RoundControl(
                        icon = Icons.Rounded.Hearing,
                        label = "只听",
                        active = state.forceListen,
                        enabled = state.phase in setOf(SessionPhase.LIVE, SessionPhase.PAUSED),
                        onClick = onToggleForceListen,
                    )
                    RoundControl(
                        icon = Icons.Rounded.Stop,
                        label = if (state.phase in setOf(SessionPhase.CONNECTING, SessionPhase.QUEUED, SessionPhase.PREPARING)) {
                            "取消"
                        } else {
                            "结束"
                        },
                        danger = true,
                        onClick = onStop,
                    )
                }
            }
            if (state.lastLatencyMs != null || state.lastKvCacheLength != null) {
                Spacer(Modifier.height(10.dp))
                Text(
                    text = buildString {
                        state.lastLatencyMs?.let { append("LATENCY ${it}MS") }
                        if (state.lastLatencyMs != null && state.lastKvCacheLength != null) append("  ·  ")
                        state.lastKvCacheLength?.let { append("KV $it") }
                    },
                    style = MaterialTheme.typography.labelMedium,
                    color = MonitorMuted,
                    modifier = Modifier.align(Alignment.CenterHorizontally),
                )
            }
        }
    }
}

@Composable
private fun RoundControl(
    icon: ImageVector,
    label: String,
    active: Boolean = false,
    danger: Boolean = false,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        FilledIconButton(
            onClick = onClick,
            enabled = enabled,
            colors = IconButtonDefaults.filledIconButtonColors(
                containerColor = when {
                    danger -> MonitorDanger.copy(alpha = 0.16f)
                    active -> MonitorSignal
                    else -> MonitorSurfaceRaised
                },
                contentColor = when {
                    danger -> MonitorDanger
                    active -> MonitorInk
                    else -> MonitorPaper
                },
                disabledContainerColor = MonitorSurfaceRaised.copy(alpha = 0.45f),
                disabledContentColor = MonitorMuted.copy(alpha = 0.45f),
            ),
            modifier = Modifier.size(52.dp),
        ) {
            Icon(icon, contentDescription = label)
        }
        Spacer(Modifier.height(4.dp))
        Text(label, style = MaterialTheme.typography.labelMedium, color = MonitorMuted)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsSheet(
    initial: SessionSettings,
    onDismiss: () -> Unit,
    onSave: (SessionSettings) -> String?,
) {
    var draft by remember(initial) { mutableStateOf(initial) }
    var error by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MonitorSurface,
        contentColor = MonitorPaper,
        dragHandle = null,
    ) {
        LazyColumn(
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("会话设置", style = MaterialTheme.typography.headlineMedium)
                        Text(
                            "Realtime API 连接与生成参数",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MonitorMuted,
                        )
                    }
                    IconButton(onClick = onDismiss, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Rounded.Close, contentDescription = "关闭设置")
                    }
                }
            }
            item {
                OutlinedTextField(
                    value = draft.apiHost,
                    onValueChange = { draft = draft.copy(apiHost = it) },
                    label = { Text("API Host") },
                    supportingText = { Text("仅接受 HTTPS / WSS 地址") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                OutlinedTextField(
                    value = draft.systemPrompt,
                    onValueChange = { draft = draft.copy(systemPrompt = it) },
                    label = { Text("系统提示词") },
                    minLines = 3,
                    maxLines = 6,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                Column {
                    Row(Modifier.fillMaxWidth()) {
                        Text("长度惩罚", style = MaterialTheme.typography.titleMedium)
                        Spacer(Modifier.weight(1f))
                        Text(
                            String.format(Locale.US, "%.1f", draft.lengthPenalty),
                            style = MaterialTheme.typography.labelMedium,
                            color = MonitorSignal,
                        )
                    }
                    Slider(
                        value = draft.lengthPenalty,
                        onValueChange = { draft = draft.copy(lengthPenalty = it) },
                        valueRange = 0.5f..2f,
                        steps = 14,
                    )
                }
            }
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("文字对话语音回复", style = MaterialTheme.typography.titleMedium)
                        Text(
                            "播放服务端返回的 24 kHz 流式音频",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MonitorMuted,
                        )
                    }
                    Switch(
                        checked = draft.chatTtsEnabled,
                        onCheckedChange = { draft = draft.copy(chatTtsEnabled = it) },
                    )
                }
            }
            item { HorizontalDivider(color = MonitorOutline) }
            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = MonitorSurfaceRaised),
                    shape = RoundedCornerShape(18.dp),
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Rounded.CheckCircle, contentDescription = null, tint = MonitorSignal)
                        Spacer(Modifier.width(12.dp))
                        Text(
                            "官方公网服务当前无需 API Key。应用不会写入或上传额外凭据。",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MonitorMuted,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
            error?.let { message ->
                item {
                    Text(
                        text = message,
                        color = MonitorDanger,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    TextButton(
                        onClick = {
                            context.startActivity(
                                Intent(
                                    Intent.ACTION_VIEW,
                                    "https://minicpmo45.modelbest.cn/docs/zh/realtime-api/overview/".toUri(),
                                ),
                            )
                        },
                        modifier = Modifier.heightIn(min = 52.dp),
                    ) {
                        Text("API 文档")
                        Spacer(Modifier.width(6.dp))
                        Icon(
                            Icons.AutoMirrored.Rounded.OpenInNew,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                    Button(
                        onClick = {
                            error = onSave(draft)
                        },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MonitorSignal,
                            contentColor = MonitorInk,
                        ),
                        shape = RoundedCornerShape(16.dp),
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 52.dp),
                    ) {
                        Text("保存设置")
                    }
                }
            }
        }
    }
}

private val MODE_DISPLAY_ORDER = listOf(
    RealtimeMode.AUDIO,
    RealtimeMode.VIDEO,
    RealtimeMode.CHAT,
)

private fun preferredMode(allowedModes: Set<RealtimeMode>): RealtimeMode? = when {
    RealtimeMode.AUDIO in allowedModes -> RealtimeMode.AUDIO
    RealtimeMode.VIDEO in allowedModes -> RealtimeMode.VIDEO
    RealtimeMode.CHAT in allowedModes -> RealtimeMode.CHAT
    else -> null
}

private fun statusColor(phase: SessionPhase): Color = when (phase) {
    SessionPhase.LIVE -> MonitorSignal
    SessionPhase.CONNECTING, SessionPhase.QUEUED, SessionPhase.PREPARING -> Color(0xFFFFCB69)
    SessionPhase.ERROR -> MonitorDanger
    SessionPhase.PAUSED, SessionPhase.IDLE, SessionPhase.STOPPED -> MonitorMuted
}

private fun android.content.Context.hasPermission(permission: String): Boolean =
    ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
