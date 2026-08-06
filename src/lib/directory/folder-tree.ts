/**
 * Building the folder tree, and walking a folder's ancestry.
 *
 * ## Why both of these need a cycle guard
 *
 * `parent_id` is a self-referencing column with nothing in the database
 * stopping A from being B's parent while B is A's. The action that moves a
 * folder does check — it walks up from the target and refuses a drop into its
 * own subtree — but that check gives up after 32 levels, and it is not the only
 * writer: the desktop⇄cloud sync engine applies rows directly, so two devices
 * reparenting the same pair while offline can commit a cycle that no single
 * request ever saw.
 *
 * A cycle is small but each walk over it failed differently, and none of the
 * three failures was survivable:
 *
 *   - **The tree builder** attached every folder to its parent, so two folders
 *     parenting each other ended up as children of one another and neither
 *     became a root. Nothing renders them — they simply vanish from the
 *     sidebar, along with anything beneath them, with no error to explain it.
 *   - **The breadcrumb walk** climbed `parentId` in a `while` loop with no
 *     termination but a missing parent. Opening a folder inside a cycle spun
 *     that loop forever, mid-render, which freezes the tab.
 *   - **The cascade delete** walked the other way, queueing children, and
 *     re-queued the same pair endlessly — a server action that never returned.
 *
 * So all three track what they have already seen, and the builder promotes a
 * folder to a root rather than parenting it to its own descendant. A cycle then
 * costs the one edge that closes it: the folders stay visible, the breadcrumb
 * ends, the delete finishes, and the mess is repairable by dragging a folder
 * somewhere sensible instead of being unreachable.
 */

/** The folder fields the tree cares about. */
export type TreeFolder = {
  id: string;
  parentId: string | null;
};

export type FolderTreeNode<F extends TreeFolder> = {
  folder: F;
  children: FolderTreeNode<F>[];
};

/**
 * Root-level folders, each with its children attached.
 *
 * A folder whose parent is missing (deleted, or not in this user's set) is
 * promoted to a root rather than dropped — an orphan you can see and move is
 * better than one that simply isn't there.
 */
export function buildFolderTree<F extends TreeFolder>(folders: F[]): FolderTreeNode<F>[] {
  const byId = new Map<string, FolderTreeNode<F>>();
  for (const f of folders) byId.set(f.id, { folder: f, children: [] });

  const roots: FolderTreeNode<F>[] = [];
  for (const node of byId.values()) {
    const parentId = node.folder.parentId;
    const parent = parentId ? byId.get(parentId) : null;
    // A folder that is its own ancestor has no valid place in a tree, and
    // attaching it anyway is what made both members of a cycle disappear:
    // each became the other's child, so neither was ever a root and nothing
    // rendered either. Promoting it to a root keeps it — and everything under
    // it — visible, and confines the damage to the edge that closes the loop.
    if (parent && parent !== node && !isDescendantOf(byId, parentId!, node.folder.id)) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/**
 * Whether `startId` sits under `ancestorId`, walking parents.
 *
 * Bounded by the number of folders: a walk that visits more nodes than exist
 * has necessarily revisited one, which is the definition of the cycle being
 * looked for.
 */
function isDescendantOf<F extends TreeFolder>(
  byId: Map<string, FolderTreeNode<F>>,
  startId: string,
  ancestorId: string,
): boolean {
  const seen = new Set<string>();
  let cursor: string | null = startId;
  while (cursor) {
    if (cursor === ancestorId) return true;
    if (seen.has(cursor)) return false;
    seen.add(cursor);
    cursor = byId.get(cursor)?.folder.parentId ?? null;
  }
  return false;
}

/**
 * The ancestor chain of a folder, root first, including the folder itself.
 * Returns an empty array for an unknown id — the breadcrumb simply doesn't
 * render rather than the page failing.
 */
export function folderPathTo<F extends TreeFolder>(folders: F[], folderId: string | null): F[] {
  if (!folderId) return [];
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: F[] = [];
  const seen = new Set<string>();
  let cur = byId.get(folderId);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path;
}

/**
 * Every folder in a subtree, the folder itself first.
 *
 * Used by the cascade delete, which walks down instead of up and had the same
 * unbounded shape — a cycle there meant a server action that never returned.
 */
export function subtreeFolderIds<F extends TreeFolder>(folders: F[], rootId: string): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const f of folders) {
    if (!f.parentId) continue;
    const list = childrenOf.get(f.parentId) ?? [];
    list.push(f.id);
    childrenOf.set(f.parentId, list);
  }

  const out: string[] = [];
  const seen = new Set<string>([rootId]);
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    out.push(cur);
    for (const child of childrenOf.get(cur) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push(child);
    }
  }
  return out;
}
