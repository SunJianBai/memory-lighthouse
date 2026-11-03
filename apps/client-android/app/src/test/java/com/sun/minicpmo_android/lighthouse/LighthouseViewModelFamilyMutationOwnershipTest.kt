package com.sun.minicpmo_android.lighthouse

import androidx.lifecycle.viewModelScope
import com.sun.minicpmo_android.lighthouse.call.CompanionMediaHandoffState
import com.sun.minicpmo_android.lighthouse.call.CoordinatedRemoteCallState
import com.sun.minicpmo_android.lighthouse.call.RemoteCallCoordinator
import com.sun.minicpmo_android.lighthouse.call.RemoteHeartbeatConnectionState
import com.sun.minicpmo_android.lighthouse.data.LighthouseRepository
import com.sun.minicpmo_android.lighthouse.data.RemoteCallCommandRegistry
import com.sun.minicpmo_android.lighthouse.model.ActivationApprovalDetails
import com.sun.minicpmo_android.lighthouse.model.ActivationApprovalDevice
import com.sun.minicpmo_android.lighthouse.model.ActivationPresentation
import com.sun.minicpmo_android.lighthouse.model.CareAuthorityInput
import com.sun.minicpmo_android.lighthouse.model.CareAuthorityView
import com.sun.minicpmo_android.lighthouse.model.CareRecipientView
import com.sun.minicpmo_android.lighthouse.model.CareHistoryPage
import com.sun.minicpmo_android.lighthouse.model.CareEventView
import com.sun.minicpmo_android.lighthouse.model.CareHistoryFilter
import com.sun.minicpmo_android.lighthouse.model.OccurrenceView
import com.sun.minicpmo_android.lighthouse.model.AppRole
import com.sun.minicpmo_android.lighthouse.data.CareHistoryKind
import com.sun.minicpmo_android.lighthouse.model.CompanionBindingView
import com.sun.minicpmo_android.lighthouse.model.ConsentStateView
import com.sun.minicpmo_android.lighthouse.model.HouseholdMemberView
import com.sun.minicpmo_android.lighthouse.model.HouseholdView
import com.sun.minicpmo_android.lighthouse.model.MemoryInput
import com.sun.minicpmo_android.lighthouse.model.MemoryRevisionView
import com.sun.minicpmo_android.lighthouse.model.MemoryView
import com.sun.minicpmo_android.lighthouse.model.RoutineView
import com.sun.minicpmo_android.lighthouse.model.FamilyTaskView
import com.sun.minicpmo_android.lighthouse.model.UserView
import com.sun.minicpmo_android.lighthouse.network.LighthouseApiException
import com.sun.minicpmo_android.lighthouse.realtime.LiveCallState
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.unmockkAll
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class LighthouseViewModelFamilyMutationOwnershipTest {
    private val mainDispatcher = StandardTestDispatcher()

    @Test
    fun olderPostPauseReloadCannotOverwriteANewerExplicitRefresh() = runTest(mainDispatcher) {
        val original = RoutineView("routine", HOUSEHOLD_ID, RECIPIENT_A, "OTHER", null, "散步", "慢慢走", "完成了吗", "FAMILY", "ACTIVE", emptyList(), "2026-08-01T00:00:00Z", 1)
        val stale = CompletableDeferred<List<RoutineView>>()
        val newest = original.copy(status = "ACTIVE", version = 3)
        var reads = 0
        val fixture = fixture(CompletableDeferred(), configureRepository = { repo ->
            coEvery { repo.listRoutines(any(), any()) } coAnswers {
                when (++reads) { 1 -> listOf(original); 2 -> stale.await(); else -> listOf(newest) }
            }
            coEvery { repo.setRoutinePaused(HOUSEHOLD_ID, original, true) } returns original.copy(status = "PAUSED", version = 2)
        })
        try {
            fixture.signIn(this)
            fixture.viewModel.setRoutinePaused(original, true); runCurrent()
            fixture.viewModel.refresh(); runCurrent()
            stale.complete(listOf(original.copy(status = "PAUSED", version = 2))); advanceUntilIdle()
            assertEquals(listOf(newest), fixture.viewModel.uiState.value.routines)
        } finally { fixture.close() }
    }

    @Test
    fun acceptedPauseThenFailedReadDoesNotResubmitOrReplaceKnownState() = runTest(mainDispatcher) {
        val original = RoutineView("routine", HOUSEHOLD_ID, RECIPIENT_A, "OTHER", null, "散步", "慢慢走", "完成了吗", "FAMILY", "ACTIVE", emptyList(), "2026-08-01T00:00:00Z", 1)
        var accepted = false
        val fixture = fixture(CompletableDeferred(), configureRepository = { repo ->
            coEvery { repo.listRoutines(any(), any()) } answers { if (accepted) throw IOException("offline") else listOf(original) }
            coEvery { repo.setRoutinePaused(HOUSEHOLD_ID, original, true) } answers { accepted = true; original.copy(status = "PAUSED") }
        })
        try {
            fixture.signIn(this)
            fixture.viewModel.setRoutinePaused(original, true); advanceUntilIdle()
            assertEquals(listOf(original), fixture.viewModel.uiState.value.routines)
            assertTrue(fixture.viewModel.uiState.value.message.orEmpty().contains("操作已受理，状态暂未刷新"))
            assertNull(fixture.viewModel.uiState.value.routineCommandPendingId)
            assertEquals(1L, fixture.viewModel.uiState.value.routineCommandRevision)
        } finally { fixture.close() }
    }

    @Test
    fun noFutureResumeOffersEditingInsteadOfGenericVersionConflict() = runTest(mainDispatcher) {
        val original = RoutineView("routine", HOUSEHOLD_ID, RECIPIENT_A, "OTHER", null, "散步", "慢慢走", "完成了吗", "FAMILY", "PAUSED", emptyList(), "2026-08-01T00:00:00Z", 1)
        val fixture = fixture(CompletableDeferred(), configureRepository = { repo ->
            coEvery { repo.listRoutines(any(), any()) } returns listOf(original)
            coEvery { repo.setRoutinePaused(HOUSEHOLD_ID, original, false) } throws LighthouseApiException(409, "ROUTINE_NO_FUTURE_OCCURRENCE", "no future")
        })
        try {
            fixture.signIn(this)
            fixture.viewModel.setRoutinePaused(original, false); advanceUntilIdle()
            assertEquals("原安排没有后续提醒时间，请先修改日期或重复规则", fixture.viewModel.uiState.value.routineCommandError)
            assertEquals(listOf(original), fixture.viewModel.uiState.value.routines)
            assertEquals(0L, fixture.viewModel.uiState.value.routineCommandRevision)
        } finally { fixture.close() }
    }

    @Test
    fun lifecycleDenialClearsSensitiveRoutineCards() = runTest(mainDispatcher) {
        val original = RoutineView("routine", HOUSEHOLD_ID, RECIPIENT_A, "OTHER", null, "散步", "慢慢走", "完成了吗", "FAMILY", "ACTIVE", emptyList(), "2026-08-01T00:00:00Z", 1)
        val fixture = fixture(CompletableDeferred(), configureRepository = { repo ->
            coEvery { repo.listRoutines(any(), any()) } returns listOf(original)
            coEvery { repo.setRoutinePaused(HOUSEHOLD_ID, original, true) } throws LighthouseApiException(403, "DENIED", "权限已撤销")
        })
        try {
            fixture.signIn(this)
            fixture.viewModel.setRoutinePaused(original, true); advanceUntilIdle()
            assertTrue(fixture.viewModel.uiState.value.routines.isEmpty())
            assertEquals("日程权限已变化，请刷新", fixture.viewModel.uiState.value.routineLoadError)
            assertNull(fixture.viewModel.uiState.value.routineCommandPendingId)
        } finally { fixture.close() }
    }

    @Test
    fun pauseReceiptUsesAuthoritativeReloadAndPreservesHistoryFilters() = runTest(mainDispatcher) {
        val original = RoutineView("routine", HOUSEHOLD_ID, RECIPIENT_A, "OTHER", null, "散步", "慢慢走", "完成了吗", "FAMILY", "ACTIVE", emptyList(), "2026-08-01T00:00:00Z", 1)
        val authoritative = original.copy(status = "ACTIVE", version = 3)
        var changed = false
        val fixture = fixture(CompletableDeferred(), configureRepository = { repo ->
            coEvery { repo.listRoutines(any(), any()) } answers { listOf(if (changed) authoritative else original) }
            coEvery { repo.setRoutinePaused(HOUSEHOLD_ID, original, true) } answers {
                changed = true
                original.copy(status = "PAUSED", version = 2)
            }
        })
        try {
            fixture.signIn(this)
            val filter = CareHistoryFilter("2026-08-01", "2026-08-31", "EXPIRED")
            fixture.viewModel.queryCareHistory(CareHistoryKind.OCCURRENCES, filter); advanceUntilIdle()
            fixture.viewModel.setRoutinePaused(original, true); advanceUntilIdle()
            assertEquals(listOf(authoritative), fixture.viewModel.uiState.value.routines)
            assertEquals(filter, fixture.viewModel.uiState.value.occurrenceHistory.filter)
            assertNull(fixture.viewModel.uiState.value.routineCommandPendingId)
        } finally { fixture.close() }
    }

    @Test
    fun latePauseCannotChangeRecipientBOrReopenItsDialog() = runTest(mainDispatcher) {
        val original = RoutineView("routine", HOUSEHOLD_ID, RECIPIENT_A, "OTHER", null, "散步", "慢慢走", "完成了吗", "FAMILY", "ACTIVE", emptyList(), "2026-08-01T00:00:00Z", 1)
        val pending = CompletableDeferred<RoutineView>()
        val fixture = fixture(CompletableDeferred(), configureRepository = { repo ->
            coEvery { repo.setRoutinePaused(HOUSEHOLD_ID, original, true) } coAnswers { pending.await() }
        })
        try {
            fixture.signIn(this)
            fixture.viewModel.setRoutinePaused(original, true); runCurrent()
            fixture.viewModel.selectRecipient(RECIPIENT_B); advanceUntilIdle()
            val revision = fixture.viewModel.uiState.value.routineCommandRevision
            pending.complete(original.copy(status = "PAUSED", version = 2)); advanceUntilIdle()
            assertEquals(RECIPIENT_B, fixture.viewModel.uiState.value.selectedRecipientId)
            assertEquals(revision, fixture.viewModel.uiState.value.routineCommandRevision)
            assertNull(fixture.viewModel.uiState.value.routineCommandPendingId)
            assertTrue(fixture.viewModel.uiState.value.routines.isEmpty())
        } finally { fixture.close() }
    }

    @Test
    fun initialCareHistoryUsesPagedRepositoryInsteadOfLegacyArray() = runTest(mainDispatcher) {
        val event = CareEventView("history-1", "ROUTINE_CONFIRMED", "INFO", "FAMILY", "历史动态", "原文", "2026-08-01T00:00:00Z")
        val fixture = fixture(CompletableDeferred(), configureRepository = { repository ->
            coEvery { repository.listCareEventHistory(any(), any(), any(), any()) } returns
                CareHistoryPage(listOf(event), null, "Asia/Shanghai", null, null)
        })
        try {
            fixture.signIn(this)
            assertEquals(listOf(event), fixture.viewModel.uiState.value.careEvents)
        } finally { fixture.close() }
    }

    private fun historyEvent(id: String) = CareEventView(id, "ROUTINE_CONFIRMED", "INFO", "FAMILY", id, "原文", "2026-08-01T00:00:00Z")
    private fun eventPage(id: String, cursor: String? = null) = CareHistoryPage(listOf(historyEvent(id)), cursor, "Asia/Shanghai", null, null)

    @Test
    fun verificationAndRefreshKeepBothHistoryFiltersAndRemoveConfirmedFromReview() = runTest(mainDispatcher) {
        val occurrence = OccurrenceView("o", HOUSEHOLD_ID, RECIPIENT_A, "rule", "饮水", "HYDRATION", "原文", "2026-08-01T00:00:00Z", "2026-08-01", "NEEDS_FAMILY_REVIEW", null, null, null, 1)
        val reminderFilter = CareHistoryFilter("2026-08-01", "2026-08-31", "NEEDS_FAMILY_REVIEW")
        val eventFilter = CareHistoryFilter("2026-07-01", "2026-07-31")
        var verified = false
        val reminderReads = mutableListOf<Pair<CareHistoryFilter, String?>>()
        val eventReads = mutableListOf<Pair<CareHistoryFilter, String?>>()
        lateinit var repo: LighthouseRepository
        val fixture = fixture(CompletableDeferred(), configureRepository = { repository ->
            repo = repository
            coEvery { repository.listOccurrenceHistory(any(), any(), any(), any()) } coAnswers {
                val filter = thirdArg<CareHistoryFilter>()
                reminderReads += filter to arg<String?>(3)
                CareHistoryPage(if (verified && filter.status == "NEEDS_FAMILY_REVIEW") emptyList() else listOf(occurrence), null, "Asia/Shanghai", null, null)
            }
            coEvery { repository.listCareEventHistory(any(), any(), any(), any()) } coAnswers {
                eventReads += thirdArg<CareHistoryFilter>() to arg<String?>(3)
                eventPage(if (verified) "verified-event" else "before")
            }
            coEvery { repository.familyVerifyOccurrence(HOUSEHOLD_ID, occurrence, true, any()) } coAnswers {
                verified = true
                occurrence.copy(status = "CONFIRMED", version = 2)
            }
        })
        try {
            fixture.signIn(this)
            fixture.viewModel.queryCareHistory(CareHistoryKind.OCCURRENCES, reminderFilter)
            fixture.viewModel.queryCareHistory(CareHistoryKind.EVENTS, eventFilter)
            advanceUntilIdle()
            fixture.viewModel.verifyOccurrence(occurrence, true, null)
            advanceUntilIdle()
            assertTrue(fixture.viewModel.uiState.value.occurrences.isEmpty())
            assertEquals(listOf(historyEvent("verified-event")), fixture.viewModel.uiState.value.careEvents)
            assertEquals(reminderFilter to null, reminderReads.last())
            assertEquals(eventFilter to null, eventReads.last())
            fixture.viewModel.refresh(); advanceUntilIdle()
            assertEquals(reminderFilter, fixture.viewModel.uiState.value.occurrenceHistory.filter)
            assertEquals(eventFilter, fixture.viewModel.uiState.value.eventHistory.filter)
            coVerify(exactly = 0) { repo.listOccurrences(any(), any(), any(), any()) }
            coVerify(exactly = 0) { repo.listCareEvents(any(), any()) }
        } finally { fixture.close() }
    }

    @Test
    fun historyDenialClearsBothPanelsAndTasksDespitePendingSiblingPage() = runTest(mainDispatcher) {
        val late = CompletableDeferred<CareHistoryPage<CareEventView>>()
        val task = mockk<FamilyTaskView>(relaxed = true)
        val fixture = fixture(CompletableDeferred(), configureRepository = { repository ->
            coEvery { repository.listFamilyTasks(any(), any()) } returns listOf(task)
            coEvery { repository.listCareEventHistory(any(), any(), any(), any()) } coAnswers {
                if (arg<String?>(3) != null) late.await() else eventPage("private", "next")
            }
            coEvery { repository.listOccurrenceHistory(any(), any(), any(), any()) } coAnswers {
                if (thirdArg<CareHistoryFilter>().startDate != null) throw LighthouseApiException(403, "DENIED", "权限已撤回")
                CareHistoryPage(emptyList(), null, "Asia/Shanghai", null, null)
            }
        })
        try {
            fixture.signIn(this)
            assertEquals(listOf(task), fixture.viewModel.uiState.value.familyTasks)
            fixture.viewModel.loadMoreCareHistory(CareHistoryKind.EVENTS); runCurrent()
            fixture.viewModel.queryCareHistory(CareHistoryKind.OCCURRENCES, CareHistoryFilter("2026-08-01", "2026-08-31")); runCurrent()
            val denied = fixture.viewModel.uiState.value
            assertNull(denied.eventHistory.page)
            assertNull(denied.occurrenceHistory.page)
            assertTrue(denied.familyTasks.isEmpty())
            assertEquals("权限已撤回", denied.familyTaskError)
            late.complete(eventPage("late-private")); advanceUntilIdle()
            assertNull(fixture.viewModel.uiState.value.eventHistory.page)
        } finally { fixture.close() }
    }

    @Test
    fun fastHistoryDenialRejectsSlowTasksButKeepsIndependentlyAuthorizedRoutines() = runTest(mainDispatcher) {
        val slowTasks = CompletableDeferred<List<FamilyTaskView>>()
        val slowRoutines = CompletableDeferred<List<RoutineView>>()
        val routine = mockk<RoutineView>(relaxed = true)
        val fixture = fixture(CompletableDeferred(), configureRepository = { repository ->
            coEvery { repository.listRoutines(any(), any()) } coAnswers { slowRoutines.await() }
            coEvery { repository.listFamilyTasks(any(), any()) } coAnswers { slowTasks.await() }
            coEvery { repository.listCareEventHistory(any(), any(), any(), any()) } throws LighthouseApiException(403, "DENIED", "不能查看记录")
        })
        try {
            fixture.signIn(this)
            slowRoutines.complete(listOf(routine))
            slowTasks.complete(listOf(mockk(relaxed = true)))
            advanceUntilIdle()
            assertEquals(listOf(routine), fixture.viewModel.uiState.value.routines)
            assertNull(fixture.viewModel.uiState.value.routineLoadError)
            assertTrue(fixture.viewModel.uiState.value.familyTasks.isEmpty())
            assertEquals("不能查看记录", fixture.viewModel.uiState.value.familyTaskError)
        } finally { fixture.close() }
    }

    @Test
    fun recipientABAIgnoresLateHistorySuccessAndDenial() = runTest(mainDispatcher) {
        for (fail in listOf(false, true)) {
            val late = CompletableDeferred<CareHistoryPage<CareEventView>>()
            var aReads = 0
            val fixture = fixture(CompletableDeferred(), configureRepository = { repository ->
                coEvery { repository.listCareEventHistory(any(), any(), any(), any()) } coAnswers {
                    if (secondArg<String>() == RECIPIENT_A && ++aReads == 1) late.await() else eventPage("current-${secondArg<String>()}")
                }
            })
            try {
                fixture.signIn(this)
                fixture.viewModel.selectRecipient(RECIPIENT_B); advanceUntilIdle()
                fixture.viewModel.selectRecipient(RECIPIENT_A); advanceUntilIdle()
                if (fail) late.completeExceptionally(signedOutError()) else late.complete(eventPage("old-a"))
                advanceUntilIdle()
                assertEquals(listOf(historyEvent("current-$RECIPIENT_A")), fixture.viewModel.uiState.value.careEvents)
                assertNull(fixture.viewModel.uiState.value.eventHistory.error)
                assertTrue(fixture.viewModel.uiState.value.signedIn)
            } finally { fixture.close() }
        }
    }

    @Test
    fun logoutAndReloginDiscardOldHistoryAuthenticationFailure() = runTest(mainDispatcher) {
        val late = CompletableDeferred<CareHistoryPage<CareEventView>>()
        var read = 0
        val fixture = fixture(CompletableDeferred(), configureRepository = { repository ->
            coEvery { repository.listCareEventHistory(any(), any(), any(), any()) } coAnswers {
                if (++read == 2) late.await() else eventPage("current-$read")
            }
        })
        try {
            fixture.signIn(this)
            fixture.viewModel.queryCareHistory(CareHistoryKind.EVENTS, CareHistoryFilter("2026-08-01", "2026-08-31")); runCurrent()
            fixture.viewModel.logout(); advanceUntilIdle()
            assertTrue(fixture.viewModel.uiState.value.careEvents.isEmpty())
            fixture.viewModel.login("family", "password"); advanceUntilIdle()
            late.completeExceptionally(signedOutError()); advanceUntilIdle()
            assertTrue(fixture.viewModel.uiState.value.signedIn)
            assertEquals(listOf(historyEvent("current-3")), fixture.viewModel.uiState.value.careEvents)
            assertEquals(CareHistoryFilter(), fixture.viewModel.uiState.value.eventHistory.filter)
        } finally { fixture.close() }
    }

    @Test
    fun roleChangeClosesHistoryAndReturningToFamilyReloadsIt() = runTest(mainDispatcher) {
        val late = CompletableDeferred<CareHistoryPage<CareEventView>>()
        var read = 0
        val fixture = fixture(CompletableDeferred(), configureRepository = { repository ->
            coEvery { repository.listCareEventHistory(any(), any(), any(), any()) } coAnswers {
                if (++read == 2) late.await() else eventPage("current-$read")
            }
        })
        try {
            fixture.signIn(this)
            fixture.viewModel.queryCareHistory(CareHistoryKind.EVENTS); runCurrent()
            fixture.viewModel.switchRole(AppRole.COMPANION)
            assertTrue(fixture.viewModel.uiState.value.careEvents.isEmpty())
            fixture.viewModel.switchRole(AppRole.FAMILY); advanceUntilIdle()
            late.complete(eventPage("old")); advanceUntilIdle()
            assertEquals(listOf(historyEvent("current-3")), fixture.viewModel.uiState.value.careEvents)
        } finally { fixture.close() }
    }

    @Test
    fun recipientTimezoneChangeResetsHistoryFilterAndOldRequests() = runTest(mainDispatcher) {
        val data = defaultRepositoryState()
        val late = CompletableDeferred<CareHistoryPage<CareEventView>>()
        var read = 0
        val fixture = fixture(CompletableDeferred(), repositoryState = data, configureRepository = { repository ->
            coEvery { repository.listCareEventHistory(any(), any(), any(), any()) } coAnswers {
                if (++read == 2) late.await() else eventPage("current-$read")
            }
        })
        try {
            fixture.signIn(this)
            fixture.viewModel.queryCareHistory(CareHistoryKind.EVENTS, CareHistoryFilter("2026-08-01", "2026-08-31")); runCurrent()
            data.recipientsByHousehold[HOUSEHOLD_ID] = listOf(recipient(RECIPIENT_A).copy(timezone = "America/Los_Angeles"))
            fixture.viewModel.refresh(); advanceUntilIdle()
            late.complete(eventPage("old-zone")); advanceUntilIdle()
            assertEquals(CareHistoryFilter(), fixture.viewModel.uiState.value.eventHistory.filter)
            assertEquals(listOf(historyEvent("current-3")), fixture.viewModel.uiState.value.careEvents)
        } finally { fixture.close() }
    }

    @Test
    fun failedMemoryAndConsentReadsRemainUnknownUntilSuccessfulRefresh() = runTest(mainDispatcher) {
        var fail = true
        val fixture = fixture(CompletableDeferred(), configureRepository = { repository ->
            coEvery { repository.listMemories(any(), any()) } coAnswers {
                if (fail) throw IOException("memory unavailable") else emptyList()
            }
            coEvery { repository.listConsents(any(), any()) } coAnswers {
                if (fail) throw IOException("consent unavailable") else emptyList()
            }
        })
        try {
            fixture.signIn(this)
            assertTrue(fixture.viewModel.uiState.value.memoryLoadError != null)
            assertTrue(fixture.viewModel.uiState.value.consentLoadError != null)
            fail = false
            fixture.viewModel.refresh()
            advanceUntilIdle()
            assertNull(fixture.viewModel.uiState.value.memoryLoadError)
            assertNull(fixture.viewModel.uiState.value.consentLoadError)
        } finally { fixture.close() }
    }

    @Test
    fun slowRefreshCannotUndoTaskClaim() = assertTaskMutationSupersedesSlowRefresh("claim")

    @Test
    fun slowRefreshCannotUndoTaskCompletion() = assertTaskMutationSupersedesSlowRefresh("finish")

    @Test
    fun slowRefreshCannotUndoTaskRelease() = assertTaskMutationSupersedesSlowRefresh("release")

    private fun assertTaskMutationSupersedesSlowRefresh(action: String) = runTest(mainDispatcher) {
        val original = FamilyTaskView(
            "task-1", RECIPIENT_A, "event-1", null, "OPEN", "NORMAL",
            null, null, null, null, 0,
        ).let { if (action == "release") it.copy(status = "CLAIMED", assigneeMemberId = "me", assignedToMe = true, canRelease = true) else it }
        val updated = original.copy(status = when (action) { "finish" -> "RESOLVED"; "release" -> "OPEN"; else -> "CLAIMED" }, version = 1, assigneeMemberId = null, canRelease = false)
        var storedTasks = listOf(original)
        val command = CompletableDeferred<FamilyTaskView>()
        val slowMemories = CompletableDeferred<List<MemoryView>>()
        var blockNextMemoryRead = false
        var taskReads = 0
        val fixture = fixture(CompletableDeferred(), configureRepository = { repository ->
            coEvery { repository.listMemories(any(), any()) } coAnswers {
                if (blockNextMemoryRead) {
                    blockNextMemoryRead = false
                    slowMemories.await()
                } else emptyList()
            }
            coEvery { repository.listFamilyTasks(any(), any()) } coAnswers {
                taskReads++
                storedTasks
            }
            coEvery { repository.claimFamilyTask(any(), any()) } coAnswers { command.await() }
            coEvery { repository.finishFamilyTask(any(), any(), any(), any()) } coAnswers { command.await() }
            coEvery { repository.releaseFamilyTask(any(), any()) } coAnswers { command.await() }
        })
        try {
            fixture.signIn(this)
            when (action) {
                "finish" -> fixture.viewModel.finishFamilyTask(original, true, null)
                "release" -> fixture.viewModel.releaseFamilyTask(original)
                else -> fixture.viewModel.claimFamilyTask(original)
            }
            runCurrent()
            blockNextMemoryRead = true
            fixture.viewModel.refresh()
            runCurrent()
            assertEquals("refresh captured the old task snapshot", 2, taskReads)
            storedTasks = listOf(updated)
            command.complete(updated)
            runCurrent()
            assertEquals(listOf(updated), fixture.viewModel.uiState.value.familyTasks)
            slowMemories.complete(emptyList())
            advanceUntilIdle()
            assertEquals("late refresh must not undo the successful command", listOf(updated), fixture.viewModel.uiState.value.familyTasks)
        } finally { fixture.close() }
    }

    @Test
    fun routineDenialDoesNotHideAuthorizedFamilyTasks() = runTest(mainDispatcher) {
        val task = mockk<FamilyTaskView>(relaxed = true)
        val fixture = fixture(CompletableDeferred(), configureRepository = { repository ->
            coEvery { repository.listRoutines(any(), any()) } throws IOException("没有日程管理权限")
            coEvery { repository.listFamilyTasks(any(), any()) } returns listOf(task)
        })
        try {
            fixture.signIn(this)
            val state = fixture.viewModel.uiState.value
            assertEquals(listOf(task), state.familyTasks)
            assertNull(state.familyTaskError)
            assertTrue(state.routineLoadError.orEmpty().contains("权限"))
            assertTrue(state.error.orEmpty().contains("日程"))
            assertFalse(state.busy)
        } finally { fixture.close() }
    }

    @Test
    fun taskFailureIsVisibleWithoutHidingLoadedRoutines() = runTest(mainDispatcher) {
        val routine = mockk<RoutineView>(relaxed = true)
        val fixture = fixture(CompletableDeferred(), configureRepository = { repository ->
            coEvery { repository.listRoutines(any(), any()) } returns listOf(routine)
            coEvery { repository.listFamilyTasks(any(), any()) } throws IOException("待办不可用")
        })
        try {
            fixture.signIn(this)
            val state = fixture.viewModel.uiState.value
            assertEquals(listOf(routine), state.routines)
            assertNull(state.routineLoadError)
            assertTrue(state.familyTaskError.orEmpty().contains("待办"))
            assertTrue(state.familyTasks.isEmpty())
        } finally { fixture.close() }
    }

    @Before
    fun setUp() {
        Dispatchers.setMain(mainDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        unmockkAll()
    }

    @Test
    fun lateMemoryCreateFromRecipientADoesNotPublishIntoRecipientB() =
        runTest(mainDispatcher) {
            val lateMemory = CompletableDeferred<MemoryView>()
            val fixture = fixture(lateMemory)
            try {
                fixture.signIn(this)

                fixture.viewModel.createMemory(memoryInput())
                runCurrent()
                fixture.viewModel.selectRecipient(RECIPIENT_B)
                advanceUntilIdle()

                assertEquals(RECIPIENT_B, fixture.viewModel.uiState.value.selectedRecipientId)
                assertFalse(
                    "recipient A work must not keep recipient B visibly busy",
                    fixture.viewModel.uiState.value.busy,
                )

                lateMemory.complete(memory("memory-a", RECIPIENT_A))
                advanceUntilIdle()

                val state = fixture.viewModel.uiState.value
                assertEquals(RECIPIENT_B, state.selectedRecipientId)
                assertEquals(emptyList<String>(), state.memories.map { it.id })
                assertNull(state.message)
                assertNull(state.error)
                assertFalse(state.busy)
            } finally {
                fixture.close()
            }
        }

    @Test
    fun lateMemoryFailureFromRecipientADoesNotPublishIntoRecipientB() =
        runTest(mainDispatcher) {
            val lateMemory = CompletableDeferred<MemoryView>()
            val fixture = fixture(lateMemory)
            try {
                fixture.signIn(this)

                fixture.viewModel.createMemory(memoryInput())
                runCurrent()
                fixture.viewModel.selectRecipient(RECIPIENT_B)
                advanceUntilIdle()

                lateMemory.completeExceptionally(IOException("recipient A failed"))
                advanceUntilIdle()

                val state = fixture.viewModel.uiState.value
                assertEquals(RECIPIENT_B, state.selectedRecipientId)
                assertEquals(emptyList<String>(), state.memories.map { it.id })
                assertNull(state.message)
                assertNull(state.error)
                assertFalse(state.busy)
            } finally {
                fixture.close()
            }
        }

    @Test
    fun currentMemorySuccessStillPublishesAndReconciles() = runTest(mainDispatcher) {
        val lateMemory = CompletableDeferred<MemoryView>()
        val fixture = fixture(lateMemory)
        try {
            fixture.signIn(this)

            fixture.viewModel.createMemory(memoryInput())
            runCurrent()
            lateMemory.complete(memory("memory-current", RECIPIENT_A))
            advanceUntilIdle()

            val state = fixture.viewModel.uiState.value
            assertEquals(RECIPIENT_A, state.selectedRecipientId)
            assertEquals(listOf("memory-current"), state.memories.map { it.id })
            assertEquals("记忆已保存", state.message)
            assertNull(state.error)
            assertFalse(state.busy)
        } finally {
            fixture.close()
        }
    }

    @Test
    fun currentMemoryFailureRemainsVisibleAfterSilentReconciliation() =
        runTest(mainDispatcher) {
            val lateMemory = CompletableDeferred<MemoryView>()
            val fixture = fixture(lateMemory)
            try {
                fixture.signIn(this)

                fixture.viewModel.createMemory(memoryInput())
                runCurrent()
                lateMemory.completeExceptionally(IOException("current write failed"))
                advanceUntilIdle()

                val state = fixture.viewModel.uiState.value
                assertEquals(RECIPIENT_A, state.selectedRecipientId)
                assertEquals(emptyList<String>(), state.memories.map { it.id })
                assertEquals("current write failed", state.error)
                assertFalse(state.busy)
            } finally {
                fixture.close()
            }
        }

    @Test
    fun oldMutationCannotReviveAfterSameUserLogsOutAndBackIn() =
        runTest(mainDispatcher) {
            val lateMemory = CompletableDeferred<MemoryView>()
            val fixture = fixture(lateMemory)
            try {
                fixture.signIn(this)
                fixture.viewModel.createMemory(memoryInput())
                runCurrent()

                fixture.viewModel.logout()
                advanceUntilIdle()
                fixture.viewModel.login("family", "password")
                advanceUntilIdle()

                lateMemory.complete(memory("memory-old-session", RECIPIENT_A))
                advanceUntilIdle()

                val state = fixture.viewModel.uiState.value
                assertEquals(RECIPIENT_A, state.selectedRecipientId)
                assertEquals(emptyList<String>(), state.memories.map { it.id })
                assertNull(state.error)
                assertFalse(state.busy)
            } finally {
                fixture.close()
            }
        }

    @Test
    fun staleMutationStillSignsOutItsActiveFamilySession() = runTest(mainDispatcher) {
        val lateMemory = CompletableDeferred<MemoryView>()
        val fixture = fixture(lateMemory)
        try {
            fixture.signIn(this)
            fixture.viewModel.createMemory(memoryInput())
            runCurrent()
            fixture.viewModel.selectRecipient(RECIPIENT_B)
            advanceUntilIdle()

            lateMemory.completeExceptionally(signedOutError())
            advanceUntilIdle()

            val state = fixture.viewModel.uiState.value
            assertFalse(state.signedIn)
            assertNull(state.user)
            assertNull(state.selectedHouseholdId)
            assertEquals("登录状态已失效", state.error)
            assertFalse(state.busy)
        } finally {
            fixture.close()
        }
    }

    @Test
    fun signedOutFromAnOldSessionCannotTerminateANewerLogin() = runTest(mainDispatcher) {
        val lateMemory = CompletableDeferred<MemoryView>()
        val fixture = fixture(lateMemory)
        try {
            fixture.signIn(this)
            fixture.viewModel.createMemory(memoryInput())
            runCurrent()

            fixture.viewModel.logout()
            advanceUntilIdle()
            fixture.viewModel.login("family", "password")
            advanceUntilIdle()

            lateMemory.completeExceptionally(signedOutError())
            advanceUntilIdle()

            val state = fixture.viewModel.uiState.value
            assertEquals(true, state.signedIn)
            assertEquals(USER_ID, state.user?.id)
            assertEquals(RECIPIENT_A, state.selectedRecipientId)
            assertNull(state.error)
            assertFalse(state.busy)
        } finally {
            fixture.close()
        }
    }

    @Test
    fun signedOutDuringMutationReconciliationTerminatesTheActiveSession() =
        runTest(mainDispatcher) {
            val updated = authority(version = 2, accessLevel = "MANAGE")
            val fixture = fixture(
                lateMemory = CompletableDeferred(),
                authorityUpdate = updated,
                careAuthorityReconcileFailure = signedOutError(),
            )
            try {
                fixture.signIn(this)

                fixture.viewModel.putCareAuthority(
                    memberId = MEMBER_ID,
                    input = authorityInput(version = 1),
                    currentPassword = "password",
                )
                advanceUntilIdle()

                val state = fixture.viewModel.uiState.value
                assertFalse(state.signedIn)
                assertNull(state.user)
                assertNull(state.selectedHouseholdId)
                assertEquals("登录状态已失效", state.error)
                assertFalse(state.busy)
            } finally {
                fixture.close()
            }
        }

    @Test
    fun careAuthorityMutationSupersedesAnOlderAuthorityRead() = runTest(mainDispatcher) {
        val lateMemory = CompletableDeferred<MemoryView>()
        val lateAuthorities = CompletableDeferred<List<CareAuthorityView>>()
        val repositoryState = defaultRepositoryState().apply {
            careAuthorities = listOf(authority(version = 1, accessLevel = "VIEW"))
        }
        val updated = authority(version = 2, accessLevel = "MANAGE")
        val fixture = fixture(
            lateMemory = lateMemory,
            repositoryState = repositoryState,
            firstCareAuthorities = lateAuthorities,
            authorityUpdate = updated,
        )
        try {
            fixture.signIn(this)

            fixture.viewModel.loadCareAuthorities()
            runCurrent()
            fixture.viewModel.putCareAuthority(
                memberId = MEMBER_ID,
                input = authorityInput(version = 1),
                currentPassword = "password",
            )
            advanceUntilIdle()

            assertEquals(listOf(2), fixture.viewModel.uiState.value.careAuthorities.map { it.version })
            assertFalse(
                "the superseded read must not keep the current workspace busy",
                fixture.viewModel.uiState.value.busy,
            )

            lateAuthorities.complete(listOf(authority(version = 1, accessLevel = "VIEW")))
            advanceUntilIdle()

            val state = fixture.viewModel.uiState.value
            assertEquals(listOf(2), state.careAuthorities.map { it.version })
            assertEquals("Member 的照护权限已更新", state.message)
            assertNull(state.error)
            assertFalse(state.busy)
        } finally {
            fixture.close()
        }
    }

    @Test
    fun automaticHouseholdFallbackClearsActivationPresentation() = runTest(mainDispatcher) {
        val repositoryState = defaultRepositoryState().apply {
            households = listOf(household(HOUSEHOLD_ID), household(HOUSEHOLD_B))
            recipientsByHousehold[HOUSEHOLD_B] = listOf(recipient(RECIPIENT_B, HOUSEHOLD_B))
        }
        val fixture = fixture(
            lateMemory = CompletableDeferred(),
            repositoryState = repositoryState,
        )
        try {
            fixture.signIn(this)
            fixture.showActivation()

            repositoryState.households = listOf(household(HOUSEHOLD_B))
            fixture.viewModel.refresh()
            advanceUntilIdle()

            val state = fixture.viewModel.uiState.value
            assertEquals(HOUSEHOLD_B, state.selectedHouseholdId)
            assertEquals(RECIPIENT_B, state.selectedRecipientId)
            assertNull(state.activation)
            assertNull(state.activationApprovalDetails)
        } finally {
            fixture.close()
        }
    }

    @Test
    fun automaticRecipientFallbackClearsActivationPresentation() = runTest(mainDispatcher) {
        val repositoryState = defaultRepositoryState()
        val fixture = fixture(
            lateMemory = CompletableDeferred(),
            repositoryState = repositoryState,
        )
        try {
            fixture.signIn(this)
            fixture.showActivation()

            repositoryState.recipientsByHousehold[HOUSEHOLD_ID] =
                listOf(recipient(RECIPIENT_B))
            fixture.viewModel.refresh()
            advanceUntilIdle()

            val state = fixture.viewModel.uiState.value
            assertEquals(HOUSEHOLD_ID, state.selectedHouseholdId)
            assertEquals(RECIPIENT_B, state.selectedRecipientId)
            assertNull(state.activation)
            assertNull(state.activationApprovalDetails)
        } finally {
            fixture.close()
        }
    }

    private fun fixture(
        lateMemory: CompletableDeferred<MemoryView>,
        repositoryState: RepositoryState = defaultRepositoryState(),
        firstCareAuthorities: CompletableDeferred<List<CareAuthorityView>>? = null,
        authorityUpdate: CareAuthorityView? = null,
        careAuthorityReconcileFailure: Throwable? = null,
        configureRepository: (LighthouseRepository) -> Unit = {},
    ): Fixture {
        val repository = mockk<LighthouseRepository>(relaxed = true)
        val storedMemories = mutableMapOf<String, List<MemoryView>>()
        var careAuthorityReadCount = 0
        every { repository.apiBaseUrl() } returns "https://example.invalid/openBMB/api/v1"
        every { repository.hasDeviceCredential() } returns false
        every { repository.pendingDeviceActivation() } returns null
        coEvery { repository.restoreUser() } returns null
        coEvery { repository.login(any(), any()) } returns user()
        coEvery { repository.listHouseholds() } coAnswers { repositoryState.households }
        coEvery { repository.listRecipients(any()) } coAnswers {
            repositoryState.recipientsByHousehold[firstArg()].orEmpty()
        }
        coEvery { repository.listBindings(any()) } returns emptyList<CompanionBindingView>()
        coEvery { repository.listHouseholdMembers(any()) } coAnswers {
            repositoryState.membersByHousehold[firstArg()].orEmpty()
        }
        coEvery { repository.listMemories(any(), any()) } coAnswers {
            storedMemories[secondArg()] ?: emptyList()
        }
        coEvery { repository.listRoutines(any(), any()) } returns emptyList<RoutineView>()
        coEvery {
            repository.listOccurrenceHistory(any(), any(), any(), any())
        } returns CareHistoryPage(emptyList(), null, "Asia/Shanghai", null, null)
        coEvery { repository.listCareEventHistory(any(), any(), any(), any()) } returns CareHistoryPage(emptyList(), null, "Asia/Shanghai", null, null)
        coEvery { repository.listFamilyTasks(any(), any()) } returns emptyList()
        coEvery { repository.listConsents(any(), any()) } returns emptyList<ConsentStateView>()
        coEvery {
            repository.createMemory(HOUSEHOLD_ID, RECIPIENT_A, any())
        } coAnswers {
            lateMemory.await().also { created ->
                storedMemories[RECIPIENT_A] =
                    (storedMemories[RECIPIENT_A].orEmpty() + created).distinctBy { it.id }
            }
        }
        coEvery { repository.listCareAuthorities(any(), any()) } coAnswers {
            val readIndex = careAuthorityReadCount++
            if (readIndex == 0 && firstCareAuthorities != null) {
                firstCareAuthorities.await()
            } else if (careAuthorityReconcileFailure != null) {
                throw careAuthorityReconcileFailure
            } else {
                repositoryState.careAuthorities
            }
        }
        coEvery {
            repository.putCareAuthority(any(), any(), any(), any(), any())
        } coAnswers {
            checkNotNull(authorityUpdate).also {
                repositoryState.careAuthorities = listOf(it)
            }
        }
        coEvery { repository.createActivationChallenge(any(), any()) } returns activation()
        coEvery { repository.activationApprovalDetails(any()) } returns activationApproval()
        configureRepository(repository)

        val callCoordinator = mockk<RemoteCallCoordinator>(relaxed = true)
        every { callCoordinator.state } returns MutableStateFlow(CoordinatedRemoteCallState())
        every { callCoordinator.liveCallState } returns MutableStateFlow(LiveCallState())
        every { callCoordinator.heartbeatConnectionState } returns
            MutableStateFlow<RemoteHeartbeatConnectionState?>(null)
        every { callCoordinator.companionMediaHandoffState } returns
            MutableStateFlow<CompanionMediaHandoffState>(CompanionMediaHandoffState.Idle)

        return Fixture(
            viewModel = LighthouseViewModel(
                repository = repository,
                callCoordinator = callCoordinator,
                remoteCallCommands = mockk<RemoteCallCommandRegistry>(relaxed = true),
            ),
            scope = null,
        )
    }

    private data class Fixture(
        val viewModel: LighthouseViewModel,
        private var scope: TestScope?,
    ) {
        fun signIn(scope: TestScope) {
            this.scope = scope
            scope.advanceUntilIdle()
            viewModel.login("family", "password")
            scope.advanceUntilIdle()
            assertEquals(RECIPIENT_A, viewModel.uiState.value.selectedRecipientId)
        }

        fun showActivation() {
            val currentScope = checkNotNull(scope)
            viewModel.createActivation(RECIPIENT_A)
            currentScope.advanceUntilIdle()
            viewModel.loadActivationApprovalDetails(CHALLENGE_ID)
            currentScope.advanceUntilIdle()
            assertEquals(CHALLENGE_ID, viewModel.uiState.value.activation?.challengeId)
            assertEquals(
                CHALLENGE_ID,
                viewModel.uiState.value.activationApprovalDetails?.challengeId,
            )
        }

        fun close() {
            viewModel.viewModelScope.cancel()
        }
    }

    private class RepositoryState(
        var households: List<HouseholdView>,
        val recipientsByHousehold: MutableMap<String, List<CareRecipientView>>,
        val membersByHousehold: MutableMap<String, List<HouseholdMemberView>>,
        var careAuthorities: List<CareAuthorityView>,
    )

    private fun defaultRepositoryState() = RepositoryState(
        households = listOf(household()),
        recipientsByHousehold = mutableMapOf(
            HOUSEHOLD_ID to listOf(recipient(RECIPIENT_A), recipient(RECIPIENT_B)),
        ),
        membersByHousehold = mutableMapOf(
            HOUSEHOLD_ID to listOf(member()),
        ),
        careAuthorities = emptyList(),
    )

    private fun user() = UserView(
        id = USER_ID,
        displayName = "Family",
        status = "ACTIVE",
        primaryIdentity = "family",
        email = "family@example.com",
        emailVerified = true,
    )

    private fun household(id: String = HOUSEHOLD_ID) = HouseholdView(
        id = id,
        name = "Home",
        timezone = "Asia/Shanghai",
        status = "ACTIVE",
        roleCodes = listOf("OWNER"),
        version = 1,
    )

    private fun member() = HouseholdMemberView(
        id = MEMBER_ID,
        householdId = HOUSEHOLD_ID,
        userId = "member-user",
        displayName = "Member",
        status = "ACTIVE",
        roleCodes = listOf("CAREGIVER"),
        joinedAt = "2026-08-25T00:00:00Z",
        version = 1,
    )

    private fun recipient(
        id: String,
        householdId: String = HOUSEHOLD_ID,
    ) = CareRecipientView(
        id = id,
        householdId = householdId,
        name = id,
        preferredName = id,
        birthDate = null,
        timezone = "Asia/Shanghai",
        homeLabel = null,
        status = "ACTIVE",
        version = 1,
    )

    private fun authority(version: Int, accessLevel: String) = CareAuthorityView(
        id = "authority-1",
        householdId = HOUSEHOLD_ID,
        recipientId = RECIPIENT_A,
        memberId = MEMBER_ID,
        userId = "member-user",
        displayName = "Member",
        relationshipLabel = "家属",
        accessLevel = accessLevel,
        canManageProfile = true,
        canManageConsent = true,
        canManageRoutine = true,
        canViewEvents = true,
        canViewConversation = true,
        canActivateDevice = true,
        canRemoteCall = true,
        receiveNotifications = true,
        contactPriority = 1,
        status = "ACTIVE",
        version = version,
    )

    private fun authorityInput(version: Int) = CareAuthorityInput(
        relationshipLabel = "家属",
        accessLevel = "MANAGE",
        canManageProfile = true,
        canManageConsent = true,
        canManageRoutine = true,
        canViewEvents = true,
        canViewConversation = true,
        canActivateDevice = true,
        canRemoteCall = true,
        receiveNotifications = true,
        contactPriority = 1,
        status = "ACTIVE",
        version = version,
    )

    private fun activation() = ActivationPresentation(
        challengeId = CHALLENGE_ID,
        publicId = "public-1",
        dynamicCode = "123456",
        qrPayload = "activation-payload",
        expiresAt = "2026-08-25T01:00:00Z",
    )

    private fun activationApproval() = ActivationApprovalDetails(
        challengeId = CHALLENGE_ID,
        claimedAt = "2026-08-25T00:00:00Z",
        claimNetworkSource = "127.0.0.1",
        claimSnapshotToken = "snapshot-token",
        device = ActivationApprovalDevice(
            platform = "ANDROID",
            installationKeyAlgorithm = "EC_P256",
            manufacturer = "Google",
            model = "Emulator",
            osVersion = "16",
            appVersion = "1.0.3",
            keyFingerprintSuffix = "ABCD",
        ),
    )

    private fun signedOutError() = LighthouseApiException(
        status = 401,
        code = "SIGNED_OUT",
        message = "登录状态已失效",
    )

    private fun memoryInput() = MemoryInput(
        kind = "STORY",
        title = "A memory",
        content = "Only recipient A owns this memory",
        sensitivity = "HOUSEHOLD",
    )

    private fun memory(id: String, recipientId: String) = MemoryView(
        id = id,
        householdId = HOUSEHOLD_ID,
        recipientId = recipientId,
        kind = "STORY",
        title = "A memory",
        sensitivity = "HOUSEHOLD",
        verificationStatus = "FAMILY_REPORTED",
        status = "ACTIVE",
        currentRevision = MemoryRevisionView(
            id = "revision-$id",
            revisionNo = 1,
            content = "Only recipient A owns this memory",
            source = "FAMILY",
            changeReason = null,
            createdAt = "2026-08-25T00:00:00Z",
        ),
        updatedAt = "2026-08-25T00:00:00Z",
        version = 1,
    )

    private companion object {
        const val USER_ID = "user-1"
        const val HOUSEHOLD_ID = "household-1"
        const val HOUSEHOLD_B = "household-2"
        const val RECIPIENT_A = "recipient-a"
        const val RECIPIENT_B = "recipient-b"
        const val MEMBER_ID = "member-1"
        const val CHALLENGE_ID = "challenge-1"
    }
}
