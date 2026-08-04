/**
 * The per-user trending pass: read the recent window, cluster it into stories,
 * score them, write the scores back.
 *
 * ## Shape of the work
 *
 * Three queries in, two writes out, and everything in between is arithmetic in
 * process. That's deliberate. The naive version asks pgvector for each
 * article's neighbours and the database for each cluster's members, which is
 * hundreds of round trips inside a function the platform kills at ~10s. Here
 * the round trips are constant and the per-article cost is CPU, which is the
 * resource we have plenty of.
 *
 * ## No model calls
 *
 * Nothing in this file talks to an LLM. Trending has to run over every article
 * for every user on a schedule; anything per-article and paid would make it
 * unaffordable, and worse, non-deterministic — the same queue would rank
 * differently on each run. Same reasoning as the keyword desk classifier in
 * `src/lib/today/topics.ts`.
 *
 * ## Two windows, deliberately
 *
 * The pass READS 48 hours but SCORES one day (`src/lib/trending/day.ts`). What
 * comes out of it is the trending articles *for the day*, and nothing else
 * carries a score at all.
 *
 * The wider read window is not a contradiction — it's what makes the day's
 * scores correct. Corroboration and velocity are properties of a story, not of
 * an article, and a story that broke at eleven last night has most of its
 * evidence on the far side of the boundary. Clustering over 48 hours lets this
 * morning's telling inherit the full "nine outlets, six hours" picture; scoring
 * only the day's tellings keeps yesterday's copies out of today's ranking.
 */

import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { articles, storyClusters } from "@/lib/db/schema";
import { classifyArticle } from "@/lib/today/topics";
import { clusterArticles, cosine, representativeTitle, type ClusterableArticle } from "./cluster";
import { isWithinTrendingDay, trendingDayStart } from "./day";
import { externalHeat, personalRelevance, scoreCluster } from "./score";
import { loadTrendingTerms } from "./signals";
import { matchTerms, type WeightedTerm } from "./terms";

/**
 * Hours of articles read into the pass — the CLUSTERING window, not the scoring
 * one. An article outside it can't join a cluster anyway, so fetching it would
 * be waste; an article inside it but outside the day joins clusters and lends
 * them its corroboration, and then scores 0 (see the header).
 */
export const WINDOW_HOURS = 48;

/**
 * Ceiling on articles per pass. The clustering is O(n²) and every row carries a
 * 1024-dimension embedding over the wire, so this is the knob that bounds both
 * the CPU and the bytes. 250 articles is roughly two days of a heavy feed list;
 * beyond that the tail is old enough that recency decay has flattened it to
 * nothing regardless.
 */
export const MAX_ARTICLES = 250;

/** User material sampled to build the interest centroid. */
const INTEREST_SAMPLE = 200;

const HOUR_MS = 60 * 60 * 1000;

/**
 * pgvector renders as `[0.1,0.2,…]`. Returns null rather than throwing on
 * anything unexpected — a malformed vector should cost that one article its
 * embedding, not fail the run.
 */
export function parseVector(raw: unknown): number[] | null {
  if (typeof raw !== "string" || raw.length < 3) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const nums = parsed.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
    return nums.length === parsed.length && nums.length > 0 ? nums : null;
  } catch {
    return null;
  }
}

/** Component-wise mean of some vectors — the user's "interests", as one point. */
export function centroid(vectors: number[][]): number[] | null {
  const usable = vectors.filter((v) => v.length > 0);
  if (usable.length === 0) return null;
  const dims = usable[0].length;
  const sum = new Array<number>(dims).fill(0);
  let counted = 0;
  for (const v of usable) {
    if (v.length !== dims) continue; // mixed dimensions: a stale embedding model
    for (let i = 0; i < dims; i += 1) sum[i] += v[i];
    counted += 1;
  }
  if (counted === 0) return null;
  return sum.map((s) => s / counted);
}

type ArticleRow = {
  id: string;
  title: string;
  url: string;
  excerpt: string | null;
  feed_id: string;
  publish_date: Date | string | null;
  starred: boolean;
  feed_title: string | null;
  embedding: string | null;
};

type WindowArticle = ClusterableArticle & {
  url: string;
  excerpt: string | null;
  feedTitle: string | null;
  starred: boolean;
};

function asDate(v: Date | string | null): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * The recent window with embeddings attached.
 *
 * Only chunk 0 is joined: articles are embedded as a single chunk of
 * title + lead (see `src/lib/embeddings/backfill.ts`), and a LEFT join keeps
 * articles the backfill hasn't reached yet — they still cluster on headline
 * overlap, just not semantically.
 */
