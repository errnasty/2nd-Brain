"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  Bookmark,
  BookmarkX,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  FileText,
  FolderClosed,
  Inbox,
  Library,
  Loader2,
  MoreHorizontal,
  Newspaper,
  NotebookPen,
  Pencil,
  Plus,
  Search,
  Trash2,
  Wand2,
  X,
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
  createDirectoryFolderAction,
  deleteDirectoryFolderAction,
  fetchFolderTreeItemsAction,
  renameDirectoryFolderAction,
} from "@/app/(app)/directory/actions";
import type { DirectoryFolder } from "@/lib/db/schema";
import type { FolderTreeItem } from "@/lib/directory/query";
import { usePromptText } from "@/components/ui/app-dialogs";
import { DeleteFolderDialog } from "./delete-folder-dialog";
import { ExportDialog } from "./export-dialog";
import { AutoOrganizeDialog } from "./auto-organize-dialog";
import { getRecent, pushRecent, type RecentEntry } from "@/lib/directory/recently-viewed";
import { getSmartViews, saveSmartView, deleteSmartView, type SmartView } from "@/lib/directory/smart-views";

const UNSORTED = "unsorted";
const DIR_COLLAPSE_KEY = "directory.collapsed.v1";

export type DirectoryTag = { id: string; name: string; count: number };

