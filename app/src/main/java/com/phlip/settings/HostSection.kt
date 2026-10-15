package com.phlip.settings

import android.content.Intent

import android.content.Context
import android.provider.Settings
import android.widget.ScrollView
import com.phlip.PendingJoinMessages
import com.phlip.R
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.core.graphics.ColorUtils
import app.phlip.server.DevicePatchStatus
import app.phlip.server.HostService
import app.phlip.server.HostingConsent
import app.phlip.server.PRESET_BUSINESS
import app.phlip.server.PRESET_CIRCLES
import app.phlip.server.PRESET_CLUB
import app.phlip.server.PRESET_FAMILY
import app.phlip.server.PRESET_FRIEND
import app.phlip.server.PRESET_SCRATCH
import app.phlip.server.local.ApprovedNetworks
import app.phlip.server.normalizeSetupPreset
import app.phlip.server.publichost.HostPublicGate
import com.phlip.SettingsActivity
import com.phlip.settings.SettingsTheme.ACCENT
import com.phlip.settings.SettingsTheme.CHIP
import com.phlip.settings.SettingsTheme.DANGER
import com.phlip.settings.SettingsTheme.INK
import com.phlip.settings.SettingsTheme.MUTED
import com.phlip.settings.SettingsTheme.PUBLIC_LIVE
import com.phlip.settings.SettingsTheme.SURFACE
import com.phlip.settings.SettingsTheme.BORDER


/** Host / networks / host-info settings screens. */
class HostSection(private val host: SettingsActivity) {
    fun renderHost(content: LinearLayout) = host.renderHostScreen(content)
    fun renderApprovedNetworks(content: LinearLayout) = host.renderApprovedNetworksScreen(content)
    fun renderHostInfo(content: LinearLayout) = host.renderHostInfoScreen(content)
}

internal fun SettingsActivity.renderHostScreen(content: LinearLayout) {
    val svc = hostService
    val running = svc != null && svc.isRunning()
    if (running) enforcePublicAcksOrDemote()

    content.addView(tv("Hosting on this phone", 20f, INK, bold = true))

    if (!running) {
        content.addView(tv("Host on this phone", 20f, INK, bold = true))
        content.addView(tv(
            "Start hosting, then create servers from the rail + in the app.",
            15f, MUTED,
        ).margins(top = 8, bottom = 24))
        content.addView(btn("Start Hosting", ACCENT, INK) { startHosting() })
        return
    }

    if (svc!!.isNetworkSuspended() && svc.serverStatuses().any { it.reachMode == "local" || it.isPublic }) {
        content.addView(networkPausedBanner(svc).margins(bottom = 12))
    }

    content.addView(tv("Hosting is on", 20f, INK, bold = true))
    svc.ensureLanDiscovery()
    content.addView(tv(
        "Keep the phone cool and uncovered while hosting.",
        13f, MUTED,
    ).margins(top = 8, bottom = 12))
    content.addView(btn("Approved networks", CHIP, INK) {
        showScreen(SettingsActivity.Screen.HOST_NETWORKS)
    }.margins(bottom = 8))
    content.addView(tv(
        "Create and configure servers in the app — rail + to create, the reach line on a server to configure.",
        13f, MUTED,
    ).margins(top = 8, bottom = 8))
    content.addView(btn("Stop hosting on this phone", CHIP, INK) { stopHosting() }.margins(top = 20))
    content.addView(btn("Host requirements and diagnostics", CHIP, INK) { showScreen(SettingsActivity.Screen.HOST_INFO) }.margins(top = 12))
}

