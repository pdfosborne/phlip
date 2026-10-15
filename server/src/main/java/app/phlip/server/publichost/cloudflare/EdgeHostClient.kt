package app.phlip.server.publichost.cloudflare

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Phone → public Worker host-sync API (invite hash, member sessions, shares, pull).
 * Authenticated with [CloudflarePrefs.hostSyncSecret] as `X-Phlip-Host-Sync`.
 */
object EdgeHostClient {

    private const val TAG = "AshEdgeHost"

    data class HostResult(
        val ok: Boolean,
        val body: JSONObject? = null,
        val httpCode: Int = 0,
        val errorText: String = "",
    ) {
        val errorMessage: String
            get() {
                val fromJson = body?.optString("error").orEmpty().trim()
                if (fromJson.isNotEmpty()) return fromJson
                return errorText.trim()
            }
    }

    fun edgeBaseUrl(prefs: CloudflarePrefs, publicHostname: String): String {
        val host = publicHostname.trim().lowercase()
        if (host.isNotEmpty()) return "https://$host"
        val origin = prefs.originHostname.trim()
        return if (origin.isNotEmpty()) "https://$origin" else ""
    }

    fun sha256Hex(text: String): String {
        val dig = MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8))
        return dig.joinToString("") { "%02x".format(it) }
    }

    /** HMAC-SHA256 hex — must match Worker `hmacHex` (UTF-8 secret + message). */
    fun hmacHex(secret: String, msg: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(secret.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        return mac.doFinal(msg.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }

    /**
     * Authenticity MAC for share upserts (Worker `shareUpsertMac`):
     * `share|{id}|{passHash}|{expiresAt}|{refId}` under HOST_SYNC.
     */
    fun shareUpsertMac(prefs: CloudflarePrefs, share: JSONObject): String {
        val passHash = if (share.isNull("passHash")) "" else share.optString("passHash", "")
        val msg = "share|${share.optString("id")}|$passHash|${share.optLong("expiresAt", 0)}|${share.optString("refId")}"
        return hmacHex(prefs.hostSyncSecret, msg)
    }

    /** @deprecated Rotating join-code hash publish is retired — no-op. Prefer [syncPersonalInvites]. */
    fun syncInvite(
        prefs: CloudflarePrefs,
        publicHostname: String,
        inviteCode: String,
        expiresAtMs: Long,
    ): Boolean {
        // Intentionally does not POST /edge/host/invite (Worker rejects hash publish).
        return prefs.edgeProvisioned && publicHostname.isNotBlank()
    }

    /**
     * Wipe edge KV / cache state for a public hostname after delete or Disconnect.
     * Call while the Worker route still answers this host.
     */
    fun clearHostname(prefs: CloudflarePrefs, publicHostname: String): Boolean {
        if (!prefs.edgeProvisioned) return false
        val host = publicHostname.trim().lowercase()
        if (host.isEmpty()) return false
        val body = JSONObject().put("hostname", host)
        return post(prefs, host, "/edge/host/clear", body).ok
    }

    /**
     * Publish active personal invite slugs for `/j/:slug` request-to-join.
     */
    fun syncPersonalInvites(
        prefs: CloudflarePrefs,
        publicHostname: String,
        slugs: List<String>,
        hostDisplayName: String = "",
    ): Boolean {
        if (!prefs.edgeProvisioned) return false
        val cleaned = slugs
            .map { it.trim().lowercase().replace(Regex("[^a-z0-9]"), "") }
            .filter { it.length >= 8 }
            .distinct()
            .take(500)
        val body = JSONObject()
            .put("hostname", publicHostname.lowercase())
            .put("slugs", JSONArray(cleaned))
            .put("hostDisplayName", hostDisplayName.trim().take(40))
        return post(prefs, publicHostname, "/edge/host/slugs", body).ok
    }

    /** Map public hostname → origin tunnel URL for tiered proxy. */
    fun syncOrigin(
        prefs: CloudflarePrefs,
        publicHostname: String,
        originUrl: String,
    ): Boolean {
        if (!prefs.edgeProvisioned) return false
        val body = JSONObject()
            .put("hostname", publicHostname.lowercase())
            .put("originUrl", originUrl.trim().removeSuffix("/"))
        return post(prefs, publicHostname, "/edge/host/origin", body).ok
    }

    /** Bind an approved / password-login bearer so Worker grants member tier. */
    fun syncMemberSession(
        prefs: CloudflarePrefs,
        publicHostname: String,
        bearerToken: String,
        userId: String,
        oldBearerToken: String? = null,
    ): Boolean {
        if (!prefs.edgeProvisioned || bearerToken.isEmpty()) return false
        val body = JSONObject()
            .put("hostname", publicHostname.lowercase())
            .put("tokenHash", sha256Hex(bearerToken))
            .put("userId", userId)
            .put("exp", System.currentTimeMillis() + 30L * 24 * 60 * 60 * 1000)
        if (!oldBearerToken.isNullOrEmpty()) {
            body.put("oldTokenHash", sha256Hex(oldBearerToken))
        }
        return post(prefs, publicHostname, "/edge/host/member", body).ok
    }

    /** Host-confirmed Workers Free/Paid — drives Free-tier Broadcast throttles. */
    fun syncWorkersPlan(prefs: CloudflarePrefs, publicHostname: String): HostResult {
        if (!prefs.edgeProvisioned) return HostResult(false, errorText = "Edge not provisioned")
        val body = JSONObject()
            .put("hostname", publicHostname.lowercase())
            .put("plan", prefs.workersPlan)
            .put("relayEnabled", prefs.relayCacheEnabled)
        return post(prefs, publicHostname, "/edge/host/plan", body)
    }

    /**
     * Push (or clear) the encrypted relay snapshot for members when the host is asleep.
     * [sealed] must be an `e2e:` blob under the group key; pass [enabled]=false to disable.
     */
    fun pushRelaySnapshot(
        prefs: CloudflarePrefs,
        publicHostname: String,
        seq: Long,
        sealed: String?,
        enabled: Boolean = true,
    ): HostResult {
        if (!prefs.edgeProvisioned) return HostResult(false, errorText = "Edge not provisioned")
        val body = JSONObject()
            .put("hostname", publicHostname.lowercase())
            .put("enabled", enabled)
            .put("seq", seq)
        if (enabled && !sealed.isNullOrBlank()) {
            body.put("sealed", sealed)
        }
        return post(prefs, publicHostname, "/edge/host/relay", body)
    }

    /**
     * Pull Worker KV meter (`kv`) since [sinceMs].
     */
    fun pullInbox(
        prefs: CloudflarePrefs,
        publicHostname: String,
        sinceMs: Long,
    ): HostResult {
        if (!prefs.edgeProvisioned) return HostResult(false, errorText = "Edge not provisioned")
        val base = edgeBaseUrl(prefs, publicHostname)
        if (base.isEmpty()) return HostResult(false, errorText = "No edge base URL")
        val path = "/edge/host/pull?hostname=${enc(publicHostname)}&since=$sinceMs"
        return get(prefs, base + path)
    }

    /**
     * Pull offline join requests queued at the edge while the tunnel was down.
     * Worker clears KV on successful pull (same idea as RSVP inbox).
     */
    fun pullJoinRequests(
        prefs: CloudflarePrefs,
        publicHostname: String,
    ): HostResult {
        if (!prefs.edgeProvisioned) return HostResult(false, errorText = "Edge not provisioned")
        val base = edgeBaseUrl(prefs, publicHostname)
        if (base.isEmpty()) return HostResult(false, errorText = "No edge base URL")
        val path = "/edge/host/join-requests?hostname=${enc(publicHostname)}"
        return get(prefs, base + path)
    }

    /** @deprecated Prefer [pullInbox]; kept for call sites that only need events. */
    fun pullEvents(
        prefs: CloudflarePrefs,
        publicHostname: String,
        sinceMs: Long,
    ): JSONArray {
        val root = pullInbox(prefs, publicHostname, sinceMs).body ?: return JSONArray()
        return root.optJSONArray("events") ?: JSONArray()
    }

    private fun post(
        prefs: CloudflarePrefs,
        publicHostname: String,
        path: String,
        body: JSONObject,
    ): HostResult {
        val base = edgeBaseUrl(prefs, publicHostname)
        if (base.isEmpty()) return HostResult(false, errorText = "No edge base URL")
        return request(prefs, "POST", base + path, body)
    }

    private fun get(prefs: CloudflarePrefs, url: String): HostResult =
        request(prefs, "GET", url, null)

    private fun request(
        prefs: CloudflarePrefs,
        method: String,
        urlStr: String,
        body: JSONObject?,
    ): HostResult {
        val secret = prefs.hostSyncSecret
        if (secret.isEmpty()) return HostResult(false, errorText = "Missing host sync secret")
        return try {
            val url = URL(urlStr)
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = 15_000
                readTimeout = 20_000
                setRequestProperty("Accept", "application/json")
                setRequestProperty("X-Phlip-Host-Sync", secret)
                setRequestProperty("X-Phlip-Workers-Plan", prefs.workersPlan)
                // Host sync must reach Worker even when edge enforce is on —
                // Worker handles /edge/host/* itself (no origin).
                if (body != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                }
            }
            if (body != null) {
                conn.outputStream.use {
                    it.write(body.toString().toByteArray(StandardCharsets.UTF_8))
                }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.use {
                BufferedReader(InputStreamReader(it, StandardCharsets.UTF_8)).readText()
            }.orEmpty()
            conn.disconnect()
            val parsed = try {
                if (text.isBlank()) JSONObject() else JSONObject(text)
            } catch (_: Exception) {
                null
            }
            if (code !in 200..299) {
                Log.w(TAG, "$method $urlStr → $code ${text.take(160)}")
                return HostResult(
                    ok = false,
                    body = parsed,
                    httpCode = code,
                    errorText = text.take(200),
                )
            }
            HostResult(ok = true, body = parsed ?: JSONObject(), httpCode = code)
        } catch (t: Throwable) {
            Log.w(TAG, "$method $urlStr failed", t)
            HostResult(false, errorText = t.message ?: "Request failed")
        }
    }

    private fun enc(s: String): String = java.net.URLEncoder.encode(s, "UTF-8")
}
