"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Bookmark,
  BookmarkPlus,
  BookOpen,
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Highlighter,
  Languages,
  ListChecks,
  Loader2,
  MoreVertical,
  Pause,
  Play,
  Rss,
  Sparkles,
  Star,
  Volume2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { detectLanguage, languageName, LANGUAGE_NAMES, type LanguageCode } from "@/lib/i18n/detect-language";
import {
  getCachedTranslation,
  getTranslatePrefs,
  putCachedTranslation,
  setTranslatePrefs,
  type TranslatePrefs,
} from "@/lib/i18n/translate-prefs";
import { getCachedSimplified, putCachedSimplified } from "@/lib/reader/simplify-cache";
import { walkChunks } from "./chunked-rewrite";
import { getHighlights } from "@/lib/reader/highlights";
import { useShortcuts } from "@/components/reader/use-shortcuts";
import { RelatedPanel } from "@/components/reader/related-panel";
import { DocQueryPanel } from "@/components/reader/doc-query-panel";
import { SelectionToCard } from "@/components/review/selection-card";
import { PaneToggles } from "@/components/shell/pane-toggles";
import {
  createCardsFromTextAction,
  createFlashcardAction,
  proposeCardsFromTextAction,
  type ProposedCard,
} from "@/app/(app)/review/actions";

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

// ── Next-article warm cache ───────────────────────────────────────────
// Continuous reading (scroll past the end → next article) is only pleasant if
// the next article is already there. While you read, we quietly fetch the next
// one's metadata and body so advancing paints instantly instead of flashing a
// skeleton. Full-text extraction is cached server-side, so doing it now simply
// moves the work off the moment you're waiting on it.
type WarmEntry = { meta?: ArticleData; content?: string };
const warmCache = new Map<string, WarmEntry>();
const warmInFlight = new Set<string>();
const WARM_MAX = 5;

