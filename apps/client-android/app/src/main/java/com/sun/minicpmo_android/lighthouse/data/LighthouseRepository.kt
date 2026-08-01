package com.sun.minicpmo_android.lighthouse.data

import android.os.Build
import com.sun.minicpmo_android.BuildConfig
import com.sun.minicpmo_android.lighthouse.model.*
import com.sun.minicpmo_android.lighthouse.network.LighthouseApiException
import com.sun.minicpmo_android.lighthouse.network.LighthouseHttpClient
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

    fun deviceCredentialHouseholdId(): String? = vault.deviceCredential()?.householdId

    fun pendingDeviceActivation(): PendingDeviceActivation? = vault.pendingDeviceActivation()

    suspend fun login(identifier: String, password: String): UserView {
        beginExplicitUserSession()
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
        replaceUserSession(parseUserSession(result))
        return getMe()
    }

    suspend fun register(
        email: String?,
        username: String?,
        password: String,
        displayName: String,
    ): UserView {
        beginExplicitUserSession()
        val body = JSONObject()
            .put("password", password)
            .put("displayName", displayName.trim())
            .put("clientType", "ANDROID")
        email?.trim()?.takeIf(String::isNotBlank)?.let { body.put("email", it) }
        username?.trim()?.takeIf(String::isNotBlank)?.let { body.put("username", it) }
        val result = requireNotNull(http.request("POST", "auth/register", body))
        replaceUserSession(parseUserSession(result))
        return getMe()
    }

    suspend fun requestEmailVerification(email: String) {
        userRequest(
            "POST",
            "auth/email-verifications",
            JSONObject().put("email", email.trim()),
        )
    }

    suspend fun logout() {
        runCatching { userRequest("POST", "auth/logout", JSONObject()) }
        clearUserSession()
    }

    suspend fun restoreUser(): UserView? {
        if (!hasUserSession()) return null
        return runCatching { getMe() }.getOrElse {
            if (it is LighthouseApiException && it.status == 401) {
                clearUserSession()
                null
            } else {
                throw it
            }
        }
    }

    suspend fun getMe(): UserView = parseUser(
        requireNotNull(userRequest("GET", "me")),
    ).also(::saveUserCareNamespace)

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

    suspend fun exchangeApprovedActivation(pending: PendingDeviceActivation): DeviceCredential? {
        val status = requireNotNull(
            http.request("GET", "activation-challenges/${pending.challengeId}"),
        )
        if (status.getString("status") != "APPROVED") return null
        val approvedAt = status.optString("approvedAt").takeIf(String::isNotBlank) ?: return null
        val installation = requireNotNull(vault.deviceInstallation())
        val signature = signer.sign(
            DeviceProofProtocol.exchangeMessage(
                challengeId = pending.challengeId,
                installationId = installation.installationId,
                approvedAt = approvedAt,
            ),
        )
        val result = requireNotNull(
            http.request(
                "POST",
                "device-credentials/exchange",
                JSONObject()
                    .put("challengeId", pending.challengeId)
                    .put("installationId", installation.installationId)
                    .put("signature", signature),
            ),
        )
        return parseDeviceCredential(result).also {
            vault.saveDeviceCredential(it)
            vault.savePendingDeviceActivation(null)
        }
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
        return CompanionModelConnection(
            companionSessionId = companionSessionId,
            modelSessionId = model.getJSONObject("session").getString("id"),
            realtimeUrl = model.getJSONObject("connection").getString("realtimeUrl"),
            model = model.getJSONObject("connection").getString("model"),
            systemPrompt = model.getJSONObject("prompt").getString("content"),
            userTranscriptionAllowed = decisions.optBoolean(
                "MODEL_INPUT_TRANSCRIPTION",
                false,
            ),
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
        val session = vault.userSession() ?: throw LighthouseApiException(401, "SIGNED_OUT", "请先登录")
        return try {
            http.request(method, path, body, session.accessToken, headers)
        } catch (error: LighthouseApiException) {
            if (error.status != 401) throw error
            val refreshed = refreshUserSession(session.refreshToken)
            http.request(method, path, body, refreshed.accessToken, headers)
        }
    }

    private suspend fun refreshUserSession(previousRefreshToken: String): UserSession =
        userRefreshMutex.withLock {
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
                    clearUserSession()
                    throw LighthouseApiException(
                        status = 401,
                        code = "SIGNED_OUT",
                        message = "登录已过期，请重新登录",
                        requestId = error.requestId,
                    )
                }
                throw error
            }
            parseUserSession(result).also(::replaceUserSession)
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

    private fun beginExplicitUserSession() {
        // A deliberate sign-in/register action replaces any previous account
        // intent. Token refresh never enters this boundary.
        vault.saveCareCommandState(null)
        vault.saveUserCareNamespace(null)
        vault.saveUserSession(null)
    }

    private fun clearUserSession() {
        // Logout/terminal refresh failure is an explicit abandonment boundary.
        vault.saveCareCommandState(null)
        vault.saveUserCareNamespace(null)
        vault.saveUserSession(null)
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
