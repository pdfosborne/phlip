package app.phlip.server.hosting

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import app.phlip.server.HostService
import app.phlip.server.HostUiIntents
import app.phlip.server.HostingConsent
import app.phlip.server.PendingInfo
import app.phlip.server.ServerRegistry
import app.phlip.server.local.ApprovedNetworks
import app.phlip.server.local.LocalHostingCoordinator
import java.util.concurrent.ConcurrentHashMap

/** Notification channels + status / network-pause notification builders. */
internal class HostNotifications(
    private val context: Context,
    private val registry: ServerRegistry,
    private val pendingByServer: ConcurrentHashMap<String, List<PendingInfo>>,
    private val localHosting: LocalHostingCoordinator,
    private val isLiveBusy: () -> Boolean,
    private val serverCount: () -> Int,
) {
    val channelId = "phlip_host"
    val channelNetworkId = "phlip_host_network"
    val notifId = 1
    val notifNetworkId = 2

    fun createNotificationChannel() {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(channelId, "Host status", NotificationManager.IMPORTANCE_LOW)
                .apply { description = "Shows while Phlip is running as host" },
        )
        nm.createNotificationChannel(
            NotificationChannel(
                channelNetworkId,
                "Hosting network approval",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "Prompts when hosting pauses on a new network"
                enableVibration(true)
            },
        )
    }

    fun buildNotification(): Notification {
        val n = serverCount()
        val pending = pendingByServer.values.flatten()
        if (localHosting.isNetworkSuspended()) {
            val pending = localHosting.hasPendingNetwork()
            val busy = pending && isLiveBusy()
            val open = PendingIntent.getActivity(
                context,
                0,
                HostUiIntents.openHostSettings(context),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            return NotificationCompat.Builder(context, channelId)
                .setContentTitle(
                    if (pending) HostingConsent.NETWORK_PAUSE_TITLE
                    else HostingConsent.NETWORK_OFFLINE_TITLE,
                )
                .setContentText(
                    when {
                        !pending -> HostingConsent.NETWORK_OFFLINE_TEXT
                        busy -> HostingConsent.NETWORK_PAUSE_BUSY_TEXT
                        else -> HostingConsent.NETWORK_PAUSE_TEXT
                    },
                )
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(open)
                .build()
        }
        if (pending.isNotEmpty()) {
            val names = pending.mapNotNull { it.name.trim().takeIf(String::isNotEmpty) }.distinct()
            val waitingText = if (names.isNotEmpty()) {
                names.joinToString(", ")
            } else {
                "${pending.size} join request${if (pending.size == 1) "" else "s"} waiting"
            }
            val settingsIntent = PendingIntent.getActivity(
                context,
                0,
                HostUiIntents.openHostSettings(context),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            return NotificationCompat.Builder(context, channelId)
                .setContentTitle("Someone wants to join")
                .setContentText("$waitingText — open Phlip to Approve")
                .setSmallIcon(android.R.drawable.ic_menu_share)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(settingsIntent)
                .setAutoCancel(false)
                .build()
        }
        val pubCount = registry.publicServers().size
        val onlyDevice = n > 0 && pubCount == 0 && registry.all().all { it.isDeviceOnly() }
        val trustHint = when {
            localHosting.isCellularExempt() -> "cellular"
            localHosting.currentTrust() == ApprovedNetworks.Trust.TRUSTED -> "trusted LAN"
            localHosting.currentTrust() == ApprovedNetworks.Trust.ONCE -> "approved once"
            else -> "local"
        }
        val title = if (onlyDevice) "Servers on this device only" else "Phlip is hosting"
        val text = when {
            n == 0 -> "Hosting on — no servers yet"
            onlyDevice -> "$n server(s) · only this phone"
            pubCount > 0 -> "$n server(s) · $pubCount public · $trustHint"
            else -> "$n server(s) · $trustHint"
        }
        return NotificationCompat.Builder(context, channelId)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_share)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
    }

    fun showNetworkSuspendNotification() {
        if (!localHosting.hasPendingNetwork()) {
            notifyStatus()
            return
        }
        val busy = isLiveBusy()
        val text = if (busy) HostingConsent.NETWORK_PAUSE_BUSY_TEXT else HostingConsent.NETWORK_PAUSE_TEXT
        val open = PendingIntent.getActivity(
            context,
            10,
            HostUiIntents.openHostSettings(context),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val once = PendingIntent.getService(
            context,
            11,
            Intent(context, HostService::class.java).setAction(HostService.ACTION_APPROVE_ONCE),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val trust = PendingIntent.getService(
            context,
            12,
            Intent(context, HostService::class.java).setAction(HostService.ACTION_ALWAYS_TRUST),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notif = NotificationCompat.Builder(context, channelNetworkId)
            .setContentTitle(HostingConsent.NETWORK_PAUSE_TITLE)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setOngoing(true)
            .setOnlyAlertOnce(!busy)
            .setContentIntent(open)
            .addAction(0, HostingConsent.NETWORK_APPROVE_ONCE, once)
            .addAction(0, HostingConsent.NETWORK_ALWAYS_TRUST, trust)
            .addAction(0, "Open", open)
            .build()
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.notify(notifNetworkId, notif)
        nm.notify(notifId, buildNotification())
    }

    fun clearNetworkSuspendNotification() {
        context.getSystemService(NotificationManager::class.java).cancel(notifNetworkId)
    }

    fun notifyStatus(notification: Notification = buildNotification()) {
        context.getSystemService(NotificationManager::class.java).notify(notifId, notification)
    }
}
