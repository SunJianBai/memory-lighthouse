package com.sun.minicpmo_android.lighthouse.data

internal data class CompanionSessionTicket(
    val generation: Long,
    val sessionId: String?,
)

/**
 * Owns the local identity of the server-side AI companion session. Network
 * serialization lives in LighthouseRepository; this class supplies the
 * synchronous generation fence needed by UI acknowledgements and credential
 * revocation paths that may invalidate an in-flight operation.
 */
internal class CompanionSessionOwnership {
    private val monitor = Any()
    private var generation = 0L
    private var activeSessionId: String? = null
    private var starting = false

    fun snapshot(): CompanionSessionTicket = synchronized(monitor) {
        CompanionSessionTicket(generation, activeSessionId)
    }

    fun beginStart(): CompanionSessionTicket = synchronized(monitor) {
        check(!starting && activeSessionId == null) {
            "已有 AI 陪伴会话正在启动或运行"
        }
        generation += 1
        starting = true
        CompanionSessionTicket(generation, null)
    }

    fun activate(ticket: CompanionSessionTicket, sessionId: String): Boolean =
        synchronized(monitor) {
            if (ticket.generation != generation || !starting) {
                return@synchronized false
            }
            starting = false
            activeSessionId = sessionId
            true
        }

    fun cancelStart(ticket: CompanionSessionTicket): Boolean = synchronized(monitor) {
        if (ticket.generation != generation || !starting) {
            return@synchronized false
        }
        advanceToIdle()
        true
    }

    fun clearSession(sessionId: String): Boolean = synchronized(monitor) {
        if (activeSessionId != sessionId) return@synchronized false
        advanceToIdle()
        true
    }

    fun clearIfCurrent(ticket: CompanionSessionTicket): Boolean = synchronized(monitor) {
        if (ticket.generation != generation) return@synchronized false
        advanceToIdle()
        true
    }

    fun invalidate() = synchronized(monitor) {
        advanceToIdle()
    }

    fun isCurrent(ticket: CompanionSessionTicket): Boolean = synchronized(monitor) {
        ticket.generation == generation
    }

    fun hasActiveSession(): Boolean = synchronized(monitor) {
        activeSessionId != null
    }

    private fun advanceToIdle() {
        generation += 1
        starting = false
        activeSessionId = null
    }
}

internal class CompanionSessionOperationSupersededException : Exception(
    "AI 陪伴会话操作已被更新的设备状态取代",
)
