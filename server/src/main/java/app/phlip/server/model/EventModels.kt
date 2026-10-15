package app.phlip.server

import org.json.JSONObject

data class EventCardStyleColors(
    val imageBg: String, val imageFg: String,
    val badgeBg: String, val badgeText: String,
    val subtitleBg: String, val subtitleText: String,
    val infoBg: String, val detailText: String, val border: String,
)

data class EventCardStyleFonts(
    val titleFont: String, val badgeFont: String, val detailsFont: String,
)

data class EventCardStyleOptions(val subtitleBorder: Boolean = true)

data class EventCardStyle(
    val id: String,
    val name: String,
    val colors: EventCardStyleColors,
    val fonts: EventCardStyleFonts,
    val options: EventCardStyleOptions = EventCardStyleOptions(),
)

private val EVENT_CARD_HEX = Regex("^#[0-9A-Fa-f]{6}$")
private val EVENT_CARD_ID = Regex("^[A-Za-z0-9:_-]+$")
private val EVENT_CARD_FONTS = setOf("inter", "rounded", "serif", "mono")

fun defaultEventCardStyle(): EventCardStyle = EventCardStyle(
    id = "simple", name = "Simple",
    colors = EventCardStyleColors(
        imageBg = "#EAF4FC", imageFg = "#285B80",
        badgeBg = "#FFFFFF", badgeText = "#111827",
        subtitleBg = "#F3F8FC", subtitleText = "#285B80",
        infoBg = "#FFFFFF", detailText = "#4B5563", border = "#E5E7EB",
    ),
    fonts = EventCardStyleFonts("inter", "inter", "inter"),
)

/** Strict wire validator: card styles are data, never arbitrary CSS. */
fun eventCardStyleFromJson(raw: JSONObject?): EventCardStyle? {
    raw ?: return null
    val fallback = defaultEventCardStyle()
    val colors = raw.optJSONObject("colors") ?: return null
    val fonts = raw.optJSONObject("fonts") ?: return null
    fun color(key: String): String? = colors.optString(key).trim()
        .takeIf { EVENT_CARD_HEX.matches(it) }?.uppercase()
    fun font(key: String): String? = fonts.optString(key).trim().takeIf { it in EVENT_CARD_FONTS }
    val id = raw.optString("id").trim().take(80)
    if (id.isEmpty() || !EVENT_CARD_ID.matches(id)) return null
    val name = raw.optString("name").trim().take(40).ifEmpty { fallback.name }
    return EventCardStyle(
        id = id,
        name = name,
        colors = EventCardStyleColors(
            color("imageBg") ?: return null, color("imageFg") ?: return null,
            color("badgeBg") ?: return null, color("badgeText") ?: return null,
            color("subtitleBg") ?: return null, color("subtitleText") ?: return null,
            color("infoBg") ?: return null, color("detailText") ?: return null,
            color("border") ?: return null,
        ),
        fonts = EventCardStyleFonts(
            font("titleFont") ?: return null,
            font("badgeFont") ?: return null,
            font("detailsFont") ?: return null,
        ),
        options = EventCardStyleOptions(raw.optJSONObject("options")?.optBoolean("subtitleBorder", true) ?: true),
    )
}

/**
 * Event row. **Opaque content** (T1.5 — client blobs; server length-caps only, never parses):
 * [title], [where], [details], [sticker], [subtitle]. **Routing / schedule metadata** (server may use):
 * [id], [when], precision/period, [duration], [channelId], [typeId]/[cat]/[icon], RSVPs,
 * chain pointers, creator ids/names.
 *
 * Intentional plaintext exceptions (not content fields): guest Broadcast `display`/`guest*`,
 * share auto-close via [when]+duration.
 */
