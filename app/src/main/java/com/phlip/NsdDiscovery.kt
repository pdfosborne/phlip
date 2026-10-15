package com.phlip

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import app.phlip.server.HostService
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/**
 * LAN NSD browse for join modal + joined-member refresh.
 * Permission prompts and WebView pushes stay with the host Activity via [Callbacks].
 */
class NsdDiscovery(
    context: Context,
    private val callbacks: Callbacks,
) {
    interface Callbacks {
        fun runOnUiThread(block: () -> Unit)
        fun executeIo(block: () -> Unit)
        fun hasNearbyPermission(): Boolean
        fun requestNearbyPermission()
        fun clientTrustLabel(): String
        fun probeNearbyOnDirectWifi(): List<JSONObject>
        fun unbindDiscoveryNetwork()
        fun pushDiscoveredJson(arr: JSONArray)
    }

    private enum class DiscoveryMode { NONE, JOIN, MEMBER }

    private val nsdManager: NsdManager by lazy {
        context.applicationContext.getSystemService(Context.NSD_SERVICE) as NsdManager
    }
    private var discoveryMode = DiscoveryMode.NONE
    private var discoveryListener: NsdManager.DiscoveryListener? = null
    private val discovered = ConcurrentHashMap<String, JSONObject>()
    private val memberResolved = ConcurrentHashMap<String, JSONObject>()

    fun startDiscovery() {
        if (!callbacks.hasNearbyPermission()) {
            callbacks.requestNearbyPermission()
            return
        }
        callbacks.runOnUiThread { ensureDiscovery(DiscoveryMode.JOIN) }
        callbacks.executeIo {
            val extra = try {
                callbacks.probeNearbyOnDirectWifi()
            } catch (_: Exception) {
                emptyList()
            }
            if (extra.isEmpty()) return@executeIo
            callbacks.runOnUiThread {
                if (discoveryMode != DiscoveryMode.JOIN) return@runOnUiThread
                for (o in extra) {
                    val key = o.optString("id").ifEmpty { o.optString("shareLan") }
                    discovered[key] = o
                }
                pushDiscovered()
            }
        }
    }

    fun startMemberDiscovery() {
        if (!callbacks.hasNearbyPermission()) return
        if (callbacks.clientTrustLabel() != "trusted") return
        callbacks.runOnUiThread { ensureDiscovery(DiscoveryMode.MEMBER) }
    }

    fun stopMemberDiscovery() {
        callbacks.runOnUiThread {
            if (discoveryMode == DiscoveryMode.MEMBER) stopDiscoveryInternal()
        }
    }

    fun stopDiscovery() {
        callbacks.runOnUiThread {
            if (discoveryMode == DiscoveryMode.JOIN) {
                discoveryMode =
                    if (callbacks.clientTrustLabel() == "trusted") DiscoveryMode.MEMBER
                    else DiscoveryMode.NONE
                discovered.clear()
                if (discoveryMode == DiscoveryMode.MEMBER) return@runOnUiThread
            }
            stopDiscoveryInternal()
            try {
                callbacks.unbindDiscoveryNetwork()
            } catch (_: Exception) {
            }
        }
    }

    /** Resume JOIN browse after nearby permission is granted. */
    fun onNearbyPermissionGranted() {
        callbacks.runOnUiThread { ensureDiscovery(DiscoveryMode.JOIN) }
    }

    fun resolveJoinTagBlocking(joinTag: String, timeoutMs: Int): String {
        val tag = joinTag.trim().uppercase().take(4)
        if (tag.isEmpty()) return JSONObject().put("ok", false).toString()
        memberResolved[tag]?.let { return memberResolveJson(tag, it) }
        if (callbacks.clientTrustLabel() != "trusted") return JSONObject().put("ok", false).toString()
        val deadline = System.currentTimeMillis() + timeoutMs.coerceIn(200, 3000)
        val latch = java.util.concurrent.CountDownLatch(1)
        callbacks.runOnUiThread {
            startMemberDiscovery()
            latch.countDown()
        }
        try {
            latch.await(200, java.util.concurrent.TimeUnit.MILLISECONDS)
        } catch (_: Exception) {
        }
        while (System.currentTimeMillis() < deadline) {
            memberResolved[tag]?.let { return memberResolveJson(tag, it) }
            try {
                Thread.sleep(50)
            } catch (_: Exception) {
                break
            }
        }
        return JSONObject().put("ok", false).toString()
    }

    fun pushDiscovered() {
        val arr = JSONArray()
        val seen = HashSet<String>()
        for (o in discovered.values) {
            val key = o.optString("shareLan").ifEmpty { o.optString("url") }.lowercase()
            if (key.isNotEmpty() && !seen.add(key)) continue
            arr.put(o)
        }
        callbacks.runOnUiThread { callbacks.pushDiscoveredJson(arr) }
    }

    private fun ensureDiscovery(mode: DiscoveryMode) {
        if (discoveryListener != null) {
            if (mode == DiscoveryMode.JOIN) discoveryMode = DiscoveryMode.JOIN
            return
        }
        discoveryMode = mode
        beginDiscovery()
    }

    private fun beginDiscovery() {
        if (discoveryListener != null) return
        if (discoveryMode == DiscoveryMode.NONE) return
        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(regType: String) {
                android.util.Log.d("AshNsd", "discovery started $regType")
            }

            override fun onServiceFound(service: NsdServiceInfo) {
                android.util.Log.d("AshNsd", "found ${service.serviceName} type=${service.serviceType}")
                if (!isAshNsdServiceType(service.serviceType)) return
                resolve(service)
            }

            override fun onServiceLost(service: NsdServiceInfo) {
                discovered.remove(service.serviceName)
                val sid = service.attributes?.get("sid")?.toString(Charsets.UTF_8)?.trim()?.uppercase()
                if (!sid.isNullOrEmpty()) memberResolved.remove(sid)
                if (discoveryMode == DiscoveryMode.JOIN) pushDiscovered()
            }

            override fun onDiscoveryStopped(regType: String) {}
            override fun onStartDiscoveryFailed(regType: String, errorCode: Int) {
                android.util.Log.d("AshNsd", "discovery start FAILED $errorCode")
                discoveryListener = null
                discoveryMode = DiscoveryMode.NONE
            }

            override fun onStopDiscoveryFailed(regType: String, errorCode: Int) {
                discoveryListener = null
                discoveryMode = DiscoveryMode.NONE
            }
        }
        try {
            nsdManager.discoverServices(HostService.NSD_SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
            discoveryListener = listener
        } catch (_: Exception) {
            discoveryMode = DiscoveryMode.NONE
        }
    }

    private fun stopDiscoveryInternal() {
        discoveryListener?.let { try { nsdManager.stopServiceDiscovery(it) } catch (_: Exception) {} }
        discoveryListener = null
        discoveryMode = DiscoveryMode.NONE
        discovered.clear()
    }

    private fun serviceToJson(si: NsdServiceInfo): JSONObject? {
        val host = si.host?.hostAddress ?: return null
        fun attr(k: String) = si.attributes?.get(k)?.toString(Charsets.UTF_8) ?: ""
        return JSONObject()
            .put("id", attr("id").ifEmpty { si.serviceName })
            .put("sid", attr("sid"))
            .put("name", attr("name").ifEmpty { si.serviceName })
            .put("url", "ws://$host:${si.port}/ws")
            .put("shareLan", "http://$host:${si.port}")
            .put("code", attr("code"))
            .put("slug", attr("slug"))
            .put("pass", attr("pass"))
    }

    private fun resolve(service: NsdServiceInfo) {
        try {
            nsdManager.resolveService(service, object : NsdManager.ResolveListener {
                override fun onResolveFailed(si: NsdServiceInfo, errorCode: Int) {
                    android.util.Log.d("AshNsd", "resolve FAILED $errorCode")
                }

                override fun onServiceResolved(si: NsdServiceInfo) {
                    val obj = serviceToJson(si) ?: return
                    val sid = obj.optString("sid").trim().uppercase()
                    if (sid.isNotEmpty()) memberResolved[sid] = obj
                    if (discoveryMode == DiscoveryMode.JOIN) {
                        discovered[si.serviceName] = obj
                        pushDiscovered()
                    }
                }
            })
        } catch (_: Exception) {
        }
    }

    private fun memberResolveJson(tag: String, obj: JSONObject): String =
        JSONObject()
            .put("ok", true)
            .put("sid", tag)
            .put("url", obj.optString("url"))
            .put("shareLan", obj.optString("shareLan"))
            .toString()

    companion object {
        fun isAshNsdServiceType(serviceType: String?): Boolean {
            val t = (serviceType ?: "").trim().trimStart('.').lowercase()
            return t.startsWith("_ash._tcp")
        }
    }
}
