"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Brain, CalendarDays, CheckSquare, HelpCircle, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { localKey, utcKey } from "@/lib/study/calendar";
import dynamic from "next/dynamic";
import { Spinner } from "@/components/ui/spinner";
import { StatsOverview } from "./stats-overview";

// Only one tab renders at a time, so everything but the default Overview tab
// is code-split: the /study route chunk stays small and a tab's code is
// fetched the first time it's opened (then cached). next/dynamic needs its
// options inline as object literals, hence the repetition.
function TabLoading() {
  return (
    <div className="flex justify-center py-16">
      <Spinner className="h-5 w-5 text-muted-foreground" />
    </div>
  );
}
const CalendarView = dynamic(() => import("./calendar-view").then((m) => m.CalendarView), { loading: TabLoading });
const TasksView = dynamic(() => import("@/components/tasks/tasks-view").then((m) => m.TasksView), { loading: TabLoading });
const ReviewView = dynamic(() => import("@/components/review/review-view").then((m) => m.ReviewView), { loading: TabLoading });
const QuizTab = dynamic(() => import("./quiz-tab").then((m) => m.QuizTab), { loading: TabLoading });
const CardsTab = dynamic(() => import("./cards-tab").then((m) => m.CardsTab), { loading: TabLoading });
const SessionRunner = dynamic(() => import("./session-runner").then((m) => m.SessionRunner), { loading: TabLoading });
import { lastLocation } from "@/lib/last-location";
import type { StudyStats, CalendarEntry } from "@/app/(app)/study/actions";
import type { TaskRow } from "@/app/(app)/tasks/actions";
import type { DueCard, LeechCard } from "@/app/(app)/review/actions";
import type { QuizListItem } from "@/app/(app)/study/quiz-actions";
import type { SessionPlan } from "@/app/(app)/study/session-actions";
import type { GameState } from "@/lib/gamify/state";

export type StudyTab = "overview" | "tasks" | "review" | "calendar" | "quiz" | "cards";

const TABS: { id: StudyTab; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <BarChart3 className="h-3.5 w-3.5" /> },
  { id: "tasks", label: "Tasks", icon: <CheckSquare className="h-3.5 w-3.5" /> },
  { id: "review", label: "Review", icon: <Brain className="h-3.5 w-3.5" /> },
  { id: "quiz", label: "Quiz", icon: <HelpCircle className="h-3.5 w-3.5" /> },
  { id: "cards", label: "Cards", icon: <Layers className="h-3.5 w-3.5" /> },
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
  leeches,
  quizzes,
  quizId,
  sessionPlan,
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
  leeches?: LeechCard[];
  quizzes: QuizListItem[];
  /** Deep-link straight into taking a just-generated quiz. */
  quizId?: string | null;
  /** Composed "Today's session" plan (due cards + quiz + overdue tasks). */
  sessionPlan: SessionPlan;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState<StudyTab>(defaultTab);
  const [inSession, setInSession] = useState(false);

  useEffect(() => {
    setTab(defaultTab);
  }, [defaultTab]);

  // Resume: on a bare visit (no explicit ?tab), restore the last tab used so
  // "Study" lands where you left off instead of always on Overview.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab")) return;
    const saved = lastLocation.getStudyTab();
    if (saved && saved !== "overview" && TABS.some((t) => t.id === saved)) {
      setTab(saved as StudyTab);
      const url = new URL(window.location.href);
      url.searchParams.set("tab", saved);
      window.history.replaceState(null, "", url.toString());
    }
  }, []);

  // Due-today task count for the Tasks tab badge (overdue + due today).
  const todayKey = localKey(new Date());
  const taskDue = tasks.filter(
    (t) => !t.done && t.dueDate && utcKey(new Date(t.dueDate)) <= todayKey,
  ).length;

  function select(next: StudyTab) {
    setTab(next);
    lastLocation.setStudyTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url.toString());
    // The hub is a client shell — tab data is fetched at page load and tabs
    // don't refetch on switch. Pull fresh server data when entering a data tab
    // so newly-added/-completed tasks and graded cards always show (the "tasks
    // don't sync" symptom). Calendar fetches its own range on demand.
    if (next !== "calendar") startTransition(() => router.refresh());
  }

  // Today's Session takes over the whole hub while it runs — a focused,
  // full-height flow rather than a tab.
  if (inSession) {
    return (
      <SessionRunner
        plan={sessionPlan}
        onExit={() => {
          setInSession(false);
          startTransition(() => router.refresh());
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Editorial tab bar */}
      <div className="flex items-center gap-1 border-b border-border px-3 py-2.5">
        {TABS.map((t) => {
          const active = tab === t.id;
          // Brass badges: due flashcards on Review, due tasks on Tasks.
          const badge =
            t.id === "review"
              ? dueCount > 0 ? dueCount : undefined
              : t.id === "tasks"
                ? taskDue > 0 ? taskDue : undefined
                : undefined;
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
        {tab === "overview" && (
          <StatsOverview
            stats={stats}
            game={game}
            canStartSession={sessionPlan.cards.length > 0 || sessionPlan.overdueTasks.length > 0}
            sessionSummary={{
              cards: sessionPlan.cards.length,
              dueCount: sessionPlan.dueCount,
              tasks: sessionPlan.overdueTasks.length,
              quizTitle: sessionPlan.quiz?.title ?? null,
              weakestSkill: sessionPlan.weakestSkill?.name ?? null,
            }}
            onStartSession={() => setInSession(true)}
          />
        )}
        {tab === "tasks" && <TasksView tasks={tasks} />}
        {tab === "review" && (
          <ReviewView
            cards={dueCards}
            total={totalCards}
            due={dueCount}
            scopeLabel={reviewScopeLabel}
            leeches={leeches ?? []}
          />
        )}
        {tab === "quiz" && <QuizTab quizzes={quizzes} initialQuizId={quizId} />}
        {tab === "cards" && <CardsTab />}
        {tab === "calendar" && <CalendarView initial={calendar} />}
      </div>
    </div>
  );
}
