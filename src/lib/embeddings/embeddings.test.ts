import { describe, expect, it } from "vitest";
import { clampForEmbedding, toVectorLiteral } from "./index";

describe("toVectorLiteral", () => {
  it("formats a number array as a pgvector literal", () => {
    expect(toVectorLiteral([0.1, 0.2, 0.3])).toBe("[0.1,0.2,0.3]");
  });
  it("handles an empty vector", () => {
    expect(toVectorLiteral([])).toBe("[]");
  });
});

describe("clampForEmbedding", () => {
  it("returns short text unchanged", () => {
    expect(clampForEmbedding("hello")).toBe("hello");
  });
  it("truncates to the max char budget", () => {
    const long = "a".repeat(10_000);
    expect(clampForEmbedding(long, 8000).length).toBe(8000);
  });
  it("handles empty input", () => {
    expect(clampForEmbedding("")).toBe("");
  });
});
