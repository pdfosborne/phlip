package app.phlip.tunnel

import android.annotation.SuppressLint
import android.content.Context

/**
 * Application context for ServiceLoader-constructed tunnel controllers
 * (no-arg constructors). Set from the app [android.app.Application.onCreate].
 */
object AppContextHolder {
    @SuppressLint("StaticFieldLeak")
    @Volatile
    private var appContext: Context? = null

    fun init(context: Context) {
        appContext = context.applicationContext
    }

    fun require(): Context =
        appContext ?: throw IllegalStateException("Tunnel AppContextHolder not initialised")
}
