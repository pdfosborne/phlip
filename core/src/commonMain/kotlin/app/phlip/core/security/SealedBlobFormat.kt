package app.phlip.core.security

import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

/**
 * Portable host-file ciphertext format (`servers.json` / `data_*.json`).
 * Raw bytes are `iv ‖ ciphertext` from [DeviceKeyStore.seal]; this layer only
 * adds the `ks:` prefix and Base64 so platforms share one on-disk shape.
 */
@OptIn(ExperimentalEncodingApi::class)
object SealedBlobFormat {
    const val PREFIX = "ks:"

    fun isSealed(blob: String): Boolean = blob.startsWith(PREFIX)

    fun encode(rawIvAndCiphertext: ByteArray): String =
        PREFIX + Base64.encode(rawIvAndCiphertext)

    /** Payload after `ks:`, or null if not a sealed blob. */
    fun decodePayload(blob: String): ByteArray? {
        if (!isSealed(blob)) return null
        return try {
            Base64.decode(blob.removePrefix(PREFIX))
        } catch (_: Throwable) {
            null
        }
    }
}