internal fun SettingsActivity.networkPausedBanner(svc: HostService): View {
    val offline = !svc.hasPendingNetwork()
    val busy = !offline && svc.isLiveBusy()
    val box = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(12).toFloat()
            setColor(if (busy) 0xFFFFE8E5.toInt() else 0xFFFFF0D6.toInt())
        }
        setPadding(dp(14), dp(14), dp(14), dp(14))
    }
    if (offline) {
        box.addView(tv(HostingConsent.NETWORK_OFFLINE_TITLE, 16f, INK, bold = true))
        box.addView(tv(HostingConsent.NETWORK_OFFLINE_TEXT, 13f, INK).margins(top = 6))
        return box
    }
    box.addView(tv(HostingConsent.NETWORK_PAUSE_TITLE, 16f, INK, bold = true))
    box.addView(tv(
        if (busy) HostingConsent.NETWORK_PAUSE_BUSY_TEXT else HostingConsent.NETWORK_PAUSE_TEXT,
        13f, INK,
    ).margins(top = 6))
    box.addView(tv(HostingConsent.NETWORK_APPROVE_BODY, 12f, MUTED).margins(top = 8))
    val row = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        setPadding(0, dp(10), 0, 0)
    }
    row.addView(btn(HostingConsent.NETWORK_APPROVE_ONCE, ACCENT, INK) {
        ensureWifiSsidAccess {
            hostService?.refreshNetworkGate()
            hostService?.approvePendingNetwork(ApprovedNetworks.Trust.ONCE)
            toast("Network approved once")
            refresh()
        }
    }.apply {
        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            .apply { marginEnd = dp(6) }
    })
    row.addView(btn(HostingConsent.NETWORK_ALWAYS_TRUST, CHIP, INK) {
        ensureWifiSsidAccess {
            hostService?.refreshNetworkGate()
            hostService?.approvePendingNetwork(ApprovedNetworks.Trust.TRUSTED)
            toast("Network always trusted")
            refresh()
        }
    }.apply {
        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
    })
    box.addView(row)
    return box
}

internal fun SettingsActivity.renderApprovedNetworksScreen(content: LinearLayout) {
    val nets = ApprovedNetworks(this)
    // Location unlocks Wi‑Fi SSID; backfill once readable (existing blank labels).
    ensureWifiSsidAccess {
        hostService?.refreshNetworkGate()
        if (nets.backfillCurrentLabelIfPossible()) {
            handler.post { refresh() }
        }
    }
    content.addView(tv("Approved networks", 20f, INK, bold = true))
    content.addView(tv(
        "Phlip only serves on networks you approve. Trusted networks get full LAN behaviour " +
            "(including LAN Broadcast minting); approved-once networks allow hosting and " +
            "Nearby discovery without LAN Broadcast minting.",
        14f, MUTED,
    ).margins(top = 8, bottom = 16))
    val list = nets.list()
    val unnamedWifi = list.any {
        it.transport.equals("WIFI", ignoreCase = true) && it.label.isNullOrBlank()
    }
    if (unnamedWifi) {
        when {
            !hasWifiSsidPermission() -> {
                content.addView(tv(
                    "Allow Location so Phlip can show Wi‑Fi names for approved networks.",
                    13f, MUTED,
                ).margins(bottom = 12))
                content.addView(btn("Allow Location", ACCENT, INK) {
                    ensureWifiSsidAccess {
                        hostService?.refreshNetworkGate()
                        nets.backfillCurrentLabelIfPossible()
                        refresh()
                    }
                }.margins(bottom = 12))
            }
            !isWifiSsidLocationEnabled() -> {
                content.addView(tv(
                    "Turn on Location in system settings to show Wi‑Fi names.",
                    13f, MUTED,
                ).margins(bottom = 12))
                content.addView(btn("Open Location settings", CHIP, INK) {
                    openWifiSsidLocationSettings()
                }.margins(bottom = 12))
            }
        }
    }
    if (list.isEmpty()) {
        content.addView(tv("No approved networks yet.", 14f, MUTED))
    } else {
        for (rec in list) {
            content.addView(approvedNetworkCard(nets, rec).margins(bottom = 10))
        }
        content.addView(btn("Forget all", CHIP, DANGER) {
            AlertDialog.Builder(this)
                .setTitle("Forget all networks?")
                .setMessage("Hosting will pause on the next network until you approve again.")
                .setPositiveButton("Forget all") { _, _ ->
                    nets.forgetAll()
                    hostService?.refreshNetworkGate()
                    toast("Cleared approved networks")
                    refresh()
                }
                .setNegativeButton("Cancel", null)
                .show()
        }.margins(top = 12))
    }
}

