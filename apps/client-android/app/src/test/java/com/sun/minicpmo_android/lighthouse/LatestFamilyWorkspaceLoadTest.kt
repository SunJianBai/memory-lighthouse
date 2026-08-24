package com.sun.minicpmo_android.lighthouse

import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Test

class LatestFamilyWorkspaceLoadTest {
    @Test
    fun newerWorkspaceWinsWhenOlderRequestCompletesLast() = runBlocking {
        val loads = LatestFamilyWorkspaceLoad()
        val firstResponse = CompletableDeferred<String>()
        val secondResponse = CompletableDeferred<String>()
        val firstScope = loads.begin()
        val first = async(start = CoroutineStart.UNDISPATCHED) {
            loads.load(firstScope) { firstResponse.await() }
        }
        val secondScope = loads.begin()
        val second = async(start = CoroutineStart.UNDISPATCHED) {
            loads.load(secondScope) { secondResponse.await() }
        }

        secondResponse.complete("workspace-b")
        assertEquals(
            FamilyWorkspaceLoadResult.CurrentSuccess("workspace-b"),
            second.await(),
        )

        firstResponse.complete("workspace-a")
        assertSame(FamilyWorkspaceLoadResult.Stale, first.await())
    }

    @Test
    fun staleFailureDoesNotReplaceNewerSuccess() = runBlocking {
        val loads = LatestFamilyWorkspaceLoad()
        val firstResponse = CompletableDeferred<String>()
        val secondResponse = CompletableDeferred<String>()
        val firstScope = loads.begin()
        val first = async(start = CoroutineStart.UNDISPATCHED) {
            loads.load(firstScope) { firstResponse.await() }
        }
        val secondScope = loads.begin()
        val second = async(start = CoroutineStart.UNDISPATCHED) {
            loads.load(secondScope) { secondResponse.await() }
        }

        secondResponse.complete("workspace-b")
        assertEquals(
            FamilyWorkspaceLoadResult.CurrentSuccess("workspace-b"),
            second.await(),
        )

        firstResponse.completeExceptionally(IOException("late failure"))
        assertSame(FamilyWorkspaceLoadResult.Stale, first.await())
    }

    @Test
    fun currentFailureRemainsVisibleToItsOwner() = runBlocking {
        val loads = LatestFamilyWorkspaceLoad()
        val scope = loads.begin()
        val failure = IOException("current failure")

        val result = loads.load<String>(scope) { throw failure }

        assertEquals(FamilyWorkspaceLoadResult.CurrentFailure(failure), result)
    }

    @Test
    fun invalidatedWorkspaceCannotPublishALateSuccess() = runBlocking {
        val loads = LatestFamilyWorkspaceLoad()
        val response = CompletableDeferred<String>()
        val scope = loads.begin()
        val request = async(start = CoroutineStart.UNDISPATCHED) {
            loads.load(scope) { response.await() }
        }

        loads.invalidate()
        response.complete("signed-out workspace")

        assertSame(FamilyWorkspaceLoadResult.Stale, request.await())
    }

    @Test
    fun cancellationIsNeverConvertedIntoAVisibleFailure() {
        val loads = LatestFamilyWorkspaceLoad()
        val scope = loads.begin()
        val cancelled = CancellationException("cancelled")

        val thrown = assertThrows(CancellationException::class.java) {
            runBlocking {
                loads.load<String>(scope) { throw cancelled }
            }
        }

        assertSame(cancelled, thrown)
    }
}
