import { describe, expect, it } from "vitest";
import { EXTERNAL_CHIP_THRESHOLD, trendReason } from "./trend-reason";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-08-04T12:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

describe("trendReason", () => {
  it("says nothing about an ordinary article", () => {
    expect(trendReason(null)).toBeNull();
    expect(trendReason(undefined)).toBeNull();
    expect(trendReason({ sourceCount: 1, externalVolume: 0.1 })).toBeNull();
    // No cluster row at all — the trending pass hasn't run.
    expect(trendReason({})).toBeNull();
  });

  it("calls out outlets converging fast", () => {
    const r = trendReason({
      sourceCount: 9,
      firstSeen: ago(2),
      lastSeen: ago(0),
      externalVolume: 0.2,
    });
    expect(r?.kind).toBe("burst");
    expect(r?.label).toBe("9 outlets in 2h");
  });

  it("reports breadth without pretending it was fast", () => {
    const r = trendReason({
      sourceCount: 6,
      firstSeen: ago(30),
      lastSeen: ago(2),
      externalVolume: 0,
    });
    expect(r?.kind).toBe("broad");
    expect(r?.label).toBe("6 sources");
    expect(r?.detail).toContain("28h");
  });

  it("uses minutes when the whole story landed inside an hour", () => {
    const r = trendReason({ sourceCount: 4, firstSeen: ago(0.5), lastSeen: ago(0) });
    expect(r?.label).toBe("4 outlets in 30m");
  });

  it("mentions the outside world only when it is shouting", () => {
    const loud = trendReason({
      sourceCount: 4,
      firstSeen: ago(1),
      lastSeen: ago(0),
      externalVolume: EXTERNAL_CHIP_THRESHOLD,
    });
    const quiet = trendReason({
      sourceCount: 4,
      firstSeen: ago(1),
      lastSeen: ago(0),
      externalVolume: EXTERNAL_CHIP_THRESHOLD - 0.01,
    });
    expect(loud?.detail).toContain("wider news world");
    expect(quiet?.detail).not.toContain("wider news world");
  });

  it("flags a blind spot one feed carried but the world is loud about", () => {
    const r = trendReason({ sourceCount: 1, externalVolume: 0.8 });
    expect(r?.kind).toBe("external");
    expect(r?.label).toBe("big elsewhere");
  });

  it("survives missing or unparseable timestamps", () => {
    const r = trendReason({ sourceCount: 3, firstSeen: "not a date", lastSeen: null });
    expect(r?.kind).toBe("broad");
    expect(r?.label).toBe("3 sources");
    expect(r?.detail).not.toContain("over");
  });

  it("accepts the ISO strings a server component serializes", () => {
    const r = trendReason({
      sourceCount: 5,
      firstSeen: ago(1).toISOString(),
      lastSeen: ago(0).toISOString(),
    });
    expect(r?.label).toBe("5 outlets in 1h");
  });
});
