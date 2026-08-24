package com.sun.minicpmo_android.lighthouse.data

import android.os.Build
import com.sun.minicpmo_android.BuildConfig
import com.sun.minicpmo_android.lighthouse.model.*
import com.sun.minicpmo_android.lighthouse.network.LighthouseApiException
import com.sun.minicpmo_android.lighthouse.network.LighthouseHttpClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicReference
import java.util.UUID
import java.util.Locale

internal fun deviceInstallationRegistrationPayload(
    installationPublicKeySpki: String,
    installationKeyAlgorithm: String,
    manufacturer: String,
    model: String,
    osVersion: String,
    appVersion: String,
): JSONObject = JSONObject()
    .put("installationPublicKeySpki", installationPublicKeySpki)
    .put("installationKeyAlgorithm", installationKeyAlgorithm)
    .put("keyProtection", "NON_EXPORTABLE_V1")
    .put("platform", "ANDROID")
    .put("manufacturer", manufacturer)
    .put("model", model)
    .put("osVersion", osVersion)
    .put("appVersion", appVersion)

class LighthouseRepository(
    private val settings: AppSettingsRepository,
    private val vault: CredentialVault,
    private val signer: DeviceProofSigner,
    httpClient: LighthouseHttpClient? = null,
) {
    private val http = httpClient ?: LighthouseHttpClient(settings::apiBaseUrl)
    private val userRefreshMutex = Mutex()
    private val deviceRefreshMutex = Mutex()
    private val explicitUserSessions = ExplicitUserSessionOwnership()
    private val activeCompanionSessionId = AtomicReference<String?>(null)
    private val careCommands = CareCommandRetrier(
        persistence = VaultCareCommandPersistence(vault),
        namespace = {
            vault.userCareNamespace()?.let { "user:$it" }.orEmpty()
        },
    )

    fun apiBaseUrl(): String = settings.apiBaseUrl()

    fun saveApiBaseUrl(value: String) = settings.saveApiBaseUrl(value)

    fun hasUserSession(): Boolean = vault.userSession() != null

    fun hasDeviceCredential(): Boolean = vault.deviceCredential() != null

    fun hasActiveCompanionSession(): Boolean = activeCompanionSessionId.get() != null

    fun pendingDeviceActivation(): PendingDeviceActivation? = vault.pendingDeviceActivation()

    suspend fun login(identifier: String, password: String): UserView {
        val ticket = beginExplicitUserSession()
        val result = requireNotNull(
            http.request(
                method = "POST",
                path = "auth/login",
                body = JSONObject()
                    .put("identifier", identifier.trim())
                    .put("password", password)
                    .put("clientType", "ANDROID"),
            ),
        )
        val session = parseUserSession(result)
        val user = fetchUser(session)
        commitExplicitUserSession(ticket, session, user)
        return user
    }

    suspend fun register(
        email: String?,
        username: String?,
        password: String,
        displayName: String,
    ): UserView {
        val ticket = beginExplicitUserSession()
        val body = JSONObject()
            .put("password", password)
            .put("displayName", displayName.trim())
            .put("clientType", "ANDROID")
        email?.trim()?.takeIf(String::isNotBlank)?.let { body.put("email", it) }
        username?.trim()?.takeIf(String::isNotBlank)?.let { body.put("username", it) }
        val result = requireNotNull(http.request("POST", "auth/register", body))
        val session = parseUserSession(result)
        val user = fetchUser(session)
        commitExplicitUserSession(ticket, session, user)
        return user
    }

    suspend fun requestEmailVerification(email: String, currentPassword: String? = null) {
        userRequest(
            "POST",
            AuthApiContract.emailVerificationsPath(),
            AuthApiContract.requestEmailVerificationBody(email, currentPassword),
        )
    }

    suspend fun confirmEmailVerification(email: String, code: String) {
        userRequest(
            "POST",
            AuthApiContract.confirmEmailVerificationPath(),
            AuthApiContract.confirmEmailVerificationBody(email, code),
        )
    }

    suspend fun logout(familyRemoteSession: RemoteSessionView? = null) {
        completeUserSessionRevocation(
            revocation = beginUserSessionRevocation(),
            familyRemoteSession = familyRemoteSession,
        )
    }

    suspend fun revokeUserSessionForCompanionMode() {
        // Device mode must stop retaining family authority before any network
        // wait. The server-side logout is best effort; the local refresh token
        // and every account-scoped pending command are already gone.
        completeUserSessionRevocation(beginUserSessionRevocation())
    }

    internal fun beginUserSessionRevocation(): UserSessionRevocation? =
        clearUserSession()?.let(::UserSessionRevocation)

    internal suspend fun completeUserSessionRevocation(
        revocation: UserSessionRevocation?,
        familyRemoteSession: RemoteSessionView? = null,
    ) {
        val session = revocation?.session ?: return
        revokeCapturedUserSession(session) { accessToken ->
            familyRemoteSession?.let { remote ->
                http.request(
                    "POST",
                    "households/${remote.householdId}/remote-sessions/${remote.id}/end",
                    JSONObject(),
                    accessToken,
                )
            }
        }
    }

    suspend fun restoreUser(): UserView? {
        val ticket = explicitUserSessions.snapshot()
        if (!hasUserSession()) return null
        return runCatching { getMe() }.getOrElse {
            if (it is LighthouseApiException && it.status == 401) {
                if (it.code == "SIGNED_OUT" && vault.userSession() == null) {
                    return@getOrElse null
                }
                val cleared = explicitUserSessions.invalidateIfCurrent(ticket) {
                    clearUserSessionStorage()
                }
                if (cleared) null else throw ExplicitUserSessionSupersededException()
            } else {
                throw it
            }
        }
    }

    suspend fun getMe(): UserView {
        val ticket = explicitUserSessions.snapshot()
        val user = parseUser(requireNotNull(userRequest("GET", "me")))
        val committed = explicitUserSessions.commitIfCurrent(ticket) {
            saveUserCareNamespace(user)
        }
        if (!committed) throw ExplicitUserSessionSupersededException()
        return user
    }

    suspend fun listHouseholds(): List<HouseholdView> =
        arrayData(userRequest("GET", "households")).mapObjects(::parseHousehold)

    suspend fun createHousehold(name: String, timezone: String): HouseholdView =
        FamilyJsonMapper.parseHousehold(
            requireNotNull(
                userRequest(
                    "POST",
                    FamilyApiContract.householdsPath(),
                    FamilyApiContract.createHouseholdBody(name, timezone),
                ),
            ),
        )

    suspend fun listRecipients(householdId: String): List<CareRecipientView> =
        arrayData(userRequest("GET", "households/$householdId/care-recipients"))
            .mapObjects(::parseRecipient)

    suspend fun listHouseholdMembers(householdId: String): List<HouseholdMemberView> =
        arrayData(userRequest("GET", FamilyApiContract.householdMembersPath(householdId)))
            .mapObjects(FamilyJsonMapper::parseHouseholdMember)

    suspend fun updateHouseholdMember(
        householdId: String,
        member: HouseholdMemberView,
        roleCodes: Set<String>,
        currentPassword: String,
    ): HouseholdMemberView {
        require(currentPassword.isNotEmpty()) { "请输入当前账号密码以确认角色变更" }
        return FamilyJsonMapper.parseHouseholdMember(
            requireNotNull(
                userRequest(
                    "PATCH",
                    FamilyApiContract.householdMemberPath(householdId, member.id),
                    FamilyApiContract.updateHouseholdMemberBody(
                        roleCodes,
                        member.version,
                        currentPassword,
                    ),
                ),
            ),
        )
    }

    suspend fun removeHouseholdMember(
        householdId: String,
        member: HouseholdMemberView,
        currentPassword: String,
    ) {
        require(currentPassword.isNotEmpty()) { "请输入当前账号密码以确认移除成员" }
        userRequest(
            "DELETE",
            FamilyApiContract.removeHouseholdMemberPath(
                householdId,
                member.id,
                member.version,
            ),
            FamilyApiContract.removeHouseholdMemberBody(currentPassword),
        )
    }

    suspend fun listCareAuthorities(
        householdId: String,
        recipientId: String,
    ): List<CareAuthorityView> = arrayData(
        userRequest("GET", FamilyApiContract.careAuthoritiesPath(householdId, recipientId)),
    ).mapObjects(FamilyJsonMapper::parseCareAuthority)

    suspend fun putCareAuthority(
        householdId: String,
        recipientId: String,
        memberId: String,
        input: CareAuthorityInput,
        currentPassword: String,
    ): CareAuthorityView {
        require(currentPassword.isNotEmpty()) { "请输入当前账号密码以确认权限变更" }
        return FamilyJsonMapper.parseCareAuthority(
            requireNotNull(
                userRequest(
                    "PUT",
                    FamilyApiContract.careAuthorityPath(householdId, recipientId, memberId),
                    FamilyApiContract.careAuthorityBody(input, currentPassword),
                ),
            ),
        )
    }

    suspend fun createRecipient(
        householdId: String,
        input: CareRecipientInput,
    ): CareRecipientView = FamilyJsonMapper.parseRecipient(
        requireNotNull(
            userRequest(
                "POST",
                FamilyApiContract.recipientsPath(householdId),
                FamilyApiContract.createRecipientBody(input),
            ),
        ),
    )

    suspend fun listMemories(householdId: String, recipientId: String): List<MemoryView> {
        val page = requireNotNull(
            userRequest("GET", FamilyApiContract.memoriesPath(householdId, recipientId)),
        )
        return (page.optJSONArray("items") ?: JSONArray()).mapObjects(FamilyJsonMapper::parseMemory)
    }

    suspend fun createMemory(
        householdId: String,
        recipientId: String,
        input: MemoryInput,
    ): MemoryView = FamilyJsonMapper.parseMemory(
        requireNotNull(
            userRequest(
                "POST",
                FamilyApiContract.createMemoryPath(householdId, recipientId),
                FamilyApiContract.createMemoryBody(input),
            ),
        ),
    )

    suspend fun updateMemory(
        householdId: String,
        memory: MemoryView,
        input: MemoryInput,
    ): MemoryView = FamilyJsonMapper.parseMemory(
        requireNotNull(
            userRequest(
                "PATCH",
                FamilyApiContract.memoryPath(householdId, memory.id),
                FamilyApiContract.updateMemoryBody(input, memory.version),
            ),
        ),
    )

    suspend fun deleteMemory(householdId: String, memory: MemoryView) {
        userRequest(
            "DELETE",
            FamilyApiContract.deleteMemoryPath(householdId, memory.id, memory.version),
        )
    }

    suspend fun listRoutines(householdId: String, recipientId: String): List<RoutineView> =
        FamilyJsonMapper.parseArray(
            userRequest("GET", FamilyApiContract.routinesPath(householdId, recipientId)),
        ).mapObjects(FamilyJsonMapper::parseRoutine)

    suspend fun createRoutine(
        householdId: String,
        recipientId: String,
        input: RoutineInput,
    ): RoutineView = FamilyJsonMapper.parseRoutine(
        requireNotNull(
            userRequest(
                "POST",
                FamilyApiContract.routinesPath(householdId, recipientId),
                FamilyApiContract.createRoutineBody(input),
            ),
        ),
    )

    suspend fun updateRoutine(
        householdId: String,
        routine: RoutineView,
        input: RoutineInput,
    ): RoutineView = FamilyJsonMapper.parseRoutine(
        requireNotNull(
            userRequest(
                "PATCH",
                FamilyApiContract.routinePath(householdId, routine.id),
                FamilyApiContract.updateRoutineBody(input, routine.version),
            ),
        ),
    )

    suspend fun deleteRoutine(householdId: String, routine: RoutineView) {
        userRequest(
            "DELETE",
            FamilyApiContract.deleteRoutinePath(householdId, routine.id, routine.version),
        )
    }

    suspend fun listOccurrences(
        householdId: String,
        recipientId: String,
        from: String,
        to: String,
    ): List<OccurrenceView> = FamilyJsonMapper.parseArray(
        userRequest(
            "GET",
            FamilyApiContract.occurrencesPath(householdId, recipientId, from, to),
        ),
    ).mapObjects(FamilyJsonMapper::parseOccurrence)

    suspend fun listCareEvents(householdId: String, recipientId: String): List<CareEventView> =
        FamilyJsonMapper.parseArray(
            userRequest("GET", FamilyApiContract.careEventsPath(householdId, recipientId)),
        ).mapObjects(FamilyJsonMapper::parseCareEvent)

    suspend fun listFamilyTasks(householdId: String, recipientId: String): List<FamilyTaskView> =
        FamilyJsonMapper.parseArray(
            userRequest("GET", FamilyApiContract.familyTasksPath(householdId, recipientId)),
        ).mapObjects(FamilyJsonMapper::parseFamilyTask)

    suspend fun familyVerifyOccurrence(
        householdId: String,
        occurrence: OccurrenceView,
        verified: Boolean,
        note: String?,
    ): OccurrenceView {
        val normalizedNote = note?.trim()?.takeIf(String::isNotBlank)
        val normalizedCommand = JSONArray()
            .put("family-verify")
            .put(householdId)
            .put(occurrence.id)
            .put(occurrence.version)
            .put(verified)
            .put(normalizedNote ?: JSONObject.NULL)
            .toString()
        return careCommands.execute(normalizedCommand) { idempotencyKey ->
            FamilyJsonMapper.parseOccurrence(
                requireNotNull(
                    userRequest(
                        "POST",
                        FamilyApiContract.familyVerifyPath(householdId, occurrence.id),
                        FamilyApiContract.familyVerifyBody(
                            version = occurrence.version,
                            idempotencyKey = idempotencyKey,
                            verified = verified,
                            note = normalizedNote,
                        ),
                        headers = mapOf("Idempotency-Key" to idempotencyKey),
                    ),
                ),
            )
        }
    }

    suspend fun claimFamilyTask(householdId: String, task: FamilyTaskView): FamilyTaskView {
        val normalizedCommand = JSONArray()
            .put("family-task-claim")
            .put(householdId)
            .put(task.id)
            .put(task.version)
            .toString()
        return careCommands.execute(normalizedCommand) { idempotencyKey ->
            FamilyJsonMapper.parseFamilyTask(
                requireNotNull(
                    userRequest(
                        "POST",
                        FamilyApiContract.familyTaskActionPath(householdId, task.id, "claim"),
                        FamilyApiContract.claimTaskBody(task.version),
                        headers = mapOf("Idempotency-Key" to idempotencyKey),
                    ),
                ),
            )
        }
    }

    suspend fun finishFamilyTask(
        householdId: String,
        task: FamilyTaskView,
        resolve: Boolean,
        note: String?,
    ): FamilyTaskView {
        val action = if (resolve) "resolve" else "dismiss"
        val resolutionCode = if (resolve) "FAMILY_CONFIRMED" else "NOT_ACTIONABLE"
        val normalizedNote = note?.trim()?.takeIf(String::isNotBlank)
        val normalizedCommand = JSONArray()
            .put("family-task-$action")
            .put(householdId)
            .put(task.id)
            .put(task.version)
            .put(resolutionCode)
            .put(normalizedNote ?: JSONObject.NULL)
            .toString()
        return careCommands.execute(normalizedCommand) { idempotencyKey ->
            FamilyJsonMapper.parseFamilyTask(
                requireNotNull(
                    userRequest(
                        "POST",
                        FamilyApiContract.familyTaskActionPath(householdId, task.id, action),
                        FamilyApiContract.finishTaskBody(
                            task.version,
                            resolutionCode,
                            normalizedNote,
                        ),
                        headers = mapOf("Idempotency-Key" to idempotencyKey),
                    ),
                ),
            )
        }
    }

    suspend fun listConsents(householdId: String, recipientId: String): List<ConsentStateView> =
        FamilyJsonMapper.parseArray(
            userRequest("GET", FamilyApiContract.consentsPath(householdId, recipientId)),
        ).mapObjects(FamilyJsonMapper::parseConsentState)

    suspend fun decideConsent(
        householdId: String,
        recipientId: String,
        current: ConsentStateView,
        grant: Boolean,
    ): ConsentEventView {
        val definition = ConsentCatalog.definition(current.scope)
        val documentVersionId = current.lastEvent?.documentVersion?.id ?: definition.documentVersionId
        return FamilyJsonMapper.parseConsentEvent(
            requireNotNull(
                userRequest(
                    "POST",
                    FamilyApiContract.consentDecisionPath(
                        householdId,
                        recipientId,
                        current.scope,
                        grant,
                    ),
                    FamilyApiContract.consentDecisionBody(
                        documentVersionId,
                        if (grant) "家属在 Android 隐私中心明确授权" else "家属在 Android 隐私中心主动撤回",
                    ),
                    mapOf("Idempotency-Key" to UUID.randomUUID().toString()),
                ),
            ),
        )
    }

    suspend fun listBindings(householdId: String): List<CompanionBindingView> =
        arrayData(userRequest("GET", "households/$householdId/companion-bindings"))
            .mapObjects(::parseBinding)

    suspend fun revokeBinding(
        householdId: String,
        bindingId: String,
        reasonCode: String?,
        currentPassword: String,
    ) {
        require(currentPassword.isNotEmpty()) { "请输入当前账号密码以确认解绑设备" }
        userRequest(
            "DELETE",
            FamilyApiContract.revokeBindingPath(householdId, bindingId),
            FamilyApiContract.revokeBindingBody(reasonCode, currentPassword),
        )
    }

    suspend fun createActivationChallenge(
        householdId: String,
        recipientId: String,
    ): ActivationPresentation = parseActivation(
        requireNotNull(
            userRequest(
                "POST",
                "households/$householdId/care-recipients/$recipientId/activation-challenges",
                JSONObject(),
            ),
        ),
    )

    suspend fun activationApprovalDetails(challengeId: String): ActivationApprovalDetails =
        parseActivationApprovalDetails(
            requireNotNull(
                userRequest("GET", "activation-challenges/$challengeId/approval-details"),
            ),
        )

    suspend fun approveActivation(challengeId: String, claimSnapshotToken: String) {
        userRequest(
            "POST",
            "activation-challenges/$challengeId/approve",
            JSONObject().put("claimSnapshotToken", claimSnapshotToken),
            headers = mapOf("Idempotency-Key" to UUID.randomUUID().toString()),
        )
    }

    suspend fun ensureDeviceInstallation(): DeviceInstallation {
        val installationPublicKeySpki = signer.publicKeySpki()
        val keyFingerprint = signer.publicKeyFingerprint()
        val installationKeyAlgorithm = signer.keyAlgorithm().protocolId
        vault.deviceInstallation()
            ?.takeIf {
                it.keyFingerprint == keyFingerprint &&
                    it.installationKeyAlgorithm == installationKeyAlgorithm &&
                    it.protocolVersion == "NON_EXPORTABLE_V1"
            }
            ?.let { return it }
        val result = requireNotNull(
            http.request(
                "POST",
                "device-installations",
                deviceInstallationRegistrationPayload(
                    installationPublicKeySpki = installationPublicKeySpki,
                    installationKeyAlgorithm = installationKeyAlgorithm,
                    manufacturer = Build.MANUFACTURER.take(100),
                    model = Build.MODEL.take(100),
                    osVersion = Build.VERSION.RELEASE.take(64),
                    appVersion = BuildConfig.VERSION_NAME.take(32),
                ),
            ),
        )
        val installation = DeviceInstallation(
            installationId = result.getString("installationId"),
            serverNonce = result.getString("serverNonce"),
            keyFingerprint = result.getString("keyFingerprint"),
            installationKeyAlgorithm = installationKeyAlgorithm,
            protocolVersion = "NON_EXPORTABLE_V1",
        )
        vault.saveDeviceInstallation(installation)
        return installation
    }

    suspend fun claimActivation(
        publicId: String,
        proofType: ActivationProofType,
        proof: String,
    ): PendingDeviceActivation {
        val normalizedPublicId = publicId.trim().uppercase(Locale.ROOT)
        val normalizedProof = DeviceProofProtocol.normalizeProof(proofType, proof)
        val installation = ensureDeviceInstallation()
        val signature = signer.sign(
            DeviceProofProtocol.claimMessage(
                publicId = normalizedPublicId,
                installationId = installation.installationId,
                serverNonce = installation.serverNonce,
                proofType = proofType,
                proof = normalizedProof,
            ),
        )
        val result = requireNotNull(
            http.request(
                "POST",
                "activation-challenges/$normalizedPublicId/claim",
                JSONObject()
                    .put("installationId", installation.installationId)
                    .put("serverNonce", installation.serverNonce)
                    .put("proofType", proofType.name)
                    .put("proof", normalizedProof)
                    .put("signature", signature),
            ),
        )
        return PendingDeviceActivation(
            challengeId = result.getString("challengeId"),
            publicId = normalizedPublicId,
            proofType = proofType.name,
            proof = normalizedProof,
        ).also(vault::savePendingDeviceActivation)
    }

    fun abandonPendingDeviceActivation() = vault.savePendingDeviceActivation(null)

    suspend fun exchangeApprovedActivation(
        pending: PendingDeviceActivation,
    ): ActivationExchangeOutcome {
        val status = requireNotNull(
            http.request("GET", "activation-challenges/${pending.challengeId}"),
        )
        val activationStatus = status.getString("status")
        when (activationChallengeDisposition(activationStatus)) {
            ActivationChallengeDisposition.WAITING -> return ActivationExchangeOutcome.Waiting
            ActivationChallengeDisposition.TERMINAL -> {
                abandonPendingDeviceActivation()
                return ActivationExchangeOutcome.Terminal(
                    status = activationStatus,
                    message = activationTerminalMessage(activationStatus),
                )
            }
            ActivationChallengeDisposition.INVALID ->
                error("服务端返回了未知的设备激活状态：$activationStatus")
            ActivationChallengeDisposition.EXCHANGE -> Unit
        }
        val approvedAt = status.optString("approvedAt").takeIf(String::isNotBlank)
            ?: error("设备激活响应缺少批准时间")
        val installation = requireNotNull(vault.deviceInstallation())
        val recoveryToken = if (activationStatus == "CONSUMED") {
            status.optString("recoveryToken").takeIf(String::isNotBlank)
                ?: error("设备凭据恢复响应缺少恢复令牌")
        } else {
            null
        }
        val signature = signer.sign(
            recoveryToken?.let {
                DeviceProofProtocol.exchangeRecoveryMessage(
                    challengeId = pending.challengeId,
                    installationId = installation.installationId,
                    recoveryToken = it,
                )
            } ?: DeviceProofProtocol.exchangeMessage(
                challengeId = pending.challengeId,
                installationId = installation.installationId,
                approvedAt = approvedAt,
            ),
        )
        val exchangeBody = JSONObject()
            .put("challengeId", pending.challengeId)
            .put("installationId", installation.installationId)
            .put("signature", signature)
        recoveryToken?.let { exchangeBody.put("recoveryToken", it) }
        val result = requireNotNull(
            http.request(
                "POST",
                "device-credentials/exchange",
                exchangeBody,
            ),
        )
        val credential = parseDeviceCredential(result).also {
            vault.saveDeviceCredential(it)
            vault.savePendingDeviceActivation(null)
        }
        return ActivationExchangeOutcome.Activated(credential)
    }

    suspend fun getDeviceContext(): DeviceContextView = parseDeviceContext(
        requireNotNull(deviceRequest("GET", "device/context")),
    )

    suspend fun heartbeat(): DeviceHeartbeatView {
        val localActiveSessionId = activeCompanionSessionId.get()
        val body = JSONObject()
            .put("appVersion", BuildConfig.VERSION_NAME)
            .put("osVersion", Build.VERSION.RELEASE)
        localActiveSessionId?.let { body.put("activeCompanionSessionId", it) }
        val result = requireNotNull(deviceRequest("POST", "device/heartbeats", body))
        return DeviceHeartbeatView(
            online = result.optBoolean("online", false),
            serverTime = result.getString("serverTime"),
            mediaDirective = DeviceMediaDirective.valueOf(
                result.optString("mediaDirective", "CONTINUE"),
            ),
            activeCompanionSessionId = result.optNullableString(
                "activeCompanionSessionId",
            ),
            reason = result.optNullableString("reason"),
        ).also { heartbeat ->
            if (heartbeat.mediaDirective == DeviceMediaDirective.STOP) {
                localActiveSessionId?.let(::clearActiveCompanionSession)
            }
        }
    }

    suspend fun startCompanionModel(mode: String): CompanionModelConnection {
        val companion = requireNotNull(
            deviceRequest(
                "POST",
                "device/companion-sessions",
                JSONObject().put("mode", mode),
                mapOf("Idempotency-Key" to UUID.randomUUID().toString()),
            ),
        )
        val companionSessionId = companion.getJSONObject("session").getString("id")
        val model = requireNotNull(
            deviceRequest(
                "POST",
                "device/companion-sessions/$companionSessionId/model-sessions",
                JSONObject(),
                mapOf("Idempotency-Key" to UUID.randomUUID().toString()),
            ),
        )
        val decisions = model.getJSONObject("consent").getJSONObject("decisions")
        val prompt = model.getJSONObject("prompt")
        val careSnapshot = model.optJSONObject("careSnapshot")
        return CompanionModelConnection(
            companionSessionId = companionSessionId,
            modelSessionId = model.getJSONObject("session").getString("id"),
            realtimeUrl = model.getJSONObject("connection").getString("realtimeUrl"),
            model = model.getJSONObject("connection").getString("model"),
            systemPrompt = prompt.getString("content"),
            userTranscriptionAllowed = decisions.optBoolean(
                "MODEL_INPUT_TRANSCRIPTION",
                false,
            ),
            promptVersion = prompt.optInt("version").takeIf { it > 0 },
            memoryCount = careSnapshot?.optJSONArray("memories")?.length(),
            routineCount = careSnapshot?.optJSONArray("occurrences")?.length(),
        ).also { activeCompanionSessionId.set(companionSessionId) }
    }

    suspend fun appendModelEvent(
        modelSessionId: String,
        eventType: String,
        metrics: Map<String, Number>? = null,
        errorCode: String? = null,
    ) {
        val body = JSONObject().put("eventType", eventType)
        metrics?.let { values ->
            body.put("metrics", JSONObject().apply { values.forEach { (k, v) -> put(k, v) } })
        }
        errorCode?.let { body.put("errorCode", it.take(64)) }
        deviceRequest("POST", "device/model-sessions/$modelSessionId/events", body)
    }

    suspend fun appendAssistantUtterance(
        modelSessionId: String,
        sequenceNo: Int,
        providerEventId: String,
        rawText: String,
    ) {
        deviceRequest(
            "POST",
            "device/model-sessions/$modelSessionId/utterances",
            JSONObject()
                .put("sequenceNo", sequenceNo)
                .put("speaker", "ASSISTANT")
                .put("source", "MODEL")
                .put("providerEventId", providerEventId.take(200))
                .put("rawText", rawText.take(20_000))
                .put("isFinal", true)
                .put("language", "zh-CN"),
        )
    }

    suspend fun endCompanionSession(companionSessionId: String, reason: String) {
        try {
            deviceRequest(
                "POST",
                "device/companion-sessions/$companionSessionId/end",
                JSONObject().put("reason", reason.take(64)),
            )
        } finally {
            clearActiveCompanionSession(companionSessionId)
        }
    }

    fun clearActiveCompanionSession(companionSessionId: String) {
        activeCompanionSessionId.compareAndSet(companionSessionId, null)
    }

    fun clearActiveCompanionSessionTracking() {
        activeCompanionSessionId.set(null)
    }

    suspend fun requestRemoteSession(
        householdId: String,
        bindingId: String,
        idempotencyKey: String,
        media: RequestedRemoteMedia = RequestedRemoteMedia(),
    ): RemoteSessionView = parseRemoteSession(
        requireNotNull(
            userRequest(
                "POST",
                "households/$householdId/remote-sessions",
                JSONObject().put("bindingId", bindingId).put("media", media.toJson()),
                mapOf("Idempotency-Key" to idempotencyKey),
            ),
        ),
    )

    suspend fun getFamilyRemoteSession(
        householdId: String,
        sessionId: String,
    ): RemoteSessionView = parseRemoteSession(
        requireNotNull(userRequest("GET", "households/$householdId/remote-sessions/$sessionId")),
    )

    suspend fun currentDeviceRemoteSession(): RemoteSessionView? =
        deviceRequest("GET", "device/remote-sessions/current")?.let(::parseRemoteSession)

    suspend fun acceptDeviceRemoteSession(sessionId: String): RemoteSessionView =
        parseRemoteSession(
            requireNotNull(deviceRequest("POST", "device/remote-sessions/$sessionId/accept", JSONObject())),
        )

    suspend fun declineDeviceRemoteSession(sessionId: String): RemoteSessionView =
        parseRemoteSession(
            requireNotNull(deviceRequest("POST", "device/remote-sessions/$sessionId/decline", JSONObject())),
        )

    suspend fun endDeviceRemoteSession(sessionId: String) {
        deviceRequest("POST", "device/remote-sessions/$sessionId/end", JSONObject())
    }

    suspend fun endFamilyRemoteSession(householdId: String, sessionId: String) {
        userRequest("POST", "households/$householdId/remote-sessions/$sessionId/end", JSONObject())
    }

    suspend fun cancelFamilyRemoteSession(householdId: String, sessionId: String) {
        userRequest("POST", "households/$householdId/remote-sessions/$sessionId/cancel", JSONObject())
    }

    suspend fun familyJoinTicket(householdId: String, sessionId: String): RemoteJoinTicket =
        parseJoinTicket(
            requireNotNull(
                userRequest(
                    "POST",
                    "households/$householdId/remote-sessions/$sessionId/join-ticket",
                    JSONObject().put("clientType", "ANDROID"),
                ),
            ),
        )

    suspend fun deviceJoinTicket(sessionId: String): RemoteJoinTicket = parseJoinTicket(
        requireNotNull(
            deviceRequest(
                "POST",
                "device/remote-sessions/$sessionId/join-ticket",
                JSONObject().put("clientType", "ANDROID"),
            ),
        ),
    )

    suspend fun remoteHeartbeat(sessionId: String) {
        deviceRequest("POST", "device/remote-sessions/$sessionId/heartbeat", JSONObject())
    }

    private suspend fun userRequest(
        method: String,
        path: String,
        body: JSONObject? = null,
        headers: Map<String, String> = emptyMap(),
    ): JSONObject? {
        val ticket = explicitUserSessions.snapshot()
        val session = vault.userSession() ?: throw LighthouseApiException(401, "SIGNED_OUT", "请先登录")
        requireCurrentExplicitUserSession(ticket)
        return try {
            http.request(method, path, body, session.accessToken, headers).also {
                requireCurrentExplicitUserSession(ticket)
            }
        } catch (error: LighthouseApiException) {
            requireCurrentExplicitUserSession(ticket)
            if (error.status != 401) throw error
            val refreshed = refreshUserSession(ticket, session.refreshToken)
            requireCurrentExplicitUserSession(ticket)
            http.request(method, path, body, refreshed.accessToken, headers).also {
                requireCurrentExplicitUserSession(ticket)
            }
        }
    }

    private suspend fun refreshUserSession(
        ticket: ExplicitUserSessionTicket,
        previousRefreshToken: String,
    ): UserSession {
        return userRefreshMutex.withLock {
            if (!explicitUserSessions.isCurrent(ticket)) {
                throw ExplicitUserSessionSupersededException()
            }
            val current = vault.userSession() ?: throw LighthouseApiException(401, "SIGNED_OUT", "请重新登录")
            if (current.refreshToken != previousRefreshToken) return@withLock current
            val result = try {
                requireNotNull(
                    http.request(
                        "POST",
                        "auth/refresh",
                        JSONObject()
                            .put("clientType", "ANDROID")
                            .put("refreshToken", current.refreshToken),
                    ),
                )
            } catch (error: LighthouseApiException) {
                if (error.status == 401) {
                    val cleared = explicitUserSessions.invalidateIfCurrent(
                        ticket = ticket,
                        shouldInvalidate = {
                            vault.userSession()?.refreshToken == previousRefreshToken
                        },
                        clearSession = ::clearUserSessionStorage,
                    )
                    if (!cleared) throw ExplicitUserSessionSupersededException()
                    throw LighthouseApiException(
                        status = 401,
                        code = "SIGNED_OUT",
                        message = "登录已过期，请重新登录",
                        requestId = error.requestId,
                    )
                }
                throw error
            }
            val refreshed = parseUserSession(result)
            var sessionStillMatches = false
            val committed = explicitUserSessions.commitIfCurrent(ticket) {
                sessionStillMatches = vault.userSession()?.refreshToken == previousRefreshToken
                if (sessionStillMatches) replaceUserSession(refreshed)
            }
            if (!committed || !sessionStillMatches) {
                revokeCapturedUserSession(refreshed)
                throw ExplicitUserSessionSupersededException()
            }
            refreshed
        }
    }

    private fun replaceUserSession(session: UserSession) {
        // Refresh-token rotation changes the server session ID. Pending care
        // commands are account-scoped and must survive that normal rotation.
        vault.saveUserSession(session)
    }

    private fun saveUserCareNamespace(user: UserView) {
        val previous = vault.userCareNamespace()
        if (previous != null && previous != user.id) {
            vault.saveCareCommandState(null)
        }
        vault.saveUserCareNamespace(user.id)
    }

    private fun beginExplicitUserSession(): ExplicitUserSessionTicket =
        explicitUserSessions.begin {
            // A deliberate sign-in/register action replaces any previous
            // account intent. Token refresh never enters this boundary.
            clearUserSessionStorage()
        }

    private fun clearUserSession(): UserSession? = explicitUserSessions.invalidate {
        val previous = vault.userSession()
        // Logout/terminal refresh failure is an explicit abandonment boundary.
        // Remove access/refresh authority before ancillary retry metadata.
        clearUserSessionStorage()
        previous
    }

    private fun clearUserSessionStorage() {
        vault.saveUserSession(null)
        vault.saveCareCommandState(null)
        vault.saveUserCareNamespace(null)
    }

    private fun requireCurrentExplicitUserSession(ticket: ExplicitUserSessionTicket) {
        if (!explicitUserSessions.isCurrent(ticket)) {
            throw ExplicitUserSessionSupersededException()
        }
    }

    private suspend fun revokeCapturedUserSession(
        session: UserSession,
        beforeLogout: (suspend (String) -> Unit)? = null,
    ) {
        var cleanupComplete = beforeLogout == null

        suspend fun runCleanup(accessToken: String) {
            if (cleanupComplete) return
            try {
                requireNotNull(beforeLogout).invoke(accessToken)
                cleanupComplete = true
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Throwable) {
                // Retry once if an expired access token can be refreshed.
            }
        }

        runCleanup(session.accessToken)
        try {
            http.request("POST", "auth/logout", JSONObject(), session.accessToken)
            return
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Throwable) {
            if (error !is LighthouseApiException || error.status != 401) return
        }

        val refreshed = try {
            parseUserSession(
                requireNotNull(
                    http.request(
                        "POST",
                        "auth/refresh",
                        JSONObject()
                            .put("clientType", "ANDROID")
                            .put("refreshToken", session.refreshToken),
                    ),
                ),
            )
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Throwable) {
            // A replayed rotated token revokes the whole server-side family;
            // transport failures fall back to server expiry.
            return
        }

        runCleanup(refreshed.accessToken)
        try {
            http.request("POST", "auth/logout", JSONObject(), refreshed.accessToken)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Throwable) {
            // Local authority is already gone. Server expiry remains the final
            // fallback when this best-effort revocation cannot be delivered.
        }
    }

    private suspend fun fetchUser(session: UserSession): UserView = parseUser(
        requireNotNull(http.request("GET", "me", bearerToken = session.accessToken)),
    )

    private fun commitExplicitUserSession(
        ticket: ExplicitUserSessionTicket,
        session: UserSession,
        user: UserView,
    ) {
        val committed = explicitUserSessions.commitIfCurrent(ticket) {
            replaceUserSession(session)
            saveUserCareNamespace(user)
        }
        if (!committed) throw ExplicitUserSessionSupersededException()
    }

    private suspend fun deviceRequest(
        method: String,
        path: String,
        body: JSONObject? = null,
        headers: Map<String, String> = emptyMap(),
    ): JSONObject? {
        val credential = vault.deviceCredential()
            ?: throw LighthouseApiException(401, "DEVICE_NOT_ACTIVATED", "请先激活陪伴设备")
        return try {
            http.request(method, path, body, credential.accessToken, headers)
        } catch (error: LighthouseApiException) {
            if (error.status != 401) throw error
            val refreshed = refreshDeviceCredential(credential)
            http.request(method, path, body, refreshed.accessToken, headers)
        }
    }

    private suspend fun refreshDeviceCredential(previous: DeviceCredential): DeviceCredential =
        deviceRefreshMutex.withLock {
            val current = vault.deviceCredential()
                ?: throw LighthouseApiException(401, "DEVICE_NOT_ACTIVATED", "请重新激活设备")
            if (current.credential != previous.credential) return@withLock current
            val signature = signer.sign(
                DeviceProofProtocol.refreshMessage(
                    credentialId = current.credentialId,
                    bindingId = current.bindingId,
                    credential = current.credential,
                ),
            )
            val result = try {
                requireNotNull(
                    http.request(
                        "POST",
                        "device-auth/refresh",
                        JSONObject()
                            .put("credential", current.credential)
                            .put("signature", signature),
                    ),
                )
            } catch (error: LighthouseApiException) {
                if (error.status == 401) {
                    vault.saveDeviceCredential(null)
                    throw LighthouseApiException(
                        status = 401,
                        code = "DEVICE_NOT_ACTIVATED",
                        message = "陪伴设备凭据已失效，请重新激活",
                        requestId = error.requestId,
                    )
                }
                throw error
            }
            parseDeviceCredential(result).also(vault::saveDeviceCredential)
        }

    private fun parseUserSession(json: JSONObject) = UserSession(
        accessToken = json.getString("accessToken"),
        accessTokenExpiresAt = json.getString("accessTokenExpiresAt"),
        refreshToken = json.getString("refreshToken"),
        refreshTokenExpiresAt = json.getString("refreshTokenExpiresAt"),
        sessionId = json.getString("sessionId"),
    )

    private fun parseUser(json: JSONObject): UserView {
        val identities = json.optJSONArray("identities") ?: JSONArray()
        val identityObjects = identities.objects()
        val primary = identityObjects.firstOrNull { it.optBoolean("isPrimary") }
        val email = identityObjects.firstOrNull { it.optString("type") == "EMAIL" }
        return UserView(
            id = json.getString("id"),
            displayName = json.getString("displayName"),
            status = json.getString("status"),
            primaryIdentity = primary?.optString("value")?.takeIf(String::isNotBlank),
            email = email?.optString("value")?.takeIf(String::isNotBlank),
            emailVerified = email != null && !email.isNull("verifiedAt"),
        )
    }

    private fun parseHousehold(json: JSONObject) = FamilyJsonMapper.parseHousehold(json)

    private fun parseRecipient(json: JSONObject) = FamilyJsonMapper.parseRecipient(json)

    private fun parseBinding(json: JSONObject) = CompanionBindingView(
        id = json.getString("id"),
        deviceId = json.getString("deviceId"),
        householdId = json.getString("householdId"),
        recipientId = json.getString("recipientId"),
        displayName = json.getString("displayName"),
        status = json.getString("status"),
        version = json.getInt("version"),
    )

    private fun parseActivation(json: JSONObject) = ActivationPresentation(
        challengeId = json.getString("challengeId"),
        publicId = json.getString("publicId"),
        dynamicCode = json.getString("dynamicCode"),
        qrPayload = json.getString("qrPayload"),
        expiresAt = json.getString("expiresAt"),
    )

    private fun parseActivationApprovalDetails(json: JSONObject): ActivationApprovalDetails {
        val device = json.getJSONObject("device")
        return ActivationApprovalDetails(
            challengeId = json.getString("challengeId"),
            claimedAt = json.getString("claimedAt"),
            claimNetworkSource = json.getString("claimNetworkSource"),
            claimSnapshotToken = json.getString("claimSnapshotToken"),
            device = ActivationApprovalDevice(
                platform = device.getString("platform"),
                installationKeyAlgorithm = device.getString("installationKeyAlgorithm"),
                manufacturer = device.optNullableString("manufacturer"),
                model = device.optNullableString("model"),
                osVersion = device.optNullableString("osVersion"),
                appVersion = device.optNullableString("appVersion"),
                keyFingerprintSuffix = device.getString("keyFingerprintSuffix"),
            ),
        )
    }

    private fun parseDeviceCredential(json: JSONObject) = DeviceCredential(
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

    private fun parseDeviceContext(json: JSONObject): DeviceContextView {
        val recipient = json.getJSONObject("recipient")
        val model = json.getJSONObject("model")
        val decisionsJson = json.getJSONObject("consent").getJSONObject("decisions")
        val decisions = decisionsJson.keys().asSequence().associateWith(decisionsJson::optBoolean)
        return DeviceContextView(
            deviceId = json.getString("deviceId"),
            bindingId = json.getString("bindingId"),
            householdId = json.getString("householdId"),
            recipientId = json.getString("recipientId"),
            recipientName = recipient.getString("preferredName"),
            timezone = recipient.getString("timezone"),
            modelProvider = model.getString("provider"),
            modelName = model.getString("model"),
            realtimeUrl = model.getString("realtimeUrl"),
            consentDecisions = decisions,
        )
    }

    private fun parseRemoteSession(json: JSONObject): RemoteSessionView {
        val mediaJson = json.getJSONObject("media")
        return RemoteSessionView(
            id = json.getString("id"),
            householdId = json.getString("householdId"),
            recipientId = json.getString("recipientId"),
            bindingId = json.getString("bindingId"),
            status = json.getString("status"),
            media = RequestedRemoteMedia(
                receiveDeviceAudio = mediaJson.getBoolean("receiveDeviceAudio"),
                receiveDeviceVideo = mediaJson.getBoolean("receiveDeviceVideo"),
                sendFamilyAudio = mediaJson.getBoolean("sendFamilyAudio"),
                sendFamilyVideo = mediaJson.getBoolean("sendFamilyVideo"),
            ),
            requestedAt = json.getString("requestedAt"),
            acceptedAt = json.optNullableString("acceptedAt"),
            connectedAt = json.optNullableString("connectedAt"),
            endedAt = json.optNullableString("endedAt"),
            endReason = json.optNullableString("endReason"),
        )
    }

    private fun parseJoinTicket(json: JSONObject) = RemoteJoinTicket(
        sessionId = json.getString("sessionId"),
        ticketId = json.getString("ticketId"),
        url = json.getString("url"),
        token = json.getString("token"),
        expiresAt = json.getString("expiresAt"),
        media = json.getJSONObject("media").let { media ->
            RequestedRemoteMedia(
                receiveDeviceAudio = media.getBoolean("receiveDeviceAudio"),
                receiveDeviceVideo = media.getBoolean("receiveDeviceVideo"),
                sendFamilyAudio = media.getBoolean("sendFamilyAudio"),
                sendFamilyVideo = media.getBoolean("sendFamilyVideo"),
            )
        },
        recording = json.getBoolean("recording"),
        transcription = json.getBoolean("transcription"),
    )

    private fun arrayData(json: JSONObject?): JSONArray = json?.optJSONArray("value") ?: JSONArray()
}

private fun JSONArray.objects(): List<JSONObject> =
    (0 until length()).mapNotNull { optJSONObject(it) }

private fun <T> JSONArray.mapObjects(transform: (JSONObject) -> T): List<T> = objects().map(transform)

private fun JSONArray.strings(): List<String> =
    (0 until length()).mapNotNull { optString(it).takeIf(String::isNotBlank) }

private fun JSONObject.optNullableString(name: String): String? =
    if (!has(name) || isNull(name)) null else optString(name).takeIf(String::isNotBlank)
