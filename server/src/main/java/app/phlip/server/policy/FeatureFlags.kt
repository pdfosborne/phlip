package app.phlip.server

/**
 * App-developer kill switch for the demo users feature (see [DemoUserService]).
 *
 * Flip to `false` and ship an update to retire the feature: the create/remove
 * commands stop being recognized ([MemberCommandRouter.SUPPORTED_COMMANDS]),
 * any already-scheduled demo RSVP/chat callbacks no-op, and the admin settings
 * UI hides the whole section (via `demoUsersEnabled` in [serverSettingsPayload]).
 * Existing demo users are left alone — not auto-purged — so disabling never
 * silently deletes a host's data.
 */
internal const val DEMO_USERS_FEATURE_ENABLED = true
