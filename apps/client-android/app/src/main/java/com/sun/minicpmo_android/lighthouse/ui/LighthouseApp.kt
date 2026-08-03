package com.sun.minicpmo_android.lighthouse.ui

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.view.WindowManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.Login
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.rounded.CallEnd
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Devices
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.FamilyRestroom
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Key
import androidx.compose.material.icons.rounded.Lightbulb
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.QrCode2
import androidx.compose.material.icons.rounded.QrCodeScanner
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Security
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Videocam
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.sun.minicpmo_android.MainViewModel
import com.sun.minicpmo_android.lighthouse.LighthouseViewModel
import com.sun.minicpmo_android.lighthouse.call.CompanionMediaHandoffState
import com.sun.minicpmo_android.lighthouse.call.CompanionMediaStopReason
import com.sun.minicpmo_android.lighthouse.camera.QrCodeImage
import com.sun.minicpmo_android.lighthouse.camera.QrScannerView
import com.sun.minicpmo_android.lighthouse.model.ActivationPresentation
import com.sun.minicpmo_android.lighthouse.model.ActivationApprovalDetails
import com.sun.minicpmo_android.lighthouse.model.AppRole
import com.sun.minicpmo_android.lighthouse.model.CompanionBindingView
import com.sun.minicpmo_android.lighthouse.model.LighthouseUiState
import com.sun.minicpmo_android.lighthouse.model.RemoteSessionView
import com.sun.minicpmo_android.lighthouse.realtime.LiveCallPhase
import com.sun.minicpmo_android.lighthouse.realtime.LiveCallState
import com.sun.minicpmo_android.lighthouse.realtime.presentFamilyCall
import com.sun.minicpmo_android.ui.MiniCpmRoute
import com.sun.minicpmo_android.model.RealtimeMode
import com.sun.minicpmo_android.ui.theme.MinicpmoAndroidTheme
import kotlinx.coroutines.launch
import livekit.org.webrtc.SurfaceViewRenderer
import java.util.Locale

