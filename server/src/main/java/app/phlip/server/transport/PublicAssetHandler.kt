package app.phlip.server

import app.phlip.core.assets.ClientAssetSource
import fi.iki.elonen.NanoHTTPD
import java.io.File

/**
 * Static public assets, HTML OG injection for share/event cards, and `/card/` PNGs.
 *
 * **Store:** APK/asset pack files under `public/…` via [ClientAssetSource];
 * cached event-card PNGs beside host data as `event-cards/<id>.png`.
 *
 * **User → host:** GET (or drained POST) for `/…` static paths; GET `/card/<id>`.
 *
 * **Host → users:** HTML/JS/CSS/media responses with browser security headers;
 * HTML may inject `og:image` when a card exists for `?event=`.
 */
internal class PublicAssetHandler(
    private val clientAssets: ClientAssetSource,
    private val dataFile: File,
    private val rejectIfBodyTooLarge: (NanoHTTPD.IHTTPSession) -> NanoHTTPD.Response?,
) {
    private val mime = mapOf(
        "html" to "text/html; charset=UTF-8",
        "css" to "text/css; charset=UTF-8",
        "js" to "text/javascript; charset=UTF-8",
        "svg" to "image/svg+xml",
        "png" to "image/png",
        "mp3" to "audio/mpeg",
        "ico" to "image/x-icon",
        "webmanifest" to "application/manifest+json",
    )

    fun servePublicAsset(session: NanoHTTPD.IHTTPSession, rawPath: String): NanoHTTPD.Response {
        var path = rawPath
        // Drain unexpected POST bodies so keep-alive can't poison later requests
        // (static asset GETs share the same public-tunnel→origin connections).
        if (session.method == NanoHTTPD.Method.POST || session.method == NanoHTTPD.Method.PUT) {
            rejectIfBodyTooLarge(session)?.let { return it }
            try { session.parseBody(HashMap()) } catch (_: Exception) {}
        }
        if (path == "/") path = "/index.html"
        val safePath = sanitizePublicAssetPath(path)
            ?: return notFoundAsset()
        val ext = safePath.substringAfterLast('.', "")
        val contentType = mime[ext] ?: return notFoundAsset()
        return try {
            if (ext == "html") {
                return serveHtmlWithOg(session, safePath, contentType)
            }
            val stream = clientAssets.open("public$safePath") ?: return notFoundAsset()
            val r = NanoHTTPD.newChunkedResponse(NanoHTTPD.Response.Status.OK, contentType, stream)
            r.addHeader("Connection", "close")
            r.addHeader("X-Content-Type-Options", "nosniff")
            r.addHeader("Referrer-Policy", "no-referrer")
            r.addHeader("X-Frame-Options", "DENY")
            // Public browsers (and Cloudflare) otherwise keep stale app.js while
            // index.html updates — e.g. empty theme button with no click handler.
            if (ext == "js" || ext == "css") {
                r.addHeader("Cache-Control", "no-cache, must-revalidate")
            }
            r.closeConnection(true)
            r
        } catch (_: Exception) {
            notFoundAsset()
        }
    }

    fun serveCachedEventCard(rawId: String): NanoHTTPD.Response {
        val file = eventCardFile(rawId) ?: return notFoundAsset()
        return try {
            val r = NanoHTTPD.newFixedLengthResponse(
                NanoHTTPD.Response.Status.OK,
                "image/png",
                file.inputStream(),
                file.length(),
            )
            r.addHeader("Connection", "close")
            r.addHeader("Cache-Control", "public, max-age=3600")
            r.addHeader("X-Content-Type-Options", "nosniff")
            r.closeConnection(true)
            r
        } catch (_: Exception) {
            notFoundAsset()
        }
    }

    /** Inject og:image when a cached card exists for ?event=. */
    private fun serveHtmlWithOg(
        session: NanoHTTPD.IHTTPSession,
        safePath: String,
        contentType: String,
    ): NanoHTTPD.Response {
        val stream = clientAssets.open("public$safePath") ?: return notFoundAsset()
        val html = stream.bufferedReader().use { it.readText() }
        val eventId = session.parms?.get("event")?.trim().orEmpty()
        val card = if (eventId.isNotEmpty()) eventCardFile(eventId) else null
        val body = if (card != null) {
            val host = session.headers["host"]?.trim().orEmpty()
            val proto = when {
                session.headers["x-forwarded-proto"]?.equals("https", true) == true -> "https"
                host.endsWith(".trycloudflare.com") || host.contains("phlip.") -> "https"
                else -> "http"
            }
            val abs = if (host.isNotEmpty()) "$proto://$host/card/$eventId.png" else "/card/$eventId.png"
            val meta = """
                <meta property="og:image" content="$abs">
                <meta property="og:image:width" content="1200">
                <meta property="og:image:height" content="630">
                <meta name="twitter:card" content="summary_large_image">
                <meta name="twitter:image" content="$abs">
            """.trimIndent()
            if (html.contains("</head>", ignoreCase = true)) {
                html.replaceFirst(Regex("</head>", RegexOption.IGNORE_CASE), "$meta\n</head>")
            } else html
        } else html
        val r = NanoHTTPD.newFixedLengthResponse(NanoHTTPD.Response.Status.OK, contentType, body)
        r.addHeader("Connection", "close")
        r.addHeader("X-Content-Type-Options", "nosniff")
        r.addHeader("Referrer-Policy", "no-referrer")
        r.addHeader("X-Frame-Options", "DENY")
        r.addHeader(
            "Content-Security-Policy",
            "default-src 'self'; " +
                "script-src 'self'; " +
                "style-src 'self' 'unsafe-inline'; " +
                "img-src 'self' data: blob:; " +
                "font-src 'self'; " +
                "connect-src 'self'; " +
                "worker-src 'self'; " +
                "manifest-src 'self'; " +
                "media-src 'self' blob:; " +
                "object-src 'none'; " +
                "base-uri 'self'; " +
                "form-action 'self'; " +
                "frame-ancestors 'none'",
        )
        r.addHeader("Cache-Control", "no-cache, must-revalidate")
        r.closeConnection(true)
        return r
    }

    private fun eventCardFile(eventId: String): File? {
        val id = eventId.filter { it.isLetterOrDigit() || it == '-' || it == '_' }
        if (id.isEmpty() || id != eventId) return null
        val dir = File(dataFile.parentFile ?: return null, "event-cards")
        val f = File(dir, "$id.png")
        return if (f.isFile) f else null
    }

    private fun notFoundAsset(): NanoHTTPD.Response {
        val r = NanoHTTPD.newFixedLengthResponse(
            NanoHTTPD.Response.Status.NOT_FOUND,
            "text/plain",
            "not found",
        )
        r.addHeader("Connection", "close")
        r.closeConnection(true)
        return r
    }

    /**
     * Resolve static files from APK assets by name only. Reject traversal,
     * absolute paths outside /public, and unknown extensions.
     */
    private fun sanitizePublicAssetPath(raw: String): String? {
        var p = raw.trim()
        if (p.isEmpty() || p.contains('\u0000') || p.contains('\\')) return null
        if (p.contains("..")) return null
        while (p.contains("//")) p = p.replace("//", "/")
        if (!p.startsWith("/")) p = "/$p"
        if (p != "/" && p.endsWith("/")) return null
        val ext = p.substringAfterLast('.', "")
        if (ext.isEmpty() || !mime.containsKey(ext)) return null
        // Only flat /file or /dir/file under public — no deep escapes.
        if (!p.matches(Regex("^/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$"))) return null
        return p
    }
}
