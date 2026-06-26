"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Brain, CalendarDays, CheckSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatsOverview } from "./stats-overview";
import { CalendarView } from "./calendar-view";
import { TasksView } from "@/components/tasks/tasks-view";
import { ReviewView } from "@/components/review/review-view";
import type { StudyStats, CalendarEntry } from "@/app/(app)/study/actions";
import type { TaskRow } from "@/app/(app)/tasks/actions";
import type { DueCard } from "@/app/(app)/review/actions";
import type { GameState } from "@/lib/gamify/state";

export type StudyTab = "overview" | "tasks" | "review" | "calendar";

const TABS: { id: StudyTab; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <BarChart3 className="h-3.5 w-3.5" /> },
  { id: "tasks", label: "Tasks", icon: <CheckSquare className="h-3.5 w-3.5" /> },
  { id: "review", label: "Review", icon: <Brain className="h-3.5 w-3.5" /> },
  { id: "calendar", label: "Calendar", icon: <CalendarDays className="h-3.5 w-3.5" /> },
];

export function StudyShell({
  defaultTab,
  stats,
  tasks,
  dueCards,
  totalCards,
  dueCount,
  calendar,
  game,
  reviewScopeLabel,
}: {
  defaultTab: StudyTab;
  stats: StudyStats;
  tasks: TaskRow[];
  dueCards: DueCard[];
  totalCards: number;
  dueCount: number;
  calendar: CalendarEntry[];
  game: GameState | null;
  reviewScopeLabel?: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState<StudyTab>(defaultTab);

  useEffect(() => {
    setTab(defaultTab);
  }, [defaultTab]);

  function select(next: StudyTab) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url.toString());
    if (next === "overview") startTransition(() => router.refresh());
  }

  return (
    <div className="flex h-full flex-col">
      {/* Editorial tab bar */}
      <div className="flex items-center gap-1 border-b border-border px-3 py-2.5">
        {TABS.map((t) => {
          const active = tab === t.id;
          // Map duecount badge to Review only
          const badge = t.id === "review" && dueCount > 0 ? dueCount : undefined;
          return (
            <button
              key={t.id}
              onClick={() => select(t.id)}
              className={cn(
                "relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                active
                  ? "bg-accent font-semibold text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              {active && (
                <span
                  className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-brand"
                  aria-hidden
                />
              )}
              <span className={cn(active && "text-brand")}>{t.icon}</span>
              <span className="hidden sm:inline">{t.label}</span>
              {badge !== undefined && (
                <span
                  className="ml-1 rounded-full px-1.5 py-0 font-mono text-[10px] tabular-nums"
                  style={{ color: "hsl(var(--brand))", background: "hsl(var(--brand) / 0.08)" }}
                >
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "overview" && <StatsOverview stats={stats} game={game} />}
        {tab === "tasks" && <TasksView tasks={tasks} />}
        {tab === "review" && (
          <ReviewView cards={dueCards} total={totalCards} due={dueCount} scopeLabel={reviewScopeLabel} />
        )}
        {tab === "calendar" && <CalendarView initial={calendar} />}
      </div>
    </div>
  );
}
