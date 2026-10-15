// Apply the saved (or system) theme before first paint to avoid a flash.
// Kept as an external file so served pages can use a strict script-src CSP.

/** demo.phlipapp.com, /demo/, or ?demo=1 — never treat as a host-served join page. */
function isDemoMode() {
  try {
    if (document.documentElement && document.documentElement.dataset.demoMode === "1") return true;
  } catch (e) {}
  try {
    if (location.hostname === "appassets.androidplatform.net" || location.protocol === "file:") return false;
    if (location.hostname === "demo.phlipapp.com") return true;
    var path = location.pathname || "";
    if (path === "/demo" || path.indexOf("/demo/") === 0) return true;
    return new URLSearchParams(location.search || "").get("demo") === "1";
  } catch (e) {
    return false;
  }
}

(function () {
  try {
    var demo = typeof isDemoMode === "function" && isDemoMode();
    if (demo) {
      document.documentElement.dataset.demoMode = "1";
      document.documentElement.classList.add("demo-mode");
    }
    // Host public/LAN page (not the Android app WebView, not the local demo).
    if (!demo && location.hostname !== "appassets.androidplatform.net" && location.protocol !== "file:") {
      document.documentElement.dataset.servedHost = "1";
      document.documentElement.classList.add("served-host");
    }
    var served = document.documentElement.dataset.servedHost === "1";
    var t = "light";
    try { localStorage.setItem("dp_theme", t); } catch {}
    document.documentElement.dataset.theme = t;
    var mtc = document.querySelector('meta[name="theme-color"]');
    if (mtc) mtc.setAttribute("content", "#ffffff");
    document.documentElement.dataset.packTheme = "sky";
    var cardType = localStorage.getItem("ash_card_type");
    if (cardType && cardType !== "simple") document.documentElement.dataset.cardType = cardType;
    // Pin shell height to the visual viewport (keyboard, dynamic bars, status
    // bar insets) wherever it's available — served browser, iOS standalone,
    // *and* the packaged app WebViews, which the static dvh/svh CSS fallback
    // alone doesn't always match on-device.
    if (window.visualViewport) {
      var syncAppHeight = function () {
        var h = window.visualViewport.height;
        if (h > 0) document.documentElement.style.setProperty("--app-height", h + "px");
      };
      window.visualViewport.addEventListener("resize", syncAppHeight);
      window.visualViewport.addEventListener("scroll", syncAppHeight);
      syncAppHeight();
    }
  } catch (e) {}
})();
