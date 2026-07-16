"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Brain, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/app-dialogs";
import {
  deleteQuizAction,
  fetchQuizAction,
  type QuizForTaking,
  type QuizListItem,
} from "@/app/(app)/study/quiz-actions";
import { QuizPickerDialog } from "./quiz-picker-dialog";
import { QuizRunner } from "./quiz-runner";

export function QuizTab({
  quizzes,
  initialQuizId,
}: {
  quizzes: QuizListItem[];
  /** Deep-link from the Directory's bulk "Quiz" action or a document's "Make
   *  quiz" — jump straight into taking the freshly-generated quiz. */
  initialQuizId?: string | null;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [taking, setTaking] = useState<QuizForTaking | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function take(id: string) {
    setLoadingId(id);
    fetchQuizAction(id)
      .then((q) => {
        if (q) setTaking(q);
        else toast.error("Quiz not found");
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Couldn't load the quiz"))
      .finally(() => setLoadingId(null));
  }

  useEffect(() => {
    if (initialQuizId) take(initialQuizId);
  }, [initialQuizId]);

  function exit() {
    setTaking(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("quiz");
    window.history.replaceState(null, "", url.toString());
  }

  async function remove(id: string, title: string) {
    const ok = await confirm({
      title: `Delete "${title}"?`,
      body: "This deletes the quiz and its attempt history. This cannot be undone.",
      destructive: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setDeletingId(id);
    try {
      const r = await deleteQuizAction(id);
      if (r.ok) {
        toast.success("Quiz deleted");
        router.refresh();
      } else {
        toast.error(r.error);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete the quiz");
    } finally {
      setDeletingId(null);
    }
  }

  if (taking) {
    return (
      <QuizRunner
        quiz={taking}
        onDone={() => router.refresh()}
        onExit={exit}
      />
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="editorial-eyebrow mb-1">Study · Quiz</div>
          <h1 className="editorial-display m-0 flex items-center gap-2" style={{ fontSize: "clamp(1.5rem, 3vw, 2rem)" }}>
            <Brain className="h-5 w-5 shrink-0" style={{ color: "hsl(var(--brand))" }} /> Quiz
          </h1>
        </div>
        <Button onClick={() => setPickerOpen(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> New quiz
        </Button>
      </div>

      {quizzes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <Brain className="h-8 w-8 text-muted-foreground/40" />
          <p className="max-w-sm text-sm italic text-muted-foreground">
            Pick one or more documents and generate a mixed multiple-choice / open-ended quiz
            to test yourself.
          </p>
          <Button variant="outline" onClick={() => setPickerOpen(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> New quiz
          </Button>
        </div>
      ) : (
        <ul className="space-y-2">
          {quizzes.map((q) => {
            const pct = q.bestScore !== null && q.bestTotal ? Math.round((q.bestScore / q.bestTotal) * 100) : null;
            return (
              <li
                key={q.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{q.title}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                    {q.questionCount} question{q.questionCount === 1 ? "" : "s"} · {q.itemCount} doc
                    {q.itemCount === 1 ? "" : "s"}
                    {pct !== null && ` · best ${pct}%`}
                    {q.attemptCount > 0 && ` · ${q.attemptCount} attempt${q.attemptCount === 1 ? "" : "s"}`}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loadingId === q.id}
                  onClick={() => take(q.id)}
                  className="gap-1.5"
                >
                  {loadingId === q.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : q.attemptCount > 0 ? (
                    <RotateCcw className="h-3.5 w-3.5" />
                  ) : null}
                  {q.attemptCount > 0 ? "Retake" : "Take"}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={deletingId === q.id}
                  onClick={() => remove(q.id, q.title)}
                  title="Delete quiz"
                >
                  {deletingId === q.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <QuizPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} />
    </div>
  );
}
