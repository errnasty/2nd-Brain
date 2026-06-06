import Parser from "rss-parser";

type CustomItem = {
  contentEncoded?: string;
  "content:encoded"?: string;
  author?: string;
};

export type NormalizedFeed = {
  title: string;
  description?: string;
  siteUrl?: string;
  iconUrl?: string;
  items: NormalizedItem[];
};

export type NormalizedItem = {
  guid: string;
  url: string;
  title: string;
  author?: string;
  excerpt?: string;
  content?: string;
  publishDate?: Date;
  imageUrl?: string;
};

// We fetch the feed ourselves (below) rather than letting rss-parser's
// parseURL do it, so we control the timeout (AbortController), send a
// browser-like User-Agent (many origins 403 a bot UA), and retry transient
// blocks. The parser is used only to PARSE the fetched XML.
const parser: Parser<{}, CustomItem> = new Parser({
  customFields: {
    item: [
      ["content:encoded", "contentEncoded"],
      ["media:thumbnail", "mediaThumbnail"],
    ],
  },
});

// A real browser UA — plain bot UAs get 403'd by Cloudflare/WAF on many news
// sites (RT, Bloomberg, WEF, sciencemag, …).
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Per-attempt fetch timeout. Kept below the sync run budget (8s) so one slow
// feed aborts on its own instead of blocking its batch or being killed by the
// serverless wall-clock cap.
const FETCH_TIMEOUT_MS = 6000;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch the raw feed XML with a bounded timeout, browser UA, and a single
 * retry on bot-block (403) / rate-limit (429). We do NOT retry timeouts — the
 * origin is already slow and a second 6s wait would blow the run budget.
 */
async function fetchFeedText(url: string): Promise<string> {
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": BROWSER_UA,
          Accept:
            "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.7",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      if (res.ok) return await res.text();

      lastError = `Status code ${res.status}`;
      // Retry once on transient blocks; a brief pause for 429 (rate limit).
      if (attempt === 0 && (res.status === 403 || res.status === 429)) {
        await delay(res.status === 429 ? 1200 : 400);
        continue;
      }
      throw new Error(lastError);
    } catch (err) {
      // Timeouts/aborts: don't retry (already slow). Other network errors
      // (DNS, reset) fail fast, so one quick retry is cheap and worthwhile.
      const isAbort = err instanceof Error && err.name === "AbortError";
      if (attempt === 0 && !isAbort && !lastError) {
        lastError = err instanceof Error ? err.message : String(err);
        await delay(400);
        continue;
      }
      if (isAbort) throw new Error(`Timed out after ${FETCH_TIMEOUT_MS}ms`);
      throw err instanceof Error ? err : new Error(String(err));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(lastError || "Fetch failed");
}

function stripHtml(html: string | undefined): string | undefined {
  if (!html) return undefined;
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFirstImage(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m?.[1];
}

function safeDate(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function fetchAndParseFeed(url: string): Promise<NormalizedFeed> {
  const xml = await fetchFeedText(url);
  const feed = await parser.parseString(xml);
  const siteUrl = feed.link ?? undefined;
  const iconUrl = siteUrl
    ? `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(siteUrl)}`
    : undefined;

  const items: NormalizedItem[] = (feed.items ?? []).flatMap((item) => {
    const url = item.link;
    if (!url) return [];
    const guid = item.guid ?? url;
    const content = item.contentEncoded ?? item["content:encoded"] ?? item.content;
    const excerpt = stripHtml(item.contentSnippet ?? item.summary ?? content)?.slice(0, 500);
    return [
      {
        guid,
        url,
        title: (item.title ?? "Untitled").trim(),
        author: item.creator ?? item.author ?? undefined,
        excerpt,
        content,
        publishDate: safeDate(item.isoDate ?? item.pubDate),
        imageUrl: extractFirstImage(content),
      },
    ];
  });

  return {
    title: (feed.title ?? new URL(url).hostname).trim(),
    description: feed.description ?? undefined,
    siteUrl,
    iconUrl,
    items,
  };
}
