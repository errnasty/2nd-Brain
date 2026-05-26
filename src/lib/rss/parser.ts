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

const parser: Parser<{}, CustomItem> = new Parser({
  timeout: 15_000,
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; SecondBrainBot/1.0; +https://github.com/)",
    Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
  },
  customFields: {
    item: [
      ["content:encoded", "contentEncoded"],
      ["media:thumbnail", "mediaThumbnail"],
    ],
  },
});

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
  const feed = await parser.parseURL(url);
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
