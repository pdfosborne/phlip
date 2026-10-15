package app.phlip.server

import org.json.JSONObject

/**
 * Server branding and member profile/presence media content type.
 *
 * **Store (persisted in AppState):** [AppState.iconText], [AppState.serverPic]
 * (JPEG data-URL), [User.profilePic] (when [LIVE_PROFILE_PHOTOS_ALWAYS]),
 * [User.offlineAvatar].
 *
 * **Store (RAM only):** [CollaborationCommandSupport.livePics] — JPEG data-URLs
 * keyed by userId when [LIVE_PROFILE_PHOTOS_ONLINE]; never sealed to disk;
 * pruned when offline.
 *
 * **User → host:** RPC `setServerIcon`, `setServerPic`, `setProfilePic`,
 * `setLivePic`, `setOfflineAvatar`.
 *
 * **Host → users:** `serverMeta` via [CollaborationCommandService.Operations.broadcast];
 * `livePic` via [CollaborationCommandService.Operations.broadcastLivePic];
 * offline avatar / card back / persisted profile via
 * [CollaborationCommandService.Operations.presence]
 * (`presence` payload with members). Draw-denied offline avatars get a directed
 * `error` via [CollaborationCommandService.Operations.sendToUser].
 */
internal class ProfileMediaHandler(
    private val s: CollaborationCommandSupport,
) {
    fun cmdSetServerIcon(user: User, m: JSONObject) {
        if (!s.authorization.canManageServer(user)) return
        s.state.iconText = s.operations.sanitizeIconText(m.optString("iconText"))
        s.operations.save()
        broadcastServerMeta()
    }

    fun cmdSetServerPic(user: User, m: JSONObject) {
        if (!s.authorization.canManageServer(user)) return
        val raw = m.optString("data")
        s.state.serverPic = if (raw.isBlank()) null else isJpegDataUrl(raw, MAX_SERVER_PIC) ?: return
        s.operations.save()
        broadcastServerMeta()
    }

    fun cmdSetProfilePic(user: User, m: JSONObject) {
        val mode = s.state.effectiveLiveProfilePhotos()
        val raw = m.optString("data")
        when (mode) {
            LIVE_PROFILE_PHOTOS_ALWAYS -> {
                if (raw.isBlank()) {
                    clearPersistedProfilePic(user)
                    clearLivePic(user.id)
                } else {
                    val pic = isJpegDataUrl(raw, MAX_PROFILE_PIC) ?: return
                    user.profilePic = pic
                    clearLivePic(user.id)
                    s.operations.save()
                    s.operations.presence()
                }
            }
            LIVE_PROFILE_PHOTOS_ONLINE -> {
                // Older clients may still call setProfilePic — treat as RAM live pic.
                cmdSetLivePic(user, m)
            }
            else -> {
                // off: reject uploads; still honor clears.
                if (raw.isNotBlank()) return
                clearPersistedProfilePic(user)
                clearLivePic(user.id)
            }
        }
    }

    fun cmdSetLivePic(user: User, m: JSONObject) {
        val mode = s.state.effectiveLiveProfilePhotos()
        val raw = m.optString("data")
        if (mode != LIVE_PROFILE_PHOTOS_ONLINE) {
            // Only online mode stores session photos; still allow clears.
            if (raw.isBlank()) clearLivePic(user.id)
            return
        }
        if (raw.isBlank()) {
            clearLivePic(user.id)
        } else {
            val pic = isJpegDataUrl(raw, MAX_PROFILE_PIC) ?: return
            val prev = s.livePics.put(user.id, pic)
            if (prev != pic) s.operations.broadcastLivePic(user.id, pic)
        }
    }

    fun cmdSetOfflineAvatar(user: User, m: JSONObject) {
        val encoded = clampOfflineAvatar(m.opt("offlineAvatar")) ?: run {
            if (m.has("offlineAvatar") && (m.isNull("offlineAvatar") || m.optString("offlineAvatar").isBlank())) {
                user.offlineAvatar = null
                s.operations.save()
                s.operations.presence()
            }
            return
        }
        if (!s.authorization.canUserDraw() && encoded.contains("\"mode\":\"draw\"")) {
            s.operations.sendToUser(user, JSONObject().put("type", "error")
                .put("error", "Drawing is turned off on this server."))
            return
        }
        user.offlineAvatar = encoded
        // Always-viewable photos stay; letters/draw sit under them when the client prefers photo.
        if (s.state.effectiveLiveProfilePhotos() != LIVE_PROFILE_PHOTOS_ALWAYS && user.profilePic != null) {
            user.profilePic = null
        }
        s.operations.save()
        s.operations.presence()
    }

    fun cmdSetUserEventCardStyle(user: User, m: JSONObject) {
        val style = eventCardStyleFromJson(m.optJSONObject("eventCardStyle")) ?: return
        if (user.eventCardStyle == style) return
        user.eventCardStyle = style
        s.operations.save()
        s.operations.presence()
    }

    private fun clearLivePic(userId: String) {
        if (s.livePics.remove(userId) != null) s.operations.broadcastLivePic(userId, null)
    }

    private fun clearPersistedProfilePic(user: User) {
        if (user.profilePic == null) return
        user.profilePic = null
        s.operations.save()
        s.operations.presence()
    }

    private fun broadcastServerMeta() {
        s.operations.broadcast(JSONObject()
            .put("type", "serverMeta")
            .put("iconText", s.state.iconText)
            .put("hostName", s.state.hostName)
            .put("serverPic", s.state.serverPic ?: JSONObject.NULL))
    }
}
