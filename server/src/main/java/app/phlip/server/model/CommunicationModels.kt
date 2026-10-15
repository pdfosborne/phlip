package app.phlip.server

data class ChatMessage(
    val id: String, val channelId: String, val userId: String, val name: String, val text: String, val ts: Long,
    // Primary / legacy single tagged event (also first of [mentionedEventIds]).
    val eventId: String? = null, val eventTitle: String? = null,
    // Users @-mentioned on this message (client-supplied ids, not parsed from the
    // encrypted text — the server never sees plaintext message content).
    val mentionedUserIds: MutableList<String>? = null,
    // 030 — events #mentioned (multi). Infer sticky-forward on the client only.
    val mentionedEventIds: MutableList<String>? = null,
    // Retroactive link attribution (optional).
    val linkedByUserId: String? = null,
    val linkedByUserName: String? = null,
    // Host-authored log kind (e.g. memberJoined). Never copied from client sendMessage.
    val activity: String? = null,
    // Reply parent in this channel; validated on send against dest messages.
    val replyToId: String? = null,
    // userId → emoji. One reaction per user; toggled by reactMessage.
    val reactions: MutableMap<String, String>? = null,
    // Board task card posted into chat; validated against the sibling Tasks channel.
    val taskId: String? = null,
    // Conversation chain. Kept without an event tag so unattached chains survive restart.
    val conversationId: String? = null,
    // Set when the sender edits the text (editMessage).
    val editedAt: Long? = null,
)

// A private, per-recipient feed entry — "you were added to X" / "you were
// @-mentioned in #Y". Never carries encrypted content itself; the client
// resolves eventId/channelId/messageId against data it already has locally
// (event titles, member names — none of which are secret) to build the text.
data class Notification(
    val id: String,
    val userId: String,      // recipient
    // "addedToEvent" | "mentioned" | "pitchResolved" | "eventPendingApproval" | "eventBlocked"
    val kind: String,
    val eventId: String? = null,
    val channelId: String? = null,
    val messageId: String? = null,
    val fromUserId: String,
    val fromUserName: String,
    val ts: Long,
    var read: Boolean = false,
    /** "eventBlocked" only — reason given by the approver. */
    val approvalNote: String? = null,
    /** "eventBlocked" only — approver's alternative suggestion. */
    val approvalAltSuggestion: String? = null,
)
