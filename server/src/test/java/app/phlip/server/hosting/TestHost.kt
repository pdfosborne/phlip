package app.phlip.server.hosting

import android.app.Application
import app.phlip.core.assets.AssetManagerClientAssetSource
import app.phlip.server.DrServer
import app.phlip.server.SecurityRejectLog
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import org.json.JSONArray
import org.json.JSONObject
import org.robolectric.RuntimeEnvironment
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * L2 fixture harness from hosting-security-tests.md:
 * `TestHost.start(seed) → server on 127.0.0.1:<ephemeral>`.
 *
 * Lives under `src/test` only — never packaged into the published APK.
 */
class TestHost private constructor(
    val server: DrServer,
    val dataFile: File,
    val edgeSecret: String,
) {
    val port: Int get() = server.listeningPort
    val baseUrl: String get() = "http://127.0.0.1:$port"

    /** Host bearer minted in-process (never via the public join path). */
    lateinit var hostToken: String
        private set

    /** E-07: every HTTP body/header seen by this host (scanned on [stop]). */
    private val capturedResponses = java.util.concurrent.CopyOnWriteArrayList<Pair<String, String>>()

    private val http = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(35, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false)
        .build()

    /** Short-timeout client — for endpoints that would otherwise long-poll (LINK K-04). */
    private val httpQuick = OkHttpClient.Builder()
        .connectTimeout(3, TimeUnit.SECONDS)
        .readTimeout(2, TimeUnit.SECONDS)
        .writeTimeout(3, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false)
        .build()

    enum class Role { OWNER, MEMBER, MEMBER_B, MODERATOR, VIEWER, PENDING, SHARE_GUEST }

    data class Seed(
        val hostName: String = "Test Host",
        val edgeSecret: String = "test-edge-secret-do-not-ship",
        val edgeEnforce: Boolean = false,
        val apexDomain: String = "example.test",
        /** Enable [SecurityRejectLog] so EDGE / LIMIT assertions can inspect entries. */
        val rejectLog: Boolean = true,
    )

    data class HttpResult(
        val code: Int,
        val body: String,
        val headers: Map<String, String>,
        val json: JSONObject?,
    ) {
        fun type(): String = json?.optString("type").orEmpty()
        fun error(): String = json?.optString("error").orEmpty()
        fun header(name: String): String? =
            headers.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value
    }

    fun stop() {
        try {
            assertEdgeSecretNotLeaked()
        } finally {
            try {
                server.closeAllClients()
            } catch (_: Exception) {
            }
            try {
                server.stop()
            } catch (_: Exception) {
            }
        }
    }

    /**
     * E-07 global: every response captured while this host ran must not contain
     * [edgeSecret] in body or headers (suite-wide, not a single-case assertion).
     */
    fun assertEdgeSecretNotLeaked() {
        if (edgeSecret.isEmpty()) return
        for ((kind, text) in capturedResponses) {
            org.junit.Assert.assertFalse(
                "E-07: edgeSecret leaked in $kind: ${text.take(120)}",
                text.contains(edgeSecret),
            )
        }
        for (e in SecurityRejectLog.snapshot()) {
            org.junit.Assert.assertFalse(e.detail.contains(edgeSecret))
            org.junit.Assert.assertFalse(e.reason.contains(edgeSecret))
            org.junit.Assert.assertFalse(e.path.contains(edgeSecret))
            org.junit.Assert.assertFalse(e.serverHint.contains(edgeSecret))
        }
    }

    fun bearerFor(role: Role, shareId: String? = null, guestName: String = "Guest"): String = when (role) {
        Role.OWNER -> hostToken
        Role.SHARE_GUEST -> {
            require(!shareId.isNullOrBlank()) { "shareId required for SHARE_GUEST" }
            joinShare(shareId, guestName).optString("token")
                .also { require(it.isNotEmpty()) { "share join failed: no token" } }
        }
        else -> error("Use approveMember() / seeded tokens for $role")
    }

    /** POST /ash-rpc with bearer. */
    fun rpc(bearer: String, type: String, payload: JSONObject = JSONObject()): HttpResult {
        val body = JSONObject(payload.toString()).put("type", type).put("token", bearer)
        return postJson("/ash-rpc", body, tokenHeader = bearer)
    }

    /** POST /ash-share-rpc with guest bearer. */
    fun shareRpc(bearer: String, type: String, payload: JSONObject = JSONObject()): HttpResult {
        val body = JSONObject(payload.toString()).put("type", type).put("token", bearer)
        return postJson("/ash-share-rpc", body, tokenHeader = bearer)
    }

    fun poll(bearer: String): HttpResult =
        get("/ash-poll", headers = mapOf("X-Ash-Token" to bearer))

    fun sharePoll(bearer: String): HttpResult =
        get("/ash-share-poll", headers = mapOf("X-Ash-Token" to bearer))

    fun get(
        path: String,
        headers: Map<String, String> = emptyMap(),
        query: String = "",
        quick: Boolean = false,
    ): HttpResult {
        val url = if (query.isEmpty()) "$baseUrl$path" else "$baseUrl$path?$query"
        val b = Request.Builder().url(url).get()
        headers.forEach { (k, v) -> b.header(k, v) }
        return execute(b.build(), quick = quick)
    }

    /** GET with an encoded path OkHttp must not resolve (e.g. `%2e%2e`). */
    fun getEncoded(encodedPath: String, headers: Map<String, String> = emptyMap()): HttpResult {
        val url = okhttp3.HttpUrl.Builder()
            .scheme("http")
            .host("127.0.0.1")
            .port(port)
            .encodedPath(encodedPath)
            .build()
        val b = Request.Builder().url(url).get()
        headers.forEach { (k, v) -> b.header(k, v) }
        return execute(b.build())
    }

    fun postJson(
        path: String,
        json: JSONObject,
        headers: Map<String, String> = emptyMap(),
        tokenHeader: String? = null,
        contentType: String = "application/json; charset=UTF-8",
        extraHeaders: Map<String, String> = emptyMap(),
    ): HttpResult {
        val body = json.toString().toRequestBody(contentType.toMediaType())
        val b = Request.Builder().url("$baseUrl$path").post(body)
            .header("Content-Type", contentType)
        headers.forEach { (k, v) -> b.header(k, v) }
        extraHeaders.forEach { (k, v) -> b.header(k, v) }
        if (!tokenHeader.isNullOrEmpty()) b.header("X-Ash-Token", tokenHeader)
        return execute(b.build())
    }

    fun postRaw(
        path: String,
        bytes: ByteArray,
        contentType: String = "application/json",
        headers: Map<String, String> = emptyMap(),
    ): HttpResult {
        val body = bytes.toRequestBody(contentType.toMediaType())
        val b = Request.Builder().url("$baseUrl$path").post(body)
            .header("Content-Type", contentType)
            .header("Content-Length", bytes.size.toString())
        headers.forEach { (k, v) -> b.header(k, v) }
        return execute(b.build())
    }

    /**
     * POST with a declared Content-Length that may exceed the bytes actually written.
     * Used to exercise the server's header-only body-size gate without a full socket transfer
     * (Windows aborts when NanoHTTPD rejects mid-write of a huge body).
     */
    fun postDeclaredLength(
        path: String,
        declaredLength: Long,
        bytes: ByteArray,
        contentType: String = "application/json",
    ): HttpResult {
        val media = contentType.toMediaType()
        val body = object : RequestBody() {
            override fun contentType() = media
            override fun contentLength() = declaredLength
            override fun writeTo(sink: BufferedSink) {
                sink.write(bytes)
            }
        }
        return execute(Request.Builder().url("$baseUrl$path").post(body).build())
    }

    private fun execute(req: Request, quick: Boolean = false): HttpResult {
        val client = if (quick) httpQuick else http
        return try {
            client.newCall(req).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                val hdrs = resp.headers.toMultimap().mapValues { it.value.lastOrNull().orEmpty() }
                capturedResponses.add("body" to text)
                for ((k, v) in hdrs) capturedResponses.add("header:$k" to v)
                val json = try {
                    if (text.trimStart().startsWith("{")) JSONObject(text) else null
                } catch (_: Exception) {
                    null
                }
                HttpResult(resp.code, text, hdrs, json)
            }
        } catch (e: java.io.IOException) {
            // Short-timeout polls (K-04) are expected to abort; still a captured attempt.
            capturedResponses.add("io" to (e.message ?: "io"))
            HttpResult(-1, e.message ?: "io", emptyMap(), null)
        }
    }

    /**
     * Join + host-approve a new member. Returns the welcome bearer token.
     * Request-to-join: no rotating invite required (optional [inviteSlug] for attribution).
     */
    fun approveMember(
        name: String,
        role: String = "user",
        fingerprint: String = "fp-${name.lowercase()}-0123456789abcdef",
        inviteSlug: String? = null,
    ): MemberSession {
        val joinBody = JSONObject()
            .put("name", name)
            .put("fingerprint", fingerprint)
        if (!inviteSlug.isNullOrBlank()) joinBody.put("inviteSlug", inviteSlug)
        val join = postJson("/ash-join", joinBody)
        require(join.type() == "waiting") {
            "expected waiting, got ${join.type()} / ${join.error()} / ${join.body}"
        }
        val requestId = join.json!!.optString("requestId")
        val approve = rpc(hostToken, "approveJoin", JSONObject().put("requestId", requestId))
        require(approve.code == 200) { "approveJoin failed: ${approve.body}" }

        // Poll until welcome (readyWelcome is kept until TTL).
        var welcome: HttpResult? = null
        repeat(40) {
            val w = get("/ash-join-wait", query = "id=$requestId")
            if (w.type() == "welcome" || w.json?.has("token") == true) {
                welcome = w
                return@repeat
            }
            Thread.sleep(50)
        }
        val w = welcome ?: error("no welcome for $name: last=${get("/ash-join-wait", query = "id=$requestId").body}")
        val token = w.json!!.optString("token")
        require(token.isNotEmpty()) { "welcome missing token: ${w.body}" }
        val userId = w.json.optJSONObject("user")?.optString("id").orEmpty()
        require(userId.isNotEmpty()) { "welcome missing user.id: ${w.body}" }
        if (role != "user" && role != "viewer") {
            rpc(hostToken, "setMemberRole", JSONObject().put("userId", userId).put("role", role))
        } else if (role == "viewer") {
            rpc(hostToken, "setMemberRole", JSONObject().put("userId", userId).put("role", "viewer"))
        }
        return MemberSession(token = token, userId = userId, name = name, role = role)
    }

    /** Create a private event channel visible only to [allowedUserIds] (host always included). */
    fun createEventChannel(name: String, allowedUserIds: List<String>): String {
        val before = channelIds()
        rpc(
            hostToken,
            "createBoard",
            JSONObject()
                .put("name", name)
                .put("kind", "event")
                .put("allowedUserIds", JSONArray(allowedUserIds)),
        )
        val after = channelIds()
        return (after - before).firstOrNull { id -> channelKind(id) == "event" }
            ?: error("createChannel did not add a channel")
    }

    fun createChatChannel(name: String, allowedUserIds: List<String>? = null): String {
        val before = channelIds()
        val payload = JSONObject().put("name", name).put("kind", "chat")
        if (allowedUserIds == null) {
            // Explicit null = open channel (omit key would default to creator-only).
            payload.put("allowedUserIds", JSONObject.NULL)
        } else {
            payload.put("allowedUserIds", JSONArray(allowedUserIds))
        }
        rpc(hostToken, "createBoard", payload)
        return (channelIds() - before).firstOrNull { id -> channelKind(id) == "chat" }
            ?: error("createChatChannel failed")
    }

    fun createEvent(
        bearer: String,
        channelId: String,
        title: String = "e2e:test-title",
        whenMs: Long = System.currentTimeMillis() + 86_400_000L,
        id: String? = null,
    ): String {
        val payload = JSONObject()
            .put("channelId", channelId)
            .put("title", title)
            .put("when", whenMs)
            .put("where", "e2e:where")
            .put("details", "e2e:details")
        if (id != null) payload.put("id", id)
        val before = eventIds()
        rpc(bearer, "createEvent", payload)
        val created = (eventIds() - before).firstOrNull()
        if (created != null) return created
        if (id != null && eventIds().contains(id)) return id
        error("createEvent failed for channel=$channelId")
    }

    fun createShare(
        eventId: String,
        mode: String = "join",
        requirePass: Boolean = false,
        pass: String? = null,
        isPublic: Boolean = false,
        expiresAt: Long = 0L,
        displayTitle: String = "Shared event",
    ): String {
        val payload = JSONObject()
            .put("kind", "event")
            .put("refId", eventId)
            .put("mode", mode)
            .put("requirePass", requirePass)
            .put("public", isPublic)
            .put("expiresAt", expiresAt)
            .put("display", JSONObject().put("title", displayTitle).put("creator", "Host"))
            .put("enc", JSONObject().put("title", "e2e:shared-title"))
        if (pass != null) {
            payload.put("passHash", sha256Hex(pass))
        }
        val r = rpc(hostToken, "createShareLink", payload)
        val msgs = r.json?.optJSONArray("messages") ?: JSONArray()
        for (i in 0 until msgs.length()) {
            val m = msgs.optJSONObject(i) ?: continue
            if (m.optString("type") == "shareLink") return m.optString("id")
        }
        // Fall back: read data file for newest open share on this event.
        return findShareIdForEvent(eventId)
            ?: error("createShareLink produced no share id: ${r.body}")
    }

    fun joinShare(
        shareId: String,
        name: String,
        pass: String? = null,
        ageOk: Boolean = true,
        claim: Boolean = false,
        claimToken: String? = null,
        extraHeaders: Map<String, String> = emptyMap(),
    ): JSONObject {
        // First call without ageOk/name → invite preview; second completes join.
        val body = JSONObject()
            .put("s", shareId)
            .put("name", name)
            .put("ageOk", ageOk)
        if (pass != null) body.put("pass", pass)
        if (claim) body.put("claim", true)
        if (claimToken != null) body.put("claimToken", claimToken)
        val r = postJson("/ash-share-join", body, extraHeaders = extraHeaders)
        return r.json ?: JSONObject().put("type", "error").put("error", r.body)
    }

    fun revokeShare(shareId: String) {
        rpc(hostToken, "revokeShareLink", JSONObject().put("id", shareId))
    }

    fun setEdgeGate(enforce: Boolean, secret: String = edgeSecret, apex: String = "example.test") {
        server.setEdgeGate(secret, enforce, apex)
    }

    fun hostUserId(): String {
        // Snapshot via a no-op rpc drain: read data file users.
        val raw = dataFile.readText()
        val o = JSONObject(raw)
        val users = o.optJSONObject("users") ?: return ""
        val keys = users.keys()
        while (keys.hasNext()) {
            val tok = keys.next()
            val u = users.optJSONObject(tok) ?: continue
            if (u.optBoolean("isHost")) return u.optString("id")
        }
        return ""
    }

    private fun channelKind(id: String): String? {
        val arr = JSONObject(dataFile.readText()).optJSONArray("channels") ?: return null
        for (i in 0 until arr.length()) {
            val channel = arr.getJSONObject(i)
            if (channel.optString("id") == id) return channel.optString("kind")
        }
        return null
    }

    fun channelIds(): Set<String> {
        val o = JSONObject(dataFile.readText())
        val arr = o.optJSONArray("channels") ?: return emptySet()
        val out = mutableSetOf<String>()
        for (i in 0 until arr.length()) {
            out.add(arr.getJSONObject(i).optString("id"))
        }
        return out
    }

    fun eventIds(): Set<String> {
        val o = JSONObject(dataFile.readText())
        val arr = o.optJSONArray("events") ?: return emptySet()
        val out = mutableSetOf<String>()
        for (i in 0 until arr.length()) {
            out.add(arr.getJSONObject(i).optString("id"))
        }
        return out
    }

    fun findEvent(eventId: String): JSONObject? {
        val o = JSONObject(dataFile.readText())
        val arr = o.optJSONArray("events") ?: return null
        for (i in 0 until arr.length()) {
            val e = arr.getJSONObject(i)
            if (e.optString("id") == eventId) return e
        }
        return null
    }

    fun findShareIdForEvent(eventId: String): String? {
        val o = JSONObject(dataFile.readText())
        val arr = o.optJSONArray("shareLinks") ?: return null
        for (i in arr.length() - 1 downTo 0) {
            val s = arr.getJSONObject(i)
            if (s.optString("refId") == eventId && !s.optBoolean("closed")) return s.optString("id")
        }
        return null
    }

    fun findShare(shareId: String): JSONObject? {
        val o = JSONObject(dataFile.readText())
        val arr = o.optJSONArray("shareLinks") ?: return null
        for (i in 0 until arr.length()) {
            val s = arr.getJSONObject(i)
            if (s.optString("id") == shareId) return s
        }
        return null
    }

    fun messageCount(channelId: String): Int {
        val o = JSONObject(dataFile.readText())
        val msgs = o.optJSONObject("messages") ?: return 0
        val arr = msgs.optJSONArray(channelId) ?: return 0
        return arr.length()
    }

    fun reportCount(): Int {
        val o = JSONObject(dataFile.readText())
        return o.optJSONArray("reports")?.length() ?: 0
    }

    data class MemberSession(
        val token: String,
        val userId: String,
        val name: String,
        val role: String,
    )

    companion object {
        fun start(seed: Seed = Seed()): TestHost {
            val app = RuntimeEnvironment.getApplication()
            if (seed.rejectLog) {
                SecurityRejectLog.setEnabled(app, true)
                SecurityRejectLog.clear()
            }
            val dir = File(app.cacheDir, "host-tests-${UUID.randomUUID()}")
            dir.mkdirs()
            val dataFile = File(dir, "data_test.json")
            val srv = DrServer(
                port = 0,
                clientAssets = AssetManagerClientAssetSource(app.assets),
                dataFile = dataFile,
                serverPassphrase = "test-group-secret",
                atRest = null,
            )
            srv.setHostName(seed.hostName)
            srv.setEdgeGate(seed.edgeSecret, seed.edgeEnforce, seed.apexDomain)
            srv.start(0)
            val host = TestHost(srv, dataFile, seed.edgeSecret)
            host.hostToken = srv.mintHostUser("Host")
            // Touch HTTP session so subsequent RPCs see a live client queue.
            host.rpc(host.hostToken, "ping")
            return host
        }

        fun sha256Hex(s: String): String {
            val dig = MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8))
            return dig.joinToString("") { "%02x".format(it) }
        }

        /** Stable fingerprint string (≥16 chars) for join. */
        fun fp(label: String): String = "fp-${label.lowercase().padEnd(16, 'x').take(32)}"
    }
}

/** Robolectric Application stub — avoids AshApp side effects during unit tests. */
class HostTestApp : Application()
