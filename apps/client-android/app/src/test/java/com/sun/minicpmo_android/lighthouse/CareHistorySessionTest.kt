package com.sun.minicpmo_android.lighthouse

import com.sun.minicpmo_android.lighthouse.model.CareHistoryFilter
import com.sun.minicpmo_android.lighthouse.model.CareHistoryPage
import com.sun.minicpmo_android.lighthouse.model.CareHistoryRetry
import com.sun.minicpmo_android.lighthouse.model.CareHistoryState
import com.sun.minicpmo_android.lighthouse.network.LighthouseApiException
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CareHistorySessionTest {
    private data class Row(val id: String)
    private data class Request(
        val filter: CareHistoryFilter,
        val cursor: String?,
        val response: CompletableDeferred<CareHistoryPage<Row>> = CompletableDeferred(),
    )

    private class Fixture(onDenied: (LighthouseApiException) -> Unit = {}) {
        val requests = mutableListOf<Request>()
        val published = mutableListOf<CareHistoryState<Row>>()
        val denials = mutableListOf<LighthouseApiException>()
        val session = CareHistorySession(
            loadPage = { filter, cursor ->
                Request(filter, cursor).also(requests::add).response.await()
            },
            idOf = Row::id,
            onState = published::add,
            onAccessDenied = { error -> denials += error; onDenied(error) },
        )
    }

    private val august = CareHistoryFilter("2026-08-01", "2026-08-31", "NEEDS_FAMILY_REVIEW")
    private val september = CareHistoryFilter("2026-09-01", "2026-09-21")
    private fun page(vararg ids: String, cursor: String? = null) = CareHistoryPage(
        items = ids.map(::Row), nextCursor = cursor, timezone = "Asia/Shanghai",
        from = "2026-07-31T16:00:00Z", to = "2026-08-31T16:00:00Z",
    )
    private fun denied(status: Int) = LighthouseApiException(status, "DENIED", "无权查看照护记录")

    @Test fun startsUnloadedAndRefreshKeepsAppliedFilterButDropsTheCursor() = runTest {
        val f = Fixture()
        assertNull(f.session.state.page)
        launch { f.session.refresh(august) }
        runCurrent()
        assertTrue(f.session.state.loading)
        f.requests[0].response.complete(page("old", cursor = "next"))
        runCurrent()
        launch { f.session.refresh() }
        runCurrent()
        assertEquals(august, f.requests[1].filter)
        assertNull(f.requests[1].cursor)
        assertNull(f.session.state.page)
        f.requests[1].response.complete(page("new"))
        runCurrent()
        assertEquals(listOf(Row("new")), f.session.state.page?.items)
        assertFalse(f.session.state.loading)
    }

    @Test fun newQueryClearsRowsErrorsCursorAndAppendImmediately() = runTest {
        val f = Fixture()
        launch { f.session.refresh(august) }; runCurrent()
        f.requests[0].response.complete(page("old", cursor = "next")); runCurrent()
        launch { f.session.loadMore() }; runCurrent()
        launch { f.session.refresh(september) }; runCurrent()
        assertEquals(september, f.session.state.filter)
        assertNull(f.session.state.page)
        assertNull(f.session.state.error)
        assertTrue(f.session.state.loading)
        assertFalse(f.session.state.appending)
        f.requests[1].response.complete(page("late"))
        f.requests[2].response.complete(page("current")); runCurrent()
        assertEquals(listOf(Row("current")), f.session.state.page?.items)
    }

    @Test fun queryABARejectsBothOldSuccessAndOldDenial() = runTest {
        val f = Fixture()
        launch { f.session.refresh(august) }; runCurrent()
        launch { f.session.refresh(september) }; runCurrent()
        launch { f.session.refresh(august) }; runCurrent()
        f.requests[2].response.complete(page("a-new")); runCurrent()
        f.requests[0].response.complete(page("a-old"))
        f.requests[1].response.completeExceptionally(denied(403)); runCurrent()
        assertEquals(august, f.session.state.filter)
        assertEquals(listOf(Row("a-new")), f.session.state.page?.items)
        assertNull(f.session.state.error)
        assertTrue(f.denials.isEmpty())
    }

    @Test fun appendIsSingleFlightAndDeduplicatesIdsWithoutInventingATotal() = runTest {
        val f = Fixture()
        launch { f.session.refresh() }; runCurrent()
        f.requests[0].response.complete(page("1", "2", cursor = "next")); runCurrent()
        launch { f.session.loadMore() }
        launch { f.session.loadMore() }; runCurrent()
        assertEquals(2, f.requests.size)
        assertEquals("next", f.requests[1].cursor)
        assertTrue(f.session.state.appending)
        assertEquals(2, f.session.state.page?.items?.size)
        f.requests[1].response.complete(page("2", "3", "3")); runCurrent()
        assertEquals(listOf("1", "2", "3"), f.session.state.page?.items?.map(Row::id))
        f.session.loadMore()
        assertEquals(2, f.requests.size)
    }

    @Test fun refreshingDuringAppendRejectsLateFailureAndPreservesNewLoadingState() = runTest {
        val f = Fixture()
        launch { f.session.refresh(august) }; runCurrent()
        f.requests[0].response.complete(page("old", cursor = "next")); runCurrent()
        launch { f.session.loadMore() }; runCurrent()
        launch { f.session.refresh() }; runCurrent()
        f.requests[1].response.completeExceptionally(IOException("old network failure")); runCurrent()
        assertTrue(f.session.state.loading)
        assertNull(f.session.state.error)
        f.requests[2].response.complete(page("fresh")); runCurrent()
        assertEquals(listOf(Row("fresh")), f.session.state.page?.items)
    }

    @Test fun appendNetworkFailureRetainsRowsAndRetriesTheSameCursor() = runTest {
        val f = Fixture()
        launch { f.session.refresh(august) }; runCurrent()
        f.requests[0].response.complete(page("1", cursor = "next")); runCurrent()
        launch { f.session.loadMore() }; runCurrent()
        f.requests[1].response.completeExceptionally(IOException("网络中断")); runCurrent()
        assertEquals(listOf(Row("1")), f.session.state.page?.items)
        assertEquals("next", f.session.state.page?.nextCursor)
        assertEquals(CareHistoryRetry.MORE, f.session.state.retry)
        assertEquals("网络中断", f.session.state.error)
        launch { f.session.loadMore() }; runCurrent()
        assertEquals(f.requests[1].filter, f.requests[2].filter)
        assertEquals(f.requests[1].cursor, f.requests[2].cursor)
        f.requests[2].response.complete(page("2")); runCurrent()
        assertEquals(listOf(Row("1"), Row("2")), f.session.state.page?.items)
        assertNull(f.session.state.error)
    }

    @Test fun invalidCursorRequiresFirstPageRefreshWithSameFilter() = runTest {
        val f = Fixture()
        launch { f.session.refresh(august) }; runCurrent()
        f.requests[0].response.complete(page("1", cursor = "expired")); runCurrent()
        launch { f.session.loadMore() }; runCurrent()
        f.requests[1].response.completeExceptionally(LighthouseApiException(400, "BAD_CURSOR", "请重新查询")); runCurrent()
        assertEquals(CareHistoryRetry.REFRESH, f.session.state.retry)
        assertEquals(listOf(Row("1")), f.session.state.page?.items)
        f.session.loadMore()
        assertEquals(2, f.requests.size)
        launch { f.session.refresh() }; runCurrent()
        assertEquals(august, f.requests[2].filter)
        assertNull(f.requests[2].cursor)
        f.requests[2].response.complete(page("fresh")); runCurrent()
    }

    @Test fun permissionFailuresClearProtectedRowsAndCursor() = runTest {
        for (status in listOf(401, 403, 404)) {
            val f = Fixture()
            launch { f.session.refresh(august) }; runCurrent()
            f.requests[0].response.complete(page("private", cursor = "next")); runCurrent()
            launch { f.session.loadMore() }; runCurrent()
            f.requests[1].response.completeExceptionally(denied(status)); runCurrent()
            assertNull(f.session.state.page)
            assertTrue(f.session.state.accessDenied)
            assertEquals(august, f.session.state.filter)
            assertEquals(CareHistoryRetry.REFRESH, f.session.state.retry)
            assertEquals(status, f.denials.single().status)
            f.session.loadMore()
            assertEquals(2, f.requests.size)
        }
    }

    @Test fun sharedDenialClearsSiblingAndInvalidatesItsInFlightAppend() = runTest {
        val events = Fixture()
        val reminders = Fixture { events.session.denyAccess(it.message) }
        launch { events.session.refresh(september) }
        launch { reminders.session.refresh(august) }; runCurrent()
        events.requests[0].response.complete(page("private-event", cursor = "next"))
        reminders.requests[0].response.complete(page("private-reminder", cursor = "next")); runCurrent()
        launch { events.session.loadMore() }
        launch { reminders.session.loadMore() }; runCurrent()
        reminders.requests[1].response.completeExceptionally(denied(403)); runCurrent()
        assertNull(events.session.state.page)
        assertNull(reminders.session.state.page)
        assertEquals(september, events.session.state.filter)
        events.requests[1].response.complete(page("late-private-event")); runCurrent()
        assertNull(events.session.state.page)
        assertTrue(events.session.state.accessDenied)
        assertTrue(events.denials.isEmpty()) // sibling notification does not recurse
        assertEquals(1, reminders.denials.size)
        launch { events.session.refresh() }; runCurrent()
        events.requests[2].response.complete(page("authorized-again")); runCurrent()
        assertFalse(events.session.state.accessDenied)
        assertEquals(september, events.requests[2].filter)
    }

    @Test fun closingScopeDropsLateSuccessAndDoesNotReuseRowsWhenReturningToSameRecipient() = runTest {
        val firstA = Fixture()
        launch { firstA.session.refresh(august) }; runCurrent()
        val publishedBeforeClose = firstA.published.size
        firstA.session.close()
        val secondA = Fixture()
        launch { secondA.session.refresh() }; runCurrent()
        secondA.requests[0].response.complete(page("current-a"))
        firstA.requests[0].response.complete(page("old-a")); runCurrent()
        assertNull(firstA.session.state.page)
        assertEquals(publishedBeforeClose, firstA.published.size)
        assertEquals(listOf(Row("current-a")), secondA.session.state.page?.items)
        assertEquals(CareHistoryFilter(), secondA.session.state.filter)
        firstA.session.refresh()
        firstA.session.loadMore()
        firstA.session.denyAccess("late")
        assertEquals(1, firstA.requests.size)
        assertEquals(publishedBeforeClose, firstA.published.size)
    }

    @Test fun logoutCloseSuppressesLateAuthenticationDenial() = runTest {
        val f = Fixture()
        launch { f.session.refresh() }; runCurrent()
        f.session.close()
        f.requests[0].response.completeExceptionally(denied(401)); runCurrent()
        assertNull(f.session.state.error)
        assertTrue(f.denials.isEmpty())
    }

    @Test fun failedFirstPageIsNotAnEmptySuccessfulPage() = runTest {
        val f = Fixture()
        launch { f.session.refresh() }; runCurrent()
        f.requests[0].response.completeExceptionally(IOException()); runCurrent()
        assertNull(f.session.state.page)
        assertNotNull(f.session.state.error)
        assertFalse(f.session.state.loading)
        assertEquals(CareHistoryRetry.REFRESH, f.session.state.retry)
    }

    @Test fun successfulEmptyPageIsDistinctFromAnUnloadedPage() = runTest {
        val f = Fixture()
        launch { f.session.refresh() }; runCurrent()
        f.requests[0].response.complete(page()); runCurrent()
        assertNotNull(f.session.state.page)
        assertTrue(f.session.state.page!!.items.isEmpty())
        assertNull(f.session.state.error)
        f.session.loadMore()
        assertEquals(1, f.requests.size)
    }

    @Test fun cancellationClearsOnlyItsOwnLoadingStateAndRetainsAppendRows() = runTest {
        val f = Fixture()
        launch { f.session.refresh() }; runCurrent()
        f.requests[0].response.complete(page("1", cursor = "next")); runCurrent()
        val append = launch { f.session.loadMore() }; runCurrent()
        append.cancel(); runCurrent()
        assertFalse(f.session.state.appending)
        assertEquals(listOf(Row("1")), f.session.state.page?.items)
        assertEquals("next", f.session.state.page?.nextCursor)
        assertNull(f.session.state.error)
        assertTrue(append.isCancelled)
        val old = launch { f.session.refresh() }; runCurrent()
        launch { f.session.refresh(september) }; runCurrent()
        old.cancel(); runCurrent()
        assertTrue(f.session.state.loading)
        assertEquals(september, f.session.state.filter)
        f.requests[3].response.complete(page("new")); runCurrent()
    }

    @Test fun mismatchedPageWindowIsNotAppendedAndRequiresRefresh() = runTest {
        for (mismatch in listOf(
            page("bad").copy(timezone = "America/Los_Angeles"),
            page("bad").copy(from = "2026-08-01T16:00:00Z"),
            page("bad").copy(to = "2026-09-01T16:00:00Z"),
        )) {
            val f = Fixture()
            launch { f.session.refresh() }; runCurrent()
            f.requests[0].response.complete(page("1", cursor = "next")); runCurrent()
            launch { f.session.loadMore() }; runCurrent()
            f.requests[1].response.complete(mismatch); runCurrent()
            assertEquals(listOf(Row("1")), f.session.state.page?.items)
            assertEquals(CareHistoryRetry.REFRESH, f.session.state.retry)
            assertNotNull(f.session.state.error)
            f.session.loadMore()
            assertEquals(2, f.requests.size)
        }
    }
}
