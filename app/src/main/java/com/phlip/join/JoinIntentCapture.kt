package com.phlip.join

import android.content.Intent
import com.phlip.JoinIntentPrefill

/** Captures join / pass text from VIEW, SEND, or PROCESS_TEXT intents. */
class JoinIntentCapture {
    var pendingJoinPrefill: String? = null
    var pendingInviteSlug: String? = null
    var pendingEventPass: String? = null

    /** Pull join URL / invite text / event pass from an intent. */
    fun capture(intent: Intent?) {
        // A new deep/share intent owns its complete invite context. Do not let
        // a slug from an earlier intent attach itself to a later bare origin.
        pendingInviteSlug = null
        val text = joinPrefillFromIntent(intent) ?: return
        when {
            looksLikeEventPass(text) -> pendingEventPass = text
            else -> pendingJoinPrefill = text
        }
    }

    fun looksLikeEventPass(text: String): Boolean {
        val t = text.trim()
        if (t.contains("phlip://p/", ignoreCase = true)) return true
        // Selected bare token (PROCESS_TEXT) — not a URL / invite paragraph
        if (t.contains("://") || t.contains('\n') || t.contains(' ')) return false
        val compact = t.replace("\\s+".toRegex(), "")
        return compact.matches(Regex("^[A-Za-z0-9_-]{48,}$"))
    }

    private fun joinPrefillFromIntent(intent: Intent?): String? {
        if (intent == null) return null
        when (intent.action) {
            Intent.ACTION_VIEW -> {
                val data = intent.data ?: return null
                when (data.scheme?.lowercase()) {
                    "phlip" -> {
                        val host = data.host?.lowercase()
                        if (host == "p") {
                            return data.toString()
                        }
                        if (host == "join") {
                            val slug = data.getQueryParameter("slug")?.trim()?.takeIf { it.isNotEmpty() }
                            if (slug != null) pendingInviteSlug = slug
                            // Keep url + personal slug in one value. Returning only the
                            // url dropped the invite tier before the WebView could join.
                            return data.toString()
                        }
                        val q = data.getQueryParameter("url")
                            ?: data.getQueryParameter("host")
                        return q?.trim()?.takeIf { it.isNotEmpty() } ?: data.toString()
                    }
                    "https", "http" -> {
                        val path = data.path.orEmpty()
                        if (path.startsWith("/j/")) {
                            val slug = path.removePrefix("/j/").substringBefore('/').trim()
                            if (slug.isNotEmpty()) {
                                pendingInviteSlug = slug
                            }
                        }
                        return data.toString()
                    }
                }
            }
            Intent.ACTION_SEND -> {
                if (intent.type?.startsWith("text/") == true) {
                    val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim()?.takeIf { it.isNotEmpty() }
                    text?.let { stashInviteSlugFromText(it) }
                    return text
                }
            }
            Intent.ACTION_PROCESS_TEXT -> {
                val text = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)
                    ?.toString()?.trim()?.takeIf { it.isNotEmpty() }
                text?.let { stashInviteSlugFromText(it) }
                return text
            }
        }
        return null
    }

    /** Pull `/j/<slug>` (any host) or `phlip://join?slug=` out of shared text. */
    private fun stashInviteSlugFromText(text: String) {
        val personal = Regex("""https?://[^/\s]+/j/([A-Za-z0-9]+)""", RegexOption.IGNORE_CASE)
            .find(text)
        if (personal != null) {
            pendingInviteSlug = personal.groupValues[1]
            return
        }
        val deep = Regex("""phlip://join\?[^\s]*slug=([A-Za-z0-9]+)""", RegexOption.IGNORE_CASE)
            .find(text)
        if (deep != null) {
            pendingInviteSlug = deep.groupValues[1]
        }
    }

    fun combinePrefill(): String? =
        JoinIntentPrefill.combine(pendingJoinPrefill, pendingInviteSlug)
}
