package app.phlip.server.hotspot

import android.content.Context
import android.os.Handler
import app.phlip.server.ServerRegistry
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/**
 * Host-side direct hotspot session — one active reservation per device.
 * Composes [HotspotReservationController]; does not own [DrServer] instances.
 *
 * [startSession] / [endSession] must be called off the main thread (bridge IO thread).
 *
 * Soft-AP may die when the host joins STA Wi‑Fi (OEM limit). While Direct is still
 * desired we keep session metadata and attempt Soft-AP restart.
 */
class HotspotSessionCoordinator(
    context: Context,
    private val registry: ServerRegistry,
    private val mainHandler: Handler,
    private val onStateChanged: () -> Unit,
    private val inviteCodeProvider: (serverId: String) -> String = { "" },
) {
    private val reservation = HotspotReservationController(context, mainHandler)
    private val active = AtomicReference<HotspotSessionInfo?>(null)
    private val desired = AtomicBoolean(false)
    private val restartAttempts = AtomicInteger(0)
    private val restartInFlight = AtomicBoolean(false)

    init {
        reservation.onUnexpectedStop = {
            handleUnexpectedSoftApStop()
        }
    }

    fun isActive(): Boolean = active.get() != null

    fun isDesired(): Boolean = desired.get()

    fun isRadioLive(): Boolean = reservation.isActive()

    fun sessionInfo(): HotspotSessionInfo? = active.get()

    fun sessionForServer(serverId: String): HotspotSessionInfo? =
        active.get()?.takeIf { it.serverId == serverId }

    fun startSession(serverId: String, port: Int, rotateNetwork: Boolean = false): HotspotStartResult {
        if (active.get() != null && desired.get() && reservation.isActive()) {
            return HotspotStartResult.Failed("End the current direct session first")
        }
        // Stale session after Soft-AP death — clear before starting again.
        if (active.get() != null) {
            active.set(null)
        }
        val hs = registry.get(serverId)
            ?: return HotspotStartResult.Failed("Server not found")
        desired.set(true)
        restartAttempts.set(0)
        val creds = reservation.startBlocking(20_000L, rotateNetwork = rotateNetwork)
            ?: run {
                desired.set(false)
                return HotspotStartResult.Failed(
                    reservation.lastError ?: "Timed out starting hotspot",
                )
            }
        val (ssid, password, gatewayIp) = creds
        val joinCode = inviteCodeProvider(serverId)
        val info = HotspotSessionInfo(
            serverId = serverId,
            serverName = hs.name,
            ssid = ssid,
            password = password,
            qrUri = HotspotQrPayload.wifiUri(ssid, password),
            gatewayIp = gatewayIp,
            lanUrl = "http://$gatewayIp:$port",
            joinCode = joinCode,
            startedAt = System.currentTimeMillis(),
            radioLive = true,
            radioNote = "",
        )
        active.set(info)
        refreshGatewayLater(port)
        onStateChanged()
        return HotspotStartResult.Started(info)
    }

    /** Prepare a new Soft-AP name for the next Direct start (does not start a session). */
    fun rotateNetworkCredentials(): Pair<String, String> {
        val c = reservation.rotatePreferredCredentials()
        return c.ssid to c.password
    }

    fun preferredNetworkCredentials(): Pair<String, String>? =
        reservation.preferredCredentials()?.let { it.ssid to it.password }

    /** AP addressing often lands after onStarted — republish the real join URL. */
    private fun refreshGatewayLater(port: Int) {
        fun bump() {
            val cur = active.get() ?: return
            if (!desired.get()) return
            val ip = reservation.currentGatewayIp()
            if (ip.isBlank() || ip == cur.gatewayIp) return
            active.set(
                cur.copy(
                    gatewayIp = ip,
                    lanUrl = "http://$ip:$port",
                    radioLive = true,
                    radioNote = "",
                ),
            )
            onStateChanged()
        }
        Thread({
            try {
                Thread.sleep(400)
                bump()
                Thread.sleep(1200)
                bump()
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            }
        }, "ash-hotspot-ip").apply { isDaemon = true }.start()
    }

    private fun handleUnexpectedSoftApStop() {
        if (!desired.get()) return
        val cur = active.get() ?: return
        active.set(
            cur.copy(
                radioLive = false,
                radioNote = "Direct Wi‑Fi stopped — often happens if this phone joined another network. Retrying…",
            ),
        )
        onStateChanged()
        attemptSoftApRestart()
    }

    private fun attemptSoftApRestart() {
        if (!desired.get()) return
        if (!restartInFlight.compareAndSet(false, true)) return
        Thread({
            try {
                var attempt = 0
                while (desired.get() && attempt < MAX_RESTART_ATTEMPTS) {
                    attempt = restartAttempts.incrementAndGet()
                    android.util.Log.i("AshHotspot", "Soft-AP restart attempt $attempt")
                    try {
                        Thread.sleep(1_200L * attempt)
                    } catch (_: InterruptedException) {
                        Thread.currentThread().interrupt()
                        return@Thread
                    }
                    if (!desired.get()) return@Thread
                    val cur = active.get() ?: return@Thread
                    val port = registry.get(cur.serverId)?.port ?: return@Thread
                    val creds = reservation.startBlocking(20_000L, rotateNetwork = false)
                    if (creds != null) {
                        val (ssid, password, gatewayIp) = creds
                        active.set(
                            cur.copy(
                                ssid = ssid,
                                password = password,
                                qrUri = HotspotQrPayload.wifiUri(ssid, password),
                                gatewayIp = gatewayIp,
                                lanUrl = "http://$gatewayIp:$port",
                                radioLive = true,
                                radioNote = "",
                            ),
                        )
                        restartAttempts.set(0)
                        refreshGatewayLater(port)
                        onStateChanged()
                        android.util.Log.i("AshHotspot", "Soft-AP restarted ssid=$ssid")
                        return@Thread
                    }
                }
                if (desired.get()) {
                    val cur = active.get()
                    if (cur != null) {
                        active.set(
                            cur.copy(
                                radioLive = false,
                                radioNote = "Direct Wi‑Fi stopped (phone may be on another network). Leave that Wi‑Fi or tap Start again.",
                            ),
                        )
                        onStateChanged()
                    }
                }
            } finally {
                restartInFlight.set(false)
            }
        }, "ash-hotspot-restart").apply { isDaemon = true }.start()
    }

    fun endSession(): Boolean {
        desired.set(false)
        restartAttempts.set(0)
        if (active.get() == null && !reservation.isActive()) return false
        reservation.stopBlocking(5_000L)
        active.set(null)
        onStateChanged()
        return true
    }

    fun stop() {
        endSession()
    }

    companion object {
        private const val MAX_RESTART_ATTEMPTS = 2
    }
}
