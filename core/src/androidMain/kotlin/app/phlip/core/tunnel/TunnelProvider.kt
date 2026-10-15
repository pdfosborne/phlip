package app.phlip.core.tunnel

import java.util.ServiceLoader

object TunnelProvider {

    /** Null when the module is not installed. Not an error. */
    fun getOrNull(): TunnelController? =
        runCatching {
            ServiceLoader.load(
                TunnelController::class.java,
                TunnelController::class.java.classLoader,
            ).firstOrNull()
        }.getOrNull()

    val isAvailable: Boolean get() = getOrNull() != null
}
