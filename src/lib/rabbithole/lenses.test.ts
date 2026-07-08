import { describe, expect, it } from "vitest";
import { collectSubtreeIds, extractNodeTitle, getLens } from "./lenses";

describe("getLens", () => {
  it("resolves a known lens key", () => {
    expect(getLens("eli5")?.label).toBe("ELI5");
  });
  it("returns null for unknown / missing keys", () => {
    expect(getLens("socratic")).toBeNull();
    expect(getLens(null)).toBeNull();
    expect(getLens(undefined)).toBeNull();
  });
});

describe("extractNodeTitle", () => {
  it("uses the first ATX heading", () => {
    expect(extractNodeTitle("# Quantum Tunneling\n\nBody…", "fallback")).toBe(
      "Quantum Tunneling",
    );
  });
  it("skips leading blank lines and strips markdown emphasis", () => {
    expect(extractNodeTitle("\n\n## **Bold** _title_\ntext", "fb")).toBe("Bold title");
  });
  it("falls back to the first non-empty line when there is no heading", () => {
    expect(extractNodeTitle("Plain opener sentence.\nMore.", "fb")).toBe(
      "Plain opener sentence.",
    );
  });
  it("clamps long titles to 80 chars", () => {
    const title = extractNodeTitle(`# ${"x".repeat(200)}`, "fb");
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith("…")).toBe(true);
  });
  it("uses the fallback for empty content", () => {
    expect(extractNodeTitle("", "What is entropy?")).toBe("What is entropy?");
    expect(extractNodeTitle("   \n  ", "")).toBe("Untitled branch");
  });
});

describe("collectSubtreeIds", () => {
  const nodes = [
    { id: "a", parentId: null },
    { id: "b", parentId: "a" },
    { id: "c", parentId: "b" },
    { id: "d", parentId: null },
  ];
  it("collects the node and all descendants", () => {
    expect(collectSubtreeIds(nodes, "a").sort()).toEqual(["a", "b", "c"]);
  });
  it("a leaf collects only itself", () => {
    expect(collectSubtreeIds(nodes, "c")).toEqual(["c"]);
  });
  it("does not cross into unrelated roots", () => {
    expect(collectSubtreeIds(nodes, "d")).toEqual(["d"]);
  });
  it("survives a parent cycle without hanging", () => {
    const cyclic = [
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
    ];
    expect(collectSubtreeIds(cyclic, "a").sort()).toEqual(["a", "b"]);
  });
});
