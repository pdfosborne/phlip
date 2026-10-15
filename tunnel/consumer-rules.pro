# Keep ServiceLoader tunnel implementation
-keep class app.phlip.tunnel.CloudflaredController { <init>(); }
-keep class app.phlip.tunnel.NamedTunnelProviderFactory { <init>(); }
-keepnames class app.phlip.core.tunnel.TunnelController
-keepnames class app.phlip.core.tunnel.PublicAccessProviderFactory
