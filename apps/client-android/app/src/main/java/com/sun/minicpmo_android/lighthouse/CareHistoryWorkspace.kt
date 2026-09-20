package com.sun.minicpmo_android.lighthouse

import com.sun.minicpmo_android.lighthouse.data.LighthouseRepository
import com.sun.minicpmo_android.lighthouse.model.CareEventView
import com.sun.minicpmo_android.lighthouse.model.CareHistoryState
import com.sun.minicpmo_android.lighthouse.model.OccurrenceView
import com.sun.minicpmo_android.lighthouse.network.LighthouseApiException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

internal data class CareHistoryWorkspaceKey(
    val userId: String,
    val householdId: String,
    val recipientId: String,
    val timezone: String,
)

/** Shares VIEW_EVENTS denial with both histories and a captured family-task read. Main only. */
internal class CareHistoryWorkspace(
    val key: CareHistoryWorkspaceKey,
    repository: LighthouseRepository,
    onOccurrences: (CareHistoryState<OccurrenceView>) -> Unit,
    onEvents: (CareHistoryState<CareEventView>) -> Unit,
    private val onDenied: (LighthouseApiException) -> Unit,
) {
    var accessGeneration = 0L
        private set
    var accessError: String? = null
        private set
    private var closed = false

    val occurrences = CareHistorySession(
        loadPage = { filter, cursor -> repository.listOccurrenceHistory(key.householdId, key.recipientId, filter, cursor) },
        idOf = OccurrenceView::id, onState = onOccurrences, onAccessDenied = ::denyAccess,
    )
    val events = CareHistorySession(
        loadPage = { filter, cursor -> repository.listCareEventHistory(key.householdId, key.recipientId, filter, cursor) },
        idOf = CareEventView::id, onState = onEvents, onAccessDenied = ::denyAccess,
    )

    fun refresh(scope: CoroutineScope): kotlinx.coroutines.Job {
        val access = ++accessGeneration
        accessError = null
        return scope.launch {
            coroutineScope {
                launch { if (acceptsAccess(access)) occurrences.refresh() }
                launch { if (acceptsAccess(access)) events.refresh() }
            }
        }
    }

    fun acceptsAccess(generation: Long) = !closed && accessError == null && accessGeneration == generation

    fun denyAccess(error: LighthouseApiException) {
        if (closed) return
        accessGeneration++
        accessError = error.message
        occurrences.denyAccess(error.message)
        events.denyAccess(error.message)
        onDenied(error)
    }

    fun close() {
        closed = true
        accessGeneration++
        occurrences.close()
        events.close()
    }
}
