package app.phlip.core.security

/**
 * Device-bound key custody (dual-platform Phase B).
 *
 * Envelope / sealed-card / note encryption sit **above** this API in commonMain.
 * Only key material and prefs-backed secret storage are platform-specific.
 *
 * Construct with [storeName] + [keyAlias]. Android requires
 * [AndroidCryptoContext.init] before first use (done by [SecureStore]).
 */
expect class DeviceKeyStore(storeName: String, keyAlias: String) {
    /** Encrypt to raw `iv ‖ ciphertext` (12-byte GCM IV + AES-GCM). */
    fun seal(plaintext: ByteArray): ByteArray

    /** Decrypt raw seal bytes; null on failure. */
    fun open(sealed: ByteArray): ByteArray?

    fun getSecret(key: String): String?
    fun putSecret(key: String, value: String)
    fun removeSecret(key: String)
    fun clearSecrets()
}
