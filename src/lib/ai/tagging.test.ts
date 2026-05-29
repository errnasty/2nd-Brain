import { describe, expect, it } from "vitest";
import { tagSlug } from "./tagging";

describe("tagSlug", () => {
  it("lowercases and hyphenates", () => {
    expect(tagSlug("Machine Learning")).toBe("machine-learning");
  });
  it("collapses non-alphanumerics", () => {
    expect(tagSlug("AI / Safety!!")).toBe("ai-safety");
  });
  it("trims leading/trailing separators", () => {
    expect(tagSlug("  #hello  ")).toBe("hello");
  });
  it("returns empty for symbol-only input", () => {
    expect(tagSlug("!!!")).toBe("");
  });
});
