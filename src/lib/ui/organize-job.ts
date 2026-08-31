"use client";

/**
 * The browser half of a background Directory sort.
 *
 * ## What this is for
 *
 * Sorting a real library takes minutes, and the person who started it should
 * not have to sit and watch it. So the dialog closes the moment the job is
 * created, the work carries on server-side, and this module keeps the app
 * honest about it: a live progress strip while it runs (via the same store the
 * quiz/flashcard builders use), and a toast when it lands.
 *
 * ## Why the job id is persisted
 *
 * The strip is in-memory, so a reload would otherwise lose the thread entirely
 * — the sort would still be happening, with nothing anywhere saying so, and the
 * folders would just change under the user later. One localStorage key fixes
 * that: `resumeOrganizeJob()` runs on every app mount and re-attaches to a sort
 * that is still going. The key is cleared the moment the job settles, so a
 * finished sort can't resurrect its strip on the next visit.
 *
 * ## Undo
 *
 * The completion toast carries the undo, because the seconds right after "your
 * library was rearranged" are when someone actually wants it. It is not the
 * only way back — the sort dialog offers the last run's undo too — but it is
 * the one that costs no clicks.
 */

import { toast } from "sonner";
import {
  finishGenerationJob,
  startGenerationJob,
  updateGenerationJob,
} from "@/lib/ui/generation-jobs";
import { isSeveredResponse } from "@/lib/ui/severed";
import { undoSortAction } from "@/app/(app)/directory/actions";
import {
  describeOrganizeSummary,
  type OrganizeScope,
  type PublicOrganizeSummary,
} from "@/lib/directory/organize-plan";

const KEY = "directory.sortJob.v1";
const POLL_MS = 2000;
/** A capped run (600 items, 25 per batch) cannot plausibly outlive this. */
const POLL_TIMEOUT_MS = 15 * 60_000;

/** Fired when a sort (or its undo) has changed what's on screen. */
export const DIRECTORY_CHANGED_EVENT = "directory-changed";

function announceChange(): void {
  window.dispatchEvent(new CustomEvent(DIRECTORY_CHANGED_EVENT));
}

function remember(jobId: string): void {
  try {
    localStorage.setItem(KEY, jobId);
  } catch {
    // Private mode / disabled storage: the sort still runs and this session
    // still shows it. Only surviving a reload is lost.
  }
}

function forget(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // as above
  }
}

/** A sort left running by an earlier page, if there is one. */
function remembered(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

type JobStatus = {
  status: "pending" | "running" | "done" | "error";
  error: string | null;
  progress: { phase: string; done: number; total: number; label: string } | null;
  summary: PublicOrganizeSummary | null;
};

/**
 * Start a sort and hand it to the watcher. Resolves as soon as the job exists
 * — deliberately, so the caller can close its dialog — not when the sort ends.
 */
export async function startOrganizeJob(opts: {
  scope: OrganizeScope;
  pruneEmpty?: boolean;
}): Promise<{ ok: true; jobId: string } | { ok: false; error: string }> {
  let jobId: string;
  try {
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "organize", scope: opts.scope, pruneEmpty: opts.pruneEmpty === true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.jobId) return { ok: false, error: data.error ?? "Couldn't start sorting" };
    jobId = data.jobId as string;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't start sorting" };
  }

  remember(jobId);
  // The kick's response is allowed to sever mid-run — the poll below is the
  // source of truth about how the sort is going. A kick REFUSED outright is a
  // different thing: the row would sit pending forever with nothing working on
  // it, so that stops the watcher and says why instead of showing a bar for a
  // sort that never started. 409 is the exception — it means something else
  // already claimed the job, which is exactly what we wanted.
  void fetch(`/api/jobs/${jobId}/run`, { method: "POST" })
    .then(async (res) => {
      if (res.ok || res.status === 409) return;
      const data = await res.json().catch(() => ({}));
      forget();
      stopWatching(jobId);
      toast.error(data.error ?? "Couldn't start sorting");
    })
    .catch((err) => {
      if (!isSeveredResponse(err)) {
        console.warn("sort kick failed:", err instanceof Error ? err.message : err);
      }
    });

  watchOrganizeJob(jobId, opts.scope);
  return { ok: true, jobId };
}

