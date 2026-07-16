"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Brain, Check, CheckSquare, HelpCircle, Loader2, PartyPopper, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ReviewView } from "@/components/review/review-view";
import { QuizRunner } from "./quiz-runner";
import { toggleTaskAction, type TaskRow } from "@/app/(app)/tasks/actions";
import { celebrate } from "@/lib/gamify/celebrate";
import type { SessionPlan } from "@/app/(app)/study/session-actions";

type Stage = "review" | "quiz" | "tasks" | "recap";

const STAGE_META: Record<Exclude<Stage, "recap">, { label: string; icon: React.ReactNode }> = {
  review: { label: "Review", icon: <Brain className="h-3.5 w-3.5" /> },
  quiz: { label: "Quiz", icon: <HelpCircle className="h-3.5 w-3.5" /> },
  tasks: { label: "Tasks", icon: <CheckSquare className="h-3.5 w-3.5" /> },
};

/**
 * "Today's session": a single guided run through whatever's due — flashcards,
 * one quiz, and overdue tasks — so studying is one decision ("start"), not
 * three. Each stage reuses the standalone component (ReviewView, QuizRunner);
 * empty stages are skipped, and a recap closes it out.
 */
export function SessionRunner({ plan, onExit }: { plan: SessionPlan; onExit: () => void }) {
  const router = useRouter();

  // Which stages actually have work — computed once from the plan.
  const stages = useMemo<Stage[]>(() => {
    const s: Stage[] = [];
    if (plan.cards.length > 0) s.push("review");
    if (plan.quiz) s.push("quiz");
    if (plan.overdueTasks.length > 0) s.push("tasks");
    s.push("recap");
    return s;
  }, [plan]);

  const [stageIndex, setStageIndex] = useState(0);
  const [cardsReviewed, setCardsReviewed] = useState(0);
  const [quizResult, setQuizResult] = useState<{ score: number; total: number } | null>(null);
  const [tasksCleared, setTasksCleared] = useState(0);

  const stage = stages[stageIndex];
  const workStages = stages.filter((s) => s !== "recap") as Exclude<Stage, "recap">[];

  function next() {
    setStageIndex((i) => Math.min(stages.length - 1, i + 1));
  }

  return (
    <div className="flex h-full flex-col">
      {/* Progress rail */}
      <div className="flex items-center gap-3 border-b border-border px-6 py-3">
        <div className="editorial-eyebrow-brand shrink-0">§ Today&apos;s session</div>
        <div className="flex flex-1 items-center gap-2">
          {workStages.map((s) => {
            const idx = stages.indexOf(s);
            const done = idx < stageIndex;
            const active = idx === stageIndex;
            return (
              <div
                key={s}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition-colors",
                  active
                    ? "bg-accent font-semibold text-foreground"
                    : done
                      ? "text-brand"
                      : "text-muted-foreground",
                )}
                title={STAGE_META[s].label}
              >
                <span className={cn(active && "text-brand")}>
                  {done ? <Check className="h-3.5 w-3.5" /> : STAGE_META[s].icon}
                </span>
                <span className="hidden sm:inline">{STAGE_META[s].label}</span>
              </div>
            );
          })}
        </div>
        <button
          onClick={onExit}
          className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
          title="Exit session"
        >
          Exit
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {stage === "review" && (
          <ReviewView
            cards={plan.cards}
            total={plan.dueCount}
            due={plan.cards.length}
            leeches={[]}
            onComplete={(n) => {
              setCardsReviewed(n);
              next();
            }}
          />
        )}

        {stage === "quiz" && plan.quiz && (
          <QuizRunner
            quiz={plan.quiz}
            exitLabel="Continue"
            onDone={(r) => {
              if (r) setQuizResult(r);
              router.refresh();
            }}
            onExit={next}
          />
        )}

        {stage === "tasks" && (
          <SessionTasks tasks={plan.overdueTasks} onCleared={setTasksCleared} onDone={next} />
        )}

        {stage === "recap" && (
          <Recap
            cardsReviewed={cardsReviewed}
            quizResult={quizResult}
            tasksCleared={tasksCleared}
            didReview={workStages.includes("review")}
            didQuiz={workStages.includes("quiz")}
            didTasks={workStages.includes("tasks")}
            onExit={onExit}
          />
        )}
      </div>
    </div>
  );
}

