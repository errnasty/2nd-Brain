import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAndParseFeed } from "./parser";

// Feeds come from servers this app does not control, and real-world RSS is full
// of EMPTY elements — `<guid></guid>`, `<title></title>`. Those parse as "",
// which is not nullish, so they sail through `??` and become real data.
//
// For guid that was silent data loss: articles has UNIQUE (feed_id, guid) and
// the sync inserts with onConflictDoNothing, so every item after the first in
// such a feed was dropped on every sync, forever.

function mockFeed(body: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/rss+xml" }),
      text: async () => body,
    })),
  );
}

const rss = (inner: string, channelExtra = "") => `<?xml version="1.0"?>
<rss version="2.0"><channel><title>T</title><link>https://e.test</link>${channelExtra}${inner}</channel></rss>`;

const item = (inner: string) => `<item>${inner}</item>`;
const three = (inner: (n: number) => string) => [1, 2, 3].map(inner).join("");

afterEach(() => vi.unstubAllGlobals());

describe("fetchAndParseFeed — empty elements must not become data", () => {
  it("falls back to the link when <guid> is empty", async () => {
    mockFeed(
      rss(
        three((n) =>
          item(`<guid></guid><title>Item ${n}</title><link>https://e.test/${n}</link>`),
        ),
      ),
    );
    const feed = await fetchAndParseFeed("https://e.test/feed");
    const guids = feed.items.map((i) => i.guid);
    expect(new Set(guids).size, `guids collide: ${JSON.stringify(guids)}`).toBe(3);
    expect(guids).toEqual([
      "https://e.test/1",
      "https://e.test/2",
      "https://e.test/3",
    ]);
  });

  it("falls back to the link when <guid> is only whitespace", async () => {
    mockFeed(rss(item(`<guid>   </guid><title>A</title><link>https://e.test/1</link>`)));
    const [only] = (await fetchAndParseFeed("https://e.test/feed")).items;
    expect(only.guid).toBe("https://e.test/1");
  });

  it("keeps a real guid exactly as given", async () => {
    mockFeed(rss(item(`<guid>tag:e.test,2026:1</guid><title>A</title><link>https://e.test/1</link>`)));
    const [only] = (await fetchAndParseFeed("https://e.test/feed")).items;
    expect(only.guid).toBe("tag:e.test,2026:1");
  });

  it("falls back to Untitled when the item title is blank", async () => {
    mockFeed(rss(item(`<title>   </title><link>https://e.test/1</link>`)));
    const [only] = (await fetchAndParseFeed("https://e.test/feed")).items;
    expect(only.title).toBe("Untitled");
  });

  it("falls back to the hostname when the channel title is blank", async () => {
    const body = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>  </title><link>https://e.test</link>
${item(`<title>A</title><link>https://e.test/1</link>`)}</channel></rss>`;
    mockFeed(body);
    const feed = await fetchAndParseFeed("https://feeds.e.test/rss");
    expect(feed.title).toBe("feeds.e.test");
  });

  it("leaves author undefined rather than empty", async () => {
    mockFeed(
      rss(item(`<dc:creator></dc:creator><title>A</title><link>https://e.test/1</link>`)),
    );
    const [only] = (await fetchAndParseFeed("https://e.test/feed")).items;
    expect(only.author ?? "").toBe("");
    expect(only.author).not.toBe("");
  });

  it("still drops items with no link at all", async () => {
    mockFeed(rss(item(`<title>No link</title>`)));
    expect((await fetchAndParseFeed("https://e.test/feed")).items).toEqual([]);
  });
});
