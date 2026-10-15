package com.phlip

import java.net.URLDecoder
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

/** Builds one atomic WebView prefill from Android's separately captured URL and slug. */
internal object JoinIntentPrefill {
    fun combine(text: String?, slug: String?): String? {
        val personalSlug = slug?.trim()?.takeIf { it.isNotEmpty() }
        val raw = text?.trim()?.takeIf { it.isNotEmpty() }
        if (personalSlug == null) return raw
        if (raw == null) return "phlip://join?slug=${encode(personalSlug)}"
        if (carriesSlug(raw, personalSlug)) return raw
        return "phlip://join?url=${encode(raw)}&slug=${encode(personalSlug)}"
    }

    private fun carriesSlug(raw: String, slug: String): Boolean {
        if (Regex("""/j/${Regex.escape(slug)}(?:[/?#\s]|$)""", RegexOption.IGNORE_CASE).containsMatchIn(raw)) {
            return true
        }
        val encoded = Regex("""(?:[?&])slug=([^&#\s]+)""", RegexOption.IGNORE_CASE)
            .find(raw)
            ?.groupValues
            ?.getOrNull(1)
            ?: return false
        val decoded = runCatching {
            URLDecoder.decode(encoded, StandardCharsets.UTF_8.name())
        }.getOrDefault(encoded)
        return decoded.equals(slug, ignoreCase = true)
    }

    private fun encode(value: String): String =
        URLEncoder.encode(value, StandardCharsets.UTF_8.name()).replace("+", "%20")
}
