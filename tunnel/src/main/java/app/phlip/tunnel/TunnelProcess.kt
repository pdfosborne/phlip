package app.phlip.tunnel

import android.content.Context
import android.util.Log
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * Spawns the bundled `libcloudflared.so` binary (cloudflared renamed for Android
 * packaging). Captures stdout/stderr line-by-line for URL parsing and diagnostics.
 */
class TunnelProcess(
    private val context: Context,
    private val onLine: (String) -> Unit,
    private val onExit: (Int) -> Unit,
) {
    private val running = AtomicBoolean(false)
    private val processRef = AtomicReference<Process?>(null)

    fun binaryPath(): String {
        val dir = context.applicationInfo.nativeLibraryDir
        val so = File(dir, "libcloudflared.so")
        if (so.isFile) return so.absolutePath
        throw IllegalStateException(
            "cloudflared binary missing at ${so.absolutePath}. Rebuild the app with jniLibs/arm64-v8a/libcloudflared.so."
        )
    }

    fun start(args: List<String>) {
        stop()
        val cmd = ArrayList<String>(args.size + 1)
        cmd.add(binaryPath())
        cmd.addAll(args)
        Log.i(TAG, "starting cloudflared from ${cmd.first()} (${args.size} args)")
        val pb = ProcessBuilder(cmd)
            .redirectErrorStream(true)
            .directory(context.cacheDir)
        val env = pb.environment()
        // Writable dirs for cloudflared; avoid inheriting odd OEM TMPDIR issues.
        env["HOME"] = context.filesDir.absolutePath
        env["TMPDIR"] = context.cacheDir.absolutePath
        val proc = try {
            pb.start()
        } catch (t: Throwable) {
            Log.e(TAG, "failed to spawn cloudflared", t)
            onExit(-1)
            return
        }
        processRef.set(proc)
        running.set(true)
        Thread({
            try {
                BufferedReader(InputStreamReader(proc.inputStream)).use { reader ->
                    var line: String?
                    while (reader.readLine().also { line = it } != null) {
                        val l = line ?: continue
                        onLine(l)
                    }
                }
            } catch (t: Throwable) {
                Log.w(TAG, "cloudflared reader ended", t)
            } finally {
                val code = try { proc.waitFor() } catch (_: Exception) { -1 }
                running.set(false)
                processRef.compareAndSet(proc, null)
                onExit(code)
            }
        }, "cloudflared-io").apply { isDaemon = true }.start()
    }

    fun stop() {
        val p = processRef.getAndSet(null) ?: return
        running.set(false)
        try { p.destroy() } catch (_: Exception) {}
        try {
            if (!p.waitFor(2, java.util.concurrent.TimeUnit.SECONDS)) {
                p.destroyForcibly()
            }
        } catch (_: Exception) {
            try { p.destroyForcibly() } catch (_: Exception) {}
        }
    }

    fun isRunning(): Boolean = running.get()

    companion object {
        private const val TAG = "AshTunnel"
    }
}
