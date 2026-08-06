import { describe, expect, it } from "vitest";
import { lastResolvedIndex, resolveVirtualRows } from "./virtual-rows";

const row = (index: number) => ({ index, start: index * 10, size: 10 });

describe("resolveVirtualRows", () => {
  it("pairs each row with the item it points at", () => {
    const items = ["a", "b", "c"];
    const resolved = resolveVirtualRows([row(0), row(1), row(2)], items);
    expect(resolved.map((r) => r.item)).toEqual(["a", "b", "c"]);
    expect(resolved.map((r) => r.row.index)).toEqual([0, 1, 2]);
  });

  it("drops rows pointing past the end of a list that just shrank", () => {
    // The crash: the virtualizer's geometry is briefly ahead of the data after
    // rows are hidden (a pending delete, a filter change, story grouping), and
    // it indexes into its measurements without a bounds check.
    const resolved = resolveVirtualRows([row(0), row(1), row(2)], ["a"]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].item).toBe("a");
  });

  it("drops undefined rows, which the library can genuinely produce", () => {
    const resolved = resolveVirtualRows([row(0), undefined, row(1)], ["a", "b"]);
    expect(resolved.map((r) => r.item)).toEqual(["a", "b"]);
  });

  it("keeps a falsy item — absent is not the same as empty", () => {
    const resolved = resolveVirtualRows([row(0), row(1)], ["", 0] as unknown[]);
    expect(resolved).toHaveLength(2);
  });

  it("is empty when there is nothing to show", () => {
    expect(resolveVirtualRows([], ["a"])).toEqual([]);
    expect(resolveVirtualRows([row(0)], [])).toEqual([]);
  });
});

describe("lastResolvedIndex", () => {
  it("reports the furthest row actually rendered", () => {
    expect(lastResolvedIndex(resolveVirtualRows([row(3), row(4)], Array(5).fill("x")))).toBe(4);
  });

  it("reports -1 for nothing on screen", () => {
    // Not 0: an infinite-scroll check of the form `last >= count - 5` would
    // otherwise fire against a list that hasn't rendered a row yet.
    expect(lastResolvedIndex([])).toBe(-1);
    expect(lastResolvedIndex(resolveVirtualRows([row(0)], []))).toBe(-1);
  });
});
