package app.phlip.core.security

import android.util.Base64
import org.json.JSONObject
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * Portable passphrase seal matching personal Tier‑1 `.phlip` envelopes in
 * `phlip-web/public/scripts/personal/backup.js` (PBKDF2-SHA256 150k → AES-256-GCM).
 *
 * Used for server structure/full backups so files travel across devices;
 * Keystore `ks:` seals stay on-device only.
 */
object PassphraseEnvelope {
    const val PHLIP = 1
    const val KDF = "pbkdf2-sha256"
    const val ITER = 150_000
    const val SALT_LEN = 16
    const val IV_LEN = 12
    const val KEY_BITS = 256
    const val GCM_TAG_BITS = 128

    const val KIND_PERSONAL = "personal"
    const val KIND_SERVER_STRUCTURE = "server-structure"
    const val KIND_SERVER_FULL = "server-full"

    private val rng = SecureRandom()

    fun seal(kind: String, passphrase: String, plaintextUtf8: String): String {
        require(passphrase.length >= 8) { "Passphrase must be at least 8 characters" }
        val salt = ByteArray(SALT_LEN).also { rng.nextBytes(it) }
        val iv = ByteArray(IV_LEN).also { rng.nextBytes(it) }
        val key = deriveKey(passphrase, salt, ITER)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
        val ct = cipher.doFinal(plaintextUtf8.toByteArray(Charsets.UTF_8))
        return JSONObject()
            .put("phlip", PHLIP)
            .put("kind", kind)
            .put("kdf", KDF)
            .put("iter", ITER)
            .put("salt", b64(salt))
            .put("iv", b64(iv))
            .put("ct", b64(ct))
            .toString()
    }

    /**
     * Decrypts [envelopeJson]. Returns plaintext UTF-8, or null on wrong
     * passphrase / corrupt / unsupported envelope.
     */
    fun open(passphrase: String, envelopeJson: String): String? {
        return try {
            val o = JSONObject(envelopeJson)
            if (o.optInt("phlip") != PHLIP) return null
            if (o.optString("kdf") != KDF) return null
            val salt = b64d(o.getString("salt")) ?: return null
            val iv = b64d(o.getString("iv")) ?: return null
            val ct = b64d(o.getString("ct")) ?: return null
            val iter = o.optInt("iter", ITER).coerceAtLeast(10_000)
            val key = deriveKey(passphrase, salt, iter)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
            String(cipher.doFinal(ct), Charsets.UTF_8)
        } catch (_: Exception) {
            null
        }
    }

    /** Peek envelope metadata without decrypting. */
    fun peek(envelopeJson: String): Peek? {
        return try {
            val o = JSONObject(envelopeJson)
            if (o.optInt("phlip") != PHLIP) return null
            Peek(
                kind = o.optString("kind"),
                kdf = o.optString("kdf"),
                iter = o.optInt("iter", ITER),
            )
        } catch (_: Exception) {
            null
        }
    }

    data class Peek(val kind: String, val kdf: String, val iter: Int)

    private fun deriveKey(passphrase: String, salt: ByteArray, iter: Int): SecretKeySpec {
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val spec = PBEKeySpec(passphrase.toCharArray(), salt, iter, KEY_BITS)
        val bits = factory.generateSecret(spec).encoded
        return SecretKeySpec(bits, "AES")
    }

    private fun b64(bytes: ByteArray): String =
        Base64.encodeToString(bytes, Base64.NO_WRAP)

    private fun b64d(s: String): ByteArray? = try {
        Base64.decode(s, Base64.DEFAULT)
    } catch (_: Exception) {
        null
    }
}
