/**
 * Google Trends — what people are searching for right now.
 *
 * The only signal here that measures *demand* rather than supply. The others
 * count what publishers produced or what an audience upvoted; this counts what
 * people went looking for, which sometimes leads coverage by hours.
 *
 * It's also the noisiest by a distance — daily trends are dominated by sport,
 * celebrity and TV, none of which the app's desks care about — so its terms are
 * capped low and it contributes no stories at all, only keywords.
 *
 * The daily-trends RSS feed is keyless and public.
 */

import { XMLParser } from "fast-xml-parser";
import { normalizeTerm } from "../terms";
import { emptyResult, fetchSignal, type SignalResult, type TrendingTerm } from "./types";

const ENDPOINT = "https://trends.google.com/trending/rss?geo=US";

/**
 * Kept deliberately small. Google Trends ranks by search volume, and search
 * volume is a popularity contest that a news brief has no business being
 * reordered by — these terms are a nudge, not a driver.
 */
const MAX_TERMS = 15;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

type TrendItem = { title?: string; "ht:approx_traffic"?: string };

/**
 * "200,000+" → 200000. Traffic is the only weight the feed offers; without
 * parsing it every trend would arrive equally weighted and the top search of
 * the day would rank level with the twentieth.
 */
export function parseTraffic(raw: string | undefined): number {
  if (!raw) return 0;
  const digits = raw.replace(/[^0-9]/g, "");
  const n = Number(digits);
  return Number.isFinite(n) ? n : 0;
}

export function toTerms(items: TrendItem[]): TrendingTerm[] {
  const parsed = items
    .map((it) => ({
      term: normalizeTerm(typeof it.title === "string" ? it.title : ""),
      traffic: parseTraffic(it["ht:approx_traffic"]),
    }))
    // Single-word trends are almost always a person or a team, which match
    // arbitrary articles; multi-word trends are far likelier to be an event.
    .filter((t) => t.term.length >= 3);

  if (parsed.length === 0) return [];
  const max = Math.max(...parsed.map((p) => p.traffic), 1);

  return parsed
    .map((p) => ({
      term: p.term,
      // Rank order is a usable fallback when the feed omits traffic entirely.
      weight: p.traffic > 0 ? p.traffic / max : 0.3,
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_TERMS);
}

export async function fetchGoogleTrends(): Promise<SignalResult> {
  const res = await fetchSignal(ENDPOINT);
  if (!res) return emptyResult("trends", "fetch failed");

  let xml: string;
  try {
    xml = await res.text();
  } catch {
    return emptyResult("trends", "unreadable response");
  }

  let items: TrendItem[];
  try {
    const doc = parser.parse(xml) as {
      rss?: { channel?: { item?: TrendItem | TrendItem[] } };
    };
    const raw = doc?.rss?.channel?.item;
    items = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
  } catch {
    return emptyResult("trends", "unparseable feed");
  }

  const terms = toTerms(items);
  if (terms.length === 0) return emptyResult("trends", "no trends");

  return { source: "trends", terms, stories: [] };
}
