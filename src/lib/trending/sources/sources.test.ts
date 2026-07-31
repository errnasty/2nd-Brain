import { describe, expect, it } from "vitest";
import { groupGdeltArticles, parseSeenDate } from "./gdelt";
import { rankWeight, splitOutlet } from "./gnews";
import { hnVolume, toStories } from "./hn";
import { parseTraffic, toTerms } from "./trends";

describe("gdelt", () => {
  // GDELT's seendate is YYYYMMDDTHHMMSSZ, which new Date() reads as Invalid.
  it("parses GDELT's non-ISO seendate", () => {
    expect(parseSeenDate("20260731T093000Z")?.toISOString()).toBe("2026-07-31T09:30:00.000Z");
  });

  it("returns null for missing or unparseable dates", () => {
    expect(parseSeenDate(undefined)).toBeNull();
    expect(parseSeenDate("not a date")).toBeNull();
  });

  it("groups the flat article list by headline and counts distinct domains", () => {
    const stories = groupGdeltArticles([
      { title: "Fed holds rates", url: "https://a.com/1", domain: "a.com" },
      { title: "Fed holds rates", url: "https://b.com/1", domain: "b.com" },
      { title: "Fed holds rates", url: "https://c.com/1", domain: "c.com" },
      { title: "A local story", url: "https://d.com/1", domain: "d.com" },
    ]);
    expect(stories).toHaveLength(2);
    const top = stories[0];
    expect(top.title).toBe("Fed holds rates");
    expect(top.sourceCount).toBe(3);
    expect(top.volume).toBeGreaterThan(stories[1].volume);
  });

  it("skips records missing a title or url", () => {
    expect(groupGdeltArticles([{ title: "", url: "https://a.com" }, { title: "x" }])).toEqual([]);
  });
});

describe("gnews", () => {
  // " - Reuters" on every item would otherwise rank "reuters" the hottest term
  // in the world.
  it("splits the trailing publisher off a Google News title", () => {
    expect(splitOutlet("Fed holds rates steady - Reuters")).toEqual({
      title: "Fed holds rates steady",
      outlet: "Reuters",
    });
  });

  it("leaves a hyphenated headline alone", () => {
    const long = "Why the U.S. - and everyone else - is watching the Fed this week";
    expect(splitOutlet(long).outlet).toBeNull();
    expect(splitOutlet(long).title).toBe(long);
  });

  it("still recognises multi-word publisher names", () => {
    expect(splitOutlet("Markets slide - The Wall Street Journal").outlet).toBe(
      "The Wall Street Journal",
    );
    expect(splitOutlet("Markets slide - Al Jazeera English").outlet).toBe("Al Jazeera English");
  });

  it("weights rank position 1 highest and never reaches zero", () => {
    expect(rankWeight(0, 10)).toBeGreaterThan(rankWeight(5, 10));
    expect(rankWeight(9, 10)).toBeGreaterThan(0);
    expect(rankWeight(0, 0)).toBe(0);
  });
});

describe("hn", () => {
  it("weights points above comments and saturates", () => {
    expect(hnVolume(500, 0)).toBeGreaterThan(hnVolume(0, 500));
    expect(hnVolume(100_000, 100_000)).toBeLessThanOrEqual(1);
    expect(hnVolume(0, 0)).toBe(0);
  });

  it("links the discussion for posts with no external url", () => {
    const [story] = toStories([{ title: "Ask HN: anything", objectID: "42", points: 10 }]);
    expect(story.url).toBe("https://news.ycombinator.com/item?id=42");
    expect(story.topicId).toBe("tech");
  });

  it("skips hits with neither a title nor any link", () => {
    expect(toStories([{ title: "", url: "https://x.com" }, { title: "y" }])).toEqual([]);
  });
});

describe("trends", () => {
  it("parses approximate traffic counts", () => {
    expect(parseTraffic("200,000+")).toBe(200000);
    expect(parseTraffic(undefined)).toBe(0);
    expect(parseTraffic("n/a")).toBe(0);
  });

  it("normalizes weights against the busiest trend", () => {
    const terms = toTerms([
      { title: "Volcano Iceland", "ht:approx_traffic": "500,000+" },
      { title: "County Fair", "ht:approx_traffic": "20,000+" },
    ]);
    expect(terms[0].term).toBe("volcano iceland");
    expect(terms[0].weight).toBe(1);
    expect(terms[1].weight).toBeLessThan(1);
  });

  it("falls back to a flat weight when the feed omits traffic", () => {
    const terms = toTerms([{ title: "Something Trending" }]);
    expect(terms[0].weight).toBeGreaterThan(0);
  });

  it("returns nothing for an empty feed", () => {
    expect(toTerms([])).toEqual([]);
  });
});
