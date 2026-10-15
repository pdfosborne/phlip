package app.phlip.core.security

import android.content.Context

/**
 * Holds the application [Context] for [DeviceKeyStore] construction on Android.
 * [SecureStore] (and app startup) call [init] before any seal/open.
 */
object AndroidCryptoContext {
    @Volatile
    private var appContext: Context? = null

    fun init(ctx: Context) {
        appContext = ctx.applicationContext
    }

    fun require(): Context =
        appContext ?: error("AndroidCryptoContext.init(Context) must run before DeviceKeyStore use")
}
