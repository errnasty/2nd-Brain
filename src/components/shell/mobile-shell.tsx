"use client";

import { type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Mobile (<768px) drill-down for the Feeds + Directory routes. The desktop
 * two-pane layout collapses on mobile, so instead we stack:
 *
 *   Folders (nav)  →  list (content)  →  reader/viewer (content's own pane)
 *
 * Level 1 (folders) shows whenever the URL carries no scope. Picking a folder
 * /feed (or "All items/unread") pushes a scope param → level 2 (the list).
 * The list↔reader step is handled inside the content components themselves.
 * A "← Folders" back button in each list header returns to level 1.
 */
export function MobileShell({
  route,
  nav,
  children,
}: {
  route: "feeds" | "directory";
  nav: ReactNode;
  children: ReactNode;
}) {
  const sp = useSearchParams();
  const scopeKeys =
    route === "feeds"
      ? ["feed", "folder", "view", "article", "scope"]
      : ["folder", "tags", "item", "scope"];
  const showContent = scopeKeys.some((k) => sp.has(k));

  // `key` on the inner pane makes React remount on drill-down (folders→list,
  // list→reader) so the page-in transition replays — mobile navigation feels
  // like a deliberate page change instead of an abrupt content swap.
  return (
    <div className="h-full min-w-0 w-full overflow-hidden">
      {showContent ? (
        <div key="content" className="h-full motion-safe:animate-page-in">{children}</div>
      ) : (
        <div key="nav" className="h-full overflow-y-auto motion-safe:animate-page-in">{nav}</div>
      )}
    </div>
  );
}