internal fun SettingsActivity.approvedNetworkCard(nets: ApprovedNetworks, rec: ApprovedNetworks.Record): View {
    val box = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(CHIP)
        setPadding(dp(14), dp(14), dp(14), dp(14))
    }
    val name = rec.label?.trim()?.takeIf { it.isNotEmpty() }
    val transportLabel = when (rec.transport.uppercase()) {
        "WIFI" -> "Wi‑Fi"
        "ETHERNET" -> "Ethernet"
        "HOTSPOT" -> "Hotspot"
        "LAN" -> "LAN"
        else -> rec.transport.ifEmpty { "Network" }
    }
    val title = name ?: when {
        rec.transport.equals("HOTSPOT", ignoreCase = true) -> "Hotspot"
        else -> "$transportLabel (name unavailable)"
    }
    box.addView(tv(title, 15f, INK, bold = true))
    if (name != null && !rec.transport.equals("HOTSPOT", ignoreCase = true)) {
        box.addView(tv(transportLabel, 12f, MUTED).margins(top = 2))
    }
    val trustLabel = when (rec.trust) {
        ApprovedNetworks.Trust.TRUSTED -> "Trusted — full LAN"
        ApprovedNetworks.Trust.ONCE -> "Approved once — discovery on, no LAN Broadcast"
    }
    box.addView(tv(trustLabel, 13f, MUTED).margins(top = 4))
    box.addView(tv("Last seen ${formatRelative(rec.lastSeen)}", 12f, MUTED).margins(top = 2))
    val row = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        setPadding(0, dp(10), 0, 0)
    }
    if (rec.trust == ApprovedNetworks.Trust.ONCE) {
        row.addView(btn("Always trust", ACCENT, INK) {
            nets.setTrust(rec.fpHash, ApprovedNetworks.Trust.TRUSTED)
            hostService?.refreshNetworkGate()
            refresh()
        }.apply {
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                .apply { marginEnd = dp(6) }
        })
    }
    row.addView(btn("Forget", CHIP, DANGER) {
        nets.forget(rec.fpHash)
        hostService?.refreshNetworkGate()
        refresh()
    }.apply {
        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
    })
    box.addView(row)
    return box
}

internal fun SettingsActivity.formatRelative(ts: Long): String {
    if (ts <= 0L) return "unknown"
    val ago = System.currentTimeMillis() - ts
    val mins = ago / 60_000L
    return when {
        mins < 1 -> "just now"
        mins < 60 -> "${mins}m ago"
        mins < 60 * 48 -> "${mins / 60}h ago"
        else -> "${mins / (60 * 24)}d ago"
    }
}

/** Big in-page SETUP callout — rules, tips, Cloudflare acknowledgments. */
internal fun SettingsActivity.setupEntryCard(): View {
    val box = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(14).toFloat()
            setColor(ACCENT)
        }
        setPadding(dp(16), dp(16), dp(16), dp(16))
        isClickable = true
        isFocusable = true
        setOnClickListener { showScreen(SettingsActivity.Screen.HOST_INFO) }
    }
    box.addView(tv("SETUP", 13f, INK, bold = true).apply {
        letterSpacing = 0.08f
    })
    box.addView(tv(
        "Acknowledgments, device tips, host rules & Cloudflare",
        15f, INK, bold = true,
    ).margins(top = 4))
    box.addView(tv(
        "Open this before creating servers or going Public — everything for hosting setup is here.",
        13f, INK,
    ).margins(top = 6))
    box.addView(tv("Tap to open →", 13f, INK, bold = true).margins(top = 10))
    return box
}

