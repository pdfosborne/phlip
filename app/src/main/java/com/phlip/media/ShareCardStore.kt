package com.phlip.media

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Base64
import androidx.core.content.FileProvider
import com.phlip.MainActivity
import java.io.File
import java.util.concurrent.ExecutorService

/**
 * Share-card image/text plumbing behind the AshNative share calls. Decode + disk
 * work runs on [io] so the JS thread is never blocked; the chooser Intents are
 * posted back to the UI thread.
 */
class ShareCardStore(
    private val activity: Activity,
    private val io: ExecutorService,
) {
    companion object {
        private const val ICS_MIME = "text/calendar"
        private const val MAX_ICS_CHARS = 1_000_000

        internal fun icsFilename(name: String): String {
            val raw = name.substringBeforeLast('.', name)
            val stem = raw.filter { it.isLetterOrDigit() || it == '-' || it == '_' }.take(80)
            return "${stem.ifBlank { "event" }}.ics"
        }
    }

    fun shareImage(base64Png: String, caption: String) {
        if (base64Png.length > MainActivity.MAX_SHARE_BASE64_LEN) return
        io.execute {
            val bytes = try { Base64.decode(base64Png, Base64.DEFAULT) } catch (_: IllegalArgumentException) { return@execute }
            val file = File(activity.cacheDir, "shared/event-card.png")
            try {
                file.parentFile?.mkdirs()
                file.writeBytes(bytes)
                val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
                val intent = Intent(Intent.ACTION_SEND).apply {
                    type = "image/png"
                    putExtra(Intent.EXTRA_STREAM, uri)
                    putExtra(Intent.EXTRA_TEXT, caption)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                activity.runOnUiThread {
                    try { activity.startActivity(Intent.createChooser(intent, "Send card")) } catch (_: ActivityNotFoundException) {}
                }
            } catch (_: Exception) {
                // The JS API is fire-and-forget; leave the client usable if sharing fails.
            }
        }
    }

    /** Save a share-card PNG into Pictures/Phlip via MediaStore. */
    fun saveImage(base64Png: String) {
        if (base64Png.length > MainActivity.MAX_SHARE_BASE64_LEN) return
        io.execute {
            val bytes = try { Base64.decode(base64Png, Base64.DEFAULT) } catch (_: IllegalArgumentException) { return@execute }
            try {
                val values = android.content.ContentValues().apply {
                    put(android.provider.MediaStore.Images.Media.DISPLAY_NAME, "phlip-event-card-${System.currentTimeMillis()}.png")
                    put(android.provider.MediaStore.Images.Media.MIME_TYPE, "image/png")
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        put(android.provider.MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Phlip")
                        put(android.provider.MediaStore.Images.Media.IS_PENDING, 1)
                    }
                }
                val resolver = activity.contentResolver
                val uri = resolver.insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                    ?: return@execute
                resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: return@execute
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    values.clear()
                    values.put(android.provider.MediaStore.Images.Media.IS_PENDING, 0)
                    resolver.update(uri, values, null, null)
                }
            } catch (_: Exception) {}
        }
    }

    /** Persist a rendered event card for og:image / DrServer `/card/<id>.png`. */
    fun cacheEventCard(eventId: String, base64Png: String) {
        val id = eventId.filter { it.isLetterOrDigit() || it == '-' || it == '_' }
        if (id.isEmpty() || id != eventId || base64Png.length > MainActivity.MAX_SHARE_BASE64_LEN) return
        io.execute {
            val bytes = try { Base64.decode(base64Png, Base64.DEFAULT) } catch (_: IllegalArgumentException) { return@execute }
            try {
                val dir = File(activity.filesDir, "event-cards").apply { mkdirs() }
                File(dir, "$id.png").writeBytes(bytes)
                // Cap at 50 files, evict oldest by lastModified.
                val files = dir.listFiles()?.filter { it.isFile && it.name.endsWith(".png") } ?: return@execute
                if (files.size > 50) {
                    files.sortedBy { it.lastModified() }
                        .take(files.size - 50)
                        .forEach { it.delete() }
                }
            } catch (_: Exception) {}
        }
    }

    /** Plain-text share sheet (server invites, etc.). */
    fun shareText(text: String) {
        val body = text.trim()
        if (body.isEmpty() || body.length > 8_000) return
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, body)
        }
        activity.runOnUiThread {
            try {
                activity.startActivity(Intent.createChooser(intent, "Share invite"))
            } catch (_: ActivityNotFoundException) {}
        }
    }

    /**
     * Hand an .ics snapshot to the system calendar (ACTION_VIEW), falling back
     * to ACTION_SEND. No WRITE_CALENDAR — the user confirms in their calendar app.
     */
    fun openCalendarIcs(ics: String, filename: String) {
        val body = ics
        if (body.isEmpty() || body.length > MAX_ICS_CHARS) return
        val safeName = icsFilename(filename)
        io.execute {
            try {
                val file = File(activity.cacheDir, "shared/$safeName")
                file.parentFile?.mkdirs()
                file.writeText(body, Charsets.UTF_8)
                val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
                activity.runOnUiThread {
                    if (!startIcsIntent(uri, Intent.ACTION_VIEW, "Add to calendar")) {
                        startIcsIntent(uri, Intent.ACTION_SEND, "Add to calendar")
                    }
                }
            } catch (_: Exception) {
                // Fire-and-forget from JS; leave the client usable if sharing fails.
            }
        }
    }

    private fun startIcsIntent(uri: Uri, action: String, title: String): Boolean {
        val intent = Intent(action).apply {
            if (action == Intent.ACTION_SEND) {
                type = ICS_MIME
                putExtra(Intent.EXTRA_STREAM, uri)
            } else {
                setDataAndType(uri, ICS_MIME)
            }
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            clipData = ClipData.newRawUri("event", uri)
        }
        return try {
            val chooser = Intent.createChooser(intent, title)
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            activity.startActivity(chooser)
            true
        } catch (_: ActivityNotFoundException) {
            false
        } catch (_: Exception) {
            false
        }
    }

    /** Read clipboard for event-pass paste (user-gesture only; may toast on Android 12+). */
    fun readClipboardText(): String {
        return try {
            val cm = activity.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return ""
            val clip: ClipData = cm.primaryClip ?: return ""
            if (clip.itemCount < 1) return ""
            clip.getItemAt(0)?.coerceToText(activity)?.toString()?.trim().orEmpty()
        } catch (_: Exception) {
            ""
        }
    }
}
