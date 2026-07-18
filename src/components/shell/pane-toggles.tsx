"use client";

import { Columns2, PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePaneChrome } from "./pane-context";

/**
 * Desktop-only cluster of collapse toggles shown at the left of a reader/viewer
 * header: one for the secondary nav pane (via the shared pane context) and one
 * for the third list pane (passed in by the owning shell). Collapsing both
 * hands the document the full window width. Hidden on mobile, where navigation
 * is a drill-down rather than side-by-side panes.
 */
export function PaneToggles({
  listCollapsed = false,
  onToggleList,
  className,
}: {
  listCollapsed?: boolean;
  onToggleList?: () => void;
  className?: string;
}) {
  const { navControllable, navCollapsed, toggleNav } = usePaneChrome();

  // Nothing to control (no shell / mobile / list toggle not wired) → render
  // nothing rather than dead buttons.
  if (!navControllable && !onToggleList) return null;

  return (
    <div className={cn("hidden items-center lg:flex", className)}>
      {navControllable && (
        <Button
          size="icon"
          variant="ghost"
          className={cn("h-8 w-8", navCollapsed && "text-primary")}
          onClick={toggleNav}
          title={navCollapsed ? "Show sidebar" : "Hide sidebar"}
          aria-pressed={navCollapsed}
        >
          <PanelLeft className="h-4 w-4" />
        </Button>
      )}
      {onToggleList && (
        <Button
          size="icon"
          variant="ghost"
          className={cn("h-8 w-8", listCollapsed && "text-primary")}
          onClick={onToggleList}
          title={listCollapsed ? "Show list" : "Hide list"}
          aria-pressed={listCollapsed}
        >
          <Columns2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