/** Acknowledgments, tips, updates, security log, host rules, Cloudflare. */
internal fun SettingsActivity.renderHostInfoScreen(content: LinearLayout) {
    val svc = hostService
    val running = svc != null && svc.isRunning()
    enforcePublicAcksOrDemote()

    content.addView(tv(getString(R.string.settings_host_setup_title), 20f, INK, bold = true))
    content.addView(tv(
        getString(R.string.settings_host_setup_sub),
        14f, MUTED,
    ).margins(top = 8, bottom = 12))
    content.addView(publicAckChecklist().margins(bottom = 12))

    content.addView(updateStatusSection().margins(bottom = 8))
    content.addView(devicePatchSection().margins(top = 12, bottom = 8))
    content.addView(alphaAckSection().margins(top = 12, bottom = 8))
    content.addView(localPrepSection().margins(top = 12, bottom = 8))
    content.addView(devicePrepSection().margins(top = 12, bottom = 8))
    if (running) {
        content.addView(tv(
            "If your phone has a charge limit (e.g. 80%), turn it on — Phlip eases Wi‑Fi power when nobody is connected.",
            13f, MUTED,
        ).margins(top = 4, bottom = 8))
        content.addView(securityLogSection().margins(top = 12, bottom = 8))
        content.addView(hostRulesSection().margins(top = 12, bottom = 8))
    } else {
        content.addView(tv(
            "Start hosting from this screen when you’re ready. Create servers from the rail + in the app. Cloudflare domain setup below works anytime.",
            13f, MUTED,
        ).margins(top = 8, bottom = 8))
    }
    // Domain / API token does not require the host service to be running.
    content.addView(cloudflareSection(svc).margins(top = 12, bottom = 8))
}

/** Domain + API token only — opened from in-panel Hosting setup. */
internal fun SettingsActivity.serverCard(s: HostService.ServerStatus): View {
    val card = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(CHIP)
        setPadding(dp(12), dp(12), dp(12), dp(12))
    }.margins(top = 8, bottom = 2) as LinearLayout

    card.addView(tv(s.name, 17f, INK, bold = true))
    card.addView(tv(s.lanUrls.firstOrNull() ?: "starting…", 12f, MUTED).margins(bottom = 2))

    // Public hosting: panel for setup; kill switch drops Public immediately when live.
    val reach = if (s.isPublic) {
        when {
            !s.publicUrl.isNullOrBlank() -> "Public · ${s.publicUrl}"
            !s.error.isNullOrBlank() -> "Public · error — open Public hosting"
            else -> "Public · starting tunnel…"
        }
    } else {
        "Local · Wi‑Fi only"
    }
    card.addView(tv(
        reach, 12f,
        when {
            s.isPublic && !s.error.isNullOrBlank() -> DANGER
            s.isPublic -> PUBLIC_LIVE
            else -> MUTED
        },
    ).margins(top = 2))

    val pubRow = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
    }.margins(top = 4) as LinearLayout
    if (s.isPublic) {
        val manage = btn("Public · ON", PUBLIC_LIVE, 0xFFFFFFFF.toInt()) {
            openPublicHostingPanel(s)
        }.apply {
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        pubRow.addView(manage)
        pubRow.addView(spaced(btn("Kill switch", DANGER, 0xFFFFFFFF.toInt()) {
            killPublicHosting(s)
        }, 8))
    } else {
        pubRow.addView(btn("Public hosting", CHIP, INK) {
            openPublicHostingPanel(s)
        }.apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            )
        })
    }
    card.addView(pubRow)

    val inviteUrl = hostService?.hostInviteLink(s.id)
    card.addView(tv("Invite link: ${inviteUrl ?: "…"}", 13f, MUTED).margins(top = 6))
    card.addView(tv(
        "Friends open your personal link and request to join — you Approve them by name.",
        11f, MUTED,
    ).margins(top = 1))
    val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }.margins(top = 4) as LinearLayout
    actions.addView(btn("Share invite", ACCENT, INK) { shareInvite(s) })
    actions.addView(spaced(btn("Copy link", CHIP, INK) {
        val url = hostService?.hostInviteLink(s.id)
            ?: run { toast("No invite link ready yet — try again in a moment."); return@btn }
        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        cm.setPrimaryClip(android.content.ClipData.newPlainText("Phlip invite", url))
        toast("Invite link copied")
    }, 8))
    card.addView(actions)
    card.addView(btn("Rotate link", CHIP, INK) {
        AlertDialog.Builder(this)
            .setTitle("Rotate invite link?")
            .setMessage(
                "Your old personal invite link will stop working. " +
                    "Anyone with the old link will need the new one."
            )
            .setPositiveButton("Rotate") { _, _ ->
                val url = hostService?.rotateHostInviteLink(s.id)
                if (url != null) toast("Invite link rotated")
                else toast("Could not rotate invite link")
                refresh()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }.margins(top = 4))

    if (s.pending.isNotEmpty()) {
        card.addView(tv("Waiting to join", 13f, MUTED, bold = true).margins(top = 8))
        for (p in s.pending) {
            val prow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
                .margins(top = 4) as LinearLayout
            val via = p.invitedByName?.trim()?.takeIf { it.isNotEmpty() }
            val label = if (via != null) "${p.name}\nRequested via $via" else p.name
            prow.addView(tv(label, 14f, INK).apply {
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            })
            prow.addView(btn("Approve", 0xFF2e7d32.toInt(), 0xFFFFFFFF.toInt()) { hostService?.approve(s.id, p.id) })
            prow.addView(spaced(btn("Deny", 0xFF7f0000.toInt(), 0xFFFFFFFF.toInt()) { hostService?.deny(s.id, p.id) }, 6))
            card.addView(prow)
        }
    }

    card.addView(btn("Delete server", CHIP, DANGER) { confirmDelete(s) }.margins(top = 8))
    return card
}

