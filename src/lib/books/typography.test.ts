import { describe, expect, it } from "vitest";
import {
  BOOK_TYPOGRAPHY_DEFAULT,
  LINE_HEIGHT_STEPS,
  MARGIN_STEPS,
  marginCss,
  resolveTypography,
} from "./typography";

describe("resolveTypography", () => {
  it("returns the defaults for an account that never touched the panel", () => {
    expect(resolveTypography(undefined)).toEqual(BOOK_TYPOGRAPHY_DEFAULT);
    expect(resolveTypography({})).toEqual(BOOK_TYPOGRAPHY_DEFAULT);
    expect(resolveTypography(null)).toEqual(BOOK_TYPOGRAPHY_DEFAULT);
  });

  it("keeps stored values", () => {
    expect(resolveTypography({ font: "sans", lineHeight: 1.9, margin: "wide" })).toEqual({
      font: "sans",
      lineHeight: 1.9,
      margin: "wide",
    });
  });

  // The settings blob is jsonb written by a shallow merge, so nothing upstream
  // guarantees the shape — and a bad line height renders a book as overlapping
  // lines with no way back from inside the app.
  it("falls back per field rather than wholesale", () => {
    expect(resolveTypography({ font: "comic", margin: "wide" })).toEqual({
      font: "serif",
      lineHeight: BOOK_TYPOGRAPHY_DEFAULT.lineHeight,
      margin: "wide",
    });
  });

  it("snaps an out-of-range line height to the nearest offered step", () => {
    const smallest = LINE_HEIGHT_STEPS[0].value;
    const largest = LINE_HEIGHT_STEPS[LINE_HEIGHT_STEPS.length - 1].value;
    expect(resolveTypography({ lineHeight: 0.2 }).lineHeight).toBe(smallest);
    expect(resolveTypography({ lineHeight: 99 }).lineHeight).toBe(largest);
    expect(resolveTypography({ lineHeight: 1.66 }).lineHeight).toBe(1.65);
  });

  it("ignores a line height that isn't a usable number", () => {
    expect(resolveTypography({ lineHeight: Number.NaN }).lineHeight).toBe(
      BOOK_TYPOGRAPHY_DEFAULT.lineHeight,
    );
    expect(resolveTypography({ lineHeight: "big" }).lineHeight).toBe(
      BOOK_TYPOGRAPHY_DEFAULT.lineHeight,
    );
  });
});

describe("marginCss", () => {
  it("returns the band for each setting", () => {
    for (const step of MARGIN_STEPS) {
      expect(marginCss(step.value)).toBe(step.css);
    }
  });

  // Every band has to scale with the viewport: one fixed gutter cannot be right
  // for both a phone and a desktop window.
  it("gives every setting a viewport-relative band", () => {
    for (const step of MARGIN_STEPS) {
      expect(step.css).toMatch(/^clamp\(.+vw.+\)$/);
    }
  });
});
