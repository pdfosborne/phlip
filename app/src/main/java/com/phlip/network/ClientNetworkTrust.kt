package com.phlip.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import app.phlip.server.local.ApprovedNetworks
import org.json.JSONObject

/** Client-side LAN path eligibility (dual-path connectivity for joined members):
 *  watches the default network and keeps the page's trust label — and member
 *  discovery — in step with it. */
class ClientNetworkTrust(
    private val context: Context,
    private val networks: ApprovedNetworks,
    private val isAlive: () -> Boolean,
    private val setMemberDiscovery: (enabled: Boolean) -> Unit,
    private val postCoalescedWebUpdate: (key: String, js: String) -> Unit,
) {
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    @Volatile private var lastPostedTrust: String? = null

    fun trustLabel(): String =
        when (val ev = networks.evaluate(context)) {
            is ApprovedNetworks.Evaluation.CellularExempt -> "cellular"
            is ApprovedNetworks.Evaluation.HotspotTrusted -> "trusted"
            is ApprovedNetworks.Evaluation.Known -> when (ev.record.trust) {
                ApprovedNetworks.Trust.TRUSTED -> "trusted"
                ApprovedNetworks.Trust.ONCE -> "once"
            }
            else -> "unknown"
        }

    fun register() {
        if (networkCallback != null) return
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = push()
            override fun onLost(network: Network) = push()
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = push()
            override fun onLinkPropertiesChanged(network: Network, props: LinkProperties) = push()
        }
        networkCallback = cb
        try {
            cm.registerDefaultNetworkCallback(cb)
        } catch (_: Exception) {
            try {
                cm.registerNetworkCallback(
                    NetworkRequest.Builder()
                        .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                        .build(),
                    cb,
                )
            } catch (_: Exception) {
                networkCallback = null
            }
        }
    }

    fun push() {
        if (!isAlive()) {
            lastPostedTrust = null
            return
        }
        val trust = trustLabel()
        setMemberDiscovery(trust == "trusted")
        if (trust == lastPostedTrust) return
        lastPostedTrust = trust
        postCoalescedWebUpdate(
            "network-trust",
            "window.ashNetworkChanged && window.ashNetworkChanged(${JSONObject().put("trust", trust)})",
        )
    }
}
