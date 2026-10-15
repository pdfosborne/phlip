package com.phlip.settings

import android.content.Intent
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import app.phlip.server.DevicePatchStatus
import app.phlip.server.HostService
import app.phlip.server.HostingConsent
import app.phlip.server.SecurityRejectLog
import app.phlip.server.publichost.HostPublicGate
import app.phlip.server.publichost.cloudflare.CloudflareApi
import app.phlip.server.publichost.cloudflare.CloudflarePrefs
import com.phlip.PlayUpdateHelper
import com.phlip.SettingsActivity
import com.phlip.VersionPolicy
import com.phlip.settings.SettingsTheme.ACCENT
import com.phlip.settings.SettingsTheme.CHIP
import com.phlip.settings.SettingsTheme.INK
import com.phlip.settings.SettingsTheme.MUTED
import com.phlip.settings.SettingsTheme.PUBLIC_LIVE
import com.phlip.settings.SettingsTheme.SURFACE
import com.phlip.settings.SettingsTheme.BORDER
import com.phlip.settings.SettingsTheme.DANGER


/** Cloudflare setup + public-hosting acknowledgement checklist. */
class CloudflareSection(private val host: SettingsActivity) {
    fun render(content: LinearLayout) = host.renderCloudflareScreen(content)
}

internal fun SettingsActivity.renderCloudflareScreen(content: LinearLayout) {
    val hsts = intent.getBooleanExtra(SettingsActivity.EXTRA_SHOW_HSTS_GUIDE, false)
    val connect = intent.getStringExtra(SettingsActivity.EXTRA_SCREEN) == SettingsActivity.SCREEN_CLOUDFLARE_CONNECT
    if (!connect && !hsts && !CloudflarePrefs(this).hasNamedTunnel()) {
        intent.putExtra(SettingsActivity.EXTRA_SCREEN, SettingsActivity.SCREEN_CLOUDFLARE_CONNECT)
    }
    if (intent.getStringExtra(SettingsActivity.EXTRA_SCREEN) == SettingsActivity.SCREEN_CLOUDFLARE_CONNECT) {
        cloudflareConnectUi.mount(content)
        return
    }
    content.addView(tv("Cloudflare domain & API", 20f, INK, bold = true))
    content.addView(tv(
        "Connect or update the Cloudflare domain used by Public servers.",
        14f, MUTED,
    ).margins(top = 8, bottom = 12))
    content.addView(cloudflareSection(hostService, skipAcks = true))
    content.addView(btn("Open HTTPS hardening guide", CHIP, INK) {
        promptCloudflareHstsGuide()
    }.margins(top = 8, bottom = 8))
}

/** Checklist so hosts see every acknowledgment still required for Public. */
internal fun SettingsActivity.publicAckChecklist(): View {
    val cf = hostService?.cloudflarePrefs() ?: CloudflarePrefs(this)
    val box = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(CHIP)
        setPadding(dp(14), dp(12), dp(14), dp(12))
    }
    box.addView(tv("Before Public — complete all of these", 15f, INK, bold = true))
    fun row(done: Boolean, label: String) {
        val mark = if (done) "✓" else "○"
        val color = if (done) MUTED else DANGER
        box.addView(tv("$mark  $label", 13f, color).margins(top = 6))
    }
    row(alphaAckAccepted(), "Alpha software risks")
    row(hostRulesAccepted(), "Server rules for hosts")
    row(localPrepAccepted(), "Safer hosting for Local")
    row(devicePrepAccepted(), "Safer hosting for Public")
    row(patchAckSatisfied(), "Device security warning (if your patch is very old)")
    row(cf.operatorAcknowledged, "Operator responsibility")
    row(cf.dataDisclosureAcknowledged, "Cloudflare data disclosure")
    row(cf.publicRiskAcknowledged, "Public risk warning")
    row(cf.hasNamedTunnel(), "Cloudflare domain + API token")
    row(!VersionPolicy.isBelowMinSafe(), "App at or above minimum safe version")
    val ready = HostPublicGate.canGoPublic(this, cf)
    box.addView(tv(
        if (ready) "All set — you can turn a server Public."
        else "Public stays locked until every item above is done.",
        12f, if (ready) MUTED else DANGER,
    ).margins(top = 10))
    return box
}

internal fun SettingsActivity.hostRulesAccepted(): Boolean =
    HostPublicGate.hostRulesAccepted(this)

internal fun SettingsActivity.alphaAckAccepted(): Boolean =
    HostPublicGate.alphaAckAccepted(this)

internal fun SettingsActivity.localPrepAccepted(): Boolean =
    HostPublicGate.localPrepAccepted(this)

internal fun SettingsActivity.devicePrepAccepted(): Boolean =
    HostPublicGate.devicePrepAccepted(this)

internal fun SettingsActivity.patchAckSatisfied(): Boolean =
    HostPublicGate.patchAckSatisfied(this)

