package app.phlip.server.publichost

import android.content.Context
import app.phlip.core.tunnel.PublicAccessConfig
import app.phlip.core.tunnel.PublicAccessListener
import app.phlip.core.tunnel.PublicAccessProviders
import app.phlip.core.tunnel.PublicAccessState
import app.phlip.server.DrServer
import app.phlip.server.HostedServer
import app.phlip.server.ServerRegistry
import app.phlip.server.publichost.cloudflare.CloudflarePrefs

/** Single shared PublicAccessProvider tunnel for all Public servers. */
internal class SharedTunnelController(
    private val context: Context,
    private val registry: ServerRegistry,
    private val servers: MutableMap<String, DrServer>,
    private val cfPrefs: CloudflarePrefs,
    private val state: PublicHostingState,
    private val namedHostnameFor: (HostedServer) -> String,
    private val onAdvertise: (HostedServer) -> Unit,
    private val onStateChanged: () -> Unit,
    private val onServerActivity: () -> Unit,
    private val startEdgePullLoop: () -> Unit,
    private val clearEdgePull: () -> Unit,
) {
    fun hasActiveProvider(): Boolean = state.publicProvider != null

    fun ensureSharedTunnelRunning(hintHostname: String) {
        if (state.publicProvider != null) {
            if (state.publicProvider?.status()?.state == PublicAccessState.CONNECTED) {
                markAllPublicConnected()
            }
            return
        }
        val listener = PublicAccessListener { st ->
            when (st.state) {
                PublicAccessState.CONNECTED -> markAllPublicConnected()
                PublicAccessState.ERROR -> {
                    val err = st.error
                    val demote = !err.isNullOrBlank() && err.contains("Missing Cloudflare tunnel")
                    for (hs in registry.publicServers()) {
                        state.publicErrors[hs.id] = err ?: "Cloudflare tunnel error"
                        state.publicUrls.remove(hs.id)
                        if (demote) {
                            registry.setPublic(hs.id, false)
                            if (servers.containsKey(hs.id)) onAdvertise(hs)
                        }
                    }
                    if (demote) stopCloudflarePublic()
                    onServerActivity()
                    onStateChanged()
                }
                PublicAccessState.STARTING -> onStateChanged()
                PublicAccessState.STOPPED -> {
                    state.publicUrls.clear()
                    onStateChanged()
                }
            }
        }
        val provider = PublicAccessProviders.create(context, listener) ?: run {
            android.util.Log.e("AshCloudflare", "Public access module not installed")
            return
        }
        state.publicProvider = provider
        val host = hintHostname.ifBlank {
            registry.publicServers().firstOrNull()?.let { namedHostnameFor(it) }.orEmpty()
        }
        android.util.Log.i("AshCloudflare", "Shared tunnel start (hint host=$host)")
        provider.start(
            PublicAccessConfig(
                localAddr = "127.0.0.1:1",
                tunnelToken = cfPrefs.tunnelToken,
                publicHostname = host,
            ),
        )
    }

    fun markAllPublicConnected() {
        for (hs in registry.publicServers()) {
            val host = namedHostnameFor(hs)
            if (host.isNotEmpty()) {
                state.publicUrls[hs.id] = "https://$host"
                state.publicErrors.remove(hs.id)
            }
        }
        onStateChanged()
        onServerActivity()
        if (cfPrefs.edgeProvisioned) startEdgePullLoop()
    }

    fun stopCloudflarePublic() {
        clearEdgePull()
        try {
            state.publicProvider?.stop()
        } catch (t: Throwable) {
            android.util.Log.e("AshCloudflare", "stop failed", t)
        }
        state.publicProvider = null
        state.publicUrls.clear()
    }
}
