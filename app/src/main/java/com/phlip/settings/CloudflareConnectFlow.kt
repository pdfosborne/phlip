package com.phlip.settings

import android.content.ClipboardManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import app.phlip.server.publichost.cloudflare.CloudflareApi
import app.phlip.server.publichost.cloudflare.CloudflarePrefs
import app.phlip.server.publichost.cloudflare.CloudflareSetup
import com.phlip.SettingsActivity
import com.phlip.settings.SettingsTheme.ACCENT
import com.phlip.settings.SettingsTheme.CHIP
import com.phlip.settings.SettingsTheme.INK
import com.phlip.settings.SettingsTheme.MUTED

/** Activity-owned draft: API credentials never enter WebView, URLs or saved instance state. */
class CloudflareConnectFlow(private val host: SettingsActivity) {
    private companion object {
        const val CLOUDFLARE_LOGIN_URL = "https://dash.cloudflare.com/login"
    }
    private val api = CloudflareSetup()
    private val handler = Handler(Looper.getMainLooper())
    private val root = LinearLayout(host).apply { orientation = LinearLayout.VERTICAL }
    private var input: EditText? = null
    private var status: TextView? = null
    private var draft = ""
    private var verified: CloudflareSetup.Verified? = null
    private var selected: CloudflareSetup.Domain? = null
    private var revision = 0
    private var provisioning = false
    private var connectError: String? = null
    private var waitingForBrowser = false
    private var troubleOpen = false
    private var debounce: Runnable? = null

    fun mount(container: LinearLayout) {
        (root.parent as? ViewGroup)?.removeView(root)
        container.addView(root)
        if (root.childCount == 0) render()
    }

    /** Step back inside this flow. False on the token step, so the activity can leave. */
    fun handleBack(): Boolean {
        if (provisioning || connectError != null || selected != null) {
            cancelToDomains()
            return true
        }
        if (verified != null) {
            resetToken()
            return true
        }
        return false
    }

    fun onWindowFocus() {
        if (!waitingForBrowser || host.isFinishing) return
        waitingForBrowser = false
        when {
            verified == null -> {
                input?.requestFocus()
                val clipboard = host.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                if (clipboard.hasPrimaryClip()) status?.text = "Copied your API key? Tap 3. Paste API key."
            }
            selected == null -> inspect()
            connectError != null -> status?.text = "If you changed the token, choose Use a different token and paste it. Otherwise tap Try again."
        }
    }

    private fun text(value: String, size: Float = 14f, strong: Boolean = false, ink: Boolean = strong): TextView =
        host.tv(value, size, if (ink || strong) INK else MUTED, bold = strong).also {
            root.addView(host.run { it.margins(top = 8, bottom = 12) })
        }

    private fun button(label: String, primary: Boolean = false, enabled: Boolean? = null, action: () -> Unit): View =
        host.btn(label, if (primary) ACCENT else CHIP, INK, action).also {
            it.isEnabled = enabled ?: !provisioning
            root.addView(host.run { it.margins(top = 8) })
        }

    private fun openBrowser(url: String) {
        waitingForBrowser = true
        host.openUrl(url)
    }

    private fun render() {
        root.removeAllViews()
        input = null
        when {
            provisioning && selected != null -> renderConnecting()
            connectError != null && selected != null -> renderFailure()
            verified == null -> renderToken()
            else -> renderDomains()
        }
    }

