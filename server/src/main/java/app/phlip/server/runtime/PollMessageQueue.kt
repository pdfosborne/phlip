package app.phlip.server

import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ArrayBlockingQueue

/** Bounded, wakeable queue shared by member and guest HTTP long-poll sessions. */
internal class PollMessageQueue(capacity: Int = 256) {
    private val queue = ArrayBlockingQueue<String>(capacity)
    private val monitor = Object()

    fun enqueue(raw: String) {
        if (!queue.offer(raw)) {
            queue.poll()
            queue.offer(raw)
        }
        synchronized(monitor) { monitor.notifyAll() }
    }

    fun drain(max: Int = 50): JSONArray {
        val out = JSONArray()
        while (out.length() < max) {
            val raw = queue.poll() ?: break
            try { out.put(JSONObject(raw)) } catch (_: Exception) {}
        }
        return out
    }

    fun awaitMessages(waitMs: Long) {
        synchronized(monitor) {
            if (queue.isEmpty()) {
                try { monitor.wait(waitMs) } catch (_: InterruptedException) {}
            }
        }
    }
}
