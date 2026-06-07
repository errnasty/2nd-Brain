"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  view: "unread" | "all" | "starred" | "readlater";
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

  // Clear the open article only when the user actually changes scope
  // (feed/folder/view) and it's no longer in the new list. We must NOT clear on
  // mount: a deep link from the Daily Brief (?article=…) often points at an
  // article outside the current list (read, or older than the 100 loaded), and
  // the reader fetches it by id regardless — clearing here blanked it.
  const scopeKey = `${view}|${feedId}|${folderId}`;
  const prevScope = useRef<string | null>(null);
  useEffect(() => {
    if (prevScope.current === null) {
      prevScope.current = scopeKey; // first mount — keep URL-linked selection
      return;
    }
    if (prevScope.current === scopeKey) return; // same scope (e.g. refresh) — keep
    prevScope.current = scopeKey;
    if (selectedId && !orderedIds.includes(selectedId)) {
      setSelectedId(null);
      const url = new URL(window.location.href);
      url.searchParams.delete("article");
      window.history.replaceState(null, "", url.toString());
    }
  }, [scopeKey, orderedIds, selectedId]);

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