/* ── actions ── */

internal fun SettingsActivity.showCreateDialog() {
    val svc = hostService ?: return
    if (!alphaAckAccepted()) {
        toast("Accept the alpha software risks in Setup first")
        showScreen(SettingsActivity.Screen.HOST_INFO)
        return
    }
    val box = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(20), dp(8), dp(20), 0)
    }
    box.addView(tv("What kind of server is this?", 14f, MUTED).margins(bottom = 8))

    val presets = listOf(
        Triple(PRESET_FRIEND, "Friend group", "A shared hub for friends to suggest plans, with extra private boards for smaller groups."),
        Triple(PRESET_FAMILY, "Family", "One shared family board, plus the option to follow individual family members' plans in their own boards."),
        Triple(PRESET_CIRCLES, "Separate circles", "Separate Work, Home and Friends boards, each with its own people and access, rather than one shared group board."),
        Triple(PRESET_CLUB, "Club or organisation", "Structured sessions. Say the activity for matching courts, pitches or event types."),
        Triple(PRESET_BUSINESS, "Business", "You post the classes and events — customers RSVP."),
        Triple(PRESET_SCRATCH, "Start from scratch", "Open permissions, no auto-include — you shape it."),
    )
    var selectedPreset = PRESET_FRIEND
    val etActivity = EditText(this).apply {
        hint = "Activity (e.g. Tennis)"
        visibility = View.GONE
    }
    val flatGroup = RadioGroup(this).apply { orientation = LinearLayout.VERTICAL }
    var friendViewId = View.NO_ID
    for ((id, title, blurb) in presets) {
        val rb = RadioButton(this).apply {
            this.id = View.generateViewId()
            text = "$title\n$blurb"
            tag = id
            setPadding(0, dp(6), 0, dp(6))
        }
        if (id == PRESET_FRIEND) friendViewId = rb.id
        flatGroup.addView(rb)
    }
    // check() after children have unique ids — setting isChecked while adding
    // leaves multiple radios selected when ids are all NO_ID.
    if (friendViewId != View.NO_ID) flatGroup.check(friendViewId)
    flatGroup.setOnCheckedChangeListener { group, checkedId ->
        if (checkedId == View.NO_ID) return@setOnCheckedChangeListener
        val rb = group.findViewById<RadioButton>(checkedId) ?: return@setOnCheckedChangeListener
        selectedPreset = (rb.tag as? String) ?: PRESET_FRIEND
        etActivity.hint = if (selectedPreset == PRESET_BUSINESS) {
            "What do you host? (e.g. Pottery classes)"
        } else {
            "Activity (e.g. Tennis)"
        }
        etActivity.visibility = if (selectedPreset == PRESET_CLUB || selectedPreset == PRESET_BUSINESS) {
            View.VISIBLE
        } else {
            View.GONE
        }
    }
    box.addView(flatGroup)
    box.addView(etActivity.margins(top = 4, bottom = 8))
    val etServer = EditText(this).apply { hint = "Server name (e.g. Family)" }
    val etName = EditText(this).apply { hint = "Your name (host)"; setText(prefs.getString(SettingsActivity.KEY_HOST_NAME, "")) }
    box.addView(etServer)
    box.addView(etName)
    AlertDialog.Builder(this)
        .setTitle("Create a server")
        .setMessage("This seeds event types, permissions, and who new people join as. You can change everything later in Setup guide.")
        .setView(box)
        .setPositiveButton("Create") { _, _ ->
            if (!alphaAckAccepted()) {
                toast("Accept the alpha software risks in Setup first")
                return@setPositiveButton
            }
            val server = etServer.text.toString().trim()
            val host = etName.text.toString().trim()
            if (server.isEmpty() || host.isEmpty()) { toast("Fill in all fields."); return@setPositiveButton }
            prefs.edit().putString(SettingsActivity.KEY_HOST_NAME, host).apply()
            val activity = etActivity.text.toString().trim().ifEmpty { null }
            val created = svc.createServer(server, host, false, selectedPreset, activity)
            if (created == null) toast("Couldn’t create server — accept the alpha risks first")
            else toast(when (selectedPreset) {
                PRESET_CLUB -> "Club server ready"
                PRESET_CIRCLES -> "Circles server ready"
                PRESET_FAMILY -> "Family server ready"
                PRESET_BUSINESS -> "Business server ready"
                PRESET_SCRATCH -> "Blank server ready"
                else -> "Friend group ready"
            })
            refresh()
        }
        .setNegativeButton("Cancel", null)
        .show()
}

