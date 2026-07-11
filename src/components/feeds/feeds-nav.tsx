"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useSearchParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Compass,
  Download,
  ExternalLink,
  FolderClosed,
  Inbox,
  Pencil,
  Plus,
  RefreshCw,
  Rss,
  Star,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { AddFeedDialog } from "./add-feed-dialog";
import { ImportOpmlDialog } from "./import-opml-dialog";
import { FeedDiscoveryDialog } from "./feed-discovery-dialog";
import {
  createFolderAction,
  deleteFeedAction,
  deleteFolderAction,
  markFolderReadAction,
  moveFeedToFolderAction,
  renameFeedAction,
  renameFolderAction,
  syncAllAction,
  syncFeedAction,
} from "@/app/(app)/feeds/actions";
import { toast } from "sonner";
import type { Feed as DbFeed, Folder } from "@/lib/db/schema";

/**
 * Slim projection of a feed row — everything the nav renders. The layout
 * selects only these columns so the RSC payload doesn't ship etag/description/
 * fetch-bookkeeping fields for every feed on every navigation.
 */
export type NavFeed = Pick<DbFeed, "id" | "folderId" | "title" | "url" | "siteUrl" | "iconUrl" | "lastError">;
type Feed = NavFeed;

type UnreadCounts = {
  perFeed: Record<string, number>;
  perFolder: Record<string, number>;
};

const COLLAPSE_KEY = "feedsNav.collapsed.v1";

