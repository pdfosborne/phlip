package com.phlip.backup

import com.phlip.MainActivity

/**
 * Tier 1 personal backup export/import. The SAF launchers stay registered on
 * [MainActivity] (registration must happen before onStart), so this only stages
 * the pending body and drives them.
 */
class PersonalBackupBridge(
    private val main: MainActivity,
) {
    /** Write passphrase envelope via SAF CreateDocument. Result: `window.__ashOnBackupExport(boolean)`. */
    fun exportPersonalBackup(body: String, suggestedName: String) {
        main.runOnUiThread {
            try {
                main.pendingBackupExportBody = body
                val name = suggestedName.trim().ifEmpty {
                    "phlip-backup.phlip"
                }
                main.createBackupLauncher.launch(name)
            } catch (_: Exception) {
                main.pendingBackupExportBody = null
                main.deliverBackupExport(false)
            }
        }
    }

    /** Pick a `.phlip` file via SAF. Result: `window.__ashOnBackupImport(string|null)`. */
    fun importPersonalBackup() {
        main.runOnUiThread {
            try {
                main.openBackupLauncher.launch(arrayOf(
                    "application/octet-stream",
                    "application/json",
                    "text/plain",
                    "*/*",
                ))
            } catch (_: Exception) {
                main.deliverBackupImport(null)
            }
        }
    }
}
