"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSidebarData } from "@/lib/offline/use-sidebar-data";
import { toast } from "sonner";

/**
 * Scoped export configuration. Lets the user limit the streaming export to a
 * single folder or a set of tags, then downloads from /api/export/stream.
 */
export function ExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { folders, tags } = useSidebarData();
  const [scope, setScope] = useState<"all" | "folder" | "tags">("all");
  const [folderId, setFolderId] = useState<string>("");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  function toggleTag(id: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runExport() {
    const params = new URLSearchParams();
    if (scope === "folder" && folderId) params.set("folder", folderId);
    if (scope === "tags" && selectedTags.size > 0) params.set("tags", Array.from(selectedTags).join(","));

    setBusy(true);
    try {
      const res = await fetch(`/api/export/stream?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        toast.error(`Export failed (HTTP ${res.status})`);
        return;
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = "second_brain_export.md";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      toast.success("Export downloaded");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  const regularFolders = folders.filter((f) => !f.isInbox);
  const canExport = scope === "all" || (scope === "folder" && !!folderId) || (scope === "tags" && selectedTags.size > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Export knowledge base</DialogTitle>
          <DialogDescription>
            Streams a Markdown file. Scope it to a folder or tags, or export everything.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Scope picker */}
          <div className="flex gap-2">
            {(["all", "folder", "tags"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={cn(
                  "flex-1 rounded-md border px-3 py-2 text-sm capitalize transition-colors",
                  scope === s ? "border-primary bg-accent" : "border-border hover:bg-accent/50",
                )}
              >
                {s === "all" ? "Everything" : s}
              </button>
            ))}
          </div>

          {scope === "folder" && (
            <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-border p-1">
              {regularFolders.length === 0 ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">No folders yet.</p>
              ) : (
                regularFolders.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFolderId(f.id)}
                    className={cn(
                      "flex w-full items-center rounded px-2 py-1.5 text-left text-sm",
                      folderId === f.id ? "bg-accent" : "hover:bg-accent/50",
                    )}
                  >
                    {f.name}
                  </button>
                ))
              )}
            </div>
          )}

          {scope === "tags" && (
            <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-border p-2">
              {tags.length === 0 ? (
                <p className="px-1 py-1 text-xs text-muted-foreground">No tags yet.</p>
              ) : (
                tags.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => toggleTag(t.id)}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs transition-colors",
                      selectedTags.has(t.id)
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground",
                    )}
                  >
                    #{t.name}
                  </button>
                ))
              )}
              {scope === "tags" && selectedTags.size > 0 && (
                <p className="mt-1 w-full text-[11px] text-muted-foreground">
                  Items matching ALL {selectedTags.size} selected tag(s) will be exported.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={runExport} disabled={busy || !canExport}>
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
