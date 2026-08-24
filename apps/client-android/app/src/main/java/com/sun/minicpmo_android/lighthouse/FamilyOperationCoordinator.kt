package com.sun.minicpmo_android.lighthouse

import java.util.concurrent.atomic.AtomicLong

internal enum class FamilyOperationScope {
    SESSION,
    HOUSEHOLD,
    RECIPIENT,
    SELECTION,
}

internal enum class FamilyOperationPolicy {
    LATEST_PER_LANE,
    ADDITIVE,
}

internal enum class FamilyOperationOutcome {
    SUCCESS,
    FAILURE,
}

internal enum class FamilyOperationReconcile {
    NONE,
    HOUSEHOLD_LIST,
    HOUSEHOLD,
    RECIPIENT,
    CARE_AUTHORITIES,
}

internal data class FamilyOperationDecision(
    val publish: Boolean,
    val reconcile: FamilyOperationReconcile? = null,
)

internal data class FamilyOperationTicket(
    internal val intentId: Long,
    internal val sessionEpoch: Long,
    internal val userId: String,
    internal val householdId: String?,
    internal val recipientId: String?,
    internal val householdEpoch: Long,
    internal val recipientEpoch: Long,
    internal val selectionEpoch: Long,
    internal val scope: FamilyOperationScope,
    internal val policy: FamilyOperationPolicy,
    internal val laneKey: FamilyOperationLaneKey?,
    internal val reconcileTarget: FamilyOperationReconcile,
)

internal data class FamilyOperationLaneKey(
    val sessionEpoch: Long,
    val scope: FamilyOperationScope,
    val householdId: String?,
    val recipientId: String?,
    val lane: String,
)

/**
 * Owns family-operation presentation independently from latest-wins GET loads.
 *
 * Server mutations are never cancelled or rolled back here. A ticket only
 * decides whether a completed result still belongs to the visible family
 * workspace and whether that workspace needs an authoritative reload.
 */
internal class FamilyOperationCoordinator {
    private val nextIntentId = AtomicLong(0)
    private var sessionEpoch = 0L
    private var householdEpoch = 0L
    private var recipientEpoch = 0L
    private var selectionEpoch = 0L
    private var userId: String? = null
    private var householdId: String? = null
    private var recipientId: String? = null
    private val latestIntentByLane = mutableMapOf<FamilyOperationLaneKey, Long>()

    val hasSession: Boolean
        get() = userId != null

    fun startSession(userId: String) {
        require(userId.isNotBlank()) { "userId must not be blank" }
        sessionEpoch += 1
        householdEpoch += 1
        recipientEpoch += 1
        selectionEpoch += 1
        this.userId = userId
        householdId = null
        recipientId = null
        latestIntentByLane.clear()
    }

    fun endSession() {
        sessionEpoch += 1
        householdEpoch += 1
        recipientEpoch += 1
        selectionEpoch += 1
        userId = null
        householdId = null
        recipientId = null
        latestIntentByLane.clear()
    }

    fun updateSelection(householdId: String?, recipientId: String?) {
        require(recipientId == null || householdId != null) {
            "recipient selection requires a household"
        }
        if (!hasSession) return

        val householdChanged = this.householdId != householdId
        val recipientChanged = householdChanged || this.recipientId != recipientId
        if (householdChanged) householdEpoch += 1
        if (recipientChanged) recipientEpoch += 1
        if (householdChanged || recipientChanged) selectionEpoch += 1
        this.householdId = householdId
        this.recipientId = recipientId
    }

