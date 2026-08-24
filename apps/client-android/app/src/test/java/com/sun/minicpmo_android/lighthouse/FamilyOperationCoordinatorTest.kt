package com.sun.minicpmo_android.lighthouse

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FamilyOperationCoordinatorTest {
    @Test
    fun recipientSwitchExpiresRecipientWorkButKeepsHouseholdWork() {
        val coordinator = coordinatorAt("household-a", "recipient-a")
        val household = coordinator.begin(
            scope = FamilyOperationScope.HOUSEHOLD,
            lane = "member:1",
        )
        val recipient = coordinator.begin(
            scope = FamilyOperationScope.RECIPIENT,
            lane = "memory:1",
        )

        coordinator.updateSelection("household-a", "recipient-b")

        assertTrue(coordinator.isResultOwner(household))
        assertFalse(coordinator.isResultOwner(recipient))
    }

    @Test
    fun householdSwitchExpiresBothHouseholdAndRecipientWork() {
        val coordinator = coordinatorAt("household-a", "recipient-a")
        val household = coordinator.begin(FamilyOperationScope.HOUSEHOLD, "member:1")
        val recipient = coordinator.begin(FamilyOperationScope.RECIPIENT, "memory:1")

        coordinator.updateSelection("household-b", "recipient-b")

        assertFalse(coordinator.isResultOwner(household))
        assertFalse(coordinator.isResultOwner(recipient))
    }

    @Test
    fun restartingTheSameUserSessionStillExpiresOldWork() {
        val coordinator = coordinatorAt("household-a", "recipient-a")
        val ticket = coordinator.begin(FamilyOperationScope.RECIPIENT, "memory:1")

        coordinator.startSession(USER_ID)
        coordinator.updateSelection("household-a", "recipient-a")

        assertFalse(coordinator.isResultOwner(ticket))
        assertEquals(
            FamilyOperationDecision(publish = false),
            coordinator.complete(ticket, FamilyOperationOutcome.SUCCESS),
        )
    }

    @Test
    fun sessionFailureOwnershipSurvivesSelectionButNotSessionRestart() {
        val coordinator = coordinatorAt("household-a", "recipient-a")
        val ticket = coordinator.begin(FamilyOperationScope.RECIPIENT, "memory:1")

        coordinator.updateSelection("household-a", "recipient-b")
        assertTrue(coordinator.isSessionCurrent(ticket))

        coordinator.startSession(USER_ID)
        coordinator.updateSelection("household-a", "recipient-a")
        assertFalse(coordinator.isSessionCurrent(ticket))
    }

    @Test
    fun latestLaneSupersedesOlderIntentWithoutInvalidatingAdditiveCreates() {
        val coordinator = coordinatorAt("household-a", "recipient-a")
        val oldUpdate = coordinator.begin(FamilyOperationScope.RECIPIENT, "memory:1")
        val firstCreate = coordinator.begin(
            scope = FamilyOperationScope.RECIPIENT,
            lane = "memory:create",
            policy = FamilyOperationPolicy.ADDITIVE,
        )
        val newUpdate = coordinator.begin(FamilyOperationScope.RECIPIENT, "memory:1")
        val secondCreate = coordinator.begin(
            scope = FamilyOperationScope.RECIPIENT,
            lane = "memory:create",
            policy = FamilyOperationPolicy.ADDITIVE,
        )

        assertFalse(coordinator.isResultOwner(oldUpdate))
        assertTrue(coordinator.isResultOwner(newUpdate))
        assertTrue(coordinator.isResultOwner(firstCreate))
        assertTrue(coordinator.isResultOwner(secondCreate))

        coordinator.complete(newUpdate, FamilyOperationOutcome.SUCCESS)
        assertFalse(
            "an older in-flight request must not regain ownership after the latest completes",
            coordinator.isResultOwner(oldUpdate),
        )
    }

    @Test
    fun independentLatestLanesDoNotSupersedeEachOther() {
        val coordinator = coordinatorAt("household-a", "recipient-a")
        val memory = coordinator.begin(FamilyOperationScope.RECIPIENT, "memory:1")
        val routine = coordinator.begin(FamilyOperationScope.RECIPIENT, "routine:1")

        assertTrue(coordinator.isResultOwner(memory))
        assertTrue(coordinator.isResultOwner(routine))
    }

    @Test
    fun abaSelectionReconcilesInsteadOfPublishingAnOldResult() {
        val coordinator = coordinatorAt("household-a", "recipient-a")
        val ticket = coordinator.begin(
            scope = FamilyOperationScope.RECIPIENT,
            lane = "memory:1",
            reconcile = FamilyOperationReconcile.RECIPIENT,
        )

        coordinator.updateSelection("household-a", "recipient-b")
        coordinator.updateSelection("household-a", "recipient-a")

        assertEquals(
            FamilyOperationDecision(
                publish = false,
                reconcile = FamilyOperationReconcile.RECIPIENT,
            ),
            coordinator.complete(ticket, FamilyOperationOutcome.SUCCESS),
        )
    }

    @Test
    fun offscreenResultWaitsForNormalSelectionReload() {
        val coordinator = coordinatorAt("household-a", "recipient-a")
        val ticket = coordinator.begin(
            scope = FamilyOperationScope.RECIPIENT,
            lane = "memory:1",
            reconcile = FamilyOperationReconcile.RECIPIENT,
        )

        coordinator.updateSelection("household-a", "recipient-b")

        assertEquals(
            FamilyOperationDecision(publish = false),
            coordinator.complete(ticket, FamilyOperationOutcome.SUCCESS),
        )
    }

    @Test
    fun currentFailureStaysVisibleAndRequestsAuthoritativeReconciliation() {
        val coordinator = coordinatorAt("household-a", "recipient-a")
        val ticket = coordinator.begin(
            scope = FamilyOperationScope.RECIPIENT,
            lane = "memory:1",
            reconcile = FamilyOperationReconcile.RECIPIENT,
        )

        assertEquals(
            FamilyOperationDecision(
                publish = true,
                reconcile = FamilyOperationReconcile.RECIPIENT,
            ),
            coordinator.complete(ticket, FamilyOperationOutcome.FAILURE),
        )
    }

    @Test
    fun currentSuccessAlsoReconcilesAgainstOlderReadSnapshots() {
        val coordinator = coordinatorAt("household-a", "recipient-a")
        val ticket = coordinator.begin(
            scope = FamilyOperationScope.RECIPIENT,
            lane = "memory:1",
            reconcile = FamilyOperationReconcile.RECIPIENT,
        )

        assertEquals(
            FamilyOperationDecision(
                publish = true,
                reconcile = FamilyOperationReconcile.RECIPIENT,
            ),
            coordinator.complete(ticket, FamilyOperationOutcome.SUCCESS),
        )
    }

    @Test
    fun refreshDoesNotChangeMutationOwnership() {
        val coordinator = coordinatorAt("household-a", "recipient-a")
        val ticket = coordinator.begin(FamilyOperationScope.RECIPIENT, "memory:1")
        val reads = LatestFamilyWorkspaceLoad()

        reads.begin()
        reads.begin()

        assertTrue(coordinator.isResultOwner(ticket))
    }

    private fun coordinatorAt(
        householdId: String,
        recipientId: String,
    ) = FamilyOperationCoordinator().also {
        it.startSession(USER_ID)
        it.updateSelection(householdId, recipientId)
    }

    private companion object {
        const val USER_ID = "user-1"
    }
}
