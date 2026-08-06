/**
 * Pairing a virtualizer's rows with the items they point at, safely.
 *
 * ## Why this needs to exist
 *
 * `@tanstack/virtual-core` builds its virtual items like this (v3.16.0,
 * `getVirtualItems`):
 *
 *     for (let k = 0; k < indexes.length; k++) {
 *       const i = indexes[k];
 *       const measurement = measurements[i];
 *       virtualItems.push(measurement);   // no bounds check
 *     }
 *
 * The index list and the measurement list are memoized separately, so whenever
 * they disagree — which happens when the row count SHRINKS, because the count
 * the range was computed against is briefly ahead of the array the rows are
 * read from — the returned array contains `undefined` holes.
 *
 * A list that then writes `items[row.index].id` throws
 * `Cannot read properties of undefined`, and because this is a render, the
 * route's error boundary swallows the entire view: the Directory became
 * "Something went wrong" rather than one missing row.
 *
 * Shrinking is not an edge case in either list that uses this. The Directory
 * hides rows the moment you delete them (the server delete is deferred behind a
 * 6-second undo), and again whenever the type or age filter changes. Feeds
 * collapses every telling of a story into one row when grouping is on. Both are
 * things you do after you have been on the page a while, which is exactly when
 * the crash showed up.
 *
 * ## Why skip rather than clamp
 *
 * A hole means the geometry is momentarily ahead of the data. Clamping to the
 * last item would render a duplicate of it at the wrong offset; skipping
 * renders nothing there for one frame, and the re-measure that follows fills it
 * in. One frame of a missing row beats a wrong row, and both beat losing the
 * page.
 */

/** The part of a virtual row this cares about. */
export type IndexedRow = { index: number };

/**
 * Rows paired with their items, with holes dropped.
 *
 * Takes the rows array as possibly containing `undefined` because it genuinely
 * can — see above. TypeScript's own view of `getVirtualItems()` says otherwise,
 * which is the reason this went unnoticed.
 */
export function resolveVirtualRows<R extends IndexedRow, T>(
  rows: readonly (R | undefined)[],
  items: readonly T[],
): { row: R; item: T }[] {
  const out: { row: R; item: T }[] = [];
  for (const row of rows) {
    if (!row) continue;
    const item = items[row.index];
    if (item === undefined) continue;
    out.push({ row, item });
  }
  return out;
}

/**
 * The furthest row actually on screen, for "am I near the end" checks.
 *
 * Returns -1 for an empty set rather than 0: with 0, an empty list reads as
 * "row 0 is showing", and an infinite-scroll check of the shape
 * `last >= count - 5` fires against a list that has nothing in it yet.
 */
export function lastResolvedIndex<R extends IndexedRow, T>(
  resolved: readonly { row: R; item: T }[],
): number {
  return resolved.length > 0 ? resolved[resolved.length - 1].row.index : -1;
}
