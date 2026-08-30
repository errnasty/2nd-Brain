/**
 * Turning a saved reading position into a place on screen, and back.
 *
 * The stored anchor is a character offset into a chapter's text, chosen
 * precisely because it survives everything layout does not: a bigger font, a
 * rotated phone, a resized window, a different device. None of that changes
 * which character you had reached. All of it changes which page that character
 * is on, which is why a page number would be worthless.
 *
 * ## Why this is an index rather than a scan
 *
 * The obvious implementation walks the text nodes and measures each one until
 * it finds the boundary. That costs one `getBoundingClientRect` per text node,
 * and a chapter routinely has a couple of thousand — on *every page turn*,
 * which is exactly when the reader can least afford a stall.
 *
 * So measuring is separated from asking. `indexChapter` measures every node
 * once per layout (a single reflow, because it only reads), and the lookups are
 * then binary searches over plain arrays. Only the one node straddling the
 * boundary is probed live, and only ~12 times.
 *
 * Positions are stored relative to the root's own box. The root carries the
 * page transform, so both rects move together and the stored values stay
 * correct as pages turn — a transform does not invalidate layout, so nothing
 * needs re-measuring until the text actually reflows.
 */

export type ChapterIndex = {
  nodes: Text[];
  /** Cumulative character offset at the start of each node. */
  starts: number[];
  /** Left and right edges of each node, in the root's coordinate space. */
  lefts: number[];
  rights: number[];
  totalChars: number;
};

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

/**
 * Measure a laid-out chapter once.
 *
 * Call this after a reflow — a new chapter, a font change, a resize — and reuse
 * the result for every page turn until the next one. All the reads happen
 * together with no interleaved writes, so the browser reflows once rather than
 * once per node.
 */
export function indexChapter(root: HTMLElement): ChapterIndex {
  const nodes = textNodesOf(root);
  const starts: number[] = new Array(nodes.length);
  const lefts: number[] = new Array(nodes.length);
  const rights: number[] = new Array(nodes.length);

  const originLeft = root.getBoundingClientRect().left;
  const range = document.createRange();
  let seen = 0;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    starts[i] = seen;
    seen += node.data.length;

    range.setStart(node, 0);
    range.setEnd(node, node.data.length);
    const rect = range.getBoundingClientRect();
    // A zero-size rect is a node the layout collapsed away (whitespace at a
    // column break). Inheriting the previous node's edge keeps both arrays
    // monotonic, which is what makes the binary searches valid.
    if (rect.width === 0 && rect.height === 0) {
      lefts[i] = i > 0 ? lefts[i - 1] : 0;
      rights[i] = i > 0 ? rights[i - 1] : 0;
    } else {
      lefts[i] = rect.left - originLeft;
      rights[i] = rect.right - originLeft;
    }
  }

  return { nodes, starts, lefts, rights, totalChars: seen };
}

/** Locate a character offset among the chapter's text nodes. */
export function offsetToPosition(
  index: ChapterIndex,
  offset: number,
): { node: Text; offset: number } | null {
  const { nodes, starts } = index;
  if (nodes.length === 0) return null;

  // Binary search for the last node starting at or before `offset`.
  let lo = 0;
  let hi = nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }

  const node = nodes[lo];
  return { node, offset: Math.max(0, Math.min(offset - starts[lo], node.data.length)) };
}

/** The reverse: where a DOM position falls in the chapter's text. */
export function positionToOffset(index: ChapterIndex, node: Text, offsetInNode: number): number {
  const i = index.nodes.indexOf(node);
  if (i === -1) return 0;
  return index.starts[i] + offsetInNode;
}

/** Horizontal position of a character, in the root's own coordinate space. */
export function xOfOffset(index: ChapterIndex, root: HTMLElement, offset: number): number | null {
  const pos = offsetToPosition(index, offset);
  if (!pos) return null;

  const i = index.nodes.indexOf(pos.node);
  // Start of a node is already measured; no need to touch the DOM at all.
  if (pos.offset === 0 && i !== -1) return index.lefts[i];

  const range = document.createRange();
  range.setStart(pos.node, pos.offset);
  range.setEnd(pos.node, Math.min(pos.offset + 1, pos.node.data.length));
  const rect = range.getBoundingClientRect();

  if (rect.width === 0 && rect.height === 0) {
    return i === -1 ? null : index.lefts[i];
  }
  return rect.left - root.getBoundingClientRect().left;
}

