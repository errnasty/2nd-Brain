/**
 * Turning a saved reading position into a place on screen, and back.
 *
 * The stored anchor is a character offset into a chapter's text, chosen
 * precisely because it survives everything layout does not: a bigger font, a
 * rotated phone, a resized window, a different device. None of that changes
 * which character you had reached. All of it changes which page that character
 * is on, which is why a page number would be worthless.
 *
 * Both directions walk the same text nodes in the same order, so the offset the
 * reader saves and the offset it later resolves always mean the same thing,
 * even where they disagree with the server's estimate of the chapter's length.
 */

export function textNodesOf(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node as Text;
    if (text.data.length > 0) out.push(text);
  }
  return out;
}

/** Locate a character offset among the chapter's text nodes. */
export function offsetToPosition(
  root: HTMLElement,
  offset: number,
): { node: Text; offset: number } | null {
  const nodes = textNodesOf(root);
  if (nodes.length === 0) return null;

  let seen = 0;
  for (const node of nodes) {
    const len = node.data.length;
    if (offset < seen + len) return { node, offset: Math.max(0, offset - seen) };
    seen += len;
  }
  const last = nodes[nodes.length - 1];
  return { node: last, offset: last.data.length };
}

/** The reverse: where a DOM position falls in the chapter's text. */
export function positionToOffset(root: HTMLElement, node: Text, offsetInNode: number): number {
  let seen = 0;
  for (const candidate of textNodesOf(root)) {
    if (candidate === node) return seen + offsetInNode;
    seen += candidate.data.length;
  }
  return seen;
}

/** Horizontal position of a character, in `root`'s own coordinate space. */
export function xOfOffset(root: HTMLElement, offset: number): number | null {
  const pos = offsetToPosition(root, offset);
  if (!pos) return null;

  const range = document.createRange();
  const end = Math.min(pos.offset + 1, pos.node.data.length);
  range.setStart(pos.node, pos.offset);
  range.setEnd(pos.node, end);

  const rect = range.getBoundingClientRect();
  // A collapsed rect means the character sits at a column break with nothing to
  // measure; the element around it is the next best thing.
  if (rect.width === 0 && rect.height === 0) {
    const parent = pos.node.parentElement;
    if (!parent) return null;
    return parent.getBoundingClientRect().left - root.getBoundingClientRect().left;
  }
  // `root` carries the page transform, so both rects move together and the
  // difference stays in untranslated content coordinates.
  return rect.left - root.getBoundingClientRect().left;
}

/**
 * The first character at or after a horizontal position — i.e. the first word
 * on the page whose left edge is `x`.
 *
 * Nodes are skipped whole where their rightmost edge is still left of `x`, and
 * only the one node that straddles the boundary is searched character by
 * character.
 */
export function offsetAtX(root: HTMLElement, x: number): number {
  const nodes = textNodesOf(root);
  if (nodes.length === 0) return 0;

  const originLeft = root.getBoundingClientRect().left;
  const range = document.createRange();
  let seen = 0;

  for (const node of nodes) {
    const len = node.data.length;
    range.setStart(node, 0);
    range.setEnd(node, len);
    const bounds = range.getBoundingClientRect();

    // Wholly before the boundary — nothing in it can be the answer.
    if (bounds.width > 0 && bounds.right - originLeft <= x) {
      seen += len;
      continue;
    }

    // Binary search for the first character whose left edge reaches x.
    let lo = 0;
    let hi = len;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      range.setStart(node, mid);
      range.setEnd(node, Math.min(mid + 1, len));
      const r = range.getBoundingClientRect();
      const reached = r.width === 0 && r.height === 0 ? false : r.left - originLeft >= x;
      if (reached) hi = mid;
      else lo = mid + 1;
    }
    return seen + lo;
  }

  return seen;
}
