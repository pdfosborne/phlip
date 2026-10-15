package com.phlip

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.util.Base64
import android.view.LayoutInflater
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResult
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import java.util.Locale
import androidx.appcompat.widget.Toolbar
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import com.phlip.hosting.HostStatusBuilder
import com.phlip.hosting.HostingLifecycleBridge
import com.phlip.hotspot.HotspotJoinCoordinator
import com.phlip.hotspot.HotspotLocationGate
import com.phlip.join.JoinIntentCapture
import com.phlip.join.PendingJoinDialogHost
import com.phlip.join.PendingPrefillDelivery
import com.phlip.network.ClientNetworkTrust
import com.phlip.ui.SystemBarsTheme
import com.phlip.webview.PhlipWebChromeClient
import com.phlip.webview.PhlipWebViewClient
import com.phlip.webview.WebViewUpdateCoalescer
import app.phlip.server.hotspot.HotspotStartResult
import app.phlip.server.local.ApprovedNetworks
import app.phlip.server.publichost.HostPublicGate
import app.phlip.server.HostService
import app.phlip.server.normalizeSetupPreset
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/** The universal client: this WebView always loads the bundled web app from its own
 *  fixed asset origin, regardless of whether hosting is on, off, or unreachable — the
 *  personal space works with zero connectivity. If hosting happens to be running on
 *  this same device, [bridgeHostingIfRunning] hands the page's own server a live
 *  connection to it automatically. */
class MainActivity : AppCompatActivity() {

    private val statusListener: () -> Unit = {
        runOnUiThread {
            bridgeHostingIfRunning()
            pushHostStatusToWebView()
            pushHotspotSessionToWebView()
            pushPendingJoinQueueToWebView()
            showPendingJoinDialogs()
        }
    }

    private val hostConnector = HostServiceConnector(
        this,
        onConnected = { svc ->
            svc.addStatusListener(statusListener)
            bridgeHostingIfRunning()
            pushHostStatusToWebView()
            showPendingJoinDialogs()
        },
        onDisconnected = { previous ->
            previous?.removeStatusListener(statusListener)
            runOnUiThread {
                bridgeHostingIfRunning()
                pushHostStatusToWebView()
            }
        },
    )

    internal var hostService: HostService?
        get() = hostConnector.service
        set(value) {
            if (value == null) hostConnector.clearServiceHandle()
        }

    internal var bound: Boolean
        get() = hostConnector.bound
        set(_) { /* owned by hostConnector */ }

    internal val connection: ServiceConnection
        get() = hostConnector.connection

    private val hostingBridge by lazy {
        HostingLifecycleBridge(
            context = this,
            hostService = { hostService },
            isBound = { bound },
            postCoalescedWebUpdate = { key, js -> postCoalescedWebUpdate(key, js) },
            pushPendingJoinQueueToWebView = { pushPendingJoinQueueToWebView() },
        )
    }

    internal lateinit var webView: WebView
    @Volatile internal var imeInsetPx: Int = 0
    /** Serial disk/image work must never block UI or WebView JavaScript bridge execution. */
    internal val clientIo: ExecutorService = Executors.newSingleThreadExecutor()
    private lateinit var layoutClientError: View
    private lateinit var progressStarting: ProgressBar
    private lateinit var splashLogo: ImageView
    private val joinCapture = JoinIntentCapture()
    private val joinPrefill by lazy {
        PendingPrefillDelivery(
            capture = joinCapture,
            isPageReady = { webPageReady },
            webView = { if (::webView.isInitialized) webView else null },
        )
    }
    private val joinDialogs by lazy {
        PendingJoinDialogHost(
            activity = this,
            hostService = { hostService },
            webView = { if (::webView.isInitialized) webView else null },
            webPageReady = { webPageReady },
            postCoalescedWebUpdate = { key, js -> postCoalescedWebUpdate(key, js) },
        )
    }
    private var webPageReady = false
    private val webUpdates = WebViewUpdateCoalescer(
        isAlive = { !isFinishing && !isDestroyed },
        webView = { if (::webView.isInitialized) webView else null },
    )
    /** Hold the OS splash until the WebView finishes — otherwise Studio launches
     *  often flash a blank/cached plate before our in-activity logo can paint. */
    private var keepSplash = true

