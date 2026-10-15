package app.phlip.server

/**
 * A member signed up to a [TimeBlock]. Names are plaintext (same as
 * [AvailabilitySignal]); schedule + ids stay plaintext.
 */
data class TimeBlockSignup(
    val userId: String,
    val name: String,
    val ts: Long,
)

/**
 * Lightweight whole-day / timed / multi-day mark on an event channel.
 * Not an [Event]: no RSVP, type matrix, approval, or stub minicard.
 * [title]/[where]/[details] are opaque length-capped blobs (T1.5).
 *
 * [startDay] / [endDay] are local calendar dayStarts (epoch ms at 00:00), inclusive.
 * [startMinutes] / [endMinutes] are minutes from midnight (0–1439) on the first
 * and last day. Null means derive from [startPeriod]/[endPeriod] (legacy) or all-day.
 * [startPeriod] / [endPeriod] are legacy null (whole day) or morning|afternoon|evening.
 * On a single-day block only the start clock/period applies with the end clock.
 */
data class TimeBlock(
    val id: String,
    var channelId: String,
    var createdBy: String,
    var createdByName: String,
    var title: String,
    var where: String = "",
    var details: String = "",
    var startDay: Long,
    var endDay: Long,
    var startPeriod: String? = null,
    var endPeriod: String? = null,
    var startMinutes: Int? = null,
    var endMinutes: Int? = null,
    var createdAt: Long,
    var signups: MutableList<TimeBlockSignup> = mutableListOf(),
)
