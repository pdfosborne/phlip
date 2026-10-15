package app.phlip.core.assets

import java.io.InputStream

/**
 * Proprietary client (and host-edge) assets live in `:app`. Open `:server`
 * must not own them — inject a source when constructing the local HTTP server.
 *
 * Android / JVM only (InputStream). Not in commonMain.
 */
interface ClientAssetSource {
    /** Open an asset under the client tree (e.g. `public/index.html` or `edge/…`). */
    fun open(path: String): InputStream?

    fun exists(path: String): Boolean
}
