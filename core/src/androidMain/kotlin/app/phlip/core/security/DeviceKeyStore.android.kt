package app.phlip.core.security

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Android Keystore AES-256-GCM custody. Prefs store Base64(iv‖ct) without the
 * `ks:` file prefix — [SecureStore] / [SealedBlobFormat] add that for host files.
 */
actual class DeviceKeyStore actual constructor(
    storeName: String,
    private val keyAlias: String,
) {
    private val prefs: SharedPreferences =
        AndroidCryptoContext.require().getSharedPreferences(storeName, Context.MODE_PRIVATE)

    actual fun seal(plaintext: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORM).apply {
            init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        }
        val iv = cipher.iv
        val ct = cipher.doFinal(plaintext)
        return iv + ct
    }

    actual fun open(sealed: ByteArray): ByteArray? {
        if (sealed.size <= IV_LEN) return null
        return try {
            val iv = sealed.copyOfRange(0, IV_LEN)
            val ct = sealed.copyOfRange(IV_LEN, sealed.size)
            val cipher = Cipher.getInstance(TRANSFORM).apply {
                init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(TAG_BITS, iv))
            }
            cipher.doFinal(ct)
        } catch (t: Throwable) {
            Log.e(TAG, "open failed", t)
            null
        }
    }

    actual fun getSecret(key: String): String? {
        val blob = prefs.getString(key, null) ?: return null
        return try {
            val data = Base64.decode(blob, Base64.NO_WRAP)
            val plain = open(data) ?: error("undecryptable")
            String(plain, Charsets.UTF_8)
        } catch (t: Throwable) {
            Log.e(TAG, "decrypt failed for '$key'; clearing", t)
            prefs.edit().remove(key).apply()
            null
        }
    }

    actual fun putSecret(key: String, value: String) {
        try {
            val sealed = seal(value.toByteArray(Charsets.UTF_8))
            prefs.edit().putString(key, Base64.encodeToString(sealed, Base64.NO_WRAP)).apply()
        } catch (t: Throwable) {
            Log.e(TAG, "encrypt failed for '$key'; not stored", t)
        }
    }

    actual fun removeSecret(key: String) {
        prefs.edit().remove(key).apply()
    }

    actual fun clearSecrets() {
        prefs.edit().clear().apply()
    }

    @Synchronized
    private fun getOrCreateKey(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (ks.getEntry(keyAlias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        gen.init(
            KeyGenParameterSpec.Builder(
                keyAlias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    companion object {
        private const val TAG = "DeviceKeyStore"
        private const val KEYSTORE = "AndroidKeyStore"
        private const val TRANSFORM = "AES/GCM/NoPadding"
        private const val IV_LEN = 12
        private const val TAG_BITS = 128
    }
}
