package app.phlip.server

import app.phlip.core.security.SecureStore
import com.google.gson.Gson
import java.io.File

/**
 * Owns the raw persisted representation of one hosted server.
 *
 * Schema repair and migration are orchestrated by [ServerRuntime] /
 * [ServerStateMigrations]. This class deliberately isolates I/O and at-rest
 * sealing so migrations can move without changing persistence semantics.
 */
internal class ServerPersistence(
    private val dataFile: File,
    private val gson: Gson,
    private val atRest: SecureStore?,
) {
    internal data class ReadResult(
        val state: AppState?,
        val raw: String,
        val sealedButUnreadable: Boolean,
    )

    fun read(): ReadResult? {
        if (!dataFile.exists()) return null
        return try {
            val raw = dataFile.readText()
            val json = atRest?.open(raw) ?: raw
            val sealedButUnreadable = json.isEmpty() && raw.isNotEmpty() && SecureStore.isSealedBlob(raw)
            ReadResult(
                state = if (sealedButUnreadable) null else gson.fromJson(json, AppState::class.java),
                raw = raw,
                sealedButUnreadable = sealedButUnreadable,
            )
        } catch (_: Exception) {
            null
        }
    }

    /** Returns false when persistence failed or at-rest sealing could not complete. */
    fun save(state: AppState): Boolean {
        return try {
            val json = gson.toJson(state)
            val text = if (atRest != null) atRest.seal(json) else json
            if (text.isEmpty()) return false
            dataFile.writeText(text)
            true
        } catch (_: Exception) {
            false
        }
    }

    fun needsSeal(raw: String): Boolean = atRest != null && raw.isNotEmpty() && !atRest.isSealed(raw)

    fun displayName(): String = dataFile.name
}
