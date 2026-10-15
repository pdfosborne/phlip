package app.phlip.server

/**
 * Canonical RPC command sets for hosting authZ.
 *
 * Guest whitelist sweeps ([AUTHZ-G-01](hosting-security-tests)) subtract
 * [GUEST_ALLOWED] from [MEMBER_RPC] at test time. Keep this list aligned with
 * `DrServer.handleAuthedMessage` — [HostCommandCatalogSyncTest] fails the build
 * if a new `when` branch is added without updating this catalog.
 */
object HostCommandCatalog {

    /** Every `type` handled by member WebSocket / `/ash-rpc`. */
    val MEMBER_RPC: Set<String> = MemberCommandRouter.SUPPORTED_COMMANDS

    /** Always allowed for guests (including view-mode shares). */
    val GUEST_ALWAYS: Set<String> = setOf("report")

    /** Event-share guests only (not view mode). */
    val GUEST_EVENT: Set<String> = setOf("rsvp", "react")

    /** Full guest whitelist — everything else must reject. */
    val GUEST_ALLOWED: Set<String> = GUEST_ALWAYS + GUEST_EVENT

    /** Member commands that must never succeed for a share guest. */
    val GUEST_FORBIDDEN: Set<String> = MEMBER_RPC - GUEST_ALLOWED
}
