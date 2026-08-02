import { describe, expect, it } from "vitest";
import { SIGIL_SIZE, proceduralSigil, sigilGrid } from "./sigil";

const filledCount = (g: number[][]) => g.flat().filter((c) => c !== 0).length;

describe("sigilGrid", () => {
  it("is square at the declared size", () => {
    const g = sigilGrid("user-1");
    expect(g).toHaveLength(SIGIL_SIZE);
    for (const row of g) expect(row).toHaveLength(SIGIL_SIZE);
  });

  // The whole identity claim rests on this: your sigil is the same today and
  // in a year, on every device.
  it("is deterministic for a seed", () => {
    expect(sigilGrid("user-1")).toEqual(sigilGrid("user-1"));
  });

  it("differs between seeds", () => {
    expect(sigilGrid("user-1")).not.toEqual(sigilGrid("user-2"));
  });

  it("is mirrored down the middle", () => {
    for (const row of sigilGrid("mirror-check")) {
      for (let x = 0; x < SIGIL_SIZE; x++) {
        expect(row[x]).toBe(row[SIGIL_SIZE - 1 - x]);
      }
    }
  });

  it("only ever uses the three inks", () => {
    for (const cell of sigilGrid("inks").flat()) expect([0, 1, 2]).toContain(cell);
  });

  // A near-empty sigil would look broken — and being deterministic, it would
  // look broken permanently for whoever drew that seed.
  it("is never close to empty, across many seeds", () => {
    for (let i = 0; i < 300; i++) {
      expect(filledCount(sigilGrid(`seed-${i}`))).toBeGreaterThanOrEqual(SIGIL_SIZE);
    }
  });

  // …nor a solid block, which reads as a bug rather than a crest.
  it("is never completely full", () => {
    for (let i = 0; i < 300; i++) {
      expect(filledCount(sigilGrid(`seed-${i}`))).toBeLessThan(SIGIL_SIZE * SIGIL_SIZE);
    }
  });

  it("handles an empty seed without throwing", () => {
    expect(() => sigilGrid("")).not.toThrow();
    expect(sigilGrid("")).toHaveLength(SIGIL_SIZE);
  });
});

describe("proceduralSigil", () => {
  it("returns a procedural source carrying the grid", () => {
    const s = proceduralSigil("user-1");
    expect(s.kind).toBe("procedural");
    if (s.kind === "procedural") expect(s.grid).toEqual(sigilGrid("user-1"));
  });
});
