/**
 * Fetching the public trending signals and persisting them.
 *
 * These tables are GLOBAL, not per-user: "what is the world talking about" has
 * one answer, so the refresh happens once per cron run and every user's scoring
 * pass reads the result. Doing it per-user would multiply identical requests
 * against four free endpoints by the size of the user base — the fastest way to
 * get an app blocked from services that are generously not charging for this.
 */

import { and, desc, gte, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { externalStories, trendingTerms } from "@/lib/db/schema";
import { classifyArticle } from "@/lib/today/topics";
import { trendingDayStart } from "./day";
import { fetchGdelt } from "./sources/gdelt";
import { fetchGoogleNews } from "./sources/gnews";
import { fetchHackerNews } from "./sources/hn";
import { fetchGoogleTrends } from "./sources/trends";
import type { SignalResult } from "./sources/types";
import type { WeightedTerm } from "./terms";

/**
 * How long a signal fetch stays fresh. The signals move on the order of hours,
 * and the cron may run far more often than that (it also has per-user work to
 * do), so re-fetching on every run would be pure waste — and rude to four free
 * endpoints.
 */
export const SIGNAL_TTL_MINUTES = 60;

/** Terms older than this are ignored even if a refresh has failed since. */
export const TERM_MAX_AGE_HOURS = 12;

/** External stories older than this stop being "what you're missing". */
export const STORY_MAX_AGE_HOURS = 36;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** Whether the global signal tables are stale enough to warrant a refresh. */
export async function signalsAreStale(now: Date = new Date()): Promise<boolean> {
  try {
    const [row] = await db
      .select({ fetchedAt: trendingTerms.fetchedAt })
      .from(trendingTerms)
      .orderBy(desc(trendingTerms.fetchedAt))
      .limit(1);
    if (!row) return true;
    return now.getTime() - row.fetchedAt.getTime() > SIGNAL_TTL_MINUTES * MINUTE_MS;
  } catch {
    // Can't tell → assume stale. A redundant refresh is cheap; running forever
    // on terms from last week is not.
    return true;
  }
}

export type SignalRefresh = {
  sources: { source: string; terms: number; stories: number; error?: string }[];
  termsWritten: number;
  storiesWritten: number;
};

/**
 * Refresh all four signals and store them.
 *
 * Every source is fetched in parallel and settled independently: a source that
 * times out, rate-limits or changes its response shape contributes nothing and
 * the run continues on the rest. Trending degrades gracefully all the way down
 * to pure local corroboration, which still works with zero external input.
 */
export async function refreshSignals(now: Date = new Date()): Promise<SignalRefresh> {
  const settled = await Promise.allSettled([
    fetchGdelt(),
    fetchGoogleNews(),
    fetchHackerNews(),
    fetchGoogleTrends(),
  ]);

  const results: SignalResult[] = settled.flatMap((s) =>
    s.status === "fulfilled" ? [s.value] : [],
  );

  const termRows = results.flatMap((r) =>
    r.terms.map((t) => ({
      term: t.term,
      source: r.source,
      weight: t.weight,
      topicId: t.topicId ?? null,
      fetchedAt: now,
    })),
  );

  const storyRows = results.flatMap((r) =>
    r.stories.map((s) => ({
      url: s.url,
      title: s.title,
      outlet: s.outlet ?? null,
      source: r.source,
      // Classify with the same desk keywords the brief uses, so an external
      // story lands on the same desk an equivalent article from the user's own
      // feeds would. Sources that already declare a topic keep theirs.
      topicId: s.topicId ?? classifyArticle({ title: s.title, feedTitle: s.outlet ?? null }),
      volume: s.volume,
      sourceCount: s.sourceCount ?? 1,
      publishedAt: s.publishedAt ?? null,
      fetchedAt: now,
    })),
  );

  let termsWritten = 0;
  let storiesWritten = 0;

  if (termRows.length > 0) {
    try {
      // Upsert on (term, source): a term that is still trending gets its weight
      // and timestamp refreshed rather than accumulating duplicate rows.
      await db
        .insert(trendingTerms)
        .values(termRows)
        .onConflictDoUpdate({
          target: [trendingTerms.term, trendingTerms.source],
          set: {
            weight: sql`excluded.weight`,
            topicId: sql`excluded.topic_id`,
            fetchedAt: sql`excluded.fetched_at`,
          },
        });
      termsWritten = termRows.length;
    } catch (err) {
      console.error("[trending] term write failed:", err instanceof Error ? err.message : err);
    }
  }

  if (storyRows.length > 0) {
    try {
      await db
        .insert(externalStories)
        .values(storyRows)
        .onConflictDoUpdate({
          target: externalStories.url,
          set: {
            title: sql`excluded.title`,
            volume: sql`excluded.volume`,
            sourceCount: sql`excluded.source_count`,
            topicId: sql`excluded.topic_id`,
            fetchedAt: sql`excluded.fetched_at`,
          },
        });
      storiesWritten = storyRows.length;
    } catch (err) {
      console.error("[trending] story write failed:", err instanceof Error ? err.message : err);
    }
  }

  await pruneSignals(now);

  return {
    sources: results.map((r) => ({
      source: r.source,
      terms: r.terms.length,
      stories: r.stories.length,
      error: r.error,
    })),
    termsWritten,
    storiesWritten,
  };
}

/**
 * Drop expired rows. Without this both tables grow without bound — they're
 * append-mostly caches of a moving target, and yesterday's trends actively
 * mislead the scorer rather than merely wasting space.
 */
async function pruneSignals(now: Date): Promise<void> {
  try {
    await db
      .delete(trendingTerms)
      .where(lt(trendingTerms.fetchedAt, new Date(now.getTime() - TERM_MAX_AGE_HOURS * HOUR_MS)));
    await db
      .delete(externalStories)
      .where(
        lt(externalStories.fetchedAt, new Date(now.getTime() - STORY_MAX_AGE_HOURS * HOUR_MS)),
      );
  } catch (err) {
    console.error("[trending] prune failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * The current trending terms, collapsed across sources.
 *
 * A term found by several independent signals is far stronger evidence than one
 * found by a single source, so overlapping weights are combined with
 * diminishing returns rather than replaced by the maximum — but the result is
 * still capped at 1 so no term can outrun the score model.
 */
export async function loadTrendingTerms(now: Date = new Date()): Promise<WeightedTerm[]> {
  let rows: { term: string; weight: number }[] = [];
  try {
    rows = await db
      .select({ term: trendingTerms.term, weight: trendingTerms.weight })
      .from(trendingTerms)
      .where(gte(trendingTerms.fetchedAt, new Date(now.getTime() - TERM_MAX_AGE_HOURS * HOUR_MS)));
  } catch {
    return [];
  }

  const merged = new Map<string, number>();
  for (const r of rows) {
    const prev = merged.get(r.term) ?? 0;
    // prev + w*(1-prev): monotonic, saturating at 1.
    merged.set(r.term, prev + r.weight * (1 - prev));
  }
  return [...merged.entries()].map(([term, weight]) => ({ term, weight }));
}

export type ExternalStoryRow = {
  id: string;
  url: string;
  title: string;
  outlet: string | null;
  topicId: string | null;
  volume: number;
  sourceCount: number;
  publishedAt: Date | null;
};

/**
 * The biggest external stories of the day, for the "you're missing" section.
 *
 * Two age tests, because they catch different failures. `fetched_at` bounds how
 * stale our *knowledge* is — it's the only guard when a source doesn't report a
 * date, and it's what the prune uses. `published_at` bounds how old the *story*
 * is, and is the one that matters here: a still-referenced piece from Tuesday
 * can go on being re-fetched with a fresh timestamp for a day and a half, and
 * without this test it would sit in a section that tells the reader, in those
 * words, that these are the stories of the last day.
 *
 * A story with no `published_at` is kept. Not every source reports one, and
 * dropping them would quietly reduce the section to whichever sources happen
 * to — the freshness of the fetch is a weaker guarantee, but it is a real one.
 */
export async function loadExternalStories(
  limit: number,
  now: Date = new Date(),
): Promise<ExternalStoryRow[]> {
  try {
    return await db
      .select({
        id: externalStories.id,
        url: externalStories.url,
        title: externalStories.title,
        outlet: externalStories.outlet,
        topicId: externalStories.topicId,
        volume: externalStories.volume,
        sourceCount: externalStories.sourceCount,
        publishedAt: externalStories.publishedAt,
      })
      .from(externalStories)
      .where(
        and(
          gte(
            externalStories.fetchedAt,
            new Date(now.getTime() - STORY_MAX_AGE_HOURS * HOUR_MS),
          ),
          or(
            isNull(externalStories.publishedAt),
            gte(externalStories.publishedAt, trendingDayStart(now)),
          ),
        ),
      )
      .orderBy(desc(externalStories.volume), desc(externalStories.fetchedAt))
      .limit(limit);
  } catch {
    return [];
  }
}
