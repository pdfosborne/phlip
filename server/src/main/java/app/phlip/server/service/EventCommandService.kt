package app.phlip.server

import com.google.gson.Gson
import org.json.JSONObject

/** Event creation, attendance, scheduling, chain, suggestion, reaction, and note commands. */
internal class EventCommandService(
    stateProvider: () -> AppState,
    gson: Gson,
    authorization: ServerAuthorization,
    idGenerator: () -> String,
    private val operations: Operations,
) {
    internal data class Operations(
        val save: () -> Unit,
        val broadcastToChannel: (Channel, JSONObject) -> Unit,
        val pushSyncToAll: () -> Unit,
        val pushNotification: (Notification) -> Unit,
        val sendToUser: (User, JSONObject) -> Unit,
        val purgeEventFromHost: (String, Boolean, Boolean) -> List<String>,
        /** Fired right after a new (non-pending) event is created and broadcast — see DemoUserService. */
        val onEventCreated: (Event, Channel) -> Unit = { _, _ -> },
        /** § I'm available — drop free-time marks that an event now fills. */
        val clearOverlappingAvailabilities: (Event) -> Unit = {},
    )

    private val support = EventCommandSupport(
        stateProvider = stateProvider,
        gson = gson,
        authorization = authorization,
        idGenerator = idGenerator,
        operations = operations,
    )
    private val lifecycle = EventLifecycleHandler(support)
    private val scheduling = EventSchedulingHandler(support)
    private val chains = EventChainHandler(support)
    private val fields = EventFieldsHandler(support)
    private val notes = EventNotesHandler(support)

    /** Returns true when handled, false when approve/block rejected, null when not owned. */
    fun dispatch(user: User, message: JSONObject): Boolean? {
        when (message.optString("type")) {
            "createEvent" -> lifecycle.cmdCreateEvent(user, message)
            "rsvp" -> lifecycle.cmdRsvp(user, message)
            "setMemberRsvp" -> lifecycle.cmdSetMemberRsvp(user, message)
            "setEventConfirmAttendance" -> lifecycle.cmdSetEventConfirmAttendance(user, message)
            "setEventSignupGroups" -> lifecycle.cmdSetEventSignupGroups(user, message)
            "assignEventGroup" -> lifecycle.cmdAssignEventGroup(user, message)
            "addPerson" -> lifecycle.cmdAddPerson(user, message)
            "removePerson" -> lifecycle.cmdRemovePerson(user, message)
            "deleteEvent" -> lifecycle.cmdDeleteEvent(user, message)
            "approveEvent" -> return lifecycle.cmdApproveEvent(user, message)
            "blockEvent" -> return lifecycle.cmdBlockEvent(user, message)
            "setEventTimePrecision" -> scheduling.cmdSetEventTimePrecision(user, message)
            "suggestEventWhen" -> scheduling.cmdSuggestEventWhen(user, message)
            "supportEventSuggestion" -> scheduling.cmdSupportEventSuggestion(user, message)
            "promoteEventSuggestion" -> scheduling.cmdPromoteEventSuggestion(user, message)
            "lockEventSuggestions" -> scheduling.cmdLockEventSuggestions(user, message)
            "setChainMode" -> chains.cmdSetChainMode(user, message)
            "promoteChainEvent" -> chains.cmdPromoteChainEvent(user, message)
            "clearChainDepWarn" -> chains.cmdClearChainDepWarn(user, message)
            "setEventWhere" -> fields.cmdSetEventWhere(user, message)
            "setEventDetails" -> fields.cmdSetEventDetails(user, message)
            "setEventSticker" -> fields.cmdSetEventSticker(user, message)
            "setEventSubtitle" -> fields.cmdSetEventSubtitle(user, message)
            "setEventType" -> fields.cmdSetEventType(user, message)
            "setEventDuration" -> fields.cmdSetEventDuration(user, message)
            "setEventIcon" -> fields.cmdSetEventIcon(user, message)
            "setEventCategory" -> fields.cmdSetEventCategory(user, message)
            "setEventCardStyle" -> fields.cmdSetEventCardStyle(user, message)
            "markNotificationsRead" -> fields.cmdMarkNotificationsRead(user, message)
            "react" -> notes.cmdReact(user, message)
            "eventNote" -> notes.cmdEventNote(user, message)
            "pinEventNote" -> notes.cmdPinEventNote(user, message)
            "publishPersonalNote" -> notes.cmdPublishPersonalNote(user, message)
            "deleteEventNote" -> notes.cmdDeleteEventNote(user, message)
            else -> return null
        }
        return true
    }

    /** Delete a chat-style event note and its reciprocal and chat mirrors. */
    fun removeEventChatNote(
        eventId: String,
        noteId: String?,
        noteUserId: String?,
        noteTs: Long?,
        actor: User,
        broadcast: Boolean,
        saveAfter: Boolean,
    ): Boolean = support.removeEventChatNote(
        eventId, noteId, noteUserId, noteTs, actor, broadcast, saveAfter,
    )

    /** Used by Broadcast guest RSVPs to retain the existing activity wire format. */
    fun appendEventActivity(channel: Channel, event: Event, note: EventNote) {
        support.appendEventActivity(channel, event, note)
    }
}
