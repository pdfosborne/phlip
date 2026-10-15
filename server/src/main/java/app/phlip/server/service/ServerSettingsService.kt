package app.phlip.server

import org.json.JSONObject

/**
 * Host-managed server settings mutations (`updateServerSettings` RPC).
 *
 * **Store:** permission floors and feature flags on [AppState] (createEvents,
 * createEventTypes, addLocations, profile/draw, cardTheme, defaultRole,
 * forceJoinCode, minAge, purge/retention, description, clone defaults, etc.).
 *
 * **User → host:** member RPC `updateServerSettings` (managers only).
 *
 * **Host → users:** `{ type: "serverSettings", serverSettings }` broadcast;
 * optional full `sync` when pinned-people feature toggles with existing pins;
 * may trigger ended-event / chat-retention sweeps.
 * `forceJoinCode` delegates to [InviteCoordinator] via [Operations.setForceJoinCode].
 */
internal class ServerSettingsService(
    private val stateProvider: () -> AppState,
    private val authorization: ServerAuthorization,
    private val operations: Operations,
) {
    internal data class Operations(
        val save: () -> Unit,
        val broadcast: (JSONObject) -> Unit,
        val serverSettingsPayload: () -> JSONObject,
        val setForceJoinCode: (Boolean) -> Unit,
        val pushSyncToAll: () -> Unit,
        val sweepEndedEventPurge: () -> Unit,
        val sweepChatRetention: () -> Unit,
        /** Clear RAM livePics and broadcast null for each cleared id. */
        val clearAllLivePics: () -> Unit,
        /** Clear every member's persisted [User.profilePic]. */
        val clearAllProfilePics: () -> Unit,
        val presence: () -> Unit,
    )

    private val state get() = stateProvider()

    fun cmdUpdateServerSettings(user: User, m: JSONObject) {
        if (!authorization.canManageServer(user)) return
        if (m.has("createEvents")) {
            val level = normalizeMemberPerm(m.optString("createEvents"), PERM_MODERATOR)
            state.createEvents = level
            state.allowUserCreateEvents = level == PERM_EVERYONE
        } else if (m.has("allowUserCreateEvents")) {
            // Legacy boolean — map onto createEvents.
            state.allowUserCreateEvents = m.optBoolean("allowUserCreateEvents", true)
            state.createEvents = if (state.allowUserCreateEvents) PERM_EVERYONE else PERM_MODERATOR
        }
        if (m.has("createEventTypes")) {
            state.createEventTypes = normalizeMemberPerm(m.optString("createEventTypes"), PERM_MODERATOR)
        }
        if (m.has("addLocations")) {
            state.addLocations = normalizeMemberPerm(m.optString("addLocations"), PERM_MODERATOR)
        }
        // inviteToGroup is hard-fixed admin-only; ignore client attempts to widen it.
        if (m.has("inviteToGroup")) {
            state.inviteToGroup = PERM_ADMIN
        }
        var livePhotosChanged = false
        val prevLivePhotos = state.effectiveLiveProfilePhotos()
        if (m.has("liveProfilePhotos")) {
            val next = normalizeLiveProfilePhotos(m.optString("liveProfilePhotos"), null)
            if (next != prevLivePhotos) {
                state.applyLiveProfilePhotos(next)
                livePhotosChanged = true
            }
        } else if (m.has("allowProfilePics")) {
            // Legacy boolean — map onto liveProfilePhotos.
            val next = if (m.optBoolean("allowProfilePics", true)) {
                LIVE_PROFILE_PHOTOS_ONLINE
            } else {
                LIVE_PROFILE_PHOTOS_OFF
            }
            if (next != prevLivePhotos) {
                state.applyLiveProfilePhotos(next)
                livePhotosChanged = true
            }
        }
        if (m.has("allowUserDraw")) {
            state.allowUserDraw = m.optBoolean("allowUserDraw", true)
        }
        if (m.has("cardTheme")) {
            val t = m.optString("cardTheme").trim().lowercase()
            if (t in setOf("classic", "bold", "soft", "mono")) state.cardTheme = t
        }
        if (m.has("defaultRole")) {
            val r = m.optString("defaultRole").trim().lowercase()
            if (r in ASSIGNABLE_ROLES) {
                if (r == ROLE_ADMIN && effectiveRole(user) != ROLE_HOST) {
                    // Only the host may make Admin the default for new joins.
                } else {
                    state.defaultRole = r
                }
            }
        }
        if (m.has("forceJoinCode")) {
            operations.setForceJoinCode(m.optBoolean("forceJoinCode", false))
            return
        }
        if (m.has("minAge")) {
            state.minAge = clampMinAge(m.optInt("minAge", 18))
        }
        if (m.has("purgeEndedEvents")) {
            state.purgeEndedEvents = m.optBoolean("purgeEndedEvents", false)
        }
        if (m.has("allowMultiLocations")) {
            state.allowMultiLocations = m.optBoolean("allowMultiLocations", false)
        }
        if (m.has("allowPinnedPeople")) {
            state.allowPinnedPeople = m.optBoolean("allowPinnedPeople", false)
        }
        if (m.has("chatRetentionDays")) {
            state.chatRetentionDays = clampChatRetentionDays(m.optInt("chatRetentionDays", 0))
        }
        if (m.has("description")) {
            state.description = m.optString("description").trim().take(MAX_SERVER_DESCRIPTION).ifEmpty { null }
        }
        if (m.has("eventsRequireApprovalDefault")) {
            state.eventsRequireApprovalDefault = m.optBoolean("eventsRequireApprovalDefault", false)
        }
        if (livePhotosChanged) {
            applyLiveProfilePhotosModeChange(state.effectiveLiveProfilePhotos())
        }
        operations.save()
        operations.broadcast(
            JSONObject().put("type", "serverSettings").put("serverSettings", operations.serverSettingsPayload()),
        )
        // § pinned people — toggling the feature must rebuild/clear reserved stubs.
        if (m.has("allowPinnedPeople") && state.channels.any { it.pinnedUserId != null }) {
            operations.pushSyncToAll()
        }
        if (state.purgeEndedEvents) operations.sweepEndedEventPurge()
        if (state.chatRetentionDays > 0) operations.sweepChatRetention()
    }

    /**
     * When the camera-photo mode changes, drop the store that no longer applies
     * so clients don't keep seeing the wrong visibility.
     */
    private fun applyLiveProfilePhotosModeChange(to: String) {
        when (to) {
            LIVE_PROFILE_PHOTOS_OFF -> {
                operations.clearAllLivePics()
                operations.clearAllProfilePics()
                operations.presence()
            }
            LIVE_PROFILE_PHOTOS_ONLINE -> {
                // No longer always-viewable — wipe persisted JPEGs.
                operations.clearAllProfilePics()
                operations.presence()
            }
            LIVE_PROFILE_PHOTOS_ALWAYS -> {
                // Persisted profilePic is source of truth — drop RAM session photos.
                operations.clearAllLivePics()
                operations.presence()
            }
        }
    }

    private fun clampChatRetentionDays(raw: Int): Int =
        when (raw) {
            1, 7, 30, 90 -> raw
            else -> 0
        }
}
