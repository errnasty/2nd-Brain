"use client";

import { useState } from "react";
import { FolderInput, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deleteDirectoryFolderAction, moveDirectoryFolderToParentAction } from "@/app/(app)/directory/actions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { DirectoryFolder } from "@/lib/db/schema";

export function FolderBulkActionBar({
  selectedIds,
  folders,
  folderCounts,
  itemSelectionActive,
  onClear,
  onChanged,
}: {
  selectedIds: string[];
  folders: DirectoryFolder[];
  folderCounts: Record<string, number>;
  /** Whether the item bulk-action bar is also visible, so this one stacks above it. */
  itemSelectionActive: boolean;
  onClear: () => void;
  onChanged: () => void;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const count = selectedIds.length;
  if (count === 0) return null;

  const totalItems = selectedIds.reduce((sum, id) => sum + (folderCounts[id] ?? 0), 0);
  const targets = folders.filter((f) => !f.isInbox && !selectedIds.includes(f.id));

  async function moveInto(parentId: string | null) {
    setBusy(true);
    try {
      const results = await Promise.all(selectedIds.map((id) => moveDirectoryFolderToParentAction(id, parentId)));
      const failed = results.find((r) => !r.ok);
      if (failed && !failed.ok) toast.error(failed.error);
      else toast.success(parentId ? "Folders nested" : "Folders moved to root");
      onClear();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete(mode: "unassign" | "cascade") {
    setDeleteOpen(false);
    setBusy(true);
    try {
      await Promise.all(selectedIds.map((id) => deleteDirectoryFolderAction(id, mode)));
      toast.success(`Deleted ${count} folder${count === 1 ? "" : "s"}`);
      onClear();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div
        className={cn(
          "pointer-events-auto fixed left-1/2 z-50 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-2xl border border-border bg-card/95 px-4 py-2 shadow-lg backdrop-blur lg:flex-nowrap lg:rounded-full",
          itemSelectionActive
            ? "bottom-[calc(9.5rem+env(safe-area-inset-bottom))] lg:bottom-20"
            : "bottom-[calc(4.5rem+env(safe-area-inset-bottom))] lg:bottom-6",
        )}
      >
        <span className="text-sm font-medium">
          {count} folder{count === 1 ? "" : "s"} selected
        </span>
        <span className="h-4 w-px bg-border" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" disabled={busy}>
              <FolderInput className="mr-1.5 h-3.5 w-3.5" />
              Move into…
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" side="top" className="max-h-[40vh] overflow-y-auto">
            <DropdownMenuLabel>Nest {count} folder{count === 1 ? "" : "s"} under</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => moveInto(null)}>Root (no parent)</DropdownMenuItem>
            {targets.length > 0 && <DropdownMenuSeparator />}
            {targets.map((f) => (
              <DropdownMenuItem key={f.id} onClick={() => moveInto(f.id)}>
                {f.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={() => setDeleteOpen(true)}
          disabled={busy}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Delete
        </Button>

        <span className="h-4 w-px bg-border" />
        <button
          onClick={onClear}
          className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Clear selection"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {count} folder{count === 1 ? "" : "s"}?</DialogTitle>
            <DialogDescription>
              {totalItems > 0
                ? `These folders contain ${totalItems} item${totalItems === 1 ? "" : "s"} in total. What would you like to do with them?`
                : "These folders are empty. Confirm deletion below."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <button
              onClick={() => confirmDelete("unassign")}
              className="w-full rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-accent"
            >
              <div className="text-sm font-medium">Keep items, delete folders only</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {totalItems > 0 ? "Items will move to Unsorted." : "Delete the folders."}
              </div>
            </button>
            {totalItems > 0 && (
              <button
                onClick={() => confirmDelete("cascade")}
                className="w-full rounded-md border border-destructive/40 bg-destructive/5 p-3 text-left transition-colors hover:bg-destructive/10"
              >
                <div className="text-sm font-medium text-destructive">Delete folders AND all items inside</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Permanently removes {totalItems} item{totalItems === 1 ? "" : "s"} and their tags. Cannot be undone.
                </div>
              </button>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