    fun begin(
        scope: FamilyOperationScope,
        lane: String,
        policy: FamilyOperationPolicy = FamilyOperationPolicy.LATEST_PER_LANE,
        reconcile: FamilyOperationReconcile = FamilyOperationReconcile.NONE,
    ): FamilyOperationTicket {
        val currentUserId = checkNotNull(userId) { "family session is not active" }
        require(lane.isNotBlank()) { "operation lane must not be blank" }
        if (scope in setOf(FamilyOperationScope.HOUSEHOLD, FamilyOperationScope.RECIPIENT)) {
            checkNotNull(householdId) { "household is not selected" }
        }
        if (scope == FamilyOperationScope.RECIPIENT) {
            checkNotNull(recipientId) { "recipient is not selected" }
        }

        val intentId = nextIntentId.incrementAndGet()
        val laneKey = if (policy == FamilyOperationPolicy.LATEST_PER_LANE) {
            FamilyOperationLaneKey(
                sessionEpoch = sessionEpoch,
                scope = scope,
                householdId = householdId.takeIf {
                    scope != FamilyOperationScope.SESSION
                },
                recipientId = recipientId.takeIf {
                    scope in setOf(FamilyOperationScope.RECIPIENT, FamilyOperationScope.SELECTION)
                },
                lane = lane,
            ).also { latestIntentByLane[it] = intentId }
        } else {
            null
        }
        return FamilyOperationTicket(
            intentId = intentId,
            sessionEpoch = sessionEpoch,
            userId = currentUserId,
            householdId = householdId,
            recipientId = recipientId,
            householdEpoch = householdEpoch,
            recipientEpoch = recipientEpoch,
            selectionEpoch = selectionEpoch,
            scope = scope,
            policy = policy,
            laneKey = laneKey,
            reconcileTarget = reconcile,
        )
    }

    fun isResultOwner(ticket: FamilyOperationTicket): Boolean =
        scopeIsCurrent(ticket) && laneIsCurrent(ticket)

    fun isSessionCurrent(ticket: FamilyOperationTicket): Boolean =
        ticket.sessionEpoch == sessionEpoch && ticket.userId == userId

    fun complete(
        ticket: FamilyOperationTicket,
        outcome: FamilyOperationOutcome,
    ): FamilyOperationDecision {
        if (isResultOwner(ticket)) {
            // Success reconciles against any GET snapshot that started before
            // the mutation. Failure reconciles because a lost response does
            // not prove that the server rejected the write.
            return FamilyOperationDecision(
                publish = true,
                reconcile = when (outcome) {
                    FamilyOperationOutcome.SUCCESS,
                    FamilyOperationOutcome.FAILURE,
                    -> ticket.reconcileTarget.takeUnless {
                        it == FamilyOperationReconcile.NONE
                    }
                },
            )
        }
        val reconcile = ticket.reconcileTarget.takeIf {
            it != FamilyOperationReconcile.NONE && targetIsVisible(ticket, it)
        }
        return FamilyOperationDecision(publish = false, reconcile = reconcile)
    }

    private fun scopeIsCurrent(ticket: FamilyOperationTicket): Boolean {
        if (!isSessionCurrent(ticket)) return false
        return when (ticket.scope) {
            FamilyOperationScope.SESSION -> true
            FamilyOperationScope.HOUSEHOLD ->
                ticket.householdId == householdId && ticket.householdEpoch == householdEpoch
            FamilyOperationScope.RECIPIENT ->
                ticket.householdId == householdId &&
                    ticket.recipientId == recipientId &&
                    ticket.householdEpoch == householdEpoch &&
                    ticket.recipientEpoch == recipientEpoch
            FamilyOperationScope.SELECTION ->
                ticket.householdId == householdId &&
                    ticket.recipientId == recipientId &&
                    ticket.selectionEpoch == selectionEpoch
        }
    }

    private fun laneIsCurrent(ticket: FamilyOperationTicket): Boolean =
        ticket.policy == FamilyOperationPolicy.ADDITIVE ||
            ticket.laneKey?.let { latestIntentByLane[it] == ticket.intentId } == true

    private fun targetIsVisible(
        ticket: FamilyOperationTicket,
        target: FamilyOperationReconcile,
    ): Boolean {
        if (ticket.sessionEpoch != sessionEpoch || ticket.userId != userId) return false
        return when (target) {
            FamilyOperationReconcile.NONE -> false
            FamilyOperationReconcile.HOUSEHOLD_LIST -> true
            FamilyOperationReconcile.HOUSEHOLD -> ticket.householdId == householdId
            FamilyOperationReconcile.RECIPIENT,
            FamilyOperationReconcile.CARE_AUTHORITIES,
            -> ticket.householdId == householdId && ticket.recipientId == recipientId
        }
    }
}
