package app.phlip.server

import android.content.Context
import app.phlip.core.security.SecureStore
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.SecureRandom

/** One server this device hosts. The passphrase is a host-side secret (it builds
 *  invite codes and lets the host's own bridged client decrypt) — it is never sent
 *  to the DrServer, which only ever holds the non-secret PBKDF2 salt.
 *
 *  On disk (`servers.json`) [passphrase] is Keystore-sealed (`ks:…`); in memory it
 *  stays plaintext for DrServer / WebView bridge. See E2E-ENCRYPTION.md §1.1.
 *
 *  [joinTag] is a stable 4-character id used in shareable invites (`TAG-XXXXXX`).
 *  [publicSubdomain] optional DNS label for named Cloudflare hosting
 *  (empty → derived from [name] / [joinTag]).
 *
 *  [reachMode] near-field path: [REACH_DEVICE] (this phone only), [REACH_LOCAL]
 *  (STA Wi‑Fi), or [REACH_DIRECT] (phone Soft-AP only). Mutually exclusive. */
data class HostedServer(
    val id: String,
    var name: String,
    val port: Int,
    val dataFile: String,
    var passphrase: String,
    var isPublic: Boolean,
    var joinTag: String,
    var publicSubdomain: String = "",
    /** `device` | `local` | `direct`. Missing JSON still loads as local. */
    var reachMode: String = "local",
) {
    fun isDirectReach(): Boolean = reachMode.equals(ServerRegistry.REACH_DIRECT, ignoreCase = true)
    fun isDeviceOnly(): Boolean = reachMode.equals(ServerRegistry.REACH_DEVICE, ignoreCase = true)
    /** Loopback bind for device-only; null means all interfaces. */
    fun bindHost(): String? = if (isDeviceOnly()) "127.0.0.1" else null
}

/** Persistent list of hosted servers (filesDir/servers.json). One device can host
 *  several independent servers; each maps to its own DrServer instance + data file. */
class ServerRegistry(private val ctx: Context) {

    private val file = File(ctx.filesDir, FILE_NAME)
    private val servers = mutableListOf<HostedServer>()
    private val rng = SecureRandom()
    private val atRest: SecureStore by lazy { SecureStore.hostAtRest(ctx) }

    init { load(); migrateLegacy(); ensureJoinTags() }

    fun all(): List<HostedServer> = servers.toList()
    fun get(id: String): HostedServer? = servers.find { it.id == id }
    fun publicServer(): HostedServer? = servers.find { it.isPublic }
    /** Every server currently marked Public (may be several — each has its own subdomain). */
    fun publicServers(): List<HostedServer> = servers.filter { it.isPublic }
    fun isEmpty(): Boolean = servers.isEmpty()

    fun add(name: String, passphrase: String, reachMode: String = REACH_DEVICE): HostedServer {
        val id = genId()
        val s = HostedServer(
            id, name.ifBlank { "My server" }, nextPort(), "data_$id.json",
            passphrase, false, genJoinTag(),
            reachMode = normalizeReachMode(reachMode),
        )
        servers.add(s); save()
        return s
    }

    fun remove(id: String) {
        val s = servers.find { it.id == id } ?: return
        servers.remove(s)
        try { File(ctx.filesDir, s.dataFile).delete() } catch (_: Exception) {}
        save()
    }

    /** Toggle Public for one server. Multiple servers may be Public at once
     *  (each gets its own Cloudflare subdomain → local port ingress). */
    fun setPublic(id: String, public: Boolean) {
        servers.find { it.id == id }?.isPublic = public
        save()
    }

    /** Lock near-field reach to On this device, Local STA Wi‑Fi, or Direct Soft-AP. */
    fun setReachMode(id: String, mode: String): Boolean {
        val s = servers.find { it.id == id } ?: return false
        val normalized = normalizeReachMode(mode)
        if (s.reachMode == normalized) return true
        s.reachMode = normalized
        save()
        return true
    }

    /**
     * Insert or update a hosted server row for full backup restore.
     * Keeps existing port / dataFile when [id] already exists. Never auto-enables Public.
     */
    fun importOrReplace(
        id: String,
        name: String,
        passphrase: String,
        joinTag: String,
        reachMode: String = REACH_LOCAL,
        publicSubdomain: String = "",
    ): HostedServer {
        require(id.isNotBlank()) { "server id required" }
        val existing = get(id)
        val mode = normalizeReachMode(reachMode)
        val tag = if (joinTag.length == 4) joinTag.uppercase() else genJoinTag()
        if (existing != null) {
            existing.name = name.ifBlank { existing.name }
            existing.passphrase = passphrase
            existing.joinTag = tag
            existing.reachMode = mode
            existing.publicSubdomain = publicSubdomain.trim().lowercase()
            existing.isPublic = false
            save()
            return existing
        }
        val s = HostedServer(
            id = id,
            name = name.ifBlank { "Restored server" },
            port = nextPort(),
            dataFile = "data_$id.json",
            passphrase = passphrase,
            isPublic = false,
            joinTag = tag,
            publicSubdomain = publicSubdomain.trim().lowercase(),
            reachMode = mode,
        )
        servers.add(s)
        save()
        return s
    }