/** Drop Public if any required acknowledgment was revoked. */
internal fun SettingsActivity.enforcePublicAcksOrDemote() {
    val svc = hostService ?: return
    val cf = svc.cloudflarePrefs()
    val reason = HostPublicGate.missingAckReason(this, cf) ?: return
    if (svc.serverStatuses().none { it.isPublic }) return
    svc.demoteAllPublic(reason)
    toast("Public turned off — $reason")
}

/** Patch-age warning for recycled / unpatched host phones (plan §8.3–8.4). */
internal fun SettingsActivity.devicePatchSection(): View {
    val info = DevicePatchStatus.evaluate()
    val box = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(CHIP)
        setPadding(dp(14), dp(12), dp(14), dp(12))
    }
    box.addView(tv(HostingConsent.PATCH_WARNING_TITLE, 15f, INK, bold = true))
    when (info.bucket) {
        DevicePatchStatus.Bucket.GREEN -> {
            box.addView(tv(
                "This phone’s security patch is recent (${DevicePatchStatus.friendlyPatchLabel(info)}).",
                13f, MUTED,
            ).margins(top = 6))
        }
        DevicePatchStatus.Bucket.AMBER -> {
            val label = DevicePatchStatus.friendlyPatchLabel(info)
            box.addView(tv(
                "Security patch is getting old ($label). A dedicated host phone and guest Wi‑Fi can reduce risk — note Local servers on guest Wi‑Fi usually won’t show for devices on your main network.",
                13f, INK,
            ).margins(top = 6))
        }
        DevicePatchStatus.Bucket.RED -> {
            val label = DevicePatchStatus.friendlyPatchLabel(info)
            val dismissed = prefs.getBoolean(HostPublicGate.KEY_PATCH_WARN_DISMISSED, false)
            if (!dismissed) {
                box.addView(tv(HostingConsent.patchWarningBody(label), 13f, INK).margins(top = 6))
                box.addView(tv(
                    "Required before Public hosting.",
                    12f, DANGER,
                ).margins(top = 6))
                box.addView(btn(HostingConsent.PATCH_WARNING_ACCEPT, ACCENT, INK) {
                    prefs.edit().putBoolean(HostPublicGate.KEY_PATCH_WARN_DISMISSED, true).apply()
                    refresh()
                }.margins(top = 10))
            } else {
                box.addView(tv(
                    "Older security patch ($label). Dedicated wiped phone + guest Wi‑Fi can reduce risk. Tap to re-read the full warning.",
                    13f, MUTED,
                ).margins(top = 6))
                box.addView(btn("Show patch warning again", CHIP, INK) {
                    prefs.edit().putBoolean(HostPublicGate.KEY_PATCH_WARN_DISMISSED, false).apply()
                    enforcePublicAcksOrDemote()
                    refresh()
                }.margins(top = 8))
            }
        }
    }
    return box
}

/** Alpha / early-development risk — required before creating servers. */
internal fun SettingsActivity.alphaAckSection(): View {
    val box = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(CHIP)
        setPadding(dp(14), dp(12), dp(14), dp(12))
    }
    box.addView(tv(HostingConsent.ALPHA_ACK_TITLE, 15f, INK, bold = true))
    if (!alphaAckAccepted()) {
        box.addView(tv(HostingConsent.ALPHA_ACK_BODY, 13f, INK).margins(top = 6))
        box.addView(tv(
            "Required before creating servers.",
            12f, DANGER,
        ).margins(top = 6))
        box.addView(btn(HostingConsent.ALPHA_ACK_ACCEPT, ACCENT, INK) {
            prefs.edit().putBoolean(HostPublicGate.KEY_ALPHA_ACK, true).apply()
            prefs.edit().putBoolean(HostPublicGate.KEY_ALPHA_EXPANDED, false).apply()
            toast("Alpha risks acknowledged")
            refresh()
        }.margins(top = 10))
    } else {
        val expanded = prefs.getBoolean(HostPublicGate.KEY_ALPHA_EXPANDED, false)
        box.addView(tv(
            "Acknowledged — early software; updates may break things or lose data.",
            13f, MUTED,
        ).margins(top = 6))
        if (expanded) {
            box.addView(tv(HostingConsent.ALPHA_ACK_BODY, 13f, INK).margins(top = 8))
            box.addView(btn("Hide info", CHIP, INK) {
                prefs.edit().putBoolean(HostPublicGate.KEY_ALPHA_EXPANDED, false).apply()
                refresh()
            }.margins(top = 8))
        } else {
            box.addView(btn("Show info again", CHIP, INK) {
                prefs.edit().putBoolean(HostPublicGate.KEY_ALPHA_EXPANDED, true).apply()
                refresh()
            }.margins(top = 8))
        }
        box.addView(btn("Revoke acknowledgment", CHIP, DANGER) {
            prefs.edit().putBoolean(HostPublicGate.KEY_ALPHA_ACK, false).apply()
            enforcePublicAcksOrDemote()
            refresh()
        }.margins(top = 8))
    }
    return box
}

