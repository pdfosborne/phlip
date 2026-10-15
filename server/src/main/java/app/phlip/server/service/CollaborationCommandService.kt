package app.phlip.server

import com.google.gson.Gson
import org.json.JSONObject

/**
 * Chat, channel, catalog, and profile collaboration commands.
 *
 * Thin façade over content-type handlers under `service/collaboration/`.
 * Each handler documents AppState storage and host↔member wire paths.
 */
internal class CollaborationCommandService(
    stateProvider: () -> AppState,
    gson: Gson,
    livePics: MutableMap<String, String>,
    authorization: ServerAuthorization,
    idGenerator: () -> String,
    uniqueTypeId: (String, List<EventType>) -> String,
    private val operations: Operations,
) {
    internal data class Operations(
        val save: () -> Unit,
        val broadcast: (JSONObject) -> Unit,
        val broadcastToChannel: (Channel, JSONObject) -> Unit,
        val pushSyncToAll: () -> Unit,
        val broadcastLivePic: (String, String?) -> Unit,
        val presence: () -> Unit,
        val sendToUser: (User, JSONObject) -> Unit,
        val removeEventChatNote: (String, String?, String?, Long?, User, Boolean, Boolean) -> Boolean,
        val pushNotification: (Notification) -> Unit,
        val purgeEventFromHost: (String, Boolean, Boolean) -> List<String>,
        val sanitizeIconText: (String) -> String,
    )

    private val support = CollaborationCommandSupport(
        stateProvider = stateProvider,
        gson = gson,
        livePics = livePics,
        authorization = authorization,
        idGenerator = idGenerator,
        uniqueTypeId = uniqueTypeId,
        operations = operations,
    )
    private val chat = ChatMessageHandler(support)
    private val channels = ChannelHandler(support)
    private val catalog = CatalogHandler(support)
    private val profileMedia = ProfileMediaHandler(support)

    /** Returns true when this service owns the command type. */
    fun dispatch(user: User, message: JSONObject): Boolean {
        when (message.optString("type")) {
            "sendMessage" -> chat.cmdSendMessage(user, message)
            "tagMessageEvents" -> chat.cmdTagMessageEvents(user, message)
            "deleteMessage" -> chat.cmdDeleteMessage(user, message)
            "editMessage" -> chat.cmdEditMessage(user, message)
            "reactMessage" -> chat.cmdReactMessage(user, message)
            "createChannel" -> channels.cmdCreateChannel(user, message)
            "createBoard" -> channels.cmdCreateBoard(user, message)
            "updateBoard" -> channels.cmdUpdateBoard(user, message)
            "deleteBoard" -> channels.cmdDeleteBoard(user, message)
            "reorderBoards" -> channels.cmdReorderBoards(user, message)
            "setServerIcon" -> profileMedia.cmdSetServerIcon(user, message)
            "setServerPic" -> profileMedia.cmdSetServerPic(user, message)
            "setProfilePic" -> profileMedia.cmdSetProfilePic(user, message)
            "setLivePic" -> profileMedia.cmdSetLivePic(user, message)
            "setOfflineAvatar" -> profileMedia.cmdSetOfflineAvatar(user, message)
            "setUserEventCardStyle" -> profileMedia.cmdSetUserEventCardStyle(user, message)
            "updateChannel" -> channels.cmdUpdateChannel(user, message)
            "reorderChannels" -> channels.cmdReorderChannels(user, message)
            "updateCategories" -> catalog.cmdUpdateCategories(user, message)
            "updateEventTypes" -> catalog.cmdUpdateEventTypes(user, message)
            "addEventType" -> catalog.cmdAddEventType(user, message)
            "updateLocations" -> catalog.cmdUpdateLocations(user, message)
            "addLocation" -> catalog.cmdAddLocation(user, message)
            "deleteReactionCard" -> catalog.cmdDeleteReactionCard(user, message)
            "deleteChannel" -> channels.cmdDeleteChannel(user, message)
            "deleteChannelsBulk" -> channels.cmdDeleteChannelsBulk(user, message)
            "deleteEventsBulk" -> channels.cmdDeleteEventsBulk(user, message)
            else -> return false
        }
        return true
    }

    /** Remove one channel and its server-side content. */
    fun purgeChannelById(channelId: String): Boolean = channels.purgeChannelById(channelId)

    fun postMemberJoined(user: User) = chat.postMemberJoined(user)
}
