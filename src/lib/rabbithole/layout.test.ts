import { describe, it, expect } from "vitest";
import { layoutTree, ROOT_ID, type LayoutNode } from "./layout";

const size = { w: 320, h: 200 };
const sizes = (ids: string[]) => new Map(ids.map((id) => [id, size]));

describe("layoutTree", () => {
  it("places the synthetic root at origin and a single child to its right", () => {
    const nodes: LayoutNode[] = [{ id: "a", parentId: null }];
    const pos = layoutTree(nodes, sizes([ROOT_ID, "a"]), new Set());
    expect(pos.get(ROOT_ID)).toEqual({ x: 0, y: 0 });
    expect(pos.get("a")!.x).toBeGreaterThan(0);
    expect(pos.get("a")!.y).toBe(0);
  });

  it("stacks siblings vertically without overlap", () => {
    const nodes: LayoutNode[] = [
      { id: "a", parentId: null },
      { id: "b", parentId: null },
    ];
    const pos = layoutTree(nodes, sizes([ROOT_ID, "a", "b"]), new Set());
    expect(pos.get("a")!.x).toBe(pos.get("b")!.x);
    const gap = Math.abs(pos.get("b")!.y - pos.get("a")!.y);
    expect(gap).toBeGreaterThanOrEqual(size.h);
  });

  it("hides descendants of a collapsed node", () => {
    const nodes: LayoutNode[] = [
      { id: "a", parentId: null },
      { id: "a1", parentId: "a" },
    ];
    const pos = layoutTree(nodes, sizes([ROOT_ID, "a", "a1"]), new Set(["a"]));
    expect(pos.has("a")).toBe(true);
    expect(pos.has("a1")).toBe(false);
  });

  it("keeps the synthetic root at origin with differing card heights", () => {
    const nodes: LayoutNode[] = [
      { id: "a", parentId: null },
      { id: "b", parentId: null },
    ];
    const s = new Map([
      [ROOT_ID, { w: 320, h: 200 }],
      ["a", { w: 320, h: 100 }],
      ["b", { w: 320, h: 300 }],
    ]);
    const pos = layoutTree(nodes, s, new Set());
    expect(pos.get(ROOT_ID)).toEqual({ x: 0, y: 0 });
  });

  it("gives a parent's two subtrees non-overlapping vertical bands", () => {
    const nodes: LayoutNode[] = [
      { id: "a", parentId: null },
      { id: "b", parentId: null },
      { id: "a1", parentId: "a" },
      { id: "a2", parentId: "a" },
    ];
    const pos = layoutTree(nodes, sizes([ROOT_ID, "a", "b", "a1", "a2"]), new Set());
    expect(pos.get("b")!.y).toBeGreaterThan(pos.get("a2")!.y);
  });
});