internal fun SettingsActivity.killPublicHosting(s: HostService.ServerStatus) {
    AlertDialog.Builder(this)
        .setTitle("Turn off Public?")
        .setMessage(
            "This drops the public tunnel now. Friends off your Wi‑Fi lose access until you turn Public on again.",
        )
        .setPositiveButton("Kill Public") { _, _ ->
            hostService?.setPublic(s.id, false)
            toast("Public off — Local only")
            refresh()
        }
        .setNegativeButton("Cancel", null)
        .show()
}

/**
 * Per-server Public hosting: checklist of Setup requirements, then Local/Public
 * and address controls (moved off the main Host settings card).
 */
internal fun SettingsActivity.openPublicHostingPanel(s: HostService.ServerStatus) {
    val svc = hostService ?: return
    val live = svc.serverStatuses().find { it.id == s.id } ?: s
    val ready = publicReady()
    val box = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(20), dp(8), dp(20), dp(4))
    }
    box.addView(tv(live.name, 16f, INK, bold = true))
    box.addView(tv(
        if (live.isPublic) "This server is Public — reachable from the internet."
        else "This server is Local — same Wi‑Fi only.",
        13f, MUTED,
    ).margins(top = 4, bottom = 10))
    box.addView(publicAckChecklist())
    if (!ready) {
        box.addView(tv(
            publicBlockReason() ?: "Complete every item above before enabling Public.",
            13f, DANGER,
        ).margins(top = 10))
    }

    val namedHost = live.namedHostname
    if (namedHost.isNotEmpty()) {
        val subLabel = live.publicSubdomain.ifEmpty {
            namedHost.substringBefore('.', missingDelimiterValue = namedHost)
        }
        box.addView(tv("Public address: https://$namedHost", 13f, MUTED).margins(top = 12))
        box.addView(tv(
            if (live.publicSubdomain.isEmpty())
                "Subdomain follows the server name ($subLabel). Change it anytime."
            else "Custom subdomain: $subLabel",
            12f, MUTED,
        ).margins(top = 2))
        box.addView(btn("Change address", CHIP, INK) {
            editPublicSubdomain(live)
        }.margins(top = 6))
    }

    if (!live.error.isNullOrBlank()) {
        box.addView(tv("Tunnel error: ${live.error}", 12f, DANGER).margins(top = 8))
    } else if (live.isPublic) when {
        live.publicUrl != null -> {
            box.addView(tv("Live link: ${live.publicUrl}", 12f, MUTED).margins(top = 8))
            val pubRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
            }.margins(top = 4) as LinearLayout
            pubRow.addView(btn("Copy link", CHIP, INK) {
                val cm = getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                cm.setPrimaryClip(android.content.ClipData.newPlainText("Phlip public", live.publicUrl))
                toast("Public link copied")
            })
            pubRow.addView(spaced(btn("Test link", CHIP, INK) {
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(live.publicUrl)))
                } catch (_: Exception) {
                    toast("No browser to open link")
                }
            }, 8))
            box.addView(pubRow)
        }
        else -> box.addView(tv("Starting Cloudflare tunnel…", 12f, MUTED).margins(top = 8))
    }

    val rg = RadioGroup(this).apply { orientation = RadioGroup.HORIZONTAL }
        .margins(top = 14) as RadioGroup
    val rbLocal = RadioButton(this).apply {
        id = View.generateViewId()
        text = "Local"
        setTextColor(INK)
    }
    val rbPublic = RadioButton(this).apply {
        id = View.generateViewId()
        text = if (ready) "Public" else "Public (locked)"
        setTextColor(if (ready) INK else MUTED)
        isEnabled = ready
    }
    rg.addView(rbLocal)
    rg.addView(rbPublic)
    if (live.isPublic && ready) rbPublic.isChecked = true else rbLocal.isChecked = true
    box.addView(rg)
    box.addView(tv(
        if (ready) "Switch to Public only when you want friends off your Wi‑Fi to reach this server."
        else "Finish Setup (checklist above), then return here to enable Public.",
        12f, MUTED,
    ).margins(top = 6))

    val scroll = ScrollView(this).apply {
        addView(box)
        isFillViewport = true
    }

    val dialog = AlertDialog.Builder(this)
        .setTitle("Public hosting")
        .setView(scroll)
        .setNegativeButton("Close") { _, _ -> refresh() }
        .apply {
            if (!ready) {
                setNeutralButton("Open Setup") { _, _ -> showScreen(SettingsActivity.Screen.HOST_INFO) }
            }
        }
        .setOnDismissListener { refresh() }
        .create()

    fun reopen() {
        dialog.dismiss()
        refresh()
        svc.serverStatuses().find { it.id == live.id }?.let { openPublicHostingPanel(it) }
    }

    fun bindRadios() {
        rg.setOnCheckedChangeListener { group, checkedId ->
            val wantPublic = checkedId == rbPublic.id
            if (wantPublic == live.isPublic) return@setOnCheckedChangeListener
            if (wantPublic && !publicReady()) {
                toast(publicBlockReason() ?: "Complete Setup before going Public")
                group.setOnCheckedChangeListener(null)
                rbLocal.isChecked = true
                bindRadios()
                return@setOnCheckedChangeListener
            }
            if (wantPublic) {
                group.setOnCheckedChangeListener(null)
                rbLocal.isChecked = true
                bindRadios()
                AlertDialog.Builder(this)
                    .setTitle(HostingConsent.PUBLIC_RISK_TITLE)
                    .setMessage(HostingConsent.PUBLIC_RISK_BODY)
                    .setPositiveButton(HostingConsent.PUBLIC_RISK_ACCEPT) { _, _ ->
                        val ok = svc.setPublic(live.id, true)
                        if (!ok) {
                            toast(
                                svc.serverStatuses().find { it.id == live.id }?.error
                                    ?: publicBlockReason()
                                    ?: "Complete every acknowledgment in Setup first",
                            )
                        }
                        reopen()
                    }
                    .setNegativeButton("Cancel", null)
                    .show()
                return@setOnCheckedChangeListener
            }
            svc.setPublic(live.id, false)
            reopen()
        }
    }
    bindRadios()
    dialog.show()
}

