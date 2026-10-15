package app.phlip.server

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Host-visible ring buffer of rejected / anomalous HTTP requests.
 * Off by default — enable in Host settings. Never stores bodies, tokens, or passwords.
 */
object SecurityRejectLog {
    private const val PREFS = "dp_host_prefs"
    private const val KEY_ENABLED = "security_reject_log"
    private const val MAX = 80

    data class Entry(
        val ts: Long,
        val serverHint: String,
        val path: String,
        val reason: String,
        val detail: String,
    )

    private val entries = CopyOnWriteArrayList<Entry>()
    @Volatile private var enabledCached: Boolean? = null

    fun isEnabled(ctx: Context): Boolean {
        enabledCached?.let { return it }
        val v = ctx.applicationContext
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY_ENABLED, false)
        enabledCached = v
        return v
    }

    fun setEnabled(ctx: Context, on: Boolean) {
        ctx.applicationContext
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_ENABLED, on)
            .apply()
        enabledCached = on
        if (!on) entries.clear()
    }

    fun record(serverHint: String, path: String, reason: String, detail: String = "") {
        if (enabledCached != true) return
        val e = Entry(
            ts = System.currentTimeMillis(),
            serverHint = serverHint.take(40),
            path = path.take(80),
            reason = reason.take(48),
            detail = detail.take(120),
        )
        entries.add(0, e)
        while (entries.size > MAX) entries.removeAt(entries.lastIndex)
    }

    /** Call once hosting starts so [record] can skip prefs I/O when off. */
    fun refreshEnabled(ctx: Context) {
        enabledCached = null
        isEnabled(ctx)
    }

    fun snapshot(): List<Entry> = entries.toList()

    fun clear() { entries.clear() }

    fun toJsonArray(limit: Int = 40): JSONArray {
        val arr = JSONArray()
        for (e in entries.take(limit)) {
            arr.put(
                JSONObject()
                    .put("ts", e.ts)
                    .put("server", e.serverHint)
                    .put("path", e.path)
                    .put("reason", e.reason)
                    .put("detail", e.detail),
            )
        }
        return arr
    }
}
