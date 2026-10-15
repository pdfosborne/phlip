package app.phlip.server.hosting

import android.content.Context
import android.os.Handler
import app.phlip.core.assets.ClientAssetSource
import app.phlip.server.DrServer
import app.phlip.server.HostedServer
import app.phlip.server.PendingInfo
import app.phlip.server.PRESET_FRIEND
import app.phlip.server.ServerRegistry
import app.phlip.server.local.LocalHostingCoordinator
import app.phlip.server.publichost.PublicHostingCoordinator
import java.util.concurrent.ConcurrentHashMap

/**
 * Start / stop live [DrServer] instances and wire edge/NSD callbacks.
 */
internal class ServerInstanceManager(
    private val context: Context,
    private val registry: ServerRegistry,
    private val servers: ConcurrentHashMap<String, DrServer>,
    private val pendingByServer: ConcurrentHashMap<String, List<PendingInfo>>,
    private val mainHandler: Handler,
    private val localHosting: LocalHostingCoordinator,
    private val publicHosting: PublicHostingCoordinator,
    private val clientAssetSource: () -> ClientAssetSource,
    private val isStarted: () -> Boolean,
    private val publishStatus: () -> Unit,
    private val onServerActivity: () -> Unit,
    private val applyEdgeGate: (DrServer) -> Unit,
) {
    fun startInstance(hs: HostedServer, initialPreset: String = PRESET_FRIEND, initialActivity: String? = null) {
        if (servers.containsKey(hs.id)) return
        val atRest = app.phlip.core.security.SecureStore.hostAtRest(context)
        val srv = DrServer(
            hs.port,
            clientAssetSource(),
            java.io.File(context.filesDir, hs.dataFile),
            hs.passphrase,
            atRest,
            hs.bindHost(),
            initialPreset,
            initialActivity,
        )
        srv.onPendingChanged = { list ->
            pendingByServer[hs.id] = list
            publishStatus()
            onServerActivity()
        }
        srv.onActivityChanged = { onServerActivity() }
        srv.onInviteChanged = { code, exp ->
            mainHandler.post {
                if (!isStarted() || !servers.containsKey(hs.id)) return@post
                registry.get(hs.id)?.let { localHosting.advertise(it) }
                publishStatus()
                // Personal invite slugs are primary; rotating-code hash sync is legacy-only.
                publicHosting.syncPersonalInvitesToEdge(hs.id)
                publicHosting.syncInviteToEdge(hs.id, code, exp)
            }
        }
        srv.onPersonalInvitesChanged = {
            mainHandler.post {
                if (!isStarted() || !servers.containsKey(hs.id)) return@post
                publicHosting.syncPersonalInvitesToEdge(hs.id)
            }
        }
        srv.onEdgeMemberSession = { token, userId, oldToken ->
            publicHosting.syncMemberSessionBlocking(hs.id, token, userId, oldToken)
        }
        srv.onRelayCacheMutated = {
            publicHosting.queueRelayPush(hs.id, force = false)
        }
        srv.setHostName(hs.name)
        srv.setJoinTag(hs.joinTag)
        srv.setShareReach("", null, hs.isPublic, hs.reachMode)
        srv.setServerPassphrase(hs.passphrase)
        applyEdgeGate(srv)
        try {
            srv.start(0)
        } catch (_: Exception) {
            return
        }
        servers[hs.id] = srv
        if (hs.isDeviceOnly()) {
            return
        }
        if (!localHosting.isServing()) {
            srv.pauseListening()
        } else {
            localHosting.syncShareReach(hs.id)
            localHosting.advertise(hs)
        }
    }

    fun stopInstance(id: String) {
        localHosting.unadvertise(id)
        servers.remove(id)?.let {
            it.onActivityChanged = null
            it.onPendingChanged = null
            it.onInviteChanged = null
            it.onPersonalInvitesChanged = null
            it.onEdgeMemberSession = null
            it.onRelayCacheMutated = null
            it.closeAllClients()
            it.stop()
        }
        pendingByServer.remove(id)
        onServerActivity()
    }
}
