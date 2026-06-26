"use client";

import { Brain, CheckSquare, FileText, Layers, NotebookPen } from "lucide-react";
import type { StudyStats } from "@/app/(app)/study/actions";
import type { GameState } from "@/lib/gamify/state";
import { GamifyDashboard } from "./gamify-dashboard";

export function StatsOverview({ stats, game }: { stats: StudyStats; game: GameState | null }) {
  // Secondary weekly numbers, shown under the game HUD as a compact strip.
  const cards = [
    { label: "Due now", value: stats.dueToday, icon: <Brain className="h-3.5 w-3.5" style={{ color: "hsl(var(--brand))" }} />, hint: "flashcards to review" },
    { label: "Reviewed", value: stats.cardsReviewedWeek, icon: <CheckSquare className="h-3.5 w-3.5" />, hint: "cards this week" },
    { label: "Items added", value: stats.itemsWeek, icon: <Layers className="h-3.5 w-3.5" />, hint: "this week" },
    { label: "Notes written", value: stats.notesWeek, icon: <NotebookPen className="h-3.5 w-3.5" />, hint: "this week" },
    { label: "Total cards", value: stats.totalCards, icon: <FileText className="h-3.5 w-3.5" />, hint: "in your deck" },
  ];

  const now = new Date();
  const dateLine = now.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });

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
          {stats.cardsReviewedWeek > 0
            ? `${stats.cardsReviewedWeek} reviews this week.`
            : stats.dueToday > 0
              ? `${stats.dueToday} cards waiting.`
              : "Caught up on review."}
        </h1>
        {stats.dueToday > 0 && stats.cardsReviewedWeek > 0 && (
          <p className="mt-3 max-w-[60ch] text-[15px] italic leading-snug text-muted-foreground">
            {stats.dueToday} {stats.dueToday === 1 ? "card is" : "cards are"} due now — and{" "}
            {stats.itemsWeek} new {stats.itemsWeek === 1 ? "item" : "items"} have landed in your
            library this week.
          </p>
        )}
      </header>

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
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
