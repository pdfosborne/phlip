package app.phlip.server.hotspot

/** Live direct-hotspot session metadata exposed to host UI / bridge. */
data class HotspotSessionInfo(
    val serverId: String,
    val serverName: String,
    val ssid: String,
    val password: String,
    val qrUri: String,
    val gatewayIp: String,
    val lanUrl: String,
    val joinCode: String,
    val startedAt: Long,
    /** False when Soft-AP radio died (e.g. host joined STA Wi‑Fi) while Direct is still desired. */
    val radioLive: Boolean = true,
    val radioNote: String = "",
)

sealed class HotspotStartResult {
    data class Started(val info: HotspotSessionInfo) : HotspotStartResult()
    data class Failed(val error: String) : HotspotStartResult()
}
