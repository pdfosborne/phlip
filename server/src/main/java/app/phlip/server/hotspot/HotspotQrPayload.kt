package app.phlip.server.hotspot

/** Standard `WIFI:` QR URI for joining a WPA network (Android / iOS camera affordances). */
object HotspotQrPayload {
    fun wifiUri(ssid: String, password: String): String {
        val s = escapeWifiField(ssid)
        val p = escapeWifiField(password)
        return "WIFI:T:WPA;S:$s;P:$p;;"
    }

    internal fun escapeWifiField(value: String): String =
        buildString(value.length) {
            for (ch in value) {
                when (ch) {
                    '\\', ';', ':', ',' -> {
                        append('\\')
                        append(ch)
                    }
                    else -> append(ch)
                }
            }
        }
}
