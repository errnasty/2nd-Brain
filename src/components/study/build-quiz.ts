import {
  continueQuizAction,
  generateQuizAction,
  type QuizProgress,
} from "@/app/(app)/study/quiz-actions";
import { QUIZ_BATCH, QUIZ_COUNT_RANGE } from "@/lib/ai/study-options";
import {
  finishGenerationJob,
  startGenerationJob,
  updateGenerationJob,
} from "@/lib/ui/generation-jobs";

/**
 * Drive a staggered quiz build from the client.
 *
 * Generation is one model call per request (see `quiz-actions.ts` for why), so
 * something has to walk the batches. That belongs on the client for the same
 * reason it does in the Daily Brief and the article simplifier: a server-side
 * loop is a single long request, which is exactly what the host kills.
 *
 * Every call site used to be `generateQuizAction(ids).then(…)`. This keeps that
 * shape — one promise, one result — and adds `onProgress` for a live count.
 */

/** Hard stop on the loop. The count is clamped server-side, so this can only
 *  be reached by a batch that keeps returning fewer questions than asked; it
 *  exists so a misbehaving model can't spin requests forever. */
const MAX_ROUNDS = Math.ceil(QUIZ_COUNT_RANGE.max / QUIZ_BATCH) + 4;

/**
 * Consecutive rounds that may add nothing before the quiz is called finished.
 *
 * A batch under-delivers more often than you would expect — the model repeats
 * a question it was told not to, or emits options that fail validation, and
 * those get dropped. Stopping at the first such round is what turned "10
 * questions" into 7. Retrying a couple of times usually recovers the rest,
 * and costs at most two extra short calls when it doesn't.
 */
const MAX_STALLS = 2;

/**
 * What to tell the user when the build finishes.
 *
 * Says "7 of 10" when it fell short. Reporting a plain "7 questions" against a
 * setting of 10 reads as the setting being ignored, when what actually
 * happened is that the model could not produce usable questions for the rest.
 */
export function quizReadyMessage(r: { count: number; total: number }): string {
  const noun = r.count === 1 ? "question" : "questions";
  return r.count < r.total
    ? `Quiz ready — ${r.count} of ${r.total} ${noun}`
    : `Quiz ready — ${r.count} ${noun}`;
}

export type BuildQuizResult =
  | { ok: true; id: string; count: number; total: number; xp?: QuizProgress["xp"] }
  | { ok: false; error: string };

export async function buildQuiz(
  itemIds: string[],
  opts?: { onProgress?: (count: number, total: number) => void },
): Promise<BuildQuizResult> {
  // Registered here rather than at the five call sites, so every entry point
  // — row menu, bulk bar, item viewer, picker dialog — reports progress the
  // same way, including the ones that navigate away mid-build.
  const jobId = startGenerationJob("Building quiz");
  try {
    const first = await generateQuizAction(itemIds);
    if (!first.ok) return first;

    const { id, total, xp } = first;
    let count = first.count;
    let done = first.done;
    const report = () => {
      updateGenerationJob(jobId, { done: count, total });
      opts?.onProgress?.(count, total);
    };
    report();

    let stalls = 0;
    for (let round = 0; !done && round < MAX_ROUNDS; round += 1) {
      const next = await continueQuizAction(id);
      // A hard failure ends it. Keep what already landed: the quiz exists and
      // is takeable from the first batch on, so this means a shorter quiz —
      // never a lost one. That is the whole reason for batching.
      if (!next.ok) break;
      if (next.count <= count) {
        if (++stalls >= MAX_STALLS) break;
        continue;
      }
      stalls = 0;
      count = next.count;
      done = next.done;
      report();
    }

    return { ok: true, id, count, total, xp };
  } finally {
    finishGenerationJob(jobId);
  }
}