async function fetchWindow(userId: string, now: Date): Promise<WindowArticle[]> {
  const since = new Date(now.getTime() - WINDOW_HOURS * HOUR_MS);
  const res = (await db.execute(sql`
    select
      a.id, a.title, a.url, a.excerpt, a.feed_id, a.publish_date, a.starred,
      f.title as feed_title,
      e.embedding::text as embedding
    from articles a
    inner join feeds f on f.id = a.feed_id
    left join article_embeddings e on e.article_id = a.id and e.chunk_index = 0
    where a.user_id = ${userId}
      and a.publish_date >= ${since.toISOString()}
    order by a.publish_date desc
    limit ${MAX_ARTICLES}
  `)) as unknown as { rows?: ArticleRow[] } | ArticleRow[];

  const rows = Array.isArray(res) ? res : (res.rows ?? []);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url,
    feedId: r.feed_id,
    publishDate: asDate(r.publish_date),
    embedding: parseVector(r.embedding),
    excerpt: r.excerpt,
    feedTitle: r.feed_title,
    starred: r.starred,
  }));
}

/**
 * A single vector standing for what this user cares about, averaged over their
 * saved items and notes.
 *
 * One centroid rather than per-item similarity is a real simplification — it
 * blurs a user with several unrelated interests towards the middle of them. It
 * buys one query instead of one per cluster, and personal relevance is only
 * 20% of the blend and mostly a tie-breaker, so precision here is worth less
 * than keeping the pass inside its time budget.
 */
async function fetchInterestCentroid(userId: string): Promise<number[] | null> {
  try {
    const res = (await db.execute(sql`
      select embedding::text as embedding
      from directory_items
      where user_id = ${userId} and embedding is not null
      order by updated_at desc
      limit ${INTEREST_SAMPLE}
    `)) as unknown as { rows?: { embedding: string | null }[] } | { embedding: string | null }[];
    const rows = Array.isArray(res) ? res : (res.rows ?? []);
    const vectors = rows
      .map((r) => parseVector(r.embedding))
      .filter((v): v is number[] => v !== null);
    return centroid(vectors);
  } catch {
    // A user with no Directory items, or a pending migration — personal
    // relevance simply contributes nothing.
    return null;
  }
}

export type TrendingPassResult = {
  articles: number;
  clusters: number;
  scored: number;
};

/**
 * Recompute trending for one user. Returns counts; never throws — a failure for
 * one user must not stop the cron working through the rest.
 */
export async function computeTrendingForUser(
  userId: string,
  opts: { followedTopics?: string[]; now?: Date } = {},
): Promise<TrendingPassResult> {
  const now = opts.now ?? new Date();
  const followed = new Set(opts.followedTopics ?? []);

  const [window, terms, interest] = await Promise.all([
    fetchWindow(userId, now),
    loadTrendingTerms(now),
    fetchInterestCentroid(userId),
  ]);

  if (window.length === 0) return { articles: 0, clusters: 0, scored: 0 };

  const byId = new Map(window.map((a) => [a.id, a]));
  const clusters = clusterArticles(window);

  const clusterRows: (typeof storyClusters.$inferInsert)[] = [];
  // article id → the score and cluster it ends up with.
  const assignments: { articleId: string; score: number; clusterKey: number }[] = [];

  clusters.forEach((cluster, index) => {
    const members = cluster.articleIds
      .map((id) => byId.get(id))
      .filter((a): a is WindowArticle => a !== undefined);
    if (members.length === 0) return;

    const title = representativeTitle(members.map((m) => m.title));
    const topicId = classifyArticle({
      title,
      excerpt: members[0].excerpt,
      feedTitle: members[0].feedTitle,
    });

    // External heat is measured on the cluster's best headline plus its lead,
    // not on every member: the members are tellings of the same story, so
    // matching them all would just multiply one story's terms by its size —
    // double-counting corroboration, which is already its own term.
    const matched: WeightedTerm[] = matchTerms({ title, excerpt: members[0].excerpt }, terms);
    const heat = externalHeat(matched);

    const memberVectors = members
      .map((m) => m.embedding)
      .filter((v): v is number[] => Array.isArray(v) && v.length > 0);
    const clusterVector = centroid(memberVectors);
    const similarity = interest && clusterVector ? cosine(clusterVector, interest) : 0;

    const onFollowedDesk = followed.has(topicId);
    const personal = personalRelevance({
      similarity,
      onFollowedDesk,
      starredInCluster: members.some((m) => m.starred),
    });

    const scored = scoreCluster(
      {
        distinctFeeds: cluster.distinctFeeds,
        firstSeen: cluster.firstSeen,
        lastSeen: cluster.lastSeen,
        externalVolume: heat,
        personalScore: personal,
        onFollowedDesk,
      },
      now,
    );

    // The member whose headline was chosen as representative is also the copy
    // to link to, so the cluster's title and link come from the same telling.
    const best = members.find((m) => m.title === title) ?? members[0];

    clusterRows.push({
      userId,
      title,
      url: best.url,
      sourceCount: cluster.distinctFeeds,
      articleCount: members.length,
      firstSeen: cluster.firstSeen,
      lastSeen: cluster.lastSeen,
      velocity: scored.velocity,
      externalVolume: heat,
      personalScore: personal,
      score: scored.score,
      topicId,
      computedAt: now,
    });

    for (const m of members) {
      assignments.push({
        articleId: m.id,
        // Every telling of a story inherits the story's score — they are the
        // same news, and ranking one Reuters copy above another because of a
        // wording difference would be noise dressed as signal — but only the
        // tellings published within the day do. This is what makes the pass
        // return TODAY's trending articles: a story that ran yesterday and is
        // still running scores its fresh tellings and leaves the stale copies
        // at zero, so the reader is pointed at the current write-up rather than
        // at last night's first take of the same events.
        score: isWithinTrendingDay(m.publishDate, now) ? scored.score : 0,
        // The cluster id is assigned regardless, because it answers a different
        // question — "how many outlets carried this" — which is still true of a
        // copy that has aged out of the ranking, and is what the Feeds list
        // shows as a source badge.
        clusterKey: index,
      });
    }
  });

  const clusterIds = await writeClusters(userId, clusterRows);
  const scored = await writeArticleScores(userId, assignments, clusterIds, now);

  return { articles: window.length, clusters: clusterRows.length, scored };
}

