"use client";

/**
 * Update the address bar in place — no server round-trip, no re-render of the
 * route's server components — while keeping the Next.js App Router healthy.
 *
 * The obvious-looking call, `window.history.replaceState(null, "", url)`,
 * DISCARDS the App Router's own history state (`__NA` and
 * `__PRIVATE_NEXTJS_INTERNALS_TREE`). Those markers are how the router
 * reconciles the current tree on the next navigation; once they're gone, a
 * subsequent <Link> tap can silently do nothing and the app looks frozen on
 * the current page until a full reload. That's exactly what "I opened an
 * article and then couldn't switch tabs without refreshing" looks like.
 *
 * Re-passing the *existing* state object preserves those markers regardless of
 * which Next version is in play, so use this everywhere instead of calling
 * history.replaceState directly.
 */
export function replaceUrl(url: string): void {
  if (typeof window === "undefined") return;
  window.history.replaceState(window.history.state, "", url);
}
