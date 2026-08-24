package com.sun.minicpmo_android.lighthouse

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FamilyOperationOwnershipStaticTest {
    private val projectDir = generateSequence(File(requireNotNull(System.getProperty("user.dir")))) {
        it.parentFile
    }.first { it.resolve("gradle/libs.versions.toml").isFile }

    private val viewModel = projectDir.resolve(
        "app/src/main/java/com/sun/minicpmo_android/lighthouse/LighthouseViewModel.kt",
    ).readText().replace("\r\n", "\n")
    private val familyScreen = projectDir.resolve(
        "app/src/main/java/com/sun/minicpmo_android/lighthouse/ui/FamilyManagementScreen.kt",
    ).readText().replace("\r\n", "\n")

    @Test
    fun occurrenceVerificationKeepsOneWorkspaceAcrossEveryRequest() {
        val body = functionBody("verifyOccurrence")
        val householdCapture = body.indexOf(
            "val capturedHouseholdId = checkNotNull(householdId)",
        )
        val recipientCapture = body.indexOf(
            "val capturedRecipientId = checkNotNull(recipientId)",
        )
        val mutation = body.indexOf("repository.familyVerifyOccurrence(")

        assertTrue(
            "the household and recipient must be captured before the first suspend call",
            householdCapture >= 0 &&
                recipientCapture >= 0 &&
                householdCapture < mutation &&
                recipientCapture < mutation,
        )
        assertFalse(
            "a late response must not read a recipient selected after the mutation started",
            body.contains("_uiState.value.selectedRecipientId"),
        )
        assertTrue(
            body.contains(
                "repository.listFamilyTasks(capturedHouseholdId, capturedRecipientId)",
            ),
        )
        assertTrue(
            body.contains(
                "repository.listCareEvents(capturedHouseholdId, capturedRecipientId)",
            ),
        )
    }

    @Test
    fun recipientSelectionUsesTheLatestWorkspaceLoadOwner() {
        val body = functionBody("selectRecipient")

        assertTrue(body.contains("familyWorkspaceLoads.begin()"))
        assertTrue(body.contains("isResultOwner = { familyWorkspaceLoads.isCurrent(scope) }"))
        assertTrue(body.contains("isResultOwner = { familyWorkspaceLoads.isCurrent(scope) },"))
        assertTrue(body.contains("activation = null"))
        assertTrue(body.contains("activationApprovalDetails = null"))
    }

    @Test
    fun everyScopedFamilyOperationChecksOwnershipBeforeWritingUiState() {
        val expectedScopes = linkedMapOf(
            "createHousehold" to "SELECTION",
            "createRecipient" to "SELECTION",
            "createMemory" to "RECIPIENT",
            "updateMemory" to "RECIPIENT",
            "deleteMemory" to "RECIPIENT",
            "createRoutine" to "RECIPIENT",
            "updateRoutine" to "RECIPIENT",
            "deleteRoutine" to "RECIPIENT",
            "verifyOccurrence" to "RECIPIENT",
            "claimFamilyTask" to "RECIPIENT",
            "finishFamilyTask" to "RECIPIENT",
            "decideConsent" to "RECIPIENT",
            "loadCareAuthorities" to "RECIPIENT",
            "updateHouseholdMember" to "HOUSEHOLD",
            "removeHouseholdMember" to "HOUSEHOLD",
            "putCareAuthority" to "RECIPIENT",
            "revokeBinding" to "HOUSEHOLD",
            "createActivation" to "RECIPIENT",
            "loadActivationApprovalDetails" to "SELECTION",
            "approveActivation" to "SELECTION",
        )

        expectedScopes.forEach { (functionName, scope) ->
            val body = functionBody(functionName)
            assertTrue(
                "$functionName must capture $scope ownership",
                body.contains("= familyAction(") &&
                    body.contains("scope = FamilyOperationScope.$scope"),
            )
            assertFalse(
                "$functionName must not bypass the family operation coordinator",
                body.contains("= action {"),
            )
        }
    }

    @Test
    fun creationFocusChangesReuseTheNormalSelectionLoaders() {
        assertTrue(functionBody("createHousehold").contains("selectHousehold(created.id)"))
        assertTrue(functionBody("createRecipient").contains("selectRecipient(created.id)"))
    }

    @Test
    fun entityMutationsRejectItemsFromAnotherRecipient() {
        val expectedChecks = mapOf(
            "updateRoutine" to "routine.recipientId == recipientId",
            "deleteRoutine" to "routine.recipientId == recipientId",
            "verifyOccurrence" to "occurrence.recipientId == recipientId",
            "claimFamilyTask" to "task.recipientId == recipientId",
            "finishFamilyTask" to "task.recipientId == recipientId",
        )

        expectedChecks.forEach { (functionName, ownershipCheck) ->
            assertTrue(
                "$functionName must reject an entity captured for another recipient",
                functionBody(functionName).contains(ownershipCheck),
            )
        }
    }

    @Test
    fun changingWorkspaceClosesDialogsThatCapturedOldEntities() {
        val effectStart = familyScreen.indexOf(
            "LaunchedEffect(state.selectedHouseholdId, state.selectedRecipientId)",
        )
        assertTrue("workspace changes need a dialog cleanup effect", effectStart >= 0)
        val effectEnd = familyScreen.indexOf("\n    }", effectStart).takeIf { it >= 0 }
            ?: familyScreen.length
        val body = familyScreen.substring(effectStart, effectEnd)
        listOf(
            "memoryEditorVisible = false",
            "memoryDelete = null",
            "routineEditorVisible = false",
            "routineDelete = null",
            "taskDecision = null",
            "occurrenceDecision = null",
        ).forEach { cleanup ->
            assertTrue("workspace cleanup must include $cleanup", body.contains(cleanup))
        }
    }

    @Test
    fun operationWiringUsesSharedResourceLanesAndAdditiveCreates() {
        assertSharedLane("updateMemory", "deleteMemory", "memory:\${memory.id}")
        assertSharedLane("updateRoutine", "deleteRoutine", "routine:\${routine.id}")
        assertSharedLane("claimFamilyTask", "finishFamilyTask", "task:\${task.id}")
        assertSharedLane(
            "updateHouseholdMember",
            "removeHouseholdMember",
            "member:\${member.id}",
        )
        assertSharedLane(
            "loadActivationApprovalDetails",
            "approveActivation",
            "activation:approval",
        )
        listOf("createMemory", "createRoutine").forEach { functionName ->
            assertTrue(
                "$functionName must not supersede another independent create",
                functionBody(functionName).contains(
                    "policy = FamilyOperationPolicy.ADDITIVE",
                ),
            )
        }
        assertTrue(
            functionBody("putCareAuthority").contains(
                "reconcile = FamilyOperationReconcile.CARE_AUTHORITIES",
            ),
        )
    }

    private fun functionBody(functionName: String): String {
        val start = viewModel.indexOf("    fun $functionName(")
        require(start >= 0) { "Missing function $functionName" }
        val end = viewModel.indexOf("\n    fun ", start + 1).takeIf { it >= 0 } ?: viewModel.length
        return viewModel.substring(start, end)
    }

    private fun assertSharedLane(first: String, second: String, lane: String) {
        assertTrue("$first must use lane $lane", functionBody(first).contains("lane = \"$lane\""))
        assertTrue("$second must use lane $lane", functionBody(second).contains("lane = \"$lane\""))
    }
}
