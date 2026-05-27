"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, ExternalLink, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { setReadStatusAction, toggleStarredAction } from "@/app/(app)/feeds/actions";
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
};

export function ArticleReader({
  selectedId,
  orderedIds,
}: {
  selectedId: string | null;
  orderedIds: string[];
}) {
  const router = useRouter();
  const params = useSearchParams();
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

  const goToArticle = useCallback(
    (id: string | null) => {
      const sp = new URLSearchParams(params.toString());
      if (id) sp.set("article", id);
      else sp.delete("article");
      router.replace(`/feeds?${sp.toString()}`, { scroll: false });
    },
    [params, router],
  );
  const close = useCallback(() => goToArticle(null), [goToArticle]);

  function toggleStar() {
    if (!article) return;
    const next = !article.starred;
    setArticle({ ...article, starred: next });
    startTransition(() => toggleStarredAction(article.id, next));
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

  // 1) Fetch article meta when selectedId changes
  useEffect(() => {
    setExtractError(null);
    setContent(null);

    if (!selectedId) {
      setArticle(null);
      return;
    }

    let aborted = false;
    setLoadingMeta(true);
    fetch(`/api/articles/${selectedId}`, { cache: "no-store" })
      .then(async (res) => {
        if (aborted) return;
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        const data: ArticleData = await res.json();
        setArticle(data);
      })
      .catch((err) => {
        if (aborted) return;
        toast.error(err.message ?? "Failed to load article");
        setArticle(null);
      })
      .finally(() => !aborted && setLoadingMeta(false));

    return () => {
      aborted = true;
    };
  }, [selectedId]);

  // 2) When article meta arrives, ensure full text. Use cached `fullText` or fetch via Readability.
  useEffect(() => {
    if (!article) return;

    if (article.fullText) {
      setContent(article.fullText);
      return;
    }

    let aborted = false;
    setLoadingContent(true);
    fetch(`/api/articles/${article.id}/full-text`, { method: "POST" })
      .then(async (res) => {
        const data = await res.json();
        if (aborted) return;
        if (!res.ok) {
          setExtractError(data.error ?? "Failed to load");
          setContent(article.excerpt ? `<p>${article.excerpt}</p>` : null);
        } else {
          setContent(data.content);
        }
      })
      .catch((err) => {
        if (aborted) return;
        setExtractError(err.message ?? "Failed to load");
      })
      .finally(() => !aborted && setLoadingContent(false));

    return () => {
      aborted = true;
    };
  }, [article?.id, article?.fullText]);

  // 3) Mark as read implicitly when an unread article is opened. Done after a small delay
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
        <Button size="icon" variant="ghost" onClick={close} className="lg:hidden">
          <X className="h-4 w-4" />
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
            // eslint-disable-next-line @next/next/no-img-element
            <img src={article.feedIconUrl} alt="" className="h-4 w-4 rounded-sm" />
          ) : null}
          <span className="truncate">{article?.feedTitle ?? ""}</span>
          {readingMinutes && <span className="hidden sm:inline">· ~{readingMinutes} min</span>}
        </div>
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
              <h1>{article.title}</h1>
              <div className="not-prose mt-3 mb-8 pb-6 border-b border-border flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                {article.author && (
                  <span className="font-medium text-foreground/75">{article.author}</span>
                )}
                {article.author && <span className="text-border">·</span>}
                <span>{formatRelativeTime(article.publishDate)}</span>
              </div>
              {loadingContent && (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              )}
              {extractError && (
                <div className="not-prose mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  Couldn&apos;t extract full text ({extractError}). Showing RSS excerpt.
                </div>
              )}
              {content && !loadingContent && (
                <div dangerouslySetInnerHTML={{ __html: content }} />
              )}
              {article && !loadingContent && <RelatedPanel articleId={article.id} />}
            </>
          )}
        </article>
      </ScrollArea>
    </section>
  );
}
