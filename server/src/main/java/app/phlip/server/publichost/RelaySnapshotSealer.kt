package app.phlip.server.publichost

import android.util.Base64
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * Seal a welcome-shaped relay snapshot so members can open it with [conn.key]
 * (PBKDF2 of group passphrase + [e2eSalt] → AES-256-GCM `e2e:` blob).
 * Matches `phlip-web/public/scripts/boot/crypto.js` encrypt/decrypt — not PassphraseEnvelope.
 */
object RelaySnapshotSealer {
    private const val ITER = 150_000
    private const val KEY_BITS = 256
    private const val GCM_TAG_BITS = 128
    private val rng = SecureRandom()

    fun seal(passphrase: String, e2eSaltB64: String, plaintextUtf8: String): String {
        require(passphrase.isNotEmpty()) { "Missing group passphrase" }
        require(e2eSaltB64.isNotBlank()) { "Missing e2eSalt" }
        val salt = b64d(e2eSaltB64) ?: throw IllegalArgumentException("Bad e2eSalt")
        val key = deriveKey(passphrase, salt, ITER)
        val iv = ByteArray(12).also { rng.nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
        val ct = cipher.doFinal(plaintextUtf8.toByteArray(Charsets.UTF_8))
        val out = ByteArray(iv.size + ct.size)
        System.arraycopy(iv, 0, out, 0, iv.size)
        System.arraycopy(ct, 0, out, iv.size, ct.size)
        return "e2e:" + Base64.encodeToString(out, Base64.NO_WRAP)
    }

    private fun deriveKey(passphrase: String, salt: ByteArray, iter: Int): SecretKeySpec {
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val spec = PBEKeySpec(passphrase.toCharArray(), salt, iter, KEY_BITS)
        val bits = factory.generateSecret(spec).encoded
        return SecretKeySpec(bits, "AES")
    }

    private fun b64d(s: String): ByteArray? = try {
        Base64.decode(s, Base64.DEFAULT)
    } catch (_: Exception) {
        null
    }
}
