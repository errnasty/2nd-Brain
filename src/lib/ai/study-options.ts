// Shared defaults/ranges for the user-configurable flashcard/quiz generation
// options (Settings → Flashcards & Quiz). One source of truth so the AI
// generators' schema bounds, the server actions reading user_settings, and
// the Settings UI's steppers never drift out of sync with each other.

export type StudyDifficulty = "easy" | "medium" | "hard";

export const DEFAULT_STUDY_DIFFICULTY: StudyDifficulty = "medium";
export const DEFAULT_FLASHCARD_COUNT = 5;
export const DEFAULT_QUIZ_COUNT = 8;

export const FLASHCARD_COUNT_RANGE = { min: 3, max: 20 } as const;
export const QUIZ_COUNT_RANGE = { min: 4, max: 20 } as const;

/**
 * Questions requested per model call.
 *
 * Lives here rather than in `ai/quiz.ts` because the CLIENT needs it — the
 * quiz build loop runs in the browser (see components/study/build-quiz.ts) and
 * sizes its round limit from it. Importing it from `ai/quiz.ts` pulled that
 * module's `user-model` → `auth` chain into the client bundle and failed the
 * production build. This module is plain data with no imports, so it is safe
 * on both sides.
 */
export const QUIZ_BATCH = 4;

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Cut generated text to a length, preferring a word boundary.
 *
 * This exists because length limits belong in NORMALIZATION, not in the
 * generation schema. A `z.string().max(400)` on a model's explanation does not
 * shorten anything — it fails validation, which throws away the entire object
 * (every question in the batch, not just the long field) and drops to a slower
 * fallback path. Over-long output is the cheapest failure there is to recover
 * from; it should never cost more than the characters past the limit.
 */
export function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  // Only honour a word boundary in the last quarter, or a limit that lands
  // mid-first-word would leave almost nothing.
  return (lastSpace > max * 0.75 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}
