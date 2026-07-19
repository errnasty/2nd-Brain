import { describe, expect, it } from "vitest";
import { DAILY_CARDS, unlockedCardCount } from "./pacing";

describe("unlockedCardCount", () => {
  const day0 = new Date("2026-07-19T10:00:00Z");

  it("unlocks the first day's allowance on creation day", () => {
    expect(unlockedCardCount(day0, 16, day0)).toBe(DAILY_CARDS);
  });

  it("unlocks one allowance per elapsed UTC day", () => {
    const day2 = new Date("2026-07-21T01:00:00Z");
    expect(unlockedCardCount(day0, 16, day2)).toBe(DAILY_CARDS * 3);
  });

  it("crosses the UTC day boundary, not a 24h window", () => {
    const lateDay0 = new Date("2026-07-19T23:50:00Z");
    const earlyDay1 = new Date("2026-07-20T00:10:00Z");
    expect(unlockedCardCount(lateDay0, 16, earlyDay1)).toBe(DAILY_CARDS * 2);
  });

  it("never exceeds the deck size", () => {
    const muchLater = new Date("2026-08-19T00:00:00Z");
    expect(unlockedCardCount(day0, 8, muchLater)).toBe(8);
  });

  it("treats a clock skewed before creation as day zero", () => {
    const before = new Date("2026-07-18T00:00:00Z");
    expect(unlockedCardCount(day0, 16, before)).toBe(DAILY_CARDS);
  });
});
