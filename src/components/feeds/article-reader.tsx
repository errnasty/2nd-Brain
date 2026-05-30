"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Rss,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  setReadStatusAction,
  toggleStarredAction,
} from "@/app/(app)/feeds/actions";
import { saveArticleToDirectoryAction } from "@/app/(app)/directory/actions";
import { formatRelativeTime } from "@/lib/utils";
import { toast } from "sonner";
import { ReaderControls, useReaderPrefs } from "@/components/reader/reader-controls";
import { useShortcuts } from "@/components/reader/use-shortcuts";
import { RelatedPanel } from "@/components/reader/related-panel";

type ArticleData = {
  id: string;
  title: string;
  excerpt: string | null;
  author: string | null;
  url: string;
  publishDate: string | null;
  readStatus: "unread" | "read" | "archived";
  starred: boolean;
  fullText: string | null;
  feedTitle: string;
  feedIconUrl: string | null;
  feedFolderId: string | null;
  feedFolderName: string | null;
};

export function ArticleReader({
  selectedId,
  orderedIds,
  onSelect,
}: {
  selectedId: string | null;
  orderedIds: string[];
  onSelect: (id: string | null) => void;
}) {
  const router = useRouter();
  const prefs = useReaderPrefs();

  const [article, setArticle] = useState<ArticleData | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const currentIdx = useMemo(
    () => (selectedId ? orderedIds.indexOf(selectedId) : -1),
    [selectedId, orderedIds],
  );
  const prevId = currentIdx > 0 ? orderedIds[currentIdx - 1] : null;
  const nextId =
    currentIdx >= 0 && currentIdx < orderedIds.length - 1 ? orderedIds[currentIdx + 1] : null;

  const goToArticle = useCallback((id: string | null) => onSelect(id), [onSelect]);
  const close = useCallback(() => goToArticle(null), [goToArticle]);

  function toggleStar() {
    if (!article) return;
    const next = !article.starred;
    setArticle({ ...article, starred: next });
    startTransition(() => toggleStarredAction(article.id, next));
  }

  function saveToDirectory() {
    if (!article) return;
    startTransition(async () => {
      try {
        const r = await saveArticleToDirectoryAction(article.id);
        if (r.ok) {
          toast.success(r.alreadySaved ? "Already in your Directory" : "Saved to Directory");
        } else {
          toast.error(r.error);
        }
      } catch (err) {
        toast.error(`Save failed: ${err instanceof Error ? err.message : "unknown error"}`);
      }
    });
  }

  function toggleRead() {
    if (!article) return;
    const next = article.readStatus === "read" ? "unread" : "read";
    setArticle({ ...article, readStatus: next });
    startTransition(async () => {
      await setReadStatusAction({ articleIds: [article.id], status: next });
      toast.success(next === "read" ? "Marked read" : "Marked unread");
    });
  }

  useShortcuts(
    {
      j: () => nextId && goToArticle(nextId),
      n: () => nextId && goToArticle(nextId),
      arrowright: () => nextId && goToArticle(nextId),
      k: () => prevId && goToArticle(prevId),
      p: () => prevId && goToArticle(prevId),
      arrowleft: () => prevId && goToArticle(prevId),
      m: () => toggleRead(),
      s: () => toggleStar(),
      v: () => article && window.open(article.url, "_blank"),
      o: () => article && window.open(article.url, "_blank"),
      escape: close,
    },
    !!article,
  );

  // Fetch meta + full-text in parallel when selectedId changes.
  // The full-text endpoint returns cached content fast if it exists, and runs
  // Readability extraction if not. Firing both in parallel saves ~50-100ms
  // versus the previous serial pattern.
  useEffect(() => {
    setExtractError(null);
    setContent(null);

    if (!selectedId) {
      setArticle(null);
      return;
    }

    let aborted = false;
    setLoadingMeta(true);
    setLoadingContent(true);

    const metaP = fetch(`/api/articles/${selectedId}`, { cache: "no-store" }).then(async (res) => {
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as ArticleData;
    });

    const fullTextP = fetch(`/api/articles/${selectedId}/full-text`, { method: "POST" }).then(
      async (res) => {
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, data, status: res.status };
      },
    );

    metaP
      .then((data) => {
        if (aborted) return;
        setArticle(data);
        setLoadingMeta(false);
        // If meta already has fullText cached, prefer it — the full-text call
        // will return the same thing but this lets us paint content sooner.
        if (data.fullText) {
          setContent(data.fullText);
          setLoadingContent(false);
        }
      })
      .catch((err) => {
        if (aborted) return;
        toast.error(err.message ?? "Failed to load article");
        setArticle(null);
        setLoadingMeta(false);
        setLoadingContent(false);
      });

    fullTextP
      .then(({ ok, data }) => {
        if (aborted) return;
        if (!ok) {
          setExtractError(typeof data.error === "string" ? data.error : "Failed to load");
        } else if (typeof data.content === "string") {
          setContent(data.content);
        }
        setLoadingContent(false);
      })
      .catch((err) => {
        if (aborted) return;
        setExtractError(err.message ?? "Failed to load");
        setLoadingContent(false);
      });

    return () => {
      aborted = true;
    };
  }, [selectedId]);

  // Mark as read implicitly when an unread article is opened. Done after a small delay
  // so quickly paging with j/k doesn't mark a flood of articles read.
  useEffect(() => {
    if (!article || article.readStatus !== "unread") return;
    const handle = setTimeout(() => {
      startTransition(async () => {
        await setReadStatusAction({ articleIds: [article.id], status: "read" });
        setArticle((cur) => (cur && cur.id === article.id ? { ...cur, readStatus: "read" } : cur));
      });
    }, 500);
    return () => clearTimeout(handle);
  }, [article?.id]);

  // Note: RSS articles are NOT auto-tagged anymore — tagging is the Directory's
  // job. Save the article to your Directory (bookmark icon) to get tags +
  // routing. This makes article-open instant.

  if (!selectedId) {
    return (
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
    );
  }

  const readingMinutes = content
    ? Math.max(1, Math.ceil(content.replace(/<[^>]+>/g, " ").split(/\s+/).length / 250))
    : null;

  return (
    <section className="flex flex-1 flex-col overflow-hidden" data-reader-theme={prefs.theme}>
      <div className="flex items-center gap-1 border-b border-border px-2 py-2">
        {/* Mobile-only back: returns to the article list (list is hidden on
            mobile while reading; side-by-side on md+ so no button needed). */}
        <Button size="sm" variant="ghost" onClick={close} className="md:hidden -ml-1 gap-1 px-2">
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>
        <Button
          size="icon"
          variant="ghost"
          disabled={!prevId}
          onClick={() => prevId && goToArticle(prevId)}
          title="Previous (k)"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          disabled={!nextId}
          onClick={() => nextId && goToArticle(nextId)}
          title="Next (j)"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <div className="flex flex-1 items-center gap-2 text-xs text-muted-foreground">
          {article?.feedIconUrl ? (
            <Image
              src={article.feedIconUrl}
              alt=""
              width={16}
              height={16}
              className="rounded-sm"
              unoptimized
            />
          ) : null}
          <span className="truncate">{article?.feedTitle ?? ""}</span>
          {readingMinutes && <span className="hidden sm:inline">· ~{readingMinutes} min</span>}
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={saveToDirectory}
          title="Save to Directory"
          disabled={!article}
        >
          <BookmarkPlus className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" onClick={toggleStar} title="Star (s)" disabled={!article}>
          <Star className={article?.starred ? "fill-yellow-500 text-yellow-500" : ""} />
        </Button>
        <Button size="icon" variant="ghost" asChild title="Open original (v)" disabled={!article}>
          <a href={article?.url ?? "#"} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4" />
          </a>
        </Button>
        <ReaderControls />
      </div>
      <ScrollArea className="flex-1">
        <article
          className="prose-reader px-4 py-8"
          style={
            {
              "--reader-font": prefs.font,
              "--reader-font-size": `${prefs.fontSize}px`,
            } as React.CSSProperties
          }
        >
          {loadingMeta || !article ? (
            <div className="space-y-3">
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="mt-6 h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            <>
              {/* Folder breadcrumb */}
              <nav
                aria-label="Feed path"
                className="not-prose mb-3 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground"
              >
                <button
                  onClick={() => router.push("/feeds")}
                  className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                >
                  <Rss className="h-3 w-3" />
                  Feeds
                </button>
                {article.feedFolderName && article.feedFolderId && (
                  <>
                    <ChevronRight className="h-3 w-3 opacity-50" />
                    <button
                      onClick={() =>
                        router.push(`/feeds?folder=${article.feedFolderId}`)
                      }
                      className="hover:text-foreground transition-colors"
                    >
                      {article.feedFolderName}
                    </button>
                  </>
                )}
                <ChevronRight className="h-3 w-3 opacity-50" />
                <span>{article.feedTitle}</span>
              </nav>

              <h1>{article.title}</h1>
              <div className="not-prose mt-3 mb-8 pb-6 border-b border-border flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                {article.author && (
                  <span className="font-medium text-foreground/75">{article.author}</span>
                )}
                {article.author && <span className="text-border">·</span>}
                <span>{formatRelativeTime(article.publishDate)}</span>
              </div>
              {loadingContent && !content && (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              )}
              {extractError && !content && (
                <div className="not-prose mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  Couldn&apos;t extract full text ({extractError}). Showing RSS excerpt.
                </div>
              )}
              {content && <div dangerouslySetInnerHTML={{ __html: content }} />}
              {article && !loadingContent && <RelatedPanel articleId={article.id} />}
            </>
          )}
        </article>
      </ScrollArea>
    </section>
  );
}
