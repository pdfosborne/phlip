package app.phlip.server

import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * Failed-attempt lockouts (LAN vs WAN) and shared long-poll concurrency accounting.
 */
internal class RateLimitPolicy(
    private val rateMap: ConcurrentHashMap<String, Pair<Int, Long>>,
    private val activePolls: AtomicInteger,
    private val now: () -> Long = System::currentTimeMillis,
) {
    fun bump(ip: String, lan: Boolean = false) {
        val maxFails = if (lan) RATE_MAX_FAILS_LAN else RATE_MAX_FAILS
        val lockMs = if (lan) RATE_LOCK_MS_LAN else RATE_LOCK_MS
        val (fails, until) = rateMap[ip] ?: Pair(0, 0L)
        val newFails = fails + 1
        rateMap[ip] = if (newFails >= maxFails) Pair(0, now() + lockMs)
        else Pair(newFails, until)
    }

    fun clear(ip: String) {
        rateMap.remove(ip)
    }

    /** Non-null error JSON when [ip] is currently locked out. */
    fun limitedError(ip: String, lan: Boolean): JSONObject? {
        val rl = rateMap[ip] ?: return null
        if (rl.second <= now()) return null
        return JSONObject().put("type", "error").put(
            "error",
            if (lan) "Too many attempts. Wait a few seconds and try again."
            else "Too many attempts. Wait a minute and try again.",
        )
    }

    /** Shared cap for member and Broadcast long-polls. */
    fun tryBeginPoll(): Boolean {
        while (true) {
            val count = activePolls.get()
            if (count >= MAX_CONCURRENT_POLLS) return false
            if (activePolls.compareAndSet(count, count + 1)) return true
        }
    }

    fun endPoll() {
        activePolls.updateAndGet { (it - 1).coerceAtLeast(0) }
    }
}
