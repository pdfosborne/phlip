package app.phlip.tunnel

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import app.phlip.core.tunnel.PublicAccessConfig
import app.phlip.core.tunnel.PublicAccessListener
import app.phlip.core.tunnel.PublicAccessProvider
import app.phlip.core.tunnel.PublicAccessState
import app.phlip.core.tunnel.PublicAccessStatus
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/**
 * Named Cloudflare Tunnel using a tunnel run token + fixed hostname
 * (e.g. `family.example.com`). Edge IPs are resolved in Java so the linux
 * cloudflared binary does not need working Go DNS on Android.
 */
class NamedTunnelProvider(
    private val context: Context,
    private val listener: PublicAccessListener,
) : PublicAccessProvider {

    private val main = Handler(Looper.getMainLooper())
    private var tunnel: TunnelProcess? = null
    private val statusRef = AtomicReference(PublicAccessStatus(PublicAccessState.STOPPED))
    private val generation = AtomicInteger(0)
    private var hostname = ""

    override fun start(config: PublicAccessConfig) {
        if (config.tunnelToken.isBlank()) {
            publish(
                PublicAccessStatus(
                    PublicAccessState.ERROR,
                    error = "Missing Cloudflare tunnel token. Finish public hosting setup first.",
                )
            )
            return
        }
        hostname = config.publicHostname.trim().lowercase()
        val gen = generation.incrementAndGet()
        publish(PublicAccessStatus(PublicAccessState.STARTING))
        Thread({
            startProcess(config, gen)
        }, "ash-named-tunnel").apply { isDaemon = true }.start()
    }

    private fun startProcess(config: PublicAccessConfig, gen: Int) {
        if (gen != generation.get()) return
        val edges = CloudflareEdges.resolve()
        val metricsPort = 22_000 + (config.localAddr.hashCode().and(0x1fff))
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
            add("--token"); add(config.tunnelToken)
        }
        val proc = TunnelProcess(
            context,
            onLine = { line ->
                if (gen != generation.get()) return@TunnelProcess
                Log.d(TAG, line)
                if (CONNECTED_HINT.containsMatchIn(line) && hostname.isNotEmpty()) {
                    publish(
                        PublicAccessStatus(
                            PublicAccessState.CONNECTED,
                            publicUrl = "https://$hostname",
                            isTrial = false,
                        )
                    )
                }
            },
            onExit = { code ->
                if (gen != generation.get()) return@TunnelProcess
                publish(
                    PublicAccessStatus(
                        PublicAccessState.ERROR,
                        error = "Cloudflare tunnel exited (code $code).",
                    )
                )
            },
        )
        tunnel = proc
        try {
            proc.start(args)
            if (hostname.isNotEmpty()) {
                main.postDelayed({
                    if (gen != generation.get()) return@postDelayed
                    if (statusRef.get().state == PublicAccessState.STARTING) {
                        publish(
                            PublicAccessStatus(
                                PublicAccessState.CONNECTED,
                                publicUrl = "https://$hostname",
                                isTrial = false,
                            )
                        )
                    }
                }, 4_000)
            }
        } catch (t: Throwable) {
            Log.e(TAG, "named tunnel start failed", t)
            publish(
                PublicAccessStatus(
                    PublicAccessState.ERROR,
                    error = t.message ?: "Couldn't start Cloudflare tunnel",
                )
            )
        }
    }

    override fun stop() {
        generation.incrementAndGet()
        tunnel?.stop()
        tunnel = null
        publish(PublicAccessStatus(PublicAccessState.STOPPED))
    }

    override fun status(): PublicAccessStatus = statusRef.get()

    private fun publish(s: PublicAccessStatus) {
        statusRef.set(s)
        main.post { listener.onStatus(s) }
    }

    companion object {
        private const val TAG = "AshNamedTunnel"
        private val CONNECTED_HINT = Regex(
            """Registered tunnel connection|Connection .+ registered|connIndex=""",
            RegexOption.IGNORE_CASE,
        )
    }
}