internal fun SettingsActivity.editPublicSubdomain(s: HostService.ServerStatus) {
    val svc = hostService ?: return
    val prefs = svc.cloudflarePrefs()
    if (!prefs.hasNamedTunnel()) {
        toast("Named Cloudflare domain required")
        return
    }
    val apex = prefs.domain.trim().lowercase()
    val currentLabel = s.publicSubdomain.ifEmpty {
        s.namedHostname.substringBefore('.', missingDelimiterValue = "")
    }
    val et = EditText(this).apply {
        hint = "subdomain"
        setText(currentLabel)
        setSelection(text.length)
        inputType = android.text.InputType.TYPE_CLASS_TEXT or
            android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS or
            android.text.InputType.TYPE_TEXT_VARIATION_URI
    }
    AlertDialog.Builder(this)
        .setTitle("Public address")
        .setMessage(
            "Friends will open https://<subdomain>.$apex\n\n" +
                "Letters, numbers, and hyphens only. Leave blank and tap Use server name " +
                "to derive it from “${s.name}” again." +
                if (s.isPublic) "\n\nIf Public is on, the tunnel updates to the new address (old one stops working)."
                else ""
        )
        .setView(et.apply { setPadding(dp(20), dp(12), dp(20), dp(4)) })
        .setPositiveButton("Save") { _, _ ->
            val err = svc.setPublicSubdomain(s.id, et.text.toString())
            if (err != null) toast(err) else {
                toast("Address updated")
                refresh()
            }
        }
        .setNeutralButton("Use server name") { _, _ ->
            val err = svc.setPublicSubdomain(s.id, "")
            if (err != null) toast(err) else {
                toast("Using name-based address")
                refresh()
            }
        }
        .setNegativeButton("Cancel", null)
        .show()
}

