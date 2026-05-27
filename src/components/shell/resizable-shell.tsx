"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Two-pane horizontal split with a draggable handle. Panel widths are saved
 * to localStorage via `autoSaveId`. The left panel collapses to zero with a
 * floating toggle button.
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

  function toggle() {
    if (!panelRef.current) return;
    if (collapsed) {
      panelRef.current.expand();
    } else {
      panelRef.current.collapse();
    }
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

      {/* Floating collapse / expand toggle, anchored to the divider area */}
      <Button
        onClick={toggle}
        size="icon"
        variant="ghost"
        className="absolute left-2 top-2 z-10 h-7 w-7"
        title={collapsed ? "Show sidebar" : "Hide sidebar"}
      >
        {collapsed ? (
          <PanelLeftOpen className="h-3.5 w-3.5" />
        ) : (
          <PanelLeftClose className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
}
