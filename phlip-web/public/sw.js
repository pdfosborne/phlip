/* Phlip service worker â€” network-first shell caching for the installable PWA.
 *
 * Always tries the host first, so a stale cached bundle can never mask a host
 * update; the cache is only an offline fallback. Never intercepts live host
 * traffic: WebSocket upgrades (/ws) and dynamic endpoints (/ash-*) are ignored,
 * and only same-origin GETs are handled.
 *
 * Bump CACHE whenever the cached shell set changes so old caches are purged.
 */
const SHELL_VER = "20261015v7";
const SCOPE_IS_DEMO = (() => {
  try {
    const u = new URL(self.registration.scope);
    return u.hostname === "demo.phlipapp.com" || u.pathname.indexOf("/demo") !== -1;
  } catch {
    return false;
  }
})();
const CACHE = (SCOPE_IS_DEMO ? "phlip-demo-shell-" : "phlip-shell-") + SHELL_VER;
const CACHE_FAMILY = SCOPE_IS_DEMO ? "phlip-demo-shell-" : "phlip-shell-";
const SHELL = [
  "./",
  "./index.html",
  "./theme-boot.js",
  "./register-sw.js",
  "./scripts/boot/crypto-lite.js",
  "./scripts/boot/legal-docs.js",
  "./scripts/boot/core.js",
  "./scripts/boot/ash-gesture.js",
  "./scripts/boot/storage.js",
  "./scripts/vendor/dexie-4.4.5.min.js",
  "./scripts/vendor/DEXIE-LICENSE.txt",
  "./scripts/demo/demo-mode.js",
  "./scripts/boot/local-sync-store.js",
  "./scripts/demo/demo-store.js",
  "./scripts/boot/dom-events.js",
  "./scripts/boot/ui-confirm.js",
  "./scripts/boot/perf.js",
  "./scripts/boot/feel.js",
  "./scripts/boot/ash-feedback.js",
  "./scripts/boot/crypto.js",
  "./scripts/net/net-part1.js",
  "./scripts/net/net-part2.js",
  "./scripts/net/net-part3.js",
  "./scripts/net/pathselect.js",
  "./scripts/handlers/handlers-clone.js",
  "./scripts/handlers/handlers-dispatch.js",
  "./scripts/personal/personal.js",
  "./scripts/personal/personal-space.js",
  "./scripts/demo/demo-fixture.js",
  "./scripts/demo/demo-boot.js",
  "./scripts/personal/backup.js",
  "./scripts/helpers/icons-lucide-pack.js",
  "./scripts/helpers/icons-phosphor-sports-pack.js",
  "./scripts/helpers/icons-phosphor-objects-pack.js",
  "./scripts/helpers/helpers-part1.js",
  "./scripts/helpers/helpers-part2.js",
  "./scripts/helpers/helpers-part3.js",
  "./scripts/helpers/helpers-part4.js",
  "./scripts/shell/modal.js",
  "./scripts/shell/nav.js",
  "./scripts/shell/chatScope.js",
  "./scripts/shell/served.js",
  "./scripts/render/render-core.js",
  "./scripts/render/render-rail.js",
  "./scripts/render/render-side-overlay.js",
  "./scripts/render/render-share.js",
  "./scripts/render/render-host-console.js",
  "./scripts/render/render-help.js",
  "./scripts/render/render-sidebar.js",
  "./scripts/render/sidebar-menus.js",
  "./scripts/render/render-sidebar-reorder.js",
  "./scripts/render/render-backup.js",
  "./scripts/render/render-user-settings.js",
  "./scripts/render/user-profile-overlay.js",
  "./scripts/render/render-join-parse.js",
  "./scripts/render/render-join-modal.js",
  "./scripts/render/render-add-server.js",
  "./scripts/render/render-join-leave.js",
  "./scripts/render/render-deck-icons.js",
  "./scripts/render/render-deck-editor-body.js",
  "./scripts/render/render-roles.js",
  "./scripts/render/render-locations.js",
  "./scripts/channel/channel-access.js",
  "./scripts/channel/channel-linked-feeds.js",
  "./scripts/channel/channel-form-components.js",
  "./scripts/channel/channel-invites.js",
  "./scripts/channel/channel-panel-state.js",
  "./scripts/channel/channel-panel.js",
  "./scripts/channel/channel-panel-calendar.js",
  "./scripts/channel/channel-panel-actions.js",
  "./scripts/channel/channel-panel-gestures.js",
  "./scripts/channel/channel-settings.js",
  "./scripts/channel/board-settings-sheet.js",
  "./scripts/channel/channel-moderation.js",
  "./scripts/channel/channel-shell.js",
  "./scripts/channel/channel-view.js",
  "./scripts/channel/channel-console.js",
  "./scripts/channel/channel-members.js",
  "./scripts/channel/channel-history.js",
  "./scripts/channel/channel-agenda.js",
  "./scripts/channel/channel-events-board.js",
  "./scripts/channel/channel-ticket-cards.js",
  "./scripts/channel/channel-timeline-view.js",
  "./scripts/channel/channel-timeline-settings.js",
  "./scripts/channel/channel-timeline-cards.js",
  "./scripts/channel/channel-chains.js",
  "./scripts/channel/channel-suggestions.js",
  "./scripts/channel/channel-chat-part1.js",
  "./scripts/channel/channel-chat-part2.js",
  "./scripts/channel/channel-chat-part3.js",
  "./scripts/channel/channel-chat-part4.js",
  "./scripts/channel/channel-board-nav.js",
  "./scripts/channel/channel-event-panel.js",
  "./scripts/channel/board-model.js",
  "./scripts/channel/board-card.js",
  "./scripts/channel/board-feed.js",
  "./scripts/channel/board-pages.js",
  "./scripts/channel/board-continue.js",
  "./scripts/channel/board-composer.js",
  "./scripts/channel/board-from-chat.js",
  "./scripts/channel/board-home.js",
  "./scripts/channel/board-select.js",
  "./scripts/channel/board-drag.js",
  "./scripts/channel/board-event-nav.js",
  "./scripts/channel/board-destination.js",
  "./scripts/helpers/event-short-name.js",
  "./scripts/shell/panel.js",
  "./scripts/host/host-settings-part1.js",
  "./scripts/host/host-settings-part2.js",
  "./scripts/host/host-settings-part3.js",
  "./scripts/host/hotspot-join-part1.js",
  "./scripts/host/hotspot-join-part2.js",
  "./scripts/host/hosting-guide.js",
  "./scripts/host/sharing-checks.js",
  "./scripts/host/sharing-settings.js",
  "./scripts/pitch/pitch-part4.js",
  "./scripts/pitch/event-card-styles.js",
  "./scripts/share/event-ics.js",
  "./scripts/hand/hand-storage.js",
  "./scripts/hand/hand-categories.js",
  "./scripts/hand/hand-cards.js",
  "./scripts/hand/hand-typed-backlog.js",
  "./scripts/hand/hand-locations.js",
  "./scripts/hand/hand-availability.js",
  "./scripts/hand/hand-time-blocks.js",
  "./scripts/hand/hand-agenda-week.js",
  "./scripts/hand/hand-create-entry.js",
  "./scripts/hand/hand-create-swipe-model.js",
  "./scripts/hand/hand-create-time.js",
  "./scripts/hand/hand-plan-parse.js",
  "./scripts/hand/hand-create-draft.js",
  "./scripts/hand/hand-create-suggest.js",
  "./scripts/hand/hand-create-quick.js",
  "./scripts/hand/hand-core.js",
  "./scripts/hand/hand-reactions.js",
  "./scripts/hand/hand-share.js",
  "./scripts/hand/hand-apply.js",
  "./scripts/late/splash.js",
  "./scripts/late/onboarding.js",
  "./scripts/personal/device-calendar.js",
  "./scripts/shell/ash-back.js",
  "./scripts/late/wireboot.js",
  "./style.css",
  "./styles/00-foundation.css",
  "./styles/10-forms.css",
  "./styles/20-app-shell.css",
  "./styles/21-demo.css",
  "./styles/30-main-events.css",
  "./styles/35-timeline-view.css",
  "./styles/36-create-draft.css",
  "./styles/38-conversations.css",
  "./styles/40-cards-deck.css",
  "./styles/50-event-detail.css",
  "./styles/70-admin-settings.css",
  "./fonts/AtkinsonHyperlegible-Regular.woff2",
  "./fonts/AtkinsonHyperlegible-Bold.woff2",
  "./fonts/OFL.txt",
  "./sounds/card-play.mp3",
  "./app-logo.png",
  "./app-logo-text.png",
  "./images/event-card-default-art.svg",
  "./favicon.ico",
  "./icons/favicon-16.png",
  "./icons/favicon-32.png",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith(CACHE_FAMILY) && k !== CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;         // leave cross-origin alone
  if (url.pathname.startsWith("/ws") || url.pathname.startsWith("/ash-")) return; // live host traffic
  e.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok && fresh.type === "basic") {
        const copy = fresh.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return fresh;
    } catch (err) {
      // Shell entries are cached without their HTML `?v=` cache-busters.
      // Ignore search only on a network failure, never for the network-first path.
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      if (req.mode === "navigate") {
        const shell = await caches.match("./index.html");
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
