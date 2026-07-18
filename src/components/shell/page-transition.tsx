"use client";

import { usePathname } from "next/navigation";

/**
 * Replays a short fade/rise each time the pathname changes, so section
 * switches (now served instantly from the prefetched router cache) read as a
 * deliberate transition instead of an abrupt content swap. Keyed by pathname
 * only: search-param navigations (study tabs, directory folders/filters)
 * re-render in place with no remount and no replay.
 *
 * Motion prefs: `motion-safe:` skips the animation for OS-level
 * prefers-reduced-motion; the in-app Settings toggle collapses it via
 * `html[data-reduce-motion="true"]` in globals.css.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="h-full min-w-0 w-full overflow-hidden motion-safe:animate-page-in">
      {children}
    </div>
  );
}
