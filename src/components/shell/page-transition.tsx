"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

// Order of the mobile bottom-tab bar (see TABS in mobile-nav.tsx). When both
// ends of a navigation are bottom tabs, the new page slides in from the side
// the user is heading toward; every other navigation keeps the fade/rise.
const TAB_ORDER: Record<string, number> = {
  "/today": 0,
  "/feeds": 1,
  "/directory": 2,
  "/ask": 3,
};

function tabIndex(pathname: string): number | undefined {
  const hit = Object.keys(TAB_ORDER).find(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  return hit === undefined ? undefined : TAB_ORDER[hit];
}

/**
 * Replays a short fade/rise each time the pathname changes, so section
 * switches (now served instantly from the prefetched router cache) read as a
 * deliberate transition instead of an abrupt content swap. Keyed by pathname
 * only: search-param navigations (study tabs, directory folders/filters)
 * re-render in place with no remount and no replay.
 *
 * On mobile (<lg), switching between bottom-bar tabs uses a directional
 * horizontal slide instead; desktop always keeps the fade/rise.
 *
 * Motion prefs: `motion-safe:` skips the animation for OS-level
 * prefers-reduced-motion; the in-app Settings toggle collapses it via
 * `html[data-reduce-motion="true"]` in globals.css.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // "Adjust state during render" pattern: remembers where this navigation came
  // from. Lives in PageTransition itself (not the keyed div), so it survives
  // the per-pathname remount of the children.
  const [nav, setNav] = useState<{ from: string | null; to: string }>({
    from: null,
    to: pathname,
  });
  if (nav.to !== pathname) setNav({ from: nav.to, to: pathname });
  const from = nav.to === pathname ? nav.from : nav.to;

  const fromTab = from === null ? undefined : tabIndex(from);
  const toTab = tabIndex(pathname);
  let mobileAnim = "max-lg:motion-safe:animate-page-in";
  if (fromTab !== undefined && toTab !== undefined && fromTab !== toTab) {
    mobileAnim =
      toTab > fromTab
        ? "max-lg:motion-safe:animate-page-in-left"
        : "max-lg:motion-safe:animate-page-in-right";
  }

  return (
    <div
      key={pathname}
      className={`h-full min-w-0 w-full overflow-hidden lg:motion-safe:animate-page-in ${mobileAnim}`}
    >
      {children}
    </div>
  );
}