    private fun renderToken() {
        text("Connect Cloudflare", 20f, true)
        button("1. Sign in to Cloudflare", true) { openBrowser(CLOUDFLARE_LOGIN_URL) }
        button("2. Create API key", true) { openBrowser(CloudflareSetup.templateUrl()) }
        val field = EditText(host).apply {
            hint = "API key"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            isSingleLine = true
            isSaveEnabled = false
            importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
            setText(draft)
        }
        input = field
        root.addView(host.run { field.margins(top = 8) })
        button("3. Paste API key", true) { pasteToken(field) }
        status = text("")
        field.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                draft = s?.toString()?.trim().orEmpty()
                revision++
                debounce?.let(handler::removeCallbacks)
                if (draft.length >= 20 && !draft.any(Char::isWhitespace)) {
                    debounce = Runnable { inspect() }.also { handler.postDelayed(it, 600) }
                }
            }
            override fun afterTextChanged(s: Editable?) {}
        })
    }

    private fun pasteToken(field: EditText) {
        val clipboard = host.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val value = clipboard.primaryClip?.getItemAt(0)?.text?.toString()?.trim().orEmpty()
        if (value.isBlank()) status?.text = "Copy the API key from Cloudflare first."
        else field.setText(value.removePrefix("Bearer ").trim())
    }

    private fun renderDomains() {
        val domains = verified!!.domains
        text("Choose your domain", 20f, true)
        if (domains.isEmpty()) {
            text("Your domain isn’t on Cloudflare yet. Add it there, or create a token that includes the domain. Cloudflare can also return an empty list when the token’s scope excludes your domains.")
            button("Add a domain in Cloudflare", true) { openBrowser(CloudflareSetup.ADD_DOMAIN_URL) }
            button("Refresh domains") { inspect() }
            return
        }
        text("Tap your domain to connect it. Sharing stays off until you enable it in Phlip.")
        domains.forEach { domain ->
            if (domain.status == "active") button(domain.name, primary = true) { selectDomain(domain) }
            else text("${domain.name} — ${domain.status.ifBlank { "not active" }}. Finish activating it in Cloudflare.")
        }
        if (domains.none { it.status == "active" }) {
            button("Finish domain setup in Cloudflare", true) { openBrowser(CloudflareSetup.ADD_DOMAIN_URL) }
            button("Refresh domains") { inspect() }
        }
    }

    private fun renderConnecting() {
        text("Connecting ${selected!!.name}…", 20f, true)
        text("This creates the tunnel and Worker in your Cloudflare account. Sharing stays off until you enable it in Phlip.")
        button("Cancel", primary = true, enabled = true) { cancelToDomains() }
    }

    private fun renderFailure() {
        text("Could not connect ${selected!!.name}", 20f, true)
        status = text(connectError!!, ink = true)
        button("Try again", true) { connect() }
        troubleDisclosure()
    }

    private fun troubleDisclosure() {
        button(if (troubleOpen) "▾ This didn’t work" else "▸ This didn’t work") {
            troubleOpen = !troubleOpen
            render()
        }
        if (!troubleOpen) return
        button("Edit token in Cloudflare") { openBrowser(CloudflareSetup.TOKENS_URL) }
        button("Use a different token") { resetToken() }
    }

    private fun selectDomain(domain: CloudflareSetup.Domain) {
        if (provisioning) return
        selected = domain
        connectError = null
        troubleOpen = false
        connect()
    }

    private fun cancelToDomains() {
        revision++
        provisioning = false
        connectError = null
        selected = null
        troubleOpen = false
        debounce?.let(handler::removeCallbacks)
        render()
    }

    private fun resetToken() {
        if (provisioning) return
        revision++
        verified = null
        selected = null
        connectError = null
        troubleOpen = false
        render()
    }

    private fun inspect() {
        if (provisioning) return
        if (draft.length < 20 || draft.any(Char::isWhitespace)) {
            status?.text = "Paste the complete API token from Cloudflare."
            return
        }
        val token = draft
        val request = ++revision
        debounce?.let(handler::removeCallbacks)
        status?.text = "Checking token and loading domains…"
        Thread({
            try {
                val result = api.inspect(token)
                host.runOnUiThread {
                    if (request != revision || host.isDestroyed) return@runOnUiThread
                    verified = result
                    val keyboard = host.getSystemService(Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager
                    input?.windowToken?.let { keyboard.hideSoftInputFromWindow(it, 0) }
                    selected = null
                    connectError = null
                    render()
                }
            } catch (t: Throwable) {
                host.runOnUiThread { if (request == revision && !host.isDestroyed) status?.text = CloudflareApi.describeFailure(t) }
            }
        }, "phlip-cf-verify").start()
    }

    private fun connect() {
        val domain = selected ?: return
        if (provisioning) return
        provisioning = true
        connectError = null
        val token = draft
        val request = ++revision
        render()
        Thread({
            var failure: String? = null
            try {
                val prefs = CloudflarePrefs(host)
                CloudflareApi.provisionNamedHosting(token, CloudflareApi.Zone(domain.id, domain.name, domain.accountId), prefs)
                val script = host.assets.open("edge/phlip-edge-worker.js").use { it.readBytes() }
                CloudflareApi.provisionEdge(token, prefs, script, "http://127.0.0.1:1", emptyList())
            } catch (t: Throwable) { failure = CloudflareApi.describeFailure(t) }
            host.runOnUiThread {
                if (request != revision || host.isDestroyed) return@runOnUiThread
                provisioning = false
                if (failure == null) {
                    host.finish()
                } else {
                    connectError = "Could not connect: $failure. Check Edit permissions for Tunnel, DNS and Workers, then tap Try again."
                    render()
                }
            }
        }, "phlip-cf-connect").start()
    }
}
