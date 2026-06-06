import { describe, it, expect } from "vitest";
import { computeStreak, dayKey } from "./streak";
import { buildMonthGrid, localKey } from "./calendar";

const D = (s: string) => new Date(`${s}T12:00:00Z`);

describe("computeStreak", () => {
  it("returns 0 with no activity", () => {
    expect(computeStreak([], D("2026-06-06"))).toBe(0);
  });

  it("counts consecutive days including today", () => {
    const days = ["2026-06-06", "2026-06-05", "2026-06-04"];
    expect(computeStreak(days, D("2026-06-06"))).toBe(3);
  });

  it("continues through yesterday when today is empty", () => {
    const days = ["2026-06-05", "2026-06-04"];
    expect(computeStreak(days, D("2026-06-06"))).toBe(2);
  });

  it("breaks on a gap", () => {
    const days = ["2026-06-06", "2026-06-04", "2026-06-03"];
    expect(computeStreak(days, D("2026-06-06"))).toBe(1);
  });

  it("resets if neither today nor yesterday active", () => {
    expect(computeStreak(["2026-06-01"], D("2026-06-06"))).toBe(0);
  });

  it("dayKey is UTC YYYY-MM-DD", () => {
    expect(dayKey(D("2026-06-06"))).toBe("2026-06-06");
  });
});

describe("buildMonthGrid", () => {
  it("is 6 weeks of 7 days", () => {
    const g = buildMonthGrid(2026, 5, D("2026-06-06"));
    expect(g).toHaveLength(6);
    expect(g.every((w) => w.length === 7)).toBe(true);
  });

  it("starts on a Sunday and contains the 1st in-month", () => {
    const g = buildMonthGrid(2026, 5, D("2026-06-06"));
    expect(g[0][0].date.getDay()).toBe(0);
    const flat = g.flat();
    const first = flat.find((d) => d.inMonth && d.date.getDate() === 1)!;
    expect(first.inMonth).toBe(true);
  });

  it("marks today", () => {
    const g = buildMonthGrid(2026, 5, D("2026-06-06"));
    const today = g.flat().find((d) => d.isToday);
    expect(today?.key).toBe(localKey(D("2026-06-06")));
  });
});
