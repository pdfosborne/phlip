package app.phlip.server

import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * Owns periodic server scheduling: presence maintenance and invite rotation.
 *
 * [DrServer] remains the lifecycle owner and provides callbacks for the actual
 * mutation and transport work.
 */
internal class ServerScheduler(
    port: Int,
    private val onPresenceTick: () -> Unit,
    private val shouldUseIdlePresenceTick: () -> Boolean,
    private val onInviteRotationTick: () -> Unit,
    private val currentInviteExpiry: () -> Long,
) {
    private val scheduler = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "ash-presence-$port").apply { isDaemon = true }
    }
    @Volatile private var presenceTick: ScheduledFuture<*>? = null
    @Volatile private var presenceTickMs: Long = PRESENCE_TICK_IDLE_MS
    @Volatile private var inviteRotateFuture: ScheduledFuture<*>? = null

    fun startPresenceTicker() {
        if (presenceTick != null) return
        schedulePresenceTick(PRESENCE_TICK_IDLE_MS)
    }

    fun adjustPresenceTicker() {
        val want = if (shouldUseIdlePresenceTick()) PRESENCE_TICK_IDLE_MS else PRESENCE_TICK_MS
        if (want == presenceTickMs && presenceTick != null) return
        schedulePresenceTick(want)
    }

    fun scheduleInviteRotation(expiry: Long = currentInviteExpiry()) {
        try { inviteRotateFuture?.cancel(false) } catch (_: Exception) {}
        inviteRotateFuture = null
        if (scheduler.isShutdown) return
        val delayMs = (expiry - System.currentTimeMillis() + 250L).coerceAtLeast(250L)
        inviteRotateFuture = scheduler.schedule({
            try {
                if (System.currentTimeMillis() >= currentInviteExpiry()) {
                    onInviteRotationTick()
                } else {
                    scheduleInviteRotation(currentInviteExpiry())
                }
            } catch (t: Throwable) {
                android.util.Log.w("AshInvite", "invite rotate failed", t)
            }
        }, delayMs, TimeUnit.MILLISECONDS)
    }

    fun stop() {
        try { inviteRotateFuture?.cancel(false) } catch (_: Exception) {}
        inviteRotateFuture = null
        try { presenceTick?.cancel(false) } catch (_: Exception) {}
        presenceTick = null
        try { scheduler.shutdownNow() } catch (_: Exception) {}
    }

    fun schedule(delayMs: Long, action: () -> Unit) {
        if (scheduler.isShutdown) return
        scheduler.schedule({
            try { action() } catch (_: Exception) {}
        }, delayMs.coerceAtLeast(0L), TimeUnit.MILLISECONDS)
    }

    private fun schedulePresenceTick(periodMs: Long) {
        if (scheduler.isShutdown) return
        presenceTick?.cancel(false)
        presenceTick = null
        presenceTickMs = periodMs
        presenceTick = scheduler.scheduleAtFixedRate({
            try {
                onPresenceTick()
                adjustPresenceTicker()
            } catch (t: Throwable) {
                android.util.Log.w("AshPresence", "tick failed", t)
            }
        }, periodMs, periodMs, TimeUnit.MILLISECONDS)
    }
}