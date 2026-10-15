package app.phlip.server.local

import android.content.Context
import android.util.Log
import app.phlip.core.security.SecureStore
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Per-network hosting approval. Fingerprints are hashes of gateway/DNS/domain/subnet/
 * transport — never raw values. See approved-networks plan: serving is opt-in per LAN.
 *
 * Hashing / LAN snapshot logic lives in [NetworkFingerprint].
 */
class ApprovedNetworks(ctx: Context) {

    private val appCtx = ctx.applicationContext
    private val store = SecureStore(appCtx, PREFS_NAME, KEY_ALIAS)

    enum class Trust { TRUSTED, ONCE }

    data class Record(
        val fpHash: String,
        val trust: Trust,
        val label: String?,
        val firstSeen: Long,
        val lastSeen: Long,
        val transport: String,
    )

    data class Fingerprint(
        val hash: String,
        val transport: String,
        val label: String? = null,
    )

    /** Current LAN evaluation for the host gate. */
    sealed class Evaluation {
        /** No LAN to approve — cellular-only (or similar); tunnel may run. */
        data object CellularExempt : Evaluation()
        /** This phone is the AP — auto-Trusted. */
        data class HotspotTrusted(val fp: Fingerprint) : Evaluation()
        data class Known(val fp: Fingerprint, val record: Record) : Evaluation()
        data class Unknown(val fp: Fingerprint) : Evaluation()
        /** No usable network / still settling. */
        data object None : Evaluation()
    }

    fun list(): List<Record> = load().sortedByDescending { it.lastSeen }

    fun lookup(fpHash: String): Record? =
        load().firstOrNull { it.fpHash == fpHash }

    /**
     * Silent resume only for [Trust.TRUSTED]. [Trust.ONCE] is session-scoped:
     * cleared when leaving that network so a later return prompts again.
     */
    fun trustedMatch(fpHash: String): Record? =
        lookup(fpHash)?.takeIf { it.trust == Trust.TRUSTED }?.also { touch(it.fpHash) }

    fun approve(fp: Fingerprint, trust: Trust, label: String? = null): Record {
        val now = System.currentTimeMillis()
        val list = load().toMutableList()
        val existing = list.indexOfFirst { it.fpHash == fp.hash }
        val rec = if (existing >= 0) {
            val old = list[existing]
            old.copy(
                trust = trust,
                label = label ?: old.label,
                lastSeen = now,
                transport = fp.transport.ifEmpty { old.transport },
            ).also { list[existing] = it }
        } else {
            Record(
                fpHash = fp.hash,
                trust = trust,
                label = label ?: fp.label,
                firstSeen = now,
                lastSeen = now,
                transport = fp.transport,
            ).also { list.add(it) }
        }
        trimAndSave(list)
        notifyChanged()
        return rec
    }

    fun setTrust(fpHash: String, trust: Trust): Record? {
        val list = load().toMutableList()
        val i = list.indexOfFirst { it.fpHash == fpHash }
        if (i < 0) return null
        val updated = list[i].copy(trust = trust, lastSeen = System.currentTimeMillis())
        list[i] = updated
        trimAndSave(list)
        notifyChanged()
        return updated
    }

    fun forget(fpHash: String) {
        trimAndSave(load().filterNot { it.fpHash == fpHash })
        notifyChanged()
    }

    fun forgetAll() {
        store.remove(KEY_LIST)
        notifyChanged()
    }

    /** Drop ONCE records when leaving that network (return must prompt again). */
    fun clearOnce(fpHash: String) {
        val rec = lookup(fpHash) ?: return
        if (rec.trust == Trust.ONCE) forget(fpHash)
    }

    fun touch(fpHash: String) {
        val list = load().toMutableList()
        val i = list.indexOfFirst { it.fpHash == fpHash }
        if (i < 0) return
        list[i] = list[i].copy(lastSeen = System.currentTimeMillis())
        trimAndSave(list)
    }

