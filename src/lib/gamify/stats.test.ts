import { describe, expect, it } from "vitest";
import { STAT_MAX, archetype, computeStats, curve, dominantStat } from "./stats";

const stat = (counters: Record<string, number>, streak = 0) =>
  Object.fromEntries(computeStats(counters, streak).map((s) => [s.key, s.value]));

describe("curve", () => {
  it("starts at 1 for someone who has done nothing", () => {
    expect(curve(0)).toBe(1);
    expect(curve(-5)).toBe(1);
  });

  // The first few actions have to visibly move the number, or a new character
  // looks broken for a fortnight.
  it("moves early", () => {
    expect(curve(5)).toBeGreaterThan(curve(0));
    expect(curve(20)).toBeGreaterThan(curve(5));
  });

  it("never exceeds the maximum", () => {
    expect(curve(1_000_000)).toBeLessThanOrEqual(STAT_MAX);
  });

  it("is monotonic", () => {
    let prev = -1;
    for (const n of [0, 1, 5, 25, 100, 500, 2000, 10000]) {
      const v = curve(n);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  // Diminishing returns: the same absolute gain matters less the further in
  // you are, which is what stops a two-year-old account pinning every stat.
  it("has diminishing returns", () => {
    expect(curve(110) - curve(100)).toBeLessThan(curve(20) - curve(10));
  });
});

describe("computeStats", () => {
  it("gives a blank character all ones", () => {
    expect(stat({})).toEqual({ INT: 1, MEM: 1, GRT: 1, PRC: 1, CRF: 1 });
  });

  it("routes each counter to the right stat and leaves the others alone", () => {
    expect(stat({ cardsGraded: 200 }).MEM).toBeGreaterThan(1);
    expect(stat({ cardsGraded: 200 }).INT).toBe(1);
    expect(stat({ conceptsLearned: 60 }).INT).toBeGreaterThan(1);
    expect(stat({ quizzesCompleted: 20 }).PRC).toBeGreaterThan(1);
    expect(stat({ notesCreated: 30 }).CRF).toBeGreaterThan(1);
  });

  it("counts the current streak towards Grit", () => {
    expect(stat({}, 30).GRT).toBeGreaterThan(stat({}, 0).GRT);
  });

  it("ignores unknown and negative counters rather than throwing", () => {
    expect(() => computeStats({ somethingElse: 50, cardsGraded: -10 })).not.toThrow();
    expect(stat({ somethingElse: 50, cardsGraded: -10 }).MEM).toBe(1);
  });

  it("reports the raw points behind each value, so the number is auditable", () => {
    const mem = computeStats({ cardsGraded: 40 }).find((s) => s.key === "MEM");
    expect(mem?.points).toBe(40);
  });

  // Two accounts with the same XP but different habits must not look the same
  // — that difference is the entire reason the sheet exists.
  it("distinguishes a reviewer from a reader", () => {
    const reviewer = stat({ cardsGraded: 400 });
    const reader = stat({ articlesRead: 400 });
    expect(reviewer.MEM).toBeGreaterThan(reviewer.INT);
    expect(reader.INT).toBeGreaterThan(reader.MEM);
  });
});

describe("dominantStat", () => {
  it("picks the highest", () => {
    expect(dominantStat(computeStats({ cardsGraded: 500 }))?.key).toBe("MEM");
  });

  // All-equal is the state every new account starts in; it must be stable
  // rather than flickering between five tied stats on each render.
  it("breaks ties in a stable order", () => {
    expect(dominantStat(computeStats({}))?.key).toBe("INT");
  });

  it("returns null for an empty list", () => {
    expect(dominantStat([])).toBeNull();
  });
});

describe("archetype", () => {
  it("calls a character with no history a Wanderer", () => {
    expect(archetype(computeStats({}), 1)).toBe("Wanderer");
  });

  it("names the character after its strongest stat", () => {
    expect(archetype(computeStats({ cardsGraded: 300 }), 1)).toBe("Rememberer");
    expect(archetype(computeStats({ notesCreated: 100 }), 1)).toBe("Note-taker");
  });

  it("escalates the title with player level", () => {
    const s = computeStats({ conceptsLearned: 200 });
    expect(archetype(s, 1)).toBe("Reader");
    expect(archetype(s, 10)).toBe("Scholar");
    expect(archetype(s, 25)).toBe("Polymath");
  });
});
