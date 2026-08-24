package com.sun.minicpmo_android.lighthouse

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HouseholdDetailsScopeStaticTest {
    private val projectDir = generateSequence(File(requireNotNull(System.getProperty("user.dir")))) {
        it.parentFile
    }.first { it.resolve("gradle/libs.versions.toml").isFile }

    @Test
    fun theLatestWorkspaceScopeOwnsRefreshDetailsErrorsAndLoading() {
        val viewModel = projectDir.resolve(
            "app/src/main/java/com/sun/minicpmo_android/lighthouse/LighthouseViewModel.kt",
        ).readText().replace("\r\n", "\n")

        val selection = viewModel.substringAfter("fun selectHousehold(householdId: String)")
            .substringBefore("fun selectRecipient")
        val refresh = viewModel.substringAfter("fun refresh(): Job")
            .substringBefore("fun createActivation")
        val login = viewModel.substringAfter("fun login(identifier: String, password: String)")
            .substringBefore("fun register")
        val familyRefresh = viewModel.substringAfter(
            "private suspend fun refreshFamilyData(scope: FamilyWorkspaceLoadScope)",
        ).substringBefore("private suspend fun loadHouseholdDetails")
        val detailsLoader = viewModel.substringAfter("private suspend fun loadHouseholdDetails")
            .substringBefore("private suspend fun loadRecipientResources")
        val action = viewModel.substringAfter("private fun action(")
            .substringBefore("private fun handleActionFailure")
        val errorCatch = action.substringAfter("catch (error: Throwable)")
            .substringBefore("finally")
        val actionFinally = action.substringAfter("finally")
        val showError = viewModel.substringAfter("private fun showError(error: Throwable)")
            .substringBefore("private fun stopBackgroundJobs")
        val logout = viewModel.substringAfter("fun logout(): Job")
            .substringBefore("fun switchRole")

        assertTrue(selection.contains("familyWorkspaceLoads.begin()"))
        assertTrue(selection.contains("isResultOwner = { familyWorkspaceLoads.isCurrent(scope) }"))
        assertTrue(
            refresh.indexOf("familyWorkspaceLoads.begin()") in
                0 until refresh.indexOf("return action("),
        )
        assertTrue(refresh.contains("isResultOwner = { familyWorkspaceLoads.isCurrent(scope) }"))
        assertTrue(refresh.contains("refreshFamilyData(scope)"))
        assertTrue(familyRefresh.contains("familyWorkspaceLoads.load(scope)"))
        assertTrue(familyRefresh.contains("repository.listHouseholds()"))
        assertTrue(familyRefresh.contains("FamilyWorkspaceLoadResult.Stale -> return"))
        assertTrue(familyRefresh.contains("loadHouseholdDetails(scope, selected)"))
        assertFalse(familyRefresh.contains("familyWorkspaceLoads.begin()"))
        assertTrue(detailsLoader.contains("familyWorkspaceLoads.load(scope)"))
        assertTrue(detailsLoader.contains("FamilyWorkspaceLoadResult.Stale -> return"))
        assertTrue(
            detailsLoader.contains(
                "isResultOwner = { familyWorkspaceLoads.isCurrent(scope) }",
            ),
        )
        assertTrue(login.contains("refreshFamilyData(scope)"))
        assertTrue(login.contains("restoreDeviceData()"))
        assertTrue(login.contains("consumeDeferredActivation()"))
        assertFalse(login.contains("if (!familyWorkspaceLoads.isCurrent(scope)) return@action"))
        assertTrue(action.contains("catch (cancelled: CancellationException)"))
        assertTrue(errorCatch.contains("if (isResultOwner()) handleActionFailure(error)"))
        assertTrue(action.contains("actionBusyTracker.begin(isResultOwner)"))
        assertTrue(actionFinally.contains("actionBusyTracker.end(busyLease)"))
        assertTrue(actionFinally.contains("publishActionBusy()"))
        assertFalse(showError.contains("busy = false"))
        assertTrue(logout.contains("familyWorkspaceLoads.invalidate()"))
    }
}
