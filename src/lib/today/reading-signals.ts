/**
 * What the reader's own behaviour says, read out of the database.
 *
 * Two queries with one thing in common: neither asks the reader for anything.
 * Which feeds they open and what they save are already recorded, and both turn
 * into things the brief can act on — how much a feed's corroboration is worth
 * (`feed-trust.ts`), and which desk they have not thought to create
 * (`desk-suggest.ts`).
 *
 * Split from the arithmetic for the same reason `feedback-store.ts` is split
 * from `brief-feedback.ts`: the maths is worth unit-testing and the query is
 * not, and a loader that takes a `userId` must never live in a `"use server"`
 * module where it would become an endpoint anyone could call with somebody
 * else's id.
 */

import { and, desc, eq, gte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { articles } from "@/lib/db/schema";
import { TRUST_WINDOW_DAYS, feedTrust, type FeedEngagement } from "./feed-trust";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * This user's per-feed trust multipliers.
 *
 * One grouped aggregate over a window the article indexes already cover. Runs
 * on the plan request and on each section request, where it is a cache hit for
 * the plan's own read in practice — and it is fail-soft: a slow or failed read
 * costs the brief its feed weighting, never the brief.
 */
export async function loadFeedTrust(
  userId: string,
  now: Date = new Date(),
): Promise<Record<string, number>> {
  try {
    const rows = await db
      .select({
        feedId: articles.feedId,
        delivered: sql<number>`count(*)::int`.as("delivered"),
        read: sql<number>`count(*) filter (where ${articles.readStatus} <> 'unread')::int`.as(
          "read",
        ),
        saved: sql<number>`count(*) filter (where ${articles.starred} or ${articles.readLater})::int`.as(
          "saved",
        ),
      })
      .from(articles)
      .where(
        and(
          eq(articles.userId, userId),
          gte(articles.createdAt, new Date(now.getTime() - TRUST_WINDOW_DAYS * DAY_MS)),
        ),
      )
      .groupBy(articles.feedId);
    return feedTrust(rows as FeedEngagement[]);
  } catch {
    return {};
  }
}

/**
 * Headlines of what this reader actually engaged with.
 *
 * Saved and starred articles first, because saving one is a deliberate act
 * about that article, where marking read is as often a backlog being cleared.
 * Titles only — desk suggestions are built from headline vocabulary, and
 * pulling bodies to count words would make a nice-to-have expensive.
 */
export async function loadEngagedTitles(
  userId: string,
  limit = 300,
  now: Date = new Date(),
): Promise<string[]> {
  try {
    const rows = await db
      .select({ title: articles.title })
      .from(articles)
      .where(
        and(
          eq(articles.userId, userId),
          gte(articles.createdAt, new Date(now.getTime() - TRUST_WINDOW_DAYS * DAY_MS)),
          or(
            eq(articles.starred, true),
            eq(articles.readLater, true),
            eq(articles.readStatus, "read"),
          ),
        ),
      )
      .orderBy(desc(articles.starred), desc(articles.readLater), desc(articles.createdAt))
      .limit(limit);
    return rows.map((r) => r.title);
  } catch {
    return [];
  }
}
