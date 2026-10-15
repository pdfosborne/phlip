package com.phlip.backup

import com.phlip.MainActivity
import org.json.JSONObject

/**
 * Host-only server backup export / unlock / restore. Sealing and reading run on
 * `clientIo`; the SAF launchers and pending envelope+payload handoffs stay on
 * [MainActivity].
 */
class ServerBackupBridge(
    private val main: MainActivity,
) {
    /** Builds+seals on a background thread, then SAF. Result: `window.__ashOnServerBackupExport(boolean)`. */
    fun exportServerBackup(serverId: String, kind: String, passphrase: String, suggestedName: String) {
        val id = serverId.trim()
        val k = kind.trim()
        val pass = passphrase
        val name = suggestedName.trim().ifEmpty { "phlip-server-backup.phlip" }
        main.clientIo.execute {
            try {
                val svc = main.hostService
                if (svc == null || !svc.isRunning()) {
                    main.deliverServerBackupExport(false)
                    return@execute
                }
                val sealed = svc.exportServerBackup(id, k, pass)
                val bytes = sealed.getOrElse {
                    main.deliverServerBackupExport(false)
                    return@execute
                }
                main.pendingServerBackupExportBytes = bytes
                main.runOnUiThread {
                    try {
                        main.createServerBackupLauncher.launch(name)
                    } catch (_: Exception) {
                        main.pendingServerBackupExportBytes = null
                        main.deliverServerBackupExport(false)
                    }
                }
            } catch (_: Exception) {
                main.deliverServerBackupExport(false)
            }
        }
    }

    fun serverBackupSuggestedName(serverId: String, kind: String): String {
        val svc = main.hostService ?: return "phlip-server-backup.phlip"
        return try {
            svc.serverBackupSuggestedName(serverId.trim(), kind.trim())
        } catch (_: Exception) {
            "phlip-server-backup.phlip"
        }
    }

    /** Pick a server `.phlip` file. Result: `window.__ashOnServerBackupPicked(boolean)`. */
    fun importServerBackup() {
        main.runOnUiThread {
            try {
                main.openServerBackupLauncher.launch(
                    arrayOf(
                        "application/octet-stream",
                        "application/json",
                        "text/plain",
                        "*/*",
                    ),
                )
            } catch (_: Exception) {
                main.deliverServerBackupPicked(false)
            }
        }
    }

    /**
     * Unlock the picked server backup. Returns JSON:
     * `{ok,kind,exportedAt,serverId,serverName,channelCount,eventTypeCount,memberCount,eventCount,error?}`.
     */
    fun unlockServerBackup(passphrase: String): String {
        val env = main.pendingServerBackupEnvelope
            ?: return JSONObject().put("ok", false).put("error", "No backup file selected").toString()
        val svc = main.hostService
            ?: return JSONObject().put("ok", false).put("error", "Start hosting first").toString()
        return try {
            val preview = svc.unlockServerBackup(passphrase, env).getOrElse { err ->
                return JSONObject()
                    .put("ok", false)
                    .put("error", err.message ?: "Could not unlock backup")
                    .toString()
            }
            main.pendingServerBackupPayload = preview.payloadJson
            JSONObject()
                .put("ok", true)
                .put("kind", preview.kind)
                .put("exportedAt", preview.exportedAt)
                .put("serverId", preview.serverId)
                .put("serverName", preview.serverName)
                .put("channelCount", preview.channelCount)
                .put("eventTypeCount", preview.eventTypeCount)
                .put("memberCount", preview.memberCount)
                .put("eventCount", preview.eventCount)
                .toString()
        } catch (t: Throwable) {
            JSONObject().put("ok", false).put("error", t.message ?: "Unlock failed").toString()
        }
    }

    /**
     * Apply unlocked structure backup.
     * Empty [targetServerId] + [newServerName] → create new server.
     */
    fun applyServerStructureBackup(
        targetServerId: String,
        newServerName: String,
        hostDisplayName: String,
    ): String {
        val payload = main.pendingServerBackupPayload
            ?: return JSONObject().put("ok", false).put("error", "Unlock a backup first").toString()
        val svc = main.hostService
            ?: return JSONObject().put("ok", false).put("error", "Start hosting first").toString()
        return try {
            val id = svc.applyServerStructureBackup(
                payload,
                targetServerId.trim().ifEmpty { null },
                newServerName.trim().ifEmpty { null },
                hostDisplayName.trim(),
            ).getOrElse { err ->
                return JSONObject()
                    .put("ok", false)
                    .put("error", err.message ?: "Restore failed")
                    .toString()
            }
            main.pendingServerBackupEnvelope = null
            main.pendingServerBackupPayload = null
            JSONObject().put("ok", true).put("serverId", id).toString()
        } catch (t: Throwable) {
            JSONObject().put("ok", false).put("error", t.message ?: "Restore failed").toString()
        }
    }

    /** Same-ID full replace from unlocked payload. */
    fun applyServerFullBackup(): String {
        val payload = main.pendingServerBackupPayload
            ?: return JSONObject().put("ok", false).put("error", "Unlock a backup first").toString()
        val svc = main.hostService
            ?: return JSONObject().put("ok", false).put("error", "Start hosting first").toString()
        return try {
            val id = svc.applyServerFullBackup(payload).getOrElse { err ->
                return JSONObject()
                    .put("ok", false)
                    .put("error", err.message ?: "Restore failed")
                    .toString()
            }
            main.pendingServerBackupEnvelope = null
            main.pendingServerBackupPayload = null
            JSONObject().put("ok", true).put("serverId", id).toString()
        } catch (t: Throwable) {
            JSONObject().put("ok", false).put("error", t.message ?: "Restore failed").toString()
        }
    }
}