/** Local (same Wi‑Fi) safer-host tips — required before creating servers. */
internal fun SettingsActivity.localPrepSection(): View {
    val box = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(CHIP)
        setPadding(dp(14), dp(12), dp(14), dp(12))
    }
    box.addView(tv(HostingConsent.LOCAL_PREP_TITLE, 15f, INK, bold = true))
    if (!localPrepAccepted()) {
        box.addView(tv(HostingConsent.LOCAL_PREP_BODY, 13f, INK).margins(top = 6))
        box.addView(tv(
            "Required before creating servers.",
            12f, DANGER,
        ).margins(top = 6))
        box.addView(btn(HostingConsent.LOCAL_PREP_ACCEPT, ACCENT, INK) {
            prefs.edit().putBoolean(HostPublicGate.KEY_LOCAL_PREP_ACK, true).apply()
            prefs.edit().putBoolean(HostPublicGate.KEY_LOCAL_PREP_EXPANDED, false).apply()
            toast("Safer hosting for Local acknowledged")
            refresh()
        }.margins(top = 10))
    } else {
        val expanded = prefs.getBoolean(HostPublicGate.KEY_LOCAL_PREP_EXPANDED, false)
        box.addView(tv(
            "Acknowledged — Local is same Wi‑Fi only.",
            13f, MUTED,
        ).margins(top = 6))
        if (expanded) {
            box.addView(tv(HostingConsent.LOCAL_PREP_BODY, 13f, INK).margins(top = 8))
            box.addView(btn("Hide setup tips", CHIP, INK) {
                prefs.edit().putBoolean(HostPublicGate.KEY_LOCAL_PREP_EXPANDED, false).apply()
                refresh()
            }.margins(top = 8))
        } else {
            box.addView(btn("Show setup tips again", CHIP, INK) {
                prefs.edit().putBoolean(HostPublicGate.KEY_LOCAL_PREP_EXPANDED, true).apply()
                refresh()
            }.margins(top = 8))
        }
        box.addView(btn("Revoke acknowledgment", CHIP, DANGER) {
            prefs.edit().putBoolean(HostPublicGate.KEY_LOCAL_PREP_ACK, false).apply()
            refresh()
        }.margins(top = 8))
    }
    return box
}

/** Public / Cloudflare safer-host tips — required ack for Public. */
internal fun SettingsActivity.devicePrepSection(): View {
    val box = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(CHIP)
        setPadding(dp(14), dp(12), dp(14), dp(12))
    }
    box.addView(tv(HostingConsent.DEVICE_PREP_TITLE, 15f, INK, bold = true))
    if (!devicePrepAccepted()) {
        box.addView(tv(HostingConsent.DEVICE_PREP_BODY, 13f, INK).margins(top = 6))
        box.addView(tv(
            "Required before Public hosting.",
            12f, DANGER,
        ).margins(top = 6))
        box.addView(btn(HostingConsent.DEVICE_PREP_ACCEPT, ACCENT, INK) {
            prefs.edit().putBoolean(HostPublicGate.KEY_DEVICE_PREP_ACK, true).apply()
            prefs.edit().putBoolean(HostPublicGate.KEY_DEVICE_PREP_EXPANDED, false).apply()
            toast("Safer hosting for Public acknowledged")
            refresh()
        }.margins(top = 10))
    } else {
        val expanded = prefs.getBoolean(HostPublicGate.KEY_DEVICE_PREP_EXPANDED, false)
        box.addView(tv(
            "Acknowledged. Guest Wi‑Fi + wiped throwaway host phone recommended.",
            13f, MUTED,
        ).margins(top = 6))
        if (expanded) {
            box.addView(tv(HostingConsent.DEVICE_PREP_BODY, 13f, INK).margins(top = 8))
            box.addView(btn("Hide setup tips", CHIP, INK) {
                prefs.edit().putBoolean(HostPublicGate.KEY_DEVICE_PREP_EXPANDED, false).apply()
                refresh()
            }.margins(top = 8))
        } else {
            box.addView(btn("Show setup tips again", CHIP, INK) {
                prefs.edit().putBoolean(HostPublicGate.KEY_DEVICE_PREP_EXPANDED, true).apply()
                refresh()
            }.margins(top = 8))
        }
        box.addView(btn("Revoke acknowledgment", CHIP, DANGER) {
            prefs.edit().putBoolean(HostPublicGate.KEY_DEVICE_PREP_ACK, false).apply()
            enforcePublicAcksOrDemote()
            refresh()
        }.margins(top = 8))
    }
    return box
}

