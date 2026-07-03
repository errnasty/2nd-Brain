// Pure FSRS-4.5 spaced-repetition scheduler. Like sm2.ts: no db / runtime
// deps so it's unit-tested and runs anywhere (server actions, offline client).
//
// FSRS models each card with two numbers — stability S (days until recall
// probability drops to 90%) and difficulty D (1–10) — instead of SM-2's single
// ease factor. Same retention, ~20–30% fewer reviews. Reference:
// https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm

/** Default FSRS-4.5 parameters (w0..w16), fit on the Anki 20k-user dataset. */
export const FSRS_WEIGHTS = [
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474,
  0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755,
] as const;

const W = FSRS_WEIGHTS;
const DECAY = -0.5;
const FACTOR = 19 / 81; // makes R(S, S) = 0.9 exactly
const DAY_MS = 86_400_000;

/** Target recall probability at the moment a card comes due. */
export const REQUEST_RETENTION = 0.9;
/** Ceiling so a long-lived card can never disappear for years. */
export const MAX_INTERVAL_DAYS = 365;

/** 1=Again (lapse) · 2=Hard · 3=Good · 4=Easy */
export type FsrsRating = 1 | 2 | 3 | 4;

export type FsrsState = {
  stability: number; // days; > 0
  difficulty: number; // 1..10
};

export type FsrsResult = FsrsState & {
  intervalDays: number;
  dueDate: Date;
  /** True when the review was a lapse (rating = Again). */
  lapsed: boolean;
};

function clampDifficulty(d: number): number {
  return Math.min(10, Math.max(1, d));
}

/** Probability of recall after `elapsedDays` at stability S. */
export function retrievability(elapsedDays: number, stability: number): number {
  const t = Math.max(0, elapsedDays);
  const s = Math.max(0.01, stability);
  return Math.pow(1 + (FACTOR * t) / s, DECAY);
}

/** Interval (days) at which recall probability decays to REQUEST_RETENTION. */
export function nextIntervalDays(stability: number): number {
  const raw = (stability / FACTOR) * (Math.pow(REQUEST_RETENTION, 1 / DECAY) - 1);
  return Math.min(MAX_INTERVAL_DAYS, Math.max(1, Math.round(raw)));
}

/** Initial stability for a card's very first review. */
export function initStability(rating: FsrsRating): number {
  return Math.max(0.1, W[rating - 1]);
}

/** Initial difficulty for a card's very first review (FSRS-4.5 linear form). */
export function initDifficulty(rating: FsrsRating): number {
  return clampDifficulty(W[4] - (rating - 3) * W[5]);
}

function nextDifficulty(d: number, rating: FsrsRating): number {
  const updated = d - W[6] * (rating - 3);
  // Mean-revert toward the "Easy first review" difficulty so cards don't get
  // stuck at the extremes.
  return clampDifficulty(W[7] * initDifficulty(4) + (1 - W[7]) * updated);
}

function recallStability(s: number, d: number, r: number, rating: FsrsRating): number {
  const hardPenalty = rating === 2 ? W[15] : 1;
  const easyBonus = rating === 4 ? W[16] : 1;
  return (
    s *
    (1 +
      Math.exp(W[8]) *
        (11 - d) *
        Math.pow(s, -W[9]) *
        (Math.exp(W[10] * (1 - r)) - 1) *
        hardPenalty *
        easyBonus)
  );
}

function forgetStability(s: number, d: number, r: number): number {
  const sf =
    W[11] *
    Math.pow(d, -W[12]) *
    (Math.pow(s + 1, W[13]) - 1) *
    Math.exp(W[14] * (1 - r));
  // A lapse can never leave the card more stable than it was.
  return Math.max(0.1, Math.min(sf, s));
}

/**
 * Apply one FSRS review. `state` is null for a card's first-ever review.
 * `elapsedDays` is time since the previous review (0 for first review).
 */
export function scheduleFsrs(
  state: FsrsState | null,
  rating: FsrsRating,
  elapsedDays: number,
  now: Date = new Date(),
): FsrsResult {
  let stability: number;
  let difficulty: number;

  if (!state) {
    stability = initStability(rating);
    difficulty = initDifficulty(rating);
  } else {
    const r = retrievability(elapsedDays, state.stability);
    difficulty = nextDifficulty(state.difficulty, rating);
    stability =
      rating === 1
        ? forgetStability(state.stability, state.difficulty, r)
        : recallStability(state.stability, state.difficulty, r, rating);
  }

  // A lapse comes back tomorrow regardless of its (reduced) stability — the
  // session UI additionally re-queues it for an immediate same-day retry.
  const intervalDays = rating === 1 ? 1 : nextIntervalDays(stability);
  return {
    stability,
    difficulty,
    intervalDays,
    dueDate: new Date(now.getTime() + intervalDays * DAY_MS),
    lapsed: rating === 1,
  };
}

/**
 * Map the existing 0–5 SM-2 quality API (kept for back-compat with queued
 * offline grades and the UI's GRADES constants) onto FSRS's four ratings.
 */
export function qualityToRating(quality: number): FsrsRating {
  const q = Math.max(0, Math.min(5, Math.round(quality)));
  if (q < 3) return 1; // Again
  if (q === 3) return 2; // Hard
  if (q === 4) return 3; // Good
  return 4; // Easy
}

/**
 * Seed FSRS state for a card that only has legacy SM-2 fields. Approximation:
 * stability ≈ current interval (both are "days the card survives"), difficulty
 * from ease (2.5 default → ~5, floor 1.3 → ~7.4).
 */
export function seedFromSm2(ease: number, intervalDays: number): FsrsState {
  return {
    stability: Math.max(0.5, intervalDays || 1),
    difficulty: clampDifficulty(5 + (2.5 - ease) * 2),
  };
}

/** Cards with this many lapses are "leeches" — badly formulated, eating time. */
export const LEECH_LAPSES = 4;
