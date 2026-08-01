package com.sun.minicpmo_android.lighthouse

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.core.net.toUri
import com.sun.minicpmo_android.lighthouse.data.ActivationProofType
import com.sun.minicpmo_android.lighthouse.data.LighthouseRepository
import com.sun.minicpmo_android.lighthouse.model.*
import com.sun.minicpmo_android.lighthouse.network.LighthouseApiException
import com.sun.minicpmo_android.lighthouse.realtime.CallSide
import com.sun.minicpmo_android.lighthouse.realtime.LiveKitCallController
import com.sun.minicpmo_android.lighthouse.realtime.LiveCallState
import com.sun.minicpmo_android.lighthouse.realtime.LiveCallPhase
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.temporal.ChronoUnit

class LighthouseViewModel(
    context: Context,
    private val repository: LighthouseRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(
        LighthouseUiState(apiBaseUrl = repository.apiBaseUrl()),
    )
    val uiState: StateFlow<LighthouseUiState> = _uiState.asStateFlow()

    private val callController = LiveKitCallController(context, viewModelScope)
    val callState: StateFlow<LiveCallState> = callController.state

    private var incomingPolling: Job? = null
    private var activationPolling: Job? = null
    private var remotePolling: Job? = null
    private var heartbeatJob: Job? = null
    private var deferredActivationPayload: String? = null

    init {
        restore()
    }

    fun login(identifier: String, password: String) = action {
        val user = repository.login(identifier, password)
        _uiState.value = _uiState.value.copy(signedIn = true, user = user)
        refreshFamilyData()
        restoreDeviceData()
        consumeDeferredActivation()
    }

    fun register(
        email: String?,
        username: String?,
        password: String,
        displayName: String,
    ) = action {
        require(!email.isNullOrBlank()) { "请填写邮箱，完成验证后才能管理家庭和设备" }
        val user = repository.register(email, username, password, displayName)
        _uiState.value = _uiState.value.copy(
            signedIn = true,
            user = user,
            message = "注册成功。创建家庭前请先完成邮箱验证。",
        )
        refreshFamilyData()
        restoreDeviceData()
        consumeDeferredActivation()
    }

    fun requestEmailVerification(emailInput: String? = null) = action {
        val email = emailInput?.trim()?.takeIf(String::isNotBlank)
            ?: _uiState.value.user?.email
            ?: error("请先填写用于验证的邮箱")
        repository.requestEmailVerification(email)
        _uiState.value = _uiState.value.copy(
            user = repository.getMe(),
            message = "验证邮件已发送，请在邮箱中完成验证",
        )
    }

    fun logout() = action {
        _uiState.value.activeRemoteSession?.let { session ->
            runCatching {
                if (_uiState.value.role == AppRole.COMPANION) {
                    repository.endDeviceRemoteSession(session.id)
                } else {
                    repository.endFamilyRemoteSession(session.householdId, session.id)
                }
            }
        }
        stopBackgroundJobs()
        callController.disconnect("signed_out")
        repository.logout()
        _uiState.value = LighthouseUiState(
            restoring = false,
            apiBaseUrl = repository.apiBaseUrl(),
        )
    }

    fun switchRole(role: AppRole) {
        if (role == _uiState.value.role) return
        _uiState.value = _uiState.value.copy(
            role = role,
            message = null,
            error = null,
            aiScreenVisible = false,
            qrScannerVisible = false,
        )
        if (role == AppRole.COMPANION && _uiState.value.deviceActivated) {
            startIncomingPolling()
        } else {
            incomingPolling?.cancel()
            incomingPolling = null
        }
    }

    fun selectHousehold(householdId: String) = action {
        _uiState.value = _uiState.value.copy(
            selectedHouseholdId = householdId,
            selectedRecipientId = null,
        ).withoutRecipientResources()
        loadHouseholdDetails(householdId)
    }

    fun selectRecipient(recipientId: String) = action {
        require(_uiState.value.recipients.any { it.id == recipientId }) { "陪伴对象不存在" }
        val householdId = _uiState.value.selectedHouseholdId ?: error("请先选择家庭")
        _uiState.value = _uiState.value.copy(selectedRecipientId = recipientId)
            .withoutRecipientResources()
        loadRecipientResources(householdId, recipientId)
    }

    fun createHousehold(name: String, timezone: String) = action {
        require(name.trim().isNotEmpty()) { "请填写家庭名称" }
        require(timezone.trim().isNotEmpty()) { "请填写家庭时区" }
        val created = repository.createHousehold(name, timezone)
        _uiState.value = _uiState.value.copy(
            households = _uiState.value.households + created,
            selectedHouseholdId = created.id,
            selectedRecipientId = null,
            recipients = emptyList(),
            bindings = emptyList(),
            message = "家庭已创建，请继续添加陪伴对象",
        ).withoutRecipientResources()
    }

    fun createRecipient(input: CareRecipientInput) = action {
        val householdId = _uiState.value.selectedHouseholdId ?: error("请先创建或选择家庭")
        require(input.name.trim().isNotEmpty()) { "请填写长者姓名" }
        require(input.timezone.trim().isNotEmpty()) { "请填写长者时区" }
        input.birthDate?.takeIf(String::isNotBlank)?.let(LocalDate::parse)
        val created = repository.createRecipient(householdId, input)
        _uiState.value = _uiState.value.copy(
            recipients = _uiState.value.recipients + created,
            selectedRecipientId = created.id,
            message = "已添加 ${created.preferredName}",
        ).withoutRecipientResources()
        loadRecipientResources(householdId, created.id)
    }

    fun createMemory(input: MemoryInput) = action {
        validateMemory(input)
        val (householdId, recipientId) = selectedWorkspace()
        val created = repository.createMemory(householdId, recipientId, input)
        _uiState.value = _uiState.value.copy(
            memories = listOf(created) + _uiState.value.memories,
            message = "记忆已保存",
        )
    }

    fun updateMemory(memory: MemoryView, input: MemoryInput) = action {
        validateMemory(input)
        val householdId = _uiState.value.selectedHouseholdId ?: error("请先选择家庭")
        val updated = repository.updateMemory(householdId, memory, input)
        _uiState.value = _uiState.value.copy(
            memories = _uiState.value.memories.replaceById(updated.id, updated) { it.id },
            message = "记忆已更新为第 ${updated.currentRevision.revisionNo} 版",
        )
    }

    fun deleteMemory(memory: MemoryView) = action {
        val householdId = _uiState.value.selectedHouseholdId ?: error("请先选择家庭")
        repository.deleteMemory(householdId, memory)
        _uiState.value = _uiState.value.copy(
            memories = _uiState.value.memories.filterNot { it.id == memory.id },
            message = "记忆已删除，不再进入新的模型上下文",
        )
    }

    fun createRoutine(input: RoutineInput) = action {
        validateRoutine(input)
        val (householdId, recipientId) = selectedWorkspace()
        val created = repository.createRoutine(householdId, recipientId, input)
        _uiState.value = _uiState.value.copy(
            routines = _uiState.value.routines + created,
            message = "日程已创建",
        )
    }

    fun updateRoutine(routine: RoutineView, input: RoutineInput) = action {
        validateRoutine(input)
        val householdId = _uiState.value.selectedHouseholdId ?: error("请先选择家庭")
        val updated = repository.updateRoutine(householdId, routine, input)
        _uiState.value = _uiState.value.copy(
            routines = _uiState.value.routines.replaceById(updated.id, updated) { it.id },
            message = "日程已更新",
        )
    }

    fun deleteRoutine(routine: RoutineView) = action {
        val householdId = _uiState.value.selectedHouseholdId ?: error("请先选择家庭")
        repository.deleteRoutine(householdId, routine)
        _uiState.value = _uiState.value.copy(
            routines = _uiState.value.routines.filterNot { it.id == routine.id },
            message = "日程已删除",
        )
    }

    fun verifyOccurrence(occurrence: OccurrenceView, verified: Boolean, note: String?) = action {
        require(occurrence.status == "NEEDS_FAMILY_REVIEW") { "该日程实例不需要家属核验" }
        val householdId = _uiState.value.selectedHouseholdId ?: error("请先选择家庭")
        val updated = repository.familyVerifyOccurrence(
            householdId,
            occurrence,
            verified,
            note?.trim()?.takeIf(String::isNotBlank),
        )
        val recipientId = _uiState.value.selectedRecipientId ?: error("请先选择陪伴对象")
        val tasks = repository.listFamilyTasks(householdId, recipientId)
        val events = repository.listCareEvents(householdId, recipientId)
        _uiState.value = _uiState.value.copy(
            occurrences = _uiState.value.occurrences.replaceById(updated.id, updated) { it.id },
            familyTasks = tasks,
            careEvents = events.take(30),
            message = if (verified) "已核验为完成" else "已核验为未完成",
        )
    }

    fun claimFamilyTask(task: FamilyTaskView) = action {
        val householdId = _uiState.value.selectedHouseholdId ?: error("请先选择家庭")
        val updated = repository.claimFamilyTask(householdId, task)
        _uiState.value = _uiState.value.copy(
            familyTasks = _uiState.value.familyTasks.replaceById(updated.id, updated) { it.id },
            message = "待办已领取",
        )
    }

    fun finishFamilyTask(task: FamilyTaskView, resolve: Boolean, note: String?) = action {
        val householdId = _uiState.value.selectedHouseholdId ?: error("请先选择家庭")
        val updated = repository.finishFamilyTask(
            householdId,
            task,
            resolve,
            note?.trim()?.takeIf(String::isNotBlank),
        )
        _uiState.value = _uiState.value.copy(
            familyTasks = _uiState.value.familyTasks.replaceById(updated.id, updated) { it.id },
            message = if (resolve) "待办已处理" else "待办已忽略",
        )
    }

    fun decideConsent(scope: String, grant: Boolean) = action {
        val (householdId, recipientId) = selectedWorkspace()
        val current = _uiState.value.consents.firstOrNull { it.scope == scope }
            ?: error("授权状态尚未加载，请刷新后重试")
        repository.decideConsent(householdId, recipientId, current, grant)
        _uiState.value = _uiState.value.copy(
            consents = repository.listConsents(householdId, recipientId),
            message = if (grant) "授权已生效" else "授权已撤回，新的请求将被服务器拒绝",
        )
    }

    fun refresh() = action {
        if (_uiState.value.role == AppRole.FAMILY) refreshFamilyData() else restoreDeviceData()
    }

    fun createActivation(recipientId: String) = action {
        val householdId = _uiState.value.selectedHouseholdId ?: error("请先选择家庭")
        val activation = repository.createActivationChallenge(householdId, recipientId)
        _uiState.value = _uiState.value.copy(
            activation = activation,
            message = "激活凭据已生成；陪伴设备认领后仍需家属现场批准",
        )
    }

    fun approveActivation(challengeId: String) = action {
        repository.approveActivation(challengeId)
        _uiState.value = _uiState.value.copy(message = "已批准设备激活")
        startActivationPolling()
    }

    fun showQrScanner(show: Boolean) {
        _uiState.value = _uiState.value.copy(qrScannerVisible = show, error = null)
    }

    fun claimDynamicCode(publicId: String, dynamicCode: String) = action {
        val pending = repository.claimActivation(
            publicId,
            ActivationProofType.DYNAMIC_CODE,
            dynamicCode,
        )
        _uiState.value = _uiState.value.copy(
            pendingDeviceActivation = pending,
            qrScannerVisible = false,
            message = "设备已认领，请家属端批准后完成激活",
        )
        startActivationPolling()
    }

    fun handleActivationQr(payload: String) {
        if (!_uiState.value.signedIn) {
            deferredActivationPayload = payload
            _uiState.value = _uiState.value.copy(message = "登录后将继续处理设备激活")
            return
        }
        action {
            val uri = payload.trim().toUri()
            require(uri.scheme == "memory-lighthouse" && uri.host == "activate") {
                "这不是守忆灯塔激活二维码"
            }
            val publicId = uri.getQueryParameter("publicId") ?: error("二维码缺少设备标识")
            val secret = uri.getQueryParameter("secret") ?: error("二维码缺少激活密钥")
            val pending = repository.claimActivation(
                publicId,
                ActivationProofType.QR_SECRET,
                secret,
            )
            _uiState.value = _uiState.value.copy(
                role = AppRole.COMPANION,
                pendingDeviceActivation = pending,
                qrScannerVisible = false,
                message = "二维码已验证，请家属端批准",
            )
            startActivationPolling()
        }
    }

    fun openAiCompanion() {
        require(_uiState.value.deviceActivated)
        _uiState.value = _uiState.value.copy(aiScreenVisible = true)
    }

    fun closeAiCompanion() {
        _uiState.value = _uiState.value.copy(aiScreenVisible = false)
    }

    fun requestRemoteCall(bindingId: String) = action {
        val householdId = _uiState.value.selectedHouseholdId ?: error("请先选择家庭")
        val session = repository.requestRemoteSession(householdId, bindingId)
        _uiState.value = _uiState.value.copy(
            activeRemoteSession = session,
            message = "已发起现场接听请求，长者设备明确接听后才能连线",
        )
        startFamilyRemotePolling(session)
    }

    fun acceptIncomingCall() = action {
        val incoming = _uiState.value.incomingRemoteSession ?: error("来电已失效")
        val accepted = repository.acceptDeviceRemoteSession(incoming.id)
        _uiState.value = _uiState.value.copy(
            incomingRemoteSession = null,
            activeRemoteSession = accepted,
            message = "已现场接听，正在进入通话",
        )
        val ticket = repository.deviceJoinTicket(accepted.id)
        callController.connect(ticket, CallSide.DEVICE)
        startRemoteHeartbeat(accepted.id)
    }

    fun declineIncomingCall() = action {
        val incoming = _uiState.value.incomingRemoteSession ?: return@action
        repository.declineDeviceRemoteSession(incoming.id)
        _uiState.value = _uiState.value.copy(
            incomingRemoteSession = null,
            message = "已拒绝本次来电",
        )
    }

    fun connectFamilyCall() = action {
        val session = _uiState.value.activeRemoteSession ?: error("通话请求不存在")
        val ticket = repository.familyJoinTicket(session.householdId, session.id)
        callController.connect(ticket, CallSide.FAMILY)
    }

    fun connectDeviceCall() = action {
        val session = _uiState.value.activeRemoteSession ?: error("通话请求不存在")
        val ticket = repository.deviceJoinTicket(session.id)
        callController.connect(ticket, CallSide.DEVICE)
        startRemoteHeartbeat(session.id)
    }

    fun endRemoteCall() = action {
        val session = _uiState.value.activeRemoteSession
        callController.disconnect()
        heartbeatJob?.cancel()
        heartbeatJob = null
        if (session != null) {
            if (_uiState.value.role == AppRole.COMPANION) {
                repository.endDeviceRemoteSession(session.id)
            } else {
                repository.endFamilyRemoteSession(session.householdId, session.id)
            }
        }
        _uiState.value = _uiState.value.copy(activeRemoteSession = null, message = "通话已结束")
    }

    fun cancelRemoteRequest() = action {
        val session = _uiState.value.activeRemoteSession ?: return@action
        repository.cancelFamilyRemoteSession(session.householdId, session.id)
        remotePolling?.cancel()
        _uiState.value = _uiState.value.copy(activeRemoteSession = null, message = "已取消呼叫")
    }

    fun attachVideoRenderer(renderer: livekit.org.webrtc.SurfaceViewRenderer) =
        callController.attachRenderer(renderer)

    fun detachVideoRenderer(renderer: livekit.org.webrtc.SurfaceViewRenderer) =
        callController.detachRenderer(renderer)

    fun saveApiBaseUrl(url: String) = action {
        repository.saveApiBaseUrl(url)
        _uiState.value = _uiState.value.copy(
            apiBaseUrl = repository.apiBaseUrl(),
            message = "开发服务器地址已更新",
        )
    }

    fun clearNotice() {
        _uiState.value = _uiState.value.copy(message = null, error = null)
    }

    fun onAppBackgrounded() {
        if (callState.value.phase in setOf(LiveCallPhase.CONNECTING, LiveCallPhase.CONNECTED)) {
            endRemoteCall()
        }
    }

    private fun restore() = viewModelScope.launch {
        runCatching {
            val user = repository.restoreUser()
            _uiState.value = _uiState.value.copy(
                restoring = false,
                signedIn = user != null,
                user = user,
                pendingDeviceActivation = repository.pendingDeviceActivation(),
                deviceActivated = repository.hasDeviceCredential(),
            )
            if (user != null) {
                refreshFamilyData()
                restoreDeviceData()
                consumeDeferredActivation()
            }
        }.onFailure { showError(it) }
        _uiState.value = _uiState.value.copy(restoring = false)
    }

    private suspend fun refreshFamilyData() {
        val households = repository.listHouseholds()
        val selected = _uiState.value.selectedHouseholdId
            ?.takeIf { id -> households.any { it.id == id } }
            ?: households.firstOrNull()?.id
        _uiState.value = _uiState.value.copy(
            households = households,
            selectedHouseholdId = selected,
        )
        if (selected != null) loadHouseholdDetails(selected)
        else {
            _uiState.value = _uiState.value.copy(
                recipients = emptyList(),
                selectedRecipientId = null,
                bindings = emptyList(),
            ).withoutRecipientResources()
        }
    }

    private suspend fun loadHouseholdDetails(householdId: String) {
        val (recipients, bindings) = coroutineScope {
            val recipientsRequest = async { repository.listRecipients(householdId) }
            val bindingsRequest = async { repository.listBindings(householdId) }
            recipientsRequest.await() to bindingsRequest.await()
        }
        val selectedRecipientId = _uiState.value.selectedRecipientId
            ?.takeIf { id -> recipients.any { it.id == id } }
            ?: recipients.firstOrNull()?.id
        _uiState.value = _uiState.value.copy(
            recipients = recipients,
            selectedRecipientId = selectedRecipientId,
            bindings = bindings,
        ).withoutRecipientResources()
        if (selectedRecipientId != null) {
            loadRecipientResources(householdId, selectedRecipientId)
        }
    }

    private suspend fun loadRecipientResources(householdId: String, recipientId: String) {
        val now = Instant.now()
        val from = now.minus(1, ChronoUnit.DAYS).toString()
        val to = now.plus(7, ChronoUnit.DAYS).toString()
        val resources = coroutineScope {
            val memories = async { repository.listMemories(householdId, recipientId) }
            val routines = async { repository.listRoutines(householdId, recipientId) }
            val occurrences = async {
                repository.listOccurrences(householdId, recipientId, from, to)
            }
            val events = async { repository.listCareEvents(householdId, recipientId) }
            val tasks = async { repository.listFamilyTasks(householdId, recipientId) }
            val consents = async { repository.listConsents(householdId, recipientId) }
            FamilyResources(
                memories = memories.await(),
                routines = routines.await(),
                occurrences = occurrences.await(),
                careEvents = events.await().take(30),
                familyTasks = tasks.await(),
                consents = consents.await(),
            )
        }
        if (
            _uiState.value.selectedHouseholdId != householdId ||
            _uiState.value.selectedRecipientId != recipientId
        ) return
        _uiState.value = _uiState.value.copy(
            memories = resources.memories,
            routines = resources.routines,
            occurrences = resources.occurrences,
            careEvents = resources.careEvents,
            familyTasks = resources.familyTasks,
            consents = resources.consents,
        )
    }

    private fun selectedWorkspace(): Pair<String, String> {
        val householdId = _uiState.value.selectedHouseholdId ?: error("请先选择家庭")
        val recipientId = _uiState.value.selectedRecipientId ?: error("请先选择陪伴对象")
        return householdId to recipientId
    }

    private fun validateMemory(input: MemoryInput) {
        require(input.kind in MEMORY_KINDS) { "请选择有效的记忆类型" }
        require(input.title.trim().isNotEmpty()) { "请填写记忆标题" }
        require(input.content.trim().isNotEmpty()) { "请填写记忆内容" }
        require(input.title.length <= 200 && input.content.length <= 20_000) { "记忆内容过长" }
        require(input.sensitivity in setOf("HOUSEHOLD", "SENSITIVE")) { "请选择敏感等级" }
    }

    private fun validateRoutine(input: RoutineInput) {
        require(input.type in ROUTINE_TYPES) { "请选择有效的日程类型" }
        require(input.title.trim().isNotEmpty()) { "请填写日程标题" }
        require(input.instructions.trim().isNotEmpty()) { "请填写提醒内容" }
        require(input.confirmationQuestion.trim().isNotEmpty()) { "请填写确认问题" }
        require(input.localTimeMinutes in 0..1439) { "提醒时间无效" }
        require(input.weekdayMask in 1..127) { "请至少选择一天" }
        require(input.graceMinutes in 0..1440) { "确认宽限时间无效" }
        require(input.familyNoticeMinutes in 0..10080) { "家属通知时间无效" }
        LocalDate.parse(input.startDate)
        input.endDate?.takeIf(String::isNotBlank)?.let(LocalDate::parse)
    }

    private suspend fun restoreDeviceData() {
        val deviceHouseholdId = repository.deviceCredentialHouseholdId()
        val accountCanUseDevice = deviceHouseholdId == null ||
            _uiState.value.households.any { it.id == deviceHouseholdId }
        _uiState.value = _uiState.value.copy(
            pendingDeviceActivation = repository.pendingDeviceActivation(),
            deviceActivated = repository.hasDeviceCredential() && accountCanUseDevice,
            companionContext = if (accountCanUseDevice) _uiState.value.companionContext else null,
        )
        if (repository.hasDeviceCredential() && accountCanUseDevice) {
            val context = repository.getDeviceContext()
            repository.heartbeat()
            _uiState.value = _uiState.value.copy(
                deviceActivated = true,
                companionContext = context,
                pendingDeviceActivation = null,
            )
            if (_uiState.value.role == AppRole.COMPANION) startIncomingPolling()
        } else if (repository.hasDeviceCredential()) {
            _uiState.value = _uiState.value.copy(
                message = "这台陪伴设备属于另一个家庭；请使用该家庭成员账号登录",
            )
        } else if (repository.pendingDeviceActivation() != null) {
            startActivationPolling()
        }
    }

    private fun startActivationPolling() {
        activationPolling?.cancel()
        activationPolling = viewModelScope.launch {
            while (isActive && !repository.hasDeviceCredential()) {
                val pending = repository.pendingDeviceActivation() ?: break
                runCatching { repository.exchangeApprovedActivation(pending) }
                    .onSuccess { credential ->
                        if (credential != null) {
                            if (_uiState.value.households.none { it.id == credential.householdId }) {
                                _uiState.value = _uiState.value.copy(
                                    deviceActivated = false,
                                    pendingDeviceActivation = null,
                                    companionContext = null,
                                    message = "设备已激活，但当前账号不是该家庭成员，请切换账号",
                                )
                                return@launch
                            }
                            val context = repository.getDeviceContext()
                            repository.heartbeat()
                            _uiState.value = _uiState.value.copy(
                                deviceActivated = true,
                                pendingDeviceActivation = null,
                                companionContext = context,
                                message = "设备激活完成，已绑定 ${context.recipientName}",
                            )
                            startIncomingPolling()
                            return@launch
                        }
                    }
                    .onFailure { error ->
                        if (error is LighthouseApiException && error.status in 400..499) {
                            showError(error)
                            return@launch
                        }
                    }
                delay(3_000)
            }
        }
    }

    private fun startIncomingPolling() {
        if (!_uiState.value.deviceActivated) return
        incomingPolling?.cancel()
        incomingPolling = viewModelScope.launch {
            while (isActive && _uiState.value.role == AppRole.COMPANION) {
                runCatching {
                    repository.heartbeat()
                    repository.currentDeviceRemoteSession()
                }.onSuccess { session ->
                    when {
                        session == null -> {
                            if (_uiState.value.activeRemoteSession != null) {
                                heartbeatJob?.cancel()
                                heartbeatJob = null
                                callController.disconnect("对方已结束通话")
                                _uiState.value = _uiState.value.copy(
                                    incomingRemoteSession = null,
                                    activeRemoteSession = null,
                                    message = "远程通话已结束",
                                )
                            } else {
                                _uiState.value = _uiState.value.copy(incomingRemoteSession = null)
                            }
                        }
                        session.status == "RINGING" -> _uiState.value = _uiState.value.copy(incomingRemoteSession = session)
                        session.status in ACTIVE_REMOTE_STATUSES -> _uiState.value =
                            _uiState.value.copy(activeRemoteSession = session, incomingRemoteSession = null)
                    }
                }.onFailure { error ->
                    if (error is LighthouseApiException && error.code == "DEVICE_NOT_ACTIVATED") {
                        _uiState.value = _uiState.value.copy(
                            deviceActivated = false,
                            companionContext = null,
                            incomingRemoteSession = null,
                            activeRemoteSession = null,
                            error = error.message,
                        )
                        return@launch
                    }
                }
                delay(3_000)
            }
        }
    }

    private fun startFamilyRemotePolling(initial: RemoteSessionView) {
        remotePolling?.cancel()
        remotePolling = viewModelScope.launch {
            var current = initial
            while (isActive && current.status !in TERMINAL_REMOTE_STATUSES) {
                delay(2_000)
                val refreshed = runCatching {
                    repository.getFamilyRemoteSession(current.householdId, current.id)
                }
                if (refreshed.isFailure) continue
                current = refreshed.getOrThrow()
                _uiState.value = _uiState.value.copy(activeRemoteSession = current)
            }
            if (current.status in TERMINAL_REMOTE_STATUSES) {
                callController.disconnect(current.endReason ?: "通话已结束")
                _uiState.value = _uiState.value.copy(
                    activeRemoteSession = null,
                    message = when (current.status) {
                        "DECLINED" -> "陪伴设备已拒绝接听"
                        "EXPIRED" -> "本次呼叫已超时"
                        else -> "远程通话已结束"
                    },
                )
            }
        }
    }

    private fun startRemoteHeartbeat(sessionId: String) {
        heartbeatJob?.cancel()
        heartbeatJob = viewModelScope.launch {
            while (isActive) {
                runCatching { repository.remoteHeartbeat(sessionId) }
                delay(15_000)
            }
        }
    }

    private fun consumeDeferredActivation() {
        deferredActivationPayload?.let { payload ->
            deferredActivationPayload = null
            handleActivationQr(payload)
        }
    }

    private fun action(block: suspend () -> Unit): Job = viewModelScope.launch {
        _uiState.value = _uiState.value.copy(busy = true, error = null)
        runCatching { block() }.onFailure(::handleActionFailure)
        _uiState.value = _uiState.value.copy(busy = false)
    }

    private fun handleActionFailure(error: Throwable) {
        if (error is LighthouseApiException && error.code == "SIGNED_OUT") {
            stopBackgroundJobs()
            callController.disconnect("signed_out")
            _uiState.value = LighthouseUiState(
                restoring = false,
                apiBaseUrl = repository.apiBaseUrl(),
                error = error.message,
            )
            return
        }
        if (error is LighthouseApiException && error.code == "DEVICE_NOT_ACTIVATED") {
            _uiState.value = _uiState.value.copy(
                deviceActivated = false,
                companionContext = null,
                incomingRemoteSession = null,
                activeRemoteSession = null,
            )
        }
        showError(error)
    }

    private fun showError(error: Throwable) {
        val message = when (error) {
            is LighthouseApiException -> error.message +
                (error.requestId?.let { "（请求号 $it）" } ?: "")
            else -> error.message ?: "操作失败，请稍后重试"
        }
        _uiState.value = _uiState.value.copy(error = message, busy = false)
    }

    private fun stopBackgroundJobs() {
        listOf(incomingPolling, activationPolling, remotePolling, heartbeatJob).forEach { it?.cancel() }
        incomingPolling = null
        activationPolling = null
        remotePolling = null
        heartbeatJob = null
    }

    override fun onCleared() {
        stopBackgroundJobs()
        callController.disconnect("client_closed")
        super.onCleared()
    }

    companion object {
        private val MEMORY_KINDS = setOf("PERSON", "PREFERENCE", "PLACE", "STORY", "ROUTINE")
        private val ROUTINE_TYPES = setOf(
            "MEDICATION",
            "MEAL",
            "HYDRATION",
            "ACTIVITY",
            "APPOINTMENT",
            "OTHER",
        )
        private val ACTIVE_REMOTE_STATUSES = setOf("ACCEPTED", "CONNECTING", "ACTIVE", "ENDING")
        private val TERMINAL_REMOTE_STATUSES = setOf(
            "DECLINED",
            "CANCELLED",
            "ENDED",
            "EXPIRED",
            "FAILED",
            "REVOKED",
        )

        fun factory(context: Context, graph: AppGraph): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    LighthouseViewModel(context.applicationContext, graph.repository) as T
            }
    }
}

private data class FamilyResources(
    val memories: List<MemoryView>,
    val routines: List<RoutineView>,
    val occurrences: List<OccurrenceView>,
    val careEvents: List<CareEventView>,
    val familyTasks: List<FamilyTaskView>,
    val consents: List<ConsentStateView>,
)

private fun LighthouseUiState.withoutRecipientResources() = copy(
    memories = emptyList(),
    routines = emptyList(),
    occurrences = emptyList(),
    careEvents = emptyList(),
    familyTasks = emptyList(),
    consents = emptyList(),
)

private fun <T> List<T>.replaceById(
    id: String,
    replacement: T,
    idOf: (T) -> String,
): List<T> = map { if (idOf(it) == id) replacement else it }
