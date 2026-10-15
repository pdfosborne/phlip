package app.phlip.core.security

/**
 * iOS Keychain / Secure Enclave actual — stub until an iOS app exists.
 * Compiling this target is the Phase B deliverable; behaviour comes later.
 */
actual class DeviceKeyStore actual constructor(
    @Suppress("UNUSED_PARAMETER") storeName: String,
    @Suppress("UNUSED_PARAMETER") keyAlias: String,
) {
    actual fun seal(plaintext: ByteArray): ByteArray =
        throw NotImplementedError("DeviceKeyStore iOS actual not implemented yet")

    actual fun open(sealed: ByteArray): ByteArray? =
        throw NotImplementedError("DeviceKeyStore iOS actual not implemented yet")

    actual fun getSecret(key: String): String? =
        throw NotImplementedError("DeviceKeyStore iOS actual not implemented yet")

    actual fun putSecret(key: String, value: String): Unit =
        throw NotImplementedError("DeviceKeyStore iOS actual not implemented yet")

    actual fun removeSecret(key: String): Unit =
        throw NotImplementedError("DeviceKeyStore iOS actual not implemented yet")

    actual fun clearSecrets(): Unit =
        throw NotImplementedError("DeviceKeyStore iOS actual not implemented yet")
}
