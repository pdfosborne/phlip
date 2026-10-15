package app.phlip.server

import org.json.JSONArray
import org.json.JSONObject
import java.util.Random

/**
 * Host/admin-only synthetic ("demo") members. A demo user is a normal [User]
 * row flagged [User.isDemo] — it has no live connection, but its RSVPs and
 * chat messages run through the exact same [EventCommandService.dispatch] /
 * [CollaborationCommandService.dispatch] paths as a real member (see
 * [Operations.dispatchSimulated]), scheduled after a randomized human-like
 * delay so a host can preview server activity before real people join.
 *
 * Gated end-to-end by [DEMO_USERS_FEATURE_ENABLED] — see that flag's doc for
 * how to retire the whole feature in a future release.
 */
internal class DemoUserService(
    private val stateProvider: () -> AppState,
    private val authorization: ServerAuthorization,
    private val idGenerator: () -> String,
    private val memberTokenGenerator: () -> String,
    private val defaultRoleForNewMembers: () -> String,
    private val random: Random,
    private val operations: Operations,
) {
    internal data class Operations(
        val save: () -> Unit,
        val broadcast: (JSONObject) -> Unit,
        val broadcastMembers: () -> Unit,
        val pushSyncToAll: () -> Unit,
        val purgeMemberContent: (String) -> Unit,
        val autoIncludeNewMember: (User) -> Unit,
        val scheduleDelay: (Long, () -> Unit) -> Unit,
        val dispatchSimulated: (User, JSONObject) -> Unit,
        val sendToUser: (User, JSONObject) -> Unit,
    )

    private val state: AppState get() = stateProvider()

    fun dispatch(actor: User, message: JSONObject): Boolean {
        if (!DEMO_USERS_FEATURE_ENABLED) return false
        when (message.optString("type")) {
            "createDemoUsers" -> cmdCreateDemoUsers(actor, message)
            "removeDemoUsers" -> cmdRemoveDemoUsers(actor, message)
            else -> return false
        }
        return true
    }

    private fun cmdCreateDemoUsers(actor: User, m: JSONObject) {
        if (!authorization.canManageServer(actor)) return
        val currentDemoCount = state.users.values.count { it.isDemo }
        val room = (MAX_DEMO_USERS - currentDemoCount).coerceAtLeast(0)
        if (room <= 0) {
            operations.sendToUser(
                actor,
                JSONObject().put("type", "error")
                    .put("error", "Already at the $MAX_DEMO_USERS demo user limit — remove some first."),
            )
            return
        }
        val requestedCount = m.optInt("count", 10).coerceIn(1, MAX_DEMO_USERS)
        val role = m.optString("role").trim().lowercase().takeIf { it in ASSIGNABLE_ROLES }
        val n = requestedCount.coerceAtMost(room)
        val existingNames = state.users.values.map { it.name }.toHashSet()
        val added = mutableListOf<User>()
        repeat(n) {
            val name = randomDemoName(existingNames)
            existingNames.add(name)
            val token = memberTokenGenerator()
            val user = User(
                idGenerator(), name, System.currentTimeMillis(), false,
                role = role ?: defaultRoleForNewMembers(),
            )
            user.isDemo = true
            state.users[token] = user
            operations.autoIncludeNewMember(user)
            added.add(user)
        }
        operations.save()
        for (user in added) {
            scheduleReactionsForExistingEvents(user)
            scheduleGenericChat(user)
        }
        operations.broadcastMembers()
        operations.sendToUser(actor, JSONObject().put("type", "demoUsersCreated").put("count", added.size))
    }

    private fun cmdRemoveDemoUsers(actor: User, m: JSONObject) {
        if (!authorization.canManageServer(actor)) return
        val demoEntries = state.users.entries.filter { it.value.isDemo }.toList()
        if (demoEntries.isEmpty()) {
            operations.sendToUser(
                actor,
                JSONObject().put("type", "demoUsersRemoved").put("count", 0).put("userIds", JSONArray()),
            )
            return
        }
        val userIds = JSONArray()
        for (entry in demoEntries) {
            val userId = entry.value.id
            operations.purgeMemberContent(userId)
            for (channel in state.channels) channel.allowedUserIds?.removeAll { it == userId }
            state.notifications.remove(userId)
            state.users.remove(entry.key)
            userIds.put(userId)
        }
        operations.save()
        operations.broadcastMembers()
        operations.pushSyncToAll()
        // Ack last (same as create) so a sync flood cannot drop it from the
        // poll queue, and /ash-rpc drain can still surface it to the actor.
        operations.sendToUser(
            actor,
            JSONObject().put("type", "demoUsersRemoved").put("count", demoEntries.size).put("userIds", userIds),
        )
    }

    /** Called from [EventCommandService] right after a new event is created and broadcast. */
    fun scheduleReactionsForNewEvent(event: Event, channel: Channel) {
        if (!DEMO_USERS_FEATURE_ENABLED) return
        for (user in state.users.values) {
            if (!user.isDemo) continue
            scheduleEventReaction(user, event, channel)
        }
    }

    /** Called right after minting a new demo user — react to what's already on the calendar. */
    private fun scheduleReactionsForExistingEvents(user: User) {
        val now = System.currentTimeMillis()
        for (event in state.events) {
            val whenMs = event.`when` ?: continue
            if (whenMs < now) continue
            val channel = state.channels.find { it.id == event.channelId } ?: continue
            scheduleEventReaction(user, event, channel)
        }
    }

    private fun scheduleEventReaction(user: User, event: Event, channel: Channel) {
        if (event.approvalStatus == "pending") return
        if (event.rsvps.containsKey(user.id)) return
        if (!authorization.canChannel(user, channel, PERM_FLAG_RSVP)) return
        if (random.nextInt(100) < DEMO_RSVP_SKIP_PCT) return
        val status = weightedRsvpStatus()
        val eventId = event.id
        val channelId = channel.id
        val delayMs = randomDelayMs(DEMO_RSVP_MIN_DELAY_MS, DEMO_RSVP_MAX_DELAY_MS)
        val userId = user.id
        operations.scheduleDelay(delayMs) {
            if (!DEMO_USERS_FEATURE_ENABLED) return@scheduleDelay
            val liveUser = state.users.values.find { it.id == userId && it.isDemo } ?: return@scheduleDelay
            operations.dispatchSimulated(
                liveUser,
                JSONObject().put("type", "rsvp").put("eventId", eventId).put("status", status),
            )
            maybeScheduleEventChat(liveUser, eventId, channelId, status)
        }
    }

    private fun maybeScheduleEventChat(user: User, eventId: String, channelId: String, status: String) {
        if (random.nextInt(100) >= DEMO_CHAT_ON_RSVP_PCT) return
        val phrase = (RSVP_PHRASES[status] ?: GENERIC_PHRASES).pick()
        val delayMs = randomDelayMs(DEMO_CHAT_MIN_DELAY_MS, DEMO_CHAT_MAX_DELAY_MS)
        val userId = user.id
        operations.scheduleDelay(delayMs) {
            if (!DEMO_USERS_FEATURE_ENABLED) return@scheduleDelay
            val liveUser = state.users.values.find { it.id == userId && it.isDemo } ?: return@scheduleDelay
            operations.dispatchSimulated(
                liveUser,
                JSONObject().put("type", "sendMessage").put("channelId", channelId)
                    .put("text", phrase).put("eventId", eventId),
            )
        }
    }

    /** A few generic one-liners into the demo user's own chat channels, independent of any event. */
    private fun scheduleGenericChat(user: User) {
        val chatChannels = state.channels.filter { it.kind == "chat" && authorization.channelVisible(it, user) }
        if (chatChannels.isEmpty()) return
        val userId = user.id
        repeat(random.nextInt(DEMO_GENERIC_CHAT_MAX + 1)) {
            val channelId = chatChannels.pick().id
            val phrase = GENERIC_PHRASES.pick()
            val delayMs = randomDelayMs(DEMO_GENERIC_CHAT_MIN_DELAY_MS, DEMO_GENERIC_CHAT_MAX_DELAY_MS)
            operations.scheduleDelay(delayMs) {
                if (!DEMO_USERS_FEATURE_ENABLED) return@scheduleDelay
                val liveUser = state.users.values.find { it.id == userId && it.isDemo } ?: return@scheduleDelay
                operations.dispatchSimulated(
                    liveUser,
                    JSONObject().put("type", "sendMessage").put("channelId", channelId).put("text", phrase),
                )
            }
        }
    }

    /** Test-only: pins every scheduled delay to a fixed value so tests don't wait minutes. Null = normal random range. */
    @Volatile internal var testDelayOverrideMs: Long? = null

    private fun randomDelayMs(min: Long, max: Long): Long {
        testDelayOverrideMs?.let { return it }
        return if (max <= min) min else min + (random.nextDouble() * (max - min)).toLong()
    }

    private fun weightedRsvpStatus(): String {
        val roll = random.nextInt(100)
        return when {
            roll < 60 -> "going"
            roll < 85 -> "maybe"
            else -> "out"
        }
    }

    private fun randomDemoName(existing: Set<String>): String {
        repeat(50) {
            val candidate = "${DEMO_NAME_ADJECTIVES.pick()} ${DEMO_NAME_NOUNS.pick()}"
            if (existing.none { it.equals(candidate, ignoreCase = true) }) return candidate
        }
        var suffix = 2
        while (true) {
            val candidate = "${DEMO_NAME_ADJECTIVES.pick()} ${DEMO_NAME_NOUNS.pick()} $suffix"
            if (existing.none { it.equals(candidate, ignoreCase = true) }) return candidate
            suffix++
        }
    }

    private fun <T> List<T>.pick(): T = this[random.nextInt(size)]

    companion object {
        internal const val MAX_DEMO_USERS = 100
    }
}

