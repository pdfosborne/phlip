package app.phlip.server.publichost.cloudflare

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import java.nio.charset.StandardCharsets
import javax.net.ssl.SSLException

    /**
     * Minimal Cloudflare REST client for permanent Phlip public hosting + edge Worker.
     *
     * Required API token permissions (Custom token):
     * - Account → Cloudflare Tunnel → Edit
     * - Account → Workers Scripts → Edit
     * - Account → Workers KV Storage → Edit
     * - Zone → DNS → Edit  (first dropdown on that row must be Zone, not Account)
     * - Zone → Workers Routes → Edit
     */
    object CloudflareApi {

    data class Account(val id: String, val name: String)
    data class Zone(val id: String, val name: String, val accountId: String)
    data class Tunnel(val id: String, val name: String, val token: String?)

    class ApiException(message: String, val statusCode: Int? = null) : Exception(message)

    internal fun setupGet(apiToken: String, path: String): JSONObject = get(apiToken, path)

    /**
     * User-facing text for Cloudflare HTTP / DNS failures.
     * Prefer this over raw [Throwable.message] (Android DNS errors are opaque).
     */
    fun describeFailure(t: Throwable): String {
        if (t is ApiException) {
            val m = t.message?.trim().orEmpty()
            if (m.isNotEmpty()) return m
        }
        var cur: Throwable? = t
        while (cur != null) {
            when (cur) {
                is UnknownHostException -> return MSG_DNS
                is SocketTimeoutException -> return MSG_TIMEOUT
                is SSLException -> return MSG_SSL
                is ConnectException -> return MSG_CONNECT
                is IOException -> {
                    val m = cur.message.orEmpty()
                    if (m.contains("Unable to resolve host", ignoreCase = true) ||
                        m.contains("No address associated", ignoreCase = true)
                    ) {
                        return MSG_DNS
                    }
                }
            }
            cur = cur.cause
        }
        return t.message?.trim()?.takeIf { it.isNotEmpty() } ?: "Cloudflare request failed"
    }

    fun listAccounts(apiToken: String): List<Account> {
        val root = get(apiToken, "/accounts?per_page=50")
        val result = root.optJSONArray("result") ?: JSONArray()
        return (0 until result.length()).map { i ->
            val o = result.getJSONObject(i)
            Account(o.getString("id"), o.optString("name"))
        }
    }

    fun findZone(apiToken: String, domain: String): Zone {
        val apex = domain.trim().lowercase().removePrefix("https://").removePrefix("http://")
            .substringBefore("/").trim('.')
        if (apex.isEmpty() || !apex.contains('.')) {
            throw ApiException("Enter an apex domain like example.com")
        }
        val root = get(apiToken, "/zones?name=${enc(apex)}&status=active")
        val result = root.optJSONArray("result") ?: JSONArray()
        if (result.length() == 0) {
            throw ApiException("No active Cloudflare zone for “$apex”. Add the domain in Cloudflare first.")
        }
        val o = result.getJSONObject(0)
        val accountId = o.getJSONObject("account").getString("id")
        return Zone(o.getString("id"), o.getString("name"), accountId)
    }

    /** Find an existing tunnel by name, or create a remotely-managed one. */
    fun ensureTunnel(apiToken: String, accountId: String, name: String = TUNNEL_NAME): Tunnel {
        val listed = get(apiToken, "/accounts/${enc(accountId)}/cfd_tunnel?is_deleted=false&per_page=50")
        val arr = listed.optJSONArray("result") ?: JSONArray()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            if (o.optString("name").equals(name, ignoreCase = true) && !o.optBoolean("deleted", false)) {
                val id = o.getString("id")
                val token = getTunnelToken(apiToken, accountId, id)
                return Tunnel(id, o.optString("name", name), token)
            }
        }
        val body = JSONObject()
            .put("name", name)
            .put("config_src", "cloudflare")
        val created = post(apiToken, "/accounts/${enc(accountId)}/cfd_tunnel", body)
        val result = created.getJSONObject("result")
        val id = result.getString("id")
        val token = result.optString("token").ifBlank { getTunnelToken(apiToken, accountId, id) }
        return Tunnel(id, result.optString("name", name), token)
    }

    fun getTunnelToken(apiToken: String, accountId: String, tunnelId: String): String {
        val root = get(apiToken, "/accounts/${enc(accountId)}/cfd_tunnel/${enc(tunnelId)}/token")
        // API may return result as a raw JSON string or wrapped object.
        val result = root.opt("result")
        val token = when (result) {
            is String -> result
            is JSONObject -> result.optString("token")
            else -> root.optString("result")
        }.trim()
        if (token.isEmpty()) throw ApiException("Cloudflare did not return a tunnel token.")
        return token
    }

    /**
     * Invalidate the current tunnel run token by creating a new tunnel, migrating
     * DNS + ingress for [routes] (hostname → local HTTP URL), updating [prefs],
     * then deleting the old tunnel. One-tap remediation after suspected compromise.
     */
    fun rotateNamedTunnel(
        apiToken: String,
        prefs: CloudflarePrefs,
        routes: List<Pair<String, String>>,
    ) {
        val accountId = prefs.accountId.trim()
        val zoneId = prefs.zoneId.trim()
        val oldTunnelId = prefs.tunnelId.trim()
        if (accountId.isEmpty() || zoneId.isEmpty()) {
            throw ApiException("Cloudflare account/zone missing — run domain setup again.")
        }
        val name = "phlip-${System.currentTimeMillis().toString(36)}"
        val created = post(
            apiToken,
            "/accounts/${enc(accountId)}/cfd_tunnel",
            JSONObject().put("name", name).put("config_src", "cloudflare"),
        )
        val result = created.getJSONObject("result")
        val newId = result.getString("id")
        val newToken = result.optString("token").ifBlank {
            getTunnelToken(apiToken, accountId, newId)
        }.trim()
        if (newToken.isEmpty()) throw ApiException("New tunnel token missing.")

        // Seed empty ingress so putIngress merges cleanly.
        put(
            apiToken,
            "/accounts/${enc(accountId)}/cfd_tunnel/${enc(newId)}/configurations",
            JSONObject().put(
                "config",
                JSONObject().put("ingress", JSONArray().put(JSONObject().put("service", "http_status:404"))),
            ),
        )
        for ((hostname, local) in routes) {
            val host = hostname.trim().lowercase()
            if (host.isEmpty()) continue
            publishHostname(apiToken, accountId, zoneId, newId, host, local)
        }

        prefs.tunnelId = newId
        prefs.tunnelToken = newToken

        if (oldTunnelId.isNotEmpty() && oldTunnelId != newId) {
            try {
                delete(apiToken, "/accounts/${enc(accountId)}/cfd_tunnel/${enc(oldTunnelId)}")
            } catch (t: Throwable) {
                Log.w(TAG, "old tunnel delete failed (new tunnel is active)", t)
            }
        }
    }

    /** Point hostname at the tunnel and set remote ingress → local NanoHTTPD. */
    fun publishHostname(
        apiToken: String,
        accountId: String,
        zoneId: String,
        tunnelId: String,
        hostname: String,
        localHttpUrl: String,
    ) {
        val host = hostname.trim().lowercase()
        if (host.isEmpty()) throw ApiException("Missing public hostname.")
        ensureDnsCname(apiToken, zoneId, host, tunnelId)
        putIngress(apiToken, accountId, tunnelId, host, localHttpUrl)
    }

    /** Drop a hostname from DNS + tunnel ingress (e.g. after subdomain rename). */
    fun removeHostname(
        apiToken: String,
        accountId: String,
        zoneId: String,
        tunnelId: String,
        hostname: String,
    ) {
        val host = hostname.trim().lowercase()
        if (host.isEmpty()) return
        try { deleteDnsCname(apiToken, zoneId, host) } catch (t: Throwable) {
            Log.w(TAG, "DNS delete $host failed", t)
        }
        try { removeIngressHostname(apiToken, accountId, tunnelId, host) } catch (t: Throwable) {
            Log.w(TAG, "Ingress remove $host failed", t)
        }
    }

    /**
     * Full teardown for a public hostname: edge KV clear (while route still live),
     * Worker route, public DNS/ingress, and unguessable origin DNS/ingress.
     */
    fun purgePublicHostname(
        apiToken: String,
        prefs: CloudflarePrefs,
        hostname: String,
    ) {
        val host = hostname.trim().lowercase()
        if (host.isEmpty()) return
        val accountId = prefs.accountId.trim()
        val zoneId = prefs.zoneId.trim()
        val tunnelId = prefs.tunnelId.trim()

        // KV clear first — needs Worker route + DNS still answering.
        try {
            EdgeHostClient.clearHostname(prefs, host)
        } catch (t: Throwable) {
            Log.w(TAG, "edge KV clear $host failed", t)
        }

        if (zoneId.isNotEmpty()) {
            try { removeWorkerRoute(apiToken, zoneId, host) } catch (t: Throwable) {
                Log.w(TAG, "Worker route remove $host failed", t)
            }
        }

        if (accountId.isNotEmpty() && zoneId.isNotEmpty() && tunnelId.isNotEmpty()) {
            removeHostname(apiToken, accountId, zoneId, tunnelId, host)
            val origin = originHostnameFor(prefs, host)
            try { deleteDnsCname(apiToken, zoneId, origin) } catch (t: Throwable) {
                Log.w(TAG, "origin DNS delete $origin failed", t)
            }
            try { removeIngressHostname(apiToken, accountId, tunnelId, origin) } catch (t: Throwable) {
                Log.w(TAG, "origin ingress remove $origin failed", t)
            }
        }
    }

    fun ensureDnsCname(apiToken: String, zoneId: String, hostname: String, tunnelId: String) {
        val target = "$tunnelId.cfargotunnel.com"
        val existing = get(
            apiToken,
            "/zones/${enc(zoneId)}/dns_records?type=CNAME&name=${enc(hostname)}&per_page=5",
        )
        val arr = existing.optJSONArray("result") ?: JSONArray()
        if (arr.length() > 0) {
            val rec = arr.getJSONObject(0)
            val id = rec.getString("id")
            val body = JSONObject()
                .put("type", "CNAME")
                .put("name", hostname)
                .put("content", target)
                .put("proxied", true)
                .put("ttl", 1)
            put(apiToken, "/zones/${enc(zoneId)}/dns_records/${enc(id)}", body)
            return
        }
        val body = JSONObject()
            .put("type", "CNAME")
            .put("name", hostname)
            .put("content", target)
            .put("proxied", true)
            .put("ttl", 1)
        post(apiToken, "/zones/${enc(zoneId)}/dns_records", body)
    }

    fun deleteDnsCname(apiToken: String, zoneId: String, hostname: String) {
        val existing = get(
            apiToken,
            "/zones/${enc(zoneId)}/dns_records?type=CNAME&name=${enc(hostname)}&per_page=5",
        )
        val arr = existing.optJSONArray("result") ?: JSONArray()
        for (i in 0 until arr.length()) {
            val id = arr.getJSONObject(i).optString("id")
            if (id.isNotBlank()) delete(apiToken, "/zones/${enc(zoneId)}/dns_records/${enc(id)}")
        }
    }

    fun putIngress(
        apiToken: String,
        accountId: String,
        tunnelId: String,
        hostname: String,
        localHttpUrl: String,
    ) {
        val service = if (localHttpUrl.startsWith("http")) localHttpUrl else "http://$localHttpUrl"
        val host = hostname.trim().lowercase()
        val rule = JSONObject()
            .put("hostname", host)
            .put("service", service)
            // Keep HTTP/1.1 to NanoHTTPD — HTTP/2 origin breaks POST body reads.
            .put(
                "originRequest",
                JSONObject()
                    .put("http2Origin", false)
                    .put("disableChunkedEncoding", true),
            )

        // Merge into existing ingress so publishing a new subdomain doesn't
        // wipe every other hostname already on this tunnel.
        val ingress = JSONArray()
        var replaced = false
        try {
            val existing = get(
                apiToken,
                "/accounts/${enc(accountId)}/cfd_tunnel/${enc(tunnelId)}/configurations",
            )
            val prev = existing.optJSONObject("result")
                ?.optJSONObject("config")
                ?.optJSONArray("ingress")
            if (prev != null) {
                for (i in 0 until prev.length()) {
                    val item = prev.optJSONObject(i) ?: continue
                    val itemHost = item.optString("hostname").trim().lowercase()
                    if (itemHost.isEmpty()) continue // catch-all; re-add at end
                    if (itemHost == host) {
                        ingress.put(rule)
                        replaced = true
                    } else {
                        ingress.put(item)
                    }
                }
            }
        } catch (t: Throwable) {
            Log.w("AshCfApi", "Could not read existing ingress; replacing", t)
        }
        if (!replaced) ingress.put(rule)
        ingress.put(JSONObject().put("service", "http_status:404"))

        val body = JSONObject().put("config", JSONObject().put("ingress", ingress))
        put(apiToken, "/accounts/${enc(accountId)}/cfd_tunnel/${enc(tunnelId)}/configurations", body)
    }

    fun removeIngressHostname(
        apiToken: String,
        accountId: String,
        tunnelId: String,
        hostname: String,
    ) {
        val host = hostname.trim().lowercase()
        if (host.isEmpty()) return
        val existing = get(
            apiToken,
            "/accounts/${enc(accountId)}/cfd_tunnel/${enc(tunnelId)}/configurations",
        )
        val prev = existing.optJSONObject("result")
            ?.optJSONObject("config")
            ?.optJSONArray("ingress") ?: return
        val ingress = JSONArray()
        var removed = false
        for (i in 0 until prev.length()) {
            val item = prev.optJSONObject(i) ?: continue
            val itemHost = item.optString("hostname").trim().lowercase()
            if (itemHost.isEmpty()) continue // catch-all; re-add at end
            if (itemHost == host) {
                removed = true
                continue
            }
            ingress.put(item)
        }
        if (!removed) return
        ingress.put(JSONObject().put("service", "http_status:404"))
        val body = JSONObject().put("config", JSONObject().put("ingress", ingress))
        put(apiToken, "/accounts/${enc(accountId)}/cfd_tunnel/${enc(tunnelId)}/configurations", body)
    }

    /**
     * One-shot setup: resolve zone + account, ensure tunnel, store run token.
     * Keeps [apiToken] so later Public toggles can update DNS/ingress.
     */
    fun provisionNamedHosting(apiToken: String, domain: String, prefs: CloudflarePrefs): String {
        val zone = findZone(apiToken, domain)
        return provisionNamedHosting(apiToken, zone, prefs)
    }

    fun provisionNamedHosting(apiToken: String, zone: Zone, prefs: CloudflarePrefs): String {
        val tunnel = ensureTunnel(apiToken, zone.accountId)
        val token = tunnel.token?.trim().orEmpty()
        if (token.isEmpty()) throw ApiException("Tunnel token missing after create.")
        prefs.apiToken = apiToken.trim()
        prefs.domain = zone.name
        prefs.accountId = zone.accountId
        prefs.zoneId = zone.id
        prefs.tunnelId = tunnel.id
        prefs.tunnelToken = token
        return zone.name
    }

    // ── Edge Worker + KV ────────────────────────────────────────────────────

    const val WORKER_SCRIPT_NAME = "phlip-edge"

    /** Ensure a KV namespace for edge invite/share state; stores id on [prefs]. */
    fun ensureKvNamespace(apiToken: String, accountId: String, prefs: CloudflarePrefs): String {
        val existing = prefs.kvNamespaceId.trim()
        if (existing.isNotEmpty()) {
            try {
                get(apiToken, "/accounts/${enc(accountId)}/storage/kv/namespaces/${enc(existing)}")
                return existing
            } catch (_: Exception) {
                prefs.kvNamespaceId = ""
            }
        }
        val listed = get(apiToken, "/accounts/${enc(accountId)}/storage/kv/namespaces?per_page=100")
        val arr = listed.optJSONArray("result") ?: JSONArray()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            if (o.optString("title") == "phlip-edge") {
                val id = o.getString("id")
                prefs.kvNamespaceId = id
                return id
            }
        }
        val created = post(
            apiToken,
            "/accounts/${enc(accountId)}/storage/kv/namespaces",
            JSONObject().put("title", "phlip-edge"),
        )
        val id = created.getJSONObject("result").getString("id")
        prefs.kvNamespaceId = id
        return id
    }

    /**
     * Upload the module Worker from [scriptBytes], bind KV + plain-text secrets
     * via metadata, then set encrypted secrets EDGE_SECRET / HOST_SYNC / ORIGIN.
     */
    fun deployEdgeWorker(
        apiToken: String,
        accountId: String,
        kvNamespaceId: String,
        scriptBytes: ByteArray,
        edgeSecret: String,
        hostSync: String,
        originUrl: String,
    ) {
        val metadata = JSONObject()
            .put("main_module", "phlip-edge-worker.js")
            .put("bindings", JSONArray()
                .put(JSONObject()
                    .put("type", "kv_namespace")
                    .put("name", "KV")
                    .put("namespace_id", kvNamespaceId))
                .put(JSONObject()
                    .put("type", "plain_text")
                    .put("name", "EDGE_SECRET")
                    .put("text", edgeSecret))
                .put(JSONObject()
                    .put("type", "plain_text")
                    .put("name", "HOST_SYNC")
                    .put("text", hostSync))
                .put(JSONObject()
                    .put("type", "plain_text")
                    .put("name", "ORIGIN")
                    .put("text", originUrl.trim().removeSuffix("/")))
            )
            .put("compatibility_date", "2024-11-01")
        putWorkerModule(
            apiToken,
            "/accounts/${enc(accountId)}/workers/scripts/${enc(WORKER_SCRIPT_NAME)}",
            metadata,
            "phlip-edge-worker.js",
            scriptBytes,
        )
    }

    /** Attach Worker to a public hostname (zone route). */
    fun ensureWorkerRoute(apiToken: String, zoneId: String, hostname: String) {
        val host = hostname.trim().lowercase()
        if (host.isEmpty()) return
        val pattern = "$host/*"
        val listed = get(apiToken, "/zones/${enc(zoneId)}/workers/routes")
        val arr = listed.optJSONArray("result") ?: JSONArray()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            if (o.optString("pattern").equals(pattern, ignoreCase = true)) {
                if (o.optString("script") != WORKER_SCRIPT_NAME) {
                    put(
                        apiToken,
                        "/zones/${enc(zoneId)}/workers/routes/${enc(o.getString("id"))}",
                        JSONObject().put("pattern", pattern).put("script", WORKER_SCRIPT_NAME),
                    )
                }
                return
            }
        }
        post(
            apiToken,
            "/zones/${enc(zoneId)}/workers/routes",
            JSONObject().put("pattern", pattern).put("script", WORKER_SCRIPT_NAME),
        )
    }

    fun removeWorkerRoute(apiToken: String, zoneId: String, hostname: String) {
        val host = hostname.trim().lowercase()
        if (host.isEmpty()) return
        val pattern = "$host/*"
        val listed = get(apiToken, "/zones/${enc(zoneId)}/workers/routes")
        val arr = listed.optJSONArray("result") ?: JSONArray()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            if (o.optString("pattern").equals(pattern, ignoreCase = true)) {
                try {
                    delete(apiToken, "/zones/${enc(zoneId)}/workers/routes/${enc(o.getString("id"))}")
                } catch (t: Throwable) {
                    Log.w(TAG, "route delete failed", t)
                }
            }
        }
    }

    /**
     * Ensure an unguessable origin hostname for [publicHostname] (DNS + tunnel
     * ingress → [localHttpUrl]). Derived label so multi-public servers each get
     * their own origin port mapping.
     */
    fun originHostnameFor(prefs: CloudflarePrefs, publicHostname: String): String {
        val apex = prefs.domain.trim().lowercase()
        val dig = java.security.MessageDigest.getInstance("SHA-256")
            .digest(publicHostname.trim().lowercase().toByteArray(Charsets.UTF_8))
        val label = "o-" + dig.take(6).joinToString("") { "%02x".format(it) }
        return "$label.$apex"
    }

    fun ensureOriginHostname(
        apiToken: String,
        prefs: CloudflarePrefs,
        publicHostname: String,
        localHttpUrl: String,
    ): String {
        val origin = originHostnameFor(prefs, publicHostname)
        prefs.originHostname = origin // last provisioned (fallback for Worker env)
        publishHostname(
            apiToken,
            prefs.accountId,
            prefs.zoneId,
            prefs.tunnelId,
            origin,
            localHttpUrl,
        )
        return origin
    }

    /**
     * Full edge provision: KV + Worker + routes for public hostnames.
     * Per-hostname origin ingress is published separately in [ensureNamedPublicRoute].
     */
    fun provisionEdge(
        apiToken: String,
        prefs: CloudflarePrefs,
        scriptBytes: ByteArray,
        originLocalHttp: String,
        publicHostnames: List<String>,
    ) {
        val accountId = prefs.accountId.trim()
        val zoneId = prefs.zoneId.trim()
        if (accountId.isEmpty() || zoneId.isEmpty()) {
            throw ApiException("Cloudflare account/zone missing — run domain setup again.")
        }
        val secret = prefs.ensureEdgeSecret()
        prefs.hostSyncSecret = secret
        val kvId = ensureKvNamespace(apiToken, accountId, prefs)
        val firstHost = publicHostnames.firstOrNull()?.trim().orEmpty()
        val originHost = if (firstHost.isNotEmpty()) {
            ensureOriginHostname(apiToken, prefs, firstHost, originLocalHttp)
        } else {
            val placeholder = "bootstrap.${prefs.domain}"
            ensureOriginHostname(apiToken, prefs, placeholder, originLocalHttp)
        }
        val originUrl = "https://$originHost"
        deployEdgeWorker(apiToken, accountId, kvId, scriptBytes, secret, secret, originUrl)
        for (h in publicHostnames) {
            val host = h.trim().lowercase()
            if (host.isEmpty()) continue
            ensureWorkerRoute(apiToken, zoneId, host)
        }
        prefs.edgeProvisioned = true
    }

    private fun putWorkerModule(
        apiToken: String,
        path: String,
        metadata: JSONObject,
        filename: String,
        scriptBytes: ByteArray,
    ): JSONObject {
        val boundary = "----PhlipBoundary${System.currentTimeMillis()}"
        val metaPart = buildString {
            append("--$boundary\r\n")
            append("Content-Disposition: form-data; name=\"metadata\"; filename=\"metadata.json\"\r\n")
            append("Content-Type: application/json\r\n\r\n")
            append(metadata.toString())
            append("\r\n")
        }.toByteArray(StandardCharsets.UTF_8)
        val scriptHeader = buildString {
            append("--$boundary\r\n")
            append("Content-Disposition: form-data; name=\"$filename\"; filename=\"$filename\"\r\n")
            append("Content-Type: application/javascript+module\r\n\r\n")
        }.toByteArray(StandardCharsets.UTF_8)
        val footer = "\r\n--$boundary--\r\n".toByteArray(StandardCharsets.UTF_8)
        val body = metaPart + scriptHeader + scriptBytes + footer

        val url = URL(BASE + path)
        val conn = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "PUT"
            connectTimeout = 45_000
            readTimeout = 60_000
            doOutput = true
            setRequestProperty("Authorization", "Bearer ${apiToken.trim()}")
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
        }
        try {
            conn.outputStream.use { it.write(body) }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.use { BufferedReader(InputStreamReader(it, StandardCharsets.UTF_8)).readText() }
                .orEmpty()
            val root = try {
                if (text.isBlank()) JSONObject() else JSONObject(text)
            } catch (_: Exception) {
                throw ApiException("Cloudflare Worker upload HTTP $code: ${text.take(200)}")
            }
            if (code !in 200..299 || !root.optBoolean("success", code in 200..299)) {
                val err = root.optJSONArray("errors")?.optJSONObject(0)?.optString("message")
                    ?: text.take(200).ifBlank { "HTTP $code" }
                throw ApiException(err, code)
            }
            return root
        } catch (e: ApiException) {
            throw e
        } catch (t: Throwable) {
            throw ApiException(describeFailure(t))
        } finally {
            conn.disconnect()
        }
    }

    private fun get(apiToken: String, path: String): JSONObject =
        request(apiToken, "GET", path, null)

    private fun post(apiToken: String, path: String, body: JSONObject): JSONObject =
        request(apiToken, "POST", path, body)

    private fun put(apiToken: String, path: String, body: JSONObject): JSONObject =
        request(apiToken, "PUT", path, body)

    private fun delete(apiToken: String, path: String): JSONObject =
        request(apiToken, "DELETE", path, null)

    private fun request(apiToken: String, method: String, path: String, body: JSONObject?): JSONObject {
        val url = URL(BASE + path)
        val conn = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 25_000
            readTimeout = 30_000
            setRequestProperty("Authorization", "Bearer ${apiToken.trim()}")
            setRequestProperty("Accept", "application/json")
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
        }
        try {
            if (body != null) {
                conn.outputStream.use { os ->
                    os.write(body.toString().toByteArray(StandardCharsets.UTF_8))
                }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.use { BufferedReader(InputStreamReader(it, StandardCharsets.UTF_8)).readText() }
                .orEmpty()
            val root = try {
                if (text.isBlank()) JSONObject() else JSONObject(text)
            } catch (_: Exception) {
                throw ApiException("Cloudflare HTTP $code: ${text.take(180)}", code)
            }
            if (code !in 200..299 || !root.optBoolean("success", code in 200..299)) {
                val err = root.optJSONArray("errors")?.optJSONObject(0)?.optString("message")
                    ?: text.take(180).ifBlank { "HTTP $code" }
                Log.w(TAG, "API $method $path → $code $err")
                throw ApiException(err, code)
            }
            return root
        } catch (e: ApiException) {
            throw e
        } catch (t: Throwable) {
            throw ApiException(describeFailure(t))
        } finally {
            conn.disconnect()
        }
    }

    private fun enc(s: String): String = java.net.URLEncoder.encode(s, "UTF-8")

    private const val BASE = "https://api.cloudflare.com/client/v4"
    private const val TUNNEL_NAME = "ash-phone"
    private const val TAG = "AshCfApi"

    private const val MSG_DNS =
        "Can't reach Cloudflare’s API — DNS lookup for api.cloudflare.com failed on this phone. " +
            "Check Private DNS / any DNS filter (AdGuard, NextDNS), try the other network " +
            "(Wi‑Fi ↔ mobile data), then Save or turn Public again."
    private const val MSG_TIMEOUT =
        "Cloudflare’s API timed out. Check the connection and try again."
    private const val MSG_CONNECT =
        "Can't connect to Cloudflare’s API. Check the connection and try again."
    private const val MSG_SSL =
        "Secure connection to Cloudflare’s API failed. Check the phone date/time and any network filters, then try again."
}
