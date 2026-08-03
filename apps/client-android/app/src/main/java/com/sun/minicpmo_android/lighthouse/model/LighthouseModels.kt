package com.sun.minicpmo_android.lighthouse.model

import org.json.JSONObject

enum class AppRole(val label: String) {
    FAMILY("家属端"),
    COMPANION("陪伴端"),
}

data class UserSession(
    val accessToken: String,
    val accessTokenExpiresAt: String,
    val refreshToken: String,
    val refreshTokenExpiresAt: String,
    val sessionId: String,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("accessToken", accessToken)
        .put("accessTokenExpiresAt", accessTokenExpiresAt)
        .put("refreshToken", refreshToken)
        .put("refreshTokenExpiresAt", refreshTokenExpiresAt)
        .put("sessionId", sessionId)

    companion object {
        fun fromJson(json: JSONObject) = UserSession(
            accessToken = json.getString("accessToken"),
            accessTokenExpiresAt = json.getString("accessTokenExpiresAt"),
            refreshToken = json.getString("refreshToken"),
            refreshTokenExpiresAt = json.getString("refreshTokenExpiresAt"),
            sessionId = json.getString("sessionId"),
        )
    }
}

data class UserView(
    val id: String,
    val displayName: String,
    val status: String,
    val primaryIdentity: String?,
    val email: String?,
    val emailVerified: Boolean,
)

data class HouseholdView(
    val id: String,
    val name: String,
    val timezone: String,
    val status: String,
    val roleCodes: List<String>,
    val version: Int,
)

data class HouseholdMemberView(
    val id: String,
    val householdId: String,
    val userId: String,
    val displayName: String,
    val status: String,
    val roleCodes: List<String>,
    val joinedAt: String?,
    val version: Int,
)

data class CareRecipientView(
    val id: String,
    val householdId: String,
    val name: String,
    val preferredName: String,
    val birthDate: String?,
    val timezone: String,
    val homeLabel: String?,
    val status: String,
    val version: Int,
)

data class CareRecipientInput(
    val name: String,
    val preferredName: String?,
    val birthDate: String?,
    val timezone: String,
    val homeLabel: String?,
)

data class CareAuthorityView(
    val id: String,
    val householdId: String,
    val recipientId: String,
    val memberId: String,
    val userId: String,
    val displayName: String,
    val relationshipLabel: String?,
    val accessLevel: String,
    val canManageProfile: Boolean,
    val canManageConsent: Boolean,
    val canManageRoutine: Boolean,
    val canViewEvents: Boolean,
    val canViewConversation: Boolean,
    val canActivateDevice: Boolean,
    val canRemoteCall: Boolean,
    val receiveNotifications: Boolean,
    val contactPriority: Int?,
    val status: String,
    val version: Int,
)

data class CareAuthorityInput(
    val relationshipLabel: String?,
    val accessLevel: String,
    val canManageProfile: Boolean,
    val canManageConsent: Boolean,
    val canManageRoutine: Boolean,
    val canViewEvents: Boolean,
    val canViewConversation: Boolean,
    val canActivateDevice: Boolean,
    val canRemoteCall: Boolean,
    val receiveNotifications: Boolean,
    val contactPriority: Int?,
    val status: String,
    val version: Int?,
)

data class MemoryRevisionView(
    val id: String,
    val revisionNo: Int,
    val content: String,
    val source: String,
    val changeReason: String?,
    val createdAt: String,
)

data class MemoryView(
    val id: String,
    val householdId: String,
    val recipientId: String,
    val kind: String,
    val title: String,
    val sensitivity: String,
    val verificationStatus: String,
    val status: String,
    val currentRevision: MemoryRevisionView,
    val updatedAt: String,
    val version: Int,
)

data class MemoryInput(
    val kind: String,
    val title: String,
    val content: String,
    val sensitivity: String,
    val verificationStatus: String = "FAMILY_REPORTED",
)

data class RoutineScheduleView(
    val id: String,
    val timezone: String,
    val localTimeMinutes: Int,
    val weekdayMask: Int,
    val startDate: String,
    val endDate: String?,
    val graceMinutes: Int,
    val familyNoticeMinutes: Int,
    val scheduleVersion: Int,
)

