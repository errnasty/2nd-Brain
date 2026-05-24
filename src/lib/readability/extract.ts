import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export type ExtractedArticle = {
  title?: string;
  byline?: string;
  excerpt?: string;
  content: string;        // sanitized HTML body
  textContent: string;    // plain text (for embeddings / token counts)
  length: number;         // approx char count
  siteName?: string;
  publishedTime?: string;
};

const FETCH_TIMEOUT_MS = 15_000;

const SAFE_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: SAFE_HEADERS,
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

export async function extractReadable(url: string): Promise<ExtractedArticle> {
  const html = await fetchHtml(url);
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const result = reader.parse();
  if (!result) throw new Error("Readability failed to parse the page");

  return {
    title: result.title ?? undefined,
    byline: result.byline ?? undefined,
    excerpt: result.excerpt ?? undefined,
    content: result.content ?? "",
    textContent: result.textContent ?? "",
    length: result.length ?? 0,
    siteName: result.siteName ?? undefined,
    publishedTime: result.publishedTime ?? undefined,
  };
}
