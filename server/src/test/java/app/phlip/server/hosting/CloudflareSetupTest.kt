package app.phlip.server.hosting

import app.phlip.server.publichost.cloudflare.CloudflareApi
import app.phlip.server.publichost.cloudflare.CloudflareSetup
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.net.URLDecoder

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = HostTestApp::class)
class CloudflareSetupTest {
    private val domain = CloudflareSetup.Domain("zone1", "example.org", "account1", "active")
    private fun active() = JSONObject("""{"result":{"id":"token1","status":"active"}}""")
    private fun zones(name: String = "example.org", status: String = "active", pages: Int = 1) =
        JSONObject("""{"result":[{"id":"$name","name":"$name","status":"$status","account":{"id":"account1"}}],"result_info":{"total_pages":$pages}}""")
    private fun selectedZone() = zones().apply { getJSONArray("result").getJSONObject(0).put("id", domain.id) }
    private fun failure(block: () -> Unit): String {
        try { block(); fail("Expected failure") } catch (e: CloudflareApi.ApiException) { return e.message.orEmpty() }
        return ""
    }

    @Test fun loadsEveryPageAndRetainsPendingDomains() {
        val calls = mutableListOf<String>()
        val api = CloudflareSetup { _, path ->
            calls += path
            when {
                path == "/user/tokens/verify" -> active()
                path.endsWith("page=1") -> zones("z.org", pages = 2)
                else -> zones("a.org", "pending", 2)
            }
        }
        val result = api.inspect("test-token")
        assertEquals(listOf("a.org", "z.org"), result.domains.map { it.name })
        assertEquals("pending", result.domains.first().status)
        assertEquals(3, calls.size)
    }

    @Test fun emptyZonesIsAValidResult() {
        val api = CloudflareSetup { _, path -> if (path.endsWith("verify")) active() else JSONObject("""{"result":[]}""") }
        assertTrue(api.inspect("test-token").domains.isEmpty())
    }

    @Test fun inactiveAndInvalidTokensStopBeforeListingDomains() {
        var calls = 0
        val api = CloudflareSetup { _, _ -> calls++; active().apply { getJSONObject("result").put("status", "disabled") } }
        assertTrue(failure { api.inspect("test-token") }.contains("not active"))
        assertEquals(1, calls)
        val denied = CloudflareSetup { _, _ -> throw CloudflareApi.ApiException("denied", 403) }
        assertTrue(failure { denied.inspect("test-token") }.contains("could not be verified"))
    }

    @Test fun namesEachDeniedPermissionAndDoesNotMislabelRateLimits() {
        val permissions = linkedMapOf("/zones?" to "Zone → Read", "/cfd_tunnel" to "Cloudflare Tunnel", "/workers/scripts" to "Workers Scripts",
            "/storage/kv/" to "Workers KV Storage", "/workers/routes" to "Workers Routes", "/dns_records" to "DNS")
        permissions.forEach { (match, label) ->
            val api = CloudflareSetup { _, path ->
                when {
                    path.contains(match) -> throw CloudflareApi.ApiException("denied", 403)
                    path.endsWith("verify") -> active()
                    path.startsWith("/zones?") -> selectedZone()
                    else -> JSONObject("""{"result":[]}""")
                }
            }
            assertTrue(label, failure { api.checkAccess("test-token", domain) }.contains(label))
        }
        val limited = CloudflareSetup { _, _ -> throw CloudflareApi.ApiException("Try later", 429) }
        assertEquals("Try later", failure { limited.inspect("test-token") })
    }

    @Test fun rejectsDomainsRemovedFromScopeBeforeServiceChecks() {
        val calls = mutableListOf<String>()
        val api = CloudflareSetup { _, path -> calls += path; if (path.endsWith("verify")) active() else zones("other.org") }
        assertTrue(failure { api.checkAccess("test-token", domain) }.contains("no longer active"))
        assertEquals(2, calls.size)
    }

    @Test fun checksAllFiveServiceFamiliesWithSelectedScope() {
        val calls = mutableListOf<String>()
        val api = CloudflareSetup { _, path ->
            calls += path
            when {
                path.endsWith("verify") -> active()
                path.startsWith("/zones?") -> selectedZone()
                else -> JSONObject("""{"result":[]}""")
            }
        }
        api.checkAccess("test-token", domain)
        assertEquals(7, calls.size)
        assertEquals(3, calls.count { it.startsWith("/accounts/account1/") })
        assertEquals(2, calls.count { it.startsWith("/zones/zone1/") })
    }

    @Test fun templateIncludesZoneReadAlongsideFiveEditPermissions() {
        val value = CloudflareSetup.templateUrl().substringAfter("permissionGroupKeys=").substringBefore("&")
        val permissions = JSONArray(URLDecoder.decode(value, "UTF-8"))
        assertEquals(6, permissions.length())
        assertEquals("zone", permissions.getJSONObject(5).getString("key"))
        assertEquals("read", permissions.getJSONObject(5).getString("type"))
        assertTrue(CloudflareSetup.templateUrl().contains("accountId=*&zoneId=all"))
    }
}
