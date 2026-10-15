package app.phlip.server.publichost.cloudflare

import android.content.Context
import android.content.SharedPreferences
import app.phlip.core.security.SecureStore

/**
 * Cloudflare account settings for permanent public hosting.
 * One domain → many Phlip servers as subdomains (e.g. `home.example.com` from server name "Home").
 */
class CloudflarePrefs(ctx: Context) {

    private val appCtx = ctx.applicationContext

    private val plain: SharedPreferences =
        appCtx.getSharedPreferences(PREFS_PLAIN, Context.MODE_PRIVATE)

    private val secure: SecureStore by lazy {
        SecureStore(appCtx, PREFS_SECURE, KEY_ALIAS)
    }

    var operatorAcknowledged: Boolean
        get() = plain.getBoolean(KEY_OPERATOR_ACK, false)
        set(v) = plain.edit().putBoolean(KEY_OPERATOR_ACK, v).apply()

    var dataDisclosureAcknowledged: Boolean
        get() = plain.getBoolean(KEY_DATA_ACK, false)
        set(v) = plain.edit().putBoolean(KEY_DATA_ACK, v).apply()

    /** Explicit “YES I UNDERSTAND RISK” before any server can go Public. */
    var publicRiskAcknowledged: Boolean
        get() = plain.getBoolean(KEY_PUBLIC_RISK_ACK, false)
        set(v) = plain.edit().putBoolean(KEY_PUBLIC_RISK_ACK, v).apply()

    /** Apex domain on Cloudflare, e.g. `example.com`. */
    var domain: String
        get() = plain.getString(KEY_DOMAIN, "") ?: ""
        set(v) = plain.edit().putString(KEY_DOMAIN, v.trim().lowercase()).apply()

    /** Cloudflare account id (from API automation). */
    var accountId: String
        get() = plain.getString(KEY_ACCOUNT, "") ?: ""
        set(v) = plain.edit().putString(KEY_ACCOUNT, v.trim()).apply()

    var zoneId: String
        get() = plain.getString(KEY_ZONE, "") ?: ""
        set(v) = plain.edit().putString(KEY_ZONE, v.trim()).apply()

    var tunnelId: String
        get() = plain.getString(KEY_TUNNEL_ID, "") ?: ""
        set(v) = plain.edit().putString(KEY_TUNNEL_ID, v.trim()).apply()

    /** Tunnel run token — never log. */
    var tunnelToken: String
        get() = secure.getString(KEY_TUNNEL_TOKEN)
        set(v) = secure.putString(KEY_TUNNEL_TOKEN, v.trim())

    /**
     * API token for setup + publishing DNS/ingress when a server goes Public.
     * Stored encrypted; required for automatic permanent hosting.
     */
    var apiToken: String
        get() = secure.getString(KEY_API_TOKEN)
        set(v) = secure.putString(KEY_API_TOKEN, v.trim())

    /**
     * Shared secret the edge Worker must send as `X-Phlip-Edge`. Empty until
     * generated. See `feature-planning/cloudflare-edge-gate.md`.
     */
    var edgeSecret: String
        get() = secure.getString(KEY_EDGE_SECRET)
        set(v) = secure.putString(KEY_EDGE_SECRET, v.trim())

    /**
     * When true, [DrServer] rejects Cloudflare-looking requests without the edge
     * header. Set true after Worker provision/verify succeeds.
     */
    var edgeEnforce: Boolean
        get() = plain.getBoolean(KEY_EDGE_ENFORCE, false)
        set(v) = plain.edit().putBoolean(KEY_EDGE_ENFORCE, v).apply()

    /** Unguessable origin hostname (`o-….apex`) — tunnel only; never in join codes. */
    var originHostname: String
        get() = plain.getString(KEY_ORIGIN_HOST, "") ?: ""
        set(v) = plain.edit().putString(KEY_ORIGIN_HOST, v.trim().lowercase()).apply()

    var kvNamespaceId: String
        get() = plain.getString(KEY_KV_NS, "") ?: ""
        set(v) = plain.edit().putString(KEY_KV_NS, v.trim()).apply()

    /** True after Worker + KV + origin have been provisioned at least once. */
    var edgeProvisioned: Boolean
        get() = plain.getBoolean(KEY_EDGE_PROVISIONED, false)
        set(v) = plain.edit().putBoolean(KEY_EDGE_PROVISIONED, v).apply()

    /** Host→Worker sync secret (`X-Phlip-Host-Sync`). Defaults to edge secret. */
    var hostSyncSecret: String
        get() = secure.getString(KEY_HOST_SYNC).ifBlank { edgeSecret }
        set(v) = secure.putString(KEY_HOST_SYNC, v.trim())

    /**
     * Host-confirmed Cloudflare Workers plan for public Broadcast KV budgeting.
     * Default Free — Paid must be set after upgrading in the Cloudflare dashboard.
     * Values: [PLAN_FREE] or [PLAN_PAID].
     */
    var workersPlan: String
        get() {
            val v = (plain.getString(KEY_WORKERS_PLAN, PLAN_FREE) ?: PLAN_FREE).trim().lowercase()
            return if (v == PLAN_PAID) PLAN_PAID else PLAN_FREE
        }
        set(v) = plain.edit().putString(
            KEY_WORKERS_PLAN,
            if (v.trim().lowercase() == PLAN_PAID) PLAN_PAID else PLAN_FREE,
        ).apply()

