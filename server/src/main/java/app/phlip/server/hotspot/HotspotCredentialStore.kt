package app.phlip.server.hotspot

import android.content.Context

/**
 * Stable Direct Soft-AP credentials for this device.
 *
 * Restarting a Direct session reuses the same `phlip-……` SSID/password so clients
 * do not have to join a brand-new network. Clearing / rotating is explicit.
 *
 * System-chosen names (e.g. AndroidShare_…) cannot be requested again — only
 * Soft-AP (`phlip-`) credentials are persisted for reuse.
 */
internal class HotspotCredentialStore(
    context: Context,
) {
    private val prefs = context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    data class Creds(val ssid: String, val password: String)

    fun loadPreferred(): Creds? {
        val ssid = prefs.getString(KEY_SSID, null)?.trim().orEmpty()
        val password = prefs.getString(KEY_PASSWORD, null)?.trim().orEmpty()
        if (ssid.isEmpty() || password.isEmpty()) return null
        if (!HotspotReservationController.looksLikePhlipSsid(ssid)) return null
        return Creds(ssid, password)
    }

    /** Load existing Soft-AP creds, or mint and persist a new pair. */
    fun ensurePreferred(): Creds {
        loadPreferred()?.let { return it }
        val fresh = Creds(
            HotspotReservationController.generatePhlipSsid(),
            HotspotReservationController.generatePhlipPassphrase(),
        )
        savePreferred(fresh.ssid, fresh.password)
        return fresh
    }

    fun savePreferred(ssid: String, password: String) {
        val s = ssid.trim()
        val p = password.trim()
        if (s.isEmpty() || p.isEmpty()) return
        if (!HotspotReservationController.looksLikePhlipSsid(s)) return
        prefs.edit()
            .putString(KEY_SSID, s)
            .putString(KEY_PASSWORD, p)
            .apply()
    }

    /** Drop saved Soft-AP name so the next start mints a new `phlip-……` network. */
    fun clear() {
        prefs.edit().clear().apply()
    }

    fun rotatePreferred(): Creds {
        clear()
        return ensurePreferred()
    }

    companion object {
        private const val PREFS = "ash_direct_hotspot_v1"
        private const val KEY_SSID = "ssid"
        private const val KEY_PASSWORD = "password"
    }
}
