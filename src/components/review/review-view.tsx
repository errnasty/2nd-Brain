"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Brain, Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { GRADES } from "@/lib/srs/sm2";
import { gradeCardAction, type DueCard } from "@/app/(app)/review/actions";

export function ReviewView({ cards, total }: { cards: DueCard[]; total: number }) {
  const router = useRouter();
  const [queue, setQueue] = useState<DueCard[]>(cards);
  const [showAnswer, setShowAnswer] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [, startTransition] = useTransition();

  const current = queue[0];

  function grade(quality: number) {
    if (!current) return;
    const id = current.id;
    setQueue((q) => q.slice(1));
    setShowAnswer(false);
    setReviewed((n) => n + 1);
    startTransition(async () => {
      const r = await gradeCardAction({ id, quality });
      if (!r.ok) toast.error(r.error);
    });
  }

  if (total === 0) {
    return (
      <Empty
        title="No flashcards yet"
        body="Open a note or document in the Directory and hit “Make flashcards” to start building your review deck."
      />
    );
  }

  if (!current) {
    return (
      <Empty
        title="All caught up 🎉"
        body={`Reviewed ${reviewed} card${reviewed === 1 ? "" : "s"}. Nothing else is due right now.`}
        action={
          <Button variant="outline" onClick={() => router.refresh()} className="gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" /> Check again
          </Button>
        }
      />
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Brain className="h-5 w-5" /> Review
        </h1>
        <div className="text-xs text-muted-foreground">{queue.length} due</div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-8">
        <div className="w-full rounded-xl border border-border bg-card p-6 shadow-sm">
          {current.itemTitle && (
            <div className="mb-3 text-[11px] uppercase tracking-wider text-muted-foreground">
              {current.itemTitle}
            </div>
          )}
          <div className="text-lg font-medium leading-snug">{current.question}</div>
          {showAnswer && (
            <div className="mt-4 border-t border-border pt-4 text-[15px] leading-relaxed text-foreground/90">
              {current.answer}
            </div>
          )}
        </div>

        {!showAnswer ? (
          <Button onClick={() => setShowAnswer(true)} className="gap-1.5">
            <Check className="h-4 w-4" /> Show answer
          </Button>
        ) : (
          <div className="flex w-full justify-center gap-2">
            {GRADES.map((g) => (
              <Button
                key={g.label}
                variant="outline"
                onClick={() => grade(g.quality)}
                className={cn(
                  "flex-1 max-w-[120px]",
                  g.label === "Again" && "hover:border-destructive hover:text-destructive",
                  g.label === "Easy" && "hover:border-emerald-500 hover:text-emerald-600",
                )}
              >
                {g.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <Brain className="h-10 w-10 text-muted-foreground/40" />
      <div className="text-lg font-medium">{title}</div>
      <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}