data class Event(
    // var (not val) so a chain link created without a firm time can later
    // get an exact one set from its detail page.
    val id: String, val title: String, var `when`: Long?,
    var icon: String? = null,
    // var (not val) so the client can edit a focused event's location.
    var where: String, var details: String,
    // var so leave/kick purge can clear the organiser to an empty slot.
    var createdBy: String, var createdByName: String, val createdAt: Long,
    val rsvps: MutableMap<String, String> = mutableMapOf(),
    // Nullable (not defaulted) because Gson bypasses Kotlin constructors: events
    // persisted before these fields existed deserialize with them as null.
    // Legacy one-per-user map ("emoji" or "emoji|count"). Prefer [reactionStacks]
    // for multi-reaction; kept for older clients and migrated on load.
    var reactions: MutableMap<String, String>? = null,
    /**
     * Multi-reaction stacks: userId → ordered list of emoji / drawn `d:` values.
     * Null on legacy events until migration expands [reactions].
     */
    var reactionStacks: MutableMap<String, MutableList<String>>? = null,
    /** Recently applied react clientActionIds (idempotent offline replay). */
    var reactionActionIds: MutableList<String>? = null,
    var notes: MutableList<EventNote>? = null,
    // Empty (not nullable) for the same reason — pre-channels events deserialize
    // with "" and get backfilled by migrateEventChannels() in load().
    var channelId: String = "",
    // userId -> id of the user who dragged them on ("added by X"); absent/self
    // entries mean the person RSVP'd themselves rather than being added.
    var addedBy: MutableMap<String, String>? = null,
    // null/absent = an exact time was set. "day" = only a day was chosen (no
    // period/hour), "period" = a rough time-of-day (see whenPeriod), "unconfirmed"
    // = explicitly marked as still TBD via the availability card.
    var whenPrecision: String? = null,
    var whenPeriod: String? = null,   // "morning" | "afternoon" | "evening", only when whenPrecision == "period"
    // Set when this event was queued as a follow-on to another while it was
    // still a draft ("movie, then drinks") — holds the id of that primary
    // event. Follow-ons render as a connected, no-RSVP sub-entry under it.
    var chainOf: String? = null,
    /**
     * 021 — on a primary: how follow-ons relate.
     * null / "sequence" = all happen in order; "choice" = pick one (reactions).
     */
    var chainMode: String? = null,
    /**
     * 021 — on a follow-on: "proposal" (dashed, reactions) or "linked" (solid, time).
     * null treated as proposal for new chains.
     */
    var chainStatus: String? = null,
    /**
     * 021 — one-hop dependency: parent's `when` when this linked follow-on was
     * flagged after the parent moved. Cleared when the follow-on time is edited
     * or the chain is re-promoted / acknowledged by opening + editing.
     */
    var chainDepWarnWhen: Long? = null,
    /** Broadcast / share-link guest RSVPs: display label → going|maybe|out. */
    var bridgeGuests: MutableMap<String, String>? = null,
    /** Going guests attributed as host+N on the origin (share / aggregate tally). */
    var bridgeHostPlusN: Int = 0,
    // Short memorable emphasis (e.g. "The Red Lion, Soho") — E2E ciphertext
    // like where/details. Null on older events; empty string clears.
    var sticker: String? = null,
    // Member who last set the sticker (cleared when sticker is removed).
    var stickerBy: String? = null,
    var stickerByName: String? = null,
    // Optional qualifier shown as `Type: Subtitle` (e.g. "Social") — E2E
    // ciphertext like sticker. Null on older events; empty string clears.
    var subtitle: String? = null,
    /** Optional E2E compact display name. Empty/missing uses the client-derived title. */
    var shortName: String? = null,
    // How long the event runs: "5m"|"10m"|"15m"|"30m"|"45m"|"1h"|"2h"|"3h"|"4h"
    // or "morning"|"afternoon"|"evening"|"day". Null → client uses type default / 1h.
    var duration: String? = null,
    /**
     * Id of the [EventType] this event was created as (plaintext — same exposure
     * class as [icon]). Null on legacy events; the client then resolves the type
     * by matching the decrypted title against the type list. Lets the server
     * enforce per-type who-can-create and snapshot the type on end.
     */
    var typeId: String? = null,
    /**
     * Plaintext category id (same exposure as [typeId]). Carried mainly for
     * freeform "Other" events, which have no [typeId] and a ciphertext title —
     * without it, other members can't colour the card by category. Typed events
     * can derive their category from the type, but the client sends it anyway.
     */
    var cat: String? = null,
    /**
     * Type name / colour-band copied onto the event when it ends, so a later
     * rename or deletion of the type doesn't rewrite history (client Memories /
     * host archive stay as they were at the time). Null until the event ends.
     */
    var typeNameSnap: String? = null,
    var typeColorSnap: String? = null,
    /**
     * 001/010 — alternative times under the current date (pushback or creator poll).
     * Null on legacy events. Pruned when suggestion `when` is before today.
     */
    var suggestions: MutableList<EventSuggestion>? = null,
    /**
     * Pending-approval workflow (§ approvals). Null = normal / auto-approved.
     * "pending" = awaiting an approver; "blocked" = declined (see [approvalNote]).
     */
    var approvalStatus: String? = null,
    /** Reason given when [approvalStatus] is "blocked" (plaintext, capped, like Report.note). */
    var approvalNote: String? = null,
    /** Approver's alternative suggestion when blocking (plaintext, capped). */
    var approvalAltSuggestion: String? = null,
    /**
     * Curated place(s) this event books (§ pinned location channels). Plaintext
     * id into [AppState.locations] ([PlaceEntry.label]) — unlike [where], this
     * is never ciphertext, so the server can route/aggregate by it. Multi-place
     * events join several labels with `" · "` (same encoding as client `where`).
     */
    var locationLabelId: String? = null,
    /** Server-wide routine snapshot that produced this occurrence, when any. */
    var routineId: String? = null,
    /** Visual treatment copied from the producing routine. */
    var routineStyle: String? = null,
    /** Creator-owned card preset snapshotted when this event was created. */
    var eventCardStyle: EventCardStyle? = null,
    /**
     * When true, members sign up (`signedUp`) and the organiser confirms them
     * (`going`). Default false = Going / Can't RSVP.
     */
    var confirmAttendance: Boolean = false,
    /** Organiser-made buckets (car pools, matches). One person in at most one group. */
    var signupGroups: MutableList<EventSignupGroup>? = null,
)

