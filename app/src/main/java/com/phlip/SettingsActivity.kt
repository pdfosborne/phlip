package com.phlip

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.SharedPreferences
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.view.Menu
import android.view.MenuItem
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.Toolbar
import androidx.core.graphics.ColorUtils
import app.phlip.server.local.ApprovedNetworks
import app.phlip.server.DevicePatchStatus
import app.phlip.server.publichost.HostPublicGate
import app.phlip.server.HostService
import app.phlip.server.HostingConsent
import app.phlip.server.PRESET_CIRCLES
import app.phlip.server.PRESET_CLUB
import app.phlip.server.PRESET_FRIEND
import app.phlip.server.PRESET_SCRATCH
import app.phlip.server.SecurityRejectLog
import app.phlip.server.publichost.cloudflare.CloudflareApi
import app.phlip.server.publichost.cloudflare.CloudflarePrefs
import app.phlip.server.normalizeSetupPreset
import com.phlip.settings.SettingsTheme
import com.phlip.settings.ViewBuilders
import com.phlip.settings.AboutSection
import com.phlip.settings.HostSection
import com.phlip.settings.CloudflareSection
import com.phlip.settings.maybeShowHstsGuide
import com.phlip.settings.pendingJoinMessage
import com.phlip.settings.requestBatteryOptimisationExemption
import com.phlip.settings.openUrl
import com.phlip.settings.cloudflareSection
import com.phlip.network.WifiSsidAccessGate

/** Settings hub: Host settings, Support us, Legal, Contact, and Help. */
class SettingsActivity : AppCompatActivity() {

    internal enum class Screen { HUB, HOST, HOST_INFO, HOST_NETWORKS, CLOUDFLARE, SUPPORT, LEGAL, CONTACT }

    internal var screen: Screen = Screen.HUB
    /** True when opened straight to a screen (menu / notification) — back exits instead of the hub. */
    private var openedDirect = false
    private val shownJoinDialogs = HashSet<String>()
    private var joinDialog: AlertDialog? = null
    private var joinDialogKey: String? = null

    internal val prefs: SharedPreferences by lazy { getSharedPreferences(PREFS_NAME, MODE_PRIVATE) }
    internal val handler = Handler(Looper.getMainLooper())

    internal val ui by lazy { ViewBuilders(this) }
    private val aboutSection by lazy { AboutSection(this) }
    private val hostSection by lazy { HostSection(this) }
    private val cloudflareSectionUi by lazy { CloudflareSection(this) }
    internal val cloudflareConnectUi by lazy { com.phlip.settings.CloudflareConnectFlow(this) }

    private val statusListener: () -> Unit = {
        runOnUiThread {
            // Keep Approve dialog if its request is still pending; otherwise dismiss
            // (e.g. an admin approved in People) and rebuild the screen.
            if (joinDialog?.isShowing == true) {
                dismissStaleJoinDialog()
                if (joinDialog?.isShowing == true) return@runOnUiThread
            }
            refresh()
            showPendingJoinDialogs()
        }
    }

    private val hostConnector = HostServiceConnector(
        this,
        onConnected = { svc ->
            svc.addStatusListener(statusListener)
            refresh()
            showPendingJoinDialogs()
        },
        onDisconnected = { previous ->
            previous?.removeStatusListener(statusListener)
            refresh()
        },
    )