internal fun SettingsActivity.confirmDelete(s: HostService.ServerStatus) {
    AlertDialog.Builder(this)
        .setTitle("Delete ${s.name}?")
        .setMessage("Removes this server and all its data on this device. This can't be undone.")
        .setPositiveButton("Delete") { _, _ -> hostService?.deleteServer(s.id); refresh() }
        .setNegativeButton("Cancel", null)
        .show()
}

/** Share personal invite URL (request-to-join). */
internal fun SettingsActivity.shareInvite(s: HostService.ServerStatus) {
    val url = hostService?.hostInviteLink(s.id)
        ?: run { toast("No invite link ready yet — try again in a moment."); return }
    val body = buildString {
        append("Join my Phlip server \"${s.name}\"\n\n")
        append("$url\n\n")
        append("Open the link and request to join — I’ll approve new people.")
    }
    sharePlainText(body, "Share invite")
}

internal fun SettingsActivity.pendingJoinMessage(serverName: String, p: app.phlip.server.PendingInfo): String =
    PendingJoinMessages.format(serverName, p.name, p.invitedByName)

internal fun SettingsActivity.sharePlainText(body: String, chooserTitle: String) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, body)
    }
    try { startActivity(Intent.createChooser(send, chooserTitle)) } catch (_: Exception) {}
}

internal fun SettingsActivity.requestBatteryOptimisationExemption() {
    val pm = getSystemService(android.os.PowerManager::class.java)
    if (!pm.isIgnoringBatteryOptimizations(packageName)) {
        startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
            data = Uri.parse("package:$packageName")
        })
    }
}
