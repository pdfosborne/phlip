package com.phlip

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import app.phlip.server.publichost.HostPublicGate
import app.phlip.server.HostService

/**
 * Play / sideload updates restart the process and tear down [HostService].
 * If the host had hosting on, bring the foreground service (and Public tunnel)
 * back without waiting for them to open Settings.
 *
 * Binding is not automatic: [HostService] evaluates the network fingerprint
 * before listening. On an unknown network it restores into SUSPENDED and notifies
 * for approval — never silently reopens LAN exposure after an overnight update.
 */
class PackageReplacedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        if (!HostPublicGate.isHostingDesired(context)) return
        Log.i(TAG, "Package replaced — restoring HostService (network gate applies before bind)")
        try {
            context.startForegroundService(Intent(context, HostService::class.java))
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to restore HostService after update", t)
        }
    }

    companion object {
        private const val TAG = "AshPkgReplaced"
    }
}
