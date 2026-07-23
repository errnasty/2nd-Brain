import { beforeEach, describe, expect, it } from "vitest";

function installLocalStorageMock() {
  const store = new Map<string, string>();
  const mock = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  (globalThis as unknown as { window: unknown }).window = globalThis;
  (globalThis as unknown as { localStorage: unknown }).localStorage = mock;
}

describe("smart-views", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  it("starts empty", async () => {
    const { getSmartViews } = await import("./smart-views");
    expect(getSmartViews()).toEqual([]);
  });

  it("saveSmartView appends a view with a generated id", async () => {
    const { saveSmartView, getSmartViews } = await import("./smart-views");
    const after = saveSmartView("Unread AI papers", ["tag-1", "tag-2"]);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ name: "Unread AI papers", tagIds: ["tag-1", "tag-2"] });
    expect(typeof after[0].id).toBe("string");
    expect(getSmartViews()).toHaveLength(1);
  });

  it("deleteSmartView removes only the matching view", async () => {
    const { saveSmartView, deleteSmartView } = await import("./smart-views");
    saveSmartView("A", ["t1"]);
    const [, b] = saveSmartView("B", ["t2"]);
    const after = deleteSmartView(b.id);
    expect(after).toHaveLength(1);
    expect(after[0].name).toBe("A");
  });
});