private const val DEMO_RSVP_SKIP_PCT = 25
private const val DEMO_RSVP_MIN_DELAY_MS = 3_000L
private const val DEMO_RSVP_MAX_DELAY_MS = 5L * 60 * 1000

private const val DEMO_CHAT_ON_RSVP_PCT = 50
private const val DEMO_CHAT_MIN_DELAY_MS = 1_000L
private const val DEMO_CHAT_MAX_DELAY_MS = 20_000L

private const val DEMO_GENERIC_CHAT_MAX = 3
private const val DEMO_GENERIC_CHAT_MIN_DELAY_MS = 30_000L
private const val DEMO_GENERIC_CHAT_MAX_DELAY_MS = 2L * 60 * 60 * 1000

private val DEMO_NAME_ADJECTIVES = listOf(
    "Clever", "Sunny", "Breezy", "Cosmic", "Witty", "Jolly", "Nifty", "Plucky",
    "Zesty", "Cheerful", "Dapper", "Speedy", "Quirky", "Mellow", "Bouncy", "Sneaky",
    "Lucky", "Chill", "Bold", "Curious", "Snappy", "Feisty", "Groovy", "Sly",
)
private val DEMO_NAME_NOUNS = listOf(
    "Fox", "Otter", "Falcon", "Panda", "Koala", "Raven", "Badger", "Wombat",
    "Lynx", "Heron", "Marmot", "Gecko", "Puffin", "Weasel", "Toucan", "Ferret",
    "Meerkat", "Sparrow", "Beaver", "Mongoose", "Ocelot", "Pelican", "Squirrel", "Tapir",
)

/** Sent shortly after a demo user's RSVP fires, flavored to match their status. */
private val RSVP_PHRASES: Map<String, List<String>> = mapOf(
    "going" to listOf(
        "Count me in!", "See you there!", "Wouldn't miss it 🙌", "Yes! Can't wait.",
        "I'm in.", "Sounds great, I'll be there.",
    ),
    "maybe" to listOf(
        "I'll try to make it, not 100% sure yet.", "Might be able to swing by.",
        "Tentatively yes — will confirm closer to the time.", "Fingers crossed I can make it!",
    ),
    "out" to listOf(
        "Can't make it this time, sorry!", "Ah, gonna have to skip this one.",
        "Wish I could, but I'm out.", "Not this time — have fun without me!",
    ),
)

/** Generic small talk with no event context. */
private val GENERIC_PHRASES = listOf(
    "Hey everyone 👋", "Anyone free later?", "Haha nice", "This is fun",
    "Sounds good to me", "Ha, love it", "What's the plan?", "Can't wait for this",
    "😂😂😂", "Good shout", "Agreed!", "Same here",
)
