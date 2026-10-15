package app.phlip.server

import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.MessageDigest

/**
 * Builds the opt-in slice-sync projection from the same permission-filtered
 * welcome object used by legacy clients. The legacy wire shape is therefore
 * untouched and remains the compatibility fallback.
 */
internal class SyncSliceBuilder {
    companion object {
        const val PROTOCOL = 1
        const val CAPABILITY = "slice-sync-v1"
        const val MESSAGE_PAGE_SIZE = 100
        private const val MAX_MANIFEST_ENTRIES = 512
    }

    fun response(fullSnapshot: JSONObject, user: User, request: JSONObject): JSONObject {
        val requestedPrincipal = request.optString("principalId")
        val supplied = if (requestedPrincipal == user.id) readManifest(request.optJSONObject("manifest"))
            else emptyMap()
        val slices = buildSlices(fullSnapshot)
        val manifest = linkedMapOf<String, String>()
        for ((key, value) in slices) manifest[key] = hash(value)

        val changed = JSONArray()
        for ((key, value) in slices) {
            if (supplied[key] == manifest[key]) continue
            changed.put(JSONObject().put("key", key).put("hash", manifest[key]).put("data", value))
        }
        val removed = JSONArray()
        for (key in supplied.keys) if (key !in manifest) removed.put(key)

        val manifestJson = JSONObject()
        for ((key, value) in manifest) manifestJson.put(key, value)
        return JSONObject()
            .put("type", "syncSlices")
            .put("protocol", PROTOCOL)
            .put("principalId", user.id)
            .put("baseRevision", hash(manifestJson))
            .put("manifest", manifestJson)
            .put("changed", changed)
            .put("removed", removed)
    }

    fun messagePage(fullSnapshot: JSONObject, channelId: String, beforeTs: Long, beforeId: String): JSONObject {
        val all = fullSnapshot.optJSONObject("messages")?.optJSONArray(channelId) ?: JSONArray()
        val rows = mutableListOf<JSONObject>()
        for (i in 0 until all.length()) {
            val row = all.optJSONObject(i) ?: continue
            val ts = row.optLong("ts")
            val id = row.optString("id")
            val before = beforeTs <= 0L || ts < beforeTs || (ts == beforeTs && id < beforeId)
            if (before) rows.add(JSONObject(row.toString()))
        }
        rows.sortWith(compareBy<JSONObject>({ it.optLong("ts") }, { it.optString("id") }))
        val start = (rows.size - MESSAGE_PAGE_SIZE).coerceAtLeast(0)
        val pageRows = rows.subList(start, rows.size)
        val items = JSONArray()
        pageRows.forEach { items.put(it) }
        val first = pageRows.firstOrNull()
        return JSONObject()
            .put("type", "messagePage")
            .put("channelId", channelId)
            .put("items", items)
            .put("hasMore", start > 0)
            .put("beforeTs", first?.optLong("ts") ?: 0L)
            .put("beforeId", first?.optString("id") ?: "")
    }

    private fun buildSlices(full: JSONObject): LinkedHashMap<String, JSONObject> {
        val out = linkedMapOf<String, JSONObject>()
        val excluded = setOf("type", "channels", "events", "availabilities", "timeBlocks", "messages", "online")
        val root = JSONObject()
        for (key in full.keys()) {
            if (key in excluded) continue
            root.put(key, full.opt(key))
        }
        out["root"] = root

        val channels = full.optJSONArray("channels") ?: JSONArray()
        val eventsByChannel = groupByChannel(full.optJSONArray("events"))
        val availabilitiesByChannel = groupByChannel(full.optJSONArray("availabilities"))
        val timeBlocksByChannel = groupByChannel(full.optJSONArray("timeBlocks"))
        val messages = full.optJSONObject("messages") ?: JSONObject()
        for (i in 0 until channels.length()) {
            val channel = channels.optJSONObject(i) ?: continue
            val channelId = channel.optString("id")
            if (channelId.isEmpty()) continue
            val allMessages = messages.optJSONArray(channelId) ?: JSONArray()
            val newest = JSONArray()
            val from = (allMessages.length() - MESSAGE_PAGE_SIZE).coerceAtLeast(0)
            for (j in from until allMessages.length()) newest.put(allMessages.opt(j))
            out["channel:$channelId"] = JSONObject()
                .put("channel", channel)
                .put("events", eventsByChannel[channelId] ?: JSONArray())
                .put("availabilities", availabilitiesByChannel[channelId] ?: JSONArray())
                .put("timeBlocks", timeBlocksByChannel[channelId] ?: JSONArray())
                .put("messages", newest)
                .put("messageCount", allMessages.length())
                .put("hasOlderMessages", from > 0)
        }
        return out
    }

    private fun groupByChannel(source: JSONArray?): Map<String, JSONArray> {
        if (source == null || source.length() == 0) return emptyMap()
        val out = linkedMapOf<String, JSONArray>()
        for (i in 0 until source.length()) {
            val row = source.optJSONObject(i) ?: continue
            val channelId = row.optString("channelId")
            if (channelId.isEmpty()) continue
            out.getOrPut(channelId) { JSONArray() }.put(row)
        }
        return out
    }

    private fun readManifest(raw: JSONObject?): Map<String, String> {
        if (raw == null || raw.length() > MAX_MANIFEST_ENTRIES) return emptyMap()
        val out = linkedMapOf<String, String>()
        for (key in raw.keys()) {
            if (key != "root" && !key.startsWith("channel:")) continue
            val value = raw.optString(key)
            if (value.matches(Regex("^[0-9a-f]{64}$"))) out[key] = value
        }
        return out
    }

    internal fun hash(value: Any): String {
        val canonical = canonical(value)
        return MessageDigest.getInstance("SHA-256")
            .digest(canonical.toByteArray(StandardCharsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }

    private fun canonical(value: Any?): String = when (value) {
        null, JSONObject.NULL -> "null"
        is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(",", "{", "}") { key ->
            JSONObject.quote(key) + ":" + canonical(value.opt(key))
        }
        is JSONArray -> (0 until value.length()).joinToString(",", "[", "]") { canonical(value.opt(it)) }
        is String -> JSONObject.quote(value)
        is Number, is Boolean -> value.toString()
        else -> JSONObject.quote(value.toString())
    }
}
