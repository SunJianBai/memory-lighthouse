package com.sun.minicpmo_android.lighthouse.ui

import com.sun.minicpmo_android.lighthouse.model.CompanionAuthorizationCheck
import com.sun.minicpmo_android.lighthouse.model.DeviceReadinessView
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CompanionStartupCheckTest {
    private val report = DeviceReadinessView("device", "binding", "2026-09-20T04:00:00Z",
        CompanionAuthorizationCheck(true, emptyList()), CompanionAuthorizationCheck(false, listOf("CAMERA_CAPTURE")), true)

    @Test fun onlyChecksOnRequestAndExpires() = runTest {
        var calls = 0
        val check = CompanionStartupCheck("device", "binding", backgroundScope) { calls++; report }
        assertEquals(0, calls)
        assertEquals(StartupCheckPhase.IDLE, check.state.value.phase)
        check.check(); runCurrent()
        assertEquals(report, check.state.value.report)
        assertEquals(1, calls)
        advanceTimeBy(60_000); runCurrent()
        assertEquals(StartupCheckPhase.EXPIRED, check.state.value.phase)
        assertNull(check.state.value.report)
    }

    @Test fun failedRetryClearsOldSuccessAndCanRecover() = runTest {
        var failed = false
        val check = CompanionStartupCheck("device", "binding", backgroundScope) { if (failed) error("离线") else report }
        check.check(); runCurrent(); assertNotNull(check.state.value.report)
        failed = true
        check.check(); assertNull(check.state.value.report); runCurrent()
        assertEquals("离线", check.state.value.error)
        failed = false
        check.check(); runCurrent(); assertEquals(StartupCheckPhase.DONE, check.state.value.phase)
    }

    @Test fun transportTimeCountsTowardsSnapshotLifetime() = runTest {
        val check = CompanionStartupCheck("device", "binding", backgroundScope) {
            delay(10_000)
            report
        }
        check.check(); runCurrent()
        advanceTimeBy(10_000); runCurrent()
        assertEquals(StartupCheckPhase.DONE, check.state.value.phase)
        advanceTimeBy(50_000); runCurrent()
        assertEquals(StartupCheckPhase.EXPIRED, check.state.value.phase)
        assertNull(check.state.value.report)
    }

    @Test fun lateNonCancellableResultCannotReplaceANewerCheck() = runTest {
        val pending = CompletableDeferred<DeviceReadinessView>()
        var calls = 0
        val check = CompanionStartupCheck("device", "binding", backgroundScope) {
            if (++calls == 1) withContext(NonCancellable) { pending.await() } else report.copy(modelConfigured = false)
        }
        check.check(); runCurrent()
        check.check(); assertEquals(1, calls)
        check.invalidate()
        check.check(); runCurrent()
        pending.complete(report); runCurrent()
        assertFalse(check.state.value.report!!.modelConfigured)
    }

    @Test fun invalidationDiscardsVisibleSuccessAndPendingResults() = runTest {
        val pending = CompletableDeferred<DeviceReadinessView>()
        val check = CompanionStartupCheck("device", "binding", backgroundScope) { pending.await() }
        check.check(); runCurrent(); check.invalidate()
        pending.complete(report); runCurrent()
        assertEquals(StartupCheckPhase.EXPIRED, check.state.value.phase)
        assertNull(check.state.value.report)
    }

    @Test fun wrongBindingCannotBeDisplayedAsAValidCheck() = runTest {
        val check = CompanionStartupCheck("device", "binding", backgroundScope) { report.copy(bindingId = "other") }
        check.check(); runCurrent()
        assertEquals(StartupCheckPhase.ERROR, check.state.value.phase)
        assertNull(check.state.value.report)
    }

    @Test fun requestTimeoutShowsRecovery() = runTest {
        val check = CompanionStartupCheck("device", "binding", backgroundScope) { CompletableDeferred<DeviceReadinessView>().await() }
        check.check(); runCurrent()
        advanceTimeBy(15_000); runCurrent()
        assertEquals(StartupCheckPhase.ERROR, check.state.value.phase)
        assertEquals("检查超时，请稍后重试", check.state.value.error)
    }
}
