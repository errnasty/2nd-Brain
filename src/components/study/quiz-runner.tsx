"use client";

import { useEffect, useState } from "react";
import { Brain, Check, ChevronRight, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { OpenGrade } from "@/lib/ai/grade-open";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  addMissedToFlashcardsAction,
  submitQuizAttemptAction,
  type QuizForTaking,
} from "@/app/(app)/study/quiz-actions";
import type { QuizAnswer } from "@/lib/db/schema";
import { celebrate } from "@/lib/gamify/celebrate";

/** Step through a quiz's mixed multiple-choice / open-ended questions, then
 *  submit for a scored, saved attempt. Mirrors review-view.tsx's per-card
 *  reveal→grade flow, adapted for auto-graded MC + self-graded open answers. */
export function QuizRunner({
  quiz,
  onDone,
  onExit,
  exitLabel = "Back to quizzes",
}: {
  quiz: QuizForTaking;
  /** Called after a completed attempt is saved (with its score), so the caller
   *  can refresh and/or record the result. */
  onDone: (result?: { score: number; total: number }) => void;
  onExit: () => void;
  /** Label for the post-quiz exit button (e.g. "Continue" inside a session). */
  exitLabel?: string;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<QuizAnswer[]>([]);
  const [mcSelected, setMcSelected] = useState<number | null>(null);
  const [openRevealed, setOpenRevealed] = useState(false);
  // What the learner wrote before revealing, and the model's read on it.
  // Optional throughout: the quiz works exactly as before if you type nothing.
  const [openDraft, setOpenDraft] = useState("");
  const [grade, setGrade] = useState<OpenGrade | null>(null);
  const [grading, setGrading] = useState(false);
  const [submitPhase, setSubmitPhase] = useState<"idle" | "submitting" | "error">("idle");
  const [result, setResult] = useState<{ score: number; total: number } | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [addMissedState, setAddMissedState] = useState<"idle" | "loading" | "done">("idle");

  const total = quiz.questions.length;
  const q = index < total ? quiz.questions[index] : null;

  // Missed questions, derived from the answers already collected — the count
  // shown on the score screen's "add to flashcards" button.
  const missedCount = (() => {
    const byId = new Map(quiz.questions.map((qq) => [qq.id, qq]));
    return answers.filter((a) => {
      const qq = byId.get(a.questionId);
      if (!qq) return false;
      if (qq.type === "mc" && a.type === "mc") return a.selectedIndex !== qq.correctIndex;
      if (qq.type === "open" && a.type === "open") return !a.selfCorrect;
      return false;
    }).length;
  })();

  // Keyboard-first quiz: 1–4 pick a multiple-choice option, Space/Enter reveal
  // an open answer or advance once answered, and 1/2 self-grade an open card.
  // Keeps a whole quiz hands-on-keyboard, matching the review flow.
  useEffect(() => {
    if (result || submitPhase !== "idle" || !q) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || !q) return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
      ) {
        return;
      }
      if (q.type === "mc") {
        if (mcSelected === null) {
          const n = Number(e.key);
          if (n >= 1 && n <= q.options.length) {
            e.preventDefault();
            setMcSelected(n - 1);
          }
        } else if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") {
          e.preventDefault();
          advance({ questionId: q.id, type: "mc", selectedIndex: mcSelected });
        }
      } else if (!openRevealed) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setOpenRevealed(true);
        }
      } else if (e.key === "1") {
        e.preventDefault();
        advance({ questionId: q.id, type: "open", selfCorrect: false });
      } else if (e.key === "2" || e.key === "Enter") {
        e.preventDefault();
        advance({ questionId: q.id, type: "open", selfCorrect: true });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, mcSelected, openRevealed, result, submitPhase]);

  function submit(finalAnswers: QuizAnswer[]) {
    setSubmitPhase("submitting");
    submitQuizAttemptAction({ quizId: quiz.id, answers: finalAnswers })
      .then((r) => {
        if (r.ok) {
          setSubmitPhase("idle");
          setAttemptId(r.attemptId);
          setResult({ score: r.score, total: r.total });
          celebrate(r.xp);
          onDone({ score: r.score, total: r.total });
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

  function addMissedToFlashcards() {
    if (!attemptId || addMissedState !== "idle") return;
    setAddMissedState("loading");
    addMissedToFlashcardsAction(quiz.id, attemptId)
      .then((r) => {
        if (r.ok) {
          toast.success(`Added ${r.count} card${r.count === 1 ? "" : "s"} to your flashcard deck`);
          celebrate(r.xp);
          setAddMissedState("done");
        } else {
          setAddMissedState("idle");
          toast.error(r.error);
        }
      })
      .catch((err) => {
        setAddMissedState("idle");
        toast.error(err instanceof Error ? err.message : "Couldn't add cards");
      });
  }

  function advance(answer: QuizAnswer) {
    const nextAnswers = [...answers, answer];
    setAnswers(nextAnswers);
    setMcSelected(null);
    setOpenRevealed(false);
    setOpenDraft("");
    setGrade(null);
    setGrading(false);
    setIndex((i) => i + 1);
    if (nextAnswers.length >= total) submit(nextAnswers);
  }

  function retake() {
    setIndex(0);
    setAnswers([]);
    setMcSelected(null);
    setOpenRevealed(false);
    setOpenDraft("");
    setGrade(null);
    setGrading(false);
    setSubmitPhase("idle");
    setResult(null);
    setAttemptId(null);
    setAddMissedState("idle");
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
        {missedCount > 0 && (
          <Button
            variant="outline"
            className="gap-1.5"
            disabled={addMissedState !== "idle"}
            onClick={addMissedToFlashcards}
          >
            {addMissedState === "loading" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : addMissedState === "done" ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Brain className="h-3.5 w-3.5" />
            )}
            {addMissedState === "done" ? "Added to flashcards" : `Add ${missedCount} missed to flashcards`}
          </Button>
        )}
        <div className="flex gap-2">
          <Button variant="outline" onClick={onExit}>
            {exitLabel}
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
                    "flex items-center gap-3 rounded-lg border px-4 py-2.5 text-left text-sm transition-colors",
                    !chosen && "border-border hover:bg-accent",
                    chosen && isCorrect && "border-emerald-500 bg-emerald-500/10",
                    chosen && isPicked && !isCorrect && "border-destructive bg-destructive/10",
                    chosen && !isPicked && !isCorrect && "border-border opacity-60",
                  )}
                >
                  <kbd className="hidden h-5 w-5 shrink-0 items-center justify-center rounded border border-border bg-muted text-[10px] font-medium text-muted-foreground sm:inline-flex">
                    {i + 1}
                  </kbd>
                  <span className="min-w-0 flex-1">{opt}</span>
                  {chosen && isCorrect && <Check className="h-4 w-4 shrink-0 text-emerald-600" />}
                  {chosen && isPicked && !isCorrect && <X className="h-4 w-4 shrink-0 text-destructive" />}
                </button>
              );
            })}
            {mcSelected !== null && q.explanation && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
                {q.explanation}
              </div>
            )}
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
          <div className="flex w-full flex-col gap-3">
            {/* Optional. Writing the answer down before seeing it is the whole
                point of an open question — and it is what makes the "check my
                answer" step below possible at all. Skipping it leaves the
                original reveal-and-self-grade flow untouched. */}
            <Textarea
              value={openDraft}
              onChange={(e) => setOpenDraft(e.target.value)}
              placeholder="Write your answer first (optional)…"
              rows={3}
              className="resize-none"
            />
            <Button className="self-center" onClick={() => setOpenRevealed(true)}>
              Show answer
            </Button>
          </div>
        ) : (
          <div className="flex w-full flex-col gap-4">
            {openDraft.trim() && (
              <div className="rounded-lg border border-border p-3 text-sm leading-relaxed">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Your answer
                </div>
                <div className="whitespace-pre-wrap">{openDraft}</div>
              </div>
            )}
            <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm leading-relaxed">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Reference answer
              </div>
              {q.answer}
            </div>

            {openDraft.trim() && !grade && (
              <Button
                variant="outline"
                size="sm"
                className="self-center gap-1.5"
                disabled={grading}
                onClick={async () => {
                  setGrading(true);
                  try {
                    const res = await fetch("/api/study/grade-open", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        quizId: quiz.id,
                        questionId: q.id,
                        answer: openDraft,
                      }),
                    });
                    const data = (await res.json()) as { grade?: OpenGrade | null; error?: string };
                    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
                    // A null grade is not an error — it means grading is
                    // unavailable. Self-grading below still works.
                    if (data.grade) setGrade(data.grade);
                    else toast.message("Couldn't check this one — grade it yourself below.");
                  } catch (err) {
                    toast.error(
                      `Couldn't check your answer: ${err instanceof Error ? err.message : "error"}`,
                    );
                  } finally {
                    setGrading(false);
                  }
                }}
              >
                {grading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                Check my answer
              </Button>
            )}

            {grade && (
              <div
                className={cn(
                  "rounded-lg border p-3 text-sm leading-relaxed",
                  grade.verdict === "correct"
                    ? "border-emerald-500/40 bg-emerald-500/5"
                    : grade.verdict === "partial"
                      ? "border-yellow-500/40 bg-yellow-500/5"
                      : "border-destructive/40 bg-destructive/5",
                )}
              >
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {grade.verdict === "correct"
                    ? "Looks right"
                    : grade.verdict === "partial"
                      ? "Partly there"
                      : "Not quite"}{" "}
                  · you still decide
                </div>
                {grade.feedback}
              </div>
            )}

            {/* The self-grade stays the score. The check above only suggests —
                see the note in lib/ai/grade-open.ts for why a model must not
                write to your results. "partial" suggests "Missed it": recall
                that needed prompting has not landed yet. */}
            <div className="flex justify-center gap-2">
              <Button
                variant="outline"
                className={cn(
                  "gap-1.5 hover:border-destructive hover:text-destructive",
                  grade && grade.verdict !== "correct" && "border-destructive text-destructive",
                )}
                onClick={() => advance({ questionId: q.id, type: "open", selfCorrect: false })}
              >
                <X className="h-3.5 w-3.5" /> Missed it
              </Button>
              <Button
                variant="outline"
                className={cn(
                  "gap-1.5 hover:border-emerald-500 hover:text-emerald-600",
                  grade?.verdict === "correct" && "border-emerald-500 text-emerald-600",
                )}
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
