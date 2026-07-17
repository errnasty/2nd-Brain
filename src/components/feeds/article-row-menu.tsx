"use client";

import { Bookmark, BookmarkPlus, Check, ExternalLink, Eye, Star } from "lucide-react";
import type { MenuPrimitives } from "@/components/ui/menu-primitives";
import type { ArticleListItem } from "./article-list";

export function ArticleRowMenuItems({
  prims,
  item,
  onOpen,
  onToggleStar,
  onToggleReadLater,
  onSetRead,
  onSaveToDirectory,
}: {
  prims: MenuPrimitives;
  item: ArticleListItem;
  onOpen: () => void;
  onToggleStar: () => void;
  onToggleReadLater: () => void;
  onSetRead: (read: boolean) => void;
  onSaveToDirectory: () => void;
}) {
  const { Item, Separator } = prims;
  const isRead = item.readStatus === "read";

  return (
    <>
      <Item onClick={onOpen}>
        <Eye className="mr-2 h-3.5 w-3.5" /> Open
      </Item>
      <Item onClick={onToggleStar}>
        <Star className={`mr-2 h-3.5 w-3.5 ${item.starred ? "fill-current text-yellow-500" : ""}`} />
        {item.starred ? "Unstar" : "Star"}
      </Item>
      <Item onClick={onToggleReadLater}>
        <Bookmark className={`mr-2 h-3.5 w-3.5 ${item.readLater ? "fill-current text-brand" : ""}`} />
        {item.readLater ? "Remove from Read Later" : "Read later"}
      </Item>
      <Item onClick={() => onSetRead(!isRead)}>
        <Check className="mr-2 h-3.5 w-3.5" />
        {isRead ? "Mark as unread" : "Mark as read"}
      </Item>
      <Separator />
      <Item onClick={onSaveToDirectory}>
        <BookmarkPlus className="mr-2 h-3.5 w-3.5" /> Save to Directory
      </Item>
      <Item onClick={onOpenOriginal(item.url)}>
        <ExternalLink className="mr-2 h-3.5 w-3.5" /> Open original
      </Item>
    </>
  );
}

// window.open in a click handler (rather than an <a> child) keeps both menus'
// item shapes identical — some Radix Item variants swallow asChild anchors.
function onOpenOriginal(url: string) {
  return () => {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };
}
