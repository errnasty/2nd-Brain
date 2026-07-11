"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { ArticleList, type ArticleListItem } from "./article-list";

// The reader (712 lines: panels, TTS, takeaways, next/image…) loads only once
// an article is actually opened — it's the bulk of /feeds' initial JS. Its
// keyboard shortcuts are enabled only while an article is loaded, so nothing
// is lost while the chunk is deferred.
const ArticleReader = dynamic(
  () => import("./article-reader").then((m) => m.ArticleReader),
  {
    ssr: false,
    loading: () => <section className="hidden flex-1 lg:flex" aria-busy="true" />,
  },
);

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
  // Sync the open article from the URL's ?article= param. useSearchParams updates
  // on mount, back/forward, AND same-route router.push/replace — so a "related"
  // item (router.replace("/feeds?article=X")) or a Daily-Brief deep link opens
  // the reader. The old popstate-only listener missed router.replace entirely.
  const urlArticle = useSearchParams().get("article");
  // Seed from the URL so a deep link mounts the reader on first render instead
  // of flashing the empty pane for one paint.
  const [selectedId, setSelectedId] = useState<string | null>(urlArticle);
  useEffect(() => {
    setSelectedId(urlArticle);
  }, [urlArticle]);

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
      {selectedId ? (
        <ArticleReader
          selectedId={selectedId}
          orderedIds={orderedIds}
          onSelect={onSelect}
        />
      ) : (
        <section className="hidden flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground lg:flex">
          <div>Select an article to read.</div>
          <div className="text-xs">
            <kbd className="rounded border border-border px-1.5 py-0.5">j</kbd> next ·
            <kbd className="ml-1 rounded border border-border px-1.5 py-0.5">k</kbd> previous ·
            <kbd className="ml-1 rounded border border-border px-1.5 py-0.5">m</kbd> mark read ·
            <kbd className="ml-1 rounded border border-border px-1.5 py-0.5">s</kbd> star ·
            <kbd className="ml-1 rounded border border-border px-1.5 py-0.5">v</kbd> open original
          </div>
        </section>
      )}
    </>
  );
}
