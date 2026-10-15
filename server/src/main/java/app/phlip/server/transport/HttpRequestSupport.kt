package app.phlip.server

import fi.iki.elonen.NanoHTTPD
import org.json.JSONObject

/**
 * Shared HTTP request/response helpers for member and share gateways:
 * JSON body parse, Content-Length gate, bearer/pass extract, reject logging.
 */
internal class HttpRequestSupport(
    private val hostNameProvider: () -> String,
) {
    fun jsonResponse(status: NanoHTTPD.Response.Status, body: JSONObject): NanoHTTPD.Response {
        val r = NanoHTTPD.newFixedLengthResponse(
            status,
            "application/json; charset=UTF-8",
            body.toString(),
        )
        return HttpResponsePolicy.close(r)
    }

    /** NanoHTTPD 2.3 defaults missing charset to US-ASCII, which turns UTF-8
     *  emoji (reactions) into U+FFFD replacement characters. Force UTF-8 for
     *  JSON (and form) bodies before parseBody reads them. */
    fun ensureUtf8BodyCharset(session: NanoHTTPD.IHTTPSession) {
        val headers = session.headers ?: return
        val ct = headers["content-type"] ?: return
        if (ct.contains("charset=", ignoreCase = true)) return
        if (ct.contains("json", ignoreCase = true) ||
            ct.contains("application/x-www-form-urlencoded", ignoreCase = true) ||
            ct.contains("text/", ignoreCase = true)
        ) {
            headers["content-type"] = "$ct; charset=UTF-8"
        }
    }

    /**
     * Read a JSON POST body through NanoHTTPD. Cloudflare tunnels sometimes
     * deliver bodies in ways parseBody alone mishandles (missing postData,
     * charset quirks, truncated reads). Fall back to form fields and the
     * raw queryParameterString when needed.
     */
    fun readJsonBody(session: NanoHTTPD.IHTTPSession): JSONObject? {
        val tooBig = rejectIfBodyTooLarge(session)
        if (tooBig != null) return null
        ensureUtf8BodyCharset(session)
        val files = HashMap<String, String>()
        var parseErr: Exception? = null
        try {
            session.parseBody(files)
        } catch (e: Exception) {
            parseErr = e
            android.util.Log.w("AshHttp", "parseBody failed: ${e.javaClass.simpleName}: ${e.message}")
        }

        // Defense in depth if Content-Length was missing/wrong.
        val post = files["postData"]
        if (post != null && post.length > MAX_REQUEST_BODY) return null

        val candidates = ArrayList<String>()
        post?.let { candidates.add(it) }
        // Some NanoHTTPD paths leave a JSON body here even for POST.
        session.queryParameterString?.let { q ->
            val t = q.trim()
            if (t.startsWith("{") || t.startsWith("%7B") || t.startsWith("%7b")) candidates.add(q)
        }

        for (raw in candidates) {
            val text = decodeMaybeUrl(raw).trim().removePrefix("\uFEFF")
            if (text.isEmpty()) continue
            if (text.length > MAX_REQUEST_BODY) return null
            try {
                return JSONObject(text)
            } catch (e: Exception) {
                android.util.Log.w("AshHttp", "JSON parse failed (${text.take(96)}): ${e.message}")
            }
        }

        // application/x-www-form-urlencoded fallback (client retries use this).
        val parms = session.parms
        if (parms.isNotEmpty() && (
                parms.containsKey("invite") || parms.containsKey("name") ||
                    parms.containsKey("fingerprint") || parms.containsKey("authVerifier") ||
                    parms.containsKey("pass") || parms.containsKey("token") || parms.containsKey("type")
                )
        ) {
            val o = JSONObject()
            for ((k, v) in parms) if (k != null && v != null) o.put(k, v)
            return o
        }

        if (parseErr != null) return null
        // Truly empty body — let the caller report missing fields, not "Bad JSON".
        return JSONObject()
    }

    /** Reject oversized POSTs before NanoHTTPD buffers them into memory. */
    fun rejectIfBodyTooLarge(session: NanoHTTPD.IHTTPSession): NanoHTTPD.Response? {
        val cl = session.headers["content-length"]?.toLongOrNull() ?: return null
        if (cl <= MAX_REQUEST_BODY) return null
        noteReject(session.uri.split("?")[0], "body_too_large", "len=$cl")
        return jsonResponse(
            NanoHTTPD.Response.Status.BAD_REQUEST,
            JSONObject().put("type", "error").put("error", "Request too large."),
        )
    }

    fun decodeMaybeUrl(raw: String): String {
        if (!raw.contains('%')) return raw
        return try {
            java.net.URLDecoder.decode(raw, "UTF-8")
        } catch (_: Exception) {
            raw
        }
    }

    fun requestPass(session: NanoHTTPD.IHTTPSession): String {
        val headers = session.headers ?: emptyMap()
        val hdr = headers.entries.firstOrNull { it.key.equals("x-ash-pass", ignoreCase = true) }?.value
        if (!hdr.isNullOrEmpty()) return hdr
        return session.parms["pass"] ?: ""
    }

    fun requestToken(session: NanoHTTPD.IHTTPSession): String {
        val headers = session.headers ?: emptyMap()
        val hdr = headers.entries.firstOrNull { it.key.equals("x-ash-token", ignoreCase = true) }?.value?.trim()
        if (!hdr.isNullOrEmpty()) return hdr
        val q = session.parms["token"]?.trim().orEmpty()
        if (q.isNotEmpty()) {
            noteReject(session.uri.split("?")[0], "token_in_query", "prefer X-Ash-Token header")
        }
        return q
    }

    fun noteReject(path: String, reason: String, detail: String = "") {
        SecurityRejectLog.record(hostNameProvider(), path, reason, detail)
    }
}
