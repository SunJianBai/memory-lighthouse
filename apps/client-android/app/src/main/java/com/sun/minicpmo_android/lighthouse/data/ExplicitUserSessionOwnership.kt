package com.sun.minicpmo_android.lighthouse.data

import com.sun.minicpmo_android.lighthouse.model.UserSession

internal data class ExplicitUserSessionTicket(
    val generation: Long,
)

/**
 * Serializes the small durable boundary where an explicit login intent may
 * replace local user authority. Network calls stay outside the monitor; only
 * begin, commit and invalidation touch the protected credential state.
 */
internal class ExplicitUserSessionOwnership {
    private val monitor = Any()
    private var generation = 0L

    fun begin(clearPreviousSession: () -> Unit): ExplicitUserSessionTicket =
        synchronized(monitor) {
            generation += 1
            clearPreviousSession()
            ExplicitUserSessionTicket(generation)
        }

    fun snapshot(): ExplicitUserSessionTicket = synchronized(monitor) {
        ExplicitUserSessionTicket(generation)
    }

    fun <T> invalidate(clearSession: () -> T): T = synchronized(monitor) {
        generation += 1
        clearSession()
    }

    fun invalidateIfCurrent(
        ticket: ExplicitUserSessionTicket,
        shouldInvalidate: () -> Boolean = { true },
        clearSession: () -> Unit,
    ): Boolean = synchronized(monitor) {
        if (ticket.generation != generation || !shouldInvalidate()) {
            return@synchronized false
        }
        generation += 1
        clearSession()
        true
    }

    fun commitIfCurrent(
        ticket: ExplicitUserSessionTicket,
        commit: () -> Unit,
    ): Boolean = synchronized(monitor) {
        if (ticket.generation != generation) return@synchronized false
        commit()
        true
    }

    fun isCurrent(ticket: ExplicitUserSessionTicket): Boolean = synchronized(monitor) {
        ticket.generation == generation
    }
}

internal class ExplicitUserSessionSupersededException : Exception(
    "登录请求已被更新的账号操作取代",
)

internal data class UserSessionRevocation internal constructor(
    internal val session: UserSession,
)