    private val wifiSsidPermissionLauncher: androidx.activity.result.ActivityResultLauncher<String> =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            wifiSsidAccess.onPermissionResult(granted)
        }

    private val wifiSsidAccess = WifiSsidAccessGate(
        activity = this,
        requestPermission = { permission -> wifiSsidPermissionLauncher.launch(permission) },
    )

    /** Location permission so Approved networks can show the Wi‑Fi SSID. */
    internal fun ensureWifiSsidAccess(onReady: () -> Unit) =
        wifiSsidAccess.ensureFineLocation(onReady)

    internal fun hasWifiSsidPermission(): Boolean = wifiSsidAccess.hasFineLocationPermission()

    internal fun isWifiSsidLocationEnabled(): Boolean = wifiSsidAccess.isSystemLocationEnabled()

    internal fun openWifiSsidLocationSettings() = wifiSsidAccess.openSystemLocationSettings()

    internal var hostService: HostService?
        get() = hostConnector.service
        set(value) {
            if (value == null) hostConnector.clearServiceHandle()
        }

    private var bound: Boolean
        get() = hostConnector.bound
        set(_) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        setSupportActionBar(findViewById<Toolbar>(R.id.toolbar))
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        screen = screenFromIntent(intent)
        openedDirect = !intent?.getStringExtra(EXTRA_SCREEN).isNullOrBlank()
        if (savedInstanceState != null) {
            screen = Screen.entries.getOrElse(savedInstanceState.getInt(STATE_SCREEN, 0)) { Screen.HUB }
            openedDirect = savedInstanceState.getBoolean(STATE_OPENED_DIRECT, openedDirect)
        }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                navigateSettingsBack()
            }
        })
        refresh()
        if (savedInstanceState == null) maybeShowHstsGuide(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        openedDirect = !intent.getStringExtra(EXTRA_SCREEN).isNullOrBlank()
        showScreen(screenFromIntent(intent))
        maybeShowHstsGuide(intent)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putInt(STATE_SCREEN, screen.ordinal)
        outState.putBoolean(STATE_OPENED_DIRECT, openedDirect)
    }

    override fun onSupportNavigateUp(): Boolean {
        navigateSettingsBack()
        return true
    }

    private fun navigateSettingsBack() {
        if (intent.getStringExtra(EXTRA_SCREEN) == SCREEN_CLOUDFLARE_CONNECT &&
            screen == Screen.CLOUDFLARE &&
            cloudflareConnectUi.handleBack()
        ) return
        when {
            screen == Screen.HOST_INFO && !openedDirect -> showScreen(Screen.HOST)
            screen == Screen.HOST_NETWORKS && !openedDirect -> showScreen(Screen.HOST)
            screen == Screen.CLOUDFLARE && !openedDirect -> showScreen(Screen.HOST_INFO)
            !openedDirect && screen != Screen.HUB -> showScreen(Screen.HUB)
            else -> finish()
        }
    }

    internal fun showCloudflareConnect() {
        intent.putExtra(EXTRA_SCREEN, SCREEN_CLOUDFLARE_CONNECT)
        showScreen(Screen.CLOUDFLARE)
    }

    private fun screenFromIntent(intent: Intent?): Screen = when (intent?.getStringExtra(EXTRA_SCREEN)) {
        SCREEN_SUPPORT -> Screen.SUPPORT
        SCREEN_HOST -> Screen.HOST
        SCREEN_HOST_SETUP -> Screen.HOST_INFO
        SCREEN_HOST_NETWORKS -> Screen.HOST_NETWORKS
        SCREEN_CLOUDFLARE, SCREEN_CLOUDFLARE_CONNECT -> Screen.CLOUDFLARE
        SCREEN_LEGAL -> Screen.LEGAL
        SCREEN_CONTACT -> Screen.CONTACT
        else -> Screen.HUB
    }

    internal fun showScreen(next: Screen) {
        screen = next
        invalidateOptionsMenu()
        refresh()
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        if (screen == Screen.HOST) {
            val item = menu.add(Menu.NONE, MENU_HOST_INFO, Menu.NONE, R.string.settings_host_info)
            item.setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS)
            item.actionView = setupToolbarChip().also { chip ->
                chip.setOnClickListener { showScreen(Screen.HOST_INFO) }
            }
        }
        return true
    }

    /** High-contrast SETUP pill in the toolbar — hard to miss. */
    private fun setupToolbarChip(): TextView = TextView(this).apply {
        text = getString(R.string.settings_host_info).uppercase()
        textSize = 13f
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(INK)
        letterSpacing = 0.06f
        background = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(20).toFloat()
            setColor(ACCENT)
        }
        val padH = dp(14)
        val padV = dp(8)
        setPadding(padH, padV, padH, padV)
        minHeight = dp(36)
        gravity = Gravity.CENTER
        contentDescription = getString(R.string.settings_host_setup_title)
        // Keep clear of the toolbar edge.
        val lp = android.view.ViewGroup.MarginLayoutParams(
            android.view.ViewGroup.LayoutParams.WRAP_CONTENT,
            android.view.ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        lp.marginEnd = dp(8)
        layoutParams = lp
        isClickable = true
        isFocusable = true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        if (item.itemId == MENU_HOST_INFO) {
            showScreen(Screen.HOST_INFO)
            return true
        }
        return super.onOptionsItemSelected(item)
    }

    override fun onStart() {
        super.onStart()
        // Bind if the service is already running; don't start it (starting is explicit).
        hostConnector.bind()
    }

    override fun onResume() {
        super.onResume()
        if (screen == Screen.HOST || screen == Screen.HOST_INFO || screen == Screen.HOST_NETWORKS) {
            VersionPolicy.refreshAsync(this) {
                if (!isFinishing && (screen == Screen.HOST || screen == Screen.HOST_INFO || screen == Screen.HOST_NETWORKS)) refresh()
            }
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && screen == Screen.CLOUDFLARE && intent.getStringExtra(EXTRA_SCREEN) == SCREEN_CLOUDFLARE_CONNECT) {
            cloudflareConnectUi.onWindowFocus()
        }
    }

    override fun onStop() {
        super.onStop()
        hostConnector.unbind { it.removeStatusListener(statusListener) }
    }

    /** Drop the host Approve dialog when that join request is gone (admin already acted). */
    private fun dismissStaleJoinDialog() {
        val open = joinDialog ?: return
        val key = joinDialogKey ?: return
        if (!open.isShowing) return
        val svc = hostService ?: return
        val pendingKeys = svc.serverStatuses()
            .flatMap { s -> s.pending.map { "${s.id}:${it.id}" } }
            .toSet()
        if (key in pendingKeys) return
        open.dismiss()
        joinDialog = null
        joinDialogKey = null
        shownJoinDialogs.remove(key)
    }

    /** In-app Approve/Deny dialog for waiting joiners (stays until you choose). */
    private fun showPendingJoinDialogs() {
        val svc = hostService ?: return
        if (isFinishing) return
        dismissStaleJoinDialog()
        val pending = svc.serverStatuses().flatMap { s -> s.pending.map { s to it } }
        if (joinDialog?.isShowing == true) return
        val next = pending.firstOrNull { (s, p) -> "${s.id}:${p.id}" !in shownJoinDialogs } ?: return
        val (server, p) = next
        val key = "${server.id}:${p.id}"
        shownJoinDialogs.add(key)
        joinDialogKey = key
        joinDialog = AlertDialog.Builder(this)
            .setTitle("Someone wants to join")
            .setMessage(pendingJoinMessage(server.name, p))
            .setPositiveButton("Approve") { _, _ ->
                val ok = svc.approve(server.id, p.id)
                joinDialog = null
                joinDialogKey = null
                shownJoinDialogs.remove(key)
                if (ok) toast("Approved — they can finish joining now")
                else toast("That join request expired — ask them to try again")
                handler.post { refresh(); showPendingJoinDialogs() }
            }
            .setNegativeButton("Deny") { _, _ ->
                svc.deny(server.id, p.id)
                joinDialog = null
                joinDialogKey = null
                shownJoinDialogs.remove(key)
                handler.post { refresh(); showPendingJoinDialogs() }
            }
            .setCancelable(false)
            .show()
    }

    /* ── hosting lifecycle ── */

    internal fun startHosting() {
        requestBatteryOptimisationExemption()
        hostConnector.startHosting()
        // onStartCommand (which flips isRunning) is dispatched async; nudge a refresh
        // shortly after so the server list appears without waiting on a status event.
        handler.postDelayed(::refresh, 400)
    }

    internal fun stopHosting() {
        hostConnector.stopHosting()
        refresh()
    }

    /* ── UI ── */

    internal fun refresh() {
        val content = findViewById<LinearLayout>(R.id.content) ?: return
        content.removeAllViews()
        supportActionBar?.title = when (screen) {
            Screen.HUB -> getString(R.string.action_settings)
            Screen.HOST -> getString(R.string.settings_host)
            Screen.HOST_INFO -> getString(R.string.settings_host_setup_title)
            Screen.HOST_NETWORKS -> "Approved networks"
            Screen.CLOUDFLARE -> "Cloudflare"
            Screen.SUPPORT -> getString(R.string.settings_support)
            Screen.LEGAL -> getString(R.string.settings_legal)
            Screen.CONTACT -> getString(R.string.settings_contact)
        }
        when (screen) {
            Screen.HUB -> renderHub(content)
            Screen.HOST -> renderHost(content)
            Screen.HOST_INFO -> renderHostInfo(content)
            Screen.HOST_NETWORKS -> renderApprovedNetworks(content)
            Screen.CLOUDFLARE -> renderCloudflare(content)
            Screen.SUPPORT -> renderSupport(content)
            Screen.LEGAL -> renderLegal(content)
            Screen.CONTACT -> renderContact(content)
        }
        invalidateOptionsMenu()
    }

    private fun renderHub(content: LinearLayout) {
        content.addView(tv("Settings", 26f, INK, bold = true))
        content.addView(tv("Hosting, support, legal, contact, and help — each in its own place.", 15f, MUTED)
            .margins(top = 8, bottom = 20))
        content.addView(hubCard(
            getString(R.string.settings_host),
            "Start hosting, Hosting setup, and approved networks. Add a server from the rail + in the app.",
        ) { showScreen(Screen.HOST) }.margins(bottom = 10))
        content.addView(hubCard(
            getString(R.string.settings_support),
            "Tips and cosmetics — hosting stays free.",
        ) { showScreen(Screen.SUPPORT) }.margins(bottom = 10))
        content.addView(hubCard(
            getString(R.string.settings_legal),
            "Terms, moderation, privacy, licence, and notices.",
        ) { showScreen(Screen.LEGAL) }.margins(bottom = 10))
        content.addView(hubCard(
            getString(R.string.settings_contact),
            "Email the developers or report a bug.",
        ) { showScreen(Screen.CONTACT) }.margins(bottom = 10))
        content.addView(hubCard(
            getString(R.string.settings_help),
            "FAQs and guides on phlipapp.com.",
        ) {
            try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(HELP_FAQS_URL)))
            } catch (_: Exception) {
                toast("No browser available to open Help")
            }
        })
    }

    private fun hubCard(title: String, subtitle: String, onClick: () -> Unit): View {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(CHIP)
            setPadding(dp(14), dp(14), dp(14), dp(14))
            isClickable = true
            isFocusable = true
            setOnClickListener { onClick() }
        }
        box.addView(tv(title, 16f, INK, bold = true))
        box.addView(tv(subtitle, 13f, MUTED).margins(top = 4))
        return box
    }

    private fun renderHost(content: LinearLayout) = hostSection.renderHost(content)
    private fun renderApprovedNetworks(content: LinearLayout) = hostSection.renderApprovedNetworks(content)
    private fun renderHostInfo(content: LinearLayout) = hostSection.renderHostInfo(content)
    private fun renderCloudflare(content: LinearLayout) = cloudflareSectionUi.render(content)
    private fun renderSupport(content: LinearLayout) = aboutSection.renderSupport(content)
    private fun renderLegal(content: LinearLayout) = aboutSection.renderLegal(content)
    private fun renderContact(content: LinearLayout) = aboutSection.renderContact(content)

    /* ── tiny view helpers (delegated to ViewBuilders) ── */

    internal fun dp(v: Int) = ui.dp(v)
    internal fun toast(msg: String) = ui.toast(msg)
    internal fun tv(text: String, size: Float, color: Int, bold: Boolean = false) = ui.tv(text, size, color, bold)
    internal fun btn(text: String, bg: Int, fg: Int, onClick: () -> Unit) = ui.btn(text, bg, fg, onClick)
    internal fun <T : View> T.margins(top: Int = 0, bottom: Int = 0): T = ui.run { this@margins.margins(top, bottom) }
    internal fun spaced(view: View, left: Int): View = ui.spaced(view, left)

    companion object {
        const val EXTRA_SCREEN = "screen"
        const val EXTRA_SHOW_HSTS_GUIDE = "showHstsGuide"
        const val SCREEN_HOST = "host"
        /** Direct open to Host SETUP (rules / Cloudflare) — used by in-panel Host settings. */
        const val SCREEN_HOST_SETUP = "hostSetup"
        /** Approved networks list under Host. */
        const val SCREEN_HOST_NETWORKS = "hostNetworks"
        /** Domain + API token only — from “Configure domain & API token”. */
        const val SCREEN_CLOUDFLARE = "cloudflare"
        const val SCREEN_CLOUDFLARE_CONNECT = "cloudflareConnect"
        const val SCREEN_SUPPORT = "support"
        const val SCREEN_LEGAL = "legal"
        const val SCREEN_CONTACT = "contact"
        private const val MENU_HOST_INFO = 1001
        internal const val HELP_FAQS_URL = "https://phlipapp.com/FAQs"
        private const val STATE_SCREEN = "state_screen"
        private const val STATE_OPENED_DIRECT = "state_opened_direct"
        internal const val PREFS_NAME = HostPublicGate.PREFS_NAME
        internal const val KEY_HOST_NAME = "host_name"
        internal const val CF_DASHBOARD = "https://dash.cloudflare.com/"
        internal const val CF_API_TOKENS = "https://dash.cloudflare.com/profile/api-tokens"
        /** Account → Compute → Workers & Pages → plans. */
        internal const val CF_WORKERS_PLANS = "https://dash.cloudflare.com/?to=/:account/workers/plans"
        internal val INK get() = SettingsTheme.INK
        internal val MUTED get() = SettingsTheme.MUTED
        internal val ACCENT get() = SettingsTheme.ACCENT
        /** Live Public hosting — distinct from Accent (invite) orange. */
        internal val PUBLIC_LIVE get() = SettingsTheme.PUBLIC_LIVE
        internal val CHIP get() = SettingsTheme.CHIP
        internal val SURFACE get() = SettingsTheme.SURFACE
        internal val BORDER get() = SettingsTheme.BORDER
        internal val DANGER get() = SettingsTheme.DANGER
    }
}
