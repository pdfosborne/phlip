package app.phlip.server

import java.util.Locale
import org.json.JSONObject

internal const val MAX_CLIENTS = 100
internal const val MAX_PENDING = 50
internal const val MAX_CHANNELS = 50
/** One board owns three channels, leaving room under [MAX_CHANNELS] for Welcome. */
internal const val MAX_BOARDS = 16
internal const val MAX_CATEGORIES = 20
internal const val MAX_EVENT_TYPES = 60
internal const val MAX_LOCATIONS = 50
/** Server-wide reusable drawn reaction cards (d: payloads). */
internal const val MAX_REACTION_CARDS = 40
/** Cap how many reactions one member can stack on a single event. */
internal const val MAX_REACTIONS_PER_USER = 24
internal const val MAX_CIPHERTEXT = 8000
internal fun opaqueCiphertext(raw: String): String = raw.take(MAX_CIPHERTEXT)
internal const val MAX_REPORTS = 500
internal const val MAX_OPEN_REPORTS_PER_REPORTER = 20
internal const val MAX_REPORT_NOTE = 1000
internal const val MAX_ICON_NAME = 64
internal const val MAX_SERVER_ACTIVITY = 50
internal const val MAX_DRAWN_ICON = 100_000
internal const val MAX_SERVER_PIC = 150_000
internal const val MAX_PROFILE_PIC = 12_000
internal const val MAX_SERVER_DESCRIPTION = 500

internal const val INVITE_TTL_MS = 60L * 60 * 1000
internal const val INVITE_CODE_LEN = 6
/** Personal request-to-join slug length (URL path segment). */
internal const val PERSONAL_INVITE_SLUG_LEN = 16
internal const val GROUP_INVITE_TTL_MS = 24L * 60 * 60 * 1000
internal const val GROUP_INVITE_CODE_LEN = 12
internal const val MAX_GROUP_INVITES = 50
/**
 * Optional App Link prefix only (deep-link into the installed app).
 * Never use as the canonical Copy/Share invite.
 */
internal const val PERSONAL_INVITE_APP_LINK_BASE = "https://phlipapp.com/j/"

/** @deprecated Use [personalInviteUrlFor] with the server's share origin. */
@Deprecated("Canonical invites use each server origin", ReplaceWith("personalInviteUrlFor(slug, sharePublic, shareLan, isPublic)"))
internal const val PERSONAL_INVITE_LINK_BASE = PERSONAL_INVITE_APP_LINK_BASE

/**
 * Canonical invite URL on the server's reachable origin.
 * - Public: `https://<host>/j/<slug>` (personal attribution path)
 * - Local/Direct: bare `http://<lan>:<port>` (SPA join — no `/j/` slug noise)
 */
internal fun personalInviteUrlFor(
    slug: String,
    sharePublicUrl: String,
    shareLanUrl: String,
    isPublic: Boolean,
): String {
    val pub = sharePublicUrl.trim().trimEnd('/')
    val lan = shareLanUrl.trim().trimEnd('/')
    if (isPublic && pub.isNotEmpty()) {
        val s = slug.trim().lowercase().replace(Regex("[^a-z0-9]"), "")
        if (s.length < 8) return ""
        return "$pub/j/$s"
    }
    if (lan.isNotEmpty()) return lan
    return ""
}
internal const val RATE_MAX_FAILS = 5
internal const val RATE_LOCK_MS = 60_000L
internal const val RATE_MAX_FAILS_LAN = 40
internal const val RATE_LOCK_MS_LAN = 10_000L
internal const val MAX_SHARE_LINKS = 30
internal const val MAX_SHARE_ENC_ENTRIES = 200
internal const val MAX_REQUEST_BODY = 256_000
internal const val SHARE_RPC_WINDOW_MS = 10_000L
internal const val SHARE_RPC_MAX_PER_WINDOW = 40
internal const val MAX_SHARE_GUESTS = 50
internal const val MAX_CONCURRENT_POLLS = 80
internal const val SHARE_GUEST_MAX_SESSION_MS = 12L * 60 * 60 * 1000
internal const val SHARE_EVENT_GRACE_MS = 2L * 60 * 60 * 1000
internal val EVENT_DURATION_CODES = setOf(
    "5m", "10m", "15m", "30m", "45m", "1h", "2h", "3h", "4h",
    "morning", "afternoon", "evening", "day",
)
internal const val DEFAULT_EVENT_DURATION = "1h"
internal const val MAX_SHARE_NAME = 24
internal const val HTTP_PRESENCE_IDLE_MS = 40_000L
internal const val PRESENCE_TICK_MS = 8_000L
internal const val PRESENCE_TICK_IDLE_MS = 60_000L
internal const val BASE32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

internal fun clampIcon(raw: String?): String? {
    val s = raw?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    if (s.startsWith("d:")) return s.take(MAX_DRAWN_ICON)
    if (s.length <= MAX_ICON_NAME && s.matches(Regex("^[A-Za-z0-9][A-Za-z0-9_-]*$"))) return s
    if (s.length <= 8 && !s.contains('<') && !s.contains('>') && !s.contains('&') && !s.contains('"')) return s.take(8)
    return null
}

internal fun clampReaction(raw: String?): String? {
    val s = raw?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    return if (s.startsWith("d:")) s.take(MAX_DRAWN_ICON) else s.take(32)
}

internal fun isJpegDataUrl(s: String, maxLen: Int): String? {
    val t = s.trim()
    if (t.length > maxLen) return null
    if (!t.startsWith("data:image/jpeg;base64,") && !t.startsWith("data:image/jpg;base64,")) return null
    return t
}

private val OFFLINE_AVATAR_COLOR = Regex("^#[0-9a-fA-F]{6}$")
private val OFFLINE_AVATAR_LETTERS = Regex("^[\\p{L}\\p{N}]{1,2}$")
private const val MAX_OFFLINE_AVATAR_JSON = 120_000

internal fun clampOfflineAvatar(raw: Any?): String? {
    val obj = when (raw) {
        is JSONObject -> raw
        is String -> {
            val t = raw.trim()
            if (t.isEmpty() || t.length > MAX_OFFLINE_AVATAR_JSON) return null
            try { JSONObject(t) } catch (_: Exception) { return null }
        }
        else -> return null
    }
    return when (obj.optString("mode").trim().lowercase()) {
        "letters" -> {
            val color = obj.optString("color").trim()
            if (!OFFLINE_AVATAR_COLOR.matches(color)) return null
            val text = obj.optString("text").trim()
                .ifEmpty { obj.optString("letters").trim() }
                .take(2)
                .uppercase(Locale.ROOT)
            if (!OFFLINE_AVATAR_LETTERS.matches(text)) return null
            JSONObject().put("mode", "letters").put("text", text).put("color", color).toString()
        }
        // Legacy clients — keep accepting until everyone is on letters.
        "icon" -> {
            val color = obj.optString("color").trim()
            if (!OFFLINE_AVATAR_COLOR.matches(color)) return null
            JSONObject().put("mode", "icon").put("color", color).toString()
        }
        "draw" -> {
            val draw = clampIcon(obj.optString("draw")) ?: return null
            if (!draw.startsWith("d:")) return null
            val out = JSONObject().put("mode", "draw").put("draw", draw)
            val color = obj.optString("color").trim()
            if (OFFLINE_AVATAR_COLOR.matches(color)) out.put("color", color)
            out.toString()
        }
        else -> null
    }
}
