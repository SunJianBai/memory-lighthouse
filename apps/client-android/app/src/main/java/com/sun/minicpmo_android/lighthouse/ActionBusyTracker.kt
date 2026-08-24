package com.sun.minicpmo_android.lighthouse

/**
 * Tracks visible work without letting an obsolete latest-wins request keep the
 * whole screen busy. The ViewModel owns this tracker on its main dispatcher.
 */
internal class ActionBusyTracker {
    private var nextLeaseId = 0L
    private val resultOwners = linkedMapOf<Long, () -> Boolean>()

    fun begin(isResultOwner: () -> Boolean): Long {
        val leaseId = ++nextLeaseId
        resultOwners[leaseId] = isResultOwner
        return leaseId
    }

    fun end(leaseId: Long) {
        resultOwners.remove(leaseId)
    }

    fun isBusy(): Boolean = resultOwners.values.any { it() }
}