/**
 * Replace this user's clusters wholesale.
 *
 * Clusters are fully derived and cheap to rebuild, and their membership changes
 * every time a feed syncs, so reconciling them incrementally would be more code
 * and more failure modes than simply recomputing. Delete-then-insert also
 * guarantees no stale cluster outlives the articles it referred to.
 */
async function writeClusters(
  userId: string,
  rows: (typeof storyClusters.$inferInsert)[],
): Promise<string[]> {
  try {
    await db.delete(storyClusters).where(eq(storyClusters.userId, userId));
    if (rows.length === 0) return [];
    const inserted = await db
      .insert(storyClusters)
      .values(rows)
      .returning({ id: storyClusters.id });
    return inserted.map((r) => r.id);
  } catch (err) {
    console.error("[trending] cluster write failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Write scores back onto the articles.
 *
 * One UPDATE … FROM (VALUES …) per batch rather than one statement per article:
 * a few hundred individual updates would spend the entire function budget on
 * round trips. Batched so a very large window can't build a statement big
 * enough to upset the driver.
 */
const SCORE_BATCH = 200;

async function writeArticleScores(
  userId: string,
  assignments: { articleId: string; score: number; clusterKey: number }[],
  clusterIds: string[],
  now: Date,
): Promise<number> {
  if (assignments.length === 0) return 0;

  let written = 0;
  for (let i = 0; i < assignments.length; i += SCORE_BATCH) {
    const batch = assignments.slice(i, i + SCORE_BATCH);
    const values = sql.join(
      batch.map(
        (a) =>
          sql`(${a.articleId}::uuid, ${a.score}::real, ${clusterIds[a.clusterKey] ?? null}::uuid)`,
      ),
      sql`, `,
    );
    try {
      await db.execute(sql`
        update articles as a
        set trend_score = v.score,
            cluster_id = v.cluster_id,
            trend_scored_at = ${now.toISOString()}
        from (values ${values}) as v(id, score, cluster_id)
        where a.id = v.id and a.user_id = ${userId}
      `);
      written += batch.length;
    } catch (err) {
      console.error("[trending] score write failed:", err instanceof Error ? err.message : err);
    }
  }
  return written;
}

/**
 * Clear scores that have aged out of the day.
 *
 * Without this, an article scored highly yesterday keeps that score forever and
 * outranks today's news indefinitely — the ranking would silently become a
 * record of what was once hot rather than what is.
 *
 * The pass above already zeroes everything it reads, so this is the sweeper for
 * what it *didn't* read: articles past the 48-hour clustering window, and the
 * tail of a very busy day that fell beyond `MAX_ARTICLES`. Between them, the
 * invariant holds for every article a user owns — a non-zero `trend_score`
 * means "trending today", with no qualifiers.
 *
 * The cluster id outlives the score by another day, until the article leaves
 * the clustering window and the cluster row itself is rebuilt without it. It
 * answers "how many outlets carried this", which stays true of a story after it
 * stops being current, and is what the Feeds source badge reads.
 */
export async function decayStaleScores(userId: string, now: Date = new Date()): Promise<number> {
  const dayStart = trendingDayStart(now);
  const clusterCutoff = new Date(now.getTime() - WINDOW_HOURS * HOUR_MS);
  try {
    const stale = await db
      .select({ id: articles.id })
      .from(articles)
      .where(
        and(
          eq(articles.userId, userId),
          gte(articles.trendScore, 0.0001),
          sql`(${articles.publishDate} is null or ${articles.publishDate} < ${dayStart.toISOString()})`,
        ),
      )
      .limit(1000);
    if (stale.length === 0) return 0;
    await db
      .update(articles)
      .set({
        trendScore: 0,
        clusterId: sql`case when ${articles.publishDate} is null or ${articles.publishDate} < ${clusterCutoff.toISOString()} then null else ${articles.clusterId} end`,
        trendScoredAt: now,
      })
      .where(
        and(
          eq(articles.userId, userId),
          inArray(
            articles.id,
            stale.map((s) => s.id),
          ),
        ),
      );
    return stale.length;
  } catch (err) {
    console.error("[trending] decay failed:", err instanceof Error ? err.message : err);
    return 0;
  }
}