/** Remote version / minSafe + Play flexible update prompt. */
internal fun SettingsActivity.updateStatusSection(): View {
    val box = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(CHIP)
        setPadding(dp(14), dp(12), dp(14), dp(12))
    }
    box.addView(tv(HostingConsent.UPDATE_NEEDED_TITLE, 15f, INK, bold = true))
    val snap = VersionPolicy.current()
    val below = VersionPolicy.isBelowMinSafe()
    val newer = VersionPolicy.isUpdateAvailable()
    when {
        below -> {
            box.addView(tv(
                "This build (${VersionPolicy.currentName()}) is below the minimum safe version" +
                    (snap?.minSafe?.let { " ($it)" } ?: "") +
                    ". Update before making servers Public.",
                13f, DANGER,
            ).margins(top = 6))
        }
        newer -> {
            box.addView(tv(
                "A newer Phlip is available" +
                    (snap?.latest?.let { " ($it)" } ?: "") +
                    ". Current: ${VersionPolicy.currentName()}.",
                13f, INK,
            ).margins(top = 6))
        }
        snap == null -> {
            box.addView(tv(
                "Version ${VersionPolicy.currentName()}. Checking phlipapp.com for updates…",
                13f, MUTED,
            ).margins(top = 6))
        }
        else -> {
            box.addView(tv(
                "You’re on the latest known build (${VersionPolicy.currentName()}).",
                13f, MUTED,
            ).margins(top = 6))
        }
    }
    box.addView(btn("Check for updates", if (below || newer) ACCENT else CHIP, INK) {
        VersionPolicy.refreshAsync(this) {
            if (VersionPolicy.isPlayInstall(this)) {
                val busy = hostService?.isLiveBusy() == true
                val started = PlayUpdateHelper.checkAndPromptFlexible(this) {
                    hostService?.isLiveBusy() == true
                }
                if (!started || busy) {
                    toast("Update paused while an event, pitch, or broadcast is live")
                }
            }
            refresh()
        }
        toast("Checking…")
    }.margins(top = 8))
    return box
}

/** Off-by-default ring buffer of rejected / anomalous requests. */
internal fun SettingsActivity.securityLogSection(): View {
    val box = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(CHIP)
        setPadding(dp(14), dp(12), dp(14), dp(12))
    }
    box.addView(tv("Security reject log", 15f, INK, bold = true))
    val on = SecurityRejectLog.isEnabled(this)
    box.addView(tv(
        if (on)
            "Recording rejected requests (no passwords or tokens). Useful when debugging probes or rate limits."
        else
            "Off. Turn on to record rejects (body too large, poll caps, edge gate, guest TTL, etc.) — host-visible only.",
        13f, MUTED,
    ).margins(top = 6))
    box.addView(btn(if (on) "Turn log off" else "Turn log on", if (on) CHIP else ACCENT, INK) {
        SecurityRejectLog.setEnabled(this, !on)
        if (!on) toast("Reject log on")
        refresh()
    }.margins(top = 8))
    if (on) {
        val lines = SecurityRejectLog.snapshot().take(12)
        if (lines.isEmpty()) {
            box.addView(tv("No rejects recorded yet.", 12f, MUTED).margins(top = 8))
        } else {
            val fmt = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US)
            val text = lines.joinToString("\n") { e ->
                "${fmt.format(java.util.Date(e.ts))} ${e.reason} ${e.path}" +
                    if (e.detail.isNotEmpty()) " (${e.detail})" else ""
            }
            box.addView(tv(text, 11f, INK).margins(top = 8))
        }
        box.addView(btn("Clear log", CHIP, INK) {
            SecurityRejectLog.clear()
            refresh()
        }.margins(top = 6))
    }
    return box
}

/** Must accept host regulations before creating any server (and before Public). */
internal fun SettingsActivity.hostRulesSection(): View {
    val box = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(CHIP)
        setPadding(dp(14), dp(12), dp(14), dp(12))
    }
    box.addView(tv(HostingConsent.HOST_RULES_TITLE, 15f, INK, bold = true))
    if (!hostRulesAccepted()) {
        box.addView(tv(HostingConsent.HOST_RULES_BODY, 13f, INK).margins(top = 8))
        box.addView(tv(
            "Required before creating servers or going Public.",
            12f, DANGER,
        ).margins(top = 6))
        box.addView(btn(HostingConsent.HOST_RULES_ACCEPT, ACCENT, INK) {
            prefs.edit().putBoolean(HostPublicGate.KEY_HOST_RULES_ACK, true).apply()
            toast("Server rules accepted — you can create servers")
            refresh()
        }.margins(top = 10))
    } else {
        box.addView(tv(
            "You accepted the host rules. You can create servers and run them on this phone.",
            13f, MUTED,
        ).margins(top = 6))
        box.addView(btn("Review server rules", CHIP, INK) {
            prefs.edit().putBoolean(HostPublicGate.KEY_HOST_RULES_ACK, false).apply()
            enforcePublicAcksOrDemote()
            refresh()
        }.margins(top = 8))
    }
    return box
}

