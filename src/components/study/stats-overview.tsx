"use client";

import { Brain, CheckSquare, FileText, Flame, Layers, NotebookPen } from "lucide-react";
import type { StudyStats } from "@/app/(app)/study/actions";

export function StatsOverview({ stats }: { stats: StudyStats }) {
  const cards = [
    { label: "Day streak", value: stats.streak, icon: <Flame className="h-4 w-4 text-orange-500" />, hint: "consecutive active days" },
    { label: "Due now", value: stats.dueToday, icon: <Brain className="h-4 w-4 text-primary" />, hint: "flashcards to review" },
    { label: "Reviewed", value: stats.cardsReviewedWeek, icon: <CheckSquare className="h-4 w-4" />, hint: "cards this week" },
    { label: "Items added", value: stats.itemsWeek, icon: <Layers className="h-4 w-4" />, hint: "this week" },
    { label: "Notes written", value: stats.notesWeek, icon: <NotebookPen className="h-4 w-4" />, hint: "this week" },
    { label: "Total cards", value: stats.totalCards, icon: <FileText className="h-4 w-4" />, hint: "in your deck" },
  ];

  return (
    <div className="mx-auto max-w-2xl px-6 py-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {c.icon}
              {c.label}
            </div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{c.value}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{c.hint}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
