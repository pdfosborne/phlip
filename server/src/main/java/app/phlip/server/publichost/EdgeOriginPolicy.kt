package app.phlip.server.publichost

import fi.iki.elonen.NanoHTTPD
import org.json.JSONObject
import java.security.MessageDigest

/**
 * Edge-origin gate: Cloudflare-looking / public-apex traffic must carry
 * `X-Phlip-Edge`, and public Broadcast endpoints stay Worker-only when enforce is on.
 */
internal object EdgeOriginPolicy {

    /**
     * When edge enforce is on, traffic that looks Cloudflare-proxied (or Host
     * matches the public apex) must carry `X-Phlip-Edge`. Loopback / plain LAN
     * is never blocked so local hosting keeps working without a Worker.
     */
    fun rejectIfEdgeGateFails(
        session: NanoHTTPD.IHTTPSession,
        edgeEnforce: Boolean,
        edgeSecret: String,
        publicApex: String,
        noteReject: (path: String, reason: String, detail: String) -> Unit,
        jsonResponse: (NanoHTTPD.Response.Status, JSONObject) -> NanoHTTPD.Response,
    ): NanoHTTPD.Response? {
        if (!edgeEnforce || edgeSecret.isEmpty()) return null
        val headers = session.headers ?: emptyMap()
        fun hdrLocal(name: String) =
            headers.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value.orEmpty()
        val host = hdrLocal("host").substringBefore(':').lowercase()
        val viaCf = hdrLocal("cf-connecting-ip").isNotEmpty() || hdrLocal("cf-ray").isNotEmpty()
        val looksPublic = viaCf ||
            (publicApex.isNotEmpty() && (host == publicApex || host.endsWith(".$publicApex")))
        if (!looksPublic) return null
        val got = hdrLocal("x-phlip-edge")
        if (got.isNotEmpty() && MessageDigest.isEqual(
                got.toByteArray(Charsets.UTF_8),
                edgeSecret.toByteArray(Charsets.UTF_8),
            )
        ) return null
        noteReject(session.uri.split("?")[0], "edge_gate", "missing or bad X-Phlip-Edge")
        return jsonResponse(
            NanoHTTPD.Response.Status.FORBIDDEN,
            JSONObject().put("type", "error").put("error", "Forbidden"),
        )
    }

}
