package app.phlip.server

import org.json.JSONObject

/**
 * Stable member-command entry point shared by HTTP RPC, WebSocket, and the
 * explicitly scoped share-guest bridge.
 *
 * Command implementations remain feature-owned; this router owns protocol
 * recognition so authorization tests no longer parse source text.
 */
internal class MemberCommandRouter(
    private val dispatchKnown: (User, JSONObject) -> Boolean,
) {
    val supportedCommands: Set<String> = SUPPORTED_COMMANDS

    fun dispatch(user: User, message: JSONObject): Boolean {
        if (message.optString("type") !in supportedCommands) return true
        return dispatchKnown(user, message)
    }

    companion object {
        private val BASE_COMMANDS: Set<String> = setOf(
            "setPassword",
            "setDisplayName",
            "setMemberDisplayName",
            "sendMessage",
            "tagMessageEvents",
            "deleteMessage",
            "editMessage",
            "reactMessage",
            "createChannel",
            "createBoard",
            "updateBoard",
            "deleteBoard",
            "reorderBoards",
            "setServerIcon",
            "setServerPic",
            "setProfilePic",
            "setLivePic",
            "setOfflineAvatar",
            "setUserEventCardStyle",
            "updateChannel",
            "reorderChannels",
            "updateCategories",
            "updateEventTypes",
            "addEventType",
            "updateLocations",
            "addLocation",
            "deleteReactionCard",
            "deleteChannel",
            "deleteChannelsBulk",
            "deleteEventsBulk",
            "createEvent",
            "approveEvent",
            "blockEvent",
            "createAvailability",
            "updateAvailability",
            "deleteAvailability",
            "signalAvailability",
            "createTimeBlock",
            "updateTimeBlock",
            "deleteTimeBlock",
            "rsvp",
            "setMemberRsvp",
            "setEventConfirmAttendance",
            "setEventSignupGroups",
            "assignEventGroup",
            "addPerson",
            "removePerson",
            "setEventTimePrecision",
            "suggestEventWhen",
            "supportEventSuggestion",
            "promoteEventSuggestion",
            "lockEventSuggestions",
            "setChainMode",
            "promoteChainEvent",
            "clearChainDepWarn",
            "setEventWhere",
            "setEventDetails",
            "setEventSticker",
            "setEventSubtitle",
            "setEventType",
            "setEventDuration",
            "setEventIcon",
            "setEventCategory",
            "setEventCardStyle",
            "markNotificationsRead",
            "react",
            "eventNote",
            "pinEventNote",
            "publishPersonalNote",
            "deleteEventNote",
            "deleteEvent",
            "setMemberRole",
            "setMemberRoleTags",
            "createCustomRole",
            "updateCustomRole",
            "deleteCustomRole",
            "updateEventRolePerms",
            "approveJoin",
            "denyJoin",
            "leaveServer",
            "removeMember",
            "report",
            "setBlock",
            "resolveReport",
            "updateServerSettings",
            "applySetupPreset",
            "triggerCodeRequest",
            "createInvite",
            "revokeInvite",
            "redeemInvite",
            "syncRequest",
            "getMessagePage",
        )

        /** Every member command id recognized by the router. */
        val SUPPORTED_COMMANDS: Set<String> = buildSet {
            addAll(BASE_COMMANDS)
            // See DEMO_USERS_FEATURE_ENABLED — the app-developer kill switch for demo users.
            if (DEMO_USERS_FEATURE_ENABLED) {
                add("createDemoUsers")
                add("removeDemoUsers")
            }
        }
    }
}
