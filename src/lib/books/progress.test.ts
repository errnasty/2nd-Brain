import { describe, expect, it } from "vitest";
import {
  advanceFurthest,
  charTotals,
  clampAnchor,
  createProgressCalculator,
  progressFor,
} from "./progress";

const book = [
  { idx: 0, charCount: 100 },
  { idx: 1, charCount: 300 },
  { idx: 2, charCount: 600 },
];

describe("charTotals", () => {
  it("sums the book and the run-up to each chapter", () => {
    expect(charTotals(book)).toEqual({ total: 1000, before: [0, 100, 400] });
  });

  it("does not care what order the chapters arrive in", () => {
    expect(charTotals([...book].reverse())).toEqual({ total: 1000, before: [0, 100, 400] });
  });

  it("ignores a negative count rather than shrinking the book", () => {
    expect(charTotals([{ idx: 0, charCount: -50 }, { idx: 1, charCount: 100 }]).total).toBe(100);
  });
});

describe("progressFor", () => {
  it("measures from the start of the book, not the chapter", () => {
    expect(progressFor(book, { chapterIdx: 1, charOffset: 150 })).toBeCloseTo(0.25);
    expect(progressFor(book, { chapterIdx: 0, charOffset: 0 })).toBe(0);
    expect(progressFor(book, { chapterIdx: 2, charOffset: 600 })).toBe(1);
  });

  it("never exceeds 1 when an offset overshoots the stored count", () => {
    // The server's char count is an estimate of what the browser renders, so a
    // real offset can legitimately run past it.
    expect(progressFor(book, { chapterIdx: 2, charOffset: 99999 })).toBe(1);
  });

  it("returns 0 for an empty book instead of dividing by zero", () => {
    expect(progressFor([], { chapterIdx: 0, charOffset: 0 })).toBe(0);
    expect(progressFor([{ idx: 0, charCount: 0 }], { chapterIdx: 0, charOffset: 5 })).toBe(0);
  });

  it("treats a negative offset as the start", () => {
    expect(progressFor(book, { chapterIdx: 1, charOffset: -20 })).toBeCloseTo(0.1);
  });
});

describe("clampAnchor", () => {
  it("leaves a valid anchor alone", () => {
    expect(clampAnchor(book, { chapterIdx: 1, charOffset: 42 })).toEqual({
      chapterIdx: 1,
      charOffset: 42,
    });
  });

  it("pulls an offset back inside its chapter", () => {
    expect(clampAnchor(book, { chapterIdx: 0, charOffset: 5000 })).toEqual({
      chapterIdx: 0,
      charOffset: 100,
    });
  });

  it("falls back to an earlier chapter when the saved one is gone", () => {
    // A re-uploaded book can have a shorter spine than the position saved
    // against the previous upload.
    expect(clampAnchor(book, { chapterIdx: 9, charOffset: 10 })).toEqual({
      chapterIdx: 2,
      charOffset: 0,
    });
  });

  it("falls forward to the first chapter when nothing earlier exists", () => {
    expect(clampAnchor([{ idx: 3, charCount: 10 }], { chapterIdx: 0, charOffset: 4 })).toEqual({
      chapterIdx: 3,
      charOffset: 0,
    });
  });

  it("returns the start of an empty book", () => {
    expect(clampAnchor([], { chapterIdx: 4, charOffset: 9 })).toEqual({
      chapterIdx: 0,
      charOffset: 0,
    });
  });
});

describe("advanceFurthest", () => {
  it("only ever moves forward", () => {
    expect(advanceFurthest(5, 7)).toBe(7);
    // Re-reading chapter 2 must not re-hide chapter 9 from the spoiler clamp.
    expect(advanceFurthest(9, 2)).toBe(9);
  });
});

describe("createProgressCalculator", () => {
  it("agrees with progressFor", () => {
    const at = createProgressCalculator(book);
    for (const anchor of [
      { chapterIdx: 0, charOffset: 0 },
      { chapterIdx: 1, charOffset: 150 },
      { chapterIdx: 2, charOffset: 600 },
      { chapterIdx: 2, charOffset: 99999 },
      { chapterIdx: 1, charOffset: -20 },
    ]) {
      expect(at(anchor)).toBeCloseTo(progressFor(book, anchor));
    }
  });

  it("returns 0 for an empty book without dividing by zero", () => {
    expect(createProgressCalculator([])({ chapterIdx: 0, charOffset: 5 })).toBe(0);
    expect(createProgressCalculator([{ idx: 0, charCount: 0 }])({ chapterIdx: 0, charOffset: 5 })).toBe(0);
  });

  it("sorts once, not once per call", () => {
    // The point of the helper: the chapter table is built when the book loads
    // rather than rebuilt on every page turn.
    const chapters = [{ idx: 1, charCount: 10 }, { idx: 0, charCount: 10 }];
    const at = createProgressCalculator(chapters);
    chapters.length = 0;
    expect(at({ chapterIdx: 1, charOffset: 0 })).toBeCloseTo(0.5);
  });
});