/**
 * The first character at or after a horizontal position — i.e. the first word
 * on the page whose left edge is `x`.
 *
 * Two binary searches: one over the measured node edges to find the node that
 * straddles the boundary, then one inside it. Roughly two dozen rect reads
 * regardless of how long the chapter is.
 */
export function offsetAtX(index: ChapterIndex, root: HTMLElement, x: number): number {
  const { nodes, starts, rights } = index;
  if (nodes.length === 0) return 0;

  // First node whose right edge reaches x. `rights` is non-decreasing in a
  // left-to-right column flow, which is what makes this searchable.
  let lo = 0;
  let hi = nodes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rights[mid] > x) hi = mid;
    else lo = mid + 1;
  }
  if (lo >= nodes.length) return index.totalChars;

  const node = nodes[lo];
  const len = node.data.length;
  const originLeft = root.getBoundingClientRect().left;
  const range = document.createRange();

  let charLo = 0;
  let charHi = len;
  while (charLo < charHi) {
    const mid = (charLo + charHi) >> 1;
    range.setStart(node, mid);
    range.setEnd(node, Math.min(mid + 1, len));
    const r = range.getBoundingClientRect();
    const reached = r.width === 0 && r.height === 0 ? false : r.left - originLeft >= x;
    if (reached) charHi = mid;
    else charLo = mid + 1;
  }

  return starts[lo] + charLo;
}

/**
 * A DOM Range covering a character span of the chapter.
 *
 * Highlights are drawn as overlay rectangles from this rather than by wrapping
 * the text in `<mark>`. Wrapping would split text nodes, which changes the very
 * offsets every anchor in the reader is measured in — the reading position, the
 * highlights themselves, the page restore. Overlays touch nothing.
 */
export function rangeForOffsets(
  index: ChapterIndex,
  start: number,
  end: number,
): Range | null {
  const from = offsetToPosition(index, start);
  const to = offsetToPosition(index, Math.max(start, end));
  if (!from || !to) return null;

  const range = document.createRange();
  try {
    range.setStart(from.node, Math.min(from.offset, from.node.data.length));
    range.setEnd(to.node, Math.min(to.offset, to.node.data.length));
  } catch {
    return null;
  }
  return range.collapsed ? null : range;
}

export type OverlayRect = { left: number; top: number; width: number; height: number };

/** Client rects of a range, in the root's own (untransformed) coordinates. */
export function rectsForRange(root: HTMLElement, range: Range): OverlayRect[] {
  const origin = root.getBoundingClientRect();
  const out: OverlayRect[] = [];
  for (const r of Array.from(range.getClientRects())) {
    // Zero-area rects come from collapsed whitespace at line and column breaks.
    if (r.width <= 0 || r.height <= 0) continue;
    out.push({
      left: r.left - origin.left,
      top: r.top - origin.top,
      width: r.width,
      height: r.height,
    });
  }
  return out;
}

/**
 * Where the current selection sits in the chapter, if it sits in it at all.
 *
 * Returns null for a collapsed selection, and for one whose ends are not text
 * inside `root` — a selection that started in the chapter and ended in the
 * toolbar is not a highlight.
 */
export function selectionOffsets(
  index: ChapterIndex,
  root: HTMLElement,
): { start: number; end: number; text: string; rect: OverlayRect } | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  if (range.startContainer.nodeType !== Node.TEXT_NODE) return null;
  if (range.endContainer.nodeType !== Node.TEXT_NODE) return null;

  const text = selection.toString().trim();
  if (!text) return null;

  const start = positionToOffset(index, range.startContainer as Text, range.startOffset);
  const end = positionToOffset(index, range.endContainer as Text, range.endOffset);
  if (end <= start) return null;

  const rects = rectsForRange(root, range);
  if (rects.length === 0) return null;

  return { start, end, text, rect: rects[0] };
}
