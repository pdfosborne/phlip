package com.phlip

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

/**
 * Remote version policy from phlipapp.com + local [BuildConfig.VERSION_NAME].
 * Used to nudge updates and (when [minSafe] is set) refuse new Public toggles
 * until the host updates. Fail-open if the endpoint is unreachable.
 *
 * Expected JSON: `{ "latest": "1.0.1", "minSafe": "1.0.0", "securityRelease": true }`
 */
object VersionPolicy {

    private const val TAG = "AshVersion"
    const val VERSION_URL = "https://phlipapp.com/app-version.json"

    data class Snapshot(
        val latest: String?,
        val minSafe: String?,
        val securityRelease: Boolean,
        val fetchedAtMs: Long,
    )

    private val snapshot = AtomicReference<Snapshot?>(null)
    private val io = Executors.newSingleThreadExecutor { r ->
        Thread(r, "ash-version-check").apply { isDaemon = true }
    }

    fun currentName(): String = BuildConfig.VERSION_NAME

    fun current(): Snapshot? = snapshot.get()

    /** True when remote [minSafe] is strictly newer than this install. */
    fun isBelowMinSafe(): Boolean {
        val min = snapshot.get()?.minSafe?.trim().orEmpty()
        if (min.isEmpty()) return false
        return compareVersions(currentName(), min) < 0
    }

    /** True when remote [latest] is newer than this install. */
    fun isUpdateAvailable(): Boolean {
        val latest = snapshot.get()?.latest?.trim().orEmpty()
        if (latest.isEmpty()) return false
        return compareVersions(currentName(), latest) < 0
    }

    fun refreshAsync(ctx: Context, onDone: (() -> Unit)? = null) {
        val app = ctx.applicationContext
        io.execute {
            try {
                fetchAndStore()
            } catch (t: Throwable) {
                Log.w(TAG, "version fetch failed", t)
            }
            onDone?.let { cb ->
                android.os.Handler(app.mainLooper).post { cb() }
            }
        }
    }

    private fun fetchAndStore() {
        val conn = (URL(VERSION_URL).openConnection() as HttpURLConnection).apply {
            connectTimeout = 8_000
            readTimeout = 8_000
            requestMethod = "GET"
            instanceFollowRedirects = true
            setRequestProperty("Accept", "application/json")
            setRequestProperty("User-Agent", "Phlip/${BuildConfig.VERSION_NAME}")
        }
        try {
            val code = conn.responseCode
            if (code !in 200..299) {
                Log.w(TAG, "version HTTP $code")
                return
            }
            val text = conn.inputStream.bufferedReader().use { it.readText() }
            val o = JSONObject(text)
            snapshot.set(
                Snapshot(
                    latest = o.optString("latest").trim().takeIf { it.isNotEmpty() },
                    minSafe = o.optString("minSafe").trim().takeIf { it.isNotEmpty() },
                    securityRelease = o.optBoolean("securityRelease", false),
                    fetchedAtMs = System.currentTimeMillis(),
                ),
            )
            Log.i(TAG, "version ok latest=${snapshot.get()?.latest} minSafe=${snapshot.get()?.minSafe}")
        } finally {
            conn.disconnect()
        }
    }

    /**
     * Semver-ish compare: `"1.2.3"` vs `"1.10.0"`. Non-numeric segments compare as strings.
     * @return negative if [a] < [b], 0 if equal, positive if [a] > [b]
     */
    fun compareVersions(a: String, b: String): Int {
        val pa = a.trim().removePrefix("v").split('.', '-', '+')
        val pb = b.trim().removePrefix("v").split('.', '-', '+')
        val n = maxOf(pa.size, pb.size)
        for (i in 0 until n) {
            val sa = pa.getOrNull(i).orEmpty()
            val sb = pb.getOrNull(i).orEmpty()
            // Missing trailing segments count as 0 ("1.0" == "1.0.0").
            val na = sa.toIntOrNull() ?: if (sa.isEmpty()) 0 else null
            val nb = sb.toIntOrNull() ?: if (sb.isEmpty()) 0 else null
            val c = when {
                na != null && nb != null -> na.compareTo(nb)
                na != null -> 1
                nb != null -> -1
                else -> sa.compareTo(sb)
            }
            if (c != 0) return c
        }
        return 0
    }

    fun installerPackage(ctx: Context): String? {
        return try {
            val pm = ctx.packageManager
            if (Build.VERSION.SDK_INT >= 30) {
                pm.getInstallSourceInfo(ctx.packageName).installingPackageName
            } else {
                @Suppress("DEPRECATION")
                pm.getInstallerPackageName(ctx.packageName)
            }
        } catch (_: Exception) {
            null
        }
    }

    fun isPlayInstall(ctx: Context): Boolean =
        installerPackage(ctx) == "com.android.vending"
}
