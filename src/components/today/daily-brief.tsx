"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CitedMarkdown, type Citation } from "@/components/ui/cited-markdown";
import {
  AlertTriangle,
  Bookmark,
  Brain,
  Check,
  CheckCheck,
  Compass,
  ExternalLink,
  GraduationCap,
  History,
  Layers,
  Loader2,
  Newspaper,
  RefreshCw,
  RotateCw,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SourceRow, SourceBadge } from "@/components/ui/source-list";
import { BRIEFSOURCES_SENTINEL, USAGE_SENTINEL, displayText } from "@/lib/ai/stream-markers";
import { cn } from "@/lib/utils";
import { setReadLaterAction, setReadStatusAction } from "@/app/(app)/feeds/actions";
import { fetchCalendarRange } from "@/app/(app)/study/actions";
import { fetchRecallCardsAction, gradeCardAction, type RecallCard } from "@/app/(app)/review/actions";
import { updateUserSettingsAction } from "@/lib/settings/actions";
import {
  BRIEF_LEVELS,
  BRIEF_LEVEL_CONFIG,
  DEFAULT_BRIEF_LEVEL,
  type BriefLevel,
} from "@/lib/today/brief-plan";
import { BRIEF_TOPICS } from "@/lib/today/topics";
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
const SYNTHESIS_CACHE_KEY = "brief.weeklySynthesis.v1";
const MAX_HISTORY = 10;

/** ISO week key ("2026-W30") — the cache identity for the weekly synthesis, so
 *  a new week naturally invalidates the last one. */
