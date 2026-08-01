import { describe, expect, it } from "vitest";
import {
  REFRESH_LADDER_DAYS,
  advanceStage,
  intervalDaysForStage,
  isDue,
  ladderSummary,
  nextRefresherAt,
} from "./refresh";

const NOW = new Date("2026-07-31T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

describe("intervalDaysForStage", () => {
  it("walks the ladder", () => {
    REFRESH_LADDER_DAYS.forEach((d, i) => expect(intervalDaysForStage(i)).toBe(d));
  });

  // A concept you keep meeting shouldn't need new intervals invented for it.
  it("clamps past the end and below zero", () => {
    const last = REFRESH_LADDER_DAYS[REFRESH_LADDER_DAYS.length - 1];
    expect(intervalDaysForStage(99)).toBe(last);
    expect(intervalDaysForStage(-5)).toBe(REFRESH_LADDER_DAYS[0]);
  });
});

describe("nextRefresherAt", () => {
  it("schedules the first refresher a day out", () => {
    expect(nextRefresherAt(0, NOW).getTime()).toBe(NOW.getTime() + DAY);
  });

  it("expands with the stage", () => {
    expect(nextRefresherAt(2, NOW).getTime()).toBeGreaterThan(nextRefresherAt(1, NOW).getTime());
  });
});

describe("advanceStage", () => {
  it("moves up one rung when remembered", () => {
    expect(advanceStage(0, "remembered")).toBe(1);
    expect(advanceStage(1, "remembered")).toBe(2);
  });

  // Stepping down one rung would keep showing a failed concept at intervals it
  // has already proven too long.
  it("resets to the start when forgotten", () => {
    expect(advanceStage(3, "forgot")).toBe(0);
    expect(advanceStage(1, "forgot")).toBe(0);
  });

  it("never exceeds the ladder", () => {
    expect(advanceStage(99, "remembered")).toBe(REFRESH_LADDER_DAYS.length - 1);
  });
});

describe("isDue", () => {
  it("is due at or before now", () => {
    expect(isDue(new Date(NOW.getTime() - 1000), NOW)).toBe(true);
    expect(isDue(NOW, NOW)).toBe(true);
    expect(isDue(new Date(NOW.getTime() + 1000), NOW)).toBe(false);
  });

  // A nudge you didn't need is a much smaller failure than a saved concept
  // that silently never comes back.
  it("treats an unreadable timestamp as due", () => {
    expect(isDue("not a date", NOW)).toBe(true);
  });
});

describe("ladderSummary", () => {
  it("reads as plain language", () => {
    expect(ladderSummary()).toBe("a day, then a week, then a month");
  });
});
