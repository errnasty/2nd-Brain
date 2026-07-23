import { describe, expect, it } from "vitest";
import { applyRanking, unionByItem } from "./rerank";
import type { RagSource } from "@/lib/ai/rag";

function src(id: string, sim: number): RagSource {
  return {
    directoryItemId: id,
    title: id,
    kind: "user_note",
    snippet: "",
    similarity: sim,
    sourceKind: "note",
  };
}

describe("unionByItem", () => {
  it("dedupes by item id, keeping the highest similarity", () => {
    const a = [src("x", 0.4), src("y", 0.9)];
    const b = [src("x", 0.7), src("z", 0.5)];
    const out = unionByItem([a, b]);
    expect(out.map((s) => s.directoryItemId)).toEqual(["y", "x", "z"]);
    expect(out.find((s) => s.directoryItemId === "x")!.similarity).toBe(0.7);
  });

  it("returns sorted-by-similarity descending", () => {
    const out = unionByItem([[src("a", 0.1), src("b", 0.8), src("c", 0.5)]]);
    expect(out.map((s) => s.similarity)).toEqual([0.8, 0.5, 0.1]);
  });
});

describe("applyRanking", () => {
  const cands = [src("0", 0.5), src("1", 0.5), src("2", 0.5), src("3", 0.5)];

  it("reorders by the model's index order and truncates to keep", () => {
    const out = applyRanking(cands, [2, 0], 2);
    expect(out.map((s) => s.directoryItemId)).toEqual(["2", "0"]);
  });

  it("appends candidates the model dropped, in original order", () => {
    const out = applyRanking(cands, [3], 4);
    expect(out.map((s) => s.directoryItemId)).toEqual(["3", "0", "1", "2"]);
  });

  it("ignores out-of-range and duplicate indexes", () => {
    const out = applyRanking(cands, [9, 1, 1, -2, 0], 4);
    expect(out.map((s) => s.directoryItemId)).toEqual(["1", "0", "2", "3"]);
  });
});
