package app.phlip.tunnel

import app.phlip.core.tunnel.TunnelConfig
import app.phlip.core.tunnel.TunnelController
import app.phlip.core.tunnel.TunnelState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * [TunnelController] backed by the bundled cloudflared binary.
 * No-arg constructor required for [java.util.ServiceLoader].
 */
class CloudflaredController : TunnelController {

    private val _state = MutableStateFlow<TunnelState>(TunnelState.Idle)
    override val state: StateFlow<TunnelState> = _state.asStateFlow()

    @Volatile private var process: TunnelProcess? = null

    override suspend fun start(config: TunnelConfig) {
        stop()
        val ctx = AppContextHolder.require()
        _state.value = TunnelState.Connecting
        val proc = TunnelProcess(
            ctx,
            onLine = { line ->
                if (CONNECTED_HINT.containsMatchIn(line) && config.hostname.isNotEmpty()) {
                    _state.value = TunnelState.Live(url = "https://${config.hostname}")
                }
            },
            onExit = { code ->
                if (_state.value !is TunnelState.Live) {
                    _state.value = TunnelState.Failed("Cloudflare tunnel exited (code $code).")
                } else {
                    _state.value = TunnelState.Idle
                }
            },
        )
        process = proc
        val edges = CloudflareEdges.resolve()
        val metricsPort = 22_000 + (config.localPort.and(0x1fff))
        val args = ArrayList<String>().apply {
            add("tunnel")
            add("--no-autoupdate")
            add("--edge-ip-version"); add("4")
            add("--protocol"); add("http2")
            add("--metrics"); add("127.0.0.1:$metricsPort")
            for (edge in edges) {
                add("--edge"); add(edge)
            }
            add("run")
            add("--token"); add(config.credentialsJson)
        }
        proc.start(args)
    }

    override suspend fun stop() {
        process?.stop()
        process = null
        _state.value = TunnelState.Idle
    }

    companion object {
        private val CONNECTED_HINT = Regex(
            """Registered tunnel connection|Connection .+ registered|connIndex=""",
            RegexOption.IGNORE_CASE,
        )
    }
}
