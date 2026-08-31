"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Highlighter,
  List,
  Search,
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
import {
  setBookFinishedAction,
  saveBookPositionAction,
  setBookPrefsAction,
} from "@/app/read/actions";
import { searchBookAction, type BookHighlight, type BookSearchHit } from "@/app/read/highlights";
import { celebrate } from "@/lib/gamify/celebrate";
import { BookHighlightLayer } from "./book-highlight-layer";
import { BookExplainPanel } from "./book-explain-panel";

export type BookChapterMeta = {
  idx: number;
  title: string | null;
  charCount: number;
  navLevel: number;
};

export type BookReaderTheme = "app" | "paper" | "night";

export type BookNavEntry = {
  idx: number;
  title: string;
  level: number;
  chapterIdx: number;
  fragment: string | null;
};

export type BookPayload = {
  id: string;
  title: string;
  author: string | null;
  fixedLayout: boolean;
  chapters: BookChapterMeta[];
  /** The book's own contents. Empty falls back to listing the spine. */
  nav: BookNavEntry[];
  finishedAt: string | null;
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

/**
 * Above this, the page splits into a two-column spread.
 *
 * A single column across a desktop window is 150-plus characters a line, which
 * is genuinely hard to read — the eye loses its place on the return sweep. Two
 * columns is also what the paginated metaphor is already shaped like.
 */
const SPREAD_MIN_WIDTH = 900;

const FONT_STEPS = [0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75];

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export function BookReader({
  book,
  initialHtml = null,
  initialHighlights = [],
}: {
  book: BookPayload;
  /** The resume chapter, rendered on the server so the book opens instantly. */
  initialHtml?: string | null;
  /** Every highlight in the book — small enough that page turns never wait. */
  initialHighlights?: BookHighlight[];
}) {
  const router = useRouter();

  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const [chapterIdx, setChapterIdx] = useState(book.state.chapterIdx);
  const [loaded, setLoaded] = useState<{ idx: number; html: string } | null>(
    initialHtml === null ? null : { idx: book.state.chapterIdx, html: initialHtml },
  );
  // Never the previous chapter's markup: a mismatch means the new chapter has
  // not arrived yet, and everything downstream must wait rather than measure
  // the wrong document.
  const html = loaded !== null && loaded.idx === chapterIdx ? loaded.html : null;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [fontScale, setFontScale] = useState(book.state.fontScale);
  const [theme, setTheme] = useState<BookReaderTheme>(book.state.theme ?? "app");
  const [spoilerSafe, setSpoilerSafe] = useState(book.state.spoilerSafe);
  const [panel, setPanel] = useState<"toc" | "settings" | "search" | "explain" | null>(null);
  // The passage the explain panel is working on. Kept here rather than in the
  // panel so a new selection replaces the old explanation instead of stacking.
  const [explaining, setExplaining] = useState<string | null>(null);
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
  const [highlights, setHighlights] = useState<BookHighlight[]>(initialHighlights);
  // Bumped after every relayout so the highlight overlay re-measures. Rects
  // live in the content's coordinate space, which only moves when text does.
  const [layoutTick, setLayoutTick] = useState(0);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<BookSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [dismissedFinish, setDismissedFinish] = useState(false);
  // A phrase to locate once the chapter it lives in has been laid out.
  const pendingSearchRef = useRef<string | null>(null);

  const setContentNode = useCallback((el: HTMLDivElement | null) => {
    contentRef.current = el;
    setContentEl(el);
  }, []);
  const [finishedAt, setFinishedAt] = useState<string | null>(book.finishedAt);

  // A nav entry can point at an anchor inside a chapter; the jump is queued
  // here and consumed once that chapter has been laid out.
  const pendingFragmentRef = useRef<string | null>(null);

  // The character offset the reader is at. Everything layout-dependent is
  // derived from this and re-derived after every reflow, which is what makes a
  // font change or a rotation land back on the same words.
  const anchorRef = useRef(book.state.charOffset);
  const [progress, setProgress] = useState(book.state.progressPct);
  // A chapter's XP, shown for a few seconds beside the progress bar rather than
  // as a toast: a card sliding over the page you are reading, every chapter, is
  // an interruption — the reward belongs in the furniture you already glance at.
  const [xpFlash, setXpFlash] = useState<{ amount: number; at: number } | null>(null);

  // Measured once per reflow and reused for every page turn. Rebuilding it per
  // turn would mean a getBoundingClientRect for every text node in the chapter.
  const indexRef = useRef<ChapterIndex | null>(null);
  // Which chapter indexRef actually describes. The page effect refuses to read
  // an index built from a different chapter's DOM.
  const measuredChapterRef = useRef<number | null>(null);

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
  const columns = !scrollMode && size.w >= SPREAD_MIN_WIDTH ? 2 : 1;
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
      setLoaded({ idx: chapterIdx, html: cached });
      setLoadError(null);
    } else {
      setLoadError(null);
      loadChapter(chapterIdx, ac.signal)
        .then((text) => setLoaded({ idx: chapterIdx, html: text }))
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
    measuredChapterRef.current = chapterIdx;

    const fragment = pendingFragmentRef.current;
    if (fragment) {
      pendingFragmentRef.current = null;
      const target = content.querySelector<HTMLElement>("#" + CSS.escape(fragment));
      if (target) {
        const fx = target.getBoundingClientRect().left - content.getBoundingClientRect().left;
        setPage(clamp(Math.floor((fx + 1) / stride), 0, count - 1));
        anchorRef.current = offsetAtX(index, content, Math.floor(fx / stride) * stride);
        setLayoutTick((t) => t + 1);
        return;
      }
    }

    const phrase = pendingSearchRef.current;
    if (phrase) {
      pendingSearchRef.current = null;
      // The chapter's text, in the same character space every anchor uses, so
      // a match can be turned straight into a page.
      const whole = index.nodes.map((node) => node.data).join("");
      const at = whole.toLowerCase().indexOf(phrase.toLowerCase());
      if (at >= 0) {
        anchorRef.current = at;
        const hx = xOfOffset(index, content, at);
        setPage(hx === null ? 0 : clamp(Math.floor((hx + 1) / stride), 0, count - 1));
        setLayoutTick((t) => t + 1);
        return;
      }
    }

    const x = xOfOffset(index, content, anchorRef.current);
    setPage(x === null ? 0 : clamp(Math.floor((x + 1) / stride), 0, count - 1));
    setLayoutTick((t) => t + 1);
  }, [html, size.w, size.h, fontScale, scrollMode, chapterIdx]);

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
          if (!r.ok) return;
          setProgress(r.progressPct);
          // Only ever set on the save that actually crossed the end of a
          // chapter — the server pays each chapter once, so this cannot repeat
          // while the reader lingers on the last page.
          if (r.xp && r.xp.awarded > 0) {
            setXpFlash({ amount: r.xp.awarded, at: Date.now() });
            celebrate(r.xp);
          }
        })
        .catch(() => {});
    },
    [book.id],
  );

  // Clear the flash a few seconds after the award that set it.
  useEffect(() => {
    if (!xpFlash) return;
    const t = setTimeout(() => setXpFlash(null), 4000);
    return () => clearTimeout(t);
  }, [xpFlash]);

  // After a page turn, record which character now sits at the left edge. That
  // offset is what gets saved, and what the next reflow resolves back to.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || !html || scrollMode) return;

    const index = indexRef.current;
    if (!index || measuredChapterRef.current !== chapterIdx) return;

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
    (idx: number, land: "start" | "end" = "start", fragment: string | null = null) => {
      const target = book.chapters.find((c) => c.idx === idx);
      if (!target) return;
      pendingFragmentRef.current = fragment;
      // MAX_SAFE_INTEGER resolves to the final character, and from there the
      // layout pass lands on the last page — which is what going backwards
      // through a chapter boundary should feel like.
      anchorRef.current = land === "start" ? 0 : Number.MAX_SAFE_INTEGER;
      // Reset the page with the chapter. Left at its old value it is both a
      // flash of the wrong page and a stale number for the effects to read.
      setPage(0);
      setPageCount(1);
      measuredChapterRef.current = null;
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

  async function runSearch() {
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true);
    try {
      const r = await searchBookAction({ documentId: book.id, query: q });
      setHits(r.ok ? r.hits : []);
      if (!r.ok) toast.error(r.error);
    } catch {
      setHits([]);
    } finally {
      setSearching(false);
    }
  }

  function goToHit(hit: BookSearchHit) {
    pendingSearchRef.current = query.trim();
    goChapter(hit.chapterIdx, "start");
  }

  function toggleFinished() {
    const next = finishedAt === null;
    setFinishedAt(next ? new Date().toISOString() : null);
    void setBookFinishedAction({ documentId: book.id, finished: next })
      .then((r) => {
        if (!r.ok) return;
        // Finishing a book is worth hundreds of XP, so say the number rather
        // than leaving it to be noticed on the Study page later. A repeat
        // finish awards nothing (the server pays once per book) — that path
        // falls back to the plain confirmation.
        if (next && r.xp && r.xp.awarded > 0) {
          toast.success(`Finished — +${r.xp.awarded} XP 📖`, {
            description: r.xp.skill ? `Into ${r.xp.skill.name}. That's the whole book.` : "That's the whole book.",
          });
          celebrate(r.xp);
        } else {
          toast.success(next ? "Marked as read." : "Put back on the pile.");
        }
      })
      .catch(() => {});
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

  // The book's contents where it shipped any; the spine only as a fallback,
  // because a spine listing is front matter and continuation files jumbled in
  // with real chapters.
  const contents = useMemo(
    () =>
      book.nav.length > 0
        ? book.nav.map((e) => ({
            key: `n${e.idx}`,
            title: e.title,
            level: e.level,
            chapterIdx: e.chapterIdx,
            fragment: e.fragment,
          }))
        : book.chapters.map((c) => ({
            key: `c${c.idx}`,
            title: c.title ?? `Section ${c.idx + 1}`,
            level: c.navLevel,
            chapterIdx: c.idx,
            fragment: null as string | null,
          })),
    [book.nav, book.chapters],
  );

  // The line you are inside, which for a chapter split across several contents
  // entries is the last one at or before where you are.
  const activeKey = useMemo(() => {
    let key: string | null = null;
    for (const entry of contents) {
      if (entry.chapterIdx <= chapterIdx) key = entry.key;
      else break;
    }
    return key;
  }, [contents, chapterIdx]);

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
          onClick={() => setPanel((p) => (p === "search" ? null : "search"))}
          title="Find in book"
          aria-label="Find in book"
        >
          <Search className="h-4 w-4" />
        </Button>
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
        className="relative mx-auto min-h-0 w-full max-w-[80rem] flex-1 px-5 py-4 sm:px-10 sm:py-6 lg:px-14"
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
          <>
          <div
            ref={setContentNode}
            onClick={onContentClick}
            className={cn("prose-book", scrollMode && "h-full overflow-y-auto")}
            style={
              scrollMode
                ? { ["--book-font-scale" as string]: String(fontScale) }
                : {
                    ["--book-font-scale" as string]: String(fontScale),
                    width: size.w ? `${size.w}px` : "100%",
                    height: size.h ? `${size.h}px` : "100%",
                    // One column on a phone, a two-page spread on a desktop.
                    columnWidth: size.w
                      ? `${(size.w - COLUMN_GAP * (columns - 1)) / columns}px`
                      : undefined,
                    columnGap: `${COLUMN_GAP}px`,
                    columnFill: "auto",
                    transform: `translateX(-${page * (size.w + COLUMN_GAP)}px)`,
                    willChange: "transform",
                  }
            }
            onScroll={scrollMode ? onScrollSave : undefined}
            dangerouslySetInnerHTML={{ __html: html }}
          />
          {/* Same box, same transform: highlight rects are measured in the
              content's own coordinates, so the overlay has to move with it. */}
          {!scrollMode && (
            <div
              className="pointer-events-none absolute inset-0 z-10"
              style={{ transform: `translateX(-${page * (size.w + COLUMN_GAP)}px)` }}
            >
              <BookHighlightLayer
                documentId={book.id}
                chapterIdx={chapterIdx}
                contentEl={contentEl}
                indexRef={indexRef}
                layoutTick={layoutTick}
                onExplain={(text) => {
                  setExplaining(text);
                  setPanel("explain");
                }}
                highlights={highlights}
                onChange={setHighlights}
              />
            </div>
          )}
          </>
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

      {/* Offered where the intent actually is: the last page. Finding the
          settings panel afterwards is a step nobody takes. */}
      {atEnd && !finishedAt && !dismissedFinish && html !== null && (
        <div className="pointer-events-none absolute inset-x-0 bottom-20 z-20 flex justify-center px-4">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-popover py-2 pl-4 pr-2 text-sm shadow-xl">
            <span className="text-muted-foreground">Finished this book?</span>
            <Button size="sm" onClick={toggleFinished} className="h-8 gap-1.5">
              <Check className="h-3.5 w-3.5" />
              Mark as read
            </Button>
            <button
              onClick={() => setDismissedFinish(true)}
              aria-label="Not yet"
              title="Not yet"
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

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
          <div className="relative text-center font-mono text-[11px] tabular-nums opacity-60">
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
            {xpFlash && (
              <span
                key={xpFlash.at}
                aria-live="polite"
                className="pointer-events-none absolute inset-x-0 -top-5 animate-in fade-in slide-in-from-bottom-1 font-sans font-medium text-emerald-500"
              >
                Chapter read · +{xpFlash.amount} XP
              </span>
            )}
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
                {panel === "toc"
                  ? "Contents"
                  : panel === "search"
                    ? "Find in book"
                    : panel === "explain"
                      ? "Explain"
                      : "Reading"}
              </div>
              <Button size="icon" variant="ghost" onClick={() => setPanel(null)} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>

            {panel === "explain" ? (
              explaining ? (
                <BookExplainPanel
                  // Keyed on the passage so a fresh selection remounts the panel
                  // rather than trying to reconcile a half-streamed answer.
                  key={explaining}
                  documentId={book.id}
                  chapterIdx={chapterIdx}
                  passage={explaining}
                />
              ) : (
                <p className="p-4 text-[13px] leading-relaxed text-muted-foreground">
                  Select a passage in the book, then press the sparkle to have it explained.
                </p>
              )
            ) : panel === "search" ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runSearch();
                  }}
                  className="border-b border-border p-2"
                >
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search this book…"
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-foreground/40"
                  />
                </form>

                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  {searching ? (
                    <div className="flex justify-center py-6">
                      <Loader2 className="h-4 w-4 animate-spin opacity-50" />
                    </div>
                  ) : hits === null ? (
                    <p className="px-2 py-4 text-[13px] leading-relaxed text-muted-foreground">
                      Search the whole book. A result jumps to the page its phrase is on.
                    </p>
                  ) : hits.length === 0 ? (
                    <p className="px-2 py-4 text-[13px] text-muted-foreground">
                      Nothing found for that.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {hits.map((hit) => (
                        <li key={hit.chapterIdx}>
                          <button
                            onClick={() => goToHit(hit)}
                            className="block w-full rounded px-2 py-2 text-left transition-colors hover:bg-accent"
                          >
                            <div className="truncate text-xs font-medium text-foreground">
                              {hit.chapterTitle ?? `Chapter ${hit.chapterIdx + 1}`}
                            </div>
                            <div className="mt-0.5 line-clamp-3 text-[13px] leading-snug text-muted-foreground">
                              {hit.snippet}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : panel === "toc" ? (
              <nav className="min-h-0 flex-1 overflow-y-auto p-2">
                <ul className="space-y-0.5">
                  {contents.map((entry) => (
                    <li key={entry.key}>
                      <button
                        onClick={() => goChapter(entry.chapterIdx, "start", entry.fragment)}
                        className={cn(
                          "block w-full rounded px-2 py-1.5 text-left text-sm leading-snug transition-colors hover:bg-accent",
                          entry.key === activeKey
                            ? "bg-accent font-medium text-foreground"
                            : "text-muted-foreground",
                          // Top-level lines are the book's structure; deeper
                          // ones are sections within it and read as such.
                          entry.level === 1 ? "font-medium" : "text-[13px]",
                        )}
                        style={{ paddingLeft: `${0.5 + (Math.min(entry.level, 5) - 1) * 0.85}rem` }}
                        title={entry.title}
                      >
                        {entry.title}
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

                {highlights.length > 0 && (
                  <section className="flex items-center gap-2 rounded-md border border-border p-2.5 text-sm">
                    <Highlighter className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 text-muted-foreground">
                      {highlights.length} highlight{highlights.length === 1 ? "" : "s"} in this book
                    </span>
                  </section>
                )}

                <section>
                  <button
                    onClick={toggleFinished}
                    className={cn(
                      "flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                      finishedAt
                        ? "border-foreground bg-accent text-foreground"
                        : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <Check className="h-4 w-4" />
                    {finishedAt ? "Read" : "Mark as read"}
                  </button>
                  {finishedAt && (
                    <p className="mt-1.5 text-center text-xs text-muted-foreground">
                      Finished {new Date(finishedAt).toLocaleDateString()}
                    </p>
                  )}
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
