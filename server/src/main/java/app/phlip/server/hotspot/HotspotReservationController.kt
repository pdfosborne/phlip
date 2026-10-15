package app.phlip.server.hotspot

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import java.net.NetworkInterface
import java.security.SecureRandom
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Wraps [WifiManager.startLocalOnlyHotspot] — session-bound, foreground reservation.
 * Not restored across process death (by design).
 *
 * On Android 13+ ([PhlipSoftApStarter]) requests a stable `phlip-……` Soft-AP name.
 * Falls back to the system-chosen `AndroidShare_…` name when that fails.
 *
 * Start/stop must never block the main looper while waiting for framework callbacks —
 * otherwise the callback (posted to [mainHandler]) cannot run and the caller times out.
 */
internal class HotspotReservationController(
    private val context: Context,
    private val mainHandler: Handler,
) {
    @Volatile private var reservation: WifiManager.LocalOnlyHotspotReservation? = null
    private val lock = Any()
    private val credentialStore = HotspotCredentialStore(context)
    @Volatile private var stoppingIntentionally = false
    @Volatile var onUnexpectedStop: (() -> Unit)? = null

    fun isActive(): Boolean = reservation != null

    /** Soft-AP pair reused across Direct session restarts (null if never minted). */
    fun preferredCredentials(): HotspotCredentialStore.Creds? = credentialStore.loadPreferred()

    /** Mint a new Soft-AP SSID/password for the *next* Direct start. */
    fun rotatePreferredCredentials(): HotspotCredentialStore.Creds =
        credentialStore.rotatePreferred()

    /**
     * Blocking start for bridge callers. Must be called off the main thread.
     * Returns credentials, or null on failure/timeout (see [lastError]).
     *
     * @param rotateNetwork when true, mint a new Soft-AP name before starting.
     */
    @Volatile var lastError: String? = null
        private set

    fun startBlocking(timeoutMs: Long, rotateNetwork: Boolean = false): Triple<String, String, String>? {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            lastError = "Hotspot start must not run on the UI thread"
            return null
        }
        lastError = null
        val preferred = if (rotateNetwork) {
            credentialStore.rotatePreferred()
        } else {
            credentialStore.ensurePreferred()
        }
        // Ensure any prior reservation is fully released before requesting a new one.
        stopBlocking(timeoutMs.coerceAtMost(5_000L))
        // Brief settle — some OEMs reject an immediate re-start after close().
        try {
            Thread.sleep(400L)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        }

        val latch = CountDownLatch(1)
        val out = AtomicReference<Triple<String, String, String>?>(null)
        val err = AtomicReference<String?>(null)

        runOnMain {
            if (reservation != null) {
                err.set("Hotspot session already active")
                latch.countDown()
                return@runOnMain
            }
            val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            if (wm == null) {
                err.set("Wi-Fi unavailable")
                latch.countDown()
                return@runOnMain
            }
            try {
                val callback = object : WifiManager.LocalOnlyHotspotCallback() {
                    override fun onStarted(res: WifiManager.LocalOnlyHotspotReservation?) {
                        if (res == null) {
                            err.set("Hotspot reservation empty")
                            latch.countDown()
                            return
                        }
                        synchronized(lock) { reservation = res }
                        val creds = readCredentials(res)
                        if (creds == null) {
                            releaseQuietly()
                            err.set("Could not read hotspot credentials")
                            latch.countDown()
                            return
                        }
                        val gateway = detectGatewayIp()
                        out.set(Triple(creds.first, creds.second, gateway))
                        latch.countDown()
                    }

                    override fun onStopped() {
                        val intentional = stoppingIntentionally
                        synchronized(lock) { reservation = null }
                        if (!intentional) {
                            android.util.Log.w("AshHotspot", "Soft-AP stopped unexpectedly")
                            try {
                                onUnexpectedStop?.invoke()
                            } catch (t: Throwable) {
                                android.util.Log.w("AshHotspot", "onUnexpectedStop failed", t)
                            }
                        }
                    }

                    override fun onFailed(reason: Int) {
                        synchronized(lock) { reservation = null }
                        err.set(failureLabel(reason))
                        latch.countDown()
                    }
                }
                if (PhlipSoftApStarter.start(
                        wm,
                        mainHandler,
                        callback,
                        preferred.ssid,
                        preferred.password,
                    )
                ) {
                    // Custom SSID path started with stable Soft-AP credentials.
                } else {
                    // System-chosen SSID (AndroidShare_…) — cannot be reused next time.
                    android.util.Log.w(
                        "AshHotspot",
                        "falling back to system Soft-AP name (${PhlipSoftApStarter.lastError})",
                    )
                    wm.startLocalOnlyHotspot(callback, mainHandler)
                }
            } catch (t: Throwable) {
                val msg = t.message?.take(120) ?: "Could not start hotspot"
                err.set(
                    if (msg.contains("location", ignoreCase = true)) {
                        "Turn on Location in Settings, then try again"
                    } else msg
                )
                latch.countDown()
            }
        }

        val finished = latch.await(timeoutMs, TimeUnit.MILLISECONDS)
        if (!finished) {
            lastError = "Timed out starting hotspot"
            // Best-effort cleanup if the framework started late.
            stopBlocking(2_000L)
            return null
        }
        val fail = err.get()
        if (fail != null) {
            lastError = fail
            return null
        }
        val started = out.get() ?: return null
        // Keep Soft-AP prefs stable when the framework honoured our request.
        if (looksLikePhlipSsid(started.first)) {
            credentialStore.savePreferred(started.first, started.second)
        } else {
            android.util.Log.w(
                "AshHotspot",
                "system Soft-AP name=${started.first} (preferred=${preferred.ssid}) — reuse needs Soft-AP support",
            )
        }
        return started
    }

    fun stop() {
        mainHandler.post { releaseQuietly() }
    }

    /** Close the reservation and wait until the main-thread close has run. */
    fun stopBlocking(timeoutMs: Long = 3_000L) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            releaseQuietly()
            return
        }
        val latch = CountDownLatch(1)
        mainHandler.post {
            try {
                releaseQuietly()
            } finally {
                latch.countDown()
            }
        }
        try {
            latch.await(timeoutMs, TimeUnit.MILLISECONDS)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        }
    }

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == mainHandler.looper) {
            block()
        } else {
            mainHandler.post(block)
        }
    }

    private fun releaseQuietly() {
        stoppingIntentionally = true
        val res = synchronized(lock) {
            val cur = reservation
            reservation = null
            cur
        }
        try {
            res?.close()
        } catch (_: Throwable) {
        } finally {
            // Allow a brief window for onStopped, then clear the intentional flag.
            mainHandler.postDelayed({ stoppingIntentionally = false }, 1_500L)
        }
    }

    private fun readCredentials(res: WifiManager.LocalOnlyHotspotReservation): Pair<String, String>? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val cfg = res.softApConfiguration
            // Prefer WifiSsid when String ssid is empty (newer platforms).
            val ssid = cfg.ssid?.toString()?.trim()?.trim('"').orEmpty()
                .ifEmpty {
                    try {
                        val raw = cfg.wifiSsid?.bytes ?: return@ifEmpty ""
                        String(raw, Charsets.UTF_8).trim().trim('"')
                    } catch (_: Throwable) {
                        ""
                    }
                }
            val pass = cfg.passphrase?.toString().orEmpty()
            if (ssid.isEmpty() || pass.isEmpty()) null else ssid to pass
        } else {
            @Suppress("DEPRECATION")
            val wc = res.wifiConfiguration ?: return null
            @Suppress("DEPRECATION")
            val ssid = wc.SSID?.trim()?.trim('"').orEmpty()
            @Suppress("DEPRECATION")
            val pass = wc.preSharedKey.orEmpty()
            if (ssid.isEmpty() || pass.isEmpty()) null else ssid to pass
        }
    }

    private fun detectGatewayIp(): String {
        val candidates = collectIpv4()
        android.util.Log.i(
            "AshHotspot",
            "iface IPs: ${candidates.joinToString { "${it.first}=${it.second}" }}",
        )
        pickHotspotIp(candidates)?.let { return it }
        return DEFAULT_GATEWAY
    }

    /** Re-read after the AP iface finishes addressing (often 300–1500ms after onStarted). */
    fun currentGatewayIp(): String = pickHotspotIp(collectIpv4()) ?: detectGatewayIp()

    private fun collectIpv4(): List<Pair<String, String>> {
        return try {
            NetworkInterface.getNetworkInterfaces()?.toList()
                ?.flatMap { ni ->
                    if (!ni.isUp) return@flatMap emptyList()
                    ni.inetAddresses.toList().mapNotNull { addr ->
                        if (addr.isLoopbackAddress || addr !is java.net.Inet4Address) null
                        else {
                            val ip = addr.hostAddress?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
                            ni.name.lowercase() to ip
                        }
                    }
                }
                .orEmpty()
        } catch (_: Throwable) {
            emptyList()
        }
    }

    private fun pickHotspotIp(candidates: List<Pair<String, String>>): String? {
        fun isApName(name: String) =
            name.startsWith("ap") || name.startsWith("softap") ||
                name.startsWith("swlan") || name == "wlan1" || name.startsWith("wlan1")
        fun isHotspotRange(ip: String) =
            ip.startsWith("192.168.43.") ||
                ip.startsWith("192.168.49.") ||
                ip.startsWith("192.168.75.") ||
                ip.startsWith("192.168.137.")

        // Prefer a real address on a soft-AP iface — including .240, not only .1.
        candidates.firstOrNull { (name, ip) -> isApName(name) && isHotspotRange(ip) }?.second
            ?.let { return it }
        candidates.firstOrNull { (name, _) -> isApName(name) }?.second
            ?.let { return it }
        candidates.firstOrNull { (_, ip) -> ip == DEFAULT_GATEWAY || ip == "192.168.49.1" }?.second
            ?.let { return it }
        candidates.firstOrNull { (_, ip) -> isHotspotRange(ip) && ip.endsWith(".1") }?.second
            ?.let { return it }
        // Host STA leftover is often 192.168.43.240 while AP is .1 — only use .240
        // when no .1 exists on any iface.
        candidates.firstOrNull { (_, ip) -> isHotspotRange(ip) }?.second
            ?.let { return it }
        return null
    }

    private fun failureLabel(reason: Int): String = when (reason) {
        WifiManager.LocalOnlyHotspotCallback.ERROR_GENERIC -> "Hotspot failed (generic)"
        WifiManager.LocalOnlyHotspotCallback.ERROR_INCOMPATIBLE_MODE ->
            "Hotspot unavailable (incompatible Wi-Fi mode) — try again in a moment"
        WifiManager.LocalOnlyHotspotCallback.ERROR_TETHERING_DISALLOWED ->
            "Hotspot disallowed on this device"
        else -> "Hotspot failed ($reason)"
    }

    companion object {
        const val DEFAULT_GATEWAY = "192.168.43.1"
        /** Prefix joiners and Phlip use to recognise a Direct session Soft-AP. */
        const val SSID_PREFIX = "phlip-"

        private val rnd = SecureRandom()

        fun generatePhlipSsid(): String {
            // Soft-AP SSID max is typically 32; keep short and Wi‑Fi-list friendly.
            val alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
            val suffix = buildString(6) {
                repeat(6) { append(alphabet[rnd.nextInt(alphabet.length)]) }
            }
            return SSID_PREFIX + suffix
        }

        fun generatePhlipPassphrase(): String {
            val alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
            return buildString(10) {
                repeat(10) { append(alphabet[rnd.nextInt(alphabet.length)]) }
            }
        }

        fun looksLikePhlipSsid(ssid: String?): Boolean =
            !ssid.isNullOrBlank() && ssid.trim().startsWith(SSID_PREFIX, ignoreCase = true)
    }
}
