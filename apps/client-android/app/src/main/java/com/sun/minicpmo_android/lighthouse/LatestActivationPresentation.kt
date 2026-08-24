package com.sun.minicpmo_android.lighthouse

internal data class ActivationPresentationTicket(
    val generation: Long,
)

/**
 * Owns user-facing activation results only. Device installation, pending
 * activation and device credentials have a separate durable lifecycle.
 */
internal class LatestActivationPresentation {
    private var generation = 0L

    fun begin(): ActivationPresentationTicket = ActivationPresentationTicket(++generation)

    fun snapshot(): ActivationPresentationTicket = ActivationPresentationTicket(generation)

    fun invalidate() {
        generation += 1
    }

    fun isCurrent(ticket: ActivationPresentationTicket): Boolean =
        ticket.generation == generation
}