    val workersPlanPaid: Boolean get() = workersPlan == PLAN_PAID

    /**
     * Opt-in Worker relay cache: host pushes encrypted welcome snapshots so
     * members can read when the phone is unreachable. Default off (KV budget).
     */
    var relayCacheEnabled: Boolean
        get() = plain.getBoolean(KEY_RELAY_CACHE, false)
        set(v) = plain.edit().putBoolean(KEY_RELAY_CACHE, v).apply()

    /** Monotonic relay push sequence per public hostname. */
    fun relaySeqFor(hostname: String): Long {
        val host = hostname.trim().lowercase()
        if (host.isEmpty()) return 0L
        return plain.getLong(KEY_RELAY_SEQ_PREFIX + host, 0L)
    }

    fun bumpRelaySeq(hostname: String): Long {
        val host = hostname.trim().lowercase()
        if (host.isEmpty()) return 0L
        val next = relaySeqFor(host) + 1L
        plain.edit().putLong(KEY_RELAY_SEQ_PREFIX + host, next).apply()
        return next
    }

    /** Ensure an edge secret exists (32 random bytes, hex). Does not enable enforce. */
    fun ensureEdgeSecret(): String {
        val existing = edgeSecret
        if (existing.isNotEmpty()) return existing
        val bytes = ByteArray(32).also { java.security.SecureRandom().nextBytes(it) }
        val hex = bytes.joinToString("") { b -> "%02x".format(b) }
        edgeSecret = hex
        return hex
    }

    fun clearSecrets() {
        secure.remove(KEY_TUNNEL_TOKEN)
        secure.remove(KEY_API_TOKEN)
        secure.remove(KEY_EDGE_SECRET)
        secure.remove(KEY_HOST_SYNC)
        edgeEnforce = false
        edgeProvisioned = false
        originHostname = ""
        kvNamespaceId = ""
    }

    fun clearAll() {
        clearSecrets()
        plain.edit().clear().apply()
    }

    fun hasNamedTunnel(): Boolean =
        tunnelToken.isNotBlank() && domain.isNotBlank()

    /**
     * Public hostname for a server: `<slug>.<domain>`.
     * Slug comes from the server/group name (e.g. "Home" → `home.pitchplanserver.com`),
     * falling back to the join tag if the name can't form a DNS label.
     */
    fun hostnameFor(serverName: String, fallbackTag: String = "", customSubdomain: String = ""): String {
        val apex = domain.trim().lowercase()
        if (apex.isEmpty()) return ""
        val sub = customSubdomain.trim().lowercase().ifEmpty {
            subdomainLabel(serverName, fallbackTag)
        }
        return "$sub.$apex"
    }

    companion object {
        private const val PREFS_PLAIN = "ash_cloudflare"
        private const val PREFS_SECURE = "ash_cloudflare_secure_v2"
        private const val KEY_ALIAS = "ash_cloudflare_secure_key"
        private const val KEY_OPERATOR_ACK = "operator_ack"
        private const val KEY_DATA_ACK = "data_ack"
        private const val KEY_PUBLIC_RISK_ACK = "public_risk_ack"
        private const val KEY_DOMAIN = "domain"
        private const val KEY_ACCOUNT = "account_id"
        private const val KEY_ZONE = "zone_id"
        private const val KEY_TUNNEL_ID = "tunnel_id"
        private const val KEY_TUNNEL_TOKEN = "tunnel_token"
        private const val KEY_API_TOKEN = "api_token"
        private const val KEY_EDGE_SECRET = "edge_secret"
        private const val KEY_EDGE_ENFORCE = "edge_enforce"
        private const val KEY_ORIGIN_HOST = "origin_hostname"
        private const val KEY_KV_NS = "kv_namespace_id"
        private const val KEY_EDGE_PROVISIONED = "edge_provisioned"
        private const val KEY_HOST_SYNC = "host_sync_secret"
        private const val KEY_WORKERS_PLAN = "workers_plan"
        private const val KEY_RELAY_CACHE = "relay_cache_enabled"
        private const val KEY_RELAY_SEQ_PREFIX = "relay_seq_"

        const val PLAN_FREE = "free"
        const val PLAN_PAID = "paid"

        /** DNS label from server name: "Public Test" → `public-test`. */
        fun subdomainLabel(serverName: String, fallbackTag: String = ""): String {
            val fromName = normalizeSubdomainInput(serverName)
            if (fromName.isNotEmpty()) return fromName
            val tag = normalizeSubdomainInput(fallbackTag)
            return tag.ifEmpty { "server" }
        }

        /**
         * Sanitize a host-typed subdomain. Letters, digits, hyphens only;
         * max 63 chars; must start and end with alphanumeric. Empty if invalid.
         */
        fun normalizeSubdomainInput(raw: String): String {
            val s = raw.trim().lowercase()
                .replace(Regex("[^a-z0-9]+"), "-")
                .trim('-')
                .take(63)
            if (s.isEmpty() || !s.first().isLetterOrDigit() || !s.last().isLetterOrDigit()) return ""
            return s
        }
    }
}
