"use client";

import { useState } from "react";
import { Check, ChevronRight, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { submitQuizAttemptAction, type QuizForTaking } from "@/app/(app)/study/quiz-actions";
import type { QuizAnswer } from "@/lib/db/schema";
import { celebrate } from "@/lib/gamify/celebrate";

/** Step through a quiz's mixed multiple-choice / open-ended questions, then
 *  submit for a scored, saved attempt. Mirrors review-view.tsx's per-card
 *  reveal→grade flow, adapted for auto-graded MC + self-graded open answers. */
export function QuizRunner({
  quiz,
  onDone,
  onExit,
}: {
  quiz: QuizForTaking;
  /** Called after a completed attempt is saved, so the list can refresh. */
  onDone: () => void;
  onExit: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<QuizAnswer[]>([]);
  const [mcSelected, setMcSelected] = useState<number | null>(null);
  const [openRevealed, setOpenRevealed] = useState(false);
  const [submitPhase, setSubmitPhase] = useState<"idle" | "submitting" | "error">("idle");
  const [result, setResult] = useState<{ score: number; total: number } | null>(null);

  const total = quiz.questions.length;
  const q = index < total ? quiz.questions[index] : null;

  function submit(finalAnswers: QuizAnswer[]) {
    setSubmitPhase("submitting");
    submitQuizAttemptAction({ quizId: quiz.id, answers: finalAnswers })
      .then((r) => {
        if (r.ok) {
          setSubmitPhase("idle");
          setResult({ score: r.score, total: r.total });
          celebrate(r.xp);
          onDone();
        } else {
          setSubmitPhase("error");
          toast.error(r.error);
        }
      })
      .catch((err) => {
        setSubmitPhase("error");
        toast.error(err instanceof Error ? err.message : "Couldn't save this attempt");
      });
  }

  function advance(answer: QuizAnswer) {
    const nextAnswers = [...answers, answer];
    setAnswers(nextAnswers);
    setMcSelected(null);
    setOpenRevealed(false);
    setIndex((i) => i + 1);
    if (nextAnswers.length >= total) submit(nextAnswers);
  }

  function retake() {
    setIndex(0);
    setAnswers([]);
    setMcSelected(null);
    setOpenRevealed(false);
    setSubmitPhase("idle");
    setResult(null);
  }

  if (result) {
    const pct = result.total > 0 ? Math.round((result.score / result.total) * 100) : 0;
    return (
      <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <div
          className="flex h-20 w-20 items-center justify-center rounded-full font-mono text-2xl font-semibold"
          style={{ color: "hsl(var(--brand))", background: "hsl(var(--brand) / 0.1)" }}
        >
          {pct}%
        </div>
        <div>
          <div className="editorial-display text-xl">
            {result.score} / {result.total} correct
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{quiz.title}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onExit}>
            Back to quizzes
          </Button>
          <Button onClick={retake} className="gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" /> Retake
          </Button>
        </div>
      </div>
    );
  }

  if (submitPhase !== "idle" || !q) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        {submitPhase === "error" ? (
          <>
            <p className="text-sm text-muted-foreground">Couldn&apos;t save this attempt.</p>
            <Button variant="outline" onClick={() => submit(answers)} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" /> Try again
            </Button>
          </>
        ) : (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <div className="editorial-eyebrow mb-1 truncate">{quiz.title}</div>
          <h1 className="editorial-display m-0" style={{ fontSize: "clamp(1.25rem, 2.5vw, 1.75rem)" }}>
            Question {index + 1} of {total}
          </h1>
        </div>
        <button onClick={onExit} className="shrink-0 text-xs text-muted-foreground hover:text-foreground">
          Exit
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-8">
        <div className="w-full rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="editorial-display text-xl font-medium leading-snug">{q.question}</div>
        </div>

        {q.type === "mc" ? (
          <div className="flex w-full flex-col gap-2">
            {q.options.map((opt, i) => {
              const chosen = mcSelected !== null;
              const isCorrect = i === q.correctIndex;
              const isPicked = i === mcSelected;
              return (
                <button
                  key={i}
                  disabled={chosen}
                  onClick={() => setMcSelected(i)}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-lg border px-4 py-2.5 text-left text-sm transition-colors",
                    !chosen && "border-border hover:bg-accent",
                    chosen && isCorrect && "border-emerald-500 bg-emerald-500/10",
                    chosen && isPicked && !isCorrect && "border-destructive bg-destructive/10",
                    chosen && !isPicked && !isCorrect && "border-border opacity-60",
                  )}
                >
                  <span>{opt}</span>
                  {chosen && isCorrect && <Check className="h-4 w-4 shrink-0 text-emerald-600" />}
                  {chosen && isPicked && !isCorrect && <X className="h-4 w-4 shrink-0 text-destructive" />}
                </button>
              );
            })}
            {mcSelected !== null && (
              <Button
                onClick={() => advance({ questionId: q.id, type: "mc", selectedIndex: mcSelected })}
                className="mt-2 gap-1.5 self-end"
              >
                {index + 1 === total ? "Finish" : "Next"} <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ) : !openRevealed ? (
          <Button onClick={() => setOpenRevealed(true)}>Show answer</Button>
        ) : (
          <div className="flex w-full flex-col gap-4">
            <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm leading-relaxed">
              {q.answer}
            </div>
            <div className="flex justify-center gap-2">
              <Button
                variant="outline"
                className="gap-1.5 hover:border-destructive hover:text-destructive"
                onClick={() => advance({ questionId: q.id, type: "open", selfCorrect: false })}
              >
                <X className="h-3.5 w-3.5" /> Missed it
              </Button>
              <Button
                variant="outline"
                className="gap-1.5 hover:border-emerald-500 hover:text-emerald-600"
                onClick={() => advance({ questionId: q.id, type: "open", selfCorrect: true })}
              >
                <Check className="h-3.5 w-3.5" /> Got it
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
