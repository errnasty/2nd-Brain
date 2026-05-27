"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Loader2, Plus, Search, Users } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { FEED_DIRECTORY } from "@/data/feed-directory";
import { addFeedAction, searchFeedsAction, type FeedSearchResult } from "@/app/(app)/feeds/actions";
import { toast } from "sonner";

type DisplayFeed = {
  title: string;
  url: string;
  description: string;
  iconUrl?: string | null;
  subscribers?: number;
  categoryLabel?: string;
};

function formatSubs(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function FeedDiscoveryDialog({
  open,
  onOpenChange,
  followedUrls,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  followedUrls: string[];
}) {
  const [selectedCategory, setSelectedCategory] = useState(FEED_DIRECTORY[0].id);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<FeedSearchResult[] | null>(null);
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  const followedSet = useMemo(() => new Set(followedUrls), [followedUrls]);

  // Reset transient state when the dialog closes
  useEffect(() => {
    if (!open) {
      setQuery("");
      setSearchResults(null);
      setSearching(false);
      setAdding(new Set());
      setAdded(new Set());
    }
  }, [open]);

  // Debounced live search via Feedly
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const results = await searchFeedsAction(q);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [query]);

  const isSearching = query.trim().length > 0;

  const displayFeeds: DisplayFeed[] = useMemo(() => {
    if (isSearching) {
      return (searchResults ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        description: r.description,
        iconUrl: r.iconUrl,
        subscribers: r.subscribers,
      }));
    }
    const cat = FEED_DIRECTORY.find((c) => c.id === selectedCategory);
    return (cat?.feeds ?? [])
      .filter((f) => !followedSet.has(f.url))
      .map((f) => ({ title: f.title, url: f.url, description: f.description }));
  }, [isSearching, searchResults, selectedCategory, followedSet]);

  function handleAdd(url: string) {
    if (adding.has(url) || added.has(url)) return;
    setAdding((prev) => new Set(prev).add(url));
    startTransition(async () => {
      const result = await addFeedAction({ url });
      setAdding((prev) => {
        const s = new Set(prev);
        s.delete(url);
        return s;
      });
      if (result.ok) {
        setAdded((prev) => new Set(prev).add(url));
        toast.success(`Feed added — ${result.inserted} article${result.inserted === 1 ? "" : "s"} synced`);
      } else {
        toast.error(result.error ?? "Failed to add feed");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[600px] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-5 pt-5 pb-4">
          <DialogTitle className="text-base font-semibold">Discover Feeds</DialogTitle>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search the web for feeds — try “Stratechery”, “Verge”, “astrophysics”…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {isSearching
              ? "Live results from Feedly · feeds you already follow are hidden"
              : "Browse curated picks · feeds you already follow are hidden"}
          </p>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          {/* Category sidebar — hidden while searching */}
          {!isSearching && (
            <div className="w-44 shrink-0 border-r border-border">
              <ScrollArea className="h-full">
                <div className="space-y-0.5 p-2">
                  {FEED_DIRECTORY.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedCategory(cat.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                        selectedCategory === cat.id
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                      )}
                    >
                      <span className="text-base leading-none">{cat.icon}</span>
                      <span className="truncate text-[13px]">{cat.label}</span>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Feed list */}
          <ScrollArea className="flex-1">
            <div className="space-y-0.5 p-3">
              {isSearching && searching && displayFeeds.length === 0 && (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  Searching…
                </div>
              )}
              {!searching && displayFeeds.length === 0 && (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  {isSearching ? (
                    <>No feeds match &ldquo;{query}&rdquo;.</>
                  ) : (
                    <>You already follow every curated feed in this category. Try searching above.</>
                  )}
                </div>
              )}
              {displayFeeds.map((feed) => (
                <div
                  key={feed.url}
                  className="flex items-center gap-3 rounded-lg p-3 transition-colors hover:bg-accent/40"
                >
                  {feed.iconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={feed.iconUrl}
                      alt=""
                      className="h-8 w-8 shrink-0 rounded object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.visibility = "hidden";
                      }}
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium leading-tight">{feed.title}</span>
                      {feed.subscribers && feed.subscribers > 0 && (
                        <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground">
                          <Users className="h-2.5 w-2.5" />
                          {formatSubs(feed.subscribers)}
                        </span>
                      )}
                    </div>
                    {feed.description && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{feed.description}</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={added.has(feed.url) ? "secondary" : "outline"}
                    disabled={adding.has(feed.url) || added.has(feed.url)}
                    className="h-8 shrink-0"
                    onClick={() => handleAdd(feed.url)}
                  >
                    {adding.has(feed.url) ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : added.has(feed.url) ? (
                      "Added ✓"
                    ) : (
                      <>
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        Add
                      </>
                    )}
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
