package app.phlip.server

import android.os.Build
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

/**
 * Host-device Android security-patch age (no permission required).
 * Buckets match host-security-posture §8.3 — warn, never refuse to host.
 */
object DevicePatchStatus {

    enum class Bucket { GREEN, AMBER, RED }

    data class Info(
        val bucket: Bucket,
        /** Raw `Build.VERSION.SECURITY_PATCH` or null if missing. */
        val patchDate: String?,
        val monthsAgo: Long?,
    )

    fun evaluate(): Info {
        val raw = try {
            Build.VERSION.SECURITY_PATCH?.trim()?.takeIf { it.isNotEmpty() }
        } catch (_: Throwable) {
            null
        }
        if (raw.isNullOrBlank()) return Info(Bucket.AMBER, null, null)
        return try {
            val d = LocalDate.parse(raw, DateTimeFormatter.ISO_LOCAL_DATE)
            val months = ChronoUnit.MONTHS.between(d, LocalDate.now()).coerceAtLeast(0)
            val bucket = when {
                months < 6 -> Bucket.GREEN
                months <= 24 -> Bucket.AMBER
                else -> Bucket.RED
            }
            Info(bucket, raw, months)
        } catch (_: Exception) {
            Info(Bucket.AMBER, raw, null)
        }
    }

    fun friendlyPatchLabel(info: Info): String {
        val raw = info.patchDate ?: return "unknown"
        return try {
            val d = LocalDate.parse(raw, DateTimeFormatter.ISO_LOCAL_DATE)
            d.format(DateTimeFormatter.ofPattern("MMMM yyyy"))
        } catch (_: Exception) {
            raw
        }
    }
}
