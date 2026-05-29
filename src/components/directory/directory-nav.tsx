"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FolderClosed,
  Inbox,
  Library,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  autoOrganizeDirectoryAction,
  createDirectoryFolderAction,
  deleteDirectoryFolderAction,
  renameDirectoryFolderAction,
} from "@/app/(app)/directory/actions";
import type { DirectoryFolder } from "@/lib/db/schema";
import { DeleteFolderDialog } from "./delete-folder-dialog";
import { ExportDialog } from "./export-dialog";

const UNSORTED = "unsorted";
const DIR_COLLAPSE_KEY = "directory.collapsed.v1";

export function DirectoryNav({
  folders,
  folderCounts,
  unsortedCount,
}: {
  folders: DirectoryFolder[];
  folderCounts: Record<string, number>;
  unsortedCount: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderToDelete, setFolderToDelete] = useState<DirectoryFolder | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  // Collapse state for nested folders, persisted to localStorage.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DIR_COLLAPSE_KEY);
      if (raw) setCollapsed(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);
  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(DIR_COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

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

  // Folders to render in the list. The deprecated [Inbox] (is_inbox=true)
  // folder is hidden because we now use a virtual "Unsorted" tray instead.
  const regularFolders = folders.filter((f) => !f.isInbox);

  // Build a tree from the flat list so nested folders render indented.
  const folderTree = buildFolderTree(regularFolders);

  return (
    <aside className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between px-3 py-3">
        <div className="text-sm font-semibold">Directory</div>
        <div className="flex items-center gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setExportOpen(true)}
            title="Export knowledge base"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={runAutoOrganize}
            disabled={pending}
            title={pending ? "Auto-organizing…" : "Auto-organize uncategorized items"}
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wand2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
      <Separator />

      <ScrollArea className="flex-1">
        <nav className="space-y-0.5 p-2 text-sm">
          {/* Unsorted tray — items not yet placed into a folder.
              Pinned to the top because it's the staging ground for sorting.
              Acts as a drop target so items can be dragged back here. */}
          <DroppableUnsorted
            active={activeFolder === UNSORTED}
            count={unsortedCount}
            onClick={() => setFolder(UNSORTED)}
          />

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

          {folderTree.map((node) => (
            <FolderTreeNode
              key={node.folder.id}
              node={node}
              depth={0}
              folderCounts={folderCounts}
              activeFolder={activeFolder}
              collapsed={collapsed}
              onToggleCollapsed={toggleCollapsed}
              onSelect={setFolder}
              onRequestDelete={(f) => setFolderToDelete(f)}
            />
          ))}
        </nav>
      </ScrollArea>

      {folderToDelete && (
        <DeleteFolderDialog
          folder={folderToDelete}
          itemCount={folderCounts[folderToDelete.id] ?? 0}
          open={!!folderToDelete}
          onOpenChange={(open) => !open && setFolderToDelete(null)}
          onConfirm={(mode) => {
            const f = folderToDelete;
            setFolderToDelete(null);
            startTransition(async () => {
              await deleteDirectoryFolderAction(f.id, mode);
              if (activeFolder === f.id) setFolder(null);
              toast.success(
                mode === "cascade"
                  ? `Deleted "${f.name}" and its contents`
                  : `Deleted "${f.name}". Items moved to Unsorted.`,
              );
            });
          }}
        />
      )}
    </aside>
  );
}

// ── Folder tree (nested) ──────────────────────────────────────────────

type FolderNode = { folder: DirectoryFolder; children: FolderNode[] };

function buildFolderTree(folders: DirectoryFolder[]): FolderNode[] {
  const byId = new Map<string, FolderNode>();
  folders.forEach((f) => byId.set(f.id, { folder: f, children: [] }));
  const roots: FolderNode[] = [];
  for (const node of byId.values()) {
    const parent = node.folder.parentId ? byId.get(node.folder.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function FolderTreeNode({
  node,
  depth,
  folderCounts,
  activeFolder,
  collapsed,
  onToggleCollapsed,
  onSelect,
  onRequestDelete,
}: {
  node: FolderNode;
  depth: number;
  folderCounts: Record<string, number>;
  activeFolder: string | null;
  collapsed: Record<string, boolean>;
  onToggleCollapsed: (id: string) => void;
  onSelect: (id: string) => void;
  onRequestDelete: (f: DirectoryFolder) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed[node.folder.id];
  return (
    <div>
      <div className="flex items-center" style={{ paddingLeft: depth * 12 }}>
        {hasChildren ? (
          <button
            onClick={() => onToggleCollapsed(node.folder.id)}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            title={isCollapsed ? "Expand" : "Collapse"}
          >
            {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        ) : (
          <span className="w-4 shrink-0" /> // align leaf rows with chevroned ones
        )}
        <div className="min-w-0 flex-1">
          <FolderRow
            folder={node.folder}
            count={folderCounts[node.folder.id] ?? 0}
            active={activeFolder === node.folder.id}
            onSelect={() => onSelect(node.folder.id)}
            onRequestDelete={() => onRequestDelete(node.folder)}
          />
        </div>
      </div>
      {hasChildren && !isCollapsed && (
        <div>
          {node.children.map((child) => (
            <FolderTreeNode
              key={child.folder.id}
              node={child}
              depth={depth + 1}
              folderCounts={folderCounts}
              activeFolder={activeFolder}
              collapsed={collapsed}
              onToggleCollapsed={onToggleCollapsed}
              onSelect={onSelect}
              onRequestDelete={onRequestDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Droppable Unsorted tray ───────────────────────────────────────────

function DroppableUnsorted({
  active,
  count,
  onClick,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "folder:unsorted" });
  return (
    <button
      ref={setNodeRef}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
        isOver && "ring-2 ring-primary",
      )}
    >
      <Inbox className="h-4 w-4" />
      <span className="flex-1 truncate">Unsorted</span>
      {count > 0 && (
        <span className="text-[11px] tabular-nums text-muted-foreground">{count}</span>
      )}
    </button>
  );
}

// ── FolderRow with inline rename + context menu + drop target ────────

function FolderRow({
  folder,
  count,
  active,
  onSelect,
  onRequestDelete,
}: {
  folder: DirectoryFolder;
  count: number;
  active: boolean;
  onSelect: () => void;
  onRequestDelete: () => void;
}) {
  const [, startTransition] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(folder.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `folder:${folder.id}` });
  const {
    attributes: dragAttrs,
    listeners: dragListeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({ id: `folder-drag:${folder.id}` });

  // Combine the two refs onto the same element — it's both a drag source and
  // a drop target at the same time.
  function setNodeRef(node: HTMLDivElement | null) {
    setDragRef(node);
    setDropRef(node);
  }

  function startRename() {
    setValue(folder.name);
    setRenaming(true);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 20);
  }

  function commitRename() {
    setRenaming(false);
    const next = value.trim();
    if (!next || next === folder.name) return;
    startTransition(async () => {
      const r = await renameDirectoryFolderAction(folder.id, next);
      if (!r.ok) toast.error(r.error);
    });
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          className={cn(
            "group flex w-full items-center gap-2 rounded-md px-3 py-1.5 transition-colors",
            active ? "bg-accent text-accent-foreground" : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
            isOver && "ring-2 ring-primary",
            isDragging && "opacity-40",
          )}
        >
          <button onClick={onSelect} className="flex flex-1 items-center gap-2 text-left min-w-0">
            {/* The folder icon is the drag handle — click anywhere else still opens the folder. */}
            <span
              {...dragAttrs}
              {...dragListeners}
              className="cursor-grab shrink-0 active:cursor-grabbing"
              onClick={(e) => e.preventDefault()}
              aria-label="Drag to nest folder"
            >
              <FolderClosed className="h-4 w-4 text-muted-foreground" />
            </span>
            {renaming ? (
              <input
                ref={inputRef}
                className="flex-1 bg-transparent text-sm outline-none border-b border-primary py-0"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                  if (e.key === "Escape") setRenaming(false);
                  e.stopPropagation();
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="flex-1 truncate">{folder.name}</span>
            )}
          </button>
          {!renaming && count > 0 && (
            <span className="text-[11px] tabular-nums text-muted-foreground">{count}</span>
          )}
          {!renaming && (
            <button
              onClick={startRename}
              title="Rename / delete (right-click for menu)"
              className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-background group-hover:opacity-100"
              tabIndex={-1}
            >
              <MoreHorizontal className="h-3 w-3" />
            </button>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel className="max-w-[200px] truncate">{folder.name}</ContextMenuLabel>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={startRename}>
          <Pencil className="mr-2 h-3.5 w-3.5" />
          Rename folder
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onClick={onRequestDelete}
        >
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          Delete folder…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
