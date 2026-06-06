"use client";

import { useState } from "react";
import { BarChart3, Brain, CalendarDays, CheckSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatsOverview } from "./stats-overview";
import { CalendarView } from "./calendar-view";
import { TasksView } from "@/components/tasks/tasks-view";
import { ReviewView } from "@/components/review/review-view";
import type { StudyStats, CalendarEntry } from "@/app/(app)/study/actions";
import type { TaskRow } from "@/app/(app)/tasks/actions";
import type { DueCard } from "@/app/(app)/review/actions";

export type StudyTab = "overview" | "tasks" | "review" | "calendar";

const TABS: { id: StudyTab; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <BarChart3 className="h-4 w-4" /> },
  { id: "tasks", label: "Tasks", icon: <CheckSquare className="h-4 w-4" /> },
  { id: "review", label: "Review", icon: <Brain className="h-4 w-4" /> },
  { id: "calendar", label: "Calendar", icon: <CalendarDays className="h-4 w-4" /> },
];

/**
 * Single hub for the learning surface — keeps Tasks, Review, Stats and the
 * study Calendar behind one sidebar entry instead of four. Tab is reflected in
 * ?tab= (replaceState) for shareable deep links without a server round-trip.
 */
export function StudyShell({
  defaultTab,
  stats,
  tasks,
  dueCards,
  totalCards,
  calendar,
}: {
  defaultTab: StudyTab;
  stats: StudyStats;
  tasks: TaskRow[];
  dueCards: DueCard[];
  totalCards: number;
  calendar: CalendarEntry[];
}) {
  const [tab, setTab] = useState<StudyTab>(defaultTab);

  function select(next: StudyTab) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url.toString());
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => select(t.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
              tab === t.id
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.icon}
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "overview" && <StatsOverview stats={stats} />}
        {tab === "tasks" && <TasksView tasks={tasks} />}
        {tab === "review" && <ReviewView cards={dueCards} total={totalCards} />}
        {tab === "calendar" && <CalendarView initial={calendar} />}
      </div>
    </div>
  );
}
