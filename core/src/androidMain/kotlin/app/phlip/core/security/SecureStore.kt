package app.phlip.core.security

import android.content.Context
import android.util.Log

/**
 * Android-facing façade over [DeviceKeyStore] (dual-platform Phase B).
 *
 * Keeps the historical string API used by `:server` (prefs secrets + `ks:` file
 * blobs). All Keystore access goes through [DeviceKeyStore] in androidMain.
 */
class SecureStore(ctx: Context, storeName: String, keyAlias: String) {

    init {
        AndroidCryptoContext.init(ctx)
    }

    private val keys = DeviceKeyStore(storeName, keyAlias)

    /** Decrypted value for [key], or [default] if absent/undecryptable. */
    fun getString(key: String, default: String = ""): String =
        keys.getSecret(key) ?: default

    /** Encrypt and persist [value] under [key]. Fails closed (no write) on error. */
    fun putString(key: String, value: String) {
        keys.putSecret(key, value)
    }

    fun remove(key: String) {
        keys.removeSecret(key)
    }

    fun clear() {
        keys.clearSecrets()
    }

    /**
     * Encrypt [value] to a portable `ks:<base64(iv‖ct)>` blob for host files.
     * Empty input stays empty. On Keystore failure returns "" (fail closed — never plaintext).
     */
    fun seal(value: String): String {
        if (value.isEmpty()) return ""
        return try {
            SealedBlobFormat.encode(keys.seal(value.toByteArray(Charsets.UTF_8)))
        } catch (t: Throwable) {
            Log.e(TAG, "seal failed; not writing plaintext", t)
            ""
        }
    }

    /**
     * Decrypt a [seal] blob. Legacy plaintext (no `ks:` prefix) is returned as-is
     * so callers can migrate on next save. Undecryptable sealed blobs → [default].
     */
    fun open(blob: String, default: String = ""): String {
        if (blob.isEmpty()) return default
        if (!isSealed(blob)) return blob
        val payload = SealedBlobFormat.decodePayload(blob) ?: return default
        return try {
            val plain = keys.open(payload) ?: return default
            String(plain, Charsets.UTF_8)
        } catch (t: Throwable) {
            Log.e(TAG, "open failed for sealed blob; clearing", t)
            default
        }
    }

    fun isSealed(blob: String): Boolean = SealedBlobFormat.isSealed(blob)

    companion object {
        private const val TAG = "SecureStore"

        /** File-embedded ciphertext prefix (`servers.json` / `data_*.json`). */
        const val SEAL_PREFIX = SealedBlobFormat.PREFIX

        fun isSealedBlob(blob: String): Boolean = SealedBlobFormat.isSealed(blob)

        /**
         * Shared Keystore seal for host group secrets + `data_*.json` at rest
         * (E2E-ENCRYPTION.md §1.1 / §5.3). Device-bound; not lock-screen gated.
         */
        fun hostAtRest(ctx: Context): SecureStore =
            SecureStore(ctx.applicationContext, PREFS_HOST_AT_REST, KEY_HOST_AT_REST)

        private const val PREFS_HOST_AT_REST = "ash_host_at_rest_v1"
        private const val KEY_HOST_AT_REST = "ash_host_at_rest_key"
    }
}
