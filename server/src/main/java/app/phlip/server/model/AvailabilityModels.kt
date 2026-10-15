package app.phlip.server

/**
 * § I'm available — a peer signal that another member is also free during an
 * [Availability] window, optionally proposing a specific [startWhen] inside it.
 */
data class AvailabilitySignal(
    val userId: String,
    val name: String,
    val startWhen: Long? = null,
    val ts: Long,
)

/**
 * § I'm available — lightweight free-time mark on an event channel.
 * Not an [Event]: no approval, clone, type matrix, or RSVP. [where]/[details]
 * are opaque length-capped blobs (T1.5); schedule + ids stay plaintext.
 */
data class Availability(
    val id: String,
    var channelId: String,
    var userId: String,
    var userName: String,
    var `when`: Long,
    /** Window length in milliseconds; must be > 0. */
    var duration: Long,
    var where: String = "",
    var details: String = "",
    var signals: MutableList<AvailabilitySignal> = mutableListOf(),
    var createdAt: Long,
)
