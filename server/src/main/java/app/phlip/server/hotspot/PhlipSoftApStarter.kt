package app.phlip.server.hotspot

import android.annotation.SuppressLint
import android.net.wifi.SoftApConfiguration
import android.net.wifi.WifiManager
import android.net.wifi.WifiSsid
import android.os.Build
import android.os.Handler
import android.util.Log
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executor

/**
 * Starts LocalOnlyHotspot with a requested `phlip-……` Soft-AP name.
 *
 * Public [WifiManager.startLocalOnlyHotspot] always mints `AndroidShare_…`.
 * Android 13+ exposes a hidden overload that accepts [SoftApConfiguration] when the app
 * holds [android.Manifest.permission.NEARBY_WIFI_DEVICES]. SoftApConfiguration.Builder
 * is @SystemApi, so construction is via reflection.
 *
 * Returns false when custom naming is unsupported or rejected — caller may fall back
 * to the public API (system SSID).
 */
internal object PhlipSoftApStarter {
    private const val TAG = "AshHotspot"

    @Volatile
    var lastError: String? = null
        private set

    fun supportsCustomSsid(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU

    @SuppressLint("MissingPermission")
    fun start(
        wm: WifiManager,
        mainHandler: Handler,
        callback: WifiManager.LocalOnlyHotspotCallback,
        ssid: String,
        passphrase: String,
    ): Boolean {
        lastError = null
        if (!supportsCustomSsid()) {
            lastError = "Custom Soft-AP names need Android 13+"
            Log.i(TAG, lastError!!)
            return false
        }
        if (ssid.isBlank() || passphrase.length < 8) {
            lastError = "Invalid Soft-AP credentials"
            return false
        }
        return try {
            val config = buildSoftApConfig(ssid, passphrase)
                ?: return false.also {
                    if (lastError == null) lastError = "Could not build Soft-AP config"
                }
            val softApClass = SoftApConfiguration::class.java
            val start = resolveStartMethod(softApClass)
                ?: return false.also {
                    lastError = "startLocalOnlyHotspot(SoftApConfiguration) not available"
                    Log.w(TAG, lastError!!)
                }
            val executor = Executor { r -> mainHandler.post(r) }
            start.isAccessible = true
            start.invoke(wm, config, executor, callback)
            Log.i(TAG, "requested Soft-AP ssid=$ssid via ${start.declaringClass.name}")
            true
        } catch (t: Throwable) {
            val root = (t as? java.lang.reflect.InvocationTargetException)?.cause ?: t
            lastError = "${root.javaClass.simpleName}: ${root.message?.take(160)}"
            Log.w(TAG, "phlip Soft-AP start failed — $lastError", root)
            false
        }
    }

    private fun resolveStartMethod(softApClass: Class<*>): java.lang.reflect.Method? {
        val callbackClass = WifiManager.LocalOnlyHotspotCallback::class.java
        val executorClass = Executor::class.java
        val wifiClass = WifiManager::class.java
        try {
            return wifiClass.getDeclaredMethod(
                "startLocalOnlyHotspot",
                softApClass,
                executorClass,
                callbackClass,
            )
        } catch (_: NoSuchMethodException) {
        }
        try {
            return wifiClass.getMethod(
                "startLocalOnlyHotspot",
                softApClass,
                executorClass,
                callbackClass,
            )
        } catch (_: NoSuchMethodException) {
        }
        return wifiClass.declaredMethods.firstOrNull { m ->
            m.name == "startLocalOnlyHotspot" &&
                m.parameterTypes.size == 3 &&
                softApClass.isAssignableFrom(m.parameterTypes[0])
        } ?: wifiClass.methods.firstOrNull { m ->
            m.name == "startLocalOnlyHotspot" &&
                m.parameterTypes.size == 3 &&
                softApClass.isAssignableFrom(m.parameterTypes[0])
        }
    }

    /**
     * Build SoftApConfiguration via hidden Builder. Uses [WifiSsid] when possible
     * (API 33+), falls back to setSsid(String).
     */
    private fun buildSoftApConfig(ssid: String, passphrase: String): SoftApConfiguration? {
        return try {
            val builderClass = Class.forName("android.net.wifi.SoftApConfiguration\$Builder")
            var builder: Any = builderClass.getDeclaredConstructor().newInstance()

            builder = applySsid(builderClass, builder, ssid) ?: return null

            val wpa2 = SoftApConfiguration.SECURITY_TYPE_WPA2_PSK
            builder = invokeReturning(
                builderClass,
                builder,
                "setPassphrase",
                arrayOf(String::class.java, Int::class.javaPrimitiveType),
                passphrase,
                wpa2,
            ) ?: return null.also { lastError = "setPassphrase failed" }

            // Prefer 2.4 GHz for phone-to-phone Soft-AP compatibility (BAND_2GHZ = 1).
            try {
                builder = invokeReturning(
                    builderClass,
                    builder,
                    "setBand",
                    arrayOf(Int::class.javaPrimitiveType),
                    1,
                ) ?: builder
            } catch (_: Throwable) {
            }

            val built = builderClass.getMethod("build").invoke(builder)
            built as? SoftApConfiguration
        } catch (t: Throwable) {
            val root = (t as? java.lang.reflect.InvocationTargetException)?.cause ?: t
            lastError = "Builder: ${root.javaClass.simpleName}: ${root.message?.take(120)}"
            Log.w(TAG, "SoftApConfiguration build failed", root)
            null
        }
    }

    private fun applySsid(builderClass: Class<*>, builder: Any, ssid: String): Any? {
        // Preferred on modern platforms.
        try {
            val wifiSsid = WifiSsid.fromBytes(ssid.toByteArray(StandardCharsets.UTF_8))
            val next = invokeReturning(
                builderClass,
                builder,
                "setWifiSsid",
                arrayOf(WifiSsid::class.java),
                wifiSsid,
            )
            if (next != null) {
                Log.i(TAG, "Soft-AP setWifiSsid($ssid)")
                return next
            }
        } catch (t: Throwable) {
            Log.i(TAG, "setWifiSsid unavailable (${t.javaClass.simpleName}); trying setSsid")
        }
        return try {
            val next = invokeReturning(
                builderClass,
                builder,
                "setSsid",
                arrayOf(String::class.java),
                ssid,
            )
            if (next != null) {
                Log.i(TAG, "Soft-AP setSsid($ssid)")
                next
            } else {
                lastError = "Neither setWifiSsid nor setSsid worked"
                null
            }
        } catch (t: Throwable) {
            val root = (t as? java.lang.reflect.InvocationTargetException)?.cause ?: t
            lastError = "setSsid: ${root.javaClass.simpleName}: ${root.message?.take(120)}"
            null
        }
    }

    private fun invokeReturning(
        builderClass: Class<*>,
        builder: Any,
        name: String,
        types: Array<Class<*>?>,
        vararg args: Any?,
    ): Any? {
        val method = try {
            builderClass.getMethod(name, *types)
        } catch (_: NoSuchMethodException) {
            builderClass.getDeclaredMethod(name, *types).also { it.isAccessible = true }
        }
        val result = method.invoke(builder, *args)
        // Builder setters return this (or a copy) — prefer the return value.
        return result ?: builder
    }
}
