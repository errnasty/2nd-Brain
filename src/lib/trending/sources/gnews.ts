/**
 * Google News — editorially ranked top stories, as RSS.
 *
 * Free, keyless, and already parseable with the `rss-parser` dependency the
 * app uses for feeds. What it adds over GDELT is *judgement*: GDELT tells you
 * how much was published, Google News tells you what a ranking system thinks
 * leads. Volume and prominence disagree often enough (a slow-burn story with
 * huge volume versus a breaking one with little) that having both is worth it.
 *
 * Rank position is the weight: Google News RSS returns items in ranked order,
 * so position 1 is the day's lead. That ordering is the entire signal here —
 * the feed carries no scores.
 */

import { XMLParser } from "fast-xml-parser";
import { rankTerms } from "../terms";
import { emptyResult, fetchSignal, type ExternalStory, type SignalResult } from "./types";

/**
 * Per-desk topic feeds plus the global top-stories feed. Mapping each to a desk
 * id from `src/lib/today/topics.ts` means an external story arrives already
 * filed, so the brief's "you're missing" section can be grouped by desk without
 * re-classifying anything.
 */
const FEEDS: { url: string; topicId: string | null }[] = [
  { url: "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en", topicId: null },
  {
    url: "https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en",
    topicId: "geopolitics",
  },
  {
    url: "https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-US&gl=US&ceid=US:en",
    topicId: "tech",
  },
  {
    url: "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en",
    topicId: "markets",
  },
  {
    url: "https://news.google.com/rss/headlines/section/topic/SCIENCE?hl=en-US&gl=US&ceid=US:en",
    topicId: "science",
  },
  {
    url: "https://news.google.com/rss/headlines/section/topic/HEALTH?hl=en-US&gl=US&ceid=US:en",
    topicId: "health",
  },
];

/** Items to take from each feed. The tail of a ranked list isn't trending. */
const ITEMS_PER_FEED = 12;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

/**
 * Google News titles arrive as "Real headline text - The Publisher". Splitting
 * the outlet off matters twice over: the headline is what gets term-extracted
 * (and " - Reuters" on every item would rank "reuters" as the hottest term in
 * the world), and the outlet is worth displaying.
 *
 * Headlines contain dashes of their own ("Why the U.S. - and everyone else - is
 * watching the Fed"), so the tail has to actually look like a publisher before
 * we treat it as one. Word count is the discriminator that length alone isn't:
 * publisher names are almost always one to four words ("Reuters", "The Wall
 * Street Journal"), while a mid-sentence fragment runs longer even when it's
 * short in characters.
 */
const MAX_OUTLET_CHARS = 40;
const MAX_OUTLET_WORDS = 5;

export function splitOutlet(rawTitle: string): { title: string; outlet: string | null } {
  const idx = rawTitle.lastIndexOf(" - ");
  if (idx <= 0) return { title: rawTitle.trim(), outlet: null };

  const tail = rawTitle.slice(idx + 3).trim();
  const words = tail.split(/\s+/).filter(Boolean);
  if (!tail || tail.length > MAX_OUTLET_CHARS || words.length > MAX_OUTLET_WORDS) {
    return { title: rawTitle.trim(), outlet: null };
  }

  return { title: rawTitle.slice(0, idx).trim(), outlet: tail };
}

/** Rank position → weight in (0, 1]. Position 1 leads; the tail tapers off. */
export function rankWeight(position: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0.05, 1 - position / Math.max(total, 1));
}

type RssItem = { title?: string; link?: string; pubDate?: string; source?: unknown };

function itemsOf(xml: string): RssItem[] {
  const doc = parser.parse(xml) as {
    rss?: { channel?: { item?: RssItem | RssItem[] } };
  };
  const raw = doc?.rss?.channel?.item;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

async function fetchOne(
  feed: { url: string; topicId: string | null },
): Promise<ExternalStory[]> {
  const res = await fetchSignal(feed.url);
  if (!res) return [];
  let xml: string;
  try {
    xml = await res.text();
  } catch {
    return [];
  }

  let items: RssItem[];
  try {
    items = itemsOf(xml).slice(0, ITEMS_PER_FEED);
  } catch {
    return [];
  }

  return items.flatMap((item, i) => {
    const rawTitle = typeof item.title === "string" ? item.title : "";
    const link = typeof item.link === "string" ? item.link : "";
    if (!rawTitle || !link) return [];
    const { title, outlet } = splitOutlet(rawTitle);
    if (!title) return [];
    const published = item.pubDate ? new Date(item.pubDate) : null;
    return [
      {
        url: link,
        title,
        outlet,
        topicId: feed.topicId,
        volume: rankWeight(i, ITEMS_PER_FEED),
        sourceCount: 1,
        publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
      },
    ];
  });
}

export async function fetchGoogleNews(): Promise<SignalResult> {
  // In parallel: these are six independent requests against the same host and
  // each is already timeout-bounded, so serial fetching would just multiply the
  // worst case by six for no benefit.
  const settled = await Promise.allSettled(FEEDS.map(fetchOne));
  const stories = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));

  if (stories.length === 0) return emptyResult("gnews", "no items");

  const terms = rankTerms(
    stories.map((s) => ({ title: s.title, weight: s.volume })),
    { limit: 50, minCount: 1 },
  );

  return { source: "gnews", terms, stories };
}