@Composable
fun LighthouseRoute(
    viewModel: LighthouseViewModel,
    miniCpmViewModel: MainViewModel,
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val callState by viewModel.callState.collectAsStateWithLifecycle()
    val mediaHandoffState by viewModel.companionMediaHandoffState.collectAsState()
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var pendingPermissionAction by remember { mutableStateOf<(() -> Unit)?>(null) }
    val remoteHandoffInProgress = mediaHandoffState !is CompanionMediaHandoffState.Idle
    val familyActions = remember(viewModel) {
        FamilyUiActions(
            requestEmailVerification = viewModel::requestEmailVerification,
            confirmEmailVerification = viewModel::confirmEmailVerification,
            dismissEmailVerificationPrompt = viewModel::dismissEmailVerificationPrompt,
            selectHousehold = viewModel::selectHousehold,
            selectRecipient = viewModel::selectRecipient,
            createHousehold = viewModel::createHousehold,
            createRecipient = viewModel::createRecipient,
            createActivation = viewModel::createActivation,
            loadActivationApprovalDetails = viewModel::loadActivationApprovalDetails,
            approveActivation = viewModel::approveActivation,
            requestCall = viewModel::requestRemoteCall,
            createMemory = viewModel::createMemory,
            updateMemory = viewModel::updateMemory,
            deleteMemory = viewModel::deleteMemory,
            createRoutine = viewModel::createRoutine,
            updateRoutine = viewModel::updateRoutine,
            deleteRoutine = viewModel::deleteRoutine,
            verifyOccurrence = viewModel::verifyOccurrence,
            claimFamilyTask = viewModel::claimFamilyTask,
            finishFamilyTask = viewModel::finishFamilyTask,
            decideConsent = viewModel::decideConsent,
            loadCareAuthorities = viewModel::loadCareAuthorities,
            updateHouseholdMember = viewModel::updateHouseholdMember,
            removeHouseholdMember = viewModel::removeHouseholdMember,
            putCareAuthority = viewModel::putCareAuthority,
            revokeBinding = viewModel::revokeBinding,
        )
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { result ->
        if (result.values.all { it }) {
            pendingPermissionAction?.invoke()
        } else {
            scope.launch { snackbar.showSnackbar("需要相应权限才能执行此操作；应用不会静默开启摄像头或麦克风") }
        }
        pendingPermissionAction = null
    }

    fun withPermissions(permissions: List<String>, action: () -> Unit) {
        val missing = permissions.distinct().filterNot(context::hasPermission)
        if (missing.isEmpty()) action()
        else {
            pendingPermissionAction = action
            permissionLauncher.launch(missing.toTypedArray())
        }
    }

    DisposableEffect(viewModel) {
        viewModel.attachLocalCompanionStopConsumer()
        onDispose { viewModel.detachLocalCompanionStopConsumer() }
    }

    LaunchedEffect(mediaHandoffState) {
        val stopping = mediaHandoffState as? CompanionMediaHandoffState.StoppingLocalCompanion
            ?: return@LaunchedEffect
        viewModel.closeAiCompanion()
        when (stopping.reason) {
            CompanionMediaStopReason.REMOTE_ANSWER -> miniCpmViewModel.stopForRemoteCall(
                onStopped = { viewModel.completeLocalCompanionStop(stopping.requestId) },
                onFailure = { error ->
                    viewModel.failLocalCompanionStop(stopping.requestId, error)
                },
            )
            CompanionMediaStopReason.SERVER_DIRECTIVE ->
                miniCpmViewModel.stopForServerDirective {
                    viewModel.completeLocalCompanionStop(stopping.requestId)
                }
        }
    }

    LaunchedEffect(state.role, state.deviceActivated) {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            state.role == AppRole.COMPANION &&
            state.deviceActivated &&
            !context.hasPermission(Manifest.permission.POST_NOTIFICATIONS)
        ) {
            permissionLauncher.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
        }
    }

    LaunchedEffect(
        state.pendingSystemAnswerSessionId,
        state.incomingRemoteSession?.id,
    ) {
        val sessionId = state.pendingSystemAnswerSessionId ?: return@LaunchedEffect
        val incoming = state.incomingRemoteSession?.takeIf { it.id == sessionId }
            ?: return@LaunchedEffect
        val permissions = buildList {
            if (incoming.media.receiveDeviceAudio) add(Manifest.permission.RECORD_AUDIO)
            if (incoming.media.receiveDeviceVideo) add(Manifest.permission.CAMERA)
        }
        withPermissions(permissions) {
            viewModel.acceptIncomingCall(sessionId)
            viewModel.consumeSystemAnswerIntent()
        }
    }

    LaunchedEffect(state.message, state.error) {
        (state.error ?: state.message)?.let {
            snackbar.showSnackbar(it)
            viewModel.clearNotice()
        }
    }

    DisposableEffect(callState.phase) {
        val activity = context as? Activity
        if (callState.phase in setOf(LiveCallPhase.CONNECTING, LiveCallPhase.CONNECTED)) {
            activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
        onDispose { activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
    }

    if (state.aiScreenVisible) {
        MinicpmoAndroidTheme {
            val incoming = state.incomingRemoteSession

            Box(Modifier.fillMaxSize()) {
                if (remoteHandoffInProgress) {
                    LoadingScreen("正在安全切换到家属通话")
                } else {
                    MiniCpmRoute(
                        miniCpmViewModel,
                        onExit = viewModel::closeAiCompanion,
                        allowedModes = setOf(RealtimeMode.AUDIO, RealtimeMode.VIDEO),
                    )
                }

                incoming?.let {
                    IncomingCallDialog(
                        onAccept = {
                            val permissions = buildList {
                                if (incoming.media.receiveDeviceAudio) {
                                    add(Manifest.permission.RECORD_AUDIO)
                                }
                                if (incoming.media.receiveDeviceVideo) {
                                    add(Manifest.permission.CAMERA)
                                }
                            }
                            withPermissions(permissions) {
                                viewModel.acceptIncomingCall()
                            }
                        },
                        onDecline = viewModel::declineIncomingCall,
                        acceptEnabled = !remoteHandoffInProgress,
                        declineEnabled = !remoteHandoffInProgress,
                        accepting = remoteHandoffInProgress,
                    )
                }

                SnackbarHost(
                    hostState = snackbar,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(16.dp),
                )
            }
        }
        return
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .imePadding(),
        ) {
            when {
                state.restoring -> LoadingScreen("正在安全恢复会话")
                !state.signedIn && !state.companionDeviceLocked -> AuthScreen(
                    busy = state.busy,
                    apiBaseUrl = state.apiBaseUrl,
                    onLogin = viewModel::login,
                    onRegister = viewModel::register,
                    onSaveApiBase = viewModel::saveApiBaseUrl,
                    onReturnToCompanion = if (state.deviceActivated) {
                        { viewModel.returnToCompanionDevice() }
                    } else {
                        null
                    },
                )
                state.qrScannerVisible -> QrScannerScreen(
                    cameraGranted = context.hasPermission(Manifest.permission.CAMERA),
                    onRequestCamera = {
                        withPermissions(listOf(Manifest.permission.CAMERA)) {
                            viewModel.showQrScanner(true)
                        }
                    },
                    onResult = viewModel::handleActivationQr,
                    onClose = { viewModel.showQrScanner(false) },
                    onError = { scope.launch { snackbar.showSnackbar(it) } },
                )
                else -> SignedInShell(
                    state = state,
                    callState = callState,
                    onSwitchRole = viewModel::switchRole,
                    onLogout = viewModel::logout,
                    onRequireFamilyAuthentication = viewModel::requireFamilyAuthentication,
                    onRefresh = viewModel::refresh,
                    familyActions = familyActions,
                    onCancelCall = viewModel::cancelRemoteRequest,
                    onConnectFamilyCall = {
                        withPermissions(listOf(Manifest.permission.RECORD_AUDIO)) {
                            viewModel.connectFamilyCall()
                        }
                    },
                    onClaimDynamic = viewModel::claimDynamicCode,
                    onOpenScanner = {
                        withPermissions(listOf(Manifest.permission.CAMERA)) {
                            viewModel.showQrScanner(true)
                        }
                    },
                    onOpenAi = viewModel::openAiCompanion,
                    onAcceptCall = {
                        val media = state.incomingRemoteSession?.media
                        val permissions = buildList {
                            if (media?.receiveDeviceAudio != false) add(Manifest.permission.RECORD_AUDIO)
                            if (media?.receiveDeviceVideo != false) add(Manifest.permission.CAMERA)
                        }
                        withPermissions(permissions) { viewModel.acceptIncomingCall() }
                    },
                    onDeclineCall = viewModel::declineIncomingCall,
                    onDismissRemoteCallFailure = viewModel::dismissRemoteCallFailure,
                    onConnectDeviceCall = {
                        val media = state.activeRemoteSession?.media
                        val permissions = buildList {
                            if (media?.receiveDeviceAudio != false) add(Manifest.permission.RECORD_AUDIO)
                            if (media?.receiveDeviceVideo != false) add(Manifest.permission.CAMERA)
                        }
                        withPermissions(permissions) { viewModel.connectDeviceCall() }
                    },
                    onEndCall = viewModel::endRemoteCall,
                    onAttachRenderer = viewModel::attachVideoRenderer,
                    onDetachRenderer = viewModel::detachVideoRenderer,
                )
            }

            if (state.busy && (state.signedIn || state.companionDeviceLocked)) {
                Surface(
                    color = MaterialTheme.colorScheme.scrim.copy(alpha = 0.48f),
                    modifier = Modifier
                        .fillMaxSize()
                        .pointerInput(Unit) {
                            awaitPointerEventScope {
                                while (true) {
                                    awaitPointerEvent(PointerEventPass.Initial)
                                        .changes
                                        .forEach { it.consume() }
                                }
                            }
                        },
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(modifier = Modifier.semantics {
                            liveRegion = LiveRegionMode.Polite
                        })
                    }
                }
            }
        }
    }
}

