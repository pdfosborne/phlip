package app.phlip.core.tunnel

import kotlinx.coroutines.flow.StateFlow

interface TunnelController {
    val state: StateFlow<TunnelState>
    suspend fun start(config: TunnelConfig)
    suspend fun stop()
}

data class TunnelConfig(
    val hostname: String,
    val localPort: Int,
    val credentialsJson: String,
)

sealed interface TunnelState {
    data object Idle : TunnelState
    data object Connecting : TunnelState
    data class Live(val url: String) : TunnelState
    data class Failed(val reason: String) : TunnelState
}
