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
const MAX_ROUNDS = Math.ceil(QUIZ_COUNT_RANGE.max / QUIZ_BATCH) + 2;

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

    for (let round = 0; !done && round < MAX_ROUNDS; round += 1) {
      const next = await continueQuizAction(id);
      // Keep what already landed. The quiz exists and is takeable from the
      // first batch on, so a failed or empty later batch means a shorter quiz
      // — never a lost one. This is the whole reason for batching.
      if (!next.ok || next.count <= count) break;
      count = next.count;
      done = next.done;
      report();
    }

    return { ok: true, id, count, total, xp };
  } finally {
    finishGenerationJob(jobId);
  }
}
