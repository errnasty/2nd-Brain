"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  List,
  Loader2,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { indexChapter, offsetAtX, xOfOffset, type ChapterIndex } from "@/lib/books/dom-anchor";
import { createProgressCalculator } from "@/lib/books/progress";
import { saveBookPositionAction, setBookPrefsAction } from "@/app/read/actions";

export type BookChapterMeta = {
  idx: number;
  title: string | null;
  charCount: number;
  navLevel: number;
};

export type BookReaderTheme = "app" | "paper" | "night";

export type BookPayload = {
  id: string;
  title: string;
  author: string | null;
  fixedLayout: boolean;
  chapters: BookChapterMeta[];
  state: {
    chapterIdx: number;
    charOffset: number;
    progressPct: number;
    spoilerSafe: boolean;
    fontScale: number;
    theme: BookReaderTheme | null;
  };
};

/** Gap between pages. Also the gutter, so text never runs to the screen edge. */
const COLUMN_GAP = 48;

const FONT_STEPS = [0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75];

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export function BookReader({
  book,
  initialHtml = null,
}: {
  book: BookPayload;
  /** The resume chapter, rendered on the server so the book opens instantly. */
  initialHtml?: string | null;
}) {
  const router = useRouter();

  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const [chapterIdx, setChapterIdx] = useState(book.state.chapterIdx);
  const [html, setHtml] = useState<string | null>(initialHtml);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [fontScale, setFontScale] = useState(book.state.fontScale);
  const [theme, setTheme] = useState<BookReaderTheme>(book.state.theme ?? "app");
  const [spoilerSafe, setSpoilerSafe] = useState(book.state.spoilerSafe);
  const [panel, setPanel] = useState<"toc" | "settings" | null>(null);

  // The character offset the reader is at. Everything layout-dependent is
  // derived from this and re-derived after every reflow, which is what makes a
  // font change or a rotation land back on the same words.
  const anchorRef = useRef(book.state.charOffset);
  const [progress, setProgress] = useState(book.state.progressPct);

  // Measured once per reflow and reused for every page turn. Rebuilding it per
  // turn would mean a getBoundingClientRect for every text node in the chapter.
  const indexRef = useRef<ChapterIndex | null>(null);

  // Progress is asked for on every page turn and every scroll tick, and the
  // naive form sorts the chapter list each time.
  const progressAt = useMemo(() => createProgressCalculator(book.chapters), [book.chapters]);

  // Chapters already fetched. Turning back a page at a chapter boundary, or
  // flipping through a table of contents, should never hit the network twice.
  // Seeded with the server-rendered chapter so the first paint costs nothing.
  const cacheRef = useRef<Map<number, string>>(
    new Map(initialHtml === null ? [] : [[book.state.chapterIdx, initialHtml]]),
  );

  const scrollMode = book.fixedLayout;
  const chapter = book.chapters.find((c) => c.idx === chapterIdx) ?? book.chapters[0];

  /* ── chapter loading ─────────────────────────────────────────────── */

  const loadChapter = useCallback(
    async (idx: number, signal?: AbortSignal): Promise<string> => {
      const cached = cacheRef.current.get(idx);
      if (cached !== undefined) return cached;

      const r = await fetch(`/api/book/${book.id}/chapter/${idx}`, { signal });
      if (!r.ok) {
        throw new Error(r.status === 404 ? "This chapter is missing." : "Couldn't load this chapter.");
      }
      const text = await r.text();

      // A handful of chapters is a megabyte at most, and the ones worth keeping
      // are always the ones nearest where you are reading.
      const cache = cacheRef.current;
      cache.set(idx, text);
      if (cache.size > 7) {
        const furthest = [...cache.keys()].reduce((a, b) =>
          Math.abs(b - idx) > Math.abs(a - idx) ? b : a,
        );
        if (furthest !== idx) cache.delete(furthest);
      }
      return text;
    },
    [book.id],
  );

  useEffect(() => {
    const ac = new AbortController();

    // A cache hit renders synchronously: crossing a chapter boundary should
    // not flash a spinner for content already in memory.
    const cached = cacheRef.current.get(chapterIdx);
    if (cached !== undefined) {
      setHtml(cached);
      setLoadError(null);
    } else {
      setHtml(null);
      setLoadError(null);
      loadChapter(chapterIdx, ac.signal)
        .then(setHtml)
        .catch((err: unknown) => {
          if (ac.signal.aborted) return;
          setLoadError(err instanceof Error ? err.message : "Couldn't load this chapter.");
        });
    }

    // Warm the neighbours. Reading is overwhelmingly forwards, so the next
    // chapter goes first and the previous one follows — by the time the last
    // page of this chapter is reached, the next one is already in memory.
    const warm = window.setTimeout(() => {
      for (const idx of [chapterIdx + 1, chapterIdx - 1]) {
        if (idx < 0 || cacheRef.current.has(idx)) continue;
        if (!book.chapters.some((c) => c.idx === idx)) continue;
        void loadChapter(idx).catch(() => {});
      }
    }, 250);

    return () => {
      ac.abort();
      window.clearTimeout(warm);
    };
  }, [book.id, book.chapters, chapterIdx, loadChapter]);

  /* ── measure ─────────────────────────────────────────────────────── */

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Re-paginate whenever anything that affects layout changes, then put the
  // reader back on the character they were on. Never on page change — that
  // would fight the navigation it is meant to preserve.
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content || !html || scrollMode || size.w === 0) return;

    const stride = size.w + COLUMN_GAP;
    const count = Math.max(1, Math.round((content.scrollWidth + COLUMN_GAP) / stride));
    setPageCount(count);

    // Measure everything once, here, while the layout is already being read.
    const index = indexChapter(content);
    indexRef.current = index;

    const x = xOfOffset(index, content, anchorRef.current);
    setPage(x === null ? 0 : clamp(Math.floor((x + 1) / stride), 0, count - 1));
  }, [html, size.w, size.h, fontScale, scrollMode]);

  // Scroll mode (fixed-layout books) anchors by proportion rather than by
  // character: those books are images with almost no text to anchor to.
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content || !html || !scrollMode) return;
    const ratio = chapter && chapter.charCount > 0 ? anchorRef.current / chapter.charCount : 0;
    content.scrollTop = ratio * content.scrollHeight;
  }, [html, scrollMode, chapter]);

  /* ── position ────────────────────────────────────────────────────── */

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback(
    (idx: number, offset: number) => {
      void saveBookPositionAction({ documentId: book.id, chapterIdx: idx, charOffset: offset })
        .then((r) => {
          if (r.ok) setProgress(r.progressPct);
        })
        .catch(() => {});
    },
    [book.id],
  );

  // After a page turn, record which character now sits at the left edge. That
  // offset is what gets saved, and what the next reflow resolves back to.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || !html || scrollMode) return;

    const index = indexRef.current;
    if (!index) return;

    anchorRef.current = offsetAtX(index, content, page * (size.w + COLUMN_GAP));
    setProgress(progressAt({ chapterIdx, charOffset: anchorRef.current }));

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(chapterIdx, anchorRef.current), 1500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [page, html, size.w, chapterIdx, scrollMode, progressAt, persist]);

  // Leaving the reader through an in-app navigation unmounts without ever
  // firing visibilitychange, and the pending debounce is cleared on the way
  // out — so the last page turn before pressing Back would be lost.
  const flushRef = useRef<() => void>(() => {});
  flushRef.current = () => persist(chapterIdx, anchorRef.current);
  useEffect(() => () => flushRef.current(), []);

  // A debounce loses the last few seconds of reading when a tab is closed or
  // backgrounded, which on a phone is most of the time.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") persist(chapterIdx, anchorRef.current);
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, [chapterIdx, persist]);

  // Fixed-layout books have almost no text to anchor to, so their position is
  // stored as a proportion of the chapter mapped onto its character count —
  // approximate, but it resumes on the right screenful and keeps the same
  // column meaning something for progress.
  const onScrollSave = useCallback(() => {
    const content = contentRef.current;
    if (!content || !scrollMode || !chapter) return;

    const scrollable = content.scrollHeight - content.clientHeight;
    const ratio = scrollable > 0 ? content.scrollTop / scrollable : 0;
    anchorRef.current = Math.round(ratio * chapter.charCount);
    setProgress(progressAt({ chapterIdx, charOffset: anchorRef.current }));

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(chapterIdx, anchorRef.current), 1500);
  }, [scrollMode, chapter, chapterIdx, progressAt, persist]);

  /* ── navigation ──────────────────────────────────────────────────── */

  const goChapter = useCallback(
    (idx: number, land: "start" | "end" = "start") => {
      const target = book.chapters.find((c) => c.idx === idx);
      if (!target) return;
      // MAX_SAFE_INTEGER resolves to the final character, and from there the
      // layout pass lands on the last page — which is what going backwards
      // through a chapter boundary should feel like.
      anchorRef.current = land === "start" ? 0 : Number.MAX_SAFE_INTEGER;
      setChapterIdx(idx);
      setPanel(null);
    },
    [book.chapters],
  );

  const nextPage = useCallback(() => {
    if (!scrollMode && page < pageCount - 1) {
      setPage((p) => p + 1);
      return;
    }
    goChapter(chapterIdx + 1, "start");
  }, [scrollMode, page, pageCount, chapterIdx, goChapter]);

  const prevPage = useCallback(() => {
    if (!scrollMode && page > 0) {
      setPage((p) => p - 1);
      return;
    }
    goChapter(chapterIdx - 1, "end");
  }, [scrollMode, page, chapterIdx, goChapter]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        nextPage();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        prevPage();
      } else if (e.key === "Escape") {
        setPanel(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nextPage, prevPage]);

  // Swipe. Tracked on the viewport rather than the page so a horizontal drag
  // still works while the finger is over text.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || scrollMode) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // Ignore anything that reads as a vertical scroll or a tap.
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) nextPage();
    else prevPage();
  };

  /* ── in-book links ───────────────────────────────────────────────── */

  const onContentClick = (e: React.MouseEvent) => {
    const link = (e.target as HTMLElement).closest("a");
    if (!link) return;

    const target = link.getAttribute("data-book-chapter");
    if (target !== null) {
      e.preventDefault();
      goChapter(Number(target), "start");
      return;
    }

    const href = link.getAttribute("href") ?? "";
    if (href.startsWith("#") && href.length > 1) {
      e.preventDefault();
      const content = contentRef.current;
      const el = content?.querySelector(`#${CSS.escape(href.slice(1))}`);
      if (!el || !content) return;
      if (scrollMode) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      const x = el.getBoundingClientRect().left - content.getBoundingClientRect().left;
      setPage(clamp(Math.floor((x + 1) / (size.w + COLUMN_GAP)), 0, pageCount - 1));
    }
    // Everything else is an external link the sanitizer already made safe.
  };

  /* ── preferences ─────────────────────────────────────────────────── */

  function changeFont(next: number) {
    setFontScale(next);
    void setBookPrefsAction({ documentId: book.id, fontScale: next }).catch(() => {});
  }

  function changeTheme(next: BookReaderTheme) {
    setTheme(next);
    void setBookPrefsAction({ documentId: book.id, theme: next }).catch(() => {});
  }

  function changeSpoiler(next: boolean) {
    setSpoilerSafe(next);
    void setBookPrefsAction({ documentId: book.id, spoilerSafe: next })
      .then(() =>
        toast.success(
          next
            ? "The assistant will only see up to where you've read."
            : "The assistant can see the whole book.",
        ),
      )
      .catch(() => {});
  }

  const atStart = chapterIdx === book.chapters[0]?.idx && page === 0;
  const lastIdx = book.chapters[book.chapters.length - 1]?.idx;
  const atEnd = chapterIdx === lastIdx && page >= pageCount - 1;

  return (
    <div
      data-book-theme={theme}
      className={cn(
        "flex h-dvh w-full flex-col overflow-hidden",
        theme === "paper" && "book-theme-paper",
        theme === "night" && "book-theme-night",
        theme === "app" && "bg-background text-foreground",
      )}
    >
      {/* ── top bar ─────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center gap-1 border-b border-border/60 px-2 py-1.5">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => router.push("/directory")}
          title="Back to Directory"
          aria-label="Back to Directory"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <div className="min-w-0 flex-1 px-1">
          <div className="truncate text-sm font-medium leading-tight">{book.title}</div>
          <div className="truncate font-mono text-[11px] uppercase tracking-wide opacity-60">
            {chapter?.title ?? `Chapter ${chapterIdx + 1}`}
          </div>
        </div>

        <Button
          size="icon"
          variant="ghost"
          onClick={() => setPanel((p) => (p === "toc" ? null : "toc"))}
          title="Contents"
          aria-label="Contents"
        >
          <List className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setPanel((p) => (p === "settings" ? null : "settings"))}
          title="Reading settings"
          aria-label="Reading settings"
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </header>

      {/* ── page ────────────────────────────────────────────────── */}
      <div
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="relative min-h-0 flex-1 px-5 py-4 sm:px-10 sm:py-6"
      >
        {/* The measured box is deliberately the one WITHOUT the gutter padding:
            clientWidth on the padded element counts the padding, and columns
            sized from it overhang the page and lose their last words. */}
        <div ref={viewportRef} className="relative h-full w-full overflow-hidden">
        {loadError ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm opacity-70">
            {loadError}
            <Button size="sm" variant="outline" onClick={() => setChapterIdx((i) => i)}>
              Try again
            </Button>
          </div>
        ) : html === null ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin opacity-50" />
          </div>
        ) : (
          <div
            ref={contentRef}
            onClick={onContentClick}
            className={cn("prose-book", scrollMode && "h-full overflow-y-auto")}
            style={
              scrollMode
                ? { ["--book-font-scale" as string]: String(fontScale) }
                : {
                    ["--book-font-scale" as string]: String(fontScale),
                    width: size.w ? `${size.w}px` : "100%",
                    height: size.h ? `${size.h}px` : "100%",
                    columnWidth: size.w ? `${size.w}px` : undefined,
                    columnGap: `${COLUMN_GAP}px`,
                    columnFill: "auto",
                    transform: `translateX(-${page * (size.w + COLUMN_GAP)}px)`,
                    willChange: "transform",
                  }
            }
            onScroll={scrollMode ? onScrollSave : undefined}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
        </div>

        {/* Tap zones: the left and right thirds turn pages, and the middle is
            left alone so text stays selectable and links stay clickable. */}
        {!scrollMode && html !== null && (
          <>
            <button
              aria-label="Previous page"
              onClick={prevPage}
              className="absolute inset-y-0 left-0 w-[18%] cursor-w-resize opacity-0"
            />
            <button
              aria-label="Next page"
              onClick={nextPage}
              className="absolute inset-y-0 right-0 w-[18%] cursor-e-resize opacity-0"
            />
          </>
        )}
      </div>

      {/* ── bottom bar ──────────────────────────────────────────── */}
      <footer className="flex shrink-0 items-center gap-2 border-t border-border/60 px-3 py-2">
        <Button
          size="icon"
          variant="ghost"
          onClick={prevPage}
          disabled={atStart}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="h-0.5 w-full overflow-hidden rounded-full bg-current/15">
            <div
              className="h-full rounded-full bg-current/50 transition-[width]"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <div className="text-center font-mono text-[11px] tabular-nums opacity-60">
            {scrollMode ? (
              <>
                {chapterIdx + 1} / {book.chapters.length}
              </>
            ) : (
              <>
                {page + 1} / {pageCount}
              </>
            )}
            <span className="mx-1.5 opacity-40">·</span>
            {Math.round(progress * 100)}%
          </div>
        </div>

        <Button
          size="icon"
          variant="ghost"
          onClick={nextPage}
          disabled={atEnd}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </footer>

      {/* ── slide-over ──────────────────────────────────────────── */}
      {panel && (
        <>
          <button
            aria-label="Close panel"
            onClick={() => setPanel(null)}
            className="fixed inset-0 z-40 bg-black/30"
          />
          <aside className="fixed inset-y-0 right-0 z-50 flex w-[min(22rem,90vw)] flex-col border-l border-border bg-background text-foreground shadow-xl">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <div className="flex-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                {panel === "toc" ? "Contents" : "Reading"}
              </div>
              <Button size="icon" variant="ghost" onClick={() => setPanel(null)} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>

            {panel === "toc" ? (
              <nav className="min-h-0 flex-1 overflow-y-auto p-2">
                <ul className="space-y-0.5">
                  {book.chapters.map((c) => (
                    <li key={c.idx}>
                      <button
                        onClick={() => goChapter(c.idx, "start")}
                        className={cn(
                          "block w-full truncate rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                          c.idx === chapterIdx
                            ? "bg-accent font-medium text-foreground"
                            : "text-muted-foreground",
                        )}
                        style={{ paddingLeft: `${0.5 + (Math.min(c.navLevel, 4) - 1) * 0.75}rem` }}
                        title={c.title ?? undefined}
                      >
                        {c.title ?? `Chapter ${c.idx + 1}`}
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : (
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3">
                <section>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Type size
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {FONT_STEPS.map((s) => (
                      <button
                        key={s}
                        onClick={() => changeFont(s)}
                        className={cn(
                          "rounded-md border px-2.5 py-1 text-sm transition-colors",
                          Math.abs(s - fontScale) < 0.01
                            ? "border-foreground bg-accent"
                            : "border-border text-muted-foreground hover:bg-accent",
                        )}
                      >
                        {Math.round(s * 100)}%
                      </button>
                    ))}
                  </div>
                </section>

                <section>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Page
                  </div>
                  <div className="flex gap-1">
                    {(["app", "paper", "night"] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => changeTheme(t)}
                        className={cn(
                          "flex-1 rounded-md border px-2 py-1.5 text-sm capitalize transition-colors",
                          theme === t
                            ? "border-foreground bg-accent"
                            : "border-border text-muted-foreground hover:bg-accent",
                        )}
                      >
                        {t === "app" ? "Follow app" : t}
                      </button>
                    ))}
                  </div>
                </section>

                <section>
                  <label className="flex cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={spoilerSafe}
                      onChange={(e) => changeSpoiler(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0"
                    />
                    <span>
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        <Sparkles className="h-3.5 w-3.5" />
                        Spoiler-safe assistant
                      </span>
                      <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                        Ask, Distill and flashcards only see chapters up to the furthest point
                        you&apos;ve reached in this book.
                      </span>
                    </span>
                  </label>
                </section>

                {book.fixedLayout && (
                  <p className="rounded-md border border-border p-2 text-xs leading-snug text-muted-foreground">
                    This is a fixed-layout book, so it scrolls rather than paginating — its pages
                    are designed images and cannot reflow.
                  </p>
                )}
              </div>
            )}
          </aside>
        </>
      )}
    </div>
  );
}
