package com.phlip

import android.app.Activity
import android.util.Log
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.UpdateAvailability

/**
 * Play In-App Updates (FLEXIBLE only — never IMMEDIATE, which would kill a live host).
 * No-ops when not installed from Play, when Play Core reports nothing, or when
 * [deferIfBusy] says an event/broadcast/pitch is live (caller should retry later).
 */
object PlayUpdateHelper {
    private const val TAG = "AshPlayUpdate"
    const val REQUEST_CODE = 49101

    /**
     * @return false if the prompt was skipped because the host is live-busy
     *         (so the UI can explain); true if a check was started or nothing to do.
     */
    fun checkAndPromptFlexible(
        activity: Activity,
        deferIfBusy: () -> Boolean = { false },
    ): Boolean {
        if (!VersionPolicy.isPlayInstall(activity)) return true
        if (deferIfBusy()) {
            Log.i(TAG, "deferring flexible update — host is live")
            return false
        }
        try {
            val mgr = AppUpdateManagerFactory.create(activity)
            mgr.appUpdateInfo.addOnSuccessListener { info ->
                val available = info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE &&
                    info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)
                if (!available) return@addOnSuccessListener
                // Re-check immediately before starting the flow — a pitch may
                // have started while Play was answering.
                if (deferIfBusy()) {
                    Log.i(TAG, "deferring flexible update after AppUpdateInfo — now live")
                    return@addOnSuccessListener
                }
                try {
                    mgr.startUpdateFlowForResult(
                        info,
                        activity,
                        AppUpdateOptions.newBuilder(AppUpdateType.FLEXIBLE).build(),
                        REQUEST_CODE,
                    )
                } catch (t: Throwable) {
                    Log.w(TAG, "startUpdateFlow failed", t)
                }
            }.addOnFailureListener { t ->
                Log.w(TAG, "appUpdateInfo failed", t)
            }
        } catch (t: Throwable) {
            Log.w(TAG, "Play update check unavailable", t)
        }
        return true
    }
}
