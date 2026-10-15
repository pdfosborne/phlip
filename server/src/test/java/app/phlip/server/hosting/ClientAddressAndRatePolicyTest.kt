package app.phlip.server.hosting

import android.app.Application
import app.phlip.server.ClientAddressPolicy
import app.phlip.server.RATE_LOCK_MS
import app.phlip.server.RATE_LOCK_MS_LAN
import app.phlip.server.RATE_MAX_FAILS
import app.phlip.server.RATE_MAX_FAILS_LAN
import app.phlip.server.RateLimitPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class ClientAddressAndRatePolicyTest {

    @Test
    fun privateIpv4Classifications() {
        assertTrue(ClientAddressPolicy.isPrivateClientIp("127.0.0.1"))
        assertTrue(ClientAddressPolicy.isPrivateClientIp("10.0.0.5"))
        assertTrue(ClientAddressPolicy.isPrivateClientIp("192.168.1.10"))
        assertTrue(ClientAddressPolicy.isPrivateClientIp("172.16.0.1"))
        assertFalse(ClientAddressPolicy.isPrivateClientIp("8.8.8.8"))
        assertFalse(ClientAddressPolicy.isPrivateClientIp("?"))
        assertFalse(ClientAddressPolicy.isPrivateClientIp(""))
    }

    @Test
    fun privateIpv6UlaAndLoopback() {
        assertTrue(ClientAddressPolicy.isPrivateClientIp("::1"))
        assertTrue(ClientAddressPolicy.isPrivateClientIp("fc00::1"))
        assertTrue(ClientAddressPolicy.isPrivateClientIp("fd12:3456:789a::1"))
        assertFalse(ClientAddressPolicy.isPrivateClientIp("2001:4860:4860::8888"))
    }

    @Test
    fun spoofedForwardingHeadersIgnoredFromNonLoopback() {
        val headers = mapOf(
            "cf-connecting-ip" to "1.2.3.4",
            "x-forwarded-for" to "5.6.7.8",
        )
        assertEquals("203.0.113.9", ClientAddressPolicy.clientIp("203.0.113.9", headers))
    }

    @Test
    fun trustedForwardingFromLoopbackPeer() {
        assertEquals(
            "198.51.100.20",
            ClientAddressPolicy.clientIp("127.0.0.1", mapOf("cf-connecting-ip" to "198.51.100.20, 10.0.0.1")),
        )
        assertEquals(
            "198.51.100.21",
            ClientAddressPolicy.clientIp("127.0.0.1", mapOf("x-forwarded-for" to "198.51.100.21")),
        )
    }

    @Test
    fun directLanFalseWhenCloudflareHeadersPresent() {
        assertFalse(
            ClientAddressPolicy.isDirectLanRequest(
                "192.168.1.5",
                mapOf("cf-connecting-ip" to "1.2.3.4"),
            ),
        )
        assertFalse(
            ClientAddressPolicy.isDirectLanRequest(
                "192.168.1.5",
                mapOf("cf-ray" to "abc"),
            ),
        )
        assertTrue(ClientAddressPolicy.isDirectLanRequest("192.168.1.5", emptyMap()))
        assertTrue(ClientAddressPolicy.isDirectLanRequest("127.0.0.1", emptyMap()))
    }

    @Test
    fun passwordsEqualTimingSafe() {
        assertTrue(ClientAddressPolicy.passwordsEqual("secret", "secret"))
        assertFalse(ClientAddressPolicy.passwordsEqual("secret", "secre"))
        assertFalse(ClientAddressPolicy.passwordsEqual("a", "b"))
        assertTrue(ClientAddressPolicy.passwordsEqual("", ""))
    }

    @Test
    fun wanLockoutAfterMaxFails() {
        var now = 1_000_000L
        val map = ConcurrentHashMap<String, Pair<Int, Long>>()
        val policy = RateLimitPolicy(map, AtomicInteger(0)) { now }
        repeat(RATE_MAX_FAILS) { policy.bump("9.9.9.9", lan = false) }
        val err = policy.limitedError("9.9.9.9", lan = false)
        assertNotNull(err)
        assertTrue(err!!.optString("error").contains("minute", ignoreCase = true))
        now += RATE_LOCK_MS + 1
        assertNull(policy.limitedError("9.9.9.9", lan = false))
    }

    @Test
    fun lanLockoutUsesShorterCopyAndWindow() {
        var now = 1_000_000L
        val map = ConcurrentHashMap<String, Pair<Int, Long>>()
        val policy = RateLimitPolicy(map, AtomicInteger(0)) { now }
        repeat(RATE_MAX_FAILS_LAN) { policy.bump("192.168.0.2", lan = true) }
        val err = policy.limitedError("192.168.0.2", lan = true)
        assertNotNull(err)
        assertTrue(err!!.optString("error").contains("seconds", ignoreCase = true))
        now += RATE_LOCK_MS_LAN + 1
        assertNull(policy.limitedError("192.168.0.2", lan = true))
    }

    @Test
    fun clearRemovesLockoutBucket() {
        val map = ConcurrentHashMap<String, Pair<Int, Long>>()
        val policy = RateLimitPolicy(map, AtomicInteger(0))
        repeat(RATE_MAX_FAILS) { policy.bump("1.1.1.1", lan = false) }
        assertNotNull(policy.limitedError("1.1.1.1", lan = false))
        policy.clear("1.1.1.1")
        assertNull(policy.limitedError("1.1.1.1", lan = false))
    }

    @Test
    fun pollCapAccounting() {
        val polls = AtomicInteger(0)
        val policy = RateLimitPolicy(ConcurrentHashMap(), polls)
        repeat(80) { assertTrue(policy.tryBeginPoll()) }
        assertFalse(policy.tryBeginPoll())
        policy.endPoll()
        assertTrue(policy.tryBeginPoll())
    }
}
