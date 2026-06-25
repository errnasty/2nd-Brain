import { describe, expect, it } from "vitest";
import { cardGradeXp, streakMultiplier, withStreak, XP_RULES, SOURCE_LABEL, SOURCE_COUNTER } from "./rules";

describe("cardGradeXp", () => {
  it("scales 4..16 with quality, clamped", () => {
    expect(cardGradeXp(0)).toBe(4);
    expect(cardGradeXp(5)).toBe(14);
    expect(cardGradeXp(-3)).toBe(4);
    expect(cardGradeXp(99)).toBe(14);
  });
});

describe("streakMultiplier", () => {
  it("is 1.0 at 0 days and caps at +35% by 7 days", () => {
    expect(streakMultiplier(0)).toBeCloseTo(1.0);
    expect(streakMultiplier(3)).toBeCloseTo(1.15);
    expect(streakMultiplier(7)).toBeCloseTo(1.35);
    expect(streakMultiplier(100)).toBeCloseTo(1.35);
    expect(streakMultiplier(-5)).toBeCloseTo(1.0);
  });
  it("withStreak rounds the boosted amount", () => {
    expect(withStreak(15, 0)).toBe(15);
    expect(withStreak(15, 7)).toBe(20); // 15 * 1.35 = 20.25 → 20
  });
});

describe("rules tables are complete + consistent", () => {
  it("every source has a positive base, a label and a counter entry", () => {
    for (const key of Object.keys(XP_RULES) as (keyof typeof XP_RULES)[]) {
      expect(XP_RULES[key]).toBeGreaterThan(0);
      expect(SOURCE_LABEL[key]).toBeTruthy();
      expect(key in SOURCE_COUNTER).toBe(true);
    }
  });
});