    private val nearbyPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) nsdDiscovery?.onNearbyPermissionGranted()
            // Denied: no special-cased UI — the joiner still has invite code + password fields.
        }

    private var nsdDiscovery: NsdDiscovery? = null

    private fun nsd(): NsdDiscovery = nsdDiscovery
        ?: error("NsdDiscovery used before onCreate")

    /** Client-side LAN path eligibility (dual-path connectivity for joined members). */
    internal val clientNetworks by lazy { ApprovedNetworks(this) }
    private val clientTrust by lazy {
        ClientNetworkTrust(
            context = this,
            networks = clientNetworks,
            isAlive = { ::webView.isInitialized && !isFinishing && !isDestroyed },
            setMemberDiscovery = { enabled ->
                if (enabled) startMemberDiscovery() else stopMemberDiscovery()
            },
            postCoalescedWebUpdate = { key, js -> postCoalescedWebUpdate(key, js) },
        )
    }

    internal val calendarPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            deliverCalendarPermission(granted)
        }

    internal var vaultStorageOnResult: ((Boolean) -> Unit)? = null
    internal val vaultStoragePermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            val cb = vaultStorageOnResult
            vaultStorageOnResult = null
            cb?.invoke(granted)
        }

    internal var driveAuthOnResult: ((ActivityResult) -> Unit)? = null
    internal val driveAuthLauncher =
        registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
            val cb = driveAuthOnResult
            driveAuthOnResult = null
            cb?.invoke(result)
        }


    internal val hotspotJoin by lazy { HotspotJoinCoordinator(this) }

    private val hotspotLocationLauncher: ActivityResultLauncher<String> =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            hotspotLocation.onPermissionResult(granted)
        }
    private val hotspotLocation = HotspotLocationGate(
        activity = this,
        requestPermission = { permission -> hotspotLocationLauncher.launch(permission) },
    )

    internal fun hasHotspotWifiPermission(): Boolean = hotspotLocation.hasHotspotWifiPermission()

    internal fun isSystemLocationEnabled(): Boolean = hotspotLocation.isSystemLocationEnabled()

    internal fun openSystemLocationSettings() = hotspotLocation.openSystemLocationSettings()

    internal fun ensureHotspotLocationPermission(onGranted: () -> Unit) =
        hotspotLocation.ensureHotspotLocationPermission(onGranted)

    /** Called by [HotspotJoinCoordinator] when the joiner lands on the expected SSID. */
    fun pushHotspotJoinReady(payload: JSONObject) {
        if (!webPageReady || !::webView.isInitialized) return
        postCoalescedWebUpdate(
            "hotspot-join-ready",
            "window.ashHotspotJoinReady && window.ashHotspotJoinReady(${payload})",
        )
    }

    /** Async result from [HotspotJoinCoordinator.reconnectToHotspot] (system Wi‑Fi sheet). */
    fun pushHotspotReconnectResult(payload: JSONObject) {
        if (!webPageReady || !::webView.isInitialized) return
        postCoalescedWebUpdate(
            "hotspot-reconnect",
            "window.ashHotspotReconnectResult && window.ashHotspotReconnectResult(${payload})",
        )
    }

    internal fun pushHotspotSessionToWebView() {
        if (!webPageReady || !::webView.isInitialized) return
        try {
            val svc = hostService
            val info = if (svc != null && svc.isRunning()) svc.hotspotSessionInfo() else null
            val json = if (info == null) {
                JSONObject().put("active", false)
            } else {
                JSONObject()
                    .put("active", true)
                    .put("serverId", info.serverId)
                    .put("serverName", info.serverName)
                    .put("ssid", info.ssid)
                    .put("password", info.password)
                    .put("qrUri", info.qrUri)
                    .put("gatewayIp", info.gatewayIp)
                    .put("lanUrl", info.lanUrl)
                    .put("joinCode", info.joinCode)
                    .put("startedAt", info.startedAt)
                    .put("radioLive", info.radioLive)
                    .put("radioNote", info.radioNote)
            }
            postCoalescedWebUpdate(
                "hotspot-session",
                "window.ashHotspotSessionChanged && window.ashHotspotSessionChanged($json)",
            )
        } catch (t: Throwable) {
            android.util.Log.w("AshMain", "pushHotspotSessionToWebView failed", t)
        }
    }

    internal fun deliverCalendarPermission(granted: Boolean) {
        webView.post {
            webView.evaluateJavascript(
                "(function(){var cb=window.__ashOnCalendarPermission;window.__ashOnCalendarPermission=null;" +
                    "if(typeof cb==='function')cb(${if (granted) "true" else "false"});})();",
                null,
            )
        }
    }

    internal fun deliverTimePicked(requestId: String, hour: Int?, minute: Int?) {
        val idJson = org.json.JSONObject.quote(requestId)
        val hJson = hour?.toString() ?: "null"
        val mJson = minute?.toString() ?: "null"
        webView.post {
            webView.evaluateJavascript(
                "(function(){var cb=window.__ashOnTimePicked;" +
                    "if(typeof cb==='function')cb($idJson,$hJson,$mJson);})();",
                null,
            )
        }
    }

    internal val pickImageLauncher =
        registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
            if (uri == null) {
                deliverPickedImage(null)
                return@registerForActivityResult
            }
            clientIo.execute {
                try {
                    val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() }
                    if (bytes == null || bytes.isEmpty() || bytes.size > MAX_PICK_IMAGE_BYTES) {
                        deliverPickedImage(null)
                        return@execute
                    }
                    deliverPickedImage(Base64.encodeToString(bytes, Base64.NO_WRAP))
                } catch (_: Exception) {
                    deliverPickedImage(null)
                }
            }
        }

    /** Pending UTF-8 body for [createBackupLauncher] (Tier 1 personal export). */
    @Volatile internal var pendingBackupExportBody: String? = null

    internal val createBackupLauncher =
        registerForActivityResult(
            ActivityResultContracts.CreateDocument("application/octet-stream"),
        ) { uri ->
            val body = pendingBackupExportBody
            pendingBackupExportBody = null
            if (uri == null || body == null) {
                deliverBackupExport(false)
                return@registerForActivityResult
            }
            clientIo.execute {
                try {
                    val wrote = contentResolver.openOutputStream(uri)?.use { os ->
                        os.write(body.toByteArray(Charsets.UTF_8))
                        os.flush()
                        true
                    } ?: false
                    deliverBackupExport(wrote)
                } catch (_: Exception) {
                    deliverBackupExport(false)
                }
            }
        }

    internal val openBackupLauncher =
        registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri == null) {
                deliverBackupImport(null)
                return@registerForActivityResult
            }
            clientIo.execute {
                try {
                    val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() }
                    if (bytes == null || bytes.isEmpty() || bytes.size > MAX_BACKUP_IMPORT_BYTES) {
                        deliverBackupImport(null)
                        return@execute
                    }
                    deliverBackupImport(String(bytes, Charsets.UTF_8))
                } catch (_: Exception) {
                    deliverBackupImport(null)
                }
            }
        }

    internal fun deliverBackupExport(ok: Boolean) {
        webView.post {
            webView.evaluateJavascript(
                "(function(){var cb=window.__ashOnBackupExport;window.__ashOnBackupExport=null;" +
                    "if(typeof cb==='function')cb(${if (ok) "true" else "false"});})();",
                null,
            )
        }
    }

    internal fun deliverBackupImport(text: String?) {
        val payload = if (text == null) "null" else JSONObject.quote(text)
        webView.post {
            webView.evaluateJavascript(
                "(function(){var cb=window.__ashOnBackupImport;window.__ashOnBackupImport=null;" +
                    "if(typeof cb==='function')cb($payload);})();",
                null,
            )
        }
    }

    /** Pending sealed `.phlip` bytes for server backup CreateDocument. */
    @Volatile internal var pendingServerBackupExportBytes: ByteArray? = null
    /** Picked envelope awaiting unlock/apply. */
    @Volatile internal var pendingServerBackupEnvelope: ByteArray? = null
    /** Decrypted plaintext payload JSON after unlock. */
    @Volatile internal var pendingServerBackupPayload: String? = null

    internal val createServerBackupLauncher =
        registerForActivityResult(
            ActivityResultContracts.CreateDocument("application/octet-stream"),
        ) { uri ->
            val body = pendingServerBackupExportBytes
            pendingServerBackupExportBytes = null
            if (uri == null || body == null) {
                deliverServerBackupExport(false)
                return@registerForActivityResult
            }
            clientIo.execute {
                try {
                    val wrote = contentResolver.openOutputStream(uri)?.use { os ->
                        os.write(body)
                        os.flush()
                        true
                    } ?: false
                    deliverServerBackupExport(wrote)
                } catch (_: Exception) {
                    deliverServerBackupExport(false)
                }
            }
        }

    internal val openServerBackupLauncher =
        registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri == null) {
                pendingServerBackupEnvelope = null
                deliverServerBackupPicked(false)
                return@registerForActivityResult
            }
            clientIo.execute {
                try {
                    val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() }
                    if (bytes == null || bytes.isEmpty() || bytes.size > MAX_SERVER_BACKUP_BYTES) {
                        pendingServerBackupEnvelope = null
                        deliverServerBackupPicked(false)
                        return@execute
                    }
                    pendingServerBackupEnvelope = bytes
                    pendingServerBackupPayload = null
                    deliverServerBackupPicked(true)
                } catch (_: Exception) {
                    pendingServerBackupEnvelope = null
                    deliverServerBackupPicked(false)
                }
            }
        }

    internal fun deliverServerBackupExport(ok: Boolean) {
        webView.post {
            webView.evaluateJavascript(
                "(function(){var cb=window.__ashOnServerBackupExport;window.__ashOnServerBackupExport=null;" +
                    "if(typeof cb==='function')cb(${if (ok) "true" else "false"});})();",
                null,
            )
        }
    }

    internal fun deliverServerBackupPicked(ok: Boolean) {
        webView.post {
            webView.evaluateJavascript(
                "(function(){var cb=window.__ashOnServerBackupPicked;window.__ashOnServerBackupPicked=null;" +
                    "if(typeof cb==='function')cb(${if (ok) "true" else "false"});})();",
                null,
            )
        }
    }

    internal fun deliverPickedImage(base64: String?) {
        val payload = if (base64 == null) "null"
        else JSONObject.quote(base64)
        webView.post {
            webView.evaluateJavascript(
                "(function(){var cb=window.__ashOnPickedImage;window.__ashOnPickedImage=null;" +
                    "if(typeof cb==='function')cb($payload);})();",
                null,
            )
        }
    }

    private fun postCoalescedWebUpdate(key: String, javascript: String) {
        webUpdates.post(key, javascript)
    }

    // Built in onCreate, not as a field initializer: the Activity's base Context isn't
    // attached yet at construction time, and AssetsPathHandler needs it (for .assets).
    private lateinit var assetLoader: WebViewAssetLoader

    override fun onCreate(savedInstanceState: Bundle?) {
        val splashScreen = installSplashScreen()
        splashScreen.setKeepOnScreenCondition { keepSplash }
        super.onCreate(savedInstanceState)
        nsdDiscovery = NsdDiscovery(
            this,
            object : NsdDiscovery.Callbacks {
                override fun runOnUiThread(block: () -> Unit) {
                    this@MainActivity.runOnUiThread(block)
                }
                override fun executeIo(block: () -> Unit) {
                    clientIo.execute(block)
                }
                override fun hasNearbyPermission(): Boolean = this@MainActivity.hasNearbyPermission()
                override fun requestNearbyPermission() {
                    nearbyPermissionLauncher.launch(Manifest.permission.NEARBY_WIFI_DEVICES)
                }
                override fun clientTrustLabel(): String = this@MainActivity.clientTrustLabel()
                override fun probeNearbyOnDirectWifi(): List<JSONObject> =
                    try {
                        hotspotJoin.probeNearbyOnDirectWifi()
                    } catch (_: Exception) {
                        emptyList()
                    }
                override fun unbindDiscoveryNetwork() {
                    try {
                        hotspotJoin.unbindDiscoveryNetwork()
                    } catch (_: Exception) {
                    }
                }
                override fun pushDiscoveredJson(arr: JSONArray) {
                    webView.evaluateJavascript(
                        "window.ashDiscoveredServers && window.ashDiscoveredServers($arr)",
                        null,
                    )
                }
            },
        )
        setContentView(R.layout.activity_main)
        // Match status/nav bars to the last web light/dark choice before the page paints.
        applySystemBarsForTheme(isDarkUiTheme())

        setSupportActionBar(findViewById<Toolbar>(R.id.toolbar))
        supportActionBar?.setDisplayShowTitleEnabled(false)

        webView = findViewById(R.id.webview)
        layoutClientError = findViewById(R.id.layoutClientError)
        progressStarting = findViewById(R.id.progressStarting)
        splashLogo = findViewById(R.id.splashLogo)
        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        // Public join: asset origin → remote host is third-party. Without this, the
        // edge gate Set-Cookie is dropped and /ash-ok stays 401 (works in Chrome).
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)
        // Without these, WebView ignores the page's <meta name="viewport"> tag and lays out
        // at a fixed desktop-ish width, so the mobile CSS/JS breakpoint (which turns the group
        // sidebar into a hidden slide-in drawer) never activates.
        webView.settings.useWideViewPort = true
        webView.settings.loadWithOverviewMode = true
        // The page is served from a secure https:// asset origin but opens plain ws://
        // sockets to LAN hosts (their own DrServer has no TLS cert to offer) — without this,
        // WebView blocks those connections as mixed content.
        webView.settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        // Bundled assets only — never allow the WebView to read device files/content URIs
        // if a navigation somehow escaped the asset origin.
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = false
        // Safe here specifically because this WebView never navigates to remote/untrusted
        // content — it only ever loads the bundled asset origin (see loadClient() +
        // shouldOverrideUrlLoading) — so there's no page other than our own that could
        // reach this interface.
        webView.addJavascriptInterface(JsBridge(this), "AshNative")
        wireImeInsetTracking()
        webView.webViewClient = PhlipWebViewClient(
            this,
            assetLoader,
            ASSET_DOMAIN,
            object : PhlipWebViewClient.Callbacks {
                override fun onMainFrameFinished() {
                    keepSplash = false
                    webPageReady = true
                    bridgeHostingIfRunning()
                    deliverPendingJoinPrefill()
                    registerClientNetworkCallback()
                    pushClientNetworkTrust()
                }
                override fun onMainFrameError() {
                    keepSplash = false
                    showClientError()
                }
                override fun progressViews(): Pair<View, View> = progressStarting to splashLogo
            },
        )
        webView.webChromeClient = PhlipWebChromeClient(this)

        findViewById<Button>(R.id.btnRetryClient).setOnClickListener { loadClient() }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript(
                    "(function(){try{return !!(window.ashBack&&window.ashBack());}catch(e){return false;}})()",
                ) { result -> if (result != "true") moveTaskToBack(true) }
            }
        })

        captureJoinPrefill(intent)
        loadClient()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        captureJoinPrefill(intent)
        deliverPendingJoinPrefill()
    }

    override fun onDestroy() {
        try {
            hotspotJoin.stopWatchHotspotJoin()
            hotspotJoin.leaveDirectSession()
        } catch (_: Exception) {}
        clientIo.shutdownNow()
        webUpdates.clear()
        super.onDestroy()
    }

    /** Pull join URL / invite text / event pass / contact / sealed from VIEW, SEND, or PROCESS_TEXT. */
    private fun captureJoinPrefill(intent: Intent?) {
        joinCapture.capture(intent)
    }

    private fun deliverPendingJoinPrefill() {
        joinPrefill.deliverAll()
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        // Overflow ⋮ removed — Day hours / Host / Support / Legal / Contact / Help
        // live in the channel info panel (web).
        return false
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        return super.onOptionsItemSelected(item)
    }

    internal fun openHelpFaqs() {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(HELP_FAQS_URL)))
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, "No browser available to open Help", Toast.LENGTH_SHORT).show()
        }
    }

    internal fun openSettingsScreen(screen: String, showHstsGuide: Boolean = false) {
        startActivity(
            Intent(this, SettingsActivity::class.java)
                .putExtra(SettingsActivity.EXTRA_SCREEN, screen)
                .putExtra(SettingsActivity.EXTRA_SHOW_HSTS_GUIDE, showHstsGuide),
        )
    }

    override fun onStart() {
        super.onStart()
        hostConnector.bind()
        if (HostPublicGate.isHostingDesired(this)) {
            hostConnector.startHosting()
        }
    }

    override fun onResume() {
        super.onResume()
        bridgeHostingIfRunning()
        pushHostStatusToWebView()
    }

    override fun onStop() {
        super.onStop()
        hostConnector.unbind { it.removeStatusListener(statusListener) }
        stopDiscovery()
        stopMemberDiscovery()
    }

    /** In-app Approve/Deny dialog when someone is waiting (stays until you choose). */
    internal fun showPendingJoinDialogs() {
        joinDialogs.showPendingJoinDialogs()
    }

    /**
     * Native Approve/Deny (popup / Settings) bypasses the WebView socket, so People
     * can keep a stale "Waiting to join" row. Push the live queue from HostService.
     */
    internal fun pushPendingJoinQueueToWebView() {
        joinDialogs.pushPendingJoinQueueToWebView()
    }

    private fun loadClient() {
        webPageReady = false
        joinPrefill.resetFlight()
        layoutClientError.visibility = View.GONE
        progressStarting.visibility = View.GONE
        splashLogo.visibility = View.VISIBLE
        webView.visibility = View.VISIBLE
        webView.loadUrl("https://$ASSET_DOMAIN/assets/public/index.html")
    }

    private fun showClientError() {
        keepSplash = false
        webView.visibility = View.GONE
        progressStarting.visibility = View.GONE
        splashLogo.visibility = View.GONE
        layoutClientError.visibility = View.VISIBLE
    }

    internal fun bridgeHostingIfRunning() {
        hostingBridge.bridgeHostingIfRunning()
    }

    internal fun liveImeInsetPx(): Int {
        if (!::webView.isInitialized) return imeInsetPx
        return ViewCompat.getRootWindowInsets(webView)
            ?.getInsets(WindowInsetsCompat.Type.ime())
            ?.bottom
            ?: imeInsetPx
    }

    private fun noteImeInsetPx(px: Int) {
        val next = px.coerceAtLeast(0)
        if (next == imeInsetPx) return
        imeInsetPx = next
        if (!webPageReady || !::webView.isInitialized) return
        webView.evaluateJavascript(
            "(function(){window.__ashImeInsetPx=$next;window.dispatchEvent(new Event('ash-ime-inset'));})()",
            null,
        )
    }

    private fun wireImeInsetTracking() {
        val target = findViewById<View>(android.R.id.content) ?: webView
        ViewCompat.setOnApplyWindowInsetsListener(target) { _, insets ->
            noteImeInsetPx(insets.getInsets(WindowInsetsCompat.Type.ime()).bottom)
            insets
        }
        ViewCompat.setWindowInsetsAnimationCallback(
            target,
            object : WindowInsetsAnimationCompat.Callback(
                WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE,
            ) {
                override fun onProgress(
                    insets: WindowInsetsCompat,
                    runningAnimations: MutableList<WindowInsetsAnimationCompat>,
                ): WindowInsetsCompat {
                    noteImeInsetPx(insets.getInsets(WindowInsetsCompat.Type.ime()).bottom)
                    return insets
                }
            },
        )
    }

    /** Snapshot for the in-panel Host settings UI (right info sidebar). */
    internal fun buildHostStatusJson(): JSONObject =
        HostStatusBuilder.build(this, hostService)

    internal fun pushHostStatusToWebView() {
        if (!webPageReady || !::webView.isInitialized) return
        val json = buildHostStatusJson().toString()
        webView.evaluateJavascript(
            "window.ashSyncHostStatus && window.ashSyncHostStatus($json)",
            null,
        )
    }

    internal fun hostAckPrefs() = HostPublicGate.hostPrefs(this)

    internal fun sweepLeftoverHostDataFiles() {
        hostingBridge.sweepLeftoverHostDataFiles()
    }

    /* ── local-network discovery (browsing side; see HostService for advertising) ── */

    private fun hasNearbyPermission(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.NEARBY_WIFI_DEVICES) == PackageManager.PERMISSION_GRANTED

    internal fun startDiscovery() = nsd().startDiscovery()

    internal fun startMemberDiscovery() = nsd().startMemberDiscovery()

    internal fun stopMemberDiscovery() = nsd().stopMemberDiscovery()

    internal fun stopDiscovery() = nsd().stopDiscovery()

    internal fun resolveJoinTagBlocking(joinTag: String, timeoutMs: Int): String =
        nsd().resolveJoinTagBlocking(joinTag, timeoutMs)

    internal fun pushDiscovered() = nsd().pushDiscovered()

    internal fun identitySecrets(): app.phlip.core.security.SecureStore {
        AndroidCryptoContextEnsure()
        return app.phlip.core.security.SecureStore(
            applicationContext,
            "ash_identity_v1",
            "ash_identity_keystore_key",
        )
    }

    internal fun AndroidCryptoContextEnsure() {
        try {
            app.phlip.core.security.AndroidCryptoContext.init(applicationContext)
        } catch (_: Exception) {}
    }

    internal fun isDarkUiTheme(): Boolean = SystemBarsTheme.isDark(this)

    internal fun applySystemBarsForTheme(dark: Boolean) {
        SystemBarsTheme.applySystemBars(this, dark)
    }

    internal fun clientTrustLabel(): String = clientTrust.trustLabel()

    private fun registerClientNetworkCallback() {
        clientTrust.register()
    }

    internal fun pushClientNetworkTrust() {
        clientTrust.push()
    }

    companion object {
        internal const val ASSET_DOMAIN = "appassets.androidplatform.net"
        private const val HELP_FAQS_URL = "https://phlipapp.com/FAQs"
        internal const val PREFS_UI = SystemBarsTheme.PREFS_UI
        internal const val KEY_UI_THEME = SystemBarsTheme.KEY_UI_THEME
        // ~5 MB of decoded PNG, base64-inflated (~4/3) — a defensive cap, not a tuned limit.
        internal const val MAX_SHARE_BASE64_LEN = 7_000_000
        /** Raw bytes before client compress — generous so gallery HEIC/JPEG can be read. */
        internal const val MAX_PICK_IMAGE_BYTES = 12_000_000
        /** Personal backup import size cap (~8 MB UTF-8). */
        internal const val MAX_BACKUP_IMPORT_BYTES = 8_000_000
        /** Server full backup envelope cap (~64 MB). */
        internal const val MAX_SERVER_BACKUP_BYTES = 64_000_000
    }
}