/** Overdue-task checklist stage — tick them off, then continue. */
function SessionTasks({
  tasks,
  onCleared,
  onDone,
}: {
  tasks: TaskRow[];
  onCleared: (n: number) => void;
  onDone: () => void;
}) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  function tick(t: TaskRow) {
    if (done.has(t.id)) return; // one-way in a session — tick it off and move on
    setBusy(t.id);
    toggleTaskAction({ id: t.id, done: true })
      .then((r) => {
        if (r.ok) {
          const nextDone = new Set(done).add(t.id);
          setDone(nextDone);
          onCleared(nextDone.size);
          if (r.xp) celebrate(r.xp);
        } else {
          toast.error(r.error);
        }
      })
      .catch(() => toast.error("Couldn't update the task"))
      .finally(() => setBusy(null));
  }

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col">
      <div className="border-b border-border px-6 py-4">
        <div className="editorial-eyebrow mb-1">Session · Tasks</div>
        <h1 className="editorial-display m-0" style={{ fontSize: "clamp(1.25rem, 2.5vw, 1.75rem)" }}>
          Clear what&apos;s overdue
        </h1>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <ul className="space-y-1.5">
          {tasks.map((t) => {
            const checked = done.has(t.id);
            return (
              <li key={t.id}>
                <button
                  onClick={() => tick(t)}
                  disabled={busy === t.id || checked}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition-colors",
                    checked ? "opacity-60" : "hover:bg-accent/50",
                  )}
                >
                  <span className="mt-0.5 shrink-0 text-muted-foreground">
                    {busy === t.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : checked ? (
                      <CheckSquare className="h-4 w-4 text-brand" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm", checked && "line-through")}>{t.text}</span>
                    <span className="mt-0.5 block truncate font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                      {t.itemTitle}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-6 py-3">
        <Button onClick={onDone}>Continue</Button>
      </div>
    </div>
  );
}

function Recap({
  cardsReviewed,
  quizResult,
  tasksCleared,
  didReview,
  didQuiz,
  didTasks,
  onExit,
}: {
  cardsReviewed: number;
  quizResult: { score: number; total: number } | null;
  tasksCleared: number;
  didReview: boolean;
  didQuiz: boolean;
  didTasks: boolean;
  onExit: () => void;
}) {
  const rows: { label: string; value: string; icon: React.ReactNode }[] = [];
  if (didReview)
    rows.push({ label: "Cards reviewed", value: String(cardsReviewed), icon: <Brain className="h-4 w-4" /> });
  if (didQuiz)
    rows.push({
      label: "Quiz score",
      value: quizResult ? `${quizResult.score}/${quizResult.total}` : "—",
      icon: <HelpCircle className="h-4 w-4" />,
    });
  if (didTasks)
    rows.push({ label: "Tasks cleared", value: String(tasksCleared), icon: <CheckSquare className="h-4 w-4" /> });

  return (
    <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-full"
        style={{ color: "hsl(var(--brand))", background: "hsl(var(--brand) / 0.1)" }}
      >
        <PartyPopper className="h-7 w-7" />
      </div>
      <div>
        <div className="editorial-display text-2xl">Session complete</div>
        <p className="mt-1 text-sm text-muted-foreground">Nice work — you&apos;re caught up for now.</p>
      </div>
      {rows.length > 0 && (
        <div className="w-full space-y-2">
          {rows.map((r) => (
            <div
              key={r.label}
              className="flex items-center justify-between rounded-lg border border-border px-4 py-2.5 text-sm"
            >
              <span className="flex items-center gap-2 text-muted-foreground">
                {r.icon} {r.label}
              </span>
              <span className="font-mono tabular-nums">{r.value}</span>
            </div>
          ))}
        </div>
      )}
      <Button onClick={onExit} className="gap-1.5">
        <Check className="h-3.5 w-3.5" /> Done
      </Button>
    </div>
  );
}
