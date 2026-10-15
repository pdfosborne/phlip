package app.phlip.server.hosting

import app.phlip.server.DrServer
import app.phlip.server.HostService
import app.phlip.server.HostedServer
import app.phlip.server.PendingInfo
import app.phlip.server.ServerRegistry
import app.phlip.server.hotspot.HotspotSessionCoordinator
import app.phlip.server.local.ApprovedNetworks
import app.phlip.server.local.LocalHostingCoordinator
import app.phlip.server.local.ShareReachPublisher
import app.phlip.server.personalInviteUrlFor
import app.phlip.server.publichost.PublicHostingCoordinator
import java.net.NetworkInterface
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
/**
 * Assembles [HostService.ServerStatus] / [HostService.BridgeInfo] and fans out
 * status listeners.
 */
internal class HostStatusPublisher(
    private val registry: ServerRegistry,
    private val servers: ConcurrentHashMap<String, DrServer>,
    private val pendingByServer: ConcurrentHashMap<String, List<PendingInfo>>,
    private val localHosting: LocalHostingCoordinator,
    private val publicHosting: PublicHostingCoordinator,
    private val hotspotSession: HotspotSessionCoordinator,
    private val isLanBroadcastAllowed: () -> Boolean,
    private val namedHostnameFor: (HostedServer) -> String,
    private val syncAllShareReach: () -> Unit,
    private val notifyForeground: () -> Unit,
) {
    private val statusListeners = CopyOnWriteArrayList<() -> Unit>()

    fun addStatusListener(listener: () -> Unit) {
        statusListeners.add(listener)
    }

    fun removeStatusListener(listener: () -> Unit) {
        statusListeners.remove(listener)
    }

    var onStatusChanged: (() -> Unit)?
        get() = statusListeners.firstOrNull()
        set(v) {
            statusListeners.clear()
            if (v != null) statusListeners.add(v)
        }

    fun pendingJoins(): List<Pair<String, PendingInfo>> =
        pendingByServer.flatMap { (serverId, list) -> list.map { serverId to it } }

    fun publishStatus() {
        syncAllShareReach()
        notifyForeground()
        for (l in statusListeners) {
            try {
                l.invoke()
            } catch (t: Throwable) {
                android.util.Log.e("AshHost", "status listener failed", t)
            }
        }
    }

    fun serverStatuses(): List<HostService.ServerStatus> {
        val showLan = localHosting.isServing() && !localHosting.isCellularExempt()
        val ips = if (isLanBroadcastAllowed() ||
            (localHosting.isServing() && localHosting.currentTrust() == ApprovedNetworks.Trust.ONCE)
        ) {
            lanAddresses()
        } else if (showLan) {
            lanAddresses()
        } else {
            emptyList()
        }
        return registry.all().map { hs ->
            val srv = servers[hs.id]
            val invite = srv?.currentInvite()
            val rotating = invite?.first ?: ""
            val pub = publicHosting.publicUrlFor(hs.id)
            val named = namedHostnameFor(hs)
            val host = publicJoinHost(pub).ifEmpty {
                if (hs.isPublic && named.isNotEmpty()) named else ""
            }
            val hotspot = hotspotSession.sessionForServer(hs.id)
            val hotspotLan = hotspot?.lanUrl
            val lanUrls = when {
                hs.isDirectReach() -> {
                    // Direct-only: Soft-AP URL when session live — never STA home Wi‑Fi.
                    when {
                        hotspotLan != null -> listOf(hotspotLan)
                        else -> emptyList()
                    }
                }
                hotspotLan != null -> {
                    val extra = lanAddresses()
                        .filter { ip -> ShareReachPublisher.isSoftApRange(ip) }
                        .map { "http://$it:${hs.port}" }
                    (listOf(hotspotLan) + extra).distinct()
                }
                showLan -> ips
                    .filter { !ShareReachPublisher.isSoftApRange(it) || ips.size == 1 }
                    .map { "http://$it:${hs.port}" }
                else -> emptyList()
            }
            val inviteSlug = srv?.hostInviteSlug().orEmpty()
            val inviteUrl = if (inviteSlug.isEmpty()) {
                ""
            } else {
                personalInviteUrlFor(
                    inviteSlug,
                    pub.orEmpty(),
                    lanUrls.firstOrNull().orEmpty(),
                    hs.isPublic,
                )
            }
            HostService.ServerStatus(
                id = hs.id,
                name = hs.name,
                port = hs.port,
                lanUrls = lanUrls,
                inviteCode = rotating,
                inviteExpiry = invite?.second ?: 0L,
                joinTag = hs.joinTag,
                shareCode = formatShareCode(rotating, host),
                inviteSlug = inviteSlug,
                inviteUrl = inviteUrl,
                isPublic = hs.isPublic,
                listening = srv?.isAlive == true,
                publicUrl = pub,
                publicNetworkCode = if (host.isNotEmpty()) "@$host" else "",
                error = publicHosting.publicErrorFor(hs.id),
                passphrase = hs.passphrase,
                pending = pendingByServer[hs.id] ?: emptyList(),
                forceJoinCode = srv?.forceJoinCode() == true,
                publicSubdomain = hs.publicSubdomain,
                namedHostname = named,
                reachMode = hs.reachMode,
                hotspotActive = hotspot != null,
                hotspotSsid = hotspot?.ssid.orEmpty(),
                hotspotPassword = hotspot?.password.orEmpty(),
                hotspotQrUri = hotspot?.qrUri.orEmpty(),
                hotspotLanUrl = hotspot?.lanUrl.orEmpty(),
                hotspotRadioLive = hotspot?.radioLive == true,
                hotspotRadioNote = hotspot?.radioNote.orEmpty(),
            )
        }
    }

    fun bridgeInfos(): List<HostService.BridgeInfo> = registry.all().mapNotNull { hs ->
        val token = servers[hs.id]?.hostToken() ?: return@mapNotNull null
        HostService.BridgeInfo(hs.id, hs.port, hs.name, token, hs.passphrase)
    }

    private fun formatShareCode(rotating: String, host: String): String {
        val code = rotating.trim().uppercase().replace("-", "")
        if (host.isNotEmpty()) {
            return if (code.isEmpty()) host else "$code@$host"
        }
        return code
    }

    private fun publicJoinHost(publicUrl: String?): String {
        if (publicUrl.isNullOrBlank()) return ""
        return try {
            java.net.URI(publicUrl).host?.trim().orEmpty()
        } catch (_: Exception) {
            ""
        }
    }

    fun lanAddresses(): List<String> =
        NetworkInterface.getNetworkInterfaces()?.toList()
            ?.flatMap { it.inetAddresses.toList() }
            ?.filter { !it.isLoopbackAddress && it is java.net.Inet4Address }
            ?.mapNotNull { it.hostAddress?.takeIf { a -> a.isNotEmpty() } }
            ?: emptyList()
}
