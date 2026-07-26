import { describe, expect, it } from "vitest";
import {
  cardGradeXp,
  quizXp,
  QUIZ_XP_BASE,
  QUIZ_XP_MAX,
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
  it("scales 5..15 with quality, clamped", () => {
    expect(cardGradeXp(0)).toBe(5);
    expect(cardGradeXp(5)).toBe(15);
    expect(cardGradeXp(-3)).toBe(5);
    expect(cardGradeXp(99)).toBe(15);
  });
});

describe("quizXp", () => {
  it("pays the base for a zero score and the max for a perfect one", () => {
    expect(quizXp(0, 10)).toBe(QUIZ_XP_BASE);
    expect(quizXp(10, 10)).toBe(QUIZ_XP_MAX);
  });

  it("scales in between with the proportion answered correctly", () => {
    expect(quizXp(5, 10)).toBe(31); // 12 + round(0.5 * 38)
    expect(quizXp(8, 10)).toBe(42);
    expect(quizXp(2, 10)).toBe(20);
  });

  it("rewards a better score more, monotonically", () => {
    let prev = -1;
    for (let score = 0; score <= 10; score++) {
      const xp = quizXp(score, 10);
      expect(xp).toBeGreaterThan(prev);
      prev = xp;
    }
  });

  it("beats a single perfect card recall from half marks upward", () => {
    // Below half it deliberately does not: a quiz you got nothing right on
    // should not out-earn a card you actually remembered.
    expect(quizXp(4, 10)).toBeLessThan(cardGradeXp(5) * 2);
    for (let score = 5; score <= 10; score++) {
      expect(quizXp(score, 10)).toBeGreaterThan(cardGradeXp(5));
    }
  });

  it("pays several cards' worth for a perfect run", () => {
    expect(quizXp(10, 10)).toBeGreaterThan(cardGradeXp(5) * 3);
  });

  it("handles an empty or nonsense quiz without dividing by zero", () => {
    expect(quizXp(0, 0)).toBe(QUIZ_XP_BASE);
    expect(quizXp(5, 0)).toBe(QUIZ_XP_BASE);
    expect(quizXp(-2, 10)).toBe(QUIZ_XP_BASE);
    expect(quizXp(99, 10)).toBe(QUIZ_XP_MAX);
  });
});

describe("the economy stays weighted towards recall", () => {
  it("reading an article is worth less than reviewing a card", () => {
    expect(XP_RULES.article_read).toBeLessThan(cardGradeXp(0));
  });

  it("interacting with an article pays, but less than saving it", () => {
    expect(XP_RULES.article_starred).toBeGreaterThan(0);
    expect(XP_RULES.article_read_later).toBeGreaterThan(0);
    expect(XP_RULES.article_starred).toBeLessThan(XP_RULES.article_saved);
    expect(XP_RULES.article_read_later).toBeLessThan(XP_RULES.article_starred);
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
