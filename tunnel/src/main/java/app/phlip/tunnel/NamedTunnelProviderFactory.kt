package app.phlip.tunnel

import android.content.Context
import app.phlip.core.tunnel.PublicAccessListener
import app.phlip.core.tunnel.PublicAccessProvider
import app.phlip.core.tunnel.PublicAccessProviderFactory

class NamedTunnelProviderFactory : PublicAccessProviderFactory {
    override fun create(context: Context, listener: PublicAccessListener): PublicAccessProvider =
        NamedTunnelProvider(context, listener)
}
