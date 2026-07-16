import { describe, expect, it } from "vitest";
import { clamp } from "./study-options";

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
