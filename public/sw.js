/* Second Brain service worker.
 *
 * Goals (deliberately minimal):
 *  1. Installable PWA (manifest + SW = install prompt on mobile).
 *  2. Instant repeat loads: immutable Next static assets are cache-first.
 *  3. Offline study: navigations are network-first with a cached fallback, so
 *     a previously visited page (e.g. /study) still opens offline — the review
 *     UI then serves cards from its last render and queues grades locally.
 *
 * NOT cached: API routes, server actions, auth — anything dynamic goes to the
 * network untouched (and fails offline, where the UI has its own fallbacks).
 */

// Cache names carry the Next build id, stamped by scripts/inject-sw-buildid.mjs
// (npm postbuild + electron/build.js). Every deploy therefore gets fresh cache
// names and the activate handler below drops the previous build's caches —
// hashed _next/static assets are immutable and would otherwise accumulate in
// the user's storage forever. Do not hand-edit the version suffixes.
const STATIC_CACHE = "sb-static-ae54LitY2bEEse2ctxNZa";
const PAGE_CACHE = "sb-pages-ae54LitY2bEEse2ctxNZa";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(STATIC_CACHE));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, PAGE_CACHE]);
      for (const key of await caches.keys()) {
        if (!keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept data/API traffic — correctness over offline coverage.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/") ||
    url.searchParams.has("_rsc") // RSC payload fetches — let the router handle them
  ) {
    return;
  }

  // Hashed build assets + icons: immutable, cache-first.
  if (url.pathname.startsWith("/_next/static/") || /\.(png|ico|svg|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res.ok) {
          const cache = await caches.open(STATIC_CACHE);
          cache.put(req, res.clone());
        }
        return res;
      })(),
    );
    return;
  }

  // Page navigations: network-first (always fresh online), cached copy of the
  // same page — else the app root — when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok) {
            const cache = await caches.open(PAGE_CACHE);
            cache.put(req, res.clone());
          }
          return res;
        } catch {
          const cached = await caches.match(req);
          return cached ?? (await caches.match("/")) ?? Response.error();
        }
      })(),
    );
  }
});
