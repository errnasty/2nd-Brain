import { describe, expect, it } from "vitest";
import {
  cardGradeXp,
  momentumMultiplier,
  momentumStep,
  streakMultiplier,
  withStreak,
  MOMENTUM_CAP,
  XP_RULES,
  SOURCE_LABEL,
  SOURCE_COUNTER,
} from "./rules";

describe("cardGradeXp", () => {
  it("scales 5..20 with quality, clamped", () => {
    expect(cardGradeXp(0)).toBe(5);
    expect(cardGradeXp(5)).toBe(20);
    expect(cardGradeXp(-3)).toBe(5);
    expect(cardGradeXp(99)).toBe(20);
  });
});

describe("streakMultiplier", () => {
  it("is 1.0 at 0 days and caps at +60% by 10 days", () => {
    expect(streakMultiplier(0)).toBeCloseTo(1.0);
    expect(streakMultiplier(3)).toBeCloseTo(1.18);
    expect(streakMultiplier(10)).toBeCloseTo(1.6);
    expect(streakMultiplier(100)).toBeCloseTo(1.6);
    expect(streakMultiplier(-5)).toBeCloseTo(1.0);
  });
  it("withStreak rounds the boosted amount", () => {
    expect(withStreak(15, 0)).toBe(15);
    expect(withStreak(15, 10)).toBe(24); // 15 * 1.6 = 24
  });
});

describe("momentum", () => {
  it("is neutral with no recent grades and caps at +50%", () => {
    expect(momentumMultiplier(0)).toBeCloseTo(1.0);
    expect(momentumMultiplier(4)).toBeCloseTo(1.2);
    expect(momentumMultiplier(MOMENTUM_CAP)).toBeCloseTo(1.5);
    expect(momentumMultiplier(999)).toBeCloseTo(1.5);
    expect(momentumMultiplier(-3)).toBeCloseTo(1.0);
  });
  it("momentumStep clamps to the cap", () => {
    expect(momentumStep(0)).toBe(0);
    expect(momentumStep(3)).toBe(3);
    expect(momentumStep(999)).toBe(MOMENTUM_CAP);
    expect(momentumStep(-1)).toBe(0);
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