export function FeedsNav({
  folders,
  feeds,
  unread,
}: {
  folders: Folder[];
  feeds: Feed[];
  unread: UnreadCounts;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Dedicated transition for feed/folder/view navigation. Using a transition for
  // the router.push keeps the CURRENT article list on screen (instead of flashing
  // the loading.tsx skeleton) while the next page streams in — the switch feels
  // instant. `navPending` + `optimistic` drive an immediate selection highlight.
  const [navPending, startNav] = useTransition();
  const [optimistic, setOptimistic] = useState<{
    feed: string | null;
    folder: string | null;
    view: string;
  } | null>(null);
  // Dedicated flag so the Sync-all spinner doesn't spin on unrelated transitions
  // (create folder, move feed, …) that also flip the shared `pending`.
  const [syncing, setSyncing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [draggingFeed, setDraggingFeed] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | "uncategorized" | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const newFolderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      if (raw) setCollapsed(JSON.parse(raw));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed));
    } catch {}
  }, [collapsed]);

  function toggleFolder(id: string) {
    setCollapsed((m) => ({ ...m, [id]: !m[id] }));
  }

  // While a navigation is in flight, reflect the clicked target immediately so
  // the highlight doesn't lag behind the (slower) server round-trip.
  const activeFeed = optimistic ? optimistic.feed : params.get("feed");
  const activeFolder = optimistic ? optimistic.folder : params.get("folder");
  const view = optimistic ? optimistic.view : params.get("view") ?? "unread";
  const totalUnread = Object.values(unread.perFeed).reduce((a, b) => a + b, 0);
  const uncategorizedFeeds = feeds.filter((f) => !f.folderId);

  // Once the navigation settles, drop the optimistic override so the highlight
  // tracks the real URL again.
  useEffect(() => {
    if (!navPending) setOptimistic(null);
  }, [navPending]);

  function hrefFor(next: Record<string, string | null>): string {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null) sp.delete(k);
      else sp.set(k, v);
    }
    sp.delete("article");
    return `/feeds?${sp.toString()}`;
  }

  function setQuery(next: Record<string, string | null>) {
    setOptimistic({
      feed: "feed" in next ? next.feed : params.get("feed"),
      folder: "folder" in next ? next.folder : params.get("folder"),
      view: next.view ?? params.get("view") ?? "unread",
    });
    startNav(() => router.push(hrefFor(next)));
  }

  // Warm the target route on hover so the click resolves from cache.
  function prefetchQuery(next: Record<string, string | null>) {
    router.prefetch(hrefFor(next));
  }

  function onDropToFolder(folderId: string | null) {
    if (!draggingFeed) return;
    const feedId = draggingFeed;
    setDraggingFeed(null);
    setDropTarget(null);
    startTransition(async () => {
      try {
        await moveFeedToFolderAction(feedId, folderId);
        toast.success(folderId ? "Moved to folder" : "Moved to Uncategorized");
      } catch (err) {
        toast.error(`Move failed: ${err instanceof Error ? err.message : "error"}`);
      }
    });
  }

  async function syncAll() {
    if (syncing) return;
    setSyncing(true);
    const toastId = toast.loading("Syncing feeds…");
    let totalSynced = 0;
    let totalFailed = 0;
    try {
      // Each call is time-boxed (~8s) and processes the stalest feeds first, so
      // loop until nothing is left. Cap iterations as a safety net.
      for (let i = 0; i < 25; i += 1) {
        const r = await syncAllAction();
        if (!r.ok) {
          if ("alreadyRunning" in r) {
            toast.info("A sync is already running — hang tight.", { id: toastId });
          } else {
            toast.error(`Sync failed: ${r.error}`, { id: toastId });
          }
          return;
        }
        totalSynced += r.synced;
        totalFailed += r.failed;
        if (r.remaining <= 0) break;
        toast.loading(`Syncing feeds… ${r.remaining} left`, { id: toastId });
      }
      toast.success(
        `Synced ${totalSynced} feed${totalSynced === 1 ? "" : "s"}` +
          (totalFailed > 0 ? ` · ${totalFailed} failed (see ⚠ in list)` : ""),
        { id: toastId },
      );
    } catch (err) {
      toast.error(`Sync failed: ${err instanceof Error ? err.message : "unknown error"}.`, { id: toastId });
    } finally {
      setSyncing(false);
    }
  }

  function startCreateFolder() {
    setNewFolderName("");
    setCreatingFolder(true);
    setTimeout(() => newFolderRef.current?.focus(), 20);
  }

  function commitCreateFolder() {
    setCreatingFolder(false);
    if (!newFolderName.trim()) return;
    const name = newFolderName.trim();
    startTransition(async () => {
      const r = await createFolderAction(name);
      if (r.ok) toast.success(`Folder "${name}" created`);
      else toast.error(r.error);
    });
  }

  return (
    <aside className="flex h-full w-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3">
        <div className="text-sm font-semibold">Feeds</div>
        <div className="flex items-center gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            disabled={syncing}
            onClick={syncAll}
            title="Sync all"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setDiscoverOpen(true)}
            title="Discover feeds"
          >
            <Compass className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setImportOpen(true)}
            title="Import OPML"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setAddOpen(true)}
            title="Add feed"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <Separator />

      <ScrollArea className="flex-1">
        <nav className="space-y-0.5 p-2 text-sm">
          <NavRow
            label="All unread"
            icon={<Inbox className="h-4 w-4" />}
            count={totalUnread}
            active={!activeFeed && !activeFolder && view === "unread"}
            onClick={() => setQuery({ feed: null, folder: null, view: "unread" })}
            onHover={() => prefetchQuery({ feed: null, folder: null, view: "unread" })}
          />
          <NavRow
            label="Starred"
            icon={<Star className="h-4 w-4" />}
            count={0}
            active={view === "starred"}
            onClick={() => setQuery({ feed: null, folder: null, view: "starred" })}
            onHover={() => prefetchQuery({ feed: null, folder: null, view: "starred" })}
          />

          {/* Folders section header */}
          <div className="flex items-center justify-between px-3 pb-1 pt-4">
            {creatingFolder ? (
              <input
                ref={newFolderRef}
                className="flex-1 bg-transparent text-[10px] uppercase tracking-wider outline-none border-b border-primary py-0.5"
                placeholder="Folder name…"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onBlur={commitCreateFolder}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); commitCreateFolder(); }
                  if (e.key === "Escape") setCreatingFolder(false);
                }}
              />
            ) : (
              <>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {folders.length > 0 ? "Folders" : ""}
                </span>
                <button
                  onClick={startCreateFolder}
                  title="New folder"
                  className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </>
            )}
          </div>

          {/* Folder rows */}
          {folders.map((folder) => (
            <FolderSection
              key={folder.id}
              folder={folder}
              folderFeeds={feeds.filter((f) => f.folderId === folder.id)}
              allFolders={folders}
              unread={unread}
              // Default to collapsed (undefined === not-yet-toggled) so opening
              // Feeds shows a tidy folder list; an explicit expand is remembered.
              collapsed={collapsed[folder.id] ?? true}
              onToggle={() => toggleFolder(folder.id)}
              isDropTarget={dropTarget === folder.id}
              draggingFeed={draggingFeed}
              activeFeed={activeFeed}
              activeFolder={activeFolder}
              onDragOver={(e) => {
                if (draggingFeed) { e.preventDefault(); setDropTarget(folder.id); }
              }}
              onDragLeave={() => dropTarget === folder.id && setDropTarget(null)}
              onDrop={(e) => { e.preventDefault(); onDropToFolder(folder.id); }}
              onSelectFolder={() => setQuery({ feed: null, folder: folder.id, view: "unread" })}
              onSelectFeed={(feedId) => setQuery({ feed: feedId, folder: null, view: "unread" })}
              onPrefetchFolder={() => prefetchQuery({ feed: null, folder: folder.id, view: "unread" })}
              onPrefetchFeed={(feedId) => prefetchQuery({ feed: feedId, folder: null, view: "unread" })}
              onFeedDragStart={(feedId) => setDraggingFeed(feedId)}
              onFeedDragEnd={() => { setDraggingFeed(null); setDropTarget(null); }}
            />
          ))}

          {/* Uncategorized */}
          <div
            onDragOver={(e) => {
              if (draggingFeed) { e.preventDefault(); setDropTarget("uncategorized"); }
            }}
            onDragLeave={() => dropTarget === "uncategorized" && setDropTarget(null)}
            onDrop={(e) => { e.preventDefault(); onDropToFolder(null); }}
            className={cn(
              "mt-1 rounded-md transition-colors",
              dropTarget === "uncategorized" && "ring-2 ring-primary",
            )}
          >
            {(uncategorizedFeeds.length > 0 || feeds.length === 0) && (
              <div className="px-3 pb-1 pt-3 text-[10px] uppercase tracking-wider text-muted-foreground">
                {folders.length > 0 ? "Uncategorized" : "Feeds"}
              </div>
            )}

            {uncategorizedFeeds.length === 0 && feeds.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                No feeds yet.{" "}
                <button
                  className="underline hover:text-foreground"
                  onClick={() => setDiscoverOpen(true)}
                >
                  Discover feeds
                </button>{" "}
                or click + to add one.
              </div>
            )}
            {uncategorizedFeeds.length === 0 && feeds.length > 0 && folders.length > 0 && (
              <div className="px-3 py-1 text-xs italic text-muted-foreground">
                Drop a feed here to remove from folder
              </div>
            )}
            {uncategorizedFeeds.map((feed) => (
              <FeedRow
                key={feed.id}
                feed={feed}
                count={unread.perFeed[feed.id] ?? 0}
                active={activeFeed === feed.id}
                dragging={draggingFeed === feed.id}
                onDragStart={() => setDraggingFeed(feed.id)}
                onDragEnd={() => { setDraggingFeed(null); setDropTarget(null); }}
                onClick={() => setQuery({ feed: feed.id, folder: null, view: "unread" })}
                onHover={() => prefetchQuery({ feed: feed.id, folder: null, view: "unread" })}
                folders={folders}
              />
            ))}
          </div>
        </nav>
      </ScrollArea>

      <AddFeedDialog open={addOpen} onOpenChange={setAddOpen} folders={folders} />
      <ImportOpmlDialog open={importOpen} onOpenChange={setImportOpen} />
      <FeedDiscoveryDialog
        open={discoverOpen}
        onOpenChange={setDiscoverOpen}
        followedUrls={feeds.map((f) => f.url)}
      />
    </aside>
  );
}

