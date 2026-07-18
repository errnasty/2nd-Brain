/**
 * Provider-agnostic web search + page fetch — no Anthropic dependency, so it
 * works with any OpenRouter model. Uses DuckDuckGo's HTML endpoint (free, no
 * API key) and Jina Reader (r.jina.ai) for clean article-text extraction.
 *
 * Token efficiency is the whole point: we fetch only a few results, extract
 * ~2k chars each, and return a compact brief the caller folds into its prompt
 * — not raw HTML. That keeps the grounding cost to a few hundred tokens.
 */

export type WebSnippet = {
  title: string;
  url: string;
  /** Cleaned, length-capped body text from the page (or DDG's snippet). */
  text: string;
};

const MAX_SNIPPETS = 2;
const MAX_CHARS_PER_SNIPPET = 1800;
// Aggressive timeouts: the whole grounding pass (search + N page fetches) must
// finish well under the server-action limit so it never pushes the total
// (grounding + AI generation) past Next.js's "unexpected response" threshold.
// 4s per fetch × 2 pages = ~8s worst case; the AI call gets the rest.
const FETCH_TIMEOUT_MS = 4000;

/** Search DuckDuckGo and return the top result URLs + titles. */
export async function searchWeb(query: string, max = MAX_SNIPPETS): Promise<{ title: string; url: string }[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 SecondBrain/1.0",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`DuckDuckGo search failed: ${res.status}`);
  const html = await res.text();
  // DDG wraps result URLs in a redirect: href="//duckduckgo.com/l/?uddg=<real>"
  const out: { title: string; url: string }[] = [];
  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < max) {
    const href = m[1];
    const title = m[2].trim();
    const u = new URL(href.startsWith("//") ? `https:${href}` : href);
    // Unwrap the DDG redirect to get the real article URL.
    const real = u.searchParams.get("uddg") ?? href;
    try {
      const parsed = new URL(real);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        out.push({ title, url: parsed.toString() });
      }
    } catch {
      // skip unparseable
    }
  }
  return out;
}

/**
 * Fetch a page's main text via Jina Reader (https://r.jina.ai/<url>), which
 * returns clean markdown — far smaller than raw HTML and already chunked to
 * the readable content. Falls back to DDG's snippet if the fetch fails.
 */
export async function fetchPageText(url: string, title: string): Promise<string> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { "Accept": "text/plain", "X-Return-Format": "text" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.ok) {
      const text = (await res.text()).trim();
      if (text.length > 60) return text.slice(0, MAX_CHARS_PER_SNIPPET);
    }
  } catch {
    // fall through to snippet
  }
  return title; // last-resort: just the title
}

/**
 /** One-shot: search + fetch + clean → a compact array of snippets ready to
  * inject into a prompt. Failures are swallowed (returns whatever we got, even
  * an empty array) so callers can degrade to an ungrounded generation. The
  * entire pass is hard-capped at 10s so it can never push a server action past
  * its time limit. */
 export async function groundFromWeb(query: string): Promise<WebSnippet[]> {
   try {
     const result = await Promise.race([
       (async () => {
         const results = await searchWeb(query);
         if (results.length === 0) return [];
         const snippets = await Promise.all(
           results.map(async (r) => ({
             title: r.title,
             url: r.url,
             text: await fetchPageText(r.url, r.title),
           })),
         );
         return snippets.filter((s) => s.text.length > 0);
       })(),
       // Hard cap: 10s regardless of how many fetches are in flight.
       new Promise<WebSnippet[]>((resolve) => setTimeout(() => resolve([]), 10000)),
     ]);
     return result;
   } catch {
     return [];
   }
 }

/** Render snippets into a compact prompt block (a few hundred tokens max). */
export function formatWebGround(snippets: WebSnippet[]): string {
  if (snippets.length === 0) return "(no web results)";
  return snippets
    .map((s, i) => `[${i + 1}] ${s.title}\n${s.url}\n${s.text.slice(0, 600)}`)
    .join("\n\n");
}