// One watcher per job, however many times a mount or a start asks for one.
// The value tears that watcher down — used when the kick comes back refused
// and there is no longer anything to watch.
const watching = new Map<string, () => void>();

function stopWatching(jobId: string): void {
  watching.get(jobId)?.();
}

/** Attach the progress strip and the completion toast to a running sort. */
export function watchOrganizeJob(jobId: string, scope?: OrganizeScope): void {
  if (typeof window === "undefined" || watching.has(jobId)) return;

  // Re-attaching after a reload has no idea which scope was chosen, so it says
  // the true, vaguer thing rather than guessing "unsorted" and being wrong
  // about a whole-directory run. The label is replaced by the job's own on the
  // first poll anyway.
  const stripId = startGenerationJob(
    scope === "everything"
      ? "Sorting your whole directory"
      : scope === "unsorted"
        ? "Sorting unsorted items"
        : "Sorting your directory",
  );
  const startedAt = Date.now();

  const stop = () => {
    clearInterval(timer);
    watching.delete(jobId);
    finishGenerationJob(stripId);
  };
  watching.set(jobId, stop);

  const timer = setInterval(async () => {
    let data: JobStatus;
    try {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (res.status === 404) {
        // The job is gone (cleared account, or a stale id from an old device).
        forget();
        stop();
        return;
      }
      if (!res.ok) return; // transient — next tick retries
      data = (await res.json()) as JobStatus;
    } catch {
      return; // transient — next tick retries
    }

    if (data.progress) {
      updateGenerationJob(stripId, {
        label: data.progress.label,
        done: data.progress.done,
        // Only the filing phase counts anything; planning and tidying report an
        // indeterminate sweep rather than a bar sitting at 0.
        total: data.progress.phase === "filing" ? data.progress.total : 0,
      });
    }

    if (data.status === "done") {
      forget();
      stop();
      announceChange();
      if (data.summary) celebrateSort(jobId, data.summary);
      else toast.success("Sorting finished.");
      return;
    }

    if (data.status === "error") {
      forget();
      stop();
      toast.error(data.error ?? "Sorting failed");
      return;
    }

    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      // Still going, or wedged — either way stop drawing a bar nobody can trust.
      forget();
      stop();
      toast("Still sorting in the background. Refresh in a bit to see where it got to.");
    }
  }, POLL_MS);
}

/** Re-attach to a sort left running by an earlier page. Safe to call on every mount. */
export function resumeOrganizeJob(): void {
  const jobId = remembered();
  if (jobId) watchOrganizeJob(jobId);
}

function celebrateSort(jobId: string, summary: PublicOrganizeSummary): void {
  // "Nothing needed moving" has to mean nothing happened at all — a run that
  // cleared out four empty folders did something, and saying otherwise leaves
  // the reader wondering where their folders went.
  if (
    summary.moved === 0 &&
    summary.foldersCreated.length === 0 &&
    summary.foldersRemoved.length === 0
  ) {
    toast("Nothing needed moving — your directory is already tidy.");
    return;
  }
  toast.success("Your directory is sorted", {
    description: describeOrganizeSummary(summary),
    duration: 12_000,
    // Offered only when there is something to put back. A sort whose undo has
    // already been used still reports itself as done to a tab that reconnects
    // to it later, and an Undo button that can only say "put back 0 items" is
    // worse than no button.
    action: summary.canUndo ? { label: "Undo", onClick: () => void undoSort(jobId) } : undefined,
  });
}

/** Reverse a sort and say what came back. Exported so the dialog can offer it too. */
export async function undoSort(jobId: string): Promise<void> {
  const id = startGenerationJob("Putting your directory back");
  try {
    const r = await undoSortAction(jobId);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    announceChange();
    toast.success(
      `Put back ${r.restored} item${r.restored === 1 ? "" : "s"}`,
      r.foldersRestored > 0
        ? { description: `${r.foldersRestored} folder${r.foldersRestored === 1 ? "" : "s"} restored` }
        : undefined,
    );
  } catch {
    toast.error("Couldn't undo that sort");
  } finally {
    finishGenerationJob(id);
  }
}