data class RoutineView(
    val id: String,
    val householdId: String,
    val recipientId: String,
    val type: String,
    val medicationId: String?,
    val title: String,
    val instructions: String,
    val confirmationQuestion: String,
    val contentProvenance: String,
    val status: String,
    val schedules: List<RoutineScheduleView>,
    val updatedAt: String,
    val version: Int,
)

data class RoutineInput(
    val type: String,
    val medicationId: String? = null,
    val title: String,
    val instructions: String,
    val confirmationQuestion: String,
    val timezone: String,
    val localTimeMinutes: Int,
    val weekdayMask: Int,
    val startDate: String,
    val endDate: String?,
    val graceMinutes: Int,
    val familyNoticeMinutes: Int,
)

data class OccurrenceView(
    val id: String,
    val householdId: String,
    val recipientId: String,
    val routineId: String,
    val routineTitle: String,
    val routineType: String,
    val instructions: String,
    val scheduledAtUtc: String,
    val scheduledLocalDate: String,
    val status: String,
    val confirmationDeadlineAt: String?,
    val escalationAt: String?,
    val completedAt: String?,
    val version: Int,
)

data class CareEventView(
    val id: String,
    val type: String,
    val severity: String,
    val sourceType: String,
    val title: String,
    val summary: String,
    val occurredAt: String,
)

data class FamilyTaskView(
    val id: String,
    val recipientId: String,
    val sourceEventId: String,
    val assigneeMemberId: String?,
    val status: String,
    val priority: String,
    val dueAt: String?,
    val resolvedAt: String?,
    val resolutionCode: String?,
    val resolutionNote: String?,
    val version: Int,
)

data class ConsentDocumentVersionView(
    val id: String,
    val code: String,
    val version: Int,
    val publishedAt: String,
)

data class ConsentEventView(
    val id: String,
    val scope: String,
    val decision: String,
    val documentVersion: ConsentDocumentVersionView,
    val reason: String?,
    val occurredAt: String,
)

data class ConsentStateView(
    val scope: String,
    val granted: Boolean,
    val decision: String,
    val lastEvent: ConsentEventView?,
    val version: Int,
)

data class ConsentScopeDefinition(
    val scope: String,
    val documentVersionId: String,
    val title: String,
    val description: String,
    val detail: String,
    val sensitive: Boolean = false,
)

object ConsentCatalog {
    val entries = listOf(
        ConsentScopeDefinition("CAMERA_CAPTURE", "01KYYD3S55C7TCKGXJ32HBEV8E", "陪伴摄像头", "陪伴会话中采集画面供模型处理。", "撤回后，新的陪伴会话不能开启摄像头。"),
        ConsentScopeDefinition("MICROPHONE_CAPTURE", "01KYYD3S566Y0A1HCZZCAYDTXV", "陪伴麦克风", "陪伴会话中采集声音供模型处理。", "不包含家属远程通话录音授权。"),
        ConsentScopeDefinition("MODEL_PROCESSING", "01KYYD3S57AE606GFKY35H2KYM", "全模态模型处理", "把已授权的会话输入交给 MiniCPM-o。", "模型输出不是医疗诊断，也不能替代家属确认。"),
        ConsentScopeDefinition("MODEL_INPUT_TRANSCRIPTION", "01KYYD3S58BSZQF3256C7HA6MK", "用户语音转写", "允许 ASR 单独保存陪伴会话中的用户原文。", "未授权时不能从模型回复反推用户说了什么。", true),
        ConsentScopeDefinition("REMOTE_ASSISTANCE_AUDIO", "01KYYD3S59JC1S1RCT09YTQ38Q", "家属远程音频", "现场接听后，家属与陪伴端实时对话。", "远程通话始终不录音、不转写。"),
        ConsentScopeDefinition("REMOTE_ASSISTANCE_VIDEO", "01KYYD3S5AYMHN86J6H4FJ9K67", "家属查看陪伴端画面", "现场接听后，向家属发送陪伴端摄像头画面。", "家属端不会向陪伴端发送摄像头画面。"),
        ConsentScopeDefinition("MEMORY_STORAGE", "01KYYD3S5BADE8WTHRP83JSP3K", "长期记忆存储", "保存家属录入并核验的长期记忆。", "撤回后，记忆不再进入新的模型上下文。"),
        ConsentScopeDefinition("CONTENT_INSPECTION", "01KYYD3S5CVXPGQK0GQB3VY36D", "开发期原文检查", "允许受审计的管理员在开发期检查记忆与对话原文。", "还需双人审批的临时检查授权；生产环境硬关闭。", true),
    )

