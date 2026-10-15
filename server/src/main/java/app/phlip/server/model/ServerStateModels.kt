package app.phlip.server

import com.google.gson.annotations.JsonAdapter

/**
 * §10 dual-purpose invite: one link does bootstrap for newcomers or adds
 * group edges for people already on the server. Tight defaults — 24h, one use,
 * individually revocable. Distinct from the rotating LAN/Nearby join code.
 */
data class GroupInvite(
    val id: String,
    /** Unguessable token embedded in the invite URL (`#join&t=…`). */
    val code: String,
    val createdBy: String,
    val createdByName: String,
    val createdAt: Long,
    var expiresAt: Long,
    var maxUses: Int = 1,
    var uses: Int = 0,
    var revoked: Boolean = false,
    /** Private groups to open for the redeemer (in addition to auto-include). */
    var channelIds: MutableList<String> = mutableListOf(),
)

// A user-filed report about content or a person, delivered to the
// host and any admins/moderators for action. Notes/reasons are plaintext (the
// host must be able to read them to moderate) — kept short and never carry
// group ciphertext. Reports are host-side only; they are never sent to
// ordinary members and never leave the host device except as the host hosts.
data class Report(
    val id: String,
    val targetType: String,        // "message" | "event" | "user" | "pitch" | "broadcast"
    val targetId: String,          // message / event / user / pitch session / share id
    val channelId: String? = null, // where the reported item lives, when known
    val reason: String,            // short slug: spam | harassment | hate | sexual | csam | violence | illegal | other
    val note: String? = null,      // optional free-text detail from the reporter (plaintext, capped)
    val reporterId: String,        // member id, or "guest:<pitchId>" for a broadcast guest
    val reporterName: String,
    val isGuest: Boolean = false,
    val createdAt: Long,
    var status: String = "open",   // "open" | "resolved" | "dismissed"
    var handledBy: String? = null,
    var handledByName: String? = null,
    var handledAt: Long? = null,
)

