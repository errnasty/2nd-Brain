import { describe, expect, it } from "vitest";
import { DEFAULT_FEED_SORT, FEED_SORTS, FEED_SORT_LABELS, parseFeedSort } from "./sort";

describe("parseFeedSort", () => {
  it("accepts every declared sort", () => {
    for (const s of FEED_SORTS) expect(parseFeedSort(s)).toBe(s);
  });

  // Bookmarks and shared links still carry ?sort=hot. It was never trending —
  // it filtered to three days and then sorted by date — so it maps onto the
  // real thing rather than silently reverting to newest.
  it("maps the retired \"hot\" sort onto trending", () => {
    expect(parseFeedSort("hot")).toBe("trending");
  });

  it("falls back to the default for anything else", () => {
    expect(parseFeedSort(undefined)).toBe(DEFAULT_FEED_SORT);
    expect(parseFeedSort(null)).toBe(DEFAULT_FEED_SORT);
    expect(parseFeedSort("")).toBe(DEFAULT_FEED_SORT);
    expect(parseFeedSort("popular")).toBe(DEFAULT_FEED_SORT);
  });

  it("defaults to trending", () => {
    expect(DEFAULT_FEED_SORT).toBe("trending");
  });

  it("labels every sort", () => {
    for (const s of FEED_SORTS) expect(FEED_SORT_LABELS[s]).toBeTruthy();
  });
});
