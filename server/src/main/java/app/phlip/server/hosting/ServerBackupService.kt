package app.phlip.server.hosting

import android.content.Context
import app.phlip.core.security.PassphraseEnvelope
import app.phlip.core.security.SecureStore
import app.phlip.server.AppState
import app.phlip.server.Category
import app.phlip.server.Channel
import app.phlip.server.CustomRole
import app.phlip.server.DrServer
import app.phlip.server.EventType
import app.phlip.server.HostedServer
import app.phlip.server.PlaceEntry
import app.phlip.server.PlaceEntryListAdapter
import app.phlip.server.RolePermFlags
import app.phlip.server.ServerPersistence
import app.phlip.server.ServerRegistry
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.reflect.TypeToken
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * Host-only server backup: structure (deck/channels/roles/settings) and full
 * (identity + AppState). Passphrase envelopes match personal Tier‑1 `.phlip`.
 */
class ServerBackupService(
    private val context: Context,
    private val registry: ServerRegistry,
    private val liveServers: ConcurrentHashMap<String, DrServer>,
    private val startInstance: (HostedServer) -> Unit,
    private val stopInstance: (String) -> Unit,
    private val publishStatus: () -> Unit,
    private val mintHostUser: (serverId: String, hostName: String) -> Unit,
) {
    private val gson: Gson = GsonBuilder()
        .registerTypeAdapter(
            object : TypeToken<MutableList<PlaceEntry>>() {}.type,
            PlaceEntryListAdapter(),
        )
        .create()
    private val atRest: SecureStore by lazy { SecureStore.hostAtRest(context) }

    data class Preview(
        val kind: String,
        val exportedAt: Long,
        val serverId: String,
        val serverName: String,
        val channelCount: Int,
        val eventTypeCount: Int,
        val memberCount: Int,
        val eventCount: Int,
        val payloadJson: String,
    )

    fun exportSealed(serverId: String, kind: String, passphrase: String): Result<ByteArray> {
        return try {
            require(passphrase.length >= 8) { "Passphrase must be at least 8 characters" }
            val hs = registry.get(serverId) ?: return Result.failure(IllegalArgumentException("Server not found"))
            val appJson = loadAppStateJson(hs)
                ?: return Result.failure(IllegalStateException("Could not read server data"))
            val plain = when (kind) {
                PassphraseEnvelope.KIND_SERVER_STRUCTURE -> buildStructurePlaintext(hs, appJson)
                PassphraseEnvelope.KIND_SERVER_FULL -> buildFullPlaintext(hs, appJson)
                else -> return Result.failure(IllegalArgumentException("Unknown backup kind"))
            }
            val envelope = PassphraseEnvelope.seal(kind, passphrase, plain)
            Result.success(envelope.toByteArray(Charsets.UTF_8))
        } catch (t: Throwable) {
            Result.failure(t)
        }
    }

    fun unlockPreview(passphrase: String, envelopeBytes: ByteArray): Result<Preview> {
        return try {
            val envelopeJson = String(envelopeBytes, Charsets.UTF_8)
            val peek = PassphraseEnvelope.peek(envelopeJson)
                ?: return Result.failure(IllegalArgumentException("Not a Phlip backup file"))
            when (peek.kind) {
                PassphraseEnvelope.KIND_SERVER_STRUCTURE,
                PassphraseEnvelope.KIND_SERVER_FULL,
                -> Unit
                PassphraseEnvelope.KIND_PERSONAL ->
                    return Result.failure(IllegalArgumentException("That file is a personal backup — use User settings → Restore"))
                else ->
                    return Result.failure(IllegalArgumentException("Unsupported backup kind (${peek.kind})"))
            }
            val plain = PassphraseEnvelope.open(passphrase, envelopeJson)
                ?: return Result.failure(IllegalArgumentException("Wrong passphrase or corrupt file"))
            val root = JSONObject(plain)
            if (root.optInt("schema") != 1) {
                return Result.failure(IllegalArgumentException("Unsupported backup schema"))
            }
            val kind = root.optString("kind")
            if (kind != peek.kind) {
                return Result.failure(IllegalArgumentException("Backup kind mismatch"))
            }
            Result.success(previewFromPlain(kind, plain, root))
        } catch (t: Throwable) {
            Result.failure(t)
        }
    }

    /**
     * @param targetServerId existing server to overwrite structure, or null/blank to create new
     * @param newServerName name when creating
     * @param hostDisplayName mint host user on new server
     */
    fun applyStructure(
        payloadJson: String,
        targetServerId: String?,
        newServerName: String?,
        hostDisplayName: String,
    ): Result<String> {
        return try {
            val root = JSONObject(payloadJson)
            if (root.optString("kind") != PassphraseEnvelope.KIND_SERVER_STRUCTURE) {
                return Result.failure(IllegalArgumentException("Not a structure backup"))
            }
            val structureJson = root.getJSONObject("structure").toString()
            val hintName = root.optString("serverNameHint").ifBlank { "Server" }
            val targetId = targetServerId?.trim().orEmpty()
            if (targetId.isNotEmpty()) {
                val hs = registry.get(targetId)
                    ?: return Result.failure(IllegalArgumentException("Target server not found"))
                val live = liveServers[targetId]
                if (live != null) {
                    if (!live.applyStructureJson(structureJson)) {
                        return Result.failure(IllegalStateException("Could not apply structure"))
                    }
                } else {
                    val state = readAppState(hs) ?: AppState()
                    val src = gson.fromJson(structureJson, AppState::class.java)
                        ?: return Result.failure(IllegalStateException("Bad structure JSON"))
                    copyStructureInto(state, src, gson)
                    if (!writeAppState(hs, state)) {
                        return Result.failure(IllegalStateException("Could not save structure"))
                    }
                }
                publishStatus()
                Result.success(targetId)
            } else {
                val name = newServerName?.trim().orEmpty().ifBlank { "$hintName (copy)" }
                val hs = registry.add(name, newGroupSecret())
                val state = AppState()
                val src = gson.fromJson(structureJson, AppState::class.java)
                    ?: return Result.failure(IllegalStateException("Bad structure JSON"))
                copyStructureInto(state, src, gson)
                if (!writeAppState(hs, state)) {
                    registry.remove(hs.id)
                    return Result.failure(IllegalStateException("Could not save new server"))
                }
                startInstance(hs)
                mintHostUser(hs.id, hostDisplayName.ifBlank { "Host" })
                publishStatus()
                Result.success(hs.id)
            }
        } catch (t: Throwable) {
            Result.failure(t)
        }
    }

    /** Same-ID full replace (or install when id absent). */
    fun applyFull(payloadJson: String): Result<String> {
        return try {
            val root = JSONObject(payloadJson)
            if (root.optString("kind") != PassphraseEnvelope.KIND_SERVER_FULL) {
                return Result.failure(IllegalArgumentException("Not a full server backup"))
            }
            val hosted = root.getJSONObject("hostedServer")
            val appStateJson = root.getJSONObject("appState").toString()
            val id = hosted.getString("id")
            val name = hosted.optString("name").ifBlank { "Restored server" }
            val passphrase = hosted.optString("passphrase")
            if (passphrase.isBlank()) {
                return Result.failure(IllegalArgumentException("Backup missing group secret"))
            }
            val joinTag = hosted.optString("joinTag")
            val reachMode = hosted.optString("reachMode", ServerRegistry.REACH_LOCAL)
            val publicSubdomain = hosted.optString("publicSubdomain")

            stopInstance(id)
            val hs = registry.importOrReplace(
                id = id,
                name = name,
                passphrase = passphrase,
                joinTag = joinTag,
                reachMode = reachMode,
                publicSubdomain = publicSubdomain,
            )
            val state = gson.fromJson(appStateJson, AppState::class.java)
                ?: return Result.failure(IllegalStateException("Bad appState JSON"))
            if (!writeAppState(hs, state)) {
                return Result.failure(IllegalStateException("Could not write restored data"))
            }
            startInstance(hs)
            publishStatus()
            Result.success(id)
        } catch (t: Throwable) {
            Result.failure(t)
        }
    }

    fun suggestedName(kind: String, serverName: String): String {
        val d = java.util.Calendar.getInstance()
        val stamp = String.format(
            "%04d-%02d-%02d-%02d%02d",
            d.get(java.util.Calendar.YEAR),
            d.get(java.util.Calendar.MONTH) + 1,
            d.get(java.util.Calendar.DAY_OF_MONTH),
            d.get(java.util.Calendar.HOUR_OF_DAY),
            d.get(java.util.Calendar.MINUTE),
        )
        val safe = serverName.trim().lowercase()
            .replace(Regex("[^a-z0-9]+"), "-")
            .trim('-')
            .take(24)
            .ifBlank { "server" }
        val prefix = when (kind) {
            PassphraseEnvelope.KIND_SERVER_STRUCTURE -> "phlip-server-structure"
            else -> "phlip-server-full"
        }
        return "$prefix-$safe-$stamp.phlip"
    }

    private fun previewFromPlain(kind: String, plain: String, root: JSONObject): Preview {
        val exportedAt = root.optLong("exportedAt", 0L)
        return when (kind) {
            PassphraseEnvelope.KIND_SERVER_STRUCTURE -> {
                val structure = root.getJSONObject("structure")
                val state = gson.fromJson(structure.toString(), AppState::class.java) ?: AppState()
                Preview(
                    kind = kind,
                    exportedAt = exportedAt,
                    serverId = "",
                    serverName = root.optString("serverNameHint"),
                    channelCount = state.channels.size,
                    eventTypeCount = state.eventTypes.size,
                    memberCount = 0,
                    eventCount = 0,
                    payloadJson = plain,
                )
            }
            else -> {
                val hosted = root.getJSONObject("hostedServer")
                val state = gson.fromJson(root.getJSONObject("appState").toString(), AppState::class.java)
                    ?: AppState()
                Preview(
                    kind = kind,
                    exportedAt = exportedAt,
                    serverId = hosted.optString("id"),
                    serverName = hosted.optString("name"),
                    channelCount = state.channels.size,
                    eventTypeCount = state.eventTypes.size,
                    memberCount = state.users.size,
                    eventCount = state.events.size,
                    payloadJson = plain,
                )
            }
        }
    }

    private fun buildStructurePlaintext(hs: HostedServer, appJson: String): String {
        val full = gson.fromJson(appJson, AppState::class.java) ?: AppState()
        val structure = extractStructure(full)
        return JSONObject()
            .put("schema", 1)
            .put("kind", PassphraseEnvelope.KIND_SERVER_STRUCTURE)
            .put("exportedAt", System.currentTimeMillis())
            .put("serverNameHint", hs.name)
            .put("structure", JSONObject(gson.toJson(structure)))
            .toString()
    }

    private fun buildFullPlaintext(hs: HostedServer, appJson: String): String {
        val hosted = JSONObject()
            .put("id", hs.id)
            .put("name", hs.name)
            .put("joinTag", hs.joinTag)
            .put("passphrase", hs.passphrase)
            .put("reachMode", hs.reachMode)
            .put("publicSubdomain", hs.publicSubdomain)
        return JSONObject()
            .put("schema", 1)
            .put("kind", PassphraseEnvelope.KIND_SERVER_FULL)
            .put("exportedAt", System.currentTimeMillis())
            .put("hostedServer", hosted)
            .put("appState", JSONObject(appJson))
            .toString()
    }

    private fun extractStructure(full: AppState): AppState {
        val slim = AppState()
        copyStructureInto(slim, full, gson)
        return slim
    }

    private fun loadAppStateJson(hs: HostedServer): String? {
        val live = liveServers[hs.id]
        if (live != null) return live.snapshotAppStateJson()
        val state = readAppState(hs) ?: return null
        return gson.toJson(state)
    }

    private fun readAppState(hs: HostedServer): AppState? {
        val file = File(context.filesDir, hs.dataFile)
        val persistence = ServerPersistence(file, gson, atRest)
        return persistence.read()?.state
    }

    private fun writeAppState(hs: HostedServer, state: AppState): Boolean {
        val file = File(context.filesDir, hs.dataFile)
        val persistence = ServerPersistence(file, gson, atRest)
        return persistence.save(state)
    }

    private fun newGroupSecret(): String {
        val b = ByteArray(24)
        java.security.SecureRandom().nextBytes(b)
        return android.util.Base64.encodeToString(
            b,
            android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP,
        )
    }

    companion object {
        fun copyStructureInto(dest: AppState, src: AppState, gson: Gson) {
            dest.categories = deepCopyList(src.categories, gson, Category::class.java)
            dest.cardCats = src.cardCats.toMutableMap()
            dest.cardDurations = src.cardDurations.toMutableMap()
            dest.removedCards = src.removedCards.toMutableList()
            dest.locations = deepCopyList(src.locations, gson, PlaceEntry::class.java)
            dest.eventTypes = deepCopyList(src.eventTypes, gson, EventType::class.java)
            dest.reactionCards = src.reactionCards?.toMutableList()
            dest.allowFreeform = src.allowFreeform
            dest.allowMultiLocations = src.allowMultiLocations
            dest.allowPinnedPeople = src.allowPinnedPeople
            dest.setupPreset = src.setupPreset
            dest.setupActivity = src.setupActivity
            dest.offerAutoInclude = src.offerAutoInclude
            dest.allowUserCreateEvents = src.allowUserCreateEvents
            dest.createEvents = src.createEvents
            dest.createEventTypes = src.createEventTypes
            dest.addLocations = src.addLocations
            dest.inviteToGroup = src.inviteToGroup
            dest.liveProfilePhotos = src.liveProfilePhotos
            dest.allowProfilePics = src.allowProfilePics
            dest.allowUserDraw = src.allowUserDraw
            dest.cardTheme = src.cardTheme
            dest.defaultRole = src.defaultRole
            dest.customRoles = src.customRoles?.let { deepCopyList(it, gson, CustomRole::class.java) }
            dest.eventRolePerms = src.eventRolePerms?.mapValues { (_, v) ->
                gson.fromJson(gson.toJson(v), RolePermFlags::class.java)
            }?.toMutableMap()
            dest.minAge = src.minAge
            dest.purgeEndedEvents = src.purgeEndedEvents
            dest.chatRetentionDays = src.chatRetentionDays
            dest.serverPic = src.serverPic
            dest.description = src.description
            dest.eventsRequireApprovalDefault = src.eventsRequireApprovalDefault
            dest.iconText = src.iconText
            if (src.hostName.isNotBlank()) dest.hostName = src.hostName
            dest.channels = src.channels.map {
                gson.fromJson(gson.toJson(it), Channel::class.java)
            }.toMutableList()
        }

        private fun <T> deepCopyList(list: List<T>, gson: Gson, elementClass: Class<T>): MutableList<T> {
            val tree = gson.toJsonTree(list)
            if (!tree.isJsonArray) return mutableListOf()
            return tree.asJsonArray.map { gson.fromJson(it, elementClass) }.toMutableList()
        }
    }
}
