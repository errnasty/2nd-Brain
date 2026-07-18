"use client";

import { useEffect, useRef, useState } from "react";
import { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";

/**
 * Cross-component wiring for the top route-loading bar. The App Router has no
 * global navigation events, but useLinkStatus reads the pending state of an
 * enclosing <Link> — so nav links render a <LinkPendingReporter/> child that
 * broadcasts pending changes as window events, and the single <RouteProgress/>
 * in the app layout listens. Programmatic router.push (e.g. the folder drawer)
 * doesn't drive the bar — a known, acceptable gap.
 */

/** Render inside a <Link> (alongside its visible content, renders nothing). */
export function LinkPendingReporter() {
  const { pending } = useLinkStatus();
  const wasPending = useRef(false);
  useEffect(() => {
    // Only real transitions count: every link mounts with pending=false, and a
    // mount-time "settled" would cancel another link's genuine pending.
    if (pending === wasPending.current) return;
    wasPending.current = pending;
    window.dispatchEvent(new CustomEvent(pending ? "route-pending" : "route-settled"));
    // An unmount while pending (destination page replaced this link) counts as
    // settled, and the layout-level pathname reset backstops the rest.
  }, [pending]);
  useEffect(
    () => () => {
      if (wasPending.current) window.dispatchEvent(new CustomEvent("route-settled"));
    },
    [],
  );
  return null;
}

/** Fixed indeterminate 2px bar at the very top of the viewport. */
export function RouteProgress() {
  const pathname = usePathname();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const up = () => setPendingCount((n) => n + 1);
    const down = () => setPendingCount((n) => Math.max(0, n - 1));
    window.addEventListener("route-pending", up);
    window.addEventListener("route-settled", down);
    return () => {
      window.removeEventListener("route-pending", up);
      window.removeEventListener("route-settled", down);
    };
  }, []);

  // Safety net: the destination committed, so any stuck pending state is stale.
  useEffect(() => {
    setPendingCount(0);
  }, [pathname]);

  if (pendingCount <= 0) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 z-50 h-0.5 overflow-hidden"
      style={{ top: "env(safe-area-inset-top)" }}
    >
      <div className="h-full w-full bg-brand motion-safe:animate-route-progress" />
    </div>
  );
}
