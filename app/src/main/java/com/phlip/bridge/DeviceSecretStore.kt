package com.phlip.bridge

import com.phlip.MainActivity

/** 016 — seal small identity secrets (private key JWK) in Android Keystore. */
class DeviceSecretStore(
    private val main: MainActivity,
) {
    fun putDeviceSecret(alias: String, value: String): Boolean {
        val key = sanitize(alias) ?: return false
        if (value.length > 16_384) return false
        return try {
            main.identitySecrets().putString(key, value)
            true
        } catch (_: Exception) {
            false
        }
    }

    fun getDeviceSecret(alias: String): String {
        val key = sanitize(alias) ?: return ""
        return try {
            main.identitySecrets().getString(key, "")
        } catch (_: Exception) {
            ""
        }
    }

    fun removeDeviceSecret(alias: String): Boolean {
        val key = sanitize(alias) ?: return false
        return try {
            main.identitySecrets().remove(key)
            true
        } catch (_: Exception) {
            false
        }
    }

    /** Aliases must already be keystore-safe — anything altered by filtering is rejected. */
    private fun sanitize(alias: String): String? {
        val key = alias.filter { it.isLetterOrDigit() || it == '_' || it == '-' }.take(64)
        return if (key.isEmpty() || key != alias) null else key
    }
}