// ── Folder section ────────────────────────────────────────────────────

function FolderSection({
  folder,
  folderFeeds,
  allFolders,
  unread,
  collapsed,
  onToggle,
  isDropTarget,
  draggingFeed,
  activeFeed,
  activeFolder,
  onDragOver,
  onDragLeave,
  onDrop,
  onSelectFolder,
  onSelectFeed,
  onPrefetchFolder,
  onPrefetchFeed,
  onFeedDragStart,
  onFeedDragEnd,
}: {
  folder: Folder;
  folderFeeds: Feed[];
  allFolders: Folder[];
  unread: UnreadCounts;
  collapsed: boolean;
  onToggle: () => void;
  isDropTarget: boolean;
  draggingFeed: string | null;
  activeFeed: string | null;
  activeFolder: string | null;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onSelectFolder: () => void;
  onSelectFeed: (feedId: string) => void;
  onPrefetchFolder: () => void;
  onPrefetchFeed: (feedId: string) => void;
  onFeedDragStart: (feedId: string) => void;
  onFeedDragEnd: () => void;
}) {
  const [, startTransition] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);
  const inputRef = useRef<HTMLInputElement>(null);

  function startRename() {
    setRenameValue(folder.name);
    setRenaming(true);
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 20);
  }

  function commitRename() {
    setRenaming(false);
    if (renameValue.trim() && renameValue.trim() !== folder.name) {
      const name = renameValue.trim();
      startTransition(async () => {
        const r = await renameFolderAction(folder.id, name);
        if (!r.ok) toast.error(r.error);
      });
    }
  }

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={cn(
              "group flex items-center gap-1 rounded-md transition-colors",
              activeFolder === folder.id && "bg-accent",
              isDropTarget && "ring-2 ring-primary",
            )}
          >
            <button
              onClick={onToggle}
              className="rounded p-1 text-muted-foreground hover:bg-background transition-colors"
              title={collapsed ? "Expand" : "Collapse"}
            >
              {collapsed ? (
                <ChevronRight className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
            <button
              onClick={onSelectFolder}
              onMouseEnter={onPrefetchFolder}
              className="flex flex-1 items-center gap-2 px-1 py-1.5 text-left"
            >
              <FolderClosed className="h-4 w-4 shrink-0 text-muted-foreground" />
              {renaming ? (
                <input
                  ref={inputRef}
                  className="flex-1 bg-transparent border-b border-primary outline-none text-sm py-0"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
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
              {!renaming && (unread.perFolder[folder.id] ?? 0) > 0 && (
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {unread.perFolder[folder.id]}
                </span>
              )}
            </button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuLabel className="max-w-[180px] truncate">{folder.name}</ContextMenuLabel>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={startRename}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Rename folder
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() =>
              startTransition(async () => {
                try {
                  await markFolderReadAction(folder.id);
                  toast.success("Marked all as read");
                } catch (err) {
                  toast.error(`Couldn't mark read: ${err instanceof Error ? err.message : "error"}`);
                }
              })
            }
          >
            <CheckCheck className="mr-2 h-3.5 w-3.5" />
            Mark all as read
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => {
              if (!confirm(`Delete folder "${folder.name}"?\n\nFeeds inside will be moved to Uncategorized.`)) return;
              startTransition(async () => {
                try {
                  await deleteFolderAction(folder.id);
                  toast.success("Folder deleted");
                } catch (err) {
                  toast.error(`Delete failed: ${err instanceof Error ? err.message : "error"}`);
                }
              });
            }}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Delete folder
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {!collapsed && (
        <div className="ml-4 border-l border-border/50 pl-1">
          {folderFeeds.length === 0 && (
            <div className="px-3 py-1 text-xs italic text-muted-foreground">
              Empty — drag a feed here
            </div>
          )}
          {folderFeeds.map((feed) => (
            <FeedRow
              key={feed.id}
              feed={feed}
              count={unread.perFeed[feed.id] ?? 0}
              active={activeFeed === feed.id}
              dragging={draggingFeed === feed.id}
              onDragStart={() => onFeedDragStart(feed.id)}
              onDragEnd={onFeedDragEnd}
              onClick={() => onSelectFeed(feed.id)}
              onHover={() => onPrefetchFeed(feed.id)}
              folders={allFolders}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Feed row ──────────────────────────────────────────────────────────

function FeedRow({
  feed,
  count,
  active,
  dragging,
  onDragStart,
  onDragEnd,
  onClick,
  onHover,
  folders,
}: {
  feed: Feed;
  count: number;
  active: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
  onHover?: () => void;
  folders: Folder[];
}) {
  const [pending, startTransition] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(feed.title);
  const inputRef = useRef<HTMLInputElement>(null);

  function startRename() {
    setRenameValue(feed.title);
    setRenaming(true);
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 20);
  }

  function commitRename() {
    setRenaming(false);
    if (renameValue.trim() && renameValue.trim() !== feed.title) {
      const title = renameValue.trim();
      startTransition(async () => {
        const r = await renameFeedAction(feed.id, title);
        if (!r.ok) toast.error(r.error);
      });
    }
  }

  function resync() {
    startTransition(async () => {
      const toastId = toast.loading(`Re-syncing ${feed.title}…`);
      try {
        const r = await syncFeedAction(feed.id);
        if (r.errored) toast.error(`Sync failed: ${r.error}`, { id: toastId });
        else
          toast.success(`Synced — ${r.inserted} new article${r.inserted === 1 ? "" : "s"}`, {
            id: toastId,
          });
      } catch (err) {
        toast.error(`Sync failed: ${err instanceof Error ? err.message : "unknown error"}`, {
          id: toastId,
        });
      }
    });
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", feed.id);
            onDragStart();
          }}
          onDragEnd={onDragEnd}
          onMouseEnter={onHover}
          className={cn(
            "group flex items-center gap-2 rounded-md pr-1 transition-colors",
            active ? "bg-accent" : "hover:bg-accent/60",
            dragging && "opacity-40",
          )}
        >
          {/* Label is a button (or the rename input) — kept a SIBLING of the
              retry control + count, never their parent, so we don't nest
              interactive elements inside a <button> (invalid HTML / hydration). */}
          {renaming ? (
            <div className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5">
              {feed.iconUrl ? (
                <Image src={feed.iconUrl} alt="" width={16} height={16} className="shrink-0 rounded-sm" unoptimized />
              ) : (
                <Rss className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <input
                ref={inputRef}
                className="min-w-0 flex-1 border-b border-primary bg-transparent py-0 text-sm outline-none"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                  if (e.key === "Escape") setRenaming(false);
                }}
              />
            </div>
          ) : (
            <button onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left">
              {feed.iconUrl ? (
                <Image src={feed.iconUrl} alt="" width={16} height={16} className="shrink-0 rounded-sm" unoptimized />
              ) : (
                <Rss className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="flex-1 truncate text-sm">{feed.title}</span>
            </button>
          )}
          {!renaming && feed.lastError && (
            <button
              onClick={(e) => { e.stopPropagation(); resync(); }}
              className="shrink-0 rounded p-0.5 hover:bg-accent"
              title={`Last sync failed: ${feed.lastError}. Click to retry.`}
            >
              <AlertTriangle className={cn("h-3.5 w-3.5 text-amber-500", pending && "animate-pulse")} />
            </button>
          )}
          {!renaming && count > 0 && (
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{count}</span>
          )}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuLabel className="max-w-[200px] truncate">{feed.title}</ContextMenuLabel>
        <ContextMenuSeparator />
        {feed.siteUrl && (
          <ContextMenuItem onClick={() => window.open(feed.siteUrl!, "_blank")}>
            <ExternalLink className="mr-2 h-3.5 w-3.5" />
            Open website
          </ContextMenuItem>
        )}
        <ContextMenuItem
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              try {
                const r = await syncFeedAction(feed.id);
                if (r.errored) toast.error(`Sync failed: ${r.error}`);
                else toast.success(`Synced — ${r.inserted} new article${r.inserted === 1 ? "" : "s"}`);
              } catch (err) {
                toast.error(
                  `Sync failed: ${err instanceof Error ? err.message : "unknown error"}`,
                );
              }
            })
          }
        >
          <RefreshCw className={cn("mr-2 h-3.5 w-3.5", pending && "animate-spin")} />
          Sync feed
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={startRename}>
          <Pencil className="mr-2 h-3.5 w-3.5" />
          Rename
        </ContextMenuItem>
        {folders.length > 0 && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <FolderClosed className="mr-2 h-3.5 w-3.5" />
              Move to folder
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem
                onClick={() =>
                  startTransition(async () => {
                    try {
                      await moveFeedToFolderAction(feed.id, null);
                      toast.success("Moved to Uncategorized");
                    } catch (err) {
                      toast.error(`Move failed: ${err instanceof Error ? err.message : "error"}`);
                    }
                  })
                }
              >
                <span className="text-muted-foreground">— Uncategorized</span>
              </ContextMenuItem>
              <ContextMenuSeparator />
              {folders.map((folder) => (
                <ContextMenuItem
                  key={folder.id}
                  onClick={() =>
                    startTransition(async () => {
                      try {
                        await moveFeedToFolderAction(feed.id, folder.id);
                        toast.success(`Moved to ${folder.name}`);
                      } catch (err) {
                        toast.error(`Move failed: ${err instanceof Error ? err.message : "error"}`);
                      }
                    })
                  }
                >
                  <FolderClosed className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                  {folder.name}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => {
            if (!confirm(`Remove "${feed.title}"? Articles will also be deleted.`)) return;
            startTransition(async () => {
              try {
                await deleteFeedAction(feed.id);
                toast.success("Feed removed");
              } catch (err) {
                toast.error(`Remove failed: ${err instanceof Error ? err.message : "error"}`);
              }
            });
          }}
        >
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          Remove feed
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ── Nav row ───────────────────────────────────────────────────────────

function NavRow({
  label,
  icon,
  count,
  active,
  onClick,
  onHover,
}: {
  label: string;
  icon: React.ReactNode;
  count: number;
  active: boolean;
  onClick: () => void;
  onHover?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={onHover}
      className={cn(
        "group flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {count > 0 && (
        <span className="text-[11px] tabular-nums text-muted-foreground group-hover:text-accent-foreground">
          {count}
        </span>
      )}
    </button>
  );
}
