package app.phlip.server

import app.phlip.core.assets.ClientAssetSource
import app.phlip.server.hosting.ServerBackupService
import app.phlip.server.publichost.EdgeOriginPolicy
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.reflect.TypeToken
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoWSD
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
/* ─── server ────────────────────────────────────────────────────────────────── */

class DrServer(
    port: Int,
    private val clientAssets: ClientAssetSource,
    private val dataFile: File,
    /** Group E2E secret (host-side). Used to wrap a one-time copy into welcome after
     *  Approve — never required as a shared "server password" for joining. */
    private var serverPassphrase: String = "",
    /** Keystore seal for `data_*.json` at rest (E2E §5.3). Null = plaintext (tests). */
    private val atRest: app.phlip.core.security.SecureStore? = null,
    bindHost: String? = null,
    private val initialPreset: String = PRESET_FRIEND,
    private val initialActivity: String? = null,
) : NanoWSD(bindHost, port) {

    private val gson: Gson = GsonBuilder()
        .registerTypeAdapter(
            object : TypeToken<MutableList<PlaceEntry>>() {}.type,
            PlaceEntryListAdapter(),
        )
        .create()
    private val rng = SecureRandom()
    private val persistence = ServerPersistence(dataFile, gson, atRest)
    private var state = AppState()
    private val authorization = ServerAuthorization { state }
    private val memberCommands = MemberCommandRouter(::dispatchKnownMemberCommand)
    private val sessionRegistry = ServerSessionRegistry()
    private val activePolls = sessionRegistry.activePolls
    private val rateLimits = RateLimitPolicy(sessionRegistry.rateMap, activePolls)
    private val httpRequests = HttpRequestSupport(
        hostNameProvider = { state.hostName.ifBlank { "server" } },
    )
    private val moderationService = ModerationService(
        stateProvider = { state },
        gson = gson,
        authorization = authorization,
        idGenerator = ::genId,
        operations = ModerationService.Operations(
            save = ::saveNow,
            sendToUser = ::sendToUser,
            broadcastToModerators = ::broadcastToModerators,
        ),
    )
    private val domainSweepService = DomainSweepService(
        stateProvider = { state },
        operations = DomainSweepService.Operations(
            save = ::saveNow,
            broadcast = ::broadcast,
            broadcastToChannel = ::broadcastToChannel,
            pushSyncToAll = ::pushSyncToAll,
            eventHasEnded = ::eventHasEnded,
            typeColorResolved = ::typeColorResolved,
            clampChatRetentionDays = ::clampChatRetentionDays,
        ),
    )
    private val publicAssets = PublicAssetHandler(
        clientAssets = clientAssets,
        dataFile = dataFile,
        rejectIfBodyTooLarge = httpRequests::rejectIfBodyTooLarge,
    )
    private val httpGateway = HttpGateway(
        transport = HttpGateway.Transport(
            isWebsocketRequested = ::isWebsocketRequested,
            serveWebsocket = ::serveWebsocketUpgrade,
            rejectIfEdgeGateFails = ::rejectIfEdgeGateFails,
            jsonResponse = httpRequests::jsonResponse,
            publicJoinMeta = ::publicJoinMeta,
            handleHttpJoin = ::handleHttpJoin,
            handleHttpLogin = ::handleHttpLogin,
            handleHttpJoinWait = ::handleHttpJoinWait,
            handleAuthSalt = ::handleAuthSalt,
            handleHttpPoll = ::handleHttpPoll,
            handleHttpLeave = ::handleHttpLeave,
            handleHttpRpc = ::handleHttpRpc,
            handleShare = { _, _ -> null },
            handlePersonalInvite = ::handlePersonalInviteHttp,
            serveCachedCard = publicAssets::serveCachedEventCard,
            rejectIfBodyTooLarge = httpRequests::rejectIfBodyTooLarge,
            servePublicAsset = publicAssets::servePublicAsset,
        ),
    )
    private val webSocketGateway = WebSocketGateway(
        transport = WebSocketGateway.Transport(
            resolveToken = { ws -> clients[ws] },
            resolveUser = { token -> state.users[token] },
            sendRaw = { ws, raw -> try { ws.send(raw) } catch (_: Exception) {} },
            handleJoin = { ws, ip, message -> handleWebSocketJoin(ws as DrWebSocket, ip, message) },
            handleAuthed = ::handleAuthedMessage,
            onDisconnect = ::disconnectWebSocket,
        ),
    )
    private val migrations = ServerStateMigrations(::genId)
    private val runtime = ServerRuntime(persistence, migrations, rng, { state }, { state = it })
    private val scheduler = ServerScheduler(
        port = port,
        onPresenceTick = ::onPresenceTick,
        shouldUseIdlePresenceTick = { httpClients.isEmpty() },
        onInviteRotationTick = { regenerateInvite() },
        currentInviteExpiry = { state.inviteExpiry },
    )
    private val inviteCoordinator: InviteCoordinator = InviteCoordinator(
        stateProvider = { state },
        sessionRegistry = sessionRegistry,
        authorization = authorization,
        operations = InviteCoordinator.Operations(
            save = ::saveNow,
            newInviteCode = ::newInviteCode,
            newMemberToken = ::newMemberToken,
            disconnectUser = ::disconnectUser,
            broadcast = ::broadcast,
            serverSettingsPayload = ::serverSettingsPayload,
            sendToUser = ::sendToUser,
            enqueueHttp = ::enqueueHttp,
            scheduleInviteRotation = scheduler::scheduleInviteRotation,
            onInviteChanged = { code, expiry ->
                try {
                    onInviteChanged?.invoke(code, expiry)
                } catch (t: Throwable) {
                    android.util.Log.w("AshInvite", "onInviteChanged failed", t)
                }
            },
        ),
    )
    private val serverSettingsService: ServerSettingsService = ServerSettingsService(
        stateProvider = { state },
        authorization = authorization,
        operations = ServerSettingsService.Operations(
            save = ::saveNow,
            broadcast = ::broadcast,
            serverSettingsPayload = ::serverSettingsPayload,
            setForceJoinCode = ::setForceJoinCode,
            pushSyncToAll = ::pushSyncToAll,
            sweepEndedEventPurge = ::sweepEndedEventPurge,
            sweepChatRetention = ::sweepChatRetention,
            clearAllLivePics = ::clearAllLivePics,
            clearAllProfilePics = ::clearAllProfilePics,
            presence = ::presence,
        ),
    )
    private val presenceCoordinator by lazy {
        PresenceCoordinator(
            sessionRegistry = sessionRegistry,
            scheduler = scheduler,
            gson = gson,
            userIdForToken = { token -> state.users[token]?.id },
            membersPayload = { includeLivePics -> membersPayload(includeLivePics) },
            broadcast = ::broadcast,
            onActivityChanged = { onActivityChanged?.invoke() },
        )
    }
    private val httpSessions by lazy {
        HttpSessionCoordinator(
            sessionRegistry = sessionRegistry,
            onHttpSessionOpened = { token ->
                state.users[token]?.let { u ->
                    try {
                        // Enqueue via registry directly to avoid lazy recursion with enqueueHttp().
                        sessionRegistry.httpClients[token]?.messages?.enqueue(
                            snapshot(u).put("type", "sync").toString(),
                        )
                    } catch (t: Throwable) {
                        android.util.Log.w("AshHttp", "resync on poll start failed", t)
                    }
                }
            },
            onHttpSessionsChanged = {
                presence()
                adjustPresenceTicker()
                fireActivityChanged()
            },
            closeWebSocketsForToken = { token ->
                for ((ws, tok) in clients.entries.toList()) {
                    if (tok != token) continue
                    unbindClient(ws)
                    try {
                        ws.close(NanoWSD.WebSocketFrame.CloseCode.NormalClosure, "rejoined", false)
                    } catch (_: Exception) {}
                }
            },
        )
    }

    // Concise aliases keep the transport code readable while the registry remains
    // the sole owner and initializer of all connection/session collections.
    private val clients = sessionRegistry.clients
    private val httpClients = sessionRegistry.httpClients
    private val livePics = sessionRegistry.livePics
    private val pending = sessionRegistry.pending
    private val preApproved = sessionRegistry.preApproved
    private val readyWelcome = sessionRegistry.readyWelcome
    private val readyWelcomeAt = sessionRegistry.readyWelcomeAt
    private val deniedIds = sessionRegistry.deniedIds
    private val rateMap = sessionRegistry.rateMap
    private val deliveryHub by lazy {
        DeliveryHub(
            wsBindings = clients,
            httpBindings = httpClients,
            userByToken = { token -> state.users[token] },
            enqueueHttp = ::enqueueHttp,
        )
    }

    private val availabilityCommands = AvailabilityCommandService(
        stateProvider = { state },
        gson = gson,
        authorization = authorization,
        idGenerator = ::genId,
        operations = AvailabilityCommandService.Operations(
            save = ::save,
            broadcastToChannel = ::broadcastToChannel,
        ),
    )

    private val timeBlockCommands = TimeBlockCommandService(
        stateProvider = { state },
        gson = gson,
        authorization = authorization,
        idGenerator = ::genId,
        operations = TimeBlockCommandService.Operations(
            save = ::save,
            broadcastToChannel = ::broadcastToChannel,
        ),
    )

    private val eventCommands = EventCommandService(
        stateProvider = { state },
        gson = gson,
        authorization = authorization,
        idGenerator = ::genId,
        operations = EventCommandService.Operations(
            save = ::save,
            broadcastToChannel = ::broadcastToChannel,
            pushSyncToAll = ::pushSyncToAll,
            pushNotification = ::pushNotification,
            sendToUser = ::sendToUser,
            purgeEventFromHost = ::purgeEventFromHost,
            onEventCreated = { ev, ch -> demoUserService.scheduleReactionsForNewEvent(ev, ch) },
            clearOverlappingAvailabilities = { ev -> availabilityCommands.clearOverlappingForEvent(ev) },
        ),
    )

    private val collaborationCommands: CollaborationCommandService = CollaborationCommandService(
        stateProvider = { state },
        gson = gson,
        livePics = livePics,
        authorization = authorization,
        idGenerator = ::genId,
        uniqueTypeId = migrations::uniqueTypeId,
        operations = CollaborationCommandService.Operations(
            save = ::save,
            broadcast = ::broadcast,
            broadcastToChannel = ::broadcastToChannel,
            pushSyncToAll = ::pushSyncToAll,
            broadcastLivePic = ::broadcastLivePic,
            presence = ::presence,
            sendToUser = ::sendToUser,
            removeEventChatNote = eventCommands::removeEventChatNote,
            pushNotification = ::pushNotification,
            purgeEventFromHost = ::purgeEventFromHost,
            sanitizeIconText = ::sanitizeIconText,
        ),
    )

    private val membershipService: MembershipService = MembershipService(
        stateProvider = { state },
        gson = gson,
        authorization = authorization,
        idGenerator = ::genId,
        memberTokenGenerator = ::newMemberToken,
        groupInviteCodeGenerator = ::newGroupInviteCode,
        personalInviteSlugGenerator = ::newPersonalInviteSlug,
        random = rng,
        serverPassphrase = { serverPassphrase },
        defaultRoleForNewMembers = ::defaultRoleForNewMembers,
        livePics = livePics,
        operations = MembershipService.Operations(
            save = ::saveNow,
            sendToUser = ::sendToUser,
            sendToToken = ::sendToToken,
            broadcast = ::broadcast,
            presence = ::presence,
            broadcastMembers = ::broadcastMembers,
            pushSyncToAll = ::pushSyncToAll,
            purgeMemberContent = ::purgeMemberContent,
            disconnectUser = ::disconnectUser,
            approveJoin = ::approve,
            denyJoin = ::deny,
            snapshot = ::snapshot,
            releaseHttpSession = ::releaseHttpSession,
            edgeMemberSession = { token, userId, oldToken ->
                onEdgeMemberSession?.invoke(token, userId, oldToken)
            },
            onPersonalInvitesChanged = {
                try {
                    onPersonalInvitesChanged?.invoke()
                } catch (t: Throwable) {
                    android.util.Log.w("AshInvite", "onPersonalInvitesChanged failed", t)
                }
            },
            shareLanUrl = { shareLanUrl },
            sharePublicUrl = { sharePublicUrl },
            hostIsPublic = { hostIsPublic },
            postMemberJoined = ::postWelcomeMemberJoined,
        ),
    )

    private val snapshotBuilder: SnapshotBuilder = SnapshotBuilder(
        stateProvider = { state },
        gson = gson,
        authorization = authorization,
        sessionRegistry = sessionRegistry,
        membershipService = this.membershipService,
        moderationService = moderationService,
        operations = SnapshotBuilder.Operations(
            onlineUserIds = ::onlineUserIds,
            pruneLivePics = ::pruneLivePics,
            livePicFor = { id: String -> livePics[id] },
            save = ::saveNow,
            currentInvite = ::currentInvite,
            shareLanUrl = { shareLanUrl },
            sharePublicUrl = { sharePublicUrl },
            hostIsPublic = { hostIsPublic },
            hotspotSsid = { hotspotSsid },
            hotspotPassword = { hotspotPassword },
            reachMode = { hostReachMode },
            registryJoinTag = { registryJoinTag },
            serverSettingsPayload = ::serverSettingsPayload,
        ),
    )

    private val setupPresetService: SetupPresetService = SetupPresetService(
        stateProvider = { state },
        gson = gson,
        authorization = authorization,
        operations = SetupPresetService.Operations(
            save = ::saveNow,
            genId = ::genId,
            broadcast = ::broadcast,
            pushSyncToAll = ::pushSyncToAll,
            purgeEventFromHost = ::purgeEventFromHost,
            serverSettingsPayload = ::serverSettingsPayload,
            defaultRoleForNewMembers = ::defaultRoleForNewMembers,
            effectiveCreateEvents = ::effectiveCreateEvents,
            sendToUser = ::sendToUser,
            canManageServer = ::canManageServer,
        ),
    )

    private val joinOrchestrator: JoinOrchestrator = JoinOrchestrator(
        stateProvider = { state },
        sessionRegistry = sessionRegistry,
        membershipService = this.membershipService,
        rateLimits = rateLimits,
        rng = rng,
        operations = JoinOrchestrator.Operations(
            save = ::saveNow,
            genId = ::genId,
            newMemberToken = ::newMemberToken,
            snapshot = { user: User -> snapshot(user) },
            reclaimMemberSession = ::reclaimMemberSession,
            releaseHttpSession = ::releaseHttpSession,
            bindClient = { ws: JoinWebSocket, token: String -> bindClient(ws as NanoWSD.WebSocket, token) },
            presence = ::presence,
            notifyPending = ::notifyPending,
            onEdgeMemberSession = { token: String, userId: String, oldToken: String? ->
                try { onEdgeMemberSession?.invoke(token, userId, oldToken) } catch (_: Exception) {}
            },
            connectedClientCount = ::connectedClientCount,
            pruneStalePending = ::pruneStalePending,
            pruneReadyWelcome = ::pruneReadyWelcome,
        ),
    )

    private val httpJoinHandler = HttpJoinHandler(
        transport = HttpJoinHandler.Transport(
            jsonResponse = httpRequests::jsonResponse,
            rejectIfBodyTooLarge = httpRequests::rejectIfBodyTooLarge,
            readJsonBody = httpRequests::readJsonBody,
            clientIp = ::clientIp,
            isPrivateClientIp = ::isPrivateClientIp,
            isDirectLanRequest = ::isDirectLanRequest,
        ),
        operations = HttpJoinHandler.Operations(
            authSalt = { name, inviteRaw, identityId, ip, lan, inviteSlug ->
                joinOrchestrator.authSalt(name, inviteRaw, identityId, ip, lan, inviteSlug)
            },
            processJoin = { nameRaw, inviteRaw, fingerprint, authVerifier, ip, identityId, identityPub, inviteSlug, signInOnly ->
                processJoin(
                    nameRaw = nameRaw,
                    inviteRaw = inviteRaw,
                    fingerprint = fingerprint,
                    authVerifier = authVerifier,
                    ip = ip,
                    ws = null,
                    identityId = identityId,
                    identityPub = identityPub,
                    inviteSlug = inviteSlug,
                    signInOnly = signInOnly,
                )
            },
            pruneReadyWelcome = ::pruneReadyWelcome,
            readyWelcome = { id -> readyWelcome[id] },
            isDenied = { id -> deniedIds.containsKey(id) },
            isPending = { id -> pending.containsKey(id) },
        ),
    )
    private val personalInviteHttpHandler = PersonalInviteHttpHandler(
        transport = PersonalInviteHttpHandler.Transport(
            jsonResponse = httpRequests::jsonResponse,
            rejectIfBodyTooLarge = httpRequests::rejectIfBodyTooLarge,
            readJsonBody = httpRequests::readJsonBody,
            clientIp = ::clientIp,
            htmlResponse = { status, body ->
                NanoHTTPD.newFixedLengthResponse(status, "text/html; charset=UTF-8", body).also {
                    it.addHeader("Cache-Control", "no-store")
                    it.addHeader("X-Content-Type-Options", "nosniff")
                }
            },
            redirectResponse = { location ->
                NanoHTTPD.newFixedLengthResponse(
                    NanoHTTPD.Response.Status.REDIRECT,
                    NanoHTTPD.MIME_PLAINTEXT,
                    "",
                ).also {
                    it.addHeader("Location", location)
                    it.addHeader("Cache-Control", "no-store")
                }
            },
        ),
        operations = PersonalInviteHttpHandler.Operations(
            hostDisplayName = { state.hostName.ifBlank { "Phlip server" }.take(40) },
            findUserByInviteSlug = membershipService::findUserByInviteSlug,
            processJoin = { nameRaw, inviteRaw, fingerprint, authVerifier, ip, identityId, identityPub, inviteSlug ->
                processJoin(
                    nameRaw = nameRaw,
                    inviteRaw = inviteRaw,
                    fingerprint = fingerprint,
                    authVerifier = authVerifier,
                    ip = ip,
                    ws = null,
                    identityId = identityId,
                    identityPub = identityPub,
                    inviteSlug = inviteSlug,
                )
            },
        ),
    )
    private val httpPollHandler = HttpPollHandler(
        transport = HttpPollHandler.Transport(
            jsonResponse = httpRequests::jsonResponse,
            requestToken = httpRequests::requestToken,
            noteReject = httpRequests::noteReject,
        ),
        operations = HttpPollHandler.Operations(
            pruneHttpClients = ::pruneHttpClients,
            isMemberToken = { token -> state.users.containsKey(token) },
            releaseHttpSession = ::releaseHttpSession,
            tryBeginPoll = ::tryBeginPoll,
            endPoll = ::endPoll,
            touchHttpClient = ::touchHttpClient,
            drainHttp = { client -> drainHttp(client) },
        ),
    )
    private val httpRpcHandler = HttpRpcHandler(
        transport = HttpRpcHandler.Transport(
            jsonResponse = httpRequests::jsonResponse,
            rejectIfBodyTooLarge = httpRequests::rejectIfBodyTooLarge,
            readJsonBody = httpRequests::readJsonBody,
            requestToken = httpRequests::requestToken,
        ),
        operations = HttpRpcHandler.Operations(
            pruneHttpClients = ::pruneHttpClients,
            isMemberToken = { token -> state.users.containsKey(token) },
            userForToken = { token -> state.users[token] },
            releaseHttpSession = ::releaseHttpSession,
            touchHttpClient = ::touchHttpClient,
            touchHttpClientWithoutInitialSync = ::touchHttpClientWithoutInitialSync,
            handleAuthedMessage = ::handleAuthedMessage,
            drainHttp = { client, max -> drainHttp(client, max) },
        ),
    )
    private val httpLeaveHandler = HttpLeaveHandler(
        transport = HttpLeaveHandler.Transport(
            jsonResponse = httpRequests::jsonResponse,
            requestToken = httpRequests::requestToken,
            readJsonBody = httpRequests::readJsonBody,
        ),
        operations = HttpLeaveHandler.Operations(
            releaseHttpSession = ::releaseHttpSession,
        ),
    )

    private val demoUserService = DemoUserService(
        stateProvider = { state },
        authorization = authorization,
        idGenerator = ::genId,
        memberTokenGenerator = ::newMemberToken,
        defaultRoleForNewMembers = ::defaultRoleForNewMembers,
        random = rng,
        operations = DemoUserService.Operations(
            save = ::saveNow,
            broadcast = ::broadcast,
            broadcastMembers = ::broadcastMembers,
            pushSyncToAll = ::pushSyncToAll,
            purgeMemberContent = ::purgeMemberContent,
            autoIncludeNewMember = membershipService::autoIncludeNewMember,
            scheduleDelay = { delay, action -> scheduler.schedule(delay, action) },
            dispatchSimulated = ::dispatchKnownMemberCommand,
            sendToUser = ::sendToUser,
        ),
    )

    fun setServerPassphrase(pass: String) {
        serverPassphrase = pass
    }

    /** Called whenever the pending queue changes; register from HostService. */
    var onPendingChanged: ((List<PendingInfo>) -> Unit)? = null
    var onActivityChanged: (() -> Unit)? = null
    var onInviteChanged: ((String, Long) -> Unit)? = null
    /** Personal invite slug mint/rotate — sync Worker allowlist. */
    var onPersonalInvitesChanged: (() -> Unit)? = null
    /** Approved / password-login bearer for Worker member tier. */
    var onEdgeMemberSession: ((token: String, userId: String, oldToken: String?) -> Unit)? = null
    /** Debounced Worker relay cache push after state saves (Public + opt-in). */
    var onRelayCacheMutated: (() -> Unit)? = null

    /**
     * When non-blank and [edgeEnforce] is true, Cloudflare-looking requests must
     * present matching `X-Phlip-Edge`. LAN / loopback is never gated. Off until a
     * Worker is deployed (see feature-planning edge-gate Worker).
     */
    @Volatile private var edgeSecret: String = ""
    @Volatile private var edgeEnforce: Boolean = false
    @Volatile private var publicApex: String = ""

    fun setEdgeGate(secret: String, enforce: Boolean, apexDomain: String) {
        edgeSecret = secret.trim()
        edgeEnforce = enforce && edgeSecret.isNotEmpty()
        publicApex = apexDomain.trim().lowercase()
    }

    /**
     * Host-advertised bases for Share link (managers only). Updated by HostService
     * so admins on other devices share the phone's LAN/Public URL — not their own IP.
     */
    @Volatile private var shareLanUrl: String = ""
    @Volatile private var sharePublicUrl: String = ""
    @Volatile private var hostIsPublic: Boolean = false
    /** Near-field reach: local | direct — clients avoid Local LAN dual-path when direct. */
    @Volatile private var hostReachMode: String = ServerRegistry.REACH_LOCAL
    /** Live Direct Soft-AP creds — included on welcome so members can Rejoin/Leave. */
    @Volatile private var hotspotSsid: String = ""
    @Volatile private var hotspotPassword: String = ""
    /** Stable 4-char id from [ServerRegistry] — exposed on /ash-ok for client path selection. */
    @Volatile private var registryJoinTag: String = ""

    fun setJoinTag(tag: String) {
        registryJoinTag = tag.trim().uppercase().take(4)
    }

    fun setShareReach(lanUrl: String, publicUrl: String?, isPublic: Boolean, reachMode: String = ServerRegistry.REACH_LOCAL) {
        val lan = lanUrl.trim().trimEnd('/')
        val pub = publicUrl?.trim()?.trimEnd('/').orEmpty()
        val mode = ServerRegistry.normalizeReachMode(reachMode)
        if (lan == shareLanUrl && pub == sharePublicUrl && isPublic == hostIsPublic && mode == hostReachMode) return
        shareLanUrl = lan
        sharePublicUrl = pub
        hostIsPublic = isPublic
        hostReachMode = mode
        broadcastShareReach()
    }

    fun setHotspotCreds(ssid: String, password: String) {
        val nextSsid = ssid.trim()
        val nextPass = password.trim()
        if (nextSsid == hotspotSsid && nextPass == hotspotPassword) return
        hotspotSsid = nextSsid
        hotspotPassword = nextPass
        broadcastHotspotSession()
    }

    private fun hotspotSessionPayload(): JSONObject = JSONObject()
        .put("type", "hotspotSession")
        .put("active", hotspotSsid.isNotEmpty())
        .put("hotspotSsid", hotspotSsid.ifEmpty { JSONObject.NULL })
        .put("hotspotPassword", hotspotPassword.ifEmpty { JSONObject.NULL })

    private fun broadcastHotspotSession() {
        val raw = hotspotSessionPayload().toString()
        for ((ws, token) in clients) {
            if (state.users[token] == null) continue
            try { ws.send(raw) } catch (_: Exception) {}
        }
        for ((token, _) in httpClients) {
            if (state.users[token] == null) continue
            enqueueHttp(token, raw)
        }
    }

    private fun shareReachPayload(): JSONObject = JSONObject()
        .put("type", "shareReach")
        .put("shareLan", shareLanUrl.ifEmpty { JSONObject.NULL })
        .put("sharePublic", sharePublicUrl.ifEmpty { JSONObject.NULL })
        .put("isPublic", hostIsPublic)
        .put("reachMode", hostReachMode)
        .put("hotspotSsid", hotspotSsid.ifEmpty { JSONObject.NULL })
        .put("hotspotPassword", hotspotPassword.ifEmpty { JSONObject.NULL })
        .put("hotspotActive", hotspotSsid.isNotEmpty())

    private fun broadcastShareReach() {
        val raw = shareReachPayload().toString()
        // Managers get share bases; every member needs Direct Wi‑Fi creds when active.
        for ((ws, token) in clients) {
            val u = state.users[token] ?: continue
            val payload = if (canManageServer(u)) raw else hotspotSessionPayload().toString()
            try { ws.send(payload) } catch (_: Exception) {}
        }
        for ((token, _) in httpClients) {
            val u = state.users[token] ?: continue
            val payload = if (canManageServer(u)) raw else hotspotSessionPayload().toString()
            enqueueHttp(token, payload)
        }
    }

    init { load(); startPresenceTicker(); inviteCoordinator.scheduleInviteRotation() }

    fun connectedClientCount(): Int = clients.size + httpClients.size

    fun hasShareActivity(): Boolean = false

    /**
     * True while a timed event is in progress.
     * Used to defer flexible-update prompts that would restart the host.
     */
    fun hasLiveEventOrBroadcast(): Boolean {
        val now = System.currentTimeMillis()
        val leadMs = 15L * 60 * 1000
        for (ev in state.events) {
            val start = ev.`when` ?: continue
            if (now < start - leadMs) continue
            if (now <= start + eventDurationMs(ev.duration) + SHARE_EVENT_GRACE_MS) return true
        }
        return false
    }

    private fun fireActivityChanged() = presenceCoordinator.fireActivityChanged()

    private fun bindClient(ws: NanoWSD.WebSocket, token: String) =
        presenceCoordinator.bindClient(ws, token)

    private fun unbindClient(ws: NanoWSD.WebSocket) = presenceCoordinator.unbindClient(ws)

    private fun startPresenceTicker() = presenceCoordinator.startPresenceTicker()

    /** 8s while HTTP/share sessions exist; 60s when idle. */
    private fun adjustPresenceTicker() = presenceCoordinator.adjustPresenceTicker()

    /** True while HTTP/WS accept is paused for network-gate suspend (state kept). */
    @Volatile private var listeningPaused = false
    @Volatile private var stopIsPauseOnly = false

    /** Unbind the listener without tearing down invite/presence/schedulers or disk state. */
    fun pauseListening() {
        if (listeningPaused) return
        closeAllClients()
        listeningPaused = true
        stopIsPauseOnly = true
        try {
            stop()
        } finally {
            stopIsPauseOnly = false
        }
    }

    /** Re-bind after [pauseListening]. No-op if already accepting. */
    fun resumeListening() {
        if (!listeningPaused && isAlive) return
        listeningPaused = false
        try {
            if (!isAlive) start(0)
        } catch (e: Exception) {
            android.util.Log.w("AshServer", "resumeListening failed", e)
        }
    }

    fun isListeningPaused(): Boolean = listeningPaused

    override fun stop() {
        if (!stopIsPauseOnly) {
            flushScheduledSave()
            listeningPaused = false
            scheduler.stop()
        }
        super.stop()
    }

    /* ── persistence ── */

    /** Short id for members / messages / ordinary objects (48-bit). */
    private fun genId(): String = runtime.genId()

    /** Unguessable public share / claim / guest-session ids (128-bit). */
    private fun genShareId(): String = runtime.genShareId()

    /** Fresh member bearer (same entropy as share ids). Not the user id. */
    private fun newMemberToken(): String = runtime.newMemberToken()

    private fun newInviteCode(): String = runtime.newInviteCode()

    private fun newPersonalInviteSlug(): String = runtime.newPersonalInviteSlug()

    /** Longer token for §10 group invites — distinguishable from the 6-char rotate. */
    private fun newGroupInviteCode(): String = runtime.newGroupInviteCode()

    private fun load() {
        runtime.load(
            defaultState = { AppState() },
            ensureSaltBlindKey = joinOrchestrator::ensureSaltBlindKey,
            newInviteCode = ::newInviteCode,
            newSalt = ::newSalt,
            bootstrapState = { s ->
                s.channels = mutableListOf()
                s.eventTypes = eventTypesForPreset(initialPreset, initialActivity)
                s.locations = locationsForPreset(initialPreset, initialActivity)
                s.setupPreset = normalizeSetupPreset(initialPreset)
                s.offerAutoInclude = true
                s.allowFreeform = true
                setupPresetService.seedPresetChannels(initialPreset, initialActivity)
            },
            onSealedUnreadable = {
                android.util.Log.e(
                    "AshDrServer",
                    "Cannot decrypt ${dataFile.name} — Keystore open failed; leaving file untouched",
                )
            },
            onLoaded = {
                if (membershipService.ensureAllInviteSlugs()) save()
            },
        )
    }

    /**
     * Formerly folded chat → event groups (030). Kept as a no-op — standalone
     * chat channels are retained for general conversation + agenda mirroring.
     */
    @Suppress("unused")
    private fun migrateChatChannelsToEventGroups(): Boolean = false

    private fun newSalt(): String = runtime.newSalt()

    private val saveGate = Any()
    @Volatile private var savePending = false

    /** Coalesce chatty writes. Critical membership and settings use [saveNow]. */
    private fun save() {
        // Unit tests pass a null at-rest store and read data.json immediately.
        if (atRest == null) {
            writeState()
            return
        }
        synchronized(saveGate) {
            if (savePending) return
            savePending = true
        }
        try {
            scheduler.schedule(250L) { flushScheduledSave() }
        } catch (_: Exception) {
            flushScheduledSave()
        }
    }

    /** Membership, invites, and settings write before the method returns. */
    private fun saveNow() {
        synchronized(saveGate) { savePending = false }
        writeState()
    }

    private fun flushScheduledSave() {
        synchronized(saveGate) {
            if (!savePending) return
            savePending = false
        }
        writeState()
    }

    private fun writeState() {
        if (!runtime.save()) {
            // Fail closed: never rewrite sealed storage as plaintext when sealing fails.
            android.util.Log.e("AshDrServer", "save failed for ${runtime.displayName()}; skipping write")
            return
        }
        try {
            onRelayCacheMutated?.invoke()
        } catch (t: Throwable) {
            android.util.Log.w("AshDrServer", "relay cache notify failed", t)
        }
    }

    /**
     * Seal a welcome-shaped relay snapshot under the group key (`e2e:`).
     * Returns null when passphrase / salt / snapshot is unavailable.
     */
    fun sealedRelaySnapshot(): String? {
        val pass = serverPassphrase
        val salt = state.e2eSalt
        if (pass.isEmpty() || salt.isBlank()) return null
        return try {
            val plain = snapshotBuilder.relaySnapshot().toString()
            app.phlip.server.publichost.RelaySnapshotSealer.seal(pass, salt, plain)
        } catch (t: Throwable) {
            android.util.Log.w("AshDrServer", "relay seal failed", t)
            null
        }
    }

    /** Flush in-memory state, then return a deep JSON clone of [AppState]. */
    fun snapshotAppStateJson(): String {
        save()
        return gson.toJson(state)
    }

    /** Replace live state from a full AppState JSON blob and persist. */
    fun replaceAppStateJson(json: String): Boolean {
        return try {
            val next = gson.fromJson(json, AppState::class.java) ?: return false
            state = next
            save()
            true
        } catch (_: Exception) {
            false
        }
    }

    /** Apply structure-only fields (deck/channels/roles/settings); members & events kept. */
    fun applyStructureJson(structureJson: String): Boolean {
        return try {
            val src = gson.fromJson(structureJson, AppState::class.java) ?: return false
            ServerBackupService.copyStructureInto(state, src, gson)
            save()
            true
        } catch (_: Exception) {
            false
        }
    }

    /* ── http serving (static assets + public join API) ── */

    private fun serveWebsocketUpgrade(session: IHTTPSession): Response = super.serve(session)

    override fun serve(session: IHTTPSession): Response {
        return httpGateway.serve(session)
    }

    private fun jsonResponse(status: Response.Status, body: JSONObject): Response =
        httpRequests.jsonResponse(status, body)

    private fun readJsonBody(session: IHTTPSession): JSONObject? = httpRequests.readJsonBody(session)

    private fun rejectIfBodyTooLarge(session: IHTTPSession): Response? =
        httpRequests.rejectIfBodyTooLarge(session)

    private fun requestPass(session: IHTTPSession): String = httpRequests.requestPass(session)

    private fun requestToken(session: IHTTPSession): String = httpRequests.requestToken(session)

    private fun noteReject(path: String, reason: String, detail: String = "") =
        httpRequests.noteReject(path, reason, detail)

    private fun handleAuthSalt(session: IHTTPSession): Response =
        httpJoinHandler.handleAuthSalt(session)

    private fun handleHttpJoin(session: IHTTPSession): Response =
        httpJoinHandler.handleJoin(session)

    private fun handleHttpLogin(session: IHTTPSession): Response =
        httpJoinHandler.handleJoin(session, signInOnly = true)

    private fun handlePersonalInviteHttp(session: IHTTPSession, path: String): Response? =
        personalInviteHttpHandler.handle(session, path)

    private fun processJoin(
        nameRaw: String,
        inviteRaw: String,
        fingerprint: String,
        authVerifier: String,
        ip: String,
        ws: DrWebSocket?,
        identityId: String = "",
        identityPub: String = "",
        inviteSlug: String = "",
        signInOnly: Boolean = false,
    ): JSONObject = joinOrchestrator.processJoin(
        nameRaw = nameRaw,
        inviteRaw = inviteRaw,
        fingerprint = fingerprint,
        authVerifier = authVerifier,
        ip = ip,
        joinWs = ws,
        identityId = identityId,
        identityPub = identityPub,
        inviteSlug = inviteSlug,
        signInOnly = signInOnly,
    )

    private fun handleHttpJoinWait(session: IHTTPSession): Response =
        httpJoinHandler.handleJoinWait(session)

    /**
     * When edge enforce is on, traffic that looks Cloudflare-proxied (or Host
     * matches the public apex) must carry `X-Phlip-Edge`. Loopback / plain LAN
     * is never blocked so local hosting keeps working without a Worker.
     */
    private fun rejectIfEdgeGateFails(session: IHTTPSession): Response? =
        EdgeOriginPolicy.rejectIfEdgeGateFails(
            session = session,
            edgeEnforce = edgeEnforce,
            edgeSecret = edgeSecret,
            publicApex = publicApex,
            noteReject = ::noteReject,
            jsonResponse = ::jsonResponse,
        )

    private fun touchHttpClient(token: String): HttpClient = httpSessions.touchHttpClient(token)

    private fun touchHttpClientWithoutInitialSync(token: String): HttpClient =
        httpSessions.touchHttpClient(token, enqueueInitialSync = false)

    private fun releaseHttpSession(token: String) = httpSessions.releaseHttpSession(token)

    /** Drop any live HTTP poll / WebSocket holding this member token so they can
     *  sign in again (e.g. after VPN IP change) without "name already in use". */
    private fun reclaimMemberSession(token: String) = httpSessions.reclaimMemberSession(token)

    /** Presence tick owns retention sweeps so /ash-poll only drops idle sessions. */
    private fun onPresenceTick() {
        pruneHttpClients()
        sweepTypeSnapshots()
        sweepEndedEventPurge()
        sweepChatRetention()
    }

    private fun pruneHttpClients() {
        httpSessions.pruneIdleHttpClients()
    }

    private fun handleHttpLeave(session: IHTTPSession): Response =
        httpLeaveHandler.handle(session)

    private fun enqueueHttp(token: String, raw: String) = httpSessions.enqueueHttp(token, raw)

    private fun drainHttp(client: HttpClient, max: Int = 50): JSONArray = httpSessions.drainHttp(client, max)

    private fun handleHttpPoll(session: IHTTPSession): Response =
        httpPollHandler.handle(session)

    private fun handleHttpRpc(session: IHTTPSession): Response =
        httpRpcHandler.handle(session)

    /* ── websocket ── */

    override fun openWebSocket(handshake: IHTTPSession) = DrWebSocket(handshake)

    inner class DrWebSocket(private val handshake: IHTTPSession) : NanoWSD.WebSocket(handshake), JoinWebSocket {
        /** Prefer Cloudflare client IP when tunneled. */
        val ip: String get() = clientIp(handshake)
        override var pendingId: String? = null

        override fun closeNormal(reason: String) {
            close(WebSocketFrame.CloseCode.NormalClosure, reason, false)
        }

        override fun isSocketOpen(): Boolean = try { isOpen } catch (_: Exception) { false }

        override fun onOpen() {}

        override fun onMessage(frame: WebSocketFrame) {
            webSocketGateway.onMessage(this, ip, frame.textPayload)
        }

        override fun onClose(code: WebSocketFrame.CloseCode?, reason: String?, initiatedByRemote: Boolean) {
            webSocketGateway.onCloseOrException(this)
        }

        override fun onPong(pong: WebSocketFrame?) {}
        override fun onException(e: IOException) {
            webSocketGateway.onCloseOrException(this)
        }
    }

    private fun handleWebSocketJoin(ws: DrWebSocket, ip: String, m: JSONObject) {
        // Existing session token: host bridge needs group secret; members
        // may resume a token after HTTP sign-in / WS reconnect.
        val existingToken = m.optString("token").takeIf { it.isNotEmpty() }
        if (existingToken != null && state.users.containsKey(existingToken)) {
            val u = state.users[existingToken]!!
            if (u.isHost) {
                if (serverPassphrase.isEmpty() || !passwordsEqual(m.optString("pass"), serverPassphrase)) {
                    bumpRate(ip, isPrivateClientIp(ip))
                    ws.send(err("Host session rejected.").toString())
                    return
                }
            }
            if (connectedClientCount() >= MAX_CLIENTS) {
                ws.send(err("Host is at capacity.").toString())
                return
            }
            bindClient(ws, existingToken)
            val welcome = snapshot(u).put("token", existingToken)
            if (!u.wrappedGroupKey.isNullOrEmpty()) welcome.put("wrappedGroupKey", u.wrappedGroupKey)
            welcome.put("needsPassword", u.authVerifier.isNullOrEmpty())
            ws.send(welcome.toString())
            presence()
            return
        }
        if (existingToken != null) {
            bumpRate(ip, isPrivateClientIp(ip))
            ws.send(err("That session expired. Sign in with your name and password.").toString())
            return
        }
        val result = processJoin(
            nameRaw = m.optString("name"),
            inviteRaw = m.optString("invite"),
            fingerprint = m.optString("fingerprint"),
            authVerifier = m.optString("authVerifier"),
            ip = ip,
            ws = ws,
            identityId = m.optString("identityId"),
            identityPub = m.optString("identityPub"),
            inviteSlug = m.optString("inviteSlug").ifEmpty { m.optString("slug") },
        )
        // processJoin already sent waiting/welcome on this socket when successful.
        if (result.optString("type") == "error") ws.send(result.toString())
    }

    private fun disconnectWebSocket(ws: NanoWSD.WebSocket) {
        unbindClient(ws)
        // Keep the pending slot so the host dialog doesn't disappear on a blip;
        // reconnect will reattach. Stale entries are pruned on notify/approve.
        val pendingWs = ws as? DrWebSocket
        pendingWs?.pendingId?.let { rid ->
            pending[rid]?.let { if (it.ws === ws) it.ws = null }
            pendingWs.pendingId = null
        }
        presence()
    }

    /** Shared by WebSocket and HTTP RPC (public tunnel). Returns false when approve/block rejected. */
    private fun handleAuthedMessage(user: User, m: JSONObject): Boolean {
        return memberCommands.dispatch(user, m)
    }

    /** Implementations for commands recognized by [memberCommands]. */
    private fun dispatchKnownMemberCommand(user: User, m: JSONObject): Boolean {
        when (m.optString("type")) {
            "syncRequest" -> {
                val protocol = m.optInt("protocol", 0)
                if (protocol != SyncSliceBuilder.PROTOCOL) {
                    sendToUser(user, snapshot(user).put("type", "sync"))
                } else {
                    sendToUser(user, syncSliceBuilder.response(snapshot(user), user, m))
                }
                return true
            }
            "getMessagePage" -> {
                val channelId = m.optString("channelId")
                val visible = state.channels.any { it.id == channelId && channelVisible(it, user) }
                if (visible) {
                    val page = syncSliceBuilder.messagePage(
                        snapshot(user),
                        channelId,
                        m.optLong("beforeTs", 0L),
                        m.optString("beforeId"),
                    ).put("requestId", m.optString("requestId"))
                    sendToUser(user, page)
                }
                return true
            }
        }
        eventCommands.dispatch(user, m)?.let { return it }
        if (collaborationCommands.dispatch(user, m)) return true
        if (availabilityCommands.dispatch(user, m)) return true
        if (timeBlockCommands.dispatch(user, m)) return true
        if (membershipService.dispatch(user, m)) return true
        if (moderationService.dispatch(user, m)) return true
        if (demoUserService.dispatch(user, m)) return true
        when (m.optString("type")) {
            "updateServerSettings" -> cmdUpdateServerSettings(user, m)
            "applySetupPreset" -> cmdApplySetupPreset(user, m)
            "triggerCodeRequest" -> cmdTriggerCodeRequest(user)
        }
        return true
    }

    private val syncSliceBuilder by lazy { SyncSliceBuilder() }


    private fun serverActivityPayload(): JSONArray =
        JSONArray(gson.toJson(state.serverActivity ?: emptyList<ServerActivityEntry>()))

    private fun broadcastServerActivity() {
        broadcast(
            JSONObject()
                .put("type", "serverActivityUpdated")
                .put("serverActivity", serverActivityPayload()),
        )
    }

    private fun cmdUpdateServerSettings(user: User, m: JSONObject) =
        serverSettingsService.cmdUpdateServerSettings(user, m)

    private fun pruneGroupInvites() {
        val now = System.currentTimeMillis()
        // Drop long-expired / fully-spent invites to keep data.json small.
        val keep = state.groupInvites.filter {
            !(it.revoked && now - it.expiresAt > 7L * 24 * 60 * 60 * 1000) &&
                !(it.uses >= it.maxUses && now - it.expiresAt > 7L * 24 * 60 * 60 * 1000) &&
                !(now - it.expiresAt > 30L * 24 * 60 * 60 * 1000)
        }
        if (keep.size != state.groupInvites.size) {
            state.groupInvites = keep.toMutableList()
        }
    }

    private fun groupInviteJson(inv: GroupInvite, includeCode: Boolean = false): JSONObject {
        val o = JSONObject()
            .put("id", inv.id)
            .put("createdBy", inv.createdBy)
            .put("createdByName", inv.createdByName)
            .put("createdAt", inv.createdAt)
            .put("expiresAt", inv.expiresAt)
            .put("maxUses", inv.maxUses)
            .put("uses", inv.uses)
            .put("revoked", inv.revoked)
            .put("channelIds", JSONArray(inv.channelIds))
            .put("active", groupInviteUsable(inv))
        if (includeCode) o.put("code", inv.code)
        return o
    }

    private fun autoIncludeChannelsPayload(): JSONArray {
        val arr = JSONArray()
        for (ch in state.channels) {
            if (!ch.autoIncludeNewMembers) continue
            if (ch.allowedUserIds == null) continue
            arr.put(JSONObject().put("id", ch.id).put("name", ch.name).put("kind", ch.kind))
        }
        return arr
    }

    private fun groupInvitesPayload(user: User): JSONArray {
        pruneGroupInvites()
        val arr = JSONArray()
        val manage = canManageServer(user)
        for (inv in state.groupInvites) {
            if (!manage && inv.createdBy != user.id) continue
            // Hide spent/expired unless still useful to show as history briefly.
            if (!groupInviteUsable(inv) && inv.revoked) continue
            if (!groupInviteUsable(inv) && System.currentTimeMillis() > inv.expiresAt + 86_400_000L) continue
            arr.put(groupInviteJson(inv, includeCode = false))
        }
        return arr
    }

    private fun broadcastGroupInvites() {
        for ((ws, token) in clients) {
            val u = state.users[token] ?: continue
            if (!canInviteToGroup(u)) continue
            try {
                ws.send(JSONObject()
                    .put("type", "groupInvites")
                    .put("invites", groupInvitesPayload(u))
                    .put("autoInclude", autoIncludeChannelsPayload())
                    .toString())
            } catch (_: Exception) {}
        }
        for ((token, _) in httpClients) {
            val u = state.users[token] ?: continue
            if (!canInviteToGroup(u)) continue
            enqueueHttp(token, JSONObject()
                .put("type", "groupInvites")
                .put("invites", groupInvitesPayload(u))
                .put("autoInclude", autoIncludeChannelsPayload())
                .toString())
        }
    }

    /* ── host API (called directly from Android UI, not over WebSocket) ── */

    /** Approve a pending connection request.
     *  Always stores a welcome for HTTP poll; also pushes over WebSocket if still connected. */
    fun approve(requestId: String): Boolean = joinOrchestrator.approve(requestId)

    /** Deny a pending request; closes the requester's socket with a message. */
    fun deny(requestId: String) = joinOrchestrator.deny(requestId)

    /** Live pending join queue with personal-invite attribution (tests + host UI). */
    fun pendingJoinsSnapshot(): List<PendingInfo> =
        pending.entries.map { (rid, p) ->
            PendingInfo(
                id = rid,
                name = p.name,
                ts = p.ts,
                invitedByUserId = p.invitedByUserId,
                invitedByName = p.invitedByName,
                inviteSlug = p.inviteSlug,
            )
        }

    fun regenerateInvite(ttlMs: Long = INVITE_TTL_MS): Pair<String, Long> =
        inviteCoordinator.regenerateInvite(ttlMs)

    /** Host member's personal invite slug, minting if needed. */
    fun hostInviteSlug(): String? {
        val host = state.users.values.find { it.isHost } ?: return null
        val before = host.inviteSlug
        val slug = membershipService.ensureInviteSlug(host)
        if (before.isNullOrBlank()) save()
        return slug
    }

    /** Full personal invite URL on this server's public or LAN origin. */
    fun hostPersonalInviteUrl(): String? {
        val slug = hostInviteSlug() ?: return null
        return personalInviteUrlFor(slug, sharePublicUrl, shareLanUrl, hostIsPublic)
            .takeIf { it.isNotEmpty() }
    }

    /** Rotate the host's personal invite slug; old links stop working. */
    fun rotateHostPersonalInviteUrl(): String? {
        val host = state.users.values.find { it.isHost } ?: return null
        val slug = membershipService.rotateInviteSlug(host)
        save()
        try {
            onPersonalInvitesChanged?.invoke()
        } catch (_: Exception) {
        }
        return personalInviteUrlFor(slug, sharePublicUrl, shareLanUrl, hostIsPublic)
            .takeIf { it.isNotEmpty() }
    }

    /** Active personal invite slugs for Worker allowlist sync. */
    fun activeInviteSlugs(): List<String> = membershipService.activeInviteSlugs()

    fun hostDisplayNameForEdge(): String = state.hostName.ifBlank { "Phlip server" }.take(40)

    /**
     * Ingest a Worker-queued or Worker-forwarded join request.
     * DrServer remains the trust boundary — validates name/fingerprint/slug like any join.
     */
    fun ingestEdgeJoinRequest(ev: JSONObject): JSONObject {
        val name = ev.optString("name")
        val fingerprint = ev.optString("fingerprint")
        val inviteSlug = ev.optString("inviteSlug").ifEmpty { ev.optString("slug") }
        return processJoin(
            nameRaw = name,
            inviteRaw = ev.optString("invite"),
            fingerprint = fingerprint,
            authVerifier = ev.optString("authVerifier"),
            ip = ev.optString("sourceIp").ifBlank { "edge-queue" },
            ws = null,
            identityId = ev.optString("identityId"),
            identityPub = ev.optString("identityPub"),
            inviteSlug = inviteSlug,
        )
    }

    fun forceJoinCode(): Boolean = inviteCoordinator.forceJoinCode()

    /**
     * Host failsafe: when enabled, every member re-login needs the current join code.
     * Turning on issues a fresh code, clears device trust, and invalidates live
     * member sessions so app/browser clients must sign in again with that code.
     */
    fun setForceJoinCode(enabled: Boolean) = inviteCoordinator.setForceJoinCode(enabled)

    /**
     * One-shot failsafe: bump [AppState.codeChallenge] so every member must present
     * the **current** join code once on next sign-in. Does not leave Force join code on,
     * and does not rotate the invite (share the existing code).
     */
    fun triggerCodeRequest() = inviteCoordinator.triggerCodeRequest()

    private fun cmdTriggerCodeRequest(user: User) =
        inviteCoordinator.cmdTriggerCodeRequest(user)

    /** Current rotating invite; refreshes automatically when expired. */
    fun currentInvite(): Pair<String, Long> = inviteCoordinator.currentInvite()

    /** The existing host user's token, or null before one is minted. Lets the
     *  Android bridge hand this server's own client a host session after a restart
     *  without re-minting (the host user is already in the loaded data.json). */
    fun hostToken(): String? = state.users.entries.find { it.value.isHost }?.key

    /** Name this server shows as its host ("hosted on X"). Set from the registry
     *  entry at create time so each hosted server is labelled distinctly. */
    fun setHostName(name: String) {
        val clean = name.trim().take(40).ifEmpty { return }
        var dirty = false
        if (state.hostName != clean) { state.hostName = clean; dirty = true }
        // Seed a default rail glyph from the server name the first time.
        if (state.iconText.isEmpty()) {
            state.iconText = sanitizeIconText(initialsOf(clean))
            dirty = true
        }
        if (dirty) save()
    }

    /** Host-only: update the short rail/nav glyph (1–2 characters). */
    fun setIconText(text: String) {
        state.iconText = sanitizeIconText(text)
        save()
        broadcast(JSONObject()
            .put("type", "serverMeta")
            .put("iconText", state.iconText)
            .put("hostName", state.hostName))
    }

    fun iconText(): String = state.iconText

    private fun sanitizeIconText(raw: String): String {
        val cps = raw.trim().codePoints().toArray()
        if (cps.isEmpty()) return ""
        val n = minOf(2, cps.size)
        return String(cps, 0, n)
    }

    private fun initialsOf(name: String): String {
        val parts = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        return when {
            parts.isEmpty() -> "?"
            parts.size == 1 -> parts[0].take(2)
            else -> "${parts[0].first()}${parts[1].first()}"
        }
    }

    /** In-process only. Mints (or reuses) the host-privileged user + token.
     *  Must never be reachable from a WebSocket message — public tunnel traffic
     *  reaches this same 127.0.0.1 socket, so trusting a loopback remoteIpAddress
     *  here would let any stranger claim host privileges. */
    fun mintHostUser(name: String): String {
        state.users.entries.find { it.value.isHost }?.let { existing ->
            membershipService.ensureHostOnPrivateChannels(existing.value)
            val before = existing.value.inviteSlug
            membershipService.ensureInviteSlug(existing.value)
            if (before.isNullOrBlank()) save()
            return existing.key
        }
        val token = buildString { val b = ByteArray(16); rng.nextBytes(b); b.forEach { append("%02x".format(it)) } }
        val cleanName = name.trim().take(24).ifEmpty { "Host" }
        val host = User(genId(), cleanName, System.currentTimeMillis(), true, role = ROLE_HOST)
        membershipService.ensureInviteSlug(host)
        state.users[token] = host
        membershipService.ensureHostOnPrivateChannels(host)
        save()
        return token
    }

    /**
     * §6 apply a setup preset. Writes permissions, roles, type pack, locations,
     * and Events auto-include. Does not lock the server — everything stays editable.
     * Returns a summary JSON for the client diff / toast.
     */
    fun applySetupPreset(
        presetRaw: String,
        activityRaw: String? = null,
        replaceTypes: Boolean = true,
        replaceLocations: Boolean = true,
    ): JSONObject = setupPresetService.applySetupPreset(
        presetRaw, activityRaw, replaceTypes, replaceLocations,
    )

    private fun cmdApplySetupPreset(user: User, m: JSONObject) =
        setupPresetService.cmdApplySetupPreset(user, m)

    /** Seed private channels with the host so they aren't empty shells. */
    private fun ensureHostOnPrivateChannels(host: User) {
        var changed = false
        for (ch in state.channels) {
            val list = ch.allowedUserIds ?: continue
            if (host.id in list) continue
            list.add(host.id)
            changed = true
        }
        if (changed) save()
    }

    /** §7 standing rule: drop a brand-new account into every private channel
     *  that opted into auto-include. Open channels need no edge. */
    private fun autoIncludeNewMember(user: User) {
        var changed = false
        for (ch in state.channels) {
            if (!ch.autoIncludeNewMembers) continue
            val list = ch.allowedUserIds ?: continue
            if (user.id in list) continue
            list.add(user.id)
            changed = true
        }
        if (changed) save()
    }

    /** Drop every active WebSocket connection (used by "cut public access"). */
    fun closeAllClients() {
        val had = clients.isNotEmpty() || httpClients.isNotEmpty()
        for ((ws, _) in clients) try {
            ws.close(WebSocketFrame.CloseCode.NormalClosure, "closed by host", false)
        } catch (_: Exception) {}
        clients.clear()
        httpClients.clear()
        if (had) {
            adjustPresenceTicker()
            fireActivityChanged()
        }
    }

    fun goingCount(eventId: String): Int {
        val ev = state.events.find { it.id == eventId } ?: return 0
        return ev.rsvps.values.count { it == "going" }
    }

    /** Debounced host+N writeback from the personal aggregate. */
    @Synchronized
    fun applyBridgeHostPlusN(eventId: String, plusN: Int) {
        val ev = state.events.find { it.id == eventId } ?: return
        val ch = state.channels.find { it.id == ev.channelId } ?: return
        val n = plusN.coerceAtLeast(0)
        if (ev.bridgeHostPlusN == n) return
        ev.bridgeHostPlusN = n
        save()
        broadcastToChannel(
            ch,
            JSONObject().put("type", "bridgeHostPlusN")
                .put("eventId", ev.id)
                .put("hostPlusN", n),
        )
    }

    fun getInviteCode() = state.inviteCode

    /** Deliver a payload to a specific member session token. */
    private fun sendToToken(token: String, msg: JSONObject) {
        deliveryHub.sendToToken(token, msg)
    }

    /** Deliver a payload to just this member's own live connections. */
    private fun sendToUser(user: User, msg: JSONObject) {
        deliveryHub.sendToUser(user, msg)
    }

    private fun rememberFingerprint(user: User, fingerprint: String) =
        membershipService.rememberFingerprint(user, fingerprint)

    private fun applyIdentityFields(user: User, identityId: String, identityPub: String) =
        membershipService.applyIdentityFields(user, identityId, identityPub)

    private fun applyInviteChannels(user: User, channelIds: List<String>): Boolean =
        membershipService.applyInviteChannels(user, channelIds)

    private fun consumeGroupInvite(invite: GroupInvite) =
        membershipService.consumeGroupInvite(invite)

    private fun groupInviteUsable(invite: GroupInvite): Boolean =
        membershipService.groupInviteUsable(invite)

    private fun findUsableGroupInvite(raw: String): GroupInvite? =
        membershipService.findUsableGroupInvite(raw)

    private fun encryptGroupKeyOnce(plain: String, setupNonce: String, name: String): String =
        membershipService.encryptGroupKeyOnce(plain, setupNonce, name)

    /** Publish Worker KV meter / plan to connected clients. */
    fun applyEdgeKvStats(kv: JSONObject) {
        if (kv.length() == 0) return
        broadcast(
            JSONObject()
                .put("type", "edgeKvStats")
                .put("kv", kv),
        )
    }

    private fun eventDurationMs(code: String?): Long = when (code ?: DEFAULT_EVENT_DURATION) {
        "5m" -> 5L * 60_000
        "10m" -> 10L * 60_000
        "15m" -> 15L * 60_000
        "30m" -> 30L * 60_000
        "45m" -> 45L * 60_000
        "1h" -> 60L * 60_000
        "2h" -> 2L * 60 * 60_000
        "3h" -> 3L * 60 * 60_000
        "4h", "morning", "afternoon", "evening" -> 4L * 60 * 60_000
        "day" -> 12L * 60 * 60_000
        else -> 60L * 60_000
    }

    private fun eventHasEnded(ev: Event, now: Long = System.currentTimeMillis()): Boolean {
        val start = ev.`when` ?: return false
        return now > start + eventDurationMs(ev.duration) + SHARE_EVENT_GRACE_MS
    }

    /** A type's colour band, falling back to its category's colour (mirrors the
     *  client). Null when neither carries one. */
    private fun typeColorResolved(type: EventType): String? {
        type.color?.takeIf { it.isNotBlank() }?.let { return it }
        val catId = type.categoryId ?: return null
        return state.categories.find { it.id == catId }?.color
    }

    /**
     * Copy an ended event's type name + colour onto the event once (§5). After a
     * type is later renamed or deleted, history keeps what it said at the time.
     * Only touches events that carry a resolvable [Event.typeId] and haven't been
     * snapshotted yet; runs on the sweep tick before any purge.
     */
    private fun sweepTypeSnapshots() = domainSweepService.sweepTypeSnapshots()

    /**
     * Wipe an event (+ chain follow-ons) and related host data:
     * notifications, mirrored chat notes, reports. Channels/users stay.
     * Returns purged event ids.
     */
    private fun purgeEventFromHost(
        eventId: String,
        broadcast: Boolean,
        persist: Boolean = true,
    ): List<String> = domainSweepService.purgeEventFromHost(eventId, broadcast, persist)

    /**
     * When [AppState.purgeEndedEvents] is on, drop finished plans from the host
     * so a compromised device only holds currently active events.
     */
    private fun sweepEndedEventPurge() = domainSweepService.sweepEndedEventPurge()

    /* ── internal helpers ── */

    private fun bumpRate(ip: String, lan: Boolean = false) = rateLimits.bump(ip, lan)

    private fun clearRate(ip: String) = rateLimits.clear(ip)

    /** Non-null error JSON when [ip] is currently locked out. */
    private fun rateLimitedError(ip: String, lan: Boolean): JSONObject? =
        rateLimits.limitedError(ip, lan)

    /** True for loopback / RFC1918 / link-local / ULA — used to loosen LAN rate limits. */
    private fun isPrivateClientIp(ip: String): Boolean = ClientAddressPolicy.isPrivateClientIp(ip)

    /** Shared cap for member and Broadcast long-polls. */
    private fun tryBeginPoll(): Boolean = rateLimits.tryBeginPoll()

    private fun endPoll() = rateLimits.endPoll()

    private fun notifyPending() {
        pruneStalePending()
        val list = pending.entries.map { (rid, p) ->
            PendingInfo(
                id = rid,
                name = p.name,
                ts = p.ts,
                invitedByUserId = p.invitedByUserId,
                invitedByName = p.invitedByName,
                inviteSlug = p.inviteSlug,
            )
        }
        onPendingChanged?.invoke(list)
        broadcastPendingToManagers()
    }

    /** Push the live join queue to hosts/admins (app + browser), not only the host phone dialog. */
    private fun broadcastPendingToManagers() {
        val requests = pending.entries.map { (rid, p) ->
            buildMap<String, Any?> {
                put("id", rid)
                put("name", p.name)
                put("ts", p.ts)
                p.invitedByUserId?.let { put("invitedByUserId", it) }
                p.invitedByName?.let { put("invitedByName", it) }
                p.inviteSlug?.let { put("inviteSlug", it) }
            }
        }
        val raw = JSONObject()
            .put("type", "pending")
            .put("requests", JSONArray(gson.toJson(requests)))
            .toString()
        for ((ws, token) in clients) {
            val u = state.users[token] ?: continue
            if (!canManageServer(u)) continue
            try { ws.send(raw) } catch (_: Exception) {}
        }
        for ((token, _) in httpClients) {
            val u = state.users[token] ?: continue
            if (!canManageServer(u)) continue
            enqueueHttp(token, raw)
        }
    }

    /** Drop join requests older than 10 minutes with no live socket. */
    private fun pruneStalePending() = httpSessions.pruneStalePending()

    /** Drop approved-welcome / denied markers older than 10 minutes (poll retries share the same id). */
    private fun pruneReadyWelcome() = httpSessions.pruneReadyWelcome()

    private fun clientIp(session: IHTTPSession): String = ClientAddressPolicy.clientIp(session)

    /** True only for a direct private-network request, never Cloudflare or port-forwarded WAN. */
    private fun isDirectLanRequest(session: IHTTPSession): Boolean =
        ClientAddressPolicy.isDirectLanRequest(session)

    private fun passwordsEqual(a: String, b: String): Boolean = ClientAddressPolicy.passwordsEqual(a, b)

    private val reporting by lazy {
        ReportingCoordinator(
            stateProvider = { state },
            gson = gson,
            clients = clients,
            httpClients = httpClients,
            userByToken = { token -> state.users[token] },
            canModerate = { user -> canModerateEvents(user) },
            enqueueHttp = ::enqueueHttp,
            save = ::saveNow,
        )
    }

    /** Stores a notification for its recipient and, if they're currently connected,
     *  pushes it to them live so the sidebar badge updates without a refresh. */
    private fun pushNotification(n: Notification) = reporting.pushNotification(n)

    /** Deliver a message to every connected host/admin/moderator (report inbox feed). */
    private fun broadcastToModerators(msg: JSONObject) = reporting.broadcastToModerators(msg)

    private fun publicUser(
        u: User,
        onlineIds: Collection<String> = onlineUserIds(),
        includeLivePic: Boolean = true,
    ): JSONObject = snapshotBuilder.publicUser(u, onlineIds, includeLivePic)

    private fun selfUser(u: User): JSONObject = snapshotBuilder.selfUser(u)

    private fun membersPayload(includeLivePics: Boolean = true): JSONArray =
        snapshotBuilder.membersPayload(includeLivePics)

    /** Drop session photos for anyone no longer connected. */
    private fun pruneLivePics(onlineIds: Collection<String>) =
        presenceCoordinator.pruneLivePics(onlineIds)

    private fun serverSettingsPayload(): JSONObject =
        JSONObject()
            .put("allowUserCreateEvents", effectiveCreateEvents() == PERM_EVERYONE)
            .put("createEvents", effectiveCreateEvents())
            .put("createEventTypes", normalizeMemberPerm(state.createEventTypes, PERM_MODERATOR))
            .put("addLocations", normalizeMemberPerm(state.addLocations, PERM_MODERATOR))
            .put("inviteToGroup", PERM_ADMIN)
            .put("liveProfilePhotos", state.effectiveLiveProfilePhotos())
            .put("allowProfilePics", state.effectiveLiveProfilePhotos() != LIVE_PROFILE_PHOTOS_OFF)
            .put("allowUserDraw", state.allowUserDraw)
            .put("cardTheme", state.cardTheme.ifBlank { "classic" })
            .put("forceJoinCode", state.forceJoinCode)
            .put("codeChallenge", state.codeChallenge)
            .put("defaultRole", defaultRoleForNewMembers())
            .put("minAge", clampMinAge(state.minAge))
            .put("purgeEndedEvents", state.purgeEndedEvents)
            .put("chatRetentionDays", clampChatRetentionDays(state.chatRetentionDays))
            .put("allowFreeform", state.allowFreeform != false)
            .put("allowMultiLocations", state.allowMultiLocations)
            .put("allowPinnedPeople", state.allowPinnedPeople)
            .put("setupPreset", state.setupPreset ?: JSONObject.NULL)
            .put("setupActivity", state.setupActivity ?: JSONObject.NULL)
            .put("offerAutoInclude", state.offerAutoInclude != false)
            .put("description", state.description ?: "")
            .put("eventsRequireApprovalDefault", state.eventsRequireApprovalDefault)
            .put("demoUsersEnabled", DEMO_USERS_FEATURE_ENABLED)

    private fun clampChatRetentionDays(raw: Int): Int =
        when (raw) {
            1, 7, 30, 90 -> raw
            else -> 0
        }

    /**
     * Drop chat older than [AppState.chatRetentionDays]. Broadcasts `chatPurged`
     * so clients trim without a full sync. `0` retention = no-op (keep forever).
     */
    private fun sweepChatRetention() = domainSweepService.sweepChatRetention()

    /** Unauthenticated meta for the join agreement screen (before name/password).
     *  Rotating join codes are no longer advertised; [joinTag] identifies the LAN server. */
    private fun publicJoinMeta(@Suppress("UNUSED_PARAMETER") session: IHTTPSession): JSONObject {
        val o = JSONObject()
            .put("ok", true)
            .put("name", state.hostName.ifBlank { "Phlip server" })
            .put("minAge", clampMinAge(state.minAge))
        if (registryJoinTag.isNotEmpty()) o.put("joinTag", registryJoinTag)
        return o
    }

    private fun defaultRoleForNewMembers(): String {
        val r = state.defaultRole?.trim()?.lowercase().orEmpty()
        return if (r in ASSIGNABLE_ROLES) r else ROLE_USER
    }

    private fun canManageServer(u: User): Boolean = authorization.canManageServer(u)
    private fun canModerateEvents(u: User): Boolean = authorization.canModerateEvents(u)
    private fun canCreateEvents(u: User): Boolean = authorization.canCreateEvents(u)
    private fun effectiveCreateEvents(): String = authorization.effectiveCreateEvents()
    private fun meetsMemberPerm(u: User, level: String): Boolean = authorization.meetsMemberPerm(u, level)
    private fun canCreateEventTypes(u: User): Boolean = authorization.canCreateEventTypes(u)
    private fun canAddLocations(u: User): Boolean = authorization.canAddLocations(u)
    private fun canInviteToGroup(u: User): Boolean = authorization.canInviteToGroup(u)
    private fun canUserDraw(): Boolean = authorization.canUserDraw()
    private fun canCreateType(u: User, type: EventType): Boolean = authorization.canCreateType(u, type)
    private fun canMutateContent(u: User): Boolean = authorization.canMutateContent(u)
    private fun canEditEvent(u: User, ev: Event): Boolean = authorization.canEditEvent(u, ev)

    private fun canManageMember(actor: User, target: User): Boolean = authorization.canManageMember(actor, target)
    private fun channelVisible(channel: Channel, user: User): Boolean = authorization.channelVisible(channel, user)
    private fun meetsChannelMinRole(channel: Channel, user: User): Boolean =
        authorization.meetsChannelMinRole(channel, user)
    private fun audienceFor(channel: Channel): Collection<User> = authorization.audienceFor(channel)

    /** Like broadcast(), but only to sockets whose user can see this channel. */
    private fun broadcastToChannel(channel: Channel, msg: JSONObject) {
        val ids = audienceFor(channel).map { it.id }.toSet()
        deliveryHub.broadcastToAudience(ids, msg)
    }

    private fun appendEventActivity(channel: Channel, event: Event, note: EventNote) {
        eventCommands.appendEventActivity(channel, event, note)
    }

    /** Full resync for every connected client, each getting their own permission-
     *  filtered snapshot. Used after host channel-admin actions (create/update/
     *  delete channel, bulk-delete) where the audience for existing channels may
     *  have changed — simpler and safer than delta-patching who-sees-what. */
    private fun pushSyncToAll() {
        deliveryHub.pushSyncToAll(::snapshot)
    }

    private fun jsonStringList(arr: JSONArray?): MutableList<String>? {
        if (arr == null) return null
        val out = ArrayList<String>(arr.length())
        for (i in 0 until arr.length()) {
            val v = arr.opt(i) ?: continue
            when (v) {
                is String -> out.add(v)
                is Number, is Boolean -> out.add(v.toString())
                else -> continue // skip objects/arrays — never throw on hostile JSON
            }
        }
        return out
    }

    private fun onlineUserIds(): List<String> = presenceCoordinator.onlineUserIds()

    private fun snapshot(user: User): JSONObject = snapshotBuilder.snapshot(user)

    private fun postWelcomeMemberJoined(user: User) = collaborationCommands.postMemberJoined(user)

    private fun err(msg: String) = JSONObject().put("type", "error").put("error", msg).toString()

    private fun presence() = presenceCoordinator.presence()

    /** One member's session photo (or clear) — not a full roster re-send. */
    private fun broadcastLivePic(userId: String, pic: String?) =
        presenceCoordinator.broadcastLivePic(userId, pic)

    /** Drop every RAM live pic and notify clients. */
    private fun clearAllLivePics() {
        val ids = livePics.keys.toList()
        livePics.clear()
        for (id in ids) broadcastLivePic(id, null)
    }

    /** Clear persisted camera photos on every member. Caller saves when needed. */
    private fun clearAllProfilePics() {
        var changed = false
        for (u in state.users.values) {
            if (u.profilePic != null) {
                u.profilePic = null
                changed = true
            }
        }
        if (changed) save()
    }

    private fun broadcastMembers() = presenceCoordinator.broadcastMembers()

    /**
     * Wipe a departed member's footprint from host state. Keeps Event rows but
     * clears [Event.createdBy] so the organiser chip renders empty. Removes:
     * RSVPs, reactions, authored notes, chat messages, pitch seats / hands /
     * plays / blocks / supports, reports by or targeting them, and notifications
     * from them.
     */
    private fun purgeMemberContent(userId: String) {
        for (ev in state.events) {
            if (ev.createdBy == userId) {
                ev.createdBy = ""
                ev.createdByName = ""
            }
            if (ev.stickerBy == userId) {
                ev.stickerBy = null
                ev.stickerByName = null
            }
            ev.rsvps.remove(userId)
            ev.reactions?.remove(userId)
            ev.reactionStacks?.remove(userId)
            ev.addedBy?.remove(userId)
            ev.addedBy?.entries?.removeAll { it.value == userId }
            if (ev.addedBy?.isEmpty() == true) ev.addedBy = null
            if (ev.reactions?.isEmpty() == true) ev.reactions = null
            if (ev.reactionStacks?.isEmpty() == true) ev.reactionStacks = null
            val notes = ev.notes
            if (notes != null) {
                notes.removeAll { it.userId == userId }
                if (notes.isEmpty()) ev.notes = null
                else {
                    for (n in notes) {
                        n.mentionedUserIds?.removeAll { it == userId }
                    }
                }
            }
        }
        for (block in state.timeBlocks) {
            block.signups?.removeAll { it.userId == userId }
        }
        for ((chId, list) in state.messages.toList()) {
            list.removeAll { it.userId == userId }
            for (msg in list) {
                msg.mentionedUserIds?.removeAll { it == userId }
            }
            if (list.isEmpty()) state.messages.remove(chId)
        }

        state.reports.removeAll {
            it.reporterId == userId || (it.targetType == "user" && it.targetId == userId)
        }
        // Drop other members' inbox rows that came from this person.
        for ((uid, list) in state.notifications.toList()) {
            list.removeAll { it.fromUserId == userId }
            if (list.isEmpty()) state.notifications.remove(uid)
        }
        for (u in state.users.values) {
            u.blockedUserIds?.remove(userId)
        }
    }

    private fun disconnectUser(token: String, reason: String) {
        val kicked = JSONObject().put("type", "kicked").put("error", reason).toString()
        // HTTP long-poll: enqueue kicked and wake the waiter before releasing so
        // the client can drop the server (release alone only yields a bare 403).
        if (httpClients.containsKey(token)) {
            enqueueHttp(token, kicked)
            try {
                scheduler.schedule(1500L) { releaseHttpSession(token) }
            } catch (_: Exception) {
                releaseHttpSession(token)
            }
        }
        for ((ws, t) in clients.entries.toList()) {
            if (t != token) continue
            unbindClient(ws)
            try {
                ws.send(kicked)
                ws.close(WebSocketFrame.CloseCode.NormalClosure, reason, false)
            } catch (_: Exception) {}
        }
        presence()
    }

    private fun broadcast(msg: JSONObject) {
        deliveryHub.broadcast(msg)
    }

    internal fun testStateForFixture(): AppState = state

    internal fun testSaveForFixture() = save()

    internal fun testMembersPayloadForFixture(includeLivePics: Boolean): JSONArray =
        membersPayload(includeLivePics)

    internal fun testSetActivePollsForFixture(count: Int) {
        activePolls.set(count)
    }

    internal fun testSetDemoDelayOverrideMsForFixture(ms: Long?) {
        demoUserService.testDelayOverrideMs = ms
    }
}
