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

// Bump STATIC_CACHE on each deploy to purge the previous build's stale hashed
// chunks: the activate handler below deletes any cache name NOT in its keep-set,
// so an old "sb-static-vN" is dropped wholesale. (Hashed _next/static assets are
// immutable and never expire, so without this bump old builds' chunks accumulate
// in the user's storage forever — a storage leak, not a speed issue.)
// TODO(per-deploy automation): inject NEXT_BUILD_ID into the SW so this bumps
// itself on every build instead of by hand.
const STATIC_CACHE = "sb-static-v2";
const PAGE_CACHE = "sb-pages-v1";

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