function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // ISO weeks run Mon–Sun and belong to the year containing their Thursday.
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Same calendar day in local time. */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Time-of-day greeting. */
function greetingFor(d: Date): string {
  const h = d.getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
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

// ── Sectioned generation ────────────────────────────────────────────────
// The brief is planned server-side with no model involved, then generated one
// section at a time — one short request each. That's what lets it be far more
// detailed than a single call could manage on a host that kills long functions
// (see the comments in src/app/api/brief/route.ts), and it means a section that
// fails costs only that section.

type PlanSection = {
  key: string;
  kind: "lead" | "topic" | "skip";
  topicId?: string;
  label: string;
  refs: number[];
};

type Desk = { topicId: string; label: string; count: number; included: boolean };

type BriefPlanResponse = {
  fingerprint: string;
  count: number;
  windowLabel: string;
  level: BriefLevel;
  priority: string[];
  sections: PlanSection[];
  desks: Desk[];
  sources: BriefSource[];
};

type BlockStatus = "pending" | "streaming" | "done" | "error";

/** One rendered chunk of the brief. A hydrated brief arrives as a single
 *  `stored` block whose text already contains its own headings. */
type Block = {
  key: string;
  kind: PlanSection["kind"] | "stored";
  /** Heading rendered above the text; empty for a stored brief. */
  label: string;
  refs: number[];
  text: string;
  status: BlockStatus;
  error?: string;
};

function blockMarkdown(b: Block): string {
  const text = b.text.trim();
  if (!text) return "";
  return b.label ? `### ${b.label}\n\n${text}` : text;
}

/** The whole brief as one markdown document — what gets cached and archived. */
function assembleBrief(blocks: Block[]): string {
  return blocks.map(blockMarkdown).filter(Boolean).join("\n\n");
}

/** Run `fn` over `items` with at most `limit` in flight. Keeps a deep brief's
 *  wall-clock down without firing eight requests at once. */
async function runWithLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

/** Server-stored brief handed to the client for instant paint (no fetch). */
export type InitialBrief = {
  content: string;
  sources: BriefSource[];
  usage: Usage | null;
  generatedAt: string;
  fingerprint: string | null;
  /** The stored brief was generated under different depth/desk settings. */
  settingsChanged?: boolean;
};

export function DailyBrief({
  name,
  initialBrief,
  level: initialLevel,
  followedTopics: initialTopics,
}: {
  name?: string;
  initialBrief?: InitialBrief | null;
  level?: BriefLevel;
  followedTopics?: string[];
}) {
  const router = useRouter();
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [sources, setSources] = useState<BriefSource[]>([]);
  const [desks, setDesks] = useState<Desk[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [newArticles, setNewArticles] = useState(false);
  const [history, setHistory] = useState<BriefEntry[]>([]);
  const [studyTasks, setStudyTasks] = useState<{ id: string; text: string }[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  // Background refresh in progress: the stored brief stays on screen while a
  // fresh one streams in behind it (new-day auto-regenerate).
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Ordinary "nothing to brief on" state — not a failure. */
  const [note, setNote] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [savedPrompt, setSavedPrompt] = useState("");
  const [level, setLevel] = useState<BriefLevel>(initialLevel ?? DEFAULT_BRIEF_LEVEL);
  const [followed, setFollowed] = useState<string[]>(initialTopics ?? []);
  const hasMounted = useRef(false);
  // Set synchronously when we hydrate a same-day brief from cache. A ref (not
  // state) so the auto-stream effect below — which runs in the SAME commit as
  // the cache-load effect — sees it immediately instead of the batched, still-
  // false `hydratedFromCache` state, which made the brief re-stream every load.
  const cacheHydratedRef = useRef(false);
  // Latest saved prompt, readable synchronously. The auto-stream effect captures
  // `generate` from the first render (savedPrompt still ""), so without this the
  // first brief of the day would generate sectioned, ignoring a user's saved
  // custom prompt.
  const savedPromptRef = useRef("");
  // Set during mount hydration when the stored brief is from a prior day (or was
  // generated under different settings), so the auto-stream effect refreshes it
  // in the background instead of leaving yesterday's brief up.
  const backgroundRegenRef = useRef(false);
  // The plan the on-screen sections came from — retry needs it.
  const planRef = useRef<BriefPlanResponse | null>(null);
  // Token totals summed across a generation's section calls.
  const usageRef = useRef<Usage>({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  // Bumped on every new generation so a late chunk from an abandoned one is
  // dropped instead of writing into the new brief.
  const runRef = useRef(0);
  // Whether the blocks on screen came from a generation in THIS session — only
  // those get written back to the cache/archive.
  const producedRef = useRef(false);
  const generatedAtRef = useRef<Date | null>(null);
  const levelRef = useRef<BriefLevel>(initialLevel ?? DEFAULT_BRIEF_LEVEL);

  // Load saved prompt + brief on mount. Priority: the server-stored brief
  // (authoritative, cross-device) → localStorage cache → fresh generation.
  const [hydratedFromCache, setHydratedFromCache] = useState(false);
  useEffect(() => {
    if (hasMounted.current) return;
    hasMounted.current = true;
    try {
      const saved = localStorage.getItem(PROMPT_STORAGE_KEY) ?? "";
      savedPromptRef.current = saved; // sync — before the auto-stream effect runs
      setSavedPrompt(saved);
      setCustomPrompt(saved);
    } catch {
      // ignore
    }

    // Hydrate a stored brief (from the server prop, else localStorage) so the
    // page paints instantly. Returns true when something was shown.
    function hydrate(b: {
      content: string;
      generatedAt: string;
      sources?: BriefSource[];
      usage?: Usage | null;
      fingerprint?: string | null;
      settingsChanged?: boolean;
    }): boolean {
      if (!b.content) return false;
      const genDate = new Date(b.generatedAt);
      cacheHydratedRef.current = true;
      producedRef.current = false;
      setBlocks([
        { key: "stored", kind: "stored", label: "", refs: [], text: b.content, status: "done" },
      ]);
      setSources(b.sources ?? []);
      setUsage(b.usage ?? null);
      setFingerprint(b.fingerprint ?? null);
      setGeneratedAt(genDate);
      setLoading(false);
      setHydratedFromCache(true);
      // Prior day, or generated under different depth/desk settings → refresh in
      // the background, showing this brief until the new one streams in.
      if (!isSameDay(genDate, new Date()) || b.settingsChanged) backgroundRegenRef.current = true;
      return true;
    }

    let shown = false;
    if (initialBrief) {
      shown = hydrate(initialBrief);
    }
    if (!shown) {
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
          // Same-day local cache → show it; prior-day → leave it so the
          // auto-stream effect generates fresh (no stored server brief either).
          if (parsed.content && isSameDay(new Date(parsed.generatedAt), new Date())) {
            hydrate(parsed);
          }
        }
      } catch {
        // ignore parse errors
      }
    }

    try {
      const rawHistory = localStorage.getItem(BRIEF_HISTORY_KEY);
      if (rawHistory) setHistory(JSON.parse(rawHistory) as BriefEntry[]);
    } catch {
      // ignore
    }
  }, [initialBrief]);

  /** Update one block in place (streaming text, status, error). */
  const patchBlock = useCallback((key: string, patch: Partial<Block>) => {
    setBlocks((prev) => prev.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  }, []);

  /**
   * Generate one section. Each call is a short, self-contained request: a
   * bounded slice of the queue in, a capped number of tokens out. Returns
   * "replan" when the unread set moved under us, so the caller can re-plan
   * rather than write a section against shifted `[n]` numbering.
   */
  const streamSection = useCallback(
    async (section: PlanSection, plan: BriefPlanResponse, run: number): Promise<"ok" | "replan"> => {
      patchBlock(section.key, { status: "streaming", text: "", error: undefined });
      try {
        const res = await fetch("/api/brief", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            section: section.key,
            level: plan.level,
            fingerprint: plan.fingerprint,
          }),
          cache: "no-store",
        });
        if (res.status === 409) return "replan";
        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          if (run === runRef.current) {
            patchBlock(section.key, {
              status: "error",
              error: text || `HTTP ${res.status}`,
            });
          }
          return "ok";
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        // Coalesce renders to one per animation frame instead of one per chunk —
        // ReactMarkdown re-parses the whole block on each render.
        let frameQueued = false;
        const flush = () => {
          frameQueued = false;
          if (run === runRef.current) patchBlock(section.key, { text: displayText(acc) });
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
        flush();

        const uIdx = acc.indexOf(USAGE_SENTINEL);
        if (uIdx >= 0) {
          try {
            const parsed = JSON.parse(acc.slice(uIdx + USAGE_SENTINEL.length)) as Usage;
            usageRef.current = {
              promptTokens: usageRef.current.promptTokens + (parsed.promptTokens ?? 0),
              completionTokens: usageRef.current.completionTokens + (parsed.completionTokens ?? 0),
              totalTokens: usageRef.current.totalTokens + (parsed.totalTokens ?? 0),
            };
            if (run === runRef.current) setUsage({ ...usageRef.current });
          } catch {
            // ignore malformed usage
          }
        }
        if (run === runRef.current) {
          const body = displayText(acc).trim();
          patchBlock(section.key, {
            status: body ? "done" : "error",
            text: body,
            error: body ? undefined : "Nothing came back for this section.",
          });
        }
        return "ok";
      } catch (err) {
        if (run === runRef.current) {
          patchBlock(section.key, {
            status: "error",
            error: err instanceof Error ? err.message : "Section failed",
          });
        }
        return "ok";
      }
    },
    [patchBlock],
  );

  /**
   * Plan the brief, then fill it in section by section. The plan itself costs
   * no model call, so the outline (and every desk's item count) is on screen
   * before the first token arrives.
   */
  const generateSectioned = useCallback(
    async (opts: { levelOverride?: BriefLevel; background?: boolean; replanned?: boolean } = {}) => {
      const run = runRef.current + 1;
      runRef.current = run;
      const chosenLevel = opts.levelOverride ?? levelRef.current;
      setLoading(true);
      setError(null);
      setNote(null);
      setRefreshing(opts.background === true);
      setNewArticles(false);
      if (!opts.replanned) {
        setReadIds(new Set());
        setSavedIds(new Set());
      }
      usageRef.current = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      generatedAtRef.current = null;
      producedRef.current = true;

      try {
        const planRes = await fetch(`/api/brief?plan=1&level=${chosenLevel}`, { cache: "no-store" });
        if (!planRes.ok) {
          const text = await planRes.text().catch(() => "");
          setError(text || `HTTP ${planRes.status}`);
          return;
        }
        const plan = (await planRes.json()) as BriefPlanResponse;
        if (run !== runRef.current) return;
        planRef.current = plan;
        setFingerprint(plan.fingerprint);
        setSources(plan.sources ?? []);
        setDesks(plan.desks ?? []);
        if (!plan.sections || plan.sections.length === 0) {
          producedRef.current = false;
          setBlocks([]);
          setNote("No unread articles to brief on. Add some feeds and sync them, then come back.");
          return;
        }
        setBlocks(
          plan.sections.map((s) => ({
            key: s.key,
            kind: s.kind,
            label: s.label,
            refs: s.refs,
            text: "",
            status: "pending" as BlockStatus,
          })),
        );

        // The lead goes first and alone: it's the part the reader actually waits
        // for, so it should never queue behind a desk section.
        const [lead, ...rest] = plan.sections;
        let replan = (await streamSection(lead, plan, run)) === "replan";
        if (!replan && run === runRef.current) {
          await runWithLimit(rest, 2, async (s) => {
            if (run !== runRef.current || replan) return;
            if ((await streamSection(s, plan, run)) === "replan") replan = true;
          });
        }

        // A sync landed mid-generation: the article numbering moved, so re-plan
        // once against the new queue rather than leaving mismatched citations.
        if (replan && !opts.replanned && run === runRef.current) {
          await generateSectioned({ ...opts, replanned: true });
          return;
        }
      } catch (err) {
        // A background refresh failing must not blow away the brief already on
        // screen — just drop the refreshing state.
        if (!opts.background) setError(err instanceof Error ? err.message : "Failed to load brief");
      } finally {
        if (run === runRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [streamSection],
  );

  /**
   * The single-pass path, used when the user has saved their own brief prompt:
   * their framing, one call, the whole queue. Kept because only the author of a
   * custom prompt knows what shape they asked for — it can't be split into
   * sections on their behalf.
   */
  const streamLegacy = useCallback(
    async (promptOverride?: string, force = false, background = false) => {
      const run = runRef.current + 1;
      runRef.current = run;
      setLoading(true);
      setError(null);
      setNote(null);
      if (!background) setBlocks([]);
      setRefreshing(background);
      setNewArticles(false);
      setReadIds(new Set());
      setSavedIds(new Set());
      producedRef.current = true;
      generatedAtRef.current = null;
      planRef.current = null;
      setDesks([]);
      try {
        const systemPrompt = (promptOverride ?? savedPromptRef.current).trim();
        const res = await fetch("/api/brief", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ systemPrompt, force }),
          cache: "no-store",
        });
        if (!res.ok || !res.body) {
          setError((await res.text().catch(() => "")) || `HTTP ${res.status}`);
          return;
        }
        const briefFingerprint = res.headers.get("x-brief-fingerprint");
        if (briefFingerprint) setFingerprint(briefFingerprint);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        let frameQueued = false;
        const flush = () => {
          frameQueued = false;
          if (run !== runRef.current) return;
          setBlocks([
            {
              key: "custom",
              kind: "stored",
              label: "",
              refs: [],
              text: displayText(acc),
              status: "streaming",
            },
          ]);
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
        flush();
        if (run !== runRef.current) return;

        const bIdx = acc.indexOf(BRIEFSOURCES_SENTINEL);
        const uIdx = acc.indexOf(USAGE_SENTINEL);
        if (bIdx >= 0) {
          const end = uIdx > bIdx ? uIdx : acc.length;
          try {
            setSources(
              JSON.parse(acc.slice(bIdx + BRIEFSOURCES_SENTINEL.length, end)) as BriefSource[],
            );
          } catch {
            // ignore malformed sources
          }
        }
        if (uIdx >= 0) {
          try {
            const parsed = JSON.parse(acc.slice(uIdx + USAGE_SENTINEL.length)) as Usage;
            usageRef.current = parsed;
            setUsage(parsed);
          } catch {
            // ignore malformed usage
          }
        }
        setBlocks([
          {
            key: "custom",
            kind: "stored",
            label: "",
            refs: [],
            text: displayText(acc),
            status: "done",
          },
        ]);
      } catch (err) {
        if (!background) setError(err instanceof Error ? err.message : "Failed to load brief");
      } finally {
        if (run === runRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [],
  );

  /** Generate the brief the way this user has configured it. */
  const generate = useCallback(
    (opts: { levelOverride?: BriefLevel; background?: boolean; force?: boolean } = {}) => {
      if (savedPromptRef.current.trim()) {
        return streamLegacy(undefined, opts.force ?? false, opts.background ?? false);
      }
      return generateSectioned({
        levelOverride: opts.levelOverride,
        background: opts.background,
      });
    },
    [generateSectioned, streamLegacy],
  );

  // Auto-generate on mount only when nothing was hydrated. When a stored brief
  // WAS hydrated but it's from a prior day (or different settings), refresh it
  // in the background instead. The ref check catches the same-commit case where
  // `hydratedFromCache` state hasn't flushed yet.
  useEffect(() => {
    if (cacheHydratedRef.current || hydratedFromCache) {
      if (backgroundRegenRef.current) {
        backgroundRegenRef.current = false;
        generate({ background: true });
      }
      return;
    }
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydratedFromCache]);

  /**
   * Persist a finished brief: the localStorage cache (instant paint), the dated
   * archive, and the server row that lets a second device paint instantly too.
   * Runs when every section has settled — including after a retry, so a
   * repaired section makes it into the stored copy.
   */
  useEffect(() => {
    if (!producedRef.current) return;
    if (blocks.length === 0) return;
    if (blocks.some((b) => b.status === "pending" || b.status === "streaming")) return;
    const content = assembleBrief(blocks);
    if (!content.trim()) return;

    const when = generatedAtRef.current ?? new Date();
    generatedAtRef.current = when;
    setGeneratedAt(when);

    const entry: BriefEntry = {
      generatedAt: when.toISOString(),
      content,
      sources,
      usage: usageRef.current.totalTokens > 0 ? { ...usageRef.current } : null,
      fingerprint,
    };
    try {
      localStorage.setItem(BRIEF_CACHE_KEY, JSON.stringify(entry));
    } catch {
      // quota errors — silently ignore
    }
    setHistory((prev) => {
      // Replace rather than prepend when a retry re-persists the same brief.
      const next = [entry, ...prev.filter((e) => e.generatedAt !== entry.generatedAt)].slice(
        0,
        MAX_HISTORY,
      );
      try {
        localStorage.setItem(BRIEF_HISTORY_KEY, JSON.stringify(next));
      } catch {
        // ignore quota
      }
      return next;
    });
    // Cross-device / cross-reload reuse. Best-effort: a failed store just means
    // the next visit regenerates.
    if (fingerprint) {
      void fetch("/api/brief/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fingerprint,
          level: planRef.current?.level ?? levelRef.current,
          content,
          sources,
          usage: entry.usage,
        }),
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks]);

  /** Retry a single failed section — the whole point of generating in pieces. */
  const retrySection = useCallback(
    (key: string) => {
      const plan = planRef.current;
      const section = plan?.sections.find((s) => s.key === key);
      if (!plan || !section) return;
      void streamSection(section, plan, runRef.current);
    },
    [streamSection],
  );

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
      if (!isSameDay(generatedAt, new Date())) generate();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loading, generatedAt, generate]);

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

  /** Change how much detail the brief goes into, then rebuild it. */
  const changeLevel = useCallback(
    (next: BriefLevel) => {
      if (next === level) return;
      setLevel(next);
      levelRef.current = next;
      void updateUserSettingsAction({ briefLevel: next }).catch(() => {
        toast.error("Couldn't save your depth preference");
      });
      void generate({ levelOverride: next });
    },
    [generate, level],
  );

  /** Follow/unfollow a desk: followed desks lead the brief and get a section
   *  first. Saved server-side, so it holds across devices. */
  const toggleDesk = useCallback(
    (topicId: string) => {
      const next = followed.includes(topicId)
        ? followed.filter((t) => t !== topicId)
        : [...followed, topicId];
      setFollowed(next);
      // Whole array — the settings blob is shallow-merged.
      void updateUserSettingsAction({ briefTopics: next }).catch(() => {
        toast.error("Couldn't save your desks");
      });
      void generate();
    },
    [followed, generate],
  );

  function savePrompt() {
    try {
      const trimmed = customPrompt.trim();
      localStorage.setItem(PROMPT_STORAGE_KEY, trimmed);
      localStorage.removeItem(BRIEF_CACHE_KEY); // prompt changed; old brief is stale
      savedPromptRef.current = trimmed;
      setSavedPrompt(trimmed);
      setSettingsOpen(false);
      toast.success(trimmed ? "Custom prompt saved" : "Reset to the sectioned brief");
      // Regenerate with the new framing (force — bypass the server cache).
      if (trimmed) void streamLegacy(trimmed, true);
      else void generateSectioned();
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
    runRef.current += 1; // abandon anything still streaming
    producedRef.current = false;
    planRef.current = null;
    setBlocks([
      { key: "archive", kind: "stored", label: "", refs: [], text: e.content, status: "done" },
    ]);
    setSources(e.sources ?? []);
    setUsage(e.usage ?? null);
    setFingerprint(e.fingerprint ?? null);
    setGeneratedAt(new Date(e.generatedAt));
    setDesks([]);
    setNewArticles(false);
    setReadIds(new Set());
    setError(null);
    setNote(null);
    setLoading(false);
  }

  const started = blocks.length > 0;
  const initialLoading = loading && !started;
  const isStale = !loading && generatedAt != null && !isSameDay(generatedAt, new Date());
  const unreadSourceIds = sources.map((s) => s.id).filter((id) => !readIds.has(id));
  const omittedDesks = desks.filter((d) => !d.included && d.count > 0);

  // Editorial masthead — derived from "now". State (not a bare Date) so the
  // greeting/date can refresh: a PWA left open overnight was still saying
  // "Good evening" at breakfast. Refreshed when the app returns to the
  // foreground and when a new brief lands. Volume number is brief count + 1,
  // giving an "issue No." feel without a backend.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") setNow(new Date());
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);
  useEffect(() => {
    if (generatedAt) setNow(new Date());
  }, [generatedAt]);
  const volumeNo = history.length + 1;
  const weekday = now.toLocaleDateString([], { weekday: "long" });
  const dateLine = now.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
  const greeting = greetingFor(now);

  // Turn the model's [n] references into tappable inline citations. The source
  // map arrives with the PLAN, before any text, so citations are live from the
  // first token instead of waiting for the whole brief to finish.
  const citations: Citation[] = sources.map((s) => ({
    n: s.n,
    href: `/feeds?article=${s.id}`,
    title: s.title,
  }));

  return (
    <article className="mx-auto max-w-[1080px] px-1">
      {/* ── Masthead ──────────────────────────────────────────────── */}
      <header className="editorial-rule mb-7 pb-4">
        <div className="mb-3 flex items-baseline justify-between gap-4 editorial-eyebrow">
          <span>Vol. III · {weekday} Edition · No. {volumeNo}</span>
          <span style={{ color: "hsl(var(--brand))" }}>{dateLine}</span>
        </div>
        <h1
          className="editorial-display m-0"
          style={{ fontSize: "clamp(2.25rem, 4.6vw, 3.5rem)" }}
        >
          {greeting}{name ? `, ${name}` : ""}.
        </h1>
        <div className="not-prose mt-3.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" style={{ color: "hsl(var(--brand))" }} />
          {loading && !refreshing ? (
            <span>
              {started
                ? `Writing section ${Math.min(
                    blocks.filter((b) => b.status !== "pending").length,
                    blocks.length,
                  )} of ${blocks.length}…`
                : "Planning today's brief…"}
            </span>
          ) : generatedAt ? (
            <>
              <span>
                Generated{" "}
                {isStale
                  ? generatedAt.toLocaleDateString([], { month: "short", day: "numeric" })
                  : generatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
              {usage && usage.totalTokens > 0 && (
                <>
                  <span className="opacity-40">·</span>
                  <span className="tabular-nums">
                    {usage.totalTokens.toLocaleString()} tokens
                  </span>
                </>
              )}
              {refreshing && (
                <span className="inline-flex items-center gap-1 rounded bg-brand/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-brand">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" /> Refreshing
                </span>
              )}
              {(isStale || newArticles) && !refreshing && (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-400">
                  {newArticles ? "new articles — regenerate" : "stale — regenerate"}
                </span>
              )}
              {savedPrompt ? (
                <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
                  custom prompt
                </span>
              ) : (
                <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
                  {BRIEF_LEVEL_CONFIG[level].label.toLowerCase()}
                </span>
              )}
            </>
          ) : null}
        </div>
      </header>

      {/* ── Action bar ───────────────────────────────────────────── */}
      {/* flex-wrap: on narrow phones the buttons overflow the viewport
          otherwise (Regenerate was clipped off-screen); wrapped rows keep
          everything tappable. */}
      <div className="not-prose mb-7 flex justify-end">
        <div className="flex flex-wrap items-center justify-end gap-1">
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

          {/* Desks the brief leads with. Server-stored, so it holds per person
              rather than per browser. Hidden while a custom prompt is in force:
              that path is a single pass with the user's own framing, so neither
              desks nor depth apply to it. */}
          {!savedPrompt && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" title="Choose the desks you follow">
                    <Compass className="mr-1.5 h-3.5 w-3.5" />
                    Desks
                    {followed.length > 0 && (
                      <span className="ml-1.5 rounded bg-brand/15 px-1 text-[10px] text-brand">
                        {followed.length}
                      </span>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuLabel>Desks you follow</DropdownMenuLabel>
                  <p className="px-2 pb-1.5 text-[11px] leading-snug text-muted-foreground">
                    Followed desks lead the brief and are written up first.
                  </p>
                  <DropdownMenuSeparator />
                  {BRIEF_TOPICS.map((t) => {
                    const count = desks.find((d) => d.topicId === t.id)?.count ?? 0;
                    return (
                      <DropdownMenuCheckboxItem
                        key={t.id}
                        checked={followed.includes(t.id)}
                        onCheckedChange={() => toggleDesk(t.id)}
                        onSelect={(e) => e.preventDefault()}
                      >
                        <span className="flex-1">{t.label}</span>
                        {count > 0 && (
                          <span className="ml-2 text-[11px] tabular-nums text-muted-foreground">
                            {count}
                          </span>
                        )}
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Depth. Each level is more SECTIONS, never one longer call — that's
                  what keeps every request inside the host's function budget. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" title="How much detail the brief goes into">
                    <Layers className="mr-1.5 h-3.5 w-3.5" />
                    {BRIEF_LEVEL_CONFIG[level].label}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuLabel>Depth</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {BRIEF_LEVELS.map((l) => (
                    <DropdownMenuItem
                      key={l}
                      onClick={() => changeLevel(l)}
                      className="flex flex-col items-start gap-0.5"
                    >
                      <span className="flex w-full items-center justify-between gap-2">
                        <span className="font-medium">{BRIEF_LEVEL_CONFIG[l].label}</span>
                        {l === level && <Check className="h-3.5 w-3.5" />}
                      </span>
                      <span className="text-[11px] leading-snug text-muted-foreground">
                        {BRIEF_LEVEL_CONFIG[l].blurb}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
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
          <Button
            size="sm"
            variant="brand"
            onClick={() => generate({ force: true })}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Regenerate
          </Button>
        </div>
      </div>

      {/* ── Study tasks (today) ──────────────────────────────────── */}
      {studyTasks.length > 0 && (
        <section className="not-prose mb-8">
          <div className="editorial-section-row mb-3">
            <span className="editorial-eyebrow-brand inline-flex items-center gap-2">
              <GraduationCap className="h-3 w-3" />§ Today&apos;s plan
            </span>
            <span className="editorial-section-rule" />
            <span className="text-[11px] italic text-muted-foreground">{studyTasks.length} due</span>
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {studyTasks.map((t, i) => (
              <button
                key={t.id}
                onClick={() => router.push("/study?tab=tasks")}
                className={cn(
                  "flex w-full items-start gap-2.5 px-4 py-3 text-left text-sm transition-colors hover:bg-accent/50",
                  i !== studyTasks.length - 1 && "border-b border-border",
                )}
              >
                <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-[3px] border border-muted-foreground/50" />
                <span className="flex-1 leading-snug">{t.text}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {settingsOpen && (
        <div className="not-prose mb-7 rounded-lg border border-border bg-card p-4">
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
            Leave this empty for the sectioned brief (a lead, a write-up per desk, a quick-clear
            list). Fill it in and the brief becomes a single pass with your framing instead —
            your prompt, the whole queue, one section.
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
        <div className="not-prose mb-7 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <p className="font-medium text-destructive">Couldn&apos;t generate brief</p>
          <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{error}</p>
          {(error.includes("ANTHROPIC_API_KEY") || error.includes("OPENROUTER_API_KEY")) && (
            <p className="mt-3 text-xs text-muted-foreground">
              Add an <code className="rounded bg-background px-1">ANTHROPIC_API_KEY</code> or{" "}
              <code className="rounded bg-background px-1">OPENROUTER_API_KEY</code> environment
              variable and redeploy.
            </p>
          )}
        </div>
      )}

      {note && !error && (
        <div className="not-prose mb-7 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          {note}
        </div>
      )}

      {initialLoading && (
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

      {/* ── Brief body ───────────────────────────────────────────── */}
      {/* One block per planned section, in plan order. Sections stream in
          independently, so the lead is readable while the desks are still
          being written — and a section that fails retries on its own. */}
      {started && (
        <div className="prose-brief max-w-[68ch] text-[1.05rem] leading-[1.65]">
          {blocks.map((b) => (
            <section
              key={b.key}
              // Each section is its own markdown root, so `h3:first-child`
              // zeroes every heading's top margin — the rhythm between sections
              // has to live on the wrapper instead.
              className={cn("mt-9 first:mt-0", b.status === "pending" && "opacity-60")}
            >
              {b.text.trim() ? (
                <CitedMarkdown citations={citations} onNavigate={(href) => router.push(href)}>
                  {blockMarkdown(b)}
                </CitedMarkdown>
              ) : (
                b.label && <h3>{b.label}</h3>
              )}
              {b.status === "streaming" && (
                <span className="ml-1 inline-block h-4 w-2 animate-pulse bg-foreground/40 align-middle" />
              )}
              {b.status === "pending" && (
                <div className="not-prose space-y-2 py-1">
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-3.5 w-4/5" />
                </div>
              )}
              {b.status === "error" && (
                <div className="not-prose my-3 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span className="flex-1">
                    This section didn&apos;t come through
                    {b.error ? ` — ${b.error}` : ""}.
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 gap-1 px-2 text-[11px]"
                    onClick={() => retrySection(b.key)}
                  >
                    <RotateCw className="h-3 w-3" /> Retry
                  </Button>
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {/* Desks this depth level left out — the honest version of "there's more
          in your queue than this brief covered". */}
      {!loading && omittedDesks.length > 0 && (
        <p className="not-prose mt-6 text-xs text-muted-foreground">
          Also unread, not written up:{" "}
          {omittedDesks.map((d, i) => (
            <span key={d.topicId}>
              {i > 0 ? ", " : ""}
              {d.label} ({d.count})
            </span>
          ))}
          {level !== "deep" && (
            <>
              {" · "}
              <button
                onClick={() => changeLevel("deep")}
                className="underline decoration-border underline-offset-2 hover:decoration-foreground"
              >
                go deep to cover them
              </button>
            </>
          )}
        </p>
      )}

      {/* ── Recall check ────────────────────────────────────────── */}
      {!initialLoading && <RecallCheck />}

      {/* ── Weekly synthesis ────────────────────────────────────── */}
      {!initialLoading && <WeeklySynthesisSection />}

      {/* ── Sources ─────────────────────────────────────────────── */}
      {sources.length > 0 && (
        <section className="not-prose mt-10">
          <div className="editorial-section-row mb-3">
            <span className="editorial-eyebrow-brand inline-flex items-center gap-2">
              <Newspaper className="h-3 w-3" />§ Sources in this brief
            </span>
            <span className="editorial-section-rule" />
            <span className="text-[11px] italic text-muted-foreground">
              {sources.length} {sources.length === 1 ? "item" : "items"}
            </span>
            {unreadSourceIds.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="-my-1 h-6 gap-1 px-2 text-[10px]"
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
                            // Visible by default (touch has no hover); only
                            // hover-capable devices hide-until-hover.
                            savedIds.has(s.id)
                              ? "text-brand opacity-100"
                              : "text-muted-foreground opacity-100 hover:text-foreground [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100",
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
                            className="shrink-0 rounded p-1 text-muted-foreground opacity-100 transition-opacity hover:bg-accent hover:text-foreground [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
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
                            className="shrink-0 rounded p-1 text-muted-foreground opacity-100 transition-opacity hover:bg-accent hover:text-foreground [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
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
        </section>
      )}

      {/* ── Colophon ────────────────────────────────────────────── */}
      {!loading && started && (
        <footer className="not-prose mt-12 flex items-center justify-between border-t border-border pt-4 editorial-eyebrow">
          <span>End of brief · No. {volumeNo}</span>
          <span>
            {usage && usage.totalTokens > 0 && (
              <>
                <span className="tabular-nums">{usage.promptTokens.toLocaleString()}</span> in ·{" "}
                <span className="tabular-nums">{usage.completionTokens.toLocaleString()}</span> out
              </>
            )}
          </span>
        </footer>
      )}
    </article>
  );
}

/** Grade buttons, mapped onto the quality scale `gradeCardAction` expects. */
const RECALL_GRADES: { label: string; quality: number }[] = [
  { label: "Again", quality: 1 },
  { label: "Hard", quality: 3 },
  { label: "Good", quality: 4 },
  { label: "Easy", quality: 5 },
];

/**
 * One or two due cards, inside a page the user already opens daily. Review
 * happens where attention already is instead of requiring a trip to Study —
 * the cheapest possible spaced repetition.
 *
 * Renders nothing when nothing is due: an empty state here would just be a
 * daily reminder that you have no work, which is nagging, not helping.
 */
function RecallCheck() {
  const [cards, setCards] = useState<RecallCard[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [grading, setGrading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchRecallCardsAction(2)
      .then((due) => {
        if (!cancelled) setCards(due);
      })
      // A recall prompt is a bonus on this page. If it can't load, stay silent.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const card = cards[0];
  if (!card) return null;

  async function grade(quality: number) {
    if (!card || grading) return;
    setGrading(true);
    try {
      const r = await gradeCardAction({ id: card.id, quality });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setRevealed(false);
      setCards((prev) => prev.slice(1));
    } catch {
      toast.error("Couldn't save that answer");
    } finally {
      setGrading(false);
    }
  }

  return (
    <section className="not-prose mt-10">
      <div className="editorial-section-row mb-3">
        <span className="editorial-eyebrow-brand inline-flex items-center gap-2">
          <Brain className="h-3 w-3" />§ Still remember?
        </span>
        <span className="editorial-section-rule" />
        <span className="text-[11px] italic text-muted-foreground">
          {cards.length} {cards.length === 1 ? "card" : "cards"} due
        </span>
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="text-sm font-medium leading-snug">{card.question}</div>
        {revealed ? (
          <>
            <div className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{card.answer}</div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {RECALL_GRADES.map((g) => (
                <Button
                  key={g.quality}
                  size="sm"
                  variant={g.quality === 4 ? "brand" : "outline"}
                  className="h-7 px-2.5 text-xs"
                  onClick={() => grade(g.quality)}
                  disabled={grading}
                >
                  {grading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                  {g.label}
                </Button>
              ))}
            </div>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="mt-3 h-7 px-2.5 text-xs"
            onClick={() => setRevealed(true)}
          >
            Show answer
          </Button>
        )}
      </div>
    </section>
  );
}

type WeeklySynthesisResult = {
  throughLine: string;
  themes: string[];
  tensions: string[];
  articleCount?: number;
};

function readSynthesisCache(week: string): WeeklySynthesisResult | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SYNTHESIS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { week?: string; result?: WeeklySynthesisResult };
    if (parsed?.week !== week) return null;
    return typeof parsed.result?.throughLine === "string" ? parsed.result : null;
  } catch {
    return null;
  }
}

function writeSynthesisCache(week: string, result: WeeklySynthesisResult): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SYNTHESIS_CACHE_KEY, JSON.stringify({ week, result }));
  } catch {
    // private mode / quota — the synthesis just won't survive a reload
  }
}

/**
 * What connected the week's reading, and where sources disagreed. Contradiction
 * is where understanding forms, so tensions get their own list.
 *
 * Never generates on its own: this is a weekly, whole-corpus AI call, and
 * paying for it on every page load would be indefensible. One tap, then cached
 * for the rest of the ISO week.
 */
function WeeklySynthesisSection() {
  const week = isoWeekKey(new Date());
  const [result, setResult] = useState<WeeklySynthesisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    setResult(readSynthesisCache(week));
  }, [week]);

  async function generate() {
    setLoading(true);
    setNote(null);
    try {
      const res = await fetch("/api/weekly-synthesis", { method: "POST" });
      const data = (await res.json().catch(() => null)) as
        | (WeeklySynthesisResult & { error?: string })
        | null;
      if (!res.ok) {
        // 422 is the ordinary "quiet week" case, not a failure worth a toast.
        setNote(data?.error ?? "Couldn't look at this week");
        return;
      }
      if (!data?.throughLine) {
        setNote("Couldn't look at this week");
        return;
      }
      setResult(data);
      writeSynthesisCache(week, data);
    } catch {
      setNote("Couldn't look at this week");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="not-prose mt-10">
      <div className="editorial-section-row mb-3">
        <span className="editorial-eyebrow-brand inline-flex items-center gap-2">
          <Sparkles className="h-3 w-3" />§ This week
        </span>
        <span className="editorial-section-rule" />
        {result?.articleCount ? (
          <span className="text-[11px] italic text-muted-foreground">
            {result.articleCount} articles
          </span>
        ) : null}
      </div>

      {result ? (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm leading-relaxed">{result.throughLine}</p>
          {result.themes.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {result.themes.map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          {result.tensions.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <div className="editorial-eyebrow mb-1.5">Where sources disagreed</div>
              <ul className="space-y-1.5">
                {result.tensions.map((t) => (
                  <li key={t} className="text-[13px] leading-relaxed text-muted-foreground">
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="mb-3 text-xs text-muted-foreground">
            {note ?? "Look at the last seven days as a whole — the through-line, and where your sources disagreed."}
          </p>
          <Button size="sm" variant="outline" onClick={generate} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            )}
            {loading ? "Reading your week…" : "Synthesize this week"}
          </Button>
        </div>
      )}
    </section>
  );
}
