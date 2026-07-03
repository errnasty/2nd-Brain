import { describe, expect, it } from "vitest";
import {
  FSRS_WEIGHTS,
  LEECH_LAPSES,
  MAX_INTERVAL_DAYS,
  initDifficulty,
  initStability,
  nextIntervalDays,
  qualityToRating,
  retrievability,
  scheduleFsrs,
  seedFromSm2,
  type FsrsRating,
} from "./fsrs";

const NOW = new Date("2026-07-03T12:00:00Z");
const DAY_MS = 86_400_000;

describe("retrievability", () => {
  it("is 1 at t=0 and decays monotonically", () => {
    expect(retrievability(0, 10)).toBe(1);
    expect(retrievability(5, 10)).toBeGreaterThan(retrievability(10, 10));
    expect(retrievability(10, 10)).toBeGreaterThan(retrievability(100, 10));
  });

  it("hits the 90% target exactly when elapsed = stability", () => {
    for (const s of [0.5, 3, 30, 200]) {
      expect(retrievability(s, s)).toBeCloseTo(0.9, 5);
    }
  });
});

describe("nextIntervalDays", () => {
  it("interval ≈ stability at 90% request retention", () => {
    expect(nextIntervalDays(10)).toBe(10);
    expect(nextIntervalDays(37)).toBe(37);
  });

  it("floors at 1 day and caps at MAX_INTERVAL_DAYS", () => {
    expect(nextIntervalDays(0.1)).toBe(1);
    expect(nextIntervalDays(10_000)).toBe(MAX_INTERVAL_DAYS);
  });
});

describe("first review (no prior state)", () => {
  it("uses the per-rating initial stability weights", () => {
    for (const rating of [1, 2, 3, 4] as FsrsRating[]) {
      expect(initStability(rating)).toBeCloseTo(FSRS_WEIGHTS[rating - 1], 5);
    }
  });

  it("harder first answers → higher difficulty", () => {
    expect(initDifficulty(1)).toBeGreaterThan(initDifficulty(2));
    expect(initDifficulty(2)).toBeGreaterThan(initDifficulty(3));
    expect(initDifficulty(3)).toBeGreaterThan(initDifficulty(4));
  });

  it("difficulty stays within 1..10", () => {
    for (const rating of [1, 2, 3, 4] as FsrsRating[]) {
      const d = initDifficulty(rating);
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(10);
    }
  });

  it("Again on a brand-new card comes back tomorrow", () => {
    const r = scheduleFsrs(null, 1, 0, NOW);
    expect(r.lapsed).toBe(true);
    expect(r.intervalDays).toBe(1);
    expect(r.dueDate.getTime()).toBe(NOW.getTime() + DAY_MS);
  });
});

describe("repeat reviews", () => {
  const state = { stability: 10, difficulty: 5 };

  it("Easy grows stability more than Good, Good more than Hard", () => {
    const hard = scheduleFsrs(state, 2, 10, NOW);
    const good = scheduleFsrs(state, 3, 10, NOW);
    const easy = scheduleFsrs(state, 4, 10, NOW);
    expect(easy.stability).toBeGreaterThan(good.stability);
    expect(good.stability).toBeGreaterThan(hard.stability);
    expect(hard.stability).toBeGreaterThan(state.stability); // even Hard is a success
    expect(easy.intervalDays).toBeGreaterThan(good.intervalDays);
  });

  it("a lapse reduces stability and reschedules for tomorrow", () => {
    const r = scheduleFsrs(state, 1, 10, NOW);
    expect(r.lapsed).toBe(true);
    expect(r.stability).toBeLessThan(state.stability);
    expect(r.stability).toBeGreaterThan(0);
    expect(r.intervalDays).toBe(1);
  });

  it("failing makes the card more difficult; easy makes it less", () => {
    const failed = scheduleFsrs(state, 1, 10, NOW);
    const easy = scheduleFsrs(state, 4, 10, NOW);
    expect(failed.difficulty).toBeGreaterThan(state.difficulty);
    expect(easy.difficulty).toBeLessThan(state.difficulty);
  });

  it("overdue success (low retrievability) grows stability more than an early review", () => {
    const early = scheduleFsrs(state, 3, 1, NOW); // reviewed after 1 of 10 days
    const overdue = scheduleFsrs(state, 3, 30, NOW); // reviewed 3x late
    expect(overdue.stability).toBeGreaterThan(early.stability);
  });

  it("difficulty is always clamped to 1..10", () => {
    let s = { stability: 1, difficulty: 10 };
    for (let i = 0; i < 20; i++) {
      const r = scheduleFsrs(s, 1, 1, NOW);
      s = { stability: r.stability, difficulty: r.difficulty };
      expect(s.difficulty).toBeLessThanOrEqual(10);
      expect(s.difficulty).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("SM-2 back-compat", () => {
  it("maps the legacy 0-5 quality API onto four FSRS ratings", () => {
    expect(qualityToRating(0)).toBe(1);
    expect(qualityToRating(1)).toBe(1); // UI "Again"
    expect(qualityToRating(2)).toBe(1);
    expect(qualityToRating(3)).toBe(2); // UI "Hard"
    expect(qualityToRating(4)).toBe(3); // UI "Good"
    expect(qualityToRating(5)).toBe(4); // UI "Easy"
  });

  it("seeds sensible FSRS state from SM-2 fields", () => {
    const fresh = seedFromSm2(2.5, 0);
    expect(fresh.stability).toBeGreaterThan(0);
    expect(fresh.difficulty).toBeGreaterThanOrEqual(1);
    expect(fresh.difficulty).toBeLessThanOrEqual(10);

    // A struggling card (ease at the 1.3 floor) seeds harder than a default one.
    expect(seedFromSm2(1.3, 5).difficulty).toBeGreaterThan(seedFromSm2(2.5, 5).difficulty);
    // A mature card keeps its earned interval as stability.
    expect(seedFromSm2(2.5, 40).stability).toBe(40);
  });
});

describe("leech threshold", () => {
  it("is a small positive integer", () => {
    expect(LEECH_LAPSES).toBeGreaterThanOrEqual(3);
    expect(Number.isInteger(LEECH_LAPSES)).toBe(true);
  });
});
