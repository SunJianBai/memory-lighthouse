package com.sun.minicpmo_android.lighthouse

import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CancellationException

internal data class FamilyWorkspaceLoadScope(
    internal val generation: Long,
)

internal sealed interface FamilyWorkspaceLoadResult<out T> {
    data class CurrentSuccess<T>(val value: T) : FamilyWorkspaceLoadResult<T>

    data class CurrentFailure(val error: Throwable) : FamilyWorkspaceLoadResult<Nothing>

    data object Stale : FamilyWorkspaceLoadResult<Nothing>
}

/**
 * Assigns ownership to the newest family-workspace request.
 *
 * The scope starts before the household list request and remains the same for
 * household details and recipient resources. HTTP cancellation is best effort,
 * so every success and failure is classified again when it completes.
 */
internal class LatestFamilyWorkspaceLoad {
    private val latestGeneration = AtomicLong(0)

    fun begin(): FamilyWorkspaceLoadScope =
        FamilyWorkspaceLoadScope(latestGeneration.incrementAndGet())

    fun invalidate() {
        latestGeneration.incrementAndGet()
    }

    fun isCurrent(scope: FamilyWorkspaceLoadScope): Boolean =
        latestGeneration.get() == scope.generation

    suspend fun <T> load(
        scope: FamilyWorkspaceLoadScope,
        loader: suspend () -> T,
    ): FamilyWorkspaceLoadResult<T> = try {
        val value = loader()
        if (isCurrent(scope)) {
            FamilyWorkspaceLoadResult.CurrentSuccess(value)
        } else {
            FamilyWorkspaceLoadResult.Stale
        }
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (error: Throwable) {
        if (isCurrent(scope)) {
            FamilyWorkspaceLoadResult.CurrentFailure(error)
        } else {
            FamilyWorkspaceLoadResult.Stale
        }
    }
}
