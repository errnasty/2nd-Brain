/**
 * Hacker News — real engagement numbers for the tech and AI desks.
 *
 * The only free source here that reports actual measured attention rather than
 * publication volume or an editor's ranking: points and comment counts are
 * votes by a large audience. That makes it the strongest signal the app has for
 * the AI/tech/security desks, and close to useless for everything else — which
 * is fine, because the blend is per-story and the other sources cover the rest.
 *
 * The Firebase API is keyless and public, but it's one HTTP request PER ITEM,
 * which is the wrong shape for a time-boxed cron. So we use Algolia's HN search
 * endpoint instead: one request returns the whole front page with scores
 * attached.
 */

import { rankTerms } from "../terms";
import { normalizeVolume } from "../score";
import { emptyResult, fetchSignal, type ExternalStory, type SignalResult } from "./types";

/** One request, front-page stories from the last 24h, ranked by points. */
const ENDPOINT =
  "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=50";

/** Points at which a story is considered maximally hot. */
const POINTS_SATURATION = 600;

/**
 * Comments are weighted in at a fraction of points: a high comment-to-point
 * ratio often means an argument rather than a story, so discussion counts, but
 * counts for less than agreement that something matters.
 */
const COMMENT_WEIGHT = 0.4;

type HnHit = {
  title?: string | null;
  url?: string | null;
  points?: number | null;
  num_comments?: number | null;
  objectID?: string;
  created_at?: string | null;
};

export function hnVolume(points: number, comments: number): number {
  return normalizeVolume(Math.max(0, points) + COMMENT_WEIGHT * Math.max(0, comments), POINTS_SATURATION);
}

export function toStories(hits: HnHit[]): ExternalStory[] {
  return hits.flatMap((h) => {
    const title = (h.title ?? "").trim();
    if (!title) return [];
    // Ask HN / Show HN posts have no external url — link the discussion.
    const url = (h.url ?? "").trim() || (h.objectID ? `https://news.ycombinator.com/item?id=${h.objectID}` : "");
    if (!url) return [];
    const created = h.created_at ? new Date(h.created_at) : null;
    return [
      {
        url,
        title,
        outlet: "Hacker News",
        // HN's front page is overwhelmingly this desk; filing it up front
        // spares the classifier a guess it would often get wrong on terse
        // engineering headlines.
        topicId: "tech",
        volume: hnVolume(h.points ?? 0, h.num_comments ?? 0),
        sourceCount: 1,
        publishedAt: created && !Number.isNaN(created.getTime()) ? created : null,
      },
    ];
  });
}

export async function fetchHackerNews(): Promise<SignalResult> {
  const res = await fetchSignal(ENDPOINT);
  if (!res) return emptyResult("hn", "fetch failed");

  let parsed: { hits?: HnHit[] };
  try {
    parsed = (await res.json()) as { hits?: HnHit[] };
  } catch {
    return emptyResult("hn", "unparseable response");
  }

  const stories = toStories(parsed.hits ?? []);
  if (stories.length === 0) return emptyResult("hn", "no hits");

  const terms = rankTerms(
    stories.map((s) => ({ title: s.title, weight: s.volume })),
    { limit: 40, minCount: 1 },
  ).map((t) => ({ ...t, topicId: "tech" }));

  return { source: "hn", terms, stories };
}
