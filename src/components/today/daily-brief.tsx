"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bookmark,
  Check,
  CheckCheck,
  ExternalLink,
  GraduationCap,
  History,
  Loader2,
  Newspaper,
  RefreshCw,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SourceRow, SourceBadge } from "@/components/ui/source-list";
import { cn } from "@/lib/utils";
import { setReadLaterAction, setReadStatusAction } from "@/app/(app)/feeds/actions";
import { fetchCalendarRange } from "@/app/(app)/study/actions";
import { toast } from "sonner";

type BriefSource = {
  n: number;
  id: string;
  title: string;
  url: string;
  feedTitle: string;
};

type Usage = { promptTokens: number; completionTokens: number; totalTokens: number };

type BriefEntry = {
  generatedAt: string;
  content: string;
  sources: BriefSource[];
  usage: Usage | null;
  fingerprint: string | null;
};

const PROMPT_STORAGE_KEY = "brief.systemPrompt.v1";
const BRIEF_CACHE_KEY = "brief.cache.v2";
const BRIEF_HISTORY_KEY = "brief.history.v1";
const MAX_HISTORY = 10;

// Trailing markers the server appends after the brief text. The client splits
// on these and never renders them. Mirrors /api/brief.
const BRIEFSOURCES_SENTINEL = "<<<SB_BRIEFSOURCES:";
const USAGE_SENTINEL = "<<<SB_USAGE:";

/** Index of the first sentinel marker present in the buffer, or -1. */
function firstSentinel(acc: string): number {
  const a = acc.indexOf(BRIEFSOURCES_SENTINEL);
  const b = acc.indexOf(USAGE_SENTINEL);
  if (a < 0) return b;
  if (b < 0) return a;
  return Math.min(a, b);
}

/** Same calendar day in local time. */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const DEFAULT_PROMPT_PLACEHOLDER = `You are my personal Second Brain curator. I already receive a highly detailed daily news summary via email, so your goal here is NOT to summarize everything. Your goal is rapid triage and discovery.

Review the provided JSON list of my unread articles and newly uploaded documents from the last 24 hours. Generate a short, punchy dashboard using the following strict format:

### High-Priority (Read Now)
Identify the 1-3 most substantial, unique, or high-signal pieces.
* Provide the title, followed by its bracketed reference number (e.g. [3]) so I can jump to the source.
* Write a 1-sentence hook explaining exactly *why* it's worth my time.
* List its primary tag.

### Thematic Clusters (For Batch Reading)
Group the remaining worthwhile articles into broad themes (e.g., "4 items on AI Tools", "2 items on Macroeconomics").
* Do not summarize the individual articles.
* Just list the theme, the article count, and a 1-sentence summary of the overarching trend across those articles.

### Quick Clear (Low Signal / Skip)
Identify any articles that appear to be clickbait, standard PR announcements, highly repetitive news, or low-value fluff.
* List their titles so I can confidently mark them as read or delete them without opening them.

Keep your tone sharp, objective, and extremely concise. Output in clean Markdown.`;

