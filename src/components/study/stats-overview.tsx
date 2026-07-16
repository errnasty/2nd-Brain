"use client";

import { useRouter } from "next/navigation";
import { Brain, CheckSquare, FileText, Layers, NotebookPen, Play, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StudyStats } from "@/app/(app)/study/actions";
import type { GameState } from "@/lib/gamify/state";
import { GamifyDashboard } from "./gamify-dashboard";

export type SessionSummary = {
  /** Cards in this session (capped). */
  cards: number;
  /** Total cards due (may exceed `cards`). */
  dueCount: number;
  tasks: number;
  quizTitle: string | null;
  weakestSkill: string | null;
};

/** #25 Minimal inline sparkline (14-day trend). */
function Sparkline({ data }: { data: number[] }) {
  if (!data || data.length < 2 || Math.max(...data) === 0) return null;
  const w = 60, h = 16;
  const max = Math.max(1, ...data);
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="mt-2" preserveAspectRatio="none" aria-hidden>
      <polyline
        points={pts}
        fill="none"
        stroke="hsl(var(--brand))"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.85}
      />
    </svg>
  );
}

export function StatsOverview({
  stats,
  game,
  canStartSession = false,
  sessionSummary,
  onStartSession,
}: {
  stats: StudyStats;
  game: GameState | null;
  canStartSession?: boolean;
  sessionSummary?: SessionSummary;
  onStartSession?: () => void;
}) {
  const router = useRouter();
  // Secondary weekly numbers, shown under the game HUD as a compact strip.
  const cards = [
    { label: "Due now", value: stats.dueToday, icon: <Brain className="h-3.5 w-3.5" style={{ color: "hsl(var(--brand))" }} />, hint: "flashcards to review", history: undefined as number[] | undefined },
    { label: "Reviewed", value: stats.cardsReviewedWeek, icon: <CheckSquare className="h-3.5 w-3.5" />, hint: "cards this week", history: stats.reviewsHistory },
    { label: "Items added", value: stats.itemsWeek, icon: <Layers className="h-3.5 w-3.5" />, hint: "this week", history: stats.itemsHistory },
    { label: "Notes written", value: stats.notesWeek, icon: <NotebookPen className="h-3.5 w-3.5" />, hint: "this week", history: undefined },
    { label: "Total cards", value: stats.totalCards, icon: <FileText className="h-3.5 w-3.5" />, hint: "in your deck", history: undefined },
  ];

  // "Today's session" auto-composer summary — driven by the composed plan.
  const summary = sessionSummary ?? {
    cards: stats.dueToday,
    dueCount: stats.dueToday,
    tasks: stats.dueTasks,
    quizTitle: null,
    weakestSkill: null,
  };
  const hasSession = canStartSession || summary.cards + summary.tasks > 0;
  const heroCount = summary.cards > 0 ? summary.cards : summary.tasks > 0 ? summary.tasks : 0;
  const heroLabel = summary.cards > 0 ? "cards to review" : summary.tasks > 0 ? "tasks due" : "quiz ready";
  const sessionLine = (() => {
    const parts: string[] = [];
    if (summary.cards > 0) parts.push(`${summary.cards} ${summary.cards === 1 ? "card" : "cards"}`);
    if (summary.tasks > 0) parts.push(`${summary.tasks} ${summary.tasks === 1 ? "task" : "tasks"}`);
    if (summary.quizTitle) {
      parts.push(summary.weakestSkill ? `a quiz on ${summary.weakestSkill}` : "a quiz");
    }
    return parts.join(" · ");
  })();

  // #26 Weakest subject = lowest retention (with enough cards to matter).
  const ranked = stats.retentionBySubject.filter((s) => s.cards >= 3);
  const weakest = ranked.length > 1 ? ranked[ranked.length - 1] : null;

  const now = new Date();
  const dateLine = now.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });

  const baseHeadline =
    stats.cardsReviewedWeek > 0
      ? `${stats.cardsReviewedWeek} reviews this week.`
      : stats.dueToday > 0
        ? `${stats.dueToday} cards waiting.`
        : "Caught up on review.";
  // A 7-day+ streak leads — it's the most motivating signal.
  const streak = game?.player.streakDays ?? 0;
  const headline = streak >= 7 ? `${streak}-day streak. ${baseHeadline}` : baseHeadline;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      {/* ── Editorial masthead ──────────────────────────────────── */}
      <header className="editorial-rule mb-7 pb-4">
        <div className="mb-2.5 flex items-baseline justify-between gap-3 editorial-eyebrow">
          <span>Learning · Vol. III</span>
          <span style={{ color: "hsl(var(--brand))" }}>{dateLine}</span>
        </div>
        <h1
          className="editorial-display m-0"
          style={{ fontSize: "clamp(1.875rem, 3.6vw, 2.625rem)" }}
        >
          {headline}
        </h1>
        {stats.dueToday > 0 && stats.cardsReviewedWeek > 0 && (
          <p className="mt-3 max-w-[60ch] text-[15px] italic leading-snug text-muted-foreground">
            {stats.dueToday} {stats.dueToday === 1 ? "card is" : "cards are"} due now — and{" "}
            {stats.itemsWeek} new {stats.itemsWeek === 1 ? "item" : "items"} have landed in your
            library this week.
          </p>
        )}
      </header>

      {/* ── Today's session · one-button auto-composer ─────────── */}
      {hasSession && (
        <div className="mb-7 overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="editorial-eyebrow-brand mb-1.5">§ Today&apos;s session</div>
              <div className="flex items-baseline gap-2">
                <span
                  className="text-4xl font-semibold tabular-nums"
                  style={{ fontFamily: "var(--app-font-display)", letterSpacing: "-0.02em", lineHeight: 1, color: "hsl(var(--brand))" }}
                >
                  {heroCount}
                </span>
                <span className="text-sm text-muted-foreground">{heroLabel}</span>
                {summary.dueCount > summary.cards && (
                  <span className="text-xs text-muted-foreground">(of {summary.dueCount} due)</span>
                )}
              </div>
              <p className="mt-1.5 text-[13px] italic text-muted-foreground">
                {sessionLine || "A quick session to keep your streak."}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => (onStartSession ? onStartSession() : router.push("/study?tab=review"))}
                className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white"
                style={{ background: "hsl(var(--brand))" }}
              >
                <Play className="h-3.5 w-3.5 fill-current" /> Start session
              </button>
              <button
                onClick={() => router.push("/study?tab=review")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-accent"
              >
                <Brain className="h-3.5 w-3.5" /> Review only
              </button>
            </div>
          </div>
        </div>
      )}

      {game && <GamifyDashboard game={game} />}

      {/* ── This week ─────────────────────────────────────────── */}
      <div className="mt-8">
        <div className="editorial-section-row mb-3">
          <span className="editorial-eyebrow-brand">§ This week</span>
          <span className="editorial-section-rule" />
          <span className="text-[11px] italic text-muted-foreground">7-day summary</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {cards.map((c) => (
            <div key={c.label} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                {c.icon}
                {c.label}
              </div>
              <div
                className="mt-2 text-3xl font-semibold tabular-nums"
                style={{ fontFamily: "var(--app-font-display)", letterSpacing: "-0.02em", lineHeight: 1 }}
              >
                {c.value}
              </div>
              <div className="mt-1 text-[11px] italic text-muted-foreground">{c.hint}</div>
              {c.history && <Sparkline data={c.history} />}
            </div>
          ))}
        </div>
      </div>

      {/* ── #26/#27 Retention by subject ───────────────────────── */}
      {stats.retentionBySubject.length > 0 && (
        <div className="mt-8">
          <div className="editorial-section-row mb-3">
            <span className="editorial-eyebrow-brand">§ Retention by subject</span>
            <span className="editorial-section-rule" />
            <span className="text-[11px] italic text-muted-foreground">SM-2 estimate</span>
          </div>
          {weakest && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px]">
              <TrendingDown className="h-4 w-4 shrink-0 text-destructive" />
              <span>
                <span className="font-semibold">Weak link:</span> {weakest.subject} is your lowest at{" "}
                <span className="tabular-nums">{weakest.pct}%</span> — review it next.
              </span>
            </div>
          )}
          <div className="space-y-2">
            {stats.retentionBySubject.map((s) => (
              <div key={s.subject} className="flex items-center gap-3">
                <span className="w-32 shrink-0 truncate text-[13px]" title={s.subject}>{s.subject}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full", s.pct < 60 ? "bg-destructive" : "bg-brand")}
                    style={{
                      width: `${Math.max(3, s.pct)}%`,
                      background: s.pct < 60 ? undefined : "hsl(var(--brand))",
                      opacity: s.pct < 60 ? 1 : 0.8,
                    }}
                  />
                </div>
                <span className="w-14 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                  {s.pct}% · {s.cards}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
