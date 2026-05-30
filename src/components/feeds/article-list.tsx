"use client";

import Link from "next/link";
import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDownUp, Check, CheckCheck, Copy, Loader2, Search, Star, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, formatRelativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  markAllReadAction,
  searchArticlesAction,
  setReadStatusAction,
  type ArticleSearchResult,
} from "@/app/(app)/feeds/actions";
import { toast } from "sonner";
import { useShortcuts } from "@/components/reader/use-shortcuts";
import Image from "next/image";

export type ArticleListItem = {
  id: string;
  title: string;
  excerpt: string | null;
  author: string | null;
  url: string;
  publishDate: Date | null;
  readStatus: "unread" | "read" | "archived";
  starred: boolean;
  imageUrl: string | null;
  feedTitle: string;
  feedIconUrl: string | null;
};

type OptimisticPatch = { id: string; readStatus?: ArticleListItem["readStatus"]; starred?: boolean };

export function ArticleList({
  items,
  itemTagsById,
  selectedId,
  view,
  feedId,
  folderId,
  onSelect,
}: {
  items: ArticleListItem[];
  itemTagsById: Record<string, string[]>;
  selectedId: string | null;
  view: "unread" | "all" | "starred";
  feedId: string | null;
  folderId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Search state
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ArticleSearchResult[] | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [optimistic, applyOptimistic] = useOptimistic(
    items,
    (state, patch: OptimisticPatch) =>
      state.map((it) => (it.id === patch.id ? { ...it, ...patch } : it)),
  );

  // Debounced search
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      const res = await searchArticlesAction({ query: q, view, feedId, folderId });
      setResults(res);
      setSearching(false);
    }, 250);
    return () => clearTimeout(handle);
  }, [query, view, feedId, folderId]);

  const displayed: ArticleListItem[] = useMemo(() => {
    if (results !== null) {
      return results.map((r) => ({ ...r }));
    }
    return optimistic;
  }, [results, optimistic]);

  function openArticle(id: string) {
    onSelect(id);
    const target = displayed.find((i) => i.id === id);
    if (target && target.readStatus !== "read") {
      startTransition(async () => {
        applyOptimistic({ id, readStatus: "read" });
        await setReadStatusAction({ articleIds: [id], status: "read" });
      });
    }
  }

  useShortcuts(
    {
      j: () => {
        if (selectedId) return;
        if (displayed[0]) openArticle(displayed[0].id);
      },
      k: () => {
        if (selectedId) return;
      },
      "/": () => {
        searchInputRef.current?.focus();
      },
    },
    !selectedId,
  );

  function markAllRead() {
    startTransition(async () => {
      // Optimistically clear unread state for currently-visible items
      const unread = displayed.filter((i) => i.readStatus === "unread");
      unread.forEach((i) => applyOptimistic({ id: i.id, readStatus: "read" }));

      const res = await markAllReadAction({ view, feedId, folderId });
      if (res.ok) {
        toast.success(`Marked ${res.count} as read`);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  const showingSearch = results !== null;

  return (
    <section
      className={cn(
        "w-full flex-col border-r border-border md:max-w-sm md:shrink-0 md:flex",
        // Mobile: hide the list when an article is open so the reader takes
        // the full screen. Desktop (md+) always shows both side-by-side.
        selectedId ? "hidden" : "flex",
      )}
    >
      {/* Search */}
      <div className="px-3 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            className="h-8 pl-8 pr-8 text-[13px]"
            placeholder="Search articles… (/)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery("");
                searchInputRef.current?.blur();
              }
            }}
          />
          {(searching || query) && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              title="Clear"
            >
              {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* View tabs + mark-all-read */}
      <div className="flex items-center justify-between px-3 py-3">
        <div className="flex items-center gap-2 text-sm">
          <ViewLink view="unread" current={view} label="Unread" />
          <ViewLink view="all" current={view} label="All" />
          <ViewLink view="starred" current={view} label="Starred" />
        </div>
        <div className="flex items-center gap-0.5">
          <SortControls />
          <Button
            size="sm"
            variant="ghost"
            onClick={markAllRead}
            title={`Mark all as read (${
              feedId ? "this feed" : folderId ? "this folder" : view === "starred" ? "starred" : "everywhere"
            })`}
            disabled={showingSearch}
          >
            <CheckCheck className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <Separator />

      {displayed.length === 0 ? (
        <div className="p-6 text-sm text-muted-foreground">
          {showingSearch ? (
            <>No articles match &ldquo;{query}&rdquo;.</>
          ) : (
            <>No articles. Try syncing your feeds.</>
          )}
        </div>
      ) : (
        <VirtualizedArticleList
          items={displayed}
          itemTagsById={itemTagsById}
          selectedId={selectedId}
          onOpen={openArticle}
        />
      )}
    </section>
  );
}

// ── Virtualized rows ──────────────────────────────────────────────────
// Renders only the rows in view + a small overscan buffer. Items vary in
// height because some have excerpts/images, so we use dynamic measurement
// via measureElement instead of a fixed estimate.

function VirtualizedArticleList({
  items,
  itemTagsById,
  selectedId,
  onOpen,
}: {
  items: ArticleListItem[];
  itemTagsById: Record<string, string[]>;
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 112,
    overscan: 6,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto">
      <div
        className="relative w-full divide-y divide-border"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const item = items[row.index];
          return (
            <div
              key={item.id}
              data-index={row.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${row.start}px)` }}
            >
              <button
                onClick={() => onOpen(item.id)}
                className={cn(
                  "flex w-full gap-3 px-4 py-4 text-left transition-colors",
                  selectedId === item.id ? "bg-accent" : "hover:bg-accent/50",
                  item.readStatus === "read" && "opacity-55",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    {item.feedIconUrl ? (
                      <Image
                        src={item.feedIconUrl}
                        alt=""
                        width={12}
                        height={12}
                        className="rounded-sm"
                        unoptimized
                      />
                    ) : null}
                    <span className="truncate">{item.feedTitle}</span>
                    <span>·</span>
                    <span className="shrink-0">{formatRelativeTime(item.publishDate)}</span>
                    {item.starred && <Star className="h-3 w-3 shrink-0 fill-current text-yellow-500" />}
                  </div>
                  <div
                    className={cn(
                      "text-[0.85rem] leading-snug tracking-[-0.005em]",
                      item.readStatus === "unread" ? "font-semibold" : "font-normal text-foreground/80",
                    )}
                  >
                    {item.title}
                  </div>
                  {item.excerpt && (
                    <div className="mt-1.5 line-clamp-2 text-[0.78rem] leading-relaxed text-muted-foreground">
                      {item.excerpt}
                    </div>
                  )}
                  {itemTagsById[item.id] && itemTagsById[item.id].length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {itemTagsById[item.id].slice(0, 5).map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center rounded-full bg-muted px-1.5 py-0 text-[10px] text-muted-foreground"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {item.imageUrl && (
                  <Image
                    src={item.imageUrl}
                    alt=""
                    width={64}
                    height={64}
                    sizes="64px"
                    className="h-16 w-16 shrink-0 rounded object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ViewLink({
  view,
  current,
  label,
}: {
  view: "unread" | "all" | "starred";
  current: "unread" | "all" | "starred";
  label: string;
}) {
  const params = useSearchParams();
  const sp = new URLSearchParams(params.toString());
  sp.set("view", view);
  sp.delete("article");
  return (
    <Link
      href={`/feeds?${sp.toString()}`}
      className={cn(
        "rounded-md px-2 py-1 text-xs",
        view === current ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
}

const SORT_LABELS: Record<string, string> = {
  newest: "Newest",
  oldest: "Oldest",
  hot: "Hot (recent)",
};

function SortControls() {
  const router = useRouter();
  const params = useSearchParams();
  const sort = params.get("sort") ?? "newest";
  const dedupe = params.get("dedupe") === "1";

  function setParam(key: string, value: string | null) {
    const sp = new URLSearchParams(params.toString());
    if (value === null) sp.delete(key);
    else sp.set(key, value);
    sp.delete("article");
    router.replace(`/feeds?${sp.toString()}`, { scroll: false });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1 px-2 text-[11px] font-medium"
          title="Sort & filter"
        >
          <ArrowDownUp className="h-3.5 w-3.5" />
          {SORT_LABELS[sort] ?? "Sort"}
          {dedupe && <span className="text-muted-foreground">· uniq</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        {(["newest", "oldest", "hot"] as const).map((s) => (
          <DropdownMenuItem
            key={s}
            onClick={() => setParam("sort", s === "newest" ? null : s)}
            className="flex items-center justify-between"
          >
            {SORT_LABELS[s]}
            {sort === s && <Check className="h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={dedupe}
          onCheckedChange={(c) => setParam("dedupe", c ? "1" : null)}
        >
          <Copy className="mr-2 h-3.5 w-3.5" />
          Hide duplicates
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
