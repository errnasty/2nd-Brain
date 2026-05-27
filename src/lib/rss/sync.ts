import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { articles, feeds } from "@/lib/db/schema";
import { fetchAndParseFeed } from "@/lib/rss/parser";
import { embedArticle } from "@/lib/embeddings/backfill";

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
        .returning({ id: articles.id, title: articles.title, excerpt: articles.excerpt });

      inserted = result.length;
      skipped = rows.length - inserted;

      // Embed new articles in the background. Failures here don't affect the sync result;
      // backfillEmbeddings() can sweep up anything that didn't get embedded.
      if (process.env.OPENAI_API_KEY || process.env.VOYAGE_API_KEY) {
        await Promise.allSettled(
          result.map((row) => embedArticle(row.id, userId, row.title, row.excerpt)),
        );
      }
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

/** Sync every feed in the database. Used by the cron route. */
export async function syncAllFeeds(): Promise<{ total: number; ok: number; failed: number; results: SyncResult[] }> {
  const all = await db
    .select({ id: feeds.id, userId: feeds.userId })
    .from(feeds);

  const results: SyncResult[] = [];
  for (const feed of all) {
    // Serial — avoids hammering origin servers and stays inside Vercel function limits.
    const res = await syncFeed(feed.id, feed.userId);
    results.push(res);
  }

  return {
    total: all.length,
    ok: results.filter((r) => !r.errored).length,
    failed: results.filter((r) => r.errored).length,
    results,
  };
}

/** Returns unread counts per feed and per folder for the given user, in one round trip each. */
export async function getUnreadCounts(userId: string) {
  const perFeed = await db
    .select({
      feedId: articles.feedId,
      count: sql<number>`count(*)::int`.as("count"),
    })
    .from(articles)
    .where(and(eq(articles.userId, userId), eq(articles.readStatus, "unread")))
    .groupBy(articles.feedId);

  const perFolder = await db
    .select({
      folderId: articles.folderId,
      count: sql<number>`count(*)::int`.as("count"),
    })
    .from(articles)
    .where(and(eq(articles.userId, userId), eq(articles.readStatus, "unread")))
    .groupBy(articles.folderId);

  return {
    perFeed: Object.fromEntries(perFeed.map((r) => [r.feedId, r.count])) as Record<string, number>,
    perFolder: Object.fromEntries(
      perFolder.map((r) => [r.folderId ?? "__inbox__", r.count]),
    ) as Record<string, number>,
  };
}
