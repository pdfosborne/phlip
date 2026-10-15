package app.phlip.server

import android.content.Context
import android.content.Intent

/**
 * Opens host-app settings screens without a compile dependency on the app.
 * [settingsClassName] must be set from the host [android.app.Application] at startup.
 */
object HostUiIntents {
    @Volatile
    var settingsClassName: String = ""

    const val EXTRA_SCREEN = "screen"
    const val SCREEN_HOST = "host"

    fun openHostSettings(context: Context): Intent {
        val cls = settingsClassName
        require(cls.isNotEmpty()) { "HostUiIntents.settingsClassName not set by host app" }
        return Intent().setClassName(context.packageName, cls)
            .putExtra(EXTRA_SCREEN, SCREEN_HOST)
    }
}
