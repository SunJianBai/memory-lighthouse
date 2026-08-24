package com.sun.minicpmo_android.lighthouse

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.core.net.toUri
import com.sun.minicpmo_android.lighthouse.call.CompanionCallService
import com.sun.minicpmo_android.lighthouse.call.CompanionMediaHandoffState
import com.sun.minicpmo_android.lighthouse.call.RemoteCallCoordinator
import com.sun.minicpmo_android.lighthouse.data.ActivationExchangeOutcome
import com.sun.minicpmo_android.lighthouse.data.ActivationProofType
import com.sun.minicpmo_android.lighthouse.data.LighthouseRepository
import com.sun.minicpmo_android.lighthouse.data.RemoteCallCommandPayload
import com.sun.minicpmo_android.lighthouse.data.RemoteCallCommandRegistry
import com.sun.minicpmo_android.lighthouse.data.activationPollingRetryDelayMillis
import com.sun.minicpmo_android.lighthouse.data.isActivationRecoveryConflict
import com.sun.minicpmo_android.lighthouse.data.shouldRetryActivationPolling
import com.sun.minicpmo_android.lighthouse.model.*
import com.sun.minicpmo_android.lighthouse.network.LighthouseApiException
import com.sun.minicpmo_android.lighthouse.realtime.LiveCallState
import com.sun.minicpmo_android.lighthouse.realtime.isUnexpectedFamilyMediaFailure
import com.sun.minicpmo_android.lighthouse.realtime.shouldKeepFamilyMediaFailureVisible
import kotlinx.coroutines.CancellationException
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