export function DailyBrief() {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [sources, setSources] = useState<BriefSource[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [newArticles, setNewArticles] = useState(false);
  const [history, setHistory] = useState<BriefEntry[]>([]);
  const [studyTasks, setStudyTasks] = useState<{ id: string; text: string }[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [savedPrompt, setSavedPrompt] = useState("");
  const hasMounted = useRef(false);

  // Load saved prompt + cached brief on mount. If a cached brief exists we
  // show it immediately; otherwise we kick off a fresh stream below.
  const [hydratedFromCache, setHydratedFromCache] = useState(false);
  useEffect(() => {
    if (hasMounted.current) return;
    hasMounted.current = true;
    try {
      const saved = localStorage.getItem(PROMPT_STORAGE_KEY) ?? "";
      setSavedPrompt(saved);
      setCustomPrompt(saved);
    } catch {
      // ignore
    }
    try {
      const raw = localStorage.getItem(BRIEF_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          content: string;
          generatedAt: string;
          sources?: BriefSource[];
          usage?: Usage;
          fingerprint?: string;
        };
        if (parsed.content) {
          const genDate = new Date(parsed.generatedAt);
          // The brief stays put until the user regenerates — EXCEPT across a day
          // boundary, where we auto-regenerate. Same day → hydrate from cache.
          // Prior day → leave hydratedFromCache false so the auto-stream effect
          // below generates a fresh brief.
          if (isSameDay(genDate, new Date())) {
            setContent(parsed.content);
            setSources(parsed.sources ?? []);
            setUsage(parsed.usage ?? null);
            setFingerprint(parsed.fingerprint ?? null);
            setGeneratedAt(genDate);
            setLoading(false);
            setHydratedFromCache(true);
          }
        }
      }
    } catch {
      // ignore parse errors
    }
    try {
      const rawHistory = localStorage.getItem(BRIEF_HISTORY_KEY);
      if (rawHistory) setHistory(JSON.parse(rawHistory) as BriefEntry[]);
    } catch {
      // ignore
    }
  }, []);

  const stream = useCallback(async (promptOverride?: string, force = false) => {
    setLoading(true);
    setError(null);
    setContent("");
    setSources([]);
    setUsage(null);
    setNewArticles(false);
    setReadIds(new Set());
    setSavedIds(new Set());
    try {
      const systemPrompt = (promptOverride ?? savedPrompt).trim();
      const res = await fetch("/api/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(systemPrompt ? { systemPrompt } : {}), force }),
        cache: "no-store",
      });
      if (!res.ok) {
        const text = await res.text();
        setError(text || `HTTP ${res.status}`);
        setLoading(false);
        return;
      }
      if (!res.body) {
        setError("No response body");
        setLoading(false);
        return;
      }

      const briefFingerprint = res.headers.get("x-brief-fingerprint");
      if (briefFingerprint) setFingerprint(briefFingerprint);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";

      // Coalesce renders to one per animation frame instead of one per chunk —
      // ReactMarkdown re-parses the whole doc on each render, so per-token
      // updates would re-parse hundreds of times during a long brief.
      let frameQueued = false;
      const flush = () => {
        frameQueued = false;
        const idx = firstSentinel(acc);
        setContent(idx >= 0 ? acc.slice(0, idx) : acc);
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        if (!frameQueued) {
          frameQueued = true;
          requestAnimationFrame(flush);
        }
      }
      flush(); // commit the final chunk

      // Parse trailing sentinels: source map + token usage.
      let briefSources: BriefSource[] = [];
      let briefUsage: Usage | null = null;
      const bIdx = acc.indexOf(BRIEFSOURCES_SENTINEL);
      const uIdx = acc.indexOf(USAGE_SENTINEL);
      if (bIdx >= 0) {
        const end = uIdx > bIdx ? uIdx : acc.length;
        try {
          briefSources = JSON.parse(acc.slice(bIdx + BRIEFSOURCES_SENTINEL.length, end)) as BriefSource[];
          setSources(briefSources);
        } catch {
          // ignore malformed sources
        }
      }
      if (uIdx >= 0) {
        try {
          briefUsage = JSON.parse(acc.slice(uIdx + USAGE_SENTINEL.length)) as Usage;
          setUsage(briefUsage);
        } catch {
          // ignore malformed usage
        }
      }

      const displayContent = firstSentinel(acc) >= 0 ? acc.slice(0, firstSentinel(acc)) : acc;
      const finishedAt = new Date();
      setGeneratedAt(finishedAt);
      // Persist the completed brief so the page hydrates instantly next visit
      try {
        localStorage.setItem(
          BRIEF_CACHE_KEY,
          JSON.stringify({
            content: displayContent,
            generatedAt: finishedAt.toISOString(),
            sources: briefSources,
            usage: briefUsage,
            fingerprint: briefFingerprint,
          }),
        );
      } catch {
        // quota errors — silently ignore
      }
      // Append to the dated archive (most-recent first, capped).
      if (displayContent.trim()) {
        const entry: BriefEntry = {
          generatedAt: finishedAt.toISOString(),
          content: displayContent,
          sources: briefSources,
          usage: briefUsage,
          fingerprint: briefFingerprint,
        };
        setHistory((prev) => {
          const next = [entry, ...prev].slice(0, MAX_HISTORY);
          try {
            localStorage.setItem(BRIEF_HISTORY_KEY, JSON.stringify(next));
          } catch {
            // ignore quota
          }
          return next;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load brief");
    } finally {
      setLoading(false);
    }
  }, [savedPrompt]);

  // Only auto-stream on mount if we don't already have a cached brief.
  useEffect(() => {
    if (hydratedFromCache) return;
    stream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydratedFromCache]);

  // Today's study tasks (from study plans saved to the Directory) — surfaced at
  // the top of the brief so the plan stays visible day-to-day.
  useEffect(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    let cancelled = false;
    fetchCalendarRange(start.toISOString(), end.toISOString())
      .then((entries) => {
        if (cancelled) return;
        setStudyTasks(entries.filter((e) => e.kind === "task").map((e) => ({ id: e.id, text: e.text })));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Tab left open across midnight: regenerate when it regains focus on a new
  // day. (Fresh-open on a new day is handled by the hydrate effect above.)
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      if (loading || !generatedAt) return;
      if (!isSameDay(generatedAt, new Date())) stream();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loading, generatedAt, stream]);

  // Showing a cached brief? Cheaply ask the server whether the unread set has
  // drifted (id-only fingerprint, no model). If so, nudge to regenerate
  // instead of silently showing a stale brief.
  useEffect(() => {
    if (!hydratedFromCache || !fingerprint) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/brief", { method: "GET", cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { fingerprint?: string };
        if (!cancelled && data.fingerprint && data.fingerprint !== fingerprint) {
          setNewArticles(true);
        }
      } catch {
        // offline / transient — keep showing the cached brief
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydratedFromCache, fingerprint]);

  // Mark articles read straight from the brief (optimistic — matches the feeds
  // UI, which also updates optimistically and lets sidebar counts lag).
  const markRead = useCallback(async (ids: string[]) => {
    const fresh = ids.filter(Boolean);
    if (fresh.length === 0) return;
    setReadIds((prev) => new Set([...prev, ...fresh]));
    try {
      const res = await setReadStatusAction({ articleIds: fresh, status: "read" });
      if (!res.ok) throw new Error(res.error);
      toast.success(fresh.length > 1 ? `Marked ${fresh.length} read` : "Marked read");
    } catch {
      // Revert on failure so the row reappears.
      setReadIds((prev) => {
        const next = new Set(prev);
        fresh.forEach((id) => next.delete(id));
        return next;
      });
      toast.error("Couldn't mark read");
    }
  }, []);

  // Save an article to the Read Later queue. Optimistic; toggles on re-click.
  const toggleSaved = useCallback(async (id: string) => {
    const willSave = !savedIds.has(id);
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (willSave) next.add(id);
      else next.delete(id);
      return next;
    });
    try {
      const res = await setReadLaterAction({ articleIds: [id], readLater: willSave });
      if (!res.ok) throw new Error(res.error);
      toast.success(willSave ? "Saved to Read Later" : "Removed from Read Later");
    } catch {
      setSavedIds((prev) => {
        const next = new Set(prev);
        if (willSave) next.delete(id);
        else next.add(id);
        return next;
      });
      toast.error("Couldn't update saved");
    }
  }, [savedIds]);

  function savePrompt() {
    try {
      const trimmed = customPrompt.trim();
      localStorage.setItem(PROMPT_STORAGE_KEY, trimmed);
      localStorage.removeItem(BRIEF_CACHE_KEY); // prompt changed; old brief is stale
      setSavedPrompt(trimmed);
      setSettingsOpen(false);
      toast.success(trimmed ? "Custom prompt saved" : "Reset to default prompt");
      // Regenerate with new prompt (force — bypass server cache)
      stream(trimmed, true);
    } catch {
      toast.error("Couldn't save prompt");
    }
  }

  function resetPrompt() {
    setCustomPrompt("");
  }

  // Load an archived brief into view (read-only snapshot; Regenerate still
  // fetches fresh). Doesn't touch the live cache or history.
  function viewEntry(e: BriefEntry) {
    setContent(e.content);
    setSources(e.sources ?? []);
    setUsage(e.usage ?? null);
    setFingerprint(e.fingerprint ?? null);
    setGeneratedAt(new Date(e.generatedAt));
    setNewArticles(false);
    setReadIds(new Set());
    setError(null);
    setLoading(false);
  }

  const isStale = !loading && generatedAt != null && !isSameDay(generatedAt, new Date());
  const unreadSourceIds = sources.map((s) => s.id).filter((id) => !readIds.has(id));

  return (
    <article className="prose-reader max-w-none">
      <div className="not-prose mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          {loading ? (
            <span>Generating…</span>
          ) : generatedAt ? (
            <span className="flex items-center gap-2">
              <span>
                Generated{" "}
                {isStale
                  ? generatedAt.toLocaleDateString([], { month: "short", day: "numeric" })
                  : generatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
              {(isStale || newArticles) && (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-amber-600 dark:text-amber-400">
                  {newArticles ? "new articles — regenerate" : "stale — regenerate"}
                </span>
              )}
              {savedPrompt && (
                <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] normal-case tracking-normal">
                  custom prompt
                </span>
              )}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {history.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" title="View an earlier brief">
                  <History className="mr-1.5 h-3.5 w-3.5" />
                  History
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Recent briefs</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {history.map((e) => {
                  const d = new Date(e.generatedAt);
                  return (
                    <DropdownMenuItem
                      key={e.generatedAt}
                      onClick={() => viewEntry(e)}
                      className="flex items-center justify-between gap-2"
                    >
                      <span>
                        {d.toLocaleDateString([], { month: "short", day: "numeric" })}{" "}
                        {d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {generatedAt && d.getTime() === generatedAt.getTime() && (
                        <Check className="h-3.5 w-3.5" />
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSettingsOpen((v) => !v)}
            title="Customize the brief prompt"
          >
            <Settings className="mr-1.5 h-3.5 w-3.5" />
            Prompt
          </Button>
          <Button size="sm" variant="brand" onClick={() => stream(undefined, true)} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Regenerate
          </Button>
        </div>
      </div>

      {studyTasks.length > 0 && (
        <div className="not-prose mb-6 rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            <GraduationCap className="h-3 w-3" /> Study — due today
          </div>
          <div className="space-y-1">
            {studyTasks.map((t) => (
              <button
                key={t.id}
                onClick={() => router.push("/study?tab=tasks")}
                className="flex w-full items-start gap-2 rounded-md p-1.5 text-left text-sm transition-colors hover:bg-accent/50"
              >
                <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-[3px] border border-muted-foreground/50" />
                <span className="flex-1">{t.text}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="not-prose mb-6 rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-medium">Custom brief prompt</div>
            <button
              onClick={() => setSettingsOpen(false)}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            This replaces the default editor prompt. The model still receives your unread articles —
            you control the framing.
          </p>
          <Textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder={DEFAULT_PROMPT_PLACEHOLDER}
            className="min-h-[140px] text-sm"
          />
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={resetPrompt}>
              Reset to default
            </Button>
            <Button size="sm" variant="brand" onClick={savePrompt}>
              Save &amp; regenerate
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="not-prose rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <p className="font-medium text-destructive">Couldn&apos;t generate brief</p>
          <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{error}</p>
          {error.includes("ANTHROPIC_API_KEY") && (
            <p className="mt-3 text-xs text-muted-foreground">
              Add an <code className="rounded bg-background px-1">ANTHROPIC_API_KEY</code> environment variable
              and redeploy.
            </p>
          )}
        </div>
      )}

      {loading && !content && (
        <div className="space-y-3">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <div className="h-3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      )}

      {content && (
        <div className="prose-reader max-w-[68ch] text-[1.05rem] leading-[1.85]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          {loading && <span className="ml-1 inline-block h-4 w-2 animate-pulse bg-foreground/40 align-middle" />}
        </div>
      )}

      {!loading && usage && usage.totalTokens > 0 && (
        <div className="not-prose mt-6 flex items-center gap-1.5 text-[10px] tabular-nums text-muted-foreground">
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5">
            Tokens consumed: {usage.totalTokens.toLocaleString()}
          </span>
          <span className="opacity-60">
            ({usage.promptTokens.toLocaleString()} in · {usage.completionTokens.toLocaleString()} out)
          </span>
        </div>
      )}

      {!loading && sources.length > 0 && (
        <div className="not-prose mt-8 border-t border-border pt-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              <Newspaper className="h-3 w-3" /> Articles in this brief
            </div>
            {unreadSourceIds.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 gap-1 px-2 text-[10px]"
                onClick={() => markRead(unreadSourceIds)}
                title="Mark every article in this brief as read"
              >
                <CheckCheck className="h-3 w-3" /> Mark all read
              </Button>
            )}
          </div>
          <div className="space-y-1">
            {sources.map((s) => {
              const isRead = readIds.has(s.id);
              return (
                <div key={s.id} className={isRead ? "opacity-40 transition-opacity" : undefined}>
                  <SourceRow
                    badge={<SourceBadge n={s.n} />}
                    title={s.title}
                    subtitle={s.feedTitle}
                    onClick={() => router.push(`/feeds?article=${s.id}`)}
                    right={
                      <>
                        <button
                          onClick={() => toggleSaved(s.id)}
                          title={savedIds.has(s.id) ? "Saved — remove" : "Save to read later"}
                          className={cn(
                            "shrink-0 rounded p-1 transition-opacity hover:bg-accent",
                            savedIds.has(s.id)
                              ? "text-brand opacity-100"
                              : "text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100",
                          )}
                        >
                          <Bookmark
                            className={cn("h-3.5 w-3.5", savedIds.has(s.id) && "fill-current")}
                          />
                        </button>
                        {!isRead && (
                          <button
                            onClick={() => markRead([s.id])}
                            title="Mark read"
                            className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {s.url && (
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open original article"
                            className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </>
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </article>
  );
}
