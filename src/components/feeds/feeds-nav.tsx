"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Download, Inbox, Plus, RefreshCw, Rss, Star, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { AddFeedDialog } from "./add-feed-dialog";
import { ImportOpmlDialog } from "./import-opml-dialog";
import {
  deleteFeedAction,
  syncAllAction,
  syncFeedAction,
} from "@/app/(app)/feeds/actions";
import { toast } from "sonner";
import type { Feed, Folder } from "@/lib/db/schema";

type UnreadCounts = {
  perFeed: Record<string, number>;
  perFolder: Record<string, number>;
};

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
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const activeFeed = params.get("feed");
  const activeFolder = params.get("folder");
  const view = params.get("view") ?? "unread";

  const inboxFeeds = feeds.filter((f) => !f.folderId);
  const totalUnread = Object.values(unread.perFeed).reduce((a, b) => a + b, 0);

  function setQuery(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null) sp.delete(k);
      else sp.set(k, v);
    }
    sp.delete("article");
    router.push(`/feeds?${sp.toString()}`);
  }

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border md:flex">
      <div className="flex items-center justify-between px-3 py-3">
        <div className="text-sm font-semibold">Feeds</div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await syncAllAction();
                toast.success("Synced all feeds");
              })
            }
            title="Sync all feeds"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", pending && "animate-spin")} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setImportOpen(true)}
            title="Import OPML (from Inoreader, Feedly, etc.)"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setOpen(true)}
            title="Add feed"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <Separator />
      <ScrollArea className="flex-1">
        <nav className="p-2 space-y-0.5 text-sm">
          <NavRow
            label="All unread"
            icon={<Inbox className="h-4 w-4" />}
            count={totalUnread}
            active={!activeFeed && !activeFolder && view === "unread"}
            onClick={() => setQuery({ feed: null, folder: null, view: "unread" })}
          />
          <NavRow
            label="Starred"
            icon={<Star className="h-4 w-4" />}
            count={0}
            active={view === "starred"}
            onClick={() => setQuery({ feed: null, folder: null, view: "starred" })}
          />

          <div className="px-3 pt-4 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Folders
          </div>
          {folders.length === 0 && (
            <div className="px-3 py-1 text-xs text-muted-foreground">No folders yet.</div>
          )}
          {folders.map((folder) => (
            <NavRow
              key={folder.id}
              label={folder.name}
              icon={<span className="h-4 w-4" />}
              count={unread.perFolder[folder.id] ?? 0}
              active={activeFolder === folder.id}
              onClick={() => setQuery({ feed: null, folder: folder.id, view: "unread" })}
            />
          ))}

          <div className="px-3 pt-4 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            {folders.length > 0 ? "Uncategorized" : "Feeds"}
          </div>
          {inboxFeeds.length === 0 && feeds.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              No feeds yet. Click + to add one.
            </div>
          )}
          {(folders.length > 0 ? inboxFeeds : feeds).map((feed) => (
            <FeedRow
              key={feed.id}
              feed={feed}
              count={unread.perFeed[feed.id] ?? 0}
              active={activeFeed === feed.id}
              onClick={() => setQuery({ feed: feed.id, folder: null, view: "unread" })}
            />
          ))}

          {folders.length > 0 && (
            <>
              <Separator className="my-2" />
              {folders.map((folder) => {
                const folderFeeds = feeds.filter((f) => f.folderId === folder.id);
                if (folderFeeds.length === 0) return null;
                return (
                  <div key={`grp-${folder.id}`} className="mt-2">
                    <div className="px-3 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                      {folder.name}
                    </div>
                    {folderFeeds.map((feed) => (
                      <FeedRow
                        key={feed.id}
                        feed={feed}
                        count={unread.perFeed[feed.id] ?? 0}
                        active={activeFeed === feed.id}
                        onClick={() => setQuery({ feed: feed.id, folder: null, view: "unread" })}
                      />
                    ))}
                  </div>
                );
              })}
            </>
          )}
        </nav>
      </ScrollArea>
      <AddFeedDialog open={open} onOpenChange={setOpen} folders={folders} />
      <ImportOpmlDialog open={importOpen} onOpenChange={setImportOpen} />
    </aside>
  );
}

function NavRow({
  label,
  icon,
  count,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
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

function FeedRow({
  feed,
  count,
  active,
  onClick,
}: {
  feed: Feed;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md pr-1 transition-colors",
        active ? "bg-accent" : "hover:bg-accent",
      )}
    >
      <button onClick={onClick} className="flex flex-1 items-center gap-2 px-3 py-1.5 text-left">
        {feed.iconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={feed.iconUrl} alt="" className="h-4 w-4 rounded-sm" />
        ) : (
          <Rss className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="flex-1 truncate text-sm">{feed.title}</span>
        {count > 0 && <span className="text-[11px] tabular-nums text-muted-foreground">{count}</span>}
      </button>
      <button
        title="Sync"
        disabled={pending}
        className="opacity-0 group-hover:opacity-100 rounded p-1 hover:bg-background"
        onClick={(e) => {
          e.stopPropagation();
          startTransition(async () => {
            const r = await syncFeedAction(feed.id);
            if (r.errored) toast.error(`Sync failed: ${r.error}`);
            else toast.success(`+${r.inserted} new`);
          });
        }}
      >
        <RefreshCw className={cn("h-3 w-3", pending && "animate-spin")} />
      </button>
      <button
        title="Remove"
        className="opacity-0 group-hover:opacity-100 rounded p-1 hover:bg-background"
        onClick={(e) => {
          e.stopPropagation();
          if (!confirm(`Remove "${feed.title}"?`)) return;
          startTransition(async () => {
            await deleteFeedAction(feed.id);
            toast.success("Feed removed");
          });
        }}
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}
