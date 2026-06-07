import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { articles, feeds } from "@/lib/db/schema";
import { fetchAndParseFeed } from "@/lib/rss/parser";

export type SyncResult = {
  feedId: string;
  inserted: number;
  skipped: number;
  errored: boolean;
  error?: string;
};

/** Fetches a single feed and upserts new articles. Idempotent: existing (feed_id, guid) rows are skipped. */
export async function syncFeed(feedId: string, userId: string): Promise<SyncResult> {
  const [feed] = await db
    .select()
    .from(feeds)
    .where(and(eq(feeds.id, feedId), eq(feeds.userId, userId)))
    .limit(1);

  if (!feed) {
    return { feedId, inserted: 0, skipped: 0, errored: true, error: "Feed not found" };
  }

  try {
    const parsed = await fetchAndParseFeed(feed.url);

    let inserted = 0;
    let skipped = 0;

    if (parsed.items.length > 0) {
      const rows = parsed.items.map((item) => ({
        userId,
        feedId,
        folderId: feed.folderId,
        guid: item.guid,
        url: item.url,
        title: item.title,
        author: item.author,
        excerpt: item.excerpt,
        publishDate: item.publishDate,
        imageUrl: item.imageUrl,
        wordCount: item.content ? item.content.split(/\s+/).length : null,
      }));

      const result = await db
        .insert(articles)
        .values(rows)
        .onConflictDoNothing({ target: [articles.feedId, articles.guid] })
        .returning({ id: articles.id });

      inserted = result.length;
      skipped = rows.length - inserted;

      // NOTE: auto-embedding on sync was removed — it caused the server action
      // to time out when syncing many feeds (hundreds of parallel Voyage calls).
      // Run POST /api/embeddings/backfill periodically (or from the Ask UI) to
      // populate embeddings for new content.
    }

    await db
      .update(feeds)
      .set({
        lastFetchedAt: new Date(),
        lastError: null,
        title: feed.title === feed.url ? parsed.title : feed.title,
        siteUrl: feed.siteUrl ?? parsed.siteUrl ?? null,
        iconUrl: feed.iconUrl ?? parsed.iconUrl ?? null,
        description: feed.description ?? parsed.description ?? null,
      })
      .where(eq(feeds.id, feedId));

    return { feedId, inserted, skipped, errored: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await db
      .update(feeds)
      .set({ lastFetchedAt: new Date(), lastError: message })
      .where(eq(feeds.id, feedId));
    return { feedId, inserted: 0, skipped: 0, errored: true, error: message };
  }
}

// Max feeds processed concurrently. Feeds are network-bound (each is a remote
// fetch+parse), so higher concurrency cuts wall-clock a lot; 12 stays well
// within socket/memory limits while finishing far more feeds per invocation.
const SYNC_BATCH = 12;

// Wall-clock budget per invocation. Netlify's sync function cap is 10s (it
// IGNORES the route's maxDuration export — that's Vercel-only). We stop
// starting new batches past this and return a partial 200; the next run picks
// up where we left off because feeds are synced oldest-first.
const SYNC_BUDGET_MS = 8000;

/**
 * Run syncFeed across feeds in bounded-concurrency chunks via Promise.allSettled
 * (one slow/broken feed can't reject the batch). Time-boxed: bails out of the
 * loop once SYNC_BUDGET_MS elapses so the serverless function never times out.
 */
async function runSyncBatched(feedList: { id: string; userId: string }[]): Promise<SyncResult[]> {
  const start = Date.now();
  const results: SyncResult[] = [];
  for (let i = 0; i < feedList.length; i += SYNC_BATCH) {
    if (Date.now() - start > SYNC_BUDGET_MS) break; // out of budget — rest next run
    const batch = feedList.slice(i, i + SYNC_BATCH);
    const settled = await Promise.allSettled(batch.map((f) => syncFeed(f.id, f.userId)));
    for (let j = 0; j < settled.length; j += 1) {
      const s = settled[j];
      if (s.status === "fulfilled") {
        results.push(s.value);
      } else {
        results.push({
          feedId: batch[j].id,
          inserted: 0,
          skipped: 0,
          errored: true,
          error: s.reason instanceof Error ? s.reason.message : String(s.reason),
        });
      }
    }
  }
  return results;
}

// Oldest-synced feeds first, so each time-boxed run makes forward progress
// across the whole set instead of re-doing the same head every time.
const STALEST_FIRST = sql`last_fetched_at asc nulls first`;

/** Sync every feed in the database. Used by the cron route. */
export async function syncAllFeeds(): Promise<{ total: number; processed: number; ok: number; failed: number; results: SyncResult[] }> {
  const all = await db
    .select({ id: feeds.id, userId: feeds.userId })
    .from(feeds)
    .orderBy(STALEST_FIRST);
  const results = await runSyncBatched(all);
  await purgeOldReadArticles(); // global cleanup on the cron path
  return {
    total: all.length,
    processed: results.length,
    ok: results.filter((r) => !r.errored).length,
    failed: results.filter((r) => r.errored).length,
    results,
  };
}

/** Sync only one user's feeds (used by the in-app "Sync all" button). */
export async function syncUserFeeds(
  userId: string,
): Promise<{ total: number; processed: number; ok: number; failed: number; results: SyncResult[] }> {
  const all = await db
    .select({ id: feeds.id, userId: feeds.userId })
    .from(feeds)
    .where(eq(feeds.userId, userId))
    .orderBy(STALEST_FIRST);
  const results = await runSyncBatched(all);
  await purgeOldReadArticles(userId); // keep this user's table lean
  bustUnreadCounts(userId); // new articles changed the counts
  return {
    total: all.length,
    processed: results.length,
    ok: results.filter((r) => !r.errored).length,
    failed: results.filter((r) => r.errored).length,
    results,
  };
}

// Retention: read/archived articles older than this are purged so the table
// (and its indexes) stay lean — the main cause of "everything feels slow when
// I have a lot of articles". Starred and Read-Later items are kept forever.
const RETENTION_DAYS = 45;
const PURGE_BATCH = 2000;

/**
 * Delete a bounded batch of old, already-read articles (never touches unread,
 * starred, or read-later). Bounded so one run can't lock the table for long;
 * repeated sync runs catch up. Optionally scoped to a single user.
 */
export async function purgeOldReadArticles(userId?: string): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const userCond = userId ? sql`and user_id = ${userId}` : sql``;
  try {
    await db.execute(sql`
      delete from articles
      where id in (
        select id from articles
        where read_status in ('read', 'archived')
          and starred = false
          and read_later = false
          and created_at < ${cutoff}
          ${userCond}
        limit ${PURGE_BATCH}
      )
    `);
  } catch (err) {
    // Never let cleanup break a sync.
    console.warn("purgeOldReadArticles skipped:", err instanceof Error ? err.message : err);
  }
}