internal fun SettingsActivity.cloudflareSection(
    svc: HostService?,
    skipAcks: Boolean = false,
): View {
    val prefs = svc?.cloudflarePrefs() ?: CloudflarePrefs(this)
    val box = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(CHIP)
        setPadding(dp(14), dp(12), dp(14), dp(12))
    }
    box.addView(tv("Public hosting (Cloudflare)", 15f, INK, bold = true))
    box.addView(tv(
        "Local = same Wi‑Fi. Public = Cloudflare Tunnel on your domain. " +
            "You need a Cloudflare account, a domain on Cloudflare, and an API token before any server can go Public.",
        13f, MUTED,
    ).margins(top = 4))

    if (!skipAcks) {
        if (!prefs.operatorAcknowledged) {
            box.addView(tv(HostingConsent.OPERATOR_ACK_TITLE, 14f, INK, bold = true).margins(top = 10))
            box.addView(tv(HostingConsent.OPERATOR_ACK_BODY, 13f, INK).margins(top = 6))
            box.addView(tv("Required before Public.", 12f, DANGER).margins(top = 6))
            box.addView(btn(HostingConsent.OPERATOR_ACK_ACCEPT, ACCENT, INK) {
                prefs.operatorAcknowledged = true
                refresh()
            }.margins(top = 10))
            return box
        }

        if (!prefs.dataDisclosureAcknowledged) {
            box.addView(tv(HostingConsent.DATA_ACK_TITLE, 14f, INK, bold = true).margins(top = 10))
            box.addView(tv(HostingConsent.DATA_ACK_BODY, 13f, INK).margins(top = 6))
            box.addView(tv("Required before Public.", 12f, DANGER).margins(top = 6))
            box.addView(btn(HostingConsent.DATA_ACK_ACCEPT, ACCENT, INK) {
                prefs.dataDisclosureAcknowledged = true
                refresh()
            }.margins(top = 10))
            box.addView(btn("Back — review operator responsibility", CHIP, INK) {
                prefs.operatorAcknowledged = false
                refresh()
            }.margins(top = 8))
            return box
        }

        if (!prefs.publicRiskAcknowledged) {
            box.addView(tv(HostingConsent.PUBLIC_RISK_TITLE, 14f, INK, bold = true).margins(top = 10))
            box.addView(tv(HostingConsent.PUBLIC_RISK_BODY, 13f, INK).margins(top = 6))
            box.addView(tv("Required before Public.", 12f, DANGER).margins(top = 6))
            box.addView(btn(HostingConsent.PUBLIC_RISK_ACCEPT, ACCENT, INK) {
                prefs.publicRiskAcknowledged = true
                toast("Public risk accepted — set up Cloudflare next")
                refresh()
            }.margins(top = 10))
            box.addView(btn("Review responsibility & data warnings", CHIP, INK) {
                prefs.operatorAcknowledged = false
                prefs.dataDisclosureAcknowledged = false
                prefs.publicRiskAcknowledged = false
                enforcePublicAcksOrDemote()
                refresh()
            }.margins(top = 8))
            return box
        }
    }

    if (prefs.hasNamedTunnel()) {
        box.addView(tv(
            "Cloudflare domain: ${prefs.domain}",
            13f, INK, bold = true,
        ).margins(top = 10))
        box.addView(tv(
            if (prefs.apiToken.isNotBlank())
                "API connected — Public publishes DNS, tunnel, and the edge Worker (invite gate)."
            else
                "Domain saved — paste an API token (Edit) so Phlip can publish DNS when you go Public.",
            12f, MUTED,
        ).margins(top = 4))
        box.addView(tv(
            when {
                prefs.edgeProvisioned && prefs.edgeEnforce ->
                    "Edge gate: on — friends need a valid invite before anything reaches this phone."
                prefs.edgeProvisioned ->
                    "Edge Worker: uploaded — turn a server Public (or Repair) to enforce the gate."
                else ->
                    "Edge Worker: not set up yet — tap Repair edge, or re-save your domain + token."
            },
            12f, if (prefs.edgeProvisioned && prefs.edgeEnforce) MUTED else DANGER,
        ).margins(top = 6))
        box.addView(tv(
            if (prefs.workersPlanPaid)
                "Workers plan: Paid — full public Broadcast (RSVP + reactions)."
            else
                "Workers plan: Free — public Broadcasts throttle KV writes (no guest reactions). Upgrade for busy events.",
            12f, MUTED,
        ).margins(top = 6))
        if (svc != null) {
            box.addView(btn(
                if (prefs.workersPlanPaid) "Switch to Free Workers plan" else "Mark Workers plan as Paid",
                CHIP, INK,
            ) {
                if (prefs.workersPlanPaid) {
                    prefs.workersPlan = app.phlip.server.publichost.cloudflare.CloudflarePrefs.PLAN_FREE
                    toast("Workers plan: Free — guest reactions off for public Broadcasts")
                    svc.syncWorkersPlanToEdge()
                    refresh()
                } else {
                    AlertDialog.Builder(this)
                        .setTitle("Mark Workers Paid?")
                        .setMessage(
                            "Only confirm after upgrading in Cloudflare:\n\n" +
                                "Account → Compute → Workers & Pages → upgrade Workers plan (\$5/month).\n\n" +
                                "This unlocks guest reactions and lifts Free-tier Broadcast throttles.",
                        )
                        .setPositiveButton("I’ve upgraded") { _, _ ->
                            prefs.workersPlan = app.phlip.server.publichost.cloudflare.CloudflarePrefs.PLAN_PAID
                            toast("Workers plan: Paid")
                            svc.syncWorkersPlanToEdge()
                            refresh()
                        }
                        .setNeutralButton("Open Workers plans") { _, _ -> openUrl(SettingsActivity.CF_WORKERS_PLANS) }
                        .setNegativeButton("Cancel", null)
                        .show()
                }
            }.margins(top = 6))
        }
        box.addView(btn("Open Workers plans", CHIP, INK) {
            openUrl(SettingsActivity.CF_WORKERS_PLANS)
        }.margins(top = 4))
        if (svc != null && prefs.edgeProvisioned) {
            box.addView(tv(
                if (prefs.relayCacheEnabled)
                    "Relay cache: on — members can read a sealed snapshot when this phone is asleep (uses KV writes)."
                else
                    "Relay cache: off — members only see live data while this phone is reachable.",
                12f, MUTED,
            ).margins(top = 10))
            box.addView(btn(
                if (prefs.relayCacheEnabled) "Turn off relay cache" else "Enable relay cache",
                if (prefs.relayCacheEnabled) CHIP else ACCENT,
                INK,
            ) {
                if (prefs.relayCacheEnabled) {
                    AlertDialog.Builder(this)
                        .setTitle("Turn off relay cache?")
                        .setMessage(
                            "Members will no longer get a Worker fallback when this phone is offline. " +
                                "The sealed snapshot on Cloudflare will be cleared.",
                        )
                        .setPositiveButton("Turn off") { _, _ ->
                            svc.setRelayCacheEnabled(false)
                            toast("Relay cache off")
                            refresh()
                        }
                        .setNegativeButton("Cancel", null)
                        .show()
                } else {
                    AlertDialog.Builder(this)
                        .setTitle("Enable relay cache?")
                        .setMessage(
                            "When Public servers are unreachable, members can still read an encrypted " +
                                "snapshot from your Cloudflare Worker. Writes still wait for this phone.\n\n" +
                                "Uses Worker KV writes — leave off on Free if you already hit Broadcast limits.",
                        )
                        .setPositiveButton("Enable") { _, _ ->
                            svc.setRelayCacheEnabled(true)
                            toast("Relay cache on — pushing snapshot…")
                            refresh()
                        }
                        .setNegativeButton("Cancel", null)
                        .show()
                }
            }.margins(top = 6))
        }
        box.addView(btn("Edit Cloudflare domain", CHIP, INK) {
            promptCloudflareDomainSetup(prefs)
        }.margins(top = 8))
        if (svc != null) {
            box.addView(btn("Rotate tunnel token", CHIP, INK) {
                AlertDialog.Builder(this)
                    .setTitle("Rotate tunnel token?")
                    .setMessage(
                        "Creates a new Cloudflare tunnel, re-points your Public addresses, " +
                            "repairs the edge Worker origins, and invalidates the old credentials. " +
                            "Use this if you think the host phone or token may have been compromised.\n\n" +
                            "Public servers stay Public; friends keep the same URLs after a short reconnect.",
                    )
                    .setPositiveButton("Rotate") { _, _ ->
                        toast("Rotating tunnel…")
                        svc.rotateTunnelToken { err ->
                            if (err == null) toast("Tunnel token rotated")
                            else {
                                AlertDialog.Builder(this)
                                    .setTitle("Tunnel rotate failed")
                                    .setMessage(err)
                                    .setPositiveButton("OK", null)
                                    .show()
                            }
                            refresh()
                        }
                    }
                    .setNegativeButton("Cancel", null)
                    .show()
            }.margins(top = 6))
            box.addView(btn(
                if (prefs.edgeProvisioned) "Repair edge Worker" else "Set up edge Worker",
                if (prefs.edgeProvisioned) CHIP else ACCENT,
                INK,
            ) {
                toast(if (prefs.edgeProvisioned) "Repairing edge…" else "Setting up edge…")
                svc.provisionOrRepairEdge { err ->
                    if (err == null) toast("Edge Worker ready — invite-link gate on for Public")
                    else {
                        AlertDialog.Builder(this)
                            .setTitle("Edge Worker setup failed")
                            .setMessage(err)
                            .setPositiveButton("OK", null)
                            .show()
                    }
                    refresh()
                }
            }.margins(top = 6))
            box.addView(btn("Disconnect Cloudflare domain", CHIP, INK) {
                toast("Disconnecting Cloudflare…")
                svc.disconnectCloudflareDomain { err ->
                    prefs.clearSecrets()
                    prefs.domain = ""
                    prefs.accountId = ""
                    prefs.zoneId = ""
                    prefs.tunnelId = ""
                    svc.refreshEdgeGateOnServers()
                    if (err != null) {
                        AlertDialog.Builder(this)
                            .setTitle("Disconnected with warnings")
                            .setMessage(
                                "Local Cloudflare settings were cleared, but some remote cleanup failed:\n\n$err\n\n" +
                                    "Check DNS and Worker routes in the Cloudflare dashboard for leftovers.",
                            )
                            .setPositiveButton("OK", null)
                            .show()
                    } else {
                        toast("Cloudflare domain cleared — Public needs setup again")
                    }
                    refresh()
                }
            }.margins(top = 6))
        } else {
            box.addView(tv(
                "Start hosting to rotate the tunnel, repair the edge Worker, or disconnect the domain.",
                12f, MUTED,
            ).margins(top = 8))
            box.addView(btn("Disconnect domain (clear saved secrets)", CHIP, INK) {
                prefs.clearSecrets()
                prefs.domain = ""
                prefs.accountId = ""
                prefs.zoneId = ""
                prefs.tunnelId = ""
                toast("Cloudflare domain cleared — Public needs setup again")
                refresh()
            }.margins(top = 6))
        }
    } else {
        box.addView(tv(
            "Public is locked until Cloudflare is set up. Connect Cloudflare, create an API token, then choose your domain.",
            13f, INK,
        ).margins(top = 10))
        box.addView(btn("Set up Cloudflare domain", ACCENT, INK) {
            showCloudflareConnect()
        }.margins(top = 8))
    }

    if (!skipAcks) {
        box.addView(btn("Review responsibility & data warnings", CHIP, INK) {
            prefs.operatorAcknowledged = false
            prefs.dataDisclosureAcknowledged = false
            prefs.publicRiskAcknowledged = false
            enforcePublicAcksOrDemote()
            refresh()
        }.margins(top = 8))
    }
    return box
}

