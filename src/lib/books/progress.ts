/**
 * Reading-position maths.
 *
 * Everything here is deliberately layout-free. A book paginates differently at
 * another font size, on a rotated phone, or in a resized window, so a page
 * number is worthless as a saved position and worthless as a progress figure.
 * Both are computed from character counts instead, which do not move.
 */

export type ChapterLength = { idx: number; charCount: number };

/** Where a reader is: a chapter, and how far into its text. */
export type ReadingAnchor = { chapterIdx: number; charOffset: number };

/** Characters in every chapter before `chapterIdx`, and in the whole book. */
export function charTotals(chapters: ChapterLength[]): { total: number; before: number[] } {
  const ordered = [...chapters].sort((a, b) => a.idx - b.idx);
  const before: number[] = [];
  let running = 0;
  for (const c of ordered) {
    before[c.idx] = running;
    running += Math.max(0, c.charCount);
  }
  return { total: running, before };
}

/**
 * Fraction of the book read, 0..1.
 *
 * Returns 0 for an empty book rather than dividing by zero, and never exceeds
 * 1 — a chapter's stored `charCount` is an approximation of what the browser
 * ends up rendering, so an offset can legitimately overshoot it slightly.
 */
export function progressFor(
  chapters: ChapterLength[],
  anchor: ReadingAnchor,
): number {
  const { total, before } = charTotals(chapters);
  if (total <= 0) return 0;
  const base = before[anchor.chapterIdx] ?? 0;
  const read = base + Math.max(0, anchor.charOffset);
  return Math.min(1, Math.max(0, read / total));
}

/**
 * Pull an anchor back into a book that may have changed under it.
 *
 * A saved position outlives the thing it points at: a book can be re-uploaded
 * with a different spine, and a stored offset can exceed a chapter that turned
 * out shorter. Clamping is cheaper than making every caller defend itself, and
 * far better than resuming at a crash.
 */
export function clampAnchor(chapters: ChapterLength[], anchor: ReadingAnchor): ReadingAnchor {
  if (chapters.length === 0) return { chapterIdx: 0, charOffset: 0 };

  const byIdx = new Map(chapters.map((c) => [c.idx, c]));
  const known = [...byIdx.keys()].sort((a, b) => a - b);

  let chapterIdx = anchor.chapterIdx;
  if (!byIdx.has(chapterIdx)) {
    // Nearest chapter that still exists, preferring to fall backwards so the
    // reader never skips content they have not seen.
    const earlier = known.filter((i) => i < chapterIdx).pop();
    chapterIdx = earlier ?? known[0];
    return { chapterIdx, charOffset: 0 };
  }

  const max = Math.max(0, byIdx.get(chapterIdx)?.charCount ?? 0);
  return { chapterIdx, charOffset: Math.min(Math.max(0, anchor.charOffset), max) };
}

/**
 * The furthest point reached, for the spoiler clamp.
 *
 * Monotonic on purpose: flipping back to re-read chapter 2 must not re-hide
 * chapter 9 from the AI. The clamp asks how far you have been, not where you
 * are.
 */
export function advanceFurthest(current: number, visiting: number): number {
  return Math.max(current, visiting);
}
