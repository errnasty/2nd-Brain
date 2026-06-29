"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Bookmark,
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ListChecks,
  Loader2,
  Pause,
  Play,
  Rss,
  Sparkles,
  Star,
  Volume2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  setReadLaterAction,
  setReadStatusAction,
  toggleStarredAction,
} from "@/app/(app)/feeds/actions";
import { cn } from "@/lib/utils";
import { saveArticleToDirectoryAction } from "@/app/(app)/directory/actions";
import { formatRelativeTime } from "@/lib/utils";
import { runOptimistic } from "@/lib/ui/optimistic";
import { toast } from "sonner";
import { ReaderControls, useReaderPrefs } from "@/components/reader/reader-controls";
import { useShortcuts } from "@/components/reader/use-shortcuts";
import { RelatedPanel } from "@/components/reader/related-panel";
import { DocQueryPanel } from "@/components/reader/doc-query-panel";

type ArticleData = {
  id: string;
  title: string;
  excerpt: string | null;
  author: string | null;
  url: string;
  publishDate: string | null;
  readStatus: "unread" | "read" | "archived";
  starred: boolean;
  readLater: boolean;
  wordCount: number | null;
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
  const [queryOpen, setQueryOpen] = useState(false);
  const [ttsState, setTtsState] = useState<"idle" | "speaking" | "paused">("idle");
  const [ttsSupported, setTtsSupported] = useState(false);
  const [progress, setProgress] = useState(0);
  const [takeaways, setTakeaways] = useState<{ tldr: string; keyPoints: string[] } | null>(null);
  const [takeawaysLoading, setTakeawaysLoading] = useState(false);
  const [takeawaysSecs, setTakeawaysSecs] = useState<number | null>(null);
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const restoredFor = useRef<string | null>(null);
  const [, startTransition] = useTransition();

  const loadTakeaways = useCallback(async () => {
    if (!selectedId || takeawaysLoading) return;
    setTakeawaysLoading(true);
    const started = Date.now();
    try {
      const res = await fetch(`/api/articles/${selectedId}/takeaways`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : "Couldn't generate takeaways");
        return;
      }
      setTakeaways({ tldr: data.tldr, keyPoints: data.keyPoints });
      setTakeawaysSecs(Math.max(1, Math.round((Date.now() - started) / 1000)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't generate takeaways");
    } finally {
      setTakeawaysLoading(false);
    }
  }, [selectedId, takeawaysLoading]);

  useEffect(() => {
    setTtsSupported(typeof window !== "undefined" && "speechSynthesis" in window);
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // #2 Reading-progress: track the radix ScrollArea viewport, persist + restore
  // per article. The shadcn ScrollArea exposes its viewport via a data attr, not
  // a ref, so we reach in by selector.
  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root || !selectedId) return;
    const vp = root.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (!vp) return;

    // Restore saved position once per article, after content has laid out.
    if (content && restoredFor.current !== selectedId) {
      restoredFor.current = selectedId;
      try {
        const saved = parseFloat(localStorage.getItem(`article.progress.${selectedId}`) ?? "0");
        const max = vp.scrollHeight - vp.clientHeight;
        if (saved > 0.02 && saved < 0.99 && max > 0) vp.scrollTop = saved * max;
      } catch {
        // ignore
      }
    }

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const max = vp.scrollHeight - vp.clientHeight;
        const p = max > 0 ? Math.min(1, Math.max(0, vp.scrollTop / max)) : 0;
        setProgress(p);
        try {
          localStorage.setItem(`article.progress.${selectedId}`, String(p));
        } catch {
          // ignore
        }
      });
    };
    vp.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      vp.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [selectedId, content]);

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
    const prev = article;
    const next = !article.starred;
    void runOptimistic({
      apply: () => setArticle({ ...prev, starred: next }),
      revert: () => setArticle(prev),
      action: () => toggleStarredAction(prev.id, next),
      errorPrefix: "Couldn't update star",
    });
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
    const prev = article;
    const next = prev.readStatus === "read" ? "unread" : "read";
    void runOptimistic({
      apply: () => setArticle({ ...prev, readStatus: next }),
      revert: () => setArticle(prev),
      action: () => setReadStatusAction({ articleIds: [prev.id], status: next }),
      success: next === "read" ? "Marked read" : "Marked unread",
      errorPrefix: "Couldn't update read state",
    });
  }

  function toggleReadLater() {
    if (!article) return;
    const prev = article;
    const next = !prev.readLater;
    void runOptimistic({
      apply: () => setArticle({ ...prev, readLater: next }),
      revert: () => setArticle(prev),
      action: () => setReadLaterAction({ articleIds: [prev.id], readLater: next }),
      success: next ? "Saved to Read Later" : "Removed from Read Later",
      errorPrefix: "Couldn't update Read Later",
    });
  }

  // #3 "Listen" — read the article aloud via the Web Speech API. Plain text is
  // the title + the de-HTML'd body (falls back to the RSS excerpt).
  const ttsText = useMemo(() => {
    const html = content ?? article?.excerpt ?? "";
    const body = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!body) return "";
    return article ? `${article.title}. ${body}` : body;
  }, [content, article]);

  const toggleListen = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    if (ttsState === "speaking") {
      synth.pause();
      setTtsState("paused");
      return;
    }
    if (ttsState === "paused") {
      synth.resume();
      setTtsState("speaking");
      return;
    }
    if (!ttsText) return;
    synth.cancel();
    // Cap length so a long article doesn't queue an unbounded utterance.
    const utterance = new SpeechSynthesisUtterance(ttsText.slice(0, 30_000));
    utterance.onend = () => setTtsState("idle");
    utterance.onerror = () => setTtsState("idle");
    synth.speak(utterance);
    setTtsState("speaking");
  }, [ttsState, ttsText]);

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
      b: () => toggleReadLater(),
      l: () => toggleListen(),
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
    setQueryOpen(false);
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setTtsState("idle");
    setProgress(0);
    setTakeaways(null);
    setTakeawaysSecs(null);

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
  const minutesRemaining = readingMinutes ? Math.max(0, Math.ceil(readingMinutes * (1 - progress))) : null;

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
        <div className="flex flex-1 items-center gap-2 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
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
          {readingMinutes && (
            <span className="hidden sm:inline">
              {progress > 0.02
                ? `· ≈${minutesRemaining} min left · ${Math.round(progress * 100)}%`
                : `· ≈${readingMinutes} min`}
            </span>
          )}
        </div>
        {ttsSupported && (
          <Button
            size="icon"
            variant="ghost"
            onClick={toggleListen}
            title={
              ttsState === "speaking"
                ? "Pause (l)"
                : ttsState === "paused"
                  ? "Resume (l)"
                  : "Listen (l)"
            }
            disabled={!article || (!ttsText && ttsState === "idle")}
            className={ttsState !== "idle" ? "text-brand" : ""}
          >
            {ttsState === "speaking" ? (
              <Pause className="h-4 w-4" />
            ) : ttsState === "paused" ? (
              <Play className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          onClick={loadTakeaways}
          title="Key takeaways"
          disabled={!article || takeawaysLoading}
          className={takeaways ? "text-brand" : ""}
        >
          {takeawaysLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setQueryOpen((v) => !v)}
          title="Ask about this article"
          disabled={!article}
          className={queryOpen ? "text-primary" : ""}
        >
          <Sparkles className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={saveToDirectory}
          title="Save to Directory"
          disabled={!article}
        >
          <BookmarkPlus className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={toggleReadLater}
          title={article?.readLater ? "Remove from Read Later (b)" : "Read later (b)"}
          disabled={!article}
        >
          <Bookmark className={cn("h-4 w-4", article?.readLater && "fill-brand text-brand")} />
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
      {/* #2 Reading-progress strip */}
      <div className="h-0.5 w-full bg-border/60" aria-hidden>
        <div
          className="h-full transition-[width] duration-150 ease-out"
          style={{ width: `${Math.round(progress * 100)}%`, background: "hsl(var(--brand))" }}
        />
      </div>
      <ScrollArea ref={scrollRootRef} className="flex-1">
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
                className="not-prose mb-3 flex flex-wrap items-center gap-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
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

              <h1 className="editorial-display">{article.title}</h1>
              <div className="not-prose mt-3 mb-8 pb-6 border-b border-border flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                {article.author && (
                  <span className="font-medium" style={{ color: "hsl(var(--brand))" }}>{article.author}</span>
                )}
                {article.author && <span className="text-border">·</span>}
                <span>{formatRelativeTime(article.publishDate)}</span>
                {article.wordCount && article.wordCount >= 80 && (
                  <>
                    <span className="text-border">·</span>
                    <span className="tabular-nums">≈{Math.max(1, Math.round(article.wordCount / 220))} min read</span>
                  </>
                )}
              </div>
              {/* #1 Key-takeaways callout */}
              {takeaways && (
                <div
                  className="not-prose mb-8 rounded-xl border p-4"
                  style={{ borderColor: "hsl(var(--brand) / 0.35)", background: "hsl(var(--brand) / 0.05)" }}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="editorial-eyebrow-brand inline-flex items-center gap-1.5">
                      <ListChecks className="h-3 w-3" /> § Key takeaways
                    </span>
                    {takeawaysSecs != null && (
                      <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                        Generated · {takeawaysSecs} sec
                      </span>
                    )}
                  </div>
                  <p className="mb-2 text-[14px] font-medium leading-snug">{takeaways.tldr}</p>
                  <ul className="space-y-1">
                    {takeaways.keyPoints.slice(0, 5).map((p, i) => (
                      <li key={i} className="flex gap-2 text-[13px] leading-snug text-foreground/85">
                        <span style={{ color: "hsl(var(--brand))" }}>—</span>
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
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
                  Couldn&apos;t extract full text ({extractError}).
                  {article?.excerpt ? " Showing the RSS excerpt below." : ""}
                </div>
              )}
              {content ? (
                <div dangerouslySetInnerHTML={{ __html: content }} />
              ) : !loadingContent && article ? (
                article.excerpt ? (
                  <p>{article.excerpt}</p>
                ) : (
                  <p className="not-prose text-sm italic text-muted-foreground">
                    This article&apos;s text isn&apos;t available.{" "}
                    <a
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline underline-offset-2"
                    >
                      Open the original ↗
                    </a>
                  </p>
                )
              ) : null}
              {article && !loadingContent && <RelatedPanel articleId={article.id} />}
            </>
          )}
        </article>
      </ScrollArea>
      {article && (
        <DocQueryPanel
          open={queryOpen}
          docId={article.id}
          title={article.title}
          content={content ?? article.excerpt ?? ""}
          onClose={() => setQueryOpen(false)}
        />
      )}
    </section>
  );
}
