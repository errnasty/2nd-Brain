// Pure tidy-tree layout for the Rabbithole canvas. No DOM, no React — takes the
// node parent links, each card's measured size, and the set of collapsed ids,
// and returns absolute world positions. A synthetic ROOT_ID stands in as the
// shared parent of every parentId===null branch so the root document card is
// the trunk of the tree.

export const ROOT_ID = "__root__";

export type LayoutNode = { id: string; parentId: string | null };
export type Size = { w: number; h: number };
export type Pos = { x: number; y: number };

const COL_GAP = 120; // horizontal space between a card's right edge and its children
const ROW_GAP = 40; // vertical space between sibling subtrees

/**
 * @param nodes    every branch (root document excluded — it is ROOT_ID)
 * @param sizes    measured card sizes, keyed by node id and ROOT_ID
 * @param collapsed ids whose subtrees are hidden
 * @returns position map (world coords, top-left of each card); collapsed
 *          descendants are absent from the map
 */
export function layoutTree(
  nodes: LayoutNode[],
  sizes: Map<string, Size>,
  collapsed: Set<string>,
): Map<string, Pos> {
  const DEFAULT: Size = { w: 320, h: 200 };
  const sizeOf = (id: string) => sizes.get(id) ?? DEFAULT;

  const childrenOf = new Map<string, string[]>();
  for (const n of nodes) {
    const parent = n.parentId ?? ROOT_ID;
    const list = childrenOf.get(parent) ?? [];
    list.push(n.id);
    childrenOf.set(parent, list);
  }

  const pos = new Map<string, Pos>();

  // Place `id` with its top-left column at `x`, packing its subtree into a
  // vertical band starting at `top`. Returns the band's height so the caller
  // can stack the next sibling below it. The node is vertically centered
  // against its children's combined band.
  function place(id: string, x: number, top: number): number {
    const size = sizeOf(id);
    const kids = collapsed.has(id) ? [] : childrenOf.get(id) ?? [];

    if (kids.length === 0) {
      pos.set(id, { x, y: top });
      return size.h;
    }

    const childX = x + size.w + COL_GAP;
    let childTop = top;
    const childCenters: number[] = [];
    for (const kid of kids) {
      const h = place(kid, childX, childTop);
      // Use the child's ACTUAL placed center, not the allocated-band midpoint.
      // A non-leaf child that fits inside its own children's band is not
      // centered on that band, so the band midpoint diverges from its real
      // center; that error would otherwise propagate up through `mid`.
      childCenters.push(pos.get(kid)!.y + sizeOf(kid).h / 2);
      childTop += h + ROW_GAP;
    }
    const bandBottom = childTop - ROW_GAP;
    const bandHeight = bandBottom - top;

    // Center this card against the span of its children.
    const mid = (childCenters[0] + childCenters[childCenters.length - 1]) / 2;
    pos.set(id, { x, y: mid - size.h / 2 });

    // The band must cover both the children and this (possibly taller) card.
    const selfTop = mid - size.h / 2;
    const selfBottom = mid + size.h / 2;
    const bandTop = Math.min(top, selfTop);
    const realBottom = Math.max(bandBottom, selfBottom);
    // Shift so the band starts exactly at `top` (keep children/self relative).
    const shift = top - bandTop;
    if (shift !== 0) {
      shiftSubtree(id, shift);
    }
    return Math.max(bandHeight, realBottom - bandTop);
  }

  function shiftSubtree(id: string, dy: number) {
    const p = pos.get(id);
    if (p) pos.set(id, { x: p.x, y: p.y + dy });
    if (collapsed.has(id)) return;
    for (const kid of childrenOf.get(id) ?? []) shiftSubtree(kid, dy);
  }

  place(ROOT_ID, 0, 0);

  // Pin ROOT_ID to the origin. The design spec requires "root at origin" as a
  // hard invariant; translate the whole tree to absorb any residual centering
  // drift. `rootPos` is captured before the loop so its values stay stable as
  // entries are reassigned.
  const rootPos = pos.get(ROOT_ID);
  if (rootPos && (rootPos.x !== 0 || rootPos.y !== 0)) {
    const dx = rootPos.x;
    const dy = rootPos.y;
    for (const [id, p] of pos) {
      pos.set(id, { x: p.x - dx, y: p.y - dy });
    }
  }

  return pos;
}