internal fun SettingsActivity.promptCloudflareDomainSetup(prefs: app.phlip.server.publichost.cloudflare.CloudflarePrefs) {
    val box = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(20), dp(8), dp(20), 0)
    }
    box.addView(tv(
        "Enter your Cloudflare domain and API token. Connecting creates hosting resources in your account.\n\n" +
            "Your token needs these permissions:\n" +
            "1. Account → Cloudflare Tunnel → Edit\n" +
            "2. Account → Workers Scripts → Edit\n" +
            "3. Account → Workers KV Storage → Edit\n" +
            "4. Zone → DNS → Edit\n" +
            "5. Zone → Workers Routes → Edit\n\n" +
            "On Zone rows, change the first dropdown from Account to Zone — " +
            "DNS and Workers Routes only appear under Zone (your domain).",
        13f, MUTED,
    ))
    box.addView(btn("Create API token", CHIP, INK) {
        openUrl(SettingsActivity.CF_API_TOKENS)
    }.margins(top = 8, bottom = 4))
    box.addView(btn("More info", CHIP, INK) {
        promptCloudflareDomainMoreInfo()
    }.margins(bottom = 8))
    val etDomain = EditText(this).apply {
        hint = "yourdomain.com"
        setText(prefs.domain)
    }
    val etApi = EditText(this).apply {
        hint = "Cloudflare API token"
        setText(prefs.apiToken)
        inputType = android.text.InputType.TYPE_CLASS_TEXT or
            android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
    }
    box.addView(etDomain)
    box.addView(etApi)
    val dialog = AlertDialog.Builder(this)
        .setTitle("Cloudflare domain")
        .setView(box)
        .setPositiveButton("Connect", null)
        .setNegativeButton("Cancel", null)
        .create()
    dialog.setOnShowListener {
        val connect = dialog.getButton(AlertDialog.BUTTON_POSITIVE)
        connect.setOnClickListener {
            val domain = etDomain.text.toString().trim().lowercase()
                .removePrefix("https://").removePrefix("http://").substringBefore("/").trim('.')
            val api = etApi.text.toString().trim()
            if (domain.isEmpty() || !domain.contains('.')) {
                toast("Enter your domain (e.g. example.com)")
                return@setOnClickListener
            }
            if (api.isEmpty()) {
                toast("Paste a Cloudflare API token")
                return@setOnClickListener
            }
            connect.isEnabled = false
            connect.text = "Connecting…"
            toast("Talking to Cloudflare…")
            Thread({
                try {
                    val saved = app.phlip.server.publichost.cloudflare.CloudflareApi.provisionNamedHosting(api, domain, prefs)
                    // Same step: upload edge Worker (invite-link gate + Broadcast KV).
                    var edgeNote = ""
                    try {
                        val script = assets.open("edge/phlip-edge-worker.js").use { it.readBytes() }
                        app.phlip.server.publichost.cloudflare.CloudflareApi.provisionEdge(
                            api, prefs, script, "http://127.0.0.1:1", emptyList(),
                        )
                        edgeNote = " · edge Worker ready"
                    } catch (edgeErr: Throwable) {
                        android.util.Log.w("AshCf", "edge provision after setup failed", edgeErr)
                        edgeNote = " · edge Worker pending (check token Workers permissions, then Repair)"
                    }
                    runOnUiThread {
                        dialog.dismiss()
                        toast("Cloudflare ready: $saved$edgeNote")
                        refresh()
                    }
                } catch (t: Throwable) {
                    runOnUiThread {
                        connect.isEnabled = true
                        connect.text = "Retry connection"
                        val detail = app.phlip.server.publichost.cloudflare.CloudflareApi.describeFailure(t)
                        AlertDialog.Builder(this)
                            .setTitle("Cloudflare setup failed")
                            .setMessage(detail)
                            .setPositiveButton("OK", null)
                            .show()
                    }
                }
            }, "ash-cf-setup").apply { isDaemon = true }.start()
        }
    }
    dialog.show()
}