export function DirectoryNav({
  folders,
  folderCounts,
  unsortedCount,
  tags = [],
}: {
  folders: DirectoryFolder[];
  folderCounts: Record<string, number>;
  unsortedCount: number;
  tags?: DirectoryTag[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const promptText = usePromptText();
  const [, startTransition] = useTransition();
  // Folder switching transition: keep the current item list on screen during the
  // server round-trip (no skeleton flash) and reflect the click instantly.
  const [navPending, startNav] = useTransition();
  const [optimisticFolder, setOptimisticFolder] = useState<{ v: string | null } | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderToDelete, setFolderToDelete] = useState<DirectoryFolder | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [organizeOpen, setOrganizeOpen] = useState(false);

  // VSCode-style tree: a folder's files are fetched lazily the first time
  // it's expanded, not eagerly for the whole tree. Cached by folder id for
  // the life of this component instance (no invalidation — a manual move/
  // create elsewhere already triggers a route refresh that remounts this nav).
  const [folderItems, setFolderItems] = useState<Record<string, FolderTreeItem[]>>({});
  const [loadingFolderIds, setLoadingFolderIds] = useState<Set<string>>(new Set());
  function loadFolderItems(folderId: string) {
    if (folderItems[folderId] || loadingFolderIds.has(folderId)) return;
    setLoadingFolderIds((prev) => new Set(prev).add(folderId));
    fetchFolderTreeItemsAction(folderId)
      .then((items) => setFolderItems((prev) => ({ ...prev, [folderId]: items })))
      .catch(() => setFolderItems((prev) => ({ ...prev, [folderId]: [] })))
      .finally(() => {
        setLoadingFolderIds((prev) => {
          const next = new Set(prev);
          next.delete(folderId);
          return next;
        });
      });
  }

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

  // Search-as-you-type filter over the folder tree — matches (and their
  // ancestors, so the path to a match stays visible) are kept; everything
  // else is pruned out and matched branches force-expand while searching.
  const [treeQuery, setTreeQuery] = useState("");

  // Recently-viewed folders/items, and saved tag-filter "views" — both
  // client-only (localStorage), hydrated after mount to avoid an SSR mismatch.
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [smartViews, setSmartViews] = useState<SmartView[]>([]);
  useEffect(() => {
    setRecent(getRecent());
    setSmartViews(getSmartViews());
  }, []);

  const activeFolder = optimisticFolder ? optimisticFolder.v : params.get("folder");
  const activeItem = params.get("item");

  useEffect(() => {
    if (!navPending) setOptimisticFolder(null);
  }, [navPending]);

  // Track real folders as "recently viewed" (Unsorted/All items aren't
  // folders, so they're excluded). Items are tracked from DirectoryShell,
  // which knows the item's title once it's loaded.
  useEffect(() => {
    if (!activeFolder || activeFolder === UNSORTED) return;
    const f = folders.find((x) => x.id === activeFolder);
    if (f) setRecent(pushRecent({ id: f.id, kind: "folder", title: f.name }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFolder]);

  function folderHref(folderId: string | null): string {
    const sp = new URLSearchParams(params.toString());
    if (folderId) sp.set("folder", folderId);
    else sp.delete("folder");
    sp.delete("item");
    // Browsing a folder clears any active tag filter (symmetric with toggleTag,
    // which clears the folder) — otherwise you'd get a confusing folder∩tags view.
    sp.delete("tags");
    return `/directory?${sp.toString()}`;
  }

  function setFolder(folderId: string | null) {
    setOptimisticFolder({ v: folderId });
    startNav(() => router.push(folderHref(folderId)));
  }

  // Warm the target folder route on hover so the click resolves from cache.
  function prefetchFolder(folderId: string | null) {
    router.prefetch(folderHref(folderId));
  }

  // ── Tag filtering (multi-select intersection via ?tags=a,b) ──
  const activeTagIds = (params.get("tags") ?? "").split(",").filter(Boolean);
  function applyTags(ids: string[]) {
    const sp = new URLSearchParams(params.toString());
    if (ids.length) sp.set("tags", ids.join(","));
    else sp.delete("tags");
    // A tag filter spans folders, so drop the folder + open-item scope.
    sp.delete("folder");
    sp.delete("item");
    startNav(() => router.push(`/directory?${sp.toString()}`));
  }
  function toggleTag(id: string) {
    const set = new Set(activeTagIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    applyTags([...set]);
  }
  function clearTags() {
    applyTags([]);
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

  async function createSubfolder(parentId: string) {
    const name = (await promptText({ title: "New subfolder", placeholder: "Folder name" }))?.trim();
    if (!name) return;
    startTransition(async () => {
      const r = await createDirectoryFolderAction(name, parentId);
      if (r.ok) {
        toast.success(`Folder "${name}" created`);
        setCollapsed((prev) => ({ ...prev, [parentId]: false })); // reveal the new child
      } else {
        toast.error(r.error);
      }
    });
  }

  // Open item in the content pane, keeping the item's own folder in the URL
  // (clicking a file nested under a folder in the tree).
  function openItem(folderId: string, itemId: string, title: string) {
    const sp = new URLSearchParams();
    sp.set("folder", folderId);
    sp.set("item", itemId);
    setOptimisticFolder({ v: folderId });
    setRecent(pushRecent({ id: itemId, kind: "item", title }));
    startNav(() => router.push(`/directory?${sp.toString()}`));
  }

  function openRecent(entry: RecentEntry) {
    if (entry.kind === "folder") {
      setFolder(entry.id);
    } else {
      startNav(() => router.push(`/directory?item=${entry.id}`));
    }
  }

  async function saveCurrentAsView() {
    if (activeTagIds.length === 0) return;
    const name = (await promptText({ title: "Name this view", placeholder: "e.g. Unread AI papers" }))?.trim();
    if (!name) return;
    setSmartViews(saveSmartView(name, activeTagIds));
    toast.success(`Saved view "${name}"`);
  }

  function removeSmartView(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setSmartViews(deleteSmartView(id));
  }

  // Folders to render in the list. The deprecated [Inbox] (is_inbox=true)
  // folder is hidden because we now use a virtual "Unsorted" tray instead.
  const regularFolders = folders.filter((f) => !f.isInbox);

  // While searching, prune to matches + their ancestors (so the path to a
  // match stays visible) and force those branches open regardless of the
  // persisted collapse state.
  const searching = treeQuery.trim().length > 0;
  const visibleFolders = (() => {
    if (!searching) return regularFolders;
    const q = treeQuery.trim().toLowerCase();
    const byId = new Map(regularFolders.map((f) => [f.id, f]));
    const keep = new Set<string>();
    for (const f of regularFolders) {
      if (!f.name.toLowerCase().includes(q)) continue;
      let cur: DirectoryFolder | undefined = f;
      while (cur) {
        keep.add(cur.id);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
    }
    return regularFolders.filter((f) => keep.has(f.id));
  })();

  // Build a tree from the (possibly filtered) flat list so nested folders
  // render indented.
  const folderTree = buildFolderTree(visibleFolders);

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
            onClick={() => setOrganizeOpen(true)}
            title="Auto-organize uncategorized items"
          >
            <Wand2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
      <AutoOrganizeDialog open={organizeOpen} onOpenChange={setOrganizeOpen} />
      <Separator />

      <div className="px-3 pt-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={treeQuery}
            onChange={(e) => setTreeQuery(e.target.value)}
            placeholder="Filter folders…"
            className="w-full rounded-md border border-border bg-transparent py-1.5 pl-7 pr-7 text-sm outline-none focus:border-primary"
          />
          {treeQuery && (
            <button
              onClick={() => setTreeQuery("")}
              title="Clear filter"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <nav className="space-y-0.5 p-2 text-sm">
          {/* Unsorted tray — items not yet placed into a folder.
              Pinned to the top because it's the staging ground for sorting.
              Acts as a drop target so items can be dragged back here. */}
          <DroppableUnsorted
            active={activeFolder === UNSORTED}
            count={unsortedCount}
            onClick={() => setFolder(UNSORTED)}
            onHover={() => prefetchFolder(UNSORTED)}
          />

          <button
            // scope=all marks an explicit "show everything" so the mobile
            // drill-down switches from the folder list to the item list.
            onClick={() => { setOptimisticFolder({ v: null }); startNav(() => router.push("/directory?scope=all")); }}
            onMouseEnter={() => router.prefetch("/directory?scope=all")}
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

          {/* Recently viewed folders/items — quick jump back, client-only. */}
          {recent.length > 0 && !searching && (
            <div className="pt-4">
              <div className="editorial-section-row px-3 pb-1">
                <span className="editorial-eyebrow-brand">§ Recent</span>
                <span className="editorial-section-rule" />
              </div>
              <div className="space-y-0.5">
                {recent.map((entry) => (
                  <button
                    key={`${entry.kind}-${entry.id}`}
                    onClick={() => openRecent(entry)}
                    onMouseEnter={() => entry.kind === "folder" && prefetchFolder(entry.id)}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[13px] text-foreground/80 transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{entry.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Folders header */}
          <div className="flex items-center justify-between px-3 pb-1 pt-4">
            {creatingFolder ? (
              <input
                autoFocus
                className="flex-1 bg-transparent text-[10px] max-md:text-base uppercase tracking-wider outline-none border-b border-primary py-0.5"
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
              activeItem={activeItem}
              collapsed={collapsed}
              onToggleCollapsed={toggleCollapsed}
              onSelect={setFolder}
              onPrefetch={prefetchFolder}
              onRequestDelete={(f) => setFolderToDelete(f)}
              onNewSubfolder={createSubfolder}
              folderItems={folderItems}
              loadingFolderIds={loadingFolderIds}
              onLoadItems={loadFolderItems}
              onOpenItem={openItem}
              forceExpand={searching}
            />
          ))}

          {/* Views — saved tag-filter shortcuts, plus "save current" while a tag filter is active. */}
          {(smartViews.length > 0 || (tags.length > 0 && activeTagIds.length > 0)) && (
            <div className="pt-4">
              <div className="editorial-section-row px-3 pb-1">
                <span className="editorial-eyebrow-brand">§ Views</span>
                <span className="editorial-section-rule" />
                {activeTagIds.length > 0 && (
                  <button
                    onClick={saveCurrentAsView}
                    title="Save current tag filter as a view"
                    className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
                  >
                    save
                  </button>
                )}
              </div>
              {smartViews.length > 0 && (
                <div className="space-y-0.5">
                  {smartViews.map((v) => {
                    const active =
                      v.tagIds.length === activeTagIds.length && v.tagIds.every((t) => activeTagIds.includes(t));
                    return (
                      <div
                        key={v.id}
                        className={cn(
                          "group flex w-full items-center gap-2 rounded-md px-3 py-1.5 transition-colors",
                          active
                            ? "bg-accent text-accent-foreground"
                            : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
                        )}
                      >
                        <button
                          onClick={() => applyTags(v.tagIds)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px]"
                        >
                          <Bookmark className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="flex-1 truncate">{v.name}</span>
                        </button>
                        <button
                          onClick={(e) => removeSmartView(v.id, e)}
                          title="Delete view"
                          className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-background group-hover:opacity-100"
                        >
                          <BookmarkX className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Tags — click to filter the Directory by tag (toggle multi-select). */}
          {tags.length > 0 && (
            <div className="pt-4">
              <div className="editorial-section-row px-3 pb-1">
                <span className="editorial-eyebrow-brand">§ Tags</span>
                <span className="editorial-section-rule" />
                {activeTagIds.length > 0 && (
                  <button
                    onClick={() => clearTags()}
                    className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
                  >
                    clear
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1 px-3 pt-1">
                {tags.map((t) => {
                  const active = activeTagIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      onClick={() => toggleTag(t.id)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] transition-colors",
                        active
                          ? "border-transparent text-brand"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                      style={active ? { background: "hsl(var(--brand) / 0.1)" } : undefined}
                    >
                      #{t.name}
                      <span className="tabular-nums opacity-60">{t.count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
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

const TREE_KIND_ICON: Record<FolderTreeItem["kind"], React.ReactNode> = {
  saved_article: <Newspaper className="h-3.5 w-3.5 shrink-0" />,
  uploaded_document: <FileText className="h-3.5 w-3.5 shrink-0" />,
  user_note: <NotebookPen className="h-3.5 w-3.5 shrink-0" />,
};

function FolderTreeNode({
  node,
  depth,
  folderCounts,
  activeFolder,
  activeItem,
  collapsed,
  onToggleCollapsed,
  onSelect,
  onPrefetch,
  onRequestDelete,
  onNewSubfolder,
  folderItems,
  loadingFolderIds,
  onLoadItems,
  onOpenItem,
  forceExpand,
}: {
  node: FolderNode;
  depth: number;
  folderCounts: Record<string, number>;
  activeFolder: string | null;
  activeItem: string | null;
  collapsed: Record<string, boolean>;
  onToggleCollapsed: (id: string) => void;
  onSelect: (id: string) => void;
  onPrefetch: (id: string) => void;
  onRequestDelete: (f: DirectoryFolder) => void;
  onNewSubfolder: (parentId: string) => void;
  folderItems: Record<string, FolderTreeItem[]>;
  loadingFolderIds: Set<string>;
  onLoadItems: (folderId: string) => void;
  onOpenItem: (folderId: string, itemId: string, title: string) => void;
  forceExpand?: boolean;
}) {
  const hasChildren = node.children.length > 0;
  const itemCount = folderCounts[node.folder.id] ?? 0;
  // VSCode-style: a folder is expandable if it has subfolders OR files —
  // expanding it reveals both, not just subfolders.
  const expandable = hasChildren || itemCount > 0;
  const isCollapsed = forceExpand ? false : (collapsed[node.folder.id] ?? false);
  const expanded = expandable && !isCollapsed;
  const items = folderItems[node.folder.id];
  const itemsLoading = loadingFolderIds.has(node.folder.id);

  useEffect(() => {
    if (expanded && itemCount > 0 && !items && !itemsLoading) onLoadItems(node.folder.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, itemCount, node.folder.id]);

  return (
    <div>
      <div className="flex items-center" style={{ paddingLeft: depth * 12 }}>
        {expandable ? (
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
            count={itemCount}
            active={activeFolder === node.folder.id}
            onSelect={() => onSelect(node.folder.id)}
            onHover={() => onPrefetch(node.folder.id)}
            onRequestDelete={() => onRequestDelete(node.folder)}
            onNewSubfolder={() => onNewSubfolder(node.folder.id)}
          />
        </div>
      </div>
      {expanded && (
        <div>
          {node.children.map((child) => (
            <FolderTreeNode
              key={child.folder.id}
              node={child}
              depth={depth + 1}
              folderCounts={folderCounts}
              activeFolder={activeFolder}
              activeItem={activeItem}
              collapsed={collapsed}
              onToggleCollapsed={onToggleCollapsed}
              onSelect={onSelect}
              onPrefetch={onPrefetch}
              onRequestDelete={onRequestDelete}
              onNewSubfolder={onNewSubfolder}
              folderItems={folderItems}
              loadingFolderIds={loadingFolderIds}
              onLoadItems={onLoadItems}
              onOpenItem={onOpenItem}
              forceExpand={forceExpand}
            />
          ))}
          {itemCount > 0 &&
            (itemsLoading || !items ? (
              <div
                className="flex items-center gap-1.5 py-1 text-xs italic text-muted-foreground"
                style={{ paddingLeft: (depth + 1) * 12 + 20 }}
              >
                <Loader2 className="h-3 w-3 animate-spin" /> Loading…
              </div>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onOpenItem(node.folder.id, item.id, item.title)}
                  style={{ paddingLeft: (depth + 1) * 12 + 20 }}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-[13px] transition-colors",
                    activeItem === item.id
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground/70 hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {TREE_KIND_ICON[item.kind]}
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                </button>
              ))
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
  onHover,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  onHover?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "folder:unsorted" });
  return (
    <button
      ref={setNodeRef}
      onClick={onClick}
      onMouseEnter={onHover}
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
  onHover,
  onRequestDelete,
  onNewSubfolder,
}: {
  folder: DirectoryFolder;
  count: number;
  active: boolean;
  onSelect: () => void;
  onHover?: () => void;
  onRequestDelete: () => void;
  onNewSubfolder: () => void;
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
          <button onClick={onSelect} onMouseEnter={onHover} className="flex flex-1 items-center gap-2 text-left min-w-0">
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
                className="flex-1 bg-transparent text-sm max-md:text-base outline-none border-b border-primary py-0"
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
              onClick={(e) => { e.stopPropagation(); onNewSubfolder(); }}
              title="New subfolder inside this folder"
              className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-background group-hover:opacity-100"
              tabIndex={-1}
            >
              <Plus className="h-3 w-3" />
            </button>
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
        <ContextMenuItem onClick={onNewSubfolder}>
          <Plus className="mr-2 h-3.5 w-3.5" />
          New subfolder
        </ContextMenuItem>
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
