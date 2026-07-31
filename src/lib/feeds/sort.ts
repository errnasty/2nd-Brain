/**
 * How the Feeds list is ordered.
 *
 * In its own module, not on the page, because the sort dropdown is a CLIENT
 * component: importing a runtime function out of `feeds/page.tsx` would drag
 * that file's `db` and auth imports into the browser bundle. A type import
 * would have been erased at build time, but `parseFeedSort` is real code.
 */

export const FEED_SORTS = ["trending", "newest", "oldest"] as const;
export type FeedSort = (typeof FEED_SORTS)[number];

/** The order used when no `?sort` is given. */
export const DEFAULT_FEED_SORT: FeedSort = "trending";

export const FEED_SORT_LABELS: Record<FeedSort, string> = {
  trending: "Trending",
  newest: "Newest",
  oldest: "Oldest",
};

/**
 * Normalize the `sort` query param.
 *
 * `"hot"` was the previous option and was never trending at all: it filtered to
 * the last three days and then sorted by date, so everything published this
 * morning ranked identically. Old links and bookmarks still carry it, so it
 * maps onto the real thing rather than silently falling back to newest.
 */
export function parseFeedSort(raw: string | null | undefined): FeedSort {
  if (raw === "newest" || raw === "oldest" || raw === "trending") return raw;
  if (raw === "hot") return "trending";
  return DEFAULT_FEED_SORT;
}
