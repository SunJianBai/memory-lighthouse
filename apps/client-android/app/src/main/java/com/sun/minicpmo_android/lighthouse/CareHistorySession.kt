package com.sun.minicpmo_android.lighthouse

import com.sun.minicpmo_android.lighthouse.model.CareHistoryFilter
import com.sun.minicpmo_android.lighthouse.model.CareHistoryPage
import com.sun.minicpmo_android.lighthouse.model.CareHistoryRetry
import com.sun.minicpmo_android.lighthouse.model.CareHistoryState
import com.sun.minicpmo_android.lighthouse.network.LighthouseApiException
import kotlinx.coroutines.CancellationException

/**
 * One record kind for one signed-in recipient scope. Confined to the main dispatcher.
 * The owner closes this session when the user, role, recipient or timezone changes;
 * a new session must be created even when returning to a previous recipient (A -> B -> A).
 * The loader captures that scope and uses the repository's validated page contract.
 */
internal class CareHistorySession<T>(
    private val loadPage: suspend (CareHistoryFilter, String?) -> CareHistoryPage<T>,
    private val idOf: (T) -> String,
    private val onState: (CareHistoryState<T>) -> Unit,
    private val onAccessDenied: (LighthouseApiException) -> Unit,
) {
    var state = CareHistoryState<T>()
        private set

    private var generation = 0L
    private var closed = false

    suspend fun refresh(filter: CareHistoryFilter = state.filter) {
        if (!closed) load(filter, append = false)
    }

    suspend fun loadMore() {
        if (closed || state.loading || state.appending || state.accessDenied ||
            state.page?.nextCursor == null ||
            state.error != null && state.retry == CareHistoryRetry.REFRESH
        ) return
        load(state.filter, append = true)
    }

    /** Clear this and sibling VIEW_EVENTS resources without recursively emitting denial. */
    fun denyAccess(message: String) {
        if (closed) return
        generation++
        publish(state.copy(
            page = null, loading = false, appending = false,
            error = message, retry = CareHistoryRetry.REFRESH, accessDenied = true,
        ))
    }

    /** Invalidate even transports that cannot be cancelled; never notify the old owner again. */
    fun close() {
        closed = true
        generation++
        state = CareHistoryState()
    }

    private suspend fun load(filter: CareHistoryFilter, append: Boolean) {
        val requestGeneration = ++generation
        val previous = if (append) state.page else null
        publish(CareHistoryState(
            filter = filter, page = previous, loading = !append, appending = append,
            retry = if (append) CareHistoryRetry.MORE else CareHistoryRetry.REFRESH,
        ))
        try {
            val page = loadPage(filter, previous?.nextCursor)
            if (!owns(requestGeneration)) return
            // A cursor pins the original window and timezone; never mix different windows.
            if (previous != null && (previous.timezone != page.timezone ||
                    previous.from != page.from || previous.to != page.to)) {
                publish(state.copy(
                    loading = false, appending = false,
                    error = "记录范围已变更，请重新查询", retry = CareHistoryRetry.REFRESH,
                ))
                return
            }
            val items = (previous?.items.orEmpty() + page.items).distinctBy(idOf)
            publish(CareHistoryState(filter = filter, page = page.copy(items = items)))
        } catch (cancelled: CancellationException) {
            if (owns(requestGeneration)) {
                publish(state.copy(loading = false, appending = false))
            }
            throw cancelled
        } catch (error: Exception) {
            if (!owns(requestGeneration)) return
            val denied = error is LighthouseApiException && error.status in setOf(401, 403, 404)
            val invalidCursor = error is LighthouseApiException && error.status == 400
            val message = error.message?.takeIf(String::isNotBlank) ?: "记录加载失败，请重试"
            if (denied) {
                denyAccess(message)
                onAccessDenied(error as LighthouseApiException)
            } else {
                publish(state.copy(
                    loading = false, appending = false, error = message,
                    retry = if (append && !invalidCursor) CareHistoryRetry.MORE else CareHistoryRetry.REFRESH,
                ))
            }
        }
    }

    private fun owns(requestGeneration: Long) = !closed && requestGeneration == generation

    private fun publish(next: CareHistoryState<T>) {
        state = next
        onState(next)
    }
}
