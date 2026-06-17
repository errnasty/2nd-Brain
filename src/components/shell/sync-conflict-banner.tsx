"use client";

import { useCallback, useEffect, useState } from "react";
import { isDesktopRuntime } from "@/lib/upload-limits";
import { AlertTriangle, Copy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";

type Conflict = {
  row_id: string;
  title: string | null;
  local_content: string | null;
  local_updated_at: string | null;
  remote_updated_at: string | null;
  detected_at: string;
};

// Desktop-only. Surfaces sync conflicts (a remote edit overwrote a note you
// also edited locally). On web the API 404s → count 0 → renders nothing.
export function SyncConflictBanner() {
  const [list, setList] = useState<Conflict[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    fetch("/api/desktop/conflicts")
      .then((r) => (r.ok ? r.json() : { conflicts: [] }))
      .then((d) => setList(Array.isArray(d.conflicts) ? d.conflicts : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Desktop-only feature — don't poll a 404 endpoint every 20s on the web.
    if (!isDesktopRuntime()) return;
    load();
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, [load]);

  async function dismiss(rowId?: string) {
    await fetch("/api/desktop/conflicts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rowId ? { action: "dismiss", rowId } : { action: "dismissAll" }),
    }).catch(() => {});
    if (!rowId) setOpen(false);
    load();
  }

  async function copy(text: string | null) {
    try {
      await navigator.clipboard.writeText(text ?? "");
      toast.success("Local version copied");
    } catch {
      toast.error("Copy failed");
    }
  }

  if (list.length === 0) return null;

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
        <span className="inline-flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {list.length} note{list.length > 1 ? "s" : ""} changed on another device — the newer version was kept.
        </span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => setOpen(true)}>
            Review
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => dismiss()} title="Dismiss all">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Sync conflicts</DialogTitle>
            <DialogDescription>
              These notes were edited on two devices. Sync kept the newer version; your overwritten local
              text is below so you can copy anything you still need.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[55vh] pr-3">
            <div className="space-y-3">
              {list.map((c) => (
                <div key={c.row_id} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-sm font-medium">{c.title || "Untitled note"}</div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => copy(c.local_content)}>
                        <Copy className="mr-1 h-3 w-3" />
                        Copy local
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => dismiss(c.row_id)}>
                        Dismiss
                      </Button>
                    </div>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    your edit {c.local_updated_at ? new Date(c.local_updated_at).toLocaleString() : "—"} · kept{" "}
                    {c.remote_updated_at ? new Date(c.remote_updated_at).toLocaleString() : "—"}
                  </div>
                  {c.local_content && (
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2 text-xs">
                      {c.local_content.slice(0, 4000)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
          <div className="flex justify-end pt-2">
            <Button size="sm" variant="outline" onClick={() => dismiss()}>
              Dismiss all
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
