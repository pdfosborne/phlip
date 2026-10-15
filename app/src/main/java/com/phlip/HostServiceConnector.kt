package com.phlip

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import androidx.core.content.ContextCompat
import app.phlip.server.HostService

/**
 * Shared HostService bind/unbind + start/stop for MainActivity and SettingsActivity.
 * Dialog presentation stays per-Activity; this owns the connection lifecycle.
 */
class HostServiceConnector(
    private val context: Context,
    private val onConnected: (HostService) -> Unit,
    /** Called with the previous service instance (may be null) when the binder drops. */
    private val onDisconnected: (HostService?) -> Unit,
) {
    @Volatile
    var service: HostService? = null
        private set

    @Volatile
    var bound: Boolean = false
        private set

    val connection: ServiceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName, binder: IBinder) {
            val svc = (binder as HostService.LocalBinder).service
            service = svc
            bound = true
            onConnected(svc)
        }

        override fun onServiceDisconnected(name: ComponentName) {
            val previous = service
            service = null
            bound = false
            onDisconnected(previous)
        }
    }

    fun bind() {
        Intent(context, HostService::class.java).also {
            context.bindService(it, connection, Context.BIND_AUTO_CREATE)
        }
    }

    fun unbind(removeListener: ((HostService) -> Unit)? = null) {
        service?.let { removeListener?.invoke(it) }
        if (bound) {
            try {
                context.unbindService(connection)
            } catch (_: Exception) {
            }
            bound = false
        }
        service = null
    }

    fun startHosting() {
        val intent = Intent(context, HostService::class.java)
        ContextCompat.startForegroundService(context, intent)
        if (!bound) {
            context.bindService(intent, connection, Context.BIND_AUTO_CREATE)
        }
    }

    fun stopHosting() {
        service?.stopHosting()
        service = null
    }

    /** Clear the local handle without calling stopHosting (Settings UI path). */
    fun clearServiceHandle() {
        service = null
    }
}
