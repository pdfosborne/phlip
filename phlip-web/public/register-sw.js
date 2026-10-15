// Register the PWA service worker for real browsers (iOS Safari / desktop).
// Skip inside the Android app WebView (window.AshNative present) so the locally
// loaded client is never intercepted. Needs a secure origin (the host's HTTPS
// tunnel URL); silently no-ops on plain-http LAN.
if ("serviceWorker" in navigator && !window.AshNative && window.isSecureContext) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  });
}
