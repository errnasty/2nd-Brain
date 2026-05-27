"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FolderClosed, Inbox, Library, Plus, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  autoOrganizeDirectoryAction,
  createDirectoryFolderAction,
} from "@/app/(app)/directory/actions";
import type { DirectoryFolder } from "@/lib/db/schema";

export function DirectoryNav({
  folders,
  folderCounts,
}: {
  folders: DirectoryFolder[];
  folderCounts: Record<string, number>;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const activeFolder = params.get("folder");

  function setFolder(folderId: string | null) {
    const sp = new URLSearchParams(params.toString());
    if (folderId) sp.set("folder", folderId);
    else sp.delete("folder");
    sp.delete("item");
    router.push(`/directory?${sp.toString()}`);
  }

  function commitCreateFolder() {
    setCreatingFolder(false);
    const name = newFolderName.trim();
    if (!name) return;
    setNewFolderName("");
    startTransition(async () => {
      const r = await createDirectoryFolderAction(name);
      if (r.ok) toast.success(`Folder "${name}" created`);
      else toast.error(r.error);
    });
  }

  function runAutoOrganize() {
    startTransition(async () => {
      const r = await autoOrganizeDirectoryAction();
      if (!r.ok) return;
      if (r.total === 0) {
        toast.success("Nothing to organize — every item is already in a folder");
      } else {
        const folderMsg =
          r.foldersCreated.length > 0
            ? ` · created ${r.foldersCreated.length} folder${r.foldersCreated.length === 1 ? "" : "s"}: ${r.foldersCreated.join(", ")}`
            : "";
        toast.success(`Auto-organized ${r.routed} of ${r.total} items${folderMsg}`);
      }
    });
  }

  const inbox = folders.find((f) => f.isInbox);
  const regularFolders = folders.filter((f) => !f.isInbox);

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border md:flex">
      <div className="flex items-center justify-between px-3 py-3">
        <div className="text-sm font-semibold">Directory</div>
        <div className="flex items-center gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={runAutoOrganize}
            disabled={pending}
            title="Auto-organize uncategorized items"
          >
            <Wand2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <Separator />

      <ScrollArea className="flex-1">
        <nav className="space-y-0.5 p-2 text-sm">
          <button
            onClick={() => setFolder(null)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left transition-colors",
              !activeFolder
                ? "bg-accent text-accent-foreground"
                : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Library className="h-4 w-4" />
            <span className="flex-1 truncate">All items</span>
          </button>

          {inbox && (
            <button
              onClick={() => setFolder(inbox.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left transition-colors",
                activeFolder === inbox.id
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Inbox className="h-4 w-4" />
              <span className="flex-1 truncate">{inbox.name}</span>
              {(folderCounts[inbox.id] ?? 0) > 0 && (
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {folderCounts[inbox.id]}
                </span>
              )}
            </button>
          )}

          {/* Folders header */}
          <div className="flex items-center justify-between px-3 pb-1 pt-4">
            {creatingFolder ? (
              <input
                autoFocus
                className="flex-1 bg-transparent text-[10px] uppercase tracking-wider outline-none border-b border-primary py-0.5"
                placeholder="Folder name…"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onBlur={commitCreateFolder}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); commitCreateFolder(); }
                  if (e.key === "Escape") { setCreatingFolder(false); setNewFolderName(""); }
                }}
              />
            ) : (
              <>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {regularFolders.length > 0 ? "Folders" : ""}
                </span>
                <button
                  onClick={() => setCreatingFolder(true)}
                  title="New folder"
                  className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </>
            )}
          </div>

          {regularFolders.map((folder) => (
            <button
              key={folder.id}
              onClick={() => setFolder(folder.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left transition-colors",
                activeFolder === folder.id
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <FolderClosed className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 truncate">{folder.name}</span>
              {(folderCounts[folder.id] ?? 0) > 0 && (
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {folderCounts[folder.id]}
                </span>
              )}
            </button>
          ))}
        </nav>
      </ScrollArea>
    </aside>
  );
}
