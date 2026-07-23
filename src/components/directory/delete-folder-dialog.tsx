"use client";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { DirectoryFolder } from "@/lib/db/schema";

export function DeleteFolderDialog({
  folder,
  itemCount,
  hasSubfolders = false,
  open,
  onOpenChange,
  onConfirm,
}: {
  folder: DirectoryFolder;
  /** Direct-child item count only — subfolders (and their contents) are
   *  handled separately by the two modes below regardless of this number. */
  itemCount: number;
  hasSubfolders?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (mode: "unassign" | "cascade") => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{folder.name}&rdquo;?</DialogTitle>
          <DialogDescription>
            {itemCount > 0
              ? `This folder contains ${itemCount} item${itemCount === 1 ? "" : "s"}. What would you like to do with them?`
              : hasSubfolders
                ? "This folder has no items directly in it, but it has subfolders. What would you like to do?"
                : "This folder is empty. Confirm deletion below."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <button
            onClick={() => onConfirm("unassign")}
            className="w-full rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-accent"
          >
            <div className="text-sm font-medium">Keep items, delete folder only</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {itemCount > 0
                ? `The ${itemCount} item${itemCount === 1 ? "" : "s"} will move to Unsorted.`
                : "Delete the folder."}
              {hasSubfolders && " Subfolders move up to take this folder's place."}
            </div>
          </button>
          {(itemCount > 0 || hasSubfolders) && (
            <button
              onClick={() => onConfirm("cascade")}
              className="w-full rounded-md border border-destructive/40 bg-destructive/5 p-3 text-left transition-colors hover:bg-destructive/10"
            >
              <div className="text-sm font-medium text-destructive">
                Delete folder AND everything inside{hasSubfolders ? " (including subfolders)" : ""}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {itemCount > 0
                  ? `Permanently removes ${itemCount} item${itemCount === 1 ? "" : "s"}`
                  : "Permanently removes"}
                {hasSubfolders ? ", every subfolder, and everything inside them" : " and their tags"}. Cannot be
                undone.
              </div>
            </button>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
