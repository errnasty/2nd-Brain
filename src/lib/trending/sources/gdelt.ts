/**
 * GDELT — global news volume.
 *
 * GDELT monitors news worldwide and publishes an open query API with no key,
 * no account and no quota, which makes it the best available answer to "how
 * big is this story globally, in absolute terms". Everything else on offer
 * measures a community's attention (HN points, Reddit upvotes) or an
 * editorial judgement (Google's ranking); GDELT measures raw publication
 * volume across languages and regions.
 *
 * We use DOC 2.0 in `artlist` mode over the last 24h. The article list is
 * enough: the headlines it returns ARE the trending signal once run through
 * term extraction, and the number of distinct outlets behind a story is
 * implicit in how often its terms recur.
 *
 * Docs: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
 */

import { normalizeTerm, rankTerms } from "../terms";
import { normalizeVolume } from "../score";
import { emptyResult, fetchSignal, type SignalResult, type ExternalStory } from "./types";

const ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc";

/**
 * A broad, deliberately generic query. GDELT requires SOME query — there is no
 * "just give me everything" mode — so this asks for the domains the app's desks
 * actually cover rather than a topic-specific slice, and lets term ranking
 * decide what's hot within the results.
 */
const QUERY =
  '(sourcelang:english) (theme:LEADER OR theme:ECON_ OR theme:TAX_FNCACT OR theme:WB_ OR theme:EPU_POLICY OR theme:SCIENCE)';

/** Records to ask for. GDELT caps `maxrecords` at 250. */
const MAX_RECORDS = 200;

/** Articles-per-story at which external volume is considered maxed. */
const VOLUME_SATURATION = 40;

type GdeltArticle = {
  url?: string;
  title?: string;
  domain?: string;
  seendate?: string;
  language?: string;
};

/**
 * GDELT's `seendate` is `YYYYMMDDTHHMMSSZ` — not ISO 8601, and `new Date()`
 * parses it as Invalid Date. Reshape before parsing.
 */
export function parseSeenDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(raw.trim());
  if (!m) {
    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  const [, y, mo, d, h, mi, s] = m;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Group GDELT's flat article list into stories by headline, so `source_count`
 * reflects how many distinct DOMAINS carried each one. That count is the whole
 * reason to prefer GDELT over a plain headline list.
 */
export function groupGdeltArticles(articles: GdeltArticle[]): ExternalStory[] {
  const byTitle = new Map<
    string,
    { title: string; url: string; domains: Set<string>; seen: Date | null }
  >();

  for (const a of articles) {
    const title = (a.title ?? "").trim();
    const url = (a.url ?? "").trim();
    if (!title || !url) continue;
    const key = normalizeTerm(title);
    if (!key) continue;
    const existing = byTitle.get(key);
    const seen = parseSeenDate(a.seendate);
    if (existing) {
      if (a.domain) existing.domains.add(a.domain);
      if (seen && (!existing.seen || seen > existing.seen)) existing.seen = seen;
    } else {
      byTitle.set(key, {
        title,
        url,
        domains: new Set(a.domain ? [a.domain] : []),
        seen,
      });
    }
  }

  return [...byTitle.values()]
    .map((s) => ({
      url: s.url,
      title: s.title,
      outlet: [...s.domains][0] ?? null,
      volume: normalizeVolume(s.domains.size, VOLUME_SATURATION),
      sourceCount: s.domains.size,
      publishedAt: s.seen,
    }))
    .sort((a, b) => b.volume - a.volume);
}

export async function fetchGdelt(): Promise<SignalResult> {
  const url =
    `${ENDPOINT}?query=${encodeURIComponent(QUERY)}` +
    `&mode=artlist&maxrecords=${MAX_RECORDS}&timespan=24h&format=json&sort=hybridrel`;

  const res = await fetchSignal(url);
  if (!res) return emptyResult("gdelt", "fetch failed");

  let parsed: { articles?: GdeltArticle[] };
  try {
    // GDELT answers malformed JSON (or an HTML error page) under load often
    // enough that this needs to be a caught case, not an exceptional one.
    parsed = (await res.json()) as { articles?: GdeltArticle[] };
  } catch {
    return emptyResult("gdelt", "unparseable response");
  }

  const stories = groupGdeltArticles(parsed.articles ?? []);
  if (stories.length === 0) return emptyResult("gdelt", "no articles");

  const terms = rankTerms(
    stories.map((s) => ({ title: s.title, weight: s.volume || 0.1 })),
    // minCount 2: with 200 records, a phrase appearing once is noise. GDELT is
    // the noisiest source precisely because it is the broadest.
    { limit: 60, minCount: 2 },
  );

  return { source: "gdelt", terms, stories: stories.slice(0, 40) };
}
