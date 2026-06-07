"use client";

import { Archive, Bookmark, Check, Circle, Loader2, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Floating action bar for multi-selected articles. Presentational — the parent
 * (ArticleList) owns selection state + optimistic updates and passes handlers.
 * Mirrors the Directory's BulkActionBar.
 */
export function FeedsBulkBar({
  count,
  pending,
  onMarkRead,
  onMarkUnread,
  onStar,
  onReadLater,
  onArchive,
  onClear,
}: {
  count: number;
  pending: boolean;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onStar: () => void;
  onReadLater: () => void;
  onArchive: () => void;
  onClear: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="pointer-events-auto fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur">
      <span className="px-1 text-sm font-medium">{count} selected</span>
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      <span className="mx-1 h-4 w-px bg-border" />

      <Button size="sm" variant="ghost" onClick={onMarkRead} disabled={pending}>
        <Check className="mr-1.5 h-3.5 w-3.5" /> Read
      </Button>
      <Button size="sm" variant="ghost" onClick={onMarkUnread} disabled={pending}>
        <Circle className="mr-1.5 h-3.5 w-3.5" /> Unread
      </Button>
      <Button size="sm" variant="ghost" onClick={onStar} disabled={pending}>
        <Star className="mr-1.5 h-3.5 w-3.5" /> Star
      </Button>
      <Button size="sm" variant="ghost" onClick={onReadLater} disabled={pending}>
        <Bookmark className="mr-1.5 h-3.5 w-3.5" /> Read later
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        onClick={onArchive}
        disabled={pending}
      >
        <Archive className="mr-1.5 h-3.5 w-3.5" /> Archive
      </Button>

      <span className="mx-1 h-4 w-px bg-border" />
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