    fun definition(scope: String): ConsentScopeDefinition =
        entries.first { it.scope == scope }
}

data class CompanionBindingView(
    val id: String,
    val deviceId: String,
    val householdId: String,
    val recipientId: String,
    val displayName: String,
    val status: String,
    val version: Int,
)

data class ActivationPresentation(
    val challengeId: String,
    val publicId: String,
    val dynamicCode: String,
    val qrPayload: String,
    val expiresAt: String,
)

data class ActivationApprovalDevice(
    val platform: String,
    val installationKeyAlgorithm: String,
    val manufacturer: String?,
    val model: String?,
    val osVersion: String?,
    val appVersion: String?,
    val keyFingerprintSuffix: String,
)

data class ActivationApprovalDetails(
    val challengeId: String,
    val claimedAt: String,
    val claimNetworkSource: String,
    val claimSnapshotToken: String,
    val device: ActivationApprovalDevice,
)

data class DeviceInstallation(
    val installationId: String,
    val serverNonce: String,
    val keyFingerprint: String,
    val installationKeyAlgorithm: String,
    val protocolVersion: String,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("installationId", installationId)
        .put("serverNonce", serverNonce)
        .put("keyFingerprint", keyFingerprint)
        .put("installationKeyAlgorithm", installationKeyAlgorithm)
        .put("protocolVersion", protocolVersion)

    companion object {
        fun fromJson(json: JSONObject) = DeviceInstallation(
            installationId = json.getString("installationId"),
            serverNonce = json.getString("serverNonce"),
            keyFingerprint = json.getString("keyFingerprint"),
            installationKeyAlgorithm = json.getString("installationKeyAlgorithm"),
            protocolVersion = json.getString("protocolVersion"),
        )
    }
}

data class DeviceCredential(
    val credential: String,
    val credentialId: String,
    val credentialFamilyId: String,
    val bindingId: String,
    val householdId: String,
    val recipientId: String,
    val expiresAt: String,
    val accessToken: String,
    val accessTokenExpiresAt: String,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("credential", credential)
        .put("credentialId", credentialId)
        .put("credentialFamilyId", credentialFamilyId)
        .put("bindingId", bindingId)
        .put("householdId", householdId)
        .put("recipientId", recipientId)
        .put("expiresAt", expiresAt)
        .put("accessToken", accessToken)
        .put("accessTokenExpiresAt", accessTokenExpiresAt)

    companion object {
        fun fromJson(json: JSONObject) = DeviceCredential(
            credential = json.getString("credential"),
            credentialId = json.getString("credentialId"),
            credentialFamilyId = json.getString("credentialFamilyId"),
            bindingId = json.getString("bindingId"),
            householdId = json.getString("householdId"),
            recipientId = json.getString("recipientId"),
            expiresAt = json.getString("expiresAt"),
            accessToken = json.getString("accessToken"),
            accessTokenExpiresAt = json.getString("accessTokenExpiresAt"),
        )
    }
}

data class PendingDeviceActivation(
    val challengeId: String,
    val publicId: String,
    val proofType: String,
    val proof: String,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("challengeId", challengeId)
        .put("publicId", publicId)
        .put("proofType", proofType)
        .put("proof", proof)

    companion object {
        fun fromJson(json: JSONObject) = PendingDeviceActivation(
            challengeId = json.getString("challengeId"),
            publicId = json.getString("publicId"),
            proofType = json.getString("proofType"),
            proof = json.getString("proof"),
        )
    }
}

