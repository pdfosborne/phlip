package app.phlip.server.publichost

import app.phlip.core.tunnel.PublicAccessProvider
import java.util.concurrent.ConcurrentHashMap

/** Shared mutable maps / tunnel handle for public-hosting helpers. */
internal class PublicHostingState {
    val publicUrls = ConcurrentHashMap<String, String>()
    val publicErrors = ConcurrentHashMap<String, String>()
    var publicProvider: PublicAccessProvider? = null
}