class LighthouseViewModel internal constructor(
    private val repository: LighthouseRepository,
    private val callCoordinator: RemoteCallCoordinator,
    private val remoteCallCommands: RemoteCallCommandRegistry,
) : ViewModel() {
    private val _uiState = MutableStateFlow(
        LighthouseUiState(apiBaseUrl = repository.apiBaseUrl()),
    )
    val uiState: StateFlow<LighthouseUiState> = _uiState.asStateFlow()

    val callState: StateFlow<LiveCallState> = callCoordinator.liveCallState
    val heartbeatConnectionState = callCoordinator.heartbeatConnectionState
    val companionMediaHandoffState: StateFlow<CompanionMediaHandoffState> =
        callCoordinator.companionMediaHandoffState

    private var activationPolling: Job? = null
    private var remotePolling: Job? = null
    private var deferredActivationPayload: String? = null
    private val familyWorkspaceLoads = LatestFamilyWorkspaceLoad()
    private val familyOperations = FamilyOperationCoordinator()
    private val actionBusyTracker = ActionBusyTracker()
    private var familyCallJoinGeneration = 0L

    init {
        viewModelScope.launch {
            callCoordinator.state.collect { coordinated ->
                if (_uiState.value.role == AppRole.COMPANION) {
                    val current = _uiState.value
                    val newFailure = coordinated.failureMessage
                        ?.takeIf { it != current.remoteCallFailure }
                    _uiState.value = current.copy(
                        incomingRemoteSession = coordinated.incoming,
                        activeRemoteSession = coordinated.active,
                        remoteCallFailureSessionId = coordinated.lifecycle.sessionId
                            ?.takeIf { coordinated.failureMessage != null },
                        remoteCallFailureTitle = coordinated.failureTitle,
                        remoteCallFailure = coordinated.failureMessage,
                        error = newFailure ?: current.error,
                    )
                }
            }
        }
        viewModelScope.launch {
            callCoordinator.liveCallState.collect { media ->
                val current = _uiState.value
                val session = current.activeRemoteSession
                if (
                    current.role == AppRole.FAMILY &&
                    session != null &&
                    session.status != "RINGING" &&
                    media.isUnexpectedFamilyMediaFailure(session.id)
                ) {
                    val failureMessage =
                        "陪伴模型已停止。请结束本次通话后重新发起，不能直接重连。"
                    val isNewFailure = current.remoteCallFailureSessionId != session.id
                    _uiState.value = current.copy(
                        remoteCallFailureSessionId = session.id,
                        remoteCallFailureTitle = "设备已接听，但媒体连接失败",
                        remoteCallFailure = failureMessage,
                        error = if (isNewFailure) failureMessage else current.error,
                    )
                }
            }
        }
        restore()
    }

    fun login(identifier: String, password: String): Job {
        familyWorkspaceLoads.invalidate()
        familyOperations.endSession()
        return action {
            val user = repository.login(identifier, password)
            val scope = familyWorkspaceLoads.begin()
            familyOperations.startSession(user.id)
            _uiState.value = _uiState.value.copy(
                role = AppRole.FAMILY,
                signedIn = true,
                companionDeviceLocked = false,
                user = user,
            )
            refreshFamilyData(scope)
            restoreDeviceData()
            consumeDeferredActivation()
        }
    }

    fun register(
        email: String?,
        username: String?,
        password: String,
        displayName: String,
    ): Job {
        familyWorkspaceLoads.invalidate()
        familyOperations.endSession()
        return action {
            require(!email.isNullOrBlank()) { "请填写邮箱，完成验证后才能管理家庭和设备" }
            val user = repository.register(email, username, password, displayName)
            val scope = familyWorkspaceLoads.begin()
            familyOperations.startSession(user.id)
            _uiState.value = _uiState.value.copy(
                role = AppRole.FAMILY,
                signedIn = true,
                companionDeviceLocked = false,
                user = user,
                emailVerificationPromptVisible = !user.emailVerified,
                message = "注册成功，6 位邮箱验证码已发送。",
            )
            refreshFamilyData(scope)
            restoreDeviceData()
            consumeDeferredActivation()
        }
    }

    fun requestEmailVerification(
        emailInput: String? = null,
        currentPassword: String? = null,
    ) = action {
        val email = emailInput?.trim()?.takeIf(String::isNotBlank)
            ?: _uiState.value.user?.email
            ?: error("请先填写用于验证的邮箱")
        if (_uiState.value.user?.email == null) {
            require(!currentPassword.isNullOrEmpty()) { "绑定首个邮箱前，请输入当前账号密码" }
        }
        repository.requestEmailVerification(email, currentPassword)
        val refreshedUser = try {
            repository.getMe()
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            null
        }
        _uiState.value = _uiState.value.copy(
            user = refreshedUser ?: _uiState.value.user,
            emailVerificationPromptVisible = true,
            message = if (refreshedUser != null) {
                "6 位邮箱验证码已发送，请查收并输入验证码"
            } else {
                "验证码已发送，但账号信息暂未刷新；仍可直接输入收到的验证码"
            },
        )
    }

    fun confirmEmailVerification(emailInput: String, code: String) = action {
        val email = emailInput.trim().takeIf(String::isNotBlank)
            ?: _uiState.value.user?.email
            ?: error("请先填写用于验证的邮箱")
        repository.confirmEmailVerification(email, code)
        val user = repository.getMe()
        _uiState.value = _uiState.value.copy(
            user = user,
            emailVerificationPromptVisible = false,
            message = "邮箱验证成功，现在可以管理家庭和设备",
        )
    }

    fun dismissEmailVerificationPrompt() {
        _uiState.value = _uiState.value.copy(emailVerificationPromptVisible = false)
    }

    fun logout(): Job {
        familyWorkspaceLoads.invalidate()
        familyOperations.endSession()
        return action {
            val userId = _uiState.value.user?.id
            _uiState.value.activeRemoteSession?.let { session ->
                if (_uiState.value.role == AppRole.COMPANION) {
                    runCatching { callCoordinator.endCompanionCall(session.id) }
                } else {
                    callCoordinator.disconnectFamily("signed_out")
                    runCatching {
                        repository.endFamilyRemoteSession(session.householdId, session.id)
                    }
                }
            }
            stopBackgroundJobs()
            userId?.let(remoteCallCommands::terminateAllForUser)
            if (repository.hasDeviceCredential()) {
                enterLockedCompanionMode(message = "已退出家属账号，陪伴设备继续安全运行")
            } else {
                repository.logout()
                _uiState.value = LighthouseUiState(
                    restoring = false,
                    apiBaseUrl = repository.apiBaseUrl(),
                )
            }
        }
    }

    fun switchRole(role: AppRole) {
        if (role == _uiState.value.role) return
        if (role == AppRole.COMPANION && _uiState.value.deviceActivated) {
            action {
                enterLockedCompanionMode(message = "陪伴设备已锁定；进入家属管理需要重新登录")
            }
            return
        }
        if (role == AppRole.COMPANION) {
            familyWorkspaceLoads.invalidate()
            familyOperations.endSession()
            publishActionBusy()
        }
        _uiState.value = _uiState.value.copy(
            role = role,
            message = null,
            error = null,
            aiScreenVisible = false,
            qrScannerVisible = false,
        )
        if (role == AppRole.COMPANION) {
            val coordinated = callCoordinator.state.value
            _uiState.value = _uiState.value.copy(
                incomingRemoteSession = coordinated.incoming,
                activeRemoteSession = coordinated.active,
            )
            if (_uiState.value.deviceActivated) callCoordinator.ensureCompanionDiscoveryRunning()
        } else {
            _uiState.value.user?.id?.takeIf { _uiState.value.signedIn }?.let { userId ->
                familyOperations.startSession(userId)
                familyOperations.updateSelection(
                    _uiState.value.selectedHouseholdId,
                    _uiState.value.selectedRecipientId,
                )
            }
        }
    }

    fun requireFamilyAuthentication() {
        val current = _uiState.value
        if (!current.companionDeviceLocked || current.activeRemoteSession != null) return
        familyWorkspaceLoads.invalidate()
        familyOperations.endSession()
        _uiState.value = LighthouseUiState(
            restoring = false,
            role = AppRole.FAMILY,
            signedIn = false,
            companionDeviceLocked = false,
            deviceActivated = current.deviceActivated,
            companionContext = current.companionContext,
            apiBaseUrl = repository.apiBaseUrl(),
            message = "请重新登录家属账号后继续管理",
        )
    }

    fun returnToCompanionDevice() = action {
        require(repository.hasDeviceCredential()) { "陪伴设备凭据已失效，请重新激活" }
        enterLockedCompanionMode(message = "已返回专用陪伴模式")
    }

    fun selectHousehold(householdId: String): Job {
        familyOperations.updateSelection(householdId, null)
        val scope = familyWorkspaceLoads.begin()
        return action(
            isResultOwner = { familyWorkspaceLoads.isCurrent(scope) },
        ) {
            if (!familyWorkspaceLoads.isCurrent(scope)) return@action
            _uiState.value = _uiState.value.copy(
                selectedHouseholdId = householdId,
                selectedRecipientId = null,
                recipients = emptyList(),
                bindings = emptyList(),
                householdMembers = emptyList(),
                activation = null,
                activationApprovalDetails = null,
            ).withoutRecipientResources()
            loadHouseholdDetails(scope, householdId)
        }
    }

    fun selectRecipient(recipientId: String): Job {
        val current = _uiState.value
        if (current.recipients.none { it.id == recipientId }) {
            return action { error("陪伴对象不存在") }
        }
        val householdId = current.selectedHouseholdId
            ?: return action { error("请先选择家庭") }
        familyOperations.updateSelection(householdId, recipientId)
        val scope = familyWorkspaceLoads.begin()
        return action(
            isResultOwner = { familyWorkspaceLoads.isCurrent(scope) },
        ) {
            if (!familyWorkspaceLoads.isCurrent(scope)) return@action
            _uiState.value = _uiState.value.copy(
                selectedRecipientId = recipientId,
                activation = null,
                activationApprovalDetails = null,
            ).withoutRecipientResources()
            loadRecipientResources(
                householdId = householdId,
                recipientId = recipientId,
                isResultOwner = { familyWorkspaceLoads.isCurrent(scope) },
            )
        }
    }

    fun createHousehold(name: String, timezone: String) = familyAction(
        scope = FamilyOperationScope.SELECTION,
        lane = "household:create",
        reconcile = FamilyOperationReconcile.HOUSEHOLD_LIST,
        reconcilePublishedSuccess = false,
        validate = {
            require(name.trim().isNotEmpty()) { "请填写家庭名称" }
            require(timezone.trim().isNotEmpty()) { "请填写家庭时区" }
        },
        request = { repository.createHousehold(name, timezone) },
        apply = { created ->
            _uiState.value = _uiState.value.copy(
                households = (_uiState.value.households + created).distinctBy { it.id },
                message = "家庭已创建，请继续添加陪伴对象",
            )
            selectHousehold(created.id)
        },
    )

    fun createRecipient(input: CareRecipientInput) = familyAction(
        scope = FamilyOperationScope.SELECTION,
        lane = "recipient:create",
        reconcile = FamilyOperationReconcile.HOUSEHOLD,
        reconcilePublishedSuccess = false,
        validate = {
            require(input.name.trim().isNotEmpty()) { "请填写长者姓名" }
            require(input.timezone.trim().isNotEmpty()) { "请填写长者时区" }
            input.birthDate?.takeIf(String::isNotBlank)?.let(LocalDate::parse)
        },
        request = {
            repository.createRecipient(checkNotNull(householdId), input)
        },
        apply = { created ->
            _uiState.value = _uiState.value.copy(
                recipients = (_uiState.value.recipients + created).distinctBy { it.id },
                message = "已添加 ${created.preferredName}",
            )
            selectRecipient(created.id)
        },
    )

    fun createMemory(input: MemoryInput) = familyAction(
        scope = FamilyOperationScope.RECIPIENT,
        lane = "memory:create",
        policy = FamilyOperationPolicy.ADDITIVE,
        reconcile = FamilyOperationReconcile.RECIPIENT,
        validate = { validateMemory(input) },
        request = {
            repository.createMemory(checkNotNull(householdId), checkNotNull(recipientId), input)
        },
        apply = { created ->
            _uiState.value = _uiState.value.copy(
                memories = (listOf(created) + _uiState.value.memories).distinctBy { it.id },
                message = "记忆已保存",
            )
        },
    )

    fun updateMemory(memory: MemoryView, input: MemoryInput) = familyAction(
        scope = FamilyOperationScope.RECIPIENT,
        lane = "memory:${memory.id}",
        reconcile = FamilyOperationReconcile.RECIPIENT,
        validate = { validateMemory(input) },
        request = {
            require(memory.recipientId == recipientId) { "记忆不属于当前陪伴对象" }
            repository.updateMemory(checkNotNull(householdId), memory, input)
        },
        apply = { updated ->
            _uiState.value = _uiState.value.copy(
                memories = _uiState.value.memories.replaceById(updated.id, updated) { it.id },
                message = "记忆已更新为第 ${updated.currentRevision.revisionNo} 版",
            )
        },
    )

    fun deleteMemory(memory: MemoryView) = familyAction(
        scope = FamilyOperationScope.RECIPIENT,
        lane = "memory:${memory.id}",
        reconcile = FamilyOperationReconcile.RECIPIENT,
        request = {
            require(memory.recipientId == recipientId) { "记忆不属于当前陪伴对象" }
            repository.deleteMemory(checkNotNull(householdId), memory)
        },
        apply = {
            _uiState.value = _uiState.value.copy(
                memories = _uiState.value.memories.filterNot { it.id == memory.id },
                message = "记忆已删除，不再进入新的模型上下文",
            )
        },
    )

    fun createRoutine(input: RoutineInput) = familyAction(
        scope = FamilyOperationScope.RECIPIENT,
        lane = "routine:create",
        policy = FamilyOperationPolicy.ADDITIVE,
        reconcile = FamilyOperationReconcile.RECIPIENT,
        validate = { validateRoutine(input) },
        request = {
            repository.createRoutine(checkNotNull(householdId), checkNotNull(recipientId), input)
        },
        apply = { created ->
            _uiState.value = _uiState.value.copy(
                routines = (_uiState.value.routines + created).distinctBy { it.id },
                message = "日程已创建",
            )
        },
    )

    fun updateRoutine(routine: RoutineView, input: RoutineInput) = familyAction(
        scope = FamilyOperationScope.RECIPIENT,
        lane = "routine:${routine.id}",
        reconcile = FamilyOperationReconcile.RECIPIENT,
        validate = { validateRoutine(input) },
        request = {
            require(routine.recipientId == recipientId) { "日程不属于当前陪伴对象" }
            repository.updateRoutine(checkNotNull(householdId), routine, input)
        },
        apply = { updated ->
            _uiState.value = _uiState.value.copy(
                routines = _uiState.value.routines.replaceById(updated.id, updated) { it.id },
                message = "日程已更新",
            )
        },
    )

    fun deleteRoutine(routine: RoutineView) = familyAction(
        scope = FamilyOperationScope.RECIPIENT,
        lane = "routine:${routine.id}",
        reconcile = FamilyOperationReconcile.RECIPIENT,
        request = {
            require(routine.recipientId == recipientId) { "日程不属于当前陪伴对象" }
            repository.deleteRoutine(checkNotNull(householdId), routine)
        },
        apply = {
            _uiState.value = _uiState.value.copy(
                routines = _uiState.value.routines.filterNot { it.id == routine.id },
                message = "日程已删除",
            )
        },
    )

    fun verifyOccurrence(
        occurrence: OccurrenceView,
        verified: Boolean,
        note: String?,
    ) = familyAction(
        scope = FamilyOperationScope.RECIPIENT,
        lane = "occurrence:${occurrence.id}",
        reconcile = FamilyOperationReconcile.RECIPIENT,
        validate = {
            require(occurrence.status == "NEEDS_FAMILY_REVIEW") {
                "该日程实例不需要家属核验"
            }
        },
        request = {
            require(occurrence.recipientId == recipientId) { "日程实例不属于当前陪伴对象" }
            val capturedHouseholdId = checkNotNull(householdId)
            val capturedRecipientId = checkNotNull(recipientId)
            val updated = repository.familyVerifyOccurrence(
                capturedHouseholdId,
                occurrence,
                verified,
                note?.trim()?.takeIf(String::isNotBlank),
            )
            Triple(
                updated,
                repository.listFamilyTasks(capturedHouseholdId, capturedRecipientId),
                repository.listCareEvents(capturedHouseholdId, capturedRecipientId),
            )
        },
        apply = { (updated, tasks, events) ->
            _uiState.value = _uiState.value.copy(
                occurrences = _uiState.value.occurrences
                    .replaceById(updated.id, updated) { it.id },
                familyTasks = tasks,
                careEvents = events.take(30),
                message = if (verified) "已核验为完成" else "已核验为未完成",
            )
        },
    )

    fun claimFamilyTask(task: FamilyTaskView) = familyAction(
        scope = FamilyOperationScope.RECIPIENT,
        lane = "task:${task.id}",
        reconcile = FamilyOperationReconcile.RECIPIENT,
        request = {
            require(task.recipientId == recipientId) { "待办不属于当前陪伴对象" }
            repository.claimFamilyTask(checkNotNull(householdId), task)
        },
        apply = { updated ->
            _uiState.value = _uiState.value.copy(
                familyTasks = _uiState.value.familyTasks.replaceById(updated.id, updated) { it.id },
                message = "待办已领取",
            )
        },
    )

    fun finishFamilyTask(task: FamilyTaskView, resolve: Boolean, note: String?) = familyAction(
        scope = FamilyOperationScope.RECIPIENT,
        lane = "task:${task.id}",
        reconcile = FamilyOperationReconcile.RECIPIENT,
        request = {
            require(task.recipientId == recipientId) { "待办不属于当前陪伴对象" }
            repository.finishFamilyTask(
                checkNotNull(householdId),
                task,
                resolve,
                note?.trim()?.takeIf(String::isNotBlank),
            )
        },
        apply = { updated ->
            _uiState.value = _uiState.value.copy(
                familyTasks = _uiState.value.familyTasks.replaceById(updated.id, updated) { it.id },
                message = if (resolve) "待办已处理" else "待办已忽略",
            )
        },
    )

    fun decideConsent(scope: String, grant: Boolean) = familyAction(
        scope = FamilyOperationScope.RECIPIENT,
        lane = "consent:$scope",
        reconcile = FamilyOperationReconcile.RECIPIENT,
        request = {
            val capturedHouseholdId = checkNotNull(householdId)
            val capturedRecipientId = checkNotNull(recipientId)
            val current = _uiState.value.consents.firstOrNull { it.scope == scope }
                ?: error("授权状态尚未加载，请刷新后重试")
            repository.decideConsent(capturedHouseholdId, capturedRecipientId, current, grant)
            repository.listConsents(capturedHouseholdId, capturedRecipientId)
        },
        apply = { consents ->
            _uiState.value = _uiState.value.copy(
                consents = consents,
                message = if (grant) "授权已生效" else "授权已撤回，新的请求将被服务器拒绝",
            )
        },
    )

    fun loadCareAuthorities() = familyAction(
        scope = FamilyOperationScope.RECIPIENT,
        lane = "care-authorities",
        validate = {
            require(_uiState.value.selectedHousehold?.roleCodes?.contains("OWNER") == true) {
                "只有家庭 OWNER 可以查看成员照护权限"
            }
        },
        request = {
            repository.listCareAuthorities(checkNotNull(householdId), checkNotNull(recipientId))
        },
        apply = { authorities ->
            _uiState.value = _uiState.value.copy(
                careAuthorities = authorities,
                authoritiesLoadedRecipientId = _uiState.value.selectedRecipientId,
                message = "成员照护权限已刷新",
            )
        },
    )

    fun updateHouseholdMember(
        member: HouseholdMemberView,
        roleCodes: Set<String>,
        currentPassword: String,
    ) = familyAction(
        scope = FamilyOperationScope.HOUSEHOLD,
        lane = "member:${member.id}",
        reconcile = FamilyOperationReconcile.HOUSEHOLD,
        validate = {
            val selectedHouseholdId = _uiState.value.selectedHouseholdId
                ?: error("请先选择家庭")
            require(member.householdId == selectedHouseholdId) { "成员不属于当前家庭" }
            val currentUserId = _uiState.value.user?.id ?: error("请先登录")
            require(member.userId != currentUserId) { "不能修改自己的家庭角色" }
            require(roleCodes.isNotEmpty() && roleCodes.all { it in HOUSEHOLD_ROLES }) {
                "请至少选择一个有效家庭角色"
            }
        },
        request = {
            repository.updateHouseholdMember(
                checkNotNull(householdId),
                member,
                roleCodes,
                currentPassword,
            )
        },
        apply = { updated ->
            _uiState.value = _uiState.value.copy(
                householdMembers = _uiState.value.householdMembers
                    .replaceById(updated.id, updated) { it.id },
                message = "${updated.displayName} 的家庭角色已更新",
            )
        },
    )

    fun removeHouseholdMember(
        member: HouseholdMemberView,
        currentPassword: String,
    ) = familyAction(
        scope = FamilyOperationScope.HOUSEHOLD,
        lane = "member:${member.id}",
        reconcile = FamilyOperationReconcile.HOUSEHOLD,
        validate = {
            val selectedHouseholdId = _uiState.value.selectedHouseholdId
                ?: error("请先选择家庭")
            require(member.householdId == selectedHouseholdId) { "成员不属于当前家庭" }
            val currentUserId = _uiState.value.user?.id ?: error("请先登录")
            require(member.userId != currentUserId) { "不能移除自己的家庭成员身份" }
        },
        request = {
            repository.removeHouseholdMember(checkNotNull(householdId), member, currentPassword)
        },
        apply = {
            _uiState.value = _uiState.value.copy(
                householdMembers = _uiState.value.householdMembers
                    .filterNot { it.id == member.id },
                careAuthorities = _uiState.value.careAuthorities
                    .filterNot { it.memberId == member.id },
                message = "${member.displayName} 已从家庭移除，相关照护权限同步失效",
            )
        },
    )

    fun putCareAuthority(
        memberId: String,
        input: CareAuthorityInput,
        currentPassword: String,
    ) = familyAction(
        scope = FamilyOperationScope.RECIPIENT,
        lane = "authority:$memberId",
        reconcile = FamilyOperationReconcile.CARE_AUTHORITIES,
        validate = {
            require(
                _uiState.value.householdMembers.any {
                    it.id == memberId && it.status == "ACTIVE"
                },
            ) { "该家庭成员已失效，请刷新后重试" }
            require(input.accessLevel.isNotBlank()) { "请填写权限级别" }
            require(input.status in setOf("ACTIVE", "REVOKED")) { "权限状态无效" }
            require(input.contactPriority == null || input.contactPriority in 1..100) {
                "通知优先级需为 1 到 100"
            }
        },
        request = {
            repository.putCareAuthority(
                checkNotNull(householdId),
                checkNotNull(recipientId),
                memberId,
                input,
                currentPassword,
            )
        },
        apply = { updated ->
            _uiState.value = _uiState.value.copy(
                careAuthorities = _uiState.value.careAuthorities
                    .filterNot { it.memberId == updated.memberId } + updated,
                authoritiesLoadedRecipientId = _uiState.value.selectedRecipientId,
                message = "${updated.displayName} 的照护权限已更新",
            )
        },
    )

    fun revokeBinding(
        binding: CompanionBindingView,
        reasonCode: String?,
        currentPassword: String,
    ) = familyAction(
        scope = FamilyOperationScope.HOUSEHOLD,
        lane = "binding:${binding.id}",
        reconcile = FamilyOperationReconcile.HOUSEHOLD,
        validate = {
            require(binding.householdId == _uiState.value.selectedHouseholdId) {
                "设备不属于当前家庭"
            }
        },
        request = {
            repository.revokeBinding(
                checkNotNull(householdId),
                binding.id,
                reasonCode,
                currentPassword,
            )
        },
        apply = {
            _uiState.value = _uiState.value.copy(
                bindings = _uiState.value.bindings.filterNot { it.id == binding.id },
                message = "陪伴设备 ${binding.displayName} 已解绑，原设备凭据立即失效",
            )
        },
    )

    fun refresh(): Job {
        if (_uiState.value.role != AppRole.FAMILY) return action { restoreDeviceData() }
        val scope = familyWorkspaceLoads.begin()
        return action(
            isResultOwner = { familyWorkspaceLoads.isCurrent(scope) },
        ) {
            refreshFamilyData(scope)
        }
    }

    fun createActivation(recipientId: String) = familyAction(
        scope = FamilyOperationScope.RECIPIENT,
        lane = "activation:create",
        validate = {
            require(recipientId == _uiState.value.selectedRecipientId) {
                "只能为当前陪伴对象生成激活凭据"
            }
        },
        request = {
            repository.createActivationChallenge(checkNotNull(householdId), recipientId)
        },
        apply = { activation ->
            _uiState.value = _uiState.value.copy(
                activation = activation,
                activationApprovalDetails = null,
                message = "激活凭据已生成；陪伴设备认领后仍需家属现场批准",
            )
        },
    )

    fun loadActivationApprovalDetails(challengeId: String) = familyAction(
        scope = FamilyOperationScope.SELECTION,
        lane = "activation:approval",
        request = { repository.activationApprovalDetails(challengeId) },
        apply = { details ->
            _uiState.value = _uiState.value.copy(
                activationApprovalDetails = details,
                message = "请核对设备、认领时间和网络来源后再批准",
            )
        },
    )

    fun approveActivation(challengeId: String) = familyAction(
        scope = FamilyOperationScope.SELECTION,
        lane = "activation:approval",
        reconcile = FamilyOperationReconcile.HOUSEHOLD,
        request = {
            val capturedHouseholdId = checkNotNull(householdId)
            val details = _uiState.value.activationApprovalDetails
                ?.takeIf { it.challengeId == challengeId }
                ?: error("请先读取并核对待批准设备信息")
            repository.approveActivation(challengeId, details.claimSnapshotToken)
            repository.listBindings(capturedHouseholdId)
        },
        apply = { bindings ->
            _uiState.value = _uiState.value.copy(
                activation = null,
                activationApprovalDetails = null,
                bindings = bindings,
                message = "已批准设备激活",
            )
            startActivationPolling()
        },
    )

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
            familyWorkspaceLoads.invalidate()
            familyOperations.endSession()
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
        val initiatorUserId = _uiState.value.user?.id ?: error("请先登录")
        val householdId = _uiState.value.selectedHouseholdId ?: error("请先选择家庭")
        val media = RequestedRemoteMedia()
        val payload = RemoteCallCommandPayload(
            initiatorUserId = initiatorUserId,
            householdId = householdId,
            bindingId = bindingId,
            media = media,
        )
        val session = remoteCallCommands.execute(payload) { idempotencyKey ->
            repository.requestRemoteSession(
                householdId = householdId,
                bindingId = bindingId,
                idempotencyKey = idempotencyKey,
                media = media,
            )
        }
        _uiState.value = _uiState.value.copy(
            activeRemoteSession = session,
            remoteCallFailureSessionId = null,
            remoteCallFailureTitle = null,
            remoteCallFailure = null,
            message = "已发起现场接听请求，长者设备明确接听后才能连线",
        )
        startFamilyRemotePolling(session)
    }

    fun acceptIncomingCall(sessionId: String? = null) = action {
        val incoming = _uiState.value.incomingRemoteSession
            ?.takeIf { sessionId == null || it.id == sessionId }
            ?: error("来电已失效")
        callCoordinator.acceptIncoming(incoming.id)
        _uiState.value = _uiState.value.copy(
            pendingSystemAnswerSessionId = null,
            message = "已现场接听，正在进入通话",
        )
    }

    fun attachLocalCompanionStopConsumer() =
        callCoordinator.attachLocalCompanionStopConsumer()

    fun detachLocalCompanionStopConsumer() =
        callCoordinator.detachLocalCompanionStopConsumer()

    fun completeLocalCompanionStop(requestId: Long) =
        callCoordinator.completeLocalCompanionStop(requestId)

    fun failLocalCompanionStop(requestId: Long, error: Throwable) =
        callCoordinator.failLocalCompanionStop(requestId, error)

    fun dismissRemoteCallFailure() {
        callCoordinator.dismissFailure()
        _uiState.value = _uiState.value.copy(
            remoteCallFailureSessionId = null,
            remoteCallFailureTitle = null,
            remoteCallFailure = null,
        )
    }

    fun declineIncomingCall() = action {
        val incoming = _uiState.value.incomingRemoteSession ?: return@action
        callCoordinator.declineIncoming(incoming.id)
        _uiState.value = _uiState.value.copy(
            pendingSystemAnswerSessionId = null,
            message = "已拒绝本次来电",
        )
    }

    fun connectFamilyCall(): Job {
        val owner = captureFamilyCallJoinOwner()
            ?: return action { error("通话请求不存在") }
        return action(
            isResultOwner = { isCurrentFamilyCallJoinOwner(owner) },
        ) {
            val session = _uiState.value.activeRemoteSession ?: return@action
            require(_uiState.value.remoteCallFailureSessionId != session.id) {
                "本次媒体连接已失败，请结束后重新发起通话"
            }
            require(!callCoordinator.liveCallState.value.isUnexpectedFamilyMediaFailure(session.id)) {
                "本次媒体连接已失败，请结束后重新发起通话"
            }
            val ticket = repository.familyJoinTicket(owner.householdId, owner.sessionId)
            if (
                !isCurrentFamilyCallJoinOwner(owner) ||
                ticket.sessionId != owner.sessionId ||
                _uiState.value.remoteCallFailureSessionId == owner.sessionId ||
                callCoordinator.liveCallState.value.isUnexpectedFamilyMediaFailure(owner.sessionId)
            ) return@action
            callCoordinator.connectFamily(ticket)
        }
    }

    private fun captureFamilyCallJoinOwner(): FamilyCallJoinOwner? {
        val current = _uiState.value
        val session = current.activeRemoteSession ?: return null
        val userId = current.user?.id ?: return null
        if (!current.signedIn || current.role != AppRole.FAMILY) return null
        return FamilyCallJoinOwner(
            generation = familyCallJoinGeneration,
            userId = userId,
            householdId = session.householdId,
            sessionId = session.id,
        )
    }

    private fun isCurrentFamilyCallJoinOwner(owner: FamilyCallJoinOwner): Boolean {
        val current = _uiState.value
        val session = current.activeRemoteSession
        return familyCallJoinGeneration == owner.generation &&
            current.signedIn &&
            current.role == AppRole.FAMILY &&
            current.user?.id == owner.userId &&
            session?.id == owner.sessionId &&
            session.householdId == owner.householdId &&
            session.status !in TERMINAL_REMOTE_STATUSES
    }

    private fun invalidatePendingFamilyCallJoins() {
        familyCallJoinGeneration += 1
    }

    fun connectDeviceCall() = action {
        val session = _uiState.value.activeRemoteSession ?: error("通话请求不存在")
        val pending = callCoordinator.state.value.incoming?.takeIf { it.id == session.id }
            ?: error("通话已连接或不再等待现场接听")
        callCoordinator.acceptIncoming(pending.id)
    }

    fun endRemoteCall(): Job {
        invalidatePendingFamilyCallJoins()
        return action {
            val session = _uiState.value.activeRemoteSession
            if (session != null) {
                if (_uiState.value.role == AppRole.COMPANION) {
                    callCoordinator.endCompanionCall(session.id)
                } else {
                    callCoordinator.disconnectFamily()
                    repository.endFamilyRemoteSession(session.householdId, session.id)
                }
            }
            _uiState.value.user?.id?.let(remoteCallCommands::terminateAllForUser)
            _uiState.value = _uiState.value.copy(
                activeRemoteSession = null,
                remoteCallFailureSessionId = null,
                remoteCallFailureTitle = null,
                remoteCallFailure = null,
                message = "通话已结束",
            )
        }
    }

    fun cancelRemoteRequest(): Job {
        invalidatePendingFamilyCallJoins()
        return action {
            val session = _uiState.value.activeRemoteSession ?: return@action
            repository.cancelFamilyRemoteSession(session.householdId, session.id)
            remotePolling?.cancel()
            _uiState.value.user?.id?.let(remoteCallCommands::terminateAllForUser)
            _uiState.value = _uiState.value.copy(
                activeRemoteSession = null,
                remoteCallFailureSessionId = null,
                remoteCallFailureTitle = null,
                remoteCallFailure = null,
                message = "已取消呼叫",
            )
        }
    }

    fun attachVideoRenderer(renderer: livekit.org.webrtc.SurfaceViewRenderer) =
        callCoordinator.attachRenderer(renderer)

    fun detachVideoRenderer(renderer: livekit.org.webrtc.SurfaceViewRenderer) =
        callCoordinator.detachRenderer(renderer)

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

    fun handleCallIntent(intentAction: String?, sessionId: String?) {
        if (sessionId.isNullOrBlank()) return
        if (intentAction !in setOf(
                CompanionCallService.ACTION_ANSWER,
                CompanionCallService.ACTION_OPEN_INCOMING,
            )
        ) return

        fun applyIntent() {
            familyWorkspaceLoads.invalidate()
            familyOperations.endSession()
            publishActionBusy()
            _uiState.value = _uiState.value.copy(
                role = AppRole.COMPANION,
                companionDeviceLocked = repository.hasDeviceCredential(),
                pendingSystemAnswerSessionId = sessionId.takeIf {
                    intentAction == CompanionCallService.ACTION_ANSWER
                },
                aiScreenVisible = false,
            )
        }
        if (repository.hasDeviceCredential() && repository.hasUserSession()) {
            action {
                enterLockedCompanionMode(message = "已切换到专用陪伴模式处理来电")
                applyIntent()
            }
        } else {
            applyIntent()
        }
    }

    fun consumeSystemAnswerIntent() {
        _uiState.value = _uiState.value.copy(pendingSystemAnswerSessionId = null)
    }

    private fun restore() = viewModelScope.launch {
        runCatching {
            if (tryRestoreLockedCompanionMode()) return@runCatching
            val user = repository.restoreUser()
            if (user != null) familyOperations.startSession(user.id)
            _uiState.value = _uiState.value.copy(
                restoring = false,
                signedIn = user != null,
                user = user,
                pendingDeviceActivation = repository.pendingDeviceActivation(),
                deviceActivated = repository.hasDeviceCredential(),
            )
            if (user != null) {
                refreshFamilyData(familyWorkspaceLoads.begin())
                restoreDeviceData()
                consumeDeferredActivation()
            }
        }.onFailure { showError(it) }
        _uiState.value = _uiState.value.copy(restoring = false)
    }

    private suspend fun refreshFamilyData(scope: FamilyWorkspaceLoadScope) {
        val householdsResult = familyWorkspaceLoads.load(scope) {
            repository.listHouseholds()
        }
        val households = when (householdsResult) {
            is FamilyWorkspaceLoadResult.CurrentSuccess -> householdsResult.value
            is FamilyWorkspaceLoadResult.CurrentFailure -> throw householdsResult.error
            FamilyWorkspaceLoadResult.Stale -> return
        }
        if (!familyWorkspaceLoads.isCurrent(scope)) return
        val previousSelected = _uiState.value.selectedHouseholdId
        val selected = previousSelected
            ?.takeIf { id -> households.any { it.id == id } }
            ?: households.firstOrNull()?.id
        familyOperations.updateSelection(
            householdId = selected,
            recipientId = _uiState.value.selectedRecipientId.takeIf {
                selected == previousSelected
            },
        )
        _uiState.value = _uiState.value.copy(
            households = households,
            selectedHouseholdId = selected,
        )
        if (selected != previousSelected) {
            _uiState.value = _uiState.value.copy(
                selectedRecipientId = null,
                recipients = emptyList(),
                bindings = emptyList(),
                householdMembers = emptyList(),
                activation = null,
                activationApprovalDetails = null,
            ).withoutRecipientResources()
        }
        if (selected != null) {
            loadHouseholdDetails(scope, selected)
        } else {
            _uiState.value = _uiState.value.copy(
                recipients = emptyList(),
                selectedRecipientId = null,
                bindings = emptyList(),
                householdMembers = emptyList(),
                activation = null,
                activationApprovalDetails = null,
            ).withoutRecipientResources()
        }
    }

    private suspend fun loadHouseholdDetails(
        scope: FamilyWorkspaceLoadScope,
        householdId: String,
    ) {
        val result = familyWorkspaceLoads.load(scope) {
            coroutineScope {
                val recipientsRequest = async { repository.listRecipients(householdId) }
                val bindingsRequest = async { repository.listBindings(householdId) }
                val membersRequest = async { repository.listHouseholdMembers(householdId) }
                HouseholdDetails(
                    recipients = recipientsRequest.await(),
                    bindings = bindingsRequest.await(),
                    members = membersRequest.await(),
                )
            }
        }
        val details = when (result) {
            is FamilyWorkspaceLoadResult.CurrentSuccess -> result.value
            is FamilyWorkspaceLoadResult.CurrentFailure -> throw result.error
            FamilyWorkspaceLoadResult.Stale -> return
        }
        if (!familyWorkspaceLoads.isCurrent(scope)) return
        val previousSelectedRecipientId = _uiState.value.selectedRecipientId
        val selectedRecipientId = previousSelectedRecipientId
            ?.takeIf { id -> details.recipients.any { it.id == id } }
            ?: details.recipients.firstOrNull()?.id
        val recipientChanged = selectedRecipientId != previousSelectedRecipientId
        familyOperations.updateSelection(householdId, selectedRecipientId)
        _uiState.value = _uiState.value.copy(
            recipients = details.recipients,
            selectedRecipientId = selectedRecipientId,
            bindings = details.bindings,
            householdMembers = details.members,
            activation = _uiState.value.activation.takeUnless { recipientChanged },
            activationApprovalDetails = _uiState.value.activationApprovalDetails
                .takeUnless { recipientChanged },
        ).withoutRecipientResources()
        if (selectedRecipientId != null) {
            loadRecipientResources(
                householdId = householdId,
                recipientId = selectedRecipientId,
                isResultOwner = { familyWorkspaceLoads.isCurrent(scope) },
            )
        }
    }

    private suspend fun loadRecipientResources(
        householdId: String,
        recipientId: String,
        isResultOwner: () -> Boolean = { true },
    ) {
        val now = Instant.now()
        val from = now.minus(1, ChronoUnit.DAYS).toString()
        val to = now.plus(7, ChronoUnit.DAYS).toString()
        val resources = try {
            coroutineScope {
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
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Throwable) {
            if (!isResultOwner()) return
            throw error
        }
        if (
            !isResultOwner() ||
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
        _uiState.value = _uiState.value.copy(
            pendingDeviceActivation = repository.pendingDeviceActivation(),
            deviceActivated = repository.hasDeviceCredential(),
        )
        if (repository.hasDeviceCredential()) {
            val context = repository.getDeviceContext()
            callCoordinator.recordDeviceHeartbeat()
            _uiState.value = _uiState.value.copy(
                deviceActivated = true,
                companionContext = context,
                pendingDeviceActivation = null,
            )
            callCoordinator.ensureCompanionDiscoveryRunning()
        } else if (repository.pendingDeviceActivation() != null) {
            startActivationPolling()
        }
    }

    private suspend fun tryRestoreLockedCompanionMode(): Boolean {
        if (!repository.hasDeviceCredential()) return false
        enterLockedCompanionMode(message = "陪伴设备已恢复，家属管理需要重新登录")
        val contextResult = runCatching {
            repository.getDeviceContext().also {
                callCoordinator.recordDeviceHeartbeat()
            }
        }
        val error = contextResult.exceptionOrNull()
        if (
            error is LighthouseApiException &&
            error.code == "DEVICE_NOT_ACTIVATED" &&
            !repository.hasDeviceCredential()
        ) {
            _uiState.value = LighthouseUiState(
                restoring = false,
                apiBaseUrl = repository.apiBaseUrl(),
                error = "陪伴设备凭据已失效，请重新登录家属账号并激活设备",
            )
            return true
        }
        contextResult.onSuccess { context ->
            _uiState.value = _uiState.value.copy(companionContext = context)
        }.onFailure {
            _uiState.value = _uiState.value.copy(
                message = "陪伴设备已锁定；网络恢复后将自动继续服务",
            )
            showError(it)
        }
        return true
    }

    private suspend fun enterLockedCompanionMode(
        context: DeviceContextView? = null,
        message: String,
    ) {
        familyWorkspaceLoads.invalidate()
        familyOperations.endSession()
        val previousUserId = _uiState.value.user?.id
        val resolvedContext = context ?: _uiState.value.companionContext
        _uiState.value = LighthouseUiState(
            restoring = false,
            role = AppRole.COMPANION,
            signedIn = false,
            companionDeviceLocked = true,
            pendingDeviceActivation = null,
            deviceActivated = true,
            companionContext = resolvedContext,
            incomingRemoteSession = callCoordinator.state.value.incoming,
            activeRemoteSession = callCoordinator.state.value.active,
            apiBaseUrl = repository.apiBaseUrl(),
            message = message,
        )
        repository.revokeUserSessionForCompanionMode()
        previousUserId?.let(remoteCallCommands::terminateAllForUser)
        callCoordinator.ensureCompanionDiscoveryRunning()
    }

    private fun startActivationPolling() {
        activationPolling?.cancel()
        activationPolling = viewModelScope.launch {
            var recoveryConflictAttempts = 0
            while (isActive && !repository.hasDeviceCredential()) {
                val pending = repository.pendingDeviceActivation() ?: break
                var retryDelayMillis = 3_000L
                runCatching { repository.exchangeApprovedActivation(pending) }
                    .onSuccess { outcome ->
                        when (outcome) {
                            ActivationExchangeOutcome.Waiting -> recoveryConflictAttempts = 0
                            is ActivationExchangeOutcome.Terminal -> {
                                _uiState.value = _uiState.value.copy(
                                    pendingDeviceActivation = null,
                                    error = outcome.message,
                                )
                                return@launch
                            }
                            is ActivationExchangeOutcome.Activated -> {
                                enterLockedCompanionMode(
                                    message = "设备激活完成；家属账号已安全退出",
                                )
                                runCatching { repository.getDeviceContext() }
                                    .onSuccess { context ->
                                        _uiState.value = _uiState.value.copy(
                                            companionContext = context,
                                            message = "设备激活完成，已绑定 ${context.recipientName}；家属账号已安全退出",
                                        )
                                    }
                                    .onFailure(::showError)
                                return@launch
                            }
                        }
                    }
                    .onFailure { error ->
                        if (isActivationRecoveryConflict(error)) {
                            recoveryConflictAttempts += 1
                        }
                        if (!shouldRetryActivationPolling(error, recoveryConflictAttempts)) {
                            repository.abandonPendingDeviceActivation()
                            _uiState.value = _uiState.value.copy(pendingDeviceActivation = null)
                            if (isActivationRecoveryConflict(error)) {
                                showError(
                                    IllegalStateException(
                                        "设备凭据恢复多次冲突，请重新扫描二维码或输入新的动态激活码",
                                    ),
                                )
                            } else {
                                showError(error)
                            }
                            return@launch
                        }
                        retryDelayMillis = activationPollingRetryDelayMillis(error)
                    }
                delay(retryDelayMillis)
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
                _uiState.value.user?.id?.let(remoteCallCommands::terminateAllForUser)
                val failureBeforeDisconnect = shouldKeepFamilyMediaFailureVisible(
                    sessionStatus = current.status,
                    sessionId = current.id,
                    mediaState = callCoordinator.liveCallState.value,
                    failureLatched = _uiState.value.remoteCallFailureSessionId == current.id,
                )
                callCoordinator.disconnectFamily(current.endReason ?: "通话已结束")
                val latest = _uiState.value
                val failureRemainsVisible = failureBeforeDisconnect ||
                    latest.remoteCallFailureSessionId == current.id
                _uiState.value = latest.copy(
                    activeRemoteSession = current.takeIf { failureRemainsVisible },
                    remoteCallFailureSessionId = if (failureRemainsVisible) {
                        current.id
                    } else {
                        latest.remoteCallFailureSessionId
                    },
                    remoteCallFailureTitle = if (failureRemainsVisible) {
                        latest.remoteCallFailureTitle ?: "设备已接听，但媒体连接失败"
                    } else {
                        latest.remoteCallFailureTitle
                    },
                    remoteCallFailure = if (failureRemainsVisible) {
                        latest.remoteCallFailure
                            ?: "陪伴模型已停止。请结束本次通话后重新发起，不能直接重连。"
                    } else {
                        latest.remoteCallFailure
                    },
                    message = if (failureRemainsVisible) {
                        null
                    } else {
                        when (current.status) {
                            "DECLINED" -> "陪伴设备已拒绝接听"
                            "EXPIRED" -> "本次呼叫已超时"
                            else -> "远程通话已结束"
                        }
                    },
                )
            }
        }
    }

    private fun consumeDeferredActivation() {
        deferredActivationPayload?.let { payload ->
            deferredActivationPayload = null
            handleActivationQr(payload)
        }
    }

    private fun <T> familyAction(
        scope: FamilyOperationScope,
        lane: String,
        policy: FamilyOperationPolicy = FamilyOperationPolicy.LATEST_PER_LANE,
        reconcile: FamilyOperationReconcile = FamilyOperationReconcile.NONE,
        reconcilePublishedSuccess: Boolean = true,
        validate: () -> Unit = {},
        request: suspend FamilyOperationTicket.() -> T,
        apply: (T) -> Unit,
    ): Job {
        val current = _uiState.value
        if (
            current.role != AppRole.FAMILY ||
            !current.signedIn ||
            current.user == null ||
            !familyOperations.hasSession
        ) {
            return action { error("请先登录家属账号") }
        }
        if (
            scope in setOf(FamilyOperationScope.HOUSEHOLD, FamilyOperationScope.RECIPIENT) &&
            current.selectedHouseholdId == null
        ) {
            return action { error("请先选择家庭") }
        }
        if (scope == FamilyOperationScope.RECIPIENT && current.selectedRecipientId == null) {
            return action { error("请先选择陪伴对象") }
        }

        val ticket = familyOperations.begin(
            scope = scope,
            lane = lane,
            policy = policy,
            reconcile = reconcile,
        )
        return action(
            isResultOwner = { familyOperations.isResultOwner(ticket) },
        ) {
            validate()
            val result = try {
                ticket.request()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Throwable) {
                if (
                    error is LighthouseApiException &&
                    error.code == "SIGNED_OUT" &&
                    familyOperations.isSessionCurrent(ticket)
                ) {
                    handleActionFailure(error)
                    return@action
                }
                val decision = familyOperations.complete(
                    ticket,
                    FamilyOperationOutcome.FAILURE,
                )
                decision.reconcile?.let {
                    scheduleFamilyReconciliation(ticket, it)
                }
                if (decision.publish) throw error
                return@action
            }

            val decision = familyOperations.complete(
                ticket,
                FamilyOperationOutcome.SUCCESS,
            )
            if (decision.publish) apply(result)
            if (!decision.publish || reconcilePublishedSuccess) {
                decision.reconcile?.let {
                    scheduleFamilyReconciliation(ticket, it)
                }
            }
        }
    }

    private fun scheduleFamilyReconciliation(
        ticket: FamilyOperationTicket,
        target: FamilyOperationReconcile,
    ) {
        val careAuthoritiesTicket = if (target == FamilyOperationReconcile.CARE_AUTHORITIES) {
            familyOperations.begin(
                scope = FamilyOperationScope.RECIPIENT,
                lane = "care-authorities",
            )
        } else {
            null
        }
        val scope = familyWorkspaceLoads.begin()
        viewModelScope.launch {
            runCatching {
                when (target) {
                    FamilyOperationReconcile.NONE -> Unit
                    FamilyOperationReconcile.HOUSEHOLD_LIST -> refreshFamilyData(scope)
                    FamilyOperationReconcile.HOUSEHOLD -> {
                        val householdId = ticket.householdId ?: return@runCatching
                        if (_uiState.value.selectedHouseholdId != householdId) {
                            return@runCatching
                        }
                        loadHouseholdDetails(scope, householdId)
                    }
                    FamilyOperationReconcile.RECIPIENT -> {
                        val householdId = ticket.householdId ?: return@runCatching
                        val recipientId = ticket.recipientId ?: return@runCatching
                        if (
                            _uiState.value.selectedHouseholdId != householdId ||
                            _uiState.value.selectedRecipientId != recipientId
                        ) {
                            return@runCatching
                        }
                        loadRecipientResources(
                            householdId = householdId,
                            recipientId = recipientId,
                            isResultOwner = { familyWorkspaceLoads.isCurrent(scope) },
                        )
                    }
                    FamilyOperationReconcile.CARE_AUTHORITIES -> {
                        val householdId = ticket.householdId ?: return@runCatching
                        val recipientId = ticket.recipientId ?: return@runCatching
                        val authorities = repository.listCareAuthorities(householdId, recipientId)
                        if (
                            familyWorkspaceLoads.isCurrent(scope) &&
                            careAuthoritiesTicket?.let(familyOperations::isResultOwner) == true &&
                            _uiState.value.selectedHouseholdId == householdId &&
                            _uiState.value.selectedRecipientId == recipientId
                        ) {
                            _uiState.value = _uiState.value.copy(
                                careAuthorities = authorities,
                                authoritiesLoadedRecipientId = recipientId,
                            )
                        }
                    }
                }
            }.onFailure { error ->
                if (
                    error is LighthouseApiException &&
                    error.code == "SIGNED_OUT" &&
                    familyOperations.isSessionCurrent(ticket)
                ) {
                    handleActionFailure(error)
                }
            }
        }
    }

    private fun action(
        isResultOwner: () -> Boolean = { true },
        block: suspend () -> Unit,
    ): Job = viewModelScope.launch {
        if (!isResultOwner()) return@launch
        val busyLease = actionBusyTracker.begin(isResultOwner)
        publishActionBusy(error = null)
        try {
            block()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Throwable) {
            if (isResultOwner()) handleActionFailure(error)
        } finally {
            actionBusyTracker.end(busyLease)
            publishActionBusy()
        }
    }

    private fun publishActionBusy(error: String? = _uiState.value.error) {
        _uiState.value = _uiState.value.copy(
            busy = actionBusyTracker.isBusy(),
            error = error,
        )
    }

    private fun handleActionFailure(error: Throwable) {
        if (error is LighthouseApiException && error.code == "SIGNED_OUT") {
            familyWorkspaceLoads.invalidate()
            familyOperations.endSession()
            _uiState.value.user?.id?.let(remoteCallCommands::terminateAllForUser)
            stopBackgroundJobs()
            callCoordinator.disconnectFamily("signed_out")
            val currentContext = _uiState.value.companionContext
            val deviceAvailable = repository.hasDeviceCredential()
            _uiState.value = LighthouseUiState(
                restoring = false,
                role = if (deviceAvailable) AppRole.COMPANION else AppRole.FAMILY,
                companionDeviceLocked = deviceAvailable,
                deviceActivated = deviceAvailable,
                companionContext = currentContext.takeIf { deviceAvailable },
                apiBaseUrl = repository.apiBaseUrl(),
                error = if (deviceAvailable) {
                    "${error.message}；已返回专用陪伴模式"
                } else {
                    error.message
                },
            )
            if (deviceAvailable) callCoordinator.ensureCompanionDiscoveryRunning()
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
        _uiState.value = _uiState.value.copy(error = message)
    }

    private fun stopBackgroundJobs() {
        listOf(activationPolling, remotePolling).forEach { it?.cancel() }
        activationPolling = null
        remotePolling = null
    }

    override fun onCleared() {
        stopBackgroundJobs()
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
        private val HOUSEHOLD_ROLES = setOf("OWNER", "CAREGIVER", "VIEWER")
        private val TERMINAL_REMOTE_STATUSES = setOf(
            "DECLINED",
            "CANCELLED",
            "ENDED",
            "EXPIRED",
            "FAILED",
            "REVOKED",
        )

        fun factory(graph: AppGraph): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    LighthouseViewModel(
                        graph.repository,
                        graph.callCoordinator,
                        graph.remoteCallCommands,
                    ) as T
            }
    }
}

private data class FamilyCallJoinOwner(
    val generation: Long,
    val userId: String,
    val householdId: String,
    val sessionId: String,
)

private data class FamilyResources(
    val memories: List<MemoryView>,
    val routines: List<RoutineView>,
    val occurrences: List<OccurrenceView>,
    val careEvents: List<CareEventView>,
    val familyTasks: List<FamilyTaskView>,
    val consents: List<ConsentStateView>,
)

private data class HouseholdDetails(
    val recipients: List<CareRecipientView>,
    val bindings: List<CompanionBindingView>,
    val members: List<HouseholdMemberView>,
)

private fun LighthouseUiState.withoutRecipientResources() = copy(
    memories = emptyList(),
    routines = emptyList(),
    occurrences = emptyList(),
    careEvents = emptyList(),
    familyTasks = emptyList(),
    consents = emptyList(),
    careAuthorities = emptyList(),
    authoritiesLoadedRecipientId = null,
)

private fun <T> List<T>.replaceById(
    id: String,
    replacement: T,
    idOf: (T) -> String,
): List<T> = map { if (idOf(it) == id) replacement else it }
