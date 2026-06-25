import { describe, expect, it } from "vitest";
import { parseOpml } from "./import";

const OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Subscriptions</title></head>
  <body>
    <outline text="Tech" title="Tech">
      <outline type="rss" text="Hacker News" xmlUrl="https://hnrss.org/frontpage" htmlUrl="https://news.ycombinator.com" />
      <outline type="rss" text="Lobsters" xmlUrl="https://lobste.rs/rss" />
    </outline>
    <outline type="rss" text="Untagged Blog" xmlUrl="https://example.com/feed.xml" />
  </body>
</opml>`;

describe("parseOpml", () => {
  it("splits root feeds from foldered feeds", () => {
    const r = parseOpml(OPML);
    expect(r.rootFeeds).toHaveLength(1);
    expect(r.rootFeeds[0].url).toBe("https://example.com/feed.xml");
    expect(r.folders).toHaveLength(1);
    expect(r.folders[0].name).toBe("Tech");
    expect(r.folders[0].feeds.map((f) => f.url)).toEqual([
      "https://hnrss.org/frontpage",
      "https://lobste.rs/rss",
    ]);
  });

  it("keeps title + siteUrl, falling back to text/url", () => {
    const r = parseOpml(OPML);
    const hn = r.folders[0].feeds[0];
    expect(hn.title).toBe("Hacker News");
    expect(hn.siteUrl).toBe("https://news.ycombinator.com");
    const lob = r.folders[0].feeds[1];
    expect(lob.title).toBe("Lobsters");
    expect(lob.siteUrl).toBeUndefined();
  });

  it("handles a single foldered feed (parser returns an object, not array)", () => {
    const single = `<opml><body>
      <outline title="Solo"><outline type="rss" text="One" xmlUrl="https://one.example/rss" /></outline>
    </body></opml>`;
    const r = parseOpml(single);
    expect(r.folders).toHaveLength(1);
    expect(r.folders[0].feeds).toHaveLength(1);
    expect(r.folders[0].feeds[0].url).toBe("https://one.example/rss");
  });

  it("drops empty folders + tolerates empty input", () => {
    const empty = `<opml><body><outline title="Empty"></outline></body></opml>`;
    expect(parseOpml(empty).folders).toHaveLength(0);
    expect(parseOpml(`<opml><body></body></opml>`).rootFeeds).toHaveLength(0);
  });
});
