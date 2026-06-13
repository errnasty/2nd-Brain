"use client";

import { Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

// Web-only: hands off to the installed desktop app via the secondbrain://
// protocol. If the app isn't installed the browser just ignores the click.
export function OpenInDesktop() {
  function open() {
    const path = typeof window !== "undefined" ? window.location.pathname : "/";
    window.location.href = `secondbrain://open?path=${encodeURIComponent(path)}`;
  }
  return (
    <section className="pt-2">
      <h2 className="pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Desktop app
      </h2>
      <div className="flex items-start justify-between gap-4 py-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">Open in desktop app</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Faster, offline-capable local app. Requires the desktop app installed.
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={open} className="shrink-0">
          <Monitor className="mr-1.5 h-3.5 w-3.5" />
          Open
        </Button>
      </div>
      <Separator />
    </section>
  );
}
