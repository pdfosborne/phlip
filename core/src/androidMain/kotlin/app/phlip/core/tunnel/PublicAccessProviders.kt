package app.phlip.core.tunnel

import android.content.Context
import java.util.ServiceLoader

/** SPI — implemented in `:tunnel`, resolved via [PublicAccessProviders]. */
interface PublicAccessProviderFactory {
    fun create(context: Context, listener: PublicAccessListener): PublicAccessProvider
}

object PublicAccessProviders {
    fun create(context: Context, listener: PublicAccessListener): PublicAccessProvider? =
        runCatching {
            ServiceLoader.load(
                PublicAccessProviderFactory::class.java,
                PublicAccessProviderFactory::class.java.classLoader,
            ).firstOrNull()?.create(context.applicationContext, listener)
        }.getOrNull()

    val isAvailable: Boolean
        get() = runCatching {
            ServiceLoader.load(
                PublicAccessProviderFactory::class.java,
                PublicAccessProviderFactory::class.java.classLoader,
            ).iterator().hasNext()
        }.getOrDefault(false)
}
