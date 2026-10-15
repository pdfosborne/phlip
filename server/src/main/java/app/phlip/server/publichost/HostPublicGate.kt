package app.phlip.server.publichost

import android.content.Context
import app.phlip.server.DevicePatchStatus
import app.phlip.server.HostVersionGate
import app.phlip.server.publichost.cloudflare.CloudflarePrefs

/**
 * Public hosting is refused until every Setup acknowledgment is accepted
 * (alpha risks, host rules, public safer-host tips, red-patch warning when applicable,
 * Cloudflare operator / data / public-risk disclosures) and Cloudflare is configured.
 * Nearby / same-Wi-Fi preparation is not required.
 */
object HostPublicGate {

    const val PREFS_NAME = "dp_host_prefs"
    const val KEY_HOST_RULES_ACK = "host_rules_ack"
    const val KEY_ALPHA_ACK = "alpha_ack"
    const val KEY_ALPHA_EXPANDED = "alpha_expanded"
    const val KEY_PATCH_WARN_DISMISSED = "patch_warn_dismissed"
    /** Safer hosting tips for Local (same Wi‑Fi). */
    const val KEY_LOCAL_PREP_ACK = "local_prep_ack"
    /** Safer hosting tips for Public (dedicated phone / guest Wi‑Fi). */
    const val KEY_DEVICE_PREP_ACK = "device_prep_ack"
    const val KEY_DEVICE_PREP_EXPANDED = "device_prep_expanded"
    const val KEY_LOCAL_PREP_EXPANDED = "local_prep_expanded"

    fun hostPrefs(ctx: Context) =
        ctx.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun hostRulesAccepted(ctx: Context): Boolean =
        hostPrefs(ctx).getBoolean(KEY_HOST_RULES_ACK, false)

    fun alphaAckAccepted(ctx: Context): Boolean =
        hostPrefs(ctx).getBoolean(KEY_ALPHA_ACK, false)

    fun localPrepAccepted(ctx: Context): Boolean =
        hostPrefs(ctx).getBoolean(KEY_LOCAL_PREP_ACK, false)

    fun canShareNearby(ctx: Context): Boolean = hostRulesAccepted(ctx) && localPrepAccepted(ctx)

    fun devicePrepAccepted(ctx: Context): Boolean =
        hostPrefs(ctx).getBoolean(KEY_DEVICE_PREP_ACK, false)

    /** Red patch phones must dismiss the full warning; green/amber are fine. */
    fun patchAckSatisfied(ctx: Context): Boolean {
        if (DevicePatchStatus.evaluate().bucket != DevicePatchStatus.Bucket.RED) return true
        return hostPrefs(ctx).getBoolean(KEY_PATCH_WARN_DISMISSED, false)
    }

    fun cloudflareAcksAccepted(cf: CloudflarePrefs): Boolean =
        cf.operatorAcknowledged && cf.dataDisclosureAcknowledged && cf.publicRiskAcknowledged

    /** Human-readable first blocker, or null when acknowledgments (not tunnel/version) are complete. */
    fun missingAckReason(ctx: Context, cf: CloudflarePrefs): String? = when {
        !alphaAckAccepted(ctx) ->
            "Accept the alpha software risks in Setup first"
        !hostRulesAccepted(ctx) ->
            "Accept the server rules in Setup first"
        !devicePrepAccepted(ctx) ->
            "Read and accept safer hosting for Public in Setup first"
        !patchAckSatisfied(ctx) ->
            "Acknowledge the device security warning in Setup first"
        !cf.operatorAcknowledged ->
            "Accept the host-operator responsibility in Setup first"
        !cf.dataDisclosureAcknowledged ->
            "Accept the Cloudflare data disclosure in Setup first"
        !cf.publicRiskAcknowledged ->
            "Accept the Public risk warning in Setup first"
        else -> null
    }

    fun canGoPublic(ctx: Context, cf: CloudflarePrefs): Boolean {
        if (missingAckReason(ctx, cf) != null) return false
        if (!cf.hasNamedTunnel()) return false
        if (HostVersionGate.isBelowMinSafe()) return false
        return true
    }

    /** Why Public is blocked (acks, tunnel, or min-safe version). */
    fun blockReason(ctx: Context, cf: CloudflarePrefs): String? {
        missingAckReason(ctx, cf)?.let { return it }
        if (!cf.hasNamedTunnel()) {
            return "Set up a Cloudflare domain and API token in Setup first"
        }
        if (HostVersionGate.isBelowMinSafe()) {
            return "This Phlip build is below the minimum safe version. Update before going Public."
        }
        return null
    }

    const val KEY_HOSTING_DESIRED = "hosting_desired"

    fun setHostingDesired(ctx: Context, desired: Boolean) {
        hostPrefs(ctx).edit().putBoolean(KEY_HOSTING_DESIRED, desired).apply()
    }

    fun isHostingDesired(ctx: Context): Boolean =
        hostPrefs(ctx).getBoolean(KEY_HOSTING_DESIRED, false)
}
