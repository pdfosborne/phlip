package com.phlip.bridge

import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.core.content.ContextCompat
import app.phlip.server.HostService
import app.phlip.server.SecurityRejectLog
import app.phlip.server.ServerRegistry
import app.phlip.server.local.ApprovedNetworks
import app.phlip.server.normalizeSetupPreset
import app.phlip.server.publichost.HostPublicGate
import app.phlip.server.publichost.cloudflare.CloudflarePrefs
import com.phlip.MainActivity
import com.phlip.PlayUpdateHelper
import com.phlip.SettingsActivity
import com.phlip.VersionPolicy
import org.json.JSONObject

/**
 * Host-side AshNative calls: hosting lifecycle, hosted-server CRUD, invites,
 * join approvals, setup consents, and the native settings entry points.
 */
class HostingJsApi(
    private val main: MainActivity,
) {
    /** Full Host settings snapshot for the right info panel. */
    fun hostStatus(): String = main.buildHostStatusJson().toString()

    fun startHosting(): String {
        main.runOnUiThread {
            try {
                ContextCompat.startForegroundService(
                    main,
                    Intent(main, HostService::class.java),
                )
                // Ensure we are main.bound so status callbacks resume quickly.
                if (!main.bound) {
                    main.bindService(
                        Intent(main, HostService::class.java),
                        main.connection,
                        Context.BIND_AUTO_CREATE,
                    )
                }
            } catch (t: Throwable) {
                Toast.makeText(
                    main,
                    t.message?.take(120) ?: "Could not start hosting",
                    Toast.LENGTH_SHORT,
                ).show()
            }
        }
        return JSONObject().put("ok", true).toString()
    }

    fun stopHosting(): String {
        main.runOnUiThread {
            main.hostService?.stopHosting()
            main.pushHostStatusToWebView()
            main.bridgeHostingIfRunning()
        }
        return JSONObject().put("ok", true).toString()
    }

    fun createServer(name: String, preset: String, activityLabel: String, hostName: String): String {
        val result = JSONObject().put("ok", false).put("error", "Start hosting first")
        val latch = java.util.concurrent.CountDownLatch(1)
        main.runOnUiThread {
            try {
                val svc = main.hostService
                if (svc == null || !svc.isRunning()) {
                    result.put("ok", false).put("error", "Start hosting first")
                    return@runOnUiThread
                }
                if (!HostPublicGate.alphaAckAccepted(main)) {
                    result.put("ok", false).put("error", "Accept the alpha software risks first")
                    return@runOnUiThread
                }
                val serverName = name.trim().take(40)
                if (serverName.isEmpty()) {
                    result.put("ok", false).put("error", "Enter a server name")
                    return@runOnUiThread
                }
                val host = hostName.trim().take(24).ifEmpty {
                    main.hostAckPrefs().getString("host_name", "")?.trim().orEmpty().ifEmpty { "Host" }
                }
                main.hostAckPrefs().edit().putString("host_name", host).apply()
                val p = normalizeSetupPreset(preset)
                val act = activityLabel.trim().take(40).ifEmpty { null }
                val hs = svc.createServer(serverName, host, public = false, preset = p, activity = act)
                if (hs == null) {
                    result.put("ok", false).put("error", "Could not create server")
                } else {
                    result.put("ok", true).put("id", hs.id).remove("error")
                    main.pushHostStatusToWebView()
                    main.bridgeHostingIfRunning()
                }
            } catch (t: Throwable) {
                result.put("ok", false).put("error", t.message?.take(120) ?: "Could not create server")
            } finally {
                latch.countDown()
            }
        }
        try { latch.await(8, java.util.concurrent.TimeUnit.SECONDS) } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        }
        return result.toString()
    }

    fun deleteHostedServer(serverId: String): String {
        val id = serverId.trim()
        if (id.isEmpty()) return JSONObject().put("ok", false).put("error", "Missing server").toString()
        main.runOnUiThread {
            main.hostService?.deleteServer(id)
            main.pushHostStatusToWebView()
            main.bridgeHostingIfRunning()
        }
        return JSONObject().put("ok", true).toString()
    }

    /**
     * Factory reset — wipe all hosted servers + host prefs / Cloudflare / identity.
     * Client clears WebView storage and reloads after this returns.
     */
    fun factoryReset(): String {
        val result = JSONObject().put("ok", false)
        val latch = java.util.concurrent.CountDownLatch(1)
        main.runOnUiThread {
            try {
                val svc = main.hostService
                if (svc != null) {
                    svc.wipeAllHostedData()
                } else {
                    val reg = ServerRegistry(main)
                    for (s in reg.all()) {
                        try {
                            reg.remove(s.id)
                        } catch (_: Exception) {
                        }
                    }
                    HostPublicGate.setHostingDesired(main, false)
                }
                main.sweepLeftoverHostDataFiles()
                HostPublicGate.hostPrefs(main).edit().clear().apply()
                try {
                    CloudflarePrefs(main).clearAll()
                } catch (_: Exception) {
                }
                try {
                    ApprovedNetworks(main).forgetAll()
                } catch (_: Exception) {
                }
                try {
                    main.identitySecrets().remove("identity_p256_jwk")
                } catch (_: Exception) {
                }
                try {
                    main.getSharedPreferences(MainActivity.PREFS_UI, Context.MODE_PRIVATE).edit().clear().apply()
                } catch (_: Exception) {
                }
                main.pushHostStatusToWebView()
                main.bridgeHostingIfRunning()
                result.put("ok", true).remove("error")
            } catch (t: Throwable) {
                result.put("ok", false)
                    .put("error", t.message?.take(120) ?: "Factory reset failed")
            } finally {
                latch.countDown()
            }
        }
        try {
            latch.await(45, java.util.concurrent.TimeUnit.SECONDS)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        }
        return result.toString()
    }

    fun setForceJoinCode(serverId: String, enabled: Boolean): String {
        main.runOnUiThread {
            main.hostService?.setForceJoinCode(serverId.trim(), enabled)
            main.pushHostStatusToWebView()
        }
        return JSONObject().put("ok", true).toString()
    }

    fun triggerCodeRequest(serverId: String): String {
        main.runOnUiThread {
            main.hostService?.triggerCodeRequest(serverId.trim())
            main.pushHostStatusToWebView()
        }
        return JSONObject().put("ok", true).toString()
    }

    fun setPublicHosting(serverId: String, enabled: Boolean): String {
        val svc = main.hostService
            ?: return JSONObject().put("ok", false).put("error", "Hosting is off").toString()
        val ok = svc.setPublic(serverId.trim(), enabled)
        main.runOnUiThread {
            main.pushHostStatusToWebView()
            main.bridgeHostingIfRunning()
        }
        return JSONObject()
            .put("ok", ok)
            .put(
                "error",
                if (ok) JSONObject.NULL
                else (HostPublicGate.blockReason(main, CloudflarePrefs(main))
                    ?: "Could not change Public"),
            )
            .toString()
    }

    fun returnServerToDeviceOnly(serverId: String): String {
        val svc = main.hostService
            ?: return JSONObject().put("ok", false).put("error", "Hosting is off").toString()
        val error = try { svc.returnServerToDeviceOnly(serverId.trim()) }
            catch (t: Throwable) { t.message ?: "Could not stop sharing; check the server status" }
        main.runOnUiThread {
            main.bridgeHostingIfRunning()
            main.pushHostStatusToWebView()
        }
        return JSONObject().put("ok", error == null).put("error", error ?: JSONObject.NULL).toString()
    }

    /** Lock near-field to On this device, Local STA Wi‑Fi, or Direct Soft-AP. */
    fun setReachMode(serverId: String, mode: String): String {
        val svc = main.hostService
            ?: return JSONObject().put("ok", false).put("error", "Hosting is off").toString()
        val error = svc.setReachMode(serverId.trim(), mode.trim())
        main.runOnUiThread {
            main.pushHostStatusToWebView()
            main.pushHotspotSessionToWebView()
            main.bridgeHostingIfRunning()
        }
        return JSONObject()
            .put("ok", error == null)
            .put("error", error ?: JSONObject.NULL)
            .toString()
    }

    fun regenerateInvite(serverId: String): String {
        main.runOnUiThread {
            main.hostService?.regenerateInvite(serverId.trim())
            main.pushHostStatusToWebView()
            main.bridgeHostingIfRunning()
        }
        return JSONObject().put("ok", true).toString()
    }

    fun hostInviteLink(serverId: String): String {
        val url = main.hostService?.hostInviteLink(serverId.trim()).orEmpty()
        return JSONObject()
            .put("ok", url.isNotEmpty())
            .put("url", url)
            .put("error", if (url.isEmpty()) "No invite link" else JSONObject.NULL)
            .toString()
    }

    fun rotateHostInviteLink(serverId: String): String {
        val url = main.hostService?.rotateHostInviteLink(serverId.trim()).orEmpty()
        main.runOnUiThread {
            main.pushHostStatusToWebView()
            main.bridgeHostingIfRunning()
        }
        return JSONObject()
            .put("ok", url.isNotEmpty())
            .put("url", url)
            .put("rotated", url.isNotEmpty())
            .put("error", if (url.isEmpty()) "Couldn't rotate invite link" else JSONObject.NULL)
            .toString()
    }

    fun approveJoin(serverId: String, requestId: String): String {
        val ok = main.hostService?.approve(serverId.trim(), requestId.trim()) == true
        main.runOnUiThread {
            main.pushHostStatusToWebView()
            main.pushPendingJoinQueueToWebView()
        }
        return JSONObject().put("ok", ok).toString()
    }

    fun denyJoin(serverId: String, requestId: String): String {
        main.hostService?.deny(serverId.trim(), requestId.trim())
        main.runOnUiThread {
            main.pushHostStatusToWebView()
            main.pushPendingJoinQueueToWebView()
        }
        return JSONObject().put("ok", true).toString()
    }

    fun acceptHostRules(): String = ackHostPref(HostPublicGate.KEY_HOST_RULES_ACK)

    fun acceptAlphaAck(): String = ackHostPref(HostPublicGate.KEY_ALPHA_ACK)

    fun acceptLocalPrep(): String = ackHostPref(HostPublicGate.KEY_LOCAL_PREP_ACK)

    fun acceptDevicePrep(): String = ackHostPref(HostPublicGate.KEY_DEVICE_PREP_ACK)

    fun acceptPatchWarning(): String = ackHostPref(HostPublicGate.KEY_PATCH_WARN_DISMISSED)

    private fun ackHostPref(key: String): String {
        main.hostAckPrefs().edit().putBoolean(key, true).apply()
        main.runOnUiThread { main.pushHostStatusToWebView() }
        return JSONObject().put("ok", true).toString()
    }

    fun acceptOperatorAck(): String {
        CloudflarePrefs(main).operatorAcknowledged = true
        main.runOnUiThread { main.pushHostStatusToWebView() }
        return JSONObject().put("ok", true).toString()
    }

    fun acceptDataAck(): String {
        CloudflarePrefs(main).dataDisclosureAcknowledged = true
        main.runOnUiThread { main.pushHostStatusToWebView() }
        return JSONObject().put("ok", true).toString()
    }

    fun acceptPublicRiskAck(): String {
        CloudflarePrefs(main).publicRiskAcknowledged = true
        main.runOnUiThread { main.pushHostStatusToWebView() }
        return JSONObject().put("ok", true).toString()
    }

    fun setSecurityRejectLog(enabled: Boolean): String {
        SecurityRejectLog.setEnabled(main, enabled)
        main.runOnUiThread { main.pushHostStatusToWebView() }
        return JSONObject().put("ok", true).toString()
    }

    /** Opens native Cloudflare domain / API setup (skips Host setup hub). */
    fun openCloudflareSetup() {
        main.runOnUiThread { main.openSettingsScreen(SettingsActivity.SCREEN_CLOUDFLARE_CONNECT) }
    }

    /** Opens the host-facing Cloudflare HSTS instructions directly. */
    fun openCloudflareSecurityGuide() {
        main.runOnUiThread {
            main.openSettingsScreen(
                SettingsActivity.SCREEN_CLOUDFLARE,
                showHstsGuide = true,
            )
        }
    }

    /** Refresh remote version policy + optional Play flexible update prompt. */
    fun checkHostUpdates(): String {
        main.runOnUiThread {
            Toast.makeText(main, "Checking for updates…", Toast.LENGTH_SHORT).show()
            VersionPolicy.refreshAsync(main) {
                if (VersionPolicy.isPlayInstall(main)) {
                    PlayUpdateHelper.checkAndPromptFlexible(main) {
                        main.hostService?.isLiveBusy() == true
                    }
                }
                main.pushHostStatusToWebView()
                val msg = when {
                    VersionPolicy.isBelowMinSafe() -> "Update required before Public hosting"
                    VersionPolicy.isUpdateAvailable() -> "A newer Phlip is available"
                    else -> "You're on the latest known build"
                }
                Toast.makeText(main, msg, Toast.LENGTH_SHORT).show()
            }
        }
        return JSONObject().put("ok", true).toString()
    }

    /** App settings formerly on the ⋮ overflow — now opened from the info panel. */
    fun openAppSettings(screen: String) {
        val key = screen.trim().lowercase()
        main.runOnUiThread {
            when (key) {
                "host" -> main.openSettingsScreen(SettingsActivity.SCREEN_HOST)
                "hostsetup", "host_info", "hostinfo" ->
                    main.openSettingsScreen(SettingsActivity.SCREEN_HOST_SETUP)
                "support" -> main.openSettingsScreen(SettingsActivity.SCREEN_SUPPORT)
                "legal" -> main.openSettingsScreen(SettingsActivity.SCREEN_LEGAL)
                "contact" -> main.openSettingsScreen(SettingsActivity.SCREEN_CONTACT)
                "help" -> main.openHelpFaqs()
            }
        }
    }
}
