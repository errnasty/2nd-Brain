/**
 * The contract every public trending signal implements.
 *
 * The sources are wildly different — GDELT counts articles worldwide, Hacker
 * News counts upvotes, Google News publishes a ranked list, Google Trends
 * publishes search spikes. Rather than teach the scorer about each of them,
 * every source normalizes into the same two shapes:
 *
 *   - `terms`: what the world is talking about, weighted 0–1 WITHIN that
 *     source. Used to boost the user's own articles.
 *   - `stories`: specific big articles, used only for the "you're missing this"
 *     section. Never mixed into the user's queue.
 *
 * Normalizing inside each source is what stops whichever signal happens to use
 * the largest raw numbers from dominating the blend.
 */

/** Source ids, also the value stored in `trending_terms.source`. */
export const TRENDING_SOURCES = ["gdelt", "gnews", "trends", "hn"] as const;
export type TrendingSourceId = (typeof TRENDING_SOURCES)[number];

export type TrendingTerm = {
  /** Normalized by `normalizeTerm` — lowercase, punctuation-stripped. */
  term: string;
  /** 0–1 within this source. */
  weight: number;
  /** Desk id from `src/lib/today/topics.ts`, when the source implies one. */
  topicId?: string | null;
};

export type ExternalStory = {
  url: string;
  title: string;
  outlet?: string | null;
  topicId?: string | null;
  /** 0–1 within this source. */
  volume: number;
  /** Distinct outlets, where the source reports it. */
  sourceCount?: number;
  publishedAt?: Date | null;
};

export type SignalResult = {
  source: TrendingSourceId;
  terms: TrendingTerm[];
  stories: ExternalStory[];
  /** Set when the source failed; the run continues without it. */
  error?: string;
};

export function emptyResult(source: TrendingSourceId, error?: string): SignalResult {
  return { source, terms: [], stories: [], error };
}

/**
 * A real browser UA. Plain bot UAs get 403'd by Cloudflare/WAF on a lot of news
 * infrastructure — same reason `src/lib/rss/parser.ts` sends one.
 */
export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Per-source fetch timeout. Kept well under the cron's own wall-clock budget so
 * one unresponsive endpoint aborts itself rather than eating the whole run —
 * the sources are fetched in parallel, so this is the ceiling for all of them
 * together, not each.
 */
export const SIGNAL_TIMEOUT_MS = 4000;

/**
 * Fetch with a bounded timeout and a browser UA. Returns null instead of
 * throwing: a dead signal must degrade the score, never fail the run.
 */
export async function fetchSignal(
  url: string,
  init: RequestInit = {},
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SIGNAL_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { "user-agent": BROWSER_UA, accept: "*/*", ...(init.headers ?? {}) },
    });
    return res.ok ? res : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