data class DeviceContextView(
    val deviceId: String,
    val bindingId: String,
    val householdId: String,
    val recipientId: String,
    val recipientName: String,
    val timezone: String,
    val modelProvider: String,
    val modelName: String,
    val realtimeUrl: String,
    val consentDecisions: Map<String, Boolean>,
)

enum class DeviceMediaDirective { CONTINUE, STOP }

data class DeviceHeartbeatView(
    val online: Boolean,
    val serverTime: String,
    val mediaDirective: DeviceMediaDirective,
    val activeCompanionSessionId: String?,
    val reason: String?,
)

data class CompanionModelConnection(
    val companionSessionId: String,
    val modelSessionId: String,
    val realtimeUrl: String,
    val model: String,
    val systemPrompt: String,
    /** Whether a future provider-supplied USER/ASR transcript may be retained. */
    val userTranscriptionAllowed: Boolean,
)

data class RequestedRemoteMedia(
    val receiveDeviceAudio: Boolean = true,
    val receiveDeviceVideo: Boolean = true,
    val sendFamilyAudio: Boolean = true,
    val sendFamilyVideo: Boolean = false,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("receiveDeviceAudio", receiveDeviceAudio)
        .put("receiveDeviceVideo", receiveDeviceVideo)
        .put("sendFamilyAudio", sendFamilyAudio)
        .put("sendFamilyVideo", sendFamilyVideo)
}

data class RemoteSessionView(
    val id: String,
    val householdId: String,
    val recipientId: String,
    val bindingId: String,
    val status: String,
    val media: RequestedRemoteMedia,
    val requestedAt: String,
    val acceptedAt: String?,
    val connectedAt: String?,
    val endedAt: String?,
    val endReason: String?,
)

data class RemoteJoinTicket(
    val sessionId: String,
    val ticketId: String,
    val url: String,
    val token: String,
    val expiresAt: String,
    val media: RequestedRemoteMedia,
    val recording: Boolean,
    val transcription: Boolean,
)

data class LighthouseUiState(
    val restoring: Boolean = true,
    val busy: Boolean = false,
    val role: AppRole = AppRole.FAMILY,
    val signedIn: Boolean = false,
    val companionDeviceLocked: Boolean = false,
    val user: UserView? = null,
    val emailVerificationPromptVisible: Boolean = false,
    val households: List<HouseholdView> = emptyList(),
    val householdMembers: List<HouseholdMemberView> = emptyList(),
    val selectedHouseholdId: String? = null,
    val recipients: List<CareRecipientView> = emptyList(),
    val selectedRecipientId: String? = null,
    val bindings: List<CompanionBindingView> = emptyList(),
    val careAuthorities: List<CareAuthorityView> = emptyList(),
    val authoritiesLoadedRecipientId: String? = null,
    val memories: List<MemoryView> = emptyList(),
    val routines: List<RoutineView> = emptyList(),
    val occurrences: List<OccurrenceView> = emptyList(),
    val careEvents: List<CareEventView> = emptyList(),
    val familyTasks: List<FamilyTaskView> = emptyList(),
    val consents: List<ConsentStateView> = emptyList(),
    val activation: ActivationPresentation? = null,
    val activationApprovalDetails: ActivationApprovalDetails? = null,
    val pendingDeviceActivation: PendingDeviceActivation? = null,
    val deviceActivated: Boolean = false,
    val companionContext: DeviceContextView? = null,
    val incomingRemoteSession: RemoteSessionView? = null,
    val activeRemoteSession: RemoteSessionView? = null,
    val remoteCallFailureSessionId: String? = null,
    val remoteCallFailureTitle: String? = null,
    val remoteCallFailure: String? = null,
    val pendingSystemAnswerSessionId: String? = null,
    val aiScreenVisible: Boolean = false,
    val qrScannerVisible: Boolean = false,
    val apiBaseUrl: String = "",
    val message: String? = null,
    val error: String? = null,
) {
    val selectedHousehold: HouseholdView?
        get() = households.firstOrNull { it.id == selectedHouseholdId }

    val selectedRecipient: CareRecipientView?
        get() = recipients.firstOrNull { it.id == selectedRecipientId }
}
