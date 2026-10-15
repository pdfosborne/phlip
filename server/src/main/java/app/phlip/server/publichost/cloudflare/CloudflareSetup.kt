package app.phlip.server.publichost.cloudflare

import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder

/** Read-only onboarding checks. Nothing is provisioned until the user connects a domain. */
class CloudflareSetup(
    private val get: (String, String) -> JSONObject = CloudflareApi::setupGet,
) {
    data class Domain(val id: String, val name: String, val accountId: String, val status: String)
    data class Verified(val tokenId: String, val domains: List<Domain>)

    fun inspect(token: String): Verified {
        val verified = try { get(token, "/user/tokens/verify").getJSONObject("result") }
        catch (e: CloudflareApi.ApiException) {
            if (e.statusCode == 401 || e.statusCode == 403) throw CloudflareApi.ApiException("This token could not be verified. Copy an active user API token from Cloudflare.")
            throw e
        }
        if (verified.optString("status") != "active") throw CloudflareApi.ApiException("This token is not active. Create a new token in Cloudflare.")
        val domains = mutableListOf<Domain>()
        var page = 1
        do {
            val root = probe(token, "/zones?per_page=50&page=$page", "Zone → Read")
            val arr = root.optJSONArray("result") ?: throw CloudflareApi.ApiException("Cloudflare did not return a domain list. Try again.")
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val account = o.optJSONObject("account")?.optString("id").orEmpty()
                if (account.isNotBlank()) domains += Domain(o.getString("id"), o.getString("name"), account, o.optString("status"))
            }
            val pages = root.optJSONObject("result_info")?.optInt("total_pages", page) ?: page
            page++
        } while (page <= pages)
        return Verified(verified.getString("id"), domains.distinctBy { it.id }.sortedBy { it.name })
    }

    fun checkAccess(token: String, domain: Domain) {
        if (inspect(token).domains.none { it == domain && it.status == "active" }) {
            throw CloudflareApi.ApiException("This domain is no longer active or included in the token’s scope. Refresh the domain list and choose it again.")
        }
        val account = enc(domain.accountId)
        val zone = enc(domain.id)
        // Lists exercise each permission family without creating/deleting test resources.
        // A successful read does not prove Edit; the actual writes remain authoritative.
        probe(token, "/accounts/$account/cfd_tunnel?is_deleted=false&per_page=1", "Account → Cloudflare Tunnel → Edit")
        probe(token, "/accounts/$account/workers/scripts", "Account → Workers Scripts → Edit")
        probe(token, "/accounts/$account/storage/kv/namespaces?per_page=10", "Account → Workers KV Storage → Edit")
        probe(token, "/zones/$zone/workers/routes", "Zone → Workers Routes → Edit")
        probe(token, "/zones/$zone/dns_records?per_page=5", "Zone → DNS → Edit")
    }

    private fun probe(token: String, path: String, permission: String): JSONObject = try { get(token, path) }
    catch (e: CloudflareApi.ApiException) {
        if (e.statusCode == 401 || e.statusCode == 403) {
            throw CloudflareApi.ApiException("Access denied for $permission. Check this permission and the selected account/domain scope in Cloudflare.", e.statusCode)
        }
        throw e
    }

    companion object {
        // User-token templates: documented keys plus Tunnel's historical dashboard key.
        // Enabled so a signed-in dashboard can confirm Tunnel → Edit appears in the prefilled form.
        const val TEMPLATE_TUNNEL_VERIFIED = true
        const val TOKENS_URL = "https://dash.cloudflare.com/profile/api-tokens"
        const val ADD_DOMAIN_URL = "https://dash.cloudflare.com/"
        fun templateUrl(): String {
            val permissions = JSONArray()
            listOf("argotunnel", "workers_scripts", "workers_kv_storage", "workers_routes", "dns").forEach {
                permissions.put(JSONObject().put("key", it).put("type", "edit"))
            }
            permissions.put(JSONObject().put("key", "zone").put("type", "read"))
            return "$TOKENS_URL?permissionGroupKeys=${enc(permissions.toString())}&accountId=*&zoneId=all&name=Phlip%20Server"
        }
        private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
        const val PERMISSION_COPY = "Account: Cloudflare Tunnel, Workers Scripts and Workers KV Storage — Edit.\n\nZone: DNS and Workers Routes — Edit; Zone — Read (to list your domains).\n\nThe initial token covers all accounts and zones you can access. You can restrict it to your selected account and domain in Cloudflare."
    }
}
