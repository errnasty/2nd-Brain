import { describe, expect, it } from "vitest";
import { TRENDING_DAY_HOURS, isWithinTrendingDay, trendingDayStart } from "./day";

const HOUR_MS = 60 * 60 * 1000;

/** A `now` deliberately off the hour, so snapping is observable. */
const NOW = new Date("2026-08-04T14:37:19.482Z");

describe("trendingDayStart", () => {
  it("starts a day back, floored to the hour", () => {
    expect(trendingDayStart(NOW).toISOString()).toBe("2026-08-03T14:00:00.000Z");
  });

  it("never covers less than the nominal day", () => {
    const span = NOW.getTime() - trendingDayStart(NOW).getTime();
    expect(span).toBeGreaterThanOrEqual(TRENDING_DAY_HOURS * HOUR_MS);
    expect(span).toBeLessThan((TRENDING_DAY_HOURS + 1) * HOUR_MS);
  });

  it("holds still between hour boundaries", () => {
    // The brief hashes the article set inside this window to detect drift, so a
    // boundary that moved with every call would invalidate a half-generated
    // brief for no reason.
    const early = new Date("2026-08-04T14:00:00.000Z");
    const late = new Date("2026-08-04T14:59:59.999Z");
    expect(trendingDayStart(early).getTime()).toBe(trendingDayStart(late).getTime());
    expect(trendingDayStart(new Date("2026-08-04T15:00:00.000Z")).getTime()).toBe(
      trendingDayStart(early).getTime() + HOUR_MS,
    );
  });
});

describe("isWithinTrendingDay", () => {
  it("keeps today's articles and drops yesterday's", () => {
    expect(isWithinTrendingDay(new Date(NOW.getTime() - 2 * HOUR_MS), NOW)).toBe(true);
    expect(isWithinTrendingDay(new Date(NOW.getTime() - 30 * HOUR_MS), NOW)).toBe(false);
  });

  it("includes the boundary itself", () => {
    expect(isWithinTrendingDay(trendingDayStart(NOW), NOW)).toBe(true);
    expect(isWithinTrendingDay(new Date(trendingDayStart(NOW).getTime() - 1), NOW)).toBe(false);
  });

  it("still holds inside the clustering window, which is wider", () => {
    // The pass reads 48 hours so a story keeps the corroboration it earned
    // overnight — but those older tellings are not today's trending articles.
    expect(isWithinTrendingDay(new Date(NOW.getTime() - 40 * HOUR_MS), NOW)).toBe(false);
  });

  it("treats a missing or unparseable date as outside the day", () => {
    expect(isWithinTrendingDay(null, NOW)).toBe(false);
    expect(isWithinTrendingDay(undefined, NOW)).toBe(false);
    expect(isWithinTrendingDay(new Date("nonsense"), NOW)).toBe(false);
  });
});
