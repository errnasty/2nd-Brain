"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlignJustify, ArrowDownUp, Bookmark, Check, CheckCheck, ChevronLeft, Copy, Inbox, Loader2, Search, Star, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { FeedsBulkBar } from "@/components/feeds/feeds-bulk-bar";
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
import {
  loadMoreArticlesAction,
  markAllReadAction,
  searchArticlesAction,
  setReadLaterAction,
  setReadStatusAction,
  toggleStarredAction,
  type ArticleSearchResult,
} from "@/app/(app)/feeds/actions";

const FEED_PAGE_SIZE = 100;
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
  readLater: boolean;
  wordCount: number | null;
  imageUrl: string | null;
  feedTitle: string;
  feedIconUrl: string | null;
};

/** Estimated read time at ~220 wpm. Returns null for missing/trivial counts. */
function readMinutes(wordCount: number | null): number | null {
  if (!wordCount || wordCount < 80) return null;
  return Math.max(1, Math.round(wordCount / 220));
}

type OptimisticPatch = {
  id: string;
  readStatus?: ArticleListItem["readStatus"];
  starred?: boolean;
  readLater?: boolean;
};

const VIEW_META: Record<"unread" | "all" | "starred" | "readlater", { label: string; meta: string }> = {
  unread: { label: "Unread", meta: "Newest first" },
  all: { label: "All articles", meta: "Inbox + read" },
  starred: { label: "Starred", meta: "Favorites" },
  readlater: { label: "Read later", meta: "Saved queue" },
};

