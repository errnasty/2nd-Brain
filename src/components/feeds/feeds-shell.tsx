"use client";

import { useCallback, useEffect, useState } from "react";
import { ArticleList, type ArticleListItem } from "./article-list";
import { ArticleReader } from "./article-reader";

/**
 * Owns the `selectedId` (which article is open) in client state and updates the
 * URL bar via `history.replaceState` for shareability/refresh. Clicking an
 * article no longer triggers a soft navigation, so the layout and page server
 * components don't re-run — perceived speed goes from ~300ms to ~0ms.
 *
 * View / feed / folder changes still flow through the URL because those *do*
 * need a fresh article list from the server.
 */
export function FeedsShell({
  items,
  itemTagsById,
  view,
  feedId,
  folderId,
  orderedIds,
}: {
  items: ArticleListItem[];
  itemTagsById: Record<string, string[]>;
  view: "unread" | "all" | "starred";
  feedId: string | null;
  folderId: string | null;
  orderedIds: string[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Hydrate selection from URL on mount + react to back/forward.
  useEffect(() => {
    const fromUrl = () => {
      const sp = new URLSearchParams(window.location.search);
      setSelectedId(sp.get("article"));
    };
    fromUrl();
    window.addEventListener("popstate", fromUrl);
    return () => window.removeEventListener("popstate", fromUrl);
  }, []);

  // When the article list scope changes (different feed/folder/view), the
  // previously-selected article may no longer be in `orderedIds`. Clear it.
  useEffect(() => {
    if (!selectedId) return;
    if (!orderedIds.includes(selectedId)) {
      setSelectedId(null);
      const url = new URL(window.location.href);
      url.searchParams.delete("article");
      window.history.replaceState(null, "", url.toString());
    }
  }, [orderedIds, selectedId]);

  const onSelect = useCallback((id: string | null) => {
    setSelectedId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("article", id);
    else url.searchParams.delete("article");
    window.history.replaceState(null, "", url.toString());
  }, []);

  return (
    <>
      <ArticleList
        items={items}
        itemTagsById={itemTagsById}
        selectedId={selectedId}
        view={view}
        feedId={feedId}
        folderId={folderId}
        onSelect={onSelect}
      />
      <ArticleReader
        selectedId={selectedId}
        orderedIds={orderedIds}
        onSelect={onSelect}
      />
    </>
  );
}