internal fun SettingsActivity.promptCloudflareDomainMoreInfo() {
    AlertDialog.Builder(this)
        .setTitle("About Cloudflare domain")
        .setMessage(
                "What it does\n" +
                "Lets friends open your Phlip server from anywhere on the internet, " +
                "using a normal web address on your domain. Traffic hits a Phlip edge Worker first " +
                "(personal invite-link gate + event Broadcasts), then an unguessable tunnel to this phone.\n\n" +
                "How to get a domain on Cloudflare\n" +
                "1. Create a free account at cloudflare.com.\n" +
                "2. Add a site: buy a domain from Cloudflare, or add one you already own.\n" +
                "3. If the domain is registered elsewhere, Cloudflare will ask you to change " +
                "the domain’s nameservers at your registrar — follow their checklist until " +
                "the domain shows as Active.\n" +
                "4. Then create an API token (see the setup screen) and paste your domain + token here. " +
                "Phlip sets up the tunnel and edge Worker in one step.\n\n" +
                "What you need\n" +
                "A Cloudflare account with a domain Active on it, and an API token with Tunnel, DNS, " +
                "Workers Scripts, Workers KV, and Workers Routes. Public hosting will not work until this is set up.\n\n" +
                "Public event Broadcasts\n" +
                "Guest join, RSVP, and reactions for public Broadcast links always run on the edge Worker " +
                "(Workers KV), not on the phone tunnel. Free plan allows about 1,000 KV writes per day — " +
                "Phlip throttles Free Broadcasts (no guest reactions). For full Broadcasts, upgrade:\n" +
                "Cloudflare Account → Compute → Workers & Pages → upgrade Workers plan (\$5/month), " +
                "then mark Paid in Phlip Settings. Ordinary Public invite-link hosting can stay on Free.\n\n" +
                app.phlip.server.HostingConsent.HSTS_GUIDE_TITLE + "\n" +
                app.phlip.server.HostingConsent.HSTS_GUIDE_BODY + "\n\n" +
                "Risks\n" +
                "• You are the host and are liable for the server and its content — " +
                "who joins, what people post, and what’s stored on this phone.\n" +
                "• Cloudflare can see that people connected (and some connection details).\n" +
                "• The phone must stay on and online; if it sleeps or loses wifi, Public stops.\n" +
                "• Keep your API token private — it can change DNS and Workers on your account. " +
                "Prefer a token scoped only to this zone (Tunnel, DNS Edit, Workers Scripts/KV/Routes) — not account-wide Edit.",
        )
        .setPositiveButton("Open Cloudflare") { _, _ -> openUrl(SettingsActivity.CF_DASHBOARD) }
        .setNegativeButton("Got it", null)
        .show()
}

