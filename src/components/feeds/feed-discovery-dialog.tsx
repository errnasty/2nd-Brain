"use client";

import { useMemo, useState, useTransition } from "react";
import { Loader2, Plus, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { FEED_DIRECTORY } from "@/data/feed-directory";
import { addFeedAction } from "@/app/(app)/feeds/actions";
import { toast } from "sonner";

export function FeedDiscoveryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [selectedCategory, setSelectedCategory] = useState(FEED_DIRECTORY[0].id);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  const isSearching = search.trim().length > 0;

  const displayFeeds = useMemo(() => {
    if (isSearching) {
      const q = search.toLowerCase();
      return FEED_DIRECTORY.flatMap((cat) =>
        cat.feeds
          .filter(
            (f) =>
              f.title.toLowerCase().includes(q) ||
              f.description.toLowerCase().includes(q),
          )
          .map((f) => ({ ...f, categoryLabel: cat.label })),
      );
    }
    const cat = FEED_DIRECTORY.find((c) => c.id === selectedCategory);
    return (cat?.feeds ?? []).map((f) => ({ ...f, categoryLabel: "" }));
  }, [search, isSearching, selectedCategory]);

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
      <DialogContent className="flex h-[580px] max-w-3xl flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="shrink-0 border-b border-border px-5 pt-5 pb-4">
          <DialogTitle className="text-base font-semibold">Discover Feeds</DialogTitle>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search feeds by name or topic…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
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
              {displayFeeds.length === 0 && (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No feeds match &ldquo;{search}&rdquo;.
                </div>
              )}
              {displayFeeds.map((feed) => (
                <div
                  key={feed.url}
                  className="flex items-center gap-3 rounded-lg p-3 transition-colors hover:bg-accent/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium leading-tight">{feed.title}</span>
                      {isSearching && feed.categoryLabel && (
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {feed.categoryLabel}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{feed.description}</p>
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
