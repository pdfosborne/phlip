package com.phlip.hosting

import android.content.Context
import app.phlip.server.DevicePatchStatus
import app.phlip.server.HostService
import app.phlip.server.HostingConsent
import app.phlip.server.SecurityRejectLog
import app.phlip.server.publichost.HostPublicGate
import app.phlip.server.publichost.cloudflare.CloudflarePrefs
import com.phlip.VersionPolicy
import org.json.JSONArray
import org.json.JSONObject

/** Snapshot for the in-panel Host settings UI (right info sidebar). */
object HostStatusBuilder {

    fun build(context: Context, service: HostService?): JSONObject {
        val svc = service
        val running = svc != null && svc.isRunning()
        val cf = CloudflarePrefs(context)
        val patch = DevicePatchStatus.evaluate()
        val snap = VersionPolicy.current()
        val setup = JSONObject()
            .put("rulesAccepted", HostPublicGate.hostRulesAccepted(context))
            .put("alphaAckAccepted", HostPublicGate.alphaAckAccepted(context))
            .put("localPrepAccepted", HostPublicGate.localPrepAccepted(context))
            .put("devicePrepAccepted", HostPublicGate.devicePrepAccepted(context))
            .put("patchAckSatisfied", HostPublicGate.patchAckSatisfied(context))
            .put("patchBucket", patch.bucket.name)
            .put("patchLabel", DevicePatchStatus.friendlyPatchLabel(patch))
            .put("operatorAck", cf.operatorAcknowledged)
            .put("dataAck", cf.dataDisclosureAcknowledged)
            .put("publicRiskAck", cf.publicRiskAcknowledged)
            .put("cloudflareConfigured", cf.hasNamedTunnel())
            .put("cloudflareDomain", cf.domain)
            .put("publicReady", HostPublicGate.canGoPublic(context, cf))
            .put("localReady", HostPublicGate.canShareNearby(context))
            .put("publicBlockReason", HostPublicGate.blockReason(context, cf) ?: JSONObject.NULL)
            .put("securityLogEnabled", SecurityRejectLog.isEnabled(context))
            .put("appVersion", VersionPolicy.currentName())
            .put("belowMinSafe", VersionPolicy.isBelowMinSafe())
            .put("updateAvailable", VersionPolicy.isUpdateAvailable())
            .put("latestVersion", snap?.latest ?: JSONObject.NULL)
            .put("minSafeVersion", snap?.minSafe ?: JSONObject.NULL)
            .put(
                "hostName",
                HostPublicGate.hostPrefs(context).getString("host_name", "") ?: "",
            )
        if (running && svc != null) {
            setup.put("networkGate", if (svc.isNetworkSuspended()) "suspended" else "serving")
                .put("networkGateLabel", svc.networkGateLabel())
                .put("lanBroadcastAllowed", svc.isLanBroadcastAllowed())
                .put("networkSuspended", svc.isNetworkSuspended())
                .put("networkPending", svc.hasPendingNetwork())
                .put("networkOffline", svc.isNetworkSuspended() && !svc.hasPendingNetwork())
                .put("networkPendingLabel", svc.pendingNetworkLabel())
                .put("liveBusy", svc.isLiveBusy())
                .put(
                    "networkApproveTitle",
                    HostingConsent.NETWORK_APPROVE_TITLE,
                )
                .put("networkApproveBody", HostingConsent.NETWORK_APPROVE_BODY)
                .put("networkApproveOnce", HostingConsent.NETWORK_APPROVE_ONCE)
                .put("networkAlwaysTrust", HostingConsent.NETWORK_ALWAYS_TRUST)
                .put("networkPauseTitle", HostingConsent.NETWORK_PAUSE_TITLE)
                .put(
                    "networkPauseText",
                    if (svc.isLiveBusy()) HostingConsent.NETWORK_PAUSE_BUSY_TEXT
                    else HostingConsent.NETWORK_PAUSE_TEXT,
                )
                .put("networkOfflineTitle", HostingConsent.NETWORK_OFFLINE_TITLE)
                .put("networkOfflineText", HostingConsent.NETWORK_OFFLINE_TEXT)
        } else {
            setup.put("networkGate", "off")
                .put("networkGateLabel", "off")
                .put("lanBroadcastAllowed", false)
                .put("networkSuspended", false)
                .put("networkPending", false)
                .put("networkOffline", false)
                .put("networkPendingLabel", "")
                .put("liveBusy", false)
        }
        val consent = JSONObject()
            .put("hostRulesTitle", HostingConsent.HOST_RULES_TITLE)
            .put("hostRulesBody", HostingConsent.HOST_RULES_BODY)
            .put("hostRulesAccept", HostingConsent.HOST_RULES_ACCEPT)
            .put("alphaTitle", HostingConsent.ALPHA_ACK_TITLE)
            .put("alphaBody", HostingConsent.ALPHA_ACK_BODY)
            .put("alphaAccept", HostingConsent.ALPHA_ACK_ACCEPT)
            .put("localPrepTitle", HostingConsent.LOCAL_PREP_TITLE)
            .put("localPrepBody", HostingConsent.LOCAL_PREP_BODY)
            .put("localPrepAccept", HostingConsent.LOCAL_PREP_ACCEPT)
            .put("devicePrepTitle", HostingConsent.DEVICE_PREP_TITLE)
            .put("devicePrepBody", HostingConsent.DEVICE_PREP_BODY)
            .put("devicePrepAccept", HostingConsent.DEVICE_PREP_ACCEPT)
            .put("patchTitle", HostingConsent.PATCH_WARNING_TITLE)
            .put("patchBody", HostingConsent.patchWarningBody(DevicePatchStatus.friendlyPatchLabel(patch)))
            .put("patchAccept", HostingConsent.PATCH_WARNING_ACCEPT)
            .put("operatorTitle", HostingConsent.OPERATOR_ACK_TITLE)
            .put("operatorBody", HostingConsent.OPERATOR_ACK_BODY)
            .put("operatorAccept", HostingConsent.OPERATOR_ACK_ACCEPT)
            .put("dataTitle", HostingConsent.DATA_ACK_TITLE)
            .put("dataBody", HostingConsent.DATA_ACK_BODY)
            .put("dataAccept", HostingConsent.DATA_ACK_ACCEPT)
            .put("publicRiskTitle", HostingConsent.PUBLIC_RISK_TITLE)
            .put("publicRiskBody", HostingConsent.PUBLIC_RISK_BODY)
            .put("publicRiskAccept", HostingConsent.PUBLIC_RISK_ACCEPT)
            .put("updateTitle", HostingConsent.UPDATE_NEEDED_TITLE)
        val servers = JSONArray()
        if (running && svc != null) {
            for (st in svc.serverStatuses()) {
                servers.put(
                    JSONObject()
                        .put("id", st.id)
                        .put("name", st.name)
                        .put("port", st.port)
                        .put("lanUrl", st.lanUrls.firstOrNull() ?: "")
                        .put("inviteCode", st.inviteCode)
                        .put("inviteExpiry", st.inviteExpiry)
                        .put("shareCode", st.shareCode)
                        .put("inviteSlug", st.inviteSlug)
                        .put("inviteUrl", st.inviteUrl)
                        .put("isPublic", st.isPublic)
                        .put("publicUrl", st.publicUrl ?: "")
                        .put("publicNetworkCode", st.publicNetworkCode)
                        .put("forceJoinCode", st.forceJoinCode)
                        .put("publicSubdomain", st.publicSubdomain)
                        .put("namedHostname", st.namedHostname)
                        .put("error", st.error ?: JSONObject.NULL)
                        .put("reachMode", st.reachMode)
                        .put("listening", st.listening)
                        .put("hotspotActive", st.hotspotActive)
                        .put("hotspotSsid", st.hotspotSsid)
                        .put("hotspotPassword", st.hotspotPassword)
                        .put("hotspotQrUri", st.hotspotQrUri)
                        .put("hotspotLanUrl", st.hotspotLanUrl)
                        .put("hotspotRadioLive", st.hotspotRadioLive)
                        .put("hotspotRadioNote", st.hotspotRadioNote)
                        .put("sharingReady", JSONObject()
                            .put("local", st.listening && st.reachMode == "local" && !svc.isNetworkSuspended() && st.lanUrls.isNotEmpty())
                            .put("direct", st.listening && st.reachMode == "direct" && st.hotspotActive && st.hotspotRadioLive && st.hotspotLanUrl.isNotBlank())
                            .put("public", st.listening && st.isPublic && !svc.isNetworkSuspended() && !st.publicUrl.isNullOrBlank() && st.error.isNullOrBlank()))
                        .put("pending", JSONArray().also { arr ->
                            for (p in st.pending) {
                                arr.put(
                                    JSONObject()
                                        .put("id", p.id)
                                        .put("name", p.name)
                                        .put("ts", p.ts)
                                        .also { o ->
                                            p.invitedByName?.takeIf { it.isNotEmpty() }?.let { o.put("invitedByName", it) }
                                            p.invitedByUserId?.takeIf { it.isNotEmpty() }?.let { o.put("invitedByUserId", it) }
                                            p.inviteSlug?.takeIf { it.isNotEmpty() }?.let { o.put("inviteSlug", it) }
                                        },
                                )
                            }
                        }),
                )
            }
        }
        return JSONObject()
            .put("available", true)
            .put("running", running)
            .put("servers", servers)
            .put("setup", setup)
            .put("consent", consent)
    }
}
