import { beforeEach, describe, expect, it } from "vitest";

// vitest.config.ts runs tests under environment: "node", so there's no
// window/localStorage global by default — install a minimal in-memory mock
// so this module's `typeof window === "undefined"` guard takes the real path.
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

describe("recently-viewed", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  it("starts empty", async () => {
    const { getRecent } = await import("./recently-viewed");
    expect(getRecent()).toEqual([]);
  });

  it("pushRecent adds to the front and returns the updated list", async () => {
    const { pushRecent, getRecent } = await import("./recently-viewed");
    pushRecent({ id: "f1", kind: "folder", title: "Books" });
    const after = pushRecent({ id: "i1", kind: "item", title: "My note" });
    expect(after[0]).toMatchObject({ id: "i1", kind: "item", title: "My note" });
    expect(after[1]).toMatchObject({ id: "f1", kind: "folder", title: "Books" });
    expect(getRecent()).toHaveLength(2);
  });

  it("de-dupes by (id, kind) and moves the entry to the front", async () => {
    const { pushRecent } = await import("./recently-viewed");
    pushRecent({ id: "f1", kind: "folder", title: "Books" });
    pushRecent({ id: "f2", kind: "folder", title: "Investing" });
    const after = pushRecent({ id: "f1", kind: "folder", title: "Books (renamed)" });
    expect(after).toHaveLength(2);
    expect(after[0]).toMatchObject({ id: "f1", title: "Books (renamed)" });
  });

  it("caps the list at 6 entries", async () => {
    const { pushRecent } = await import("./recently-viewed");
    for (let i = 0; i < 10; i++) pushRecent({ id: `f${i}`, kind: "folder", title: `Folder ${i}` });
    const after = pushRecent({ id: "final", kind: "folder", title: "Final" });
    expect(after).toHaveLength(6);
    expect(after[0].id).toBe("final");
  });
});
