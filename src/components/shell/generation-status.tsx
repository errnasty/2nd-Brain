"use client";

import { useSyncExternalStore } from "react";
import { Loader2 } from "lucide-react";
import {
  getGenerationJobs,
  getServerGenerationJobs,
  subscribeGenerationJobs,
} from "@/lib/ui/generation-jobs";

/**
 * The "something is being made right now" strip, mounted once in the app
 * layout.
 *
 * Lives outside the button that started the work, on purpose. Quiz and
 * flashcard generation are kicked off from a row menu, a bulk bar, or a dialog
 * that closes on submit — and the app then navigates to /study — so the
 * button's own spinner is gone within a second of the work starting. Being in
 * the layout means this survives all of that and keeps answering "yes, it's
 * still going" until the work actually ends.
 *
 * Positioned at the top: the bottom of the screen already holds the mobile tab
 * bar and the Directory's bulk-action bar, and a progress strip that covers
 * either would trade one problem for another.
 */
export function GenerationStatus() {
  const jobs = useSyncExternalStore(
    subscribeGenerationJobs,
    getGenerationJobs,
    getServerGenerationJobs,
  );
  if (jobs.length === 0) return null;

  return (
    <div
      // aria-live so the progress is announced rather than only drawn; polite
      // because it must not interrupt what the user is reading.
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[calc(3rem+env(safe-area-inset-top)+0.5rem)] z-50 flex flex-col items-center gap-2 px-3 lg:top-4"
    >
      {jobs.map((job) => {
        const determinate = job.total > 0;
        const pct = determinate ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;
        return (
          <div
            key={job.id}
            className="pointer-events-auto w-full max-w-xs overflow-hidden rounded-xl border border-border bg-card/95 shadow-lg backdrop-blur"
          >
            <div className="flex items-center gap-2 px-3 py-2 text-sm">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{job.label}</span>
              {determinate && (
                <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                  {job.done} / {job.total}
                </span>
              )}
            </div>
            <div className="h-0.5 w-full bg-border">
              {determinate ? (
                <div
                  className="h-full bg-foreground/70 transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
              ) : (
                // No countable units to report — a travelling sliver says
                // "working" without implying a position it doesn't know.
                <div className="h-full w-1/3 animate-[generation-sweep_1.2s_ease-in-out_infinite] bg-foreground/70" />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