    /**
     * If the current LAN fingerprint has an SSID (or Ethernet) label and a stored
     * approval for that hash is missing/outdated, write it. Returns true when saved.
     */
    fun backfillCurrentLabelIfPossible(ctx: Context = appCtx): Boolean {
        val fp = currentFingerprint(ctx) ?: return false
        val label = fp.label?.trim()?.takeIf { it.isNotEmpty() } ?: return false
        val rec = lookup(fp.hash) ?: return false
        if (rec.label == label) return false
        approve(fp, rec.trust, label = label)
        return true
    }

    fun evaluate(ctx: Context = appCtx): Evaluation {
        if (NetworkFingerprint.isHotspotActive(ctx)) {
            val fp = currentFingerprint(ctx)
            return if (fp != null) Evaluation.HotspotTrusted(fp)
            else Evaluation.HotspotTrusted(NetworkFingerprint.hotspotFallbackFingerprint())
        }
        val snap = NetworkFingerprint.lanNetworkSnapshot(ctx) ?: return Evaluation.None
        if (snap.cellularOnly) return Evaluation.CellularExempt
        val fp = snap.fingerprint ?: return Evaluation.None
        val known = lookup(fp.hash)
        return if (known != null) Evaluation.Known(fp, known) else Evaluation.Unknown(fp)
    }

    fun currentFingerprint(ctx: Context = appCtx): Fingerprint? =
        NetworkFingerprint.lanNetworkSnapshot(ctx)?.fingerprint

    private fun load(): List<Record> {
        val raw = store.getString(KEY_LIST, "")
        if (raw.isEmpty()) return emptyList()
        return try {
            val arr = JSONArray(raw)
            buildList {
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    val trust = when (o.optString("trust")) {
                        "TRUSTED" -> Trust.TRUSTED
                        "ONCE" -> Trust.ONCE
                        else -> continue
                    }
                    val fp = o.optString("fpHash")
                    if (fp.isEmpty()) continue
                    add(
                        Record(
                            fpHash = fp,
                            trust = trust,
                            label = o.optString("label").ifEmpty { null },
                            firstSeen = o.optLong("firstSeen"),
                            lastSeen = o.optLong("lastSeen"),
                            transport = o.optString("transport"),
                        ),
                    )
                }
            }
        } catch (t: Throwable) {
            Log.w(TAG, "failed to load approved networks", t)
            emptyList()
        }
    }

    private fun trimAndSave(list: List<Record>) {
        val trimmed = list.sortedByDescending { it.lastSeen }.take(MAX_RECORDS)
        val arr = JSONArray()
        for (r in trimmed) {
            arr.put(
                JSONObject()
                    .put("fpHash", r.fpHash)
                    .put("trust", r.trust.name)
                    .put("label", r.label ?: "")
                    .put("firstSeen", r.firstSeen)
                    .put("lastSeen", r.lastSeen)
                    .put("transport", r.transport),
            )
        }
        store.putString(KEY_LIST, arr.toString())
    }

    companion object {
        private const val TAG = "AshApprovedNet"
        const val PREFS_NAME = "ash_approved_networks_v1"
        private const val KEY_ALIAS = "ash_approved_networks_key"
        private const val KEY_LIST = "networks"
        private const val MAX_RECORDS = 32

        fun sha256Hex(s: String): String = NetworkFingerprint.sha256Hex(s)

        /** Soft-AP / hotspot — phone is the access point. */
        fun isHotspotActive(ctx: Context): Boolean = NetworkFingerprint.isHotspotActive(ctx)

        /** In-memory listeners for Settings UI refresh (optional). */
        private val listeners = CopyOnWriteArrayList<() -> Unit>()
        fun addChangeListener(l: () -> Unit) {
            listeners.add(l)
        }

        fun removeChangeListener(l: () -> Unit) {
            listeners.remove(l)
        }

        fun notifyChanged() {
            for (l in listeners) try {
                l()
            } catch (_: Throwable) {
            }
        }
    }
}
