package app.phlip.core.tunnel

/**
 * Provider-neutral public access surface. UI and the host service talk only to
 * this — named tunnels and a future relay all implement the same contract.
 *
 * Android SPI factory lives in androidMain ([PublicAccessProviderFactory]).
 */
interface PublicAccessProvider {
    fun start(config: PublicAccessConfig)
    fun stop()
    fun status(): PublicAccessStatus
}

data class PublicAccessConfig(
    /** Local Phlip NanoHTTPD, e.g. `127.0.0.1:3000`. */
    val localAddr: String,
    /** Optional metrics bind. */
    val metricsAddr: String = "127.0.0.1:0",
    /** Named-tunnel run token (empty when unused). */
    val tunnelToken: String = "",
    /** Display / invite hostname, e.g. `family.example.com`. */
    val publicHostname: String = "",
)

enum class PublicAccessState {
    STOPPED, STARTING, CONNECTED, ERROR
}

data class PublicAccessStatus(
    val state: PublicAccessState,
    val publicUrl: String? = null,
    val error: String? = null,
    /** Reserved; named tunnels always set false (trial Quick Tunnels removed). */
    val isTrial: Boolean = false,
)

fun interface PublicAccessListener {
    fun onStatus(status: PublicAccessStatus)
}