/** Returns unread counts per feed and per folder for the given user in a single round trip. */
export async function getUnreadCounts(userId: string) {
  // One scan, two groupings — postgres-js returns the result as the array directly.
  type Row = { feed_id: string; folder_id: string | null; count: number };
  const rows = (await db.execute(sql`
    select feed_id, folder_id, count(*)::int as count
    from articles
    where user_id = ${userId} and read_status = 'unread'
    group by feed_id, folder_id
  `)) as unknown as Row[];

  const perFeed: Record<string, number> = {};
  const perFolder: Record<string, number> = {};
  for (const r of rows) {
    perFeed[r.feed_id] = (perFeed[r.feed_id] ?? 0) + r.count;
    const folderKey = r.folder_id ?? "__inbox__";
    perFolder[folderKey] = (perFolder[folderKey] ?? 0) + r.count;
  }
  return { perFeed, perFolder };
}

// Short-TTL cache for the unread-count scan, which runs on every Feeds
// navigation. The scan is O(unread) — at scale it was the main per-load cost.
// Counts can lag a few seconds; mutating actions call bustUnreadCounts() to
// refresh immediately where it matters (mark read, sync).
type CountsData = Awaited<ReturnType<typeof getUnreadCounts>>;
const countsCache = new Map<string, { at: number; data: CountsData }>();
const COUNTS_TTL_MS = 15_000;

export async function getUnreadCountsCached(userId: string): Promise<CountsData> {
  const hit = countsCache.get(userId);
  if (hit && Date.now() - hit.at < COUNTS_TTL_MS) return hit.data;
  const data = await getUnreadCounts(userId);
  countsCache.set(userId, { at: Date.now(), data });
  return data;
}

/** Invalidate the cached unread counts for a user after a mutating action. */
export function bustUnreadCounts(userId: string): void {
  countsCache.delete(userId);
}
