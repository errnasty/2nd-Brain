/**
 * Collapsing a feed list into stories.
 *
 * ## Two answers to "is this the same story"
 *
 * The list's "hide duplicates" toggle used to compare lowercased,
 * punctuation-stripped titles: an exact string match after normalizing. That
 * catches a wire report syndicated verbatim and nothing else — "Fed holds
 * rates steady" and "Fed leaves rates unchanged" stayed two rows.
 *
 * Meanwhile the trending pass had already answered the same question properly,
 * with title shingles AND embedding similarity, and written the answer onto
 * every article as `cluster_id`. So the app held two verdicts on the same
 * question and the list was reading the weaker one. This uses the real one,
 * and keeps normalized-title matching only as the fallback for rows the
 * trending pass has not reached (a fresh database, the desktop app, or search
 * results, which don't carry the column).
 *
 * ## Why collapsing hides rather than filters
 *
 * The old toggle DROPPED the duplicate rows, which quietly threw away the most
 * interesting thing about a story: that six outlets bothered. Here the extra
 * tellings stay attached to the row that represents them and can be expanded,
 * so the reader can still see who else carried it — and marking the story read
 * can take all of them with it, which is the actual chore being solved.
 */

/** What grouping needs from a row. Deliberately structural — the list, the
 *  search results and any future caller all satisfy it. */
export type StoryItem = {
  id: string;
  title: string;
  /** From the trending pass; absent on unscored rows and search results. */
  clusterId?: string | null;
};

export type StoryGrouping<T extends StoryItem> = {
  /** The rows to render, in order, with collapsed tellings removed. */
  visible: T[];
  /** Lead id → its other tellings, whether or not they are currently shown. */
  tellings: Map<string, T[]>;
};

/** Normalize a title for the fallback match. Mirrors the old dedupe exactly. */
export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The story a row belongs to. Cluster id when the trending pass has grouped
 * it, normalized title otherwise — prefixed so a cluster uuid can never
 * collide with a title that happens to look like one.
 */
export function storyKey(item: StoryItem): string {
  return item.clusterId ? `c:${item.clusterId}` : `t:${normalizeTitle(item.title)}`;
}

/**
 * Group a list into stories.
 *
 * The FIRST row of a story leads it, which matters because the list arrives
 * already sorted: under the trending sort every telling of a story shares its
 * score and they sort adjacently, so the lead is the newest telling of the
 * hottest story rather than an arbitrary one. Order is otherwise untouched —
 * collapsing must never reorder a list the reader has just sorted.
 *
 * With `collapse` off this returns the input unchanged and an empty map, so
 * the caller can render one code path either way.
 */
export function groupStories<T extends StoryItem>(
  items: T[],
  opts: { collapse: boolean; expanded?: ReadonlySet<string> },
): StoryGrouping<T> {
  if (!opts.collapse) return { visible: items, tellings: new Map() };

  const expanded = opts.expanded ?? new Set<string>();
  const leadOf = new Map<string, T>();
  const tellings = new Map<string, T[]>();
  const visible: T[] = [];

  for (const item of items) {
    const key = storyKey(item);
    const lead = leadOf.get(key);
    if (!lead) {
      leadOf.set(key, item);
      tellings.set(item.id, []);
      visible.push(item);
      continue;
    }
    tellings.get(lead.id)?.push(item);
    // An expanded story shows its tellings in place, immediately after the
    // lead — which they already are, since the list is in story order.
    if (expanded.has(lead.id)) visible.push(item);
  }

  return { visible, tellings };
}

/**
 * Every article id that marking this row read should cover: the row itself,
 * plus the tellings collapsed under it.
 *
 * Only when the story is COLLAPSED. Once the reader has expanded it, the other
 * tellings are rows on screen with their own unread state, and marking one of
 * them read behind the reader's back is exactly the kind of silent bulk action
 * that makes people distrust a reading list.
 */
export function storyReadTargets<T extends StoryItem>(
  id: string,
  grouping: StoryGrouping<T>,
  expanded: ReadonlySet<string>,
): string[] {
  if (expanded.has(id)) return [id];
  const others = grouping.tellings.get(id);
  if (!others || others.length === 0) return [id];
  return [id, ...others.map((o) => o.id)];
}
