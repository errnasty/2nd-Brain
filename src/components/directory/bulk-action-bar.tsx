"use client";

import { useState, useTransition } from "react";
import { FolderInput, Inbox, Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  bulkDeleteDirectoryItemsAction,
  bulkMoveDirectoryItemsAction,
} from "@/app/(app)/directory/actions";
import { toast } from "sonner";
import type { DirectoryFolder } from "@/lib/db/schema";

export function BulkActionBar({
  selectedIds,
  folders,
  onClear,
}: {
  selectedIds: string[];
  folders: DirectoryFolder[];
  onClear: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const count = selectedIds.length;
  if (count === 0) return null;

  function handleMassDelete() {
    if (!confirm(`Delete ${count} item${count === 1 ? "" : "s"}? This cannot be undone.`)) return;
    startTransition(async () => {
      const r = await bulkDeleteDirectoryItemsAction(selectedIds);
      if (r.ok) {
        toast.success(`Deleted ${r.count} item${r.count === 1 ? "" : "s"}`);
        onClear();
      }
    });
  }

  function handleMassMove(folderId: string | null, folderName: string) {
    startTransition(async () => {
      const r = await bulkMoveDirectoryItemsAction(selectedIds, folderId);
      if (r.ok) {
        toast.success(`Moved ${r.count} item${r.count === 1 ? "" : "s"} to ${folderName}`);
        onClear();
      }
    });
  }

  return (
    <div className="pointer-events-auto fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card/95 px-4 py-2 shadow-lg backdrop-blur">
      <span className="text-sm font-medium">
        {count} selected
      </span>
      <span className="h-4 w-px bg-border" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" disabled={pending}>
            <FolderInput className="mr-1.5 h-3.5 w-3.5" />
            Move to…
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" side="top" className="max-h-[40vh] overflow-y-auto">
          <DropdownMenuLabel>Move {count} item{count === 1 ? "" : "s"} to</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => handleMassMove(null, "Unsorted")}>
            <Inbox className="mr-2 h-3.5 w-3.5" /> Unsorted
          </DropdownMenuItem>
          {folders.filter((f) => !f.isInbox).length > 0 && <DropdownMenuSeparator />}
          {folders
            .filter((f) => !f.isInbox)
            .map((folder) => (
              <DropdownMenuItem key={folder.id} onClick={() => handleMassMove(folder.id, folder.name)}>
                <FolderInput className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                {folder.name}
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        onClick={handleMassDelete}
        disabled={pending}
      >
        {pending ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
        )}
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
  );
}
