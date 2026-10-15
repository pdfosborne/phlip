package app.phlip.server

/**
 * Injected by the host app so `:server` does not depend on app [BuildConfig].
 */
object HostVersionGate {
    @Volatile
    var isBelowMinSafe: () -> Boolean = { false }
}
