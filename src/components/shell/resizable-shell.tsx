"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobileShell } from "./mobile-shell";
import { PaneChromeProvider } from "./pane-context";

/**
 * Two-pane horizontal split with a draggable handle. Panel widths persist via
 * `autoSaveId` (localStorage). To collapse the nav, drag the handle all the
 * way to the left or use the keyboard ([) when focused on the handle.
 *
 * When collapsed, a small floating "Show sidebar" button appears at the left
 * edge of the content area. We don't render a "Hide sidebar" button while the
 * nav is open because it would overlap the nav's own header text — users can
 * just drag the divider.
 */
export function ResizableShell({
  nav,
  children,
  storageId,
  defaultNavSize = 22,
  minNavSize = 14,
  maxNavSize = 40,
  mobileRoute,
}: {
  nav: ReactNode;
  children: ReactNode;
  storageId: string;
  defaultNavSize?: number;
  minNavSize?: number;
  maxNavSize?: number;
  /** When set, mobile uses a folders→list→reader drill-down instead of just
   *  rendering content (the bottom nav can't browse feed/directory folders). */
  mobileRoute?: "feeds" | "directory";
}) {
  const panelRef = useRef<ImperativePanelHandle>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Exposed via context so a nested reader/viewer header can collapse the nav
  // to widen the document — the same panel the divider drag controls.
  const toggleNav = useCallback(() => {
    const p = panelRef.current;
    if (!p) return;
    if (p.isCollapsed()) p.expand();
    else p.collapse();
  }, []);

  // Mobile (<1024px, i.e. below Tailwind's `lg`): skip the resizable panel
  // layout entirely — the bottom MobileNav covers navigation and the panel
  // would otherwise squish content. This threshold MUST match the `lg:` shell
  // switches (sidebar / mobile-nav / layout padding) so there's a single
  // mobile↔desktop boundary and no in-between "hybrid" layout. Default to
  // desktop on first render to avoid hydration flicker; flip after mount.
  useEffect(() => {
    const m = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsMobile(m.matches);
    update();
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, []);

  if (isMobile) {
    // No controllable desktop panels on mobile — the drill-down covers nav.
    const mobileChrome = { navCollapsed: false, toggleNav: () => {}, navControllable: false };
    if (mobileRoute) {
      return (
        <PaneChromeProvider value={mobileChrome}>
          <MobileShell route={mobileRoute} nav={nav}>
            {children}
          </MobileShell>
        </PaneChromeProvider>
      );
    }
    return (
      <PaneChromeProvider value={mobileChrome}>
        <div className="h-full min-w-0 w-full overflow-hidden">{children}</div>
      </PaneChromeProvider>
    );
  }

  return (
    <PaneChromeProvider value={{ navCollapsed: collapsed, toggleNav, navControllable: true }}>
    <div className="relative flex h-full w-full overflow-hidden">
      <PanelGroup direction="horizontal" autoSaveId={storageId} className="h-full w-full">
        <Panel
          ref={panelRef}
          collapsible
          defaultSize={defaultNavSize}
          minSize={minNavSize}
          maxSize={maxNavSize}
          collapsedSize={0}
          onCollapse={() => setCollapsed(true)}
          onExpand={() => setCollapsed(false)}
          className="overflow-hidden"
        >
          <div className="h-full overflow-hidden border-r border-border">{nav}</div>
        </Panel>
        <PanelResizeHandle className="relative w-px bg-border data-[resize-handle-state=hover]:bg-primary data-[resize-handle-state=drag]:bg-primary transition-colors">
          <div className="absolute inset-y-0 -left-1 right-auto w-2 cursor-col-resize" />
        </PanelResizeHandle>
        <Panel defaultSize={100 - defaultNavSize}>
          <div className="h-full min-w-0 overflow-hidden">{children}</div>
        </Panel>
      </PanelGroup>

      {/* Show "Expand" only when the nav is collapsed — clicking the handle is
          enough to collapse, and a button here would otherwise sit on top of
          the nav header text. */}
      {collapsed && (
        <Button
          onClick={() => panelRef.current?.expand()}
          size="icon"
          variant="ghost"
          className="absolute left-2 top-2 z-10 h-7 w-7 rounded-full bg-card/90 shadow-sm backdrop-blur"
          title="Show sidebar"
        >
          <PanelLeftOpen className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
    </PaneChromeProvider>
  );
}