@Composable
private fun AuthScreen(
    busy: Boolean,
    apiBaseUrl: String,
    onLogin: (String, String) -> Unit,
    onRegister: (String?, String?, String, String) -> Unit,
    onSaveApiBase: (String) -> Unit,
    onReturnToCompanion: (() -> Unit)?,
) {
    var registering by rememberSaveable { mutableStateOf(false) }
    var identifier by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var username by rememberSaveable { mutableStateOf("") }
    var displayName by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var passwordVisible by rememberSaveable { mutableStateOf(false) }
    var showServerSettings by rememberSaveable { mutableStateOf(false) }
    var serverDraft by remember(apiBaseUrl) { mutableStateOf(apiBaseUrl) }

    BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        val horizontal = if (maxWidth >= 720.dp) 48.dp else 20.dp
        Column(
            modifier = Modifier
                .width(maxWidth.coerceAtMost(520.dp))
                .verticalScroll(rememberScrollState())
                .padding(horizontal = horizontal, vertical = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primaryContainer,
                modifier = Modifier.size(72.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        Icons.Rounded.Lightbulb,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(40.dp),
                    )
                }
            }
            Spacer(Modifier.height(16.dp))
            Text(
                "守忆灯塔",
                style = MaterialTheme.typography.displaySmall,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                "让陪伴有温度，让家人更安心",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(28.dp))
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(
                    Modifier.padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        RoleButton(
                            selected = !registering,
                            label = "登录",
                            icon = Icons.AutoMirrored.Rounded.Login,
                            onClick = { registering = false },
                            modifier = Modifier.weight(1f),
                        )
                        RoleButton(
                            selected = registering,
                            label = "注册",
                            icon = Icons.Rounded.Person,
                            onClick = { registering = true },
                            modifier = Modifier.weight(1f),
                        )
                    }
                    if (registering) {
                        OutlinedTextField(
                            value = displayName,
                            onValueChange = { displayName = it },
                            label = { Text("显示名称") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        OutlinedTextField(
                            value = email,
                            onValueChange = { email = it },
                            label = { Text("邮箱") },
                            supportingText = { Text("必填；验证后才能管理家庭和激活设备") },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        OutlinedTextField(
                            value = username,
                            onValueChange = { username = it },
                            label = { Text("用户名（可选）") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    } else {
                        OutlinedTextField(
                            value = identifier,
                            onValueChange = { identifier = it },
                            label = { Text("邮箱或用户名") },
                            leadingIcon = { Icon(Icons.Rounded.Person, contentDescription = null) },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        label = { Text("密码") },
                        supportingText = if (registering) ({ Text("至少 10 个字符") }) else null,
                        leadingIcon = { Icon(Icons.Rounded.Lock, contentDescription = null) },
                        trailingIcon = {
                            IconButton(onClick = { passwordVisible = !passwordVisible }) {
                                Icon(
                                    if (passwordVisible) Icons.Rounded.VisibilityOff else Icons.Rounded.Visibility,
                                    contentDescription = if (passwordVisible) "隐藏密码" else "显示密码",
                                )
                            }
                        },
                        visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Button(
                        onClick = {
                            val passwordForRequest = password
                            password = ""
                            if (registering) {
                                onRegister(email, username, passwordForRequest, displayName)
                            } else {
                                onLogin(identifier, passwordForRequest)
                            }
                        },
                        enabled = !busy && password.isNotBlank() &&
                            if (registering) {
                                displayName.isNotBlank() && email.isNotBlank() && password.length >= 10
                            } else {
                                identifier.isNotBlank()
                            },
                        modifier = Modifier.fillMaxWidth().height(56.dp),
                    ) {
                        if (busy) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                        else Text(if (registering) "创建账号" else "安全登录")
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
            onReturnToCompanion?.let { onReturn ->
                OutlinedButton(
                    onClick = onReturn,
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                ) {
                    Icon(Icons.Rounded.Home, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("返回专用陪伴模式")
                }
                Spacer(Modifier.height(8.dp))
            }
            TextButton(
                onClick = { showServerSettings = !showServerSettings },
                modifier = Modifier.height(48.dp),
            ) {
                Icon(Icons.Rounded.Settings, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("开发服务器设置")
            }
            if (showServerSettings) {
                OutlinedCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        OutlinedTextField(
                            value = serverDraft,
                            onValueChange = { serverDraft = it },
                            label = { Text("API Base URL") },
                            supportingText = { Text("正式环境仅允许 HTTPS；Debug 可连接本机 HTTP") },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                            modifier = Modifier.fillMaxWidth(),
                        )
                        OutlinedButton(
                            onClick = { onSaveApiBase(serverDraft) },
                            modifier = Modifier.fillMaxWidth().height(52.dp),
                        ) { Text("保存服务器地址") }
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Security, contentDescription = null, tint = MaterialTheme.colorScheme.secondary)
                Spacer(Modifier.width(8.dp))
                Text(
                    "令牌由 Android Keystore 加密保存",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun SignedInShell(
    state: LighthouseUiState,
    callState: LiveCallState,
    onSwitchRole: (AppRole) -> Unit,
    onLogout: () -> Unit,
    onRequireFamilyAuthentication: () -> Unit,
    onRefresh: () -> Unit,
    familyActions: FamilyUiActions,
    onCancelCall: () -> Unit,
    onConnectFamilyCall: () -> Unit,
    onClaimDynamic: (String, String) -> Unit,
    onOpenScanner: () -> Unit,
    onOpenAi: () -> Unit,
    onAcceptCall: () -> Unit,
    onDeclineCall: () -> Unit,
    onDismissRemoteCallFailure: () -> Unit,
    onConnectDeviceCall: () -> Unit,
    onEndCall: () -> Unit,
    onAttachRenderer: (SurfaceViewRenderer) -> Unit,
    onDetachRenderer: (SurfaceViewRenderer) -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        AppHeader(
            state,
            onSwitchRole,
            onRefresh,
            onLogout,
            onRequireFamilyAuthentication,
        )
        HorizontalDivider()
        Box(Modifier.weight(1f)) {
            if (state.activeRemoteSession != null &&
                (state.activeRemoteSession.status != "RINGING" || state.role == AppRole.FAMILY)
            ) {
                RemoteCallScreen(
                    role = state.role,
                    session = state.activeRemoteSession,
                    callState = callState,
                    familyFailureLatched = state.remoteCallFailureSessionId ==
                        state.activeRemoteSession.id,
                    onConnect = if (state.role == AppRole.FAMILY) onConnectFamilyCall else onConnectDeviceCall,
                    onCancel = onCancelCall,
                    onEnd = onEndCall,
                    onAttachRenderer = onAttachRenderer,
                    onDetachRenderer = onDetachRenderer,
                )
            } else if (state.role == AppRole.FAMILY) {
                FamilyScreen(
                    state,
                    familyActions,
                )
            } else {
                CompanionScreen(
                    state,
                    onClaimDynamic,
                    onOpenScanner,
                    onOpenAi,
                    onAcceptCall,
                    onDeclineCall,
                    onDismissRemoteCallFailure,
                )
            }
        }
    }
}

@Composable
private fun AppHeader(
    state: LighthouseUiState,
    onSwitchRole: (AppRole) -> Unit,
    onRefresh: () -> Unit,
    onLogout: () -> Unit,
    onRequireFamilyAuthentication: () -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer, modifier = Modifier.size(48.dp)) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.Lightbulb, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                }
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text("守忆灯塔", style = MaterialTheme.typography.titleLarge)
                Text(
                    if (state.companionDeviceLocked) {
                        "${state.companionContext?.recipientName ?: "长者"}的专用陪伴设备"
                    } else {
                        state.user?.displayName.orEmpty()
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            IconButton(onClick = onRefresh, modifier = Modifier.size(48.dp)) {
                Icon(Icons.Rounded.Refresh, contentDescription = "刷新数据")
            }
            if (state.companionDeviceLocked) {
                IconButton(
                    onClick = onRequireFamilyAuthentication,
                    enabled = state.activeRemoteSession == null,
                    modifier = Modifier.size(48.dp),
                ) {
                    Icon(Icons.Rounded.Person, contentDescription = "家属管理（需要重新登录）")
                }
            } else {
                IconButton(onClick = onLogout, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.AutoMirrored.Rounded.Logout, contentDescription = "退出登录")
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        if (state.companionDeviceLocked) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(Icons.Rounded.Lock, contentDescription = null, Modifier.size(18.dp))
                Text(
                    "设备身份已锁定；家属端令牌不保留",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            return@Column
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            RoleButton(
                selected = state.role == AppRole.FAMILY,
                label = "家属端",
                icon = Icons.Rounded.FamilyRestroom,
                onClick = { onSwitchRole(AppRole.FAMILY) },
                enabled = state.activeRemoteSession == null,
                modifier = Modifier.weight(1f),
            )
            RoleButton(
                selected = state.role == AppRole.COMPANION,
                label = "陪伴端",
                icon = Icons.Rounded.Home,
                onClick = { onSwitchRole(AppRole.COMPANION) },
                enabled = state.activeRemoteSession == null,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun FamilyScreen(
    state: LighthouseUiState,
    actions: FamilyUiActions,
) {
    var dismissedActivationId by rememberSaveable { mutableStateOf<String?>(null) }
    var showEmailDialog by rememberSaveable { mutableStateOf(false) }
    var verificationEmail by rememberSaveable(state.user?.email) {
        mutableStateOf(state.user?.email.orEmpty())
    }
    var verificationCode by remember(state.emailVerificationPromptVisible, showEmailDialog) {
        mutableStateOf("")
    }
    val emailVerificationDialogVisible =
        showEmailDialog || state.emailVerificationPromptVisible

    LaunchedEffect(state.user?.emailVerified) {
        if (state.user?.emailVerified == true) {
            verificationCode = ""
            showEmailDialog = false
        }
    }
    FamilyManagementContent(
        state = state,
        actions = actions,
        onRequestEmailVerification = {
            if (state.user?.email == null) showEmailDialog = true
            else actions.requestEmailVerification(null)
        },
    )

    state.activation?.takeIf { it.challengeId != dismissedActivationId }?.let { activation ->
        ActivationDialog(
            activation = activation,
            approvalDetails = state.activationApprovalDetails
                ?.takeIf { it.challengeId == activation.challengeId },
            pendingChallengeId = state.pendingDeviceActivation?.challengeId,
            onLoadApprovalDetails = actions.loadActivationApprovalDetails,
            onApprove = actions.approveActivation,
            onDismiss = { dismissedActivationId = activation.challengeId },
        )
    }

    if (emailVerificationDialogVisible) {
        AlertDialog(
            onDismissRequest = {
                verificationCode = ""
                showEmailDialog = false
                actions.dismissEmailVerificationPrompt()
            },
            icon = { Icon(Icons.Rounded.Security, contentDescription = null) },
            title = { Text("输入邮箱验证码") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        if (state.emailVerificationPromptVisible) {
                            "请输入发送到该邮箱的 6 位验证码。"
                        } else {
                            "先发送验证码，再输入邮件中的 6 位数字。"
                        },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    OutlinedTextField(
                        value = verificationEmail,
                        onValueChange = { verificationEmail = it },
                        label = { Text("邮箱") },
                        enabled = state.user?.email == null,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = verificationCode,
                        onValueChange = { value ->
                            verificationCode = value.filter(Char::isDigit).take(6)
                        },
                        label = { Text("6 位验证码") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    TextButton(
                        onClick = { actions.requestEmailVerification(verificationEmail) },
                        enabled = !state.busy && verificationEmail.contains('@'),
                    ) {
                        Text(
                            if (state.emailVerificationPromptVisible) "重新发送验证码"
                            else "发送验证码",
                        )
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        val codeForRequest = verificationCode
                        verificationCode = ""
                        actions.confirmEmailVerification(verificationEmail, codeForRequest)
                    },
                    enabled = !state.busy &&
                        state.emailVerificationPromptVisible &&
                        verificationEmail.contains('@') &&
                        verificationCode.length == 6,
                ) { Text("确认验证码") }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        verificationCode = ""
                        showEmailDialog = false
                        actions.dismissEmailVerificationPrompt()
                    },
                ) { Text("稍后验证") }
            },
        )
    }
}

@Composable
private fun DeviceCallAction(binding: CompanionBindingView, onRequestCall: (String) -> Unit) {
    FilledTonalButton(
        onClick = { onRequestCall(binding.id) },
        enabled = binding.status == "ACTIVE",
        modifier = Modifier.fillMaxWidth().height(56.dp),
    ) {
        Icon(Icons.Rounded.Videocam, contentDescription = null)
        Spacer(Modifier.width(8.dp))
        Text("呼叫陪伴设备")
    }
    Text(
        "需要长者设备现场明确接听；通话不录制、不转写。",
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun CompanionScreen(
    state: LighthouseUiState,
    onClaimDynamic: (String, String) -> Unit,
    onOpenScanner: () -> Unit,
    onOpenAi: () -> Unit,
    onAcceptCall: () -> Unit,
    onDeclineCall: () -> Unit,
    onDismissRemoteCallFailure: () -> Unit,
) {
    if (!state.deviceActivated) {
        DeviceActivationScreen(state, onClaimDynamic, onOpenScanner)
        return
    }

    val context = state.companionContext
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        Spacer(Modifier.height(12.dp))
        Surface(
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primaryContainer,
            modifier = Modifier.size(104.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(Icons.Rounded.Lightbulb, contentDescription = null, modifier = Modifier.size(56.dp))
            }
        }
        Text(
            "${context?.recipientName ?: "您好"}，今天也陪着您",
            fontSize = 30.sp,
            lineHeight = 40.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
            modifier = Modifier.semantics { heading() },
        )
        Text(
            "MiniCPM-o ${context?.modelName.orEmpty()}",
            fontSize = 19.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        state.remoteCallFailure?.let { failure ->
            OutlinedCard(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.outlinedCardColors(
                    containerColor = MaterialTheme.colorScheme.errorContainer,
                ),
            ) {
                Column(
                    Modifier.padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(
                        state.remoteCallFailureTitle ?: "通话连接失败",
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        fontSize = 21.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        failure,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        fontSize = 18.sp,
                        lineHeight = 28.sp,
                    )
                    OutlinedButton(
                        onClick = onDismissRemoteCallFailure,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("我知道了")
                    }
                }
            }
        }
        Button(
            onClick = onOpenAi,
            modifier = Modifier.fillMaxWidth().height(76.dp),
            shape = RoundedCornerShape(24.dp),
        ) {
            Icon(Icons.Rounded.Call, contentDescription = null, modifier = Modifier.size(30.dp))
            Spacer(Modifier.width(12.dp))
            Text("开始陪伴对话", fontSize = 23.sp)
        }
        OutlinedCard(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("隐私提示", fontSize = 21.sp, fontWeight = FontWeight.Bold)
                Text(
                    "摄像头和麦克风只会在您点击开始或现场接听后开启。家属不能静默接入。",
                    fontSize = 18.sp,
                    lineHeight = 28.sp,
                )
            }
        }
    }

    state.incomingRemoteSession?.let {
        IncomingCallDialog(onAcceptCall, onDeclineCall)
    }
}

@Composable
private fun DeviceActivationScreen(
    state: LighthouseUiState,
    onClaimDynamic: (String, String) -> Unit,
    onOpenScanner: () -> Unit,
) {
    var publicId by rememberSaveable { mutableStateOf("") }
    var dynamicCode by rememberSaveable { mutableStateOf("") }

    LaunchedEffect(state.activation) {
        state.activation?.let {
            publicId = it.publicId
            dynamicCode = it.dynamicCode
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        SectionTitle("激活陪伴设备", Icons.Rounded.Key)
        Text(
            "本设备会使用独立 Ed25519 安装密钥认领；家属批准前不会获得长者数据。",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Button(onClick = onOpenScanner, modifier = Modifier.fillMaxWidth().height(60.dp)) {
            Icon(Icons.Rounded.QrCodeScanner, contentDescription = null)
            Spacer(Modifier.width(10.dp))
            Text("扫描家属端二维码", fontSize = 18.sp)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            HorizontalDivider(Modifier.weight(1f))
            Text("或输入动态码", Modifier.padding(horizontal = 12.dp))
            HorizontalDivider(Modifier.weight(1f))
        }
        OutlinedTextField(
            value = publicId,
            onValueChange = { publicId = it.uppercase(Locale.ROOT) },
            label = { Text("设备激活标识（如 ML-ABC234）") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = dynamicCode,
            onValueChange = { dynamicCode = it.uppercase(Locale.ROOT) },
            label = { Text("8 位动态激活码") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        FilledTonalButton(
            onClick = { onClaimDynamic(publicId, dynamicCode) },
            enabled = publicId.isNotBlank() && dynamicCode.length >= 8 && state.pendingDeviceActivation == null,
            modifier = Modifier.fillMaxWidth().height(56.dp),
        ) { Text("认领设备") }
        state.pendingDeviceActivation?.let { pending ->
            NoticeCard(
                title = "等待家属批准",
                body = "认领编号 ${pending.publicId}。请切换到家属端，在激活卡片中点击批准。",
            )
        }
    }
}

@Composable
private fun QrScannerScreen(
    cameraGranted: Boolean,
    onRequestCamera: () -> Unit,
    onResult: (String) -> Unit,
    onClose: () -> Unit,
    onError: (String) -> Unit,
) {
    BackHandler(onBack = onClose)
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.scrim)) {
        if (cameraGranted) {
            QrScannerView(onResult, onError, Modifier.fillMaxSize())
        } else {
            Button(onClick = onRequestCamera, modifier = Modifier.align(Alignment.Center).height(56.dp)) {
                Text("允许摄像头并扫描")
            }
        }
        Surface(
            color = MaterialTheme.colorScheme.surface.copy(alpha = 0.94f),
            shape = RoundedCornerShape(18.dp),
            modifier = Modifier.align(Alignment.TopCenter).padding(16.dp),
        ) {
            Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.QrCodeScanner, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("将二维码放入画面中央", Modifier.weight(1f))
                IconButton(onClick = onClose, Modifier.size(48.dp)) {
                    Icon(Icons.Rounded.Close, contentDescription = "关闭扫码")
                }
            }
        }
    }
}

@Composable
private fun RemoteCallScreen(
    role: AppRole,
    session: RemoteSessionView,
    callState: LiveCallState,
    familyFailureLatched: Boolean,
    onConnect: () -> Unit,
    onCancel: () -> Unit,
    onEnd: () -> Unit,
    onAttachRenderer: (SurfaceViewRenderer) -> Unit,
    onDetachRenderer: (SurfaceViewRenderer) -> Unit,
) {
    val familyPresentation = if (role == AppRole.FAMILY) {
        presentFamilyCall(
            sessionStatus = session.status,
            sessionId = session.id,
            mediaState = callState,
            failureLatched = familyFailureLatched,
        )
    } else {
        null
    }
    BackHandler { if (session.status == "RINGING") onCancel() else onEnd() }
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { if (session.status == "RINGING") onCancel() else onEnd() }, Modifier.size(48.dp)) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "退出通话")
            }
            Text(
                if (role == AppRole.FAMILY) "与陪伴设备通话" else "家属来电",
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.weight(1f),
            )
        }
        Surface(
            color = MaterialTheme.colorScheme.surfaceVariant,
            shape = RoundedCornerShape(28.dp),
            modifier = Modifier.fillMaxWidth().weight(1f),
        ) {
            if (
                role == AppRole.FAMILY &&
                (callState.remoteVideoAvailable || callState.phase == LiveCallPhase.CONNECTED)
            ) {
                LiveVideoRenderer(onAttachRenderer, onDetachRenderer)
            } else {
                Box(contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Rounded.Videocam, contentDescription = null, Modifier.size(64.dp))
                        Spacer(Modifier.height(12.dp))
                        Text(
                            when {
                                familyPresentation != null -> familyPresentation.title
                                session.status == "RINGING" -> "等待陪伴设备现场接听"
                                callState.phase == LiveCallPhase.CONNECTING -> "正在连接音视频"
                                else -> "对方已接听，可以进入通话"
                            },
                            textAlign = TextAlign.Center,
                            fontSize = 20.sp,
                        )
                    }
                }
            }
        }
        NoticeCard(
            title = "隐私保护已开启",
            body = "本次通话不录音、不录像、不转写。摄像头和麦克风状态会明确显示。",
        )
        if (familyPresentation?.mediaFailed == true) {
            OutlinedCard(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.outlinedCardColors(
                    containerColor = MaterialTheme.colorScheme.errorContainer,
                ),
            ) {
                Column(
                    Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        familyPresentation.title,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        familyPresentation.message,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                    )
                }
            }
        }
        if (callState.phase == LiveCallPhase.CONNECTED) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
            ) {
                CallStatusPill(
                    label = if (callState.microphonePublished) "麦克风已开启" else "麦克风未发布",
                    icon = Icons.Rounded.Security,
                )
                CallStatusPill(
                    label = if (callState.cameraPublished) "摄像头已开启" else "摄像头未发布",
                    icon = Icons.Rounded.Videocam,
                )
            }
        }
        if (session.status == "RINGING") {
            OutlinedButton(onClick = onCancel, modifier = Modifier.fillMaxWidth().height(60.dp)) {
                Text("取消呼叫", fontSize = 18.sp)
            }
        } else if (
            familyPresentation?.canConnect == true ||
            (role != AppRole.FAMILY &&
                callState.phase !in setOf(LiveCallPhase.CONNECTING, LiveCallPhase.CONNECTED))
        ) {
            Button(onClick = onConnect, modifier = Modifier.fillMaxWidth().height(64.dp)) {
                Icon(Icons.Rounded.Call, contentDescription = null)
                Spacer(Modifier.width(10.dp))
                Text("进入通话", fontSize = 20.sp)
            }
        } else {
            Button(
                onClick = onEnd,
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                modifier = Modifier.fillMaxWidth().height(64.dp),
            ) {
                Icon(Icons.Rounded.CallEnd, contentDescription = null)
                Spacer(Modifier.width(10.dp))
                Text("挂断", fontSize = 20.sp)
            }
        }
    }
}

@Composable
private fun CallStatusPill(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
) {
    Surface(
        color = MaterialTheme.colorScheme.secondaryContainer,
        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
        shape = RoundedCornerShape(24.dp),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(icon, contentDescription = null, Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text(label, style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
private fun LiveVideoRenderer(
    onAttach: (SurfaceViewRenderer) -> Unit,
    onDetach: (SurfaceViewRenderer) -> Unit,
) {
    val context = LocalContext.current
    val renderer = remember { SurfaceViewRenderer(context) }
    DisposableEffect(renderer) {
        onAttach(renderer)
        onDispose { onDetach(renderer) }
    }
    AndroidView(factory = { renderer }, modifier = Modifier.fillMaxSize())
}

@Composable
private fun IncomingCallDialog(
    onAccept: () -> Unit,
    onDecline: () -> Unit,
    acceptEnabled: Boolean = true,
    declineEnabled: Boolean = true,
    accepting: Boolean = false,
) {
    AlertDialog(
        onDismissRequest = {},
        icon = { Icon(Icons.Rounded.Call, contentDescription = null, Modifier.size(52.dp)) },
        title = { Text("家属正在呼叫", fontSize = 28.sp, textAlign = TextAlign.Center) },
        text = {
            Text(
                "是否现场接听？只有您点击接听后，摄像头和麦克风才会开启。",
                fontSize = 20.sp,
                lineHeight = 30.sp,
                textAlign = TextAlign.Center,
            )
        },
        confirmButton = {
            Button(
                onClick = onAccept,
                enabled = acceptEnabled,
                modifier = Modifier.height(60.dp),
            ) {
                if (accepting) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        strokeWidth = 3.dp,
                    )
                } else {
                    Icon(Icons.Rounded.Call, contentDescription = null)
                }
                Spacer(Modifier.width(8.dp))
                Text(if (accepting) "正在切换" else "接听", fontSize = 20.sp)
            }
        },
        dismissButton = {
            OutlinedButton(
                onClick = onDecline,
                enabled = declineEnabled,
                modifier = Modifier.height(60.dp),
            ) {
                Icon(Icons.Rounded.CallEnd, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("拒绝", fontSize = 20.sp)
            }
        },
    )
}

@Composable
private fun ActivationDialog(
    activation: ActivationPresentation,
    approvalDetails: ActivationApprovalDetails?,
    pendingChallengeId: String?,
    onLoadApprovalDetails: (String) -> Unit,
    onApprove: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.Rounded.QrCode2, contentDescription = null) },
        title = { Text("设备激活凭据") },
        text = {
            Column(
                Modifier.verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                QrCodeImage(
                    activation.qrPayload,
                    contentDescription = "设备激活二维码",
                    modifier = Modifier.size(220.dp).border(1.dp, MaterialTheme.colorScheme.outline),
                )
                Text("激活标识", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(activation.publicId, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                Text("动态激活码", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(activation.dynamicCode, fontSize = 30.sp, fontWeight = FontWeight.Bold)
                Text(
                    "先让陪伴设备扫描或输入动态码，再由家属点击批准。二维码和动态码均为短时一次性凭据。",
                    textAlign = TextAlign.Center,
                )
                if (approvalDetails == null) {
                    Text(
                        "设备认领后，请先读取并核对型号、系统版本、认领时间和脱敏网络来源。",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                    OutlinedButton(
                        onClick = { onLoadApprovalDetails(activation.challengeId) },
                        modifier = Modifier.height(52.dp),
                    ) { Text("读取待批准设备信息") }
                } else {
                    val deviceName = listOfNotNull(
                        approvalDetails.device.manufacturer,
                        approvalDetails.device.model,
                    ).joinToString(" ").ifBlank { "未报告型号" }
                    HorizontalDivider()
                    Text("待批准设备", fontWeight = FontWeight.Bold)
                    Text(deviceName)
                    Text("${approvalDetails.device.platform} / ${approvalDetails.device.osVersion ?: "系统版本未知"}")
                    Text("App ${approvalDetails.device.appVersion ?: "版本未知"}")
                    Text("密钥算法：${approvalDetails.device.installationKeyAlgorithm}")
                    Text("认领时间：${approvalDetails.claimedAt}")
                    Text("网络来源：${approvalNetworkLabel(approvalDetails.claimNetworkSource)}")
                    Text("安装密钥尾号：…${approvalDetails.device.keyFingerprintSuffix}")
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onApprove(activation.challengeId) },
                enabled = approvalDetails != null &&
                    (pendingChallengeId == null || pendingChallengeId == activation.challengeId),
                modifier = Modifier.height(52.dp),
            ) { Text(if (approvalDetails == null) "请先核对设备信息" else "确认上述信息并批准") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, modifier = Modifier.height(52.dp)) { Text("稍后处理") }
        },
    )
}

private fun approvalNetworkLabel(source: String): String = when (source) {
    "LOCAL_NETWORK" -> "本地或家庭网络（地址已隐藏）"
    "LOOPBACK" -> "本机测试网络"
    "PUBLIC_IPV4" -> "公网 IPv4（地址已隐藏）"
    "PUBLIC_IPV6" -> "公网 IPv6（地址已隐藏）"
    else -> "网络来源未知"
}

@Composable
private fun SectionTitle(title: String, icon: androidx.compose.ui.graphics.vector.ImageVector) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.width(10.dp))
        Text(title, style = MaterialTheme.typography.headlineMedium, modifier = Modifier.semantics { heading() })
    }
}

@Composable
private fun NoticeCard(
    title: String,
    body: String,
    action: String? = null,
    onAction: (() -> Unit)? = null,
) {
    OutlinedCard(Modifier.fillMaxWidth()) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.Top) {
            Icon(Icons.Rounded.Security, contentDescription = null, tint = MaterialTheme.colorScheme.secondary)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(title, fontWeight = FontWeight.Bold)
                Text(body, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (action != null && onAction != null) {
                    TextButton(onClick = onAction, modifier = Modifier.height(48.dp)) { Text(action) }
                }
            }
        }
    }
}

@Composable
private fun EmptyCard(message: String) {
    OutlinedCard(Modifier.fillMaxWidth().padding(top = 8.dp)) {
        Row(Modifier.padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.ErrorOutline, contentDescription = null)
            Spacer(Modifier.width(12.dp))
            Text(message, Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun LoadingScreen(label: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator()
            Spacer(Modifier.height(16.dp))
            Text(label, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        }
    }
}

@Composable
private fun RoleButton(
    selected: Boolean,
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    if (selected) {
        Button(onClick = onClick, enabled = enabled, modifier = modifier.height(52.dp)) {
            Icon(icon, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(label)
        }
    } else {
        OutlinedButton(onClick = onClick, enabled = enabled, modifier = modifier.height(52.dp)) {
            Icon(icon, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(label)
        }
    }
}

private fun Context.hasPermission(permission: String): Boolean =
    ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
