package app.phlip.core.assets

import android.content.res.AssetManager
import java.io.InputStream

/** [ClientAssetSource] backed by an Android [AssetManager] (app or test). */
class AssetManagerClientAssetSource(
    private val assets: AssetManager,
) : ClientAssetSource {
    override fun open(path: String): InputStream? =
        try {
            assets.open(path.trimStart('/'))
        } catch (_: Exception) {
            null
        }

    override fun exists(path: String): Boolean =
        try {
            assets.open(path.trimStart('/')).close()
            true
        } catch (_: Exception) {
            false
        }
}