    fun save() {
        val arr = JSONArray()
        for (s in servers) {
            val sealedPass = atRest.seal(s.passphrase)
            // Fail closed: never rewrite servers.json without a sealed secret.
            if (s.passphrase.isNotEmpty() && sealedPass.isEmpty()) {
                android.util.Log.e("AshRegistry", "seal failed for server ${s.id}; skipping save")
                return
            }
            arr.put(JSONObject()
                .put("id", s.id).put("name", s.name).put("port", s.port)
                .put("dataFile", s.dataFile).put("passphrase", sealedPass)
                .put("isPublic", s.isPublic).put("joinTag", s.joinTag)
                .put("publicSubdomain", s.publicSubdomain)
                .put("reachMode", s.reachMode))
        }
        try { file.writeText(arr.toString()) } catch (_: Exception) {}
    }

    private fun load() {
        if (!file.exists()) return
        var needsReseal = false
        try {
            val arr = JSONArray(file.readText())
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val rawPass = o.optString("passphrase")
                if (rawPass.isNotEmpty() && !SecureStore.isSealedBlob(rawPass)) needsReseal = true
                val pass = atRest.open(rawPass)
                val mode = normalizeReachMode(o.optString("reachMode"))
                servers.add(HostedServer(
                    o.getString("id"), o.getString("name"), o.getInt("port"),
                    o.getString("dataFile"), pass, o.optBoolean("isPublic"),
                    o.optString("joinTag").ifBlank { "" },
                    o.optString("publicSubdomain").trim().lowercase(),
                    reachMode = mode,
                ))
            }
        } catch (_: Exception) {}
        if (needsReseal && servers.isNotEmpty()) save()
    }

    private fun ensureJoinTags() {
        var dirty = false
        val used = servers.map { it.joinTag.uppercase() }.filter { it.length == 4 }.toMutableSet()
        for (s in servers) {
            if (s.joinTag.length == 4) continue
            var tag: String
            do { tag = genJoinTag() } while (tag in used)
            s.joinTag = tag
            used.add(tag)
            dirty = true
        }
        if (dirty) save()
    }

    /** Fold a pre-multi-server single host into the registry the first time this
     *  build runs: its data.json becomes "server #0" with the fixed id "host" so it
     *  keeps bridging into the client rail as the unchanged "srv-local-host". */
    private fun migrateLegacy() {
        if (servers.isNotEmpty()) return
        val legacy = File(ctx.filesDir, "data.json")
        if (!legacy.exists()) return
        val prefs = ctx.getSharedPreferences("dp_host_prefs", Context.MODE_PRIVATE)
        val pass = prefs.getString("host_pass", "") ?: ""
        servers.add(HostedServer("host", "My server", 3000, "data.json", pass, false, genJoinTag()))
        save()
        // Drop legacy plaintext once sealed into servers.json.
        if (pass.isNotEmpty()) prefs.edit().remove("host_pass").apply()
    }

    private fun nextPort(): Int {
        val used = servers.map { it.port }.toSet()
        var p = BASE_PORT
        while (p in used) p++
        return p
    }

    private fun genId(): String {
        val b = ByteArray(6); rng.nextBytes(b)
        return b.joinToString("") { "%02x".format(it) }
    }

    /** Stable 4-char public join id (no ambiguous 0/O/1/I). */
    private fun genJoinTag(): String {
        val b = ByteArray(4); rng.nextBytes(b)
        return b.joinToString("") { JOIN_ALPHABET[(it.toInt() and 0xff) % JOIN_ALPHABET.length].toString() }
    }

    companion object {
        private const val FILE_NAME = "servers.json"
        const val BASE_PORT = 3000
        const val REACH_DEVICE = "device"
        const val REACH_LOCAL = "local"
        const val REACH_DIRECT = "direct"

        /** Missing or unknown JSON still loads as Local (no migration). */
        fun normalizeReachMode(mode: String?): String {
            return when (mode?.trim()?.lowercase()) {
                REACH_DEVICE -> REACH_DEVICE
                REACH_DIRECT -> REACH_DIRECT
                REACH_LOCAL -> REACH_LOCAL
                else -> REACH_LOCAL
            }
        }
        /** Unambiguous alphabet for typed invite tags/codes. */
        const val JOIN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        /** Client rail id for a hosted server — matches the prefix ashSyncServers reconciles on. */
        fun bridgeId(serverId: String) = "srv-local-$serverId"

        /** `XXXXXX` — rotating invite only (legacy TAG-XXXXXX still accepted when parsing). */
        fun formatInvite(joinTag: String, inviteCode: String): String {
            val code = inviteCode.trim().uppercase().replace("-", "")
            return code.ifEmpty { joinTag.trim().uppercase() }
        }
    }
}
