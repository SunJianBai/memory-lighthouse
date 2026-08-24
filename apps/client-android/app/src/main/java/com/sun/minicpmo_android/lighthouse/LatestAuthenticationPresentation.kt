package com.sun.minicpmo_android.lighthouse

internal data class AuthenticationPresentationTicket(
    val generation: Long,
)

/** Owns account-facing busy, errors and user data on the current screen. */
internal class LatestAuthenticationPresentation {
    private var generation = 0L

    fun begin(): AuthenticationPresentationTicket =
        AuthenticationPresentationTicket(++generation)

    fun snapshot(): AuthenticationPresentationTicket =
        AuthenticationPresentationTicket(generation)

    fun invalidate() {
        generation += 1
    }

    fun isCurrent(ticket: AuthenticationPresentationTicket): Boolean =
        ticket.generation == generation
}
