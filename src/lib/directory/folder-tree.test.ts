import { describe, expect, it } from "vitest";
import {
  buildFolderTree,
  folderPathTo,
  subtreeFolderIds,
  type TreeFolder,
} from "./folder-tree";

/** A normal tree: root → child → grandchild, plus a second root. */
function tree(): TreeFolder[] {
  return [
    { id: "root", parentId: null },
    { id: "child", parentId: "root" },
    { id: "grandchild", parentId: "child" },
    { id: "other", parentId: null },
  ];
}

/**
 * A cycle alongside a healthy tree: `a → b → c → a`, plus a normal root.
 *
 * Because a folder has exactly one parent, every member of a cycle has its
 * parent inside the cycle — so none of them can also hang off a root. That is
 * precisely why the old builder lost them: none qualified as a root, and
 * nothing rendered them.
 */
function cyclic(): TreeFolder[] {
  return [
    { id: "root", parentId: null },
    { id: "a", parentId: "c" },
    { id: "b", parentId: "a" },
    { id: "c", parentId: "b" },
  ];
}

/** The tightest cycle there is: two folders parenting each other. */
function mutual(): TreeFolder[] {
  return [
    { id: "a", parentId: "b" },
    { id: "b", parentId: "a" },
  ];
}

const ids = (nodes: { folder: TreeFolder }[]) => nodes.map((n) => n.folder.id);

describe("buildFolderTree", () => {
  it("nests children under their parents", () => {
    const roots = buildFolderTree(tree());
    expect(ids(roots)).toEqual(["root", "other"]);
    expect(ids(roots[0].children)).toEqual(["child"]);
    expect(ids(roots[0].children[0].children)).toEqual(["grandchild"]);
  });

  it("keeps an orphan visible instead of dropping it", () => {
    const roots = buildFolderTree([{ id: "lost", parentId: "deleted-folder" }]);
    expect(ids(roots)).toEqual(["lost"]);
  });

  it("terminates on a folder that is its own parent", () => {
    const roots = buildFolderTree([{ id: "self", parentId: "self" }]);
    expect(ids(roots)).toEqual(["self"]);
    expect(roots[0].children).toEqual([]);
  });

  it("terminates on two folders parenting each other, keeping both", () => {
    const roots = buildFolderTree(mutual());
    // Whichever edge closes the loop is broken; both folders stay reachable.
    expect(ids(roots).sort()).toContain("a");
    expect(roots.length).toBeGreaterThanOrEqual(1);
    const all = new Set<string>();
    const walk = (nodes: ReturnType<typeof buildFolderTree>) => {
      for (const n of nodes) {
        expect(all.has(n.folder.id)).toBe(false); // no node rendered twice
        all.add(n.folder.id);
        walk(n.children);
      }
    };
    walk(roots);
    expect([...all].sort()).toEqual(["a", "b"]);
  });

  it("keeps every folder of a cycle visible, exactly once", () => {
    // The regression: no member of a cycle qualified as a root, so the whole
    // group silently vanished from the sidebar with nothing to explain it.
    const roots = buildFolderTree(cyclic());
    const seen: string[] = [];
    const walk = (list: ReturnType<typeof buildFolderTree>) => {
      for (const n of list) {
        expect(seen.length).toBeLessThan(20); // fail fast rather than hang
        seen.push(n.folder.id);
        walk(n.children);
      }
    };
    walk(roots);
    expect([...seen].sort()).toEqual(["a", "b", "c", "root"]);
  });
});

describe("folderPathTo", () => {
  it("returns the ancestry root-first, including the folder", () => {
    expect(folderPathTo(tree(), "grandchild").map((f) => f.id)).toEqual([
      "root",
      "child",
      "grandchild",
    ]);
  });

  it("is empty for no folder and for an unknown one", () => {
    expect(folderPathTo(tree(), null)).toEqual([]);
    expect(folderPathTo(tree(), "nope")).toEqual([]);
  });

  it("stops at the folder that closes a cycle", () => {
    const path = folderPathTo(mutual(), "a").map((f) => f.id);
    expect(path).toEqual(["b", "a"]);
  });

  it("stops on a folder that is its own parent", () => {
    expect(folderPathTo([{ id: "self", parentId: "self" }], "self").map((f) => f.id)).toEqual([
      "self",
    ]);
  });
});

describe("subtreeFolderIds", () => {
  it("returns the folder and everything under it", () => {
    expect(subtreeFolderIds(tree(), "root").sort()).toEqual(["child", "grandchild", "root"]);
  });

  it("is just the folder when it has no children", () => {
    expect(subtreeFolderIds(tree(), "other")).toEqual(["other"]);
  });

  it("visits each folder once when the subtree contains a cycle", () => {
    // The regression: this queue re-queued a repeated child forever, so a
    // cascade delete of a folder inside a cycle never returned.
    const out = subtreeFolderIds(cyclic(), "a");
    expect(out.sort()).toEqual(["a", "b", "c"]);
    expect(new Set(out).size).toBe(out.length);
  });

  it("terminates on mutual parents", () => {
    expect(subtreeFolderIds(mutual(), "a").sort()).toEqual(["a", "b"]);
  });
});
