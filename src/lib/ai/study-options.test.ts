import { describe, expect, it } from "vitest";
import { clamp, truncateText } from "./study-options";

describe("clamp", () => {
  it("passes values already in range through unchanged", () => {
    expect(clamp(5, 3, 20)).toBe(5);
  });

  it("floors below the minimum", () => {
    expect(clamp(1, 3, 20)).toBe(3);
  });

  it("ceils above the maximum", () => {
    expect(clamp(50, 3, 20)).toBe(20);
  });

  it("rounds fractional input", () => {
    expect(clamp(7.6, 3, 20)).toBe(8);
  });
});

describe("truncateText", () => {
  it("leaves text within the limit exactly as it was", () => {
    expect(truncateText("short", 20)).toBe("short");
    expect(truncateText("exactly-ten", 11)).toBe("exactly-ten");
  });

  it("cuts on a word boundary when one is near the limit", () => {
    const out = truncateText("the quick brown fox jumps over", 20);
    expect(out.endsWith("…")).toBe(true);
    // Should not end mid-word.
    expect(out.slice(0, -1).trimEnd()).toBe("the quick brown fox");
  });

  it("still cuts when the limit lands inside a very long word", () => {
    const out = truncateText("supercalifragilisticexpialidocious", 10);
    expect(out).toBe("supercalif…");
  });

  it("never returns more than the limit plus the ellipsis", () => {
    for (const n of [1, 5, 40, 200]) {
      const out = truncateText("a ".repeat(500), n);
      expect(out.length).toBeLessThanOrEqual(n + 1);
    }
  });
});
