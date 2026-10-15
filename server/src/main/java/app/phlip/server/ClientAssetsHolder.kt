package app.phlip.server

import android.annotation.SuppressLint
import app.phlip.core.assets.ClientAssetSource

/**
 * Optional override for the client asset tree (unit tests). When null,
 * [HostService] reads `public/` from the application [android.content.res.AssetManager].
 */
object ClientAssetsHolder {
    @SuppressLint("StaticFieldLeak")
    @Volatile
    private var source: ClientAssetSource? = null

    fun init(source: ClientAssetSource) {
        this.source = source
    }

    fun get(): ClientAssetSource? = source
}