data class AppState(
    var inviteCode: String = "",
    var inviteExpiry: Long = 0,
    var e2eSalt: String = "",           // non-secret PBKDF2 salt; sent in welcome
    /**
     * HMAC key (base64, 32 bytes) for deterministic *fake* auth salts when the
     * name is unknown / has no password and the join code is missing — keeps
     * `/ash-auth-salt` responses indistinguishable from real members.
     */
    var saltBlindKey: String = "",
    var hostName: String = "Phlip host",
    // Up to 4 characters shown on the rail / nav button; empty → clients use initials.
    var iconText: String = "",
    // Event categories offered by this server (see Category above).
    var categories: MutableList<Category> = defaultCategories(),
    // Built-in / custom event-card label → category id (host-editable).
    var cardCats: MutableMap<String, String> = defaultCardCats(),
    // Event-type label → default duration code (e.g. "Dinner" → "2h"). Missing → "1h".
    var cardDurations: MutableMap<String, String> = mutableMapOf(),
    // Event-type labels the host has removed from planning hands (built-ins stay
    // in the client pack but are hidden for everyone on this server).
    var removedCards: MutableList<String> = mutableListOf(),
    // Host-curated place names offered when planning (plaintext, like categories).
    @JsonAdapter(PlaceEntryListAdapter::class)
    var locations: MutableList<PlaceEntry> = defaultLocations(),
    // First-class event types (§5). Empty on data files predating this field;
    // load() seeds it from the built-in pack + legacy cardCats/cardDurations.
    // Server-level so the whole group shares one type vocabulary.
    var eventTypes: MutableList<EventType> = mutableListOf(),
    /**
     * Server-wide library of drawn icons (`d:` stroke payloads) shared
     * with every member. Populated when someone draws an event icon or chat
     * reaction; admins prune via Drawings. Nullable so older data files load cleanly.
     * Entries may be legacy bare strings — [ReactionCardListAdapter] upgrades them.
     */
    @JsonAdapter(ReactionCardListAdapter::class)
    var reactionCards: MutableList<ReactionCardEntry>? = null,
    /**
     * When on (null/true), every category offers a freeform "Other" during
     * planning — the escape hatch for ad-hoc plans (friend groups keep it).
     * A club turns it off to enforce a rigid schema. Nullable so data files
     * predating the field read as on rather than Gson's `false` default.
     */
    var allowFreeform: Boolean? = null,
    /**
     * When on, an event may list several places at once (e.g. Court 1 + Court 3).
     * Default off — most groups use one place per plan.
     */
    var allowMultiLocations: Boolean = false,
    /**
     * § pinned people channels — opt-in for small groups (families). When on,
     * admins may create read-only boards that aggregate a member's visible
     * calendar; viewers without home-channel access see reserved-time stubs.
     * Default off.
     */
    var allowPinnedPeople: Boolean = false,
    /**
     * §6 setup preset last applied: friend | circles | club.
     * Null on legacy servers until Setup guide / create wizard runs.
     */
    var setupPreset: String? = null,
    /** Club activity hint used to seed types (e.g. tennis). */
    var setupActivity: String? = null,
    /**
     * When false, channel create UI hides the standing auto-include option
     * (Preset B — Separate circles). Null/true = offer it.
     */
    var offerAutoInclude: Boolean? = null,
    /** When false, only host/admin/moderator may create events (users/viewers cannot).
     *  Prefer [createEvents] when set; this boolean is kept for older data / clients. */
    var allowUserCreateEvents: Boolean = true,
    /**
     * Who may put events on the calendar (§3). `everyone` (members+) | `moderator` | `admin`.
     * Null → derive from [allowUserCreateEvents]. Viewers never create.
     */
    var createEvents: String? = null,
    /**
     * Who may invent new event types (§3). `everyone` | `moderator` | `admin`.
     * Default: moderator — creating a type changes the vocabulary; creating an
     * event uses it. Nullable so older data files read as the default.
     */
    var createEventTypes: String? = null,
    /**
     * Who may add curated locations (§3). `everyone` | `moderator` | `admin`.
     * Default: moderator. Full list replace stays admin-only; this gates append.
     */
    var addLocations: String? = null,
    /**
     * Who may invite people into a group/channel (§3). Hard-fixed to admin for now
     * (selector removed from Admin settings); field kept for older data files.
     */
    var inviteToGroup: String? = null,
    /**
     * Camera profile photos: `off` | `online` | `always`.
     * - off: no live/camera photos
     * - online: RAM relay while member is online (not sealed to disk)
     * - always: persisted [User.profilePic] on the host
     * Null on older data files — migrated from [allowProfilePics] on load.
     * New servers default to off.
     */
    var liveProfilePhotos: String? = "off",
    /**
     * Legacy boolean gate (pre–liveProfilePhotos). Kept in sync:
     * true when mode is online|always. Older clients still read this key.
     */
    var allowProfilePics: Boolean = false,
    /** When false, members cannot draw offline avatars, chat reactions, or event icons. */
    var allowUserDraw: Boolean = true,
    /** classic | bold | soft | mono — client card skin. */
    var cardTheme: String = "classic",
    /** When true, every re-login needs the current join code (host failsafe). */
    var forceJoinCode: Boolean = false,
    /**
     * Monotonic challenge bumped by [triggerCodeRequest]. Members whose
     * [User.lastCodeAck] is behind must present the join code once on next login.
     */
    var codeChallenge: Int = 0,
    /** Role assigned when a brand-new member is approved (admin|moderator|user|viewer). */
    var defaultRole: String? = "user",
    /**
     * Server-defined custom role tags (subgroup labels). Orthogonal to the fixed
     * host/admin/moderator/user/viewer ladder. Nullable for older data files.
     */
    var customRoles: MutableList<CustomRole>? = null,
    /**
     * Server-wide event permission matrix (rsvp/create/edit/…). Keys:
     * moderator | user | viewer | customRoleId. Channel [Channel.rolePerms] only
     * stores per-channel **view** (who can see that board — event or chat). Nullable until migration seeds it.
     */
    var eventRolePerms: MutableMap<String, RolePermFlags>? = null,
    /**
     * Minimum age to join this server (years). Floor is 18.
     * Shown on the public join agreement before personal data is collected.
     */
    var minAge: Int = 18,
    /**
     * When true, events past end + grace are wiped from this host (RSVPs, notes,
     * shares, mirrored chat, related notifications). Members keep device-local
     * Memories archives — a compromised host then only holds active plans.
     */
    var purgeEndedEvents: Boolean = false,
    /**
     * Chat retention on this host in days. `0` = keep forever. Older messages
     * (and related message notifications/reports) are wiped periodically.
     */
    var chatRetentionDays: Int = 0,
    /** Optional server avatar (data:image/jpeg;base64,…). */
    var serverPic: String? = null,
    /**
     * Creator-set blurb shown on the client's "Server info" panel tab.
     * Plaintext, host/admin editable only, short.
     */
    var description: String? = null,
    /** Server-wide fallback for [Channel.eventsRequireApproval] on channels that don't override it. */
    var eventsRequireApprovalDefault: Boolean = false,
    val users: MutableMap<String, User> = mutableMapOf(),
    // Boards group one event channel and one chat channel. Content stays in the
    // top-level stores; the board owns their shared name and visibility.
    var boards: MutableList<Board> = mutableListOf(),
    var channels: MutableList<Channel> = mutableListOf(),
    var events: MutableList<Event> = mutableListOf(),
    /** § I'm available — lightweight free-time marks (not Events). */
    var availabilities: MutableList<Availability> = mutableListOf(),
    /** Whole-day / period / multi-day time blocks (not Events). */
    var timeBlocks: MutableList<TimeBlock> = mutableListOf(),
    // §10 individually revocable group invites (bootstrap + edge-add).
    // var so load() can repair null on data files predating this field.
    var groupInvites: MutableList<GroupInvite> = mutableListOf(),
    val messages: MutableMap<String, MutableList<ChatMessage>> = mutableMapOf(),
    // Abuse reports filed by members/guests, delivered to host/admins/moderators.
    // var (not val) so load() can repair it on data files predating this field.
    var reports: MutableList<Report> = mutableListOf(),
    // userId -> their notifications, newest last. var (not val) so load() can
    // repair it on old data.json files where this key didn't exist yet —
    // Gson bypasses Kotlin constructors on deserialize, so a missing key here
    // would otherwise land as a real null despite the non-nullable type.
    var notifications: MutableMap<String, MutableList<Notification>> = mutableMapOf(),
    /** 016 Slice 2 — ring buffer of server-visible activity (name changes). Newest last. */
    var serverActivity: MutableList<ServerActivityEntry> = mutableListOf(),
    // Legacy grouped shape, present only in pre-flattening data.json; migrated
    // and cleared by load(). Null on all current data.
    var groups: MutableList<LegacyGroup>? = null,
)

/** Exposed to HostService so the UI can show the pending queue. */
data class PendingInfo(
    val id: String,
    val name: String,
    val ts: Long,
    /** Member whose personal invite link admitted this request (server-resolved). */
    val invitedByUserId: String? = null,
    val invitedByName: String? = null,
    val inviteSlug: String? = null,
)
