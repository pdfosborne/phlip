package com.phlip

/**
 * Shared copy for pending join-request dialogs shown by MainActivity and SettingsActivity.
 */
internal object PendingJoinMessages {
    fun format(serverName: String, joinerName: String, invitedByName: String?): String {
        val via = invitedByName?.trim()?.takeIf { it.isNotEmpty() }
        return buildString {
            append("$joinerName wants to join “$serverName”.")
            if (via != null) append("\nRequested via $via.")
            append("\n\nApprove to let them in.")
        }
    }
}