export function ArticleList({
  items,
  itemTagsById,
  selectedId,
  view,
  feedId,
  folderId,
  onSelect,
  collapsed = false,
}: {
  items: ArticleListItem[];
  itemTagsById: Record<string, string[]>;
  selectedId: string | null;
  view: "unread" | "all" | "starred" | "readlater";
  feedId: string | null;
  folderId: string | null;
  onSelect: (id: string | null) => void;
  /** Hide the list on desktop (an article is open and the reader is widened). */
  collapsed?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Search state
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ArticleSearchResult[] | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Infinite scroll: `items` is the first server page; `extra` holds appended
  // pages. A reset effect below drops `extra` whenever the server page changes
  // (new scope or router.refresh), so we never show stale appended rows.
  const params = useSearchParams();
  const sort = (params.get("sort") as "newest" | "oldest" | "hot" | null) ?? "newest";
  const [extra, setExtra] = useState<ArticleListItem[]>([]);
  const [hasMore, setHasMore] = useState(items.length >= FEED_PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setExtra([]);
    setHasMore(items.length >= FEED_PAGE_SIZE);
  }, [items]);

  const allItems = useMemo(() => {
    if (extra.length === 0) return items;
    // Guard against a duplicate id sneaking across a page boundary.
    const seen = new Set(items.map((i) => i.id));
    return [...items, ...extra.filter((e) => !seen.has(e.id))];
  }, [items, extra]);

  const [optimistic, applyOptimistic] = useOptimistic(
    allItems,
    (state, patch: OptimisticPatch) =>
      state.map((it) => (it.id === patch.id ? { ...it, ...patch } : it)),
  );

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res = await loadMoreArticlesAction({
        view,
        feedId,
        folderId,
        sort,
        offset: items.length + extra.length,
      });
      setExtra((prev) => [...prev, ...res.items]);
      setHasMore(res.hasMore);
    } catch {
      setHasMore(false); // stop hammering a failing endpoint
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, view, feedId, folderId, sort, items.length, extra.length]);

  // Row density (compact vs comfortable), persisted locally.
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    try {
      setCompact(localStorage.getItem("feeds.compact.v1") === "1");
    } catch {
      // ignore
    }
  }, []);
  function toggleCompact() {
    setCompact((v) => {
      const next = !v;
      try {
        localStorage.setItem("feeds.compact.v1", next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  // Multi-select for bulk actions.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const clearSelection = () => setSelected(new Set());
  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Drop the selection whenever the list scope changes (different feed/folder/
  // view) — those ids may no longer be on screen.
  useEffect(() => {
    setSelected(new Set());
  }, [view, feedId, folderId]);

  const selectedIds = useMemo(() => [...selected], [selected]);

  // Restore a set of articles to their prior read-status (used by Undo).
  const restoreStatuses = useCallback(
    (prior: { id: string; status: ArticleListItem["readStatus"] }[]) => {
      startTransition(async () => {
        prior.forEach((p) => applyOptimistic({ id: p.id, readStatus: p.status }));
        const byStatus = new Map<ArticleListItem["readStatus"], string[]>();
        prior.forEach((p) => byStatus.set(p.status, [...(byStatus.get(p.status) ?? []), p.id]));
        await Promise.all(
          [...byStatus].map(([status, ids]) => setReadStatusAction({ articleIds: ids, status })),
        );
        router.refresh();
      });
    },
    [applyOptimistic, router],
  );

  function bulkSetStatus(status: ArticleListItem["readStatus"], verb: string) {
    if (selectedIds.length === 0) return;
    const ids = selectedIds;
    const prior = ids.map((id) => ({
      id,
      status: optimistic.find((it) => it.id === id)?.readStatus ?? "unread",
    }));
    startTransition(async () => {
      ids.forEach((id) => applyOptimistic({ id, readStatus: status }));
      const res = await setReadStatusAction({ articleIds: ids, status });
      if (res.ok) {
        toast.success(`${verb} ${ids.length} article${ids.length === 1 ? "" : "s"}`, {
          action: { label: "Undo", onClick: () => restoreStatuses(prior) },
        });
        clearSelection();
        if (status === "archived") router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  const prefetched = useRef<Set<string>>(new Set());
  const prefetch = useCallback((id: string) => {
    if (prefetched.current.has(id)) return;
    prefetched.current.add(id);
    fetch(`/api/articles/${id}/full-text`, { method: "POST" }).catch(() => {});
  }, []);

  const markReadOne = useCallback(
    (id: string) => {
      startTransition(() => applyOptimistic({ id, readStatus: "read" }));
      setReadStatusAction({ articleIds: [id], status: "read" }).catch(() => {});
    },
    [applyOptimistic],
  );

  const autoReadPending = useRef<Set<string>>(new Set());
  const autoReadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onAutoRead = useCallback(
    (ids: string[]) => {
      const fresh = ids.filter((id) => !autoReadPending.current.has(id));
      if (fresh.length === 0) return;
      startTransition(() => {
        fresh.forEach((id) => {
          autoReadPending.current.add(id);
          applyOptimistic({ id, readStatus: "read" });
        });
      });
      if (autoReadTimer.current) clearTimeout(autoReadTimer.current);
      autoReadTimer.current = setTimeout(() => {
        const batch = [...autoReadPending.current];
        autoReadPending.current.clear();
        if (batch.length > 0) setReadStatusAction({ articleIds: batch, status: "read" }).catch(() => {});
      }, 800);
    },
    [applyOptimistic],
  );

  function toggleReadLater(id: string, current: boolean) {
    startTransition(async () => {
      applyOptimistic({ id, readLater: !current });
      await setReadLaterAction({ articleIds: [id], readLater: !current });
    });
  }

  function bulkStar() {
    if (selectedIds.length === 0) return;
    const ids = selectedIds;
    const prior = ids.map((id) => ({ id, starred: optimistic.find((it) => it.id === id)?.starred ?? false }));
    startTransition(async () => {
      ids.forEach((id) => applyOptimistic({ id, starred: true }));
      try {
        await Promise.all(ids.map((id) => toggleStarredAction(id, true)));
        toast.success(`Starred ${ids.length} article${ids.length === 1 ? "" : "s"}`);
        clearSelection();
      } catch (e) {
        prior.forEach((p) => applyOptimistic({ id: p.id, starred: p.starred }));
        toast.error(`Couldn't star: ${e instanceof Error ? e.message : "error"}`);
      }
    });
  }

  function bulkReadLater() {
    if (selectedIds.length === 0) return;
    const ids = selectedIds;
    const prior = ids.map((id) => ({ id, readLater: optimistic.find((it) => it.id === id)?.readLater ?? false }));
    startTransition(async () => {
      ids.forEach((id) => applyOptimistic({ id, readLater: true }));
      try {
        const res = await setReadLaterAction({ articleIds: ids, readLater: true });
        if (res && typeof res === "object" && "ok" in res && !res.ok) {
          throw new Error((res as { error?: string }).error ?? "Couldn't save");
        }
        toast.success(`Saved ${ids.length} to Read Later`);
        clearSelection();
      } catch (e) {
        prior.forEach((p) => applyOptimistic({ id: p.id, readLater: p.readLater }));
        toast.error(`Couldn't save: ${e instanceof Error ? e.message : "error"}`);
      }
    });
  }

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
  const meta = VIEW_META[view];

  return (
    <section
      className={cn(
        "w-full flex-col border-r border-border md:max-w-sm md:shrink-0",
        selectedId ? "hidden" : "flex",
        // Collapse on desktop too when an article is open and the reader is widened.
        collapsed && selectedId ? "md:hidden" : "md:flex",
      )}
    >
      {/* Mobile back */}
      <button
        onClick={() => router.push("/feeds")}
        className="flex items-center gap-1 px-3 pt-3 text-xs text-muted-foreground hover:text-foreground md:hidden"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> Folders
      </button>

      {/* ── Editorial header ──────────────────────────────────────── */}
      <header className="border-b border-border px-4 pb-3 pt-4">
        <div className="mb-1.5 editorial-eyebrow">
          Feeds · {meta.meta}
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <h2
            className="editorial-display m-0 truncate"
            style={{ fontSize: "1.35rem", letterSpacing: "-0.018em" }}
          >
            {meta.label}
          </h2>
          <span className="font-mono text-[10px] tabular-nums" style={{ color: "hsl(var(--brand))" }}>
            {showingSearch ? `${displayed.length} matches` : `${displayed.length}${hasMore ? "+" : ""}`}
          </span>
        </div>
      </header>

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

      {/* View tabs + sort */}
      <div className="flex items-center justify-between px-3 py-3">
        <div className="flex items-center gap-1 text-sm">
          <ViewLink view="unread" current={view} label="Unread" />
          <ViewLink view="all" current={view} label="All" />
          <ViewLink view="starred" current={view} label="Starred" />
          <ViewLink view="readlater" current={view} label="Read Later" />
        </div>
        <div className="flex items-center gap-0.5">
          <SortControls compact={compact} onToggleCompact={toggleCompact} />
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
      <div className="h-px bg-border" />

      {displayed.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          {showingSearch ? (
            <>
              <Search className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                No articles match &ldquo;{query}&rdquo;.
              </p>
              <Button size="sm" variant="outline" onClick={() => setQuery("")}>
                Clear search
              </Button>
            </>
          ) : (
            <>
              <Inbox className="h-8 w-8 text-muted-foreground/40" />
              <p className="editorial-display text-base">
                {view === "unread"
                  ? "You're all caught up"
                  : view === "readlater"
                    ? "Nothing to read later"
                    : view === "starred"
                      ? "Nothing starred yet"
                      : "No articles here"}
              </p>
              <p className="max-w-xs text-xs italic text-muted-foreground">
                {view === "unread"
                  ? "No unread articles in this view. Switch to All, or sync your feeds for more."
                  : view === "readlater"
                    ? "Save articles from your Daily Brief (bookmark icon) to queue them here."
                    : view === "starred"
                      ? "Star articles you want to keep handy."
                      : "Try syncing your feeds to pull in new articles."}
              </p>
            </>
          )}
        </div>
      ) : (
        <VirtualizedArticleList
          items={displayed}
          itemTagsById={itemTagsById}
          selectedId={selectedId}
          onOpen={openArticle}
          selected={selected}
          onToggleSelect={toggleSelect}
          onToggleReadLater={toggleReadLater}
          onPrefetch={prefetch}
          onMarkRead={markReadOne}
          onAutoRead={onAutoRead}
          autoRead={view === "unread" && !showingSearch}
          onLoadMore={loadMore}
          loadingMore={loadingMore}
          canLoadMore={!showingSearch && hasMore}
          compact={compact}
        />
      )}

      <FeedsBulkBar
        count={selectedIds.length}
        pending={pending}
        onMarkRead={() => bulkSetStatus("read", "Marked read")}
        onMarkUnread={() => bulkSetStatus("unread", "Marked unread")}
        onStar={bulkStar}
        onReadLater={bulkReadLater}
        onArchive={() => bulkSetStatus("archived", "Archived")}
        onClear={clearSelection}
      />
    </section>
  );
}

// ── Virtualized rows ──────────────────────────────────────────────────

function VirtualizedArticleList({
  items,
  itemTagsById,
  selectedId,
  onOpen,
  selected,
  onToggleSelect,
  onToggleReadLater,
  onPrefetch,
  onMarkRead,
  onAutoRead,
  autoRead,
  onLoadMore,
  loadingMore,
  canLoadMore,
  compact,
}: {
  items: ArticleListItem[];
  itemTagsById: Record<string, string[]>;
  selectedId: string | null;
  onOpen: (id: string) => void;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleReadLater: (id: string, current: boolean) => void;
  onPrefetch: (id: string) => void;
  onMarkRead: (id: string) => void;
  onAutoRead: (ids: string[]) => void;
  autoRead: boolean;
  onLoadMore: () => void;
  loadingMore: boolean;
  canLoadMore: boolean;
  compact: boolean;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const lastScrollTop = useRef(0);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (compact ? 56 : 112),
    overscan: 6,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !canLoadMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore();
      },
      { root: parentRef.current, rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [canLoadMore, onLoadMore]);

  useEffect(() => {
    virtualizer.measure();
  }, [compact, virtualizer]);

  function handleScroll() {
    const el = parentRef.current;
    if (!el) return;
    const top = el.scrollTop;
    const goingDown = top > lastScrollTop.current + 2;
    lastScrollTop.current = top;
    if (!autoRead || !goingDown) return;
    const past: string[] = [];
    for (const vi of virtualizer.getVirtualItems()) {
      if (vi.start + vi.size < top - 4) {
        const it = items[vi.index];
        if (it && it.readStatus === "unread") past.push(it.id);
      }
    }
    if (past.length > 0) onAutoRead(past);
  }

  const touchStart = useRef<{ x: number; y: number; id: string } | null>(null);

  return (
    <div ref={parentRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
      <div
        className="relative w-full divide-y divide-border"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const item = items[row.index];
          const isSelected = selectedId === item.id;
          return (
            <div
              key={item.id}
              data-index={row.index}
              ref={virtualizer.measureElement}
              className="group absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${row.start}px)` }}
              onTouchStart={(e) => {
                const t = e.touches[0];
                touchStart.current = { x: t.clientX, y: t.clientY, id: item.id };
              }}
              onTouchEnd={(e) => {
                const s = touchStart.current;
                touchStart.current = null;
                if (!s || s.id !== item.id) return;
                const t = e.changedTouches[0];
                const dx = t.clientX - s.x;
                const dy = t.clientY - s.y;
                if (Math.abs(dx) < 70 || Math.abs(dx) <= Math.abs(dy)) return;
                if (dx > 0) onMarkRead(item.id);
                else onToggleReadLater(item.id, item.readLater);
              }}
            >
              {/* Brass selected indicator — matches sidebar active state */}
              {isSelected && (
                <span className="absolute inset-y-3 left-0 z-10 w-[2px] rounded-full bg-brand" />
              )}
              {/* Selection checkbox */}
              <div
                className={cn(
                  "absolute left-1.5 top-1/2 z-10 -translate-y-1/2 transition-opacity",
                  selected.size > 0 || selected.has(item.id)
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100",
                )}
              >
                <Checkbox
                  checked={selected.has(item.id)}
                  onCheckedChange={() => onToggleSelect(item.id)}
                  aria-label="Select article"
                  className="bg-background"
                />
              </div>
              <button
                onClick={() => onOpen(item.id)}
                onMouseEnter={() => onPrefetch(item.id)}
                className={cn(
                  "flex w-full gap-3 pr-4 text-left transition-colors",
                  compact ? "py-2" : "py-4",
                  selected.size > 0 ? "pl-9" : "pl-4",
                  isSelected ? "bg-accent" : "hover:bg-accent/50",
                  selected.has(item.id) && "bg-accent/40",
                  item.readStatus === "read" && "opacity-55",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className={cn("flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground", compact ? "mb-0.5" : "mb-1.5")}>
                    {item.feedIconUrl ? (
                      <Image
                        src={item.feedIconUrl}
                        alt=""
                        width={11}
                        height={11}
                        className="rounded-sm"
                        unoptimized
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <span className="h-[10px] w-[10px] shrink-0 rounded-[2px] bg-muted-foreground/30" />
                    )}
                    <span className="truncate normal-case" style={{ letterSpacing: 0 }}>{item.feedTitle}</span>
                    <span className="opacity-50">·</span>
                    <span className="shrink-0 normal-case" style={{ letterSpacing: 0 }}>{formatRelativeTime(item.publishDate)}</span>
                    {readMinutes(item.wordCount) !== null && (
                      <>
                        <span className="opacity-50">·</span>
                        <span className="shrink-0 tabular-nums">≈{readMinutes(item.wordCount)}m</span>
                      </>
                    )}
                    {item.starred && <Star className="h-3 w-3 shrink-0 fill-current text-yellow-500" />}
                  </div>
                  <div
                    className={cn(
                      "leading-snug tracking-[-0.005em]",
                      compact ? "text-[0.85rem]" : "text-[0.95rem]",
                      item.readStatus === "unread" ? "font-semibold text-foreground" : "font-normal text-foreground/75",
                    )}
                    style={{ fontFamily: "var(--app-font-display)" }}
                  >
                    {item.title}
                  </div>
                  {!compact && item.excerpt && (
                    <div className="mt-1.5 line-clamp-2 text-[0.78rem] leading-relaxed text-muted-foreground">
                      {item.excerpt}
                    </div>
                  )}
                  {!compact && itemTagsById[item.id] && itemTagsById[item.id].length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {itemTagsById[item.id].slice(0, 5).map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center rounded-full bg-muted px-1.5 py-0 font-mono text-[10px] text-muted-foreground"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {!compact && item.imageUrl && (
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
              {/* Read Later toggle */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleReadLater(item.id, item.readLater);
                }}
                title={item.readLater ? "Remove from Read Later" : "Save to Read Later"}
                aria-label={item.readLater ? "Remove from Read Later" : "Save to Read Later"}
                className={cn(
                  "absolute right-2 top-2 z-10 rounded bg-background/80 p-1 backdrop-blur-sm transition-opacity hover:bg-accent",
                  item.readLater
                    ? "text-brand opacity-100"
                    : "text-muted-foreground opacity-0 group-hover:opacity-100",
                )}
              >
                <Bookmark className={cn("h-3.5 w-3.5", item.readLater && "fill-current")} />
              </button>
            </div>
          );
        })}
      </div>
      {canLoadMore && (
        <div ref={sentinelRef} className="flex items-center justify-center py-4 text-xs italic text-muted-foreground">
          {loadingMore && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          {loadingMore ? "Loading more…" : ""}
        </div>
      )}
    </div>
  );
}

function ViewLink({
  view,
  current,
  label,
}: {
  view: "unread" | "all" | "starred" | "readlater";
  current: "unread" | "all" | "starred" | "readlater";
  label: string;
}) {
  const params = useSearchParams();
  const sp = new URLSearchParams(params.toString());
  sp.set("view", view);
  sp.delete("article");
  const active = view === current;
  return (
    <Link
      href={`/feeds?${sp.toString()}`}
      className={cn(
        "rounded-md px-2 py-1 text-xs transition-colors",
        active
          ? "bg-accent font-semibold text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
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

function SortControls({
  compact,
  onToggleCompact,
}: {
  compact: boolean;
  onToggleCompact: () => void;
}) {
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
        <DropdownMenuCheckboxItem checked={compact} onCheckedChange={onToggleCompact}>
          <AlignJustify className="mr-2 h-3.5 w-3.5" />
          Compact rows
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