/** Named slot list on an event (car pool, tennis match, …). */
data class EventSignupGroup(
    val id: String,
    var name: String,
    val memberIds: MutableList<String> = mutableListOf(),
)

/** Split a stored locationLabelId / where join (multi-place uses `" · "`). */
internal fun parseEventPlaces(raw: String?): List<String> {
    val text = raw?.trim().orEmpty()
    if (text.isEmpty()) return emptyList()
    if (text.contains(" · ")) {
        return text.split(Regex("\\s*·\\s*")).map { it.trim() }.filter { it.isNotEmpty() }
    }
    return listOf(text)
}

internal fun formatEventPlaces(places: List<String>): String? {
    val out = ArrayList<String>()
    val seen = HashSet<String>()
    for (p in places) {
        val clean = p.trim()
        if (clean.isEmpty()) continue
        val key = clean.lowercase()
        if (!seen.add(key)) continue
        out.add(clean)
    }
    return out.joinToString(" · ").ifEmpty { null }
}

/** Keep registry hits from a client tag; drop unknown / joined-fake labels. */
internal fun sanitizeLocationLabelId(raw: String?, locations: List<PlaceEntry>): String? {
    val hits = ArrayList<String>()
    for (part in parseEventPlaces(raw)) {
        val hit = locations.find { it.label.equals(part, ignoreCase = true) } ?: continue
        hits.add(hit.label)
    }
    return formatEventPlaces(hits)
}

internal fun locationLabelIdHasPlace(raw: String?, pinLabel: String?): Boolean {
    val pin = pinLabel?.trim().orEmpty()
    if (pin.isEmpty()) return false
    return parseEventPlaces(raw).any { it.equals(pin, ignoreCase = true) }
}

internal fun locationLabelIdsOverlap(left: String?, right: String?): Boolean {
    val keys = parseEventPlaces(right).map { it.lowercase() }.toSet()
    if (keys.isEmpty()) return false
    return parseEventPlaces(left).any { it.lowercase() in keys }
}

/** One alternative date/time stacked under an [Event]'s current `when`. */
data class EventSuggestion(
    val id: String,
    var `when`: Long,
    var whenPrecision: String? = null,
    var whenPeriod: String? = null,
    val proposedBy: String,
    var proposedByName: String,
    var supporterIds: MutableList<String> = mutableListOf(),
    var declinerIds: MutableList<String> = mutableListOf(),
    val createdAt: Long = System.currentTimeMillis(),
)

// Legacy only. Servers used to nest channels/events under a "group"
// layer that carried no access control of its own (visibility is per-channel via
// Channel.allowedUserIds), so it's been removed. This shape is kept solely to
// migrate old data.json files (load() flattens groups into the top-level lists,
// then drops them). Gson ignores the old id/name/createdBy fields.
data class LegacyGroup(
    val channels: MutableList<Channel> = mutableListOf(),
    val events: MutableList<Event> = mutableListOf(),
)
