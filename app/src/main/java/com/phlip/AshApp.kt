package com.phlip

import android.app.Application
import app.phlip.core.security.AndroidCryptoContext
import app.phlip.server.HostUiIntents
import app.phlip.server.HostVersionGate
import app.phlip.tunnel.AppContextHolder

/** Application entry. Host assets come from the merged APK asset tree. */
class AshApp : Application() {
    override fun onCreate() {
        super.onCreate()
        instance = this
        AndroidCryptoContext.init(this)
        AppContextHolder.init(this)
        HostUiIntents.settingsClassName = SettingsActivity::class.java.name
        HostVersionGate.isBelowMinSafe = { VersionPolicy.isBelowMinSafe() }
        VersionPolicy.refreshAsync(this)
    }

    companion object {
        @Volatile lateinit var instance: AshApp
            private set
    }
}
