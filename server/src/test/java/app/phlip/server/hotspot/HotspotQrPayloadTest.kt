package app.phlip.server.hotspot

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HotspotQrPayloadTest {
    @Test
    fun wifiUri_basicWpaNetwork() {
        val uri = HotspotQrPayload.wifiUri("Phlip-Session", "secret-pass")
        assertEquals("WIFI:T:WPA;S:Phlip-Session;P:secret-pass;;", uri)
    }

    @Test
    fun wifiUri_escapesSpecialCharacters() {
        val uri = HotspotQrPayload.wifiUri("Cafe;Net", "p;ss\\word")
        assertEquals("WIFI:T:WPA;S:Cafe\\;Net;P:p\\;ss\\\\word;;", uri)
    }

    @Test
    fun escapeWifiField_doesNotAlterPlainText() {
        assertEquals("plain-ssid", HotspotQrPayload.escapeWifiField("plain-ssid"))
    }

    @Test
    fun hotspotSessionInfo_fields() {
        val info = HotspotSessionInfo(
            serverId = "abc",
            serverName = "Friends",
            ssid = "AndroidShare_1234",
            password = "xyzzy",
            qrUri = HotspotQrPayload.wifiUri("AndroidShare_1234", "xyzzy"),
            gatewayIp = "192.168.43.1",
            lanUrl = "http://192.168.43.1:3000",
            joinCode = "ABCD12",
            startedAt = 1L,
        )
        assertEquals("abc", info.serverId)
        assertFalse(info.qrUri.isEmpty())
        assertEquals("http://192.168.43.1:3000", info.lanUrl)
    }

    @Test
    fun hotspotStartResult_failedCarriesMessage() {
        val failed = HotspotStartResult.Failed("End the current direct session first")
        assertTrue(failed is HotspotStartResult.Failed)
        assertEquals("End the current direct session first", failed.error)
    }
}