internal fun SettingsActivity.maybeShowHstsGuide(source: Intent?) {
    if (source?.getBooleanExtra(SettingsActivity.EXTRA_SHOW_HSTS_GUIDE, false) != true) return
    source.removeExtra(SettingsActivity.EXTRA_SHOW_HSTS_GUIDE)
    handler.post {
        if (!isFinishing && screen == SettingsActivity.Screen.CLOUDFLARE) promptCloudflareHstsGuide()
    }
}

internal fun SettingsActivity.promptCloudflareHstsGuide() {
    AlertDialog.Builder(this)
        .setTitle(HostingConsent.HSTS_GUIDE_TITLE)
        .setMessage(HostingConsent.HSTS_GUIDE_BODY)
        .setPositiveButton("Open Cloudflare") { _, _ -> openUrl(SettingsActivity.CF_DASHBOARD) }
        .setNegativeButton("Done", null)
        .show()
}

internal fun SettingsActivity.openUrl(url: String) {
    try {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    } catch (_: Exception) {
        toast("Could not open browser")
    }
}

internal fun SettingsActivity.publicReady(): Boolean {
    val cf = hostService?.cloudflarePrefs() ?: return false
    return HostPublicGate.canGoPublic(this, cf)
}

internal fun SettingsActivity.publicBlockReason(): String? {
    val cf = hostService?.cloudflarePrefs() ?: return "Start hosting first"
    return HostPublicGate.blockReason(this, cf)
}

