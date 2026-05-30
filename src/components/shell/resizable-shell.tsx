"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

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
}: {
  nav: ReactNode;
  children: ReactNode;
  storageId: string;
  defaultNavSize?: number;
  minNavSize?: number;
  maxNavSize?: number;
}) {
  const panelRef = useRef<ImperativePanelHandle>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Mobile (<768px): skip the resizable panel layout entirely — the bottom
  // MobileNav covers navigation, and the panel would otherwise squish content.
  // Default to desktop on first render to avoid hydration flicker; flip after
  // mount if the viewport actually is mobile.
  useEffect(() => {
    const m = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(m.matches);
    update();
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, []);

  if (isMobile) {
    return <div className="h-full w-full overflow-hidden">{children}</div>;
  }

  return (
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
          <div className="h-full overflow-hidden">{children}</div>
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
  );
}
