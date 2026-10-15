package com.phlip.hotspot

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
 * Nearby-Wi‑Fi / location permission gate for the hotspot paths. The permission
 * launcher stays registered on the Activity (registration has to happen before
 * onStart), so this only holds the deferred action and decides when to ask.
 */
class HotspotLocationGate(
    private val activity: Activity,
    private val requestPermission: (permission: String) -> Unit,
) {
    private var pendingAction: (() -> Unit)? = null

    /** Feed the Activity launcher's result back in. */
    fun onPermissionResult(granted: Boolean) {
        pendingAction?.let { action ->
            if (granted) action()
            pendingAction = null
        }
    }

    fun hasHotspotWifiPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(activity, Manifest.permission.NEARBY_WIFI_DEVICES) ==
                PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(activity, Manifest.permission.ACCESS_FINE_LOCATION) ==
                PackageManager.PERMISSION_GRANTED
        }
    }

    /** LocalOnlyHotspot on API ≤32 needs system Location enabled, not only the permission. */
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

    fun ensureHotspotLocationPermission(onGranted: () -> Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(activity, Manifest.permission.NEARBY_WIFI_DEVICES) ==
                PackageManager.PERMISSION_GRANTED
            ) {
                onGranted()
                return
            }
            pendingAction = onGranted
            requestPermission(Manifest.permission.NEARBY_WIFI_DEVICES)
            return
        }
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            onGranted()
            return
        }
        pendingAction = onGranted
        requestPermission(Manifest.permission.ACCESS_FINE_LOCATION)
    }
}
