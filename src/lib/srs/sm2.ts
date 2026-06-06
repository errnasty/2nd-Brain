// Pure SM-2 spaced-repetition scheduler. No db / runtime deps so it's unit-
// tested and reusable in a future local build.

export type Sm2State = {
  ease: number; // ease factor, >= 1.3
  intervalDays: number; // days until next review
  repetitions: number; // consecutive successful reviews
};

export type Sm2Result = Sm2State & { dueDate: Date };

export const MIN_EASE = 1.3;
const DAY_MS = 86_400_000;

/**
 * Apply one SM-2 review. `quality` is 0–5 (0=blackout, 5=perfect). Quality < 3
 * is a lapse: repetitions reset and the card is seen again tomorrow. Ease is
 * always updated and floored at 1.3.
 */
export function scheduleSm2(state: Sm2State, quality: number, now: Date = new Date()): Sm2Result {
  const q = Math.max(0, Math.min(5, Math.round(quality)));

  // Ease update (SM-2 formula), floored.
  const ease = Math.max(MIN_EASE, state.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));

  let repetitions: number;
  let intervalDays: number;

  if (q < 3) {
    repetitions = 0;
    intervalDays = 1;
  } else {
    repetitions = state.repetitions + 1;
    if (repetitions === 1) intervalDays = 1;
    else if (repetitions === 2) intervalDays = 6;
    else intervalDays = Math.round(state.intervalDays * ease);
    if (intervalDays < 1) intervalDays = 1;
  }

  const dueDate = new Date(now.getTime() + intervalDays * DAY_MS);
  return { ease, intervalDays, repetitions, dueDate };
}

/** Starting state for a freshly created card. */
export function initialSm2(): Sm2State {
  return { ease: 2.5, intervalDays: 0, repetitions: 0 };
}

// UI grade buttons → SM-2 quality. Four-button Anki-style mapping.
export const GRADES = [
  { label: "Again", quality: 1 },
  { label: "Hard", quality: 3 },
  { label: "Good", quality: 4 },
  { label: "Easy", quality: 5 },
] as const;
