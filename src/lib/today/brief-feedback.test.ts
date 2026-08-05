import { describe, expect, it } from "vitest";
import {
  FEEDBACK_WINDOW_DAYS,
  MAX_DESK_WEIGHT,
  deskWeights,
  verdictWeight,
  type FeedbackRow,
} from "./brief-feedback";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-04T09:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

const row = (
  topicId: string | null,
  verdict: "more" | "less",
  ageDays = 0,
): FeedbackRow => ({ topicId, verdict, createdAt: daysAgo(ageDays) });

describe("verdictWeight", () => {
  it("is full strength when just given, and signed by the verdict", () => {
    expect(verdictWeight(row("ai", "more"), NOW)).toBeCloseTo(1);
    expect(verdictWeight(row("ai", "less"), NOW)).toBeCloseTo(-1);
  });

  it("fades over the window", () => {
    const fresh = verdictWeight(row("ai", "more", 1), NOW);
    const older = verdictWeight(row("ai", "more", 20), NOW);
    expect(older).toBeLessThan(fresh);
    expect(older).toBeGreaterThan(0);
  });

  it("counts for nothing once it is out of the window", () => {
    expect(verdictWeight(row("ai", "less", FEEDBACK_WINDOW_DAYS), NOW)).toBe(0);
    expect(verdictWeight(row("ai", "less", FEEDBACK_WINDOW_DAYS + 10), NOW)).toBe(0);
  });

  it("treats a clock-skewed future row as freshly given", () => {
    expect(verdictWeight({ ...row("ai", "more"), createdAt: daysAgo(-1) }, NOW)).toBe(1);
  });
});

describe("deskWeights", () => {
  it("pushes a desk up or down by what was said about it", () => {
    const w = deskWeights([row("ai", "more"), row("markets", "less")], NOW);
    expect(w.ai).toBeGreaterThan(0);
    expect(w.markets).toBeLessThan(0);
  });

  it("lets a change of mind outweigh an older verdict", () => {
    const w = deskWeights([row("ai", "less", 25), row("ai", "more", 0)], NOW);
    expect(w.ai).toBeGreaterThan(0);
  });

  it("cancels out to nothing when the reader is evenly split", () => {
    expect(deskWeights([row("ai", "more"), row("ai", "less")], NOW).ai).toBeUndefined();
  });

  it("never lets one desk run away with the ranking", () => {
    const many = Array.from({ length: 20 }, () => row("ai", "more"));
    expect(deskWeights(many, NOW).ai).toBe(MAX_DESK_WEIGHT);
    const hated = Array.from({ length: 20 }, () => row("ai", "less"));
    expect(deskWeights(hated, NOW).ai).toBe(-MAX_DESK_WEIGHT);
  });

  it("ignores verdicts on the lead, which belongs to no single desk", () => {
    expect(deskWeights([row(null, "less")], NOW)).toEqual({});
  });

  it("is empty for a reader who has never rated anything", () => {
    expect(deskWeights([], NOW)).toEqual({});
  });
});
