package com.phlip.network

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat

/**
 * ACCESS_FINE_LOCATION gate for reading the connected Wi‑Fi SSID (approved-network
 * labels). NEARBY_WIFI_DEVICES with neverForLocation does not unlock SSID.
 */
class WifiSsidAccessGate(
    private val activity: Activity,
    private val requestPermission: (permission: String) -> Unit,
) {
    private var pendingAction: (() -> Unit)? = null

    fun onPermissionResult(@Suppress("UNUSED_PARAMETER") granted: Boolean) {
        // Always continue — SSID labeling is best-effort; hosting approval must not block.
        val action = pendingAction
        pendingAction = null
        action?.invoke()
    }

    fun hasFineLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(activity, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    fun isSystemLocationEnabled(): Boolean {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val lm = activity.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
                lm?.isLocationEnabled == true
            } else {
                @Suppress("DEPRECATION")
                Settings.Secure.getInt(activity.contentResolver, Settings.Secure.LOCATION_MODE, 0) !=
                    Settings.Secure.LOCATION_MODE_OFF
            }
        } catch (_: Throwable) {
            true
        }
    }

    fun openSystemLocationSettings() {
        activity.runOnUiThread {
            try {
                activity.startActivity(
                    Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            } catch (_: Exception) {
                try {
                    activity.startActivity(
                        Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    )
                } catch (_: Exception) {
                }
            }
        }
    }

    /**
     * Requests fine location if missing, then runs [onReady] (whether granted or denied).
     * Callers that need the SSID should tolerate a still-empty label.
     */
    fun ensureFineLocation(onReady: () -> Unit) {
        if (hasFineLocationPermission()) {
            onReady()
            return
        }
        pendingAction = onReady
        requestPermission(Manifest.permission.ACCESS_FINE_LOCATION)
    }
}