function warmArticle(id: string): void {
  if (warmCache.has(id) || warmInFlight.has(id)) return;
  warmInFlight.add(id);
  const entry: WarmEntry = {};
  void Promise.allSettled([
    fetch(`/api/articles/${id}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ArticleData>) : null))
      .then((d) => {
        if (d) entry.meta = d;
      }),
    fetch(`/api/articles/${id}/full-text`, { method: "POST" })
      .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) }))
      .then(({ ok, data }) => {
        if (ok && typeof data.content === "string") entry.content = data.content;
      }),
  ]).then(() => {
    warmInFlight.delete(id);
    // Only cache a usable result; a failed warm should fall through to the
    // normal load (with its error handling) rather than cache a dud.
    if (!entry.meta) return;
    warmCache.set(id, entry);
    while (warmCache.size > WARM_MAX) {
      const oldest = warmCache.keys().next().value;
      if (oldest === undefined) break;
      warmCache.delete(oldest);
    }
  });
}

export function ArticleReader({
  selectedId,
  orderedIds,
  titleById = {},
  onSelect,
  listCollapsed = false,
  onToggleList,
}: {
  selectedId: string | null;
  orderedIds: string[];
  /** Titles for the ids in `orderedIds`, so the end-of-article footer can name
   *  what's coming next. Partial — falls back to a generic label. */
  titleById?: Record<string, string>;
  onSelect: (id: string | null) => void;
  /** Whether the article list (third bar) is collapsed. */
  listCollapsed?: boolean;
  /** Toggle the article list open/closed (desktop). */
  onToggleList?: () => void;
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
  // Mobile immersive reading: hides the reader toolbar while scrolling forward.
  const [chromeHidden, setChromeHidden] = useState(false);
  // ── Translation ────────────────────────────────────────────────────
  const [tPrefs, setTPrefs] = useState<TranslatePrefs>({ target: "en", auto: false });
  const [translation, setTranslation] = useState<{ title: string; content: string } | null>(null);
  const [translating, setTranslating] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  // null = not yet judged / unknown. Detection deliberately stays quiet when
  // unsure, so we simply don't offer a translation in that case.
  const [sourceLang, setSourceLang] = useState<LanguageCode | null>(null);
  useEffect(() => {
    setTPrefs(getTranslatePrefs());
  }, []);
  // ── Reading level ──────────────────────────────────────────────────
  const [simplified, setSimplified] = useState<{ title: string; content: string } | null>(null);
  const [simplifying, setSimplifying] = useState(false);
  const [showSimplified, setShowSimplified] = useState(false);
  // ── Highlights (per device, localStorage) ──────────────────────────
  const [highlights, setHighlights] = useState<string[]>([]);
  const [takeaways, setTakeaways] = useState<{ tldr: string; keyPoints: string[] } | null>(null);
  const [takeawaysLoading, setTakeawaysLoading] = useState(false);
  const [takeawaysSecs, setTakeawaysSecs] = useState<number | null>(null);
  const [takeawayCards, setTakeawayCards] = useState<"idle" | "making" | "done">("idle");
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const restoredFor = useRef<string | null>(null);
  // Live mirror of selectedId so async resolvers can detect a stale article.
  const latestIdRef = useRef<string | null>(selectedId);
  latestIdRef.current = selectedId;
  const [, startTransition] = useTransition();

  const loadTakeaways = useCallback(async () => {
    if (!selectedId || takeawaysLoading) return;
    const reqId = selectedId; // guard against the user paging away mid-fetch
    setTakeawaysLoading(true);
    const started = Date.now();
    try {
      const res = await fetch(`/api/articles/${reqId}/takeaways`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      // Ignore a response for an article that's no longer open.
      if (reqId !== latestIdRef.current) return;
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : "Couldn't generate takeaways");
        return;
      }
      setTakeaways({ tldr: data.tldr, keyPoints: data.keyPoints });
      setTakeawaysSecs(Math.max(1, Math.round((Date.now() - started) / 1000)));
    } catch (err) {
      if (reqId === latestIdRef.current) {
        toast.error(err instanceof Error ? err.message : "Couldn't generate takeaways");
      }
    } finally {
      // Always clear the (shared) loading flag so it can't stick after a switch.
      setTakeawaysLoading(false);
    }
  }, [selectedId, takeawaysLoading]);

  // Takeaways → flashcards: the distilled points are exactly the durable
  // knowledge worth spacing, so feed them (not the whole article) to the deck.
  const makeTakeawayCards = useCallback(async () => {
    if (!takeaways || takeawayCards !== "idle") return;
    setTakeawayCards("making");
    try {
      const text = `${takeaways.tldr}\n\n${takeaways.keyPoints.map((p) => `- ${p}`).join("\n")}`;
      const res = await createCardsFromTextAction({ title: article?.title ?? "Article", text });
      if (res.ok) {
        setTakeawayCards("done");
        toast.success(`${res.count} flashcard${res.count === 1 ? "" : "s"} added to your deck`);
      } else {
        setTakeawayCards("idle");
        toast.error(res.error);
      }
    } catch {
      setTakeawayCards("idle");
      toast.error("Couldn't create flashcards");
    }
  }, [takeaways, takeawayCards, article?.title]);

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
    // The viewport is reused across articles, so an article with no saved
    // progress must be explicitly sent back to the top — otherwise paging to
    // the next article drops you into the middle of it at the old offset.
    if (content && restoredFor.current !== selectedId) {
      restoredFor.current = selectedId;
      let target = 0;
      try {
        const saved = parseFloat(localStorage.getItem(`article.progress.${selectedId}`) ?? "0");
        const max = vp.scrollHeight - vp.clientHeight;
        if (saved > 0.02 && saved < 0.99 && max > 0) target = saved * max;
      } catch {
        // ignore
      }
      vp.scrollTop = target;
    }

    let raf = 0;
    let lastTop = vp.scrollTop;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const max = vp.scrollHeight - vp.clientHeight;
        const p = max > 0 ? Math.min(1, Math.max(0, vp.scrollTop / max)) : 0;
        setProgress(p);
        // Immersive reading (mobile): the toolbar retreats while you read
        // forward and comes back the moment you scroll up or return to the
        // top. Between the app's top bar, this toolbar and the tab bar, a
        // phone spends a fifth of its screen on chrome mid-article.
        const top = vp.scrollTop;
        if (top < 40) setChromeHidden(false);
        else if (top > lastTop + 6) setChromeHidden(true);
        else if (top < lastTop - 6) setChromeHidden(false);
        lastTop = top;
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

  // ── Continuous reading ──────────────────────────────────────────────
  // Reaching the end of an article and continuing to scroll opens the next
  // one, so a reading session never breaks stride to go back to the list.
  // It takes a deliberate extra pull past the bottom (not merely arriving
  // there), so stopping to read the last paragraph never skips you onward.
  const PULL_TO_ADVANCE = 160;
  const [pullProgress, setPullProgress] = useState(0);
  const nextIdRef = useRef<string | null>(null);
  nextIdRef.current = nextId;
  const prevIdRef = useRef<string | null>(null);
  prevIdRef.current = prevId;
  const advancingRef = useRef(false);

  useEffect(() => {
    advancingRef.current = false;
    setPullProgress(0);
    setChromeHidden(false); // a new article always starts with its toolbar shown
    setTranslation(null);
    setShowOriginal(false);
    setSourceLang(null);
    setTranslating(false);
    setSimplified(null);
    setShowSimplified(false);
    setSimplifying(false);
    // Re-reading is a second pass: whatever you marked last time comes back
    // first, so the article opens with your own reading of it.
    setHighlights(selectedId ? getHighlights(selectedId) : []);
  }, [selectedId]);

  // Work out what language this article is in, once its body has loaded.
  useEffect(() => {
    if (!article) return;
    const body = content ?? article.excerpt ?? "";
    if (!body) return;
    setSourceLang(detectLanguage(`${article.title} ${body}`)?.code ?? null);
  }, [article, content]);

  const needsTranslation = sourceLang !== null && sourceLang !== tPrefs.target;

  const translate = useCallback(
    async (articleId: string, target: LanguageCode) => {
      const cached = getCachedTranslation(articleId, target);
      if (cached) {
        setTranslation(cached);
        setShowOriginal(false);
        return;
      }
      setTranslating(true);
      try {
        // Chunk-addressed: the server translates one slice per request, so the
        // article fills in from the top instead of waiting on one long call
        // that the host would kill before it finished.
        const result = await walkChunks(
          `/api/articles/${articleId}/translate`,
          { target },
          {
            isStale: () => articleId !== latestIdRef.current,
            onProgress: (partial) => {
              setTranslation(partial);
              setShowOriginal(false);
            },
          },
        );
        // Paging away mid-translation: drop the result rather than pasting a
        // different article's text over what's now on screen.
        if (result.status === "stale" || articleId !== latestIdRef.current) return;
        if (result.status === "conflict") {
          setSourceLang(target); // already in the target language — stop offering
          setTranslation(null);
          return;
        }
        if (result.status === "error") {
          setTranslation(null);
          toast.error(result.message);
          return;
        }
        const value = { title: result.title, content: result.content };
        setTranslation(value);
        setShowOriginal(false);
        // A part-finished translation is still worth reading, but caching it
        // would silently serve the truncated version forever.
        if (result.partial) toast.error("Only part of this article could be translated.");
        else putCachedTranslation(articleId, target, value);
      } finally {
        if (articleId === latestIdRef.current) setTranslating(false);
      }
    },
    [],
  );

  // Auto-translate when switched on. A cached translation is applied even when
  // auto is off, so re-opening an article you already translated doesn't make
  // you ask twice.
  useEffect(() => {
    if (!article || !needsTranslation || translation || translating) return;
    const cached = getCachedTranslation(article.id, tPrefs.target);
    if (cached) {
      setTranslation(cached);
      return;
    }
    if (tPrefs.auto) void translate(article.id, tPrefs.target);
  }, [article, needsTranslation, translation, translating, tPrefs, translate]);

  const simplify = useCallback(async (articleId: string) => {
    const cached = getCachedSimplified(articleId);
    if (cached) {
      setSimplified(cached);
      setShowSimplified(true);
      return;
    }
    setSimplifying(true);
    try {
      // One model call per request, walked from the client — a whole-article
      // rewrite in a single request cannot finish inside the host's function
      // timeout, which is why this used to fail on anything long.
      const result = await walkChunks(
        `/api/articles/${articleId}/simplify`,
        {},
        {
          isStale: () => articleId !== latestIdRef.current,
          onProgress: (partial) => {
            setSimplified(partial);
            setShowSimplified(true);
          },
        },
      );
      // Paging away mid-rewrite: drop the result rather than pasting a
      // different article's text over what's now on screen.
      if (result.status === "stale" || articleId !== latestIdRef.current) return;
      if (result.status !== "ok") {
        setSimplified(null);
        setShowSimplified(false);
        toast.error(result.status === "error" ? result.message : "Couldn't simplify this article");
        return;
      }
      const value = { title: result.title, content: result.content };
      setSimplified(value);
      setShowSimplified(true);
      // Don't cache a truncated rewrite — that would serve the cut-off version
      // on every later visit with no way to ask for the rest.
      if (result.partial) toast.error("Only part of this article could be simplified.");
      else putCachedSimplified(articleId, value);
    } finally {
      if (articleId === latestIdRef.current) setSimplifying(false);
    }
  }, []);

  // Re-opening an article you already simplified restores that version, so you
  // don't pay for the same rewrite twice.
  useEffect(() => {
    if (!article || simplified || simplifying) return;
    const cached = getCachedSimplified(article.id);
    if (cached) setSimplified(cached);
  }, [article, simplified, simplifying]);

  const showTranslated = translation !== null && !showOriginal;
  // Reading level takes precedence over translation: both rewrite the body from
  // the same source, so they're alternatives rather than layers.
  const showingSimplified = simplified !== null && showSimplified;
  const displayTitle = showingSimplified
    ? simplified.title || article?.title
    : showTranslated
      ? translation.title || article?.title
      : article?.title;
  const displayContent = showingSimplified
    ? simplified.content
    : showTranslated
      ? translation.content
      : content;

  // Warm the next article once this one has settled. Delayed so paging quickly
  // with j/j/j doesn't fire off an extraction for every article skimmed past —
  // we only prefetch what you look likely to actually reach.
  useEffect(() => {
    if (!nextId || loadingContent) return;
    const t = setTimeout(() => warmArticle(nextId), 1200);
    return () => clearTimeout(t);
  }, [nextId, loadingContent]);

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;
    const vp = root.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (!vp) return;

    let pull = 0;
    let lastTouchY: number | null = null;
    let decay: ReturnType<typeof setTimeout> | null = null;
    const atBottom = () => vp.scrollHeight - vp.clientHeight - vp.scrollTop <= 2;
    const reset = () => {
      pull = 0;
      lastTouchY = null;
      setPullProgress(0);
    };

    const addPull = (dy: number) => {
      if (dy <= 0 || advancingRef.current || !nextIdRef.current || !atBottom()) return;
      pull += dy;
      setPullProgress(Math.min(1, pull / PULL_TO_ADVANCE));
      // Let the intent lapse if they stop — a pull only counts while continuous.
      if (decay) clearTimeout(decay);
      decay = setTimeout(reset, 700);
      if (pull >= PULL_TO_ADVANCE) {
        const id = nextIdRef.current;
        advancingRef.current = true;
        reset();
        if (id) goToArticle(id);
      }
    };

    const onWheel = (e: WheelEvent) => addPull(e.deltaY);
    const onTouchStart = (e: TouchEvent) => {
      lastTouchY = e.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY;
      if (y == null || lastTouchY == null) return;
      addPull(lastTouchY - y); // finger travelling up = scrolling further down
      lastTouchY = y;
    };

    vp.addEventListener("wheel", onWheel, { passive: true });
    vp.addEventListener("touchstart", onTouchStart, { passive: true });
    vp.addEventListener("touchmove", onTouchMove, { passive: true });
    vp.addEventListener("touchend", reset, { passive: true });
    vp.addEventListener("touchcancel", reset, { passive: true });
    return () => {
      vp.removeEventListener("wheel", onWheel);
      vp.removeEventListener("touchstart", onTouchStart);
      vp.removeEventListener("touchmove", onTouchMove);
      vp.removeEventListener("touchend", reset);
      vp.removeEventListener("touchcancel", reset);
      if (decay) clearTimeout(decay);
    };
  }, [goToArticle]);

  // Swipe left/right to page between articles. The reader's prev/next buttons
  // are desktop-only, so on a phone this was the missing way back to the
  // previous article. Thresholds match the article list's swipe actions: a
  // decisively horizontal drag, so it never steals a scroll or a text
  // selection.
  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;
    const vp = root.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (!vp) return;

    let start: { x: number; y: number } | null = null;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      start = t ? { x: t.clientX, y: t.clientY } : null;
    };
    const onEnd = (e: TouchEvent) => {
      const s = start;
      start = null;
      const t = e.changedTouches[0];
      if (!s || !t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) < 70 || Math.abs(dx) <= Math.abs(dy)) return;
      const id = dx < 0 ? nextIdRef.current : prevIdRef.current;
      if (id) goToArticle(id);
    };

    vp.addEventListener("touchstart", onStart, { passive: true });
    vp.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      vp.removeEventListener("touchstart", onStart);
      vp.removeEventListener("touchend", onEnd);
    };
  }, [goToArticle]);

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
  // the title + the de-HTML'd body (falls back to the RSS excerpt). Follows
  // what's on screen, so a translated article is read in the language you're
  // actually reading it in.
  const ttsText = useMemo(() => {
    const html = displayContent ?? article?.excerpt ?? "";
    const body = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!body) return "";
    const heading = displayTitle ?? article?.title;
    return heading ? `${heading}. ${body}` : body;
  }, [displayContent, displayTitle, article]);

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
    setTakeawayCards("idle");

    if (!selectedId) {
      setArticle(null);
      return;
    }

    let aborted = false;

    // Already warmed while reading the previous article — paint immediately and
    // skip both round-trips. This is what makes scroll-to-next feel continuous.
    const warm = warmCache.get(selectedId);
    if (warm?.meta) {
      warmCache.delete(selectedId);
      setArticle(warm.meta);
      setLoadingMeta(false);
      const body = warm.content ?? warm.meta.fullText;
      if (body) {
        setContent(body);
        setLoadingContent(false);
        return;
      }
      // Meta was warm but the body wasn't — fall through to fetch just the body.
      setLoadingContent(true);
      fetch(`/api/articles/${selectedId}/full-text`, { method: "POST" })
        .then(async (res) => ({ ok: res.ok, data: await res.json().catch(() => ({})) }))
        .then(({ ok, data }) => {
          if (aborted) return;
          if (!ok) setExtractError(typeof data.error === "string" ? data.error : "Failed to load");
          else if (typeof data.content === "string") setContent(data.content);
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
    }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- auto-mark-read fires once per opened article (by ID); depending on `article` would re-arm on every status flip
  }, [article?.id]);

  // Note: RSS articles are NOT auto-tagged anymore — tagging is the Directory's
  // job. Save the article to your Directory (bookmark icon) to get tags +
  // routing. This makes article-open instant.

  // Empty state (no selection) is rendered by FeedsShell — this component is
  // now dynamically imported and only mounted once an article is selected.

  const readingMinutes = content
    ? Math.max(1, Math.ceil(content.replace(/<[^>]+>/g, " ").split(/\s+/).length / 250))
    : null;
  const minutesRemaining = readingMinutes ? Math.max(0, Math.ceil(readingMinutes * (1 - progress))) : null;

  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden motion-safe:animate-page-in" data-reader-theme={prefs.theme}>
      {/* Collapses (mobile only) while reading forward — see setChromeHidden.
          max-h caps well above the row's natural ~52px so it never clips. */}
      <div
        className={cn(
          "flex items-center gap-1 overflow-hidden border-b border-border px-2 transition-all duration-200 motion-reduce:transition-none",
          chromeHidden
            ? "max-lg:max-h-0 max-lg:border-b-0 max-lg:py-0 max-lg:opacity-0 max-h-20 py-2 lg:opacity-100"
            : "max-h-20 py-2 opacity-100",
        )}
      >
        {/* Mobile-only back: returns to the article list (list is hidden on
            mobile while reading; side-by-side on md+ so no button needed). */}
        <Button size="sm" variant="ghost" onClick={close} className="lg:hidden -ml-1 gap-1 px-2">
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>
        <PaneToggles listCollapsed={listCollapsed} onToggleList={onToggleList} className="mr-0.5" />
        <Button
          size="icon"
          variant="ghost"
          disabled={!prevId}
          onClick={() => prevId && goToArticle(prevId)}
          title="Previous (k)"
          className="hidden sm:inline-flex"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          disabled={!nextId}
          onClick={() => nextId && goToArticle(nextId)}
          title="Next (j)"
          className="hidden sm:inline-flex"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Separator orientation="vertical" className="mx-1 hidden h-5 sm:block" />
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
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setQueryOpen((v) => !v)}
          title="Ask about this article"
          disabled={!article}
          className={cn("hidden sm:inline-flex", queryOpen && "text-primary")}
        >
          <Sparkles className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={toggleReadLater}
          title={article?.readLater ? "Remove from Read Later (b)" : "Read later (b)"}
          disabled={!article}
          className="hidden sm:inline-flex"
        >
          <Bookmark className={cn("h-4 w-4", article?.readLater && "fill-brand text-brand")} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={toggleStar}
          title="Star (s)"
          disabled={!article}
          className="hidden sm:inline-flex"
        >
          <Star className={article?.starred ? "fill-yellow-500 text-yellow-500" : ""} />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" title="More actions" disabled={!article}>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/* Mobile-only: these live as standalone icons on desktop (sm+). */}
            <DropdownMenuItem className="sm:hidden" onClick={() => setQueryOpen((v) => !v)} disabled={!article}>
              <Sparkles className="mr-2 h-3.5 w-3.5" /> Ask about this article
            </DropdownMenuItem>
            <DropdownMenuItem className="sm:hidden" onClick={toggleReadLater} disabled={!article}>
              <Bookmark className={cn("mr-2 h-3.5 w-3.5", article?.readLater && "fill-brand text-brand")} />
              {article?.readLater ? "Remove from Read Later" : "Read later"}
            </DropdownMenuItem>
            <DropdownMenuItem className="sm:hidden" onClick={toggleStar} disabled={!article}>
              <Star className={cn("mr-2 h-3.5 w-3.5", article?.starred && "fill-yellow-500 text-yellow-500")} />
              {article?.starred ? "Unstar" : "Star"}
            </DropdownMenuItem>
            <DropdownMenuSeparator className="sm:hidden" />
            {ttsSupported && (
              <DropdownMenuItem onClick={toggleListen} disabled={!ttsText && ttsState === "idle"}>
                {ttsState === "speaking" ? (
                  <Pause className="mr-2 h-3.5 w-3.5" />
                ) : ttsState === "paused" ? (
                  <Play className="mr-2 h-3.5 w-3.5" />
                ) : (
                  <Volume2 className="mr-2 h-3.5 w-3.5" />
                )}
                {ttsState === "speaking" ? "Pause" : ttsState === "paused" ? "Resume" : "Listen"}
                <span className="ml-auto text-[10px] text-muted-foreground">L</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={loadTakeaways} disabled={takeawaysLoading}>
              {takeawaysLoading ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <ListChecks className="mr-2 h-3.5 w-3.5" />
              )}
              Key takeaways
            </DropdownMenuItem>
            <DropdownMenuItem onClick={saveToDirectory}>
              <BookmarkPlus className="mr-2 h-3.5 w-3.5" /> Save to Directory
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={article?.url ?? "#"} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-3.5 w-3.5" /> Open original
                <span className="ml-auto text-[10px] text-muted-foreground">V</span>
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ReaderControls />
      </div>
      {/* #2 Reading-progress strip */}
      <div className="h-0.5 w-full bg-border/60" aria-hidden>
        <div
          className="h-full transition-[width] duration-150 ease-out"
          style={{ width: `${Math.round(progress * 100)}%`, background: "hsl(var(--brand))" }}
        />
      </div>
      <ScrollArea ref={scrollRootRef} className="min-w-0 flex-1">
        <article
          className="prose-reader overflow-x-hidden px-4 py-8"
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

              <h1 className="editorial-display">{displayTitle}</h1>
              <TranslationBar
                sourceLang={sourceLang}
                target={tPrefs.target}
                auto={tPrefs.auto}
                translating={translating}
                hasTranslation={translation !== null}
                showingOriginal={showOriginal}
                onTranslate={() => article && translate(article.id, tPrefs.target)}
                onToggleOriginal={() => setShowOriginal((v) => !v)}
                onSetTarget={(target) => {
                  setTPrefs(setTranslatePrefs({ target }));
                  setTranslation(null);
                  setShowOriginal(false);
                }}
                onToggleAuto={() => setTPrefs(setTranslatePrefs({ auto: !tPrefs.auto }))}
              />
              {!loadingContent && (
                <ReadingLevelBar
                  simplifying={simplifying}
                  hasSimplified={simplified !== null}
                  showingSimplified={showingSimplified}
                  onSimplify={() => article && simplify(article.id)}
                  onToggle={() => setShowSimplified((v) => !v)}
                />
              )}
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
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="editorial-eyebrow-brand inline-flex items-center gap-1.5">
                      <ListChecks className="h-3 w-3" /> § Key takeaways
                    </span>
                    <span className="flex items-center gap-2">
                      {takeawaysSecs != null && (
                        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                          Generated · {takeawaysSecs} sec
                        </span>
                      )}
                      {/* Takeaways are pre-distilled card material — one click
                          turns them into recall cards for the review deck. */}
                      <button
                        onClick={makeTakeawayCards}
                        disabled={takeawayCards !== "idle"}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-accent disabled:opacity-60"
                      >
                        {takeawayCards === "making" ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <ListChecks className="h-3 w-3" style={{ color: "hsl(var(--brand))" }} />
                        )}
                        {takeawayCards === "done" ? "Cards added" : "Make cards"}
                      </button>
                    </span>
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
              {highlights.length > 0 && !loadingContent && (
                <HighlightsRecap highlights={highlights} />
              )}
              {displayContent ? (
                // Select any passage → floating "Make flashcard" / "Highlight".
                <SelectionToCard
                  sourceTitle={article?.title ?? ""}
                  articleId={article?.id}
                  onHighlight={setHighlights}
                >
                  <div dangerouslySetInnerHTML={{ __html: displayContent }} />
                </SelectionToCard>
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
              {article && !loadingContent && (
                <CardsFromArticle
                  title={displayTitle ?? article.title}
                  text={(displayContent ?? article.excerpt ?? "").replace(/<[^>]+>/g, " ")}
                />
              )}
              {article && !loadingContent && (
                <NextUpFooter
                  nextId={nextId}
                  nextTitle={nextId ? titleById[nextId] : undefined}
                  pullProgress={pullProgress}
                  onNext={() => nextId && goToArticle(nextId)}
                  onBackToList={close}
                />
              )}
            </>
          )}
        </article>
      </ScrollArea>
      {article && (
        <DocQueryPanel
          open={queryOpen}
          docId={article.id}
          // Ask about the text you can actually see — if you're reading a
          // translation, questions and answers should be in that language too.
          title={displayTitle ?? article.title}
          content={displayContent ?? article.excerpt ?? ""}
          onClose={() => setQueryOpen(false)}
        />
      )}
    </section>
  );
}

/**
 * What you marked last time, above the body on re-read. A second pass through
 * an article is worth more when it starts from your own first pass, rather than
 * from the top again — so the passages you kept lead, and the article follows.
 */
function HighlightsRecap({ highlights }: { highlights: string[] }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="not-prose mb-8 rounded-lg border border-border bg-muted/40 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="editorial-eyebrow-brand inline-flex items-center gap-1.5">
          <Highlighter className="h-3 w-3" /> § You highlighted
        </span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {open ? "Hide" : `Show ${highlights.length}`}
        </button>
      </div>
      {open && (
        <ul className="space-y-2">
          {highlights.map((h, i) => (
            <li
              key={`${i}-${h.slice(0, 24)}`}
              className="border-l-2 pl-3 text-[13px] leading-relaxed text-muted-foreground"
              style={{ borderColor: "hsl(var(--brand) / 0.5)" }}
            >
              {h}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Reading-level strip under the headline. Same bargain as translation: a
 * machine rewrite is an aid, not a replacement, so the original is always one
 * tap away — and nothing is rewritten until asked, because it costs a model
 * call per article.
 */
function ReadingLevelBar({
  simplifying,
  hasSimplified,
  showingSimplified,
  onSimplify,
  onToggle,
}: {
  simplifying: boolean;
  hasSimplified: boolean;
  showingSimplified: boolean;
  onSimplify: () => void;
  onToggle: () => void;
}) {
  return (
    <div className="not-prose mt-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
      <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">
        {hasSimplified
          ? showingSimplified
            ? "Simplified — shorter sentences, jargon explained"
            : "Original wording"
          : "Heavy going? Read a plainer version."}
      </span>

      {hasSimplified ? (
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={onToggle}>
          {showingSimplified ? "Show original" : "Show simplified"}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="h-6 gap-1 px-2 text-xs"
          onClick={onSimplify}
          disabled={simplifying}
        >
          {simplifying && <Loader2 className="h-3 w-3 animate-spin" />}
          {simplifying ? "Simplifying…" : "Explain more simply"}
        </Button>
      )}
    </div>
  );
}

/**
 * Translation strip under the headline.
 *
 * Hidden only when the article is confidently already in your reading language.
 * When detection is unsure it still offers the button rather than disappearing:
 * silently hiding the control was indistinguishable from the feature being
 * broken, and the translation engine detects the source language better than a
 * stopword heuristic can anyway.
 *
 * Once translated, the original is always one tap away — machine translation is
 * an aid, not a replacement.
 */
function TranslationBar({
  sourceLang,
  target,
  auto,
  translating,
  hasTranslation,
  showingOriginal,
  onTranslate,
  onToggleOriginal,
  onSetTarget,
  onToggleAuto,
}: {
  sourceLang: LanguageCode | null;
  target: LanguageCode;
  auto: boolean;
  translating: boolean;
  hasTranslation: boolean;
  showingOriginal: boolean;
  onTranslate: () => void;
  onToggleOriginal: () => void;
  onSetTarget: (target: LanguageCode) => void;
  onToggleAuto: () => void;
}) {
  // Known to already be in the reading language, and nothing translated yet:
  // the only case where the strip is genuinely noise.
  if (sourceLang === target && !hasTranslation) return null;
  return (
    <div className="not-prose mt-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
      <Languages className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">
        {hasTranslation
          ? showingOriginal
            ? `Original — ${sourceLang ? languageName(sourceLang) : "source"}`
            : `Translated to ${languageName(target)}`
          : sourceLang
            ? `This article is in ${languageName(sourceLang)}.`
            : "Not in your reading language?"}
      </span>

      {hasTranslation ? (
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={onToggleOriginal}>
          {showingOriginal ? `Show ${languageName(target)}` : "Show original"}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="h-6 gap-1 px-2 text-xs"
          onClick={onTranslate}
          disabled={translating}
        >
          {translating && <Loader2 className="h-3 w-3 animate-spin" />}
          {translating ? "Translating…" : `Translate to ${languageName(target)}`}
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="ml-auto h-6 px-2 text-xs text-muted-foreground">
            Options
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[50vh] w-52 overflow-y-auto">
          <DropdownMenuItem onClick={onToggleAuto}>
            {auto ? "Stop translating automatically" : "Translate automatically"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {(Object.keys(LANGUAGE_NAMES) as LanguageCode[]).map((code) => (
            <DropdownMenuItem
              key={code}
              onClick={() => onSetTarget(code)}
              className="flex items-center justify-between"
            >
              {languageName(code)}
              {code === target && <span className="text-[10px] text-muted-foreground">current</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * End-of-article capture. The moment after reading is when context is
 * freshest and effort lowest — but nothing reaches the study deck until it's
 * explicitly kept.
 */
function CardsFromArticle({ title, text }: { title: string; text: string }) {
  const [state, setState] = useState<"idle" | "drafting" | "review">("idle");
  const [cards, setCards] = useState<ProposedCard[]>([]);
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [keptCount, setKeptCount] = useState(0);

  async function draft() {
    setState("drafting");
    try {
      const r = await proposeCardsFromTextAction({ title, text });
      if (!r.ok) {
        toast.error(r.error);
        setState("idle");
        return;
      }
      setCards(r.cards);
      setState("review");
    } catch {
      toast.error("Couldn't draft cards from this article");
      setState("idle");
    }
  }

  function discard(idx: number) {
    setCards((prev) => prev.filter((_, i) => i !== idx));
  }

  async function keep(idx: number) {
    const card = cards[idx];
    if (!card || savingIdx !== null) return;
    setSavingIdx(idx);
    try {
      const r = await createFlashcardAction({ question: card.question, answer: card.answer, itemId: null });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setKeptCount((n) => n + 1);
      discard(idx);
    } catch {
      toast.error("Couldn't save that card");
    } finally {
      setSavingIdx(null);
    }
  }

  if (!text.trim()) return null;

  return (
    <div className="not-prose mt-10 border-t border-border pt-5">
      <div className="editorial-eyebrow-brand mb-2">§ Remember this</div>
      {state !== "review" && (
        <>
          <p className="mb-3 text-xs text-muted-foreground">
            Turn what you just read into flashcards. You choose which ones to keep.
          </p>
          <Button size="sm" variant="outline" onClick={draft} disabled={state === "drafting"}>
            {state === "drafting" ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Brain className="mr-1.5 h-3.5 w-3.5" />
            )}
            {state === "drafting" ? "Drafting…" : "Make cards from this"}
          </Button>
        </>
      )}
      {state === "review" && (
        <>
          <p className="mb-3 text-xs text-muted-foreground">
            {cards.length > 0
              ? "Keep the ones worth remembering."
              : keptCount > 0
                ? `Added ${keptCount} card${keptCount === 1 ? "" : "s"} to your deck.`
                : "No cards kept."}
          </p>
          <div className="space-y-2">
            {cards.map((c, i) => (
              <div key={`${i}-${c.question}`} className="rounded-md border border-border p-3">
                <div className="text-sm font-medium leading-snug">{c.question}</div>
                <div className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{c.answer}</div>
                <div className="mt-2 flex gap-1.5">
                  <Button
                    size="sm"
                    variant="brand"
                    className="h-7 px-2 text-xs"
                    onClick={() => keep(i)}
                    disabled={savingIdx !== null}
                  >
                    {savingIdx === i ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <Check className="mr-1 h-3 w-3" />
                    )}
                    Keep
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    onClick={() => discard(i)}
                    disabled={savingIdx !== null}
                  >
                    <X className="mr-1 h-3 w-3" /> Discard
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * End-of-article rail: names what's next and fills a progress bar as the reader
 * keeps scrolling past the bottom, so the auto-advance is visible and
 * predictable rather than a surprise jump. Also works as a plain button for
 * anyone who'd rather tap than scroll.
 */
function NextUpFooter({
  nextId,
  nextTitle,
  pullProgress,
  onNext,
  onBackToList,
}: {
  nextId: string | null;
  nextTitle?: string;
  pullProgress: number;
  onNext: () => void;
  onBackToList: () => void;
}) {
  if (!nextId) {
    return (
      <div className="not-prose mt-10 border-t border-border pt-5 text-center">
        <p className="text-sm italic text-muted-foreground">That&apos;s the last article here.</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={onBackToList}>
          Back to the list
        </Button>
      </div>
    );
  }
  return (
    <div className="not-prose mt-10 border-t border-border pt-5">
      <div className="editorial-eyebrow-brand mb-2">§ Next up</div>
      <button onClick={onNext} className="group/next block w-full text-left">
        <div
          className="font-medium leading-snug transition-colors group-hover/next:text-brand"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          {nextTitle ?? "The next article"}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Keep scrolling to open it — or tap here.
        </div>
      </button>
      {/* Fills as the reader pulls past the bottom; at 100% the next article opens. */}
      <div className="mt-3 h-0.5 w-full overflow-hidden rounded-full bg-border/60" aria-hidden>
        <div
          className="h-full rounded-full transition-[width] duration-75 ease-out"
          style={{ width: `${Math.round(pullProgress * 100)}%`, background: "hsl(var(--brand))" }}
        />
      </div>
    </div>
  );
}
