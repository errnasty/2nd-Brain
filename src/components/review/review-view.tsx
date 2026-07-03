"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Brain, Check, Loader2, RotateCcw, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { GRADES } from "@/lib/srs/sm2";
import {
  gradeCardAction,
  rewriteLeechAction,
  type DueCard,
  type LeechCard,
} from "@/app/(app)/review/actions";
import { enqueueGrade, flushGrades, pendingGradeCount } from "@/lib/offline/grade-queue";
import { celebrate } from "@/lib/gamify/celebrate";

export function ReviewView({
  cards,
  total,
  due,
  scopeLabel,
  leeches = [],
}: {
  cards: DueCard[];
  total: number;
  /** True number of cards due (the session only loads the first ~50). */
  due: number;
  /** When set, this session is scoped to a folder/note ("study this folder"). */
  scopeLabel?: string | null;
  /** Repeatedly-failed cards surfaced for rewriting. */
  leeches?: LeechCard[];
}) {
  const router = useRouter();
  const [queue, setQueue] = useState<DueCard[]>(cards);
  const [showAnswer, setShowAnswer] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [, startTransition] = useTransition();

  // "Load next batch"/"Check again" call router.refresh(), which feeds a new
  // `cards` prop — but useState seeded once would ignore it, leaving an empty
  // queue. Re-seed the session whenever the server sends a fresh batch.
  useEffect(() => {
    setQueue(cards);
    setReviewed(0);
    setShowAnswer(false);
  }, [cards]);

  const current = queue[0];
  // Live backlog: the true due count minus what we've graded this session.
  const remainingDue = Math.max(0, due - reviewed);

  // Anki-style keyboard review: Space/Enter reveals the answer, 1–4 grades.
  // Keeps the whole session hands-on-keyboard — no mouse round-trips between
  // cards. Skips inputs and modifier chords so global shortcuts stay intact.
  useEffect(() => {
    if (!current) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)
      ) {
        return;
      }
      if (!showAnswer && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setShowAnswer(true);
        return;
      }
      if (showAnswer && /^[1-4]$/.test(e.key)) {
        e.preventDefault();
        grade(GRADES[Number(e.key) - 1].quality);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, showAnswer]);

  // Flush grades queued while offline: on mount and whenever we reconnect.
  useEffect(() => {
    async function flush() {
      if (pendingGradeCount() === 0 || !navigator.onLine) return;
      const n = await flushGrades(gradeCardAction);
      if (n > 0) {
        toast.success(`Synced ${n} offline review${n === 1 ? "" : "s"}`);
        router.refresh();
      }
    }
    void flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [router]);

  function grade(quality: number) {
    if (!current) return;
    const card = current;
    const lapse = quality < 3;
    // Anki-style relearning: a failed card goes to the BACK of the session for
    // an immediate same-day retry (the server still schedules it for
    // tomorrow). Only successful grades count toward the session tally.
    setQueue((q) => (lapse ? [...q.slice(1), card] : q.slice(1)));
    setShowAnswer(false);
    if (!lapse) setReviewed((n) => n + 1);
    startTransition(async () => {
      try {
        const r = await gradeCardAction({ id: card.id, quality });
        if (r.ok) celebrate(r.xp);
        if (!r.ok) {
          // Server rejected the grade — put the card back so it isn't silently
          // lost from the session, and undo the optimistic counters.
          setQueue((q) => [card, ...q.filter((c) => c.id !== card.id)]);
          if (!lapse) setReviewed((n) => Math.max(0, n - 1));
          setShowAnswer(true);
          toast.error(r.error);
        }
      } catch {
        // Network down (offline study): keep the optimistic advance and queue
        // the grade — it syncs on reconnect via the flush effect above.
        enqueueGrade(card.id, quality);
        toast.info("Offline — review saved, will sync when you're back online");
      }
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
    // We only load the first ~50 due cards per session; if more remain due,
    // don't claim "all caught up" — invite loading the next batch.
    const moreDue = remainingDue > 0;
    return (
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-1">
          <Empty
            title={moreDue ? "Batch done" : "All caught up 🎉"}
            body={
              moreDue
                ? `Reviewed ${reviewed}. ${remainingDue} more due — load the next batch.`
                : `Reviewed ${reviewed} card${reviewed === 1 ? "" : "s"}. Nothing else is due right now.`
            }
            action={
              <Button variant="outline" onClick={() => router.refresh()} className="gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" /> {moreDue ? "Load next batch" : "Check again"}
              </Button>
            }
          />
        </div>
        <LeechPanel leeches={leeches} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <div className="editorial-eyebrow mb-1">{scopeLabel ? `Review · ${scopeLabel}` : "Study · Review"}</div>
          <h1 className="editorial-display m-0 flex items-center gap-2" style={{ fontSize: "clamp(1.5rem, 3vw, 2rem)" }}>
            <Brain className="h-5 w-5 shrink-0" style={{ color: "hsl(var(--brand))" }} /> Review
          </h1>
        </div>
        <span
          className="shrink-0 rounded-full px-2.5 py-1 font-mono text-[11px] tabular-nums"
          style={{ color: "hsl(var(--brand))", background: "hsl(var(--brand) / 0.08)" }}
        >
          {remainingDue} due
        </span>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-8">
        <div className="w-full rounded-xl border border-border bg-card p-6 shadow-sm">
          {current.itemTitle && (
            <div className="editorial-eyebrow mb-3">{current.itemTitle}</div>
          )}
          <div className="editorial-display text-xl font-medium leading-snug">{current.question}</div>
          {showAnswer && (
            <div className="mt-4 border-t border-border pt-4 text-[15px] leading-relaxed text-foreground/90">
              {current.answer}
            </div>
          )}
        </div>

        {!showAnswer ? (
          <Button onClick={() => setShowAnswer(true)} className="gap-1.5">
            <Check className="h-4 w-4" /> Show answer
            <kbd className="ml-1 hidden rounded border border-border/50 bg-background/20 px-1 text-[10px] font-medium sm:inline">
              space
            </kbd>
          </Button>
        ) : (
          <div className="flex w-full justify-center gap-2">
            {GRADES.map((g, i) => (
              <Button
                key={g.label}
                variant="outline"
                onClick={() => grade(g.quality)}
                className={cn(
                  "flex-1 max-w-[120px] gap-1.5",
                  g.label === "Again" && "hover:border-destructive hover:text-destructive",
                  g.label === "Easy" && "hover:border-emerald-500 hover:text-emerald-600",
                )}
              >
                <kbd className="hidden rounded border border-border bg-muted px-1 text-[10px] font-medium text-muted-foreground sm:inline">
                  {i + 1}
                </kbd>
                {g.label}
              </Button>
            ))}
          </div>
        )}
      </div>
      <LeechPanel leeches={leeches} />
    </div>
  );
}

/**
 * Cards failed 4+ times are "leeches": almost always badly formulated, and
 * they eat review time forever if left alone. Surface them with a one-click
 * AI rewrite that resets the card's scheduling as a fresh formulation.
 */
function LeechPanel({ leeches }: { leeches: LeechCard[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  if (leeches.length === 0) return null;

  async function rewrite(id: string) {
    setBusyId(id);
    try {
      const r = await rewriteLeechAction(id);
      if (r.ok) {
        toast.success("Card rewritten — it's back in today's queue as a fresh card");
        router.refresh();
      } else {
        toast.error(r.error);
      }
    } catch {
      toast.error("Couldn't rewrite card");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="border-t border-border px-6 py-4">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="editorial-eyebrow">
          Leeches · {leeches.length} card{leeches.length === 1 ? "" : "s"} you keep failing
        </span>
        <span className="text-[11px] italic text-muted-foreground">
          rewrite = sharper card, scheduling resets
        </span>
      </div>
      <ul className="space-y-1.5">
        {leeches.slice(0, 5).map((l) => (
          <li
            key={l.id}
            className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
          >
            <span className="min-w-0 flex-1 truncate text-[13px]" title={l.question}>
              {l.question}
            </span>
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-destructive/80">
              ×{l.lapses}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2 text-xs"
              disabled={busyId !== null}
              onClick={() => rewrite(l.id)}
            >
              {busyId === l.id ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Wand2 className="h-3 w-3" />
              )}
              Rewrite
            </Button>
          </li>
        ))}
      </ul>
    </section>
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
      <div className="editorial-display text-2xl">{title}</div>
      <p className="max-w-sm text-sm italic text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}
